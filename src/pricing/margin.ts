export const MIN_QUOTE_MARGIN = 30;
export const MAX_QUOTE_MARGIN = 35;
export const DEFAULT_QUOTE_MARGIN = MIN_QUOTE_MARGIN;

/** Validates an admin-entered margin and normalizes it to at most two decimals. */
export function normalizeMarginPercent(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Margin must be a number.');
  if (value < MIN_QUOTE_MARGIN || value > MAX_QUOTE_MARGIN) {
    throw new Error(`Margin must be between ${MIN_QUOTE_MARGIN} and ${MAX_QUOTE_MARGIN} percent.`);
  }
  return Math.round(value * 100) / 100;
}

/** Applies the markup to an admin price in paise and returns a rounded quoted unit price. */
export function applyMargin(adminUnitPaise: number, marginPercent: number): number {
  return Math.round(adminUnitPaise * (1 + marginPercent / 100));
}
