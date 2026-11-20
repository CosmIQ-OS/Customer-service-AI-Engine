import { UTC_NOW_SQL, type DBExecutor } from '../database.js';

export type InvoiceDisplayStatus = 'pending' | 'sent' | 'paid' | 'discarded';

export interface InvoiceRecord {
  id: number;
  idempotency_key: string;
  ninja_invoice_id: string | null;
  customer_id: number;
  intake_id: number | null;
  quote_id: number | null;
  invoice_number: string;
  status: InvoiceDisplayStatus;
  remote_status: string;
  currency: string;
  total_paise: number;
  balance_paise: number;
  issue_date: string;
  due_date: string;
  notes: string;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  archived_at: string | null;
  last_synced_at: string | null;
  sync_error: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItemRecord {
  id: number;
  invoice_id: number;
  quote_item_id: number | null;
  description: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
  sort_order: number;
}

export interface InvoiceItemInput {
  quoteItemId?: number | null;
  description: string;
  quantity: number;
  unitPricePaise: number;
}

export interface InvoiceListRecord extends InvoiceRecord {
  customer_name: string;
  lead_company_name: string | null;
  quote_number: string | null;
}

function map(row: InvoiceRecord): InvoiceRecord {
  return {
    ...row,
    id: Number(row.id), customer_id: Number(row.customer_id),
    intake_id: row.intake_id === null ? null : Number(row.intake_id),
    quote_id: row.quote_id === null ? null : Number(row.quote_id),
    total_paise: Number(row.total_paise), balance_paise: Number(row.balance_paise),
    created_by: row.created_by === null ? null : Number(row.created_by),
  };
}

function mapItem(row: InvoiceItemRecord): InvoiceItemRecord {
  return {
    ...row, id: Number(row.id), invoice_id: Number(row.invoice_id),
    quote_item_id: row.quote_item_id === null ? null : Number(row.quote_item_id),
    quantity: Number(row.quantity), unit_price_paise: Number(row.unit_price_paise),
    line_total_paise: Number(row.line_total_paise), sort_order: Number(row.sort_order),
  };
}

export async function createInvoiceDraft(
  db: DBExecutor,
  input: {
    idempotencyKey: string;
    customerId: number;
    intakeId: number | null;
    quoteId: number | null;
    totalPaise: number;
    currency: string;
    issueDate: string;
    dueDate: string;
    notes: string;
    createdBy: number | null;
    items: InvoiceItemInput[];
  },
): Promise<InvoiceRecord> {
  const row = await db.queryOne<InvoiceRecord>(
      `INSERT INTO invoices
        (idempotency_key, customer_id, intake_id, quote_id, currency, total_paise, balance_paise,
         issue_date, due_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10) RETURNING *`,
      [input.idempotencyKey, input.customerId, input.intakeId, input.quoteId, input.currency,
        input.totalPaise, input.issueDate, input.dueDate, input.notes, input.createdBy],
    );
    const invoice = map(row!);
    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      await db.query(
        `INSERT INTO invoice_items
          (invoice_id, quote_item_id, description, quantity, unit_price_paise, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoice.id, item.quoteItemId ?? null, item.description, item.quantity, item.unitPricePaise,
          Math.round(item.quantity * item.unitPricePaise), index + 1],
      );
    }
  return invoice;
}

export async function getInvoice(db: DBExecutor, id: number): Promise<InvoiceListRecord | undefined> {
  const row = await db.queryOne<InvoiceListRecord>(`${invoiceSelect()} WHERE i.id = $1`, [id]);
  return row ? map(row) as InvoiceListRecord : undefined;
}

export async function getInvoiceByKey(db: DBExecutor, key: string): Promise<InvoiceRecord | undefined> {
  const row = await db.queryOne<InvoiceRecord>('SELECT * FROM invoices WHERE idempotency_key = $1', [key]);
  return row ? map(row) : undefined;
}

export async function listInvoices(db: DBExecutor, status?: InvoiceDisplayStatus, query = '', limit = 100): Promise<InvoiceListRecord[]> {
  const like = `%${query.trim()}%`;
  const { rows } = await db.query<InvoiceListRecord>(
    `${invoiceSelect()}
     WHERE ($1::text IS NULL OR i.status = $1)
       AND ($2 = '%%' OR c.name ILIKE $2 OR i.invoice_number ILIKE $2 OR COALESCE(q.quote_number, '') ILIKE $2)
     ORDER BY i.updated_at DESC, i.id DESC LIMIT $3`,
    [status ?? null, like, limit],
  );
  return rows.map((row) => map(row) as InvoiceListRecord);
}

export async function listInvoiceItems(db: DBExecutor, invoiceId: number): Promise<InvoiceItemRecord[]> {
  const { rows } = await db.query<InvoiceItemRecord>(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC', [invoiceId],
  );
  return rows.map(mapItem);
}

export async function syncInvoice(
  db: DBExecutor,
  id: number,
  input: {
    ninjaInvoiceId: string;
    invoiceNumber: string;
    status: InvoiceDisplayStatus;
    remoteStatus: string;
    totalPaise: number;
    balancePaise: number;
    sentAt?: string | null;
    paidAt?: string | null;
    voidedAt?: string | null;
    archivedAt?: string | null;
  },
): Promise<InvoiceRecord> {
  const row = await db.queryOne<InvoiceRecord>(
    `UPDATE invoices SET ninja_invoice_id = $2, invoice_number = $3, status = $4, remote_status = $5,
       total_paise = $6, balance_paise = $7, sent_at = $8, paid_at = $9, voided_at = $10,
       archived_at = $11, last_synced_at = ${UTC_NOW_SQL}, sync_error = '', updated_at = ${UTC_NOW_SQL}
     WHERE id = $1 RETURNING *`,
    [id, input.ninjaInvoiceId, input.invoiceNumber, input.status, input.remoteStatus, input.totalPaise,
      input.balancePaise, input.sentAt ?? null, input.paidAt ?? null, input.voidedAt ?? null, input.archivedAt ?? null],
  );
  return map(row!);
}

export async function recordInvoiceSyncError(db: DBExecutor, id: number, message: string): Promise<void> {
  await db.query(
    `UPDATE invoices SET sync_error = $2, last_synced_at = ${UTC_NOW_SQL}, updated_at = ${UTC_NOW_SQL} WHERE id = $1`,
    [id, message.slice(0, 1000)],
  );
}

function invoiceSelect(): string {
  return `SELECT i.*, c.name AS customer_name, si.company_name AS lead_company_name, q.quote_number
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    LEFT JOIN service_intakes si ON si.id = i.intake_id LEFT JOIN quotes q ON q.id = i.quote_id`;
}
