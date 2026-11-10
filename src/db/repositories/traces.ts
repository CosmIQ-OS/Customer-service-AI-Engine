import type { DB } from '../database.js';
import type { TraceRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<TraceRecord, 'tool_calls'> & { tool_calls: string };
const map = (row: Row): TraceRecord => ({ ...row, tool_calls: parseJson(row.tool_calls, []) });

export function createTrace(
  db: DB,
  input: Pick<TraceRecord, 'session_id' | 'model' | 'prompt_version'> &
    Partial<Pick<TraceRecord, 'message_id' | 'steps' | 'tokens_in' | 'tokens_out' | 'latency_ms' | 'tool_calls' | 'error' | 'tenant_id'>>,
): TraceRecord {
  const info = db.prepare(
    `INSERT INTO traces
      (session_id, message_id, model, prompt_version, steps, tokens_in, tokens_out, latency_ms, tool_calls, error, tenant_id)
     VALUES
      (@session_id, @message_id, @model, @prompt_version, @steps, @tokens_in, @tokens_out, @latency_ms, @tool_calls, @error, @tenant_id)`,
  ).run({
    session_id: input.session_id,
    message_id: input.message_id ?? null,
    model: input.model,
    prompt_version: input.prompt_version,
    steps: input.steps ?? 0,
    tokens_in: input.tokens_in ?? 0,
    tokens_out: input.tokens_out ?? 0,
    latency_ms: input.latency_ms ?? 0,
    tool_calls: JSON.stringify(input.tool_calls ?? []),
    error: input.error ?? '',
    tenant_id: input.tenant_id ?? 'default',
  });
  return map(db.prepare('SELECT * FROM traces WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
}

export function listTraces(db: DB, limit = 100): TraceRecord[] {
  return (db.prepare('SELECT * FROM traces ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(map);
}
