import { z } from 'zod';
import { createRequest } from '../db/repositories/requests.js';
import type { Tool } from '../kernel/tool-registry.js';

export const escalateToHumanTool: Tool = {
  name: 'escalate_to_human',
  description: 'Escalate the conversation to a human support agent when requested or when the issue cannot be resolved safely.',
  schema: z.object({
    reason: z.string().min(1),
    subject: z.string().min(1).default('Human support requested'),
  }),
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why human support is needed' },
      subject: { type: 'string' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  execute(input, context) {
    const request = createRequest(context.db, {
      channel: context.channel,
      external_user_id: context.externalUserId,
      session_id: context.session.id,
      kind: 'escalation',
      subject: input.subject,
      body: input.reason,
      status: 'open',
      metadata: { source: 'agent_tool', handoff: true },
    });
    return {
      result: { requestId: request.id, handoff: true },
      observation: `Escalation #${request.id} is now logged. A human agent will take over; no response time has been promised.`,
    };
  },
};
