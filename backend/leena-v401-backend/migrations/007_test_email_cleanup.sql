-- migrations/007_test_email_cleanup.sql
-- Pre-fair cleanup of 5 internal test email addresses from all expos.
-- Date: 14 May 2026
-- Fair: Mega Clima Nigeria 2026 (expo_id=7), 19-21 May 2026
--
-- Why: These 5 addresses belong to Suer/Yaprak/Elan internal accounts that
-- accumulated test registrations across multiple expos over the past year.
-- Their presence inflates Mega Clima Nigeria reports and risks them being
-- counted as real attendees during fair-day metrics. Removing them now
-- gives clean baseline counts for 19-21 May.
--
-- Target emails:
--   yaprakguzelcik@gmail.com   — 27 visitor rows across expos 1, 3, 5, 7, 9, 10
--   suer@elan-expo.com         — 3 visitor rows (expos 3, 5, 7)
--   elan02@elan-expo.com       — 7 visitor rows (expos 3, 5, 6, 7, 8, 9, 10)
--   info@siemamaroc.com        — 4 visitor rows (expos 3, 5, 7, 9)
--   info@moroccofoodexpo.com   — 4 visitor rows (expos 3, 5, 6, 7)
--
-- Expected row counts (live SELECT on 14 May 2026, post-32k-drain):
--   visitors                                  46 rows  (direct)
--   checkins                                  26 rows  (CASCADE)
--   conference_certificates                    7 rows  (manual pre-clean — RESTRICT FK)
--   email_logs       by visitor_id            116 rows (CASCADE)
--   email_logs       by email text orphans     52 rows (manual — no FK)
--   email_queue      by visitor_id             47 rows (CASCADE)
--   email_queue      by campaign_recipient_id   5 rows  (manual pre-clean — RESTRICT FK, see FIX 14 May)
--   email_queue      by recipient_email        46 rows (manual — no FK)
--   exhibitor_leads                            1 row   (manual pre-clean — RESTRICT FK)
--   visitor_event_status                      28 rows (manual — no FK to visitors)
--   reactivation_tokens by new_visitor_id      1 row   (manual pre-clean — RESTRICT FK)
--   reactivation_tokens by email text          1 row   (manual — email-only link)
--   campaign_recipients                        3 rows  (manual pre-clean — RESTRICT FK)
--   email_events                              10 rows (CASCADE via campaign_recipients delete)
--   ─────────────────────────────────────────────────
--   Total                                    ~389 rows across 10 tables
--
-- FIX 14 May 2026 (post dry-run): added email_queue cleanup by
-- campaign_recipient_id BEFORE campaign_recipients delete (new STEP 1).
-- Original migration failed dry-run because email_queue has an FK
-- (email_queue_campaign_recipient_id_fkey) pointing to campaign_recipients
-- WITHOUT ON DELETE — the initial FK audit only checked FKs pointing TO
-- visitors.id and missed inbound FKs on the intermediate tables.
-- Verified: campaign_recipients is the ONLY intermediate table with a
-- non-CASCADE inbound FK. All other steps (conference_certificates,
-- exhibitor_leads, reactivation_tokens, visitor_event_status, email_queue,
-- email_logs) have zero inbound FKs and remain safe to delete in their
-- original positions.
--
-- Live numbers may drift by a handful of rows between dry-run and execute as
-- Yaprak's activation-link clicks may still produce new check-in / event_status
-- writes for these emails between now and Suer's Render Shell run.
--
-- Backup: visitors_test_backup_20260514
--   Full row snapshot of visitors before delete. Drop AFTER the fair ends
--   (post 21 May 2026) — see todo.md post-fair backlog.
--
-- Rollback strategy:
--   If anything looks wrong AFTER COMMIT:
--     INSERT INTO visitors SELECT * FROM visitors_test_backup_20260514
--     WHERE id NOT IN (SELECT id FROM visitors);
--   This restores the visitor rows only. Related FK-cascaded rows are NOT
--   recoverable from this script — restore from Render DB point-in-time
--   backup if cascaded data also needs recovery.
--
-- Run from Render Shell:
--   psql $DATABASE_INTERNAL_URL -f migrations/007_test_email_cleanup.sql
--
-- ────────────────────────────────────────────────────────────────────
-- First cleanup-pattern migration in this repo. Migrations 001-006 are
-- schema-only; this one is data-only. Wrapped in a single transaction
-- so any failure (FK violation, permission issue, typo) rolls back the
-- whole batch — partial state is impossible.
-- ────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- Target email list — defined once as a temp table for readability.
-- Scope is the current transaction (auto-drops on COMMIT/ROLLBACK).
-- ─────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _cleanup_targets (email TEXT PRIMARY KEY) ON COMMIT DROP;

INSERT INTO _cleanup_targets (email) VALUES
  ('yaprakguzelcik@gmail.com'),
  ('suer@elan-expo.com'),
  ('elan02@elan-expo.com'),
  ('info@siemamaroc.com'),
  ('info@moroccofoodexpo.com');

-- Sanity check: confirm 5 target emails loaded.
SELECT COUNT(*) AS target_emails_loaded FROM _cleanup_targets;

-- ─────────────────────────────────────────────────────────────────────
-- BACKUP — snapshot visitor rows before any deletion.
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS visitors_test_backup_20260514;

CREATE TABLE visitors_test_backup_20260514 AS
SELECT * FROM visitors
WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets);

-- Confirm backup row count (expected: 46).
SELECT COUNT(*) AS backed_up_visitor_rows FROM visitors_test_backup_20260514;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — email_queue rows linked to doomed campaign_recipients (NEW)
-- Added 14 May 2026 after dry-run revealed email_queue.campaign_recipient_id
-- is a RESTRICT FK to campaign_recipients(id). Must clean these BEFORE
-- the campaign_recipients delete in STEP 2.
-- Expected: 5 rows.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM email_queue
WHERE campaign_recipient_id IN (
  SELECT id FROM campaign_recipients
  WHERE visitor_id IN (
    SELECT id FROM visitors
    WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
  )
);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — campaign_recipients (RESTRICT FK on visitor_id)
-- Expected: 3 rows (one each for yaprak/elan02/siemamaroc, all expo 9).
-- CASCADE auto-cleans 10 email_events rows (email_events.recipient_id
-- has ON DELETE CASCADE pointing at campaign_recipients).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM campaign_recipients
WHERE visitor_id IN (
  SELECT id FROM visitors
  WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — conference_certificates (RESTRICT FK on visitor_id)
-- Expected: 7 rows (yaprak 42427 x3, elan02 42429 x1, suer 46075 x3).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM conference_certificates
WHERE visitor_id IN (
  SELECT id FROM visitors
  WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 4 — exhibitor_leads (RESTRICT FK on BOTH directions)
-- Expected: 1 row (suer 37896 as exhibitor or lead — direction unknown).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM exhibitor_leads
WHERE lead_visitor_id IN (
        SELECT id FROM visitors
        WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
      )
   OR exhibitor_visitor_id IN (
        SELECT id FROM visitors
        WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
      );

-- ─────────────────────────────────────────────────────────────────────
-- STEP 5 — reactivation_tokens
-- 5a. By new_visitor_id (RESTRICT FK)   — expected: 1 row (info@morocco 37814)
-- 5b. By email text (no FK, but logical link) — expected: 1 row
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM reactivation_tokens
WHERE new_visitor_id IN (
  SELECT id FROM visitors
  WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
);

DELETE FROM reactivation_tokens
WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 6 — visitor_event_status (NO FK to visitors)
-- These rows would otherwise become orphans after visitor delete.
-- Expected: 28 rows.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM visitor_event_status
WHERE visitor_id IN (
  SELECT id FROM visitors
  WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets)
);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 7 — email_queue text-only orphans (visitor_id NULL rows)
-- Rows linked to target emails only via recipient_email column.
-- Note: rows WITH visitor_id are CASCADE-cleaned by Step 9 (visitors delete).
-- Note: rows linked to doomed campaign_recipients are cleaned in STEP 1.
-- Expected: 46 rows.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM email_queue
WHERE visitor_id IS NULL
  AND LOWER(recipient_email) IN (SELECT email FROM _cleanup_targets);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 8 — email_logs text-only orphans (visitor_id NULL rows)
-- Same pattern as Step 7. CASCADE handles visitor_id-linked rows in Step 9.
-- Expected: 52 rows.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM email_logs
WHERE visitor_id IS NULL
  AND LOWER(email) IN (SELECT email FROM _cleanup_targets);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 9 — visitors (final delete)
-- CASCADE handles:
--   checkins                                (26 rows)
--   email_logs   by visitor_id              (116 rows)
--   email_queue  by visitor_id              (47 rows)
-- Expected: 46 visitor rows deleted.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM visitors
WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets);

-- ─────────────────────────────────────────────────────────────────────
-- VALIDATION — all four counts MUST be 0 for success.
-- If any value is non-zero, ROLLBACK manually before this transaction
-- closes (Ctrl+C in psql) or accept the partial state.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM visitors
   WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets))           AS remaining_visitors,
  (SELECT COUNT(*) FROM email_logs
   WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets))           AS remaining_email_logs,
  (SELECT COUNT(*) FROM reactivation_tokens
   WHERE LOWER(email) IN (SELECT email FROM _cleanup_targets))           AS remaining_tokens,
  (SELECT COUNT(*) FROM email_queue
   WHERE LOWER(recipient_email) IN (SELECT email FROM _cleanup_targets)) AS remaining_queue;

COMMIT;

-- Post-COMMIT verification (read-only, safe to run after success):
--   SELECT COUNT(*) FROM visitors_test_backup_20260514;   -- expected: 46
--   \d visitors   -- schema unchanged (this migration is data-only)
