import { UTC_NOW_SQL, type DBExecutor } from '../database.js';

export interface AdminNotificationRecord {
  id: number;
  kind: string;
  quote_id: number | null;
  session_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

function map(row: AdminNotificationRecord): AdminNotificationRecord {
  return {
    ...row,
    id: Number(row.id),
    quote_id: row.quote_id === null ? null : Number(row.quote_id),
  };
}

export async function createNotification(
  db: DBExecutor,
  input: Pick<AdminNotificationRecord, 'kind' | 'title' | 'body'> &
    Partial<Pick<AdminNotificationRecord, 'quote_id' | 'session_id'>>,
): Promise<AdminNotificationRecord> {
  const row = await db.queryOne<AdminNotificationRecord>(
    `INSERT INTO admin_notifications (kind, quote_id, session_id, title, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.kind,
      input.quote_id ?? null,
      input.session_id ?? null,
      input.title,
      input.body,
    ],
  );
  return map(row!);
}

export async function getNotification(db: DBExecutor, id: number): Promise<AdminNotificationRecord | undefined> {
  const row = await db.queryOne<AdminNotificationRecord>('SELECT * FROM admin_notifications WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function listNotifications(
  db: DBExecutor,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<AdminNotificationRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const where = options.unreadOnly ? 'WHERE read_at IS NULL' : '';
  const { rows } = await db.query<AdminNotificationRecord>(
    `SELECT * FROM admin_notifications ${where} ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(map);
}

export async function unreadNotificationCount(db: DBExecutor): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM admin_notifications WHERE read_at IS NULL',
  );
  return Number(row?.count ?? 0);
}

export async function markNotificationRead(db: DBExecutor, id: number): Promise<AdminNotificationRecord | undefined> {
  const row = await db.queryOne<AdminNotificationRecord>(
    `UPDATE admin_notifications SET read_at = COALESCE(read_at, ${UTC_NOW_SQL}) WHERE id = $1 RETURNING *`,
    [id],
  );
  return row ? map(row) : undefined;
}

export async function markAllNotificationsRead(db: DBExecutor): Promise<number> {
  const res = await db.query(`UPDATE admin_notifications SET read_at = ${UTC_NOW_SQL} WHERE read_at IS NULL`);
  return res.rowCount;
}

/** Clears approval alerts for a quote once an admin has decided on it. */
export async function markQuoteNotificationsRead(db: DBExecutor, quoteId: number): Promise<number> {
  const res = await db.query(
    `UPDATE admin_notifications SET read_at = ${UTC_NOW_SQL} WHERE quote_id = $1 AND read_at IS NULL`,
    [quoteId],
  );
  return res.rowCount;
}
