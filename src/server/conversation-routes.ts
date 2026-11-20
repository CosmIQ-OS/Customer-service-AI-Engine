import { Router } from 'express';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import { asyncHandler } from './async-handler.js';

const adminReplySchema = z.object({
  text: z.string().min(1).max(4000),
});

export function createConversationRouter(engine: SupportEngine): Router {
  const router = Router();

  router.get('/conversations', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ conversations: await engine.listConversations(limit) });
  }));

  router.get('/conversations/needing-human', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ conversations: await engine.listConversationsNeedingHuman(limit) });
  }));

  router.get('/conversations/:id', asyncHandler(async (req, res) => {
    const conversation = await engine.getConversationSummary(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    res.json({
      conversation,
      messages: await engine.listMessages(req.params.id, limit),
    });
  }));

  router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    res.json({ messages: await engine.listMessages(req.params.id, limit) });
  }));

  router.post('/conversations/:id/pause', asyncHandler(async (req, res) => {
    const conversation = await engine.pauseAi(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  }));

  router.post('/conversations/:id/takeover', asyncHandler(async (req, res) => {
    const admin = res.locals.admin;
    const conversation = await engine.takeOverConversation(
      req.params.id,
      admin?.id ?? null,
      admin?.display_name || admin?.username,
    );
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  }));

  router.post('/conversations/:id/handback', asyncHandler(async (req, res) => {
    const admin = res.locals.admin;
    const conversation = await engine.handBackConversation(req.params.id, admin?.id ?? null);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  }));

  router.post('/conversations/:id/reply', asyncHandler(async (req, res) => {
    const parsed = adminReplySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Send a message between 1 and 4000 characters.' });
    const admin = res.locals.admin;
    try {
      const result = await engine.sendAdminReply(req.params.id, admin?.id ?? null, parsed.data.text);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send the reply.';
      res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
    }
  }));

  return router;
}
