import type { DB } from '../database.js';
import type { ChatLogRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ChatLogRecord, 'payload'> & { payload: string };
const map = (row: Row): ChatLogRecord => ({ ...row, payload: parseJson(row.payload, {}) });

export function listLogs(db: DB, limit = 200): ChatLogRecord[] {
  return (db.prepare('SELECT * FROM chat_logs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as Row[]).map(map);
}

export function createLog(
  db: DB,
  input: Pick<ChatLogRecord, 'channel' | 'external_user_id' | 'direction' | 'event'> &
    Partial<Pick<ChatLogRecord, 'request_id' | 'session_id' | 'message' | 'payload'>>,
): ChatLogRecord {
  const info = db.prepare(
    `INSERT INTO chat_logs (request_id, channel, external_user_id, session_id, direction, event, message, payload)
     VALUES (@request_id, @channel, @external_user_id, @session_id, @direction, @event, @message, @payload)`,
  ).run({
    request_id: input.request_id ?? null,
    channel: input.channel,
    external_user_id: input.external_user_id,
    session_id: input.session_id ?? null,
    direction: input.direction,
    event: input.event,
    message: input.message ?? '',
    payload: JSON.stringify(input.payload ?? {}),
  });
  return map(db.prepare('SELECT * FROM chat_logs WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
}
