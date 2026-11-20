import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

interface Notification {
  id: number;
  kind: string;
  quote_id: number | null;
  session_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

interface NotificationsPayload {
  notifications: Notification[];
  unread: number;
}

function fmtTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime())
    ? v
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function kindLabel(kind: string): string {
  if (kind === 'quote_realert') return 'reminder';
  if (kind === 'conversation_message') return 'inbox';
  if (kind === 'website_lead') return 'lead';
  return 'approval';
}

export function NotificationBell({
  refreshKey = 0,
  onNavigate,
}: {
  refreshKey?: number;
  onNavigate?: (tab: 'quotes' | 'inbox' | 'intakes') => void;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<NotificationsPayload>('/api/notifications?limit=30');
      setNotifications(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // ignore transient poll failures
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function markAllRead() {
    setBusy(true);
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(item: Notification) {
    if (!item.read_at) {
      await api(`/api/notifications/${item.id}/read`, { method: 'POST' }).catch(() => undefined);
      await load();
    }
    if (onNavigate) {
      if (item.kind === 'conversation_message') onNavigate('inbox');
      else if (item.kind === 'website_lead') onNavigate('intakes');
      else if (item.quote_id !== null) onNavigate('quotes');
      setOpen(false);
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`notif-btn ${open ? 'open' : ''} ${unread > 0 ? 'has-unread' : ''}`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        aria-label={`Admin Alerts${unread > 0 ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        title="Admin Alerts"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-popover" role="dialog" aria-label="Admin Alerts">
          <div className="notif-popover-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong className="kicker" style={{ color: 'var(--text-primary)' }}>
                ADMIN ALERTS
              </strong>
              <span className={`pill ${unread > 0 ? 'orange' : ''}`}>{unread} UNREAD</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ minHeight: 26, padding: '3px 8px', fontSize: '10px' }}
                onClick={markAllRead}
                disabled={unread === 0 || busy}
              >
                Mark all read
              </button>
              <button
                type="button"
                className="notif-close-btn"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="muted small" style={{ padding: '24px 16px', textAlign: 'center' }}>
                No admin alerts yet.
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = !item.read_at;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`notif-item ${isUnread ? 'unread' : ''}`}
                    onClick={() => handleSelect(item)}
                  >
                    <div className="notif-item-head">
                      <span className={`pill ${isUnread ? 'orange' : ''}`}>
                        {kindLabel(item.kind)}
                        {isUnread ? ' · unread' : ''}
                      </span>
                      <span className="mono muted" style={{ fontSize: '10px' }}>
                        {fmtTime(item.created_at)}
                      </span>
                    </div>
                    <div className="notif-item-title">{item.title}</div>
                    <div className="notif-item-body">{item.body}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
