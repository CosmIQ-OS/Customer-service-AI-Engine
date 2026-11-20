import type { DBExecutor } from '../database.js';
import type { ChatRequestRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ChatRequestRecord, 'metadata'> & { metadata: string };
const map = (row: Row): ChatRequestRecord => ({
  ...row,
  id: Number(row.id),
  metadata: parseJson(row.metadata, {}),
});

export async function listRequests(db: DBExecutor, limit = 100): Promise<ChatRequestRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM chat_requests ORDER BY created_at DESC, id DESC LIMIT $1', [limit]);
  return rows.map(map);
}

export async function createRequest(
  db: DBExecutor,
  input: Pick<ChatRequestRecord, 'channel' | 'external_user_id' | 'body'> &
    Partial<Pick<ChatRequestRecord, 'session_id' | 'kind' | 'subject' | 'status' | 'metadata'>>,
): Promise<ChatRequestRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO chat_requests (channel, external_user_id, session_id, kind, subject, body, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.channel,
      input.external_user_id,
      input.session_id ?? null,
      input.kind ?? 'message',
      input.subject ?? '',
      input.body,
      input.status ?? 'open',
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return map(row!);
}
