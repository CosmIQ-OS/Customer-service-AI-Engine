import crypto from 'node:crypto';
import type { DB } from '../../db/database.js';
import type { SessionRecord } from '../types.js';
import * as repo from '../../db/repositories/sessions.js';

interface CacheEntry {
  record: SessionRecord;
  dirty: boolean;
}

export class SessionStore {
  private cache = new Map<string, CacheEntry>();

  constructor(private db: DB, private ttlMinutes: number) {}

  private key(channel: string, userId: string) {
    return `${channel}:${userId}`;
  }

  private expiry(): string {
    const d = new Date(Date.now() + this.ttlMinutes * 60_000);
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }

  async getOrCreate(channel: string, externalUserId: string): Promise<SessionRecord> {
    const k = this.key(channel, externalUserId);
    const cached = this.cache.get(k);
    if (cached && (!cached.record.expires_at || new Date(cached.record.expires_at + 'Z').getTime() > Date.now())) {
      return cached.record;
    }
    const existing = await repo.getSessionByKey(this.db, channel, externalUserId);
    const record = existing && (!existing.expires_at || new Date(existing.expires_at + 'Z').getTime() > Date.now())
      ? await repo.upsertSession(this.db, { ...existing, expires_at: this.expiry(), context: existing.context })
      : await repo.upsertSession(this.db, {
          id: crypto.randomUUID(),
          channel,
          external_user_id: externalUserId,
          context: {},
          expires_at: this.expiry(),
          status: 'active',
        });
    this.cache.set(k, { record, dirty: false });
    return record;
  }

  async update(
    session: SessionRecord,
    patch: { context?: Record<string, unknown>; last_intent?: string; status?: string },
  ): Promise<SessionRecord> {
    const next = await repo.upsertSession(this.db, {
      id: session.id,
      channel: session.channel,
      external_user_id: session.external_user_id,
      context: patch.context ?? session.context,
      last_intent: patch.last_intent ?? session.last_intent,
      status: patch.status ?? session.status,
      expires_at: this.expiry(),
    });
    this.cache.set(this.key(next.channel, next.external_user_id), { record: next, dirty: false });
    return next;
  }

  snapshot() {
    return Array.from(this.cache.values()).map((e) => e.record);
  }
}
