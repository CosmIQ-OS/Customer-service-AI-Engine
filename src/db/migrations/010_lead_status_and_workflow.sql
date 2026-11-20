-- 010_lead_status_and_workflow.sql
-- Expand service_intakes status lifecycle and exclude website lead submissions from live conversations

ALTER TABLE service_intakes DROP CONSTRAINT IF EXISTS service_intakes_status_check;

UPDATE service_intakes SET status = 'collected' WHERE status = 'complete';

ALTER TABLE service_intakes
  ADD CONSTRAINT service_intakes_status_check
  CHECK (status IN ('collecting', 'collected', 'quoted', 'deal_won', 'completed', 'complete'));

DELETE FROM conversations WHERE LOWER(channel) = 'website';
