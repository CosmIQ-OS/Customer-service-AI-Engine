import type { EngineResponse, InboundMessage } from '../types.js';

/** Handles a normalized inbound message and returns the reply for the channel. */
export type InboundHandler = (message: InboundMessage) => Promise<EngineResponse>;

export interface ChannelAdapter {
  readonly channel: string;
  /** Connect to the external platform (polling/webhook setup). Optional for stubs. */
  connect?(): Promise<void>;
  /** Disconnect/cleanup. */
  disconnect?(): Promise<void>;
  /** Send a message back to the external user. */
  sendMessage(externalUserId: string, response: EngineResponse): Promise<void>;
  /** Normalize a platform-specific payload into an InboundMessage. */
  normalize(payload: unknown): InboundMessage | null;
  /** Attach the engine handler so the adapter can drive conversations itself. */
  bind?(handler: InboundHandler): void;
  /** Send an operational alert to the channel's operators, when the channel supports it. */
  notifyAdmins?(text: string): Promise<number>;
}

export class AdapterRegistry {
  private adapters = new Map<string, ChannelAdapter>();
  register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.channel, adapter);
  }
  get(channel: string) {
    return this.adapters.get(channel);
  }
  list() {
    return Array.from(this.adapters.values());
  }
}
