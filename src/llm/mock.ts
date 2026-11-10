import type { ChatReply, ChatRequest, LLMProvider, ToolCall } from './types.js';

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Deterministic provider for local development and regression tests. */
export class MockLLMProvider implements LLMProvider {
  async chat(request: ChatRequest): Promise<ChatReply> {
    const lastUserIndex = request.messages.map((message) => message.role).lastIndexOf('user');
    const userText = lastUserIndex >= 0 ? request.messages[lastUserIndex].content : '';
    const turnMessages = lastUserIndex >= 0 ? request.messages.slice(lastUserIndex + 1) : [];
    const observation = [...turnMessages].reverse().find((message) => message.role === 'tool');

    if (observation) {
      return reply(observation.content);
    }

    const text = userText.toLowerCase();
    let call: ToolCall | undefined;
    if (/\b(human|agent|representative|escalate)\b/.test(text)) {
      call = toolCall('escalate_to_human', { reason: userText });
    } else if (/\b(service|services|available|availability|status|maintenance)\b/.test(text)) {
      call = toolCall('list_services', {});
    } else if (/\b(issue|problem|support|ticket|complaint|broken|invoice)\b/.test(text)) {
      call = toolCall('create_support_request', { body: userText, subject: 'Customer support request' });
    } else if (/\b(faq|help|how|what|where|when|policy|hours)\b/.test(text) || text.includes('?')) {
      call = toolCall('search_faq', { query: userText });
    }

    if (call) {
      return {
        message: { role: 'assistant', content: '', toolCalls: [call] },
        usage: { ...ZERO_USAGE },
      };
    }

    return reply('I can help with service availability, frequently asked questions, and support requests. How can I help?');
  }
}

let callSequence = 0;
function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  callSequence += 1;
  return { id: `mock_call_${callSequence}`, name, arguments: args };
}

function reply(content: string): ChatReply {
  return { message: { role: 'assistant', content }, usage: { ...ZERO_USAGE } };
}
