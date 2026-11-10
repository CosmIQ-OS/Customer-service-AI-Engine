import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import * as pricingRepo from '../db/repositories/pricing.js';
import * as servicesRepo from '../db/repositories/services.js';
import { MAX_PRICE_TABLE_BYTES, parsePriceTable } from '../pricing/parse-price-table.js';

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1).max(1_000_000),
});

export function createPricingRouter(db: DB): Router {
  const router = Router();

  router.get('/services/:id/price-table', (req, res) => {
    const serviceId = Number(req.params.id);
    if (!servicesRepo.getService(db, serviceId)) return res.status(404).json({ error: 'Service not found' });
    const table = pricingRepo.activePriceTable(db, serviceId) ?? null;
    res.json({ table, items: table ? pricingRepo.listPriceItems(db, table.id) : [] });
  });

  router.get('/services/:id/price-tables', (req, res) => {
    const serviceId = Number(req.params.id);
    if (!servicesRepo.getService(db, serviceId)) return res.status(404).json({ error: 'Service not found' });
    res.json({ tables: pricingRepo.listPriceTables(db, serviceId) });
  });

  router.post('/services/:id/price-table', async (req, res, next) => {
    const serviceId = Number(req.params.id);
    if (!servicesRepo.getService(db, serviceId)) return res.status(404).json({ error: 'Service not found' });

    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Send filename and contentBase64' });

    const data = Buffer.from(parsed.data.contentBase64, 'base64');
    if (data.length === 0) return res.status(400).json({ error: 'The file is empty' });
    if (data.length > MAX_PRICE_TABLE_BYTES) {
      return res.status(413).json({ error: `Price tables must be ${MAX_PRICE_TABLE_BYTES / 1024} KB or smaller` });
    }

    try {
      const result = await parsePriceTable(parsed.data.filename, data);
      if (!result.ok) {
        return res.status(422).json({ error: 'The price table has errors. Nothing was saved.', errors: result.errors });
      }
      const table = pricingRepo.publishPriceTable(db, {
        serviceId,
        sourceFilename: parsed.data.filename,
        uploadedBy: res.locals.admin?.id ?? null,
        items: result.items,
      });
      res.status(201).json({ table, items: pricingRepo.listPriceItems(db, table.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
