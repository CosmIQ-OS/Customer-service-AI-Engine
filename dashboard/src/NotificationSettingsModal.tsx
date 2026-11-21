import { useEffect, useState } from 'react';
import { api } from './api';

interface WhatsappWindowStatus {
  phone: string;
  lastPingAt: string | null;
  status: 'active' | 'expired' | 'never_pinged';
  remainingMinutes: number;
}

interface LeadNotificationSettings {
  enabled: boolean;
  notifyOnLeadStarted: boolean;
  notifyOnLeadQualified: boolean;
  notifyOnWebsiteLead: boolean;
  whatsappEnabled: boolean;
  whatsappRecipients: string[];
  telegramEnabled: boolean;
  telegramChatIds: number[];
  whatsappLastPingAt: Record<string, string>;
}

interface NotificationSettingsView {
  settings: LeadNotificationSettings;
  channels: {
    whatsappLive: boolean;
    telegramLive: boolean;
  };
  whatsappWindows: WhatsappWindowStatus[];
}

interface TestAlertResponse {
  notification: { id: number; title: string };
  delivery: {
    whatsapp: { status: 'sent' | 'skipped' | 'failed'; sent: number; failed: number; detail: string };
    telegram: { status: 'sent' | 'skipped' | 'failed'; sent: number; failed: number; detail: string };
  };
}

function formatRemaining(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs <= 0) return `${mins}m left`;
  return `${hrs}h ${mins}m left`;
}

export function NotificationSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [testResult, setTestResult] = useState<TestAlertResponse['delivery'] | null>(null);

  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [notifyOnLeadStarted, setNotifyOnLeadStarted] = useState(true);
  const [notifyOnLeadQualified, setNotifyOnLeadQualified] = useState(true);
  const [notifyOnWebsiteLead, setNotifyOnWebsiteLead] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [whatsappInput, setWhatsappInput] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [telegramInput, setTelegramInput] = useState('');

  const applyView = (data: NotificationSettingsView) => {
    setView(data);
    setEnabled(data.settings.enabled);
    setNotifyOnLeadStarted(data.settings.notifyOnLeadStarted);
    setNotifyOnLeadQualified(data.settings.notifyOnLeadQualified);
    setNotifyOnWebsiteLead(data.settings.notifyOnWebsiteLead);
    setWhatsappEnabled(data.settings.whatsappEnabled);
    setWhatsappInput(data.settings.whatsappRecipients.join(', '));
    setTelegramEnabled(data.settings.telegramEnabled);
    setTelegramInput(data.settings.telegramChatIds.join(', '));
  };

  useEffect(() => {
    api<NotificationSettingsView>('/api/notifications/settings')
      .then(applyView)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load notification settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSavedMsg('');
    try {
      const whatsappRecipients = whatsappInput
        .split(/[\s,;]+/)
        .map((s) => s.replace(/[^\d]/g, ''))
        .filter((s) => s.length >= 7 && s.length <= 15);
      const telegramChatIds = telegramInput
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^-?\d+$/.test(s))
        .map((s) => Number(s))
        .filter((n) => Number.isSafeInteger(n) && n !== 0);

      const updated = await api<NotificationSettingsView>('/api/notifications/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          notifyOnLeadStarted,
          notifyOnLeadQualified,
          notifyOnWebsiteLead,
          whatsappEnabled,
          whatsappRecipients,
          telegramEnabled,
          telegramChatIds,
        }),
      });
      applyView(updated);
      setSavedMsg('Alert settings saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save alert settings');
    } finally {
      setBusy(false);
    }
  }

  async function handleTestAlert() {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      const res = await api<TestAlertResponse>('/api/notifications/test', { method: 'POST' });
      setTestResult(res.delivery);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test alert');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        role="dialog"
        aria-label="Lead Notification Channels"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <strong>LEAD NOTIFICATION CHANNELS (FREE TIER)</strong>
          <button type="button" className="notif-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && (
          <div className="banner error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {savedMsg && (
          <div className="banner success" style={{ marginBottom: 12 }}>
            {savedMsg}
          </div>
        )}

        {loading ? (
          <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>
            Loading notification settings…
          </div>
        ) : (
          <form onSubmit={handleSave} className="form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Master + Event triggers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.88rem' }}>1. Lead Alert Triggers</strong>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexDirection: 'row', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  <span>Alerts Master Switch</span>
                </label>
              </div>
              <div className="notif-check-grid">
                <label className="notif-check-item">
                  <input
                    type="checkbox"
                    checked={notifyOnLeadStarted}
                    disabled={!enabled}
                    onChange={(e) => setNotifyOnLeadStarted(e.target.checked)}
                  />
                  <span>New WhatsApp / Telegram lead started</span>
                </label>
                <label className="notif-check-item">
                  <input
                    type="checkbox"
                    checked={notifyOnLeadQualified}
                    disabled={!enabled}
                    onChange={(e) => setNotifyOnLeadQualified(e.target.checked)}
                  />
                  <span>Lead details completed (Qualified)</span>
                </label>
                <label className="notif-check-item">
                  <input
                    type="checkbox"
                    checked={notifyOnWebsiteLead}
                    disabled={!enabled}
                    onChange={(e) => setNotifyOnWebsiteLead(e.target.checked)}
                  />
                  <span>New Website form lead submitted</span>
                </label>
              </div>
            </div>

            {/* Free WhatsApp Admin Alerts */}
            <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: '0.88rem' }}>2. Admin WhatsApp Alerts (₹0 Free Tier)</strong>
                  <span className={`pill ${view?.channels.whatsappLive ? 'ok' : 'orange'}`}>
                    {view?.channels.whatsappLive ? 'CLOUD API LIVE' : 'STUB MODE'}
                  </span>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexDirection: 'row', fontSize: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={whatsappEnabled}
                    disabled={!enabled}
                    onChange={(e) => setWhatsappEnabled(e.target.checked)}
                  />
                  <span>Send to WhatsApp</span>
                </label>
              </div>

              <label>
                Admin WhatsApp Number(s) (with country code, e.g. 919876543210)
                <input
                  type="text"
                  placeholder="919876543210, 919812345678"
                  value={whatsappInput}
                  disabled={!enabled || !whatsappEnabled}
                  onChange={(e) => setWhatsappInput(e.target.value)}
                />
              </label>

              <p className="small muted" style={{ margin: 0, lineHeight: 1.45 }}>
                <strong>100% Free Rule:</strong> Meta Cloud API delivers normal text alerts free inside a 24-hour window.
                Send <code className="mono">/ping</code> to your CosmIQ WhatsApp bot once a day from your admin number to
                keep free alerts active (it will not create a fake lead).
              </p>

              {view && view.whatsappWindows.length > 0 && (
                <div className="window-status-list">
                  {view.whatsappWindows.map((win) => (
                    <div key={win.phone} className="window-status-row">
                      <span className="mono">{win.phone}</span>
                      {win.status === 'active' ? (
                        <span className="pill ok">FREE WINDOW · {formatRemaining(win.remainingMinutes)}</span>
                      ) : (
                        <span className="pill orange">
                          {win.status === 'expired' ? 'EXPIRED · SEND /ping TO BOT' : 'NOT PINGED · SEND /ping TO BOT'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Optional Free Forever Telegram Backup */}
            <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: '0.88rem' }}>3. Telegram Backup (Optional · Free Forever)</strong>
                  <span className={`pill ${view?.channels.telegramLive ? 'ok' : ''}`}>
                    {view?.channels.telegramLive ? 'BOT LIVE' : 'NOT CONFIGURED'}
                  </span>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexDirection: 'row', fontSize: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={telegramEnabled}
                    disabled={!enabled}
                    onChange={(e) => setTelegramEnabled(e.target.checked)}
                  />
                  <span>Send to Telegram</span>
                </label>
              </div>

              <label>
                Admin Telegram Chat ID(s) (comma-separated, optional)
                <input
                  type="text"
                  placeholder="123456789"
                  value={telegramInput}
                  disabled={!enabled || !telegramEnabled}
                  onChange={(e) => setTelegramInput(e.target.value)}
                />
              </label>
            </div>

            {testResult && (
              <div className="banner success" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>Test Alert Triggered</strong>
                <span className="small">Dashboard: Live toast &amp; bell updated.</span>
                <span className="small">
                  WhatsApp ({testResult.whatsapp.status}): {testResult.whatsapp.detail}
                </span>
                <span className="small">
                  Telegram ({testResult.telegram.status}): {testResult.telegram.detail}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={handleTestAlert}
                disabled={testing || busy}
              >
                {testing ? 'SENDING TEST…' : 'SEND TEST ALERT'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                  CLOSE
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'SAVING…' : 'SAVE SETTINGS'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
