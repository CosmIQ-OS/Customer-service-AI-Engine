import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import { applyMargin, normalizeMarginPercent } from '../../pricing/margin.js';

export type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'superseded';

export interface QuoteRecord {
  id: number;
  quote_number: string;
  session_id: string | null;
  channel: string;
  external_user_id: string;
  intake_id: number | null;
  service_id: number | null;
  service_name: string;
  client_name?: string;
  client_email?: string;
  company_size?: string;
  terms_and_conditions?: string;
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

function mapQuote(row: QuoteRecord): QuoteRecord {
  return {
    ...row,
    id: Number(row.id),
    intake_id: row.intake_id === null ? null : Number(row.intake_id),
    service_id: row.service_id === null ? null : Number(row.service_id),
    client_name: row.client_name ?? '',
    client_email: row.client_email ?? '',
    company_size: row.company_size ?? '',
    terms_and_conditions: row.terms_and_conditions ?? '',
    margin_percent: Number(row.margin_percent),
    subtotal_paise: Number(row.subtotal_paise),
    total_paise: Number(row.total_paise),
    margin_paise: Number(row.margin_paise),
    approved_by: row.approved_by === null ? null : Number(row.approved_by),
    alert_count: Number(row.alert_count),
    decided_by: row.decided_by === null ? null : Number(row.decided_by),
  };
}

function mapItem(row: QuoteItemRecord): QuoteItemRecord {
  return {
    ...row,
    id: Number(row.id),
    quote_id: Number(row.quote_id),
    price_item_id: row.price_item_id === null ? null : Number(row.price_item_id),
    quantity: Number(row.quantity),
    admin_unit_price_paise: Number(row.admin_unit_price_paise),
    quoted_unit_price_paise: Number(row.quoted_unit_price_paise),
    line_total_paise: Number(row.line_total_paise),
    sort_order: Number(row.sort_order),
  };
}

export async function getQuote(db: DBExecutor, id: number): Promise<QuoteRecord | undefined> {
  const row = await db.queryOne<QuoteRecord>('SELECT * FROM quotes WHERE id = $1', [id]);
  return row ? mapQuote(row) : undefined;
}

export async function listQuotes(db: DBExecutor, limit = 50): Promise<QuoteRecord[]> {
  const { rows } = await db.query<QuoteRecord>(
    'SELECT * FROM quotes ORDER BY created_at DESC, id DESC LIMIT $1',
    [limit],
  );
  return rows.map(mapQuote);
}

export async function listQuoteItems(db: DBExecutor, quoteId: number): Promise<QuoteItemRecord[]> {
  const { rows } = await db.query<QuoteItemRecord>(
    'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order ASC',
    [quoteId],
  );
  return rows.map(mapItem);
}

export async function latestQuoteForSession(db: DBExecutor, sessionId: string): Promise<QuoteRecord | undefined> {
  const row = await db.queryOne<QuoteRecord>(
    'SELECT * FROM quotes WHERE session_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [sessionId],
  );
  return row ? mapQuote(row) : undefined;
}

export async function createQuote(
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
): Promise<QuoteRecord> {
  if (input.items.length === 0) throw new Error('A quote needs at least one item.');
  return db.transaction(async (tx) => {
    const nextRow = await tx.queryOne<{ next: number }>('SELECT (COALESCE(MAX(id), 0) + 1)::int AS next FROM quotes');
    const next = Number(nextRow?.next ?? 1);
    const quoteNumber = `Q-${new Date().getUTCFullYear()}-${String(next).padStart(4, '0')}`;
    const subtotalPaise = input.items.reduce(
      (total, item) => total + Math.round(item.adminUnitPricePaise * item.quantity),
      0,
    );
    const totalPaise = input.items.reduce((total, item) => total + item.lineTotalPaise, 0);

    const quote = await tx.queryOne<QuoteRecord>(
      `INSERT INTO quotes
        (quote_number, session_id, channel, external_user_id, intake_id, service_id, service_name,
         status, margin_percent, subtotal_paise, total_paise, margin_paise, notes, created_by)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7,
         'draft', $8, $9, $10, $11, $12, 'pricing_agent')
       RETURNING *`,
      [
        quoteNumber,
        input.sessionId,
        input.channel,
        input.externalUserId,
        input.intakeId,
        input.serviceId,
        input.serviceName,
        input.marginPercent,
        subtotalPaise,
        totalPaise,
        totalPaise - subtotalPaise,
        input.notes,
      ],
    );
    const quoteId = Number(quote!.id);

    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      await tx.query(
        `INSERT INTO quote_items
          (quote_id, price_item_id, item_code, description, unit, quantity,
           admin_unit_price_paise, quoted_unit_price_paise, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          quoteId,
          item.priceItemId,
          item.itemCode,
          item.description,
          item.unit,
          item.quantity,
          item.adminUnitPricePaise,
          item.quotedUnitPricePaise,
          item.lineTotalPaise,
          index + 1,
        ],
      );
    }

    return mapQuote(quote!);
  });
}

export interface ProposalItemInput {
  serviceId?: number | null;
  priceItemId?: number | null;
  itemCode?: string;
  description: string;
  unit?: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise?: number;
}

export interface ProposalInput {
  sessionId?: string | null;
  channel?: string;
  externalUserId?: string;
  intakeId?: number | null;
  clientName: string;
  clientEmail?: string;
  companySize?: string;
  serviceId?: number | null;
  serviceName?: string;
  marginPercent?: number;
  termsAndConditions?: string;
  notes?: string;
  createdBy?: string;
  items: ProposalItemInput[];
}

export async function createProposal(db: DB, input: ProposalInput): Promise<QuoteRecord> {
  if (input.items.length === 0) throw new Error('A proposal needs at least one line item.');
  return db.transaction(async (tx) => {
    const nextRow = await tx.queryOne<{ next: number }>('SELECT (COALESCE(MAX(id), 0) + 1)::int AS next FROM quotes');
    const next = Number(nextRow?.next ?? 1);
    const quoteNumber = `P-${new Date().getUTCFullYear()}-${String(next).padStart(4, '0')}`;

    const subtotalPaise = input.items.reduce(
      (total, item) => total + Math.round(item.unitPricePaise * item.quantity),
      0,
    );
    const marginPercent = input.marginPercent ?? 0;
    const totalPaise = input.items.reduce(
      (total, item) => total + (item.lineTotalPaise ?? Math.round(item.unitPricePaise * item.quantity)),
      0,
    );

    const quote = await tx.queryOne<QuoteRecord>(
      `INSERT INTO quotes
        (quote_number, session_id, channel, external_user_id, intake_id, service_id, service_name,
         client_name, client_email, company_size, terms_and_conditions,
         status, margin_percent, subtotal_paise, total_paise, margin_paise, notes, created_by)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11,
         'draft', $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        quoteNumber,
        input.sessionId ?? null,
        input.channel ?? 'direct',
        input.externalUserId ?? input.clientEmail ?? input.clientName,
        input.intakeId ?? null,
        input.serviceId ?? null,
        input.serviceName ?? (input.items[0]?.description || 'Custom Proposal'),
        input.clientName,
        input.clientEmail ?? '',
        input.companySize ?? '',
        input.termsAndConditions ?? '',
        marginPercent,
        subtotalPaise,
        totalPaise,
        totalPaise - subtotalPaise,
        input.notes ?? '',
        input.createdBy ?? 'admin',
      ],
    );
    const quoteId = Number(quote!.id);

    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      const lineTotal = item.lineTotalPaise ?? Math.round(item.unitPricePaise * item.quantity);
      await tx.query(
        `INSERT INTO quote_items
          (quote_id, service_id, price_item_id, item_code, description, unit, quantity,
           admin_unit_price_paise, quoted_unit_price_paise, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          quoteId,
          item.serviceId ?? null,
          item.priceItemId ?? null,
          item.itemCode ?? `ITEM-${String(index + 1).padStart(2, '0')}`,
          item.description,
          item.unit ?? 'unit',
          item.quantity,
          item.unitPricePaise,
          item.unitPricePaise,
          lineTotal,
          index + 1,
        ],
      );
    }

    return mapQuote(quote!);
  });
}

export async function listPendingApprovals(db: DBExecutor, limit = 50): Promise<QuoteRecord[]> {
  const { rows } = await db.query<QuoteRecord>(
    `SELECT * FROM quotes WHERE status = 'pending_approval'
     ORDER BY COALESCE(expires_at, created_at) ASC, id ASC LIMIT $1`,
    [limit],
  );
  return rows.map(mapQuote);
}

export async function countPendingApprovals(db: DBExecutor): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM quotes WHERE status = 'pending_approval'",
  );
  return Number(row?.count ?? 0);
}

export async function listPendingForSession(
  db: DBExecutor,
  sessionId: string,
  exceptId: number,
): Promise<QuoteRecord[]> {
  const { rows } = await db.query<QuoteRecord>(
    "SELECT * FROM quotes WHERE session_id = $1 AND status = 'pending_approval' AND id <> $2",
    [sessionId, exceptId],
  );
  return rows.map(mapQuote);
}

/** Moves a draft (or refreshes a pending quote) into the admin approval queue. */
export async function submitQuoteForApproval(
  db: DBExecutor,
  id: number,
  input: { expiresAt: string; nextAlertAt: string },
): Promise<QuoteRecord> {
  const row = await db.queryOne<QuoteRecord>(
    `UPDATE quotes
     SET status = 'pending_approval', expires_at = $1, next_alert_at = $2,
         alert_count = 0, updated_at = ${UTC_NOW_SQL}
     WHERE id = $3 AND status IN ('draft', 'pending_approval')
     RETURNING *`,
    [input.expiresAt, input.nextAlertAt, id],
  );
  if (!row) throw new Error('Quote could not be submitted for approval.');
  return mapQuote(row);
}

export async function supersedePendingQuotes(db: DBExecutor, ids: number[]): Promise<number> {
  let changes = 0;
  for (const id of ids) {
    const res = await db.query(
      `UPDATE quotes SET status = 'superseded', next_alert_at = NULL, updated_at = ${UTC_NOW_SQL}
       WHERE id = $1 AND status = 'pending_approval'`,
      [id],
    );
    changes += res.rowCount;
  }
  return changes;
}

/** Pending quotes whose 6-hour reminder is due. */
export async function dueForRealert(db: DBExecutor, nowSql: string, limit = 50): Promise<QuoteRecord[]> {
  const { rows } = await db.query<QuoteRecord>(
    `SELECT * FROM quotes WHERE status = 'pending_approval'
       AND next_alert_at IS NOT NULL AND next_alert_at <= $1
     ORDER BY next_alert_at ASC, id ASC LIMIT $2`,
    [nowSql, limit],
  );
  return rows.map(mapQuote);
}

export async function recordRealert(db: DBExecutor, id: number, nextAlertAt: string): Promise<QuoteRecord> {
  const row = await db.queryOne<QuoteRecord>(
    `UPDATE quotes
     SET alert_count = alert_count + 1, next_alert_at = $1, updated_at = ${UTC_NOW_SQL}
     WHERE id = $2 AND status = 'pending_approval'
     RETURNING *`,
    [nextAlertAt, id],
  );
  if (!row) throw new Error('Quote is no longer awaiting approval.');
  return mapQuote(row);
}

/** Admin edit: quantities and margin only; item codes, descriptions, units and admin prices stay locked. */
export async function updateQuotePricing(
  db: DB,
  id: number,
  input: { marginPercent: number; quantities?: Record<number, number> },
): Promise<QuoteRecord> {
  const quote = await getQuote(db, id);
  if (!quote) throw new Error('Quote not found.');
  if (quote.status !== 'draft' && quote.status !== 'pending_approval') {
    throw new Error('Only draft or pending quotes can be edited.');
  }
  const marginPercent = normalizeMarginPercent(input.marginPercent);
  const items = await listQuoteItems(db, id);
  if (items.length === 0) throw new Error('The quote has no line items.');
  const quantities = input.quantities ?? {};
  const known = new Set(items.map((item) => item.id));
  for (const key of Object.keys(quantities)) {
    if (!known.has(Number(key))) throw new Error('Quote item not found on this quote.');
  }

  return db.transaction(async (tx) => {
    let subtotalPaise = 0;
    let totalPaise = 0;
    for (const item of items) {
      const quantity = quantities[item.id] ?? item.quantity;
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) {
        throw new Error(`Quantity for ${item.item_code} must be greater than zero.`);
      }
      const quotedUnit = applyMargin(item.admin_unit_price_paise, marginPercent);
      const lineTotal = Math.round(quotedUnit * quantity);
      await tx.query(
        `UPDATE quote_items SET quantity = $1, quoted_unit_price_paise = $2, line_total_paise = $3
         WHERE id = $4 AND quote_id = $5`,
        [quantity, quotedUnit, lineTotal, item.id, id],
      );
      subtotalPaise += Math.round(item.admin_unit_price_paise * quantity);
      totalPaise += lineTotal;
    }
    const updated = await tx.queryOne<QuoteRecord>(
      `UPDATE quotes
       SET margin_percent = $1, subtotal_paise = $2, total_paise = $3,
           margin_paise = $4, updated_at = ${UTC_NOW_SQL}
       WHERE id = $5
       RETURNING *`,
      [marginPercent, subtotalPaise, totalPaise, totalPaise - subtotalPaise, id],
    );
    return mapQuote(updated!);
  });
}

export async function decideQuote(
  db: DBExecutor,
  id: number,
  input: { status: 'approved' | 'rejected'; adminId: number | null; note?: string; decidedAt: string },
): Promise<QuoteRecord> {
  const quote = await getQuote(db, id);
  if (!quote) throw new Error('Quote not found.');
  if (quote.status !== 'pending_approval') throw new Error('Only quotes awaiting approval can be decided.');
  const approved = input.status === 'approved';
  const row = await db.queryOne<QuoteRecord>(
    `UPDATE quotes
     SET status = $1, decision_note = $2, decided_by = $3,
         approved_by = $4, approved_at = $5, next_alert_at = NULL, updated_at = ${UTC_NOW_SQL}
     WHERE id = $6
     RETURNING *`,
    [
      input.status,
      input.note ?? '',
      input.adminId,
      approved ? input.adminId : null,
      approved ? input.decidedAt : null,
      id,
    ],
  );
  return mapQuote(row!);
}

export async function markQuoteDelivered(db: DBExecutor, id: number, deliveredAt: string): Promise<void> {
  await db.query(`UPDATE quotes SET delivered_at = $1, updated_at = ${UTC_NOW_SQL} WHERE id = $2`, [deliveredAt, id]);
}
