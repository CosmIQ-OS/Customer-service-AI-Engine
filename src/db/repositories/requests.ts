import type { DB } from '../database.js';
import type { ChatRequestRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ChatRequestRecord, 'metadata'> & { metadata: string };
const map = (row: Row): ChatRequestRecord => ({ ...row, metadata: parseJson(row.metadata, {}) });

export function listRequests(db: DB, limit = 100): ChatRequestRecord[] {
  return (db.prepare('SELECT * FROM chat_requests ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as Row[]).map(map);
}

export function createRequest(
  db: DB,
  input: Pick<ChatRequestRecord, 'channel' | 'external_user_id' | 'body'> &
    Partial<Pick<ChatRequestRecord, 'session_id' | 'kind' | 'subject' | 'status' | 'metadata'>>,
): ChatRequestRecord {
  const info = db.prepare(
    `INSERT INTO chat_requests (channel, external_user_id, session_id, kind, subject, body, status, metadata)
     VALUES (@channel, @external_user_id, @session_id, @kind, @subject, @body, @status, @metadata)`,
  ).run({
    channel: input.channel,
    external_user_id: input.external_user_id,
    session_id: input.session_id ?? null,
    kind: input.kind ?? 'message',
    subject: input.subject ?? '',
    body: input.body,
    status: input.status ?? 'open',
    metadata: JSON.stringify(input.metadata ?? {}),
  });
  return map(db.prepare('SELECT * FROM chat_requests WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
}
