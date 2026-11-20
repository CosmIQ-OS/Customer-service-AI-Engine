import { z } from 'zod';
import { listServices } from '../db/repositories/services.js';
import { getIntake, upsertIntake } from '../db/repositories/intake.js';
import { isIntakeComplete, missingIntakeFields, type IntakeRecord } from '../intake/intake.js';
import type { Tool } from '../kernel/tool-registry.js';

const intakeSchema = z.object({
  company_name: z.string().max(200).optional(),
  company_size: z.string().max(100).optional(),
  current_tools: z.string().max(500).optional(),
  service_name: z.string().max(200).optional(),
  service_id: z.number().int().positive().optional(),
  language: z.string().max(35).optional(),
});

const FIELD_LABELS = {
  company_name: 'company name',
  company_size: 'company size',
  current_tools: 'current tools',
  service_name: 'service wanted',
} as const;

export const saveIntakeTool: Tool<typeof intakeSchema> = {
  name: 'save_intake',
  description:
    'Save what the customer has shared about their company and the service they want. ' +
    'Call this every time the customer provides a company name, company size, current tools, or the service they want. ' +
    'Never invent values and never include prices.',
  schema: intakeSchema,
  parameters: {
    type: 'object',
    properties: {
      company_name: { type: 'string', description: "The customer's company name, as they wrote it." },
      company_size: { type: 'string', description: 'Company size, such as "120 employees" or "about 40".' },
      current_tools: { type: 'string', description: 'Tools the team currently uses, such as "Slack, Notion, Google Sheets".' },
      service_name: { type: 'string', description: 'The Cosmiq service the customer wants, from the service catalog.' },
      service_id: { type: 'integer', description: 'Catalog id of the service they want, when known.' },
      language: { type: 'string', description: 'ISO language code the customer writes in, such as "en" or "hi".' },
    },
    additionalProperties: false,
  },
  async execute(input, context) {
    let serviceId = input.service_id ?? null;
    let serviceName = input.service_name?.trim() ?? '';
    const services = await listServices(context.db);
    if (serviceId !== null && !services.some((service) => service.id === serviceId)) {
      serviceId = null;
    }
    if (serviceId === null && serviceName) {
      const match = matchService(services, serviceName);
      if (match) {
        serviceId = match.id;
        serviceName = match.name;
      }
    } else if (serviceId !== null) {
      serviceName = services.find((service) => service.id === serviceId)!.name;
    }

    const intake = await upsertIntake(context.db, {
      sessionId: context.session.id,
      channel: context.channel,
      externalUserId: context.externalUserId,
      tenantId: context.tenantId,
      patch: {
        company_name: input.company_name,
        company_size: input.company_size,
        current_tools: input.current_tools,
        service_name: serviceName || undefined,
        service_id: input.service_name !== undefined || input.service_id !== undefined ? serviceId : undefined,
        language: input.language ?? (typeof context.session.context.language === 'string' ? context.session.context.language : undefined),
      },
    });

    const missing = missingIntakeFields(intake);
    const serviceNote = intake.service_name && intake.service_id === null
      ? ' The requested service is not in the catalog; use list_services to offer the services that are available.'
      : '';
    return {
      result: { intake, missingFields: missing, complete: isIntakeComplete(intake) },
      observation: `${describeIntake(intake)}${serviceNote}`,
    };
  },
};

export const getIntakeTool: Tool = {
  name: 'get_intake',
  description:
    'Read the intake details already collected for this customer: company name, company size, current tools, and service wanted. ' +
    'Use this before asking the customer to repeat themselves.',
  schema: z.object({}),
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_input, context) {
    const intake = await getIntake(context.db, context.session.id);
    if (!intake) {
      return {
        result: { intake: null, missingFields: missingIntakeFields(emptyIntake) },
        observation:
          'No intake details have been collected for this customer yet. Ask for the company name, company size, current tools, and the service they want, one or two questions at a time.',
      };
    }
    const missing = missingIntakeFields(intake);
    return {
      result: { intake, missingFields: missing, complete: isIntakeComplete(intake) },
      observation: describeIntake(intake),
    };
  },
};

const emptyIntake = { company_name: '', company_size: '', current_tools: '', service_name: '' };

function describeIntake(intake: IntakeRecord): string {
  const known = [
    `company name: ${intake.company_name || 'not provided'}`,
    `company size: ${intake.company_size || 'not provided'}`,
    `current tools: ${intake.current_tools || 'not provided'}`,
    `service wanted: ${intake.service_name || 'not provided'}`,
  ].join('; ');
  const missing = missingIntakeFields(intake);
  const nextStep = missing.length === 0
    ? 'The intake is complete. Tell the customer the pricing team will prepare a quote and that it is reviewed before being shared, and do not state any price.'
    : `Ask only for the missing fields (${missing.map((field) => FIELD_LABELS[field]).join(', ')}), one or two at a time. Do not state any price.`;
  return `Intake saved for this session. Known: ${known}. Missing fields: ${missing.length ? missing.join(', ') : 'none'}. ${nextStep}`;
}

function matchService(
  services: Array<{ id: number; name: string }>,
  wanted: string,
): { id: number; name: string } | undefined {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return undefined;
  return services.find((service) => service.name.toLowerCase() === needle)
    ?? services.find((service) => {
      const name = service.name.toLowerCase();
      return name.includes(needle) || needle.includes(name);
    });
}
