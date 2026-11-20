ALTER TABLE quotes ADD COLUMN IF NOT EXISTS next_alert_at TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS alert_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decided_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS delivered_at TEXT;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON admin_notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_quote
  ON admin_notifications(quote_id);
