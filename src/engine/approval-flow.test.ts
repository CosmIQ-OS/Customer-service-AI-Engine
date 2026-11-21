import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { publishPriceTable } from '../db/repositories/pricing.js';
import { MockLLMProvider } from '../llm/mock.js';
import type { ChannelAdapter } from './channels/adapter.js';
import type { EngineResponse, InboundMessage } from './types.js';
import { SupportEngine } from './support-engine.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

async function createEngine(options: { now?: () => Date } = {}) {
  const db = await openDatabase(':memory:');
  databases.push(db);
  const engine = new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
    pricingModel: 'pricing-mock',
    approvalWindowHours: 6,
    now: options.now,
  });
  const workflow = await engine.createService({
    name: 'Workflow Automation',
    description: 'End-to-end business workflows.',
    category: 'workflow',
    status: 'available',
    availability_note: '',
  });
  await publishPriceTable(db, {
    serviceId: workflow.id,
    sourceFilename: 'workflow.csv',
    uploadedBy: null,
    items: [
      { item_code: 'WF-1', description: 'Discovery workshop', unit: 'day', unit_price_paise: 100_000 },
      { item_code: 'WF-2', description: 'Automation build', unit: 'project', unit_price_paise: 500_000 },
    ],
  });
  const admin = await db.queryOne<{ id: number }>(
    "INSERT INTO admin_users (username, password_hash) VALUES ('test-admin', 'unused') RETURNING id",
  );
  return { db, engine, adminId: Number(admin!.id) };
}

async function startIntake(engine: SupportEngine, userId = 'approval-user') {
  const result = await engine.handleMessage({
    channel: 'telegram',
    externalUserId: userId,
    text: 'Company: Approval Co; Size: 20 employees; Tools: Slack; Service: Workflow Automation',
  });
  const quoteId = result.data?.quoteId as number;
  assert.equal(typeof quoteId, 'number');
  return { quoteId, sessionId: result.sessionId };
}

describe('quote approval flow', () => {
  it('edits a pending quote, approves it, and stores the itemized customer message', async () => {
    const { engine, adminId } = await createEngine();
    const { quoteId, sessionId } = await startIntake(engine);
    const pending = (await engine.getQuote(quoteId))!;
    const item = pending.items[0];

    const edited = await engine.editQuote(
      quoteId,
      { marginPercent: 35, quantities: { [item.id]: 2 } },
      adminId,
    );
    assert.equal(edited.quote.total_paise, 1_350_000);
    assert.equal(edited.items[0].quantity, 2);
    assert.equal(edited.items[0].admin_unit_price_paise, 500_000);
    assert.equal(edited.items[0].quoted_unit_price_paise, 675_000);

    const result = await engine.approveQuote(quoteId, adminId);
    assert.equal(result.quote.status, 'approved');
    assert.equal(result.delivered, false);
    assert.match(result.message, /WF-2/);
    assert.match(result.message, /Total: ₹13,500\.00 \(INR\)/);

    const messages = await engine.listMessages(sessionId);
    assert.ok(messages.some((message) => message.role === 'assistant' && message.content === result.message));
    const logs = await engine.listLogs(50);
    assert.ok(logs.some((log) => log.event === 'quote.approved'));
    assert.ok(logs.some((log) => log.event === 'quote.delivered' && log.direction === 'outbound'));
    assert.equal((await engine.approvalSummary()).pending, 0);
    assert.equal((await engine.approvalSummary()).unread, 0);
  });

  it('delivers an approved quote through the channel adapter when one is registered', async () => {
    const { engine } = await createEngine();
    const sent: EngineResponse[] = [];
    const adapter: ChannelAdapter = {
      channel: 'telegram',
      async sendMessage(_externalUserId: string, response: EngineResponse) {
        sent.push(response);
      },
      normalize(_payload: unknown): InboundMessage | null {
        return null;
      },
    };
    engine.adapters.register(adapter);

    const { quoteId } = await startIntake(engine, 'adapter-user');
    const result = await engine.approveQuote(quoteId, null);
    assert.equal(result.delivered, true);
    assert.equal(result.quote.delivered_at !== null, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].reply, /WF-2/);
    assert.equal(sent[0].intent, 'quote');
  });

  it('sends a price-free handoff when an admin rejects a quote', async () => {
    const { engine, adminId } = await createEngine();
    const { quoteId, sessionId } = await startIntake(engine, 'reject-user');
    const result = await engine.rejectQuote(quoteId, adminId, 'Scope does not fit the budget.');

    assert.equal(result.quote.status, 'rejected');
    assert.equal(result.quote.decision_note, 'Scope does not fit the budget.');
    assert.equal(result.message.includes('₹'), false);
    assert.match(result.message, /specialist will follow up/i);

    const messages = await engine.listMessages(sessionId);
    assert.ok(messages.some((message) => message.content === result.message));
    assert.equal((await engine.approvalSummary()).unread, 0);
  });

  it('re-alerts admins after six hours, keeps the quote pending, and does not spam the customer', async () => {
    let now = new Date('2026-11-11T10:00:00.000Z');
    const { engine } = await createEngine({ now: () => now });
    const { quoteId, sessionId } = await startIntake(engine, 'waiting-user');

    const pending = (await engine.getQuote(quoteId))!;
    assert.equal(pending.quote.expires_at, '2026-11-11 16:00:00');

    assert.deepEqual(await engine.processDueApprovals(), { realerted: 0 });
    assert.equal((await engine.approvalSummary()).unread, 2);

    now = new Date('2026-11-11T16:00:05.000Z');
    assert.deepEqual(await engine.processDueApprovals(), { realerted: 1 });

    const after = (await engine.getQuote(quoteId))!;
    assert.equal(after.quote.status, 'pending_approval');
    assert.equal(after.quote.alert_count, 1);
    assert.equal(after.quote.next_alert_at, '2026-11-11 22:00:05');
    assert.equal((await engine.approvalSummary()).unread, 3);

    // Customers must not be interrupted with repeated "still with our team" follow-ups.
    const holding = (await engine.listMessages(sessionId)).filter(
      (message) => message.role === 'assistant' && /still with our team/i.test(message.content),
    );
    assert.equal(holding.length, 0);

    assert.deepEqual(await engine.processDueApprovals(), { realerted: 0 });
    assert.equal((await engine.getQuote(quoteId))!.quote.alert_count, 1);
  });
});
