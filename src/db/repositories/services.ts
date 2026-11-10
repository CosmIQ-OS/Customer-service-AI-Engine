import type { DB } from '../database.js';
import type { ServiceRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<ServiceRecord, 'metadata'> & { metadata: string };

function map(row: Row): ServiceRecord {
  return { ...row, metadata: parseJson(row.metadata, {}) };
}

export function listServices(db: DB): ServiceRecord[] {
  return (db.prepare('SELECT * FROM services ORDER BY updated_at DESC, id DESC').all() as Row[]).map(map);
}

export function getService(db: DB, id: number): ServiceRecord | undefined {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Row | undefined;
  return row ? map(row) : undefined;
}

export function createService(
  db: DB,
  input: Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note'> & { metadata?: Record<string, unknown> },
): ServiceRecord {
  const info = db.prepare(
    `INSERT INTO services (name, description, category, status, availability_note, metadata)
     VALUES (@name, @description, @category, @status, @availability_note, @metadata)`,
  ).run({ ...input, metadata: JSON.stringify(input.metadata ?? {}) });
  return getService(db, Number(info.lastInsertRowid))!;
}

export function updateService(
  db: DB,
  id: number,
  input: Partial<Pick<ServiceRecord, 'name' | 'description' | 'category' | 'status' | 'availability_note'>> & { metadata?: Record<string, unknown> },
): ServiceRecord | undefined {
  const existing = getService(db, id);
  if (!existing) return undefined;
  const next = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    category: input.category ?? existing.category,
    status: input.status ?? existing.status,
    availability_note: input.availability_note ?? existing.availability_note,
    metadata: JSON.stringify(input.metadata ?? existing.metadata),
  };
  db.prepare(
    `UPDATE services SET name=@name, description=@description, category=@category, status=@status,
     availability_note=@availability_note, metadata=@metadata, updated_at=datetime('now') WHERE id=@id`,
  ).run({ id, ...next });
  return getService(db, id);
}
