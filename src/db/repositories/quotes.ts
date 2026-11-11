import type { DB } from '../database.js';

export type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'superseded';

export interface QuoteRecord {
  id: number;
  quote_number: string;
  session_id: string | null;
  channel: string;
  external_user_id: string;
  intake_id: number | null;
  service_id: number;
  service_name: string;
  status: QuoteStatus;
  currency: string;
  margin_percent: number;
  subtotal_paise: number;
  total_paise: number;
  margin_paise: number;
  notes: string;
  created_by: string;
  approved_by: number | null;
  approved_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItemRecord {
  id: number;
  quote_id: number;
  price_item_id: number | null;
  item_code: string;
  description: string;
  unit: string;
  quantity: number;
  admin_unit_price_paise: number;
  quoted_unit_price_paise: number;
  line_total_paise: number;
  sort_order: number;
}

export interface QuoteItemInput {
  priceItemId: number | null;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  adminUnitPricePaise: number;
  quotedUnitPricePaise: number;
  lineTotalPaise: number;
}

export function getQuote(db: DB, id: number): QuoteRecord | undefined {
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as QuoteRecord | undefined;
}

export function listQuotes(db: DB, limit = 50): QuoteRecord[] {
  return db.prepare(
    'SELECT * FROM quotes ORDER BY created_at DESC, id DESC LIMIT ?',
  ).all(limit) as QuoteRecord[];
}

export function listQuoteItems(db: DB, quoteId: number): QuoteItemRecord[] {
  return db.prepare(
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC',
  ).all(quoteId) as QuoteItemRecord[];
}

export function latestQuoteForSession(db: DB, sessionId: string): QuoteRecord | undefined {
  return db.prepare(
    'SELECT * FROM quotes WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
  ).get(sessionId) as QuoteRecord | undefined;
}

export function createQuote(
  db: DB,
  input: {
    sessionId: string;
    channel: string;
    externalUserId: string;
    intakeId: number | null;
    serviceId: number;
    serviceName: string;
    marginPercent: number;
    notes: string;
    items: QuoteItemInput[];
  },
): QuoteRecord {
  if (input.items.length === 0) throw new Error('A quote needs at least one item.');
  return db.transaction(() => {
    const { next } = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM quotes').get() as { next: number };
    const quoteNumber = `Q-${new Date().getUTCFullYear()}-${String(next).padStart(4, '0')}`;
    const subtotalPaise = input.items.reduce(
      (total, item) => total + Math.round(item.adminUnitPricePaise * item.quantity),
      0,
    );
    const totalPaise = input.items.reduce((total, item) => total + item.lineTotalPaise, 0);

    const info = db.prepare(
      `INSERT INTO quotes
        (quote_number, session_id, channel, external_user_id, intake_id, service_id, service_name,
         status, margin_percent, subtotal_paise, total_paise, margin_paise, notes, created_by)
       VALUES
        (@quoteNumber, @sessionId, @channel, @externalUserId, @intakeId, @serviceId, @serviceName,
         'draft', @marginPercent, @subtotalPaise, @totalPaise, @marginPaise, @notes, 'pricing_agent')`,
    ).run({
      quoteNumber,
      sessionId: input.sessionId,
      channel: input.channel,
      externalUserId: input.externalUserId,
      intakeId: input.intakeId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      marginPercent: input.marginPercent,
      subtotalPaise,
      totalPaise,
      marginPaise: totalPaise - subtotalPaise,
      notes: input.notes,
    });
    const quoteId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO quote_items
        (quote_id, price_item_id, item_code, description, unit, quantity,
         admin_unit_price_paise, quoted_unit_price_paise, line_total_paise, sort_order)
       VALUES
        (@quoteId, @priceItemId, @itemCode, @description, @unit, @quantity,
         @adminUnitPricePaise, @quotedUnitPricePaise, @lineTotalPaise, @sortOrder)`,
    );
    input.items.forEach((item, index) => {
      insertItem.run({ quoteId, ...item, sortOrder: index + 1 });
    });

    return getQuote(db, quoteId)!;
  })();
}

export function updateQuoteStatus(
  db: DB,
  id: number,
  status: QuoteStatus,
  patch: { approvedBy?: number | null; approvedAt?: string | null; expiresAt?: string | null } = {},
): QuoteRecord | undefined {
  db.prepare(
    `UPDATE quotes SET status = @status,
       approved_by = COALESCE(@approvedBy, approved_by),
       approved_at = COALESCE(@approvedAt, approved_at),
       expires_at = COALESCE(@expiresAt, expires_at),
       updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    status,
    approvedBy: patch.approvedBy ?? null,
    approvedAt: patch.approvedAt ?? null,
    expiresAt: patch.expiresAt ?? null,
  });
  return getQuote(db, id);
}
