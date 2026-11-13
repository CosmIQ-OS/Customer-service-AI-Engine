CREATE TABLE IF NOT EXISTS conversations (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'human', 'paused')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  taken_over_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_agent_name TEXT NOT NULL DEFAULT '',
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  last_human_reply_at TEXT,
  idle_deadline_at TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closed_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_mode ON conversations(mode, status);
CREATE INDEX IF NOT EXISTS idx_conversations_activity ON conversations(updated_at DESC);
