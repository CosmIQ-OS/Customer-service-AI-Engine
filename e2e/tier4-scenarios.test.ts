import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  REPO_ROOT,
  buildInrAmountRegex,
  fetchServedDashboardBundle,
  inspectPdfBuffer,
  openDatabase,
  readDashboardSources,
  readIntegrationDoc,
  redactDatabaseUrl,
  startE2EServer,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tier 4: Real-World Application Scenarios (>= 6 end-to-end workflows)
// ---------------------------------------------------------------------------

describe('Tier 4 — Real-World Application Scenarios', () => {
  it('Scenario 1: cosmiqos.com Enterprise Lead -> Inbox & Notification -> Multi-Service Proposal -> Branded PDF Download', async () => {
    const srv = await startE2EServer();
    try {
      // 1. Admin configures service catalog
      const svcCore = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'CosmIQ Omnichannel Support Engine',
          category: 'core',
          description: 'AI + human handoff across web, WhatsApp, and Telegram',
          status: 'available',
          basePriceInr: 25000, // 2,500,000 paise
        },
      });
      const svcCrm = await srv.apiJson('/api/services', {
        method: 'POST',
        body: {
          name: 'CRM & ERP Bi-Directional Connector',
          category: 'integration',
          description: 'Real-time sync with HubSpot / Zoho / SAP',
          status: 'available',
          basePriceInr: 15000, // 1,500,000 paise
        },
      });
      assert.equal(svcCore.status, 201);
      assert.equal(svcCrm.status, 201);

      // 2. Enterprise prospect submits enquiry on cosmiqos.com
      const leadRes = await srv.publicPost('/api/leads/website', {
        companyName: 'Bharat Mobility Systems Pvt Ltd',
        companySize: '20+',
        contactName: 'Ritu Deshpande',
        contactEmail: 'ritu@bharatmobility.in',
        contactPhone: '+91-9820011223',
        contactRole: 'Chief Operating Officer',
        currentTools: ['Salesforce', 'WhatsApp Business', 'Freshdesk'],
        automations: ['Support Triage', 'Quotation Engine'],
        notes: 'Need phased rollout across 4 regional hubs.',
      });
      assert.equal(leadRes.status, 201);
      assert.equal(leadRes.data.intake.channel, 'website');

      // 3. Verify Live Inbox, Leads list, and Admin Notification
      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const lead = intakes.data.find((i) => i.id === leadRes.data.intake.id);
      assert.ok(lead);
      assert.equal(lead.contact_name, 'Ritu Deshpande');

      const inbox = await srv.apiJson<{ conversations: any[] }>('/api/conversations');
      const conv = inbox.data.conversations.find((c) => c.session_id === leadRes.data.conversationId);
      assert.ok(conv);
      assert.equal(conv.channel, 'website');

      const notifs = await srv.apiJson<{ notifications: any[]; unread: number }>('/api/notifications');
      assert.ok(notifs.data.unread >= 1);
      await srv.apiJson(`/api/notifications/${leadRes.data.notificationId}/read`, {
        method: 'POST',
        body: {},
      });

      // 4. Create multi-service proposal using 20+ multiplier (3.0x)
      // Core: 25,000 * 3.0 = 75,000 INR; CRM: 15,000 * 3.0 = 45,000 INR => subtotal = 120,000 INR (12,000,000 paise)
      // Margin 10% = 12,000 INR => 132,000 INR; Discount 10% = 13,200 INR => Total = 118,800 INR (11,880,000 paise)
      const settings = await srv.apiJson('/api/settings');
      const mult20Plus = settings.data.companySizeMultipliers['20+'];
      assert.equal(mult20Plus, 3.0);

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: lead.id,
          companySizeMultiplier: mult20Plus,
          marginPercent: 10,
          discountPercent: 10,
          items: [
            { serviceId: svcCore.data.id, description: 'CosmIQ Omnichannel Support Engine', quantity: 1 },
            { serviceId: svcCrm.data.id, description: 'CRM & ERP Bi-Directional Connector', quantity: 1 },
          ],
        },
      });
      assert.equal(proposal.status, 201);
      assert.equal(Number(proposal.data.quote.subtotal_paise), 12000000);
      assert.equal(Number(proposal.data.quote.total_paise), 11880000);

      // 5. Download & inspect vector PDF
      const pdfRes = await srv.apiRaw(`/api/quotes/${proposal.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.match(info.header, /^%PDF-1\.[0-7]/);
      assert.equal(info.hasEof, true);
      assert.equal(info.imageObjectCount, 0);
      assert.match(info.normalizedText, /CosmIQ\s*OS/i);
      assert.ok(info.normalizedText.includes('Bharat Mobility Systems Pvt Ltd'));
      assert.ok(info.normalizedText.includes('Ritu Deshpande'));
      assert.ok(info.normalizedText.includes('CosmIQ Omnichannel Support Engine'));
      assert.ok(info.normalizedText.includes('CRM & ERP Bi-Directional Connector'));
      assert.match(info.normalizedText, buildInrAmountRegex(11880000));
    } finally {
      await srv.close();
    }
  });

  it('Scenario 2: Catalog Expansion + Custom Multiplier + Settings T&C Update -> Independent Proposal Snapshot & Audit', async () => {
    const srv = await startE2EServer();
    try {
      const s1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Document OCR Pipeline', status: 'available', basePriceInr: 10000 },
      });
      await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: { companySizeMultipliers: { '0-5': 1.0, '5-10': 1.75, '10-20': 2.5, '20+': 3.5 } },
      });
      await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: 'Standard Terms Edition A: 30 days validity.' },
      });

      const p1 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Edition A Client',
          companySize: '5-10',
          companySizeMultiplier: 1.75,
          marginPercent: 0,
          items: [{ serviceId: s1.data.id, description: 'Document OCR Pipeline', quantity: 2 }],
        },
      });
      assert.equal(p1.status, 201);
      assert.equal(Number(p1.data.quote.total_paise), 3500000); // 10,000 * 1.75 * 2 = 35,000 INR

      // Edit proposal A T&C independently
      await srv.apiJson(`/api/quotes/${p1.data.quote.id}`, {
        method: 'PATCH',
        body: { termsAndConditions: 'Custom Negotiated Terms for Edition A Client.' },
      });

      // Now update global Settings & Catalog base price
      await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: 'Standard Terms Edition B: 15 days validity.' },
      });
      await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: { companySizeMultipliers: { '0-5': 1.0, '5-10': 2.0, '10-20': 3.0, '20+': 4.0 } },
      });
      await srv.apiJson(`/api/services/${s1.data.id}`, {
        method: 'PATCH',
        body: { basePriceInr: 20000 },
      });

      // New proposal B uses new Settings and new Catalog price
      const p2 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Edition B Client',
          companySize: '5-10',
          companySizeMultiplier: 2.0,
          marginPercent: 0,
          items: [{ serviceId: s1.data.id, description: 'Document OCR Pipeline', quantity: 1 }],
        },
      });
      assert.equal(Number(p2.data.quote.total_paise), 4000000);
      assert.equal(p2.data.quote.terms_and_conditions, 'Standard Terms Edition B: 15 days validity.');

      // Proposal A snapshot & PDF remain completely isolated
      const p1Audit = await srv.apiJson(`/api/quotes/${p1.data.quote.id}`);
      assert.equal(Number(p1Audit.data.quote.total_paise), 3500000);
      assert.equal(p1Audit.data.quote.terms_and_conditions, 'Custom Negotiated Terms for Edition A Client.');

      const pdf1 = inspectPdfBuffer(
        Buffer.from(await (await srv.apiRaw(`/api/quotes/${p1.data.quote.id}/pdf`)).arrayBuffer()),
      );
      assert.ok(pdf1.normalizedText.includes('Custom Negotiated Terms for Edition A Client.'));
      assert.match(pdf1.normalizedText, buildInrAmountRegex(3500000));
    } finally {
      await srv.close();
    }
  });

  it('Scenario 3: Public Rate-Limit Burst -> Legitimate Lead Intake -> Proposal Creation & Delete Protection (409)', async () => {
    const srv = await startE2EServer();
    try {
      const protectedSvc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Protected AI Agent', status: 'available', basePriceInr: 12000 },
      });
      const unusedSvc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Unused Addon', status: 'available', basePriceInr: 4000 },
      });

      const firstLead = await srv.publicPost('/api/leads/website', {
        companyName: 'LegitBurst Lead 1',
        companySize: '0-5',
        contactName: 'Sonia Kapoor',
        contactEmail: 'sonia@legitburst.in',
      });
      assert.equal(firstLead.status, 201);

      const headerLimit = firstLead.headers.get('x-ratelimit-limit');
      const cap = headerLimit ? Math.min(Number(headerLimit) + 4, 50) : 20;
      let hit429 = false;
      let acceptedCount = 1;
      for (let i = 2; i <= cap; i += 1) {
        const res = await srv.publicPost('/api/leads/website', {
          companyName: `LegitBurst Lead ${i}`,
          companySize: '0-5',
          contactEmail: `lead${i}@legitburst.in`,
        });
        if (res.status === 429) {
          hit429 = true;
          break;
        }
        assert.equal(res.status, 201);
        acceptedCount += 1;
      }
      assert.equal(hit429, true, 'Burst beyond rate limit must return HTTP 429');

      // Server health and admin endpoints stay responsive
      const health = await srv.publicGet('/api/health');
      assert.equal(health.status, 200);

      // Legitimate leads persisted accurately
      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const legitRows = intakes.data.filter((x) => String(x.company_name).startsWith('LegitBurst Lead '));
      assert.equal(legitRows.length, acceptedCount);

      // Build proposal from lead 1
      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: firstLead.data.intake.id,
          marginPercent: 0,
          items: [{ serviceId: protectedSvc.data.id, description: 'Protected AI Agent', quantity: 1 }],
        },
      });
      assert.equal(proposal.status, 201);

      // Referenced service cannot be deleted (409); unused service deletes cleanly (200)
      const delProtected = await srv.apiJson(`/api/services/${protectedSvc.data.id}`, {
        method: 'DELETE',
      });
      assert.equal(delProtected.status, 409);
      assert.equal(delProtected.data.code, 'SERVICE_IN_USE');

      const delUnused = await srv.apiJson(`/api/services/${unusedSvc.data.id}`, {
        method: 'DELETE',
      });
      assert.equal(delUnused.status, 200);
      assert.equal(delUnused.data.deleted, true);
    } finally {
      await srv.close();
    }
  });

  it('Scenario 4: Chat Intake Lead vs Website Lead Side-by-Side -> Proposal Editing (Qty, Override, Margin, 100% Discount) -> PDF', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Live Chat Support', status: 'available', basePriceInr: 10000 },
      });

      // Chat intake via MockLLMProvider
      const sim = await srv.apiJson('/api/chat/simulate', {
        method: 'POST',
        body: {
          channel: 'whatsapp',
          externalUserId: '+919800000001',
          text: 'Company: ChatSide Co; Size: 5-10; Tools: Freshdesk; Service: Live Chat Support',
        },
      });
      assert.equal(sim.status, 200);

      // Website intake
      const web = await srv.publicPost('/api/leads/website', {
        companyName: 'WebSide Co',
        companySize: '10-20',
        contactName: 'Tarun Bose',
        contactEmail: 'tarun@webside.in',
        currentTools: ['Zendesk'],
      });
      assert.equal(web.status, 201);

      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const chatIntake = intakes.data.find((i) => i.company_name === 'ChatSide Co');
      const webIntake = intakes.data.find((i) => i.company_name === 'WebSide Co');
      assert.ok(chatIntake && webIntake);
      assert.equal(chatIntake.channel, 'whatsapp');
      assert.equal(webIntake.channel, 'website');

      // Proposal for Website lead: start with qty 1 @ 20,000 INR -> edit qty 2, override 15,000 INR, margin 20%, discount 100% -> 0 total
      const q = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: webIntake.id,
          companySizeMultiplier: 2.0,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Live Chat Support', quantity: 1 }],
        },
      });
      assert.equal(Number(q.data.quote.total_paise), 2000000);

      const edited = await srv.apiJson(`/api/quotes/${q.data.quote.id}`, {
        method: 'PATCH',
        body: {
          marginPercent: 20,
          discountPercent: 100,
          items: [
            {
              serviceId: svc.data.id,
              description: 'Live Chat Support',
              quantity: 2,
              quotedUnitPricePaise: 1500000,
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(edited.status, 200);
      assert.equal(Number(edited.data.quote.subtotal_paise), 3000000);
      assert.equal(Number(edited.data.quote.margin_paise), 600000);
      assert.equal(Number(edited.data.quote.total_paise), 0);

      const pdf = inspectPdfBuffer(
        Buffer.from(await (await srv.apiRaw(`/api/quotes/${q.data.quote.id}/pdf`)).arrayBuffer()),
      );
      assert.ok(pdf.normalizedText.includes('WebSide Co'));
      assert.match(pdf.normalizedText, buildInrAmountRegex(0));
    } finally {
      await srv.close();
    }
  });

  it('Scenario 5: Service Lifecycle (available -> limited -> maintenance -> unavailable) with Existing Proposal Integrity & Unused Deletion', async () => {
    const srv = await startE2EServer();
    try {
      const core = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Lifecycle Core Service', status: 'available', basePriceInr: 18000 },
      });
      const pilot = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Retirable Pilot Service', status: 'available', basePriceInr: 6000 },
      });

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Lifecycle Client Pvt Ltd',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: core.data.id, description: 'Lifecycle Core Service', quantity: 1 }],
        },
      });
      assert.equal(proposal.status, 201);

      for (const status of ['limited', 'maintenance', 'unavailable'] as const) {
        const toggled = await srv.apiJson(`/api/services/${core.data.id}`, {
          method: 'PATCH',
          body: { status },
        });
        assert.equal(toggled.status, 200);
        assert.equal(toggled.data.status, status);
      }

      // Existing proposal & PDF remain intact and valid
      const qCheck = await srv.apiJson(`/api/quotes/${proposal.data.quote.id}`);
      assert.equal(qCheck.status, 200);
      assert.equal(Number(qCheck.data.quote.total_paise), 1800000);
      const pdfRes = await srv.apiRaw(`/api/quotes/${proposal.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);

      // Referenced service protected (409), unused pilot deleted (200)
      const delCore = await srv.apiJson(`/api/services/${core.data.id}`, { method: 'DELETE' });
      assert.equal(delCore.status, 409);

      const delPilot = await srv.apiJson(`/api/services/${pilot.data.id}`, { method: 'DELETE' });
      assert.equal(delPilot.status, 200);
      assert.equal(delPilot.data.deleted, true);
    } finally {
      await srv.close();
    }
  });

  it('Scenario 6: Full Production Readiness & Safety Audit (Tab 04 Rename, Dashboard Bundle, cosmiqos.com Doc, Migration & Neon Isolation)', async () => {
    const srv = await startE2EServer();
    try {
      // 1. Health & PGlite isolation
      const health = await srv.publicGet('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.db, 'pglite');

      // 2. All migrations 001..010+ applied cleanly
      const db = await openDatabase(':memory:');
      try {
        const diskMigrations = fs
          .readdirSync(path.join(REPO_ROOT, 'src', 'db', 'migrations'))
          .filter((f) => f.endsWith('.sql'))
          .sort();
        const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
        assert.deepEqual(
          applied.rows.map((r) => r.name),
          diskMigrations,
        );
        assert.ok(diskMigrations.length >= 10);
      } finally {
        await db.close();
      }

      // 3. Dashboard bundle & source Tab 04 rename + workflows
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      const snap = readDashboardSources();
      assert.equal(bundle.indexStatus, 200);
      assert.equal(bundle.jsStatus, 200);
      assert.equal(bundle.cssStatus, 200);
      assert.ok(bundle.jsText.includes('PROPOSALS & QUOTES'));
      assert.ok(bundle.jsText.includes('NEW PROPOSAL'));
      assert.equal(/quotes\s*&\s*approvals/i.test(bundle.jsText), false);
      assert.equal(/quotes\s*&\s*(?:amp;\s*)?approvals/i.test(snap.combinedSource), false);

      // 4. cosmiqos.com deliverable verified & external repo safe
      const doc = readIntegrationDoc();
      assert.equal(doc.exists, true);
      assert.ok(doc.content.includes('/api/leads/website'));
      assert.ok(doc.content.includes('WEBSITE_LEAD_SECRET'));
      assert.equal(/NEXT_PUBLIC_[A-Z0-9_]*SECRET\s*=/.test(doc.content), false);

      // 5. Secret redaction works on Neon host
      const redacted = redactDatabaseUrl(
        'postgresql://neondb_owner:real_secret_token@ep-quiet-darkness-be05w8ob.us-east-2.aws.neon.tech/neondb?sslmode=require',
      );
      assert.equal(redacted.includes('real_secret_token'), false);
      assert.ok(redacted.includes('ep-quiet-darkness-be05w8ob'));
    } finally {
      await srv.close();
    }
  });
});
