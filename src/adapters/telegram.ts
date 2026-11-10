import type { ChannelAdapter } from '../engine/channels/adapter.js';
import type { EngineResponse, InboundMessage } from '../engine/types.js';

/**
 * Telegram adapter stub.
 * To connect: add `telegraf` or `grammy`, wire `connect()` to bot.launch()/webhook,
 * call `engine.handleMessage()` on incoming text, and implement `sendMessage()` via ctx.reply/bot.api.
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram';
  private token: string | undefined;

  constructor(opts?: { token?: string }) {
    this.token = opts?.token ?? process.env.TELEGRAM_BOT_TOKEN;
  }

  async connect(): Promise<void> {
    if (!this.token) {
      console.log('[telegram] TELEGRAM_BOT_TOKEN not set; adapter running in stub mode.');
      return;
    }
    // Example integration point:
    // const bot = new Telegraf(this.token);
    // bot.on('text', async (ctx) => { ... engine.handleMessage(normalize(ctx)) ... });
    // await bot.launch();
    console.log('[telegram] token present; wire Telegraf/grammY in connect() to activate.');
  }

  async sendMessage(externalUserId: string, response: EngineResponse): Promise<void> {
    // Integration point: bot.telegram.sendMessage(externalUserId, response.reply)
    console.log(`[telegram->${externalUserId}] ${response.reply}`);
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
      metadata: { username: p?.message?.from?.username },
    };
  }
}
