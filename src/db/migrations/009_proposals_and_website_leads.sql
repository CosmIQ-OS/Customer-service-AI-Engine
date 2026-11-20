-- 009_proposals_and_website_leads.sql
-- Supports multi-service proposals, lead details, and terms & conditions on quotes

ALTER TABLE quotes ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_email TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS company_size TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT NOT NULL DEFAULT '';

ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
