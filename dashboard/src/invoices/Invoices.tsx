import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { downloadInvoicePdf } from './api';
import { InvoiceComposer } from './InvoiceComposer';
import { formatMoney } from './InvoicePreview';
import { InvoiceSettings } from './InvoiceSettings';
import type { Invoice, InvoiceDetail, InvoiceStatus } from './types';

type View = 'list' | 'new' | 'settings' | 'detail';
const filters: Array<{ key: 'all' | InvoiceStatus; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'sent', label: 'Sent' }, { key: 'pending', label: 'Pending' },
  { key: 'paid', label: 'Paid' }, { key: 'discarded', label: 'Discarded' },
];

export function Invoices() {
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<'all' | InvoiceStatus>('all');
  const [query, setQuery] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const payload = await api<{ invoices: Invoice[] }>(`/api/invoices?status=${filter === 'all' ? '' : filter}&query=${encodeURIComponent(query)}`);
      setInvoices(payload.invoices);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }, [filter, query]);

  useEffect(() => { if (view === 'list') { const timer = setTimeout(() => void load(), 200); return () => clearTimeout(timer); } }, [view, load]);
  useEffect(() => { if (view === 'detail') setMessage(''); }, [view]);

  async function openDetail(id: number) {
    setError(''); setView('detail');
    try { setDetail(await api<InvoiceDetail>(`/api/invoices/${id}`)); } catch (err: any) { setError(err.message); }
  }

  async function action(name: 'send' | 'void' | 'archive') {
    if (!detail) return;
    if (name !== 'send' && !window.confirm(`${name === 'void' ? 'Cancel' : 'Archive'} this invoice in Invoice Ninja?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      setDetail(await api<InvoiceDetail>(`/api/invoices/${detail.invoice.id}/${name}`, { method: 'POST' }));
      setMessage(name === 'send' ? 'Invoice emailed through Invoice Ninja.' : `Invoice ${name === 'void' ? 'cancelled' : 'archived'}.`);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function download(invoice: Invoice) {
    setError('');
    try { await downloadInvoicePdf(invoice.id, invoice.invoice_number); } catch (err: any) { setError(err.message); }
  }

  if (view === 'new') return <InvoiceComposer onCancel={() => setView('list')} onSaved={(id) => void openDetail(id)} />;
  if (view === 'settings') return <InvoiceSettings onBack={() => setView('list')} />;
  if (view === 'detail') return (
    <section className="card">
      <div className="panel-title"><div><span className="kicker">INVOICE // DETAIL</span><h2>{detail?.invoice.invoice_number || 'Loading invoice…'}</h2></div>
        <button className="btn secondary" onClick={() => { setDetail(null); setView('list'); }}>BACK TO INVOICES</button></div>
      {error && <div className="banner error">{error}</div>}{message && <div className="banner success">{message}</div>}
      {!detail ? <p className="muted">Loading invoice detail…</p> : <>
        <div className="invoice-detail-head"><div><span className="kicker">CUSTOMER</span><h3>{detail.invoice.customer_name}</h3><p className="muted small">{detail.customer.email} · {detail.customer.phone}</p></div>
          <div className="invoice-detail-total"><span className="pill">{detail.invoice.status}</span><strong>{formatMoney(detail.invoice.total_paise, detail.invoice.currency)}</strong><span className="muted small">Balance {formatMoney(detail.invoice.balance_paise, detail.invoice.currency)}</span></div></div>
        <p className="mono muted small">{detail.invoice.quote_number ? `PROPOSAL ${detail.invoice.quote_number}` : 'MANUAL INVOICE'} · ISSUE {detail.invoice.issue_date} · DUE {detail.invoice.due_date}</p>
        {detail.invoice.sync_error && <div className="banner error">Last sync: {detail.invoice.sync_error}</div>}
        <div className="toolbar invoice-actions">
          <button className="btn secondary" onClick={() => void download(detail.invoice)}>DOWNLOAD PDF</button>
          {detail.invoice.status === 'pending' && <button className="btn primary" disabled={busy} onClick={() => void action('send')}>SEND INVOICE</button>}
          {(detail.invoice.status === 'sent' || (detail.invoice.status === 'pending' && detail.invoice.sent_at)) && <button className="btn danger" disabled={busy} onClick={() => void action('void')}>CANCEL / VOID</button>}
          <button className="btn secondary" disabled={busy || detail.invoice.status === 'discarded'} onClick={() => void action('archive')}>ARCHIVE</button>
        </div>
        <div className="invoice-detail-grid"><div><div className="table-wrap"><table><thead><tr><th>Service</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th></tr></thead>
          <tbody>{detail.items.map((item) => <tr key={item.id}><td>{item.description}</td><td className="num">{item.quantity}</td><td className="num">{formatMoney(item.unit_price_paise, detail.invoice.currency)}</td><td className="num">{formatMoney(item.line_total_paise, detail.invoice.currency)}</td></tr>)}</tbody></table></div>
          {detail.invoice.notes && <p className="invoice-note">{detail.invoice.notes}</p>}</div>
          <iframe className="invoice-pdf-frame" title={`PDF preview ${detail.invoice.invoice_number}`} src={`/api/invoices/${detail.invoice.id}/pdf`} /></div>
      </>}
    </section>
  );

  return (
    <section className="card">
      <div className="panel-title"><div><span className="kicker">FINANCE // INVOICES</span><h2>Invoices</h2></div>
        <button className="btn secondary invoice-settings-button" type="button" title="Company and payment settings" aria-label="Invoice settings" onClick={() => setView('settings')}>⚙</button></div>
      <div className="invoice-list-toolbar"><button className="btn primary" onClick={() => setView('new')}>+ NEW INVOICE</button>
        <input className="search-input" aria-label="Search invoices" placeholder="Search invoice, customer or proposal…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn secondary" onClick={() => void load()}>REFRESH</button></div>
      <div className="invoice-filters" aria-label="Invoice status filters">{filters.map((item) => <button key={item.key} className={`inbox-filter-btn ${filter === item.key ? 'active' : ''}`} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
      {error && <div className="banner error">{error}</div>}
      {loading ? <p className="muted">Loading invoices…</p> : invoices.length === 0 ? <div className="invoice-empty"><strong>No invoices found</strong><p className="muted small">Create an invoice from a qualified lead or an existing customer.</p><button className="btn primary" onClick={() => setView('new')}>CREATE FIRST INVOICE</button></div> :
        <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Proposal</th><th>Issue / due</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th><th className="act">Actions</th></tr></thead>
          <tbody>{invoices.map((invoice) => <tr key={invoice.id}><td className="mono"><strong>{invoice.invoice_number || `DRAFT #${invoice.id}`}</strong></td>
            <td>{invoice.customer_name}</td><td className="mono small">{invoice.quote_number || '—'}</td><td className="mono small">{invoice.issue_date}<br />{invoice.due_date}</td>
            <td className="num">{formatMoney(invoice.total_paise, invoice.currency)}</td><td className="num">{formatMoney(invoice.balance_paise, invoice.currency)}</td>
            <td><span className={`pill ${invoice.status === 'paid' ? 'ok' : invoice.status === 'discarded' ? 'danger' : invoice.status === 'sent' ? 'sky' : 'acc'}`}>{invoice.remote_status === '3' ? 'partial' : invoice.status}</span></td>
            <td className="act"><div className="toolbar"><button className="btn secondary btn-sm" onClick={() => void openDetail(invoice.id)}>VIEW</button><button className="btn secondary btn-sm" onClick={() => void download(invoice)}>PDF</button></div></td></tr>)}</tbody></table></div>}
    </section>
  );
}
