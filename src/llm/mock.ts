import type { ChatReply, ChatRequest, LLMProvider, ToolCall } from './types.js';
import { PRICING_AGENT_MARKER } from './prompts.js';

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const INTAKE_LABELS: Array<[RegExp, string]> = [
  [/^(company( name)?|company_name)$/i, 'company_name'],
  [/^(company size|size|employees|team size|company_size)$/i, 'company_size'],
  [/^(current tools|tools|stack|current_tools)$/i, 'current_tools'],
  [/^(service( wanted)?|service_name)$/i, 'service_name'],
];

const MISSING_TEXT: Record<string, string> = {
  company_name: 'your company name',
  company_size: 'your company size',
  current_tools: 'the tools your team uses',
  service_name: 'the service you want',
};

/** Deterministic provider for local development and regression tests. */
export class MockLLMProvider implements LLMProvider {
  async chat(request: ChatRequest): Promise<ChatReply> {
    const system = request.messages[0];
    if (system?.role === 'system' && system.content.startsWith(PRICING_AGENT_MARKER)) {
      return reply(mockPricingSelection(request));
    }

    const lastUserIndex = request.messages.map((message) => message.role).lastIndexOf('user');
    const userText = lastUserIndex >= 0 ? request.messages[lastUserIndex].content : '';
    const turnMessages = lastUserIndex >= 0 ? request.messages.slice(lastUserIndex + 1) : [];
    const observation = [...turnMessages].reverse().find((message) => message.role === 'tool');

    if (observation) {
      if (observation.name === 'save_intake' || observation.name === 'get_intake') {
        return reply(intakeReply(observation.content, userText));
      }
      return reply(observation.content);
    }

    const text = userText.toLowerCase();
    const hindi = /[\u0900-\u097F]/.test(userText);
    let call: ToolCall | undefined;
    const intake = parseIntakeFields(userText);
    if (intake) {
      call = toolCall('save_intake', intake);
    } else if (wantsIntakeRecall(text)) {
      call = toolCall('get_intake', {});
    } else if (/\b(human|agent|representative|escalate)\b/.test(text)) {
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

    return reply(hindi
      ? 'मैं सेवाओं, सामान्य प्रश्नों और सहायता अनुरोधों में मदद कर सकता हूँ। आपको किस चीज़ में मदद चाहिए?'
      : 'I can help with service availability, frequently asked questions, and support requests. How can I help?');
  }
}

/** Parses labeled intake details such as "Company: Acme; Size: 120 employees". */
function parseIntakeFields(text: string): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  const normalized = text.replace(/\.\s+/g, '; ').replace(/\n/g, ';');
  for (const segment of normalized.split(/[;,]/)) {
    const pair = /^\s*([a-z][a-z _]*?)\s*[:=]\s*(.+?)\s*$/i.exec(segment);
    if (!pair) continue;
    const label = INTAKE_LABELS.find(([pattern]) => pattern.test(pair[1].trim()));
    if (label && pair[2].trim()) fields[label[1]] = pair[2].trim();
  }
  if (Object.keys(fields).length > 0) return fields;

  const company = /\b(?:our|my) company is\s+([^.;\n,]+)/i.exec(text);
  if (company) fields.company_name = company[1].trim();
  const size = /\b(?:we (?:have|are)|team of)\s+(\d[\w+\- ]*?(?:employees|people|staff|members))/i.exec(text);
  if (size) fields.company_size = size[1].trim();
  const tools = /\bwe (?:currently )?use\s+([^.;\n]+)/i.exec(text);
  if (tools) fields.current_tools = tools[1].trim();

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function wantsIntakeRecall(text: string): boolean {
  return /\b(what (do you|have you) (know|got)|my (details|intake)|what did i (tell|share))\b/.test(text);
}

/** Deterministic pricing selection: match conversation words against the provided catalog. */
function mockPricingSelection(request: ChatRequest): string {
  const content = request.messages[request.messages.length - 1]?.content ?? '';
  const conversation = content.split('Customer conversation:')[1]?.split('Available price table')[0] ?? '';
  const catalogSection = content.split('Available price table')[1] ?? '';
  const catalog = catalogSection
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 4 && /^\d+(\.\d+)?$/.test(parts[3].trim()))
    .map(([code, description, unit]) => ({ code, description, unit }));

  if (catalog.length === 0) {
    return JSON.stringify({ items: [], notes: 'No price items were available.' });
  }

  const tokens = new Set(
    (conversation.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 3),
  );
  const scored = catalog.map((item) => {
    const words = `${item.code} ${item.description} ${item.unit}`.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const score = words.filter((word) => word.length >= 3 && tokens.has(word)).length;
    return { item, score };
  });
  const matches = scored.filter((entry) => entry.score > 0);
  const chosen = (matches.length > 0 ? matches : [scored[0]]).map((entry) => entry.item);

  return JSON.stringify({
    items: chosen.map((item) => ({
      item_code: item.code,
      quantity: 1,
      reason: 'Matched the customer request against the price table.',
    })),
    notes: 'Deterministic mock selection from the active price table.',
  });
}

function intakeReply(observation: string, userText: string): string {
  const hindi = /[\u0900-\u097F]/.test(userText);
  const missingRaw = /Missing fields: ([^.]*)\./.exec(observation)?.[1]?.trim() ?? '';
  const complete = missingRaw === '' || /^none$/i.test(missingRaw);
  if (complete) {
    return hindi
      ? 'धन्यवाद — मेरे पास कंपनी का नाम, आकार, मौजूदा टूल्स और आपकी ज़रूरत की सेवा है। हमारी प्राइसिंग टीम कोटेशन तैयार करेगी और मंज़ूरी के बाद वह आपके साथ साझा किया जाएगा।'
      : 'Thanks — I have your company name, size, current tools, and the service you want. Our pricing team will prepare a quote and it will be reviewed before it is shared with you.';
  }
  if (hindi) {
    return 'धन्यवाद, यह जानकारी मदद करती है। कोटेशन तैयार करने के लिए कृपया बाकी जानकारी भी साझा करें।';
  }
  const missing = missingRaw
    .split(',')
    .map((field) => MISSING_TEXT[field.trim()] ?? field.trim())
    .filter(Boolean);
  return `Thanks, that helps. To prepare your quote, could you also share ${joinList(missing)}?`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'the remaining details';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

let callSequence = 0;
function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  callSequence += 1;
  return { id: `mock_call_${callSequence}`, name, arguments: args };
}

function reply(content: string): ChatReply {
  return { message: { role: 'assistant', content }, usage: { ...ZERO_USAGE } };
}
