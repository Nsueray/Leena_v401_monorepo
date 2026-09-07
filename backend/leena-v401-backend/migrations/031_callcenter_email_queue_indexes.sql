-- Migration 031: partial indexes on email_queue for call-center Stage 3b
-- Per docs/sessions/CALLCENTER_DESIGN_20260907.md — this is the second and
-- final schema-adjacent change the call-center module needs (after 030's
-- new callcenter_leads table). No existing table shape changes; two new
-- partial indexes only.
--
-- Why: /api/callcenter/next enriches each lead with its latest mail status
-- from email_queue. Without these indexes the WHERE recipient_email=$1
-- predicate does a Seq Scan (email_queue has ~400k-1M rows in SIEMA
-- lifetime). One agent's Next click already touches ~30 rows per lead
-- (email_events + email_queue + expos lookup); a Seq Scan on the biggest
-- table would make each Next take 1-3 s.
--
-- With the indexes:
--   idx_queue_campaign_email       — for A/C leads (has campaign_id)
--   idx_queue_expo_email_txn       — for B leads (transactional badge mail)
-- Both are partial (bounded by IS NULL / IS NOT NULL on campaign_id) so
-- their maintenance cost is tiny — INSERTs into the wrong partition don't
-- touch the index.
--
-- ⚠️ CONCURRENTLY: these must NOT run inside a transaction. Apply via:
--   psql "$DATABASE_INTERNAL_URL" -a -f migrations/031_callcenter_email_queue_indexes.sql
--
--   (psql without -1 / --single-transaction runs each statement in its
--    own implicit transaction — CONCURRENTLY works.)
--
-- Idempotent: IF NOT EXISTS. Safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_campaign_email
  ON email_queue (campaign_id, lower(recipient_email))
  WHERE campaign_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_expo_email_txn
  ON email_queue (expo_id, lower(recipient_email))
  WHERE campaign_id IS NULL;

-- Verify
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'email_queue'
ORDER BY indexname;

-- Expect 4 indexes total:
--   email_queue_pkey                    (existing)
--   idx_queue_campaign                  (existing, partial on campaign_id NOT NULL)
--   idx_queue_campaign_email            (NEW — this migration)
--   idx_queue_expo_email_txn            (NEW — this migration)
