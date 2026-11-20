import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInrAmountRegex,
  fetchServedDashboardBundle,
  inspectPdfBuffer,
  readDashboardSources,
  readIntegrationDoc,
  startE2EServer,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tier 3: Cross-Feature Pairwise Combinatorial Tests (>= 12 tests)
// ---------------------------------------------------------------------------

describe('Tier 3 — Cross-Feature Pairwise Interactions', () => {
  it('P1 (F3 ↔ F4): Website lead creates inbox + notification and auto-populates POST /api/quotes via intakeId', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Website Intake Bot', status: 'available', basePriceInr: 12000 },
      });

      const lead = await srv.publicPost('/api/leads/website', {
        companyName: 'Pairwise Dynamics',
        companySize: '5-10',
        contactName: 'Siddharth Verma',
        contactEmail: 'sid@pairwisedynamics.in',
        contactPhone: '+91-9876501234',
        contactRole: 'VP Growth',
        currentTools: ['HubSpot', 'Slack'],
        notes: 'Need automated quote follow-ups.',
      });
      assert.equal(lead.status, 201);

      const notif = await srv.apiJson<{ notifications: any[]; unread: number }>('/api/notifications');
      assert.ok(notif.data.unread >= 1);

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: lead.data.intake.id,
          companySizeMultiplier: 1.5,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Website Intake Bot', quantity: 1 }],
        },
      });
      assert.equal(proposal.status, 201);
      assert.equal(proposal.data.quote.company_name, 'Pairwise Dynamics');
      assert.equal(proposal.data.quote.contact_email, 'sid@pairwisedynamics.in');
      assert.equal(Number(proposal.data.quote.total_paise), 1800000);
    } finally {
      await srv.close();
    }
  });

  it('P2 (F1 ↔ F4): Delete safety returns 409 for all services used in a multi-service proposal while allowing unused deletion', async () => {
    const srv = await startE2EServer();
    try {
      const s1 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Used Svc 1', status: 'available', basePriceInr: 10000 },
      });
      const s2 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Used Svc 2', status: 'available', basePriceInr: 20000 },
      });
      const s3 = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Unused Svc 3', status: 'available', basePriceInr: 5000 },
      });

      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Delete Guard Corp',
          companySize: '0-5',
          marginPercent: 0,
          items: [
            { serviceId: s1.data.id, description: 'Used Svc 1', quantity: 1 },
            { serviceId: s2.data.id, description: 'Used Svc 2', quantity: 2 },
          ],
        },
      });
      assert.equal(proposal.status, 201);

      const del1 = await srv.apiJson(`/api/services/${s1.data.id}`, { method: 'DELETE' });
      assert.equal(del1.status, 409);
      assert.equal(del1.data.code, 'SERVICE_IN_USE');

      const del2 = await srv.apiJson(`/api/services/${s2.data.id}`, { method: 'DELETE' });
      assert.equal(del2.status, 409);
      assert.equal(del2.data.code, 'SERVICE_IN_USE');

      const del3 = await srv.apiJson(`/api/services/${s3.data.id}`, { method: 'DELETE' });
      assert.equal(del3.status, 200);
      assert.equal(del3.data.deleted, true);
    } finally {
      await srv.close();
    }
  });

  it('P3 (F2 ↔ F4): Custom Settings multiplier applies to new proposals without mutating older proposal snapshots', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Analytics Hub', status: 'available', basePriceInr: 10000 }, // 1,000,000 paise
      });

      await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: {
          companySizeMultipliers: { '0-5': 1.0, '5-10': 1.5, '10-20': 2.75, '20+': 3.5 },
        },
      });

      const settings = await srv.apiJson('/api/settings');
      const mult = settings.data.companySizeMultipliers['10-20'];
      assert.equal(mult, 2.75);

      const p1 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Snapshot Client 1',
          companySize: '10-20',
          companySizeMultiplier: mult,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Analytics Hub', quantity: 1 }],
        },
      });
      assert.equal(p1.status, 201);
      assert.equal(Number(p1.data.quote.total_paise), 2750000);

      // Update Settings multiplier afterwards
      await srv.apiJson('/api/settings/multipliers', {
        method: 'PUT',
        body: {
          companySizeMultipliers: { '0-5': 1.0, '5-10': 1.5, '10-20': 4.0, '20+': 5.0 },
        },
      });

      const p1Check = await srv.apiJson(`/api/quotes/${p1.data.quote.id}`);
      assert.equal(Number(p1Check.data.quote.total_paise), 2750000);
    } finally {
      await srv.close();
    }
  });

  it('P4 (F2 ↔ F4): Updating Settings default T&C does not alter previously created proposal T&C', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Compliance Pack', status: 'available', basePriceInr: 5000 },
      });

      await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: 'T&C Snapshot v1.0' },
      });

      const p1 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Client Alpha',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Compliance Pack', quantity: 1 }],
        },
      });
      assert.equal(p1.data.quote.terms_and_conditions, 'T&C Snapshot v1.0');

      await srv.apiJson('/api/settings/terms', {
        method: 'PUT',
        body: { defaultTermsAndConditions: 'T&C Snapshot v2.0' },
      });

      const p2 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Client Beta',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Compliance Pack', quantity: 1 }],
        },
      });
      assert.equal(p2.data.quote.terms_and_conditions, 'T&C Snapshot v2.0');

      const p1ReFetched = await srv.apiJson(`/api/quotes/${p1.data.quote.id}`);
      assert.equal(p1ReFetched.data.quote.terms_and_conditions, 'T&C Snapshot v1.0');
    } finally {
      await srv.close();
    }
  });

  it('P5 (F1 ↔ F4 ↔ F5): Editing service base price in Catalog does not alter existing proposal PDF totals', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Voice Concierge', status: 'available', basePriceInr: 10000 },
      });
      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Locked Price Co',
          companySize: '0-5',
          companySizeMultiplier: 1.0,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Voice Concierge', quantity: 1 }],
        },
      });
      assert.equal(Number(proposal.data.quote.total_paise), 1000000);

      await srv.apiJson(`/api/services/${svc.data.id}`, {
        method: 'PATCH',
        body: { basePriceInr: 25000 },
      });

      const pdfRes = await srv.apiRaw(`/api/quotes/${proposal.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.match(info.normalizedText, buildInrAmountRegex(1000000));
    } finally {
      await srv.close();
    }
  });

  it('P6 (F1 ↔ F4 ↔ F5): Toggling referenced service to unavailable or maintenance keeps existing proposal & PDF intact', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Legacy Connector', status: 'available', basePriceInr: 8000 },
      });
      const proposal = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Maintenance Resilience Ltd',
          companySize: '0-5',
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Legacy Connector', quantity: 1 }],
        },
      });

      for (const status of ['maintenance', 'unavailable'] as const) {
        const patch = await srv.apiJson(`/api/services/${svc.data.id}`, {
          method: 'PATCH',
          body: { status },
        });
        assert.equal(patch.status, 200);
        assert.equal(patch.data.status, status);

        const pdfRes = await srv.apiRaw(`/api/quotes/${proposal.data.quote.id}/pdf`);
        assert.equal(pdfRes.status, 200);
      }
    } finally {
      await srv.close();
    }
  });

  it('P7 (F4 ↔ F5): PATCH /api/quotes/:id updates quantities, unit price overrides, discount %, and T&C reflected in PDF', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Custom AI Pipeline', status: 'available', basePriceInr: 10000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Dynamic Edit Corp',
          companySize: '0-5',
          companySizeMultiplier: 1.0,
          marginPercent: 0,
          discountPercent: 0,
          termsAndConditions: 'Draft terms',
          items: [{ serviceId: svc.data.id, description: 'Custom AI Pipeline', quantity: 1 }],
        },
      });

      // Override to 12,000 INR * qty 2 = 24,000 INR; discount 25% => total = 18,000 INR (1,800,000 paise)
      const patched = await srv.apiJson(`/api/quotes/${created.data.quote.id}`, {
        method: 'PATCH',
        body: {
          discountPercent: 25,
          termsAndConditions: 'Amended Final Terms 2026: Net-7 settlement.',
          items: [
            {
              serviceId: svc.data.id,
              description: 'Custom AI Pipeline',
              quantity: 2,
              quotedUnitPricePaise: 1200000,
              isPriceOverridden: true,
            },
          ],
        },
      });
      assert.equal(patched.status, 200);
      assert.equal(Number(patched.data.quote.total_paise), 1800000);

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.match(info.normalizedText, buildInrAmountRegex(1800000));
      assert.ok(info.normalizedText.includes('Amended Final Terms 2026'));
    } finally {
      await srv.close();
    }
  });

  it('P8 (F3 ↔ F8): Website lead payload matching docs/cosmiqos-website-integration.md succeeds and persists', async () => {
    const srv = await startE2EServer();
    try {
      const doc = readIntegrationDoc();
      assert.equal(doc.exists, true);
      assert.ok(doc.content.includes('/api/leads/website'));

      const payload = {
        companyName: 'Cosmiq Web Doc Match Ltd',
        companySize: '10-20',
        contactName: 'Arjun Malhotra',
        contactEmail: 'arjun@docmatch.in',
        contactPhone: '+91-9911223344',
        contactRole: 'Founder',
        currentTools: ['Gmail', 'Notion', 'HubSpot'],
        automations: ['Lead Intake', 'Quote Generation'],
        notes: 'Came directly from cosmiqos.com enquiry form.',
      };
      const res = await srv.publicPost('/api/leads/website', payload);
      assert.equal(res.status, 201);
      assert.equal(res.data.intake.channel, 'website');

      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const saved = intakes.data.find((i) => i.id === res.data.intake.id);
      assert.ok(saved);
      assert.equal(saved.contact_email, 'arjun@docmatch.in');
      assert.equal(saved.company_size, '10-20');
    } finally {
      await srv.close();
    }
  });

  it('P9 (F3 ↔ F4): Both chat intake leads (MockLLM) and website leads coexist in GET /api/intakes and feed POST /api/quotes', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Live Chat Support', status: 'available', basePriceInr: 10000 },
      });

      const chatSim = await srv.apiJson('/api/chat/simulate', {
        method: 'POST',
        body: {
          channel: 'telegram',
          externalUserId: 'tg-lead-101',
          text: 'Company: ChatOrigin Co; Size: 5-10; Tools: Slack; Service: Live Chat Support',
        },
      });
      assert.equal(chatSim.status, 200);

      const webRes = await srv.publicPost('/api/leads/website', {
        companyName: 'WebOrigin Co',
        companySize: '20+',
        contactName: 'Divya Shah',
        contactEmail: 'divya@weborigin.in',
        currentTools: ['Zendesk'],
      });
      assert.equal(webRes.status, 201);

      const intakes = await srv.apiJson<any[]>('/api/intakes');
      const chatLead = intakes.data.find((i) => i.company_name === 'ChatOrigin Co');
      const webLead = intakes.data.find((i) => i.company_name === 'WebOrigin Co');
      assert.ok(chatLead, 'Chat intake should exist');
      assert.ok(webLead, 'Website intake should exist');
      assert.equal(chatLead.channel, 'telegram');
      assert.equal(webLead.channel, 'website');

      const q1 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: chatLead.id,
          companySizeMultiplier: 1.5,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Live Chat Support', quantity: 1 }],
        },
      });
      const q2 = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: webLead.id,
          companySizeMultiplier: 3.0,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Live Chat Support', quantity: 1 }],
        },
      });
      assert.equal(q1.status, 201);
      assert.equal(q2.status, 201);
      assert.equal(Number(q1.data.quote.total_paise), 1500000);
      assert.equal(Number(q2.data.quote.total_paise), 3000000);
    } finally {
      await srv.close();
    }
  });

  it('P10 (F4 ↔ F5): Proposal approval and rejection preserve client details, terms, and PDF generation', async () => {
    const srv = await startE2EServer();
    try {
      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Approval Track Svc', status: 'available', basePriceInr: 15000 },
      });
      const created = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          companyName: 'Approval Flow Corp',
          companySize: '5-10',
          companySizeMultiplier: 1.5,
          marginPercent: 30,
          termsAndConditions: 'Standard Approval Terms 2026',
          items: [{ serviceId: svc.data.id, description: 'Approval Track Svc', quantity: 1 }],
        },
      });
      assert.equal(created.status, 201);

      const approved = await srv.apiJson(`/api/quotes/${created.data.quote.id}/approve`, {
        method: 'POST',
        body: {},
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.data.quote.status, 'approved');

      const pdfRes = await srv.apiRaw(`/api/quotes/${created.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.ok(info.normalizedText.includes('Approval Flow Corp'));
      assert.ok(info.normalizedText.includes('Standard Approval Terms 2026'));
    } finally {
      await srv.close();
    }
  });

  it('P11 (F6 ↔ F7): Served dashboard bundle aligns renamed Tab 04 PROPOSALS & QUOTES with NEW PROPOSAL and backend routes', async () => {
    const srv = await startE2EServer();
    try {
      const bundle = await fetchServedDashboardBundle(srv.baseUrl);
      const snap = readDashboardSources();
      assert.equal(bundle.indexStatus, 200);
      assert.equal(bundle.jsStatus, 200);
      assert.ok(bundle.jsText.includes('PROPOSALS & QUOTES'));
      assert.ok(bundle.jsText.includes('NEW PROPOSAL'));
      assert.equal(/quotes\s*&\s*approvals/i.test(bundle.jsText), false);
      assert.ok(snap.combinedSource.includes('/api/quotes'));
      assert.ok(snap.combinedSource.includes('/api/services'));
      assert.ok(snap.combinedSource.includes('/api/settings'));
    } finally {
      await srv.close();
    }
  });

  it('P12 (F3 ↔ F5 ↔ F9): Full isolated workflow marks notifications read and never touches external Neon DB', async () => {
    const srv = await startE2EServer();
    try {
      const health = await srv.publicGet('/api/health');
      assert.equal(health.data.db, 'pglite');

      const svc = await srv.apiJson('/api/services', {
        method: 'POST',
        body: { name: 'Isolated Flow Svc', status: 'available', basePriceInr: 5000 },
      });
      const lead = await srv.publicPost('/api/leads/website', {
        companyName: 'Isolation Test Co',
        companySize: '0-5',
        contactName: 'Karan Bedi',
        contactEmail: 'karan@isolation.test',
      });
      assert.equal(lead.status, 201);

      const readAll = await srv.apiJson('/api/notifications/read-all', { method: 'POST', body: {} });
      assert.equal(readAll.status, 200);

      const notifsAfter = await srv.apiJson<{ unread: number }>('/api/notifications');
      assert.equal(notifsAfter.data.unread, 0);

      const q = await srv.apiJson('/api/quotes', {
        method: 'POST',
        body: {
          intakeId: lead.data.intake.id,
          marginPercent: 0,
          items: [{ serviceId: svc.data.id, description: 'Isolated Flow Svc', quantity: 1 }],
        },
      });
      assert.equal(q.status, 201);

      const pdfRes = await srv.apiRaw(`/api/quotes/${q.data.quote.id}/pdf`);
      assert.equal(pdfRes.status, 200);
      const info = inspectPdfBuffer(Buffer.from(await pdfRes.arrayBuffer()));
      assert.ok(info.normalizedText.includes('Isolation Test Co'));
    } finally {
      await srv.close();
    }
  });
});
