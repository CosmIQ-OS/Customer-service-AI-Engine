import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

const PASSWORD = 'a-long-test-password';
const WEBHOOK_SECRET = 'webhook-secret-0123456789';
const WHATSAPP_APP_SECRET = 'meta-app-secret-test-value';
const WHATSAPP_VERIFY_TOKEN = 'meta-verify-token-test';

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function startServer(
  db: DB,
  auth: AdminAuth,
  options: { webhookSecret?: string; whatsappVerifyToken?: string; whatsappAppSecret?: string } = {},
): Promise<Harness> {
  const engine = new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
  });
  const app = createApp(engine, {
    auth,
    sessionHours: 1,
    cookieSecure: false,
    webhookSecret: options.webhookSecret,
    whatsappVerifyToken: options.whatsappVerifyToken,
    whatsappAppSecret: options.whatsappAppSecret,
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('admin API protection', () => {
  let db: DB;
  let auth: AdminAuth;
  let harness: Harness;
  const open: Harness[] = [];

  before(async () => {
    db = await openDatabase(':memory:');
    auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('owner', PASSWORD);
    harness = await startServer(db, auth, {
      webhookSecret: WEBHOOK_SECRET,
      whatsappVerifyToken: WHATSAPP_VERIFY_TOKEN,
      whatsappAppSecret: WHATSAPP_APP_SECRET,
    });
  });

  after(async () => {
    await harness.close();
    while (open.length) await open.pop()?.close();
    await db.close();
  });

  it('keeps the health check public', async () => {
    const res = await fetch(`${harness.base}/api/health`);
    assert.equal(res.status, 200);
  });

  it('blocks admin data without a session', async () => {
    const res = await fetch(`${harness.base}/api/services`);
    assert.equal(res.status, 401);
  });

  it('rejects a wrong password', async () => {
    const res = await login(harness.base, 'owner', 'wrong-password-here');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('issues an HttpOnly, SameSite=Strict session cookie and grants access', async () => {
    const res = await login(harness.base, 'owner', PASSWORD);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /cosmiq_admin=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const cookie = extractCookie(setCookie);
    const services = await fetch(`${harness.base}/api/services`, { headers: { cookie } });
    assert.equal(services.status, 200);
    const me = await fetch(`${harness.base}/api/auth/me`, { headers: { cookie } });
    assert.equal((await me.json() as { admin: { username: string } }).admin.username, 'owner');
  });

  it('invalidates the session on logout', async () => {
    const cookie = extractCookie((await login(harness.base, 'owner', PASSWORD)).headers.get('set-cookie') ?? '');
    const logout = await fetch(`${harness.base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);

    const services = await fetch(`${harness.base}/api/services`, { headers: { cookie } });
    assert.equal(services.status, 401);
  });

  it('requires the webhook secret for channel ingress instead of admin login', async () => {
    const url = `${harness.base}/api/channels/unknown/inbound`;
    const missing = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 401);

    const wrong = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'not-the-secret-value' },
      body: '{}',
    });
    assert.equal(wrong.status, 401);

    const correct = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: '{}',
    });
    assert.equal(correct.status, 404);
  });

  it('disables channel ingress entirely when no webhook secret is configured', async () => {
    const unconfigured = await startServer(db, auth, {});
    open.push(unconfigured);
    const res = await fetch(`${unconfigured.base}/api/channels/telegram/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: '{}',
    });
    assert.equal(res.status, 503);
  });

  it('fails closed on WhatsApp webhook POST when WHATSAPP_APP_SECRET is unset', async () => {
    const unconfigured = await startServer(db, auth, {});
    open.push(unconfigured);
    const res = await fetch(`${unconfigured.base}/api/channels/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry: [] }),
    });
    assert.equal(res.status, 503);
  });

  it('enforces X-Hub-Signature-256 HMAC verification on WhatsApp webhook POST and plain-text GET challenge', async () => {
    const getOk = await fetch(
      `${harness.base}/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=12345`,
    );
    assert.equal(getOk.status, 200);
    assert.match(getOk.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await getOk.text(), '12345');

    const body = JSON.stringify({ entry: [] });
    const missingSig = await fetch(`${harness.base}/api/channels/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(missingSig.status, 401);

    const badSig = await fetch(`${harness.base}/api/channels/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      body,
    });
    assert.equal(badSig.status, 401);

    const validSig = `sha256=${createHmac('sha256', WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
    const okRes = await fetch(`${harness.base}/api/channels/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': validSig,
      },
      body,
    });
    assert.equal(okRes.status, 200);
    assert.equal(await okRes.text(), 'EVENT_RECEIVED');
  });

  it('serves collected intakes to signed-in admins', async () => {
    const cookie = extractCookie((await login(harness.base, 'owner', PASSWORD)).headers.get('set-cookie') ?? '');
    const sim = await fetch(`${harness.base}/api/chat/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        channel: 'telegram',
        externalUserId: 'api-intake-user',
        text: 'Company: API Co; Size: 40 people; Tools: Slack; Service: Live Chat Support',
      }),
    });
    assert.equal(sim.status, 200);
    assert.equal(((await sim.json()) as { intent: string }).intent, 'intake');

    const res = await fetch(`${harness.base}/api/intakes`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const rows = await res.json() as Array<{ id: number; external_user_id: string; company_name: string; company_size: string; status: string }>;
    const row = rows.find((record) => record.external_user_id === 'api-intake-user');
    assert.equal(row?.company_name, 'API Co');
    assert.equal(row?.company_size, '40 people');
    assert.equal(row?.status, 'collected');

    for (const nextStatus of ['quoted', 'deal_won', 'completed'] as const) {
      const patchRes: Response = await fetch(`${harness.base}/api/intakes/${row!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ status: nextStatus }),
      });
      assert.equal(patchRes.status, 200);
      assert.equal(((await patchRes.json()) as { status: string }).status, nextStatus);
    }

    const badStatus = await fetch(`${harness.base}/api/intakes/${row!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ status: 'bogus_status' }),
    });
    assert.equal(badStatus.status, 400);

    const unauthorizedDelete = await fetch(`${harness.base}/api/intakes/${row!.id}`, { method: 'DELETE' });
    assert.equal(unauthorizedDelete.status, 401);
    const invalidDelete = await fetch(`${harness.base}/api/intakes/not-a-number`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(invalidDelete.status, 400);
    const deleteRes = await fetch(`${harness.base}/api/intakes/${row!.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(deleteRes.status, 200);
    assert.deepEqual(await deleteRes.json(), { deleted: true, id: row!.id });
    const missingDelete = await fetch(`${harness.base}/api/intakes/${row!.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(missingDelete.status, 404);
  });

  it('lets an admin take over a conversation, reply, delete sent messages, and hand it back', async () => {
    const cookie = extractCookie((await login(harness.base, 'owner', PASSWORD)).headers.get('set-cookie') ?? '');
    const sim = await fetch(`${harness.base}/api/chat/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ channel: 'web', externalUserId: 'api-live-user', text: 'Hello, I need help.' }),
    });
    assert.equal(sim.status, 200);
    const sessionId = ((await sim.json()) as { sessionId: string }).sessionId;

    const takeOver = await fetch(`${harness.base}/api/conversations/${sessionId}/takeover`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(takeOver.status, 200);
    assert.equal(((await takeOver.json()) as { mode: string }).mode, 'human');

    const waiting = await fetch(`${harness.base}/api/conversations/needing-human`, { headers: { cookie } });
    const waitingRows = (await waiting.json()) as { conversations: Array<{ sessionId: string; mode: string }> };
    assert.ok(waitingRows.conversations.some((row) => row.sessionId === sessionId));

    const reply = await fetch(`${harness.base}/api/conversations/${sessionId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'A specialist is on the way.' }),
    });
    assert.equal(reply.status, 200);

    const messages = await fetch(`${harness.base}/api/conversations/${sessionId}/messages`, { headers: { cookie } });
    const thread = (await messages.json()) as { messages: Array<{ id: number; role: string; content: string }> };
    const userMsg = thread.messages.find((message) => message.role === 'user');
    const aiMsg = thread.messages.find((message) => message.role === 'assistant');
    const humanMsg = thread.messages.find((message) => message.role === 'human');
    assert.ok(userMsg);
    assert.ok(aiMsg);
    assert.ok(humanMsg);

    // Cannot delete customer (user) message
    const delUser = await fetch(`${harness.base}/api/conversations/${sessionId}/messages/${userMsg.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(delUser.status, 422);

    // Can delete sent human and assistant messages
    const delHuman = await fetch(`${harness.base}/api/conversations/${sessionId}/messages/${humanMsg.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(delHuman.status, 200);

    const delAi = await fetch(`${harness.base}/api/conversations/${sessionId}/messages/${aiMsg.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(delAi.status, 200);

    const afterDelete = await fetch(`${harness.base}/api/conversations/${sessionId}/messages`, { headers: { cookie } });
    const remaining = ((await afterDelete.json()) as { messages: Array<{ id: number; role: string }> }).messages;
    assert.equal(remaining.some((m) => m.id === humanMsg.id || m.id === aiMsg.id), false);
    assert.equal(remaining.some((m) => m.id === userMsg.id), true);

    const handBack = await fetch(`${harness.base}/api/conversations/${sessionId}/handback`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(((await handBack.json()) as { mode: string }).mode, 'ai');
  });

  it('requires an admin session for the conversation routes', async () => {
    const res = await fetch(`${harness.base}/api/conversations`);
    assert.equal(res.status, 401);
  });
});

function login(base: string, username: string, password: string): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

function extractCookie(setCookie: string): string {
  const match = /cosmiq_admin=[^;]+/.exec(setCookie);
  assert.ok(match, 'expected a cosmiq_admin cookie');
  return match[0];
}
