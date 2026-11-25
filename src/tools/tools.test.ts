import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openDatabase, type DB } from '../db/database.js';
import * as servicesRepo from '../db/repositories/services.js';
import * as faqsRepo from '../db/repositories/faqs.js';
import { createSupportTools } from './index.js';
import type { ToolContext } from '../kernel/tool-registry.js';

const databases: DB[] = [];

afterEach(async () => {
  while (databases.length) await databases.pop()?.close();
});

function makeContext(db: DB): ToolContext {
  return {
    db,
    channel: 'web',
    externalUserId: 'user-1',
    tenantId: 'test',
    session: {
      id: 'tool-test-session',
      channel: 'web',
      external_user_id: 'user-1',
      status: 'active',
      last_intent: 'assistant',
      context: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    },
  };
}

describe('createSupportTools', () => {
  it('registers all 7 core support tools', () => {
    const registry = createSupportTools();
    const names = registry.definitions().map((def) => def.name).sort();
    assert.deepEqual(names, [
      'create_support_request',
      'escalate_to_human',
      'get_customer_profile',
      'get_intake',
      'list_services',
      'save_intake',
      'search_faq',
    ]);
  });

  it('executes list_services and search_faq against the database', async () => {
    const db = await openDatabase(':memory:');
    databases.push(db);
    await servicesRepo.createService(db, {
      name: 'Workflow Automation',
      description: 'Connects CRM and Slack',
      category: 'workflow',
      status: 'available',
      availability_note: '',
      base_price_paise: 500_000,
    });
    await faqsRepo.createFaq(db, {
      question: 'What is the deployment timeline?',
      answer: 'Usually 1 to 2 weeks.',
      tags: ['timeline'],
    });

    const registry = createSupportTools();
    const ctx = makeContext(db);

    const servicesResult = await registry.get('list_services')!.execute({}, ctx);
    assert.match(servicesResult.observation, /Workflow Automation/);

    const faqResult = await registry.get('search_faq')!.execute({ query: 'timeline' }, ctx);
    assert.match(faqResult.observation, /1 to 2 weeks/);
  });
});
