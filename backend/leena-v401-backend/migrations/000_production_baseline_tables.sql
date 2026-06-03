-- Migration 000: Production-only baseline tables
-- ------------------------------------------------------------------
-- Bu tablolar production (leena_v401_db) icinde elle olusturulmus ama
-- repodaki initial.sql veya numarali migration'larda CREATE'i YOKTU.
-- Kod artik DB'yi sifirdan kurabilsin diye, canli pg_dump'tan AYNEN
-- alindi (kaynak: ELL_schema_dumps/leena_schema_2026-06-02.sql).
--
-- Calisma sirasi: initial.sql -> 000 (bu) -> 001..009
-- 'terminals' tam haliyle (allow_manual_registration + kind dahil)
-- burada olusur; 008/009 ALTER'lari ADD COLUMN IF NOT EXISTS oldugu
-- icin no-op olur (backward compatible).
--
-- Tablolar: badge_templates, terminals, conference_certificates,
--           exhibitor_leads, import_logs, reactivation_tokens,
--           visitor_event_status
-- DAHIL DEGIL (kapsam disi): expos.default_badge_template_id FK
--   (initial.sql'deki expos bu kolona sahip degil — ayri sorun).
-- ------------------------------------------------------------------

--
-- Name: badge_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.badge_templates (
    id integer NOT NULL,
    organizer_id integer NOT NULL,
    name text NOT NULL,
    description text,
    size_config jsonb DEFAULT '{"width_mm": 100, "height_mm": 50, "orientation": "landscape"}'::jsonb NOT NULL,
    content_config jsonb DEFAULT '{"show_qr": true, "show_name": true, "show_role": false, "show_company": true, "show_country": false}'::jsonb NOT NULL,
    style_config jsonb DEFAULT '{"font_size_name": "18pt", "font_size_company": "14pt"}'::jsonb,
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    visitor_type text DEFAULT 'all'::text
);

--
-- Name: badge_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.badge_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: badge_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badge_templates_id_seq OWNED BY public.badge_templates.id;

--
-- Name: conference_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.conference_certificates (
    id integer NOT NULL,
    visitor_id integer NOT NULL,
    expo_id integer NOT NULL,
    organizer_id integer NOT NULL,
    conference_topic text NOT NULL,
    certificate_token character varying(64) NOT NULL,
    email_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: conference_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.conference_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: conference_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conference_certificates_id_seq OWNED BY public.conference_certificates.id;

--
-- Name: exhibitor_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.exhibitor_leads (
    id integer NOT NULL,
    expo_id integer NOT NULL,
    exhibitor_visitor_id integer NOT NULL,
    exhibitor_company character varying(255) NOT NULL,
    lead_visitor_id integer NOT NULL,
    scanned_at timestamp with time zone DEFAULT now(),
    notes text
);

--
-- Name: exhibitor_leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.exhibitor_leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: exhibitor_leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exhibitor_leads_id_seq OWNED BY public.exhibitor_leads.id;

--
-- Name: import_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.import_logs (
    id integer NOT NULL,
    organizer_id integer NOT NULL,
    expo_id integer NOT NULL,
    expo_name character varying(255),
    filename character varying(255),
    total_rows integer DEFAULT 0,
    new_count integer DEFAULT 0,
    updated_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    email_sent_count integer DEFAULT 0,
    qr_regenerated_count integer DEFAULT 0,
    custom_fields_updated integer DEFAULT 0,
    visitor_type character varying(50),
    options jsonb,
    errors jsonb,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: import_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.import_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: import_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_logs_id_seq OWNED BY public.import_logs.id;

--
-- Name: reactivation_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.reactivation_tokens (
    id integer NOT NULL,
    token character varying(64) NOT NULL,
    source_visitor_id integer,
    source_expo_id integer,
    target_expo_id integer NOT NULL,
    organizer_id integer NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255),
    last_name character varying(255),
    company character varying(255),
    country character varying(255),
    job_title character varying(255),
    phone character varying(255),
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    activated_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    new_visitor_id integer,
    form_id integer
);

--
-- Name: reactivation_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.reactivation_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: reactivation_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reactivation_tokens_id_seq OWNED BY public.reactivation_tokens.id;

--
-- Name: terminals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.terminals (
    id integer NOT NULL,
    organizer_id integer NOT NULL,
    expo_id integer NOT NULL,
    hall text NOT NULL,
    terminal_no text NOT NULL,
    auto_checkin boolean DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    terminal_key text,
    badge_template_id integer,
    allow_manual_registration boolean DEFAULT true NOT NULL,
    kind character varying(20) DEFAULT 'scanner'::character varying NOT NULL
);

--
-- Name: COLUMN terminals.terminal_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.terminals.terminal_key IS 'Opaque unique key for tokenless terminal authentication (v402 Mini)';

--
-- Name: terminals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.terminals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: terminals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminals_id_seq OWNED BY public.terminals.id;

--
-- Name: visitor_event_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.visitor_event_status (
    id integer NOT NULL,
    visitor_id integer NOT NULL,
    expo_id integer NOT NULL,
    status text DEFAULT 'registered'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_valid_status CHECK ((status = ANY (ARRAY['registered'::text, 'badge_printed'::text, 'checked_in'::text, 'revisit'::text, 'nonshow'::text])))
);

--
-- Name: TABLE visitor_event_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visitor_event_status IS 'Tracks per-expo semantic status for each visitor (v402 Mini)';

--
-- Name: COLUMN visitor_event_status.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visitor_event_status.status IS 'registered | badge_printed | checked_in | revisit | nonshow';

--
-- Name: visitor_event_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.visitor_event_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: visitor_event_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visitor_event_status_id_seq OWNED BY public.visitor_event_status.id;

--
-- Name: badge_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates ALTER COLUMN id SET DEFAULT nextval('public.badge_templates_id_seq'::regclass);

--
-- Name: conference_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates ALTER COLUMN id SET DEFAULT nextval('public.conference_certificates_id_seq'::regclass);

--
-- Name: exhibitor_leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitor_leads ALTER COLUMN id SET DEFAULT nextval('public.exhibitor_leads_id_seq'::regclass);

--
-- Name: import_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_logs ALTER COLUMN id SET DEFAULT nextval('public.import_logs_id_seq'::regclass);

--
-- Name: reactivation_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens ALTER COLUMN id SET DEFAULT nextval('public.reactivation_tokens_id_seq'::regclass);

--
-- Name: terminals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals ALTER COLUMN id SET DEFAULT nextval('public.terminals_id_seq'::regclass);

--
-- Name: visitor_event_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_event_status ALTER COLUMN id SET DEFAULT nextval('public.visitor_event_status_id_seq'::regclass);

--
-- Name: badge_templates badge_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates
    ADD CONSTRAINT badge_templates_pkey PRIMARY KEY (id);

--
-- Name: conference_certificates conference_certificates_certificate_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates
    ADD CONSTRAINT conference_certificates_certificate_token_key UNIQUE (certificate_token);

--
-- Name: conference_certificates conference_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates
    ADD CONSTRAINT conference_certificates_pkey PRIMARY KEY (id);

--
-- Name: conference_certificates conference_certificates_visitor_id_expo_id_conference_topic_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates
    ADD CONSTRAINT conference_certificates_visitor_id_expo_id_conference_topic_key UNIQUE (visitor_id, expo_id, conference_topic);

--
-- Name: exhibitor_leads exhibitor_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitor_leads
    ADD CONSTRAINT exhibitor_leads_pkey PRIMARY KEY (id);

--
-- Name: import_logs import_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_logs
    ADD CONSTRAINT import_logs_pkey PRIMARY KEY (id);

--
-- Name: reactivation_tokens reactivation_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_pkey PRIMARY KEY (id);

--
-- Name: reactivation_tokens reactivation_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_token_key UNIQUE (token);

--
-- Name: terminals terminals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_pkey PRIMARY KEY (id);

--
-- Name: visitor_event_status uq_visitor_expo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_event_status
    ADD CONSTRAINT uq_visitor_expo UNIQUE (visitor_id, expo_id);

--
-- Name: visitor_event_status visitor_event_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_event_status
    ADD CONSTRAINT visitor_event_status_pkey PRIMARY KEY (id);

--
-- Name: idx_cert_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cert_token ON public.conference_certificates USING btree (certificate_token);

--
-- Name: idx_exhibitor_leads_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_exhibitor_leads_company ON public.exhibitor_leads USING btree (exhibitor_company, expo_id);

--
-- Name: idx_exhibitor_leads_expo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_exhibitor_leads_expo ON public.exhibitor_leads USING btree (expo_id);

--
-- Name: idx_reactivation_tokens_email_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_reactivation_tokens_email_target ON public.reactivation_tokens USING btree (email, target_expo_id);

--
-- Name: idx_reactivation_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_reactivation_tokens_token ON public.reactivation_tokens USING btree (token);

--
-- Name: idx_terminals_key_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_terminals_key_active ON public.terminals USING btree (terminal_key, is_active) WHERE (terminal_key IS NOT NULL);

--
-- Name: idx_terminals_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_terminals_kind ON public.terminals USING btree (kind);

--
-- Name: idx_terminals_terminal_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_terminal_key ON public.terminals USING btree (terminal_key) WHERE (terminal_key IS NOT NULL);

--
-- Name: idx_visitor_event_status_expo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitor_event_status_expo_status ON public.visitor_event_status USING btree (expo_id, status);

--
-- Name: idx_visitor_event_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitor_event_status_updated ON public.visitor_event_status USING btree (expo_id, updated_at DESC);

--
-- Name: idx_visitor_event_status_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitor_event_status_visitor ON public.visitor_event_status USING btree (visitor_id);

--
-- Name: badge_templates badge_templates_organizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates
    ADD CONSTRAINT badge_templates_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.organizers(id) ON DELETE CASCADE;

--
-- Name: conference_certificates conference_certificates_expo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates
    ADD CONSTRAINT conference_certificates_expo_id_fkey FOREIGN KEY (expo_id) REFERENCES public.expos(id);

--
-- Name: conference_certificates conference_certificates_visitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_certificates
    ADD CONSTRAINT conference_certificates_visitor_id_fkey FOREIGN KEY (visitor_id) REFERENCES public.visitors(id);

--
-- Name: exhibitor_leads exhibitor_leads_exhibitor_visitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitor_leads
    ADD CONSTRAINT exhibitor_leads_exhibitor_visitor_id_fkey FOREIGN KEY (exhibitor_visitor_id) REFERENCES public.visitors(id);

--
-- Name: exhibitor_leads exhibitor_leads_expo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitor_leads
    ADD CONSTRAINT exhibitor_leads_expo_id_fkey FOREIGN KEY (expo_id) REFERENCES public.expos(id);

--
-- Name: exhibitor_leads exhibitor_leads_lead_visitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitor_leads
    ADD CONSTRAINT exhibitor_leads_lead_visitor_id_fkey FOREIGN KEY (lead_visitor_id) REFERENCES public.visitors(id);

--
-- Name: reactivation_tokens reactivation_tokens_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id);

--
-- Name: reactivation_tokens reactivation_tokens_new_visitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_new_visitor_id_fkey FOREIGN KEY (new_visitor_id) REFERENCES public.visitors(id);

--
-- Name: reactivation_tokens reactivation_tokens_organizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.organizers(id);

--
-- Name: reactivation_tokens reactivation_tokens_target_expo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactivation_tokens
    ADD CONSTRAINT reactivation_tokens_target_expo_id_fkey FOREIGN KEY (target_expo_id) REFERENCES public.expos(id);

--
-- Name: terminals terminals_badge_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_badge_template_id_fkey FOREIGN KEY (badge_template_id) REFERENCES public.badge_templates(id);

--
-- Name: terminals terminals_expo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_expo_id_fkey FOREIGN KEY (expo_id) REFERENCES public.expos(id) ON DELETE CASCADE;

--
-- Name: terminals terminals_organizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES public.organizers(id) ON DELETE CASCADE;

