import { useEffect, useRef, useState } from 'react';
import {
  notificationTargetFor,
  useNotificationAlerts,
  type AdminNotification,
  type NotificationTarget,
} from './useNotificationAlerts';
import { NotificationToastStack } from './NotificationToast';
import { NotificationSettingsModal } from './NotificationSettingsModal';

function fmtTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime())
    ? v
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function kindLabel(kind: string): string {
  if (kind === 'lead_started') return 'new lead';
  if (kind === 'lead_qualified') return 'qualified lead';
  if (kind === 'website_lead') return 'web lead';
  if (kind === 'quote_realert') return 'reminder';
  if (kind === 'conversation_message') return 'inbox';
  return 'approval';
}

export function NotificationBell({
  refreshKey = 0,
  onNavigate,
  onNotificationArrived,
}: {
  refreshKey?: number;
  onNavigate?: (target: NotificationTarget) => void;
  onNotificationArrived?: (item: AdminNotification) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const {
    notifications,
    unread,
    toasts,
    streamConnected,
    soundEnabled,
    desktopEnabled,
    desktopPermission,
    load,
    toggleSound,
    toggleDesktop,
    markRead,
    markAllRead: runMarkAllRead,
    dismissToast,
  } = useNotificationAlerts({
    refreshKey,
    onNavigate,
    onNotificationArrived,
  });

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
      await runMarkAllRead();
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(item: AdminNotification) {
    if (!item.read_at) {
      await markRead(item.id);
    } else {
      dismissToast(item.id);
    }
    const target = notificationTargetFor(item);
    if (target && onNavigate) {
      onNavigate(target);
      setOpen(false);
    }
  }

  const desktopLabel =
    desktopPermission === 'unsupported'
      ? 'Desktop N/A'
      : desktopPermission === 'denied'
        ? 'Desktop Blocked'
        : desktopEnabled
          ? 'Desktop ON'
          : 'Desktop OFF';

  return (
    <>
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
          title={streamConnected ? 'Admin Alerts (Live)' : 'Admin Alerts'}
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
                {streamConnected && (
                  <span className="pill ok" title="Real-time live alerts connected">
                    LIVE
                  </span>
                )}
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

            {/* Quick Notification Controls */}
            <div className="notif-controls-bar">
              <button
                type="button"
                className={`notif-toggle-pill ${soundEnabled ? 'active' : ''}`}
                onClick={toggleSound}
                title="Toggle sound chime on new leads"
              >
                {soundEnabled ? '🔊 Sound ON' : '🔇 Sound OFF'}
              </button>

              <button
                type="button"
                className={`notif-toggle-pill ${desktopEnabled ? 'active' : ''}`}
                onClick={() => void toggleDesktop()}
                disabled={desktopPermission === 'unsupported'}
                title={
                  desktopPermission === 'denied'
                    ? 'Notifications are blocked in your browser site settings.'
                    : 'Toggle browser desktop popups when a new lead arrives'
                }
              >
                🔔 {desktopLabel}
              </button>

              <button
                type="button"
                className="notif-toggle-pill"
                onClick={() => {
                  setOpen(false);
                  setShowSettings(true);
                }}
                title="Configure free WhatsApp & Telegram lead alerts"
              >
                ⚙ WhatsApp Alerts
              </button>
            </div>

            <div className="notif-list">
              {notifications.length === 0 ? (
                <div className="muted small" style={{ padding: '24px 16px', textAlign: 'center' }}>
                  No admin alerts yet. Incoming WhatsApp and Website leads will appear here instantly.
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

      <NotificationToastStack
        toasts={toasts}
        onSelect={(item) => void handleSelect(item)}
        onDismiss={dismissToast}
      />

      {showSettings && (
        <NotificationSettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => void load()}
        />
      )}
    </>
  );
}
