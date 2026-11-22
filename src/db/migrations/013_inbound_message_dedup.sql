-- 013_inbound_message_dedup.sql
-- Prevents duplicate inbound webhook deliveries from saving two customer messages or sending two AI replies.

CREATE TABLE IF NOT EXISTS inbound_message_dedup (
  dedup_key TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inbound_message_burst_guard (
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel, external_user_id, content_hash)
);
