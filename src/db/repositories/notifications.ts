import type { DB } from '../database.js';

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

export function createNotification(
  db: DB,
  input: Pick<AdminNotificationRecord, 'kind' | 'title' | 'body'> &
    Partial<Pick<AdminNotificationRecord, 'quote_id' | 'session_id'>>,
): AdminNotificationRecord {
  const info = db.prepare(
    `INSERT INTO admin_notifications (kind, quote_id, session_id, title, body)
     VALUES (@kind, @quote_id, @session_id, @title, @body)`,
  ).run({
    kind: input.kind,
    quote_id: input.quote_id ?? null,
    session_id: input.session_id ?? null,
    title: input.title,
    body: input.body,
  });
  return getNotification(db, Number(info.lastInsertRowid))!;
}

export function getNotification(db: DB, id: number): AdminNotificationRecord | undefined {
  return db.prepare('SELECT * FROM admin_notifications WHERE id = ?').get(id) as AdminNotificationRecord | undefined;
}

export function listNotifications(
  db: DB,
  options: { limit?: number; unreadOnly?: boolean } = {},
): AdminNotificationRecord[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const where = options.unreadOnly ? 'WHERE read_at IS NULL' : '';
  return db.prepare(
    `SELECT * FROM admin_notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(limit) as AdminNotificationRecord[];
}

export function unreadNotificationCount(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM admin_notifications WHERE read_at IS NULL').get() as {
    count: number;
  };
  return row.count;
}

export function markNotificationRead(db: DB, id: number): AdminNotificationRecord | undefined {
  db.prepare("UPDATE admin_notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ?").run(id);
  return getNotification(db, id);
}

export function markAllNotificationsRead(db: DB): number {
  const info = db.prepare(
    "UPDATE admin_notifications SET read_at = datetime('now') WHERE read_at IS NULL",
  ).run();
  return info.changes;
}

/** Clears approval alerts for a quote once an admin has decided on it. */
export function markQuoteNotificationsRead(db: DB, quoteId: number): number {
  const info = db.prepare(
    "UPDATE admin_notifications SET read_at = datetime('now') WHERE quote_id = ? AND read_at IS NULL",
  ).run(quoteId);
  return info.changes;
}
