import type { DBExecutor } from '../database.js';
import type { ChatLogRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ChatLogRecord, 'payload'> & { payload: string };
const map = (row: Row): ChatLogRecord => ({
  ...row,
  id: Number(row.id),
  request_id: row.request_id === null ? null : Number(row.request_id),
  payload: parseJson(row.payload, {}),
});

export async function listLogs(db: DBExecutor, limit = 200): Promise<ChatLogRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM chat_logs ORDER BY created_at DESC, id DESC LIMIT $1', [limit]);
  return rows.map(map);
}

export async function createLog(
  db: DBExecutor,
  input: Pick<ChatLogRecord, 'channel' | 'external_user_id' | 'direction' | 'event'> &
    Partial<Pick<ChatLogRecord, 'request_id' | 'session_id' | 'message' | 'payload'>>,
): Promise<ChatLogRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO chat_logs (request_id, channel, external_user_id, session_id, direction, event, message, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.request_id ?? null,
      input.channel,
      input.external_user_id,
      input.session_id ?? null,
      input.direction,
      input.event,
      input.message ?? '',
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return map(row!);
}
