import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

interface QuoteSettings {
  quoteMarginPercent: number;
  minMarginPercent: number;
  maxMarginPercent: number;
}

interface Quote {
  id: number;
  quote_number: string;
  channel: string;
  external_user_id: string;
  service_name: string;
  status: string;
  margin_percent: number;
  subtotal_paise: number;
  total_paise: number;
  margin_paise: number;
  notes: string;
  created_at: string;
}

interface QuoteItem {
  id: number;
  item_code: string;
  description: string;
  unit: string;
  quantity: number;
  admin_unit_price_paise: number;
  quoted_unit_price_paise: number;
  line_total_paise: number;
}

interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
}

function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function fmtTime(v?: string): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

function fmtQuantity(value: number): string {
  return String(value);
}

export function Quotes({ refreshKey = 0 }: { refreshKey?: number }) {
  const [settings, setSettings] = useState<QuoteSettings | null>(null);
  const [margin, setMargin] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [marginError, setMarginError] = useState('');

  const load = useCallback(async () => {
    const [nextSettings, list] = await Promise.all([
      api<QuoteSettings>('/api/settings'),
      api<{ quotes: Quote[] }>('/api/quotes?limit=50'),
    ]);
    setSettings(nextSettings);
    setMargin(String(nextSettings.quoteMarginPercent));
    setMarginError('');
    setQuotes(list.quotes);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load quotes'));
  }, [load, refreshKey]);

  function rejectMargin(text: string) {
    setMarginError(text);
    setMessage('');
    if (settings) setMargin(String(settings.quoteMarginPercent));
  }

  function onMarginChange(value: string) {
    setMargin(value);
    setMarginError('');
    setMessage('');
  }

  async function saveMargin(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const value = Number(margin);
    if (!Number.isFinite(value) || value < settings.minMarginPercent || value > settings.maxMarginPercent) {
      rejectMargin(
        `Margin must be between ${settings.minMarginPercent} and ${settings.maxMarginPercent} percent. The saved value is still ${settings.quoteMarginPercent}%.`,
      );
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    setMarginError('');
    try {
      const updated = await api<QuoteSettings>('/api/settings/quote-margin', {
        method: 'PUT',
        body: JSON.stringify({ marginPercent: value }),
      });
      setSettings(updated);
      setMargin(String(updated.quoteMarginPercent));
      setMessage(`Markup updated to ${updated.quoteMarginPercent}%. New quotes will use it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the margin');
    } finally {
      setBusy(false);
    }
  }

  async function view(id: number) {
    setError('');
    try {
      setDetail(await api<QuoteDetail>(`/api/quotes/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the quote');
    }
  }

  return (
    <section className="card">
      <h2 className="panel-title">Quotes <span>pricing agent drafts</span></h2>

      {settings ? (
        <form className="form" onSubmit={saveMargin} noValidate>
          <label>Markup on admin prices (%)
            <input
              type="number"
              min={settings.minMarginPercent}
              max={settings.maxMarginPercent}
              step="0.25"
              value={margin}
              aria-invalid={marginError ? true : undefined}
              aria-describedby={marginError ? 'quote-margin-error' : undefined}
              onChange={(e) => onMarginChange(e.target.value)}
            />
          </label>
          <div className="toolbar">
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save markup'}</button>
            <button className="btn secondary" type="button" onClick={() => load().catch(() => undefined)}>Refresh quotes</button>
          </div>
          {marginError && <span id="quote-margin-error" className="error small" role="alert">{marginError}</span>}
          <span className="muted small">
            Allowed range {settings.minMarginPercent}–{settings.maxMarginPercent}%. Applies to new quotes; existing quotes keep the margin they were built with.
          </span>
        </form>
      ) : (
        <div className="muted small">Loading pricing settings…</div>
      )}

      {message && <div className="success" style={{ marginTop: 12 }}>{message}</div>}
      {error && <div className="card error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {quotes.length === 0 ? (
          <div className="muted small">
            No quotes yet. A draft is created when an intake is complete and the service has an active price table.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quote</th><th>Customer</th><th>Service</th><th>Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td className="mono">{quote.quote_number}</td>
                    <td>
                      <span className="mono small">{quote.external_user_id}</span>
                      <div className="muted small">{quote.channel}</div>
                    </td>
                    <td className="small">{quote.service_name}</td>
                    <td>{formatInr(quote.total_paise)}</td>
                    <td><span className="pill">{quote.status}</span></td>
                    <td><button className="btn secondary" type="button" onClick={() => view(quote.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div style={{ marginTop: 18 }}>
          <h3 className="small">
            {detail.quote.quote_number} · {detail.quote.margin_percent}% markup · <span className="pill">{detail.quote.status}</span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Description</th><th>Unit</th><th>Qty</th><th>Admin unit</th><th>Quoted unit</th><th>Line total</th></tr></thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.item_code}</td>
                    <td>{item.description}</td>
                    <td>{item.unit}</td>
                    <td>{fmtQuantity(item.quantity)}</td>
                    <td className="muted">{formatInr(item.admin_unit_price_paise)}</td>
                    <td>{formatInr(item.quoted_unit_price_paise)}</td>
                    <td>{formatInr(item.line_total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small" style={{ marginTop: 10 }}>
            Admin subtotal {formatInr(detail.quote.subtotal_paise)}
            {' · '}margin {formatInr(detail.quote.margin_paise)}
            {' · '}customer total <strong>{formatInr(detail.quote.total_paise)}</strong>
          </p>
          <p className="muted small">Created {fmtTime(detail.quote.created_at)}</p>
          {detail.quote.notes && <p className="muted small">Internal note: {detail.quote.notes}</p>}
        </div>
      )}
    </section>
  );
}
