import test from 'node:test';
import assert from 'node:assert/strict';
import { generateProposalPdf } from './proposal-pdf.js';

test('generateProposalPdf creates a valid PDF buffer', async () => {
  const pdfBuffer = await generateProposalPdf({
    quoteNumber: 'Q-2026-9999',
    date: '2026-11-20',
    validUntil: '2026-12-04',
    clientName: 'GreenTech Labs',
    clientCompany: 'GreenTech Labs Pvt Ltd',
    clientEmail: 'founder@greentech.io',
    clientPhone: '+919876543210',
    companySize: '10-20',
    channel: 'website',
    items: [
      {
        description: 'WhatsApp Agent Services',
        quantity: 1,
        unit: 'deployment',
        unitPricePaise: 5500000,
        lineTotalPaise: 5500000,
      },
      {
        description: 'Workflow Automation',
        quantity: 2,
        unit: 'flow',
        unitPricePaise: 2500000,
        lineTotalPaise: 5000000,
      },
    ],
    subtotalPaise: 10500000,
    marginPercent: 10,
    totalPaise: 11550000,
    termsAndConditions: '1. Standard 14-day validity.\n2. Payment terms 50/50.',
    notes: 'Custom deployment for WhatsApp and Slack integrations.',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer should be substantial');
  // Check PDF header signature '%PDF-'
  const header = pdfBuffer.subarray(0, 5).toString('ascii');
  assert.equal(header, '%PDF-');
});
