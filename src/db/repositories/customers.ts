import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';

export interface CustomerRecord {
  id: number;
  ninja_client_id: string | null;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  vat_number: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  vatNumber?: string;
  currency?: string;
}

function map(row: CustomerRecord): CustomerRecord {
  return { ...row, id: Number(row.id) };
}

export async function getCustomer(db: DBExecutor, id: number): Promise<CustomerRecord | undefined> {
  const row = await db.queryOne<CustomerRecord>('SELECT * FROM customers WHERE id = $1', [id]);
  return row ? map(row) : undefined;
}

export async function listCustomers(db: DBExecutor, query = '', limit = 50): Promise<CustomerRecord[]> {
  const like = `%${query.trim()}%`;
  const { rows } = await db.query<CustomerRecord>(
    `SELECT * FROM customers
     WHERE $1 = '%%' OR name ILIKE $1 OR contact_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1
     ORDER BY updated_at DESC, id DESC LIMIT $2`,
    [like, limit],
  );
  return rows.map(map);
}

export async function createCustomer(db: DBExecutor, input: CustomerInput): Promise<CustomerRecord> {
  const row = await db.queryOne<CustomerRecord>(
    `INSERT INTO customers
      (name, contact_name, email, phone, address1, address2, city, state, postal_code,
       country_code, vat_number, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    customerValues(input),
  );
  return map(row!);
}

export async function updateCustomer(db: DBExecutor, id: number, input: CustomerInput): Promise<CustomerRecord> {
  const row = await db.queryOne<CustomerRecord>(
    `UPDATE customers SET
      name = $2, contact_name = $3, email = $4, phone = $5, address1 = $6, address2 = $7,
      city = $8, state = $9, postal_code = $10, country_code = $11, vat_number = $12,
      currency = $13, updated_at = ${UTC_NOW_SQL}
     WHERE id = $1 RETURNING *`,
    [id, ...customerValues(input)],
  );
  if (!row) throw new Error('Customer not found.');
  return map(row);
}

export async function setCustomerNinjaId(db: DBExecutor, id: number, ninjaClientId: string): Promise<CustomerRecord> {
  const row = await db.queryOne<CustomerRecord>(
    `UPDATE customers SET ninja_client_id = $2, updated_at = ${UTC_NOW_SQL} WHERE id = $1 RETURNING *`,
    [id, ninjaClientId],
  );
  return map(row!);
}

export async function linkIntakeCustomer(db: DB, intakeId: number, customerId: number): Promise<void> {
  await db.query(
    `UPDATE service_intakes SET customer_id = $2, updated_at = ${UTC_NOW_SQL} WHERE id = $1 AND customer_id IS NULL`,
    [intakeId, customerId],
  );
}

function customerValues(input: CustomerInput): unknown[] {
  return [
    input.name.trim(), input.contactName?.trim() ?? '', input.email?.trim() ?? '', input.phone?.trim() ?? '',
    input.address1?.trim() ?? '', input.address2?.trim() ?? '', input.city?.trim() ?? '', input.state?.trim() ?? '',
    input.postalCode?.trim() ?? '', input.countryCode?.trim().toUpperCase() || 'IN', input.vatNumber?.trim() ?? '',
    input.currency?.trim().toUpperCase() || 'INR',
  ];
}
