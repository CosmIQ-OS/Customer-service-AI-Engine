import { Router } from 'express';
import { z } from 'zod';
import type { SupportEngine } from '../engine/support-engine.js';
import { MAX_QUOTE_MARGIN, MIN_QUOTE_MARGIN } from '../pricing/margin.js';
import { generateProposalPdf } from '../pricing/proposal-pdf.js';
import { generateContractProposalPdf } from '../pricing/contract-proposal-pdf.js';
import { asyncHandler } from './async-handler.js';

const marginSchema = z.object({
  marginPercent: z.number().finite().min(MIN_QUOTE_MARGIN).max(MAX_QUOTE_MARGIN),
});

const positiveMultiplierSchema = z.number().finite().positive();

const companySizeMultipliersSchema = z.object({
  '0-5': positiveMultiplierSchema,
  '5-10': positiveMultiplierSchema,
  '10-20': positiveMultiplierSchema,
  '20+': positiveMultiplierSchema,
});

const multipliersSchema = z.object({
  companySizeMultipliers: companySizeMultipliersSchema,
});

const termsSchema = z.object({
  defaultTermsAndConditions: z.string().max(50_000),
});

const updateSettingsSchema = z
  .object({
    quoteMarginPercent: z.number().finite().min(MIN_QUOTE_MARGIN).max(MAX_QUOTE_MARGIN).optional(),
    companySizeMultipliers: companySizeMultipliersSchema.optional(),
    defaultTermsAndConditions: z.string().max(50_000).optional(),
  })
  .refine(
    (value) =>
      value.quoteMarginPercent !== undefined ||
      value.companySizeMultipliers !== undefined ||
      value.defaultTermsAndConditions !== undefined,
    { message: 'Send at least one setting to update.' },
  );

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

const proposalItemSchema = z.object({
  serviceId: z.number().int().positive().nullable().optional(),
  priceItemId: z.number().int().positive().nullable().optional(),
  itemCode: z.string().max(50).optional(),
  description: z.string().min(1).max(500),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive().max(100_000),
  unitPricePaise: z.number().int().nonnegative().max(1_000_000_000_000),
  lineTotalPaise: z.number().int().nonnegative().max(100_000_000_000_000).optional(),
});

const createProposalSchema = z.object({
  sessionId: z.string().nullable().optional(),
  channel: z.string().max(50).optional(),
  externalUserId: z.string().max(255).optional(),
  intakeId: z.number().int().positive().nullable().optional(),
  clientName: z.string().min(1).max(255),
  clientEmail: z.string().max(255).optional(),
  companySize: z.string().max(50).optional(),
  serviceId: z.number().int().positive().nullable().optional(),
  serviceName: z.string().max(255).optional(),
  marginPercent: z.number().finite().optional(),
  status: z.enum(['pending', 'paid', 'draft']).optional(),
  termsAndConditions: z.string().max(50_000).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(proposalItemSchema).min(1).max(100),
});

const updateInvoiceStatusSchema = z.object({
  status: z.enum(['pending', 'paid', 'draft', 'approved', 'rejected']),
});

const proposalSettingsSchema = z.object({
  ourCompanyName: z.string().max(255).optional(),
  ourCompanyDetails: z.string().max(5000).optional(),
  signerName: z.string().max(255).optional(),
  signerDesignation: z.string().max(255).optional(),
  signerSignatureData: z.string().max(2_000_000).optional(),
  defaultDataPrivacy: z.string().max(50_000).optional(),
});

const contractProposalStatusEnum = z.enum(['sent', 'pending', 'accepted', 'rejected']);

const createContractProposalSchema = z.object({
  intakeId: z.number().int().positive().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  channel: z.string().max(50).optional(),
  ourCompanyName: z.string().max(255).optional(),
  ourCompanyDetails: z.string().max(5000).optional(),
  clientCompany: z.string().trim().min(1, 'Customer company name is required').max(255),
  clientName: z.string().max(255).optional(),
  clientEmail: z.string().max(255).optional(),
  clientPhone: z.string().max(255).optional(),
  clientDesignation: z.string().max(255).optional(),
  proposalDate: z.string().max(50).optional(),
  scopeOfProject: z.string().max(50_000).optional(),
  phasesAndTimeline: z.string().max(50_000).optional(),
  paymentSchedules: z.string().max(50_000).optional(),
  successMetrics: z.string().max(50_000).optional(),
  ongoingCost: z.string().max(50_000).optional(),
  supportAndWarranty: z.string().max(50_000).optional(),
  dataPrivacy: z.string().max(50_000).optional(),
  includeSigning: z.boolean().optional(),
  signerName: z.string().max(255).optional(),
  signerDesignation: z.string().max(255).optional(),
  signerSignatureData: z.string().max(2_000_000).optional(),
  clientSignatureData: z.string().max(2_000_000).optional(),
  status: contractProposalStatusEnum.optional(),
});

const updateContractProposalStatusSchema = z.object({
  status: contractProposalStatusEnum,
});

export function createQuoteRouter(engine: SupportEngine): Router {
  const router = Router();

  router.get('/settings', asyncHandler(async (_req, res) => {
    res.json(await settingsPayload(engine));
  }));

  router.put('/settings/quote-margin', asyncHandler(async (req, res) => {
    const parsed = marginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: `Margin must be between ${MIN_QUOTE_MARGIN} and ${MAX_QUOTE_MARGIN} percent.`,
      });
    }
    await engine.setQuoteMarginPercent(parsed.data.marginPercent, res.locals.admin?.id ?? null);
    res.json(await settingsPayload(engine));
  }));

  router.put('/settings/multipliers', asyncHandler(async (req, res) => {
    const parsed = multipliersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Send positive finite multipliers for 0-5, 5-10, 10-20, and 20+.',
      });
    }
    await engine.setCompanySizeMultipliers(parsed.data.companySizeMultipliers, res.locals.admin?.id ?? null);
    res.json(await settingsPayload(engine));
  }));

  router.put('/settings/terms', asyncHandler(async (req, res) => {
    const parsed = termsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Send defaultTermsAndConditions as a string (max 50,000 characters).',
      });
    }
    await engine.setDefaultTermsAndConditions(parsed.data.defaultTermsAndConditions, res.locals.admin?.id ?? null);
    res.json(await settingsPayload(engine));
  }));

  router.put('/settings', asyncHandler(async (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Send a valid quoteMarginPercent, companySizeMultipliers, or defaultTermsAndConditions.',
      });
    }
    await engine.updateSettings(parsed.data, res.locals.admin?.id ?? null);
    res.json(await settingsPayload(engine));
  }));

  router.get('/quotes', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ quotes: await engine.listQuotes(limit) });
  }));

  router.get('/approvals', asyncHandler(async (_req, res) => {
    const [pending, counts, notifications] = await Promise.all([
      engine.listPendingApprovals(),
      engine.approvalSummary(),
      engine.listNotifications({ limit: 25 }),
    ]);
    res.json({ pending, counts, notifications });
  }));

  router.post('/quotes/build', asyncHandler(async (req, res) => {
    const parsed = buildSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Send a sessionId.' });
    try {
      const built = await engine.buildQuoteForSession(parsed.data.sessionId, { force: parsed.data.force });
      res.status(201).json(built);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : 'Could not build the quote.' });
    }
  }));

  router.get('/quotes/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    const found = await engine.getQuote(id);
    if (!found) return res.status(404).json({ error: 'Quote not found' });
    res.json(found);
  }));

  router.patch('/quotes/:id', asyncHandler(async (req, res) => {
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
      const updated = await engine.editQuote(
        id,
        { marginPercent: parsed.data.marginPercent, quantities },
        res.locals.admin?.id ?? null,
      );
      res.json(updated);
    } catch (error) {
      res.status(quoteErrorStatus(error)).json({ error: quoteErrorMessage(error) });
    }
  }));

  router.patch('/quotes/:id/status', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });
    const parsed = updateInvoiceStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid invoice status.' });
    const updated = await engine.updateQuoteStatus(id, parsed.data.status, res.locals.admin?.id ?? null);
    if (!updated) return res.status(404).json({ error: 'Invoice not found' });
    res.json(updated);
  }));

  router.post('/quotes/:id/approve', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid quote id' });
    try {
      const result = await engine.approveQuote(id, res.locals.admin?.id ?? null);
      res.json(result);
    } catch (error) {
      res.status(quoteErrorStatus(error)).json({ error: quoteErrorMessage(error) });
    }
  }));

  router.post('/quotes/:id/reject', asyncHandler(async (req, res) => {
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
  }));

  router.post('/proposals', asyncHandler(async (req, res) => {
    const parsed = createProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const created = await engine.createProposal({
      ...parsed.data,
      createdBy: res.locals.admin?.username || 'admin',
    });
    res.status(201).json(created);
  }));

  router.get(['/quotes/:id/pdf', '/proposals/:id/pdf'], asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });
    const found = await engine.getQuote(id);
    if (!found) return res.status(404).json({ error: 'Invoice not found' });

    const quote = found.quote;
    const items = found.items;

    const pdfBuffer = await generateProposalPdf({
      quoteNumber: quote.quote_number,
      date: (quote.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      validUntil: quote.expires_at ? quote.expires_at.slice(0, 10) : undefined,
      status: quote.status,
      clientName: quote.client_name || quote.service_name || 'Valued Client',
      clientCompany: quote.client_name || quote.service_name,
      clientEmail: quote.client_email || undefined,
      clientPhone: quote.external_user_id,
      companySize: quote.company_size || undefined,
      channel: quote.channel,
      items: items.map((it) => ({
        itemCode: it.item_code,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unitPricePaise: it.quoted_unit_price_paise,
        lineTotalPaise: it.line_total_paise,
      })),
      subtotalPaise: quote.subtotal_paise,
      marginPercent: 0,
      totalPaise: quote.total_paise,
      termsAndConditions: quote.terms_and_conditions || undefined,
      notes: quote.notes || undefined,
    });

    const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${quote.quote_number}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  }));

  router.get('/proposal-settings', asyncHandler(async (_req, res) => {
    res.json(await engine.getProposalTemplateSettings());
  }));

  router.put('/proposal-settings', asyncHandler(async (req, res) => {
    const parsed = proposalSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const updated = await engine.setProposalTemplateSettings(parsed.data, res.locals.admin?.id ?? null);
    res.json(updated);
  }));

  router.get('/contract-proposals', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    res.json({ proposals: await engine.listContractProposals(limit) });
  }));

  router.post('/contract-proposals', asyncHandler(async (req, res) => {
    const parsed = createContractProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const created = await engine.createContractProposal({
      ...parsed.data,
      createdBy: res.locals.admin?.username || 'admin',
    });
    res.status(201).json(created);
  }));

  router.get('/contract-proposals/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid proposal id' });
    const found = await engine.getContractProposal(id);
    if (!found) return res.status(404).json({ error: 'Proposal not found' });
    res.json(found);
  }));

  router.patch('/contract-proposals/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid proposal id' });
    const parsed = updateContractProposalStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid proposal status.' });
    const updated = await engine.updateContractProposalStatus(id, parsed.data.status);
    if (!updated) return res.status(404).json({ error: 'Proposal not found' });
    res.json(updated);
  }));

  router.get('/contract-proposals/:id/pdf', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid proposal id' });
    const found = await engine.getContractProposal(id);
    if (!found) return res.status(404).json({ error: 'Proposal not found' });

    const pdfBuffer = await generateContractProposalPdf(found);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${found.proposal_number}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  }));

  return router;
}

function quoteErrorStatus(error: unknown): number {
  const message = quoteErrorMessage(error);
  return /not found/i.test(message) ? 404 : 422;
}

function quoteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not update the quote.';
}

async function settingsPayload(engine: SupportEngine) {
  return engine.getSettings();
}
