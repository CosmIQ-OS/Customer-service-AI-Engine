import type { ReactNode } from 'react';

export type AnyRow = Record<string, any>;
export type IntakeDateFilter = 'all' | 'today' | 'yesterday' | '7d' | 'month';
export type IntakeStatusFilter = 'all' | 'collecting' | 'collected' | 'quoted' | 'deal_won' | 'completed';
export type PillTone =
  | 'orange'
  | 'acc'
  | 'black'
  | 'emerald'
  | 'ok'
  | 'rose'
  | 'danger'
  | 'sky'
  | 'whatsapp'
  | 'telegram'
  | 'website';

export const LEAD_STATUS_OPTIONS = [
  { value: 'collecting', label: 'COLLECTING', tone: 'acc' as const },
  { value: 'collected', label: 'COLLECTED', tone: 'sky' as const },
  { value: 'quoted', label: 'QUOTE GIVEN', tone: 'orange' as const },
  { value: 'deal_won', label: 'AFTER DEAL', tone: 'emerald' as const },
  { value: 'completed', label: 'COMPLETED', tone: 'ok' as const },
] as const;

export function normalizeLeadStatus(status?: string): string {
  return status === 'complete' ? 'collected' : status || 'collecting';
}

export function parseUtcTimestamp(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v.includes('Z') ? v : `${v.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function matchesIntakeDateFilter(row: AnyRow, filter: IntakeDateFilter): boolean {
  if (filter === 'all') return true;
  const d = parseUtcTimestamp(row.created_at || row.updated_at);
  if (!d) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') return d >= startOfToday;
  if (filter === 'yesterday') {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    return d >= startOfYesterday && d < startOfToday;
  }
  if (filter === '7d') {
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    return d >= sevenDaysAgo;
  }
  if (filter === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return d >= startOfMonth;
  }
  return true;
}

export function fmtTime(v?: string): string {
  if (!v) return '';
  const d = parseUtcTimestamp(v);
  return !d
    ? v
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatInr(num: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
}

export function Pill({ children, tone }: { children: ReactNode; tone?: PillTone }) {
  return <span className={`pill ${tone || ''}`}>{children}</span>;
}

/** Official CosmIQ C·Q·I isometric cube monomark (theme-adaptive, no background). */
export function CosmiqMark() {
  return (
    <svg viewBox="26 16 148 166" aria-hidden="true" focusable="false">
      <polygon
        className="cq-q"
        points="34.53,58.00 100.00,20.20 142.56,44.77 127.89,53.24 100.00,37.13 63.86,58.00 100.00,78.87 127.89,62.76 142.56,71.23 100.00,95.80"
      />
      <polygon
        className="cq-tail"
        points="103.93,58.00 117.02,50.44 152.38,50.44 165.48,58.00 152.38,65.56 117.02,65.56"
      />
      <polygon
        className="cq-c"
        points="96.36,102.10 30.89,64.30 30.89,139.90 96.36,177.70 96.36,154.26 81.70,145.80 81.70,152.30 45.55,131.43 45.55,89.70 81.70,110.57 81.70,117.07 96.36,125.54"
      />
      <polygon
        className="cq-i"
        points="103.64,102.10 169.11,64.30 169.11,81.23 143.71,95.90 143.71,137.63 169.11,122.97 169.11,139.90 103.64,177.70 103.64,160.77 129.04,146.10 129.04,104.37 103.64,119.03"
      />
    </svg>
  );
}

export function Table({
  cols,
  rows,
  render,
  rowClassName,
  rowId,
}: {
  cols: string[];
  rows: AnyRow[];
  render: (r: AnyRow) => ReactNode[];
  rowClassName?: (r: AnyRow) => string;
  rowId?: (r: AnyRow) => string;
}) {
  if (!rows.length) {
    return (
      <div
        className="muted small"
        style={{
          padding: '24px 0',
          textAlign: 'center',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-elevated)',
        }}
      >
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
            <tr key={r.id ?? i} id={rowId ? rowId(r) : undefined} className={rowClassName ? rowClassName(r) : undefined}>
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
