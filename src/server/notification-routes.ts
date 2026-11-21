import { Router } from 'express';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import { asyncHandler } from './async-handler.js';

const updateNotificationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  notifyOnLeadStarted: z.boolean().optional(),
  notifyOnLeadQualified: z.boolean().optional(),
  notifyOnWebsiteLead: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappRecipients: z.array(z.string().max(40)).max(25).optional(),
  telegramEnabled: z.boolean().optional(),
  telegramChatIds: z.array(z.number().int().refine((n) => n !== 0)).max(25).optional(),
});

export function createNotificationRouter(engine: SupportEngine): Router {
  const router = Router();

  router.get('/notifications', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const [notifications, summary] = await Promise.all([
      engine.listNotifications({ limit, unreadOnly }),
      engine.approvalSummary(),
    ]);
    res.json({ notifications, unread: summary.unread });
  }));

  /** Server-Sent Events stream for sub-second dashboard notification delivery. */
  router.get('/notifications/stream', asyncHandler(async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const summary = await engine.approvalSummary();
    sendEvent('ready', { unread: summary.unread, time: new Date().toISOString() });

    const unsubscribe = engine.notificationHub.subscribe((payload) => {
      if (payload.type === 'notification') {
        sendEvent('notification', payload);
      } else {
        sendEvent('unread', payload);
      }
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }));

  router.get('/notifications/settings', asyncHandler(async (_req, res) => {
    res.json(await engine.getLeadNotificationSettingsView());
  }));

  router.put('/notifications/settings', asyncHandler(async (req, res) => {
    const parsed = updateNotificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const updated = await engine.updateLeadNotificationSettings(parsed.data, res.locals.admin?.id ?? null);
    res.json(updated);
  }));

  router.post('/notifications/test', asyncHandler(async (_req, res) => {
    const result = await engine.sendTestLeadNotification();
    res.status(201).json(result);
  }));

  router.post('/notifications/read-all', asyncHandler(async (_req, res) => {
    res.json({ updated: await engine.markAllNotificationsRead() });
  }));

  router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid notification id' });
    const notification = await engine.markNotificationRead(id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json(notification);
  }));

  return router;
}
