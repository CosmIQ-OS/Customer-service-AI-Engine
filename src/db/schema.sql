PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL CHECK (status IN ('available', 'unavailable', 'limited', 'maintenance')) DEFAULT 'available',
  availability_note TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL DEFAULT 'message',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  session_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  event TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES chat_requests(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  last_intent TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_faqs_enabled ON faqs(enabled);
CREATE INDEX IF NOT EXISTS idx_requests_channel_user ON chat_requests(channel, external_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_channel_user ON chat_logs(channel, external_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_request ON chat_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_sessions_channel_user ON sessions(channel, external_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
