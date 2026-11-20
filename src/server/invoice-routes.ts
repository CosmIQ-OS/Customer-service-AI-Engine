import { Router } from 'express';
import { z } from 'zod';
import { InvoiceService, InvoiceWorkflowError, redactSecrets } from '../invoicing/service.js';
import { InvoiceNinjaError } from '../invoicing/ninja-gateway.js';
import { asyncHandler } from './async-handler.js';

const idSchema = z.coerce.number().int().positive();
const optionalId = z.coerce.number().int().positive().optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const customerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(320)]).optional().default(''),
  phone: z.string().trim().max(50).optional().default(''),
  address1: z.string().trim().max(300).optional().default(''),
  address2: z.string().trim().max(300).optional().default(''),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default(''),
  postalCode: z.string().trim().max(30).optional().default(''),
  countryCode: z.string().trim().length(2).optional().default('IN'),
  vatNumber: z.string().trim().max(100).optional().default(''),
  currency: z.string().trim().length(3).optional().default('INR'),
});
const createSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  leadId: optionalId,
  customerId: optionalId,
  customer: customerSchema,
  issueDate: dateSchema,
  dueDate: dateSchema,
  notes: z.string().max(5000).optional().default(''),
  items: z.array(z.object({
    quoteItemId: z.number().int().positive().nullable().optional(),
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().positive().max(100_000),
    unitPricePaise: z.number().int().nonnegative().safe(),
  })).min(1).max(100),
});
const settingsSchema = z.object({
  configured: z.boolean().optional(),
  companyName: z.string().trim().min(1).max(200),
  address: z.string().max(2000).default(''),
  taxNumber: z.string().max(100).default(''),
  logoUrl: z.union([z.literal(''), z.string().url()]).default(''),
  currency: z.string().length(3).default('INR'),
  defaultDueDays: z.number().int().min(0).max(365).default(14),
  paymentInstructions: z.string().max(5000).default(''),
  accountName: z.string().max(200).default(''),
  bankName: z.string().max(200).default(''),
  accountNumber: z.string().max(100).default(''),
  routingNumber: z.string().max(100).default(''),
  swiftCode: z.string().max(30).default(''),
  upiId: z.string().max(200).default(''),
  terms: z.string().max(5000).default(''),
});

export function createInvoiceRouter(service: InvoiceService): Router {
  const router = Router();

  router.get('/invoices/options', asyncHandler(async (req, res) => {
    res.json(await service.listSelectable(String(req.query.leadQuery ?? ''), String(req.query.customerQuery ?? '')));
  }));
  router.post('/invoices/compose', asyncHandler(async (req, res) => {
    const parsed = z.object({ leadId: optionalId, customerId: optionalId }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid lead or customer.' });
    res.json(await service.compose(parsed.data));
  }));
  router.get('/invoices', asyncHandler(async (req, res) => {
    const status = z.enum(['pending', 'sent', 'paid', 'discarded']).optional().parse(req.query.status || undefined);
    res.json({ invoices: await service.list(status, String(req.query.query ?? '')) });
  }));
  router.post('/invoices', asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(await service.create(parsed.data, res.locals.admin?.id ?? null));
  }));
  router.get('/invoices/:id', asyncHandler(async (req, res) => {
    // nosemgrep -- res.json serializes JSON, never HTML.
    res.json(await service.detail(idSchema.parse(req.params.id)));
  }));
  router.post('/invoices/:id/send', asyncHandler(async (req, res) => {
    // nosemgrep -- res.json serializes JSON, never HTML.
    res.json(await service.send(idSchema.parse(req.params.id)));
  }));
  router.post('/invoices/:id/void', asyncHandler(async (req, res) => {
    res.json(await service.void(idSchema.parse(req.params.id)));
  }));
  router.post('/invoices/:id/archive', asyncHandler(async (req, res) => {
    res.json(await service.archive(idSchema.parse(req.params.id)));
  }));
  router.get('/invoices/:id/pdf', asyncHandler(async (req, res) => {
    const pdf = await service.download(idSchema.parse(req.params.id));
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', pdf.contentType === 'application/pdf' ? pdf.contentType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename(pdf.filename)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    // Authenticated user bytes are proxied verbatim: never let a browser sniff them as HTML.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // nosemgrep -- PDF/octet-stream bytes with nosniff, never HTML.
    res.send(Buffer.from(pdf.bytes));
  }));
  router.get('/invoice-settings', asyncHandler(async (_req, res) => {
    res.json(await service.getSettings());
  }));
  router.put('/invoice-settings', asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(await service.updateSettings({ ...parsed.data, configured: true }));
  }));

  router.use((error: unknown, _req: any, res: any, next: any) => {
    if (error instanceof InvoiceWorkflowError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid invoice request.' });
    if (res.headersSent) return next(error);
    if (error instanceof InvoiceNinjaError) {
      return res.status(502).json({ error: redactSecrets(error.message) });
    }
    // Never echo driver, filesystem, or connection-string details to the browser.
    console.error('[invoices] Unhandled invoice error:', error);
    res.status(502).json({ error: 'Invoice operation failed.' });
  });
  return router;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'invoice';
}
