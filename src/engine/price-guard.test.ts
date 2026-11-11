import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import type { ChatReply, ChatRequest, LLMProvider } from '../llm/types.js';
import { PRICE_HOLDING_MESSAGE, containsPrice, guardPrice } from './price-guard.js';
import { SupportEngine } from './support-engine.js';

const databases: DB[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

class FixedLLM implements LLMProvider {
  constructor(private readonly content: string) {}
  async chat(_request: ChatRequest): Promise<ChatReply> {
    return {
      message: { role: 'assistant', content: this.content },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

function createEngine(content: string): SupportEngine {
  const db = openDatabase(':memory:');
  databases.push(db);
  return new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new FixedLLM(content),
    model: 'fixed',
    maxSteps: 2,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'test',
  });
}

describe('price guard', () => {
  it('detects explicit currency and price-with-amount replies', () => {
    assert.equal(containsPrice('The setup will cost ₹50,000.'), true);
    assert.equal(containsPrice('The price is 50000.'), true);
    assert.equal(containsPrice('A retainer of 25,000 per month.'), true);
    assert.equal(containsPrice('Total: 45000 INR'), true);
    assert.equal(containsPrice('We can deliver in 3 weeks.'), false);
    assert.equal(containsPrice('Company size: 120 employees'), false);
  });

  it('does not flag price-free holding language', () => {
    assert.equal(containsPrice('Our pricing team will prepare a quote and it will be reviewed before it is shared with you.'), false);
    assert.equal(containsPrice('The amount will be shared within 2 days.'), false);
    assert.deepEqual(guardPrice('Thanks, I have your details.'), { reply: 'Thanks, I have your details.', blocked: false });
  });

  it('replaces a price-bearing reply and records the block', async () => {
    const engine = createEngine('That will cost ₹50,000 for the setup.');
    const result = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'price-user',
      text: 'How much does it cost?',
    });

    assert.equal(result.reply, PRICE_HOLDING_MESSAGE);
    assert.equal(result.data?.priceBlocked, true);
    assert.equal(engine.listLogs(10).some((log) => log.event === 'price.blocked'), true);
  });

  it('leaves a price-free reply untouched', async () => {
    const content = 'Our pricing team will prepare a quote and it will be reviewed before it is shared with you.';
    const engine = createEngine(content);
    const result = await engine.handleMessage({
      channel: 'telegram',
      externalUserId: 'safe-user',
      text: 'How much does it cost?',
    });

    assert.equal(result.reply, content);
    assert.equal(result.data?.priceBlocked, false);
    assert.equal(engine.listLogs(10).some((log) => log.event === 'price.blocked'), false);
  });
});
