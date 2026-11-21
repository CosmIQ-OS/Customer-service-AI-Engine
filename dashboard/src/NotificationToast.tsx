import type { AdminNotification } from './useNotificationAlerts';

function toastKindLabel(kind: string): { label: string; tone: string } {
  if (kind === 'lead_started') return { label: 'NEW LEAD', tone: 'orange' };
  if (kind === 'lead_qualified') return { label: 'QUALIFIED LEAD', tone: 'ok' };
  if (kind === 'website_lead') return { label: 'WEBSITE LEAD', tone: 'website' };
  if (kind === 'conversation_message') return { label: 'LIVE INBOX', tone: 'whatsapp' };
  if (kind === 'quote_realert') return { label: 'REMINDER', tone: 'orange' };
  return { label: 'APPROVAL', tone: 'acc' };
}

export function NotificationToastStack({
  toasts,
  onSelect,
  onDismiss,
}: {
  toasts: AdminNotification[];
  onSelect: (item: AdminNotification) => void;
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="notif-toast-stack" role="status" aria-live="polite" aria-label="New Lead Alerts">
      {toasts.map((item) => {
        const meta = toastKindLabel(item.kind);
        return (
          <div key={item.id} className="notif-toast">
            <div className="notif-toast-head">
              <span className={`pill ${meta.tone}`}>{meta.label}</span>
              <button
                type="button"
                className="notif-close-btn"
                onClick={() => onDismiss(item.id)}
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
            <div className="notif-toast-title">{item.title}</div>
            <div className="notif-toast-body">{item.body}</div>
            <div className="notif-toast-actions">
              <button
                type="button"
                className="btn primary btn-sm"
                onClick={() => onSelect(item)}
              >
                VIEW IN DASHBOARD
              </button>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => onDismiss(item.id)}
              >
                DISMISS
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
