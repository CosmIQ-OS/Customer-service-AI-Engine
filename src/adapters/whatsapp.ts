import type { ChannelAdapter, InboundHandler } from '../engine/channels/adapter.js';
import type { EngineResponse, InboundMessage } from '../engine/types.js';

const GRAPH_VERSION = 'v21.0';
const MAX_WHATSAPP_TEXT = 4096;

export interface WhatsAppAdapterOptions {
  accessToken?: string;
  /** Cloud API phone number id that owns the business account. */
  phoneNumberId?: string;
  /** Default admin WhatsApp numbers in digits-only E.164 format (e.g. "919876543210"). */
  adminNumbers?: string[];
  onError?: (error: unknown, context: string) => void;
}

export interface WhatsAppAlertDeliveryReport {
  sent: number;
  failed: number;
  live: boolean;
  errors: string[];
}

/** Parses comma/semicolon/newline-separated phone numbers into digits-only E.164 strings (7–15 digits). */
export function parseAdminPhoneNumbers(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\r\n]+/)) {
    const digits = part.replace(/[^\d]/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      seen.add(digits);
    }
  }
  return [...seen];
}

/**
 * WhatsApp adapter for the Meta WhatsApp Business Cloud API.
 *
 * With an access token and phone number id it sends real messages through the
 * Graph API. Inbound messages arrive via the webhook route, which normalizes
 * the Cloud API payload.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp';
  private accessToken: string | undefined;
  private phoneNumberId: string | undefined;
  private adminNumbers: string[];
  private onError: (error: unknown, context: string) => void;
  private handler: InboundHandler | undefined;

  constructor(opts: WhatsAppAdapterOptions = {}) {
    this.accessToken = opts.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = opts.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.adminNumbers = (
      opts.adminNumbers ?? parseAdminPhoneNumbers(process.env.WHATSAPP_ADMIN_NUMBERS)
    )
      .map((num) => num.replace(/[^\d]/g, ''))
      .filter((num) => num.length >= 7 && num.length <= 15);
    this.onError = opts.onError ?? ((error, context) => console.error('[whatsapp] %s', context, error));
  }

  get isLive(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  bind(handler: InboundHandler): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (!this.isLive) {
      console.log('[whatsapp] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set; adapter running in stub mode.');
      return;
    }
    console.log(`[whatsapp] Cloud API ready for phone number id ${this.phoneNumberId}.`);
  }

  async sendMessage(externalUserId: string, response: EngineResponse): Promise<void> {
    const text = response.reply;
    if (!text.trim()) return;
    if (!this.isLive) {
      console.log(`[whatsapp->${externalUserId}] ${text}`);
      return;
    }
    await this.postText(externalUserId, text);
  }

  /** Sends a free-form text alert to default configured admin numbers (free inside the 24h Meta service window). */
  async notifyAdmins(text: string): Promise<number> {
    const report = await this.notifyAdminNumbers(this.adminNumbers, text);
    return report.sent;
  }

  /** Sends a free-form text alert to specific admin WhatsApp numbers and returns a per-call delivery report. */
  async notifyAdminNumbers(numbers: string[], text: string): Promise<WhatsAppAlertDeliveryReport> {
    const recipients = [...new Set(numbers.map((n) => n.replace(/[^\d]/g, '')).filter((n) => n.length >= 7 && n.length <= 15))];
    if (!this.isLive || recipients.length === 0) {
      return { sent: 0, failed: 0, live: this.isLive, errors: [] };
    }
    const body = text.slice(0, MAX_WHATSAPP_TEXT);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const phone of recipients) {
      try {
        await this.postText(phone, body);
        sent += 1;
      } catch (error) {
        failed += 1;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${phone}: ${this.redact(msg)}`);
        this.onError(error, 'failed to send an admin alert');
      }
    }
    return { sent, failed, live: true, errors };
  }

  private async postText(to: string, text: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text.slice(0, MAX_WHATSAPP_TEXT) },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`WhatsApp sendMessage request failed: ${this.redact(errorText(error))}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WhatsApp sendMessage failed with status ${res.status}: ${this.redact(detail.slice(0, 200))}`);
    }
  }

  /** Removes the access token from any text that may be logged. */
  private redact(value: string): string {
    let output = value;
    if (this.accessToken) output = output.split(this.accessToken).join('[redacted]');
    return output;
  }

  normalize(payload: unknown): InboundMessage | null {
    const p = payload as any;
    const entry = p?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg?.from || !msg?.text?.body) return null;
    const profile = entry?.contacts?.[0]?.profile;
    return {
      channel: 'whatsapp',
      externalUserId: String(msg.from),
      text: String(msg.text.body),
      metadata: {
        profile,
        name: profile?.name,
        messageId: msg.id ? String(msg.id) : undefined,
        timestamp: msg.timestamp ? String(msg.timestamp) : undefined,
      },
    };
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
