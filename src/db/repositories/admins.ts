import type { DBExecutor } from '../database.js';

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
  return { ...row, id: Number(row.id), disabled: Boolean(row.disabled) };
}

export async function countAdmins(db: DBExecutor): Promise<number> {
  const row = await db.queryOne<{ count: number }>('SELECT COUNT(*)::int AS count FROM admin_users');
  return Number(row?.count ?? 0);
}

export async function adminExists(db: DBExecutor, id: number): Promise<boolean> {
  const row = await db.queryOne<{ id: number }>('SELECT id FROM admin_users WHERE id = $1', [id]);
  return Boolean(row);
}

export async function createAdmin(
  db: DBExecutor,
  input: { username: string; passwordHash: string; displayName: string },
): Promise<AdminRecord> {
  const row = await db.queryOne<AdminRow>(
    `INSERT INTO admin_users (username, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, username, display_name, disabled, created_at, last_login_at`,
    [input.username, input.passwordHash, input.displayName],
  );
  return map(row!);
}

export async function findAdminCredentials(db: DBExecutor, username: string): Promise<CredentialRow | undefined> {
  const row = await db.queryOne<CredentialRow>(
    'SELECT id, username, password_hash, disabled FROM admin_users WHERE LOWER(username) = LOWER($1)',
    [username],
  );
  return row ? { ...row, id: Number(row.id), disabled: Number(row.disabled) } : undefined;
}

export async function insertSession(
  db: DBExecutor,
  input: { tokenHash: string; adminId: number; expiresAt: string },
): Promise<void> {
  await db.query(
    'INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)',
    [input.tokenHash, input.adminId, input.expiresAt],
  );
}

export async function findActiveSession(
  db: DBExecutor,
  tokenHash: string,
  nowIso: string,
): Promise<{ id: number; username: string; display_name: string } | undefined> {
  const row = await db.queryOne<{ id: number; username: string; display_name: string }>(
    `SELECT u.id AS id, u.username AS username, u.display_name AS display_name
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.disabled = 0`,
    [tokenHash, nowIso],
  );
  return row ? { ...row, id: Number(row.id) } : undefined;
}

export async function deleteSession(db: DBExecutor, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteExpiredSessions(db: DBExecutor, nowIso: string): Promise<void> {
  await db.query('DELETE FROM admin_sessions WHERE expires_at <= $1', [nowIso]);
}

export async function touchLastLogin(db: DBExecutor, id: number, nowIso: string): Promise<void> {
  await db.query('UPDATE admin_users SET last_login_at = $1 WHERE id = $2', [nowIso, id]);
}

export async function updateAdminPassword(db: DBExecutor, id: number, passwordHash: string): Promise<boolean> {
  const res = await db.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  return res.rowCount > 0;
}

export async function deleteAdminSessions(db: DBExecutor, adminId: number): Promise<void> {
  await db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [adminId]);
}
