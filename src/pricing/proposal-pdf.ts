import PDFDocument from 'pdfkit';

export interface ProposalPdfData {
  quoteNumber: string;
  date: string;
  validUntil?: string;
  status?: string;
  clientName: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  companySize?: string;
  channel?: string;
  items: Array<{
    itemCode?: string;
    description: string;
    unit?: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  subtotalPaise: number;
  marginPercent?: number;
  totalPaise: number;
  termsAndConditions?: string;
  notes?: string;
}

function formatInr(paise: number): string {
  const inr = paise / 100;
  return 'INR ' + new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(inr);
}

function formatInvoiceStatusLabel(status?: string): string {
  if (status === 'paid') return 'PAID INVOICE';
  if (status === 'pending') return 'PENDING';
  return (status || 'PENDING').toUpperCase();
}

export function generateProposalPdf(data: ProposalPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `CosmIQ OS Invoice - ${data.quoteNumber}`,
          Author: 'CosmIQ OS Customer Service AI Engine',
          Subject: `Invoice for ${data.clientCompany || data.clientName}`,
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Brand Accent Top Bar
      doc.rect(0, 0, 595.28, 8).fill('#ff5a1f');

      // Header
      doc.fillColor('#181715').fontSize(22).font('Helvetica-Bold').text('COSMIQ OS', 50, 40);
      doc.fillColor('#57524a').fontSize(9).font('Helvetica').text('AI NATIVE AUTOMATION & SYSTEM SOLUTIONS', 50, 66);
      doc.fillColor('#8f8a80').fontSize(8).text('Website: cosmiqos.com  |  Support: ops@cosmiqos.com', 50, 78);

      // Document Badge & Info on Right
      doc.fillColor('#ff5a1f').fontSize(16).font('Helvetica-Bold').text('INVOICE', 360, 40, { align: 'right', width: 185 });
      doc.fillColor('#181715').fontSize(10).font('Helvetica-Bold').text(`REF: ${data.quoteNumber}`, 360, 62, { align: 'right', width: 185 });
      doc.fillColor('#57524a').fontSize(8).font('Helvetica').text(`Date: ${data.date}`, 360, 76, { align: 'right', width: 185 });
      doc.text(`Status: ${formatInvoiceStatusLabel(data.status)}`, 360, 88, { align: 'right', width: 185 });
      if (data.validUntil) {
        doc.text(`Valid Until: ${data.validUntil}`, 360, 100, { align: 'right', width: 185 });
      }

      // Divider line
      doc.strokeColor('#d8d2c4').lineWidth(1).moveTo(50, 114).lineTo(545.28, 114).stroke();

      // Client Information Section
      let curY = 128;
      doc.fillColor('#ff5a1f').fontSize(8).font('Helvetica-Bold').text('INVOICE PREPARED FOR:', 50, curY);
      doc.text('BILLING CONTEXT:', 320, curY);

      curY += 14;
      doc.fillColor('#181715').fontSize(13).font('Helvetica-Bold').text(data.clientCompany || data.clientName || 'Valued Client', 50, curY);
      doc.fillColor('#181715').fontSize(10).font('Helvetica-Bold').text(`Channel: ${(data.channel || 'Direct').toUpperCase()}`, 320, curY);

      curY += 16;
      doc.fillColor('#57524a').fontSize(9).font('Helvetica');
      if (data.clientCompany && data.clientName && data.clientCompany !== data.clientName) {
        doc.text(`Attention: ${data.clientName}`, 50, curY);
        curY += 13;
      }
      if (data.clientEmail) {
        doc.text(`Email: ${data.clientEmail}`, 50, curY);
        curY += 13;
      }
      if (data.clientPhone) {
        doc.text(`Phone / ID: ${data.clientPhone}`, 50, curY);
        curY += 13;
      }

      if (data.companySize) {
        doc.text(`Company Size Tier: ${data.companySize} employees`, 320, 158);
      }

      curY = Math.max(curY + 15, 202);

      // Section Title: Services & Invoice Summary
      doc.fillColor('#181715').fontSize(11).font('Helvetica-Bold').text('INVOICED SERVICES & INVESTMENT SUMMARY', 50, curY);
      curY += 18;

      // Table Header
      doc.rect(50, curY, 495.28, 22).fill('#f4f1ea');
      doc.fillColor('#181715').fontSize(8).font('Helvetica-Bold');
      doc.text('#', 60, curY + 6);
      doc.text('SERVICE / DELIVERABLE', 85, curY + 6);
      doc.text('QTY / UNIT', 310, curY + 6, { width: 65, align: 'center' });
      doc.text('UNIT PRICE', 385, curY + 6, { width: 75, align: 'right' });
      doc.text('TOTAL', 465, curY + 6, { width: 70, align: 'right' });

      curY += 22;
      doc.strokeColor('#d8d2c4').lineWidth(0.5);

      // Table Rows
      data.items.forEach((item, index) => {
        const rowHeight = 26;
        if (index % 2 === 1) {
          doc.rect(50, curY, 495.28, rowHeight).fill('#faf8f5');
        }

        doc.fillColor('#57524a').fontSize(8).font('Helvetica').text(String(index + 1), 60, curY + 8);
        doc.fillColor('#181715').fontSize(8.5).font('Helvetica-Bold').text(item.description, 85, curY + 8, { width: 220 });
        doc.fillColor('#57524a').fontSize(8).font('Helvetica').text(`${item.quantity} ${item.unit || 'unit'}`, 310, curY + 8, { width: 65, align: 'center' });
        doc.text(formatInr(item.unitPricePaise), 385, curY + 8, { width: 75, align: 'right' });
        doc.fillColor('#181715').fontSize(8.5).font('Helvetica-Bold').text(formatInr(item.lineTotalPaise), 465, curY + 8, { width: 70, align: 'right' });

        curY += rowHeight;
        doc.moveTo(50, curY).lineTo(545.28, curY).stroke();
      });

      // Totals Box
      curY += 10;
      const totalBoxX = 350;
      const totalBoxW = 195.28;

      doc.fillColor('#57524a').fontSize(9).font('Helvetica').text('Subtotal:', totalBoxX, curY);
      doc.fillColor('#181715').font('Helvetica-Bold').text(formatInr(data.subtotalPaise), totalBoxX, curY, { width: totalBoxW, align: 'right' });
      curY += 16;

      // Grand Total Highlight
      doc.rect(totalBoxX - 10, curY - 4, totalBoxW + 10, 26).fill('#181715');
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('INVOICE TOTAL:', totalBoxX, curY + 3);
      doc.fillColor('#ff5a1f').fontSize(11).font('Helvetica-Bold').text(formatInr(data.totalPaise), totalBoxX, curY + 3, { width: totalBoxW - 5, align: 'right' });
      curY += 36;

      // Notes
      if (data.notes) {
        doc.fillColor('#181715').fontSize(9).font('Helvetica-Bold').text('INVOICE NOTES:', 50, curY);
        curY += 12;
        doc.fillColor('#57524a').fontSize(8).font('Helvetica').text(data.notes, 50, curY, { width: 495.28 });
        curY += 24;
      }

      // Check if space is left for Terms & Conditions or add page
      if (curY > 580) {
        doc.addPage();
        curY = 50;
      }

      // Terms & Conditions
      if (data.termsAndConditions) {
        doc.fillColor('#181715').fontSize(9.5).font('Helvetica-Bold').text('TERMS & CONDITIONS', 50, curY);
        curY += 14;
        doc.fillColor('#57524a').fontSize(7.5).font('Helvetica').text(data.termsAndConditions, 50, curY, {
          width: 495.28,
          lineGap: 3,
        });
        curY += doc.heightOfString(data.termsAndConditions, { width: 495.28, lineGap: 3 }) + 20;
      }

      if (curY > 670) {
        doc.addPage();
        curY = 50;
      }

      // Sign-off section
      curY += 10;
      doc.strokeColor('#d8d2c4').lineWidth(0.5).moveTo(50, curY).lineTo(545.28, curY).stroke();
      curY += 16;

      // Left: CosmIQ OS Sign-off
      doc.fillColor('#181715').fontSize(8.5).font('Helvetica-Bold').text('ISSUED & AUTHORIZED BY:', 50, curY);
      doc.fillColor('#57524a').fontSize(8).font('Helvetica').text('CosmIQ OS Solutions Delivery', 50, curY + 14);
      doc.text('Date: ' + data.date, 50, curY + 26);

      // Right: Client Acceptance
      doc.fillColor('#181715').fontSize(8.5).font('Helvetica-Bold').text('ACCEPTED & CONFIRMED BY:', 320, curY);
      doc.strokeColor('#8f8a80').lineWidth(0.5).moveTo(320, curY + 36).lineTo(520, curY + 36).stroke();
      doc.fillColor('#8f8a80').fontSize(7.5).font('Helvetica').text('Authorized Client Signature & Date', 320, curY + 40);

      // Footer
      doc.fillColor('#b8b3a8').fontSize(7).text('CosmIQ OS Customer Service AI Engine — Confidential Commercial Invoice', 50, 790, { align: 'center', width: 495.28 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
