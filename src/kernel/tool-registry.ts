import type { z } from 'zod';
import type { DB } from '../db/database.js';
import type { SessionRecord } from '../engine/types.js';
import type { ToolDefinition } from '../llm/types.js';

export interface ToolContext {
  db: DB;
  session: SessionRecord;
  channel: string;
  externalUserId: string;
  tenantId: string;
}

export interface ToolResult {
  result: unknown;
  observation: string;
}

export interface Tool<S extends z.ZodType<any, any> = z.ZodType<any, any>> {
  name: string;
  description: string;
  schema: S;
  parameters: Record<string, unknown>;
  execute(input: z.infer<S>, context: ToolContext): Promise<ToolResult> | ToolResult;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), ({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }
}

export const emptyParameters: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
