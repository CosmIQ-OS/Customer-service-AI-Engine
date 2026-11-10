import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/database.js';
import * as adminsRepo from '../db/repositories/admins.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AdminPrincipal {
  id: number;
  username: string;
  display_name: string;
}

export interface AdminAuthOptions {
  sessionHours: number;
  maxFailures?: number;
  lockoutWindowMinutes?: number;
}

export type LoginResult =
  | { ok: true; token: string; admin: AdminPrincipal; expiresAt: string }
  | { ok: false; reason: 'invalid' | 'locked' };

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AdminAuth {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private dummyHash?: Promise<string>;

  constructor(private readonly db: DB, private readonly options: AdminAuthOptions) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = (options.lockoutWindowMinutes ?? 15) * 60_000;
  }

  hasAdmins(): boolean {
    return adminsRepo.countAdmins(this.db) > 0;
  }

  async createAdmin(username: string, password: string, displayName = ''): Promise<AdminPrincipal> {
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error('Username must be 3-64 characters: letters, numbers, dot, dash, or underscore.');
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
    }
    if (adminsRepo.findAdminCredentials(this.db, username)) {
      throw new Error(`Admin "${username}" already exists.`);
    }
    const record = adminsRepo.createAdmin(this.db, {
      username,
      passwordHash: await hashPassword(password),
      displayName,
    });
    return { id: record.id, username: record.username, display_name: record.display_name };
  }

  async login(username: string, password: string, clientKey: string, now = Date.now()): Promise<LoginResult> {
    if (password.length > MAX_PASSWORD_LENGTH) return { ok: false, reason: 'invalid' };
    const key = `${clientKey}|${username.toLowerCase()}`;
    if (this.isLocked(key, now)) return { ok: false, reason: 'locked' };

    const credentials = adminsRepo.findAdminCredentials(this.db, username);
    const storedHash = credentials ? credentials.password_hash : await this.getDummyHash();
    const passwordOk = await verifyPassword(password, storedHash);
    if (!credentials || credentials.disabled || !passwordOk) {
      this.recordFailure(key, now);
      return { ok: false, reason: 'invalid' };
    }

    this.failures.delete(key);
    const nowIso = new Date(now).toISOString();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + this.options.sessionHours * 3_600_000).toISOString();
    adminsRepo.deleteExpiredSessions(this.db, nowIso);
    adminsRepo.insertSession(this.db, { tokenHash: hashToken(token), adminId: credentials.id, expiresAt });
    adminsRepo.touchLastLogin(this.db, credentials.id, nowIso);

    const admin = adminsRepo.findActiveSession(this.db, hashToken(token), nowIso);
    if (!admin) return { ok: false, reason: 'invalid' };
    return { ok: true, token, admin, expiresAt };
  }

  resolve(token: string | undefined, now = Date.now()): AdminPrincipal | undefined {
    if (!token) return undefined;
    return adminsRepo.findActiveSession(this.db, hashToken(token), new Date(now).toISOString());
  }

  logout(token: string | undefined): void {
    if (token) adminsRepo.deleteSession(this.db, hashToken(token));
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }

  private isLocked(key: string, now: number): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (now - entry.firstAt > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  private recordFailure(key: string, now: number): void {
    if (this.failures.size > 1000) this.pruneFailures(now);
    const entry = this.failures.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) {
      this.failures.set(key, { count: 1, firstAt: now });
    } else {
      entry.count += 1;
    }
  }

  private pruneFailures(now: number): void {
    for (const [key, entry] of this.failures) {
      if (now - entry.firstAt > this.windowMs) this.failures.delete(key);
    }
  }
}
