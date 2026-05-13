-- migrations/006_reactivation_closed_at.sql
-- Adds close/reopen tracking to expos for reactivation campaigns.
--
-- Additive change: existing rows are NULL (not closed). Safe online ALTER
-- on a 10-row table; lock duration measured in milliseconds.
--
-- Application-level rule: when reactivation_closed_at IS NOT NULL, the
-- View Campaigns UI flags the campaign as Closed, the Resend button is
-- disabled, and the campaign moves to the Past Campaigns section.
--
-- Run from Render Shell:
--   psql $DATABASE_INTERNAL_URL -f migrations/006_reactivation_closed_at.sql

ALTER TABLE expos
  ADD COLUMN IF NOT EXISTS reactivation_closed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivation_closed_by INTEGER NULL;

COMMENT ON COLUMN expos.reactivation_closed_at IS 'When the reactivation campaign was manually closed. NULL = not closed.';
COMMENT ON COLUMN expos.reactivation_closed_by IS 'organizer_id of the user who closed the campaign (soft reference, no FK constraint).';

-- Verification:
--   \d expos  -- should now show the two new columns
