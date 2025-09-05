-- initial.sql - Leena EMS v401 (updated)
DROP TABLE IF EXISTS checkins, visitors, forms, expos, organizers, email_templates, email_queue, email_logs CASCADE;

CREATE TABLE IF NOT EXISTS organizers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expos (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  location TEXT,
  description TEXT,
  logo_url TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visitors (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  expo_id INTEGER REFERENCES expos(id) ON DELETE CASCADE,
  name TEXT,
  last_name TEXT,
  email TEXT,
  badge_id TEXT,
  company TEXT,
  country TEXT,
  job_title TEXT,
  source TEXT,
  origin TEXT,
  phone TEXT,
  website TEXT,
  visitor_type TEXT,
  visitor_status TEXT,
  visitor_category TEXT,
  workshop_topic TEXT,
  sector TEXT,
  expo_name TEXT,
  custom_fields JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forms (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  expo_id INTEGER REFERENCES expos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  config JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  submission_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  visitor_id INTEGER REFERENCES visitors(id) ON DELETE CASCADE,
  expo_id INTEGER REFERENCES expos(id) ON DELETE CASCADE,
  source TEXT,
  terminal TEXT,
  checkin_time TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  expo_id INTEGER REFERENCES expos(id) ON DELETE CASCADE,
  visitor_id INTEGER REFERENCES visitors(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed
  try_count INTEGER DEFAULT 0,
  last_try TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE CASCADE,
  expo_id INTEGER REFERENCES expos(id) ON DELETE CASCADE,
  visitor_id INTEGER REFERENCES visitors(id) ON DELETE CASCADE,
  template_id INTEGER,
  email TEXT,
  status TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional indexes
CREATE INDEX IF NOT EXISTS idx_visitors_expo_id ON visitors(expo_id);
CREATE INDEX IF NOT EXISTS idx_checkins_expo_id ON checkins(expo_id);
CREATE INDEX IF NOT EXISTS idx_forms_expo_id ON forms(expo_id);
CREATE INDEX IF NOT EXISTS idx_emails_visitor_id ON email_logs(visitor_id);
