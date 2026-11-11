export const PRICE_HOLDING_MESSAGE =
  "I can't share pricing in this chat. A specialist team will prepare an exact quote and it will be reviewed before it is shared with you.";

const CURRENCY = /(?:₹|\bINR\b|\bRs\.?\s*\d)/i;
const RUPEE_AMOUNT = /\b\d[\d,]{2,}(?:\.\d{1,2})?\s*(?:rupees|rs)\b/i;
const PRICE_WORD_AMOUNT =
  /\b(?:price|prices|cost|costs|charge|charges|fee|fees|amount|rate|retainer)\b[^.!?\n]{0,30}(?:\d[\d,]{2,}|\d+\.\d{1,2})/i;
const QUOTE_AMOUNT = /\bquote\b[^.!?\n]{0,20}(?:\d[\d,]{2,}|\d+\.\d{1,2})/i;

/** True when a reply appears to contain a concrete price rather than a price-free holding line. */
export function containsPrice(text: string): boolean {
  return CURRENCY.test(text) || RUPEE_AMOUNT.test(text) || PRICE_WORD_AMOUNT.test(text) || QUOTE_AMOUNT.test(text);
}

/** Replaces a price-bearing reply with a safe holding message. */
export function guardPrice(reply: string): { reply: string; blocked: boolean } {
  if (!containsPrice(reply)) return { reply, blocked: false };
  return { reply: PRICE_HOLDING_MESSAGE, blocked: true };
}
