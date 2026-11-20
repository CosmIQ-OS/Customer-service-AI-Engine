import { z } from 'zod';
import { createRequest } from '../db/repositories/requests.js';
import type { Tool } from '../kernel/tool-registry.js';

export const createSupportRequestTool: Tool = {
  name: 'create_support_request',
  description: 'Log a customer issue or unanswered question for support follow-up. Returns the real request ID.',
  schema: z.object({
    body: z.string().min(1),
    subject: z.string().min(1).default('Customer support request'),
    kind: z.string().min(1).default('support'),
  }),
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The customer issue, including relevant details' },
      subject: { type: 'string' },
      kind: { type: 'string', description: 'Usually support, faq_miss, or inquiry' },
    },
    required: ['body'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const request = await createRequest(context.db, {
      channel: context.channel,
      external_user_id: context.externalUserId,
      session_id: context.session.id,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      status: 'open',
      metadata: { source: 'agent_tool' },
    });
    return {
      result: { requestId: request.id },
      observation: `Support request #${request.id} is now logged. The support team will follow up.`,
    };
  },
};
