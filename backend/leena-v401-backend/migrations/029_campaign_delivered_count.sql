-- ============================================================
-- Migration 029 — email_campaigns.delivered_count
-- Date: 2026-08-19
-- Module: Email Campaigns (funnel / results tab)
--
-- WHY
--   The campaign funnel needs a DELIVERED figure, i.e. how many emails were
--   actually handed to SendGrid, as opposed to how many were enqueued. The only
--   live source is COUNT(email_queue WHERE status='sent'), but that source is
--   TEMPORARY: email_worker.js checkCampaignCompletion() purges a campaign's sent
--   queue rows once the campaign completes —
--
--     DELETE FROM email_queue
--     WHERE campaign_id = $1 AND status = 'sent'
--       AND sent_at < NOW() - INTERVAL '1 hour'
--
--   (the purge exists to stop email_queue bloat: each row carries a full rendered
--   html_content, ~55K rows per step on a large campaign).
--
--   Measured on campaign 15, which completed 2026-08-18 18:23:
--       email_queue rows surviving ......  4
--       email_events 'sent' (unique) ....  5
--       email_campaigns.total_sent ...... 13   (5 + 4 + 4 across three steps)
--   The funnel would have reported 4 delivered against 5 opens — 125%.
--
--   So delivered must be SNAPSHOT before the purge. This column holds it.
--
-- BEHAVIOUR AFTER THIS MIGRATION
--   checkCampaignCompletion() writes delivered_count from the live queue count and
--   then purges, both in ONE transaction, so the two can never diverge.
--   Readers use COALESCE(delivered_count, <live count>):
--     - active campaign      -> delivered_count NULL, live count is accurate
--     - completed post-029   -> snapshot, accurate forever
--     - completed pre-029    -> NULL and already purged; readers must render
--                               "n/a (completed before tracking)", NOT a number
--
-- NO BACKFILL. Campaigns that completed before this migration have already lost
-- their queue rows; any value computed now would be wrong. NULL is the honest
-- answer and the application renders it as such.
--
-- Additive, nullable, no default, no index. Nothing reads it until the matching
-- application code ships. Safe to apply before or after the deploy.
--
-- APPLY (house rule: migration is written here, Suer runs it):
--   Dry run : sed 's/^COMMIT;$/ROLLBACK;/' migrations/029_campaign_delivered_count.sql | psql "$DATABASE_INTERNAL_URL"
--   Real run: psql "$DATABASE_INTERNAL_URL" -f migrations/029_campaign_delivered_count.sql
-- ============================================================

BEGIN;

ALTER TABLE email_campaigns
    ADD COLUMN IF NOT EXISTS delivered_count INTEGER NULL;

COMMENT ON COLUMN email_campaigns.delivered_count IS
    'Snapshot of COUNT(email_queue WHERE status=''sent'') taken at campaign completion, '
    'immediately before the sent-row purge. NULL while active (use the live count) and '
    'NULL for campaigns completed before migration 029 (render as unknown, not zero).';

-- ── Verification (prints on dry run; harmless on the real run) ──────────────
SELECT 'column exists' AS check,
       COUNT(*)::int   AS n
FROM information_schema.columns
WHERE table_name = 'email_campaigns' AND column_name = 'delivered_count';
-- Expect n = 1

SELECT 'campaign snapshot state' AS check,
       id,
       status,
       total_sent          AS enqueued,
       delivered_count     AS snapshot,
       (SELECT COUNT(*)::int FROM email_queue q
         WHERE q.campaign_id = c.id AND q.status = 'sent') AS live_queue_sent
FROM email_campaigns c
ORDER BY id;
-- Expect: delivered_count NULL everywhere immediately after this migration.
-- Campaign 15 (completed 18 Aug) shows live_queue_sent = 4 — already purged,
-- which is exactly why it must stay NULL and render as "n/a".

COMMIT;
