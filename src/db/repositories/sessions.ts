import type { DB } from '../database.js';
import type { SessionRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<SessionRecord, 'context'> & { context: string };
const map = (row: Row): SessionRecord => ({ ...row, context: parseJson(row.context, {}) });

export function getSessionByKey(db: DB, channel: string, externalUserId: string): SessionRecord | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE channel = ? AND external_user_id = ?').get(channel, externalUserId) as Row | undefined;
  return row ? map(row) : undefined;
}

export function getSessionById(db: DB, id: string): SessionRecord | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
  return row ? map(row) : undefined;
}

export function upsertSession(
  db: DB,
  input: { id: string; channel: string; external_user_id: string; context: Record<string, unknown>; last_intent?: string; status?: string; expires_at?: string | null },
): SessionRecord {
  db.prepare(
    `INSERT INTO sessions (id, channel, external_user_id, context, last_intent, status, expires_at)
     VALUES (@id, @channel, @external_user_id, @context, @last_intent, @status, @expires_at)
     ON CONFLICT(channel, external_user_id) DO UPDATE SET
       context=excluded.context,
       last_intent=excluded.last_intent,
       status=excluded.status,
       expires_at=excluded.expires_at,
       updated_at=datetime('now')`,
  ).run({
    id: input.id,
    channel: input.channel,
    external_user_id: input.external_user_id,
    context: JSON.stringify(input.context ?? {}),
    last_intent: input.last_intent ?? '',
    status: input.status ?? 'active',
    expires_at: input.expires_at ?? null,
  });
  return getSessionByKey(db, input.channel, input.external_user_id)!;
}

export function listSessions(db: DB, limit = 100): SessionRecord[] {
  return (db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[]).map(map);
}
