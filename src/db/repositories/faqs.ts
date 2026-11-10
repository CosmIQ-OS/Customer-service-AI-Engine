import type { DB } from '../database.js';
import type { FaqRecord } from '../../engine/types.js';
import { parseJson } from './common.js';

type Row = Omit<FaqRecord, 'tags' | 'enabled'> & { tags: string; enabled: number };

function map(row: Row): FaqRecord {
  return { ...row, tags: parseJson(row.tags, []), enabled: Boolean(row.enabled) };
}

export function listFaqs(db: DB): FaqRecord[] {
  return (db.prepare('SELECT * FROM faqs ORDER BY updated_at DESC, id DESC').all() as Row[]).map(map);
}

export function createFaq(
  db: DB,
  input: Pick<FaqRecord, 'question' | 'answer'> & { tags?: string[]; enabled?: boolean },
): FaqRecord {
  const info = db.prepare(
    `INSERT INTO faqs (question, answer, tags, enabled) VALUES (@question, @answer, @tags, @enabled)`,
  ).run({
    question: input.question,
    answer: input.answer,
    tags: JSON.stringify(input.tags ?? []),
    enabled: input.enabled === false ? 0 : 1,
  });
  return map(db.prepare('SELECT * FROM faqs WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
}

export function updateFaq(
  db: DB,
  id: number,
  input: Partial<Pick<FaqRecord, 'question' | 'answer' | 'enabled'>> & { tags?: string[] },
): FaqRecord | undefined {
  const row = db.prepare('SELECT * FROM faqs WHERE id = ?').get(id) as Row | undefined;
  if (!row) return undefined;
  const existing = map(row);
  db.prepare(
    `UPDATE faqs SET question=@question, answer=@answer, tags=@tags, enabled=@enabled, updated_at=datetime('now') WHERE id=@id`,
  ).run({
    id,
    question: input.question ?? existing.question,
    answer: input.answer ?? existing.answer,
    tags: JSON.stringify(input.tags ?? existing.tags),
    enabled: (input.enabled ?? existing.enabled) ? 1 : 0,
  });
  return map(db.prepare('SELECT * FROM faqs WHERE id = ?').get(id) as Row);
}

export function findFaqAnswer(db: DB, text: string): FaqRecord | undefined {
  const q = text.toLowerCase().trim();
  if (!q) return undefined;
  const faqs = (db.prepare('SELECT * FROM faqs WHERE enabled = 1').all() as Row[]).map(map);
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
