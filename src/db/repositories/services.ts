import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import type { ServiceRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ServiceRecord, 'metadata' | 'base_price_paise'> & {
  metadata: string;
  base_price_paise: number | string;
};

function map(row: Row): ServiceRecord {
  return {
    ...row,
    id: Number(row.id),
    base_price_paise: Number(row.base_price_paise ?? 0),
    metadata: parseJson(row.metadata, {}),
  };
}

function normalizeBasePricePaise(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('base_price_paise must be a non-negative integer.');
  }
  return value;
}

export async function listServices(db: DBExecutor): Promise<ServiceRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM services ORDER BY updated_at DESC, id DESC');
  return rows.map(map);
}

export async function getService(db: DBExecutor, id: number): Promise<ServiceRecord | undefined> {
  const row = await db.queryOne<Row>('SELECT * FROM services WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export const getServiceById = getService;

export async function createService(
  db: DBExecutor,
  input: Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note'> & {
    base_price_paise?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<ServiceRecord> {
  const basePricePaise = normalizeBasePricePaise(input.base_price_paise ?? 0);
  const row = await db.queryOne<Row>(
    `INSERT INTO services (name, description, category, status, availability_note, base_price_paise, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.name,
      input.description,
      input.category,
      input.status,
      input.availability_note,
      basePricePaise,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return map(row!);
}

export async function updateService(
  db: DBExecutor,
  id: number,
  input: Partial<Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note' | 'base_price_paise'>> & {
    metadata?: Record<string, unknown>;
  },
): Promise<ServiceRecord | undefined> {
  const existing = await getService(db, id);
  if (!existing) return undefined;
  const basePricePaise = normalizeBasePricePaise(input.base_price_paise ?? existing.base_price_paise);
  const row = await db.queryOne<Row>(
    `UPDATE services
     SET name = $1, description = $2, category = $3, status = $4,
         availability_note = $5, base_price_paise = $6, metadata = $7, updated_at = ${UTC_NOW_SQL}
     WHERE id = $8
     RETURNING *`,
    [
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.category ?? existing.category,
      input.status ?? existing.status,
      input.availability_note ?? existing.availability_note,
      basePricePaise,
      JSON.stringify(input.metadata ?? existing.metadata),
      id,
    ],
  );
  return row ? map(row) : undefined;
}

export type DeleteServiceResult =
  | { status: 'deleted'; id: number }
  | { status: 'not_found' }
  | { status: 'in_use'; quoteCount: number };

async function countReferencingQuotes(db: DBExecutor, id: number): Promise<number> {
  const hasQuoteItemsServiceId = await db.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'quote_items'
         AND column_name = 'service_id'
     ) AS exists`,
  );

  const refRow = hasQuoteItemsServiceId?.exists
    ? await db.queryOne<{ count: number }>(
        `SELECT COUNT(DISTINCT quote_id)::int AS count FROM (
           SELECT id AS quote_id FROM quotes WHERE service_id = $1
           UNION
           SELECT quote_id FROM quote_items WHERE service_id = $1
         ) refs`,
        [id],
      )
    : await db.queryOne<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM quotes WHERE service_id = $1',
        [id],
      );

  return Number(refRow?.count ?? 0);
}

export async function deleteService(db: DB, id: number): Promise<DeleteServiceResult> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await getService(tx, id);
      if (!existing) return { status: 'not_found' };

      const quoteCount = await countReferencingQuotes(tx, id);
      if (quoteCount > 0) return { status: 'in_use', quoteCount };

      await tx.query('DELETE FROM services WHERE id = $1', [id]);
      return { status: 'deleted', id };
    });
  } catch (error) {
    // Fallback race guard if a concurrent insert triggered ON DELETE RESTRICT (23001) or NO ACTION (23503).
    const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (code === '23503' || code === '23001') {
      const quoteCount = await countReferencingQuotes(db, id).catch(() => 1);
      return { status: 'in_use', quoteCount: Math.max(1, quoteCount) };
    }
    throw error;
  }
}
