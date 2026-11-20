import { UTC_NOW_SQL, type DBExecutor } from '../database.js';
import type { FaqRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<FaqRecord, 'tags' | 'enabled'> & { tags: string; enabled: number };

function map(row: Row): FaqRecord {
  return { ...row, id: Number(row.id), tags: parseJson(row.tags, []), enabled: Boolean(row.enabled) };
}

export async function listFaqs(db: DBExecutor): Promise<FaqRecord[]> {
  const { rows } = await db.query<Row>('SELECT * FROM faqs ORDER BY updated_at DESC, id DESC');
  return rows.map(map);
}

export async function createFaq(
  db: DBExecutor,
  input: Pick<FaqRecord, 'question' | 'answer'> & { tags?: string[]; enabled?: boolean },
): Promise<FaqRecord> {
  const row = await db.queryOne<Row>(
    `INSERT INTO faqs (question, answer, tags, enabled)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.question,
      input.answer,
      JSON.stringify(input.tags ?? []),
      input.enabled === false ? 0 : 1,
    ],
  );
  return map(row!);
}

export async function updateFaq(
  db: DBExecutor,
  id: number,
  input: Partial<Pick<FaqRecord, 'question' | 'answer' | 'enabled'>> & { tags?: string[] },
): Promise<FaqRecord | undefined> {
  const existingRow = await db.queryOne<Row>('SELECT * FROM faqs WHERE id = $1', [id]);
  if (!existingRow) return undefined;
  const existing = map(existingRow);
  const row = await db.queryOne<Row>(
    `UPDATE faqs
     SET question = $1, answer = $2, tags = $3, enabled = $4, updated_at = ${UTC_NOW_SQL}
     WHERE id = $5
     RETURNING *`,
    [
      input.question ?? existing.question,
      input.answer ?? existing.answer,
      JSON.stringify(input.tags ?? existing.tags),
      (input.enabled ?? existing.enabled) ? 1 : 0,
      id,
    ],
  );
  return row ? map(row) : undefined;
}

export async function findFaqAnswer(db: DBExecutor, text: string): Promise<FaqRecord | undefined> {
  const q = text.toLowerCase().trim();
  if (!q) return undefined;
  const { rows } = await db.query<Row>('SELECT * FROM faqs WHERE enabled = 1');
  const faqs = rows.map(map);
  let best: { score: number; faq: FaqRecord } | undefined;
  for (const faq of faqs) {
    const hay = `${faq.question} ${faq.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const token of q.split(/\s+/).filter((t) => t.length > 2)) {
      if (hay.includes(token)) score += 1;
    }
    if (q.includes(faq.question.toLowerCase().slice(0, Math.min(24, faq.question.length)))) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { score, faq };
  }
  return best && best.score >= 1 ? best.faq : undefined;
}
