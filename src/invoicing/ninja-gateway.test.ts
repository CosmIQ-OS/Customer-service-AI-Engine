import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InvoiceNinjaClient } from './ninja-gateway.js';
import type { CustomerRecord } from '../db/repositories/customers.js';

const customer: CustomerRecord = {
  id: 7, ninja_client_id: null, name: 'Acme', contact_name: 'Ada Lovelace', email: 'ada@example.test',
  phone: '', address1: '', address2: '', city: '', state: '', postal_code: '', country_code: 'IN', vat_number: '',
  currency: 'INR', created_at: '', updated_at: '',
};

describe('Invoice Ninja v5 gateway', () => {
  let server: Server;
  let baseUrl: string;
  const requests: Array<{ method: string; url: string; token: string | undefined; body: any }> = [];

  before(async () => {
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      requests.push({ method: req.method!, url: req.url!, token: req.headers['x-api-token'] as string, body: text ? JSON.parse(text) : undefined });
      if (req.url === '/api/v1/companies/current') return json(res, { data: { id: 'company', name: 'CosmIQ', settings: { payment_terms: 21, currency_code: 'INR' } } });
      if (req.url === '/api/v1/clients' && req.method === 'POST') return json(res, { data: { id: 'hashed-client' } });
      if (req.url?.endsWith('/download')) {
        res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-fixture');
      }
      if (req.url === '/api/v1/invoices' && req.method === 'POST') return json(res, { data: invoice({ id: 'hashed-invoice', number: 'INV-01', status_id: '1', amount: 130, balance: 130 }) });
      if (req.url === '/api/v1/invoices/hashed-invoice' && req.method === 'GET') return json(res, { data: invoice({ id: 'hashed-invoice', number: 'INV-01', status_id: '4', amount: 130, balance: 0, updated_at: 'paid-date' }) });
      return json(res, { data: {} });
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => { server.closeAllConnections(); server.close(); });

  it('uses hashed IDs, X-API-TOKEN, proposal amounts, lifecycle actions and binary PDFs', async () => {
    const client = new InvoiceNinjaClient({ baseUrl, apiToken: 'fixture-token-not-a-secret', timeoutMs: 1000 });
    assert.equal((await client.createClient(customer)).id, 'hashed-client');
    customer.ninja_client_id = 'hashed-client';
    await client.updateClient(customer);
    const created = await client.createInvoice({
      clientId: 'hashed-client', reference: 'local-key', currency: 'INR', issueDate: '2026-11-20', dueDate: '2026-12-11', notes: 'Note',
      items: [{ description: 'Proposal service', quantity: 2, unitPricePaise: 6500 }],
    });
    assert.equal(created.id, 'hashed-invoice'); assert.equal(created.totalPaise, 13000);
    assert.equal((await client.getInvoice(created.id)).paidAt, 'paid-date');
    await client.sendInvoice(created.id); await client.voidInvoice(created.id); await client.archiveInvoice(created.id);
    const pdf = await client.downloadInvoice(created.id, 'INV-01');
    assert.equal(Buffer.from(pdf.bytes).toString(), '%PDF-fixture');
    assert.ok(requests.every((request) => request.token === 'fixture-token-not-a-secret'));
    const createClient = requests.find((request) => request.url === '/api/v1/clients' && request.method === 'POST');
    assert.ok(createClient);
    assert.equal(createClient.body.contacts[0].email, 'ada@example.test');
    const createInvoice = requests.find((request) => request.url === '/api/v1/invoices' && request.method === 'POST');
    assert.ok(createInvoice);
    assert.equal(createInvoice.body.custom_value1, 'local-key');
    assert.deepEqual(createInvoice.body.line_items[0], { product_key: 'SERVICE', notes: 'Proposal service', type_id: '2', quantity: 2, cost: 65 });
    assert.ok(requests.some((request) => request.method === 'PUT' && request.body?.send_email === true));
    assert.ok(requests.some((request) => request.method === 'PUT' && request.body?.cancel === true));
    assert.ok(requests.some((request) => request.url === '/api/v1/invoices/hashed-invoice/archive'));
  });
});

function invoice(data: Record<string, unknown>) { return data; }
function json(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
}
