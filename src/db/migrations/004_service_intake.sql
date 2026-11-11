CREATE TABLE IF NOT EXISTS service_intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  company_size TEXT NOT NULL DEFAULT '',
  current_tools TEXT NOT NULL DEFAULT '',
  service_id INTEGER,
  service_name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'complete')),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_intakes_status ON service_intakes(tenant_id, status, updated_at DESC);
