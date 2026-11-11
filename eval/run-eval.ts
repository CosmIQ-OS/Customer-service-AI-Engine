import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { publishPriceTable } from '../src/db/repositories/pricing.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import { SupportEngine } from '../src/engine/support-engine.js';

interface Expectation {
  intent?: string;
  replyMatches?: string;
  hasRequestId?: boolean;
  nonEmptyReply?: boolean;
  quoteCreated?: boolean;
  quoteMinTotalPaise?: number;
}

interface GoldenCase {
  id: string;
  channel: string;
  externalUserId: string;
  text: string;
  expect: Expectation;
}

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(resolve(here, 'golden-conversations.json'), 'utf8'),
) as GoldenCase[];

function createEngine(): SupportEngine {
  const db = openDatabase(':memory:');
  const engine = new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'eval',
  });
  const liveChat = engine.createService({
    name: 'Live Chat Support',
    description: 'Real-time assistance for account and product questions.',
    category: 'support',
    status: 'available',
    availability_note: 'Mon-Fri 09:00-18:00',
  });
  publishPriceTable(db, {
    serviceId: liveChat.id,
    sourceFilename: 'eval-live-chat.csv',
    uploadedBy: null,
    items: [
      { item_code: 'LC-SETUP', description: 'Live Chat Support setup', unit: 'project', unit_price_paise: 1_000_000 },
      { item_code: 'LC-HOUR', description: 'Live Chat Support hourly support', unit: 'hour', unit_price_paise: 100_000 },
    ],
  });
  engine.createFaq({
    question: 'What is your refund policy?',
    answer: 'Refunds are issued within 14 days of request.',
    tags: ['refund', 'policy'],
  });
  return engine;
}

let passed = 0;
const failures: string[] = [];

for (const c of cases) {
  const engine = createEngine();
  const result = await engine.handleMessage({
    channel: c.channel as never,
    externalUserId: c.externalUserId,
    text: c.text,
  });

  const problems: string[] = [];
  if (c.expect.intent && result.intent !== c.expect.intent) {
    problems.push(`intent ${result.intent} != ${c.expect.intent}`);
  }
  if (c.expect.replyMatches && !result.reply.includes(c.expect.replyMatches)) {
    problems.push(`reply missing "${c.expect.replyMatches}"`);
  }
  if (c.expect.hasRequestId && typeof result.requestId !== 'number') {
    problems.push('missing requestId');
  }
  if (c.expect.nonEmptyReply && !result.reply.trim()) {
    problems.push('empty reply');
  }
  if (c.expect.quoteCreated) {
    const quoteId = result.data?.quoteId;
    if (typeof quoteId !== 'number') {
      problems.push('missing quoteId');
    } else if (c.expect.quoteMinTotalPaise !== undefined) {
      const found = engine.getQuote(quoteId);
      if (!found) problems.push('quote not found');
      else if (found.quote.total_paise < c.expect.quoteMinTotalPaise) {
        problems.push(`quote total ${found.quote.total_paise} below ${c.expect.quoteMinTotalPaise}`);
      }
    }
  }

  if (problems.length === 0) {
    passed += 1;
    console.log(`PASS  ${c.id}  (intent=${result.intent})`);
  } else {
    failures.push(`${c.id}: ${problems.join('; ')}`);
    console.log(`FAIL  ${c.id}  -> ${problems.join('; ')}`);
  }
}

console.log(`\n${passed}/${cases.length} golden conversations passed`);
if (failures.length) {
  console.log('Failures:\n- ' + failures.join('\n- '));
  process.exit(1);
}
