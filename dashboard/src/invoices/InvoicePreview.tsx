import type { CustomerForm, InvoiceLine, InvoiceSettings } from './types';

export function formatMoney(paise: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(paise / 100);
  } catch {
    return `${currency} ${(paise / 100).toFixed(2)}`;
  }
}

export function InvoicePreview({ customer, settings, items, issueDate, dueDate, notes }: {
  customer: CustomerForm;
  settings: InvoiceSettings;
  items: InvoiceLine[];
  issueDate: string;
  dueDate: string;
  notes: string;
}) {
  const total = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPricePaise), 0);
  return (
    <article className="invoice-paper" aria-label="Live invoice preview">
      <header className="invoice-paper-head">
        <div>
          <span className="kicker">TAX INVOICE // DRAFT</span>
          <h2>{settings.companyName || 'YOUR COMPANY'}</h2>
          <p>{settings.address || 'Company address'}<br />{settings.taxNumber && `Tax ID: ${settings.taxNumber}`}</p>
        </div>
        {settings.logoUrl && <img src={settings.logoUrl} alt="Company logo" />}
      </header>
      <div className="invoice-preview-parties">
        <div><span className="kicker">BILL TO</span><strong>{customer.name || 'Select a customer'}</strong>
          <p>{customer.contactName}<br />{[customer.address1, customer.address2, customer.city, customer.state, customer.postalCode].filter(Boolean).join(', ')}<br />
            {customer.email}<br />{customer.phone}{customer.vatNumber && <><br />Tax ID: {customer.vatNumber}</>}</p>
        </div>
        <div className="invoice-preview-dates"><span><b>ISSUE</b>{issueDate || '—'}</span><span><b>DUE</b>{dueDate || '—'}</span></div>
      </div>
      <div className="table-wrap">
        <table><thead><tr><th>Service</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead>
          <tbody>{items.length ? items.map((item, index) => <tr key={index}>
            <td>{item.description || 'Untitled service'}</td><td className="num">{item.quantity}</td>
            <td className="num">{formatMoney(item.unitPricePaise, customer.currency)}</td>
            <td className="num">{formatMoney(Math.round(item.quantity * item.unitPricePaise), customer.currency)}</td>
          </tr>) : <tr><td colSpan={4} className="muted">No invoice items yet.</td></tr>}</tbody>
        </table>
      </div>
      <div className="invoice-grand-total"><span>TOTAL</span><strong>{formatMoney(total, customer.currency)}</strong></div>
      <section className="invoice-payment-preview">
        {settings.paymentInstructions && <p><b>Payment instructions</b><br />{settings.paymentInstructions}</p>}
        <p>{[settings.accountName && `Account: ${settings.accountName}`, settings.bankName && `Bank: ${settings.bankName}`,
          settings.accountNumber && `Account no.: ${settings.accountNumber}`, settings.routingNumber && `IFSC / routing: ${settings.routingNumber}`,
          settings.swiftCode && `SWIFT: ${settings.swiftCode}`, settings.upiId && `UPI: ${settings.upiId}`].filter(Boolean).join(' · ')}</p>
        {notes && <p><b>Notes</b><br />{notes}</p>}
        {settings.terms && <p className="small muted">{settings.terms}</p>}
      </section>
    </article>
  );
}
