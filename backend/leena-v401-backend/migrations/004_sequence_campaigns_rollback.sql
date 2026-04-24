-- =====================================================
-- Rollback: 004_sequence_campaigns_rollback.sql
-- Reverses migration 004_sequence_campaigns.sql
-- Drop order respects FK dependencies
--
-- Run: psql $DATABASE_INTERNAL_URL -f migrations/004_sequence_campaigns_rollback.sql
-- =====================================================

BEGIN;

-- Drop indexes on email_queue campaign columns first
DROP INDEX IF EXISTS idx_queue_campaign;

-- Remove campaign columns from email_queue
ALTER TABLE email_queue DROP COLUMN IF EXISTS email_event_id;
ALTER TABLE email_queue DROP COLUMN IF EXISTS campaign_recipient_id;
ALTER TABLE email_queue DROP COLUMN IF EXISTS campaign_step_id;
ALTER TABLE email_queue DROP COLUMN IF EXISTS campaign_id;

-- Drop tables in reverse FK dependency order
DROP TABLE IF EXISTS email_unsubscribes;
DROP TABLE IF EXISTS email_events;
DROP TABLE IF EXISTS campaign_recipients;
DROP TABLE IF EXISTS campaign_steps;
DROP TABLE IF EXISTS email_campaigns;

COMMIT;
