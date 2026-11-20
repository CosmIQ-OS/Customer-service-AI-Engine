import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import { isIntakeComplete, type IntakeInput, type IntakeRecord } from '../../intake/intake.js';

function map(row: IntakeRecord): IntakeRecord {
  return {
    ...row,
    id: Number(row.id),
    service_id: row.service_id === null ? null : Number(row.service_id),
  };
}

export async function getIntake(db: DBExecutor, sessionId: string): Promise<IntakeRecord | undefined> {
  const row = await db.queryOne<IntakeRecord>('SELECT * FROM service_intakes WHERE session_id = $1', [sessionId]);
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
  db: DB,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    tenantId: string;
    patch: IntakeInput;
  },
): Promise<IntakeRecord> {
  return db.transaction(async (tx) => {
    const existing = await getIntake(tx, input.sessionId);
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
    const status = isIntakeComplete(merged) ? 'complete' : 'collecting';

    if (existing) {
      const row = await tx.queryOne<IntakeRecord>(
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

    const row = await tx.queryOne<IntakeRecord>(
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
  });
}
