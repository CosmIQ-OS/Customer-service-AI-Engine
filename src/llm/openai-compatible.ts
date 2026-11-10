import type { ChatMessage, ChatRequest, ChatReply, LLMProvider, ToolCall } from './types.js';

interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly endpoint: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(toOpenAIMessage),
        tools: request.tools?.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`LLM request failed (${response.status}): ${detail}`);
    }

    const payload = await response.json() as any;
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error('LLM response did not contain a message');

    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call: any, index: number) => ({
      id: String(call.id ?? `call_${index}`),
      name: String(call.function?.name ?? ''),
      arguments: parseArguments(call.function?.arguments),
    }));

    return {
      message: {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        promptTokens: Number(payload.usage?.prompt_tokens ?? 0),
        completionTokens: Number(payload.usage?.completion_tokens ?? 0),
        totalTokens: Number(payload.usage?.total_tokens ?? 0),
      },
    };
  }
}

function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls?.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { _invalidArguments: value };
  }
}
