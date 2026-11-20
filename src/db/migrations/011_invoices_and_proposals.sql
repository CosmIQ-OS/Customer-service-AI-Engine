-- 011_invoices_and_proposals.sql
-- Adds lead email & contact_person columns on service_intakes,
-- supports invoice statuses ('pending', 'paid') on quotes,
-- and creates contract_proposals table for standalone business proposals.

ALTER TABLE service_intakes ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE service_intakes ADD COLUMN IF NOT EXISTS contact_person TEXT NOT NULL DEFAULT '';

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'expired', 'superseded', 'pending', 'paid'));

CREATE TABLE IF NOT EXISTS contract_proposals (
  id SERIAL PRIMARY KEY,
  proposal_number TEXT NOT NULL UNIQUE,
  intake_id INTEGER REFERENCES service_intakes(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'direct',
  our_company_name TEXT NOT NULL DEFAULT 'Cosmiq OS',
  our_company_details TEXT NOT NULL DEFAULT '',
  client_company TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  client_designation TEXT NOT NULL DEFAULT 'Director',
  proposal_date TEXT NOT NULL DEFAULT '',
  scope_of_project TEXT NOT NULL DEFAULT '',
  phases_and_timeline TEXT NOT NULL DEFAULT '',
  payment_schedules TEXT NOT NULL DEFAULT '',
  success_metrics TEXT NOT NULL DEFAULT '',
  ongoing_cost TEXT NOT NULL DEFAULT '',
  support_and_warranty TEXT NOT NULL DEFAULT '',
  data_privacy TEXT NOT NULL DEFAULT '',
  include_signing BOOLEAN NOT NULL DEFAULT TRUE,
  signer_name TEXT NOT NULL DEFAULT '',
  signer_designation TEXT NOT NULL DEFAULT 'Co-Founder',
  signer_signature_data TEXT NOT NULL DEFAULT '',
  client_signature_data TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('sent', 'pending', 'accepted', 'rejected')),
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_contract_proposals_created ON contract_proposals(created_at DESC, id DESC);
