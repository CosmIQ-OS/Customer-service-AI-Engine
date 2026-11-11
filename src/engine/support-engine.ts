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
import * as intakeRepo from '../db/repositories/intake.js';
import * as quotesRepo from '../db/repositories/quotes.js';
import type { QuoteRecord } from '../db/repositories/quotes.js';
import * as settingsRepo from '../db/repositories/settings.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import { detectLanguage } from '../intake/language.js';
import { PricingAgent } from '../pricing/pricing-agent.js';
import { QuoteBuilder, type BuiltQuote } from '../pricing/quote-builder.js';
import { ApprovalService, toSqlTimestamp } from '../approvals/approval-service.js';
import {
  approvalHoldingMessage,
  approvedQuoteMessage,
  rejectedQuoteMessage,
} from '../approvals/messages.js';
import { AdapterRegistry } from './channels/adapter.js';
import { guardPrice } from './price-guard.js';
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
  pricingLlm?: LLMProvider;
  pricingModel?: string;
  /** Hours before the first admin reminder and between repeats. Defaults to 6. */
  approvalWindowHours?: number;
  now?: () => Date;
}

export class SupportEngine {
  readonly sessions: SessionStore;
  readonly adapters = new AdapterRegistry();
  readonly agentLoop: AgentLoop;
  readonly pricingAgent: PricingAgent;
  readonly quoteBuilder: QuoteBuilder;
  readonly approvals: ApprovalService;

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
    this.pricingAgent = new PricingAgent(config.pricingLlm ?? config.llm, config.pricingModel ?? config.model);
    this.quoteBuilder = new QuoteBuilder(db, this.pricingAgent);
    this.approvals = new ApprovalService(db, {
      windowHours: config.approvalWindowHours,
      now: config.now,
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
  listIntakes(limit?: number) { return intakeRepo.listIntakes(this.db, limit); }
  getIntake(sessionId: string) { return intakeRepo.getIntake(this.db, sessionId); }
  listQuotes(limit?: number) { return quotesRepo.listQuotes(this.db, limit); }
  getQuote(id: number) {
    const quote = quotesRepo.getQuote(this.db, id);
    return quote ? { quote, items: quotesRepo.listQuoteItems(this.db, id) } : undefined;
  }
  getLatestQuote(sessionId: string) { return quotesRepo.latestQuoteForSession(this.db, sessionId); }
  getQuoteMarginPercent() { return settingsRepo.getQuoteMarginPercent(this.db); }
  setQuoteMarginPercent(value: number, adminId: number | null) {
    return settingsRepo.setQuoteMarginPercent(this.db, value, adminId);
  }

  /** Builds a quote with the pricing agent and queues it for admin approval. */
  async buildQuoteForSession(sessionId: string, options: { force?: boolean } = {}): Promise<BuiltQuote> {
    const intake = intakeRepo.getIntake(this.db, sessionId);
    if (!intake) throw new Error('No intake found for this session.');
    if (intake.status !== 'complete') throw new Error('The intake is not complete yet.');

    if (!options.force) {
      const existing = quotesRepo.latestQuoteForSession(this.db, sessionId);
      if (existing) {
        const queued = existing.status === 'draft' ? this.approvals.submit(existing.id) : existing;
        return { quote: queued, items: quotesRepo.listQuoteItems(this.db, queued.id) };
      }
    }

    const history = messagesRepo.listRecentMessages(this.db, sessionId, this.config.maxHistory);
    const marginPercent = settingsRepo.getQuoteMarginPercent(this.db);
    const built = await this.quoteBuilder.build({ intake, history, marginPercent });

    logsRepo.createLog(this.db, {
      channel: intake.channel,
      external_user_id: intake.external_user_id,
      session_id: sessionId,
      direction: 'system',
      event: 'quote.created',
      message: `Created quote ${built.quote.quote_number}.`,
      payload: {
        quoteId: built.quote.id,
        serviceId: built.quote.service_id,
        subtotalPaise: built.quote.subtotal_paise,
        totalPaise: built.quote.total_paise,
        marginPercent,
      },
    });

    const queued = this.approvals.submit(built.quote.id);
    return { quote: queued, items: quotesRepo.listQuoteItems(this.db, queued.id) };
  }

  listPendingApprovals(limit?: number) { return this.approvals.listPending(limit); }

  approvalSummary() {
    return {
      pending: quotesRepo.countPendingApprovals(this.db),
      unread: notificationsRepo.unreadNotificationCount(this.db),
      windowHours: this.approvals.window,
    };
  }

  listNotifications(options: { limit?: number; unreadOnly?: boolean } = {}) {
    return notificationsRepo.listNotifications(this.db, options);
  }

  markNotificationRead(id: number) { return notificationsRepo.markNotificationRead(this.db, id); }
  markAllNotificationsRead() { return notificationsRepo.markAllNotificationsRead(this.db); }

  /** Admin edit before approval: quantities and margin only, line identity and admin prices stay locked. */
  editQuote(
    id: number,
    input: { marginPercent?: number; quantities?: Record<number, number> },
    adminId: number | null,
  ) {
    const quote = quotesRepo.getQuote(this.db, id);
    if (!quote) throw new Error('Quote not found.');
    const updated = quotesRepo.updateQuotePricing(this.db, id, {
      marginPercent: input.marginPercent ?? quote.margin_percent,
      quantities: input.quantities,
    });
    const items = quotesRepo.listQuoteItems(this.db, id);
    logsRepo.createLog(this.db, {
      channel: updated.channel,
      external_user_id: updated.external_user_id,
      session_id: updated.session_id,
      direction: 'system',
      event: 'quote.edited',
      message: `Admin updated quote ${updated.quote_number}.`,
      payload: {
        quoteId: id,
        adminId,
        marginPercent: updated.margin_percent,
        totalPaise: updated.total_paise,
      },
    });
    return { quote: updated, items };
  }

  async approveQuote(id: number, adminId: number | null) {
    const quote = this.approvals.decide(id, 'approved', adminId);
    const items = quotesRepo.listQuoteItems(this.db, id);
    const message = approvedQuoteMessage(quote, items);
    const delivered = await this.deliverQuoteMessage(quote, message, 'quote.delivered');
    return { quote: quotesRepo.getQuote(this.db, id) ?? quote, items, message, delivered };
  }

  async rejectQuote(id: number, adminId: number | null, note = '') {
    const quote = this.approvals.decide(id, 'rejected', adminId, note);
    const items = quotesRepo.listQuoteItems(this.db, id);
    const message = rejectedQuoteMessage(quote);
    const delivered = await this.deliverQuoteMessage(quote, message, 'quote.handoff_sent');
    return { quote: quotesRepo.getQuote(this.db, id) ?? quote, items, message, delivered };
  }

  /** Reminds admins about overdue quotes and sends the customer a price-free holding update. */
  async processDueApprovals(): Promise<{ realerted: number }> {
    const due = this.approvals.due();
    for (const quote of due) {
      const { quote: updated } = this.approvals.reAlert(quote.id);
      await this.deliverQuoteMessage(updated, approvalHoldingMessage(updated), 'quote.holding_sent');
    }
    return { realerted: due.length };
  }

  private async deliverQuoteMessage(quote: QuoteRecord, text: string, event: string): Promise<boolean> {
    const sessionId = quote.session_id ?? '';
    messagesRepo.appendMessage(this.db, {
      session_id: sessionId,
      channel: quote.channel,
      external_user_id: quote.external_user_id,
      role: 'assistant',
      content: text,
      tenant_id: this.config.tenantId,
    });

    let delivered = false;
    const adapter = this.adapters.get(quote.channel);
    if (adapter) {
      try {
        await adapter.sendMessage(quote.external_user_id, {
          reply: text,
          intent: 'quote',
          sessionId,
          data: { quoteId: quote.id, quoteNumber: quote.quote_number, status: quote.status },
        });
        delivered = true;
      } catch (error) {
        logsRepo.createLog(this.db, {
          channel: quote.channel,
          external_user_id: quote.external_user_id,
          session_id: quote.session_id,
          direction: 'system',
          event: 'quote.delivery_failed',
          message: `Could not deliver quote ${quote.quote_number} to the customer.`,
          payload: { quoteId: quote.id, error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    if (delivered) quotesRepo.markQuoteDelivered(this.db, quote.id, toSqlTimestamp(new Date()));

    logsRepo.createLog(this.db, {
      channel: quote.channel,
      external_user_id: quote.external_user_id,
      session_id: quote.session_id,
      direction: 'outbound',
      event,
      message: text,
      payload: { quoteId: quote.id, status: quote.status, delivered },
    });
    return delivered;
  }

  async handleMessage(msg: InboundMessage): Promise<EngineResponse> {
    const startedAt = Date.now();
    let session = this.sessions.getOrCreate(msg.channel, msg.externalUserId);
    const language = detectLanguage(msg.text);
    if (session.context.language !== language.code) {
      session = this.sessions.update(session, {
        context: { ...session.context, language: language.code, languageLabel: language.label },
      });
      if (intakeRepo.getIntake(this.db, session.id)) {
        intakeRepo.upsertIntake(this.db, {
          sessionId: session.id,
          channel: session.channel,
          externalUserId: session.external_user_id,
          tenantId: this.config.tenantId,
          patch: { language: language.code },
        });
      }
    }
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
      const response = this.completeTurn(session, msg, result, startedAt);

      const intake = intakeRepo.getIntake(this.db, session.id);
      if (intake?.status === 'complete') {
        const existing = quotesRepo.latestQuoteForSession(this.db, session.id);
        if (existing) {
          response.data = { ...response.data, quoteId: existing.id, quoteNumber: existing.quote_number };
        } else if (response.intent === 'intake') {
          try {
            const built = await this.buildQuoteForSession(session.id);
            response.data = { ...response.data, quoteId: built.quote.id, quoteNumber: built.quote.quote_number };
          } catch (error) {
            logsRepo.createLog(this.db, {
              channel: msg.channel,
              external_user_id: msg.externalUserId,
              session_id: session.id,
              direction: 'system',
              event: 'quote.failed',
              message: 'Could not prepare a quote automatically.',
              payload: { error: error instanceof Error ? error.message : String(error) },
            });
          }
        }
      }

      return response;
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
    const guarded = guardPrice(result.reply);
    const reply = guarded.reply;
    if (guarded.blocked) {
      logsRepo.createLog(this.db, {
        channel: msg.channel,
        external_user_id: msg.externalUserId,
        session_id: session.id,
        direction: 'system',
        event: 'price.blocked',
        message: 'Blocked an agent reply that contained pricing before sending it.',
        payload: { intent },
      });
    }
    const assistantMessage = messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'assistant',
      content: reply,
      tenant_id: this.config.tenantId,
    });
    const updatedSession = this.sessions.update(session, {
      last_intent: intent,
      status: escalated ? 'handoff' : session.status,
      context: {
        ...session.context,
        lastMessage: msg.text,
        lastReply: reply,
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
      message: reply,
      payload: { intent, priceBlocked: guarded.blocked },
    });

    return {
      reply,
      intent,
      sessionId: updatedSession.id,
      requestId,
      data: {
        model: this.config.model,
        steps: result.steps,
        usage: result.usage,
        priceBlocked: guarded.blocked,
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
  if (names.has('save_intake') || names.has('get_intake')) return 'intake';
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
