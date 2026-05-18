-- Migration: Add allow_manual_registration column to terminals
-- Adds a per-terminal toggle for the manual registration option in the scanner UI.
-- DEFAULT TRUE preserves existing behavior (all terminals allow manual reg by default).
-- Frontend disables the checkbox when this is false; backend /api/visitors/manual
-- is NOT gated (frontend enforcement only — see ADR notes).

ALTER TABLE terminals
ADD COLUMN IF NOT EXISTS allow_manual_registration BOOLEAN DEFAULT TRUE NOT NULL;

-- Verify
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'terminals'
  AND column_name = 'allow_manual_registration';

-- Verify all existing rows now have the column with default value
SELECT
  COUNT(*) AS total_terminals,
  COUNT(*) FILTER (WHERE allow_manual_registration = true) AS allow_true,
  COUNT(*) FILTER (WHERE allow_manual_registration = false) AS allow_false
FROM terminals;
-- Expect: all existing rows allow_manual_registration = true
