import { z } from 'zod';
import { emptyParameters, type Tool } from '../kernel/tool-registry.js';

export const getCustomerProfileTool: Tool = {
  name: 'get_customer_profile',
  description: 'Read known customer and session context. Use when personalization or prior context is needed.',
  schema: z.object({}),
  parameters: emptyParameters,
  execute(_input, context) {
    const profile = {
      externalUserId: context.externalUserId,
      channel: context.channel,
      lastIntent: context.session.last_intent,
      context: context.session.context,
    };
    return {
      result: profile,
      observation: `Known customer context: ${JSON.stringify(profile)}`,
    };
  },
};
