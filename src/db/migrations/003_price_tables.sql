CREATE TABLE IF NOT EXISTS price_tables (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  currency TEXT NOT NULL DEFAULT 'INR',
  source_filename TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (service_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_tables_one_active ON price_tables(service_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS price_items (
  id SERIAL PRIMARY KEY,
  price_table_id INTEGER NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  sort_order INTEGER NOT NULL,
  UNIQUE (price_table_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_price_items_table ON price_items(price_table_id, sort_order);
