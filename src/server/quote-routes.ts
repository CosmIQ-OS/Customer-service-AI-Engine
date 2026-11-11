import { Router } from 'express';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import { MAX_QUOTE_MARGIN, MIN_QUOTE_MARGIN } from '../pricing/margin.js';

const marginSchema = z.object({
  marginPercent: z.number().min(MIN_QUOTE_MARGIN).max(MAX_QUOTE_MARGIN),
});

const buildSchema = z.object({
  sessionId: z.string().min(1),
  force: z.boolean().optional(),
});

export function createQuoteRouter(engine: SupportEngine): Router {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json(settingsPayload(engine));
  });

  router.put('/settings/quote-margin', (req, res) => {
    const parsed = marginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: `Margin must be between ${MIN_QUOTE_MARGIN} and ${MAX_QUOTE_MARGIN} percent.`,
      });
    }
    engine.setQuoteMarginPercent(parsed.data.marginPercent, res.locals.admin?.id ?? null);
    res.json(settingsPayload(engine));
  });

  router.get('/quotes', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ quotes: engine.listQuotes(limit) });
  });

  router.get('/quotes/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    const found = engine.getQuote(id);
    if (!found) return res.status(404).json({ error: 'Quote not found' });
    res.json(found);
  });

  router.post('/quotes/build', async (req, res) => {
    const parsed = buildSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Send a sessionId.' });
    try {
      const built = await engine.buildQuoteForSession(parsed.data.sessionId, { force: parsed.data.force });
      res.status(201).json(built);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : 'Could not build the quote.' });
    }
  });

  return router;
}

function settingsPayload(engine: SupportEngine) {
  return {
    quoteMarginPercent: engine.getQuoteMarginPercent(),
    minMarginPercent: MIN_QUOTE_MARGIN,
    maxMarginPercent: MAX_QUOTE_MARGIN,
  };
}
