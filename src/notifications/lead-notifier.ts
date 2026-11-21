import type { DB } from '../db/database.js';
import * as logsRepo from '../db/repositories/logs.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import type { AdminNotificationRecord } from '../db/repositories/notifications.js';
import * as settingsRepo from '../db/repositories/settings.js';
import type { LeadNotificationSettings } from '../db/repositories/settings.js';
import type { AdapterRegistry } from '../engine/channels/adapter.js';
import type { IntakeRecord } from '../intake/intake.js';
import type { TelegramAdapter } from '../adapters/telegram.js';
import type { WhatsAppAdapter } from '../adapters/whatsapp.js';
import type { NotificationHub } from './notification-hub.js';

const FREE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ADMIN_PING_PATTERN = /^\/(?:ping|alerts?|alive|keepalive)\b/i;

export type LeadAlertKind = 'lead_started' | 'lead_qualified' | 'website_lead';

export interface WhatsappWindowStatus {
  phone: string;
  lastPingAt: string | null;
  status: 'active' | 'expired' | 'never_pinged';
  remainingMinutes: number;
}

export interface LeadNotificationSettingsView {
  settings: LeadNotificationSettings;
  channels: {
    whatsappLive: boolean;
    telegramLive: boolean;
  };
  whatsappWindows: WhatsappWindowStatus[];
}

export interface ExternalAlertResult {
  whatsapp: { status: 'sent' | 'skipped' | 'failed'; sent: number; failed: number; detail: string };
  telegram: { status: 'sent' | 'skipped' | 'failed'; sent: number; failed: number; detail: string };
}

export interface LeadNotifierOptions {
  db: DB;
  adapters: AdapterRegistry;
  hub: NotificationHub;
  dashboardPublicUrl?: string;
  envDefaults?: {
    whatsappAdminNumbers?: string;
    telegramAdminChatIds?: string;
  };
  now?: () => Date;
}

export class LeadNotifier {
  constructor(private readonly options: LeadNotifierOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private getWhatsAppAdapter(): WhatsAppAdapter | undefined {
    return this.options.adapters.get('whatsapp') as WhatsAppAdapter | undefined;
  }

  private getTelegramAdapter(): TelegramAdapter | undefined {
    return this.options.adapters.get('telegram') as TelegramAdapter | undefined;
  }

  async getSettings(): Promise<LeadNotificationSettings> {
    return settingsRepo.getLeadNotificationSettings(this.options.db, this.options.envDefaults);
  }

  async getSettingsView(): Promise<LeadNotificationSettingsView> {
    const settings = await this.getSettings();
    const wa = this.getWhatsAppAdapter();
    const tg = this.getTelegramAdapter();
    const nowMs = this.now().getTime();

    const whatsappWindows: WhatsappWindowStatus[] = settings.whatsappRecipients.map((phone) => {
      const lastPingAt = settings.whatsappLastPingAt[phone] ?? null;
      if (!lastPingAt) {
        return { phone, lastPingAt: null, status: 'never_pinged', remainingMinutes: 0 };
      }
      const parsed = Date.parse(lastPingAt);
      if (Number.isNaN(parsed)) {
        return { phone, lastPingAt: null, status: 'never_pinged', remainingMinutes: 0 };
      }
      const remainingMs = parsed + FREE_WINDOW_MS - nowMs;
      if (remainingMs <= 0) {
        return { phone, lastPingAt, status: 'expired', remainingMinutes: 0 };
      }
      return {
        phone,
        lastPingAt,
        status: 'active',
        remainingMinutes: Math.max(1, Math.floor(remainingMs / 60_000)),
      };
    });

    return {
      settings,
      channels: {
        whatsappLive: Boolean(wa?.isLive),
        telegramLive: Boolean(tg?.isLive),
      },
      whatsappWindows,
    };
  }

  async updateSettings(
    patch: Partial<Omit<LeadNotificationSettings, 'whatsappLastPingAt'>>,
    adminId: number | null,
  ): Promise<LeadNotificationSettingsView> {
    await settingsRepo.setLeadNotificationSettings(this.options.db, patch, adminId, this.options.envDefaults);
    return this.getSettingsView();
  }

  /**
   * Checks if an inbound WhatsApp message is from a configured admin number.
   * - Always refreshes the free 24-hour Meta service window timestamp for that admin number.
   * - If the message is an explicit keep-alive command (`/ping`, `/alerts`, `/alive`), intercepts it
   *   and returns a confirmation reply so no fake customer session/lead is created.
   */
  async handleInboundWhatsappAdminCheck(
    externalUserId: string,
    text: string,
  ): Promise<{ intercepted: boolean; reply?: string }> {
    const normalizedPhone = settingsRepo.normalizeWhatsappNumbers([externalUserId])[0];
    if (!normalizedPhone) return { intercepted: false };

    const settings = await this.getSettings();
    if (!settings.whatsappRecipients.includes(normalizedPhone)) {
      return { intercepted: false };
    }

    const nowIso = this.now().toISOString();
    await settingsRepo.recordAdminWhatsappPing(this.options.db, normalizedPhone, nowIso, this.options.envDefaults);

    if (ADMIN_PING_PATTERN.test(text.trim())) {
      await logsRepo.createLog(this.options.db, {
        channel: 'whatsapp',
        external_user_id: normalizedPhone,
        session_id: null,
        direction: 'system',
        event: 'admin.whatsapp_window_refreshed',
        message: `Admin ${normalizedPhone} refreshed the free 24h WhatsApp alert window.`,
        payload: { phone: normalizedPhone, refreshedAt: nowIso },
      });
      return {
        intercepted: true,
        reply:
          '✅ CosmIQ Admin Lead Alerts are active for the next 24 hours (Free Tier window).\n' +
          'You will receive instant WhatsApp alerts here whenever a new WhatsApp or Website lead arrives.\n' +
          'Reply /ping again tomorrow to keep free alerts active.',
      };
    }

    return { intercepted: false };
  }

  /** Publishes any already-stored admin notification to connected SSE dashboard tabs. */
  async broadcastNotification(notification: AdminNotificationRecord): Promise<void> {
    const unread = await notificationsRepo.unreadNotificationCount(this.options.db);
    this.options.hub.publish({ type: 'notification', notification, unread });
  }

  /** Publishes an unread-count update (e.g. after mark-read / mark-all-read). */
  async broadcastUnreadCount(): Promise<void> {
    const unread = await notificationsRepo.unreadNotificationCount(this.options.db);
    this.options.hub.publish({ type: 'unread', unread });
  }

  /** Creates a dashboard notification for a new/qualified WhatsApp or Telegram lead and dispatches external alerts. */
  async notifyIntakeLead(
    kind: 'lead_started' | 'lead_qualified',
    intake: IntakeRecord,
  ): Promise<AdminNotificationRecord | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;
    if (kind === 'lead_started' && !settings.notifyOnLeadStarted) return null;
    if (kind === 'lead_qualified' && !settings.notifyOnLeadQualified) return null;

    const channelLabel = formatChannelLabel(intake.channel);
    const leadLabel = intake.company_name || intake.contact_person || intake.external_user_id || `Lead #${intake.id}`;
    const title =
      kind === 'lead_qualified'
        ? `Qualified ${channelLabel} Lead: ${leadLabel}`
        : `New ${channelLabel} Lead: ${leadLabel}`;
    const body = buildLeadSummaryLine(intake);

    const notification = await notificationsRepo.createNotification(this.options.db, {
      kind,
      intake_id: intake.id,
      session_id: intake.session_id,
      title,
      body,
    });
    await this.broadcastNotification(notification);

    const externalText = this.formatExternalLeadMessage(kind, intake);
    void this.dispatchExternal(settings, externalText, intake.session_id);
    return notification;
  }

  /** Broadcasts an already-inserted website_lead notification and dispatches external alerts. */
  async notifyWebsiteLeadRecorded(
    notification: AdminNotificationRecord,
    intake: IntakeRecord,
  ): Promise<void> {
    await this.broadcastNotification(notification);
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.notifyOnWebsiteLead) return;
    const externalText = this.formatExternalLeadMessage('website_lead', intake);
    void this.dispatchExternal(settings, externalText, intake.session_id);
  }

  /** Fires a live test alert to both the dashboard (DB + SSE) and configured external channels. */
  async sendTestAlert(): Promise<{ notification: AdminNotificationRecord; delivery: ExternalAlertResult }> {
    const settings = await this.getSettings();
    const notification = await notificationsRepo.createNotification(this.options.db, {
      kind: 'lead_started',
      title: 'Test Lead Alert — CosmIQ OS',
      body: 'This is a test alert triggered from the dashboard to verify instant bell popups, sound, and WhatsApp delivery.',
    });
    await this.broadcastNotification(notification);

    const testText = [
      '🔔 CosmIQ OS — Test Lead Alert',
      'Your free lead alert connection is working!',
      'New WhatsApp and Website leads will appear here automatically.',
      this.options.dashboardPublicUrl ? `Dashboard: ${this.options.dashboardPublicUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const delivery = await this.dispatchExternal(settings, testText, null);
    return { notification, delivery };
  }

  async dispatchExternal(
    settings: LeadNotificationSettings,
    text: string,
    sessionId: string | null,
  ): Promise<ExternalAlertResult> {
    const result: ExternalAlertResult = {
      whatsapp: { status: 'skipped', sent: 0, failed: 0, detail: 'Disabled or no recipients configured.' },
      telegram: { status: 'skipped', sent: 0, failed: 0, detail: 'Disabled or no chat IDs configured.' },
    };

    // 1. WhatsApp (100% free inside 24h window via Meta Cloud API text message)
    if (settings.whatsappEnabled && settings.whatsappRecipients.length > 0) {
      const wa = this.getWhatsAppAdapter();
      if (!wa || !wa.isLive) {
        result.whatsapp = {
          status: 'skipped',
          sent: 0,
          failed: 0,
          detail: 'WhatsApp Cloud API credentials are not configured on the server.',
        };
      } else {
        const report = await wa.notifyAdminNumbers(settings.whatsappRecipients, text);
        if (report.failed > 0) {
          await logsRepo.createLog(this.options.db, {
            channel: 'whatsapp',
            external_user_id: 'operators',
            session_id: sessionId,
            direction: 'system',
            event: 'alert.delivery_failed',
            message: `WhatsApp lead alert failed for ${report.failed} recipient(s).`,
            payload: { errors: report.errors },
          });
        }
        result.whatsapp = {
          status: report.sent > 0 ? 'sent' : 'failed',
          sent: report.sent,
          failed: report.failed,
          detail:
            report.sent > 0
              ? `Delivered to ${report.sent} admin WhatsApp number(s).`
              : report.errors[0] || 'Delivery failed (check if 24h free window expired — send /ping to your bot).',
        };
      }
    }

    // 2. Telegram (optional 100% free backup with no 24h window)
    if (settings.telegramEnabled && settings.telegramChatIds.length > 0) {
      const tg = this.getTelegramAdapter();
      if (!tg || !tg.isLive) {
        result.telegram = {
          status: 'skipped',
          sent: 0,
          failed: 0,
          detail: 'Telegram bot token is not configured on the server.',
        };
      } else {
        const report = await tg.notifyChatIds(settings.telegramChatIds, text);
        if (report.failed > 0) {
          await logsRepo.createLog(this.options.db, {
            channel: 'telegram',
            external_user_id: 'operators',
            session_id: sessionId,
            direction: 'system',
            event: 'alert.delivery_failed',
            message: `Telegram lead alert failed for ${report.failed} chat(s).`,
            payload: { errors: report.errors },
          });
        }
        result.telegram = {
          status: report.sent > 0 ? 'sent' : 'failed',
          sent: report.sent,
          failed: report.failed,
          detail:
            report.sent > 0
              ? `Delivered to ${report.sent} Telegram chat(s).`
              : report.errors[0] || 'Telegram delivery failed.',
        };
      }
    }

    return result;
  }

  private formatExternalLeadMessage(kind: LeadAlertKind, intake: IntakeRecord): string {
    const header =
      kind === 'website_lead'
        ? '🌐 New Website Lead — CosmIQ OS'
        : kind === 'lead_qualified'
          ? `✅ Qualified ${formatChannelLabel(intake.channel)} Lead — CosmIQ OS`
          : `🔔 New ${formatChannelLabel(intake.channel)} Lead — CosmIQ OS`;

    const lines = [
      header,
      intake.company_name ? `Company: ${intake.company_name}` : '',
      intake.contact_person ? `Contact: ${intake.contact_person}` : '',
      `Client ID / Phone: ${intake.external_user_id}`,
      intake.email ? `Email: ${intake.email}` : '',
      intake.company_size ? `Team Size: ${intake.company_size}` : '',
      intake.service_name ? `Service: ${intake.service_name}` : '',
      intake.current_tools ? `Current Tools: ${intake.current_tools}` : '',
      `Stage: ${kind === 'lead_started' ? 'Collecting details' : 'Ready for quote / follow-up'}`,
      this.options.dashboardPublicUrl ? `Open Dashboard: ${this.options.dashboardPublicUrl}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  }
}

function formatChannelLabel(channel: string): string {
  const lower = (channel || '').toLowerCase();
  if (lower === 'whatsapp') return 'WhatsApp';
  if (lower === 'telegram') return 'Telegram';
  if (lower === 'website') return 'Website';
  return channel ? channel.charAt(0).toUpperCase() + channel.slice(1) : 'Lead';
}

function buildLeadSummaryLine(intake: IntakeRecord): string {
  const parts: string[] = [];
  if (intake.service_name) parts.push(`Service: ${intake.service_name}`);
  if (intake.company_size) parts.push(`Size: ${intake.company_size}`);
  if (intake.current_tools) parts.push(`Tools: ${intake.current_tools}`);
  if (intake.contact_person) parts.push(`Contact: ${intake.contact_person}`);
  if (intake.external_user_id) parts.push(`ID: ${intake.external_user_id}`);
  return parts.length > 0 ? parts.join(' · ') : 'New prospect inquiry captured.';
}
