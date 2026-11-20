import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AdminAuth } from '../auth/admin-auth.js';
import { openDatabase, type DB } from '../db/database.js';
import { SupportEngine } from '../engine/support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { createApp } from './app.js';

describe('website leads API', () => {
  let db: DB;
  let engine: SupportEngine;
  let server: Server;
  let base: string;

  before(async () => {
    db = await openDatabase(':memory:');
    const auth = new AdminAuth(db, { sessionHours: 1 });
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
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it('accepts valid website lead without admin login and creates intake & notification', async () => {
    const res = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Nexus Dynamics',
        company_size: '10-20',
        contact_person: 'Sarah Connor',
        email: 'sarah@nexus.io',
        phone: '+919876500000',
        current_tools: 'Salesforce, Slack',
        service_name: 'Workflow Automation',
        notes: 'Need end-to-end automation',
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.ok(body.sessionId);
    assert.ok(body.intakeId);

    // Verify it appears in intakes with status 'collected'
    const intakes = await engine.listIntakes();
    const found = intakes.find((i) => i.company_name === 'Nexus Dynamics');
    assert.ok(found);
    assert.equal(found.channel, 'website');
    assert.equal(found.status, 'collected');
    assert.equal(found.company_size, '10-20');

    // Verify website lead does NOT appear in Live Inbox conversations
    const conversations = await engine.listConversations();
    assert.equal(
      conversations.some((c) => c.sessionId === body.sessionId || c.channel === 'website'),
      false,
    );

    // Verify notification was recorded
    const notifs = await engine.listNotifications();
    const leadNotif = notifs.find((n) => n.kind === 'website_lead' && n.title.includes('Nexus Dynamics'));
    assert.ok(leadNotif);
  });

  it('rejects payload with missing contact info', async () => {
    const res = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Incomplete Inc',
      }),
    });
    assert.equal(res.status, 400);
  });
});
