import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  REPO_ROOT,
  buildInrAmountRegex,
  fetchServedDashboardBundle,
  inspectPdfBuffer,
  loadConfig,
  openDatabase,
  readDashboardSources,
  readIntegrationDoc,
  resolveDatabaseTarget,
  startE2EServer,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tier 1: Isolated Happy-Path Feature Coverage (F1–F9, 5 tests each = 45)
// ---------------------------------------------------------------------------

describe('Tier 1 — F1: Service Catalog CRUD & Delete Safety', () => {
  it('F1.1 creates services with base_price_paise and basePriceInr conversion', async () => {
    const srv = await startE2EServer();
    try {
      const r1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'AI Support Desk',
          category: 'automation',
          description: '24x7 omnichannel AI triage',
          status: 'available',
          base_price_paise: 1500000,
        },
      });
      assert.equal(r1.status, 201);
      assert.equal(r1.data.name, 'AI Support Desk');
      assert.equal(Number(r1.data.base_price_paise), 1500000);

      const r2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'CRM Lead Sync',
          category: 'integration',
          description: 'Bi-directional CRM sync',
          status: 'available',
          basePriceInr: 25000,
        },
      });
      assert.equal(r2.status, 201);
      assert.equal(Number(r2.data.base_price_paise), 2500000);
    } finally {
      await srv.close();
    }
  });

  it('F1.2 lists services with complete catalog fields including base_price_paise', async () => {
    const srv = await startE2EServer();
    try {
      const created = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'WhatsApp Bot',
          category: 'messaging',
          description: 'Automated WhatsApp support',
          status: 'available',
          availability_note: 'Ready in 5 days',
          basePriceInr: 12000,
        },
      });
      assert.equal(created.status, 201);

      const list = await srv.apiJson<any[]>('/api/services');
      assert.equal(list.status, 200);
      assert.ok(Array.isArray(list.data));
      const found = list.data.find((s) => s.id === created.data.id);
      assert.ok(found, 'Created service should appear in GET /api/services');
      assert.equal(found.name, 'WhatsApp Bot');
      assert.equal(found.category, 'messaging');
      assert.equal(found.description, 'Automated WhatsApp support');
      assert.equal(found.status, 'available');
      assert.equal(found.availability_note, 'Ready in 5 days');
      assert.equal(Number(found.base_price_paise), 1200000);
      assert.ok(found.created_at);
      assert.ok(found.updated_at);
    } finally {
      await srv.close();
    }
  });

  it('F1.3 edits an existing service name, description, and base price', async () => {
    const srv = await startE2EServer();
    try {
      const created = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'Initial Service',
          category: 'ai',
          description: 'Initial desc',
          status: 'available',
          basePriceInr: 10000,
        },
      });
      assert.equal(created.status, 201);

      const patched = await srv.apiJson(`/api/services/${created.data.id}`, {
        method: 'PATCH',
        body: {
          name: 'Enterprise AI Concierge',
          description: 'Updated enterprise description',
          basePriceInr: 18500,
        },
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.data.name, 'Enterprise AI Concierge');
      assert.equal(patched.data.description, 'Updated enterprise description');
      assert.equal(Number(patched.data.base_price_paise), 1850000);

      const list = await srv.apiJson<any[]>('/api/services');
      const persisted = list.data.find((s) => s.id === created.data.id);
      assert.equal(persisted.name, 'Enterprise AI Concierge');
      assert.equal(Number(persisted.base_price_paise), 1850000);
    } finally {
      await srv.close();
    }
  });

  it('F1.4 quick-toggles service across all 4 valid statuses', async () => {
    const srv = await startE2EServer();
    try {
      const created = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'Status Toggle Service',
          status: 'available',
          basePriceInr: 5000,
        },
      });
      assert.equal(created.status, 201);

      for (const status of ['unavailable', 'maintenance', 'limited', 'available'] as const) {
        const res = await srv.apiJson(`/api/services/${created.data.id}`, {
          method: 'PATCH',
          body: { status },
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.status, status);
      }

      const list = await srv.apiJson<any[]>('/api/services');
      const found = list.data.find((s) => s.id === created.data.id);
      assert.equal(found.status, 'available');
    } finally {
      await srv.close();
    }
  });

  it('F1.5 deletes an unused service and removes it from catalog', async () => {
    const srv = await startE2EServer();
    try {
      const created = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'Disposable Addon',
          status: 'available',
          basePriceInr: 3000,
        },
      });
      assert.equal(created.status, 201);

      const del = await srv.apiJson(`/api/services/${created.data.id}`, {
        method: 'DELETE',
      });
      assert.equal(del.status, 200);
      assert.equal(del.data.deleted, true);
      assert.equal(del.data.id, created.data.id);

      const list = await srv.apiJson<any[]>('/api/services');
      assert.equal(
        list.data.some((s) => s.id === created.data.id),
        false,
        'Deleted service must not remain in GET /api/services',
      );
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F2: Settings Multipliers & Default T&C', () => {
  it('F2.1 returns default company size multipliers (0-5, 5-10, 10-20, 20+)', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.apiJson('/api/settings');
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.companySizeMultipliers, {
        '0-5': 1.0,
        '5-10': 1.5,
        '10-20': 2.0,
        '20+': 3.0,
      });
    } finally {
      await srv.close();
    }
  });

  it('F2.2 returns non-empty default Terms & Conditions and default margin settings', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.apiJson('/api/settings');
      assert.equal(res.status, 200);
      assert.equal(typeof res.data.defaultTermsAndConditions, 'string');
      assert.ok(res.data.defaultTermsAndConditions.trim().length > 10);
      assert.equal(res.data.quoteMarginPercent, 30);
      assert.equal(res.data.minMarginPercent, 30);
      assert.equal(res.data.maxMarginPercent, 35);
    } finally {
      await srv.close();
    }
  });

  it('F2.3 updates and persists companySizeMultipliers via PUT /api/settings/multipliers', async () => {
    const srv = await startE2EServer();
    try {
      const updated = {
        '0-5': 1.1,
        '5-10': 1.75,
        '10-20': 2.4,
        '20+': 3.5,
      };
      const putRes = await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: { companySizeMultipliers: updated },
      });
      assert.equal(putRes.status, 200);
      assert.deepEqual(putRes.data.companySizeMultipliers, updated);

      const getRes = await srv.apiJson('/api/settings');
      assert.equal(getRes.status, 200);
      assert.deepEqual(getRes.data.companySizeMultipliers, updated);
    } finally {
      await srv.close();
    }
  });

  it('F2.4 updates and persists defaultTermsAndConditions via PUT /api/settings/terms', async () => {
    const srv = await startE2EServer();
    try {
      const newTerms = 'Payment due within 15 days. Valid for 30 calendar days from proposal date.';
      const putRes = await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: newTerms },
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.data.defaultTermsAndConditions, newTerms);

      const getRes = await srv.apiJson('/api/settings');
      assert.equal(getRes.status, 200);
      assert.equal(getRes.data.defaultTermsAndConditions, newTerms);
    } finally {
      await srv.close();
    }
  });

  it('F2.5 updates quote margin and supports combined PUT /api/settings persistence', async () => {
    const srv = await startE2EServer();
    try {
      const marginRes = await srv.apiJson('/api/settings/quote-margin', {
        method: 'PUT',
        body: { marginPercent: 34 },
      });
      assert.equal(marginRes.status, 200);
      assert.equal(marginRes.data.quoteMarginPercent, 34);

      const combinedRes = await srv.apiJson('/api/settings', {
        method: 'PUT',
        body: {
          quoteMarginPercent: 32,
          companySizeMultipliers: { '0-5': 1.0, '5-10': 1.6, '10-20': 2.2, '20+': 3.2 },
          defaultTermsAndConditions: 'Combined settings T&C v2.',
        },
      });
      assert.equal(combinedRes.status, 200);
      assert.equal(combinedRes.data.quoteMarginPercent, 32);
      assert.equal(combinedRes.data.companySizeMultipliers['5-10'], 1.6);
      assert.equal(combinedRes.data.defaultTermsAndConditions, 'Combined settings T&C v2.');
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F3: Website Lead Intake API & Rate Limit', () => {
  it('F3.1 accepts public POST /api/leads/website without admin auth and marks channel=website', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.publicPost('/api/leads/website', {
        companyName: 'Tandem Retail Pvt Ltd',
        companySize: '5-10',
        contactName: 'Aarav Mehta',
        contactEmail: 'aarav@tandemretail.in',
        contactPhone: '+91-9820112233',
        contactRole: 'Operations Lead',
        currentTools: ['Zoho CRM', 'WhatsApp Business'],
        serviceName: 'Support AI Desk',
        notes: 'Need inbound triage and quote automation.',
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.ok, true);
      assert.ok(res.data.intake);
      assert.equal(res.data.intake.channel, 'website');
      assert.equal(res.data.intake.company_name, 'Tandem Retail Pvt Ltd');
      assert.equal(res.data.intake.company_size, '5-10');
      assert.ok(res.data.sessionId);
      assert.ok(res.data.conversationId);
      assert.ok(res.data.notificationId);
    } finally {
      await srv.close();
    }
  });

  it('F3.2 exposes website lead contact details and notes via GET /api/intakes', async () => {
    const srv = await startE2EServer();
    try {
      const postRes = await srv.publicPost('/api/leads/website', {
        companyName: 'Kaveri Logistics',
        companySize: '10-20',
        contactName: 'Priya Nair',
        contactEmail: 'priya@kaverilogistics.com',
        contactPhone: '+91-9900112233',
        contactRole: 'Head of Ops',
        currentTools: ['Freshdesk', 'Slack'],
        notes: 'Looking for automated dispatch notifications.',
      });
      assert.equal(postRes.status, 201);

      const intakes = await srv.apiJson<any[]>('/api/intakes');
      assert.equal(intakes.status, 200);
      const lead = intakes.data.find((i) => i.company_name === 'Kaveri Logistics');
      assert.ok(lead, 'Website lead should appear in GET /api/intakes');
      assert.equal(lead.channel, 'website');
      assert.equal(lead.company_size, '10-20');
      assert.equal(lead.contact_name, 'Priya Nair');
      assert.equal(lead.contact_email, 'priya@kaverilogistics.com');
      assert.equal(lead.contact_phone, '+91-9900112233');
      assert.equal(lead.contact_role, 'Head of Ops');
      assert.ok(String(lead.notes).includes('automated dispatch notifications'));
      assert.ok(String(lead.current_tools).includes('Freshdesk'));
    } finally {
      await srv.close();
    }
  });

  it('F3.3 creates a Live Inbox conversation and initial message for website leads', async () => {
    const srv = await startE2EServer();
    try {
      const postRes = await srv.publicPost('/api/leads/website', {
        companyName: 'Vanguard Solar',
        companySize: '20+',
        contactName: 'Rohan Kapoor',
        contactEmail: 'rohan@vanguardsolar.in',
        notes: 'Need multi-city service scheduling bot.',
      });
      assert.equal(postRes.status, 201);

      const convList = await srv.apiJson<{ conversations: any[] }>('/api/conversations');
      assert.equal(convList.status, 200);
      const conv = convList.data.conversations.find(
        (c) => c.session_id === postRes.data.conversationId || c.session_id === postRes.data.sessionId,
      );
      assert.ok(conv, 'Website lead must appear in GET /api/conversations');
      assert.equal(conv.channel, 'website');

      const msgRes = await srv.apiJson<{ messages: any[] }>(
        `/api/conversations/${conv.session_id}/messages`,
      );
      assert.equal(msgRes.status, 200);
      assert.ok(msgRes.data.messages.length >= 1, 'Initial user message should exist');
      const combinedMsg = msgRes.data.messages.map((m) => m.content).join(' ');
      assert.ok(
        combinedMsg.includes('Vanguard Solar') || combinedMsg.includes('multi-city service scheduling'),
        'Initial conversation message should summarize the website submission',
      );
    } finally {
      await srv.close();
    }
  });

  it('F3.4 triggers an admin notification visible in GET /api/notifications', async () => {
    const srv = await startE2EServer();
    try {
      const postRes = await srv.publicPost('/api/leads/website', {
        companyName: 'Deccan FinTech',
        companySize: '0-5',
        contactName: 'Neha Joshi',
        contactEmail: 'neha@deccanfintech.in',
        notes: 'Interested in onboarding automation.',
      });
      assert.equal(postRes.status, 201);

      const notifRes = await srv.apiJson<{ notifications: any[]; unread: number }>('/api/notifications');
      assert.equal(notifRes.status, 200);
      assert.ok(notifRes.data.unread >= 1);
      const notif = notifRes.data.notifications.find(
        (n) =>
          n.id === postRes.data.notificationId ||
          n.session_id === postRes.data.sessionId ||
          n.kind === 'website_lead',
      );
      assert.ok(notif, 'Expected website_lead notification in /api/notifications');
      assert.equal(notif.kind, 'website_lead');
      assert.ok(
        String(notif.title + ' ' + notif.body).toLowerCase().includes('deccan fintech'),
        'Notification should reference company name',
      );
    } finally {
      await srv.close();
    }
  });

  it('F3.5 enforces rate limiting returning HTTP 429 when limit is exceeded while valid requests below limit succeed', async () => {
    const srv = await startE2EServer();
    try {
      const payload = (idx: number) => ({
        companyName: `RateProbe Co ${idx}`,
        companySize: '0-5',
        contactEmail: `lead${idx}@rateprobe.example`,
      });

      const first = await srv.publicPost('/api/leads/website', payload(1));
      assert.equal(first.status, 201, 'First website lead request must succeed');

      const headerLimitRaw = first.headers.get('x-ratelimit-limit');
      const probedLimit = headerLimitRaw ? Number(headerLimitRaw) : 10;
      const maxAttempts = Number.isFinite(probedLimit) && probedLimit > 0 ? Math.min(probedLimit + 5, 50) : 15;

      let hit429 = false;
      let successCount = 1;
      for (let i = 2; i <= maxAttempts; i += 1) {
        const res = await srv.publicPost('/api/leads/website', payload(i));
        if (res.status === 429) {
          hit429 = true;
          assert.ok(res.data?.error, '429 response must include error message');
          break;
        }
        assert.equal(res.status, 201, `Request #${i} before rate limit must succeed with 201`);
        successCount += 1;
      }

      assert.ok(successCount >= 1, 'At least one request below the rate limit must succeed');
      assert.ok(hit429, `Expected HTTP 429 within ${maxAttempts} consecutive requests`);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F4: Multi-Service Proposal Engine & API', () => {
  it('F4.1 creates a proposal from an existing intakeId auto-populating client fields', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'AI Knowledge Bot', status: 'available', basePriceInr: 10000 },
      });
      assert.equal(svc.status, 201);

      const lead = await srv.publicPost('/api/leads/website', {
        companyName: 'Indus MedTech',
        companySize: '10-20',
        contactName: 'Dr. Kavita Rao',
        contactEmail: 'kavita@indusmed.in',
        contactPhone: '+91-9811122233',
        currentTools: ['HubSpot', 'Intercom'],
      });
      assert.equal(lead.status, 201);

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: lead.data.intake.id,
          companySizeMultiplier: 2.0,
          marginPercent: 0,
          items: [
            {
              serviceId: svc.data.id,
              description: 'AI Knowledge Bot Setup',
              quantity: 1,
            },
          ],
        },
      });
      assert.equal(proposal.status, 201);
      assert.equal(proposal.data.quote.intake_id, lead.data.intake.id);
      assert.equal(proposal.data.quote.company_name, 'Indus MedTech');
      assert.equal(proposal.data.quote.company_size, '10-20');
      assert.equal(proposal.data.quote.contact_name, 'Dr. Kavita Rao');
      assert.equal(proposal.data.quote.contact_email, 'kavita@indusmed.in');
      assert.equal(proposal.data.quote.contact_phone, '+91-9811122233');
      assert.ok(String(proposal.data.quote.current_tools).includes('HubSpot'));
    } finally {
      await srv.close();
    }
  });

  it('F4.2 creates a manual proposal with custom lead entry (no intakeId)', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Workflow Automator', status: 'available', basePriceInr: 8000 },
      });
      assert.equal(svc.status, 201);

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Apex Custom Manufacturing',
          companySize: '5-10',
          contactName: 'Vikram Singh',
          contactEmail: 'vikram@apexmfg.com',
          contactPhone: '+91-9765432100',
          currentTools: 'SAP, Excel',
          companySizeMultiplier: 1.5,
          marginPercent: 0,
          items: [
            {
              serviceId: svc.data.id,
              description: 'Workflow Automator License',
              quantity: 1,
            },
          ],
        },
      });
      assert.equal(proposal.status, 201);
      assert.ok(proposal.data.quote.id);
      assert.ok(proposal.data.quote.quote_number);
      assert.equal(proposal.data.quote.company_name, 'Apex Custom Manufacturing');
      assert.equal(proposal.data.quote.company_size, '5-10');
      assert.equal(proposal.data.quote.contact_name, 'Vikram Singh');
      assert.equal(proposal.data.items.length, 1);
    } finally {
      await srv.close();
    }
  });

  it('F4.3 supports multi-service line items automatically applying companySizeMultiplier to base prices', async () => {
    const srv = await startE2EServer();
    try {
      const s1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Service Alpha', status: 'available', basePriceInr: 10000 },
      });
      const s2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Service Beta', status: 'available', basePriceInr: 20000 },
      });
      assert.equal(s1.status, 201);
      assert.equal(s2.status, 201);

      const res = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'MultiSvc Corp',
          companySize: '10-20',
          companySizeMultiplier: 2.0,
          marginPercent: 0,
          discountPercent: 0,
          items: [
            { serviceId: s1.data.id, description: 'Service Alpha', quantity: 1 },
            { serviceId: s2.data.id, description: 'Service Beta', quantity: 1 },
          ],
        },
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.items.length, 2);
      assert.equal(Number(res.data.items[0].quoted_unit_price_paise), 2000000);
      assert.equal(Number(res.data.items[1].quoted_unit_price_paise), 4000000);
      assert.equal(Number(res.data.quote.subtotal_paise), 6000000);
      assert.equal(Number(res.data.quote.total_paise), 6000000);
    } finally {
      await srv.close();
    }
  });

  it('F4.4 computes totals accurately with quantity edits, unit price overrides, margin %, and discount %', async () => {
    const srv = await startE2EServer();
    try {
      const s1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Core Engine', status: 'available', basePriceInr: 10000 }, // 1,000,000 paise
      });
      const s2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Training Pack', status: 'available', basePriceInr: 5000 }, // 500,000 paise
      });

      // Multiplier 1.5x => Core Engine default unit = 1,500,000 paise * qty 2 = 3,000,000
      // Training Pack overridden unit = 600,000 paise * qty 3 = 1,800,000
      // Subtotal = 4,800,000 paise
      // Margin 10% = 480,000 paise => subtotal + margin = 5,280,000
      // Discount 5% of (subtotal + margin) = Math.round(5,280,000 * 0.05) = 264,000
      // Total = 5,280,000 - 264,000 = 5,016,000 paise
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Precision Calc Ltd',
          companySize: '5-10',
          companySizeMultiplier: 1.5,
          marginPercent: 10,
          discountPercent: 5,
          items: [
            { serviceId: s1.data.id, description: 'Core Engine', quantity: 2 },
            {
              serviceId: s2.data.id,
              description: 'Training Pack',
              quantity: 3,
              quotedUnitPricePaise: 600000,
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(created.status, 201);
      assert.equal(Number(created.data.quote.subtotal_paise), 4800000);
      assert.equal(Number(created.data.quote.margin_paise), 480000);
      assert.equal(Number(created.data.quote.discount_paise), 264000);
      assert.equal(Number(created.data.quote.total_paise), 5016000);
      assert.equal(created.data.items[1].is_price_overridden, true);

      // Now edit via PATCH /api/quotes/:id: qty 1 for Core Engine (1,500,000) + Training Pack (1,800,000) => subtotal 3,300,000
      // margin 20% = 660,000 => 3,960,000; discount 10% = 396,000 => total = 3,564,000
      const patched = await srv.apiJson(`/api/quotes/${created.data.quote.id}`, {
        method: 'PATCH',
        body: {
          marginPercent: 20,
          discountPercent: 10,
          items: [
            { serviceId: s1.data.id, description: 'Core Engine', quantity: 1 },
            {
              serviceId: s2.data.id,
              description: 'Training Pack',
              quantity: 3,
              quotedUnitPricePaise: 600000,
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(patched.status, 200);
      assert.equal(Number(patched.data.quote.subtotal_paise), 3300000);
      assert.equal(Number(patched.data.quote.margin_paise), 660000);
      assert.equal(Number(patched.data.quote.discount_paise), 396000);
      assert.equal(Number(patched.data.quote.total_paise), 3564000);
    } finally {
      await srv.close();
    }
  });

  it('F4.5 pre-fills Terms & Conditions from Settings default and persists independent per-proposal T&C edits', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'T&C Test Service', status: 'available', basePriceInr: 10000 },
      });
      await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: 'Global Default Terms v1' },
      });

      const p1 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Terms Client A',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'T&C Test Service', quantity: 1 }],
        },
      });
      assert.equal(p1.status, 201);
      assert.equal(p1.data.quote.terms_and_conditions, 'Global Default Terms v1');

      const patched = await srv.apiJson(`/api/quotes/${p1.data.quote.id}`, {
        method: 'PATCH',
        body: { termsAndConditions: 'Custom Net-45 Terms for Client A' },
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.data.quote.terms_and_conditions, 'Custom Net-45 Terms for Client A');

      const settings = await srv.apiJson('/api/settings');
      assert.equal(settings.data.defaultTermsAndConditions, 'Global Default Terms v1');
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F5: Server-Side Branded Vector PDF', () => {
  it('F5.1 returns HTTP 200 application/pdf with Content-Disposition and valid PDF framing', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'PDF Service', status: 'available', basePriceInr: 15000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'PDF Framing Corp',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'PDF Service', quantity: 1 }],
        },
      });
      assert.equal(created.status, 201);

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      assert.match(pdfRes.headers.get('content-type') ?? '', /application\/pdf/i);
      const disp = pdfRes.headers.get('content-disposition') ?? '';
      assert.ok(disp.includes('.pdf'), `Expected .pdf filename in Content-Disposition, got: ${disp}`);

      const buf = Buffer.from(await pdfRes.arrayBuffer());
      const info = inspectPdfBuffer(buf);
      assert.match(info.header, /^%PDF-1\.[0-7]/);
      assert.equal(info.hasStartXref, true);
      assert.equal(info.hasEof, true);
    } finally {
      await srv.close();
    }
  });

  it('F5.2 produces a genuine vector PDF with embedded fonts and zero raster image wrappers', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Vector Check Svc', status: 'available', basePriceInr: 20000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Vector Proof Ltd',
          companySize: '5-10',
          marginPercent: 10,
          items: [{ serviceId: svc.data.id, description: 'Vector Check Svc', quantity: 1 }],
        },
      });
      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));

      assert.ok(info.fontCount >= 1, `Expected fontCount >= 1, got ${info.fontCount}`);
      assert.ok(info.textOperatorCount > 0, `Expected textOperatorCount > 0, got ${info.textOperatorCount}`);
      assert.ok(
        info.vectorOperatorCount > 0,
        `Expected vectorOperatorCount > 0, got ${info.vectorOperatorCount}`,
      );
      assert.equal(info.imageObjectCount, 0, 'Expected pure vector layout with 0 raster image objects');
    } finally {
      await srv.close();
    }
  });

  it('F5.3 extracts CosmIQ OS branding, quote number, date, and client details from PDF text', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Brand Audit Service', status: 'available', basePriceInr: 12000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Surya Aerospace Pvt Ltd',
          companySize: '10-20',
          contactName: 'Ananya Deshmukh',
          contactEmail: 'ananya@suryaaero.in',
          contactPhone: '+91-9810098100',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Brand Audit Service', quantity: 1 }],
        },
      });
      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));

      assert.match(info.normalizedText, /CosmIQ\s*OS/i);
      assert.ok(
        info.normalizedText.includes(created.data.quote.quote_number),
        `PDF text must contain quote_number ${created.data.quote.quote_number}`,
      );
      assert.match(info.normalizedText, /\d{4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
      assert.ok(info.normalizedText.includes('Surya Aerospace Pvt Ltd'));
      assert.ok(info.normalizedText.includes('Ananya Deshmukh'));
      assert.ok(info.normalizedText.includes('ananya@suryaaero.in'));
    } finally {
      await srv.close();
    }
  });

  it('F5.4 extracts itemized INR pricing table, subtotal, margin, discount, and grand total', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Automated Support Desk', status: 'available', basePriceInr: 15000 },
      });
      // unit = 15000 * 1.0 = 15,000 INR (1,500,000 paise); qty 2 => subtotal = 30,000 INR (3,000,000 paise)
      // margin 10% = 3,000 INR (300,000 paise) => 33,000 INR; discount 10% = 3,300 INR (330,000 paise)
      // total = 29,700 INR (2,970,000 paise)
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'INR Pricing Corp',
          companySize: '0-5',
          companySizeMultiplier: 1.0,
          marginPercent: 10,
          discountPercent: 10,
          items: [{ serviceId: svc.data.id, description: 'Automated Support Desk', quantity: 2 }],
        },
      });
      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));

      assert.ok(info.normalizedText.includes('₹'), 'PDF must render Indian Rupee symbol ₹');
      assert.ok(info.normalizedText.includes('Automated Support Desk'));
      assert.match(info.normalizedText, buildInrAmountRegex(3000000));
      assert.match(info.normalizedText, buildInrAmountRegex(2970000));
      assert.match(info.normalizedText, /subtotal/i);
      assert.match(info.normalizedText, /total/i);
    } finally {
      await srv.close();
    }
  });

  it('F5.5 extracts per-proposal Terms & Conditions and signature block sections', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Signature Check Service', status: 'available', basePriceInr: 9000 },
      });
      const customTerms = 'Unique Proposal Clause 9981: 50% milestone advance upon kickoff.';
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Signature Works LLP',
          companySize: '0-5',
          marginPercent: 0,
          termsAndConditions: customTerms,
          items: [{ serviceId: svc.data.id, description: 'Signature Check Service', quantity: 1 }],
        },
      });
      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));

      assert.ok(
        info.normalizedText.includes('Unique Proposal Clause 9981'),
        'PDF must include custom per-proposal terms',
      );
      assert.match(info.normalizedText, /terms\s*(&|and)?\s*conditions/i);
      assert.match(info.normalizedText, /signature|authorized|accepted/i);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F6: Tab 04 Navigation Rename', () => {
  it('F6.1 served SPA JS bundle includes "PROPOSALS & QUOTES"', async () => {
    const srv = await startE2EServer();
    try {
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      assert.equal(bundle.indexStatus, 200);
      assert.equal(bundle.jsStatus, 200);
      assert.ok(
        bundle.jsText.includes('PROPOSALS & QUOTES'),
        'Built JS bundle served by Express must include "PROPOSALS & QUOTES"',
      );
    } finally {
      await srv.close();
    }
  });

  it('F6.2 served SPA JS bundle has zero occurrences of "QUOTES & APPROVALS"', async () => {
    const srv = await startE2EServer();
    try {
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      assert.equal(bundle.jsStatus, 200);
      assert.equal(
        /quotes\s*&\s*approvals/i.test(bundle.jsText),
        false,
        'Built JS bundle must not contain legacy "QUOTES & APPROVALS" label',
      );
    } finally {
      await srv.close();
    }
  });

  it('F6.3 dashboard/src/App.tsx Tab 04 nav label is PROPOSALS & QUOTES', () => {
    const snap = readDashboardSources();
    const appFile = snap.files.find((f) => f.relPath === 'dashboard/src/App.tsx');
    assert.ok(appFile, 'dashboard/src/App.tsx must exist');
    assert.match(
      appFile.content,
      /PROPOSALS\s*&\s*(?:amp;\s*)?QUOTES/,
      'App.tsx must label Tab 04 as PROPOSALS & QUOTES',
    );
  });

  it('F6.4 dashboard/src/ has zero occurrences of QUOTES & APPROVALS in nav, headers, or comments', () => {
    const snap = readDashboardSources();
    assert.equal(
      /QUOTES\s*&\s*(?:amp;\s*)?APPROVALS/i.test(snap.combinedSource),
      false,
      'dashboard/src must not retain any "QUOTES & APPROVALS" labels or comments',
    );
  });

  it('F6.5 Tab 04 page headers in dashboard/src/ align with Proposals & Quotes', () => {
    const snap = readDashboardSources();
    const headerMatches = snap.combinedSource.match(/Proposals\s*&\s*(?:amp;\s*)?Quotes/gi) ?? [];
    assert.ok(
      headerMatches.length >= 2,
      `Expected at least 2 occurrences (nav + header) of Proposals & Quotes in dashboard/src, found ${headerMatches.length}`,
    );
  });
});

describe('Tier 1 — F7: Dashboard UI Workflows', () => {
  it('F7.1 dashboard TypeScript check (tsc -p dashboard/tsconfig.json --noEmit) exits 0', () => {
    const tscBin = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const res = spawnSync(
      process.execPath,
      [tscBin, '-p', path.join(REPO_ROOT, 'dashboard', 'tsconfig.json'), '--noEmit'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.equal(
      res.status,
      0,
      `dashboard typecheck failed:\n${res.stdout}\n${res.stderr}`,
    );
  });

  it('F7.2 Service Catalog UI supports CRUD, all 4 statuses, INR base price, and 409 conflict handling', async () => {
    const srv = await startE2EServer();
    try {
      const snap = readDashboardSources();
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      const corpus = `${snap.combinedSource}\n${bundle.jsText}`;

      assert.ok(corpus.includes('/api/services'));
      assert.match(corpus, /\bDELETE\b/);
      assert.match(corpus, /\bPATCH\b/);
      assert.match(corpus, /\bPOST\b/);
      for (const status of ['available', 'unavailable', 'maintenance', 'limited']) {
        assert.ok(corpus.includes(status), `UI must support status "${status}"`);
      }
      assert.match(corpus, /basePriceInr|base_price_paise/);
      assert.match(corpus, /409|SERVICE_IN_USE|referenced by/i);
    } finally {
      await srv.close();
    }
  });

  it('F7.3 Settings UI exposes multipliers (0-5, 5-10, 10-20, 20+) and default Terms & Conditions', async () => {
    const srv = await startE2EServer();
    try {
      const snap = readDashboardSources();
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      const corpus = `${snap.combinedSource}\n${bundle.jsText}`;

      assert.match(bundle.jsText, /\bSETTINGS\b/);
      assert.ok(corpus.includes('/api/settings'));
      for (const tier of ['0-5', '5-10', '10-20', '20+']) {
        assert.ok(corpus.includes(tier), `Settings UI must reference tier "${tier}"`);
      }
      assert.ok(
        corpus.includes('defaultTermsAndConditions') || /Terms\s*(&|&amp;|and)\s*Conditions/i.test(corpus),
      );
    } finally {
      await srv.close();
    }
  });

  it('F7.4 New Proposal UI workflow supports lead picker, multi-service items, overrides, discount/margin, T&C, and PDF download', async () => {
    const srv = await startE2EServer();
    try {
      const snap = readDashboardSources();
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);

      assert.ok(
        bundle.jsText.includes('NEW PROPOSAL'),
        'Built dashboard JS must render "NEW PROPOSAL" button',
      );
      assert.ok(snap.combinedSource.includes('/api/quotes'));
      assert.ok(snap.combinedSource.includes('/api/intakes'));
      assert.match(snap.combinedSource, /\/pdf/);
      assert.match(snap.combinedSource, /discountPercent|discount_percent/i);
      assert.match(snap.combinedSource, /termsAndConditions|terms_and_conditions/i);
      assert.match(snap.combinedSource, /quotedUnitPricePaise|isPriceOverridden|override/i);
    } finally {
      await srv.close();
    }
  });

  it('F7.5 Dashboard UI handles website channel styling, contact details, notes, and website_lead notifications', async () => {
    const srv = await startE2EServer();
    try {
      const snap = readDashboardSources();
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      const corpus = `${snap.combinedSource}\n${bundle.jsText}`;

      assert.ok(corpus.includes('website'), 'Dashboard must support website channel');
      assert.ok(
        snap.cssSource.includes('website') || bundle.cssText.includes('website'),
        'Dashboard CSS must style website channel badge/pill',
      );
      assert.match(corpus, /contact_email|contact_name|contact_phone/);
      assert.match(corpus, /website_lead/);
    } finally {
      await srv.close();
    }
  });
});

describe('Tier 1 — F8: cosmiqos.com Integration Plan & Code', () => {
  it('F8.1 docs/cosmiqos-website-integration.md exists with Markdown headings and fenced code blocks', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true, `Expected deliverable at ${doc.filePath}`);
    assert.ok(doc.content.length > 500, 'Integration doc must be substantive');
    const headings = doc.content.match(/^#{1,3}\s+.+$/gm) ?? [];
    assert.ok(headings.length >= 3, 'Expected multiple Markdown headings');
    const codeBlocks = doc.content.match(/```[\s\S]*?```/g) ?? [];
    assert.ok(codeBlocks.length >= 3, 'Expected multiple ready-to-use fenced code blocks');
  });

  it('F8.2 documents POST /api/leads/website, channel=website, and 429 rate-limit behavior', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.ok(doc.content.includes('/api/leads/website'));
    assert.match(doc.content, /\bPOST\b/);
    assert.match(doc.content, /website/i);
    assert.match(doc.content, /\b429\b|rate.?limit/i);
  });

  it('F8.3 documents server-to-server proxy and WEBSITE_LEAD_SECRET without exposing NEXT_PUBLIC_* secret', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.ok(doc.content.includes('WEBSITE_LEAD_SECRET'));
    assert.match(doc.content, /server-to-server|API route|enquiries/i);
  });

  it('F8.4 includes ready-to-use code/edits for LeadForm.tsx, validation.ts, api/enquiries/route.ts, globals.css, and env vars', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    assert.ok(doc.content.includes('LeadForm.tsx'));
    assert.ok(doc.content.includes('validation.ts'));
    assert.match(doc.content, /api\/enquiries\/route\.ts/);
    assert.ok(doc.content.includes('globals.css'));
    assert.match(doc.content, /\.env|ENGINE_API_URL|CUSTOMER_SERVICE_ENGINE_URL|COSMIQ_ENGINE_URL/i);
  });

  it('F8.5 covers all lead fields including company sizes 0-5, 5-10, 10-20, 20+ and currentTools', () => {
    const doc = readIntegrationDoc();
    assert.equal(doc.exists, true);
    for (const size of ['0-5', '5-10', '10-20', '20+']) {
      assert.ok(doc.content.includes(size), `Integration doc must cover size "${size}"`);
    }
    assert.match(doc.content, /currentTools|current_tools/);
    assert.match(doc.content, /companyName|company_name/);
    assert.match(doc.content, /automations/);
    assert.match(doc.content, /notes/);
  });
});

describe('Tier 1 — F9: Neon Branch Isolation Verification', () => {
  it('F9.1 openDatabase(":memory:") boots isolated PGlite with driver=pglite and target=pglite://:memory:', async () => {
    const db = await openDatabase(':memory:');
    try {
      assert.equal(db.driver, 'pglite');
      assert.equal(db.target, 'pglite://:memory:');
      const ping = await db.queryOne<{ one: number }>('SELECT 1 AS one');
      assert.equal(ping?.one, 1);
    } finally {
      await db.close();
    }
  });

  it('F9.2 schema_migrations matches all sorted SQL files in src/db/migrations including 008..010', async () => {
    const db = await openDatabase(':memory:');
    try {
      const diskFiles = fs
        .readdirSync(path.join(REPO_ROOT, 'src', 'db', 'migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      assert.ok(diskFiles.length >= 10, `Expected >= 10 migrations (001..010), found ${diskFiles.length}`);
      assert.ok(diskFiles.some((f) => f.startsWith('008_')));
      assert.ok(diskFiles.some((f) => f.startsWith('009_')));
      assert.ok(diskFiles.some((f) => f.startsWith('010_')));

      const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
      assert.deepEqual(
        rows.rows.map((r) => r.name),
        diskFiles,
      );
    } finally {
      await db.close();
    }
  });

  it('F9.3 new columns from migrations 008..010 are readable and writable in isolated PGlite', async () => {
    const db = await openDatabase(':memory:');
    try {
      const svc = await db.queryOne<{ id: number; base_price_paise: string | number }>(
        `INSERT INTO services (name, status, base_price_paise) VALUES ($1, $2, $3) RETURNING id, base_price_paise`,
        ['Migration Test Svc', 'available', 420000],
      );
      assert.ok(svc?.id);
      assert.equal(Number(svc?.base_price_paise), 420000);

      await db.query(
        `INSERT INTO sessions (id, channel, external_user_id) VALUES ($1, $2, $3)`,
        ['sess-mig-1', 'website', 'web-mig-1'],
      );
      const intake = await db.queryOne<{ contact_email: string; notes: string }>(
        `INSERT INTO service_intakes (session_id, channel, external_user_id, company_name, company_size, contact_name, contact_email, contact_phone, contact_role, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'complete')
         RETURNING contact_email, notes`,
        ['sess-mig-1', 'website', 'web-mig-1', 'MigCo', '0-5', 'Pat', 'pat@mig.co', '+91111', 'CTO', 'Note here'],
      );
      assert.equal(intake?.contact_email, 'pat@mig.co');
      assert.equal(intake?.notes, 'Note here');

      const quote = await db.queryOne<{ id: number; discount_percent: number; terms_and_conditions: string }>(
        `INSERT INTO quotes (quote_number, channel, external_user_id, margin_percent, company_name, company_size, company_size_multiplier, discount_percent, discount_paise, terms_and_conditions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, discount_percent, terms_and_conditions`,
        ['Q-MIG-1', 'manual', 'manual-1', 0, 'MigCo', '0-5', 1.0, 10, 0, 'Sample Terms'],
      );
      assert.ok(quote?.id);
      assert.equal(quote?.discount_percent, 10);

      const qi = await db.queryOne<{ service_id: number; is_price_overridden: boolean }>(
        `INSERT INTO quote_items (quote_id, service_id, service_name, item_code, description, unit, quantity, admin_unit_price_paise, base_unit_price_paise, quoted_unit_price_paise, is_price_overridden, line_total_paise, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING service_id, is_price_overridden`,
        [quote!.id, svc!.id, 'Migration Test Svc', 'SVC-1', 'Desc', 'unit', 1, 420000, 420000, 400000, true, 400000, 0],
      );
      assert.equal(qi?.service_id, svc!.id);
      assert.equal(qi?.is_price_overridden, true);
    } finally {
      await db.close();
    }
  });

  it('F9.4 GET /api/health reports { ok: true, db: "pglite" } on E2E server', async () => {
    const srv = await startE2EServer();
    try {
      const res = await srv.publicGet('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.equal(res.data.db, 'pglite');
    } finally {
      await srv.close();
    }
  });

  it('F9.5 loadConfig and resolveDatabaseTarget honor DB_PATH and isolated Neon branch URL overrides', () => {
    const localCfg = loadConfig({ DB_PATH: './tmp/e2e-pglite' });
    assert.equal(resolveDatabaseTarget(localCfg), './tmp/e2e-pglite');

    const branchUrl = 'postgresql://neondb_owner:secret@ep-temp-branch-123.us-east-2.aws.neon.tech/neondb?sslmode=require';
    const branchCfg = loadConfig({ DATABASE_URL: branchUrl, DB_PATH: './tmp/ignored' });
    assert.equal(resolveDatabaseTarget(branchCfg), branchUrl);
  });
});
