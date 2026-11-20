import test from 'node:test';
import assert from 'node:assert/strict';
import { generateProposalPdf } from './proposal-pdf.js';
import { generateContractProposalPdf } from './contract-proposal-pdf.js';

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
    marginPercent: 0,
    status: 'paid',
    totalPaise: 10500000,
    termsAndConditions: '1. Standard 14-day validity.\n2. Payment terms 50/50.',
    notes: 'Custom deployment for WhatsApp and Slack integrations.',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer should be substantial');
  // Check PDF header signature '%PDF-'
  const header = pdfBuffer.subarray(0, 5).toString('ascii');
  assert.equal(header, '%PDF-');
});

test('generateContractProposalPdf creates a valid contract PDF with optional sections and PNG signature', async () => {
  const samplePngSignature =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const pdfBuffer = await generateContractProposalPdf({
    id: 1,
    proposal_number: 'PROP-2026-0001',
    intake_id: null,
    session_id: null,
    channel: 'website',
    our_company_name: 'Cosmiq OS',
    our_company_details: 'AI Native Automation & System Solutions',
    client_company: 'FQLab and Research Centre Pvt Ltd',
    client_name: 'Dr. Anand',
    client_email: 'anand@fqlabs.in',
    client_phone: '+919876543210',
    client_designation: 'Director',
    proposal_date: '2026-11-20',
    scope_of_project: 'Design and build an AI-driven automation platform.',
    phases_and_timeline: '60 days from access date followed by 4-week pilot.',
    payment_schedules: 'Rs. 15,000 upfront, Rs. 15,000 at week 2 of pilot.',
    success_metrics: '',
    ongoing_cost: '',
    support_and_warranty: 'Full pilot support and maintenance included.',
    data_privacy: 'Strict data isolation and confidentiality.',
    include_signing: true,
    signer_name: 'Rinshid VP',
    signer_designation: 'Co-Founder',
    signer_signature_data: samplePngSignature,
    client_signature_data: '',
    status: 'pending',
    created_by: 'admin',
    created_at: '2026-11-20 10:00:00',
    updated_at: '2026-11-20 10:00:00',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000, 'Contract proposal PDF buffer should be substantial');
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
});
