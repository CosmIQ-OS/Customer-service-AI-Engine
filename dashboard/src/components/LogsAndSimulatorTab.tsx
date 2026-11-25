import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { fmtTime, Pill, Table, type AnyRow } from './UiPrimitives';

interface SimResult {
  intent: string;
  sessionId?: string;
  reply: string;
}

interface LogsAndSimulatorTabProps {
  logs: AnyRow[];
  requests: AnyRow[];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}

export function LogsAndSimulatorTab({ logs, requests, onRefresh, onError }: LogsAndSimulatorTabProps) {
  const [logFilter, setLogFilter] = useState<'all' | 'inbound' | 'outbound' | 'system'>('all');
  const [sim, setSim] = useState({
    channel: 'whatsapp',
    externalUserId: '919999000001',
    text: 'Hi! What services do you offer?',
  });
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState<SimResult | null>(null);

  const filteredLogs = logFilter === 'all' ? logs : logs.filter((l) => l.direction === logFilter);

  async function runSim(e: FormEvent) {
    e.preventDefault();
    setSimBusy(true);
    setSimResult(null);
    try {
      const res = await api<SimResult>('/api/chat/simulate', {
        method: 'POST',
        body: JSON.stringify(sim),
      });
      setSimResult(res);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="split-grid-logs">
      <section className="card">
        <div className="panel-title">
          <strong>Engine Chat Simulator</strong>
          <Pill>SANDBOX</Pill>
        </div>
        <p className="sub">Verify deterministic tool calls, language detection, and quote guards locally.</p>

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
            <textarea rows={3} value={sim.text} onChange={(e) => setSim({ ...sim, text: e.target.value })} />
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
              <span className="small log-msg" style={{ color: 'var(--text-secondary)' }}>
                {r.message}
              </span>,
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
  );
}
