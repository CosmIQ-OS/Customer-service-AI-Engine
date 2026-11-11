import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MessageRecord } from '../engine/types.js';
import type { IntakeRecord } from '../intake/intake.js';
import type { PriceItemRecord } from '../db/repositories/pricing.js';
import type { ChatReply, ChatRequest, LLMProvider } from '../llm/types.js';
import { PricingAgent } from './pricing-agent.js';

class QueueLLM implements LLMProvider {
  calls = 0;
  private readonly queue: string[];
  constructor(...responses: string[]) {
    this.queue = responses;
  }
  async chat(_request: ChatRequest): Promise<ChatReply> {
    this.calls += 1;
    return {
      message: { role: 'assistant', content: this.queue.shift() ?? '' },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

const intake: IntakeRecord = {
  id: 1,
  session_id: 'session-1',
  channel: 'telegram',
  external_user_id: 'user-1',
  company_name: 'Acme',
  company_size: '20 employees',
  current_tools: 'Slack',
  service_id: 10,
  service_name: 'Workflow Automation',
  language: 'en',
  status: 'complete',
  tenant_id: 'test',
  created_at: '',
  updated_at: '',
};

const history: MessageRecord[] = [{
  id: 1,
  session_id: 'session-1',
  channel: 'telegram',
  external_user_id: 'user-1',
  role: 'user',
  content: 'We need a discovery workshop for our workflow.',
  tokens: 0,
  tenant_id: 'test',
  created_at: '',
}];

const items: PriceItemRecord[] = [
  {
    id: 1,
    price_table_id: 5,
    item_code: 'WF-1',
    description: 'Discovery workshop',
    unit: 'day',
    unit_price_paise: 100_000,
    sort_order: 1,
  },
  {
    id: 2,
    price_table_id: 5,
    item_code: 'WF-2',
    description: 'Automation build',
    unit: 'project',
    unit_price_paise: 500_000,
    sort_order: 2,
  },
];

function agent(...responses: string[]) {
  const llm = new QueueLLM(...responses);
  return { llm, agent: new PricingAgent(llm, 'pricing-model') };
}

describe('PricingAgent', () => {
  it('maps selected item codes to real price-table items', async () => {
    const { agent: pricing } = agent(JSON.stringify({
      items: [{ item_code: 'wf-1', quantity: 2, reason: 'Needed for discovery' }],
      notes: 'One workshop.',
    }));
    const selection = await pricing.select({ intake, history, items });
    assert.equal(selection.items.length, 1);
    assert.equal(selection.items[0].item.id, 1);
    assert.equal(selection.items[0].quantity, 2);
    assert.equal(selection.notes, 'One workshop.');
  });

  it('accepts JSON wrapped in a markdown fence and drops duplicate codes', async () => {
    const { agent: pricing } = agent('```json\n' + JSON.stringify({
      items: [
        { item_code: 'WF-1', quantity: 1 },
        { item_code: 'WF-1', quantity: 3 },
        { item_code: 'WF-2', quantity: 1.5 },
      ],
    }) + '\n```');
    const selection = await pricing.select({ intake, history, items });
    assert.deepEqual(selection.items.map((entry) => [entry.item.item_code, entry.quantity]), [
      ['WF-1', 1],
      ['WF-2', 1.5],
    ]);
  });

  it('rejects item codes that are not in the active price table', async () => {
    const { llm, agent: pricing } = agent(
      JSON.stringify({ items: [{ item_code: 'MADE-UP', quantity: 1 }] }),
      JSON.stringify({ items: [{ item_code: 'ALSO-MADE-UP', quantity: 1 }] }),
    );
    await assert.rejects(pricing.select({ intake, history, items }), /not in the active price table/);
    assert.equal(llm.calls, 2);
  });

  it('retries once when the model returns malformed output', async () => {
    const { llm, agent: pricing } = agent(
      'I think it will cost 5000.',
      JSON.stringify({ items: [{ item_code: 'WF-2', quantity: 1 }] }),
    );
    const selection = await pricing.select({ intake, history, items });
    assert.equal(selection.items[0].item.item_code, 'WF-2');
    assert.equal(llm.calls, 2);
  });

  it('fails after two invalid responses instead of inventing a quote', async () => {
    const { llm, agent: pricing } = agent('not json', 'still not json');
    await assert.rejects(pricing.select({ intake, history, items }), /valid JSON/);
    assert.equal(llm.calls, 2);
  });
});
