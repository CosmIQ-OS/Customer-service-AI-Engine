-- 012_lead_notifications.sql
-- Links admin notifications to specific service_intakes rows so the dashboard can deep-link directly to new leads.

ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS intake_id INTEGER REFERENCES service_intakes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_intake
  ON admin_notifications(intake_id);
