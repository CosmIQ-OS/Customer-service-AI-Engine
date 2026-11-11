import type { QuoteItemRecord, QuoteRecord } from '../db/repositories/quotes.js';

/** Price-free update sent while a quote is still waiting for an admin decision. */
export function approvalHoldingMessage(quote: QuoteRecord): string {
  return `Thanks for your patience — quote ${quote.quote_number} is still with our team for review. We will share it with you as soon as it is ready.`;
}

/** Sent once an admin rejects a quote. Never contains prices. */
export function rejectedQuoteMessage(quote: QuoteRecord): string {
  return `Thanks for your patience. Our team has reviewed your requirements for ${quote.service_name} and a specialist will follow up with you shortly to discuss the next steps.`;
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Itemized customer message for an approved quote; prices come from the stored quote only. */
export function approvedQuoteMessage(quote: QuoteRecord, items: QuoteItemRecord[]): string {
  const lines = items.map(
    (item) =>
      `• ${item.item_code} — ${item.description} — ${formatQuantity(item.quantity)} ${item.unit} × ${formatInr(
        item.quoted_unit_price_paise,
      )} = ${formatInr(item.line_total_paise)}`,
  );
  return [
    `Thanks for your patience! Quote ${quote.quote_number} for ${quote.service_name} is approved.`,
    '',
    ...lines,
    '',
    `Total: ${formatInr(quote.total_paise)} (${quote.currency})`,
    '',
    'Reply here if you have any questions about this quote.',
  ].join('\n');
}
