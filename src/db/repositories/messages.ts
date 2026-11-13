import type { DB } from '../database.js';
import type { MessageRecord } from '../../engine/types.js';

export function appendMessage(
  db: DB,
  input: Pick<MessageRecord, 'session_id' | 'channel' | 'external_user_id' | 'role' | 'content'> &
    Partial<Pick<MessageRecord, 'tenant_id' | 'tokens'>>,
): MessageRecord {
  const info = db.prepare(
    `INSERT INTO messages (session_id, channel, external_user_id, role, content, tokens, tenant_id)
     VALUES (@session_id, @channel, @external_user_id, @role, @content, @tokens, @tenant_id)`,
  ).run({
    session_id: input.session_id,
    channel: input.channel,
    external_user_id: input.external_user_id,
    role: input.role,
    content: input.content,
    tokens: input.tokens ?? estimateTokens(input.content),
    tenant_id: input.tenant_id ?? 'default',
  });
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid)) as MessageRecord;
}

export function listRecentMessages(db: DB, sessionId: string, limit = 12): MessageRecord[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, clampLimit(limit)) as MessageRecord[];
  return rows.reverse();
}

export function listMessages(db: DB, sessionId: string, limit = 100): MessageRecord[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, clampLimit(limit)) as MessageRecord[];
  return rows.reverse();
}

/** Keeps a caller-supplied limit inside a sane range. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}
