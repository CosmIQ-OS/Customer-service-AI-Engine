import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AdminMe } from './api';
import { LoginView } from './Login';
import { PriceTables } from './PriceTables';
import { Quotes } from './Quotes';

type AnyRow = Record<string, any>;

function fmtTime(v?: string) {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}

function Pill({ children, tone }: { children: any; tone?: 'orange' | 'black' }) {
  return <span className={`pill ${tone || ''}`}>{children}</span>;
}

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [requests, setRequests] = useState<AnyRow[]>([]);
  const [logs, setLogs] = useState<AnyRow[]>([]);
  const [services, setServices] = useState<AnyRow[]>([]);
  const [intakes, setIntakes] = useState<AnyRow[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sim, setSim] = useState({ channel: 'telegram', externalUserId: 'demo-user', text: 'What services are available?' });
  const [simResult, setSimResult] = useState<any>(null);
  const [simBusy, setSimBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, r, l, sv, int] = await Promise.all([
        api<any>('/api/dashboard/summary'),
        api<AnyRow[]>('/api/requests?limit=50'),
        api<AnyRow[]>('/api/logs?limit=80'),
        api<AnyRow[]>('/api/services'),
        api<AnyRow[]>('/api/intakes?limit=100'),
      ]);
      setSummary(s);
      setRequests(r);
      setLogs(l);
      setServices(sv);
      setIntakes(int);
      setDataVersion((version) => version + 1);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        setAdmin(null);
        return;
      }
      setError(e.message || 'Failed to load dashboard data. Is the API running on port 3001?');
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

  if (!authChecked) return <div className="app"><p className="muted">Loading…</p></div>;
  if (!admin) return <LoginView onLogin={setAdmin} />;

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Business Support <span className="accent">Engine</span></h1>
          <p className="sub">Logs, requests, and services from chat channels (Telegram / WhatsApp ready).</p>
        </div>
        <div className="toolbar">
          <span className="muted small">{admin.username}</span>
          <button className="btn secondary" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn secondary" onClick={logout}>Log out</button>
        </div>
      </div>

      {error && <div className="card error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="grid stats">
        <Stat label="Services" value={summary?.counts?.services ?? '—'} />
        <Stat label="Available" value={summary?.counts?.availableServices ?? '—'} tone="orange" />
        <Stat label="Requests" value={summary?.counts?.requests ?? '—'} />
        <Stat label="Open Requests" value={summary?.counts?.openRequests ?? '—'} tone="orange" />
        <Stat label="Logs" value={summary?.counts?.logs ?? '—'} />
        <Stat label="FAQs" value={summary?.counts?.faqs ?? '—'} />
      </div>

      <div className="grid main-grid">
        <div className="stack">
          <section className="card">
            <h2 className="panel-title">Service Intakes <span>company and tools collected</span></h2>
            <Table
              cols={['Channel', 'User', 'Company', 'Size', 'Current tools', 'Service', 'Lang', 'Status', 'Updated']}
              rows={intakes}
              render={(r) => [
                <Pill>{r.channel}</Pill>,
                <span className="mono">{r.external_user_id}</span>,
                <strong>{r.company_name || '—'}</strong>,
                <span className="small">{r.company_size || '—'}</span>,
                <span className="small">{r.current_tools || '—'}</span>,
                <span className="small">{r.service_name || '—'}</span>,
                <Pill>{r.language || '—'}</Pill>,
                <Pill tone={r.status === 'complete' ? 'orange' : undefined}>{r.status}</Pill>,
                <span className="muted small">{fmtTime(r.updated_at)}</span>,
              ]}
            />
          </section>

          <Quotes refreshKey={dataVersion} />

          <section className="card">
            <h2 className="panel-title">Chat Requests <span>from conversations</span></h2>
            <Table
              cols={['ID', 'Channel', 'User', 'Kind', 'Status', 'Body', 'Created']}
              rows={requests}
              render={(r) => [
                <span className="mono">#{r.id}</span>,
                <Pill>{r.channel}</Pill>,
                <span className="mono">{r.external_user_id}</span>,
                <span>{r.kind}</span>,
                <Pill tone={r.status === 'open' ? 'orange' : undefined}>{r.status}</Pill>,
                <span className="log-msg">{r.body}</span>,
                <span className="muted small">{fmtTime(r.created_at)}</span>,
              ]}
            />
          </section>

          <section className="card">
            <h2 className="panel-title">Chat Logs <span>inbound / outbound / system</span></h2>
            <Table
              cols={['Time', 'Dir', 'Channel', 'Event', 'Message']}
              rows={logs}
              render={(r) => [
                <span className="muted small">{fmtTime(r.created_at)}</span>,
                <Pill tone={r.direction === 'inbound' ? 'orange' : r.direction === 'outbound' ? 'black' : undefined}>{r.direction}</Pill>,
                <Pill>{r.channel}</Pill>,
                <span className="mono small">{r.event}</span>,
                <span className="log-msg">{r.message}</span>,
              ]}
            />
          </section>
        </div>

        <div className="stack">
          <PriceTables services={services} />

          <section className="card">
            <h2 className="panel-title">Services <span>availability</span></h2>
            <Table
              cols={['Service', 'Status', 'Note']}
              rows={services}
              render={(s) => [
                <div><strong>{s.name}</strong><div className="muted small">{s.category}</div></div>,
                <Pill tone={s.status === 'available' ? 'orange' : undefined}>{s.status}</Pill>,
                <span className="small">{s.availability_note || s.description}</span>,
              ]}
            />
          </section>

          <section className="card">
            <h2 className="panel-title">Simulate Chat <span>engine test</span></h2>
            <form className="form" onSubmit={runSim}>
              <label>Channel
                <select value={sim.channel} onChange={(e) => setSim({ ...sim, channel: e.target.value })}>
                  <option value="telegram">telegram</option>
                  <option value="whatsapp">whatsapp</option>
                  <option value="web">web</option>
                </select>
              </label>
              <label>User ID
                <input value={sim.externalUserId} onChange={(e) => setSim({ ...sim, externalUserId: e.target.value })} />
              </label>
              <label>Message
                <textarea value={sim.text} onChange={(e) => setSim({ ...sim, text: e.target.value })} />
              </label>
              <button className="btn" type="submit" disabled={simBusy}>{simBusy ? 'Sending…' : 'Send to Engine'}</button>
            </form>
            {simResult && (
              <div className="success" style={{ marginTop: 12 }}>
                <div><strong>Intent:</strong> {simResult.intent} &nbsp; <strong>Session:</strong> <span className="mono">{simResult.sessionId?.slice(0, 8)}</span></div>
                <div style={{ marginTop: 6 }}>{simResult.reply}</div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: 'orange' }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
    </div>
  );
}

function Table({ cols, rows, render }: { cols: string[]; rows: AnyRow[]; render: (r: AnyRow) => any[] }) {
  if (!rows.length) return <div className="muted small">No data yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={r.id ?? i}>{render(r).map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
