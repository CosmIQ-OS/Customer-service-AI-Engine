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

const editSchema = z
  .object({
    marginPercent: z.number().min(MIN_QUOTE_MARGIN).max(MAX_QUOTE_MARGIN).optional(),
    items: z
      .array(
        z.object({
          id: z.number().int().positive(),
          quantity: z.number().positive().max(100_000),
        }),
      )
      .max(100)
      .optional(),
  })
  .refine((value) => value.marginPercent !== undefined || (value.items?.length ?? 0) > 0, {
    message: 'Send a marginPercent or item quantities.',
  });

const rejectSchema = z.object({
  note: z.string().max(1000).optional().default(''),
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

  router.get('/approvals', (_req, res) => {
    res.json({
      pending: engine.listPendingApprovals(),
      counts: engine.approvalSummary(),
      notifications: engine.listNotifications({ limit: 25 }),
    });
  });

  router.get('/notifications', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    res.json({
      notifications: engine.listNotifications({ limit, unreadOnly }),
      unread: engine.approvalSummary().unread,
    });
  });

  router.post('/notifications/read-all', (_req, res) => {
    res.json({ updated: engine.markAllNotificationsRead() });
  });

  router.post('/notifications/:id/read', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid notification id' });
    const notification = engine.markNotificationRead(id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json(notification);
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

  router.get('/quotes/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    const found = engine.getQuote(id);
    if (!found) return res.status(404).json({ error: 'Quote not found' });
    res.json(found);
  });

  router.patch('/quotes/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: `Send a margin between ${MIN_QUOTE_MARGIN} and ${MAX_QUOTE_MARGIN} or item quantities.`,
      });
    }
    const quantities = parsed.data.items
      ? Object.fromEntries(parsed.data.items.map((item) => [item.id, item.quantity]))
      : undefined;
    try {
      const updated = engine.editQuote(
        id,
        { marginPercent: parsed.data.marginPercent, quantities },
        res.locals.admin?.id ?? null,
      );
      res.json(updated);
    } catch (error) {
      res.status(quoteErrorStatus(error)).json({ error: quoteErrorMessage(error) });
    }
  });

  router.post('/quotes/:id/approve', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    try {
      const result = await engine.approveQuote(id, res.locals.admin?.id ?? null);
      res.json(result);
    } catch (error) {
      res.status(quoteErrorStatus(error)).json({ error: quoteErrorMessage(error) });
    }
  });

  router.post('/quotes/:id/reject', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'The rejection note is too long.' });
    try {
      const result = await engine.rejectQuote(id, res.locals.admin?.id ?? null, parsed.data.note);
      res.json(result);
    } catch (error) {
      res.status(quoteErrorStatus(error)).json({ error: quoteErrorMessage(error) });
    }
  });

  return router;
}

function quoteErrorStatus(error: unknown): number {
  const message = quoteErrorMessage(error);
  return /not found/i.test(message) ? 404 : 422;
}

function quoteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update the quote.';
}

function settingsPayload(engine: SupportEngine) {
  return {
    quoteMarginPercent: engine.getQuoteMarginPercent(),
    minMarginPercent: MIN_QUOTE_MARGIN,
    maxMarginPercent: MAX_QUOTE_MARGIN,
  };
}
