import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { NewProposalModal } from './NewProposalModal';

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
  const [showNewProposal, setShowNewProposal] = useState(false);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 className="panel-title" style={{ margin: 0 }}>
          <strong>PROPOSALS &amp; QUOTES</strong>
          <span>Commercial drafts &amp; client proposals</span>
        </h2>
        <button
          type="button"
          className="btn primary"
          onClick={() => setShowNewProposal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span>+</span>
          <span>NEW PROPOSAL</span>
        </button>
      </div>

      {settings ? (
        <form className="form" onSubmit={saveMargin} noValidate>
          <div className="inline-form-row">
            <label style={{ width: 200 }}>
              Markup on admin prices (%)
              <input
                type="number"
                min={settings.minMarginPercent}
                max={settings.maxMarginPercent}
                step="0.25"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                value={margin}
                aria-invalid={marginError ? true : undefined}
                aria-describedby={marginError ? 'quote-margin-error' : undefined}
                onChange={(e) => onMarginChange(e.target.value)}
              />
            </label>
            <div className="toolbar">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save markup'}
              </button>
              <button className="btn secondary" type="button" onClick={() => load().catch(() => undefined)}>
                Refresh quotes
              </button>
            </div>
          </div>
          {marginError && (
            <span id="quote-margin-error" className="banner error" style={{ marginBottom: 0 }} role="alert">
              {marginError}
            </span>
          )}
          <span className="muted small">
            Allowed range {settings.minMarginPercent}–{settings.maxMarginPercent}%. Applies to new quotes; existing quotes keep the margin they were built with.
          </span>
        </form>
      ) : (
        <div className="muted small">Loading pricing settings…</div>
      )}

      {message && <div className="banner success" style={{ marginTop: 14 }}>{message}</div>}
      {error && <div className="banner error" style={{ marginTop: 14 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {quotes.length === 0 ? (
          <div
            className="muted small"
            style={{
              padding: '20px 14px',
              textAlign: 'center',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
            }}
          >
            No quotes yet. A draft is created when an intake is complete and the service has an active price table.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th className="act"></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td className="mono">{quote.quote_number}</td>
                    <td>
                      <span className="mono small">{quote.external_user_id}</span>
                      <div className="muted small">{quote.channel}</div>
                    </td>
                    <td className="small">{quote.service_name}</td>
                    <td className="num">{formatInr(quote.total_paise)}</td>
                    <td><span className="pill">{quote.status}</span></td>
                    <td className="act" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <a
                        className="btn secondary"
                        style={{ minHeight: 30, padding: '4px 8px', fontSize: '11px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                        href={`/api/quotes/${quote.id}/pdf`}
                        download={`${quote.quote_number}.pdf`}
                        title="Download Branded Vector PDF"
                      >
                        PDF ↓
                      </a>
                      <button
                        className="btn secondary"
                        style={{ minHeight: 30, padding: '4px 10px', fontSize: '11px' }}
                        type="button"
                        onClick={() => view(quote.id)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
          }}
        >
          <div className="panel-title">
            <strong className="mono" style={{ fontSize: '0.92rem' }}>
              {detail.quote.quote_number} · {detail.quote.margin_percent}% markup
            </strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a
                className="btn primary"
                style={{ minHeight: 28, padding: '2px 12px', fontSize: '11px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                href={`/api/quotes/${detail.quote.id}/pdf`}
                download={`${detail.quote.quote_number}.pdf`}
              >
                <span>DOWNLOAD PDF</span>
                <span>↓</span>
              </a>
              <span className="pill">{detail.quote.status}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Unit</th>
                  <th className="num">Qty</th>
                  <th className="num">Admin unit</th>
                  <th className="num">Quoted unit</th>
                  <th className="num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.item_code}</td>
                    <td>{item.description}</td>
                    <td>{item.unit}</td>
                    <td className="num">{fmtQuantity(item.quantity)}</td>
                    <td className="num muted">{formatInr(item.admin_unit_price_paise)}</td>
                    <td className="num">{formatInr(item.quoted_unit_price_paise)}</td>
                    <td className="num">{formatInr(item.line_total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="quote-total-band">
            <span>ADMIN SUBTOTAL: {formatInr(detail.quote.subtotal_paise)}</span>
            <span>MARGIN: {formatInr(detail.quote.margin_paise)}</span>
            <span>CUSTOMER TOTAL: {formatInr(detail.quote.total_paise)}</span>
          </div>

          <p className="mono muted" style={{ fontSize: '11px', margin: '10px 0 0' }}>
            CREATED // {fmtTime(detail.quote.created_at)}
          </p>
          {detail.quote.notes && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Internal note: {detail.quote.notes}
            </p>
          )}
        </div>
      )}

      {showNewProposal && (
        <NewProposalModal
          onClose={() => setShowNewProposal(false)}
          onSaved={() => {
            load().catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}
