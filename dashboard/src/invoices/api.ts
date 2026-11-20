import { ApiError } from '../api';

export async function downloadInvoicePdf(id: number, invoiceNumber: string): Promise<void> {
  const response = await fetch(`/api/invoices/${id}/pdf?download=1`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body?.error ?? 'Could not download the invoice PDF.', body);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${invoiceNumber || `invoice-${id}`}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
