ALTER TABLE quotes ADD COLUMN next_alert_at TEXT;
ALTER TABLE quotes ADD COLUMN alert_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN decided_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN delivered_at TEXT;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  quote_id INTEGER,
  session_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON admin_notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_quote
  ON admin_notifications(quote_id);
