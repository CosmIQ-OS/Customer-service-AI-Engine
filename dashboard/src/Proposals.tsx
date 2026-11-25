import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { NewContractProposalModal } from './NewContractProposalModal';
import { ProposalSettingsModal } from './ProposalSettingsModal';

export interface ContractProposalRow {
  id: number;
  proposal_number: string;
  our_company_name: string;
  client_company: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  proposal_date: string;
  scope_of_project: string;
  phases_and_timeline: string;
  payment_schedules: string;
  success_metrics: string;
  ongoing_cost: string;
  support_and_warranty: string;
  data_privacy: string;
  include_signing: boolean;
  status: 'sent' | 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

const PROPOSAL_STATUS_OPTIONS = [
  { value: 'pending', label: 'PENDING' },
  { value: 'sent', label: 'SENT' },
  { value: 'accepted', label: 'ACCEPTED' },
  { value: 'rejected', label: 'REJECTED' },
] as const;

function countPopulatedSections(p: ContractProposalRow): string[] {
  const names: string[] = [];
  if (p.scope_of_project?.trim()) names.push('Scope');
  if (p.phases_and_timeline?.trim()) names.push('Timeline');
  if (p.payment_schedules?.trim()) names.push('Payments');
  if (p.success_metrics?.trim()) names.push('Metrics');
  if (p.ongoing_cost?.trim()) names.push('Ongoing Cost');
  if (p.support_and_warranty?.trim()) names.push('Support');
  if (p.data_privacy?.trim()) names.push('Data Privacy');
  if (p.include_signing) names.push('Signing');
  return names;
}

export function Proposals({ refreshKey = 0 }: { refreshKey?: number }) {
  const [proposals, setProposals] = useState<ContractProposalRow[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api<{ proposals: ContractProposalRow[] }>('/api/contract-proposals?limit=100');
      setProposals(res.proposals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load proposals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);

  async function updateStatus(id: number, status: 'sent' | 'pending' | 'accepted' | 'rejected') {
    setUpdatingId(id);
    setError('');
    setMessage('');
    try {
      const updated = await api<ContractProposalRow>(`/api/contract-proposals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setProposals((prev) => prev.map((row) => (row.id === id ? { ...row, ...updated } : row)));
      setMessage(`Proposal ${updated.proposal_number} status updated to ${status.toUpperCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update proposal status');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <section className="card" style={{ width: '100%' }}>
      <div className="panel-title">
        <div className="panel-title-group">
          <strong>Proposals</strong>
          <span className="pill">{proposals.length} PROPOSALS</span>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => load().catch(() => undefined)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn secondary btn-icon"
            onClick={() => setShowSettingsModal(true)}
            aria-label="Proposal Settings"
            title="Proposal Settings: Edit Sign-off Name, Signature & Default Data Privacy"
            style={{ fontSize: '16px' }}
          >
            ⚙
          </button>
          <button
            type="button"
            className="btn primary btn-sm"
            onClick={() => setShowNewModal(true)}
          >
            <span>+</span>
            <span>NEW PROPOSAL</span>
          </button>
        </div>
      </div>

      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      {/* Full-width centered proposals table */}
      <div style={{ width: '100%', margin: '0 auto' }}>
        {loading ? (
          <div className="muted small" style={{ padding: 28, textAlign: 'center' }}>
            Loading proposals…
          </div>
        ) : proposals.length === 0 ? (
          <div
            className="muted small"
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
            }}
          >
            No business proposals created yet. Click <strong>+ NEW PROPOSAL</strong> in the top-left corner to build your first contract PDF.
          </div>
        ) : (
          <div className="table-wrap" style={{ width: '100%' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Proposal #</th>
                  <th>Customer Company</th>
                  <th>Lead / Contact</th>
                  <th>Sections</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const sections = countPopulatedSections(p);
                  return (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontWeight: 700 }}>{p.proposal_number}</td>
                      <td>
                        <strong>{p.client_company || '—'}</strong>
                        <div className="muted small">From: {p.our_company_name || 'Cosmiq OS'}</div>
                      </td>
                      <td>
                        <div>{p.client_name || '—'}</div>
                        <div className="muted small mono">
                          {p.client_email || p.client_phone || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {sections.length > 0 ? (
                            sections.map((s) => (
                              <span key={s} className="tag">
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="muted small">Header only</span>
                          )}
                        </div>
                      </td>
                      <td className="mono small">{p.proposal_date || p.created_at.slice(0, 10)}</td>
                      <td>
                        <select
                          aria-label={`Proposal status for ${p.proposal_number}`}
                          className={`lead-status-select status-${p.status}`}
                          value={p.status}
                          disabled={updatingId === p.id}
                          onChange={(e) =>
                            updateStatus(
                              p.id,
                              e.target.value as 'sent' | 'pending' | 'accepted' | 'rejected',
                            )
                          }
                        >
                          {PROPOSAL_STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="act">
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <a
                            className="btn secondary btn-sm"
                            href={`/api/contract-proposals/${p.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View Proposal PDF in new tab"
                          >
                            <span>View</span>
                            <span>↗</span>
                          </a>
                          <a
                            className="btn primary btn-sm"
                            href={`/api/contract-proposals/${p.id}/pdf?download=1`}
                            download={`${p.proposal_number}.pdf`}
                            title="Download Proposal PDF"
                          >
                            <span>Download</span>
                            <span>↓</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewContractProposalModal
          onClose={() => setShowNewModal(false)}
          onSaved={() => {
            setMessage('Proposal saved and added to table.');
            load().catch(() => undefined);
          }}
        />
      )}

      {showSettingsModal && (
        <ProposalSettingsModal
          onClose={() => setShowSettingsModal(false)}
          onSaved={() => {
            setMessage('Proposal defaults & signature saved.');
          }}
        />
      )}
    </section>
  );
}
