export type InvoiceStatus = 'pending' | 'sent' | 'paid' | 'discarded';

export interface CustomerForm {
  id?: number | null;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  vatNumber: string;
  currency: string;
}

export interface InvoiceLine {
  quoteItemId?: number | null;
  description: string;
  quantity: number;
  unitPricePaise: number;
}

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

export interface Invoice {
  id: number;
  ninja_invoice_id: string | null;
  customer_id: number;
  intake_id: number | null;
  quote_id: number | null;
  customer_name: string;
  lead_company_name: string | null;
  quote_number: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  remote_status: string;
  currency: string;
  total_paise: number;
  balance_paise: number;
  issue_date: string;
  due_date: string;
  notes: string;
  sync_error: string;
  sent_at: string | null;
  paid_at: string | null;
}

export interface StoredLine {
  id: number;
  description: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface InvoiceDetail {
  invoice: Invoice;
  items: StoredLine[];
  customer: {
    id: number; name: string; contact_name: string; email: string; phone: string;
    address1: string; address2: string; city: string; state: string; postal_code: string;
    country_code: string; vat_number: string; currency: string;
  };
}

export interface LeadOption {
  id: number;
  company_name: string;
  external_user_id: string;
  service_name: string;
  status: string;
  customer_id?: number | null;
}

export interface CustomerOption {
  id: number;
  name: string;
  contact_name: string;
  email: string;
}

export interface ComposedInvoice {
  customer: CustomerForm;
  quote: { id: number; quote_number: string; status: string } | null;
  items: InvoiceLine[];
  settings: InvoiceSettings;
}
