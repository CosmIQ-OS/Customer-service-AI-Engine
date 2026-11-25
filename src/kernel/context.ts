import type { ChatMessage } from '../llm/types.js';
import { SUPPORT_SYSTEM_PROMPT } from '../llm/prompts.js';
import type { MessageRecord, SessionRecord } from '../engine/types.js';

const SAFE_LANG_PATTERN = /^[\p{L}\p{N}\s()\-_]+$/u;

function sanitizeShortLabel(value: unknown, maxLen = 40): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, maxLen);
  return SAFE_LANG_PATTERN.test(trimmed) ? trimmed : '';
}

function buildSafeSessionMetadata(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof context.messageCount === 'number' && Number.isFinite(context.messageCount)) {
    safe.messageCount = context.messageCount;
  }
  if (typeof context.pendingHandoff === 'boolean') {
    safe.pendingHandoff = context.pendingHandoff;
  }
  if (typeof context.lastSeenAt === 'string' && !Number.isNaN(Date.parse(context.lastSeenAt))) {
    safe.lastSeenAt = context.lastSeenAt;
  }
  return safe;
}

export function buildAgentMessages(session: SessionRecord, history: MessageRecord[]): ChatMessage[] {
  // Only include structured non-freeform metadata in the privileged system message.
  // Untrusted customer text (e.g. lastMessage, email) stays in user/tool messages.
  const safeMetadata = buildSafeSessionMetadata(session.context);
  const sessionContext = Object.keys(safeMetadata).length > 0
    ? `\nSession metadata (JSON): ${JSON.stringify(safeMetadata)}`
    : '';
  const language = sanitizeShortLabel(session.context.language, 16);
  const languageLabel = sanitizeShortLabel(session.context.languageLabel, 40) || language;
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
