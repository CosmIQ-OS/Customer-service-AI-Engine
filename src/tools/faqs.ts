import { z } from 'zod';
import { findFaqAnswer } from '../db/repositories/faqs.js';
import type { Tool } from '../kernel/tool-registry.js';

export const searchFaqTool: Tool = {
  name: 'search_faq',
  description: 'Search enabled business FAQs. Use this for policy, hours, and how-to questions.',
  schema: z.object({ query: z.string().min(1) }),
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The customer question or search terms' } },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const faq = await findFaqAnswer(context.db, input.query);
    return {
      result: { faq: faq ?? null },
      observation: faq
        ? `FAQ answer: ${faq.answer}`
        : 'NO_MATCH: No FAQ answer was found. Create a support request if the customer needs an answer; do not invent one.',
    };
  },
};
