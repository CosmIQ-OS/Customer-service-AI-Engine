import type { DB } from '../db/database.js';
import type { LLMProvider, TokenUsage, ToolCall } from '../llm/types.js';
import type { MessageRecord, SessionRecord } from '../engine/types.js';
import { buildAgentMessages } from './context.js';
import type { ToolRegistry } from './tool-registry.js';

export interface AgentLoopOptions {
  db: DB;
  llm: LLMProvider;
  tools: ToolRegistry;
  model: string;
  maxSteps: number;
  temperature: number;
}

export interface ExecutedToolCall extends ToolCall {
  result?: unknown;
  observation: string;
}

export interface AgentRunResult {
  reply: string;
  steps: number;
  toolCalls: ExecutedToolCall[];
  usage: TokenUsage;
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(input: {
    session: SessionRecord;
    history: MessageRecord[];
    tenantId: string;
  }): Promise<AgentRunResult> {
    const { db, llm, tools, model, maxSteps, temperature } = this.options;
    const messages = buildAgentMessages(input.session, input.history);
    const toolCalls: ExecutedToolCall[] = [];
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let step = 1; step <= maxSteps; step += 1) {
      const response = await llm.chat({
        model,
        messages,
        tools: tools.definitions(),
        temperature,
      });
      addUsage(usage, response.usage);

      const calls = response.message.toolCalls ?? [];
      if (calls.length === 0) {
        const reply = response.message.content.trim();
        if (reply) return { reply, steps: step, toolCalls, usage };
        throw new Error('LLM returned an empty response');
      }

      messages.push({
        role: 'assistant',
        content: response.message.content,
        toolCalls: calls,
        extraContent: response.message.extraContent,
      });
      for (const call of calls) {
        const executed = await this.executeTool(call, input);
        toolCalls.push(executed);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: executed.observation,
        });
      }
    }

    return {
      reply: 'I need a support specialist to help complete this request. Please try again or ask for a human agent.',
      steps: maxSteps,
      toolCalls,
      usage,
    };
  }

  private async executeTool(
    call: ToolCall,
    input: { session: SessionRecord; tenantId: string },
  ): Promise<ExecutedToolCall> {
    const tool = this.options.tools.get(call.name);
    if (!tool) {
      return { ...call, observation: `Tool "${call.name}" is not available. Answer without it or escalate.` };
    }

    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        ...call,
        observation: `Invalid tool input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      };
    }

    try {
      const output = await tool.execute(parsed.data, {
        db: this.options.db,
        session: input.session,
        channel: input.session.channel,
        externalUserId: input.session.external_user_id,
        tenantId: input.tenantId,
      });
      return { ...call, result: output.result, observation: output.observation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...call, observation: `Tool failed: ${message}. Do not claim the action succeeded.` };
    }
  }
}

function addUsage(total: TokenUsage, next: TokenUsage): void {
  total.promptTokens += next.promptTokens;
  total.completionTokens += next.completionTokens;
  total.totalTokens += next.totalTokens;
}
