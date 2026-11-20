import type { DB, DBExecutor } from '../database.js';
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

function mapTable(row: PriceTableRecord): PriceTableRecord {
  return {
    ...row,
    id: Number(row.id),
    service_id: Number(row.service_id),
    version: Number(row.version),
    item_count: Number(row.item_count),
    uploaded_by: row.uploaded_by === null ? null : Number(row.uploaded_by),
  };
}

function mapItem(row: PriceItemRecord): PriceItemRecord {
  return {
    ...row,
    id: Number(row.id),
    price_table_id: Number(row.price_table_id),
    unit_price_paise: Number(row.unit_price_paise),
    sort_order: Number(row.sort_order),
  };
}

export async function activePriceTable(db: DBExecutor, serviceId: number): Promise<PriceTableRecord | undefined> {
  const row = await db.queryOne<PriceTableRecord>(
    `SELECT * FROM price_tables WHERE service_id = $1 AND status = 'active'`,
    [serviceId],
  );
  return row ? mapTable(row) : undefined;
}

export async function listPriceTables(db: DBExecutor, serviceId: number): Promise<PriceTableRecord[]> {
  const { rows } = await db.query<PriceTableRecord>(
    'SELECT * FROM price_tables WHERE service_id = $1 ORDER BY version DESC',
    [serviceId],
  );
  return rows.map(mapTable);
}

export async function listPriceItems(db: DBExecutor, priceTableId: number): Promise<PriceItemRecord[]> {
  const { rows } = await db.query<PriceItemRecord>(
    'SELECT * FROM price_items WHERE price_table_id = $1 ORDER BY sort_order ASC',
    [priceTableId],
  );
  return rows.map(mapItem);
}

/** Publishes a new active version and supersedes the previous one. All-or-nothing. */
export async function publishPriceTable(
  db: DB,
  input: { serviceId: number; sourceFilename: string; uploadedBy: number | null; items: PriceItemDraft[] },
): Promise<PriceTableRecord> {
  return db.transaction(async (tx) => {
    const nextRow = await tx.queryOne<{ next: number }>(
      'SELECT (COALESCE(MAX(version), 0) + 1)::int AS next FROM price_tables WHERE service_id = $1',
      [input.serviceId],
    );
    const next = Number(nextRow?.next ?? 1);

    await tx.query(
      `UPDATE price_tables SET status = 'superseded' WHERE service_id = $1 AND status = 'active'`,
      [input.serviceId],
    );

    const table = await tx.queryOne<PriceTableRecord>(
      `INSERT INTO price_tables (service_id, version, status, source_filename, item_count, uploaded_by)
       VALUES ($1, $2, 'active', $3, $4, $5)
       RETURNING *`,
      [input.serviceId, next, input.sourceFilename, input.items.length, input.uploadedBy],
    );
    const tableId = Number(table!.id);

    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      await tx.query(
        `INSERT INTO price_items (price_table_id, item_code, description, unit, unit_price_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tableId, item.item_code, item.description, item.unit, item.unit_price_paise, index + 1],
      );
    }

    return mapTable(table!);
  });
}
