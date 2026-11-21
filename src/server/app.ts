import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import type { AdminAuth } from '../auth/admin-auth.js';
import { createAuthRouter } from '../auth/routes.js';
import { requireAdmin, requireWebhookSecret } from '../auth/http.js';
import { asyncHandler } from './async-handler.js';
import { createRateLimiter } from './rate-limiter.js';
import { createPricingRouter } from './pricing-routes.js';
import { createQuoteRouter } from './quote-routes.js';
import { createConversationRouter } from './conversation-routes.js';
import { createNotificationRouter } from './notification-routes.js';

export interface AppOptions {
  auth: AdminAuth;
  sessionHours: number;
  cookieSecure: boolean;
  dashboardOrigin?: string;
  webhookSecret?: string;
  whatsappVerifyToken?: string;
}

const MAX_PG_INT4 = 2_147_483_647;

function parseServiceId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_PG_INT4) return null;
  return id;
}

const serviceStatusSchema = z.enum(['available', 'unavailable', 'limited', 'maintenance']);

const createServiceSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(''),
  category: z.string().default('general'),
  status: serviceStatusSchema.default('available'),
  availability_note: z.string().default(''),
  base_price_paise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  basePriceInr: z.number().finite().min(0).max(Math.floor(Number.MAX_SAFE_INTEGER / 100)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateServiceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  status: serviceStatusSchema.optional(),
  availability_note: z.string().optional(),
  base_price_paise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  basePriceInr: z.number().finite().min(0).max(Math.floor(Number.MAX_SAFE_INTEGER / 100)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().optional(),
});

const updateIntakeStatusSchema = z.object({
  status: z.enum(['collecting', 'collected', 'quoted', 'deal_won', 'completed', 'complete']),
});

export function createApp(engine: SupportEngine, options: AppOptions) {
  const app = express();
  app.use(cors({ origin: options.dashboardOrigin ?? false, credentials: true }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', asyncHandler(async (_req, res) => {
    await engine.db.queryOne('SELECT 1 AS ok');
    res.json({ ok: true, db: engine.db.driver, time: new Date().toISOString() });
  }));

  app.use('/api/auth', createAuthRouter(options.auth, {
    sessionHours: options.sessionHours,
    cookieSecure: options.cookieSecure,
  }));

  // Public channel ingress. Protected by a shared secret, not by admin login.
  app.post<{ channel: string }>(
    '/api/channels/:channel/inbound',
    requireWebhookSecret(options.webhookSecret),
    asyncHandler<{ channel: string }>(async (req, res) => {
      const adapter = engine.adapters.get(req.params.channel);
      if (!adapter) return res.status(404).json({ error: `Unknown channel: ${req.params.channel}` });
      const msg = adapter.normalize(req.body.payload ?? req.body);
      if (!msg) return res.status(400).json({ error: 'Could not normalize payload' });
      const result = await engine.handleMessage(msg);
      // An empty reply means a human owns the conversation, so nothing is sent.
      if (result.reply.trim()) await adapter.sendMessage(msg.externalUserId, result);
      res.json(result);
    }),
  );

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

    // Capture asynchronous Meta delivery failure callbacks (e.g. 131047 24h window expired, 131030 test allowlist)
    const entryValue = (req.body as any)?.entry?.[0]?.changes?.[0]?.value;
    const statuses = Array.isArray(entryValue?.statuses) ? entryValue.statuses : [];
    for (const st of statuses) {
      if (st?.status === 'failed') {
        const firstErr = Array.isArray(st.errors) ? st.errors[0] : undefined;
        const recipient = String(st.recipient_id ?? 'unknown');
        const reason = firstErr
          ? `[${firstErr.code ?? 'err'}] ${firstErr.title ?? ''} ${firstErr.message ?? ''}`.trim()
          : 'Meta reported message delivery failed';
        console.warn(`[whatsapp-webhook] Delivery failed to ${recipient}: ${reason}`);
        await engine.recordWhatsappDeliveryFailure(recipient, reason, st).catch(() => undefined);
      }
    }

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

  const leadRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many lead submissions from this network. Please wait a moment and try again.',
  });

  const websiteLeadSchema = z
    .object({
      company_name: z.string().trim().min(1, 'Company name is required').max(255),
      company_size: z.string().trim().max(50).optional().default(''),
      contact_person: z.string().trim().max(255).optional().default(''),
      email: z.string().trim().max(255).optional().default(''),
      phone: z.string().trim().max(50).optional().default(''),
      current_tools: z.string().trim().max(500).optional().default(''),
      service_name: z.string().trim().max(255).optional().default(''),
      service_id: z.number().int().positive().nullable().optional(),
      notes: z.string().trim().max(2000).optional().default(''),
    })
    .refine(
      (data) => Boolean(data.email || data.phone || data.contact_person),
      { message: 'Please provide at least a contact person, email, or phone number.' },
    );

  const normalizeLeadPayload = (raw: Record<string, unknown> | null | undefined) => {
    if (!raw || typeof raw !== 'object') return {};
    return {
      company_name: raw.company_name ?? raw.companyName ?? raw.company ?? raw.domain ?? '',
      company_size: raw.company_size ?? raw.companySize ?? raw.size ?? '',
      contact_person: raw.contact_person ?? raw.contactPerson ?? raw.name ?? raw.fullName ?? '',
      email: raw.email ?? '',
      phone: raw.phone ?? raw.phoneNumber ?? raw.whatsapp ?? '',
      current_tools: raw.current_tools ?? raw.currentTools ?? raw.tools ?? '',
      service_name: raw.service_name ?? raw.serviceName ?? raw.serviceNeeded ?? (Array.isArray(raw.automations) ? raw.automations.join(', ') : raw.automations) ?? '',
      service_id: raw.service_id ?? raw.serviceId ?? null,
      notes: raw.notes ?? raw.message ?? raw.requirements ?? '',
    };
  };

  const handleWebsiteLead = asyncHandler(async (req: Request, res: Response) => {
    const normalized = normalizeLeadPayload(req.body);
    const parsed = websiteLeadSchema.safeParse(normalized);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const result = await engine.recordWebsiteLead(parsed.data);
    res.status(201).json({
      ok: true,
      message: 'Thank you! Your inquiry has been received. Our team will contact you shortly.',
      ...result,
    });
  });

  app.post('/api/leads', leadRateLimiter, handleWebsiteLead);
  app.post('/api/intake/website', leadRateLimiter, handleWebsiteLead);

  app.use('/api', requireAdmin(options.auth));
  app.use('/api', createPricingRouter(engine.db));
  app.use('/api', createNotificationRouter(engine));
  app.use('/api', createQuoteRouter(engine));
  app.use('/api', createConversationRouter(engine));

  app.get('/api/dashboard/summary', asyncHandler(async (_req, res) => {
    const [services, requests, logs, faqs, intakes] = await Promise.all([
      engine.listServices(),
      engine.listRequests(500),
      engine.listLogs(500),
      engine.listFaqs(),
      engine.listIntakes(500),
    ]);
    res.json({
      counts: {
        services: services.length,
        availableServices: services.filter((s) => s.status === 'available').length,
        requests: requests.length,
        openRequests: requests.filter((r) => r.status === 'open').length,
        logs: logs.length,
        faqs: faqs.filter((f) => f.enabled).length,
        intakes: intakes.length,
        completeIntakes: intakes.filter((i) => i.status !== 'collecting').length,
        collectedIntakes: intakes.filter((i) => i.status === 'collected').length,
        quotedIntakes: intakes.filter((i) => i.status === 'quoted').length,
        dealWonIntakes: intakes.filter((i) => i.status === 'deal_won').length,
        completedIntakes: intakes.filter((i) => i.status === 'completed').length,
      },
      recentRequests: requests.slice(0, 8),
      recentLogs: logs.slice(0, 10),
      services: services.slice(0, 8),
    });
  }));

  app.get('/api/services', asyncHandler(async (_req, res) => {
    res.json(await engine.listServices());
  }));
  app.post('/api/services', asyncHandler(async (req, res) => {
    const parsed = createServiceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { basePriceInr, base_price_paise, ...rest } = parsed.data;
    const resolvedPrice =
      base_price_paise !== undefined
        ? base_price_paise
        : basePriceInr !== undefined
          ? Math.round(basePriceInr * 100)
          : 0;
    res.status(201).json(await engine.createService({ ...rest, base_price_paise: resolvedPrice }));
  }));
  app.patch('/api/services/:id', asyncHandler(async (req, res) => {
    const id = parseServiceId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid service id' });
    const parsed = updateServiceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { basePriceInr, base_price_paise, ...rest } = parsed.data;
    const resolvedPrice =
      base_price_paise !== undefined
        ? base_price_paise
        : basePriceInr !== undefined
          ? Math.round(basePriceInr * 100)
          : undefined;
    const row = await engine.updateService(
      id,
      resolvedPrice !== undefined ? { ...rest, base_price_paise: resolvedPrice } : rest,
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));
  app.delete('/api/services/:id', asyncHandler(async (req, res) => {
    const id = parseServiceId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid service id' });
    const result = await engine.deleteService(id);
    if (result.status === 'not_found') return res.status(404).json({ error: 'Service not found' });
    if (result.status === 'in_use') {
      return res.status(409).json({
        error: 'Cannot delete service referenced by existing proposals',
        code: 'SERVICE_IN_USE',
        quoteCount: result.quoteCount,
      });
    }
    res.json({ deleted: true, id: result.id });
  }));

  app.get('/api/faqs', asyncHandler(async (_req, res) => {
    res.json(await engine.listFaqs());
  }));
  app.post('/api/faqs', asyncHandler(async (req, res) => {
    const parsed = faqSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(await engine.createFaq(parsed.data));
  }));
  app.patch('/api/faqs/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = faqSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const row = await engine.updateFaq(id, parsed.data);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));

  app.get('/api/requests', asyncHandler(async (req, res) => {
    res.json(await engine.listRequests(Number(req.query.limit) || 100));
  }));
  app.get('/api/logs', asyncHandler(async (req, res) => {
    res.json(await engine.listLogs(Number(req.query.limit) || 200));
  }));
  app.get('/api/sessions', asyncHandler(async (req, res) => {
    res.json(await engine.listSessions(Number(req.query.limit) || 100));
  }));
  app.get('/api/sessions/:id/messages', asyncHandler(async (req, res) => {
    res.json(await engine.listMessages(req.params.id, Number(req.query.limit) || 100));
  }));
  app.get('/api/traces', asyncHandler(async (req, res) => {
    res.json(await engine.listTraces(Number(req.query.limit) || 100));
  }));
  app.get('/api/intakes', asyncHandler(async (req, res) => {
    res.json(await engine.listIntakes(Number(req.query.limit) || 100));
  }));
  app.patch('/api/intakes/:id', asyncHandler(async (req, res) => {
    const id = parseServiceId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid intake id' });
    const parsed = updateIntakeStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const normalizedStatus = parsed.data.status === 'complete' ? 'completed' : parsed.data.status;
    const updated = await engine.updateIntakeStatus(id, normalizedStatus, res.locals.admin?.id ?? null);
    if (!updated) return res.status(404).json({ error: 'Intake not found' });
    res.json(updated);
  }));
  app.delete('/api/intakes/:id', asyncHandler(async (req, res) => {
    const id = parseServiceId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid intake id' });
    const deleted = await engine.deleteIntake(id, res.locals.admin?.id ?? null);
    if (!deleted) return res.status(404).json({ error: 'Intake not found' });
    res.json({ deleted: true, id: deleted.id });
  }));

  app.post('/api/chat/simulate', asyncHandler(async (req, res) => {
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
  }));

  const dashboardDist = path.resolve('dashboard/dist');
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
