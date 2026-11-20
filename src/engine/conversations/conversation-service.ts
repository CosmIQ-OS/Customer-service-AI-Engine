import type { DB } from '../../db/database.js';
import type { SessionRecord } from '../types.js';
import * as adminsRepo from '../../db/repositories/admins.js';
import * as conversationsRepo from '../../db/repositories/conversations.js';
import type { ConversationMode, ConversationRecord } from '../../db/repositories/conversations.js';
import * as logsRepo from '../../db/repositories/logs.js';
import * as messagesRepo from '../../db/repositories/messages.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';

export const DEFAULT_IDLE_MINUTES = 60;

export interface ConversationServiceOptions {
  db: DB;
  tenantId: string;
  /** Minutes a human-owned conversation may stay idle before it is closed. */
  idleMinutes?: number;
  now?: () => Date;
}

export interface ConversationSummary {
  sessionId: string;
  channel: string;
  externalUserId: string;
  displayName: string;
  mode: ConversationMode;
  status: 'open' | 'closed';
  takenOverBy: number | null;
  assignedAgentName: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  idleDeadlineAt: string | null;
  unreadCount: number;
  closedReason: string;
  updatedAt: string;
  lastMessage: string;
  lastMessageRole: string;
  lastMessageAt: string | null;
}

export interface AdminReplyResult {
  message: string;
  delivered: boolean;
  conversation: ConversationRecord;
}

/**
 * Live conversation control: who answers the customer right now.
 *
 * A conversation is owned by the AI (`ai`), held by a human (`human`), or
 * temporarily silent with no owner (`paused`). While a conversation is not
 * owned by the AI, inbound messages are recorded and surfaced to admins
 * instead of being answered by the agent.
 */
export class ConversationService {
  private readonly idleMinutes: number;

  constructor(private readonly options: ConversationServiceOptions) {
    this.idleMinutes = options.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private sqlNow(): string {
    return this.now().toISOString().slice(0, 19).replace('T', ' ');
  }

  private deadline(): string {
    return new Date(this.now().getTime() + this.idleMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  }

  async ensure(session: SessionRecord, displayName?: string): Promise<ConversationRecord> {
    return conversationsRepo.upsertConversation(this.options.db, {
      sessionId: session.id,
      channel: session.channel,
      externalUserId: session.external_user_id,
      displayName,
    });
  }

  async get(sessionId: string): Promise<ConversationRecord | undefined> {
    return conversationsRepo.getConversation(this.options.db, sessionId);
  }

  /** Dashboard-shaped view of a single conversation. */
  async summary(sessionId: string): Promise<ConversationSummary | undefined> {
    const row = await this.get(sessionId);
    return row ? this.toSummary(row) : undefined;
  }

  /** True when the AI is allowed to answer for this session. */
  async isAiActive(sessionId: string): Promise<boolean> {
    const conversation = await this.get(sessionId);
    if (!conversation) return true;
    if (conversation.status === 'closed') return false;
    return conversation.mode === 'ai';
  }

  async list(limit = 100): Promise<ConversationSummary[]> {
    const rows = await conversationsRepo.listConversations(this.options.db, limit);
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  /** Sessions waiting for a human: paused or taken over, with unread customer messages. */
  async listNeedingHuman(limit = 100): Promise<ConversationSummary[]> {
    return (await this.list(limit))
      .filter((row) => row.status === 'open' && row.mode !== 'ai')
      .sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0));
  }

  /** Records a customer message and notifies admins when no human owns the conversation. */
  async recordInbound(session: SessionRecord, text: string, displayName?: string): Promise<ConversationRecord> {
    const conversation = await this.ensure(session, displayName);
    const updated = await conversationsRepo.updateConversation(this.options.db, session.id, {
      last_inbound_at: this.sqlNow(),
      unread_count: conversation.unread_count + 1,
      status: 'open',
      closed_at: null,
      closed_reason: '',
      idle_deadline_at: conversation.mode === 'ai' ? null : this.deadline(),
    });

    if (conversation.mode !== 'ai') {
      await notificationsRepo.createNotification(this.options.db, {
        kind: 'conversation_message',
        session_id: session.id,
        title: `New customer message on ${session.channel}`,
        body: `${session.external_user_id}: ${text.slice(0, 280)}`,
      });
      await logsRepo.createLog(this.options.db, {
        channel: session.channel,
        external_user_id: session.external_user_id,
        session_id: session.id,
        direction: 'system',
        event: 'conversation.awaiting_human',
        message: 'Customer message held for a human agent.',
        payload: { mode: conversation.mode },
      });
    }
    return updated ?? conversation;
  }

  /** Records an outbound message and refreshes the idle deadline for human-owned chats. */
  async recordOutbound(session: SessionRecord, _text: string): Promise<ConversationRecord | undefined> {
    const conversation = await this.get(session.id);
    if (!conversation) return undefined;
    return conversationsRepo.updateConversation(this.options.db, session.id, {
      last_outbound_at: this.sqlNow(),
      unread_count: 0,
      idle_deadline_at: conversation.mode === 'ai' ? null : this.deadline(),
    });
  }

  /** Silences the AI without giving the conversation to anyone. */
  async pauseAi(sessionId: string, reason = 'paused by admin'): Promise<ConversationRecord | undefined> {
    const conversation = await this.get(sessionId);
    if (!conversation) return undefined;
    const updated = await conversationsRepo.updateConversation(this.options.db, sessionId, {
      mode: 'paused',
      status: 'open',
      taken_over_by: null,
      idle_deadline_at: this.deadline(),
      closed_at: null,
      closed_reason: '',
    });
    await this.log(sessionId, 'conversation.ai_paused', reason);
    return updated;
  }

  /** Gives the conversation to a human agent and stops the AI from replying. */
  async takeOver(sessionId: string, adminId: number | null, agentName?: string): Promise<ConversationRecord | undefined> {
    const conversation = await this.get(sessionId);
    if (!conversation) return undefined;
    const updated = await conversationsRepo.updateConversation(this.options.db, sessionId, {
      mode: 'human',
      status: 'open',
      taken_over_by: await this.resolveAdminId(adminId),
      assigned_agent_name: agentName ?? '',
      idle_deadline_at: this.deadline(),
      closed_at: null,
      closed_reason: '',
    });
    await this.log(sessionId, 'conversation.taken_over', `Conversation taken over by admin ${adminId ?? 'unknown'}.`);
    return updated;
  }

  /** Hands the conversation back to the AI. */
  async handBack(sessionId: string, adminId: number | null): Promise<ConversationRecord | undefined> {
    const conversation = await this.get(sessionId);
    if (!conversation) return undefined;
    const updated = await conversationsRepo.updateConversation(this.options.db, sessionId, {
      mode: 'ai',
      status: 'open',
      taken_over_by: null,
      idle_deadline_at: null,
      unread_count: 0,
      closed_at: null,
      closed_reason: '',
    });
    await this.log(sessionId, 'conversation.handed_back', `Conversation handed back to the AI by admin ${adminId ?? 'unknown'}.`);
    return updated;
  }

  /** Sends an admin message to the customer and stores it as a human reply. */
  async sendAdminReply(
    sessionId: string,
    adminId: number | null,
    text: string,
    deliver: (channel: string, externalUserId: string, text: string) => Promise<boolean>,
  ): Promise<AdminReplyResult> {
    const conversation = await this.get(sessionId);
    if (!conversation) throw new Error('Conversation not found.');

    await messagesRepo.appendMessage(this.options.db, {
      session_id: sessionId,
      channel: conversation.channel,
      external_user_id: conversation.external_user_id,
      role: 'human',
      content: text,
      tenant_id: this.options.tenantId,
    });

    let delivered = false;
    try {
      delivered = await deliver(conversation.channel, conversation.external_user_id, text);
    } catch (error) {
      await logsRepo.createLog(this.options.db, {
        channel: conversation.channel,
        external_user_id: conversation.external_user_id,
        session_id: sessionId,
        direction: 'system',
        event: 'conversation.delivery_failed',
        message: 'Could not deliver the admin reply to the customer.',
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    await conversationsRepo.updateConversation(this.options.db, sessionId, {
      last_outbound_at: this.sqlNow(),
      last_human_reply_at: this.sqlNow(),
      unread_count: 0,
      idle_deadline_at: conversation.mode === 'ai' ? null : this.deadline(),
    });

    await logsRepo.createLog(this.options.db, {
      channel: conversation.channel,
      external_user_id: conversation.external_user_id,
      session_id: sessionId,
      direction: 'outbound',
      event: 'conversation.admin_reply',
      message: text,
      payload: { adminId, delivered },
    });

    return { message: text, delivered, conversation: (await this.get(sessionId))! };
  }

  /** Closes conversations that a human left idle past the deadline. */
  async closeIdleConversations(): Promise<ConversationRecord[]> {
    const due = await conversationsRepo.listIdleConversations(this.options.db, this.sqlNow());
    for (const conversation of due) {
      await conversationsRepo.updateConversation(this.options.db, conversation.session_id, {
        status: 'closed',
        mode: 'ai',
        taken_over_by: null,
        idle_deadline_at: null,
        closed_at: this.sqlNow(),
        closed_reason: `idle for more than ${this.idleMinutes} minutes`,
      });
      await this.log(
        conversation.session_id,
        'conversation.idle_closed',
        `Conversation closed after ${this.idleMinutes} minutes of inactivity.`,
      );
    }
    return due;
  }

  /** Only references admins that exist, so the foreign key stays valid. */
  private async resolveAdminId(adminId: number | null): Promise<number | null> {
    if (adminId === null) return null;
    return (await adminsRepo.adminExists(this.options.db, adminId)) ? adminId : null;
  }

  private async log(sessionId: string, event: string, message: string): Promise<void> {
    const conversation = await this.get(sessionId);
    if (!conversation) return;
    await logsRepo.createLog(this.options.db, {
      channel: conversation.channel,
      external_user_id: conversation.external_user_id,
      session_id: sessionId,
      direction: 'system',
      event,
      message,
      payload: { mode: conversation.mode },
    });
  }

  private async toSummary(row: ConversationRecord): Promise<ConversationSummary> {
    const messages = await messagesRepo.listRecentMessages(this.options.db, row.session_id, 1);
    const last = messages[0];
    return {
      sessionId: row.session_id,
      channel: row.channel,
      externalUserId: row.external_user_id,
      displayName: row.display_name,
      mode: row.mode,
      status: row.status,
      takenOverBy: row.taken_over_by,
      assignedAgentName: row.assigned_agent_name,
      lastInboundAt: row.last_inbound_at,
      lastOutboundAt: row.last_outbound_at,
      idleDeadlineAt: row.idle_deadline_at,
      unreadCount: row.unread_count,
      closedReason: row.closed_reason,
      updatedAt: row.updated_at,
      lastMessage: last?.content ?? '',
      lastMessageRole: last?.role ?? '',
      lastMessageAt: last?.created_at ?? null,
    };
  }
}
