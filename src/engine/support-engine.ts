import type { DB } from '../db/database.js';
import type { EngineResponse, InboundMessage } from './types.js';
import { SessionStore } from './sessions/session-store.js';
import * as servicesRepo from '../db/repositories/services.js';
import * as faqsRepo from '../db/repositories/faqs.js';
import * as requestsRepo from '../db/repositories/requests.js';
import * as logsRepo from '../db/repositories/logs.js';
import * as messagesRepo from '../db/repositories/messages.js';
import * as tracesRepo from '../db/repositories/traces.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import { AdapterRegistry } from './channels/adapter.js';
import { AgentLoop, type AgentRunResult, type ExecutedToolCall } from '../kernel/agent-loop.js';
import { createSupportTools } from '../tools/index.js';
import type { LLMProvider } from '../llm/types.js';
import { SUPPORT_PROMPT_VERSION } from '../llm/prompts.js';

export interface EngineConfig {
  sessionTtlMinutes: number;
  llm: LLMProvider;
  model: string;
  maxSteps: number;
  maxHistory: number;
  temperature: number;
  tenantId: string;
}

export class SupportEngine {
  readonly sessions: SessionStore;
  readonly adapters = new AdapterRegistry();
  readonly agentLoop: AgentLoop;

  constructor(readonly db: DB, private readonly config: EngineConfig) {
    this.sessions = new SessionStore(db, config.sessionTtlMinutes);
    this.agentLoop = new AgentLoop({
      db,
      llm: config.llm,
      tools: createSupportTools(),
      model: config.model,
      maxSteps: config.maxSteps,
      temperature: config.temperature,
    });
  }

  listServices() { return servicesRepo.listServices(this.db); }
  createService(input: Parameters<typeof servicesRepo.createService>[1]) { return servicesRepo.createService(this.db, input); }
  updateService(id: number, input: Parameters<typeof servicesRepo.updateService>[2]) { return servicesRepo.updateService(this.db, id, input); }
  listFaqs() { return faqsRepo.listFaqs(this.db); }
  createFaq(input: Parameters<typeof faqsRepo.createFaq>[1]) { return faqsRepo.createFaq(this.db, input); }
  updateFaq(id: number, input: Parameters<typeof faqsRepo.updateFaq>[2]) { return faqsRepo.updateFaq(this.db, id, input); }
  listRequests(limit?: number) { return requestsRepo.listRequests(this.db, limit); }
  listLogs(limit?: number) { return logsRepo.listLogs(this.db, limit); }
  listSessions(limit?: number) { return sessionsRepo.listSessions(this.db, limit); }
  listMessages(sessionId: string, limit?: number) { return messagesRepo.listMessages(this.db, sessionId, limit); }
  listTraces(limit?: number) { return tracesRepo.listTraces(this.db, limit); }

  async handleMessage(msg: InboundMessage): Promise<EngineResponse> {
    const startedAt = Date.now();
    const session = this.sessions.getOrCreate(msg.channel, msg.externalUserId);
    logsRepo.createLog(this.db, {
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      session_id: session.id,
      direction: 'inbound',
      event: 'message.received',
      message: msg.text,
      payload: msg.metadata ?? {},
    });

    messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'user',
      content: msg.text,
      tenant_id: this.config.tenantId,
    });

    try {
      const history = messagesRepo.listRecentMessages(this.db, session.id, this.config.maxHistory);
      const result = await this.agentLoop.run({ session, history, tenantId: this.config.tenantId });
      return this.completeTurn(session, msg, result, startedAt);
    } catch (error) {
      return this.failTurn(session, msg, error, startedAt);
    }
  }

  private completeTurn(
    session: ReturnType<SessionStore['getOrCreate']>,
    msg: InboundMessage,
    result: AgentRunResult,
    startedAt: number,
  ): EngineResponse {
    const intent = detectToolIntent(result.toolCalls);
    const requestId = findRequestId(result.toolCalls);
    const escalated = result.toolCalls.some((call) => call.name === 'escalate_to_human' && call.result);
    const assistantMessage = messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'assistant',
      content: result.reply,
      tenant_id: this.config.tenantId,
    });
    const updatedSession = this.sessions.update(session, {
      last_intent: intent,
      status: escalated ? 'handoff' : session.status,
      context: {
        ...session.context,
        lastMessage: msg.text,
        lastReply: result.reply,
        lastSeenAt: new Date().toISOString(),
        messageCount: Number(session.context.messageCount ?? 0) + 1,
        ...(escalated ? { pendingHandoff: true } : {}),
      },
    });
    tracesRepo.createTrace(this.db, {
      session_id: session.id,
      message_id: assistantMessage.id,
      model: this.config.model,
      prompt_version: SUPPORT_PROMPT_VERSION,
      steps: result.steps,
      tokens_in: result.usage.promptTokens,
      tokens_out: result.usage.completionTokens,
      latency_ms: Date.now() - startedAt,
      tool_calls: result.toolCalls.map(serializeToolCall),
      tenant_id: this.config.tenantId,
    });
    logsRepo.createLog(this.db, {
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      session_id: updatedSession.id,
      request_id: requestId ?? null,
      direction: 'outbound',
      event: 'message.sent',
      message: result.reply,
      payload: { intent },
    });

    return {
      reply: result.reply,
      intent,
      sessionId: updatedSession.id,
      requestId,
      data: {
        model: this.config.model,
        steps: result.steps,
        usage: result.usage,
        toolCalls: result.toolCalls.map(serializeToolCall),
      },
    };
  }

  private failTurn(
    session: ReturnType<SessionStore['getOrCreate']>,
    msg: InboundMessage,
    error: unknown,
    startedAt: number,
  ): EngineResponse {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[agent] turn failed', error);
    const request = requestsRepo.createRequest(this.db, {
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      session_id: session.id,
      kind: 'agent_error',
      subject: 'Agent could not complete the request',
      body: msg.text,
      status: 'open',
      metadata: { error: detail },
    });
    const reply = `I couldn’t complete that request right now, so I logged it for human follow-up as request #${request.id}.`;
    const assistantMessage = messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'assistant',
      content: reply,
      tenant_id: this.config.tenantId,
    });
    this.sessions.update(session, {
      last_intent: 'agent_error',
      context: { ...session.context, lastMessage: msg.text, lastReply: reply, lastSeenAt: new Date().toISOString() },
    });
    tracesRepo.createTrace(this.db, {
      session_id: session.id,
      message_id: assistantMessage.id,
      model: this.config.model,
      prompt_version: SUPPORT_PROMPT_VERSION,
      latency_ms: Date.now() - startedAt,
      error: detail,
      tenant_id: this.config.tenantId,
    });
    logsRepo.createLog(this.db, {
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      session_id: session.id,
      request_id: request.id,
      direction: 'outbound',
      event: 'message.sent',
      message: reply,
      payload: { intent: 'agent_error' },
    });
    return { reply, intent: 'agent_error', sessionId: session.id, requestId: request.id };
  }
}

function detectToolIntent(calls: ExecutedToolCall[]): string {
  const names = new Set(calls.map((call) => call.name));
  if (names.has('escalate_to_human')) return 'escalation';
  if (names.has('create_support_request')) return 'support_request';
  if (names.has('list_services')) return 'services';
  if (names.has('search_faq')) return 'faq';
  return 'assistant';
}

function findRequestId(calls: ExecutedToolCall[]): number | undefined {
  for (const call of calls) {
    const result = call.result as { requestId?: unknown } | undefined;
    if (typeof result?.requestId === 'number') return result.requestId;
  }
  return undefined;
}

function serializeToolCall(call: ExecutedToolCall): Record<string, unknown> {
  return {
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    result: call.result,
  };
}
