import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import type { AdminAuth } from '../auth/admin-auth.js';
import { createAuthRouter } from '../auth/routes.js';
import { requireAdmin, requireWebhookSecret } from '../auth/http.js';
import { createPricingRouter } from './pricing-routes.js';
import { createQuoteRouter } from './quote-routes.js';
import { createConversationRouter } from './conversation-routes.js';

export interface AppOptions {
  auth: AdminAuth;
  sessionHours: number;
  cookieSecure: boolean;
  dashboardOrigin?: string;
  webhookSecret?: string;
  whatsappVerifyToken?: string;
}

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.string().default('general'),
  status: z.enum(['available', 'unavailable', 'limited', 'maintenance']),
  availability_note: z.string().default(''),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().optional(),
});

export function createApp(engine: SupportEngine, options: AppOptions) {
  const app = express();
  app.use(cors({ origin: options.dashboardOrigin ?? false, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', createAuthRouter(options.auth, {
    sessionHours: options.sessionHours,
    cookieSecure: options.cookieSecure,
  }));

  // Public channel ingress. Protected by a shared secret, not by admin login.
  app.post<{ channel: string }>('/api/channels/:channel/inbound', requireWebhookSecret(options.webhookSecret), async (req, res) => {
    const adapter = engine.adapters.get(req.params.channel);
    if (!adapter) return res.status(404).json({ error: `Unknown channel: ${req.params.channel}` });
    const msg = adapter.normalize(req.body.payload ?? req.body);
    if (!msg) return res.status(400).json({ error: 'Could not normalize payload' });
    const result = await engine.handleMessage(msg);
    // An empty reply means a human owns the conversation, so nothing is sent.
    if (result.reply.trim()) await adapter.sendMessage(msg.externalUserId, result);
    res.json(result);
  });

  // Meta WhatsApp Cloud API Webhook handshake (GET)
  app.get('/api/channels/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && options.whatsappVerifyToken && token === options.whatsappVerifyToken) {
      console.log('[whatsapp-webhook] Successfully verified by Meta webhook handshake!');
      res.status(200).send(challenge);
      return;
    }
    console.warn('[whatsapp-webhook] Verification failed. Mode or token mismatch.');
    res.status(403).send('Forbidden');
  });

  // Meta WhatsApp Cloud API Webhook receiver (POST)
  app.post('/api/channels/whatsapp/webhook', async (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    const adapter = engine.adapters.get('whatsapp');
    if (!adapter) return;
    const msg = adapter.normalize(req.body);
    if (!msg) return;

    try {
      console.log(`[whatsapp-webhook] Inbound message from ${msg.externalUserId}: "${msg.text}"`);
      const result = await engine.handleMessage(msg);
      // An empty reply means a human owns the conversation, so nothing is sent.
      if (result.reply.trim()) await adapter.sendMessage(msg.externalUserId, result);
    } catch (err) {
      console.error('[whatsapp-webhook] Error handling inbound message:', err);
    }
  });

  app.use('/api', requireAdmin(options.auth));
  app.use('/api', createPricingRouter(engine.db));
  app.use('/api', createQuoteRouter(engine));
  app.use('/api', createConversationRouter(engine));

  app.get('/api/dashboard/summary', (_req, res) => {
    const services = engine.listServices();
    const requests = engine.listRequests(500);
    const logs = engine.listLogs(500);
    const faqs = engine.listFaqs();
    const intakes = engine.listIntakes(500);
    res.json({
      counts: {
        services: services.length,
        availableServices: services.filter((s) => s.status === 'available').length,
        requests: requests.length,
        openRequests: requests.filter((r) => r.status === 'open').length,
        logs: logs.length,
        faqs: faqs.filter((f) => f.enabled).length,
        intakes: intakes.length,
        completeIntakes: intakes.filter((i) => i.status === 'complete').length,
      },
      recentRequests: requests.slice(0, 8),
      recentLogs: logs.slice(0, 10),
      services: services.slice(0, 8),
    });
  });

  app.get('/api/services', (_req, res) => res.json(engine.listServices()));
  app.post('/api/services', (req, res) => {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(engine.createService(parsed.data));
  });
  app.patch('/api/services/:id', (req, res) => {
    const id = Number(req.params.id);
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const row = engine.updateService(id, parsed.data);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.get('/api/faqs', (_req, res) => res.json(engine.listFaqs()));
  app.post('/api/faqs', (req, res) => {
    const parsed = faqSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(engine.createFaq(parsed.data));
  });
  app.patch('/api/faqs/:id', (req, res) => {
    const id = Number(req.params.id);
    const parsed = faqSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const row = engine.updateFaq(id, parsed.data);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.get('/api/requests', (req, res) => res.json(engine.listRequests(Number(req.query.limit) || 100)));
  app.get('/api/logs', (req, res) => res.json(engine.listLogs(Number(req.query.limit) || 200)));
  app.get('/api/sessions', (req, res) => res.json(engine.listSessions(Number(req.query.limit) || 100)));
  app.get('/api/sessions/:id/messages', (req, res) => {
    res.json(engine.listMessages(req.params.id, Number(req.query.limit) || 100));
  });
  app.get('/api/traces', (req, res) => res.json(engine.listTraces(Number(req.query.limit) || 100)));
  app.get('/api/intakes', (req, res) => res.json(engine.listIntakes(Number(req.query.limit) || 100)));

  app.post('/api/chat/simulate', async (req, res) => {
    const parsed = z.object({
      channel: z.string().default('web'),
      externalUserId: z.string().min(1),
      text: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await engine.handleMessage({
      channel: parsed.data.channel,
      externalUserId: parsed.data.externalUserId,
      text: parsed.data.text,
      metadata: parsed.data.metadata,
    });
    res.json(result);
  });

  const dashboardDist = path.resolve('dashboard/dist');
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  }

  return app;
}
