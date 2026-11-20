ALTER TABLE services
  ADD COLUMN IF NOT EXISTS base_price_paise BIGINT NOT NULL DEFAULT 0 CHECK (base_price_paise >= 0);

-- One-time backfill for pre-existing seeded CosmIQ/starter services currently at 0.
-- Runs once per database (tracked in schema_migrations), so later admin edits are never overwritten.
UPDATE services SET base_price_paise = 4000000 WHERE base_price_paise = 0 AND name = 'Company Internal Operations Automation';
UPDATE services SET base_price_paise = 7500000 WHERE base_price_paise = 0 AND name = 'AI Native Internal System';
UPDATE services SET base_price_paise = 5000000 WHERE base_price_paise = 0 AND name = 'Workflow Automation';
UPDATE services SET base_price_paise = 5500000 WHERE base_price_paise = 0 AND name = 'WhatsApp Agent Services';
UPDATE services SET base_price_paise = 1500000 WHERE base_price_paise = 0 AND name = 'Live Chat Support';
UPDATE services SET base_price_paise = 1000000 WHERE base_price_paise = 0 AND name = 'Billing Assistance';
UPDATE services SET base_price_paise = 2000000 WHERE base_price_paise = 0 AND name = 'API Integration Support';
