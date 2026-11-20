import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import { isIntakeComplete, type IntakeInput, type IntakeRecord, type IntakeStatus } from '../../intake/intake.js';

function map(row: IntakeRecord): IntakeRecord {
  const rawStatus = row.status as string;
  return {
    ...row,
    id: Number(row.id),
    service_id: row.service_id === null ? null : Number(row.service_id),
    status: rawStatus === 'complete' ? 'collected' : row.status,
  };
}

export async function getIntake(db: DBExecutor, sessionId: string): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeRecord>('SELECT * FROM service_intakes WHERE session_id = $1', [sessionId]);
  return row ? map(row) : undefined;
}

export async function getIntakeById(db: DBExecutor, id: number): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeRecord>('SELECT * FROM service_intakes WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function listIntakes(db: DBExecutor, limit = 100): Promise<IntakeRecord[]> {
  const { rows } = await db.query<IntakeRecord>(
    'SELECT * FROM service_intakes ORDER BY updated_at DESC, id DESC LIMIT $1',
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
         service_id = $4, service_name = $5, language = $6,
         status = $7, updated_at = ${UTC_NOW_SQL}
       WHERE session_id = $8
       RETURNING *`,
      [
        merged.company_name,
        merged.company_size,
        merged.current_tools,
        merged.service_id,
        merged.service_name,
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
        service_id, service_name, language, status, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
