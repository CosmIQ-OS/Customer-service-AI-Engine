import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { MockLLMProvider } from '../llm/mock.js';
import { saveIntakeTool } from '../tools/intake.js';
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
  });
  const workflow = await engine.createService({
    name: 'Workflow Automation',
    description: 'End-to-end business workflows.',
    category: 'workflow',
    status: 'available',
    availability_note: '',
  });
  return { engine, workflow };
}

function toolResults(result: Awaited<ReturnType<SupportEngine['handleMessage']>>) {
  const calls = (result.data?.toolCalls ?? []) as Array<{ name: string; result?: any }>;
  return calls;
}

describe('intake flow', () => {
  it('collects intake across turns, resolves the service, and never states a price', async () => {
    const { engine, workflow } = await createEngine();

    const first = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'intake-user-1',
      text: 'Company: Acme Robotics; Size: 120 employees',
    });
    assert.equal(first.intent, 'intake');
    assert.match(first.reply, /tools/i);
    assert.match(first.reply, /service/i);

    let intake = await engine.getIntake(first.sessionId);
    assert.ok(intake);
    assert.equal(intake.company_name, 'Acme Robotics');
    assert.equal(intake.company_size, '120 employees');
    assert.equal(intake.status, 'collecting');
    assert.equal(intake.service_id, null);

    const second = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'intake-user-1',
      text: 'Tools: Slack and Notion; Service: Workflow Automation',
    });
    assert.equal(second.intent, 'intake');
    assert.equal(second.sessionId, first.sessionId);

    intake = await engine.getIntake(first.sessionId);
    assert.ok(intake);
    assert.equal(intake.current_tools, 'Slack and Notion');
    assert.equal(intake.service_id, workflow.id);
    assert.equal(intake.service_name, 'Workflow Automation');
    assert.equal(intake.status, 'collected');
    assert.doesNotMatch(second.reply, /₹|INR|\bprice\b/i);

    const listed = (await engine.listIntakes(10)).find((record) => record.session_id === first.sessionId);
    assert.equal(listed?.status, 'collected');
  });

  it('recalls saved intake details instead of asking again', async () => {
    const { engine } = await createEngine();
    const saved = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'intake-user-2',
      text: 'Company: Beta Labs; Size: 25 people; Tools: Excel; Service: Workflow Automation',
    });
    assert.equal((await engine.getIntake(saved.sessionId))?.status, 'collected');

    const recall = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'intake-user-2',
      text: 'What do you know about my company?',
    });
    assert.equal(recall.intent, 'intake');
    const call = toolResults(recall).find((entry) => entry.name === 'get_intake');
    assert.ok(call, 'should call get_intake');
    assert.equal(call.result?.intake?.company_name, 'Beta Labs');
  });

  it('stores the detected language on the session and answers in it', async () => {
    const { engine } = await createEngine();
    const result = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'hindi-user',
      text: 'नमस्ते, मुझे मदद चाहिए',
    });
    assert.equal(result.intent, 'assistant');
    assert.match(result.reply, /[\u0900-\u097F]/);

    const session = engine.sessions.snapshot().find((record) => record.external_user_id === 'hindi-user');
    assert.equal(session?.context.language, 'hi');
    assert.equal(session?.context.languageLabel, 'Hindi');
  });

  it('matches a partial service name and flags a service outside the catalog', async () => {
    const { engine, workflow } = await createEngine();
    await engine.handleMessage({
      channel: 'web',
      externalUserId: 'intake-user-3',
      text: 'Company: Gamma; Size: 8 people; Tools: Sheets',
    });
    const session = engine.sessions.snapshot().find((record) => record.external_user_id === 'intake-user-3')!;
    const context = {
      db: engine.db,
      session,
      channel: session.channel,
      externalUserId: session.external_user_id,
      tenantId: 'test',
    };

    const matched = await saveIntakeTool.execute({ service_name: 'workflow' }, context);
    assert.equal((matched.result as any).intake.service_id, workflow.id);
    assert.equal((matched.result as any).intake.service_name, 'Workflow Automation');

    const unknown = await saveIntakeTool.execute({ service_name: 'Underwater Basket Weaving' }, context);
    assert.equal((unknown.result as any).intake.service_id, null);
    assert.match(unknown.observation, /not in the catalog/);
  });

  it('returns no intake before the customer has shared anything', async () => {
    const { engine } = await createEngine();
    const result = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'intake-user-4',
      text: 'Hello',
    });
    assert.equal(await engine.getIntake(result.sessionId), undefined);
  });
});
