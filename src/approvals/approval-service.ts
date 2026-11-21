import type { DB } from '../db/database.js';
import * as quotesRepo from '../db/repositories/quotes.js';
import type { QuoteRecord } from '../db/repositories/quotes.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import type { AdminNotificationRecord } from '../db/repositories/notifications.js';
import * as logsRepo from '../db/repositories/logs.js';
import { formatInr } from './messages.js';

export const DEFAULT_APPROVAL_WINDOW_HOURS = 6;
const HOUR_MS = 3_600_000;

export interface ApprovalServiceConfig {
  /** Hours before the first admin reminder; the same interval repeats until a decision. */
  windowHours?: number;
  now?: () => Date;
  onNotification?: (notification: AdminNotificationRecord) => void | Promise<void>;
}

/** UTC SQL timestamp (`YYYY-MM-DD HH:MM:SS`), matching database defaults. */
export function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Approval workflow for pricing quotes: submit, remind every window, record decisions.
 * Customer messaging is handled by the engine so this class stays transport-free.
 */
export class ApprovalService {
  private readonly windowHours: number;

  constructor(private readonly db: DB, private readonly config: ApprovalServiceConfig = {}) {
    this.windowHours = config.windowHours ?? DEFAULT_APPROVAL_WINDOW_HOURS;
  }

  get window() {
    return this.windowHours;
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  private at(hoursFromNow: number): string {
    return toSqlTimestamp(new Date(this.now().getTime() + hoursFromNow * HOUR_MS));
  }

  /** Queues a quote for admin approval and alerts the dashboard. */
  async submit(quoteId: number): Promise<QuoteRecord> {
    const quote = await quotesRepo.getQuote(this.db, quoteId);
    if (!quote) throw new Error('Quote not found.');
    if (quote.status !== 'draft' && quote.status !== 'pending_approval') {
      throw new Error('Only draft quotes can be submitted for approval.');
    }

    if (quote.session_id) {
      const others = await quotesRepo.listPendingForSession(this.db, quote.session_id, quote.id);
      if (others.length > 0) {
        await quotesRepo.supersedePendingQuotes(this.db, others.map((other) => other.id));
        for (const other of others) await notificationsRepo.markQuoteNotificationsRead(this.db, other.id);
        await logsRepo.createLog(this.db, {
          channel: quote.channel,
          external_user_id: quote.external_user_id,
          session_id: quote.session_id,
          direction: 'system',
          event: 'quote.superseded',
          message: `Superseded ${others.length} earlier pending quote(s) for this session.`,
          payload: { quoteIds: others.map((other) => other.id), replacementId: quote.id },
        });
      }
    }

    const expiresAt = this.at(this.windowHours);
    const updated = await quotesRepo.submitQuoteForApproval(this.db, quote.id, {
      expiresAt,
      nextAlertAt: expiresAt,
    });

    const notification = await notificationsRepo.createNotification(this.db, {
      kind: 'quote_approval',
      quote_id: updated.id,
      session_id: updated.session_id,
      title: `Quote ${updated.quote_number} needs approval`,
      body: `${updated.service_name} · ${formatInr(updated.total_paise)} · customer ${updated.external_user_id}. Reminders repeat every ${this.windowHours} hours until a decision.`,
    });
    await this.config.onNotification?.(notification);
    await logsRepo.createLog(this.db, {
      channel: updated.channel,
      external_user_id: updated.external_user_id,
      session_id: updated.session_id,
      direction: 'system',
      event: 'quote.pending_approval',
      message: `Quote ${updated.quote_number} submitted for admin approval.`,
      payload: { quoteId: updated.id, expiresAt, windowHours: this.windowHours },
    });
    return updated;
  }

  async listPending(limit = 50): Promise<QuoteRecord[]> {
    return quotesRepo.listPendingApprovals(this.db, limit);
  }

  /** Pending quotes whose reminder is due. */
  async due(): Promise<QuoteRecord[]> {
    return quotesRepo.dueForRealert(this.db, toSqlTimestamp(this.now()));
  }

  /** Re-alerts admins and schedules the next reminder one window later. */
  async reAlert(quoteId: number): Promise<{ quote: QuoteRecord; notification: AdminNotificationRecord }> {
    const quote = await quotesRepo.getQuote(this.db, quoteId);
    if (!quote || quote.status !== 'pending_approval') {
      throw new Error('Quote is not awaiting approval.');
    }
    const updated = await quotesRepo.recordRealert(this.db, quoteId, this.at(this.windowHours));
    const notification = await notificationsRepo.createNotification(this.db, {
      kind: 'quote_realert',
      quote_id: updated.id,
      session_id: updated.session_id,
      title: `Reminder: quote ${updated.quote_number} still needs approval`,
      body: `${updated.service_name} · ${formatInr(updated.total_paise)} · customer ${updated.external_user_id}. Reminder ${updated.alert_count}; next one in ${this.windowHours} hours.`,
    });
    await this.config.onNotification?.(notification);
    await logsRepo.createLog(this.db, {
      channel: updated.channel,
      external_user_id: updated.external_user_id,
      session_id: updated.session_id,
      direction: 'system',
      event: 'quote.realerted',
      message: `Re-alerted admins about quote ${updated.quote_number} (reminder ${updated.alert_count}).`,
      payload: { quoteId: updated.id, alertCount: updated.alert_count, nextAlertAt: updated.next_alert_at },
    });
    return { quote: updated, notification };
  }

  async decide(
    quoteId: number,
    decision: 'approved' | 'rejected',
    adminId: number | null,
    note = '',
  ): Promise<QuoteRecord> {
    const updated = await quotesRepo.decideQuote(this.db, quoteId, {
      status: decision,
      adminId,
      note,
      decidedAt: toSqlTimestamp(this.now()),
    });
    await notificationsRepo.markQuoteNotificationsRead(this.db, quoteId, updated.session_id);
    await logsRepo.createLog(this.db, {
      channel: updated.channel,
      external_user_id: updated.external_user_id,
      session_id: updated.session_id,
      direction: 'system',
      event: decision === 'approved' ? 'quote.approved' : 'quote.rejected',
      message: `Admin ${decision} quote ${updated.quote_number}.`,
      payload: { quoteId: updated.id, adminId, totalPaise: updated.total_paise, note },
    });
    return updated;
  }
}
