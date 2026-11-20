import { useEffect, useState } from 'react';
import { api } from './api';
import { SignaturePad } from './SignaturePad';

export interface ProposalTemplateSettingsData {
  ourCompanyName: string;
  ourCompanyDetails: string;
  signerName: string;
  signerDesignation: string;
  signerSignatureData: string;
  defaultDataPrivacy: string;
}

interface ProposalSettingsModalProps {
  onClose: () => void;
  onSaved: (settings: ProposalTemplateSettingsData) => void;
}

export function ProposalSettingsModal({ onClose, onSaved }: ProposalSettingsModalProps) {
  const [ourCompanyName, setOurCompanyName] = useState('Cosmiq OS');
  const [ourCompanyDetails, setOurCompanyDetails] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerDesignation, setSignerDesignation] = useState('Co-Founder');
  const [signerSignatureData, setSignerSignatureData] = useState('');
  const [defaultDataPrivacy, setDefaultDataPrivacy] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ProposalTemplateSettingsData>('/api/proposal-settings')
      .then((data) => {
        setOurCompanyName(data.ourCompanyName || 'Cosmiq OS');
        setOurCompanyDetails(data.ourCompanyDetails || '');
        setSignerName(data.signerName || '');
        setSignerDesignation(data.signerDesignation || 'Co-Founder');
        setSignerSignatureData(data.signerSignatureData || '');
        setDefaultDataPrivacy(data.defaultDataPrivacy || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load proposal settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await api<ProposalTemplateSettingsData>('/api/proposal-settings', {
        method: 'PUT',
        body: JSON.stringify({
          ourCompanyName: ourCompanyName.trim() || 'Cosmiq OS',
          ourCompanyDetails,
          signerName: signerName.trim(),
          signerDesignation: signerDesignation.trim() || 'Co-Founder',
          signerSignatureData,
          defaultDataPrivacy,
        }),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save proposal settings.');
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
          maxWidth: 720,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <div>
            <strong>PROPOSAL SETTINGS</strong>
            <span className="pill" style={{ marginLeft: 8 }}>AUTO-FILL DEFAULTS</span>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="Close proposal settings">
            ✕
          </button>
        </div>

        {error && <div className="banner error" style={{ marginBottom: 14 }}>{error}</div>}

        {loading ? (
          <div className="muted small" style={{ padding: 28, textAlign: 'center' }}>
            Loading proposal defaults…
          </div>
        ) : (
          <form onSubmit={handleSave} className="form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)' }}>
              <span className="stat-label">OUR COMPANY DETAILS (AUTO-FILLED ON EVERY PROPOSAL)</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 10 }}>
                <label>
                  Our Company Name
                  <input
                    type="text"
                    value={ourCompanyName}
                    onChange={(e) => setOurCompanyName(e.target.value)}
                    placeholder="Cosmiq OS"
                  />
                </label>
                <label>
                  Our Company Address / Tagline / Contact Details
                  <textarea
                    rows={2}
                    value={ourCompanyDetails}
                    onChange={(e) => setOurCompanyDetails(e.target.value)}
                    placeholder="AI Native Automation & System Solutions..."
                  />
                </label>
              </div>
            </div>

            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="stat-label">SIGNING OFF OPTIONS (OUR COMPANY SIGNER &amp; SIGNATURE)</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>
                  Signer Name
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="e.g. Rinshid VP"
                  />
                </label>
                <label>
                  Signer Designation
                  <input
                    type="text"
                    value={signerDesignation}
                    onChange={(e) => setSignerDesignation(e.target.value)}
                    placeholder="Co-Founder"
                  />
                </label>
              </div>

              <SignaturePad
                value={signerSignatureData}
                onChange={setSignerSignatureData}
                label="Authorized Company Signature (Printed inside Contract PDF)"
              />
            </div>

            <div style={{ background: 'var(--bg-elevated)', padding: 14, border: '1px solid var(--border-default)' }}>
              <span className="stat-label">DEFAULT DATA &amp; PRIVACY SECTION (AUTO-FILLED ON NEW PROPOSALS)</span>
              <p className="small muted" style={{ margin: '6px 0 8px' }}>
                This clause is automatically placed into the Data Privacy section of every new proposal.
              </p>
              <textarea
                rows={6}
                value={defaultDataPrivacy}
                onChange={(e) => setDefaultDataPrivacy(e.target.value)}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: 1.5 }}
                placeholder="Enter standard Data Privacy, Intellectual Property, and Confidentiality clauses…"
              />
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Proposal Settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
