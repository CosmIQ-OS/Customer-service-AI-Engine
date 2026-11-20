CREATE TABLE IF NOT EXISTS service_intakes (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  company_size TEXT NOT NULL DEFAULT '',
  current_tools TEXT NOT NULL DEFAULT '',
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'complete')),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_service_intakes_status ON service_intakes(tenant_id, status, updated_at DESC);
