import { UTC_NOW_SQL, type DBExecutor } from '../database.js';
import {
  DEFAULT_QUOTE_MARGIN,
  MAX_QUOTE_MARGIN,
  MIN_QUOTE_MARGIN,
  normalizeMarginPercent,
} from '../../pricing/margin.js';

export const QUOTE_MARGIN_KEY = 'quote_margin_percent';

export async function getSetting(db: DBExecutor, key: string): Promise<string | undefined> {
  const row = await db.queryOne<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return row?.value;
}

export async function setSetting(
  db: DBExecutor,
  key: string,
  value: string,
  updatedBy: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = ${UTC_NOW_SQL}`,
    [key, value, updatedBy],
  );
}

/** Returns the live margin. Admins can change it at any time within the allowed range. */
export async function getQuoteMarginPercent(db: DBExecutor): Promise<number> {
  const raw = await getSetting(db, QUOTE_MARGIN_KEY);
  if (raw === undefined) return DEFAULT_QUOTE_MARGIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_QUOTE_MARGIN || value > MAX_QUOTE_MARGIN) {
    return DEFAULT_QUOTE_MARGIN;
  }
  return value;
}

export async function setQuoteMarginPercent(
  db: DBExecutor,
  value: number,
  updatedBy: number | null,
): Promise<number> {
  const normalized = normalizeMarginPercent(value);
  await setSetting(db, QUOTE_MARGIN_KEY, String(normalized), updatedBy);
  return normalized;
}

/** Seeds the starting margin once; later admin edits are never overwritten. */
export async function ensureQuoteMarginSetting(db: DBExecutor, seedPercent: number): Promise<number> {
  if ((await getSetting(db, QUOTE_MARGIN_KEY)) !== undefined) return getQuoteMarginPercent(db);
  return setQuoteMarginPercent(db, seedPercent, null);
}
