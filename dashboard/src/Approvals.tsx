import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

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
  expires_at: string | null;
  next_alert_at: string | null;
  alert_count: number;
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

interface Notification {
  id: number;
  kind: string;
  quote_id: number | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

interface ApprovalsPayload {
  pending: Quote[];
  counts: { pending: number; unread: number; windowHours: number };
  notifications: Notification[];
}

function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

function fmtTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

export function Approvals({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [data, setData] = useState<ApprovalsPayload | null>(null);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [margin, setMargin] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setData(await api<ApprovalsPayload>('/api/approvals'));
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load approvals'));
  }, [load, refreshKey]);

  async function review(id: number) {
    setError('');
    setMessage('');
    try {
      const found = await api<QuoteDetail>(`/api/quotes/${id}`);
      setDetail(found);
      setMargin(String(found.quote.margin_percent));
      setQuantities(Object.fromEntries(found.items.map((item) => [item.id, String(item.quantity)])));
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the quote');
    }
  }

  function closeDetail() {
    setDetail(null);
  }

  function parsedQuantity(item: QuoteItem): number {
    return Number(quantities[item.id] ?? item.quantity);
  }

  function previewTotal(): number {
    if (!detail) return 0;
    const rate = Number(margin);
    if (!Number.isFinite(rate)) return 0;
    return detail.items.reduce((sum, item) => {
      const quantity = parsedQuantity(item);
      if (!Number.isFinite(quantity) || quantity <= 0) return sum;
      const quoted = Math.round(item.admin_unit_price_paise * (1 + rate / 100));
      return sum + Math.round(quoted * quantity);
    }, 0);
  }

  function validate(): string {
    if (!detail || !data) return '';
    const rate = Number(margin);
    if (!Number.isFinite(rate) || rate < 30 || rate > 35) {
      return 'Margin must be between 30 and 35 percent.';
    }
    for (const item of detail.items) {
      const quantity = parsedQuantity(item);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Quantity for ${item.item_code} must be greater than zero.`;
      }
    }
    return '';
  }

  async function saveEdits() {
    if (!detail) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      setMessage('');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await api<QuoteDetail>(`/api/quotes/${detail.quote.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          marginPercent: Number(margin),
          items: detail.items.map((item) => ({ id: item.id, quantity: parsedQuantity(item) })),
        }),
      });
      setDetail(updated);
      setQuantities(Object.fromEntries(updated.items.map((item) => [item.id, String(item.quantity)])));
      setMargin(String(updated.quote.margin_percent));
      setMessage(`Quote updated. Customer total is now ${formatInr(updated.quote.total_paise)}.`);
      onChanged?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the quote');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!detail) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      setMessage('');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const marginNum = Number(margin);
      const hasEdits =
        marginNum !== detail.quote.margin_percent ||
        detail.items.some((item) => parsedQuantity(item) !== item.quantity);
      if (hasEdits) {
        const updated = await api<QuoteDetail>(`/api/quotes/${detail.quote.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            marginPercent: marginNum,
            items: detail.items.map((item) => ({ id: item.id, quantity: parsedQuantity(item) })),
          }),
        });
        setDetail(updated);
      }
      const result = await api<{ quote: Quote; message: string; delivered: boolean }>(
        `/api/quotes/${detail.quote.id}/approve`,
        { method: 'POST' },
      );
      setDetail(null);
      setMessage(
        `Quote ${result.quote.quote_number} approved. ${
          result.delivered ? 'The customer received the itemized quote.' : 'The customer message was stored; channel delivery is pending.'
        }`,
      );
      onChanged?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve the quote');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!detail) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ quote: Quote; message: string; delivered: boolean }>(
        `/api/quotes/${detail.quote.id}/reject`,
        { method: 'POST', body: JSON.stringify({ note }) },
      );
      setDetail(null);
      setMessage(
        `Quote ${result.quote.quote_number} rejected. ${
          result.delivered ? 'The customer received a price-free handoff message.' : 'The handoff message was stored; channel delivery is pending.'
        }`,
      );
      onChanged?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject the quote');
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.pending ?? [];

  return (
    <section className="card">
      <h2 className="panel-title">
        <strong>Approval Queue</strong>
        <span>admins decide before any customer sees a price</span>
      </h2>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <span className="pill orange">{pending.length} awaiting approval</span>
      </div>

      {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="banner success" style={{ marginBottom: 12 }}>{message}</div>}

      {pending.length === 0 ? (
        <div
          className="muted small"
          style={{
            padding: '20px 14px',
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
          }}
        >
          No quotes are waiting for approval.
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
                <th className="num">Margin</th>
                <th>Waiting since</th>
                <th>Reminder</th>
                <th className="act"></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((quote) => (
                <tr key={quote.id}>
                  <td className="mono">{quote.quote_number}</td>
                  <td>
                    <span className="mono small">{quote.external_user_id}</span>
                    <div className="muted small">{quote.channel}</div>
                  </td>
                  <td className="small">{quote.service_name}</td>
                  <td className="num">{formatInr(quote.total_paise)}</td>
                  <td className="num">{quote.margin_percent}%</td>
                  <td className="mono muted">{fmtTime(quote.created_at)}</td>
                  <td className="muted small">
                    {quote.alert_count > 0 ? `${quote.alert_count} reminder(s) sent` : 'first alert sent'}
                    {quote.next_alert_at ? <div>next {fmtTime(quote.next_alert_at)}</div> : null}
                  </td>
                  <td className="act">
                    <button
                      className="btn secondary"
                      style={{ minHeight: 30, padding: '4px 10px', fontSize: '11px' }}
                      type="button"
                      onClick={() => review(quote.id)}
                      disabled={busy}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            padding: 16,
            marginTop: 16,
          }}
        >
          <div className="panel-title">
            <strong className="mono" style={{ fontSize: '0.92rem' }}>
              {detail.quote.quote_number} · {detail.quote.external_user_id}
            </strong>
            <span className="pill">{detail.quote.status}</span>
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
                    <td className="num">
                      <input
                        className="qty-input"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={quantities[item.id] ?? ''}
                        onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                      />
                    </td>
                    <td className="num muted">{formatInr(item.admin_unit_price_paise)}</td>
                    <td className="num">{formatInr(item.quoted_unit_price_paise)}</td>
                    <td className="num">{formatInr(item.line_total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form" style={{ marginTop: 14, maxWidth: 420 }}>
            <label>
              Margin (%)
              <input
                type="number"
                min="30"
                max="35"
                step="0.25"
                style={{ width: 140 }}
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
              />
            </label>
            <label>
              Internal rejection note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this quote rejected?" />
            </label>
          </div>

          <div className="quote-total-band">
            <span>ADMIN SUBTOTAL: {formatInr(detail.quote.subtotal_paise)}</span>
            <span>CURRENT TOTAL: {formatInr(detail.quote.total_paise)}</span>
            <span>PREVIEW TOTAL: {formatInr(previewTotal())}</span>
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn primary" type="button" onClick={approve} disabled={busy}>
              {busy ? 'Working…' : 'Approve & send quote'}
            </button>
            <button className="btn secondary" type="button" onClick={saveEdits} disabled={busy}>
              Save changes
            </button>
            <button className="btn danger" type="button" onClick={reject} disabled={busy}>
              Reject
            </button>
            <button className="btn secondary" type="button" onClick={closeDetail} disabled={busy}>
              Close
            </button>
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            Quantities and margin are editable. Item codes, descriptions, units, and admin prices stay locked to the price table.
          </p>
        </div>
      )}
    </section>
  );
}
