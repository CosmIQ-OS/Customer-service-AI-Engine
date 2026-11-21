import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

describe('notification routes (settings, test alert, SSE stream)', () => {
  let db: DB;
  let engine: SupportEngine;
  let server: Server;
  let base: string;
  let cookie: string;

  before(async () => {
    db = await openDatabase(':memory:');
    const auth = new AdminAuth(db, { sessionHours: 1 });
    await auth.createAdmin('admin', 'SuperSecureAdminPass123!', 'Admin');

    engine = new SupportEngine(db, {
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
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SuperSecureAdminPass123!' }),
    });
    assert.equal(loginRes.status, 200);
    cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.ok(cookie);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it('requires admin auth for notification settings, test, and stream endpoints', async () => {
    assert.equal((await fetch(`${base}/api/notifications/settings`)).status, 401);
    assert.equal((await fetch(`${base}/api/notifications/test`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/notifications/stream`)).status, 401);
  });

  it('gets, updates, and persists lead notification settings and triggers test alert', async () => {
    const initialRes = await fetch(`${base}/api/notifications/settings`, { headers: { cookie } });
    assert.equal(initialRes.status, 200);
    const initial = (await initialRes.json()) as any;
    assert.equal(initial.settings.enabled, true);

    const putRes = await fetch(`${base}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        whatsappEnabled: true,
        whatsappRecipients: ['+91 98765-43210', '919876543210'],
        telegramChatIds: [123456],
        notifyOnLeadStarted: true,
        notifyOnLeadQualified: true,
        notifyOnWebsiteLead: true,
      }),
    });
    assert.equal(putRes.status, 200);
    const updated = (await putRes.json()) as any;
    assert.deepEqual(updated.settings.whatsappRecipients, ['919876543210']);
    assert.deepEqual(updated.settings.telegramChatIds, [123456]);
    assert.equal(updated.whatsappWindows.length, 1);
    assert.equal(updated.whatsappWindows[0].status, 'never_pinged');

    const testRes = await fetch(`${base}/api/notifications/test`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(testRes.status, 201);
    const testBody = (await testRes.json()) as any;
    assert.ok(testBody.notification.id);
    assert.equal(testBody.delivery.whatsapp.status, 'skipped');
  });

  it('streams live SSE notifications when a website lead arrives', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/notifications/stream`, {
      headers: { cookie },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read initial ready event
    const first = await reader.read();
    buffer += decoder.decode(first.value, { stream: true });
    assert.match(buffer, /event: ready/);

    // Trigger a website lead while stream is connected
    const leadRes = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company_name: 'StreamPulse Co',
        contact_person: 'Meera',
        email: 'meera@streampulse.io',
        service_name: 'Workflow Automation',
      }),
    });
    assert.equal(leadRes.status, 201);

    // Wait for the live notification event over SSE
    const second = await reader.read();
    buffer += decoder.decode(second.value, { stream: true });
    assert.match(buffer, /event: notification/);
    assert.match(buffer, /StreamPulse Co/);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });
});
