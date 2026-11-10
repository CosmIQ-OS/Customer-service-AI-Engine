import type { ChannelAdapter } from '../engine/channels/adapter.js';
import type { EngineResponse, InboundMessage } from '../engine/types.js';

/**
 * WhatsApp adapter stub.
 * To connect: use WhatsApp Business Cloud API (Meta Graph) or a provider library,
 * verify webhook in connect()/server route, normalize webhook payloads, and send via Graph messages API.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp';
  private token: string | undefined;

  constructor(opts?: { token?: string }) {
    this.token = opts?.token ?? process.env.WHATSAPP_ACCESS_TOKEN;
  }

  async connect(): Promise<void> {
    if (!this.token) {
      console.log('[whatsapp] WHATSAPP_ACCESS_TOKEN not set; adapter running in stub mode.');
      return;
    }
    console.log('[whatsapp] token present; wire WhatsApp Business webhook/API in connect() to activate.');
  }

  async sendMessage(externalUserId: string, response: EngineResponse): Promise<void> {
    // Integration point: POST https://graph.facebook.com/vXX.0/<PHONE_NUMBER_ID>/messages
    console.log(`[whatsapp->${externalUserId}] ${response.reply}`);
  }

  normalize(payload: unknown): InboundMessage | null {
    const p = payload as any;
    const entry = p?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg?.from || !msg?.text?.body) return null;
    return {
      channel: 'whatsapp',
      externalUserId: String(msg.from),
      text: String(msg.text.body),
      metadata: { profile: entry?.contacts?.[0]?.profile },
    };
  }
}
