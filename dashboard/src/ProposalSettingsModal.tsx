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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title">
            <strong>Proposal Settings</strong>
            <span className="pill">AUTO-FILL DEFAULTS</span>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="Close proposal settings">
            ✕
          </button>
        </div>

        {error && <div className="banner error">{error}</div>}

        {loading ? (
          <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>
            Loading proposal defaults…
          </div>
        ) : (
          <form onSubmit={handleSave} className="form">
            <div className="modal-section">
              <span className="stat-label">Our Company Details</span>
              <div className="form" style={{ gap: 12 }}>
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

            <div className="modal-section">
              <span className="stat-label">Sign-Off &amp; Signature</span>
              <div className="grid-2">
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

            <div className="modal-section">
              <span className="stat-label">Default Data &amp; Privacy Clause</span>
              <p className="small muted" style={{ margin: 0 }}>
                This clause is automatically placed into the Data Privacy section of every new proposal.
              </p>
              <textarea
                rows={6}
                value={defaultDataPrivacy}
                onChange={(e) => setDefaultDataPrivacy(e.target.value)}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}
                placeholder="Enter standard Data Privacy, Intellectual Property, and Confidentiality clauses…"
              />
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
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
