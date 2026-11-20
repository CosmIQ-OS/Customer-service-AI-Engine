import type { DBExecutor } from '../database.js';
import type { TraceRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<TraceRecord, 'tool_calls'> & { tool_calls: string };
const map = (row: Row): TraceRecord => ({
  ...row,
  id: Number(row.id),
  message_id: row.message_id === null ? null : Number(row.message_id),
  steps: Number(row.steps),
  tokens_in: Number(row.tokens_in),
  tokens_out: Number(row.tokens_out),
  latency_ms: Number(row.latency_ms),
  tool_calls: parseJson(row.tool_calls, []),
});

export async function createTrace(
  db: DBExecutor,
  input: Pick<TraceRecord, 'session_id' | 'model' | 'prompt_version'> &
    Partial<
      Pick<
        TraceRecord,
        'message_id' | 'steps' | 'tokens_in' | 'tokens_out' | 'latency_ms' | 'tool_calls' | 'error' | 'tenant_id'
      >
    >,
): Promise<TraceRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO traces
      (session_id, message_id, model, prompt_version, steps, tokens_in, tokens_out, latency_ms, tool_calls, error, tenant_id)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.session_id,
      input.message_id ?? null,
      input.model,
      input.prompt_version,
      input.steps ?? 0,
      input.tokens_in ?? 0,
      input.tokens_out ?? 0,
      input.latency_ms ?? 0,
      JSON.stringify(input.tool_calls ?? []),
      input.error ?? '',
      input.tenant_id ?? 'default',
    ],
  );
  return map(row!);
}

export async function listTraces(db: DBExecutor, limit = 100): Promise<TraceRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM traces ORDER BY id DESC LIMIT $1', [limit]);
  return rows.map(map);
}
