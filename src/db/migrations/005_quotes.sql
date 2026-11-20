CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  intake_id INTEGER REFERENCES service_intakes(id) ON DELETE SET NULL,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  service_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'expired', 'superseded')),
  currency TEXT NOT NULL DEFAULT 'INR',
  margin_percent DOUBLE PRECISION NOT NULL,
  subtotal_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL DEFAULT 0,
  margin_paise BIGINT NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'pricing_agent',
  approved_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_session ON quotes(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS quote_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  price_item_id INTEGER REFERENCES price_items(id) ON DELETE SET NULL,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  admin_unit_price_paise BIGINT NOT NULL CHECK (admin_unit_price_paise >= 0),
  quoted_unit_price_paise BIGINT NOT NULL CHECK (quoted_unit_price_paise >= 0),
  line_total_paise BIGINT NOT NULL CHECK (line_total_paise >= 0),
  sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id, sort_order);
