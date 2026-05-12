-- Migration 005: import_jobs table for async background processing
-- Used by reactivation campaign Excel/expo imports (70k+ rows)

CREATE TABLE IF NOT EXISTS import_jobs (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES organizers(id),
  job_type TEXT NOT NULL,
  target_expo_id INTEGER REFERENCES expos(id),
  source_expo_id INTEGER REFERENCES expos(id),
  template_id INTEGER,
  form_id INTEGER,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_org ON import_jobs(organizer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
