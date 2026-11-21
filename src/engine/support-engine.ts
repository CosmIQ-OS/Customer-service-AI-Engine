import type { DB } from '../db/database.js';
import type { EngineResponse, InboundMessage, SessionRecord } from './types.js';
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
import * as contractProposalsRepo from '../db/repositories/contract-proposals.js';
import * as settingsRepo from '../db/repositories/settings.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import { extractEmailFromText, isIntakeReady, type IntakeStatus } from '../intake/intake.js';
import { detectLanguage } from '../intake/language.js';
import { PricingAgent } from '../pricing/pricing-agent.js';
import { QuoteBuilder, type BuiltQuote } from '../pricing/quote-builder.js';
import { ApprovalService, toSqlTimestamp } from '../approvals/approval-service.js';
import {
  approvedQuoteMessage,
  rejectedQuoteMessage,
} from '../approvals/messages.js';
import { AdapterRegistry } from './channels/adapter.js';
import { ConversationService, DEFAULT_IDLE_MINUTES } from './conversations/conversation-service.js';
import { guardPrice } from './price-guard.js';
import { AgentLoop, type AgentRunResult, type ExecutedToolCall } from '../kernel/agent-loop.js';
import { createSupportTools } from '../tools/index.js';
import type { LLMProvider } from '../llm/types.js';
import { SUPPORT_PROMPT_VERSION } from '../llm/prompts.js';
import { NotificationHub } from '../notifications/notification-hub.js';
import { LeadNotifier } from '../notifications/lead-notifier.js';

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
  /** Minutes a human-owned conversation may stay idle before it closes. Defaults to 60. */
  conversationIdleMinutes?: number;
  dashboardPublicUrl?: string;
  whatsappAdminNumbers?: string;
  telegramAdminChatIds?: string;
  now?: () => Date;
}

export class SupportEngine {
  readonly sessions: SessionStore;
  readonly adapters = new AdapterRegistry();
  readonly notificationHub = new NotificationHub();
  readonly leadNotifier: LeadNotifier;
  readonly agentLoop: AgentLoop;
  readonly pricingAgent: PricingAgent;
  readonly quoteBuilder: QuoteBuilder;
  readonly approvals: ApprovalService;
  readonly conversations: ConversationService;

  constructor(readonly db: DB, private readonly config: EngineConfig) {
    this.sessions = new SessionStore(db, config.sessionTtlMinutes);
    this.leadNotifier = new LeadNotifier({
      db,
      adapters: this.adapters,
      hub: this.notificationHub,
      dashboardPublicUrl: config.dashboardPublicUrl,
      envDefaults: {
        whatsappAdminNumbers: config.whatsappAdminNumbers,
        telegramAdminChatIds: config.telegramAdminChatIds,
      },
      now: config.now,
    });
    this.conversations = new ConversationService({
      db,
      tenantId: config.tenantId,
      idleMinutes: config.conversationIdleMinutes ?? DEFAULT_IDLE_MINUTES,
      now: config.now,
      onNotification: (notification) => this.leadNotifier.broadcastNotification(notification),
    });
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
      onNotification: (notification) => this.leadNotifier.broadcastNotification(notification),
    });
  }

  listServices() { return servicesRepo.listServices(this.db); }
  getService(id: number) { return servicesRepo.getServiceById(this.db, id); }
  createService(input: Parameters<typeof servicesRepo.createService>[1]) { return servicesRepo.createService(this.db, input); }
  updateService(id: number, input: Parameters<typeof servicesRepo.updateService>[2]) { return servicesRepo.updateService(this.db, id, input); }
  deleteService(id: number) { return servicesRepo.deleteService(this.db, id); }
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
  async updateIntakeStatus(id: number, status: IntakeStatus, adminId: number | null = null) {
    const updated = await intakeRepo.updateIntakeStatus(this.db, id, status);
    if (updated) {
      await logsRepo.createLog(this.db, {
        channel: updated.channel,
        external_user_id: updated.external_user_id,
        session_id: updated.session_id,
        direction: 'system',
        event: 'intake.status_updated',
        message: `Lead #${updated.id} (${updated.company_name || updated.external_user_id}) status updated to ${status}.`,
        payload: { intakeId: updated.id, status, adminId },
      });
    }
    return updated;
  }
  async deleteIntake(id: number, adminId: number | null = null) {
    const deleted = await intakeRepo.deleteIntake(this.db, id);
    if (deleted) {
      await logsRepo.createLog(this.db, {
        channel: deleted.channel,
        external_user_id: deleted.external_user_id,
        session_id: deleted.session_id,
        direction: 'system',
        event: 'intake.deleted',
        message: `Lead #${deleted.id} (${deleted.company_name || deleted.external_user_id}) deleted.`,
        payload: { intakeId: deleted.id, adminId },
      });
    }
    return deleted;
  }
  listQuotes(limit?: number) { return quotesRepo.listQuotes(this.db, limit); }
  async getQuote(id: number) {
    const quote = await quotesRepo.getQuote(this.db, id);
    return quote ? { quote, items: await quotesRepo.listQuoteItems(this.db, id) } : undefined;
  }
  getLatestQuote(sessionId: string) { return quotesRepo.latestQuoteForSession(this.db, sessionId); }
  getQuoteMarginPercent() { return settingsRepo.getQuoteMarginPercent(this.db); }
  setQuoteMarginPercent(value: number, adminId: number | null) {
    return settingsRepo.setQuoteMarginPercent(this.db, value, adminId);
  }
  getSettings() { return settingsRepo.getAllSettings(this.db); }
  getCompanySizeMultipliers() { return settingsRepo.getCompanySizeMultipliers(this.db); }
  setCompanySizeMultipliers(value: settingsRepo.CompanySizeMultipliers, adminId: number | null) {
    return settingsRepo.setCompanySizeMultipliers(this.db, value, adminId);
  }
  getDefaultTermsAndConditions() { return settingsRepo.getDefaultTermsAndConditions(this.db); }
  setDefaultTermsAndConditions(value: string, adminId: number | null) {
    return settingsRepo.setDefaultTermsAndConditions(this.db, value, adminId);
  }
  updateSettings(patch: Parameters<typeof settingsRepo.updateSettings>[1], adminId: number | null) {
    return settingsRepo.updateSettings(this.db, patch, adminId);
  }
  async createProposal(input: quotesRepo.ProposalInput) {
    const created = await quotesRepo.createProposal(this.db, input);
    await intakeRepo.advanceIntakeToQuoted(this.db, {
      intakeId: input.intakeId,
      sessionId: input.sessionId,
    });
    return created;
  }
  async updateQuoteStatus(id: number, status: quotesRepo.QuoteStatus, adminId: number | null = null) {
    const updated = await quotesRepo.updateQuoteStatus(this.db, id, status);
    if (updated) {
      await logsRepo.createLog(this.db, {
        channel: updated.channel,
        external_user_id: updated.external_user_id,
        session_id: updated.session_id,
        direction: 'system',
        event: 'quote.status_updated',
        message: `Invoice ${updated.quote_number} status updated to ${status}.`,
        payload: { quoteId: updated.id, status, adminId },
      });
    }
    return updated;
  }
  getProposalTemplateSettings() {
    return settingsRepo.getProposalTemplateSettings(this.db);
  }
  setProposalTemplateSettings(
    patch: Partial<settingsRepo.ProposalTemplateSettings>,
    adminId: number | null,
  ) {
    return settingsRepo.setProposalTemplateSettings(this.db, patch, adminId);
  }
  listContractProposals(limit?: number) {
    return contractProposalsRepo.listContractProposals(this.db, limit);
  }
  getContractProposal(id: number) {
    return contractProposalsRepo.getContractProposal(this.db, id);
  }
  async createContractProposal(input: contractProposalsRepo.ContractProposalInput) {
    const created = await contractProposalsRepo.createContractProposal(this.db, input);
    if (input.intakeId || input.sessionId) {
      await intakeRepo.advanceIntakeToQuoted(this.db, {
        intakeId: input.intakeId,
        sessionId: input.sessionId,
      });
    }
    return created;
  }
  updateContractProposalStatus(id: number, status: contractProposalsRepo.ContractProposalStatus) {
    return contractProposalsRepo.updateContractProposalStatus(this.db, id, status);
  }

  async recordWebsiteLead(input: {
    company_name: string;
    company_size?: string;
    contact_person?: string;
    email?: string;
    phone?: string;
    current_tools?: string;
    service_name?: string;
    service_id?: number | null;
    notes?: string;
  }) {
    const sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const externalUserId = input.phone || input.email || input.company_name;

    const summaryText = [
      `🌐 Inbound Website Lead from ${input.company_name}`,
      input.contact_person ? `Contact: ${input.contact_person}` : '',
      input.email ? `Email: ${input.email}` : '',
      input.phone ? `Phone: ${input.phone}` : '',
      input.company_size ? `Company Size: ${input.company_size}` : '',
      input.service_name ? `Requested Service: ${input.service_name}` : '',
      input.current_tools ? `Current Tools: ${input.current_tools}` : '',
      input.notes ? `Notes: ${input.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.db.transaction(async (tx) => {
      const session = await sessionsRepo.upsertSession(tx, {
        id: sessionId,
        channel: 'website',
        external_user_id: externalUserId,
        context: {
          company_name: input.company_name,
          company_size: input.company_size ?? '',
          contact_person: input.contact_person ?? '',
          email: input.email ?? '',
          phone: input.phone ?? '',
          current_tools: input.current_tools ?? '',
          notes: input.notes ?? '',
        },
        last_intent: 'website_lead',
      });

      await messagesRepo.appendMessage(tx, {
        session_id: sessionId,
        channel: 'website',
        external_user_id: externalUserId,
        role: 'user',
        content: summaryText,
      });

      const intake = await intakeRepo.upsertIntake(tx, {
        sessionId,
        channel: 'website',
        externalUserId,
        tenantId: 'default',
        patch: {
          company_name: input.company_name,
          company_size: input.company_size ?? '',
          current_tools: input.current_tools ?? '',
          service_id: input.service_id ?? null,
          service_name: input.service_name ?? '',
          email: input.email ?? '',
          contact_person: input.contact_person ?? '',
          language: 'en',
        },
      });
      await intakeRepo.markIntakeComplete(tx, sessionId);
      const completedIntake = (await intakeRepo.getIntake(tx, sessionId)) ?? intake;

      const notification = await notificationsRepo.createNotification(tx, {
        kind: 'website_lead',
        intake_id: completedIntake.id,
        session_id: sessionId,
        title: `New Website Lead: ${input.company_name}`,
        body: `${input.contact_person || 'Website visitor'} submitted lead inquiry for ${input.service_name || 'Services'}.`,
      });

      return { sessionId, intakeId: completedIntake.id, intake: completedIntake, notification };
    });

    await this.leadNotifier.notifyWebsiteLeadRecorded(result.notification, result.intake);

    return { sessionId: result.sessionId, intakeId: result.intakeId };
  }

  /** Builds a quote with the pricing agent and queues it for admin approval. */
  async buildQuoteForSession(sessionId: string, options: { force?: boolean } = {}): Promise<BuiltQuote> {
    const intake = await intakeRepo.getIntake(this.db, sessionId);
    if (!intake) throw new Error('No intake found for this session.');
    if (!isIntakeReady(intake.status)) throw new Error('The intake is not collected yet.');

    if (!options.force) {
      const existing = await quotesRepo.latestQuoteForSession(this.db, sessionId);
      if (existing) {
        const queued = existing.status === 'draft' ? await this.approvals.submit(existing.id) : existing;
        return { quote: queued, items: await quotesRepo.listQuoteItems(this.db, queued.id) };
      }
    }

    const history = await messagesRepo.listRecentMessages(this.db, sessionId, this.config.maxHistory);
    const marginPercent = await settingsRepo.getQuoteMarginPercent(this.db);
    const built = await this.quoteBuilder.build({ intake, history, marginPercent });

    await logsRepo.createLog(this.db, {
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

    const queued = await this.approvals.submit(built.quote.id);
    void this.alertOperators(
      `Quote ${queued.quote_number} is waiting for approval.\n` +
        `Service: ${queued.service_name}\n` +
        `Customer: ${queued.external_user_id} (${queued.channel})\n` +
        `Total: ${(queued.total_paise / 100).toFixed(2)} INR at ${queued.margin_percent}% margin.`,
    );
    return { quote: queued, items: await quotesRepo.listQuoteItems(this.db, queued.id) };
  }

  listPendingApprovals(limit?: number) { return this.approvals.listPending(limit); }

  async approvalSummary() {
    const [pending, unread] = await Promise.all([
      quotesRepo.countPendingApprovals(this.db),
      notificationsRepo.unreadNotificationCount(this.db),
    ]);
    return {
      pending,
      unread,
      windowHours: this.approvals.window,
    };
  }

  listNotifications(options: { limit?: number; unreadOnly?: boolean } = {}) {
    return notificationsRepo.listNotifications(this.db, options);
  }

  async markNotificationRead(id: number) {
    const updated = await notificationsRepo.markNotificationRead(this.db, id);
    if (updated) await this.leadNotifier.broadcastUnreadCount();
    return updated;
  }
  async markAllNotificationsRead() {
    const count = await notificationsRepo.markAllNotificationsRead(this.db);
    await this.leadNotifier.broadcastUnreadCount();
    return count;
  }
  getLeadNotificationSettingsView() {
    return this.leadNotifier.getSettingsView();
  }
  updateLeadNotificationSettings(
    patch: Parameters<typeof settingsRepo.setLeadNotificationSettings>[1],
    adminId: number | null,
  ) {
    return this.leadNotifier.updateSettings(patch, adminId);
  }
  sendTestLeadNotification() {
    return this.leadNotifier.sendTestAlert();
  }
  async recordWhatsappDeliveryFailure(recipient: string, reason: string, rawStatus: unknown) {
    await logsRepo.createLog(this.db, {
      channel: 'whatsapp',
      external_user_id: recipient,
      session_id: null,
      direction: 'system',
      event: 'whatsapp.delivery_failed',
      message: `Meta failed to deliver WhatsApp message to ${recipient}: ${reason}`,
      payload: { recipient, reason, status: rawStatus },
    });
  }

  /** Live conversations: who answers, what is waiting, and the idle sweep. */
  listConversations(limit?: number) { return this.conversations.list(limit); }
  listConversationsNeedingHuman(limit?: number) { return this.conversations.listNeedingHuman(limit); }
  getConversation(sessionId: string) { return this.conversations.get(sessionId); }
  getConversationSummary(sessionId: string) { return this.conversations.summary(sessionId); }
  pauseAi(sessionId: string) { return this.conversations.pauseAi(sessionId); }
  takeOverConversation(sessionId: string, adminId: number | null, agentName?: string) {
    return this.conversations.takeOver(sessionId, adminId, agentName);
  }
  handBackConversation(sessionId: string, adminId: number | null) {
    return this.conversations.handBack(sessionId, adminId);
  }
  async sendAdminReply(sessionId: string, adminId: number | null, text: string) {
    return this.conversations.sendAdminReply(sessionId, adminId, text, (channel, externalUserId, body) =>
      this.deliverToCustomer(channel, externalUserId, body),
    );
  }
  deleteSentMessage(sessionId: string, messageId: number, adminId: number | null) {
    return this.conversations.deleteSentMessage(sessionId, messageId, adminId);
  }
  closeIdleConversations() { return this.conversations.closeIdleConversations(); }

  /** Broadcasts an operational alert to every channel that supports operator alerts. */
  async alertOperators(text: string): Promise<number> {
    let sent = 0;
    for (const adapter of this.adapters.list()) {
      if (!adapter.notifyAdmins) continue;
      try {
        sent += await adapter.notifyAdmins(text);
      } catch (error) {
        await logsRepo.createLog(this.db, {
          channel: adapter.channel,
          external_user_id: 'operators',
          session_id: null,
          direction: 'system',
          event: 'alert.delivery_failed',
          message: `Could not send an operator alert on ${adapter.channel}.`,
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return sent;
  }

  /** Sends a message to a customer through the channel adapter, without touching the transcript. */
  private async deliverToCustomer(channel: string, externalUserId: string, text: string): Promise<boolean> {
    const adapter = this.adapters.get(channel);
    if (!adapter) return false;
    await adapter.sendMessage(externalUserId, {
      reply: text,
      intent: 'human_reply',
      sessionId: '',
      data: { source: 'admin_panel' },
    });
    return true;
  }

  /** Admin edit before approval: quantities and margin only, line identity and admin prices stay locked. */
  async editQuote(
    id: number,
    input: { marginPercent?: number; quantities?: Record<number, number> },
    adminId: number | null,
  ) {
    const quote = await quotesRepo.getQuote(this.db, id);
    if (!quote) throw new Error('Quote not found.');
    const updated = await quotesRepo.updateQuotePricing(this.db, id, {
      marginPercent: input.marginPercent ?? quote.margin_percent,
      quantities: input.quantities,
    });
    const items = await quotesRepo.listQuoteItems(this.db, id);
    await logsRepo.createLog(this.db, {
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
    const quote = await this.approvals.decide(id, 'approved', adminId);
    const items = await quotesRepo.listQuoteItems(this.db, id);
    const message = approvedQuoteMessage(quote, items);
    const delivered = await this.deliverQuoteMessage(quote, message, 'quote.delivered');
    await intakeRepo.advanceIntakeToQuoted(this.db, {
      intakeId: quote.intake_id,
      sessionId: quote.session_id,
    });
    return { quote: (await quotesRepo.getQuote(this.db, id)) ?? quote, items, message, delivered };
  }

  async rejectQuote(id: number, adminId: number | null, note = '') {
    const quote = await this.approvals.decide(id, 'rejected', adminId, note);
    const items = await quotesRepo.listQuoteItems(this.db, id);
    const message = rejectedQuoteMessage(quote);
    const delivered = await this.deliverQuoteMessage(quote, message, 'quote.handoff_sent');
    return { quote: (await quotesRepo.getQuote(this.db, id)) ?? quote, items, message, delivered };
  }

  /** Reminds admins about overdue quotes without interrupting the customer with repeated holding messages. */
  async processDueApprovals(): Promise<{ realerted: number }> {
    const due = await this.approvals.due();
    for (const quote of due) {
      await this.approvals.reAlert(quote.id);
    }
    return { realerted: due.length };
  }

  private async deliverQuoteMessage(quote: QuoteRecord, text: string, event: string): Promise<boolean> {
    const sessionId = quote.session_id ?? '';
    await messagesRepo.appendMessage(this.db, {
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
        await logsRepo.createLog(this.db, {
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
    if (delivered) await quotesRepo.markQuoteDelivered(this.db, quote.id, toSqlTimestamp(new Date()));

    await logsRepo.createLog(this.db, {
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
    if (msg.channel === 'whatsapp') {
      const adminCheck = await this.leadNotifier.handleInboundWhatsappAdminCheck(msg.externalUserId, msg.text);
      if (adminCheck.intercepted) {
        return {
          reply: adminCheck.reply ?? '',
          intent: 'admin_keepalive',
          sessionId: '',
          data: { adminKeepalive: true },
        };
      }
    }

    const startedAt = Date.now();
    let session = await this.sessions.getOrCreate(msg.channel, msg.externalUserId);
    const language = detectLanguage(msg.text);
    const detectedEmail = extractEmailFromText(msg.text);
    const needsLangUpdate = session.context.language !== language.code;
    const needsEmailUpdate = Boolean(detectedEmail && !session.context.email);

    if (needsLangUpdate || needsEmailUpdate) {
      session = await this.sessions.update(session, {
        context: {
          ...session.context,
          ...(needsLangUpdate ? { language: language.code, languageLabel: language.label } : {}),
          ...(needsEmailUpdate ? { email: detectedEmail } : {}),
        },
      });
      if (await intakeRepo.getIntake(this.db, session.id)) {
        await intakeRepo.upsertIntake(this.db, {
          sessionId: session.id,
          channel: session.channel,
          externalUserId: session.external_user_id,
          tenantId: this.config.tenantId,
          patch: {
            ...(needsLangUpdate ? { language: language.code } : {}),
            ...(needsEmailUpdate ? { email: detectedEmail } : {}),
          },
        });
      }
    }
    await logsRepo.createLog(this.db, {
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      session_id: session.id,
      direction: 'inbound',
      event: 'message.received',
      message: msg.text,
      payload: msg.metadata ?? {},
    });

    await messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'user',
      content: msg.text,
      tenant_id: this.config.tenantId,
    });

    await this.conversations.recordInbound(session, msg.text, displayNameFrom(msg.metadata));

    // A human owns this conversation: record the message and let the agent wait.
    if (!(await this.conversations.isAiActive(session.id))) {
      const conversation = await this.conversations.get(session.id);
      await logsRepo.createLog(this.db, {
        channel: msg.channel,
        external_user_id: msg.externalUserId,
        session_id: session.id,
        direction: 'system',
        event: 'conversation.held',
        message: 'AI did not reply because a human owns this conversation.',
        payload: { mode: conversation?.mode ?? 'human' },
      });
      return {
        reply: '',
        intent: 'awaiting_human',
        sessionId: session.id,
        data: { mode: conversation?.mode ?? 'human', held: true },
      };
    }

    try {
      const intakeBefore = await intakeRepo.getIntake(this.db, session.id);
      const history = await messagesRepo.listRecentMessages(this.db, session.id, this.config.maxHistory);
      const result = await this.agentLoop.run({ session, history, tenantId: this.config.tenantId });
      const response = await this.completeTurn(session, msg, result, startedAt);

      const intake = await intakeRepo.getIntake(this.db, session.id);
      if (!intakeBefore && intake) {
        const kind = isIntakeReady(intake.status) ? 'lead_qualified' : 'lead_started';
        await this.leadNotifier.notifyIntakeLead(kind, intake).catch((error) => {
          console.error('[notifications] failed to notify new lead', error);
        });
      } else if (intakeBefore && !isIntakeReady(intakeBefore.status) && intake && isIntakeReady(intake.status)) {
        await this.leadNotifier.notifyIntakeLead('lead_qualified', intake).catch((error) => {
          console.error('[notifications] failed to notify qualified lead', error);
        });
      }

      if (intake && isIntakeReady(intake.status)) {
        const existing = await quotesRepo.latestQuoteForSession(this.db, session.id);
        if (existing) {
          response.data = { ...response.data, quoteId: existing.id, quoteNumber: existing.quote_number };
        } else if (response.intent === 'intake') {
          try {
            const built = await this.buildQuoteForSession(session.id);
            response.data = { ...response.data, quoteId: built.quote.id, quoteNumber: built.quote.quote_number };
          } catch (error) {
            await logsRepo.createLog(this.db, {
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

  private async completeTurn(
    session: SessionRecord,
    msg: InboundMessage,
    result: AgentRunResult,
    startedAt: number,
  ): Promise<EngineResponse> {
    const intent = detectToolIntent(result.toolCalls);
    const requestId = findRequestId(result.toolCalls);
    const escalated = result.toolCalls.some((call) => call.name === 'escalate_to_human' && call.result);
    if (escalated) {
      void this.alertOperators(
        `A customer asked for a human on ${session.channel}.\n` +
          `Customer: ${session.external_user_id}\n` +
          `Message: ${msg.text.slice(0, 400)}\n` +
          `Open it in the dashboard and take over the conversation.`,
      );
    }
    const guarded = guardPrice(result.reply);
    const reply = guarded.reply;
    if (guarded.blocked) {
      await logsRepo.createLog(this.db, {
        channel: msg.channel,
        external_user_id: msg.externalUserId,
        session_id: session.id,
        direction: 'system',
        event: 'price.blocked',
        message: 'Blocked an agent reply that contained pricing before sending it.',
        payload: { intent },
      });
    }
    const assistantMessage = await messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'assistant',
      content: reply,
      tenant_id: this.config.tenantId,
    });
    const updatedSession = await this.sessions.update(session, {
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
    await this.conversations.recordOutbound(updatedSession, reply);
    await tracesRepo.createTrace(this.db, {
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
    await logsRepo.createLog(this.db, {
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

  private async failTurn(
    session: SessionRecord,
    msg: InboundMessage,
    error: unknown,
    startedAt: number,
  ): Promise<EngineResponse> {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[agent] turn failed', error);
    const request = await requestsRepo.createRequest(this.db, {
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
    const assistantMessage = await messagesRepo.appendMessage(this.db, {
      session_id: session.id,
      channel: msg.channel,
      external_user_id: msg.externalUserId,
      role: 'assistant',
      content: reply,
      tenant_id: this.config.tenantId,
    });
    await this.sessions.update(session, {
      last_intent: 'agent_error',
      context: { ...session.context, lastMessage: msg.text, lastReply: reply, lastSeenAt: new Date().toISOString() },
    });
    await tracesRepo.createTrace(this.db, {
      session_id: session.id,
      message_id: assistantMessage.id,
      model: this.config.model,
      prompt_version: SUPPORT_PROMPT_VERSION,
      latency_ms: Date.now() - startedAt,
      error: detail,
      tenant_id: this.config.tenantId,
    });
    await logsRepo.createLog(this.db, {
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

/** Best-effort display name from channel metadata (Telegram username, WhatsApp profile name). */
function displayNameFrom(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined;
  const profile = metadata.profile as { name?: string } | undefined;
  const candidates = [metadata.username, metadata.name, profile?.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 120);
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
