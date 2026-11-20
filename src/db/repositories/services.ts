import { UTC_NOW_SQL, type DBExecutor } from '../database.js';
import type { ServiceRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ServiceRecord, 'metadata'> & { metadata: string };

function map(row: Row): ServiceRecord {
  return { ...row, id: Number(row.id), metadata: parseJson(row.metadata, {}) };
}

export async function listServices(db: DBExecutor): Promise<ServiceRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM services ORDER BY updated_at DESC, id DESC');
  return rows.map(map);
}

export async function getService(db: DBExecutor, id: number): Promise<ServiceRecord | undefined> {
  const row = await db.queryOne<Row>('SELECT * FROM services WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function createService(
  db: DBExecutor,
  input: Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note'> & {
    metadata?: Record<string, unknown>;
  },
): Promise<ServiceRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO services (name, description, category, status, availability_note, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.description,
      input.category,
      input.status,
      input.availability_note,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return map(row!);
}

export async function updateService(
  db: DBExecutor,
  id: number,
  input: Partial<Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note'>> & {
    metadata?: Record<string, unknown>;
  },
): Promise<ServiceRecord | undefined> {
  const existing = await getService(db, id);
  if (!existing) return undefined;
  const row = await db.queryOne<Row>(
    `UPDATE services
     SET name = $1, description = $2, category = $3, status = $4,
         availability_note = $5, metadata = $6, updated_at = ${UTC_NOW_SQL}
     WHERE id = $7
     RETURNING *`,
    [
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.category ?? existing.category,
      input.status ?? existing.status,
      input.availability_note ?? existing.availability_note,
      JSON.stringify(input.metadata ?? existing.metadata),
      id,
    ],
  );
  return row ? map(row) : undefined;
}
