-- Migration: Add kind column to terminals for token type discrimination
-- 'scanner' (default) = QR scanner terminal (existing behavior)
-- 'bulk_print' = bulk badge print token (Request #1)
--
-- All existing terminal rows get DEFAULT 'scanner' (backward compatible).

ALTER TABLE terminals
ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'scanner' NOT NULL;

CREATE INDEX IF NOT EXISTS idx_terminals_kind ON terminals(kind);

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'terminals' AND column_name = 'kind';

SELECT kind, COUNT(*) FROM terminals GROUP BY kind;
-- Expect: scanner = 20, bulk_print = 0
