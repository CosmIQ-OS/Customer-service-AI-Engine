import { z } from 'zod';
import { listServices } from '../db/repositories/services.js';
import { emptyParameters, type Tool } from '../kernel/tool-registry.js';

export const listServicesTool: Tool = {
  name: 'list_services',
  description: 'Get the current service catalog and real availability status. Use this before answering availability questions.',
  schema: z.object({}),
  parameters: emptyParameters,
  execute(_input, context) {
    const services = listServices(context.db);
    return {
      result: { services },
      observation: services.length === 0
        ? 'No services are currently configured.'
        : services.map((service) =>
          `${service.name}: ${service.status}${service.availability_note ? ` — ${service.availability_note}` : ''}`,
        ).join('\n'),
    };
  },
};
