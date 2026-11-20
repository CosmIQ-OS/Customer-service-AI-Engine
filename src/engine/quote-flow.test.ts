import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { publishPriceTable } from '../db/repositories/pricing.js';
import { MockLLMProvider } from '../llm/mock.js';
import { SupportEngine } from './support-engine.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

async function createEngine() {
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

  const ai = await engine.createService({
    name: 'AI Native Internal System',
    description: 'Internal AI systems.',
    category: 'ai',
    status: 'available',
    availability_note: '',
  });
  await publishPriceTable(db, {
    serviceId: ai.id,
    sourceFilename: 'ai.csv',
    uploadedBy: null,
    items: [
      { item_code: 'AI-1', description: 'AI assistant setup', unit: 'project', unit_price_paise: 100_000 },
    ],
  });

  await engine.createService({
    name: 'WhatsApp Agent Services',
    description: 'WhatsApp agents.',
    category: 'whatsapp',
    status: 'available',
    availability_note: '',
  });

  return { db, engine };
}

describe('quote flow', () => {
  it('creates a pending-approval quote with the configured markup when intake completes', async () => {
    const { engine } = await createEngine();
    const result = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'quote-user-1',
      text: 'Company: Acme; Size: 20 employees; Tools: Slack; Service: Workflow Automation',
    });

    assert.equal(result.intent, 'intake');
    const quoteId = result.data?.quoteId;
    assert.equal(typeof quoteId, 'number');

    const found = await engine.getQuote(quoteId as number);
    assert.ok(found);
    assert.equal(found.quote.status, 'pending_approval');
    assert.equal(found.quote.margin_percent, 30);
    assert.match(found.quote.quote_number, /^Q-\d{4}-\d{4,}$/);
    assert.deepEqual(found.items.map((item) => item.item_code), ['WF-2']);
    assert.equal(found.items[0].admin_unit_price_paise, 500_000);
    assert.equal(found.items[0].quoted_unit_price_paise, 650_000);
    assert.equal(found.items[0].line_total_paise, 650_000);
    assert.equal(found.quote.subtotal_paise, 500_000);
    assert.equal(found.quote.total_paise, 650_000);
    assert.equal(found.quote.margin_paise, 150_000);
    assert.equal(found.quote.currency, 'INR');
    assert.ok(found.quote.expires_at, 'pending quotes carry the approval deadline');
    assert.equal(found.quote.expires_at, found.quote.next_alert_at);
    assert.equal((await engine.approvalSummary()).pending, 1);
    assert.equal((await engine.approvalSummary()).unread, 1);
    assert.ok((await engine.listLogs(20)).some((log) => log.event === 'quote.pending_approval'));
  });

  it('reuses the existing quote instead of creating duplicates', async () => {
    const { engine } = await createEngine();
    const first = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'quote-user-2',
      text: 'Company: Beta; Size: 10 people; Tools: Excel; Service: Workflow Automation',
    });
    const second = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'quote-user-2',
      text: 'Thanks',
    });

    assert.equal(second.data?.quoteId, first.data?.quoteId);
    assert.equal((await engine.listQuotes(10)).length, 1);
  });

  it('applies a changed margin to new quotes', async () => {
    const { engine } = await createEngine();
    assert.equal(await engine.setQuoteMarginPercent(35, null), 35);

    const result = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'quote-user-3',
      text: 'Company: Gamma; Size: 5 people; Tools: Excel; Service: AI Native Internal System',
    });
    const found = await engine.getQuote(result.data?.quoteId as number);
    assert.ok(found);
    assert.equal(found.quote.margin_percent, 35);
    assert.equal(found.items[0].admin_unit_price_paise, 100_000);
    assert.equal(found.items[0].quoted_unit_price_paise, 135_000);
    assert.equal(found.quote.total_paise, 135_000);
  });

  it('rebuilds on request, supersedes the old draft, and keeps both versions', async () => {
    const { engine } = await createEngine();
    const result = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'quote-user-4',
      text: 'Company: Delta; Size: 15 people; Tools: Notion; Service: Workflow Automation',
    });
    const firstId = result.data?.quoteId as number;
    const rebuilt = await engine.buildQuoteForSession(result.sessionId, { force: true });

    assert.notEqual(rebuilt.quote.id, firstId);
    assert.equal((await engine.listQuotes(10)).length, 2);
    assert.equal(rebuilt.quote.margin_percent, 30);
    assert.equal((await engine.getQuote(firstId))?.quote.status, 'superseded');
    assert.equal(rebuilt.quote.status, 'pending_approval');
  });

  it('logs a failure and sends the reply when the service has no price table', async () => {
    const { engine } = await createEngine();
    const result = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'quote-user-5',
      text: 'Company: Epsilon; Size: 12 people; Tools: Sheets; Service: WhatsApp Agent Services',
    });

    assert.equal(result.intent, 'intake');
    assert.equal(result.data?.quoteId, undefined);
    assert.equal((await engine.listQuotes(10)).length, 0);
    assert.ok((await engine.listLogs(20)).some((log) => log.event === 'quote.failed'));
    assert.match(result.reply, /pricing team/i);
  });
});
