import type { ChannelAdapter, InboundHandler } from '../engine/channels/adapter.js';
import type { EngineResponse, InboundMessage } from '../engine/types.js';

const GRAPH_VERSION = 'v21.0';

export interface WhatsAppAdapterOptions {
  accessToken?: string;
  /** Cloud API phone number id that owns the business account. */
  phoneNumberId?: string;
  onError?: (error: unknown, context: string) => void;
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
  private onError: (error: unknown, context: string) => void;
  private handler: InboundHandler | undefined;

  constructor(opts: WhatsAppAdapterOptions = {}) {
    this.accessToken = opts.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = opts.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
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
          to: externalUserId,
          type: 'text',
          text: { body: text },
        }),
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
      metadata: { profile, name: profile?.name },
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
