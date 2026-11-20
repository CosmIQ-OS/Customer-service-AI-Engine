import { useEffect, useState } from 'react';
import { api } from './api';
import type { ProposalTemplateSettingsData } from './ProposalSettingsModal';
import { SignaturePad } from './SignaturePad';

interface IntakeItem {
  id: number;
  session_id: string;
  channel: string;
  external_user_id: string;
  company_name: string;
  company_size: string;
  current_tools: string;
  service_name: string;
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

interface NewContractProposalModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function NewContractProposalModal({ onClose, onSaved }: NewContractProposalModalProps) {
  const [intakes, setIntakes] = useState<IntakeItem[]>([]);
  const [leadMode, setLeadMode] = useState<'existing' | 'custom'>('existing');
  const [selectedIntakeId, setSelectedIntakeId] = useState('');

  // Company & Lead fields
  const [ourCompanyName, setOurCompanyName] = useState('Cosmiq OS');
  const [ourCompanyDetails, setOurCompanyDetails] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientDesignation, setClientDesignation] = useState('Director');
  const [channel, setChannel] = useState('direct');
  const [proposalDate, setProposalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<'pending' | 'sent' | 'accepted' | 'rejected'>('pending');

  // Optional sections (in user-specified order)
  const [scopeOfProject, setScopeOfProject] = useState('');
  const [phasesAndTimeline, setPhasesAndTimeline] = useState('');
  const [paymentSchedules, setPaymentSchedules] = useState('');
  const [successMetrics, setSuccessMetrics] = useState('');
  const [ongoingCost, setOngoingCost] = useState('');
  const [supportAndWarranty, setSupportAndWarranty] = useState('');
  const [dataPrivacy, setDataPrivacy] = useState('');

  // Signing options
  const [includeSigning, setIncludeSigning] = useState(true);
  const [signerName, setSignerName] = useState('');
  const [signerDesignation, setSignerDesignation] = useState('Co-Founder');
  const [signerSignatureData, setSignerSignatureData] = useState('');
  const [clientSignatureData, setClientSignatureData] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<IntakeItem[] | { intakes: IntakeItem[] }>('/api/intakes?limit=100').catch(() => []),
      api<ProposalTemplateSettingsData>('/api/proposal-settings').catch(() => null),
    ])
      .then(([intakeData, settingsData]) => {
        const rawIntakes = Array.isArray(intakeData) ? intakeData : (intakeData?.intakes || []);
        setIntakes(rawIntakes);
        if (settingsData) {
          setOurCompanyName(settingsData.ourCompanyName || 'Cosmiq OS');
          setOurCompanyDetails(settingsData.ourCompanyDetails || '');
          setSignerName(settingsData.signerName || '');
          setSignerDesignation(settingsData.signerDesignation || 'Co-Founder');
          setSignerSignatureData(settingsData.signerSignatureData || '');
          setDataPrivacy(settingsData.defaultDataPrivacy || '');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSelectIntake(intakeIdStr: string) {
    setSelectedIntakeId(intakeIdStr);
    const found = intakes.find((i) => String(i.id) === intakeIdStr);
    if (!found) return;

    const detectedEmail = detectEmailFromLead(found);
    setClientCompany(found.company_name || 'Client Company');
    setClientName(found.contact_person || found.company_name || '');
    setClientEmail(detectedEmail);
    setClientPhone(found.external_user_id || '');
    setChannel(found.channel || 'direct');
  }

  async function submitProposal(andDownloadPdf: boolean) {
    if (!clientCompany.trim()) {
      setError("Please select a lead or enter the customer's company name.");
      return;
    }

    setBusy(true);
    setError('');
    try {
      const selectedIntake = intakes.find((i) => String(i.id) === selectedIntakeId);
      const created = await api<{ id: number; proposal_number: string }>('/api/contract-proposals', {
        method: 'POST',
        body: JSON.stringify({
          intakeId: selectedIntake?.id ?? null,
          sessionId: selectedIntake?.session_id ?? null,
          channel: channel || 'direct',
          ourCompanyName: ourCompanyName.trim() || 'Cosmiq OS',
          ourCompanyDetails,
          clientCompany: clientCompany.trim(),
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          clientPhone: clientPhone.trim(),
          clientDesignation: clientDesignation.trim() || 'Director',
          proposalDate,
          scopeOfProject,
          phasesAndTimeline,
          paymentSchedules,
          successMetrics,
          ongoingCost,
          supportAndWarranty,
          dataPrivacy,
          includeSigning,
          signerName: signerName.trim(),
          signerDesignation: signerDesignation.trim() || 'Co-Founder',
          signerSignatureData,
          clientSignatureData,
          status,
        }),
      });

      if (andDownloadPdf && created.id) {
        const a = document.createElement('a');
        a.href = `/api/contract-proposals/${created.id}/pdf?download=1`;
        a.download = `${created.proposal_number || 'proposal'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save proposal.');
    } finally {
      setBusy(false);
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
        background: 'rgba(0,0,0,0.65)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 920,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <div>
            <strong>NEW BUSINESS PROPOSAL</strong>
            <span className="pill" style={{ marginLeft: 8 }}>CONTRACT PDF BUILDER</span>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="Close new proposal modal">
            ✕
          </button>
        </div>

        {error && <div className="banner error" style={{ marginBottom: 14 }}>{error}</div>}

        {loading ? (
          <div className="muted small" style={{ padding: 32, textAlign: 'center' }}>
            Loading leads &amp; proposal defaults…
          </div>
        ) : (
          <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Section A: Our Company & Customer's Company (Acquired from Lead) */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <span className="stat-label">PARTIES // OUR COMPANY &amp; CUSTOMER COMPANY</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className={`btn ${leadMode === 'existing' ? 'primary' : 'secondary'}`}
                    style={{ minHeight: 28, fontSize: '11px', padding: '2px 10px' }}
                    onClick={() => setLeadMode('existing')}
                  >
                    Acquire From Lead
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
                    Custom / Manual
                  </button>
                </div>
              </div>

              {leadMode === 'existing' && (
                <div style={{ marginBottom: 12 }}>
                  <label>
                    Select Inbound Lead
                    <select value={selectedIntakeId} onChange={(e) => handleSelectIntake(e.target.value)}>
                      <option value="">-- Choose a Lead from Website / WhatsApp --</option>
                      {intakes.map((intake) => (
                        <option key={intake.id} value={String(intake.id)}>
                          [{intake.channel === 'website' ? 'WEBSITE' : intake.channel.toUpperCase()}] {intake.company_name || 'Prospect'} — {intake.service_name || 'Inquiry'} ({intake.external_user_id})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Left: Our Company (Auto-filled) */}
                <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="mono muted" style={{ fontSize: '10.5px', fontWeight: 700 }}>
                    FROM // OUR COMPANY (AUTO-FILLED)
                  </span>
                  <label>
                    Our Company Name
                    <input
                      type="text"
                      value={ourCompanyName}
                      onChange={(e) => setOurCompanyName(e.target.value)}
                    />
                  </label>
                  <label>
                    Our Company Details
                    <textarea
                      rows={2}
                      value={ourCompanyDetails}
                      onChange={(e) => setOurCompanyDetails(e.target.value)}
                      style={{ minHeight: 54, fontSize: '12px' }}
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label>
                      Date
                      <input
                        type="date"
                        value={proposalDate}
                        onChange={(e) => setProposalDate(e.target.value)}
                      />
                    </label>
                    <label>
                      Initial Status
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as 'pending' | 'sent' | 'accepted' | 'rejected')}
                      >
                        <option value="pending">Pending</option>
                        <option value="sent">Sent</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Right: Customer Company (Acquired from Lead) */}
                <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="mono muted" style={{ fontSize: '10.5px', fontWeight: 700 }}>
                    TO // CUSTOMER COMPANY (FROM LEAD)
                  </span>
                  <label>
                    Customer Company Name *
                    <input
                      type="text"
                      required
                      value={clientCompany}
                      onChange={(e) => setClientCompany(e.target.value)}
                      placeholder="e.g. FQLab and Research Centre Pvt Ltd"
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label>
                      Lead / Contact Name
                      <input
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Authorized contact name"
                      />
                    </label>
                    <label>
                      Work Email
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="contact@company.com"
                      />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label>
                      Phone / User ID
                      <input
                        type="text"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="+91..."
                      />
                    </label>
                    <label>
                      Customer Designation
                      <input
                        type="text"
                        value={clientDesignation}
                        onChange={(e) => setClientDesignation(e.target.value)}
                        placeholder="Director"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Section B: Optional Proposal Content Sections */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span className="stat-label">PROPOSAL SECTIONS (ALL FIELDS OPTIONAL — EMPTY SECTIONS ARE OMITTED FROM PDF)</span>
              </div>

              <label>
                1. Scope of Project (Optional)
                <textarea
                  rows={3}
                  value={scopeOfProject}
                  onChange={(e) => setScopeOfProject(e.target.value)}
                  placeholder="Describe the project objectives, systems covered, and core deliverables…"
                />
              </label>

              <label>
                2. Phases and Timeline (Optional)
                <textarea
                  rows={3}
                  value={phasesAndTimeline}
                  onChange={(e) => setPhasesAndTimeline(e.target.value)}
                  placeholder="Outline delivery phases, pilot duration, milestones, and expected ship dates…"
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  3. Payment Schedules (Optional)
                  <textarea
                    rows={3}
                    value={paymentSchedules}
                    onChange={(e) => setPaymentSchedules(e.target.value)}
                    placeholder="Specify milestone amounts, triggers, and billing schedule…"
                  />
                </label>

                <label>
                  4. Success Metrics (Optional)
                  <textarea
                    rows={3}
                    value={successMetrics}
                    onChange={(e) => setSuccessMetrics(e.target.value)}
                    placeholder="Define acceptance & success criteria (e.g. verified workflows, response SLAs)…"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  5. Ongoing Cost (Optional)
                  <textarea
                    rows={3}
                    value={ongoingCost}
                    onChange={(e) => setOngoingCost(e.target.value)}
                    placeholder="Optional post-launch retainer, hosting, API usage, or recurring operational fees…"
                  />
                </label>

                <label>
                  6. Support and Warranty (Optional)
                  <textarea
                    rows={3}
                    value={supportAndWarranty}
                    onChange={(e) => setSupportAndWarranty(e.target.value)}
                    placeholder="Support hours, maintenance terms, bug-fix coverage, and response guarantees…"
                  />
                </label>
              </div>

              <label>
                7. Data Privacy (Optional — Auto-filled from Proposal Settings)
                <textarea
                  rows={4}
                  value={dataPrivacy}
                  onChange={(e) => setDataPrivacy(e.target.value)}
                  placeholder="Data protection, IP ownership, and confidentiality provisions…"
                />
              </label>
            </div>

            {/* Section C: Signing Section */}
            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span className="stat-label">8. SIGNING SECTION (OPTIONAL IN CONTRACT PDF)</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none', fontSize: '12px', color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={includeSigning}
                    onChange={(e) => setIncludeSigning(e.target.checked)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  Include Acceptance &amp; Signatures block in Contract PDF
                </label>
              </div>

              {includeSigning && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span className="mono muted" style={{ fontSize: '10.5px', fontWeight: 700 }}>
                      CLIENT SIGNATORY ({clientCompany || 'CUSTOMER'})
                    </span>
                    <label>
                      Lead Signer Name
                      <input
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Lead / Authorized signer name"
                      />
                    </label>
                    <label>
                      Lead Signer Designation
                      <input
                        type="text"
                        value={clientDesignation}
                        onChange={(e) => setClientDesignation(e.target.value)}
                        placeholder="Director"
                      />
                    </label>
                    <SignaturePad
                      value={clientSignatureData}
                      onChange={setClientSignatureData}
                      label="Client Signature (Optional in PDF)"
                    />
                  </div>

                  <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span className="mono muted" style={{ fontSize: '10.5px', fontWeight: 700 }}>
                      OUR SIGNATORY ({ourCompanyName || 'COSMIQ OS'})
                    </span>
                    <label>
                      Our Signer Name
                      <input
                        type="text"
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        placeholder="Co-Founder / Representative"
                      />
                    </label>
                    <label>
                      Our Signer Designation
                      <input
                        type="text"
                        value={signerDesignation}
                        onChange={(e) => setSignerDesignation(e.target.value)}
                        placeholder="Co-Founder"
                      />
                    </label>
                    <SignaturePad
                      value={signerSignatureData}
                      onChange={setSignerSignatureData}
                      label="Our Signature (Auto-filled from Settings)"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => submitProposal(false)}
              >
                {busy ? 'Saving…' : 'Save Proposal'}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => submitProposal(true)}
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
