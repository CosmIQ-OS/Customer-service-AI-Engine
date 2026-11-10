import { parse as parseCsv } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';

export const PRICE_TABLE_COLUMNS = ['item_code', 'description', 'unit', 'unit_price'] as const;
export const MAX_PRICE_TABLE_BYTES = 700 * 1024;
export const MAX_PRICE_ITEMS = 2000;
const MAX_ERRORS = 50;
const MAX_UNIT_PAISE = 100_000_000_000;

export interface PriceItemDraft {
  item_code: string;
  description: string;
  unit: string;
  unit_price_paise: number;
}

/** Row 0 means the problem applies to the whole file; row 1 is the header. */
export interface PriceTableError {
  row: number;
  message: string;
}

export type PriceTableParseResult =
  | { ok: true; items: PriceItemDraft[] }
  | { ok: false; errors: PriceTableError[] };

export async function parsePriceTable(filename: string, data: Buffer): Promise<PriceTableParseResult> {
  const dot = filename.lastIndexOf('.');
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  let rows: unknown[][];
  try {
    if (extension === '.xlsx') {
      rows = (await readSheet(data)) as unknown[][];
    } else if (extension === '.csv') {
      rows = parseCsv(data.toString('utf8').replace(/^\uFEFF/, ''), {
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as string[][];
    } else {
      return fail('Unsupported file type. Upload an .xlsx or .csv file.');
    }
  } catch {
    return fail('Could not read the file. Check that it is a valid .xlsx or .csv file.');
  }

  if (rows.length === 0) return fail('The file is empty.');

  const headerIndex = new Map<string, number>();
  rows[0].forEach((cell, index) => {
    headerIndex.set(normalizeHeader(cell), index);
  });
  const missing = PRICE_TABLE_COLUMNS.filter((column) => !headerIndex.has(column));
  if (missing.length > 0) {
    return { ok: false, errors: [{ row: 1, message: `Missing required column(s): ${missing.join(', ')}` }] };
  }

  const col = {
    code: headerIndex.get('item_code')!,
    description: headerIndex.get('description')!,
    unit: headerIndex.get('unit')!,
    price: headerIndex.get('unit_price')!,
  };

  const errors: PriceTableError[] = [];
  const items: PriceItemDraft[] = [];
  const seenCodes = new Map<string, number>();

  for (let i = 1; i < rows.length && errors.length < MAX_ERRORS; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    if (row.every((cell) => text(cell) === '')) continue;

    const rowErrors: string[] = [];
    const code = text(row[col.code]);
    const description = text(row[col.description]);
    const unit = text(row[col.unit]);
    const paise = toPaise(row[col.price]);

    if (!code) rowErrors.push('item_code is required');
    else if (code.length > 64) rowErrors.push('item_code must be 64 characters or fewer');
    if (!description) rowErrors.push('description is required');
    else if (description.length > 200) rowErrors.push('description must be 200 characters or fewer');
    if (!unit) rowErrors.push('unit is required');
    else if (unit.length > 32) rowErrors.push('unit must be 32 characters or fewer');
    if (paise === null) rowErrors.push('unit_price must be a number from 0 with at most 2 decimals');

    const key = code.toLowerCase();
    if (code && seenCodes.has(key)) rowErrors.push(`item_code "${code}" is also on row ${seenCodes.get(key)}`);
    else if (code) seenCodes.set(key, rowNumber);

    if (items.length >= MAX_PRICE_ITEMS) rowErrors.push(`a price table can have at most ${MAX_PRICE_ITEMS} rows`);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join('; ') });
      continue;
    }
    items.push({ item_code: code, description, unit, unit_price_paise: paise! });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (items.length === 0) return fail('No price rows found below the header.');
  return { ok: true, items };
}

function fail(message: string): PriceTableParseResult {
  return { ok: false, errors: [{ row: 0, message }] };
}

function normalizeHeader(cell: unknown): string {
  return text(cell).toLowerCase().replace(/[\s-]+/g, '_');
}

function text(cell: unknown): string {
  return cell == null ? '' : String(cell).trim();
}

/** Converts a price cell to integer paise. Returns null when the value is not a valid amount. */
function toPaise(cell: unknown): number | null {
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell < 0) return null;
    const paise = Math.round(cell * 100);
    if (Math.abs(cell * 100 - paise) > 1e-6 || paise > MAX_UNIT_PAISE) return null;
    return paise;
  }
  if (typeof cell !== 'string') return null;
  const cleaned = cell.trim().replace(/^₹\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return paise <= MAX_UNIT_PAISE ? paise : null;
}
