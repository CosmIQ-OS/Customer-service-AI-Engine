import type { DB } from '../database.js';
import { applyMargin, normalizeMarginPercent } from '../../pricing/margin.js';

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
  next_alert_at: string | null;
  alert_count: number;
  decision_note: string;
  decided_by: number | null;
  delivered_at: string | null;
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

export function listPendingApprovals(db: DB, limit = 50): QuoteRecord[] {
  return db.prepare(
    `SELECT * FROM quotes WHERE status = 'pending_approval'
     ORDER BY COALESCE(expires_at, created_at) ASC, id ASC LIMIT ?`,
  ).all(limit) as QuoteRecord[];
}

export function countPendingApprovals(db: DB): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM quotes WHERE status = 'pending_approval'").get() as {
    count: number;
  };
  return row.count;
}

export function listPendingForSession(db: DB, sessionId: string, exceptId: number): QuoteRecord[] {
  return db.prepare(
    "SELECT * FROM quotes WHERE session_id = ? AND status = 'pending_approval' AND id <> ?",
  ).all(sessionId, exceptId) as QuoteRecord[];
}

/** Moves a draft (or refreshes a pending quote) into the admin approval queue. */
export function submitQuoteForApproval(
  db: DB,
  id: number,
  input: { expiresAt: string; nextAlertAt: string },
): QuoteRecord {
  const info = db.prepare(
    `UPDATE quotes SET status = 'pending_approval', expires_at = @expiresAt, next_alert_at = @nextAlertAt,
       alert_count = 0, updated_at = datetime('now')
     WHERE id = @id AND status IN ('draft', 'pending_approval')`,
  ).run({ id, expiresAt: input.expiresAt, nextAlertAt: input.nextAlertAt });
  if (info.changes === 0) throw new Error('Quote could not be submitted for approval.');
  return getQuote(db, id)!;
}

export function supersedePendingQuotes(db: DB, ids: number[]): number {
  const stmt = db.prepare(
    "UPDATE quotes SET status = 'superseded', next_alert_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'pending_approval'",
  );
  let changes = 0;
  for (const id of ids) changes += stmt.run(id).changes;
  return changes;
}

/** Pending quotes whose 6-hour reminder is due. */
export function dueForRealert(db: DB, nowSql: string, limit = 50): QuoteRecord[] {
  return db.prepare(
    `SELECT * FROM quotes WHERE status = 'pending_approval'
       AND next_alert_at IS NOT NULL AND next_alert_at <= ?
     ORDER BY next_alert_at ASC, id ASC LIMIT ?`,
  ).all(nowSql, limit) as QuoteRecord[];
}

export function recordRealert(db: DB, id: number, nextAlertAt: string): QuoteRecord {
  const info = db.prepare(
    `UPDATE quotes SET alert_count = alert_count + 1, next_alert_at = @nextAlertAt, updated_at = datetime('now')
     WHERE id = @id AND status = 'pending_approval'`,
  ).run({ id, nextAlertAt });
  if (info.changes === 0) throw new Error('Quote is no longer awaiting approval.');
  return getQuote(db, id)!;
}

/** Admin edit: quantities and margin only; item codes, descriptions, units and admin prices stay locked. */
export function updateQuotePricing(
  db: DB,
  id: number,
  input: { marginPercent: number; quantities?: Record<number, number> },
): QuoteRecord {
  const quote = getQuote(db, id);
  if (!quote) throw new Error('Quote not found.');
  if (quote.status !== 'draft' && quote.status !== 'pending_approval') {
    throw new Error('Only draft or pending quotes can be edited.');
  }
  const marginPercent = normalizeMarginPercent(input.marginPercent);
  const items = listQuoteItems(db, id);
  if (items.length === 0) throw new Error('The quote has no line items.');
  const quantities = input.quantities ?? {};
  const known = new Set(items.map((item) => item.id));
  for (const key of Object.keys(quantities)) {
    if (!known.has(Number(key))) throw new Error('Quote item not found on this quote.');
  }

  return db.transaction(() => {
    let subtotalPaise = 0;
    let totalPaise = 0;
    const updateItem = db.prepare(
      `UPDATE quote_items SET quantity = @quantity, quoted_unit_price_paise = @quotedUnit,
         line_total_paise = @lineTotal WHERE id = @id AND quote_id = @quoteId`,
    );
    for (const item of items) {
      const quantity = quantities[item.id] ?? item.quantity;
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) {
        throw new Error(`Quantity for ${item.item_code} must be greater than zero.`);
      }
      const quotedUnit = applyMargin(item.admin_unit_price_paise, marginPercent);
      const lineTotal = Math.round(quotedUnit * quantity);
      updateItem.run({ id: item.id, quoteId: id, quantity, quotedUnit, lineTotal });
      subtotalPaise += Math.round(item.admin_unit_price_paise * quantity);
      totalPaise += lineTotal;
    }
    db.prepare(
      `UPDATE quotes SET margin_percent = @marginPercent, subtotal_paise = @subtotalPaise,
         total_paise = @totalPaise, margin_paise = @marginPaise, updated_at = datetime('now')
       WHERE id = @id`,
    ).run({
      id,
      marginPercent,
      subtotalPaise,
      totalPaise,
      marginPaise: totalPaise - subtotalPaise,
    });
    return getQuote(db, id)!;
  })();
}

export function decideQuote(
  db: DB,
  id: number,
  input: { status: 'approved' | 'rejected'; adminId: number | null; note?: string; decidedAt: string },
): QuoteRecord {
  const quote = getQuote(db, id);
  if (!quote) throw new Error('Quote not found.');
  if (quote.status !== 'pending_approval') throw new Error('Only quotes awaiting approval can be decided.');
  const approved = input.status === 'approved';
  db.prepare(
    `UPDATE quotes SET status = @status, decision_note = @note, decided_by = @adminId,
       approved_by = @approvedBy, approved_at = @approvedAt, next_alert_at = NULL, updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    status: input.status,
    note: input.note ?? '',
    adminId: input.adminId,
    approvedBy: approved ? input.adminId : null,
    approvedAt: approved ? input.decidedAt : null,
  });
  return getQuote(db, id)!;
}

export function markQuoteDelivered(db: DB, id: number, deliveredAt: string): void {
  db.prepare('UPDATE quotes SET delivered_at = ?, updated_at = datetime(\'now\') WHERE id = ?').run(deliveredAt, id);
}

