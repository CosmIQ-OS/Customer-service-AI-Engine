import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { SupportEngine } from './support-engine.js';
import { MockLLMProvider } from '../llm/mock.js';
import { WhatsAppAdapter } from '../adapters/whatsapp.js';
import type { NotificationStreamEvent } from '../notifications/notification-hub.js';

describe('lead notifications (dashboard + free WhatsApp admin alerts)', () => {
  const databases: DB[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    while (databases.length) {
      await databases.pop()!.close();
    }
  });

  async function setup(opts: { now?: () => Date; whatsappLive?: boolean } = {}) {
    const db = await openDatabase(':memory:');
    databases.push(db);
    const sentMessages: Array<{ to: string; body: string }> = [];

    if (opts.whatsappLive) {
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { to: string; text?: { body?: string } };
        sentMessages.push({ to: parsed.to, body: parsed.text?.body ?? '' });
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;
    }

    const engine = new SupportEngine(db, {
      sessionTtlMinutes: 120,
      llm: new MockLLMProvider(),
      model: 'mock',
      maxSteps: 6,
      maxHistory: 12,
      temperature: 0,
      tenantId: 'test',
      whatsappAdminNumbers: '919999000111',
      dashboardPublicUrl: 'https://ops.cosmiqos.example',
      now: opts.now,
    });
    await engine.createService({
      name: 'WhatsApp Agent Services',
      description: 'AI agents for WhatsApp',
      category: 'whatsapp',
      status: 'available',
      availability_note: '',
      base_price_paise: 5_500_000,
    });

    const whatsapp = new WhatsAppAdapter({
      accessToken: opts.whatsappLive ? 'secret-wa-token-xyz' : undefined,
      phoneNumberId: opts.whatsappLive ? '1234567890' : undefined,
      adminNumbers: ['919999000111'],
    });
    engine.adapters.register(whatsapp);

    const events: NotificationStreamEvent[] = [];
    const unsubscribe = engine.notificationHub.subscribe((event) => events.push(event));

    return { db, engine, sentMessages, events, unsubscribe };
  }

  it('notifies immediately when a new customer enters with a greeting before sharing any intake fields', async () => {
    const { engine, sentMessages, events, unsubscribe } = await setup({ whatsappLive: true });
    try {
      // Turn 1: Customer just enters and says "Hi, what services do you offer?" (no intake saved yet)
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '916666555444',
        text: 'Hi, what services do you offer?',
        metadata: { name: 'Kiran Nair' },
      });
      await new Promise((r) => setTimeout(r, 30));

      let notifs = await engine.listNotifications();
      const started = notifs.filter((n) => n.kind === 'lead_started');
      assert.equal(started.length, 1);
      assert.match(started[0].title, /Kiran Nair/);
      assert.equal(started[0].intake_id, null);
      assert.ok(started[0].session_id);
      assert.ok(events.some((e) => e.type === 'notification' && e.notification.kind === 'lead_started'));
      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0].body, /New WhatsApp Customer Entered/);
      assert.match(sentMessages[0].body, /Kiran Nair/);

      // Turn 2: Customer gives partial intake -> should NOT duplicate lead_started
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '916666555444',
        text: 'Company: Kiran Digital; Service: WhatsApp Agent Services',
      });
      await new Promise((r) => setTimeout(r, 30));

      notifs = await engine.listNotifications();
      assert.equal(notifs.filter((n) => n.kind === 'lead_started').length, 1);
      assert.equal(sentMessages.length, 1);

      // Turn 3: Customer completes intake -> SHOULD fire lead_qualified
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '916666555444',
        text: 'Size: 15 employees; Tools: Slack, Notion',
      });
      await new Promise((r) => setTimeout(r, 30));

      notifs = await engine.listNotifications();
      assert.equal(notifs.filter((n) => n.kind === 'lead_qualified').length, 1);
      assert.equal(sentMessages.length, 2);
    } finally {
      unsubscribe();
    }
  });

  it('triggers lead_started on partial WhatsApp intake and lead_qualified when completed, without duplicates', async () => {
    const { engine, sentMessages, events, unsubscribe } = await setup({ whatsappLive: true });
    try {
      // Turn 1: partial intake -> collecting -> should fire lead_started
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '918888111222',
        text: 'Company: Orbit Labs; Service: WhatsApp Agent Services',
      });

      // Allow async external alert promise to settle
      await new Promise((r) => setTimeout(r, 30));

      let notifs = await engine.listNotifications();
      const started = notifs.filter((n) => n.kind === 'lead_started');
      assert.equal(started.length, 1);
      assert.ok(started[0].title.includes('Orbit Labs'));
      assert.ok(started[0].intake_id !== null);
      assert.ok(events.some((e) => e.type === 'notification' && e.notification.kind === 'lead_started'));
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].to, '919999000111');
      assert.match(sentMessages[0].body, /Orbit Labs/);
      assert.match(sentMessages[0].body, /https:\/\/ops\.cosmiqos\.example/);

      // Turn 2: complete intake -> collected -> should fire lead_qualified
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '918888111222',
        text: 'Size: 25 employees; Tools: Slack, HubSpot',
      });
      await new Promise((r) => setTimeout(r, 30));

      notifs = await engine.listNotifications();
      const qualified = notifs.filter((n) => n.kind === 'lead_qualified');
      assert.equal(qualified.length, 1);
      assert.ok(qualified[0].title.includes('Orbit Labs'));
      assert.equal(sentMessages.length, 2);
      assert.match(sentMessages[1].body, /Qualified WhatsApp Lead/);

      // Turn 3: follow-up message after already collected -> should NOT spam another lead notification
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '918888111222',
        text: 'Thanks, looking forward to hearing back!',
      });
      await new Promise((r) => setTimeout(r, 30));

      notifs = await engine.listNotifications();
      assert.equal(notifs.filter((n) => n.kind === 'lead_started').length, 1);
      assert.equal(notifs.filter((n) => n.kind === 'lead_qualified').length, 1);
    } finally {
      unsubscribe();
    }
  });

  it('fires only a single lead_qualified notification when all intake fields arrive in one turn', async () => {
    const { engine, sentMessages, unsubscribe } = await setup({ whatsappLive: true });
    try {
      await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '917777333444',
        text: 'Company: SolarTech; Size: 40 employees; Tools: Notion, Slack; Service: WhatsApp Agent Services',
      });
      await new Promise((r) => setTimeout(r, 30));

      const notifs = await engine.listNotifications();
      assert.equal(notifs.filter((n) => n.kind === 'lead_started').length, 0);
      assert.equal(notifs.filter((n) => n.kind === 'lead_qualified').length, 1);
      assert.equal(sentMessages.length, 1);
    } finally {
      unsubscribe();
    }
  });

  it('intercepts admin /ping on WhatsApp to refresh the free 24h window without creating a fake lead', async () => {
    let now = new Date('2026-11-21T10:00:00Z');
    const { engine, unsubscribe } = await setup({ now: () => now });
    try {
      const res = await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '919999000111',
        text: '/ping',
      });

      assert.equal(res.intent, 'admin_keepalive');
      assert.match(res.reply, /24 hours/i);
      assert.equal((await engine.listSessions()).length, 0);
      assert.equal((await engine.listIntakes()).length, 0);
      assert.equal((await engine.listConversations()).length, 0);

      const view = await engine.getLeadNotificationSettingsView();
      assert.equal(view.whatsappWindows.length, 1);
      assert.equal(view.whatsappWindows[0].status, 'active');
      assert.equal(view.whatsappWindows[0].remainingMinutes, 24 * 60);

      // Advance 25 hours -> window should show expired
      now = new Date('2026-11-22T11:00:00Z');
      const expiredView = await engine.getLeadNotificationSettingsView();
      assert.equal(expiredView.whatsappWindows[0].status, 'expired');
      assert.equal(expiredView.whatsappWindows[0].remainingMinutes, 0);
    } finally {
      unsubscribe();
    }
  });

  it('dispatches WhatsApp admin alert & SSE broadcast on website leads and survives delivery errors', async () => {
    const db = await openDatabase(':memory:');
    databases.push(db);

    globalThis.fetch = (async () =>
      new Response('meta token secret-wa-token-xyz rejected', { status: 400 })) as typeof fetch;

    const engine = new SupportEngine(db, {
      sessionTtlMinutes: 120,
      llm: new MockLLMProvider(),
      model: 'mock',
      maxSteps: 6,
      maxHistory: 12,
      temperature: 0,
      tenantId: 'test',
      whatsappAdminNumbers: '919999000111',
    });
    engine.adapters.register(
      new WhatsAppAdapter({
        accessToken: 'secret-wa-token-xyz',
        phoneNumberId: '1234567890',
        adminNumbers: ['919999000111'],
        onError: () => undefined,
      }),
    );

    const events: NotificationStreamEvent[] = [];
    const unsub = engine.notificationHub.subscribe((e) => events.push(e));
    try {
      const lead = await engine.recordWebsiteLead({
        company_name: 'Nova Retail',
        contact_person: 'Asha',
        email: 'asha@novaretail.in',
        service_name: 'WhatsApp Agent Services',
      });
      await new Promise((r) => setTimeout(r, 30));

      assert.ok(lead.intakeId);
      const notifs = await engine.listNotifications();
      const webNotif = notifs.find((n) => n.kind === 'website_lead');
      assert.ok(webNotif);
      assert.equal(webNotif.intake_id, lead.intakeId);
      assert.ok(events.some((e) => e.type === 'notification' && e.notification.kind === 'website_lead'));

      // Delivery failure logged with token redacted
      const logs = await engine.listLogs();
      const failLog = logs.find((l) => l.event === 'alert.delivery_failed');
      assert.ok(failLog);
      assert.equal(JSON.stringify(failLog.payload).includes('secret-wa-token-xyz'), false);
    } finally {
      unsub();
    }
  });

  it('deduplicates duplicate WhatsApp webhook deliveries by wamid and 8-second burst guard', async () => {
    const { engine, sentMessages, unsubscribe } = await setup({ whatsappLive: true });
    try {
      const wa = engine.adapters.get('whatsapp')!;
      const webhookPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: 'Rinshid' } }],
                  messages: [
                    {
                      id: 'wamid.HBgMOTE3NTk0ODI3NDI5FQIAEhgWM0VCMDEyMzQ1',
                      from: '917594827429',
                      timestamp: '1700000100',
                      text: { body: 'Hi' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg1 = wa.normalize(webhookPayload)!;
      const msg2 = wa.normalize(webhookPayload)!;
      assert.equal(msg1.metadata?.messageId, 'wamid.HBgMOTE3NTk0ODI3NDI5FQIAEhgWM0VCMDEyMzQ1');

      // Concurrent delivery of the exact same wamid
      const [res1, res2] = await Promise.all([engine.handleMessage(msg1), engine.handleMessage(msg2)]);
      const processed = [res1, res2].filter((r) => r.intent !== 'duplicate_ignored');
      const ignored = [res1, res2].filter((r) => r.intent === 'duplicate_ignored');

      assert.equal(processed.length, 1);
      assert.equal(ignored.length, 1);
      assert.equal(ignored[0].reply, '');

      // Even if a second webhook arrives within 8s with a different/missing messageId but identical text ("Hi"), burst guard blocks it
      const burstDup = await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '917594827429',
        text: 'Hi',
        metadata: { messageId: 'wamid.SECOND_DELIVERY' },
      });
      assert.equal(burstDup.intent, 'duplicate_ignored');
      assert.equal(burstDup.reply, '');

      // Verify only 1 user message + 1 AI reply stored in the transcript
      const messages = await engine.listMessages(processed[0].sessionId);
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, 'user');
      assert.equal(messages[0].content, 'Hi');
      assert.equal(messages[1].role, 'assistant');

      // Different follow-up text from the same user processes normally
      const followUp = await engine.handleMessage({
        channel: 'whatsapp',
        externalUserId: '917594827429',
        text: 'What services are available?',
        metadata: { messageId: 'wamid.FOLLOW_UP_1' },
      });
      assert.notEqual(followUp.intent, 'duplicate_ignored');
      assert.ok(followUp.reply.trim().length > 0);
      assert.equal((await engine.listMessages(processed[0].sessionId)).length, 4);
      assert.ok(sentMessages.length >= 1);
    } finally {
      unsubscribe();
    }
  });
});
