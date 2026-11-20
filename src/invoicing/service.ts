import type { DB } from '../db/database.js';
import * as customerRepo from '../db/repositories/customers.js';
import * as intakeRepo from '../db/repositories/intake.js';
import * as invoiceRepo from '../db/repositories/invoices.js';
import * as quoteRepo from '../db/repositories/quotes.js';
import type { CustomerInput, CustomerRecord } from '../db/repositories/customers.js';
import type { InvoiceDisplayStatus, InvoiceItemInput } from '../db/repositories/invoices.js';
import type { IntakeRecord } from '../intake/intake.js';
import type { InvoiceNinjaGateway, RemoteInvoice } from './types.js';

export interface ComposeInvoiceInput {
  leadId?: number;
  customerId?: number;
}

export interface CreateInvoiceInput {
  idempotencyKey: string;
  leadId?: number;
  customerId?: number;
  customer: CustomerInput;
  issueDate: string;
  dueDate: string;
  notes: string;
  items: InvoiceItemInput[];
}

export class InvoiceService {
  constructor(readonly db: DB, readonly ninja: InvoiceNinjaGateway) {}

  async listSelectable(leadQuery = '', customerQuery = '') {
    const normalized = leadQuery.trim().toLowerCase();
    const [leads, customers] = await Promise.all([
      intakeRepo.listIntakes(this.db, 100),
      customerRepo.listCustomers(this.db, customerQuery, 100),
    ]);
    return {
      leads: leads.filter((lead) => !normalized || `${lead.company_name} ${lead.external_user_id}`.toLowerCase().includes(normalized)),
      customers,
    };
  }

  async compose(input: ComposeInvoiceInput) {
    const { lead, customer } = await this.resolveSource(input);
    const quote = lead
      ? await quoteRepo.latestApprovedQuoteForIntake(this.db, lead.id)
      : customer
        ? await quoteRepo.latestApprovedQuoteForCustomer(this.db, customer.id)
        : undefined;
    const items = quote ? await quoteRepo.listQuoteItems(this.db, quote.id) : [];
    return {
      lead: lead ?? null,
      customer: customer ? customerPayload(customer) : emptyCustomerPayload(lead),
      quote: quote ?? null,
      items: items.map((item) => ({
        quoteItemId: item.id, description: item.description, quantity: item.quantity,
        unitPricePaise: item.quoted_unit_price_paise,
      })),
      settings: await this.ninja.getSettings(),
    };
  }

  async create(input: CreateInvoiceInput, adminId: number | null) {
    const existing = await invoiceRepo.getInvoiceByKey(this.db, input.idempotencyKey);
    if (existing?.ninja_invoice_id) return this.detail(existing.id, false);
    if (existing) return this.dispatchExisting(existing.id);

    this.requireConfigured();
    if (!input.items.length) throw new InvoiceWorkflowError('Add at least one invoice line item.');
    const { lead, customer: selected } = await this.resolveSource(input);
    if (lead && input.customerId && lead.customer_id && lead.customer_id !== input.customerId) {
      throw new InvoiceWorkflowError('The selected lead belongs to a different customer.');
    }
    const customer = selected
      ? await customerRepo.updateCustomer(this.db, selected.id, input.customer)
      : await customerRepo.createCustomer(this.db, input.customer);
    const quote = lead
      ? await quoteRepo.latestApprovedQuoteForIntake(this.db, lead.id)
      : await quoteRepo.latestApprovedQuoteForCustomer(this.db, customer.id);
    const totalPaise = input.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPricePaise), 0);

    const draft = await this.db.transaction(async (tx) => {
      const record = await invoiceRepo.createInvoiceDraft(tx as DB, {
        idempotencyKey: input.idempotencyKey, customerId: customer.id, intakeId: lead?.id ?? null,
        quoteId: quote?.id ?? null, totalPaise, currency: input.customer.currency?.toUpperCase() || 'INR',
        issueDate: input.issueDate, dueDate: input.dueDate, notes: input.notes, createdBy: adminId, items: input.items,
      });
      if (lead) await customerRepo.linkIntakeCustomer(tx as DB, lead.id, customer.id);
      return record;
    });
    return this.dispatchExisting(draft.id);
  }

  async list(status?: InvoiceDisplayStatus, query = '') {
    const records = await invoiceRepo.listInvoices(this.db, status, query, 100);
    if (this.ninja.configured) {
      await Promise.allSettled(records.filter((row) => row.ninja_invoice_id).map((row) => this.sync(row.id)));
      return invoiceRepo.listInvoices(this.db, status, query, 100);
    }
    return records;
  }

  async detail(id: number, synchronize = true) {
    if (synchronize && this.ninja.configured) await this.sync(id);
    const invoice = await invoiceRepo.getInvoice(this.db, id);
    if (!invoice) throw new InvoiceWorkflowError('Invoice not found.', 404);
    const [items, customer] = await Promise.all([
      invoiceRepo.listInvoiceItems(this.db, id), customerRepo.getCustomer(this.db, invoice.customer_id),
    ]);
    return { invoice, items, customer };
  }

  async send(id: number) {
    const invoice = await this.required(id);
    if (invoice.status !== 'pending') throw new InvoiceWorkflowError('Only pending invoices can be sent.');
    if (!invoice.ninja_invoice_id) throw new InvoiceWorkflowError('The invoice has not been created in Invoice Ninja yet.');
    const customer = await customerRepo.getCustomer(this.db, invoice.customer_id);
    if (!customer?.email) throw new InvoiceWorkflowError('Add a customer email address before sending.');
    await this.ninja.sendInvoice(invoice.ninja_invoice_id);
    await this.sync(id);
    return this.detail(id, false);
  }

  async void(id: number) {
    const invoice = await this.required(id);
    if (invoice.status === 'paid' || invoice.status === 'discarded') {
      throw new InvoiceWorkflowError('This invoice cannot be voided.');
    }
    if (!invoice.ninja_invoice_id) throw new InvoiceWorkflowError('The invoice has not been created in Invoice Ninja yet.');
    await this.ninja.voidInvoice(invoice.ninja_invoice_id);
    await this.sync(id);
    return this.detail(id, false);
  }

  async archive(id: number) {
    const invoice = await this.required(id);
    if (!invoice.ninja_invoice_id) throw new InvoiceWorkflowError('The invoice has not been created in Invoice Ninja yet.');
    await this.ninja.archiveInvoice(invoice.ninja_invoice_id);
    await this.sync(id);
    return this.detail(id, false);
  }

  async download(id: number) {
    const invoice = await this.required(id);
    if (!invoice.ninja_invoice_id) throw new InvoiceWorkflowError('The invoice PDF is not available yet.');
    return this.ninja.downloadInvoice(invoice.ninja_invoice_id, invoice.invoice_number || `invoice-${id}`);
  }

  getSettings() {
    return this.ninja.getSettings();
  }

  updateSettings(settings: Parameters<InvoiceNinjaGateway['updateSettings']>[0]) {
    this.requireConfigured();
    return this.ninja.updateSettings(settings);
  }

  private async dispatchExisting(id: number) {
    const invoice = await this.required(id);
    try {
      let customer = (await customerRepo.getCustomer(this.db, invoice.customer_id))!;
      if (customer.ninja_client_id) {
        await this.ninja.updateClient(customer);
      } else {
        const client = await this.ninja.createClient(customer);
        customer = await customerRepo.setCustomerNinjaId(this.db, customer.id, client.id);
      }
      const items = await invoiceRepo.listInvoiceItems(this.db, id);
      const remote = await this.ninja.createInvoice({
        clientId: customer.ninja_client_id!, reference: invoice.idempotency_key, currency: invoice.currency,
        issueDate: invoice.issue_date, dueDate: invoice.due_date, notes: invoice.notes,
        items: items.map((item) => ({ description: item.description, quantity: item.quantity, unitPricePaise: item.unit_price_paise })),
      });
      await invoiceRepo.syncInvoice(this.db, id, remoteSync(remote));
      return this.detail(id, false);
    } catch (error) {
      await invoiceRepo.recordInvoiceSyncError(this.db, id, safeErrorMessage(error));
      throw error;
    }
  }

  private async sync(id: number) {
    const invoice = await this.required(id);
    if (!invoice.ninja_invoice_id) return;
    try {
      await invoiceRepo.syncInvoice(this.db, id, remoteSync(await this.ninja.getInvoice(invoice.ninja_invoice_id)));
    } catch (error) {
      await invoiceRepo.recordInvoiceSyncError(this.db, id, safeErrorMessage(error));
    }
  }

  private async required(id: number) {
    const invoice = await invoiceRepo.getInvoice(this.db, id);
    if (!invoice) throw new InvoiceWorkflowError('Invoice not found.', 404);
    return invoice;
  }

  private async resolveSource(input: ComposeInvoiceInput): Promise<{ lead?: IntakeRecord; customer?: CustomerRecord }> {
    const lead = input.leadId ? await intakeRepo.getIntakeById(this.db, input.leadId) : undefined;
    if (input.leadId && !lead) throw new InvoiceWorkflowError('Lead not found.', 404);
    const customerId = lead?.customer_id ?? input.customerId;
    const customer = customerId ? await customerRepo.getCustomer(this.db, customerId) : undefined;
    if (customerId && !customer) throw new InvoiceWorkflowError('Customer not found.', 404);
    if (!lead && !customer) throw new InvoiceWorkflowError('Choose a lead or customer.');
    return { lead, customer };
  }

  private requireConfigured() {
    if (!this.ninja.configured) {
      throw new InvoiceWorkflowError('Invoice Ninja is not configured. Set its base URL and API token.', 503);
    }
  }
}

export class InvoiceWorkflowError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

function remoteSync(remote: RemoteInvoice) {
  return {
    ninjaInvoiceId: remote.id, invoiceNumber: remote.number,
    status: displayStatus(remote.status), remoteStatus: remote.status,
    totalPaise: remote.totalPaise, balancePaise: remote.balancePaise,
    sentAt: remote.sentAt, paidAt: remote.paidAt, voidedAt: remote.voidedAt, archivedAt: remote.archivedAt,
  };
}

export function displayStatus(remoteStatus: string): InvoiceDisplayStatus {
  const status = remoteStatus.toLowerCase();
  if (/deleted|archiv|void|cancel/.test(status)) return 'discarded';
  if (/^4$|paid(?!.*partial)|fully_paid/.test(status) && !/partial|unpaid/.test(status)) return 'paid';
  if (/^5$|^6$|reversed/.test(status)) return 'discarded';
  if (/^1$|draft|pending/.test(status)) return 'pending';
  return 'sent';
}

function emptyCustomerPayload(lead?: IntakeRecord) {
  return {
    id: null, name: lead?.company_name ?? '', contactName: '', email: '',
    phone: lead?.channel === 'whatsapp' ? lead.external_user_id : '', address1: '', address2: '',
    city: '', state: '', postalCode: '', countryCode: 'IN', vatNumber: '', currency: 'INR',
  };
}

function customerPayload(customer: CustomerRecord) {
  return {
    id: customer.id, name: customer.name, contactName: customer.contact_name, email: customer.email,
    phone: customer.phone, address1: customer.address1, address2: customer.address2, city: customer.city,
    state: customer.state, postalCode: customer.postal_code, countryCode: customer.country_code,
    vatNumber: customer.vat_number, currency: customer.currency,
  };
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Invoice Ninja synchronization failed.';
  return redactSecrets(message);
}

const SECRET_PATTERN =
  /((?:x-api-token|api[_-]?token|api[_-]?key|authorization|password|secret|token)\s*[:=]\s*)(?:bearer\s+)?(?:"[^"]*"|'[^']*'|\S+)/gi;

/** Masks credential-looking fragments before an upstream message is stored or returned. */
export function redactSecrets(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(SECRET_PATTERN, '$1[redacted]')
    .slice(0, 500);
}
