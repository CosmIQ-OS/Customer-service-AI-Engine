import type { DB } from '../database.js';

export interface AdminRecord {
  id: number;
  username: string;
  display_name: string;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface AdminRow extends Omit<AdminRecord, 'disabled'> {
  disabled: number;
}

interface CredentialRow {
  id: number;
  username: string;
  password_hash: string;
  disabled: number;
}

function map(row: AdminRow): AdminRecord {
  return { ...row, disabled: Boolean(row.disabled) };
}

export function countAdmins(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM admin_users').get() as { count: number }).count;
}

export function createAdmin(
  db: DB,
  input: { username: string; passwordHash: string; displayName: string },
): AdminRecord {
  const info = db.prepare(
    `INSERT INTO admin_users (username, password_hash, display_name) VALUES (@username, @passwordHash, @displayName)`,
  ).run(input);
  return map(
    db.prepare(
      'SELECT id, username, display_name, disabled, created_at, last_login_at FROM admin_users WHERE id = ?',
    ).get(Number(info.lastInsertRowid)) as AdminRow,
  );
}

export function findAdminCredentials(db: DB, username: string): CredentialRow | undefined {
  return db.prepare(
    'SELECT id, username, password_hash, disabled FROM admin_users WHERE username = ?',
  ).get(username) as CredentialRow | undefined;
}

export function insertSession(
  db: DB,
  input: { tokenHash: string; adminId: number; expiresAt: string },
): void {
  db.prepare(
    'INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (@tokenHash, @adminId, @expiresAt)',
  ).run(input);
}

export function findActiveSession(
  db: DB,
  tokenHash: string,
  nowIso: string,
): { id: number; username: string; display_name: string } | undefined {
  return db.prepare(
    `SELECT u.id AS id, u.username AS username, u.display_name AS display_name
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
  ).get(tokenHash, nowIso) as { id: number; username: string; display_name: string } | undefined;
}

export function deleteSession(db: DB, tokenHash: string): void {
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteExpiredSessions(db: DB, nowIso: string): void {
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(nowIso);
}

export function touchLastLogin(db: DB, id: number, nowIso: string): void {
  db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(nowIso, id);
}
