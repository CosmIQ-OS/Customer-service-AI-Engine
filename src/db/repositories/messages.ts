import type { DBExecutor } from '../database.js';
import type { MessageRecord } from '../../engine/types.js';

function map(row: MessageRecord): MessageRecord {
  return {
    ...row,
    id: Number(row.id),
    tokens: Number(row.tokens),
  };
}

export async function appendMessage(
  db: DBExecutor,
  input: Pick<MessageRecord, 'session_id' | 'channel' | 'external_user_id' | 'role' | 'content'> &
    Partial<Pick<MessageRecord, 'tenant_id' | 'tokens'>>,
): Promise<MessageRecord> {
  const row = await db.queryOne<MessageRecord>(
    `INSERT INTO messages (session_id, channel, external_user_id, role, content, tokens, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.session_id,
      input.channel,
      input.external_user_id,
      input.role,
      input.content,
      input.tokens ?? estimateTokens(input.content),
      input.tenant_id ?? 'default',
    ],
  );
  return map(row!);
}

export async function listRecentMessages(db: DBExecutor, sessionId: string, limit = 12): Promise<MessageRecord[]> {
  const { rows } = await db.query<MessageRecord>(
    'SELECT * FROM messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2',
    [sessionId, clampLimit(limit)],
  );
  return rows.map(map).reverse();
}

export async function listMessages(db: DBExecutor, sessionId: string, limit = 100): Promise<MessageRecord[]> {
  const { rows } = await db.query<MessageRecord>(
    'SELECT * FROM messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2',
    [sessionId, clampLimit(limit)],
  );
  return rows.map(map).reverse();
}

export async function getMessageById(db: DBExecutor, id: number): Promise<MessageRecord | undefined> {
  const row = await db.queryOne<MessageRecord>('SELECT * FROM messages WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function deleteSentMessage(
  db: DBExecutor,
  sessionId: string,
  messageId: number,
): Promise<MessageRecord | undefined> {
  const row = await db.queryOne<MessageRecord>(
    `DELETE FROM messages
     WHERE id = $1 AND session_id = $2 AND role IN ('human', 'assistant')
     RETURNING *`,
    [messageId, sessionId],
  );
  return row ? map(row) : undefined;
}

/** Keeps a caller-supplied limit inside a sane range. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}
