---
name: leena-db-schema
description: >
  USE THIS SKILL whenever writing SQL queries, creating DB migrations, or referencing
  table/column names in Leena EMS. Contains ALL tables, columns, foreign keys,
  naming conventions, and known gaps between initial.sql and production.
  TRIGGER: any task involving pool.query(), SQL, database changes, or column references.
---

> **Last verified:** v402 (March 2026)
> Update this skill whenever routes, schema, or frontend patterns change.

# Leena Database Schema

> ⚠️ Production DB has more columns/tables than initial.sql. This document reflects the REAL production schema.

## Tables Overview

| Table | Purpose | Key FK |
|-------|---------|--------|
| organizers | Account owners, auth | — |
| expos | Events/fairs | organizer_id → organizers |
| visitors | ALL person records (single source of truth) | organizer_id, expo_id, form_id |
| checkins | Entry/exit logs | visitor_id, expo_id |
| visitor_event_status | Per-visitor event state | visitor_id, expo_id |
| terminals | Physical scanner devices | expo_id, organizer_id |
| forms | Registration form configs | organizer_id, expo_id, email_template_id |
| email_templates | HTML email designs | organizer_id, expo_id |
| email_queue | Async email tasks | visitor_id, template_id |
| email_logs | Email send results | organizer_id, expo_id, visitor_id, template_id |
| badge_templates | Badge designs | organizer_id |
| reactivation_tokens | Campaign tokens | source_expo_id, target_expo_id |
| exhibitor_leads | Lead scanner records | expo_id, exhibitor_visitor_id, lead_visitor_id |
| import_logs | Import operation logs | organizer_id, expo_id |

---

## Table: organizers

```sql
CREATE TABLE organizers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,  -- bcrypt hashed
    company VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: expos

```sql
CREATE TABLE expos (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER NOT NULL REFERENCES organizers(id),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    description TEXT,
    location VARCHAR(255),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: visitors (CRITICAL — single source of truth)

```sql
CREATE TABLE visitors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),               -- unique per expo (enforced in code, not DB constraint)
    phone VARCHAR(50),
    company VARCHAR(255),
    country VARCHAR(100),
    job_title VARCHAR(255),
    visitor_type TEXT DEFAULT 'visitor', -- visitor|exhibitor|conference|vip|press|staff|speaker
    booth_number VARCHAR(100),          -- exhibitors only
    qr_code VARCHAR(255) UNIQUE,        -- UUID v4, NEVER overwrite on update
    badge_id VARCHAR(50),               -- first 8 chars of qr_code
    badge_url TEXT,
    source VARCHAR(50),                 -- manual|form|import|webhook|email
    origin VARCHAR(100),                -- massimport|manual_entry|zoho|manual_email_send
    expo_id INTEGER REFERENCES expos(id),
    organizer_id INTEGER REFERENCES organizers(id),
    form_id INTEGER REFERENCES forms(id),
    custom_fields JSONB,                -- any extra fields (e.g. {"conference_topic": "AI"})
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);
```

**Key rules:**
- `visitor_type` is free TEXT — no DB constraint, all validation in code
- `qr_code` must NEVER be overwritten on upsert (existing visitors keep their QR)
- `custom_fields` stores arbitrary JSONB (conference_topic, etc.)
- `email` uniqueness is per-expo, enforced in application code via `WHERE LOWER(email) = LOWER($1) AND expo_id = $2`

---

## Table: checkins

```sql
CREATE TABLE checkins (
    id SERIAL PRIMARY KEY,
    visitor_id INTEGER REFERENCES visitors(id),
    expo_id INTEGER REFERENCES expos(id),
    terminal_id INTEGER REFERENCES terminals(id),
    terminal_name VARCHAR(255),
    hall_name VARCHAR(255),
    source VARCHAR(50),
    checkin_time TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: visitor_event_status

```sql
CREATE TABLE visitor_event_status (
    id SERIAL PRIMARY KEY,
    visitor_id INTEGER REFERENCES visitors(id),
    expo_id INTEGER REFERENCES expos(id),
    checked_in BOOLEAN DEFAULT false,
    last_checkin_time TIMESTAMPTZ,
    checkin_count INTEGER DEFAULT 0,
    UNIQUE(visitor_id, expo_id)
);
```

Upserted on every check-in: `INSERT ... ON CONFLICT (visitor_id, expo_id) DO UPDATE SET checked_in = true, checkin_count = checkin_count + 1, last_checkin_time = NOW()`

---

## Table: terminals

```sql
CREATE TABLE terminals (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    expo_id INTEGER REFERENCES expos(id),
    name VARCHAR(255) NOT NULL,
    terminal_key VARCHAR(255) UNIQUE NOT NULL,  -- UUID v4, used for auth
    hall_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    badge_template_id INTEGER REFERENCES badge_templates(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: forms

```sql
CREATE TABLE forms (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    expo_id INTEGER REFERENCES expos(id),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    fields JSONB,                          -- form field definitions
    visitor_type VARCHAR(50) DEFAULT 'visitor',
    email_template_id INTEGER REFERENCES email_templates(id),
    webhook_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: email_templates

```sql
CREATE TABLE email_templates (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    expo_id INTEGER REFERENCES expos(id),   -- added 23 Feb 2026
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    html_content TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: email_queue

```sql
CREATE TABLE email_queue (
    id SERIAL PRIMARY KEY,
    visitor_id INTEGER REFERENCES visitors(id),
    template_id INTEGER REFERENCES email_templates(id),
    status VARCHAR(20) DEFAULT 'pending',   -- pending|processing|sent|failed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- v402 additions (direct HTML mode):
    recipient_email VARCHAR(255),
    subject VARCHAR(500),
    html_content TEXT,
    sent_at TIMESTAMPTZ,
    error_message TEXT
);
```

Two modes:
1. **Visitor+Template mode**: `visitor_id` + `template_id` set, worker fetches data and processes template
2. **Direct HTML mode**: `recipient_email` + `subject` + `html_content` set, worker sends as-is

---

## Table: email_logs

```sql
CREATE TABLE email_logs (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    expo_id INTEGER REFERENCES expos(id),
    visitor_id INTEGER REFERENCES visitors(id),
    template_id INTEGER REFERENCES email_templates(id),
    email VARCHAR(255),         -- recipient email
    status VARCHAR(20),         -- sent|failed
    message TEXT,               -- "Subject: X | To: Name"
    sent_at TIMESTAMPTZ
);
```

Written by: `emailSend.js` (single + bulk), `emailSegments.js`

---

## Table: badge_templates

```sql
CREATE TABLE badge_templates (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    name VARCHAR(255) NOT NULL,
    visitor_type VARCHAR(50) DEFAULT 'visitor',
    layout JSONB,                  -- field positions, sizes, visibility
    show_booth BOOLEAN DEFAULT false,
    show_phone BOOLEAN DEFAULT false,
    show_sector BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table: reactivation_tokens

```sql
CREATE TABLE reactivation_tokens (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    source_expo_id INTEGER REFERENCES expos(id),
    target_expo_id INTEGER REFERENCES expos(id),
    visitor_id INTEGER REFERENCES visitors(id),
    token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',  -- pending|activated|expired
    created_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ
);
```

---

## Table: exhibitor_leads

```sql
CREATE TABLE exhibitor_leads (
    id SERIAL PRIMARY KEY,
    expo_id INTEGER NOT NULL REFERENCES expos(id),
    exhibitor_visitor_id INTEGER NOT NULL REFERENCES visitors(id),
    exhibitor_company VARCHAR(255) NOT NULL,
    lead_visitor_id INTEGER NOT NULL REFERENCES visitors(id),
    scanned_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);
```

---

## Table: import_logs

```sql
CREATE TABLE import_logs (
    id SERIAL PRIMARY KEY,
    organizer_id INTEGER REFERENCES organizers(id),
    expo_id INTEGER REFERENCES expos(id),
    filename VARCHAR(255),
    total_rows INTEGER DEFAULT 0,
    new_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    email_sent_count INTEGER DEFAULT 0,
    qr_regenerated_count INTEGER DEFAULT 0,
    custom_fields_updated_count INTEGER DEFAULT 0,
    errors JSONB,
    options JSONB,               -- {existing_email_option, existing_qr_option, ...}
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Foreign Key Map

```
organizers ──┬── expos
             ├── visitors (via organizer_id)
             ├── forms
             ├── email_templates
             ├── terminals
             ├── badge_templates
             ├── email_logs
             ├── reactivation_tokens
             └── import_logs

expos ───────┬── visitors (via expo_id)
             ├── checkins
             ├── forms
             ├── terminals
             ├── email_logs
             ├── visitor_event_status
             ├── exhibitor_leads
             ├── reactivation_tokens (source + target)
             └── import_logs

visitors ────┬── checkins (via visitor_id)
             ├── visitor_event_status
             ├── email_queue
             ├── email_logs
             ├── exhibitor_leads (exhibitor_visitor_id + lead_visitor_id)
             └── reactivation_tokens

forms ───────── visitors (via form_id)

email_templates ── forms (via email_template_id)
                ── email_queue (via template_id)
                ── email_logs (via template_id)

terminals ──── checkins (via terminal_id)
            ── badge_templates (via badge_template_id)
```

---

## Naming Conventions

| What | Convention | Examples |
|------|-----------|----------|
| Table names | snake_case, plural | `visitors`, `email_logs`, `import_logs` |
| Column names | snake_case | `organizer_id`, `visitor_type`, `created_at` |
| Foreign keys | `{referenced_table_singular}_id` | `visitor_id`, `expo_id`, `template_id` |
| Boolean columns | `is_` prefix | `is_active`, `is_default` |
| Timestamps | `_at` suffix | `created_at`, `updated_at`, `sent_at`, `activated_at` |
| Count columns | `_count` suffix | `checkin_count`, `new_count`, `failed_count` |
| JSONB columns | descriptive noun | `custom_fields`, `fields`, `layout`, `options`, `errors` |
| Status columns | `status` VARCHAR | Values: pending, processing, sent, failed, activated, expired |
| Type columns | `_type` suffix, TEXT | `visitor_type` — free text, no DB constraint |

---

## Environment Variables

| Variable | Used In | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | db.js | PostgreSQL connection string |
| `JWT_SECRET` | auth.js, authMiddleware.js | JWT signing key |
| `SENDGRID_API_KEY` | email.js, email_worker.js | SendGrid API key |
| `BASE_BADGE_URL` | emailSend.js, emailSegments.js, visitors.js | Badge URL base (default: https://leena.app) |
| `ZOHO_WEBHOOK_TOKEN` | webhook.js | Webhook auth token |
| `PORT` | index.js | Server port (default: 3000) |
| `CORS_ORIGINS` | index.js | Allowed CORS origins |
| `NODE_ENV` | index.js | Environment (production/development) |

---

## Common Query Patterns

### Visitor lookup by email + expo:
```sql
SELECT id, qr_code, badge_url FROM visitors
WHERE LOWER(email) = LOWER($1) AND expo_id = $2
```

### Paginated list with organizer + expo scoping:
```sql
SELECT * FROM my_table
WHERE organizer_id = $1 AND expo_id = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4
```

### Custom fields access:
```sql
-- Read a specific custom field:
SELECT custom_fields->>'conference_topic' as conference_topic FROM visitors

-- Filter by custom field:
WHERE custom_fields->>'conference_topic' = $1

-- Update (merge, don't overwrite):
UPDATE visitors SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb
```

### Check-in with visitor_event_status upsert:
```sql
INSERT INTO checkins (visitor_id, expo_id, terminal_id, ...) VALUES (...);

INSERT INTO visitor_event_status (visitor_id, expo_id, checked_in, last_checkin_time, checkin_count)
VALUES ($1, $2, true, NOW(), 1)
ON CONFLICT (visitor_id, expo_id)
DO UPDATE SET checked_in = true, checkin_count = visitor_event_status.checkin_count + 1, last_checkin_time = NOW();
```

---

## Known Gaps: initial.sql vs Production

These exist in production but NOT in initial.sql:
- `badge_templates` table
- `visitor_event_status` table
- `exhibitor_leads` table
- `reactivation_tokens` table
- `import_logs` table
- `email_templates.expo_id` column
- `email_queue.recipient_email`, `subject`, `html_content`, `sent_at`, `error_message` columns
- `visitors.custom_fields` JSONB column
- `visitors.booth_number` column
- `visitors.updated_at` column

**⚠️ Always verify against production DB, not initial.sql, before writing queries.**
