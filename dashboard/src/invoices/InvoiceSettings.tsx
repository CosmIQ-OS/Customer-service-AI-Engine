import { useEffect, useState } from 'react';
import { api } from '../api';
import type { InvoiceSettings as Settings } from './types';

export function InvoiceSettings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<Settings>('/api/invoice-settings').then(setSettings).catch((err) => setError(err.message));
  }, []);

  function update(key: keyof Settings, value: string | number) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      setSettings(await api<Settings>('/api/invoice-settings', { method: 'PUT', body: JSON.stringify(settings) }));
      setMessage('Invoice company and payment settings saved in Invoice Ninja.');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  if (!settings) return <section className="card"><div className="panel-title"><strong>Invoice settings</strong><button className="btn secondary" onClick={onBack}>BACK</button></div>{error ? <div className="banner error">{error}</div> : <p className="muted">Loading Invoice Ninja settings…</p>}</section>;
  const fields: Array<{ key: keyof Settings; label: string }> = [
    { key: 'companyName', label: 'Legal company name *' }, { key: 'address', label: 'Company address' },
    { key: 'taxNumber', label: 'Tax / GST number' }, { key: 'currency', label: 'Default currency (ISO)' },
    { key: 'accountName', label: 'Bank account name' }, { key: 'bankName', label: 'Bank name' },
    { key: 'accountNumber', label: 'Account number' }, { key: 'routingNumber', label: 'IFSC / routing number' },
    { key: 'swiftCode', label: 'SWIFT code' }, { key: 'upiId', label: 'UPI ID' },
  ];
  return (
    <section className="card">
      <div className="panel-title"><div><span className="kicker">INVOICES // SETTINGS</span><h2>Company & payment details</h2></div><button type="button" className="btn secondary" onClick={onBack}>BACK TO INVOICES</button></div>
      <p className="sub">These details are stored in Invoice Ninja and automatically included in new invoice PDFs.</p>
      {!settings.configured && <div className="banner error">Set the Invoice Ninja base URL and API token on the backend before saving.</div>}
      {error && <div className="banner error">{error}</div>}{message && <div className="banner success">{message}</div>}
      <form className="form" onSubmit={save}>
        <div className="invoice-field-grid">{fields.map((field) => <label key={field.key}>{field.label}
          <input required={field.key === 'companyName'} maxLength={field.key === 'currency' ? 3 : undefined} value={String(settings[field.key])} onChange={(event) => update(field.key, event.target.value)} />
        </label>)}<label>Default days until due<input type="number" min="0" max="365" value={settings.defaultDueDays} onChange={(event) => update('defaultDueDays', Number(event.target.value))} /></label></div>
        <label>Payment instructions<textarea rows={4} value={settings.paymentInstructions} onChange={(event) => update('paymentInstructions', event.target.value)} /></label>
        <label>Invoice terms / footer<textarea rows={4} value={settings.terms} onChange={(event) => update('terms', event.target.value)} /></label>
        <button className="btn primary" type="submit" disabled={busy || !settings.configured}>{busy ? 'SAVING…' : 'SAVE INVOICE SETTINGS'}</button>
      </form>
    </section>
  );
}
