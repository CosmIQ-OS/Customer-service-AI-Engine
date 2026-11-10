import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { MockLLMProvider } from '../llm/mock.js';
import { SupportEngine } from './support-engine.js';

const databases: DB[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function createEngine(): SupportEngine {
  const db = openDatabase(':memory:');
  databases.push(db);
  return new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
  });
}

describe('SupportEngine agent loop', () => {
  it('uses the services tool and persists transcript and trace', async () => {
    const engine = createEngine();
    engine.createService({
      name: 'Live Chat Support',
      description: 'Real-time assistance',
      category: 'support',
      status: 'available',
      availability_note: 'Mon-Fri 09:00-18:00',
    });

    const result = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-1',
      text: 'What services are available?',
    });

    assert.equal(result.intent, 'services');
    assert.match(result.reply, /Live Chat Support: available/);
    const calls = result.data?.toolCalls as Array<Record<string, unknown>>;
    assert.equal(calls[0].name, 'list_services');

    const messages = engine.listMessages(result.sessionId);
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
    const traces = engine.listTraces();
    assert.equal(traces.length, 1);
    assert.equal(traces[0].steps, 2);
    assert.equal(traces[0].tool_calls[0].name, 'list_services');
  });

  it('creates a real support request through the tool', async () => {
    const engine = createEngine();
    const result = await engine.handleMessage({
      channel: 'whatsapp',
      externalUserId: 'customer-2',
      text: 'I have a problem with my invoice',
    });

    assert.equal(result.intent, 'support_request');
    assert.equal(typeof result.requestId, 'number');
    assert.match(result.reply, new RegExp(`#${result.requestId}`));
    assert.equal(engine.listRequests().length, 1);
    assert.equal(engine.listRequests()[0].external_user_id, 'customer-2');
  });

  it('feeds prior turns back into the next conversation', async () => {
    const engine = createEngine();
    const first = await engine.handleMessage({ channel: 'web', externalUserId: 'customer-3', text: 'Hello' });
    const second = await engine.handleMessage({ channel: 'web', externalUserId: 'customer-3', text: 'Hello again' });

    assert.equal(first.sessionId, second.sessionId);
    const messages = engine.listMessages(first.sessionId);
    assert.deepEqual(messages.map((message) => message.content), ['Hello', first.reply, 'Hello again', second.reply]);
  });
});
