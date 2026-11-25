import { useState, useEffect } from 'react';
import { api } from './api';

export interface AppSettingsData {
  quoteMarginPercent: number;
  minMarginPercent: number;
  maxMarginPercent: number;
  companySizeMultipliers: {
    '0-5': number;
    '5-10': number;
    '10-20': number;
    '20+': number;
  };
  defaultTermsAndConditions: string;
}

interface ServiceSettingsModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceSettingsModal({ onClose, onSaved }: ServiceSettingsModalProps) {
  const [settings, setSettings] = useState<AppSettingsData | null>(null);
  const [mult05, setMult05] = useState('1.0');
  const [mult510, setMult510] = useState('1.5');
  const [mult1020, setMult1020] = useState('2.0');
  const [mult20Plus, setMult20Plus] = useState('3.0');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<AppSettingsData>('/api/settings')
      .then((data) => {
        setSettings(data);
        if (data.companySizeMultipliers) {
          setMult05(String(data.companySizeMultipliers['0-5'] ?? 1.0));
          setMult510(String(data.companySizeMultipliers['5-10'] ?? 1.5));
          setMult1020(String(data.companySizeMultipliers['10-20'] ?? 2.0));
          setMult20Plus(String(data.companySizeMultipliers['20+'] ?? 3.0));
        }
        setTerms(data.defaultTermsAndConditions || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const m1 = Number(mult05);
    const m2 = Number(mult510);
    const m3 = Number(mult1020);
    const m4 = Number(mult20Plus);

    if ([m1, m2, m3, m4].some((v) => !Number.isFinite(v) || v <= 0)) {
      setError('All company size multipliers must be positive numbers (e.g. 1.0, 1.5).');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companySizeMultipliers: {
            '0-5': m1,
            '5-10': m2,
            '10-20': m3,
            '20+': m4,
          },
          defaultTermsAndConditions: terms,
        }),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title">
            <strong>Pricing Rules &amp; Invoice Settings</strong>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="Close pricing settings">✕</button>
        </div>

        {error && <div className="banner error">{error}</div>}
        {loading ? (
          <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>Loading settings…</div>
        ) : (
          <form onSubmit={handleSubmit} className="form">
            <div>
              <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Company Size Multipliers</strong>
              <p className="small muted" style={{ margin: '4px 0 12px' }}>
                Applied to service base prices automatically when creating invoices.
              </p>

              <div className="grid-4">
                <label>
                  0–5 Size
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    required
                    value={mult05}
                    onChange={(e) => setMult05(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <span className="small muted">{(Number(mult05) * 100).toFixed(0)}% base</span>
                </label>

                <label>
                  5–10 Size
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    required
                    value={mult510}
                    onChange={(e) => setMult510(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <span className="small muted">{(Number(mult510) * 100).toFixed(0)}% base</span>
                </label>

                <label>
                  10–20 Size
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    required
                    value={mult1020}
                    onChange={(e) => setMult1020(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <span className="small muted">{(Number(mult1020) * 100).toFixed(0)}% base</span>
                </label>

                <label>
                  20+ Size
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    required
                    value={mult20Plus}
                    onChange={(e) => setMult20Plus(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <span className="small muted">{(Number(mult20Plus) * 100).toFixed(0)}% base</span>
                </label>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 16 }}>
              <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Default Invoice Terms &amp; Conditions Template</strong>
              <p className="small muted" style={{ margin: '4px 0 8px' }}>
                Pre-filled automatically into new invoices. You can edit it here or override it per invoice.
              </p>

              <textarea
                rows={8}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}
                placeholder="Enter standard commercial terms, validity periods, payment schedules, and IP ownership clauses…"
              />
            </div>

            <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Pricing Rules & Terms'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
