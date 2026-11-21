import type { ChannelAdapter, InboundHandler } from '../engine/channels/adapter.js';
import type { EngineResponse, InboundMessage } from '../engine/types.js';

const TELEGRAM_API = 'https://api.telegram.org';
/** Telegram rejects messages longer than this. */
const MAX_TELEGRAM_TEXT = 4096;

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    chat?: { id: number };
  };
}

export interface TelegramAdapterOptions {
  token?: string;
  /** Admin chat ids that receive operational alerts such as quote approvals. */
  adminChatIds?: number[];
  /** Long-polling timeout in seconds. */
  pollTimeoutSeconds?: number;
  /** Set to false to only use webhook ingress. */
  polling?: boolean;
  onError?: (error: unknown, context: string) => void;
}

/**
 * Parses operator chat ids from configuration.
 *
 * Only plain integers are accepted: no decimals, no exponent notation and no
 * text. Anything else is dropped so a malformed value can never become a
 * recipient id. Telegram group and channel ids are negative, so both signs are
 * allowed, but zero is not a valid chat.
 */
export function parseAdminChatIds(raw: string | undefined): number[] {
  if (!raw) return [];
  const ids = new Set<number>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!/^-?\d+$/.test(trimmed)) continue;
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value === 0) continue;
    ids.add(value);
  }
  return [...ids];
}

/**
 * Telegram adapter with real Bot API delivery.
 *
 * With a token it long-polls `getUpdates`, forwards messages to the engine,
 * and sends replies through `sendMessage`. Without a token it stays in stub
 * mode so local development and tests need no credentials.
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram';
  private token: string | undefined;
  private adminChatIds: number[];
  private pollTimeoutSeconds: number;
  private polling: boolean;
  private onError: (error: unknown, context: string) => void;
  private handler: InboundHandler | undefined;
  private offset = 0;
  private stopped = false;
  private pollingPromise: Promise<void> | undefined;

  constructor(opts: TelegramAdapterOptions = {}) {
    this.token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
    this.adminChatIds = (opts.adminChatIds ?? parseAdminChatIds(process.env.TELEGRAM_ADMIN_CHAT_IDS)).filter(
      (chatId) => Number.isSafeInteger(chatId) && chatId !== 0,
    );
    this.pollTimeoutSeconds = opts.pollTimeoutSeconds ?? 25;
    this.polling = opts.polling ?? true;
    this.onError = opts.onError ?? ((error, context) => console.error('[telegram] %s', context, error));
  }

  /** True when a token is configured and real delivery is possible. */
  get isLive(): boolean {
    return Boolean(this.token);
  }

  bind(handler: InboundHandler): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (!this.token) {
      console.log('[telegram] TELEGRAM_BOT_TOKEN not set; adapter running in stub mode.');
      return;
    }
    const me = await this.call('getMe');
    const username = (me as { username?: string }).username;
    console.log(`[telegram] connected as @${username ?? 'unknown'}.`);
    if (this.polling) {
      this.pollingPromise = this.pollLoop();
    } else {
      console.log('[telegram] polling disabled; expecting webhook ingress.');
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    await this.pollingPromise?.catch(() => undefined);
  }

  async sendMessage(externalUserId: string, response: EngineResponse): Promise<void> {
    const text = response.reply;
    if (!text.trim()) return;
    if (!this.token) {
      console.log(`[telegram->${externalUserId}] ${text}`);
      return;
    }
    await this.call('sendMessage', {
      chat_id: externalUserId,
      text: text.slice(0, MAX_TELEGRAM_TEXT),
      disable_web_page_preview: true,
    });
  }

  /** Sends an operational alert to the configured admin chats. */
  async notifyAdmins(text: string): Promise<number> {
    const report = await this.notifyChatIds(this.adminChatIds, text);
    return report.sent;
  }

  /** Sends an operational alert to specific Telegram chat IDs and returns a delivery report. */
  async notifyChatIds(
    chatIds: number[],
    text: string,
  ): Promise<{ sent: number; failed: number; live: boolean; errors: string[] }> {
    const recipients = [...new Set(chatIds.filter((chatId) => Number.isSafeInteger(chatId) && chatId !== 0))];
    if (!this.token || recipients.length === 0) {
      return { sent: 0, failed: 0, live: Boolean(this.token), errors: [] };
    }
    const body = text.slice(0, MAX_TELEGRAM_TEXT);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const chatId of recipients) {
      try {
        await this.call('sendMessage', { chat_id: chatId, text: body });
        sent += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${chatId}: ${this.redact(error instanceof Error ? error.message : String(error))}`);
        this.onError(error, 'failed to send an admin alert');
      }
    }
    return { sent, failed, live: true, errors };
  }

  normalize(payload: unknown): InboundMessage | null {
    const p = payload as any;
    const text = p?.message?.text ?? p?.text;
    const userId = p?.message?.from?.id ?? p?.from?.id;
    if (!text || userId == null) return null;
    return {
      channel: 'telegram',
      externalUserId: String(userId),
      text: String(text),
      metadata: {
        username: p?.message?.from?.username,
        firstName: p?.message?.from?.first_name,
        lastName: p?.message?.from?.last_name,
        messageId: p?.message?.message_id,
      },
    };
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = (await this.call('getUpdates', {
          offset: this.offset,
          timeout: this.pollTimeoutSeconds,
          allowed_updates: ['message'],
        })) as TelegramUpdate[];

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        if (this.stopped) return;
        this.onError(error, 'poll failed');
        await delay(3000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || !message.from) return;
    const inbound: InboundMessage = {
      channel: 'telegram',
      externalUserId: String(message.from.id),
      text: message.text,
      metadata: {
        username: message.from.username,
        firstName: message.from.first_name,
        lastName: message.from.last_name,
        messageId: message.message_id,
      },
    };

    if (!this.handler) {
      console.log(`[telegram] no engine handler bound; dropped message from ${inbound.externalUserId}.`);
      return;
    }

    try {
      const result = await this.handler(inbound);
      if (result.reply?.trim()) await this.sendMessage(inbound.externalUserId, result);
    } catch (error) {
      this.onError(error, 'failed to handle a Telegram message');
    }
  }

  private async call(method: string, body?: Record<string, unknown>): Promise<unknown> {
    if (!this.token) throw new Error('Telegram token is not configured.');
    // The bot token is part of the Bot API path, so the URL must never end up
    // in a log line or an error message.
    const url = `${TELEGRAM_API}/bot${this.token}/${method}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      throw new Error(`Telegram ${method} request failed: ${this.redact(errorText(error))}`);
    }
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    if (!res.ok || payload.ok === false) {
      const detail = payload.description ?? `Telegram ${method} failed with status ${res.status}.`;
      throw new Error(this.redact(detail));
    }
    return payload.result;
  }

  /** Removes the bot token and Bot API URLs from any text that may be logged. */
  private redact(value: string): string {
    let output = value;
    if (this.token) output = output.split(this.token).join('[redacted]');
    return output.replace(/https?:\/\/api\.telegram\.org\/bot[^/\s"']+/gi, '[redacted-url]');
  }
}

/** Flattens an error and its cause into a single line of text. */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    return causeText ? `${error.message}: ${causeText}` : error.message;
  }
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
