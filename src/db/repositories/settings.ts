import type { DB } from '../database.js';
import {
  DEFAULT_QUOTE_MARGIN,
  MAX_QUOTE_MARGIN,
  MIN_QUOTE_MARGIN,
  normalizeMarginPercent,
} from '../../pricing/margin.js';

export const QUOTE_MARGIN_KEY = 'quote_margin_percent';

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string, updatedBy: number | null): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(key, value, updatedBy);
}

/** Returns the live margin. Admins can change it at any time within the allowed range. */
export function getQuoteMarginPercent(db: DB): number {
  const raw = getSetting(db, QUOTE_MARGIN_KEY);
  if (raw === undefined) return DEFAULT_QUOTE_MARGIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_QUOTE_MARGIN || value > MAX_QUOTE_MARGIN) {
    return DEFAULT_QUOTE_MARGIN;
  }
  return value;
}

export function setQuoteMarginPercent(db: DB, value: number, updatedBy: number | null): number {
  const normalized = normalizeMarginPercent(value);
  setSetting(db, QUOTE_MARGIN_KEY, String(normalized), updatedBy);
  return normalized;
}

/** Seeds the starting margin once; later admin edits are never overwritten. */
export function ensureQuoteMarginSetting(db: DB, seedPercent: number): number {
  if (getSetting(db, QUOTE_MARGIN_KEY) !== undefined) return getQuoteMarginPercent(db);
  return setQuoteMarginPercent(db, seedPercent, null);
}
