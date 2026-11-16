import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AdminMe } from './api';
import { LoginView } from './Login';
import { PriceTables } from './PriceTables';
import { Quotes } from './Quotes';
import { Approvals } from './Approvals';
import { LiveConversations } from './LiveConversations';

type AnyRow = Record<string, any>;
type TabKey = 'overview' | 'inbox' | 'intakes' | 'quotes' | 'services' | 'logs';

function fmtTime(v?: string) {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Pill({ children, tone }: { children: any; tone?: 'orange' | 'black' | 'emerald' | 'rose' | 'sky' | 'whatsapp' | 'telegram' }) {
  return <span className={`pill ${tone || ''}`}>{children}</span>;
}

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
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

  // Search filters
  const [intakeSearch, setIntakeSearch] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'inbound' | 'outbound' | 'system'>('all');

  // Simulator
  const [sim, setSim] = useState({ channel: 'whatsapp', externalUserId: '917594827429', text: 'Hi, what services do you offer?' });
  const [simResult, setSimResult] = useState<any>(null);
  const [simBusy, setSimBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
      setError(e.message || 'Failed to connect to the backend server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<{ admin: AdminMe }>('/api/auth/me')
      .then((result) => setAdmin(result.admin))
      .catch(() => setAdmin(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (admin) load();
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
        <div style={{ textAlign: 'center' }}>
          <div className="login-icon" style={{ animation: 'spin 1s linear infinite' }}>⚡</div>
          <p className="muted">Connecting to CosmIQ OS Command Center…</p>
        </div>
      </div>
    );
  }

  if (!admin) return <LoginView onLogin={setAdmin} />;

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

  return (
    <div className="app">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-logo">⚡</div>
          <div className="brand-text">
            <h1>
              CosmIQ <span style={{ color: 'var(--primary)' }}>OS</span>
              <span className="brand-badge">Command Center v2</span>
            </h1>
            <p>AI Automation & Consultative Customer Engine</p>
          </div>
        </div>

        <div className="toolbar">
          <div className="status-indicator">
            <span className="status-dot"></span>
            <span>Live Server Active</span>
          </div>

          <div className="user-chip">
            <div className="user-avatar">{admin.username[0].toUpperCase()}</div>
            <span>{admin.username}</span>
          </div>

          <button className="btn secondary" onClick={load} disabled={loading} title="Refresh Live Data">
            {loading ? '⟳ Syncing…' : '⟳ Refresh'}
          </button>
          <button className="btn danger" onClick={logout} title="Sign Out">
            Log out
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          📊 Overview
        </button>
        <button
          className={`tab-btn ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          💬 Live Inbox
          <span className="tab-badge">Active</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'intakes' ? 'active' : ''}`}
          onClick={() => setActiveTab('intakes')}
        >
          📋 Leads & Intake
          <span className="tab-badge">{intakes.length}</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'quotes' ? 'active' : ''}`}
          onClick={() => setActiveTab('quotes')}
        >
          💰 Quotes & Approvals
          {approvalsCount > 0 && <span className="tab-badge alert">{approvalsCount} Pending</span>}
        </button>
        <button
          className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveTab('services')}
        >
          🛠️ Services & Catalog
          <span className="tab-badge">{services.length}</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          🔍 Simulator & Logs
        </button>
      </nav>

      {/* TAB CONTENT */}

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div>
          {/* Top KPI Cards */}
          <div className="grid stats">
            <div className="card stat-card accent-purple">
              <div className="stat-card-head">
                <span className="stat-label">Active Services</span>
                <span className="stat-icon">🛠️</span>
              </div>
              <div className="stat-value">{summary?.counts?.availableServices ?? services.length} / {services.length}</div>
              <div className="stat-subtext">Operational in CosmIQ catalog</div>
            </div>

            <div className="card stat-card accent-emerald">
              <div className="stat-card-head">
                <span className="stat-label">Captured Leads</span>
                <span className="stat-icon">📋</span>
              </div>
              <div className="stat-value">{summary?.counts?.intakes ?? intakes.length}</div>
              <div className="stat-subtext">{summary?.counts?.completeIntakes ?? 0} qualified intakes completed</div>
            </div>

            <div className="card stat-card accent-amber">
              <div className="stat-card-head">
                <span className="stat-label">Pending Approvals</span>
                <span className="stat-icon">⏳</span>
              </div>
              <div className="stat-value">{approvalsCount}</div>
              <div className="stat-subtext">{approvalsCount > 0 ? 'Quotes require admin review' : 'All quotes up to date'}</div>
            </div>

            <div className="card stat-card accent-sky">
              <div className="stat-card-head">
                <span className="stat-label">Knowledge Base FAQs</span>
                <span className="stat-icon">📚</span>
              </div>
              <div className="stat-value">{summary?.counts?.faqs ?? '—'}</div>
              <div className="stat-subtext">Grounded answers for Gemini AI</div>
            </div>
          </div>

          {/* Quick Split View */}
          <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
            {/* Quick Inbox Preview */}
            <div>
              <LiveConversations />
            </div>

            {/* Quick Leads & Pending Approvals Column */}
            <div className="stack">
              <section className="card">
                <div className="panel-title">
                  <span>Recent Qualified Leads</span>
                  <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={() => setActiveTab('intakes')}>
                    View All →
                  </button>
                </div>

                {intakes.length === 0 ? (
                  <div className="muted small" style={{ padding: '20px 0', textAlign: 'center' }}>
                    No client intakes collected yet. Once a client messages on WhatsApp, their company details appear here.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {intakes.slice(0, 4).map((item, idx) => (
                      <div key={idx} style={{ background: 'var(--bg-subtle)', padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong>{item.company_name || 'Prospect Lead'}</strong>
                          <Pill tone={item.status === 'complete' ? 'emerald' : 'orange'}>{item.status}</Pill>
                        </div>
                        <div className="muted small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>Size: {item.company_size || '—'}</span>
                          <span>·</span>
                          <span>Tools: {item.current_tools || '—'}</span>
                          <span>·</span>
                          <span>Service: {item.service_name || '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="card">
                <div className="panel-title">
                  <span>Pending Quotes</span>
                  <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={() => setActiveTab('quotes')}>
                    Manage →
                  </button>
                </div>
                <Approvals refreshKey={dataVersion} onChanged={load} />
              </section>
            </div>
          </div>
        </div>
      )}

      {/* 2. LIVE INBOX TAB */}
      {activeTab === 'inbox' && (
        <div>
          <LiveConversations />
        </div>
      )}

      {/* 3. LEADS & INTAKES TAB */}
      {activeTab === 'intakes' && (
        <section className="card">
          <div className="panel-title">
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Qualified Client Leads (Service Intakes)</h2>
            <span className="pill emerald">{intakes.filter((i) => i.status === 'complete').length} Complete / {intakes.length} Total</span>
          </div>
          <p className="sub" style={{ margin: '0 0 16px' }}>
            Details collected conversationally by CosmIQ Gemini AI via WhatsApp and Telegram.
          </p>

          <div className="search-bar">
            <input
              className="search-input"
              placeholder="🔍 Search company, service, tools..."
              value={intakeSearch}
              onChange={(e) => setIntakeSearch(e.target.value)}
            />
          </div>

          <Table
            cols={['Channel', 'Client User', 'Company Name', 'Team Size', 'Current Stack / Tools', 'Requested Service', 'Lang', 'Status', 'Last Active']}
            rows={filteredIntakes}
            render={(r) => [
              <Pill tone={r.channel === 'whatsapp' ? 'whatsapp' : 'telegram'}>{r.channel}</Pill>,
              <span className="mono">{r.external_user_id}</span>,
              <strong>{r.company_name || '—'}</strong>,
              <span className="small">{r.company_size || '—'}</span>,
              <span className="small">{r.current_tools || '—'}</span>,
              <span className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>{r.service_name || '—'}</span>,
              <Pill>{r.language?.toUpperCase() || 'EN'}</Pill>,
              <Pill tone={r.status === 'complete' ? 'emerald' : 'orange'}>{r.status}</Pill>,
              <span className="muted small">{fmtTime(r.updated_at)}</span>,
            ]}
          />
        </section>
      )}

      {/* 4. QUOTES & APPROVALS TAB */}
      {activeTab === 'quotes' && (
        <div className="stack">
          <Approvals refreshKey={dataVersion} onChanged={load} />
          <Quotes refreshKey={dataVersion} />
        </div>
      )}

      {/* 5. SERVICES & CATALOG TAB */}
      {activeTab === 'services' && (
        <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
          <section className="card">
            <div className="panel-title">
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Services Catalog</h2>
              <span className="pill emerald">{services.filter((s) => s.status === 'available').length} Available</span>
            </div>
            <p className="sub" style={{ margin: '0 0 16px' }}>
              Services presented by the AI assistant when prospective clients inquire about CosmIQ capabilities.
            </p>

            <Table
              cols={['Service Name', 'Category', 'Status', 'Description / Note']}
              rows={services}
              render={(s) => [
                <div>
                  <strong>{s.name}</strong>
                </div>,
                <Pill>{s.category || 'General'}</Pill>,
                <Pill tone={s.status === 'available' ? 'emerald' : 'orange'}>{s.status}</Pill>,
                <span className="small" style={{ color: 'var(--fg-muted)' }}>{s.availability_note || s.description}</span>,
              ]}
            />
          </section>

          <PriceTables services={services} />
        </div>
      )}

      {/* 6. SIMULATOR & LOGS TAB */}
      {activeTab === 'logs' && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
          {/* Engine Simulator */}
          <section className="card">
            <div className="panel-title">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Engine Chat Simulator</h2>
              <span className="pill">Testing Sandbox</span>
            </div>
            <p className="sub" style={{ margin: '0 0 16px' }}>
              Test Gemini 2.5 Flash agent reasoning and tool execution without sending live WhatsApp messages.
            </p>

            <form className="form" onSubmit={runSim}>
              <div className="form-group">
                <label className="form-label">Simulated Channel</label>
                <select value={sim.channel} onChange={(e) => setSim({ ...sim, channel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="web">Web Widget</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Simulated User Phone / ID</label>
                <input value={sim.externalUserId} onChange={(e) => setSim({ ...sim, externalUserId: e.target.value })} />
              </div>

              <div className="form-group">
                <label className="form-label">Message Payload</label>
                <textarea
                  rows={3}
                  value={sim.text}
                  onChange={(e) => setSim({ ...sim, text: e.target.value })}
                  placeholder="e.g. My company is Acme Corp, 25 team size, we use Slack and need WhatsApp Automation."
                />
              </div>

              <button className="btn" type="submit" disabled={simBusy}>
                {simBusy ? '⚡ Processing with Gemini…' : 'Run Simulation'}
              </button>
            </form>

            {simResult && (
              <div className="banner success" style={{ marginTop: 16, display: 'block' }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>Intent:</strong> <Pill tone="emerald">{simResult.intent}</Pill> &nbsp;
                  <strong>Session:</strong> <span className="mono">{simResult.sessionId?.slice(0, 8)}</span>
                </div>
                <div style={{ background: '#0b1120', padding: 12, borderRadius: 'var(--radius)', marginTop: 8, whiteSpace: 'pre-wrap', color: '#f8fafc' }}>
                  {simResult.reply}
                </div>
              </div>
            )}
          </section>

          {/* Audit Logs */}
          <div className="stack">
            <section className="card">
              <div className="panel-title">
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Audit Event Logs</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`tab-btn ${logFilter === 'all' ? 'active' : ''}`} style={{ padding: '3px 8px', fontSize: '0.74rem' }} onClick={() => setLogFilter('all')}>All</button>
                  <button className={`tab-btn ${logFilter === 'inbound' ? 'active' : ''}`} style={{ padding: '3px 8px', fontSize: '0.74rem' }} onClick={() => setLogFilter('inbound')}>Inbound</button>
                  <button className={`tab-btn ${logFilter === 'outbound' ? 'active' : ''}`} style={{ padding: '3px 8px', fontSize: '0.74rem' }} onClick={() => setLogFilter('outbound')}>Outbound</button>
                </div>
              </div>

              <Table
                cols={['Timestamp', 'Flow', 'Channel', 'Event', 'Message Snippet']}
                rows={filteredLogs.slice(0, 20)}
                render={(r) => [
                  <span className="muted small">{fmtTime(r.created_at)}</span>,
                  <Pill tone={r.direction === 'inbound' ? 'orange' : r.direction === 'outbound' ? 'emerald' : undefined}>{r.direction}</Pill>,
                  <Pill>{r.channel}</Pill>,
                  <span className="mono small">{r.event}</span>,
                  <span className="small log-msg" style={{ color: 'var(--fg-muted)' }}>{r.message}</span>,
                ]}
              />
            </section>

            <section className="card">
              <div className="panel-title">
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Support Requests & Escalations</h2>
                <span className="pill">{requests.length} Requests</span>
              </div>
              <Table
                cols={['ID', 'Channel', 'Customer', 'Kind', 'Status', 'Subject / Body', 'Date']}
                rows={requests}
                render={(r) => [
                  <span className="mono">#{r.id}</span>,
                  <Pill>{r.channel}</Pill>,
                  <span className="mono">{r.external_user_id}</span>,
                  <span>{r.kind}</span>,
                  <Pill tone={r.status === 'open' ? 'orange' : 'emerald'}>{r.status}</Pill>,
                  <span className="small log-msg">{r.body || r.subject}</span>,
                  <span className="muted small">{fmtTime(r.created_at)}</span>,
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
    return <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>No records found.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {render(r).map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
