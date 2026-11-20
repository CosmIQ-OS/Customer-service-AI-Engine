import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import { MockLLMProvider } from '../llm/mock.js';
import { SupportEngine } from './support-engine.js';

const databases: DB[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

async function createEngine(): Promise<SupportEngine> {
  const db = await openDatabase(':memory:');
  databases.push(db);
  return new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
    conversationIdleMinutes: 60,
  });
}

describe('live conversations', () => {
  it('answers with the AI while the conversation is owned by the AI', async () => {
    const engine = await createEngine();
    await engine.createService({
      name: 'Live Chat Support',
      description: 'Real-time assistance',
      category: 'support',
      status: 'available',
      availability_note: 'Mon-Fri',
    });

    const result = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-1',
      text: 'What services are available?',
    });

    assert.equal(result.intent, 'services');
    assert.ok(result.reply.length > 0);
    assert.equal((await engine.getConversation(result.sessionId))?.mode, 'ai');
  });

  it('holds customer messages once a human takes over', async () => {
    const engine = await createEngine();
    const first = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-2',
      text: 'What services are available?',
    });

    await engine.takeOverConversation(first.sessionId, null, 'Owner');
    assert.equal((await engine.getConversation(first.sessionId))?.mode, 'human');

    const second = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-2',
      text: 'Are you still there?',
    });

    assert.equal(second.intent, 'awaiting_human');
    assert.equal(second.reply, '');
    const conversation = (await engine.getConversation(first.sessionId))!;
    assert.equal(conversation.unread_count, 1);
  });

  it('stores an admin reply as a human message and clears the unread count', async () => {
    const engine = await createEngine();
    const first = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-3',
      text: 'Hello, I need help.',
    });
    await engine.takeOverConversation(first.sessionId, null, 'Owner');
    await engine.handleMessage({ channel: 'web', externalUserId: 'customer-3', text: 'Still there?' });

    const result = await engine.sendAdminReply(first.sessionId, 7, 'Yes, a specialist is with you now.');
    assert.equal(result.delivered, false); // no adapter registered in the unit test
    assert.equal((await engine.getConversation(first.sessionId))?.unread_count, 0);

    const roles = (await engine.listMessages(first.sessionId)).map((message) => message.role);
    assert.deepEqual(roles, ['user', 'assistant', 'user', 'human']);
  });

  it('hands the conversation back to the AI', async () => {
    const engine = await createEngine();
    const first = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-4',
      text: 'Hello.',
    });
    await engine.takeOverConversation(first.sessionId, null, 'Owner');
    await engine.handBackConversation(first.sessionId, 7);

    assert.equal((await engine.getConversation(first.sessionId))?.mode, 'ai');
    const second = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-4',
      text: 'What services are available?',
    });
    assert.notEqual(second.intent, 'awaiting_human');
  });

  it('closes conversations that a human left idle', async () => {
    const engine = await createEngine();
    const first = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-5',
      text: 'Hello.',
    });
    await engine.takeOverConversation(first.sessionId, null, 'Owner');

    await engine.db.query("UPDATE conversations SET idle_deadline_at = '2000-01-01 00:00:00' WHERE session_id = $1", [
      first.sessionId,
    ]);

    const closed = await engine.closeIdleConversations();
    assert.equal(closed.length, 1);
    const conversation = (await engine.getConversation(first.sessionId))!;
    assert.equal(conversation.status, 'closed');
    assert.equal(conversation.mode, 'ai');
    assert.match(conversation.closed_reason, /idle/);
  });

  it('lists conversations that need a human', async () => {
    const engine = await createEngine();
    const first = await engine.handleMessage({
      channel: 'web',
      externalUserId: 'customer-6',
      text: 'Hello.',
    });
    await engine.takeOverConversation(first.sessionId, null, 'Owner');
    await engine.handleMessage({ channel: 'web', externalUserId: 'customer-6', text: 'One more thing.' });

    const waiting = await engine.listConversationsNeedingHuman();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].sessionId, first.sessionId);
    assert.equal(waiting[0].unreadCount, 1);
    assert.equal(waiting[0].assignedAgentName, 'Owner');
  });
});
