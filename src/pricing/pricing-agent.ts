import { z } from 'zod';
import type { MessageRecord } from '../engine/types.js';
import type { IntakeRecord } from '../intake/intake.js';
import type { PriceItemRecord } from '../db/repositories/pricing.js';
import type { ChatMessage, LLMProvider } from '../llm/types.js';
import { PRICING_SYSTEM_PROMPT } from '../llm/prompts.js';

const selectionSchema = z.object({
  items: z.array(z.object({
    item_code: z.string().min(1).max(64),
    quantity: z.number().positive().max(100_000),
    reason: z.string().max(300).optional().default(''),
  })).min(1),
  notes: z.string().max(1000).optional().default(''),
});

export interface PricingSelectionItem {
  item: PriceItemRecord;
  quantity: number;
  reason: string;
}

export interface PricingSelection {
  items: PricingSelectionItem[];
  notes: string;
}

/** A stronger model selects quote lines from the admin price table. Prices come only from that table. */
export class PricingAgent {
  constructor(private readonly llm: LLMProvider, private readonly model: string) {}

  async select(input: {
    intake: IntakeRecord;
    history: MessageRecord[];
    items: PriceItemRecord[];
  }): Promise<PricingSelection> {
    if (input.items.length === 0) throw new Error('The active price table has no items.');

    const messages: ChatMessage[] = [
      { role: 'system', content: PRICING_SYSTEM_PROMPT },
      { role: 'user', content: buildRequest(input) },
    ];

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.llm.chat({
        model: this.model,
        messages,
        temperature: 0,
      });
      const content = response.message.content;
      try {
        return parseSelection(content, input.items);
      } catch (error) {
        lastError = error;
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content:
            'That response was invalid. Return JSON only, using only item_code values from the price table, with at least one positive quantity.',
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error('The pricing agent could not prepare a quote.');
  }
}

function buildRequest(input: {
  intake: IntakeRecord;
  history: MessageRecord[];
  items: PriceItemRecord[];
}): string {
  const conversation = input.history
    .slice(-20)
    .map((message) => {
      const speaker = message.role === 'assistant' ? 'agent' : message.role === 'human' ? 'human staff' : 'customer';
      return `${speaker}: ${message.content.replace(/\s+/g, ' ').slice(0, 500)}`;
    })
    .join('\n');
  const catalog = input.items
    .map((item) => [item.item_code, item.description, item.unit, (item.unit_price_paise / 100).toFixed(2)].join('\t'))
    .join('\n');

  return [
    `Service: ${input.intake.service_name}`,
    `Company: ${input.intake.company_name}`,
    `Company size: ${input.intake.company_size}`,
    `Current tools: ${input.intake.current_tools}`,
    '',
    'Customer conversation:',
    conversation,
    '',
    'Available price table (tab separated: item_code, description, unit, admin unit price INR):',
    'item_code\tdescription\tunit\tadmin_unit_price_inr',
    catalog,
    '',
    'Return the JSON quote selection now.',
  ].join('\n');
}

/** Accepts plain JSON or JSON wrapped in a markdown fence. */
function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const candidates = [trimmed];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('The pricing agent did not return valid JSON.');
}

function parseSelection(content: string, items: PriceItemRecord[]): PricingSelection {
  const parsed = selectionSchema.parse(extractJson(content));
  const byCode = new Map(items.map((item) => [item.item_code.trim().toLowerCase(), item]));
  const seen = new Set<number>();
  const selected: PricingSelectionItem[] = [];

  for (const entry of parsed.items) {
    const item = byCode.get(entry.item_code.trim().toLowerCase());
    if (!item) {
      throw new Error(`The pricing agent selected an item that is not in the active price table: ${entry.item_code}`);
    }
    if (seen.has(item.id)) continue;
    const quantity = Math.round(entry.quantity * 1000) / 1000;
    if (quantity <= 0) throw new Error(`Invalid quantity for ${item.item_code}.`);
    seen.add(item.id);
    selected.push({ item, quantity, reason: entry.reason ?? '' });
  }

  if (selected.length === 0) throw new Error('The pricing agent did not select any valid items.');
  return { items: selected, notes: parsed.notes ?? '' };
}
