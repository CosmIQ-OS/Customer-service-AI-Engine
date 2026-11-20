import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { before, after, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import * as intakeRepo from '../db/repositories/intake.js';
import * as invoiceRepo from '../db/repositories/invoices.js';
import * as quoteRepo from '../db/repositories/quotes.js';
import { MockLLMProvider } from '../llm/mock.js';
import { SupportEngine } from '../engine/support-engine.js';
import { InvoiceService, displayStatus } from '../invoicing/service.js';
import { InvoiceNinjaError } from '../invoicing/ninja-gateway.js';
import type { InvoiceNinjaGateway, InvoiceSettings, RemoteInvoice, RemoteInvoiceInput, NinjaPdf } from '../invoicing/types.js';
import type { CustomerRecord } from '../db/repositories/customers.js';
import { createApp } from './app.js';

class FakeNinja implements InvoiceNinjaGateway {
  readonly configured = true;
  createCount = 0;
  remote?: RemoteInvoice;
  requests: RemoteInvoiceInput[] = [];
  pdfRequests = 0;
  settings: InvoiceSettings = {
    configured: true, companyName: 'CosmIQ', address: 'Test City', taxNumber: '', logoUrl: '',
    currency: 'INR', defaultDueDays: 14, paymentInstructions: 'Pay by bank transfer',
    accountName: 'CosmIQ', bankName: 'Test Bank', accountNumber: '123', routingNumber: '',
    swiftCode: '', upiId: '', terms: '',
  };
  async createClient(customer: CustomerRecord) { return { id: `client-${customer.id}` }; }
  async updateClient(_customer: CustomerRecord) {}
  async createInvoice(input: RemoteInvoiceInput) {
    this.createCount += 1;
    this.requests.push(input);
    this.remote = {
      id: 'hashed-invoice', number: 'INV-0001', status: '1', currency: input.currency,
      totalPaise: input.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPricePaise), 0),
      balancePaise: input.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPricePaise), 0),
      sentAt: null, paidAt: null, voidedAt: null, archivedAt: null,
    };
    return this.remote;
  }
  async getInvoice(_id: string) { return this.remote!; }
  async sendInvoice(_id: string) { this.remote = { ...this.remote!, status: '2', sentAt: '2026-11-20' }; }
  async voidInvoice(_id: string) { this.remote = { ...this.remote!, status: '5', voidedAt: '2026-11-20' }; }
  async archiveInvoice(_id: string) { this.remote = { ...this.remote!, status: 'archived', archivedAt: '2026-11-20' }; }
  async downloadInvoice(_id: string, number: string): Promise<NinjaPdf> {
    this.pdfRequests += 1;
    return { bytes: new TextEncoder().encode('%PDF-test').buffer, contentType: 'application/pdf', filename: number };
  }
  async getSettings() { return this.settings; }
  async updateSettings(settings: InvoiceSettings) { this.settings = settings; return settings; }
}

describe('invoice workflow', () => {
  let db: DB;
  let ninja: FakeNinja;
  let service: InvoiceService;
  let leadId: number;
  let quoteId: number;
  let server: Server;
  let base: string;
  let cookie = '';

  before(async () => {
    db = await openDatabase(':memory:');
    const engine = new SupportEngine(db, {
      sessionTtlMinutes: 120, llm: new MockLLMProvider(), model: 'mock', maxSteps: 6,
      maxHistory: 12, temperature: 0, tenantId: 'test',
    });
    const catalog = await engine.createService({ name: 'Automation', description: '', category: 'automation', status: 'available', availability_note: '' });
    await db.query("INSERT INTO sessions (id, channel, external_user_id) VALUES ('lead-session', 'whatsapp', '123456')");
    const lead = await intakeRepo.upsertIntake(db, {
      sessionId: 'lead-session', channel: 'whatsapp', externalUserId: '123456', tenantId: 'test',
      patch: { company_name: 'Acme Labs', company_size: '20', current_tools: 'Slack', service_name: 'Automation', service_id: catalog.id },
    });
    leadId = lead.id;
    const quote = await quoteRepo.createQuote(db, {
      sessionId: lead.session_id, channel: lead.channel, externalUserId: lead.external_user_id,
      intakeId: lead.id, serviceId: catalog.id, serviceName: 'Automation', marginPercent: 30, notes: '',
      items: [{ priceItemId: null, itemCode: 'AUTO-1', description: 'Process automation', unit: 'project', quantity: 2,
        adminUnitPricePaise: 100_000, quotedUnitPricePaise: 130_000, lineTotalPaise: 260_000 }],
    });
    quoteId = quote.id;
    await quoteRepo.submitQuoteForApproval(db, quoteId, { expiresAt: '2026-11-21', nextAlertAt: '2026-11-21' });
    await quoteRepo.decideQuote(db, quoteId, { status: 'approved', adminId: null, decidedAt: '2026-11-20' });
    ninja = new FakeNinja();
    service = new InvoiceService(db, ninja);

    const auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('invoice-admin', 'a-long-test-password');
    server = createApp(engine, { auth, sessionHours: 1, cookieSecure: false, invoices: service }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'invoice-admin', password: 'a-long-test-password' }) });
    cookie = /cosmiq_admin=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
  });

  after(async () => {
    server.closeAllConnections();
    server.close();
    await db.close();
  });

  it('maps Invoice Ninja lifecycle states to dashboard filters', () => {
    assert.equal(displayStatus('1'), 'pending');
    assert.equal(displayStatus('2'), 'sent');
    assert.equal(displayStatus('3'), 'sent');
    assert.equal(displayStatus('4'), 'paid');
    assert.equal(displayStatus('5'), 'discarded');
    assert.equal(displayStatus('archived'), 'discarded');
  });

  it('prefills lead details and the latest approved proposal', async () => {
    const composed = await service.compose({ leadId });
    assert.equal(composed.customer.name, 'Acme Labs');
    assert.equal(composed.customer.phone, '123456');
    assert.equal(composed.quote?.id, quoteId);
    assert.deepEqual(composed.items, [{ quoteItemId: composed.items[0].quoteItemId, description: 'Process automation', quantity: 2, unitPricePaise: 130_000 }]);
  });

  it('creates one linked invoice for repeated idempotent submissions', async () => {
    const composed = await service.compose({ leadId });
    const input = {
      idempotencyKey: 'invoice-request-0001', leadId, customer: { ...composed.customer, email: 'billing@example.test' },
      issueDate: '2026-11-20', dueDate: '2026-12-04', notes: 'Thanks', items: composed.items,
    };
    const created = await service.create(input, null);
    const repeated = await service.create(input, null);
    assert.equal(created.invoice.id, repeated.invoice.id);
    assert.equal(ninja.createCount, 1);
    assert.equal(created.invoice.quote_id, quoteId);
    assert.equal(created.invoice.total_paise, 260_000);
    assert.equal((await invoiceRepo.listInvoices(db)).length, 1);
    assert.equal((await intakeRepo.getIntakeById(db, leadId))?.customer_id, created.invoice.customer_id);
  });

  it('sends, voids, archives, and downloads a PDF', async () => {
    const [invoice] = await invoiceRepo.listInvoices(db);
    const sent = await service.send(invoice.id);
    assert.equal(sent.invoice.status, 'sent');
    assert.equal(sent.invoice.sent_at, '2026-11-20');
    const voided = await service.void(invoice.id);
    assert.equal(voided.invoice.status, 'discarded');
    const archived = await service.archive(invoice.id);
    assert.equal(archived.invoice.status, 'discarded');
    const pdf = await service.download(invoice.id);
    assert.equal(pdf.filename, 'INV-0001');
  });

  it('protects invoice APIs and streams an authenticated PDF', async () => {
    const [invoice] = await invoiceRepo.listInvoices(db);
    const unauthenticated = await fetch(`${base}/api/invoices`);
    assert.equal(unauthenticated.status, 401);
    const list = await fetch(`${base}/api/invoices?status=discarded`, { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { invoices: unknown[] }).invoices.length, 1);
    const pdf = await fetch(`${base}/api/invoices/${invoice.id}/pdf?download=1`, { headers: { cookie } });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-disposition') ?? '', /attachment/);
    assert.equal(pdf.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await pdf.text(), '%PDF-test');
  });

  it('redacts credentials from upstream sync errors', async () => {
    const [invoice] = await invoiceRepo.listInvoices(db);
    const original = ninja.getInvoice.bind(ninja);
    ninja.getInvoice = async () => { throw new InvoiceNinjaError('Upstream: X-API-TOKEN: super-secret-token'); };
    try {
      const response = await fetch(`${base}/api/invoices/${invoice.id}`, { headers: { cookie } });
      const text = await response.text();
      assert.doesNotMatch(text, /super-secret-token/);
      assert.match(text, /\[redacted\]/);
    } finally {
      ninja.getInvoice = original;
    }
  });

  it('never echoes internal error details to the browser', async () => {
    const [invoice] = await invoiceRepo.listInvoices(db);
    const original = service.download.bind(service);
    service.download = async () => { throw new Error('postgresql://user:secret@db.internal/app'); };
    try {
      const response = await fetch(`${base}/api/invoices/${invoice.id}/pdf`, { headers: { cookie } });
      const text = await response.text();
      assert.equal(response.status, 502);
      assert.doesNotMatch(text, /postgresql|secret|db\.internal/);
      assert.match(text, /Invoice operation failed/);
    } finally {
      service.download = original;
    }
  });
});
