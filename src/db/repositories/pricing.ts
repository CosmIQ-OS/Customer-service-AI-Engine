import type { DB } from '../database.js';
import type { PriceItemDraft } from '../../pricing/parse-price-table.js';

export interface PriceTableRecord {
  id: number;
  service_id: number;
  version: number;
  status: 'active' | 'superseded';
  currency: string;
  source_filename: string;
  item_count: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface PriceItemRecord {
  id: number;
  price_table_id: number;
  item_code: string;
  description: string;
  unit: string;
  unit_price_paise: number;
  sort_order: number;
}

export function activePriceTable(db: DB, serviceId: number): PriceTableRecord | undefined {
  return db.prepare(
    `SELECT * FROM price_tables WHERE service_id = ? AND status = 'active'`,
  ).get(serviceId) as PriceTableRecord | undefined;
}

export function listPriceTables(db: DB, serviceId: number): PriceTableRecord[] {
  return db.prepare(
    'SELECT * FROM price_tables WHERE service_id = ? ORDER BY version DESC',
  ).all(serviceId) as PriceTableRecord[];
}

export function listPriceItems(db: DB, priceTableId: number): PriceItemRecord[] {
  return db.prepare(
    'SELECT * FROM price_items WHERE price_table_id = ? ORDER BY sort_order ASC',
  ).all(priceTableId) as PriceItemRecord[];
}

/** Publishes a new active version and supersedes the previous one. All-or-nothing. */
export function publishPriceTable(
  db: DB,
  input: { serviceId: number; sourceFilename: string; uploadedBy: number | null; items: PriceItemDraft[] },
): PriceTableRecord {
  return db.transaction(() => {
    const { next } = db.prepare(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM price_tables WHERE service_id = ?',
    ).get(input.serviceId) as { next: number };

    db.prepare(
      `UPDATE price_tables SET status = 'superseded' WHERE service_id = ? AND status = 'active'`,
    ).run(input.serviceId);

    const info = db.prepare(
      `INSERT INTO price_tables (service_id, version, status, source_filename, item_count, uploaded_by)
       VALUES (?, ?, 'active', ?, ?, ?)`,
    ).run(input.serviceId, next, input.sourceFilename, input.items.length, input.uploadedBy);
    const tableId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO price_items (price_table_id, item_code, description, unit, unit_price_paise, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    input.items.forEach((item, index) => {
      insertItem.run(tableId, item.item_code, item.description, item.unit, item.unit_price_paise, index + 1);
    });

    return db.prepare('SELECT * FROM price_tables WHERE id = ?').get(tableId) as PriceTableRecord;
  })();
}
