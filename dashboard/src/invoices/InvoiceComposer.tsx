import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { InvoicePreview } from './InvoicePreview';
import type { ComposedInvoice, CustomerForm, CustomerOption, InvoiceLine, InvoiceSettings, LeadOption } from './types';

const blankCustomer: CustomerForm = {
  id: null, name: '', contactName: '', email: '', phone: '', address1: '', address2: '', city: '', state: '',
  postalCode: '', countryCode: 'IN', vatNumber: '', currency: 'INR',
};
const blankSettings: InvoiceSettings = {
  configured: false, companyName: '', address: '', taxNumber: '', logoUrl: '', currency: 'INR', defaultDueDays: 14,
  paymentInstructions: '', accountName: '', bankName: '', accountNumber: '', routingNumber: '', swiftCode: '', upiId: '', terms: '',
};
const customerFields: Array<{ key: keyof CustomerForm; label: string; type?: string }> = [
  { key: 'name', label: 'Customer / company *' }, { key: 'contactName', label: 'Contact person' },
  { key: 'email', label: 'Billing email', type: 'email' }, { key: 'phone', label: 'Phone' },
  { key: 'address1', label: 'Billing address' }, { key: 'address2', label: 'Address line 2' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'postalCode', label: 'Postal code' },
  { key: 'countryCode', label: 'Country code' }, { key: 'vatNumber', label: 'Tax / GST number' },
  { key: 'currency', label: 'Currency (ISO)' },
];

function isoDate(offset = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function InvoiceComposer({ onCancel, onSaved }: { onCancel: () => void; onSaved: (id: number) => void }) {
  const [sourceType, setSourceType] = useState<'lead' | 'customer'>('lead');
  const [sourceId, setSourceId] = useState('');
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerForm>(blankCustomer);
  const [settings, setSettings] = useState<InvoiceSettings>(blankSettings);
  const [quote, setQuote] = useState<ComposedInvoice['quote']>(null);
  const [items, setItems] = useState<InvoiceLine[]>([]);
  const [issueDate, setIssueDate] = useState(isoDate());
  const [dueDate, setDueDate] = useState(isoDate(14));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `invoice-${Date.now()}-${Math.random()}`);

  useEffect(() => {
    Promise.all([
      api<{ leads: LeadOption[]; customers: CustomerOption[] }>('/api/invoices/options'),
      api<InvoiceSettings>('/api/invoice-settings'),
    ]).then(([options, nextSettings]) => {
      setLeads(options.leads); setCustomers(options.customers); setSettings(nextSettings);
      setDueDate(isoDate(nextSettings.defaultDueDays));
    }).catch((err) => setError(err.message));
  }, []);

  async function chooseSource(id: string, type = sourceType) {
    setSourceId(id); setError(''); setQuote(null);
    if (!id) { setCustomer(blankCustomer); setItems([]); return; }
    setLoading(true);
    try {
      const payload = type === 'lead' ? { leadId: Number(id) } : { customerId: Number(id) };
      const composed = await api<ComposedInvoice>('/api/invoices/compose', { method: 'POST', body: JSON.stringify(payload) });
      setCustomer(composed.customer); setSettings(composed.settings); setItems(composed.items); setQuote(composed.quote);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  function updateItem(index: number, patch: Partial<InvoiceLine>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ invoice: { id: number } }>('/api/invoices', {
        method: 'POST', body: JSON.stringify({
          idempotencyKey: requestKey.current, leadId: sourceType === 'lead' ? Number(sourceId) : undefined,
          customerId: sourceType === 'customer' ? Number(sourceId) : undefined,
          customer, items, issueDate, dueDate, notes,
        }),
      });
      onSaved(result.invoice.id);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form className="invoice-composer" onSubmit={save}>
      <div className="invoice-preview-pane"><InvoicePreview customer={customer} settings={settings} items={items} issueDate={issueDate} dueDate={dueDate} notes={notes} /></div>
      <div className="invoice-controls">
        <div className="panel-title"><div><span className="kicker">NEW INVOICE</span><h2>Build from proposal</h2></div>
          <button className="btn secondary" type="button" onClick={onCancel}>BACK</button></div>
        {!settings.configured && <div className="banner error">Invoice Ninja is not configured. You can prepare the invoice, but saving requires its URL and API token.</div>}
        {error && <div className="banner error" role="alert">{error}</div>}
        <section className="invoice-form-section">
          <span className="kicker">01 // SOURCE</span>
          <div className="inline-form-row">
            <label>Record type<select value={sourceType} onChange={(event) => { const type = event.target.value as 'lead' | 'customer'; setSourceType(type); void chooseSource('', type); }}><option value="lead">Lead / intake</option><option value="customer">Existing customer</option></select></label>
            <label className="grow">Choose {sourceType}<select required value={sourceId} onChange={(event) => void chooseSource(event.target.value)}>
              <option value="">Select a {sourceType}…</option>
              {sourceType === 'lead' ? leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.company_name || lead.external_user_id} — {lead.service_name}</option>)
                : customers.map((item) => <option value={item.id} key={item.id}>{item.name} — {item.email || item.contact_name}</option>)}
            </select></label>
          </div>
          {loading && <p className="muted small">Loading customer and approved proposal…</p>}
          {sourceId && !loading && <p className="muted small">{quote ? `Imported customer prices from approved quote ${quote.quote_number}.` : 'No approved proposal was found. Add services manually below.'}</p>}
        </section>
        <section className="invoice-form-section"><span className="kicker">02 // CUSTOMER DETAILS</span>
          <div className="invoice-field-grid">{customerFields.map((field) => <label key={field.key}>{field.label}
            <input required={field.key === 'name'} type={field.type ?? 'text'} maxLength={field.key === 'currency' ? 3 : undefined} value={String(customer[field.key] ?? '')}
              onChange={(event) => setCustomer((current) => ({ ...current, [field.key]: event.target.value }))} />
          </label>)}</div>
        </section>
        <section className="invoice-form-section"><div className="panel-title"><span className="kicker">03 // SERVICES</span>
          <button type="button" className="btn secondary btn-sm" onClick={() => setItems((current) => [...current, { description: '', quantity: 1, unitPricePaise: 0 }])}>+ ADD ITEM</button></div>
          <div className="invoice-line-editor">{items.map((item, index) => <div className="invoice-line-row" key={index}>
            <input aria-label={`Item ${index + 1} description`} required placeholder="Service description" value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} />
            <label>Qty<input aria-label={`Item ${index + 1} quantity`} required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })} /></label>
            <label>Unit ({customer.currency})<input aria-label={`Item ${index + 1} unit price`} required type="number" min="0" step="0.01" value={item.unitPricePaise / 100} onChange={(event) => updateItem(index, { unitPricePaise: Math.round(Number(event.target.value) * 100) })} /></label>
            <button type="button" className="btn danger btn-sm" aria-label={`Remove item ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>)}</div>
        </section>
        <section className="invoice-form-section"><span className="kicker">04 // TERMS</span>
          <div className="inline-form-row"><label>Issue date<input type="date" required value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
            <label>Due date<input type="date" required value={dueDate} min={issueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
          <label>Customer-facing notes<textarea rows={4} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </section>
        <div className="invoice-save-actions"><button className="btn primary" type="submit" disabled={busy || !items.length || !settings.configured}>{busy ? 'CREATING…' : 'SAVE INVOICE DRAFT'}</button>
          <button className="btn secondary" type="button" onClick={onCancel}>CANCEL</button></div>
      </div>
    </form>
  );
}
