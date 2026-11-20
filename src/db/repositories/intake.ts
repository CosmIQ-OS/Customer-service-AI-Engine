import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import {
  extractEmailFromText,
  isIntakeComplete,
  type IntakeInput,
  type IntakeRecord,
  type IntakeStatus,
} from '../../intake/intake.js';
import { parseJson } from './common.js';

type IntakeQueryRow = IntakeRecord & {
  session_context?: string | null;
  email_hint?: string | null;
};

const INTAKE_SELECT_SQL = `
  SELECT i.*,
         s.context AS session_context,
         (
           SELECT m.content
           FROM messages m
           WHERE m.session_id = i.session_id
             AND m.role = 'user'
             AND m.content LIKE '%@%'
           ORDER BY m.id DESC
           LIMIT 1
         ) AS email_hint
  FROM service_intakes i
  LEFT JOIN sessions s ON s.id = i.session_id
`;

function map(row: IntakeQueryRow): IntakeRecord {
  const { session_context, email_hint, ...baseRow } = row;
  const rawStatus = baseRow.status as string;
  const ctx = session_context ? parseJson<Record<string, unknown>>(session_context, {}) : {};
  const ctxEmail = typeof ctx.email === 'string' ? ctx.email.trim() : '';
  const ctxContact =
    typeof ctx.contact_person === 'string' && ctx.contact_person.trim()
      ? ctx.contact_person.trim()
      : typeof ctx.name === 'string'
        ? ctx.name.trim()
        : '';

  const resolvedEmail =
    (baseRow.email ?? '').trim() ||
    ctxEmail ||
    extractEmailFromText(baseRow.external_user_id) ||
    extractEmailFromText(email_hint);
  const resolvedContact = (baseRow.contact_person ?? '').trim() || ctxContact;

  return {
    ...baseRow,
    id: Number(baseRow.id),
    service_id: baseRow.service_id === null ? null : Number(baseRow.service_id),
    email: resolvedEmail,
    contact_person: resolvedContact,
    status: rawStatus === 'complete' ? 'collected' : baseRow.status,
  };
}

export async function getIntake(db: DBExecutor, sessionId: string): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeQueryRow>(`${INTAKE_SELECT_SQL} WHERE i.session_id = $1`, [sessionId]);
  return row ? map(row) : undefined;
}

export async function getIntakeById(db: DBExecutor, id: number): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeQueryRow>(`${INTAKE_SELECT_SQL} WHERE i.id = $1`, [id]);
  return row ? map(row) : undefined;
}

export async function listIntakes(db: DBExecutor, limit = 100): Promise<IntakeRecord[]> {
  const { rows } = await db.query<IntakeQueryRow>(
    `${INTAKE_SELECT_SQL} ORDER BY i.updated_at DESC, i.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(map);
}

/** Merges supplied fields into the session's intake. Later calls never erase saved values. */
export async function upsertIntake(
  db: DBExecutor,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    tenantId: string;
    patch: IntakeInput;
  },
): Promise<IntakeRecord> {
  const existing = await getIntake(db, input.sessionId);
  const pick = (field: keyof IntakeInput): string | undefined => {
    const value = input.patch[field];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  };

  const merged = {
    company_name: pick('company_name') ?? existing?.company_name ?? '',
    company_size: pick('company_size') ?? existing?.company_size ?? '',
    current_tools: pick('current_tools') ?? existing?.current_tools ?? '',
    service_name: pick('service_name') ?? existing?.service_name ?? '',
    service_id: input.patch.service_id !== undefined ? input.patch.service_id : existing?.service_id ?? null,
    email: pick('email') ?? existing?.email ?? '',
    contact_person: pick('contact_person') ?? existing?.contact_person ?? '',
    language: pick('language') ?? existing?.language ?? '',
  };
  const complete = isIntakeComplete(merged);
  const status: IntakeStatus =
    existing && existing.status !== 'collecting'
      ? existing.status
      : complete
        ? 'collected'
        : 'collecting';

  if (existing) {
    const row = await db.queryOne<IntakeRecord>(
      `UPDATE service_intakes SET
         company_name = $1, company_size = $2, current_tools = $3,
         service_id = $4, service_name = $5, email = $6, contact_person = $7,
         language = $8, status = $9, updated_at = ${UTC_NOW_SQL}
       WHERE session_id = $10
       RETURNING *`,
      [
        merged.company_name,
        merged.company_size,
        merged.current_tools,
        merged.service_id,
        merged.service_name,
        merged.email,
        merged.contact_person,
        merged.language,
        status,
        input.sessionId,
      ],
    );
    return map(row!);
  }

  const row = await db.queryOne<IntakeRecord>(
    `INSERT INTO service_intakes
       (session_id, channel, external_user_id, company_name, company_size, current_tools,
        service_id, service_name, email, contact_person, language, status, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.sessionId,
      input.channel,
      input.externalUserId,
      merged.company_name,
      merged.company_size,
      merged.current_tools,
      merged.service_id,
      merged.service_name,
      merged.email,
      merged.contact_person,
      merged.language,
      status,
      input.tenantId,
    ],
  );
  return map(row!);
}

export async function markIntakeComplete(db: DBExecutor, sessionId: string): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeRecord>(
    `UPDATE service_intakes
     SET status = CASE WHEN status = 'collecting' THEN 'collected' ELSE status END,
         updated_at = ${UTC_NOW_SQL}
     WHERE session_id = $1
     RETURNING *`,
    [sessionId],
  );
  return row ? map(row) : undefined;
}

export async function updateIntakeStatus(
  db: DBExecutor,
  id: number,
  status: IntakeStatus,
): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeRecord>(
    `UPDATE service_intakes SET status = $1, updated_at = ${UTC_NOW_SQL} WHERE id = $2 RETURNING *`,
    [status, id],
  );
  return row ? map(row) : undefined;
}

export async function deleteIntake(db: DBExecutor, id: number): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeQueryRow>(
    'DELETE FROM service_intakes WHERE id = $1 RETURNING *',
    [id],
  );
  return row ? map(row) : undefined;
}

export async function advanceIntakeToQuoted(
  db: DBExecutor,
  opts: { sessionId?: string | null; intakeId?: number | null },
): Promise<void> {
  if (opts.intakeId) {
    await db.query(
      `UPDATE service_intakes
       SET status = 'quoted', updated_at = ${UTC_NOW_SQL}
       WHERE id = $1 AND status IN ('collecting', 'collected', 'complete')`,
      [opts.intakeId],
    );
    return;
  }
  if (opts.sessionId) {
    await db.query(
      `UPDATE service_intakes
       SET status = 'quoted', updated_at = ${UTC_NOW_SQL}
       WHERE session_id = $1 AND status IN ('collecting', 'collected', 'complete')`,
      [opts.sessionId],
    );
  }
}
