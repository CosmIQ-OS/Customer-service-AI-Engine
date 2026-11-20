import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AdminMe } from './api';
import { LoginView } from './Login';
import { PriceTables } from './PriceTables';
import { Quotes } from './Quotes';
import { Approvals } from './Approvals';
import { LiveConversations } from './LiveConversations';
import { NotificationBell } from './NotificationBell';

type AnyRow = Record<string, any>;
type TabKey = 'overview' | 'inbox' | 'intakes' | 'quotes' | 'services' | 'logs';
type ThemeMode = 'light' | 'dark';

function fmtTime(v?: string) {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime())
    ? v
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Pill({
  children,
  tone,
}: {
  children: any;
  tone?: 'orange' | 'acc' | 'black' | 'emerald' | 'ok' | 'rose' | 'danger' | 'sky' | 'whatsapp' | 'telegram';
}) {
  return <span className={`pill ${tone || ''}`}>{children}</span>;
}

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
  const [logFilter, setLogFilter] = useState<'all' | 'inbound' | 'outbound' | 'system'>('all');

  const [sim, setSim] = useState({
    channel: 'whatsapp',
    externalUserId: '917594827429',
    text: 'Hi, what services do you offer?',
  });
  const [simResult, setSimResult] = useState<any>(null);
  const [simBusy, setSimBusy] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tandem-theme', theme);
    } catch {
      // ignore storage failure
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [s, r, l, sv, int, apprv] = await Promise.all([
        api<any>('/api/dashboard/summary'),
        api<AnyRow[]>('/api/requests?limit=50'),
        api<AnyRow[]>('/api/logs?limit=100'),
        api<AnyRow[]>('/api/services'),
        api<AnyRow[]>('/api/intakes?limit=100'),
        api<{ pending: any[] }>('/api/approvals').catch(() => ({ pending: [] })),
      ]);
      setSummary(s);
      setRequests(r);
      setLogs(l);
      setServices(sv);
      setIntakes(int);
      setApprovalsCount(apprv?.pending?.length ?? 0);
      setDataVersion((version) => version + 1);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        setAdmin(null);
        return;
      }
      if (showLoading) {
        setError(e.message || 'Failed to connect to the backend server.');
      }
    } finally {
      if (showLoading) setLoading(false);
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

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAdmin(null);
  }

  async function runSim(e: React.FormEvent) {
    e.preventDefault();
    setSimBusy(true);
    setSimResult(null);
    try {
      const result = await api<any>('/api/chat/simulate', { method: 'POST', body: JSON.stringify(sim) });
      setSimResult(result);
      await load();
    } catch (e: any) {
      setError(e.message || 'Simulation failed');
    } finally {
      setSimBusy(false);
    }
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

  const filteredIntakes = intakes.filter((row) => {
    const q = intakeSearch.toLowerCase();
    return (
      !q ||
      row.company_name?.toLowerCase().includes(q) ||
      row.service_name?.toLowerCase().includes(q) ||
      row.current_tools?.toLowerCase().includes(q) ||
      row.external_user_id?.toLowerCase().includes(q)
    );
  });

  const filteredLogs = logs.filter((row) => {
    if (logFilter === 'all') return true;
    return row.direction === logFilter;
  });

  const availableServicesCount = summary?.counts?.availableServices ?? services.filter((s) => s.status === 'available').length;
  const completeIntakesCount = summary?.counts?.completeIntakes ?? intakes.filter((i) => i.status === 'complete').length;

  return (
    <div className="app">
      {/* Editorial Command Header */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-mark">CQ</div>
          <div className="brand-text">
            <h1>
              <span>COSMIQ OS // SUPPORT &amp; QUOTATION WORKBENCH</span>
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
            onNavigate={(tab) => setActiveTab(tab)}
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
          <span>QUOTES &amp; APPROVALS</span>
          {approvalsCount > 0 && <span className="tab-badge alert">{approvalsCount} PENDING</span>}
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveTab('services')}
        >
          <span className="tab-index">05</span>
          <span>CATALOG &amp; PRICING</span>
          <span className="tab-badge">{services.length}</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <span className="tab-index">06</span>
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
                {completeIntakesCount} qualified {completeIntakesCount === 1 ? 'lead' : 'leads'} completed
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
                    {intakes.slice(0, 4).map((item, idx) => (
                      <div key={item.id ?? idx} className="list-row" style={{ flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
                          <strong>{item.company_name || 'Prospect Lead'}</strong>
                          <Pill tone={item.status === 'complete' ? 'ok' : 'acc'}>{item.status}</Pill>
                        </div>
                        <div className="mono muted" style={{ fontSize: '11px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>SIZE: {item.company_size || '—'}</span>
                          <span>//</span>
                          <span>TOOLS: {item.current_tools || '—'}</span>
                          <span>//</span>
                          <span className="claim">{item.service_name || '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* 02 LIVE INBOX */}
      {activeTab === 'inbox' && <LiveConversations onUnauthorized={() => setAdmin(null)} />}

      {/* 03 LEADS & INTAKE */}
      {activeTab === 'intakes' && (
        <section className="card">
          <div className="panel-title">
            <strong>Qualified Client Leads (Service Intakes)</strong>
            <Pill tone="ok">
              {completeIntakesCount} COMPLETE / {intakes.length} TOTAL
            </Pill>
          </div>
          <p className="sub">
            Structured company, team size, tooling stack, and requested service records captured conversationally.
          </p>

          <div className="search-bar">
            <input
              className="search-input"
              placeholder="Filter by company, service, tools, or phone ID…"
              value={intakeSearch}
              onChange={(e) => setIntakeSearch(e.target.value)}
            />
          </div>

          <Table
            cols={['Channel', 'Client ID', 'Company', 'Size', 'Tools Stack', 'Requested Service', 'Lang', 'Status', 'Updated']}
            rows={filteredIntakes}
            render={(r) => [
              <Pill tone={r.channel === 'whatsapp' ? 'whatsapp' : 'telegram'}>{r.channel}</Pill>,
              <span className="mono">{r.external_user_id}</span>,
              <strong>{r.company_name || '—'}</strong>,
              <span className="mono small">{r.company_size || '—'}</span>,
              <span className="small">{r.current_tools || '—'}</span>,
              <span className="small claim" style={{ fontWeight: 600 }}>{r.service_name || '—'}</span>,
              <Pill>{r.language || 'en'}</Pill>,
              <Pill tone={r.status === 'complete' ? 'ok' : 'acc'}>{r.status}</Pill>,
              <span className="mono muted">{fmtTime(r.updated_at)}</span>,
            ]}
          />
        </section>
      )}

      {/* 04 QUOTES & APPROVALS */}
      {activeTab === 'quotes' && (
        <div className="stack">
          <Approvals refreshKey={dataVersion} onChanged={load} />
          <Quotes refreshKey={dataVersion} />
        </div>
      )}

      {/* 05 CATALOG & PRICING */}
      {activeTab === 'services' && (
        <div className="split-grid">
          <section className="card">
            <div className="panel-title">
              <strong>Services Catalog</strong>
              <Pill tone="ok">{availableServicesCount} AVAILABLE</Pill>
            </div>
            <p className="sub">
              Authoritative service catalog exposed to the conversational assistant.
            </p>

            <Table
              cols={['Service Name', 'Category', 'Status', 'Availability Note']}
              rows={services}
              render={(s) => [
                <strong>{s.name}</strong>,
                <Pill>{s.category || 'general'}</Pill>,
                <Pill tone={s.status === 'available' ? 'ok' : 'acc'}>{s.status}</Pill>,
                <span className="small" style={{ color: 'var(--text-secondary)' }}>
                  {s.availability_note || s.description}
                </span>,
              ]}
            />
          </section>

          <PriceTables services={services} />
        </div>
      )}

      {/* 06 TELEMETRY & LOGS */}
      {activeTab === 'logs' && (
        <div className="split-grid-logs">
          <section className="card">
            <div className="panel-title">
              <strong>Engine Chat Simulator</strong>
              <Pill>SANDBOX</Pill>
            </div>
            <p className="sub">
              Verify deterministic tool calls, language detection, and quote guards locally.
            </p>

            <form className="form" onSubmit={runSim}>
              <label>
                Channel
                <select value={sim.channel} onChange={(e) => setSim({ ...sim, channel: e.target.value })}>
                  <option value="whatsapp">whatsapp</option>
                  <option value="telegram">telegram</option>
                  <option value="web">web</option>
                </select>
              </label>

              <label>
                User Phone / External ID
                <input value={sim.externalUserId} onChange={(e) => setSim({ ...sim, externalUserId: e.target.value })} />
              </label>

              <label>
                Inbound Payload
                <textarea
                  rows={3}
                  value={sim.text}
                  onChange={(e) => setSim({ ...sim, text: e.target.value })}
                />
              </label>

              <button className="btn primary" type="submit" disabled={simBusy}>
                {simBusy ? 'PROCESSING…' : 'RUN SIMULATION'}
              </button>
            </form>

            {simResult && (
              <div className="banner success" style={{ marginTop: 16, display: 'block' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                  <span className="kicker">INTENT</span>
                  <Pill tone="ok">{simResult.intent}</Pill>
                  <span className="kicker">SESSION</span>
                  <span className="mono">{simResult.sessionId?.slice(0, 8)}</span>
                </div>
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    padding: 12,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {simResult.reply}
                </div>
              </div>
            )}
          </section>

          <div className="stack">
            <section className="card">
              <div className="panel-title">
                <strong>Telemetry Audit Logs</strong>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['all', 'inbound', 'outbound', 'system'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      className={`inbox-filter-btn ${logFilter === dir ? 'active' : ''}`}
                      onClick={() => setLogFilter(dir)}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </div>

              <Table
                cols={['Time', 'Dir', 'Channel', 'Event', 'Message']}
                rows={filteredLogs.slice(0, 25)}
                render={(r) => [
                  <span className="mono muted">{fmtTime(r.created_at)}</span>,
                  <Pill tone={r.direction === 'inbound' ? 'acc' : r.direction === 'outbound' ? 'ok' : undefined}>
                    {r.direction}
                  </Pill>,
                  <Pill>{r.channel}</Pill>,
                  <span className="mono small">{r.event}</span>,
                  <span className="small log-msg" style={{ color: 'var(--text-secondary)' }}>{r.message}</span>,
                ]}
              />
            </section>

            <section className="card">
              <div className="panel-title">
                <strong>Support Requests &amp; Escalations</strong>
                <Pill>{requests.length} TOTAL</Pill>
              </div>
              <Table
                cols={['ID', 'Channel', 'Customer', 'Kind', 'Status', 'Body', 'Created']}
                rows={requests}
                render={(r) => [
                  <span className="mono">#{r.id}</span>,
                  <Pill>{r.channel}</Pill>,
                  <span className="mono">{r.external_user_id}</span>,
                  <span className="mono small">{r.kind}</span>,
                  <Pill tone={r.status === 'open' ? 'acc' : 'ok'}>{r.status}</Pill>,
                  <span className="small log-msg">{r.body || r.subject}</span>,
                  <span className="mono muted">{fmtTime(r.created_at)}</span>,
                ]}
              />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Table({ cols, rows, render }: { cols: string[]; rows: AnyRow[]; render: (r: AnyRow) => any[] }) {
  if (!rows.length) {
    return (
      <div className="muted small" style={{ padding: '24px 0', textAlign: 'center', border: '1px solid var(--border-default)', background: 'var(--bg-elevated)' }}>
        No records found.
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {render(r).map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
