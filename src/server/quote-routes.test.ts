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
  let quoteId: number;
  let quoteSessionId: string;

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
    quoteId = simulated.data.quoteId as number;
    quoteSessionId = simulated.sessionId;

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

  it('queues the quote for approval and exposes the alert in the dashboard feed', async () => {
    const res = await fetch(`${base}/api/approvals`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      pending: Array<{ id: number; status: string; expires_at: string | null }>;
      counts: { pending: number; unread: number; windowHours: number };
      notifications: Array<{ kind: string; quote_id: number; read_at: string | null }>;
    };
    assert.equal(body.pending.length, 1);
    assert.equal(body.pending[0].id, quoteId);
    assert.equal(body.pending[0].status, 'pending_approval');
    assert.ok(body.pending[0].expires_at);
    assert.deepEqual(
      { pending: body.counts.pending, unread: body.counts.unread, windowHours: body.counts.windowHours },
      { pending: 1, unread: 1, windowHours: 6 },
    );
    assert.equal(body.notifications[0].kind, 'quote_approval');
    assert.equal(body.notifications[0].quote_id, quoteId);
    assert.equal(body.notifications[0].read_at, null);

    const readAll = await fetch(`${base}/api/notifications/read-all`, { method: 'POST', headers: { cookie } });
    assert.equal((await readAll.json() as { updated: number }).updated, 1);
    const after = await fetch(`${base}/api/approvals`, { headers: { cookie } });
    assert.equal((await after.json() as { counts: { unread: number } }).counts.unread, 0);
  });

  it('lets admins edit quantities and margin before approving, then delivers an itemized quote', async () => {
    const edited = await fetch(`${base}/api/quotes/${quoteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ marginPercent: 35, items: [{ id: 1, quantity: 2 }] }),
    });
    assert.equal(edited.status, 200);
    const editedBody = await edited.json() as {
      quote: { margin_percent: number; subtotal_paise: number; total_paise: number };
      items: Array<{ item_code: string; quantity: number; admin_unit_price_paise: number; quoted_unit_price_paise: number }>;
    };
    assert.equal(editedBody.quote.margin_percent, 35);
    assert.equal(editedBody.quote.subtotal_paise, 1_000_000);
    assert.equal(editedBody.items[0].quantity, 2);
    assert.equal(editedBody.items[0].admin_unit_price_paise, 500_000);
    assert.equal(editedBody.items[0].quoted_unit_price_paise, 675_000);
    assert.equal(editedBody.quote.total_paise, 1_350_000);

    const approved = await fetch(`${base}/api/quotes/${quoteId}/approve`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json() as {
      quote: { status: string; total_paise: number };
      message: string;
      delivered: boolean;
    };
    assert.equal(approvedBody.quote.status, 'approved');
    assert.equal(approvedBody.quote.total_paise, 1_350_000);
    assert.equal(approvedBody.delivered, false);
    assert.match(approvedBody.message, /WF-2/);
    assert.match(approvedBody.message, /Total: ₹13,500\.00/);

    const again = await fetch(`${base}/api/quotes/${quoteId}/approve`, { method: 'POST', headers: { cookie } });
    assert.equal(again.status, 422);

    const after = await fetch(`${base}/api/approvals`, { headers: { cookie } });
    const afterBody = await after.json() as { pending: unknown[]; counts: { unread: number } };
    assert.equal(afterBody.pending.length, 0);
    assert.equal(afterBody.counts.unread, 0);
  });

  it('rejects a quote with a price-free handoff message and records the internal note', async () => {
    const sim = await fetch(`${base}/api/chat/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        channel: 'telegram',
        externalUserId: 'quote-api-user-2',
        text: 'Company: Reject Co; Size: 8 people; Tools: Excel; Service: Workflow Automation',
      }),
    });
    const simulated = await sim.json() as { data: { quoteId?: number } };
    const secondId = simulated.data.quoteId as number;
    assert.equal(typeof secondId, 'number');

    const rejected = await fetch(`${base}/api/quotes/${secondId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ note: 'Budget too small for this scope.' }),
    });
    assert.equal(rejected.status, 200);
    const body = await rejected.json() as {
      quote: { status: string; decision_note: string };
      message: string;
    };
    assert.equal(body.quote.status, 'rejected');
    assert.equal(body.quote.decision_note, 'Budget too small for this scope.');
    assert.equal(body.message.includes('₹'), false);
    assert.match(body.message, /specialist will follow up/i);

    const detail = await fetch(`${base}/api/quotes/${secondId}`, { headers: { cookie } });
    const detailBody = await detail.json() as { quote: { decision_note: string; status: string } };
    assert.equal(detailBody.quote.status, 'rejected');
    assert.equal(detailBody.quote.decision_note, 'Budget too small for this scope.');
  });
});
