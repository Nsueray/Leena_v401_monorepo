-- ============================================================
-- Migration 010 — Expo Operations module
-- Date: 2026-06-16
-- Module: ELL Expo Operations (design: ELL_DURUM_DEFTERI.md "EXPO UI TASARIMI")
--
-- Adds the Expo Operations data model to LEENA's existing `expos` table and
-- creates supporting tables: reference data (core_countries, core_sectors),
-- expo_sectors junction, expo_clusters, expo_partners.
--
-- DESIGN DECISIONS (locked by Suer, ADIM 2):
--   D1 country / sector  → CLOSED SETS via reference tables, never free text.
--                          country  → expos.country_code FK → core_countries(code).
--                          sectors  → expo_sectors junction → core_sectors(id)
--                                     (many-to-many; an array can't FK its elements,
--                                      so a junction is the only thing that enforces
--                                      referential integrity). NO sectors TEXT[].
--   D1b city / venue     → FREE TEXT (open set, no fixed list).
--   D1c currency         → NOT on the LEENA expo. Currency is a LIFFY concern
--                          (offices.default_currency / exchange_rates / quotes).
--                          Out of scope for LEENA expo operations — no column added.
--   D2 deadlines         → 8 NULLable DATE columns (override store). Backend reads
--                          each as COALESCE(<override>, start_date - <offset>):
--                          NULL = compute from offset; set = manual override.
--   D3 actual_visitors   → NOT stored. Derived live via COUNT(visitors WHERE expo_id)
--                          (routes/expos.js:57). Form shows it read-only.
--   D4 location          → kept as-is (14 expos hold legacy free-text). New structured
--                          country_code/city/venue added alongside. No data migration.
--   D5 operation contacts→ NO expo column. Modeled as expo_partners rows with roles
--                          'istanbul_hq' / 'local_onsite' (LEENA has no users table).
--
-- SEED DATA: intentionally NONE in this migration. core_countries (ISO set) and
--            core_sectors (HVAC / Construction / Food-Agriculture / Ceramics / Water /
--            Electricity / Decoration-Furniture / IT) are populated by Suer manually
--            after this structural migration is applied.
--
-- CONVENTION NOTES:
--   - Enums = CHECK-constrained VARCHAR (re-run-safe via ADD COLUMN IF NOT EXISTS,
--     matches terminals.kind precedent; simpler than CREATE TYPE).
--   - created_at = TIMESTAMPTZ + now() to match LEENA tables (expos.created_at is
--     timestamptz). LEENA reference/cluster data is independent of ELIZA (no sync);
--     code keys (country code, sector slug) align for the eventual ELL merge.
--   - Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout.
--   - migrate.js does NOT iterate numbered migrations (FAZ 0a known). Apply manually:
--       Dry run : sed 's/^COMMIT;$/ROLLBACK;/' migrations/010_expo_operations.sql | psql "$CONN"
--       Real run: psql "$CONN" -f migrations/010_expo_operations.sql
-- ============================================================

BEGIN;

-- ============================================================
-- Reference data — CLOSED SETS (structure only; seeded manually by Suer)
-- ============================================================

-- ISO-3166 country reference. code = ISO alpha-2. Aligns with ELIZA core_countries
-- on the `code` key for the eventual merge (LEENA keeps a minimal code+name shape).
CREATE TABLE IF NOT EXISTS core_countries (
    code CHAR(2)      PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

-- Sector reference (Elan's working sectors). slug = stable key, name = display label.
CREATE TABLE IF NOT EXISTS core_sectors (
    id   SERIAL       PRIMARY KEY,
    slug VARCHAR(50)  NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

-- ============================================================
-- expo_clusters — group of equal expos (no parent/child).
-- Created before expos.cluster_id references it.
-- ============================================================
CREATE TABLE IF NOT EXISTS expo_clusters (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    city        VARCHAR(255),
    country     VARCHAR(255),
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- expos — add Expo Operations fields (all additive, all NULLable or DEFAULT'ed).
-- ============================================================

-- Identity
ALTER TABLE expos ADD COLUMN IF NOT EXISTS edition_year INTEGER;          -- clone bumps +1
ALTER TABLE expos ADD COLUMN IF NOT EXISTS country_code CHAR(2) REFERENCES core_countries(code);  -- D1: closed set
ALTER TABLE expos ADD COLUMN IF NOT EXISTS city  VARCHAR(100);            -- D1b: free text
ALTER TABLE expos ADD COLUMN IF NOT EXISTS venue VARCHAR(255);            -- D1b: free text

ALTER TABLE expos ADD COLUMN IF NOT EXISTS organizer_role VARCHAR(20) DEFAULT 'main_organizer'
    CHECK (organizer_role IN ('main_organizer', 'co_organizer', 'agent', 'consultant'));

ALTER TABLE expos ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'announcement'
    CHECK (status IN ('announcement', 'sales-open', 'build-up', 'live', 'accomplished'));

ALTER TABLE expos ADD COLUMN IF NOT EXISTS show_open_hours VARCHAR(255);  -- e.g. "10:00–17:00 (last day 16:00)"

-- Cluster link (nullable — supports the "leaves a cluster" scenario)
ALTER TABLE expos ADD COLUMN IF NOT EXISTS cluster_id INTEGER REFERENCES expo_clusters(id);

-- 8 offset fields (system defaults, editable per expo)
ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_1_days_before             INTEGER DEFAULT 3;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_2_days_before             INTEGER DEFAULT 2;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS standard_buildup_days_before      INTEGER DEFAULT 1;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_deadline_days_before    INTEGER DEFAULT 25;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS stand_design_deadline_days_before INTEGER DEFAULT 25;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS payment_deadline_days_before      INTEGER DEFAULT 30;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS visa_deadline_days_before         INTEGER DEFAULT 40;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS breakdown_days_after              INTEGER DEFAULT 0;

-- 8 deadline overrides (D2: NULL = compute from offset; set = manual override)
ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_day_1                      DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_day_2                      DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS standard_buildup_day               DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_submission_deadline      DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS stand_design_confirmation_deadline DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS payment_deadline                   DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS visa_support_deadline              DATE;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS breakdown                          DATE;

-- 3 form URLs
ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_form_url               VARCHAR(500);
ALTER TABLE expos ADD COLUMN IF NOT EXISTS stand_design_form_url            VARCHAR(500);
ALTER TABLE expos ADD COLUMN IF NOT EXISTS visitor_preregistration_form_url VARCHAR(500);

-- ============================================================
-- expo_sectors — expo ↔ sector many-to-many (D1: referential integrity via junction)
-- ============================================================
CREATE TABLE IF NOT EXISTS expo_sectors (
    expo_id   INTEGER NOT NULL REFERENCES expos(id) ON DELETE CASCADE,
    sector_id INTEGER NOT NULL REFERENCES core_sectors(id),
    PRIMARY KEY (expo_id, sector_id)
);

-- ============================================================
-- expo_partners — per-expo people/companies (incl. operation team contacts, D5).
-- ============================================================
CREATE TABLE IF NOT EXISTS expo_partners (
    id           SERIAL PRIMARY KEY,
    expo_id      INTEGER NOT NULL REFERENCES expos(id),
    partner_role VARCHAR(30) NOT NULL
        CHECK (partner_role IN (
            'stand_contractor', 'travel', 'visa', 'forwarder', 'hostess',
            'catering', 'security', 'venue_authority',
            'istanbul_hq', 'local_onsite', 'other')),
    company_name VARCHAR(255),
    contact_name VARCHAR(255),
    phone        VARCHAR(50),
    email        VARCHAR(255),
    notes        TEXT,
    is_primary   BOOLEAN DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expo_partners_expo ON expo_partners(expo_id);

-- ============================================================
-- Verification (printed during dry-run; harmless on real run)
-- ============================================================
SELECT 'expos new columns' AS check, COUNT(*) AS n
FROM information_schema.columns
WHERE table_name = 'expos'
  AND column_name IN (
    'edition_year','country_code','city','venue','organizer_role','status',
    'show_open_hours','cluster_id',
    'buildup_1_days_before','buildup_2_days_before','standard_buildup_days_before',
    'catalogue_deadline_days_before','stand_design_deadline_days_before',
    'payment_deadline_days_before','visa_deadline_days_before','breakdown_days_after',
    'buildup_day_1','buildup_day_2','standard_buildup_day','catalogue_submission_deadline',
    'stand_design_confirmation_deadline','payment_deadline','visa_support_deadline','breakdown',
    'catalogue_form_url','stand_design_form_url','visitor_preregistration_form_url');
-- Expect n = 27

SELECT 'tables' AS check,
       to_regclass('public.core_countries') AS core_countries,
       to_regclass('public.core_sectors')   AS core_sectors,
       to_regclass('public.expo_sectors')   AS expo_sectors,
       to_regclass('public.expo_clusters')  AS expo_clusters,
       to_regclass('public.expo_partners')  AS expo_partners;

COMMIT;
