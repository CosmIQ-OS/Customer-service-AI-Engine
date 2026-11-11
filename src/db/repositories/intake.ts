import type { DB } from '../database.js';
import { isIntakeComplete, type IntakeInput, type IntakeRecord } from '../../intake/intake.js';

export function getIntake(db: DB, sessionId: string): IntakeRecord | undefined {
  return db.prepare('SELECT * FROM service_intakes WHERE session_id = ?').get(sessionId) as IntakeRecord | undefined;
}

export function listIntakes(db: DB, limit = 100): IntakeRecord[] {
  return db.prepare(
    'SELECT * FROM service_intakes ORDER BY updated_at DESC, id DESC LIMIT ?',
  ).all(limit) as IntakeRecord[];
}

/** Merges supplied fields into the session's intake. Later calls never erase saved values. */
export function upsertIntake(
  db: DB,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    tenantId: string;
    patch: IntakeInput;
  },
): IntakeRecord {
  return db.transaction(() => {
    const existing = getIntake(db, input.sessionId);
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
      db.prepare(
        `UPDATE service_intakes SET
           company_name = @company_name, company_size = @company_size, current_tools = @current_tools,
           service_id = @service_id, service_name = @service_name, language = @language,
           status = @status, updated_at = datetime('now')
         WHERE session_id = @sessionId`,
      ).run({ sessionId: input.sessionId, ...merged, status });
    } else {
      db.prepare(
        `INSERT INTO service_intakes
           (session_id, channel, external_user_id, company_name, company_size, current_tools,
            service_id, service_name, language, status, tenant_id)
         VALUES (@sessionId, @channel, @externalUserId, @company_name, @company_size, @current_tools,
            @service_id, @service_name, @language, @status, @tenantId)`,
      ).run({
        sessionId: input.sessionId,
        channel: input.channel,
        externalUserId: input.externalUserId,
        tenantId: input.tenantId,
        ...merged,
        status,
      });
    }

    return getIntake(db, input.sessionId)!;
  })();
}
