import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { NewProposalModal } from './NewProposalModal';

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

const INVOICE_STATUS_OPTIONS = [
  { value: 'pending', label: 'PENDING' },
  { value: 'paid', label: 'PAID INVOICE' },
] as const;

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
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const list = await api<{ quotes: Quote[] }>('/api/quotes?limit=50');
    setQuotes(list.quotes);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load invoices'));
  }, [load, refreshKey]);

  async function updateInvoiceStatus(id: number, status: string) {
    setUpdatingId(id);
    setError('');
    setMessage('');
    try {
      const updated = await api<Quote>(`/api/quotes/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, ...updated } : q)));
      if (detail?.quote.id === id) {
        setDetail({ ...detail, quote: { ...detail.quote, ...updated } });
      }
      setMessage(`Invoice ${updated.quote_number} updated to ${status === 'paid' ? 'Paid Invoice' : status.toUpperCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update invoice status');
    } finally {
      setUpdatingId(null);
    }
  }

  async function view(id: number) {
    setError('');
    try {
      setDetail(await api<QuoteDetail>(`/api/quotes/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the invoice');
    }
  }

  return (
    <section className="card">
      <div className="panel-title">
        <div className="panel-title-group">
          <strong>Invoices</strong>
          <span className="sub-meta">Commercial billing &amp; client invoices</span>
        </div>
        <div className="toolbar">
          <button className="btn secondary btn-sm" type="button" onClick={() => load().catch(() => undefined)}>
            Refresh
          </button>
          <button
            type="button"
            className="btn primary btn-sm"
            onClick={() => setShowNewInvoice(true)}
          >
            <span>+</span>
            <span>NEW INVOICE</span>
          </button>
        </div>
      </div>

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
            No invoices yet. Click + NEW INVOICE to create a client invoice.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th className="act"></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => {
                  const hasKnownInvoiceStatus = INVOICE_STATUS_OPTIONS.some((o) => o.value === quote.status);
                  return (
                    <tr key={quote.id}>
                      <td className="mono">{quote.quote_number}</td>
                      <td>
                        <span className="mono small">{quote.external_user_id}</span>
                        <div className="muted small">{quote.channel}</div>
                      </td>
                      <td className="small">{quote.service_name}</td>
                      <td className="num">{formatInr(quote.total_paise)}</td>
                      <td>
                        <select
                          aria-label={`Invoice status for ${quote.quote_number}`}
                          className={`lead-status-select status-${quote.status}`}
                          value={quote.status}
                          disabled={updatingId === quote.id}
                          onChange={(e) => updateInvoiceStatus(quote.id, e.target.value)}
                        >
                          {!hasKnownInvoiceStatus && (
                            <option value={quote.status}>{quote.status.toUpperCase()}</option>
                          )}
                          {INVOICE_STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="act" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <a
                          className="btn secondary btn-sm"
                          href={`/api/quotes/${quote.id}/pdf`}
                          download={`${quote.quote_number}.pdf`}
                          title="Download Invoice PDF"
                        >
                          PDF ↓
                        </a>
                        <button
                          className="btn secondary btn-sm"
                          type="button"
                          onClick={() => view(quote.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
            <strong className="mono" style={{ fontSize: 'var(--text-base)' }}>
              {detail.quote.quote_number}
            </strong>
            <div className="toolbar">
              <a
                className="btn primary btn-sm"
                href={`/api/quotes/${detail.quote.id}/pdf`}
                download={`${detail.quote.quote_number}.pdf`}
              >
                <span>DOWNLOAD PDF</span>
                <span>↓</span>
              </a>
              <span className="pill">{detail.quote.status === 'paid' ? 'PAID INVOICE' : detail.quote.status.toUpperCase()}</span>
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
                  <th className="num">Unit Price</th>
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
                    <td className="num">{formatInr(item.quoted_unit_price_paise)}</td>
                    <td className="num">{formatInr(item.line_total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="quote-total-band">
            <span>SUBTOTAL: {formatInr(detail.quote.subtotal_paise)}</span>
            <span>INVOICE TOTAL: {formatInr(detail.quote.total_paise)}</span>
          </div>

          <p className="mono muted" style={{ fontSize: 'var(--text-xs)', margin: '12px 0 0' }}>
            Created · {fmtTime(detail.quote.created_at)}
          </p>
          {detail.quote.notes && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Internal note: {detail.quote.notes}
            </p>
          )}
        </div>
      )}

      {showNewInvoice && (
        <NewProposalModal
          onClose={() => setShowNewInvoice(false)}
          onSaved={() => {
            load().catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}
