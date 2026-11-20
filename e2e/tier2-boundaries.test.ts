import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  REPO_ROOT,
  buildInrAmountRegex,
  createTempDir,
  fetchServedDashboardBundle,
  inspectPdfBuffer,
  loadConfig,
  openDatabase,
  readDashboardSources,
  readIntegrationDoc,
  redactDatabaseUrl,
  removeTempDir,
  resolveDatabaseTarget,
  startE2EServer,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tier 2: Boundary, Corner & Negative Error-Handling Cases (F1–F9, >= 45)
// ---------------------------------------------------------------------------

describe('Tier 2 — F1: Service Catalog Boundaries & Delete Protection', () => {
  it('F1.B1 rejects empty or whitespace-only service name with 400', async () => {
    const srv = await startE2EServer();
    try {
      const r1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: '', status: 'available', basePriceInr: 1000 },
      });
      assert.equal(r1.status, 400);

      const r2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: '   ', status: 'available', basePriceInr: 1000 },
      });
      assert.equal(r2.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F1.B2 rejects negative base_price_paise and negative basePriceInr with 400', async () => {
    const srv = await startE2EServer();
    try {
      const r1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Neg Paise', status: 'available', base_price_paise: -1 },
      });
      assert.equal(r1.status, 400);

      const r2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Neg Inr', status: 'available', basePriceInr: -50 },
      });
      assert.equal(r2.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F1.B3 rejects invalid service status values with 400', async () => {
    const srv = await startE2EServer();
    try {
      const r1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Bad Status', status: 'archived', basePriceInr: 1000 },
      });
      assert.equal(r1.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F1.B4 supports large INR base prices (10,000,000 INR = 1,000,000,000 paise) without BIGINT overflow', async () => {
    const srv = await startE2EServer();
    try {
      const created = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'Enterprise Sovereign Cluster',
          status: 'available',
          basePriceInr: 10_000_000,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(Number(created.data.base_price_paise), 1_000_000_000);

      const list = await srv.apiJson<any[]>('/api/services');
      const found = list.data.find((s) => s.id === created.data.id);
      assert.equal(Number(found.base_price_paise), 1_000_000_000);
    } finally {
      await srv.close();
    }
  });

  it('F1.B5 returns 404 when patching or deleting a non-existent service id', async () => {
    const srv = await startE2EServer();
    try {
      const patchRes = await srv.apiJson('/api/services/999999', {
        method: 'PATCH',
        body: { status: 'maintenance' },
      });
      assert.equal(patchRes.status, 404);

      const delRes = await srv.apiJson('/api/services/999999', {
        method: 'DELETE',
      });
      assert.equal(delRes.status, 404);
    } finally {
      await srv.close();
    }
  });

  it('F1.B6 returns 409 SERVICE_IN_USE when deleting a service referenced by multi-service quote_items and keeps proposal intact', async () => {
    const srv = await startE2EServer();
    try {
      const s1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Primary Svc', status: 'available', basePriceInr: 10000 },
      });
      const s2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Secondary Svc', status: 'available', basePriceInr: 5000 },
      });
      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Protected Proposal Co',
          companySize: '0-5',
          marginPercent: 0,
          items: [
            { serviceId: s1.data.id, description: 'Primary Svc', quantity: 1 },
            { serviceId: s2.data.id, description: 'Secondary Svc', quantity: 1 },
          ],
        },
      });
      assert.equal(proposal.status, 201);

      const delSecond = await srv.apiJson(`/api/services/${s2.data.id}`, {
        method: 'DELETE',
      });
      assert.equal(delSecond.status, 409);
      assert.equal(delSecond.data.code, 'SERVICE_IN_USE');
      assert.ok(Number(delSecond.data.quoteCount) >= 1);

      const quoteCheck = await srv.apiJson(`/api/quotes/${proposal.data.quote.id}`);
      assert.equal(quoteCheck.status, 200);
      assert.equal(quoteCheck.data.items.length, 2);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F2: Settings Multipliers & T&C Boundaries', () => {
  it('F2.B1 rejects zero or negative multipliers with 400 and preserves previous values', async () => {
    const srv = await startE2EServer();
    try {
      const before = await srv.apiJson('/api/settings');
      const rZero = await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: {
          companySizeMultipliers: { '0-5': 0, '5-10': 1.5, '10-20': 2.0, '20+': 3.0 },
        },
      });
      assert.equal(rZero.status, 400);

      const rNeg = await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: {
          companySizeMultipliers: { '0-5': 1.0, '5-10': -1.5, '10-20': 2.0, '20+': 3.0 },
        },
      });
      assert.equal(rNeg.status, 400);

      const after = await srv.apiJson('/api/settings');
      assert.deepEqual(after.data.companySizeMultipliers, before.data.companySizeMultipliers);
    } finally {
      await srv.close();
    }
  });

  it('F2.B2 rejects missing required multiplier tiers with 400', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: {
          companySizeMultipliers: { '0-5': 1.0, '5-10': 1.5, '10-20': 2.0 },
        },
      });
      assert.equal(res.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F2.B3 rejects out-of-range quoteMarginPercent (29 and 36) with 400 and preserves existing margin', async () => {
    const srv = await startE2EServer();
    try {
      const low = await srv.apiJson('/api/settings/quote-margin', {
        method: 'PUT',
        body: { marginPercent: 29 },
      });
      assert.equal(low.status, 400);

      const high = await srv.apiJson('/api/settings/quote-margin', {
        method: 'PUT',
        body: { marginPercent: 36 },
      });
      assert.equal(high.status, 400);

      const current = await srv.apiJson('/api/settings');
      assert.equal(current.data.quoteMarginPercent, 30);
    } finally {
      await srv.close();
    }
  });

  it('F2.B4 persists empty defaultTermsAndConditions and large multi-paragraph T&C cleanly', async () => {
    const srv = await startE2EServer();
    try {
      const emptyRes = await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: '' },
      });
      assert.equal(emptyRes.status, 200);
      assert.equal(emptyRes.data.defaultTermsAndConditions, '');

      const longText = Array.from({ length: 40 }, (_, i) => `Clause ${i + 1}: Standard CosmIQ OS terms.`).join('\n');
      const longRes = await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: longText },
      });
      assert.equal(longRes.status, 200);
      assert.equal(longRes.data.defaultTermsAndConditions, longText);
    } finally {
      await srv.close();
    }
  });

  it('F2.B5 requires admin authentication (401) for all settings GET and PUT routes', async () => {
    const srv = await startE2EServer();
    try {
      const g = await srv.publicGet('/api/settings');
      assert.equal(g.status, 401);

      const p1 = await srv.publicPost('/api/settings/multipliers', {});
      assert.equal(p1.status, 401);

      const rPut = await fetch(`${srv.baseUrl}/api/settings/terms`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultTermsAndConditions: 'hacked' }),
      });
      assert.equal(rPut.status, 401);

      const rMargin = await fetch(`${srv.baseUrl}/api/settings/quote-margin`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marginPercent: 33 }),
      });
      assert.equal(rMargin.status, 401);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F3: Website Lead Intake & Rate Limit Boundaries', () => {
  it('F3.B1 rejects missing required companyName or companySize with 400', async () => {
    const srv = await startE2EServer();
    try {
      const noCompany = await srv.publicPost('/api/leads/website', {
        companySize: '0-5',
        contactEmail: 'a@b.com',
      });
      assert.equal(noCompany.status, 400);

      const noSize = await srv.publicPost('/api/leads/website', {
        companyName: 'NoSize Co',
        contactEmail: 'a@b.com',
      });
      assert.equal(noSize.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F3.B2 rejects invalid companySize values outside 0-5|5-10|10-20|20+ with 400', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.publicPost('/api/leads/website', {
        companyName: 'Bad Size Co',
        companySize: '100-500',
        contactEmail: 'bad@size.co',
      });
      assert.equal(res.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F3.B3 accepts snake_case alias payload and string current_tools', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.publicPost('/api/leads/website', {
        company_name: 'SnakeCase Enterprises',
        company_size: '20+',
        contact_name: 'Meera Iyer',
        contact_email: 'meera@snakecase.in',
        contact_phone: '+91-9888877777',
        current_tools: 'Jira, Zendesk',
        notes: 'Submitted with snake_case keys.',
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.intake.company_name, 'SnakeCase Enterprises');
      assert.equal(res.data.intake.company_size, '20+');
      assert.equal(res.data.intake.contact_email, 'meera@snakecase.in');
      assert.ok(String(res.data.intake.current_tools).includes('Jira'));
    } finally {
      await srv.close();
    }
  });

  it('F3.B4 rejects malformed JSON with 400 and oversized (>1MB) payload with 413', async () => {
    const srv = await startE2EServer();
    try {
      const badJsonRes = await fetch(`${srv.baseUrl}/api/leads/website`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      });
      assert.equal(badJsonRes.status, 400);

      const bigNotes = 'x'.repeat(1_200_000);
      const bigRes = await srv.publicPost('/api/leads/website', {
        companyName: 'Giant Payload Co',
        companySize: '0-5',
        notes: bigNotes,
      });
      assert.equal(bigRes.status, 413);
    } finally {
      await srv.close();
    }
  });

  it('F3.B5 enforces exact rate-limit boundary without inserting on 429 and keeps /api/health at 200', async () => {
    const srv = await startE2EServer();
    try {
      const makeLead = (i: number) => ({
        companyName: `BoundaryLead ${i}`,
        companySize: '0-5',
        contactEmail: `b${i}@boundary.example`,
      });

      const r1 = await srv.publicPost('/api/leads/website', makeLead(1));
      assert.equal(r1.status, 201);

      const limitHeader = r1.headers.get('x-ratelimit-limit');
      const limit = limitHeader ? Number(limitHeader) : 10;
      const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit + 3, 50) : 15;

      let accepted = 1;
      let blocked429Res: Awaited<ReturnType<typeof srv.publicPost>> | null = null;
      for (let i = 2; i <= cap; i += 1) {
        const res = await srv.publicPost('/api/leads/website', makeLead(i));
        if (res.status === 429) {
          blocked429Res = res;
          break;
        }
        assert.equal(res.status, 201);
        accepted += 1;
      }

      assert.ok(blocked429Res, 'Expected 429 once limit exceeded');
      assert.ok(
        blocked429Res.headers.has('retry-after') || blocked429Res.headers.has('x-ratelimit-remaining'),
        '429 response should include Retry-After or X-RateLimit-Remaining header',
      );

      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const boundaryIntakes = intakes.data.filter((x) =>
        String(x.company_name).startsWith('BoundaryLead '),
      );
      assert.equal(
        boundaryIntakes.length,
        accepted,
        'Rejected 429 request must not insert a service_intakes record',
      );

      const health = await srv.publicGet('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.ok, true);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F4: Multi-Service Proposal Boundaries', () => {
  it('F4.B1 rejects empty items array on POST /api/quotes with 400', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'No Items Co',
          companySize: '0-5',
          items: [],
        },
      });
      assert.equal(res.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F4.B2 rejects quantity = 0 (400) while supporting fractional quantity = 1.5', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Consulting Hours', status: 'available', basePriceInr: 1000 }, // 100,000 paise
      });

      const zeroQty = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'ZeroQty Co',
          companySize: '0-5',
          items: [{ serviceId: svc.data.id, description: 'Consulting Hours', quantity: 0 }],
        },
      });
      assert.equal(zeroQty.status, 400);

      const fracQty = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'FracQty Co',
          companySize: '0-5',
          companySizeMultiplier: 1.0,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Consulting Hours', quantity: 1.5 }],
        },
      });
      assert.equal(fracQty.status, 201);
      assert.equal(Number(fracQty.data.quote.subtotal_paise), 150000);
      assert.equal(Number(fracQty.data.quote.total_paise), 150000);
    } finally {
      await srv.close();
    }
  });

  it('F4.B3 preserves explicit quotedUnitPricePaise = 0 override (not ignored as falsy)', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Onboarding Freebie', status: 'available', basePriceInr: 15000 },
      });

      const res = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Free Trial Client',
          companySize: '5-10',
          companySizeMultiplier: 1.5,
          marginPercent: 0,
          items: [
            {
              serviceId: svc.data.id,
              description: 'Onboarding Freebie',
              quantity: 1,
              quotedUnitPricePaise: 0,
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(res.status, 201);
      assert.equal(Number(res.data.items[0].quoted_unit_price_paise), 0);
      assert.equal(Number(res.data.items[0].line_total_paise), 0);
      assert.equal(Number(res.data.quote.subtotal_paise), 0);
      assert.equal(Number(res.data.quote.total_paise), 0);
    } finally {
      await srv.close();
    }
  });

  it('F4.B4 clamps 100% discount to total_paise = 0 and allows marginPercent = 0 on manual proposals', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Discount Test Svc', status: 'available', basePriceInr: 10000 },
      });

      const res = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Full Discount Corp',
          companySize: '0-5',
          companySizeMultiplier: 1.0,
          marginPercent: 0,
          discountPercent: 100,
          items: [{ serviceId: svc.data.id, description: 'Discount Test Svc', quantity: 1 }],
        },
      });
      assert.equal(res.status, 201);
      assert.equal(Number(res.data.quote.margin_percent), 0);
      assert.equal(Number(res.data.quote.discount_percent), 100);
      assert.equal(Number(res.data.quote.total_paise), 0);
    } finally {
      await srv.close();
    }
  });

  it('F4.B5 returns 400 or 404 for non-existent intakeId or serviceId without leaving partial quotes', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Valid Svc', status: 'available', basePriceInr: 1000 },
      });

      const badIntake = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: 999999,
          companyName: 'Bad Intake',
          companySize: '0-5',
          items: [{ serviceId: svc.data.id, description: 'Valid Svc', quantity: 1 }],
        },
      });
      assert.ok(badIntake.status === 400 || badIntake.status === 404);

      const badSvc = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Bad Service',
          companySize: '0-5',
          items: [{ serviceId: 999999, description: 'Missing Svc', quantity: 1 }],
        },
      });
      assert.ok(badSvc.status === 400 || badSvc.status === 404);

      const quotes = await srv.apiJson<{ quotes: any[] }>('/api/quotes');
      assert.equal(quotes.data.quotes.length, 0);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F5: Server-Side Branded PDF Boundaries', () => {
  it('F5.B1 rejects unauthenticated GET /api/quotes/:id/pdf with 401', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.publicGet('/api/quotes/1/pdf');
      assert.equal(res.status, 401);
    } finally {
      await srv.close();
    }
  });

  it('F5.B2 returns 404 for missing quote id and 400 for non-numeric quote id on PDF route', async () => {
    const srv = await startE2EServer();
    try {
      const notFound = await srv.apiRaw('/api/quotes/999999/pdf');
      assert.equal(notFound.status, 404);

      const badId = await srv.apiRaw('/api/quotes/abc/pdf');
      assert.equal(badId.status, 400);
    } finally {
      await srv.close();
    }
  });

  it('F5.B3 handles special characters and Unicode (₹, —, &, parens, é) in PDF text cleanly', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Café & AI (Pro) — Tier', status: 'available', basePriceInr: 7500 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'R & D (India) — Résumé Pvt Ltd',
          companySize: '0-5',
          contactName: 'René Gupta',
          marginPercent: 0,
          termsAndConditions: 'Fee in ₹ (INR) — R&D clause (non-refundable).',
          items: [
            {
              serviceId: svc.data.id,
              description: 'Café & AI (Pro) — Tier',
              quantity: 1,
            },
          ],
        },
      });
      assert.equal(created.status, 201);

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.match(info.header, /^%PDF-1\.[0-7]/);
      assert.equal(info.hasEof, true);
      assert.ok(info.normalizedText.includes('₹'));
      assert.ok(info.normalizedText.includes('R & D'));
      assert.ok(info.normalizedText.includes('non-refundable'));
    } finally {
      await srv.close();
    }
  });

  it('F5.B4 paginates multi-page proposals (16+ line items) across >= 2 pages', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Modular Automation Unit', status: 'available', basePriceInr: 2500 },
      });
      const items = Array.from({ length: 16 }, (_, idx) => ({
        serviceId: svc.data.id,
        description: `LineItem-${String(idx + 1).padStart(2, '0')} Custom Automation Module`,
        quantity: 1,
      }));

      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Long Proposal Corp',
          companySize: '0-5',
          marginPercent: 0,
          items,
        },
      });
      assert.equal(created.status, 201);

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.ok(info.pageCount >= 2, `Expected >= 2 pages for 16 line items, got ${info.pageCount}`);
      assert.ok(info.normalizedText.includes('LineItem-01'));
      assert.ok(info.normalizedText.includes('LineItem-16'));
    } finally {
      await srv.close();
    }
  });

  it('F5.B5 accurately renders 100%-discounted (₹0) total and overridden unit prices in PDF text', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Override PDF Svc', status: 'available', basePriceInr: 10000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Zero Total Corp',
          companySize: '0-5',
          marginPercent: 0,
          discountPercent: 100,
          items: [
            {
              serviceId: svc.data.id,
              description: 'Override PDF Svc',
              quantity: 1,
              quotedUnitPricePaise: 550000, // ₹5,500
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(created.status, 201);

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.match(info.normalizedText, buildInrAmountRegex(550000));
      assert.match(info.normalizedText, buildInrAmountRegex(0));
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F6: Tab 04 Rename Boundaries', () => {
  it('F6.B1 case-insensitive check confirms zero QUOTES & APPROVALS across all dashboard/src/**/*.{ts,tsx}', () => {
    const snap = readDashboardSources();
    const tsFiles = snap.files.filter((f) => /\.(ts|tsx)$/.test(f.relPath));
    for (const file of tsFiles) {
      assert.equal(
        /quotes\s*&\s*(?:amp;\s*)?approvals/i.test(file.content),
        false,
        `Legacy "QUOTES & APPROVALS" found in ${file.relPath}`,
      );
    }
  });

  it('F6.B2 dashboard/index.html contains zero QUOTES & APPROVALS', () => {
    const snap = readDashboardSources();
    assert.equal(
      /quotes\s*&\s*(?:amp;\s*)?approvals/i.test(snap.indexHtml),
      false,
      'dashboard/index.html must not contain QUOTES & APPROVALS',
    );
  });

  it('F6.B3 served dashboard/dist/assets/*.js contains PROPOSALS & QUOTES and zero QUOTES & APPROVALS', async () => {
    const srv = await startE2EServer();
    try {
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      assert.equal(bundle.jsStatus, 200);
      assert.ok(bundle.jsText.includes('PROPOSALS & QUOTES'));
      assert.equal(/quotes\s*&\s*approvals/i.test(bundle.jsText), false);
    } finally {
      await srv.close();
    }
  });

  it('F6.B4 dashboard/src contains PROPOSALS & QUOTES in both nav and Tab 04 header', () => {
    const snap = readDashboardSources();
    const app = snap.files.find((f) => f.relPath === 'dashboard/src/App.tsx');
    assert.ok(app);
    assert.match(app.content, /PROPOSALS\s*&\s*(?:amp;\s*)?QUOTES/);
    const allMatches = snap.combinedSource.match(/proposals\s*&\s*(?:amp;\s*)?quotes/gi) ?? [];
    assert.ok(allMatches.length >= 2);
  });

  it('F6.B5 non-API SPA routes serve index.html cleanly while unknown /api routes stay JSON 401/404', async () => {
    const srv = await startE2EServer();
    try {
      const spa = await srv.publicGet('/proposals');
      assert.equal(spa.status, 200);
      assert.ok(spa.rawText.includes('<div id="root">'));

      const api = await srv.publicGet('/api/does-not-exist');
      assert.equal(api.status, 401);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 2 — F7: Dashboard UI Boundaries', () => {
  it('F7.B1 served dashboard CSS is non-empty and styles website channel', async () => {
    const srv = await startE2EServer();
    try {
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      assert.equal(bundle.cssStatus, 200);
      assert.ok(bundle.cssText.length > 200);
      assert.ok(bundle.cssText.includes('website'));
    } finally {
      await srv.close();
    }
  });

  it('F7.B2 dashboard UI source includes 409 / error feedback handling for catalog and proposals', () => {
    const snap = readDashboardSources();
    assert.match(snap.combinedSource, /409|error|Error/);
    assert.match(snap.combinedSource, /SERVICE_IN_USE|referenced|409/);
  });

  it('F7.B3 NEW PROPOSAL workflow supports both existing lead selection and manual custom lead entry', () => {
    const snap = readDashboardSources();
    assert.ok(snap.combinedSource.includes('NEW PROPOSAL'));
    assert.ok(snap.combinedSource.includes('/api/intakes'));
    assert.match(snap.combinedSource, /manual|custom/i);
    assert.match(snap.combinedSource, /companyName|company_name/);
  });

  it('F7.B4 Settings UI supports all 4 company size multiplier keys and validation errors', () => {
    const snap = readDashboardSources();
    for (const k of ['0-5', '5-10', '10-20', '20+']) {
      assert.ok(snap.combinedSource.includes(k));
    }
    assert.ok(snap.combinedSource.includes('/api/settings'));
  });

  it('F7.B5 Notification handling supports website_lead kind alongside conversation and quote alerts', () => {
    const snap = readDashboardSources();
    assert.ok(snap.combinedSource.includes('website_lead'));
    assert.match(snap.combinedSource, /website|intakes|inbox/i);
  });
});

describe('Tier 2 — F8: cosmiqos.com Integration Plan Boundaries', () => {
  it('F8.B1 forbids placing WEBSITE_LEAD_SECRET inside any NEXT_PUBLIC_* variable', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.equal(/NEXT_PUBLIC_[A-Z0-9_]*SECRET\s*=/.test(doc.content), false);
    assert.match(doc.content, /NEXT_PUBLIC_|never.*client|server-only|server-side/i);
  });

  it('F8.B2 documents handling upstream 429 and 5xx errors gracefully', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.match(doc.content, /\b429\b/);
    assert.match(doc.content, /\b5\d\d\b|502|503|upstream|fallback/i);
  });

  it('F8.B3 includes all 4 exact companySize enum strings (0-5, 5-10, 10-20, 20+)', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    for (const enumVal of ['0-5', '5-10', '10-20', '20+']) {
      assert.ok(doc.content.includes(enumVal), `Missing size enum ${enumVal}`);
    }
  });

  it('F8.B4 external sibling cosmiq-os-web repo (if present) was not directly modified to call /api/leads/website', () => {
    const siblingDir = path.resolve(REPO_ROOT, '..', 'cosmiq-os-web');
    if (!fs.existsSync(siblingDir)) {
      return;
    }
    const routeFile = path.join(siblingDir, 'app', 'api', 'enquiries', 'route.ts');
    const formFile = path.join(siblingDir, 'components', 'LeadForm.tsx');
    if (fs.existsSync(routeFile)) {
      assert.equal(fs.readFileSync(routeFile, 'utf8').includes('/api/leads/website'), false);
    }
    if (fs.existsSync(formFile)) {
      assert.equal(fs.readFileSync(formFile, 'utf8').includes('/api/leads/website'), false);
    }
  });

  it('F8.B5 includes a verification or testing checklist for deploying the integration', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.match(doc.content, /verif|checklist|test|curl/i);
  });
});

describe('Tier 2 — F9: Neon Branch Isolation Boundaries', () => {
  it('F9.B1 openDatabase(":memory:") ignores temporary process.env.DATABASE_URL', async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/unreachable_neon_db?sslmode=require';
    try {
      const db = await openDatabase(':memory:');
      try {
        assert.equal(db.driver, 'pglite');
        assert.equal(db.target, 'pglite://:memory:');
      } finally {
        await db.close();
      }
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it('F9.B2 redactDatabaseUrl strips password from Neon URL while preserving host and handling invalid strings', () => {
    const neonUrl =
      'postgresql://neondb_owner:super_secret_pw@ep-quiet-darkness-be05w8ob-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
    const redacted = redactDatabaseUrl(neonUrl);
    assert.equal(redacted.includes('super_secret_pw'), false);
    assert.ok(redacted.includes('ep-quiet-darkness-be05w8ob-pooler'));
    assert.ok(redacted.includes('***'));

    const malformed = redactDatabaseUrl('not-a-valid-url');
    assert.equal(typeof malformed, 'string');
  });

  it('F9.B3 loadConfig rejects non-PostgreSQL URLs and falls back to DB_PATH on blank DATABASE_URL', () => {
    assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://user:pass@localhost/db' }));
    const cfg = loadConfig({ DATABASE_URL: '   ', DB_PATH: './tmp/fallback-pglite' });
    assert.equal(resolveDatabaseTarget(cfg), './tmp/fallback-pglite');
  });

  it('F9.B4 temp-dir PGlite restart is idempotent without duplicating schema_migrations', async () => {
    const dir = createTempDir('cosmiq-e2e-pglite-');
    try {
      const db1 = await openDatabase(dir);
      const count1 = await db1.queryOne<{ count: string | number }>('SELECT COUNT(*) AS count FROM schema_migrations');
      await db1.close();

      const db2 = await openDatabase(dir);
      const count2 = await db2.queryOne<{ count: string | number }>('SELECT COUNT(*) AS count FROM schema_migrations');
      await db2.close();

      assert.equal(Number(count1?.count), Number(count2?.count));
      assert.ok(Number(count2?.count) >= 10);
    } finally {
      removeTempDir(dir);
    }
  });

  it('F9.B5 build script copies SQL migrations and no e2e/*.ts file imports entrypoints that load .env', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.match(String(pkg.scripts?.build ?? ''), /migrations/);
    assert.match(String(pkg.scripts?.build ?? ''), /schema\.sql/);

    const e2eFiles = fs
      .readdirSync(path.join(REPO_ROOT, 'e2e'))
      .filter((f) => f.endsWith('.ts'));
    const forbiddenImport = /^\s*import\b.*['"](?:dotenv\/config|\.\.\/src\/index\.js)['"]/m;
    for (const file of e2eFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, 'e2e', file), 'utf8');
      assert.equal(
        forbiddenImport.test(content),
        false,
        `e2e/${file} must never import dotenv/config or src/index.ts`,
      );
    }
  });
});
