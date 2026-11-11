import type { ChatMessage } from '../llm/types.js';
import { SUPPORT_SYSTEM_PROMPT } from '../llm/prompts.js';
import type { MessageRecord, SessionRecord } from '../engine/types.js';

export function buildAgentMessages(session: SessionRecord, history: MessageRecord[]): ChatMessage[] {
  const sessionContext = Object.keys(session.context).length > 0
    ? `\nCurrent session context (JSON): ${JSON.stringify(session.context)}`
    : '';
  const language = typeof session.context.language === 'string' ? session.context.language : '';
  const languageLabel = typeof session.context.languageLabel === 'string' ? session.context.languageLabel : language;
  const languageLine = language
    ? `\nDetected customer language: ${languageLabel} (${language}). Reply in this language unless the customer switches.`
    : '';

  return [
    {
      role: 'system',
      content: `${SUPPORT_SYSTEM_PROMPT}\nChannel: ${session.channel}\nCustomer ID: ${session.external_user_id}${languageLine}${sessionContext}`,
    },
    ...history.map((message): ChatMessage => ({
      role: message.role === 'human' ? 'user' : message.role,
      content: message.role === 'human' ? `Human support agent: ${message.content}` : message.content,
    })),
  ];
}
