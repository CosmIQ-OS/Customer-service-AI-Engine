import { UTC_NOW_SQL, type DBExecutor } from '../database.js';

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

function map(row: ConversationRecord): ConversationRecord {
  return {
    ...row,
    taken_over_by: row.taken_over_by === null ? null : Number(row.taken_over_by),
    unread_count: Number(row.unread_count),
  };
}

export async function getConversation(db: DBExecutor, sessionId: string): Promise<ConversationRecord | undefined> {
  const row = await db.queryOne<ConversationRecord>('SELECT * FROM conversations WHERE session_id = $1', [sessionId]);
  return row ? map(row) : undefined;
}

export async function upsertConversation(
  db: DBExecutor,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    displayName?: string;
  },
): Promise<ConversationRecord> {
  const row = await db.queryOne<ConversationRecord>(
    `INSERT INTO conversations (session_id, channel, external_user_id, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(session_id) DO UPDATE SET
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE conversations.display_name END,
       updated_at = ${UTC_NOW_SQL}
     RETURNING *`,
    [input.sessionId, input.channel, input.externalUserId, input.displayName ?? ''],
  );
  return map(row!);
}

export async function updateConversation(
  db: DBExecutor,
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
): Promise<ConversationRecord | undefined> {
  const existing = await getConversation(db, sessionId);
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
  const row = await db.queryOne<ConversationRecord>(
    `UPDATE conversations SET
       mode = $1, status = $2, taken_over_by = $3, assigned_agent_name = $4,
       last_inbound_at = $5, last_outbound_at = $6, last_human_reply_at = $7,
       idle_deadline_at = $8, unread_count = $9, closed_at = $10,
       closed_reason = $11, display_name = $12, updated_at = ${UTC_NOW_SQL}
     WHERE session_id = $13
     RETURNING *`,
    [
      next.mode,
      next.status,
      next.taken_over_by,
      next.assigned_agent_name,
      next.last_inbound_at,
      next.last_outbound_at,
      next.last_human_reply_at,
      next.idle_deadline_at,
      next.unread_count,
      next.closed_at,
      next.closed_reason,
      next.display_name,
      sessionId,
    ],
  );
  return row ? map(row) : undefined;
}

export async function listConversations(db: DBExecutor, limit = 100): Promise<ConversationRecord[]> {
  const { rows } = await db.query<ConversationRecord>(
    'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT $1',
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map(map);
}

/** Open conversations that a human owns and that have been idle past their deadline. */
export async function listIdleConversations(db: DBExecutor, now: string): Promise<ConversationRecord[]> {
  const { rows } = await db.query<ConversationRecord>(
    `SELECT * FROM conversations
     WHERE status = 'open' AND mode IN ('human', 'paused') AND idle_deadline_at IS NOT NULL AND idle_deadline_at <= $1
     ORDER BY idle_deadline_at ASC`,
    [now],
  );
  return rows.map(map);
}

export async function countOpenConversations(db: DBExecutor): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM conversations WHERE status = 'open' AND mode <> 'ai'",
  );
  return Number(row?.count ?? 0);
}
