import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import * as pricingRepo from '../db/repositories/pricing.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

const PASSWORD = 'a-long-test-password';
const VALID_CSV = [
  'item_code,description,unit,unit_price',
  'AUTO-01,Process mapping,hour,"1,250.50"',
  'AUTO-02,Bot setup,project,15000',
].join('\n');

describe('pricing API', () => {
  let db: DB;
  let server: Server;
  let base: string;
  let cookie: string;
  let serviceId: number;

  before(async () => {
    db = await openDatabase(':memory:');
    const auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('owner', PASSWORD);
    const engine = new SupportEngine(db, {
      sessionTtlMinutes: 120,
      llm: new MockLLMProvider(),
      model: 'mock',
      maxSteps: 6,
      maxHistory: 12,
      temperature: 0,
      tenantId: 'test',
    });
    serviceId = (await engine.createService({
      name: 'Company Internal Operations Automation',
      description: '',
      category: 'automation',
      status: 'available',
      availability_note: '',
    })).id;
    const app = createApp(engine, { auth, sessionHours: 1, cookieSecure: false, webhookSecret: 'webhook-secret-0123456789' });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: PASSWORD }),
    });
    cookie = /cosmiq_admin=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
    assert.ok(cookie, 'login should set the session cookie');
  });

  after(async () => {
    server.closeAllConnections();
    server.close();
    await db.close();
  });

  function upload(id: number, body: unknown, withCookie = true): Promise<Response> {
    return fetch(`${base}/api/services/${id}/price-table`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  it('requires an admin session to upload', async () => {
    const res = await upload(serviceId, { filename: 'prices.csv', contentBase64: Buffer.from(VALID_CSV).toString('base64') }, false);
    assert.equal(res.status, 401);
  });

  it('publishes a valid CSV and returns its items with paise prices', async () => {
    const res = await upload(serviceId, {
      filename: 'prices.csv',
      contentBase64: Buffer.from(VALID_CSV).toString('base64'),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { table: { version: number; uploaded_by: number }; items: Array<{ unit_price_paise: number }> };
    assert.equal(body.table.version, 1);
    assert.equal(body.table.uploaded_by, 1);
    assert.deepEqual(body.items.map((item) => item.unit_price_paise), [125050, 1500000]);

    const current = await fetch(`${base}/api/services/${serviceId}/price-table`, { headers: { cookie } });
    assert.equal(((await current.json()) as { items: unknown[] }).items.length, 2);
  });

  it('rejects invalid tables with row errors and saves nothing new', async () => {
    const bad = 'item_code,description,unit,unit_price\nX1,Thing,each,abc';
    const res = await upload(serviceId, { filename: 'bad.csv', contentBase64: Buffer.from(bad).toString('base64') });
    assert.equal(res.status, 422);
    const body = await res.json() as { errors: Array<{ row: number }> };
    assert.equal(body.errors[0].row, 2);
    assert.equal((await pricingRepo.listPriceTables(db, serviceId)).length, 1);
  });

  it('returns 404 for an unknown service', async () => {
    const res = await upload(999, { filename: 'prices.csv', contentBase64: Buffer.from(VALID_CSV).toString('base64') });
    assert.equal(res.status, 404);
  });

  it('rejects files larger than the 700 KB limit', async () => {
    const big = Buffer.alloc(720 * 1024, 'a');
    const res = await upload(serviceId, { filename: 'huge.csv', contentBase64: big.toString('base64') });
    assert.equal(res.status, 413);
  });

  it('lists version history for an admin', async () => {
    const res = await fetch(`${base}/api/services/${serviceId}/price-tables`, { headers: { cookie } });
    const body = await res.json() as { tables: Array<{ version: number }> };
    assert.deepEqual(body.tables.map((table) => table.version), [1]);
  });
});
