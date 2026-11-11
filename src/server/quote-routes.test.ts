import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import { publishPriceTable } from '../db/repositories/pricing.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

const PASSWORD = 'a-long-test-password';

describe('quote API', () => {
  let db: DB;
  let server: Server;
  let base: string;
  let cookie: string;

  before(async () => {
    db = openDatabase(':memory:');
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
    const workflow = engine.createService({
      name: 'Workflow Automation',
      description: '',
      category: 'workflow',
      status: 'available',
      availability_note: '',
    });
    publishPriceTable(db, {
      serviceId: workflow.id,
      sourceFilename: 'workflow.csv',
      uploadedBy: null,
      items: [
        { item_code: 'WF-1', description: 'Discovery workshop', unit: 'day', unit_price_paise: 100_000 },
        { item_code: 'WF-2', description: 'Automation build', unit: 'project', unit_price_paise: 500_000 },
      ],
    });

    const app = createApp(engine, {
      auth,
      sessionHours: 1,
      cookieSecure: false,
      webhookSecret: 'webhook-secret-0123456789',
    });
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

  after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });

  it('requires an admin session for settings and quotes', async () => {
    assert.equal((await fetch(`${base}/api/settings`)).status, 401);
    assert.equal((await fetch(`${base}/api/quotes`)).status, 401);
  });

  it('returns the editable margin range', async () => {
    const res = await fetch(`${base}/api/settings`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      quoteMarginPercent: 30,
      minMarginPercent: 30,
      maxMarginPercent: 35,
    });
  });

  it('saves an admin margin edit and rejects values outside the range', async () => {
    const saved = await fetch(`${base}/api/settings/quote-margin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ marginPercent: 32.5 }),
    });
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { quoteMarginPercent: number }).quoteMarginPercent, 32.5);

    const rejected = await fetch(`${base}/api/settings/quote-margin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ marginPercent: 36 }),
    });
    assert.equal(rejected.status, 400);

    const current = await fetch(`${base}/api/settings`, { headers: { cookie } });
    assert.equal(((await current.json()) as { quoteMarginPercent: number }).quoteMarginPercent, 32.5);
  });

  it('builds a quote when an intake completes and exposes it to admins', async () => {
    const sim = await fetch(`${base}/api/chat/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        channel: 'telegram',
        externalUserId: 'quote-api-user',
        text: 'Company: API Quote Co; Size: 25 people; Tools: Slack; Service: Workflow Automation',
      }),
    });
    assert.equal(sim.status, 200);
    const simulated = await sim.json() as { intent: string; sessionId: string; data: { quoteId?: number } };
    assert.equal(simulated.intent, 'intake');
    assert.equal(typeof simulated.data.quoteId, 'number');

    const list = await fetch(`${base}/api/quotes`, { headers: { cookie } });
    const quotes = ((await list.json()) as { quotes: Array<{ id: number; margin_percent: number }> }).quotes;
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].id, simulated.data.quoteId);
    assert.equal(quotes[0].margin_percent, 32.5);

    const detail = await fetch(`${base}/api/quotes/${simulated.data.quoteId}`, { headers: { cookie } });
    assert.equal(detail.status, 200);
    const body = await detail.json() as {
      quote: { total_paise: number; subtotal_paise: number };
      items: Array<{ item_code: string; quoted_unit_price_paise: number }>;
    };
    assert.equal(body.items[0].item_code, 'WF-2');
    assert.equal(body.items[0].quoted_unit_price_paise, 662_500);
    assert.equal(body.quote.subtotal_paise, 500_000);
    assert.equal(body.quote.total_paise, 662_500);

    const rebuild = await fetch(`${base}/api/quotes/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId: simulated.sessionId }),
    });
    assert.equal(rebuild.status, 201);
    assert.equal(((await rebuild.json()) as { quote: { id: number } }).quote.id, simulated.data.quoteId);
  });

  it('returns 404 for an unknown quote and 422 for an unknown session', async () => {
    assert.equal((await fetch(`${base}/api/quotes/999`, { headers: { cookie } })).status, 404);
    const missing = await fetch(`${base}/api/quotes/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId: 'no-such-session' }),
    });
    assert.equal(missing.status, 422);
  });
});
