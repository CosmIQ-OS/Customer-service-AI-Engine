import crypto from 'node:crypto';
import type { DBExecutor } from '../database.js';

export interface ClaimInboundInput {
  channel: string;
  externalUserId: string;
  text: string;
  externalMessageId?: string;
  /** Seconds within which an identical (channel, externalUserId, text) burst is rejected as a duplicate. */
  burstWindowSeconds?: number;
}

export interface ClaimInboundResult {
  claimed: boolean;
  reason?: 'duplicate_message_id' | 'duplicate_burst';
}

function hashText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

/**
 * Atomically claims an inbound message in PostgreSQL so duplicate webhook deliveries
 * (whether from Meta retries, cold-start latency, or concurrent containers sharing Neon DB)
 * cannot insert two customer messages or send two AI replies.
 */
export async function claimInboundMessage(
  db: DBExecutor,
  input: ClaimInboundInput,
): Promise<ClaimInboundResult> {
  const channel = input.channel.trim().toLowerCase();
  const userId = input.externalUserId.trim();
  const msgId = typeof input.externalMessageId === 'string' ? input.externalMessageId.trim() : '';

  // 1. Exact platform message ID claim (wamid on WhatsApp, message_id on Telegram)
  if (msgId) {
    const dedupKey = `${channel}:id:${msgId}`;
    const row = await db.queryOne<{ dedup_key: string }>(
      `INSERT INTO inbound_message_dedup (dedup_key, channel, external_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING dedup_key`,
      [dedupKey, channel, userId],
    );
    if (!row) {
      return { claimed: false, reason: 'duplicate_message_id' };
    }
  }

  // 2. Atomic burst guard for identical (channel, user, text) within the burst window
  const burstSeconds = input.burstWindowSeconds ?? 8;
  if (burstSeconds > 0) {
    const contentHash = hashText(input.text);
    const row = await db.queryOne<{ channel: string }>(
      `INSERT INTO inbound_message_burst_guard (channel, external_user_id, content_hash, claimed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (channel, external_user_id, content_hash) DO UPDATE
         SET claimed_at = EXCLUDED.claimed_at
         WHERE inbound_message_burst_guard.claimed_at < EXCLUDED.claimed_at - ($4 * INTERVAL '1 second')
       RETURNING channel`,
      [channel, userId, contentHash, burstSeconds],
    );
    if (!row) {
      return { claimed: false, reason: 'duplicate_burst' };
    }
  }

  return { claimed: true };
}
