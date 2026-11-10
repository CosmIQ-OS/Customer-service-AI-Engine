import type { EngineResponse, InboundMessage } from '../types.js';

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
