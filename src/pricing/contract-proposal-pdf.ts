import PDFDocument from 'pdfkit';
import type { ContractProposalRecord } from '../db/repositories/contract-proposals.js';

function decodeSignatureImage(dataUrl: string): Buffer | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buf = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function formatProposalDate(rawDate: string): string {
  const trimmed = (rawDate || '').trim();
  if (!trimmed) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  return trimmed;
}

export function generateContractProposalPdf(proposal: ContractProposalRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const margin = 60;
      const doc = new PDFDocument({
        margin,
        size: 'A4',
        info: {
          Title: `Business Proposal - ${proposal.proposal_number}`,
          Author: proposal.our_company_name || 'Cosmiq OS',
          Subject: `Business Proposal for ${proposal.client_company || proposal.client_name || 'Client'}`,
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const pageWidth = doc.page.width - margin * 2;
      const ourCompany = (proposal.our_company_name || 'Cosmiq OS').trim();
      const clientCompany = (proposal.client_company || proposal.client_name || 'Client Company').trim();
      const formattedDate = formatProposalDate(proposal.proposal_date || proposal.created_at);

      // Header Block matching Business Proposal style
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(20).text('Business Proposal', margin, 56);
      doc.font('Helvetica').fontSize(11).fillColor('#111111');

      let y = 92;
      doc.text(`From: ${ourCompany}`, margin, y);
      y += 18;

      if (proposal.our_company_details?.trim()) {
        doc.fontSize(9.5).fillColor('#4a4a4a').text(proposal.our_company_details.trim(), margin, y, {
          width: pageWidth,
          lineGap: 2,
        });
        y = doc.y + 8;
      }

      doc.fontSize(11).fillColor('#111111');
      const toY = y;
      doc.font('Helvetica-Bold').text('To: ', margin, toY, { continued: true });
      doc.font('Helvetica').text(clientCompany, { width: pageWidth - 150 });
      const afterToY = doc.y;

      doc.font('Helvetica-Bold').text('Date: ', margin + pageWidth - 140, toY, { continued: true });
      doc.font('Helvetica').text(formattedDate);

      y = Math.max(afterToY, doc.y) + 6;

      const clientMetaParts = [
        proposal.client_name && proposal.client_name !== clientCompany ? `Attn: ${proposal.client_name}` : '',
        proposal.client_email ? `Email: ${proposal.client_email}` : '',
        proposal.client_phone ? `Contact: ${proposal.client_phone}` : '',
      ].filter(Boolean);

      if (clientMetaParts.length > 0) {
        doc.fontSize(9.5).fillColor('#4a4a4a').text(clientMetaParts.join('   |   '), margin, y, {
          width: pageWidth,
        });
        y = doc.y + 8;
      }

      y += 6;
      doc.strokeColor('#d8d2c4').lineWidth(0.75).moveTo(margin, y).lineTo(margin + pageWidth, y).stroke();
      doc.y = y + 18;

      const sections = [
        { title: 'Scope of Project', body: proposal.scope_of_project },
        { title: 'Phases and Timeline', body: proposal.phases_and_timeline },
        { title: 'Payment Schedules', body: proposal.payment_schedules },
        { title: 'Success Metrics', body: proposal.success_metrics },
        { title: 'Ongoing Cost', body: proposal.ongoing_cost },
        { title: 'Support and Warranty', body: proposal.support_and_warranty },
        { title: 'Data Privacy', body: proposal.data_privacy },
      ];

      let sectionNumber = 1;
      for (const section of sections) {
        const text = (section.body || '').trim();
        if (!text) continue;

        if (doc.y > doc.page.height - 130) {
          doc.addPage();
        }

        doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12.5).text(`${sectionNumber}. ${section.title}`, margin, doc.y, {
          width: pageWidth,
        });
        doc.y += 5;

        doc.fillColor('#222222').font('Helvetica').fontSize(10.5).text(text, margin, doc.y, {
          width: pageWidth,
          lineGap: 3.5,
        });
        doc.y += 14;
        sectionNumber += 1;
      }

      // Optional Signing Section
      if (proposal.include_signing) {
        if (doc.y > doc.page.height - 250) {
          doc.addPage();
        }

        doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12.5).text(
          `${sectionNumber}. Acceptance and Signatures`,
          margin,
          doc.y,
          { width: pageWidth },
        );
        doc.y += 6;

        doc.fillColor('#222222').font('Helvetica').fontSize(10.5).text(
          'By signing below, the parties confirm their acceptance and agreement to the terms set out in this Business Proposal.',
          margin,
          doc.y,
          { width: pageWidth, lineGap: 3 },
        );
        doc.y += 16;

        const renderPartyBlock = (opts: {
          heading: string;
          name: string;
          designation: string;
          date: string;
          signatureData?: string;
        }) => {
          if (doc.y > doc.page.height - 150) {
            doc.addPage();
          }

          doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text(opts.heading, margin, doc.y);
          doc.y += 6;

          const sigBuf = opts.signatureData ? decodeSignatureImage(opts.signatureData) : null;
          if (sigBuf) {
            try {
              doc.image(sigBuf, margin + 70, doc.y, { fit: [130, 38] });
              doc.y += 32;
            } catch {
              // Fall back cleanly to signature line if image buffer cannot be parsed
            }
          }

          doc.fillColor('#222222').font('Helvetica').fontSize(10.5);
          doc.text('Signature: ______________________________');
          doc.y += 4;
          doc.text(`Name: ${opts.name?.trim() || '______________________________'}`);
          doc.y += 4;
          doc.text(`Designation: ${opts.designation?.trim() || '______________________________'}`);
          doc.y += 4;
          doc.text(`Date: ${opts.date?.trim() || '______________________________'}`);
          doc.y += 16;
        };

        // Customer / Lead Sign-off
        renderPartyBlock({
          heading: `For ${clientCompany}`,
          name: proposal.client_name || '',
          designation: proposal.client_designation || 'Director',
          date: '',
          signatureData: proposal.client_signature_data,
        });

        // Our Company Sign-off
        renderPartyBlock({
          heading: `For ${ourCompany}`,
          name: proposal.signer_name || '',
          designation: proposal.signer_designation || 'Co-Founder',
          date: formattedDate,
          signatureData: proposal.signer_signature_data,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
