import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type AdminMe } from './api';
import { LoginView } from './Login';
import { PriceTables } from './PriceTables';
import { Quotes } from './Quotes';
import { Proposals } from './Proposals';
import { Approvals } from './Approvals';
import { LiveConversations } from './LiveConversations';
import { NotificationBell } from './NotificationBell';
import type { NotificationTarget } from './useNotificationAlerts';
import { ServiceModal } from './ServiceModal';
import { ServiceSettingsModal } from './ServiceSettingsModal';
import {
  CosmiqMark,
  fmtTime,
  formatInr,
  LEAD_STATUS_OPTIONS,
  matchesIntakeDateFilter,
  normalizeLeadStatus,
  Pill,
  Table,
  type AnyRow,
  type IntakeDateFilter,
  type IntakeStatusFilter,
} from './components/UiPrimitives';
import { LogsAndSimulatorTab } from './components/LogsAndSimulatorTab';

type TabKey = 'overview' | 'inbox' | 'intakes' | 'quotes' | 'proposals' | 'services' | 'logs';
type ThemeMode = 'light' | 'dark';

function getInitialTheme(): ThemeMode {
  try {
    return localStorage.getItem('tandem-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [requests, setRequests] = useState<AnyRow[]>([]);
  const [logs, setLogs] = useState<AnyRow[]>([]);
  const [services, setServices] = useState<AnyRow[]>([]);
  const [intakes, setIntakes] = useState<AnyRow[]>([]);
  const [approvalsCount, setApprovalsCount] = useState<number>(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [intakeSearch, setIntakeSearch] = useState('');
  const [intakeChannelFilter, setIntakeChannelFilter] = useState<'all' | 'website' | 'whatsapp' | 'telegram'>('all');
  const [intakeDateFilter, setIntakeDateFilter] = useState<IntakeDateFilter>('all');
  const [intakeStatusFilter, setIntakeStatusFilter] = useState<IntakeStatusFilter>('all');
  const [updatingLeadId, setUpdatingLeadId] = useState<number | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
  const [highlightedLead, setHighlightedLead] = useState<{ intakeId?: number | null; sessionId?: string | null } | null>(null);
  const [inboxSessionId, setInboxSessionId] = useState<string | null>(null);

  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  async function toggleServiceStatus(s: any) {
    const nextStatus =
      s.status === 'available'
        ? 'limited'
        : s.status === 'limited'
          ? 'maintenance'
          : s.status === 'maintenance'
            ? 'unavailable'
            : 'available';
    try {
      await api(`/api/services/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      load(false);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    }
  }

  async function deleteService(s: any) {
    if (!window.confirm(`Are you sure you want to delete "${s.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/services/${s.id}`, { method: 'DELETE' });
      load(false);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Could not delete service');
    }
  }

  async function updateLeadStatus(id: number, status: string) {
    setUpdatingLeadId(id);
    setError('');
    try {
      const updated = await api<AnyRow>(`/api/intakes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setIntakes((prev) => prev.map((row) => (row.id === id ? { ...row, ...updated } : row)));
      load(false);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Could not update lead status');
    } finally {
      setUpdatingLeadId(null);
    }
  }

  async function deleteLead(lead: AnyRow) {
    const name = lead.company_name || lead.external_user_id || `Lead #${lead.id}`;
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingLeadId(lead.id);
    setError('');
    try {
      await api(`/api/intakes/${lead.id}`, { method: 'DELETE' });
      setIntakes((prev) => prev.filter((row) => row.id !== lead.id));
      load(false);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Could not delete lead');
    } finally {
      setDeletingLeadId(null);
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tandem-theme', theme);
    } catch {
      // ignore storage failure
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  const loadSeqRef = useRef(0);
  const load = useCallback(async (showLoading = true) => {
    const seq = ++loadSeqRef.current;
    if (showLoading) {
      setLoading(true);
      setError('');
    }
    try {
      const [s, r, l, sv, int, apprv] = await Promise.all([
        api<any>('/api/dashboard/summary'),
        api<AnyRow[]>('/api/requests?limit=50'),
        api<AnyRow[]>('/api/logs?limit=100'),
        api<AnyRow[]>('/api/services'),
        api<AnyRow[]>('/api/intakes?limit=100'),
        api<{ pending: any[] }>('/api/approvals').catch(() => ({ pending: [] })),
      ]);
      if (seq !== loadSeqRef.current) return;
      setSummary(s);
      setRequests(r);
      setLogs(l);
      setServices(sv);
      setIntakes(int);
      setApprovalsCount(apprv?.pending?.length ?? 0);
      setDataVersion((version) => version + 1);
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setAdmin(null);
        return;
      }
      if (showLoading) {
        setError(e.message || 'Failed to connect to the backend server.');
      }
    } finally {
      if (showLoading && seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<{ admin: AdminMe }>('/api/auth/me')
      .then((result) => setAdmin(result.admin))
      .catch(() => setAdmin(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!admin) return;
    load(true);
    const interval = setInterval(() => {
      load(false);
    }, 4000);
    return () => clearInterval(interval);
  }, [admin, load]);

  const handleNotificationNavigate = useCallback((target: NotificationTarget) => {
    setActiveTab(target.tab);
    if (target.tab === 'inbox' && target.sessionId) {
      setInboxSessionId(target.sessionId);
    } else if (target.tab === 'intakes' && (target.intakeId || target.sessionId)) {
      setIntakeSearch('');
      setIntakeChannelFilter('all');
      setIntakeDateFilter('all');
      setIntakeStatusFilter('all');
      setHighlightedLead({ intakeId: target.intakeId, sessionId: target.sessionId });
    }
  }, []);

  const scrolledHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightedLead || activeTab !== 'intakes') return;
    const key = `${highlightedLead.intakeId ?? ''}:${highlightedLead.sessionId ?? ''}`;
    if (scrolledHighlightRef.current === key) return;
    const match = intakes.find(
      (row) =>
        (highlightedLead.intakeId != null && row.id === highlightedLead.intakeId) ||
        (highlightedLead.sessionId && row.session_id === highlightedLead.sessionId),
    );
    if (match) {
      scrolledHighlightRef.current = key;
      requestAnimationFrame(() => {
        const el = document.getElementById(`lead-row-${match.id}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [highlightedLead, activeTab, intakes]);

  useEffect(() => {
    if (!highlightedLead) {
      scrolledHighlightRef.current = null;
      return;
    }
    const timer = setTimeout(() => setHighlightedLead(null), 6000);
    return () => clearTimeout(timer);
  }, [highlightedLead]);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAdmin(null);
  }

  if (!authChecked) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="kicker">COSMIQ OS // INITIALIZING</div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Connecting to Support &amp; Quotation Workbench…
          </p>
        </div>
      </div>
    );
  }

  if (!admin) return <LoginView onLogin={setAdmin} theme={theme} onToggleTheme={toggleTheme} />;

  const websiteIntakesCount = intakes.filter((i) => i.channel?.toLowerCase() === 'website').length;
  const whatsappIntakesCount = intakes.filter((i) => i.channel?.toLowerCase() === 'whatsapp').length;
  const telegramIntakesCount = intakes.filter((i) => i.channel?.toLowerCase() === 'telegram').length;
  const todaysIntakesCount = intakes.filter((i) => matchesIntakeDateFilter(i, 'today')).length;
  const hasActiveIntakeFilters =
    Boolean(intakeSearch.trim()) ||
    intakeChannelFilter !== 'all' ||
    intakeDateFilter !== 'all' ||
    intakeStatusFilter !== 'all';

  const filteredIntakes = intakes.filter((row) => {
    const q = intakeSearch.toLowerCase().trim();
    const matchSearch =
      !q ||
      row.company_name?.toLowerCase().includes(q) ||
      row.service_name?.toLowerCase().includes(q) ||
      row.current_tools?.toLowerCase().includes(q) ||
      row.external_user_id?.toLowerCase().includes(q);

    if (!matchSearch) return false;
    if (intakeChannelFilter !== 'all' && row.channel?.toLowerCase() !== intakeChannelFilter) return false;
    if (intakeStatusFilter !== 'all' && normalizeLeadStatus(row.status) !== intakeStatusFilter) return false;
    if (!matchesIntakeDateFilter(row, intakeDateFilter)) return false;
    return true;
  });

  const availableServicesCount = summary?.counts?.availableServices ?? services.filter((s) => s.status === 'available').length;
  const completeIntakesCount = summary?.counts?.completeIntakes ?? intakes.filter((i) => normalizeLeadStatus(i.status) !== 'collecting').length;

  return (
    <div className="app">
      {/* Editorial Command Header */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-mark" role="img" aria-label="CosmIQ">
            <CosmiqMark />
          </div>
          <div className="brand-text">
            <h1>
              <span>COSMIQ OS</span>
            </h1>
            <p>Deterministic quotations, WhatsApp enquiry routing &amp; human handover</p>
          </div>
        </div>

        <div className="toolbar">
          <div className="ai-confidence-pill">
            <span className="ai-pulse-dot" />
            <span>LIMS &amp; WHATSAPP ENGINE ACTIVE</span>
          </div>

          <NotificationBell
            refreshKey={dataVersion}
            onNavigate={handleNotificationNavigate}
            onNotificationArrived={() => {
              void load(false);
            }}
          />

          <button
            type="button"
            className="theme-btn"
            onClick={toggleTheme}
            title="Switch Tandem Warm Paper / Obsidian Dark mode"
          >
            {theme === 'light' ? 'PAPER [LIGHT]' : 'OBSIDIAN [DARK]'}
          </button>

          <div className="user-chip">
            <span className="kicker" style={{ color: 'var(--accent-primary)' }}>OP</span>
            <span>{admin.username}</span>
          </div>

          <button className="btn secondary" type="button" onClick={() => load(true)} disabled={loading}>
            {loading ? 'SYNCING…' : 'REFRESH'}
          </button>
          <button className="btn danger" type="button" onClick={logout}>
            LOG OUT
          </button>
        </div>
      </header>

      {error && <div className="banner error" style={{ marginTop: 16 }}>{error}</div>}

      {/* Numbered Architectural Tab Navigation */}
      <nav className="nav-tabs" aria-label="Workbench Sections">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="tab-index">01</span>
          <span>OVERVIEW</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          <span className="tab-index">02</span>
          <span>LIVE INBOX</span>
          <span className="tab-badge">LIVE</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'intakes' ? 'active' : ''}`}
          onClick={() => setActiveTab('intakes')}
        >
          <span className="tab-index">03</span>
          <span>LEADS &amp; INTAKE</span>
          <span className="tab-badge">{intakes.length}</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'quotes' ? 'active' : ''}`}
          onClick={() => setActiveTab('quotes')}
        >
          <span className="tab-index">04</span>
          <span>INVOICE</span>
          {approvalsCount > 0 && <span className="tab-badge alert">{approvalsCount} PENDING</span>}
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'proposals' ? 'active' : ''}`}
          onClick={() => setActiveTab('proposals')}
        >
          <span className="tab-index">05</span>
          <span>PROPOSAL</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveTab('services')}
        >
          <span className="tab-index">06</span>
          <span>CATALOG &amp; PRICING</span>
          <span className="tab-badge">{services.length}</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <span className="tab-index">07</span>
          <span>TELEMETRY &amp; LOGS</span>
        </button>
      </nav>

      {/* 01 OVERVIEW */}
      {activeTab === 'overview' && (
        <div>
          <div className="stats-grid">
            <div className="stat-cell">
              <div className="stat-cell-head">
                <span className="stat-label">METRIC // 01 · SERVICES</span>
                <Pill tone="ok">ACTIVE</Pill>
              </div>
              <div className="stat-value">
                {availableServicesCount} <span className="muted" style={{ fontSize: '1.1rem' }}>/ {services.length}</span>
              </div>
              <div className="stat-subtext">Operational services in catalog</div>
            </div>

            <div className="stat-cell">
              <div className="stat-cell-head">
                <span className="stat-label">METRIC // 02 · INTAKES</span>
                <Pill tone="ok">CAPTURED</Pill>
              </div>
              <div className="stat-value ok">{summary?.counts?.intakes ?? intakes.length}</div>
              <div className="stat-subtext">
                {completeIntakesCount} qualified {completeIntakesCount === 1 ? 'lead' : 'leads'} collected
              </div>
            </div>

            <div className="stat-cell">
              <div className="stat-cell-head">
                <span className="stat-label">METRIC // 03 · APPROVALS</span>
                {approvalsCount > 0 ? <Pill tone="acc">ACTION</Pill> : <Pill>CLEAR</Pill>}
              </div>
              <div className={`stat-value ${approvalsCount > 0 ? 'accent' : ''}`}>{approvalsCount}</div>
              <div className="stat-subtext">
                {approvalsCount > 0 ? 'Quotes awaiting operator review' : 'No pending quotation approvals'}
              </div>
            </div>

            <div className="stat-cell">
              <div className="stat-cell-head">
                <span className="stat-label">METRIC // 04 · FAQS</span>
                <Pill>GROUNDED</Pill>
              </div>
              <div className="stat-value">{summary?.counts?.faqs ?? '—'}</div>
              <div className="stat-subtext">{summary?.counts?.logs ?? logs.length} telemetry events recorded</div>
            </div>
          </div>

          <div className="stack">
            {/* Operational Action Center: Approvals & Leads in prime focus side-by-side */}
            <div className="split-grid-equal">
              <Approvals refreshKey={dataVersion} onChanged={load} />

              <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="panel-title">
                  <strong>Recent Qualified Leads</strong>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => setActiveTab('intakes')}
                  >
                    VIEW ALL LEADS
                  </button>
                </div>

                {intakes.length === 0 ? (
                  <div
                    className="muted small"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '24px 16px',
                      textAlign: 'center',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    No client intakes recorded yet. Incoming WhatsApp leads populate here automatically.
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 10, flex: 1 }}>
                    {intakes.slice(0, 4).map((item, idx) => {
                      const currentStatus = normalizeLeadStatus(item.status);
                      return (
                        <div key={item.id ?? idx} className="list-row" style={{ flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Pill tone={item.channel === 'website' ? 'website' : item.channel === 'whatsapp' ? 'whatsapp' : 'telegram'}>
                                {item.channel === 'website' ? '🌐 WEB' : item.channel?.toUpperCase()}
                              </Pill>
                              <strong>{item.company_name || 'Prospect Lead'}</strong>
                            </div>
                            <select
                              aria-label={`Lead status for ${item.company_name || item.external_user_id}`}
                              className={`lead-status-select status-${currentStatus}`}
                              value={currentStatus}
                              disabled={updatingLeadId === item.id}
                              onChange={(e) => updateLeadStatus(item.id, e.target.value)}
                            >
                              {LEAD_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mono muted" style={{ fontSize: '11px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span>SIZE: {item.company_size || '—'}</span>
                            <span>//</span>
                            <span>TOOLS: {item.current_tools || '—'}</span>
                            <span>//</span>
                            <span className="claim">{item.service_name || '—'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* 02 LIVE INBOX */}
      {activeTab === 'inbox' && (
        <LiveConversations
          initialSessionId={inboxSessionId}
          onUnauthorized={() => setAdmin(null)}
        />
      )}

      {/* 03 LEADS & INTAKE */}
      {activeTab === 'intakes' && (
        <section className="card">
          <div className="panel-title">
            <strong>Qualified Client Leads (Service Intakes)</strong>
            <Pill tone="ok">
              {completeIntakesCount} COLLECTED+ / {intakes.length} TOTAL
            </Pill>
          </div>
          <div className="lead-toolbar">
            <input
              className="search-input"
              placeholder="Search company, service, tools, phone…"
              aria-label="Search leads"
              value={intakeSearch}
              onChange={(e) => setIntakeSearch(e.target.value)}
            />

            <label className={`lead-select ${intakeDateFilter !== 'all' ? 'active' : ''}`}>
              <span className="lead-select-label">TIME</span>
              <select
                aria-label="Filter leads by time"
                value={intakeDateFilter}
                onChange={(e) => setIntakeDateFilter(e.target.value as IntakeDateFilter)}
              >
                <option value="all">All time ({intakes.length})</option>
                <option value="today">Today ({todaysIntakesCount})</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 days</option>
                <option value="month">This month</option>
              </select>
            </label>

            <label className={`lead-select ${intakeStatusFilter !== 'all' ? 'active' : ''}`}>
              <span className="lead-select-label">STAGE</span>
              <select
                aria-label="Filter leads by stage"
                value={intakeStatusFilter}
                onChange={(e) => setIntakeStatusFilter(e.target.value as IntakeStatusFilter)}
              >
                <option value="all">All stages ({intakes.length})</option>
                {LEAD_STATUS_OPTIONS.map((opt) => {
                  const count = intakes.filter((i) => normalizeLeadStatus(i.status) === opt.value).length;
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label.charAt(0) + opt.label.slice(1).toLowerCase()} ({count})
                    </option>
                  );
                })}
              </select>
            </label>

            <label className={`lead-select ${intakeChannelFilter !== 'all' ? 'active' : ''}`}>
              <span className="lead-select-label">CHANNEL</span>
              <select
                aria-label="Filter leads by channel"
                value={intakeChannelFilter}
                onChange={(e) => setIntakeChannelFilter(e.target.value as 'all' | 'website' | 'whatsapp' | 'telegram')}
              >
                <option value="all">All channels ({intakes.length})</option>
                <option value="website">Website ({websiteIntakesCount})</option>
                <option value="whatsapp">WhatsApp ({whatsappIntakesCount})</option>
                <option value="telegram">Telegram ({telegramIntakesCount})</option>
              </select>
            </label>

            <div className="lead-toolbar-meta">
              <span className="mono muted" style={{ fontSize: '11px' }}>
                {filteredIntakes.length} / {intakes.length} LEADS
              </span>
              {hasActiveIntakeFilters && (
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  onClick={() => {
                    setIntakeSearch('');
                    setIntakeChannelFilter('all');
                    setIntakeDateFilter('all');
                    setIntakeStatusFilter('all');
                  }}
                >
                  ✕ CLEAR
                </button>
              )}
            </div>
          </div>

          <Table
            cols={['Channel', 'Client ID', 'Company', 'Size', 'Tools Stack', 'Requested Service', 'Lang', 'Status', '', 'Updated']}
            rows={filteredIntakes}
            rowId={(r) => `lead-row-${r.id}`}
            rowClassName={(r) =>
              highlightedLead &&
              ((highlightedLead.intakeId != null && r.id === highlightedLead.intakeId) ||
                (highlightedLead.sessionId && r.session_id === highlightedLead.sessionId))
                ? 'lead-row-highlight'
                : ''
            }
            render={(r) => {
              const currentStatus = normalizeLeadStatus(r.status);
              return [
                <Pill tone={r.channel === 'website' ? 'website' : r.channel === 'whatsapp' ? 'whatsapp' : 'telegram'}>
                  {r.channel === 'website' ? '🌐 WEBSITE' : r.channel?.toUpperCase()}
                </Pill>,
                <span className="mono">{r.external_user_id}</span>,
                <strong>{r.company_name || '—'}</strong>,
                <span className="mono small">{r.company_size || '—'}</span>,
                <span className="small">{r.current_tools || '—'}</span>,
                <span className="small claim" style={{ fontWeight: 600 }}>{r.service_name || '—'}</span>,
                <Pill>{r.language || 'en'}</Pill>,
                <select
                  aria-label={`Lead status for ${r.company_name || r.external_user_id}`}
                  className={`lead-status-select status-${currentStatus}`}
                  value={currentStatus}
                  disabled={updatingLeadId === r.id}
                  onChange={(e) => updateLeadStatus(r.id, e.target.value)}
                >
                  {LEAD_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>,
                <button
                  type="button"
                  className="btn danger btn-sm"
                  aria-label={`Delete lead ${r.company_name || r.external_user_id}`}
                  title="Delete lead"
                  disabled={deletingLeadId === r.id}
                  onClick={() => deleteLead(r)}
                  style={{ minHeight: 28, width: 30, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6" />
                  </svg>
                </button>,
                <span className="mono muted">{fmtTime(r.updated_at)}</span>,
              ];
            }}
          />
        </section>
      )}

      {/* 04 INVOICE */}
      {activeTab === 'quotes' && (
        <div className="stack">
          <Approvals refreshKey={dataVersion} onChanged={load} />
          <Quotes refreshKey={dataVersion} />
        </div>
      )}

      {/* 05 PROPOSAL */}
      {activeTab === 'proposals' && <Proposals refreshKey={dataVersion} />}

      {/* 06 CATALOG & PRICING */}
      {activeTab === 'services' && (
        <div className="split-grid">
          <section className="card">
            <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Services Catalog</strong>
                <Pill tone="ok">{availableServicesCount} AVAILABLE</Pill>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ minHeight: 30, fontSize: '11px', padding: '0 10px' }}
                  onClick={() => setShowSettingsModal(true)}
                  title="Configure company size multipliers and default Terms & Conditions template"
                >
                  ⚙ Settings
                </button>
                <button
                  type="button"
                  className="btn primary"
                  style={{ minHeight: 30, fontSize: '11px', padding: '0 10px' }}
                  onClick={() => {
                    setEditingService(null);
                    setShowServiceModal(true);
                  }}
                >
                  + Add Service
                </button>
              </div>
            </div>
            <p className="sub">
              Authoritative service catalog exposed to the conversational assistant, pricing engine, and proposal builder.
            </p>

            <Table
              cols={['Service Name', 'Base Price (₹)', 'Category', 'Status', 'Actions']}
              rows={services}
              render={(s) => [
                <div>
                  <strong>{s.name}</strong>
                  <div className="small muted" style={{ marginTop: 2 }}>{s.availability_note || s.description}</div>
                </div>,
                <strong className="mono" style={{ color: 'var(--accent-primary)', fontSize: '0.92rem' }}>
                  {formatInr((s.base_price_paise || 0) / 100)}
                </strong>,
                <Pill>{s.category || 'general'}</Pill>,
                <button
                  type="button"
                  onClick={() => toggleServiceStatus(s)}
                  title="Click to cycle status: available → limited → maintenance → unavailable"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <Pill tone={s.status === 'available' ? 'ok' : s.status === 'limited' ? 'orange' : s.status === 'maintenance' ? 'acc' : 'rose'}>
                    {s.status} ⟳
                  </Pill>
                </button>,
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ minHeight: 26, fontSize: '10px', padding: '2px 8px' }}
                    onClick={() => {
                      setEditingService(s);
                      setShowServiceModal(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    style={{ minHeight: 26, fontSize: '10px', padding: '2px 8px' }}
                    onClick={() => deleteService(s)}
                  >
                    Delete
                  </button>
                </div>,
              ]}
            />
          </section>

          <PriceTables services={services} />
        </div>
      )}

      {/* 07 TELEMETRY & LOGS */}
      {activeTab === 'logs' && (
        <LogsAndSimulatorTab
          logs={logs}
          requests={requests}
          onRefresh={() => load(false)}
          onError={setError}
        />
      )}

      {showServiceModal && (
        <ServiceModal
          service={editingService}
          onClose={() => {
            setShowServiceModal(false);
            setEditingService(null);
          }}
          onSaved={() => load(false)}
        />
      )}

      {showSettingsModal && (
        <ServiceSettingsModal
          onClose={() => setShowSettingsModal(false)}
          onSaved={() => load(false)}
        />
      )}
    </div>
  );
}
