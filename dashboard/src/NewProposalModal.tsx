import { useState, useEffect } from 'react';
import { api } from './api';

interface ServiceItem {
  id: number;
  name: string;
  category: string;
  base_price_paise: number;
  status: string;
}

interface IntakeItem {
  id: number;
  session_id: string;
  channel: string;
  external_user_id: string;
  company_name: string;
  company_size: string;
  current_tools: string;
  service_name: string;
  service_id: number | null;
  email?: string;
  contact_person?: string;
}

function detectEmailFromLead(lead: IntakeItem): string {
  const candidates = [lead.email, lead.external_user_id, lead.company_name, lead.current_tools];
  for (const val of candidates) {
    if (!val) continue;
    const match = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(val);
    if (match) return match[0].trim();
  }
  return '';
}

interface ProposalLineItem {
  id: string;
  serviceId?: number | null;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceInr: number;
}

interface NewProposalModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function formatInr(num: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
}

export function NewProposalModal({ onClose, onSaved }: NewProposalModalProps) {
  const [intakes, setIntakes] = useState<IntakeItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [multipliers, setMultipliers] = useState<Record<string, number>>({
    '0-5': 1.0,
    '5-10': 1.5,
    '10-20': 2.0,
    '20+': 3.0,
  });

  const [leadMode, setLeadMode] = useState<'existing' | 'custom'>('existing');
  const [selectedIntakeId, setSelectedIntakeId] = useState<string>('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [channel, setChannel] = useState('direct');
  const [companySize, setCompanySize] = useState('5-10');

  const [items, setItems] = useState<ProposalLineItem[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [invoiceStatus, setInvoiceStatus] = useState<'pending' | 'paid'>('pending');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<{ intakes: IntakeItem[] }>('/api/intakes?limit=100').catch(() => ({ intakes: [] })),
      api<{ services: ServiceItem[] }>('/api/services').catch(() => ({ services: [] })),
      api<any>('/api/settings').catch(() => ({})),
    ])
      .then(([intakeData, serviceData, settingsData]) => {
        const rawIntakes = Array.isArray(intakeData) ? intakeData : (intakeData.intakes || []);
        const rawServices = Array.isArray(serviceData) ? serviceData : (serviceData.services || []);
        setIntakes(rawIntakes);
        setServices(rawServices);
        if (settingsData.companySizeMultipliers) {
          setMultipliers(settingsData.companySizeMultipliers);
        }
        if (settingsData.defaultTermsAndConditions) {
          setTerms(settingsData.defaultTermsAndConditions);
        }

        // If active services exist, pre-select first service
        const avail = rawServices.filter((s: ServiceItem) => s.status === 'available');
        if (avail.length > 0) {
          setSelectedServiceId(String(avail[0].id));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // When an existing intake lead is selected, auto-populate client fields including work email
  function handleSelectIntake(intakeIdStr: string) {
    setSelectedIntakeId(intakeIdStr);
    const found = intakes.find((i) => String(i.id) === intakeIdStr);
    if (!found) return;

    const detectedEmail = detectEmailFromLead(found);
    setClientName(found.company_name || found.contact_person || 'Client');
    setClientEmail(detectedEmail);
    setClientPhone(found.external_user_id || '');
    setChannel(found.channel || 'direct');
    if (found.company_size && ['0-5', '5-10', '10-20', '20+'].includes(found.company_size)) {
      setCompanySize(found.company_size);
    }

    // Auto-add service if intake specified one
    if (found.service_id) {
      const matchSvc = services.find((s) => s.id === found.service_id);
      if (matchSvc) {
        addServiceItem(matchSvc, found.company_size || companySize);
      }
    } else if (found.service_name) {
      const matchSvc = services.find((s) => s.name.toLowerCase() === found.service_name.toLowerCase());
      if (matchSvc) {
        addServiceItem(matchSvc, found.company_size || companySize);
      }
    }
  }

  function addServiceItem(svc: ServiceItem, sizeKey: string) {
    const mult = multipliers[sizeKey] ?? 1.0;
    const baseInr = (svc.base_price_paise || 0) / 100;
    const computedPrice = Math.round(baseInr * mult);

    const newItem: ProposalLineItem = {
      id: 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      serviceId: svc.id,
      itemCode: `SVC-${svc.id}`,
      description: svc.name,
      unit: 'deployment',
      quantity: 1,
      unitPriceInr: computedPrice > 0 ? computedPrice : 25000,
    };
    setItems((prev) => [...prev, newItem]);
  }

  function handleAddSelectedService() {
    if (!selectedServiceId) return;
    const svc = services.find((s) => String(s.id) === selectedServiceId);
    if (svc) {
      addServiceItem(svc, companySize);
    }
  }

  function handleAddCustomItem() {
    const newItem: ProposalLineItem = {
      id: 'custom-' + Date.now(),
      serviceId: null,
      itemCode: `CUSTOM-${items.length + 1}`,
      description: 'Custom Workflow Integration & Architecture',
      unit: 'milestone',
      quantity: 1,
      unitPriceInr: 30000,
    };
    setItems((prev) => [...prev, newItem]);
  }

  function handleItemChange(id: string, field: keyof ProposalLineItem, value: any) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  // Multiplier recalculation helper when company size changes
  function handleCompanySizeChange(newSize: string) {
    setCompanySize(newSize);
    const newMult = multipliers[newSize] ?? 1.0;
    // Update line items that are linked to catalog services
    setItems((prev) =>
      prev.map((it) => {
        if (!it.serviceId) return it;
        const svc = services.find((s) => s.id === it.serviceId);
        if (!svc) return it;
        const baseInr = (svc.base_price_paise || 0) / 100;
        return {
          ...it,
          unitPriceInr: Math.round(baseInr * newMult),
        };
      })
    );
  }

  const subtotalInr = items.reduce((sum, it) => sum + (it.quantity * it.unitPriceInr), 0);
  const totalInr = subtotalInr;

  async function submitInvoice(andDownloadPdf: boolean) {
    if (!clientName.trim()) {
      setError('Please provide a Client or Company name.');
      return;
    }
    if (items.length === 0) {
      setError('Please add at least one service or deliverable line item.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const selectedIntake = intakes.find((i) => String(i.id) === selectedIntakeId);

      const payload = {
        sessionId: selectedIntake?.session_id || null,
        channel: channel || 'direct',
        externalUserId: clientPhone || clientEmail || clientName,
        intakeId: selectedIntake?.id || null,
        clientName: clientName.trim(),
        clientEmail: clientEmail.trim() || undefined,
        companySize,
        serviceId: items[0]?.serviceId || null,
        serviceName: items[0]?.description || 'Commercial Invoice',
        marginPercent: 0,
        status: invoiceStatus,
        termsAndConditions: terms,
        notes,
        items: items.map((it) => ({
          serviceId: it.serviceId || null,
          itemCode: it.itemCode,
          description: it.description,
          unit: it.unit,
          quantity: it.quantity,
          unitPricePaise: Math.round(it.unitPriceInr * 100),
          lineTotalPaise: Math.round(it.quantity * it.unitPriceInr * 100),
        })),
      };

      const result = await api<any>('/api/proposals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (andDownloadPdf && result.id) {
        const downloadUrl = `/api/quotes/${result.id}/pdf`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${result.quote_number || 'invoice'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.65)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 840, background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        maxHeight: '92vh', overflowY: 'auto'
      }}>
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <div>
            <strong>NEW COMMERCIAL INVOICE</strong>
            <span className="pill" style={{ marginLeft: 8 }}>PDF GENERATOR</span>
          </div>
          <button type="button" className="banner-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="banner error" style={{ marginBottom: 14 }}>{error}</div>}

        {loading ? (
          <div className="muted small" style={{ padding: 32, textAlign: 'center' }}>Loading invoice components…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Step 1: Lead Selection */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 6, border: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="stat-label">STEP 01 // CHOOSE LEAD</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className={`btn ${leadMode === 'existing' ? 'primary' : 'secondary'}`}
                    style={{ minHeight: 28, fontSize: '11px', padding: '2px 10px' }}
                    onClick={() => setLeadMode('existing')}
                  >
                    Select From Inbound Leads
                  </button>
                  <button
                    type="button"
                    className={`btn ${leadMode === 'custom' ? 'primary' : 'secondary'}`}
                    style={{ minHeight: 28, fontSize: '11px', padding: '2px 10px' }}
                    onClick={() => {
                      setLeadMode('custom');
                      setSelectedIntakeId('');
                    }}
                  >
                    Custom / Manual Lead
                  </button>
                </div>
              </div>

              {leadMode === 'existing' ? (
                <div>
                  <label>
                    Inbound Lead / Intake
                    <select
                      value={selectedIntakeId}
                      onChange={(e) => handleSelectIntake(e.target.value)}
                    >
                      <option value="">-- Choose a Lead from WhatsApp / Website --</option>
                      {intakes.map((intake) => (
                        <option key={intake.id} value={String(intake.id)}>
                          [{intake.channel === 'website' ? '🌐 WEBSITE LEAD' : intake.channel.toUpperCase()}] {intake.company_name || 'Prospect'} — {intake.service_name || 'Inquiry'} ({intake.company_size || 'N/A'}) · {intake.external_user_id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 10 }}>
                <label>
                  Company / Client Name *
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Acme Corp Ltd"
                  />
                </label>

                <label>
                  Work Email
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="alex@acme.com"
                  />
                </label>

                <label>
                  Phone / User ID
                  <input
                    type="text"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </label>

                <label>
                  Invoice Status
                  <select
                    value={invoiceStatus}
                    onChange={(e) => setInvoiceStatus(e.target.value as 'pending' | 'paid')}
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid Invoice</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Step 2: Company Size Bracket & Multiplier */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 6, border: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className="stat-label">STEP 02 // COMPANY SIZE PRICING BRACKET</span>
                <span className="pill ok">ACTIVE MULTIPLIER: {multipliers[companySize] ?? 1.0}x</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {(['0-5', '5-10', '10-20', '20+'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    className={`btn ${companySize === tier ? 'primary' : 'secondary'}`}
                    style={{ minHeight: 34, fontSize: '11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                    onClick={() => handleCompanySizeChange(tier)}
                  >
                    <span>{tier} EMPLOYEES</span>
                    <span style={{ fontSize: '10px', opacity: 0.85 }}>({multipliers[tier]}x Multiplier)</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Services & Line Items */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 6, border: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="stat-label">STEP 03 // SERVICES &amp; PRICING DELIVERABLES</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    style={{ minHeight: 32, fontSize: '11px', maxWidth: 260 }}
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                  >
                    {services.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name} (Base ₹{(s.base_price_paise || 0) / 100})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ minHeight: 32, fontSize: '11px', padding: '0 12px' }}
                    onClick={handleAddSelectedService}
                  >
                    + Add Service
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ minHeight: 32, fontSize: '11px', padding: '0 10px' }}
                    onClick={handleAddCustomItem}
                  >
                    + Custom Item
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="muted small" style={{ padding: '24px 12px', textAlign: 'center', border: '1px dashed var(--border-default)', borderRadius: 4 }}>
                  No line items added yet. Click <strong>+ Add Service</strong> above to populate invoice deliverables.
                </div>
              ) : (
                <div className="table-wrap">
                  <table style={{ width: '100%', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th>Deliverable / Service</th>
                        <th style={{ width: 80 }}>Unit</th>
                        <th style={{ width: 70 }} className="num">Qty</th>
                        <th style={{ width: 130 }} className="num">Unit Price (₹)</th>
                        <th style={{ width: 110 }} className="num">Total (₹)</th>
                        <th style={{ width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                              style={{ width: '100%', padding: '4px 8px', fontSize: '12px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', fontSize: '11px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                              style={{ width: '100%', padding: '4px 6px', fontSize: '11px', textAlign: 'right' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="500"
                              value={item.unitPriceInr}
                              onChange={(e) => handleItemChange(item.id, 'unitPriceInr', Math.max(0, Number(e.target.value)))}
                              style={{ width: '100%', padding: '4px 8px', fontSize: '11px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                            />
                          </td>
                          <td className="num font-mono" style={{ fontWeight: 600 }}>
                            {formatInr(item.quantity * item.unitPriceInr)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="banner-close"
                              style={{ fontSize: '14px', color: 'var(--status-danger)' }}
                              onClick={() => handleRemoveItem(item.id)}
                              title="Remove item"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Total Calculation Strip */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Subtotal:</span>
                    <strong className="mono">{formatInr(subtotalInr)}</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--stone-900)', color: '#fff', borderRadius: 4, marginTop: 4 }}>
                    <strong>INVOICE TOTAL:</strong>
                    <strong className="mono" style={{ color: 'var(--accent-primary)', fontSize: '0.95rem' }}>{formatInr(totalInr)}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4: Terms & Notes */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 6, border: '1px solid var(--border-default)' }}>
              <span className="stat-label">STEP 04 // TERMS &amp; INTERNAL NOTES</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12, marginTop: 10 }}>
                <label>
                  Invoice Terms &amp; Conditions (Printed on PDF)
                  <textarea
                    rows={4}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    style={{ width: '100%', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    placeholder="Invoice terms and payment schedule…"
                  />
                </label>

                <label>
                  Internal Delivery / Scope Notes
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ width: '100%', fontSize: '11px' }}
                    placeholder="Internal team notes, specific stakeholder preferences, or deployment details…"
                  />
                </label>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => submitInvoice(false)}
              >
                {busy ? 'Saving…' : 'Save Invoice'}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => submitInvoice(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span>{busy ? 'Generating…' : 'Save & Download PDF'}</span>
                <span>↓</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
