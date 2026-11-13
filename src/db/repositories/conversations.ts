import type { DB } from '../database.js';

export type ConversationMode = 'ai' | 'human' | 'paused';
export type ConversationStatus = 'open' | 'closed';

export interface ConversationRecord {
  session_id: string;
  channel: string;
  external_user_id: string;
  display_name: string;
  mode: ConversationMode;
  status: ConversationStatus;
  taken_over_by: number | null;
  assigned_agent_name: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_human_reply_at: string | null;
  idle_deadline_at: string | null;
  unread_count: number;
  closed_at: string | null;
  closed_reason: string;
  created_at: string;
  updated_at: string;
}

export function getConversation(db: DB, sessionId: string): ConversationRecord | undefined {
  return db.prepare('SELECT * FROM conversations WHERE session_id = ?').get(sessionId) as ConversationRecord | undefined;
}

export function upsertConversation(
  db: DB,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    displayName?: string;
  },
): ConversationRecord {
  db.prepare(
    `INSERT INTO conversations (session_id, channel, external_user_id, display_name)
     VALUES (@sessionId, @channel, @externalUserId, @displayName)
     ON CONFLICT(session_id) DO UPDATE SET
       display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE conversations.display_name END,
       updated_at = datetime('now')`,
  ).run({
    sessionId: input.sessionId,
    channel: input.channel,
    externalUserId: input.externalUserId,
    displayName: input.displayName ?? '',
  });
  return getConversation(db, input.sessionId)!;
}

export function updateConversation(
  db: DB,
  sessionId: string,
  patch: Partial<
    Pick<
      ConversationRecord,
      | 'mode'
      | 'status'
      | 'taken_over_by'
      | 'assigned_agent_name'
      | 'last_inbound_at'
      | 'last_outbound_at'
      | 'last_human_reply_at'
      | 'idle_deadline_at'
      | 'unread_count'
      | 'closed_at'
      | 'closed_reason'
      | 'display_name'
    >
  >,
): ConversationRecord | undefined {
  const existing = getConversation(db, sessionId);
  if (!existing) return undefined;
  const next = {
    mode: patch.mode ?? existing.mode,
    status: patch.status ?? existing.status,
    taken_over_by: patch.taken_over_by === undefined ? existing.taken_over_by : patch.taken_over_by,
    assigned_agent_name: patch.assigned_agent_name ?? existing.assigned_agent_name,
    last_inbound_at: patch.last_inbound_at === undefined ? existing.last_inbound_at : patch.last_inbound_at,
    last_outbound_at: patch.last_outbound_at === undefined ? existing.last_outbound_at : patch.last_outbound_at,
    last_human_reply_at:
      patch.last_human_reply_at === undefined ? existing.last_human_reply_at : patch.last_human_reply_at,
    idle_deadline_at: patch.idle_deadline_at === undefined ? existing.idle_deadline_at : patch.idle_deadline_at,
    unread_count: patch.unread_count ?? existing.unread_count,
    closed_at: patch.closed_at === undefined ? existing.closed_at : patch.closed_at,
    closed_reason: patch.closed_reason ?? existing.closed_reason,
    display_name: patch.display_name ?? existing.display_name,
  };
  db.prepare(
    `UPDATE conversations SET mode=@mode, status=@status, taken_over_by=@taken_over_by, assigned_agent_name=@assigned_agent_name,
       last_inbound_at=@last_inbound_at, last_outbound_at=@last_outbound_at, last_human_reply_at=@last_human_reply_at,
       idle_deadline_at=@idle_deadline_at, unread_count=@unread_count, closed_at=@closed_at,
       closed_reason=@closed_reason, display_name=@display_name, updated_at=datetime('now')
     WHERE session_id=@sessionId`,
  ).run({ sessionId, ...next });
  return getConversation(db, sessionId);
}

export function listConversations(db: DB, limit = 100): ConversationRecord[] {
  return db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as ConversationRecord[];
}

/** Open conversations that a human owns and that have been idle past their deadline. */
export function listIdleConversations(db: DB, now: string): ConversationRecord[] {
  return db
    .prepare(
      `SELECT * FROM conversations
       WHERE status = 'open' AND mode IN ('human', 'paused') AND idle_deadline_at IS NOT NULL AND idle_deadline_at <= ?
       ORDER BY idle_deadline_at ASC`,
    )
    .all(now) as ConversationRecord[];
}

export function countOpenConversations(db: DB): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'open' AND mode <> 'ai'")
    .get() as { count: number };
  return row.count;
}
