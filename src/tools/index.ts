import { ToolRegistry } from '../kernel/tool-registry.js';
import { listServicesTool } from './services.js';
import { searchFaqTool } from './faqs.js';
import { createSupportRequestTool } from './requests.js';
import { getCustomerProfileTool } from './profile.js';
import { escalateToHumanTool } from './escalation.js';

export function createSupportTools(): ToolRegistry {
  return new ToolRegistry()
    .register(listServicesTool)
    .register(searchFaqTool)
    .register(createSupportRequestTool)
    .register(getCustomerProfileTool)
    .register(escalateToHumanTool);
}
