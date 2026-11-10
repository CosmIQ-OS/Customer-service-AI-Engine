CREATE TABLE IF NOT EXISTS price_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  currency TEXT NOT NULL DEFAULT 'INR',
  source_filename TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  UNIQUE (service_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_tables_one_active ON price_tables(service_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS price_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_table_id INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (price_table_id) REFERENCES price_tables(id) ON DELETE CASCADE,
  UNIQUE (price_table_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_price_items_table ON price_items(price_table_id, sort_order);
