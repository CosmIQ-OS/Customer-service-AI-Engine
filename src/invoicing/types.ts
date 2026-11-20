import type { CustomerRecord } from '../db/repositories/customers.js';

export interface InvoiceSettings {
  configured: boolean;
  companyName: string;
  address: string;
  taxNumber: string;
  logoUrl: string;
  currency: string;
  defaultDueDays: number;
  paymentInstructions: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  swiftCode: string;
  upiId: string;
  terms: string;
}

export interface RemoteInvoice {
  id: string;
  number: string;
  status: string;
  totalPaise: number;
  balancePaise: number;
  currency: string;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  archivedAt: string | null;
}

export interface RemoteInvoiceInput {
  clientId: string;
  reference: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  items: Array<{ description: string; quantity: number; unitPricePaise: number }>;
}

export interface NinjaPdf {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}

export interface InvoiceNinjaGateway {
  readonly configured: boolean;
  createClient(customer: CustomerRecord): Promise<{ id: string }>;
  updateClient(customer: CustomerRecord): Promise<void>;
  createInvoice(input: RemoteInvoiceInput): Promise<RemoteInvoice>;
  getInvoice(id: string): Promise<RemoteInvoice>;
  sendInvoice(id: string): Promise<void>;
  voidInvoice(id: string): Promise<void>;
  archiveInvoice(id: string): Promise<void>;
  downloadInvoice(id: string, number: string): Promise<NinjaPdf>;
  getSettings(): Promise<InvoiceSettings>;
  updateSettings(settings: InvoiceSettings): Promise<InvoiceSettings>;
}
