-- Migration 000a: Reconcile production drift (initial.sql ile prod arasi fark)
-- ------------------------------------------------------------------
-- Amac: 'kod DB'yi sifirdan kurabilsin'. initial.sql DEGISTIRILMEDI.
-- Bu dosya, production'da olup repoda olmayan: (a) 'exhibitors' tablosu,
-- (b) 8 mevcut tablodaki eksik kolonlar. Hepsi canli pg_dump'tan AYNEN.
--
-- SIRA: initial.sql -> 000 (baseline tablolar) -> 000a (bu) -> 001..009
--   * 000a, 000'dan SONRA: expos.default_badge_template_id FK'si
--     badge_templates'e (000'de olusur) referans verir.
--   * 000a, 007'den ONCE: 007_test_email_cleanup, email_queue.recipient_email
--     kolonunu kullaniyor; bu kolon burada eklenir -> 007 artik patlamaz.
-- Idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   FK'ler pg_constraint guard'li DO blogu ile.
-- ------------------------------------------------------------------

-- === (a) exhibitors (tekil) — production-only tablo ===
CREATE SEQUENCE IF NOT EXISTS public.exhibitors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS public.exhibitors (
    id integer NOT NULL,
    organizer_id integer,
    expo_id integer,
    name text,
    email text,
    company text,
    country text,
    phone text,
    job_title text,
    custom_fields jsonb,
    created_at timestamp with time zone DEFAULT now(),
    form_id integer
);

ALTER SEQUENCE public.exhibitors_id_seq OWNED BY public.exhibitors.id;
ALTER TABLE ONLY public.exhibitors ALTER COLUMN id SET DEFAULT nextval('public.exhibitors_id_seq'::regclass);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exhibitors_pkey') THEN
    ALTER TABLE ONLY public.exhibitors ADD CONSTRAINT exhibitors_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exhibitors_expo_id_fkey') THEN
    ALTER TABLE ONLY public.exhibitors ADD CONSTRAINT exhibitors_expo_id_fkey FOREIGN KEY (expo_id) REFERENCES public.expos(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exhibitors_organizer_id_fkey') THEN
    ALTER TABLE ONLY public.exhibitors ADD CONSTRAINT exhibitors_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.organizers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- === (b) Mevcut tablolardaki eksik kolonlar (initial.sql drift) ===
-- checkins
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS staff_id integer;
-- email_logs
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS recipient_email text;
-- email_queue (007_test_email_cleanup BUNLARI gerektiriyor — 007'den ONCE calismali)
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html_content text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS recipient_email character varying(255);
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS subject text;
-- email_templates
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS expo_id integer;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS is_registration_default boolean DEFAULT false;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
-- expos (default_badge_template_id FK -> badge_templates, 000'de olusur)
ALTER TABLE expos ADD COLUMN IF NOT EXISTS default_badge_template_id integer;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS form_id integer;
ALTER TABLE expos ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{"auto_checkin_on_badge_print": true, "duplicate_threshold_seconds": 120}'::jsonb;
-- forms
ALTER TABLE forms ADD COLUMN IF NOT EXISTS fields jsonb;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE forms ADD COLUMN IF NOT EXISTS visitor_type text;
-- organizers
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS reply_forward_emails text;
-- visitors
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS badge_printed_at timestamp with time zone;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS badge_url text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS booth_number text;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS is_badge_printed boolean DEFAULT false;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone;

-- expos.default_badge_template_id -> badge_templates FK (000'deki tabloya)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expos_default_badge_template_id_fkey') THEN
    ALTER TABLE ONLY public.expos ADD CONSTRAINT expos_default_badge_template_id_fkey FOREIGN KEY (default_badge_template_id) REFERENCES public.badge_templates(id);
  END IF;
END $$;

-- === (c) Production-only partial UNIQUE index (visitors) ===
-- Repoda hic yoktu; canli dokumdan aynen. Bos DB'de guvenli.
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_unique_email_per_expo
  ON public.visitors USING btree (organizer_id, expo_id, lower(email))
  WHERE ((expo_id >= 3) AND (email IS NOT NULL) AND (email <> ''::text));
