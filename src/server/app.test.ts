import assert from 'node:assert/strict';
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

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function startServer(db: DB, auth: AdminAuth, webhookSecret?: string): Promise<Harness> {
  const engine = new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
  });
  const app = createApp(engine, { auth, sessionHours: 1, cookieSecure: false, webhookSecret });
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
    db = openDatabase(':memory:');
    auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('owner', PASSWORD);
    harness = await startServer(db, auth, WEBHOOK_SECRET);
  });

  after(async () => {
    await harness.close();
    while (open.length) await open.pop()?.close();
    db.close();
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
    const unconfigured = await startServer(db, auth, undefined);
    open.push(unconfigured);
    const res = await fetch(`${unconfigured.base}/api/channels/telegram/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: '{}',
    });
    assert.equal(res.status, 503);
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
