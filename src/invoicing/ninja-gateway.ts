import type { CustomerRecord } from '../db/repositories/customers.js';
import type { InvoiceNinjaGateway, InvoiceSettings, NinjaPdf, RemoteInvoice, RemoteInvoiceInput } from './types.js';

export interface InvoiceNinjaOptions {
  baseUrl: string;
  apiToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class InvoiceNinjaClient implements InvoiceNinjaGateway {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: InvoiceNinjaOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  get configured(): boolean { return Boolean(this.options.apiToken); }

  async createClient(customer: CustomerRecord): Promise<{ id: string }> {
    const data = await this.request<any>('POST', '/clients', clientPayload(customer));
    return { id: String(data.data.id) };
  }

  async updateClient(customer: CustomerRecord): Promise<void> {
    await this.request('PUT', `/clients/${encodeURIComponent(customer.ninja_client_id!)}`, clientPayload(customer));
  }

  async createInvoice(input: RemoteInvoiceInput): Promise<RemoteInvoice> {
    const settings = await this.getSettings();
    const data = await this.request<any>('POST', '/invoices', {
      client_id: input.clientId,
      currency_code: input.currency,
      date: input.issueDate,
      due_date: input.dueDate,
      public_notes: [input.notes, paymentBlock(settings)].filter(Boolean).join('\n\n'),
      custom_value1: input.reference,
      line_items: input.items.map((item) => ({
        product_key: 'SERVICE', notes: item.description, type_id: '2', quantity: item.quantity,
        cost: item.unitPricePaise / 100,
      })),
    });
    return remoteInvoice(data.data);
  }

  async getInvoice(id: string): Promise<RemoteInvoice> {
    const data = await this.request<any>('GET', `/invoices/${encodeURIComponent(id)}`);
    return remoteInvoice(data.data);
  }

  async sendInvoice(id: string): Promise<void> {
    await this.request('PUT', `/invoices/${encodeURIComponent(id)}`, { send_email: true });
  }

  async voidInvoice(id: string): Promise<void> {
    await this.request('PUT', `/invoices/${encodeURIComponent(id)}`, { cancel: true });
  }

  async archiveInvoice(id: string): Promise<void> {
    await this.request('GET', `/invoices/${encodeURIComponent(id)}/archive`);
  }

  async downloadInvoice(id: string, number: string): Promise<NinjaPdf> {
    const response = await this.requestResponse('GET', `/invoices/${encodeURIComponent(id)}/download`);
    return {
      bytes: await response.arrayBuffer(), contentType: response.headers.get('content-type') ?? '',
      filename: number,
    };
  }

  async getSettings(): Promise<InvoiceSettings> {
    if (!this.configured) return defaultSettings();
    const response = await this.request<any>('POST', '/companies/current', {});
    const company = response.data ?? {};
    const settings = company.settings ?? {};
    return {
      configured: true,
      companyName: String(company.name ?? ''), address: [company.address1, company.address2, company.city,
        company.state, company.postal_code, company.country_code].filter(Boolean).join(', '),
      taxNumber: String(company.vat_number ?? ''), logoUrl: String(company.logo ?? ''),
      currency: String(settings.currency_code ?? 'INR'),
      defaultDueDays: numeric(settings.payment_terms, 14),
      paymentInstructions: String(settings.invoice_terms ?? ''),
      accountName: String(settings.custom_value1 ?? ''), bankName: String(settings.custom_value2 ?? ''),
      accountNumber: String(settings.custom_value3 ?? ''),
      routingNumber: String(settings.custom_value4 ?? ''), swiftCode: String(company.custom_value1 ?? ''),
      upiId: String(company.custom_value2 ?? ''), terms: String(settings.invoice_footer ?? ''),
    };
  }

  async updateSettings(input: InvoiceSettings): Promise<InvoiceSettings> {
    const current = await this.request<any>('POST', '/companies/current', {});
    const settings = current.data?.settings ?? {};
    const lines = input.address.split(',').map((line) => line.trim()).filter(Boolean);
    await this.request('POST', '/companies/current', {
      name: input.companyName, vat_number: input.taxNumber,
      address1: lines[0] ?? '', address2: lines.slice(1).join(', '),
      custom_value1: input.swiftCode, custom_value2: input.upiId,
      settings: {
        ...settings, currency_code: input.currency, payment_terms: input.defaultDueDays,
        invoice_terms: input.paymentInstructions, invoice_footer: input.terms,
        custom_value1: input.accountName, custom_value2: input.bankName,
        custom_value3: input.accountNumber, custom_value4: input.routingNumber,
      },
    });
    return this.getSettings();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.requestResponse(method, path, body);
    const text = await response.text();
    if (!text) return {} as T;
    try { return JSON.parse(text) as T; } catch { throw new InvoiceNinjaError('Invoice Ninja returned an invalid response.'); }
  }

  private async requestResponse(method: string, path: string, body?: unknown): Promise<Response> {
    if (!this.options.apiToken) throw new InvoiceNinjaError('Invoice Ninja is not configured.');
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          'X-API-TOKEN': this.options.apiToken, Accept: 'application/json, application/pdf',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof InvoiceNinjaError) throw error;
      throw new InvoiceNinjaError('Could not reach Invoice Ninja.');
    }
    if (!response.ok) {
      let message = `Invoice Ninja request failed (${response.status}).`;
      try {
        const body = await response.clone().json() as { message?: string; errors?: Record<string, string[]> };
        const detail = body.message ?? Object.values(body.errors ?? {}).flat()[0];
        if (detail) message = `Invoice Ninja: ${String(detail).slice(0, 400)}`;
      } catch { /* The status code remains a safe, useful error. */ }
      throw new InvoiceNinjaError(message);
    }
    return response;
  }
}

export class InvoiceNinjaError extends Error {}

function clientPayload(customer: CustomerRecord) {
  const [firstName, ...rest] = (customer.contact_name || 'Billing Contact').split(/\s+/);
  return {
    name: customer.name, currency_code: customer.currency,
    address1: customer.address1, address2: customer.address2, city: customer.city,
    state: customer.state, postal_code: customer.postal_code, country_code: customer.country_code,
    vat_number: customer.vat_number, phone: customer.phone, custom_value1: String(customer.id),
    contacts: [{ first_name: firstName, last_name: rest.join(' '), email: customer.email,
      phone: customer.phone, is_primary: true, send_email: Boolean(customer.email) }],
  };
}

function remoteInvoice(data: any): RemoteInvoice {
  const status = data.is_deleted ? 'deleted' : data.archived_at ? 'archived' : String(data.status_id ?? '1');
  return {
    id: String(data.id), number: String(data.number ?? ''), status,
    totalPaise: Math.round(Number(data.amount ?? 0) * 100),
    balancePaise: Math.max(0, Math.round(Number(data.balance ?? 0) * 100)),
    currency: String(data.currency_code ?? 'INR'),
    sentAt: data.last_sent_date ?? null, paidAt: status === '4' ? data.updated_at ?? null : null,
    voidedAt: status === '5' ? data.updated_at ?? null : null, archivedAt: data.archived_at ?? null,
  };
}

function paymentBlock(settings: InvoiceSettings): string {
  const accounts = [
    settings.accountName && `Account name: ${settings.accountName}`,
    settings.bankName && `Bank: ${settings.bankName}`,
    settings.accountNumber && `Account number: ${settings.accountNumber}`,
    settings.routingNumber && `IFSC / routing: ${settings.routingNumber}`,
    settings.swiftCode && `SWIFT: ${settings.swiftCode}`, settings.upiId && `UPI: ${settings.upiId}`,
  ].filter(Boolean).join('\n');
  return [settings.paymentInstructions, accounts, settings.terms].filter(Boolean).join('\n\n');
}

function defaultSettings(): InvoiceSettings {
  return {
    configured: false, companyName: '', address: '', taxNumber: '', logoUrl: '', currency: 'INR',
    defaultDueDays: 14, paymentInstructions: '', accountName: '', bankName: '', accountNumber: '',
    routingNumber: '', swiftCode: '', upiId: '', terms: '',
  };
}

function numeric(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
