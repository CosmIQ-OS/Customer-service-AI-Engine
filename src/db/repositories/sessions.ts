import { UTC_NOW_SQL, type DBExecutor } from '../database.js';
import type { SessionRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<SessionRecord, 'context'> & { context: string };
const map = (row: Row): SessionRecord => ({ ...row, context: parseJson(row.context, {}) });

export async function getSessionByKey(
  db: DBExecutor,
  channel: string,
  externalUserId: string,
): Promise<SessionRecord | undefined> {
  const row = await db.queryOne<Row>(
    'SELECT * FROM sessions WHERE channel = $1 AND external_user_id = $2',
    [channel, externalUserId],
  );
  return row ? map(row) : undefined;
}

export async function getSessionById(db: DBExecutor, id: string): Promise<SessionRecord | undefined> {
  const row = await db.queryOne<Row>('SELECT * FROM sessions WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function upsertSession(
  db: DBExecutor,
  input: {
    id: string;
    channel: string;
    external_user_id: string;
    context: Record<string, unknown>;
    last_intent?: string;
    status?: string;
    expires_at?: string | null;
  },
): Promise<SessionRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO sessions (id, channel, external_user_id, context, last_intent, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(channel, external_user_id) DO UPDATE SET
       context = EXCLUDED.context,
       last_intent = EXCLUDED.last_intent,
       status = EXCLUDED.status,
       expires_at = EXCLUDED.expires_at,
       updated_at = ${UTC_NOW_SQL}
     RETURNING *`,
    [
      input.id,
      input.channel,
      input.external_user_id,
      JSON.stringify(input.context ?? {}),
      input.last_intent ?? '',
      input.status ?? 'active',
      input.expires_at ?? null,
    ],
  );
  return map(row!);
}

export async function listSessions(db: DBExecutor, limit = 100): Promise<SessionRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT $1', [limit]);
  return rows.map(map);
}
