# RTM ENVANTER — HAM KANIT — 2026-09-14, salt-okunur

- LEENA HEAD: `ba53c7c` (`git rev-parse --short HEAD`)
- LIFFY HEAD: `9954054` (`git -C ~/Projects/liffyv1 rev-parse --short HEAD`)
- Çalışma tarihi/saati: `2026-09-14 11:42:45 +03` (`date "+%Y-%m-%d %H:%M:%S %Z"`)
- LEENA kök: `~/Desktop/Leena_Projesi/Leena_v401_monorepo`, backend: `backend/leena-v401-backend`
- LIFFY kök: `~/Projects/liffyv1`, backend: `backend/`
- Kapsam kuralı: yalnız ölçüm. Kod/dosya değişikliği yok; tek yazılan dosya bu rapordur.

---

## A. LEENA MIGRATION/ŞEMA ENVANTERİ

### A1. migrations/ listesi + initial.sql

```
$ ls -1 migrations/
000_production_baseline_tables.sql
000a_reconcile_production_drift.sql
001_floorplan_tables.sql
002_reactivation_form_id.sql
003_exhibitors_table.sql
004_sequence_campaigns.sql
004_sequence_campaigns_rollback.sql
005_import_jobs.sql
006_reactivation_closed_at.sql
007_test_email_cleanup.sql
008_add_allow_manual_registration_to_terminals.sql
009_add_kind_to_terminals.sql
010_expo_operations.sql
011_seed_reference_data.sql
012_finance_foundation.sql
013_schema_migrations.sql
014_sales_agents_invariants.sql
015_schema_migrations_normalize.sql
016_contract_operational_columns.sql
017_payments.sql
018_payment_reversal.sql
019_transfer_guards.sql
020_commission_agents.sql
021_sales_agents_import_prep.sql
022_sales_agents_import_prep2.sql
023_drop_contracts_sales_agent_id.sql
024_contract_line_items.sql
025_commission_payouts.sql
026_payment_schedule.sql
027_payout_office_method.sql
028_agent_office.sql
029_campaign_delivered_count.sql
030_callcenter_leads.sql
031_callcenter_email_queue_indexes.sql
032_users_and_first_owner.sql
```
Toplam: 34 dosya (004 + 004_rollback dahil).

```
$ ls -la initial.sql
-rw-r--r--@ 1 nsa  staff  3570 Sep  6  2025 initial.sql
```
initial.sql: **VAR**

### A2. Tüm migration'larda CREATE TABLE envanteri

```
$ grep -n "CREATE TABLE" migrations/*.sql initial.sql
migrations/000_production_baseline_tables.sql:24:CREATE TABLE IF NOT EXISTS public.badge_templates (
migrations/000_production_baseline_tables.sql:59:CREATE TABLE IF NOT EXISTS public.conference_certificates (
migrations/000_production_baseline_tables.sql:92:CREATE TABLE IF NOT EXISTS public.exhibitor_leads (
migrations/000_production_baseline_tables.sql:124:CREATE TABLE IF NOT EXISTS public.import_logs (
migrations/000_production_baseline_tables.sql:165:CREATE TABLE IF NOT EXISTS public.reactivation_tokens (
migrations/000_production_baseline_tables.sql:209:CREATE TABLE IF NOT EXISTS public.terminals (
migrations/000_production_baseline_tables.sql:252:CREATE TABLE IF NOT EXISTS public.visitor_event_status (
migrations/000a_reconcile_production_drift.sql:25:CREATE TABLE IF NOT EXISTS public.exhibitors (
migrations/001_floorplan_tables.sql:21:CREATE TABLE expo_halls (
migrations/001_floorplan_tables.sql:48:CREATE TABLE expo_floorplan_versions (
migrations/001_floorplan_tables.sql:70:CREATE TABLE expo_stands (
migrations/001_floorplan_tables.sql:135:CREATE TABLE expo_stand_cells (
migrations/001_floorplan_tables.sql:156:CREATE TABLE expo_stand_assignments (
migrations/003_exhibitors_table.sql:6:CREATE TABLE IF NOT EXISTS expo_exhibitors (
migrations/004_sequence_campaigns.sql:21:CREATE TABLE IF NOT EXISTS email_campaigns (
migrations/004_sequence_campaigns.sql:50:CREATE TABLE IF NOT EXISTS campaign_steps (
migrations/004_sequence_campaigns.sql:73:CREATE TABLE IF NOT EXISTS campaign_recipients (
migrations/004_sequence_campaigns.sql:111:CREATE TABLE IF NOT EXISTS email_events (
migrations/004_sequence_campaigns.sql:139:CREATE TABLE IF NOT EXISTS email_unsubscribes (
migrations/005_import_jobs.sql:4:CREATE TABLE IF NOT EXISTS import_jobs (
migrations/007_test_email_cleanup.sql:98:CREATE TABLE visitors_test_backup_20260514 AS
migrations/010_expo_operations.sql:56:CREATE TABLE IF NOT EXISTS core_countries (
migrations/010_expo_operations.sql:62:CREATE TABLE IF NOT EXISTS core_sectors (
migrations/010_expo_operations.sql:72:CREATE TABLE IF NOT EXISTS expo_clusters (
migrations/010_expo_operations.sql:131:CREATE TABLE IF NOT EXISTS expo_sectors (
migrations/010_expo_operations.sql:140:CREATE TABLE IF NOT EXISTS expo_partners (
migrations/012_finance_foundation.sql:31:CREATE TABLE IF NOT EXISTS sales_agents (
migrations/012_finance_foundation.sql:65:CREATE TABLE IF NOT EXISTS contracts (
migrations/013_schema_migrations.sql:26:CREATE TABLE IF NOT EXISTS schema_migrations (
migrations/017_payments.sql:35:CREATE TABLE payments (
migrations/024_contract_line_items.sql:38:CREATE TABLE contract_line_items (
migrations/025_commission_payouts.sql:36:CREATE TABLE commission_payouts (
migrations/026_payment_schedule.sql:26:CREATE TABLE offices (
migrations/026_payment_schedule.sql:49:CREATE TABLE payment_schedule_items (
migrations/030_callcenter_leads.sql:18:CREATE TABLE IF NOT EXISTS callcenter_leads (
migrations/032_users_and_first_owner.sql:31:CREATE TABLE IF NOT EXISTS users (
initial.sql:7:CREATE TABLE IF NOT EXISTS organizers (
initial.sql:17:CREATE TABLE IF NOT EXISTS expos (
initial.sql:32:CREATE TABLE IF NOT EXISTS visitors (
initial.sql:60:CREATE TABLE IF NOT EXISTS forms (
initial.sql:74:CREATE TABLE IF NOT EXISTS checkins (
initial.sql:86:CREATE TABLE IF NOT EXISTS email_templates (
initial.sql:98:CREATE TABLE IF NOT EXISTS email_queue (
initial.sql:111:CREATE TABLE IF NOT EXISTS email_logs (
```
(Not: `migrations/024_contract_line_items.sql:24` satırındaki eşleşme yorum satırıdır, tablo değil.)

### A3. contracts şeması (012 ve sonrası)

```
$ grep -n -i "contracts" migrations/*.sql | grep -i -E "CREATE|ALTER|CHECK|ADD COLUMN"
migrations/012_finance_foundation.sql:65:CREATE TABLE IF NOT EXISTS contracts (
migrations/012_finance_foundation.sql:87:  CONSTRAINT contracts_status_check
migrations/012_finance_foundation.sql:95:CREATE INDEX IF NOT EXISTS idx_contracts_expo_id
migrations/012_finance_foundation.sql:98:CREATE INDEX IF NOT EXISTS idx_contracts_organizer_id
migrations/012_finance_foundation.sql:104:CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_source_quote_id
migrations/016_contract_operational_columns.sql:20:ALTER TABLE contracts
migrations/016_contract_operational_columns.sql:29:  ADD COLUMN transferred_from_contract_id integer REFERENCES contracts(id);
migrations/016_contract_operational_columns.sql:33:ALTER TABLE contracts ADD CONSTRAINT contracts_transportation_check
migrations/016_contract_operational_columns.sql:39:ALTER TABLE contracts ADD CONSTRAINT contracts_no_self_transfer_check
migrations/019_transfer_guards.sql:39:CREATE UNIQUE INDEX uq_contracts_transferred_from
migrations/019_transfer_guards.sql:43:CREATE UNIQUE INDEX uq_contracts_af_number
migrations/020_commission_agents.sql:58:ALTER TABLE contracts
migrations/020_commission_agents.sql:67:ALTER TABLE contracts
migrations/020_commission_agents.sql:68:  ADD CONSTRAINT contracts_agent_sr_exclusive_check
migrations/020_commission_agents.sql:72:ALTER TABLE contracts
migrations/020_commission_agents.sql:73:  ADD CONSTRAINT contracts_sd_requires_sr_check
migrations/020_commission_agents.sql:77-99: (pct range + pct_requires_fk CHECK'leri — aşağıda A3-e)
migrations/023_drop_contracts_sales_agent_id.sql:19:ALTER TABLE contracts DROP COLUMN sales_agent_id;
```

#### A3-a) status CHECK — tam değer listesi

`migrations/012_finance_foundation.sql:87-88`
```
87	  CONSTRAINT contracts_status_check
88	    CHECK (status = ANY (ARRAY['Active', 'On Hold', 'Transferred', 'Cancelled'])),
```
Değer sayısı: **4**. `'Draft'`: **YOK**.
Bilinçli dışarıda bırakma notu: `migrations/012_finance_foundation.sql:52-53`
```
52	--   - 4-status CHECK, 'Draft' BİLİNÇLİ DIŞARIDA: contract signed quote'tan
53	--     doğar, doğduğu an Active.
```
Kod tarafı whitelist aynı: `routes/contracts.js:28`
```
28	const CONTRACT_STATUSES = ['Active', 'On Hold', 'Transferred', 'Cancelled'];
```

#### A3-b) transferred_from_contract_id

**VAR** — `migrations/016_contract_operational_columns.sql:29`
```
29	  ADD COLUMN transferred_from_contract_id integer REFERENCES contracts(id);
```
İlgili CHECK `016:39-41`:
```
39	ALTER TABLE contracts ADD CONSTRAINT contracts_no_self_transfer_check
40	  CHECK (transferred_from_contract_id IS NULL
41	         OR transferred_from_contract_id <> id);
```
İlgili partial UNIQUE `migrations/019_transfer_guards.sql:39` (`uq_contracts_transferred_from`), `019:43` (`uq_contracts_af_number`).

#### A3-c) denormalize paid / balance / received kolonu — contracts üzerinde

```
$ grep -n -i -E "paid|balance|received|outstanding" migrations/*.sql initial.sql | grep -i -E "ADD COLUMN|CREATE TABLE|contracts"
migrations/027_payout_office_method.sql:20:  ADD COLUMN paid_office_id integer          # commission_payouts üzerinde
migrations/026_payment_schedule.sql:97:  ADD COLUMN received_office_id integer REFERENCES offices(id);   # payments üzerinde
```
contracts üzerinde denormalize paid/balance/received kolonu: **YOK** (arama: yukarıdaki grep; iki eşleşme de başka tablolara ait ofis FK'leridir).
Kod tarafı teyidi — türetilmiş okuma: `routes/contracts.js:1108-1111`
```
1108	    CONTRACT_DETAIL_SQL + ` LEFT JOIN LATERAL (
1109	           SELECT COALESCE(SUM(pm.amount_eur), 0)::numeric(14,2) AS paid_eur
1110	             FROM payments pm WHERE pm.contract_id = c.id
1111	         ) p ON TRUE
```
Liste tarafı notu: `routes/contracts.js:226`
```
226	// Liste YALIN kalır: türev alan (total_m2, paid vb.) burada hesaplanmaz.
```

#### A3-d) revenue / currency / exchange_rate / revenue_eur

**Dördü de VAR** — `migrations/012_finance_foundation.sql:72-75`
```
72	  revenue             numeric(14,2),
73	  currency            text,
74	  exchange_rate       numeric(18,8),
75	  revenue_eur         numeric(14,2),
```
Tasarım notu `012:54-55`:
```
54	--   - Frozen-EUR: revenue/currency/exchange_rate/revenue_eur birlikte saklanır,
55	--     kur sonradan değişse de belge değişmez (bilgi kaybını önler).
```

#### A3-e) agent/sr/sd FK + 3 pct override + XOR/dışlayıcılık CHECK'leri (020)

`migrations/020_commission_agents.sql:58-100` — **hepsi VAR**
```
58	ALTER TABLE contracts
59	  ADD COLUMN agent_sales_agent_id integer REFERENCES sales_agents(id),
60	  ADD COLUMN sr_sales_agent_id    integer REFERENCES sales_agents(id),
61	  ADD COLUMN sd_sales_agent_id    integer REFERENCES sales_agents(id),
62	  ADD COLUMN agent_pct numeric(5,2),
63	  ADD COLUMN sr_pct    numeric(5,2),
64	  ADD COLUMN sd_pct    numeric(5,2);
67	ALTER TABLE contracts
68	  ADD CONSTRAINT contracts_agent_sr_exclusive_check
69	  CHECK (agent_sales_agent_id IS NULL OR sr_sales_agent_id IS NULL);
72	ALTER TABLE contracts
73	  ADD CONSTRAINT contracts_sd_requires_sr_check
74	  CHECK (sd_sales_agent_id IS NULL OR sr_sales_agent_id IS NOT NULL);
77-87	contracts_agent_pct_range_check / contracts_sr_pct_range_check /
	contracts_sd_pct_range_check  → CHECK (x_pct >= 0 AND x_pct <= 100)
90-100	contracts_agent_pct_requires_fk_check / contracts_sr_pct_requires_fk_check /
	contracts_sd_pct_requires_fk_check → CHECK (x_pct IS NULL OR x_sales_agent_id IS NOT NULL)
```
Kolon adları (E2-Q3'te kullanılacak gerçek adlar): `agent_sales_agent_id`, `sr_sales_agent_id`, `sd_sales_agent_id`.

#### A3-f) tekil sales_agent_id DROP edildi mi (023)

**EVET** — `migrations/023_drop_contracts_sales_agent_id.sql:19`
```
19	ALTER TABLE contracts DROP COLUMN sales_agent_id;
```
(Kolon 012'de oluşturulmuştu: `012:80 sales_agent_id integer`, FK `012:91-92`.)

### A4. contract_line_items (024)

`migrations/024_contract_line_items.sql:38-61`
```
38	CREATE TABLE contract_line_items (
39	  id                  serial        PRIMARY KEY,
40	  contract_id         integer       NOT NULL,
41	  line_no             integer       NOT NULL,
42	  product_code        text,                              -- donmuş SKU; nullable; FK YOK
43	  description         text          NOT NULL,
44	  quantity            numeric(10,2) NOT NULL,
45	  unit_price          numeric(14,2) NOT NULL,
46	  discount_percent    numeric(5,2)  NOT NULL DEFAULT 0,
47	  is_registration_fee boolean       NOT NULL DEFAULT false,
48	  currency            text          NOT NULL,
49	  created_at          timestamptz   NOT NULL DEFAULT now(),
51	  CONSTRAINT contract_line_items_contract_id_fkey
52	    FOREIGN KEY (contract_id) REFERENCES contracts(id),
53	  CONSTRAINT contract_line_items_contract_line_no_key
54	    UNIQUE (contract_id, line_no),
55	  CONSTRAINT contract_line_items_quantity_check
56	    CHECK (quantity > 0),
57	  CONSTRAINT contract_line_items_unit_price_check
58	    CHECK (unit_price >= 0),
59	  CONSTRAINT contract_line_items_discount_percent_check
60	    CHECK (discount_percent >= 0 AND discount_percent <= 100)
61	);
```
- `product_code`: **VAR** (nullable, FK YOK — `024:42`, gerekçe `024:33`)
- `is_registration_fee`: **VAR** (`024:47`)
- `quantity` / `unit_price` / `discount_percent`: **VAR** (`024:44-46`)
- **immutability**: trigger **YOK**, CHECK **YOK**.
  ```
  $ grep -n -i -E "TRIGGER|FUNCTION|immutab|RULE" migrations/024_contract_line_items.sql
  29:--   -- updated_at YOK (tablo immutable; UPDATE/DELETE endpoint'i olmayacak)
  ```
  Tek dayanak yorum satırıdır (`024:29`) — DB seviyesinde zorlama yok; uygulama katmanında UPDATE/DELETE endpoint'i açılmaması varsayımına dayanır. Satır toplamı kolonu da yok (`024:28`).

### A5. Payment tarafı

#### payments (017)
`migrations/017_payments.sql:35-51`
```
35	CREATE TABLE payments (
36	  id             serial PRIMARY KEY,
37	  organizer_id   integer NOT NULL,
38	  contract_id    integer NOT NULL REFERENCES contracts(id),
39	  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
40	  currency       text NOT NULL,
41	  exchange_rate  numeric(18,8) NOT NULL CHECK (exchange_rate > 0),
42	  amount_eur     numeric(14,2) NOT NULL,
43	  payment_method text NOT NULL CHECK (payment_method IN
44	                 ('bank_transfer','cash','cheque','credit_card','other')),
45	  payment_date   date NOT NULL,
46	  notes          text,
47	  created_by     integer,
48	  created_at     timestamptz NOT NULL DEFAULT now()
49	);
51	CREATE INDEX idx_payments_contract_id ON payments (contract_id);
```
- payer alanı: **YOK**; account alanı: **YOK**. Açık not `017:21`:
  ```
  21	--   - account_id, payer      → ledger fazı (additive eklenecek)
  ```
- method: **VAR** (`017:43-44`, 5 değerli CHECK)
- rate: **VAR** (`017:41` exchange_rate + `042` amount_eur)

#### 018 — reversal
```
migrations/018_payment_reversal.sql:40-41:
  ALTER TABLE payments ADD COLUMN reverses_payment_id integer REFERENCES payments(id);
migrations/018_payment_reversal.sql:45-51:
  DROP CONSTRAINT payments_amount_check; ADD CONSTRAINT payments_amount_check (yeniden)
```
(İlgili partial UNIQUE `uq_payments_reverses_payment_id` — kodda karşılığı `routes/contracts.js:39-41`.)

#### 026 — offices + payment_schedule_items + payments ALTER
`migrations/026_payment_schedule.sql:26-35` — **offices**
```
26	CREATE TABLE offices (
27	  id           serial      PRIMARY KEY,
28	  name         text        NOT NULL,
29	  country_code char(2)     NOT NULL,
30	  is_active    boolean     NOT NULL DEFAULT true,
31	  created_at   timestamptz NOT NULL DEFAULT now(),
32	  CONSTRAINT offices_name_key UNIQUE (name),
33	  CONSTRAINT offices_country_code_fkey
34	    FOREIGN KEY (country_code) REFERENCES core_countries(code)
35	);
```
SEED 5 ofis: `026:38-44` (Turkey/TR, Morocco/MA, Nigeria/NG, Kenya/KE, China/CN).

`migrations/026_payment_schedule.sql:49-89` — **payment_schedule_items**
```
49	CREATE TABLE payment_schedule_items (
50	  id                 serial        PRIMARY KEY,
51	  organizer_id       integer       NOT NULL,
52	  contract_id        integer       NOT NULL,
53	  revision           integer       NOT NULL DEFAULT 1,
54	  item_no            integer       NOT NULL,
55	  due_date           date          NOT NULL,
56	  amount             numeric(14,2) NOT NULL,
57	  currency           text          NOT NULL,
58	  percent            numeric(5,2),
59	  source             text          NOT NULL,
60	  expected_office_id integer,
61	  expected_method    text,
62	  notes              text,
63	  superseded_at      timestamptz,
64	  created_by         integer,
65	  created_at         timestamptz   NOT NULL DEFAULT now(),
67-80	  FK'ler (contract_id, expected_office_id) + CHECK'ler:
	  amount > 0 · percent 0-100 · source IN ('manual_amount','manual_percent','default')
	  · expected_method IN (payments ile AYNI beş değer)
84	CREATE UNIQUE INDEX uq_payment_schedule_items_active_item
85	  ON payment_schedule_items (contract_id, item_no) WHERE superseded_at IS NULL;
88	CREATE INDEX ix_payment_schedule_items_contract
89	  ON payment_schedule_items (organizer_id, contract_id, due_date);
```
`026:95-97` — payments'a iki kolon:
```
95	ALTER TABLE payments
96	  ADD COLUMN schedule_item_id   integer REFERENCES payment_schedule_items(id),
97	  ADD COLUMN received_office_id integer REFERENCES offices(id);
```

#### 027 / 028
```
migrations/027_payout_office_method.sql:19-25
  ALTER TABLE commission_payouts
    ADD COLUMN paid_office_id integer CONSTRAINT commission_payouts_paid_office_id_fkey REFERENCES offices(id),
    ADD COLUMN payout_method  text;
  ADD CONSTRAINT commission_payouts_payout_method_check
migrations/028_agent_office.sql:21-23
  ALTER TABLE sales_agents
    ADD COLUMN office_id integer CONSTRAINT sales_agents_office_id_fkey REFERENCES offices(id);
```

### A6. Ledger / hesap envanteri

```
$ grep -n -i -E "accounts|transfers|ledger|budget|expense|revenue" migrations/*.sql initial.sql | grep -i "CREATE TABLE"
(çıktı yok)
```
```
$ grep -rn -i -E "\b(accounts|transfers|ledger|budgets?|expenses?|revenues)\b" migrations/*.sql initial.sql
migrations/017_payments.sql:21:--   - account_id, payer      → ledger fazı (additive eklenecek)
migrations/007_test_email_cleanup.sql:6:-- Why: These 5 addresses belong to Suer/Yaprak/Elan internal accounts that
```
Sonuç (VAR/YOK):
| Tablo | Durum |
|---|---|
| accounts | **YOK** |
| two-sided transfers | **YOK** |
| owner current account (cari) | **YOK** (tablo olarak; agent cari *raporu* için bkz. B4 — `routes/payouts.js:206`) |
| budget | **YOK** |
| expenses | **YOK** |
| revenues | **YOK** (tablo yok; `contracts.revenue` / `revenue_eur` kolonları var — A3-d) |

Var olan finans tabloları (A2'den): `contracts`, `contract_line_items`, `payments`, `payment_schedule_items`, `commission_payouts`, `offices`, `sales_agents`.

### A7. expos deadline + trigger konfig

```
$ grep -n -i -E "deadline|days_before|catalogue" migrations/*.sql initial.sql
migrations/010_expo_operations.sql:21:--   D2 deadlines → 8 NULLable DATE columns (override store). Backend reads
migrations/010_expo_operations.sql:104:ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_1_days_before             INTEGER DEFAULT 3;
migrations/010_expo_operations.sql:105:ALTER TABLE expos ADD COLUMN IF NOT EXISTS buildup_2_days_before             INTEGER DEFAULT 2;
migrations/010_expo_operations.sql:106:ALTER TABLE expos ADD COLUMN IF NOT EXISTS standard_buildup_days_before      INTEGER DEFAULT 1;
migrations/010_expo_operations.sql:107:ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_deadline_days_before    INTEGER DEFAULT 25;
migrations/010_expo_operations.sql:108:ALTER TABLE expos ADD COLUMN IF NOT EXISTS stand_design_deadline_days_before INTEGER DEFAULT 25;
migrations/010_expo_operations.sql:109:ALTER TABLE expos ADD COLUMN IF NOT EXISTS payment_deadline_days_before      INTEGER DEFAULT 30;
migrations/010_expo_operations.sql:110:ALTER TABLE expos ADD COLUMN IF NOT EXISTS visa_deadline_days_before         INTEGER DEFAULT 40;
migrations/010_expo_operations.sql:113:-- 8 deadline overrides (D2: NULL = compute from offset; set = manual override)
migrations/010_expo_operations.sql:117:ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_submission_deadline      DATE;
migrations/010_expo_operations.sql:118:ALTER TABLE expos ADD COLUMN IF NOT EXISTS stand_design_confirmation_deadline DATE;
migrations/010_expo_operations.sql:119:ALTER TABLE expos ADD COLUMN IF NOT EXISTS payment_deadline                   DATE;
migrations/010_expo_operations.sql:120:ALTER TABLE expos ADD COLUMN IF NOT EXISTS visa_support_deadline              DATE;
migrations/010_expo_operations.sql:124:ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_form_url               VARCHAR(500);
migrations/010_expo_operations.sql:168-173: (010 içi kolon adı listesi — allowlist)
migrations/016_contract_operational_columns.sql:23:  ADD COLUMN catalogue_page               text,
```
Yapı: 7 adet `*_days_before` INTEGER offset (DEFAULT'lu) + `breakdown_days_after` (`010:170`) ve 8 adet NULLable DATE override. Efektif tarih okuma-anında COALESCE ile türetilir (bkz. B5c, `routes/expos.js:123-129`). DB trigger'ı **YOK** (arama: yukarıdaki grep'te TRIGGER eşleşmesi yok).

### A8. expo_partners ve expo_clusters

```
$ grep -n -i -E "CREATE TABLE.*(expo_partners|expo_clusters)" migrations/*.sql
migrations/010_expo_operations.sql:72:CREATE TABLE IF NOT EXISTS expo_clusters (
migrations/010_expo_operations.sql:140:CREATE TABLE IF NOT EXISTS expo_partners (
```
İkisi de **VAR**.

### A9. users tablosu

```
$ grep -rn -i "CREATE TABLE.*users" migrations/ initial.sql
migrations/032_users_and_first_owner.sql:31:CREATE TABLE IF NOT EXISTS users (
```
**VAR** (beklenen "yok" değil — 032 ile eklenmiş; commit `bbc69ff`, E1).
`migrations/032_users_and_first_owner.sql:31-48`
```
31	CREATE TABLE IF NOT EXISTS users (
32	  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
33	  organizer_id         integer NOT NULL REFERENCES organizers(id),
34	  email                text NOT NULL UNIQUE,
38	  password_hash        text,
40	  is_owner             boolean NOT NULL DEFAULT false,
43	  display_role         text,
45	  password_must_change boolean NOT NULL DEFAULT true,
46	  is_active            boolean NOT NULL DEFAULT true,
47	  created_at           timestamptz NOT NULL DEFAULT now()
48	);
```
`032:41-42` — display_role yetkide kullanılmaz notu:
```
41	  -- B9: SALT GÖSTERİM. Authorization'da KULLANILMAZ (yetki = permission matrix
42	  -- + scope + is_owner, dilim 4). Hiçbir kod buna göre yetki vermez.
```
`032:59` — `CREATE OR REPLACE FUNCTION enforce_min_one_active_owner()` (B10 statement-level trigger).
Not: E2-Q5'te yerel `leena_v401` tablo listesinde `users` **görünmüyor** (bkz. E2).

### A10. sales_agents kolonları

CREATE — `migrations/012_finance_foundation.sql:31-43`
```
31	CREATE TABLE IF NOT EXISTS sales_agents (
32	  id           serial      NOT NULL,
33	  organizer_id integer     NOT NULL,
34	  name         text        NOT NULL,
35	  agent_type   text        NOT NULL,
36	  user_id      integer,
37	  created_by   integer,
38	  created_at   timestamptz NOT NULL DEFAULT now(),
39	  updated_at   timestamptz NOT NULL DEFAULT now(),
40	  CONSTRAINT sales_agents_pkey PRIMARY KEY (id),
41	  CONSTRAINT sales_agents_agent_type_check
42	    CHECK (agent_type = ANY (ARRAY['internal', 'external_agency', 'external_freelance']))
43	);
```

| İstenen | Durum | Kanıt |
|---|---|---|
| default_commission_pct | **VAR** | `migrations/020_commission_agents.sql:49` `ADD COLUMN default_commission_pct numeric(5,2);` + range CHECK `020:53` |
| default_director_pct | **VAR** | `migrations/022_sales_agents_import_prep2.sql:27` + range CHECK `022:31-32` |
| is_active | **VAR** | `migrations/021_sales_agents_import_prep.sql:59` `ADD COLUMN is_active boolean NOT NULL DEFAULT true` |
| user_id nullable + external CHECK | **VAR** | `012:36` (nullable, UNIQUE `014:32-33` `sales_agents_user_id_key`); 014'teki `sales_agents_type_user_link_check` **021:46-47'de DROP edildi**, yerine `021:49-51` `sales_agents_external_user_null_check CHECK (agent_type = 'internal' OR user_id IS NULL)` |
| zoho_record_id UNIQUE | **VAR (partial)** | `021:60` kolon + `021:64-66` `CREATE UNIQUE INDEX uq_sales_agents_zoho_record_id ON sales_agents (zoho_record_id) WHERE zoho_record_id IS NOT NULL` |

Ek kolonlar (aynı ALTER'lar): `email`, `sales_group`, `agent_company`, `commission_currency char(3)` (`021:55-58`); `sales_team`, `country` (`022:28-29`); `office_id` (`028:22`).

### A11. Audit

```
$ grep -rn -i -E "CREATE TABLE.*(audit|history|_log|_logs|activity)" migrations/*.sql initial.sql
migrations/000_production_baseline_tables.sql:124:CREATE TABLE IF NOT EXISTS public.import_logs (
initial.sql:111:CREATE TABLE IF NOT EXISTS email_logs (
```
Genel audit/history/activity tablosu: **YOK**. Var olan iki tablo alan-özel log'dur (import, email).

```
$ grep -n "created_by\|modified_by" migrations/*.sql | cut -d: -f1 | sort | uniq -c
   3 migrations/001_floorplan_tables.sql
   1 migrations/004_sequence_campaigns.sql
   3 migrations/012_finance_foundation.sql
   1 migrations/017_payments.sql
   1 migrations/025_commission_payouts.sql
   1 migrations/026_payment_schedule.sql
$ grep -n "created_by\|modified_by" initial.sql
(çıktı yok)
```
`modified_by`: hiçbir dosyada eşleşme yok (yukarıdaki grep her iki deseni birlikte arar; `created_by` eşleşmeleri listelenmiştir).
`contracts` audit kolonları iki tip: `012:81-82` `created_by integer` + `converted_by uuid`, gerekçe `012:62-63`.

### A12. catalogue_submission / catalogue_template türü tablo

```
$ grep -rn -i -E "catalogue_submission|catalogue_template|catalog_submission" migrations/ routes/ initial.sql
migrations/010_expo_operations.sql:117:ALTER TABLE expos ADD COLUMN IF NOT EXISTS catalogue_submission_deadline      DATE;
migrations/010_expo_operations.sql:171:  'buildup_day_1',...,'catalogue_submission_deadline',
routes/expos.js:126, 193, 261, 279, 425  (aynı kolon adının okunması/yazılması)
```
Tablo: **YOK**. Yalnız `expos` üzerinde `catalogue_submission_deadline` DATE kolonu ve `catalogue_form_url` (`010:124`), `contracts.catalogue_page` (`016:23`) mevcut.

---

## B. LEENA ROUTE/ENDPOINT ENVANTERİ

### B1. routes/ listesi ve sayım

```
$ ls -1 routes/
auth.js  badgeTemplates.js  callcenter.js  campaignBuilder.js  campaigns.js
cashForecast.js  checkinReports.js  checkins.js  clusters.js  commissions.js
conferenceCertificates.js  conferenceCleanup.js  contracts.js  emailInbound.js
emailSegments.js  emailSend.js  emailTemplates.js  emailTracking.js  exhibitors.js
expos.js  floorplan.js  forms.js  import-checkins.js  leads.js  offices.js
organizers.js  partners.js  payouts.js  reactivation.js  reference.js  reports.js
salesAgents.js  terminalCheckins.js  terminals.js  unsubscribes.js  visitors.js
visitors.js.bak  webhook.js
```
(37 .js + 1 .bak)

```
$ grep -rn -E "router\.(get|post|put|delete)" routes/ | wc -l
204
```
(Bu sayı `routes/visitors.js.bak` içindeki 5 satırı da içerir.)

Finans/RTM ile doğrudan ilgili route path'leri (tam liste komutu: `grep -rn -E "router\.(get|post|put|delete)\(" routes/`):
```
routes/contracts.js:78:   router.post('/convert', authMiddleware, ...)
routes/contracts.js:228:  router.get('/', authMiddleware, ...)
routes/contracts.js:413:  router.get('/:id', authMiddleware, ...)
routes/contracts.js:485:  router.put('/:id/status', authMiddleware, ...)
routes/contracts.js:561:  router.post('/:id/payments', authMiddleware, ...)
routes/contracts.js:705:  router.get('/:id/payments', authMiddleware, ...)
routes/contracts.js:761:  router.post('/:id/payments/:paymentId/reverse', authMiddleware, ...)
routes/contracts.js:873:  router.post('/:id/transfer', authMiddleware, ...)
routes/contracts.js:1035: router.put('/:id/assignment', authMiddleware, ...)
routes/contracts.js:1190: router.get('/:id/schedule', authMiddleware, ...)
routes/contracts.js:1231: router.post('/:id/schedule', authMiddleware, ...)
routes/contracts.js:1354: router.post('/:id/schedule/default', authMiddleware, ...)
routes/payouts.js:52:     router.post('/:id/payouts', authMiddleware, ...)
routes/payouts.js:206:    router.get('/:id/statement', authMiddleware, ...)
routes/commissions.js:46: router.get('/', authMiddleware, ...)
routes/cashForecast.js:175: router.get('/', authMiddleware, ...)
routes/offices.js:37/52/70: GET / · POST / · PUT /:id
routes/salesAgents.js:44/115/146: GET / · POST / · PUT /:id
```

### B2. routes/contracts.js — POST /convert

| İstenen | Durum | Kanıt (dosya:satır) |
|---|---|---|
| status ≠ signed guard | **VAR** | `routes/contracts.js:95-97` — `if (b.status !== 'signed') return res.status(400)...'Only a signed quote can be converted to a contract.'` |
| idempotency / 23505 | **VAR** | `routes/contracts.js:31-51` `mapWriteError`; `:32` `err.code === '23505'`; `:34-36` `err.constraint === 'idx_contracts_source_quote_id'` → **409**. Index adı bağımlılığı migration'da da uyarılmış: `migrations/012_finance_foundation.sql:101-104` |
| Q→A prefix üretimi kodda mı | **LEENA'da YOK** | `routes/contracts.js:67,90-91,180` — `af_number` payload'dan okunur, zorunlu alan; üretilmez. No-recompute notu `routes/contracts.js:9`. Prefix üretimi **LIFFY tarafında**: `~/Projects/liffyv1/backend/routes/quotes.js:24-29` (bkz. D2). LEENA'da tek af üretimi transfer zinciri içindir: `routes/contracts.js:851-857` `nextTransferAf` (`-T{n}` soneki) |
| line_items kabulü | **VAR** | `routes/contracts.js:99-139` (tip kontrolü `:102-105`, satır bazlı doğrulama `:112-139`, `line_no` server atar `:114`, `currency` server kopyalar `:206`) |
| grand_total ↔ revenue ±0.01 (L3/L4) | **VAR** | `routes/contracts.js:141-152` — `:143` `grand_total = round2(items.reduce(...))`, `:148` `if (Math.abs(grand_total - revenue) > 0.01)` → 400. Kontrol INSERT'lerden ÖNCE (`:141` yorumu) |
| atomiklik | **VAR** | `routes/contracts.js:160` BEGIN · `:199-208` satır INSERT'leri aynı transaction · `:210` COMMIT · `:213` ROLLBACK |
| status yazımı | `'Active'` sabit | `routes/contracts.js:187` — `'Active', // contract doğduğu an Active (no Draft)` |

### B3. PUT /:id/assignment + XOR 400'leri + transfer

`routes/contracts.js:1035` — `router.put('/:id/assignment', authMiddleware, ...)` **VAR**
```
1050	  if (agent != null && sr != null)  → 400 'Agent and SR are mutually exclusive.'
1054	  if (sd != null && sr == null)     → 400 'SD requires an SR.'
1058	  if (agentPct != null && agent == null) → 400 'Percentage requires an agent.'
1061	  if (srPct != null && sr == null)       → 400 'Percentage requires an agent.'
1064	  if (sdPct != null && sd == null)       → 400 'Percentage requires an agent.'
1068	  if (!isPct(agentPct) || !isPct(srPct) || !isPct(sdPct)) → 400 '... between 0 and 100.'
1088-1095	FK organizer-scope doğrulaması → 400 'Unknown sales agent.'
```
Transfer endpoint'i: **VAR** — `routes/contracts.js:873` `router.post('/:id/transfer', authMiddleware, ...)`; af üretimi `:915` `nextTransferAf(source.af_number)`, yeni kayıt `:926` (`transferred_from_contract_id, af_number`), ödeme taşıma notu `:987`.

### B4. Rapor endpoint'leri

| Rapor | Durum | Kanıt |
|---|---|---|
| cashForecast | **VAR** | `routes/cashForecast.js:175` `router.get('/', authMiddleware, ...)`; başlık `cashForecast.js:6` "GET /api/cash-forecast — Nakit öngörü raporu (PS3-B): ofis × vade, EUR"; türetilmiş/saklama yok notu `:7-8` |
| commission kesim | **VAR** | `routes/commissions.js:46` `router.get('/', authMiddleware, ...)`; başlık `commissions.js:3` "K7c (kesim) + U1a (tavan kümülatif-marjinal) + U2a (payment_date DATE, takvim)"; hesap yardımcı dosyası `utils/commissionSlices.js` |
| agent statement (cari) | **VAR** | `routes/payouts.js:206` `router.get('/:id/statement', authMiddleware, ...)`; başlık `payouts.js:5` "GET /api/agents/:id/statement → earned (türetilmiş) / paid / balance / payouts[]"; payout yazımı `payouts.js:52` |

### B5. Email altyapısı

Dosyalar:
```
$ ls -1 email_worker.js utils/ ; find . -maxdepth 2 -name "*email*" -not -path "./node_modules/*"
email_worker.js
email_worker_backup.js
utils/email.js  utils/trackingPixel.js  utils/unsubscribe.js  utils/callCenterReport.js
routes/emailTracking.js  routes/emailSend.js  routes/emailSegments.js
routes/emailTemplates.js  routes/emailInbound.js
public/email_templates/modern-default.html
public/email-campaigns.html  public/email-history.html  public/email-segments.html
public/email-send.html  public/email-templates.html
migrations/004_sequence_campaigns.sql  migrations/031_callcenter_email_queue_indexes.sql
tests/test_email_segments_smoke.js
```
`services/` ve `workers/` dizinleri: **YOK** (`ls: services/: No such file or directory`, `ls: workers/: No such file or directory`).

**8 operasyonel aşama adları**: 
```
$ grep -rn -i -E "\b(welcome_email|buildup_email|stand_design_email|catalogue_email|payment_reminder|visa_support|operational_email)\b" routes/ utils/ email_worker.js migrations/ public/
(çıktı yok)
```
Operasyonel e-posta aşaması olarak adlandırılmış kod/tablo: **YOK**. Geniş grep (`welcome|buildup|badge|payment.?reminder|stand.?design|catalogue`) yalnızca (a) `expos` deadline kolonlarını (`routes/expos.js`, aşağıda B5c), (b) ziyaretçi badge/QR akışını (`routes/visitors.js:125-500`, `routes/terminals.js`) ve (c) sertifika/transactional metinleri (`routes/emailTracking.js:182,243`) döndürür — aşama motoru değil.

**marketing/operational flag**:
```
$ grep -rn -i -E "is_marketing|is_operational|email_type|campaign_type|'marketing'|'operational'" routes/ utils/ migrations/ email_worker.js
migrations/004_sequence_campaigns.sql:132:CREATE INDEX IF NOT EXISTS idx_events_email_type ON email_events(email, event_type);
routes/callcenter.js:180://   opened/clicked  → idx_events_email_type (email, event_type) — existing
```
marketing/operational ayrım flag'i: **YOK** (iki eşleşme de `email_events(email, event_type)` index adıdır — event türü, kampanya sınıfı değil).

**B5c. `*_days_before` okuyan kod**: **VAR** — `routes/expos.js`
```
routes/expos.js:123: COALESCE(e.buildup_day_1, (e.start_date - e.buildup_1_days_before * INTERVAL '1 day')::date) AS buildup_day_1_effective,
routes/expos.js:124: ... buildup_day_2_effective
routes/expos.js:125: ... standard_buildup_day_effective
routes/expos.js:126: ... catalogue_submission_deadline_effective
routes/expos.js:127: ... stand_design_confirmation_deadline_effective
routes/expos.js:128: ... payment_deadline_effective
routes/expos.js:129: ... visa_support_deadline_effective
routes/expos.js:190-192, 258-260, 276-278, 422-424, 438: allowlist / INSERT / clone
```
Okuma yalnız `routes/expos.js` içindedir; `email_worker.js` veya herhangi bir zamanlayıcı bu kolonları okumaz (grep kapsamı: `routes/ utils/ email_worker.js public/`).

**B5d. resend endpoint'i**:
```
routes/conferenceCertificates.js:626: router.post('/resend', terminalAuth, ...)
routes/reactivation.js:973:          router.post('/resend-pending', authMiddleware, ...)
routes/callcenter.js:577:          router.post('/resend/:id', agentAuth, ...)
```
Üç adet **VAR**; üçü de sertifika / reactivation / call-center bağlamındadır — sözleşme-operasyon e-postası resend'i **YOK**.

### B6. Global search / notification

Global search endpoint'i:
```
$ grep -rn -i -E "router\.(get|post)\(['\"]/search|globalSearch|/api/search" routes/ index.js
(çıktı yok)
```
**YOK**.

Notification tablosu/endpoint'i: **tablo YOK, endpoint YOK**. Var olan tek mekanizma form-bazlı satış bildirimi (kuyruğa e-posta atar):
```
routes/visitors.js:240:  let formNotificationConfig = null;   // Sales notification config (Suer K1: forms.config.notification)
routes/visitors.js:431-470: PER-FORM SALES NOTIFICATION bloğu (forms.config.notification jsonb; fail-open)
routes/auth.js:109: const notificationEmail = {
```

### B7. middleware/authMiddleware.js — tam içerik

```
$ ls -la middleware/
auth.js (1166b) · authMiddleware.js (634b) · callCenterAgentAuth.js · callCenterSupervisorAuth.js
dualAuth.js · terminalAuth.js

$ cat -n middleware/authMiddleware.js
     1	// middleware/authMiddleware.js
     2	const jwt = require('jsonwebtoken');
     3	require('dotenv').config({ path: '../.env' });
     4	
     5	function authenticateToken(req, res, next) {
     6	    const authHeader = req.headers['authorization'];
     7	    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
     8	
     9	    if (token == null) {
    10	        return res.sendStatus(401); // Unauthorized
    11	    }
    12	
    13	    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    14	        if (err) {
    15	            return res.sendStatus(403); // Forbidden
    16	        }
    17	        req.organizer_id = decoded.organizer_id;
    18	        next();
    19	    });
    20	}
    21	
    22	module.exports = authenticateToken;
```
role kontrolü: **YOK**. permission kontrolü: **YOK**. Token'dan okunan tek alan `decoded.organizer_id` (`:17`) — yani **yalnız organizer_id scope'u**.

### B8. FAZ 4 yer işaretleri

```
$ grep -rn "FAZ 4" routes/ middleware/
routes/cashForecast.js:176:  // FAZ 4: finance-read permission kontrolü buraya (commissions emsali).
routes/commissions.js:47:   // FAZ 4: commission-read permission kontrolü buraya (convert emsali; bugün
routes/contracts.js:82:     // FAZ 4: convert-permission kontrolü buraya (user_permissions matrisi B21-B42
routes/contracts.js:489:    // FAZ 4: status-change permission kontrolü buraya (user_permissions matrisi
routes/contracts.js:565:    // FAZ 4: payment-create permission kontrolü buraya (user_permissions matrisi
routes/contracts.js:764:    // FAZ 4: reversal-permission kontrolü buraya (user_permissions matrisi
routes/contracts.js:877:    // FAZ 4: transfer-permission kontrolü buraya (user_permissions matrisi
routes/contracts.js:1039:   // FAZ 4: assignment-permission kontrolü buraya (user_permissions B21-B42).
```
8 yer işareti; `middleware/` altında eşleşme yok.

---

## C. LEENA UI ENVANTERİ

### C1. public/*.html ve public/ui2/

```
$ ls -1 public/*.html
admin-dashboard.html  agent-statement.html  badge-print.html  badge-templates.html
badge.html  bulk-badge-print.html  cash-forecast.html  certificate-mp26.html
certificate-ng.html  certificate.html  checkin-import.html  checkin-reports.html
checkins.backup.html  checkins.html  commissions.html  conference-cleanup.html
conference-scanner.html  conference-sessions.html  contract-detail.html
contract-list.html  dashboard.backup.html  dashboard.html  dashboard_new.html
email-campaigns.html  email-history.html  email-segments.html  email-send.html
email-templates.html  expo-clusters.html  expo-create.backup.html  expo-create.html
expo-form.html  expo-list.html  expo-partners.html  floorplan-builder.html
form-builder.html  form-list.html  form-public.html  hostess-guide.html  import.html
lead-scan.html  login.html  login_new.html  main-panel-v2.html  main-panel.backup.html
main-panel.html  offices.html  qrscanner.backup.html  qrscanner.html  reactivate-fr.html
reactivate.html  reactivation-campaign.html  register.backup.html  register.html
reports.backup.html  reports.html  sales-agents.html  terminals.html
visitorlog-paginated.html
```
(58 dosya; 7'si `.backup.html`)

```
$ ls -1R public/ui2/
finance-contract.html
index.html
operations.html
sales.html
shell.js
styles

public/ui2/styles:
signal.css
themes.css
```

### C2. contract-detail.html kartları

```
$ grep -n -i -E "card-title|nav-section-title|<h1>" public/contract-detail.html
102:  <div class="nav-section-title">Finance</div>
124:  <h1><i class="bi bi-file-earmark-text"></i> <span id="pageTitle">Contract</span></h1>
130:  <div class="card-title">Contract</div>
137:  <div class="card-title">Money</div>
142:  <div class="card-title">Operational</div>
147:  <div class="card-title">Commission</div>
156:  <div class="card-title">Line Items</div>
178:  <div class="card-title">Payment Schedule</div>
183:  <div class="card-title">Payments</div>
204:  <div class="card-title">Add payment</div>
```
Kartlar (8): Contract · Money · Operational · Commission · Line Items · Payment Schedule · Payments · Add payment.
Transfer ayrı kart değil, buton: `public/contract-detail.html:694` `onclick="openTransferForm()"` — "Transfer to another expo".
Komisyon tabanı line-items'a bağlı: `:761` ve `:811` (`— (line items missing)`), `:830` `Commissionable Base`.

### C3. ui2 altındaki Finance ekranları

```
$ grep -n -i -E "finance|contract|commission|payout|forecast|schedule" public/ui2/shell.js public/ui2/index.html
public/ui2/index.html:22:    <strong>Finance</strong>.
public/ui2/shell.js:15:  // Alt-etiket brief :32-34: Sales(liffy) · Operations(leena) · Finance(yok).
public/ui2/shell.js:19:  { key: 'finance',    main: 'Finance',    sub: '',      href: 'finance-contract.html' },
public/ui2/shell.js:23-24:  // Emsal: ... AYNI subnav'ı kendi içine KOPYALIYOR
                            // (War Room·Expos·Ledger·Contracts·Commissions·Reports) — kaçındığımız tekrar.
public/ui2/shell.js:27:  // Bugün Finance'ta tek gerçek ekran var (Contract); yapı ikinciyi taşımaya hazır —
public/ui2/shell.js:30-31:  finance: [ { key: 'contract', label: 'Contracts', href: 'finance-contract.html' } ]
```
ui2 Finance altında kurulu ekran: **1 adet** — `finance-contract.html`. (`shell.js:24`'te anılan War Room · Expos · Ledger · Commissions · Reports subnav'ı tasarım mockup'ına aittir, ui2'de kurulu değildir.)

---

## D. LIFFY ENVANTERİ (yalnız dosya okuması)

**LIFFY DB: erişim yok** (env yok; görev tanımı gereği bağlanılmadı).

### D1. migrations listesi

```
$ ls -1 migrations/ | tail -20
033_add_visibility_columns.sql        034_phase4_person_id_columns.sql
035_create_sequences.sql              036_allow_null_template_id.sql
037_create_action_items.sql           038_add_manager_id.sql
039_adr015_hierarchical_permissions.sql  040_template_sender_visibility.sql
041_allow_multiple_reply_actions.sql  042_cleanup_company_industry.sql
043_create_discovery_searches.sql     044_drop_status_check_constraints.sql
045_varchar_to_text.sql               046_create_companies.sql
047_create_mining_results.sql         048_add_sales_owner_user_id.sql
049_add_source_mining_job_id.sql      050_add_offices_expos_catalog.sql
051_add_quotes.sql                    052_quotes_company_name.sql
$ ls -1 migrations/ | wc -l
52
```
```
$ grep -n "CREATE TABLE" migrations/050*.sql migrations/051*.sql
migrations/050_add_offices_expos_catalog.sql:23:CREATE TABLE IF NOT EXISTS offices (
migrations/050_add_offices_expos_catalog.sql:78:CREATE TABLE IF NOT EXISTS expos (
migrations/050_add_offices_expos_catalog.sql:132:CREATE TABLE IF NOT EXISTS products (
migrations/050_add_offices_expos_catalog.sql:180:CREATE TABLE IF NOT EXISTS product_prices (
migrations/050_add_offices_expos_catalog.sql:227:CREATE TABLE IF NOT EXISTS exchange_rates (
migrations/051_add_quotes.sql:31:CREATE TABLE IF NOT EXISTS quotes (
migrations/051_add_quotes.sql:112:CREATE TABLE IF NOT EXISTS quote_line_items (
```

### D2. quotes şeması (051)

```
migrations/051_add_quotes.sql:26:  CREATE SEQUENCE IF NOT EXISTS quote_af_seq START WITH 100000;
migrations/051_add_quotes.sql:31-74:
31	CREATE TABLE IF NOT EXISTS quotes (
32	    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
33	    organizer_id UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
36	    af_sequence BIGINT NOT NULL DEFAULT nextval('quote_af_seq'),
39	    office_id UUID NOT NULL REFERENCES offices(id),
40	    expo_id UUID NOT NULL REFERENCES expos(id),
41	    company_id UUID NOT NULL REFERENCES companies(id),
42	    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
45	    sales_owner_user_id UUID NOT NULL REFERENCES users(id),
48	    subject TEXT NOT NULL,             -- app olusturma aninda uretir, duzenlenebilir; Sent'te donar
49	    status TEXT NOT NULL DEFAULT 'draft',
50	    currency CHAR(3) NOT NULL,
51	    exchange_rate_to_eur NUMERIC NOT NULL,  -- olusturmada exchange_rates'ten kopyalanir, dondurulur
54	    valid_until DATE,
55	    sent_at TIMESTAMPTZ,
56	    signed_at DATE,
57	    declined_at TIMESTAMPTZ,
60	    signed_scan_url TEXT,              -- Drive linki; signed'a gecis sarti APP'te (DB'de degil)
61	    notes TEXT,
64	    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
67-68	    created_at / updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
71	    CONSTRAINT uq_quotes_af_sequence UNIQUE (af_sequence),
72	    CONSTRAINT chk_quotes_status CHECK (status IN ('draft', 'sent', 'signed', 'declined')),
73	    CONSTRAINT chk_quotes_rate_positive CHECK (exchange_rate_to_eur > 0)
74	);
```

| İstenen | Durum | Kanıt |
|---|---|---|
| subject üretimi | **VAR — app katmanında** | Kolon `051:48` (DB'de üretim yok). Üretim: `routes/quotes.js:501-502` `// Generate subject: {Expo}-{Company}-{totalM2}SQM or {Expo}-{Company}` → `const resolvedSubject = customSubject \|\| (totalM2 > 0 ...)`. Sent sonrası kilit: `routes/quotes.js:699,713` `'Cannot change subject after sending'` |
| AF / quote number format (Q{ISO}) | **VAR — app katmanında** | `routes/quotes.js:24-29`:<br>`24  * Derive AF display number: Q/A prefix + office.code + '-' + af_sequence.`<br>`27  const prefix = quote.status === 'signed' ? 'A' : 'Q';`<br>`29  return \`${prefix}${code}-${quote.af_sequence}\`;`<br>DB'de saklanmaz: `051:3`, `051:24`, `051:99-100` (COMMENT) |
| currency + frozen EUR | **VAR** | `051:50` `currency CHAR(3) NOT NULL`; `051:51` `exchange_rate_to_eur NUMERIC NOT NULL` (snapshot/frozen — `051:101` COMMENT "Frozen — not updated when rates change") |
| signed scan / upload alanı | **VAR (URL alanı)** | `051:60` `signed_scan_url TEXT`; zorunluluk app'te: `routes/quotes.js:1035-1037` `if (!signed_scan_url ...) return 400 'signed_scan_url is required for signing'`; `:1044` `UPDATE quotes SET status = 'signed', signed_scan_url = $3, signed_at = $4`. Dosya yükleme (storage) alanı **YOK** — yalnız Drive linki (`051:60` yorumu, `051:103` COMMENT) |

quote_line_items `051:112-138`: `product_id` (SET NULL), `description`, `unit_type` CHECK ('m2','unit'), `quantity`, `unit_price`, `discount_percent`, `tax_percent`, `sort_order`. `line_total` **saklanmaz** (`051:110`).

### D3. Lead tarafı

**Disqualification sebep taksonomisi: VAR (app sabiti, DB'de değil)**
```
$ grep -rn -i -E "disqualif|not_interested|reject_reason|lost_reason|dq_reason" migrations/ routes/ services/
routes/pipeline.js:22:  const LOST_REASONS = [
routes/pipeline.js:24:    'not_interested', 'no_budget', 'competitor', 'wrong_profile', 'bad_timing', 'other',
routes/pipeline.js:367:  if (!LOST_REASONS.includes(r)) return res.status(400).json({ error: `Geçersiz eleme sebebi: ${r}` });
```
Migration'da sebep tablosu/CHECK'i: **YOK**. İlgili commit: `c7f016f feat(liffy): require disqualification reason when moving lead to Lost stage` (E1).

**Dedup alanları: yalnız e-posta**
```
services/validators/deduplicator.js:6:   * - Merge by email (primary key)
services/validators/deduplicator.js:24:  // Group by email (lowercase)
services/validators/deduplicator.js:30:  const key = contact.email.toLowerCase().trim();
services/validators/deduplicator.js:74:  const merged = { email: group[0].email.toLowerCase() };
services/validators/deduplicator.js:77:  const fields = ['name','company','phone','website','country','city','address','title'];
```
`:77` listesi merge sırasında **doldurulan** alanlardır, anahtar değil. Domain veya company dedup anahtarı: **YOK**.
Ayrı bir şirket-adı dedup anahtarı company tablosunda mevcuttur (lead dedup'ından bağımsız):
```
migrations/046_create_companies.sql:22: name_normalized VARCHAR(500) NOT NULL,  -- lowercased, trimmed, dedup key
migrations/046_create_companies.sql:52: -- Dedup constraint: one canonical name per organizer
```
Mining job seviyesinde ayrı duplicate kontrolü: `routes/miningJobs.js:304-344` (`force=true` atlar, `:276`).

**Routing / fallback queue: YOK**
```
$ grep -rn -i -E "fallback|queue_assign|assign_to|round_robin|routing_rule" migrations/ routes/
(eşleşmeler yalnız: sender fallback routes/testEmail.js:92 · JWT legacy fallback routes/auth.js:7 ·
 kampanya canonical-resolve fallback routes/campaigns.js:487-537,1092-1124)
```
Lead routing kuralı / round-robin / fallback kuyruğu: **YOK**.

**Manuel tek-lead create endpoint'i: VAR**
```
$ grep -rn -E "router\.post" routes/leads.js routes/persons.js
routes/persons.js:628: router.post('/', authRequired, ...)         ← manuel tek kayıt
routes/leads.js:138:   router.post('/import', authRequired, ...)   ← toplu import
routes/leads.js:406:   router.post('/:id/tags', authRequired, ...)
routes/leads.js:444:   router.post('/bulk-tags', authRequired, ...)
```
İlgili commit: `8b0aada feat(liffy): add POST /api/persons with creator-owned default and authorized owner assignment` (E1).

### D4. Reply parse / qualification / intent

**Intent: VAR** — `migrations/017_create_prospect_intents.sql`
```
017:5-6   "A prospect is a person who has demonstrated intent (reply, form submission, manual qualification)."
017:13-14 "Intent signals are events, not status flags."
017:23-24 intent_type VARCHAR(30) NOT NULL CHECK (intent_type IN (...))
017:27    'manual_qualification',-- manually qualified by user
017:68    COMMENT: 'Intent layer — records that a person demonstrated interest. Mining never writes here.'
```
Route: `routes/intents.js` **VAR** (duplicate guard `routes/intents.js:250` → 409).
`qualification`: bağımsız bir yapı **YOK** — yalnız intent_type değeri olarak `manual_qualification` (`017:27`).
`enrich`: `migrations/` içinde eşleşme **YOK**; `routes/` altında enrich adlı dosya **YOK** (`ls -1 routes/ | grep -i -E "intent|qualif|enrich"` → yalnız `intents.js`).
Reply parse: `migrations/041_allow_multiple_reply_actions.sql` ve `routes/webhooks.js` mevcut (intent kaynağı olarak `017:74` "webhook (automated from SendGrid)").

### D5. users tablosu + office_id

```
$ grep -rn "CREATE TABLE.*users" migrations/*.sql
migrations/004_create_organizers_users_sender_identities.sql:21:CREATE TABLE users (

004:21-30
21	CREATE TABLE users (
22	    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
23	    organizer_id UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
24	    email VARCHAR(255) NOT NULL,
25	    password_hash TEXT NOT NULL,
26	    role VARCHAR(20) NOT NULL DEFAULT 'user',  -- 'owner', 'admin', 'user'
27	    is_active BOOLEAN NOT NULL DEFAULT TRUE,
28	    created_at TIMESTAMP DEFAULT NOW(),
29	    CONSTRAINT users_email_unique UNIQUE (email)
30	);
```
office_id: **VAR (sonradan ALTER)** — `migrations/050_add_offices_expos_catalog.sql:68`
```
64	-- 2) USERS: office_id kolonu
66	-- Mevcut 13 kolon; office_id cakismasi yok (dogrulandi).
67	-- NULL = henuz atanmamis. Suer manuel atar.
68	ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES offices(id) ON DELETE SET NULL;
70	CREATE INDEX IF NOT EXISTS idx_users_office ON users(office_id) WHERE office_id IS NOT NULL;
```
(Not: LIFFY `users.role` VARCHAR(20) `:26` — LEENA `users.display_role`'ün aksine burada yorum satırıyla "yetkide kullanılmaz" notu yoktur.)

### D6. canonical_expo_id

**VAR** — `migrations/050_add_offices_expos_catalog.sql:90`
```
76	-- canonical_expo_id = ileride LEENA/ELIZA entegrasyonu icin hazirlik (FK YOK, sadece UUID referansi).
90	    canonical_expo_id UUID,     -- ileride LEENA/ELIZA expos.id ile eslesme (FK YOK — cross-system soft ref)
121	COMMENT ON TABLE expos IS '... canonical_expo_id is a soft ref to LEENA/ELIZA (no FK).'
122	COMMENT ON COLUMN expos.canonical_expo_id IS 'Soft reference to LEENA/ELIZA expos table. No FK constraint — cross-system integration key.'
```

### D7. ref_* tabloları

```
$ grep -rn "ref_" migrations/*.sql
(çıktı yok)
```
**YOK** (beklenen ile uyumlu).

### D8. products / product_prices / exchange_rates (050)

```
migrations/050_add_offices_expos_catalog.sql:132:CREATE TABLE IF NOT EXISTS products (
133	    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
134	    organizer_id UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
136	    code TEXT NOT NULL,
137	    name TEXT NOT NULL,
138	    category TEXT,              -- serbest gruplama ("Stand", "Services", "Sponsorship")
139	    unit_type TEXT NOT NULL,
140	    is_active BOOLEAN NOT NULL DEFAULT TRUE,
143	    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
migrations/050_add_offices_expos_catalog.sql:180:CREATE TABLE IF NOT EXISTS product_prices (
	178: -- UNIQUE(product_id, office_id): bir urunun bir ofiste tek fiyati olur.
migrations/050_add_offices_expos_catalog.sql:227:CREATE TABLE IF NOT EXISTS exchange_rates (
```
Üç tablo da **VAR** (şema varlığı). SKU sayımı yapılmadı (DB işi — kapsam dışı).

---

## E. GIT + LEENA DB (read-only)

### E1. Git logları

```
$ git -C ~/Desktop/Leena_Projesi/Leena_v401_monorepo log --oneline --since=2026-08-04 -- backend/leena-v401-backend | head -40
ba53c7c test(users): sema + kisit + B10 trigger testleri (12) + CLAUDE.md AD-01
7db2cfb fix(worker): report scheduler rolling-window idempotency + hour cap
91858c9 test(cash_forecast): is_overdue fixture'larini bugune goreli yap (tarih borcu)
cc87a5e test(setup): dizin-okuyan setup + organizers stub + GUARD (yalancı yeşilden çıkış)
bbc69ff migration 032: users tablosu + ilk Owner + sales_agents FK (Faz 4 dilim 1)
45c8d61 fix(callcenter/agent): note required when outcome=not_interested
2f61376 fix(callcenter): eager stuck-claim reaper on /next
5b84ba6 feat(callcenter): daily 19:00 Casablanca report auto-fire
0c5cc49 fix(callcenter/splash): form-wrap + touch-action for mobile clicks
fdb6ac1 fix(callcenter): stats/live day/range filter + labelled window
1c2b353 fix(form-builder): silent email-template wipe — await template load + confirm on empty save
2eee318 feat(badge-page): redesign public badge page (expo name, bilingual, mobile-first)
696568a feat(email): expose {{badge_link}} fallback variable for QR mails
493ad39 ui2 first finance screen
4be38ed ui2 shell (nav + auth + permission hook)
68753e9 feat(dashboard): archive fold for test and stale expos
976599d feat(dashboard): green accent for active/upcoming expos
5ca4b9d fix(dashboard): NULL-date expos sink to the bottom of the picker
4b69814 feat(dashboard): truthful expo stats (total/registered/unique check-ins) + chronological ordering
8907612 feat(expos): country field on Create Expo
6ccfdb3 feat(registration-id): normalise badge_id + show Registration ID on thank-you page
97ffcac fix(reactivation): legacy routes send language-correct activation page
194b646 fix(tracking): widen _lc matcher to cover reactivate-fr.html
a9a44fd fix(reactivation): last_name required on both pages + /activate endpoint
1f8692a feat(callcenter): normalise agent name + optional CALLCENTER_AGENTS allowlist
a403d2f feat: call-center 4c fixes + admin xlsx import
c161a32 feat(callcenter): TR strings, FR default, resend uses token email
8f47e3d feat(callcenter): dialer module — table, auth, routes, three pages
aed7898 feat(worker): sender display name on transactional mails
de89247 feat(thankyou-page): per-form editable success card + language-aware defaults
3120810 fix(campaigns): step-1 activation gate + creation/update/delete overrides accept any condition
87c6c4c feat(wizard): step 1 accepts not_registered; worker guard-move so it takes effect
7e34f9e feat(campaign-wizard): propagate form_id + phone to reused pending tokens (Phase 2b)
fec84bf fix(wizard): phone assertion location + expo-name fallback for CAMPAIGN_SENDER_NAME
52cc517 feat(wizard): SIEMA batch — sender name, French page, form design, phone, footer
f6e7f44 feat(wizard): Delivery B — /lift report + one-line lift on Stats tab
77297e7 feat(wizard): holdout at build time — random control group, opt-in, 0–20%
72a29d4 feat(wizard): cross-campaign overlap detection + opt-in exclusion
3f4da63 feat: Morocco CAN-SPAM footer + wizard preview readability
81c9a0f feat(wizard): step-column headers, tooltips, step-1 disabled + backend normaliser + info box
(kırpıldı — head -40)

$ ... | wc -l
75
```

```
$ cd ~/Projects/liffyv1 && git log --oneline --since=2026-06-01 | head -20
9954054 fix: quotes list API — add owner_email to SELECT for display fallback
fe4b3ec fix: quotes module — company_name replaces company_id FK (companies table empty)
eadf08c feat: quote system — migrations 048/050/051 + full CRUD API
0c15ac4 feat(liffy): track source_mining_job_id on persons for job-scoped queries and bulk assignment
b2b8b15 feat(liffy): add PATCH /api/persons/bulk-owner for authorized bulk reassignment
544e7e9 fix(liffy): include sales_owner_user_id in GET /api/persons/:id
4b40d57 feat(liffy): add GET /api/users/assignable (hierarchy-scoped user list for owner dropdowns)
c1a75f6 feat(liffy): add PATCH /api/persons/:id/owner for authorized reassignment
c7f016f feat(liffy): require disqualification reason when moving lead to Lost stage
e651ebc feat(liffy): assign sales_owner_user_id from mining job creator in background aggregation
53a117f fix(liffy): pass user_id through background import chain (req out of scope ...)
0866b06 feat(liffy): assign sales_owner_user_id to uploader on import paths (preserve existing ownership)
8b0aada feat(liffy): add POST /api/persons with creator-owned default and authorized owner assignment
6b985ad feat(liffy): enforce per-user daily email limit in main campaign worker (clamp batch to remaining)
47c7e55 fix(liffy): add uuid casts to pipeline stage update (pre-existing type bug)
07c3ede feat(liffy): harden DELETE (role+scope+reason) and close pipeline null-assignee bypass
807e6ee feat(liffy): add hierarchical scope to leaking read/export endpoints
be58541 Faz 0a: production şema kurtarma — eksik mining_results tablosu (ordering/drift Faz 1'e ertelendi)
```

### E2. LEENA DB — read-only oturum

Bağlantı: yerel PostgreSQL, `psql -d leena_v401` (oturumun ilk komutu `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;` — çıktı `SET`). Üretim bağlantı dizesi yalnız `.env*` içindedir; kural 4 gereği açılmadı, bu nedenle üretim DB'sine bağlanılmadı.

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SELECT current_database() AS db, inet_server_addr() AS host, current_user AS usr;
```
```
SET
     db     | host | usr 
------------+------+-----
 leena_v401 |      | nsa
(1 row)
```

**Q1 — `SELECT count(*) FROM contracts;`**
```
ERROR:  relation "contracts" does not exist
LINE 1: SELECT count(*) FROM contracts;
```
Q1 çalıştırılamadı. Aynı nedenle **Q2, Q3, Q4, Q6 da çalıştırılamadı** (contracts / sales_agents / contract_line_items bu veritabanında yok). ISRAR EDİLMEDİ.

**Q5 — `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;`**
```
   table_name    
-----------------
 checkins
 custom_fields
 email_logs
 email_queue
 email_templates
 exhibitors
 expos
 forms
 organizers
 visitors
(10 rows)
```

Ölçüm sonucu: bağlanılan `leena_v401` veritabanı **10 tablo** içerir; A2'de envanterlenen finans şeması (contracts, contract_line_items, payments, payment_schedule_items, commission_payouts, offices, sales_agents), 032'nin `users` tablosu, floorplan/campaign/callcenter tabloları bu veritabanında **YOK**. Finans şemasının bulunduğu veritabanı bu oturumda tespit edilmedi (bağlantı dizesi `.env*` içinde — açılmadı).

E2 özet: **Q5 çalıştı; Q1/Q2/Q3/Q4/Q6 çalıştırılamadı** — hata tipi: `42P01 undefined_table` (relation does not exist). Sır/bağlantı dizesi yazılmadı.

### E3. Sentetik veri notu

Sayımlar sentetik kayıtları içerir: contract id=1 (Acme), ATR-100000, QMA-100001 fixture'ları dahildir.
(Bu turda E2 sayımları — Q1/Q2/Q3/Q4/Q6 — çalıştırılamadığı için nota konu olacak sayısal sonuç üretilmemiştir; not, sayım yapılabildiğinde geçerlidir.)

---

## Commit öncesi `git status`

```
$ git -C ~/Desktop/Leena_Projesi/Leena_v401_monorepo status --short
 M backend/leena-v401-backend/.DS_Store
 M todo.md
?? BUG_6_DEEPDIVE_20260515.md
?? BULK_PRINT_DUAL_AUTH_DESIGN_20260518.md
?? CERTIFICATE_SYSTEM_ANALYSIS_20260518.md
?? CONFERENCE_FORCE_AUDIT_20260514.md
?? COOL_PLUS_BLOCK_ANALYSIS_20260518.md
?? DAY1_DAY2_ISSUE_RESEARCH_20260515.md
?? FAIR_DAY1_AFTERNOON_20260519.md
?? FAIR_DAY1_ANALYTICS_20260519.md
?? FAIR_DAY1_HEALTH_REPORT_20260519.md
?? FAIR_DAY2_MIDDAY_20260520.md
?? GROUP_A_PLUS_BUG_ANALYSIS_20260515.md
?? HOSTESS_CARD_RESEARCH_20260515.md
?? LEENA_CURRENT_STATE.md
?? REACTIVATION_PRELAUNCH_AUDIT.md
?? REQUESTS_1_AND_3_ANALYSIS_20260515.md
?? TERMINAL_TYPE_DEFAULT_ANALYSIS_20260515.md
?? WEBHOOK_DAY1_DAY2_FIX_PLAN_20260515.md
?? backend/leena-v401-backend/cleanup-day12-commit.sql
?? backend/leena-v401-backend/cleanup-day12-dryrun.sql
?? docs/PRE_FLIGHT_AUDIT_55K.md
?? docs/audits/
?? docs/sessions/CALLCENTER_DESIGN_20260907.md

$ git diff --cached --name-only
(bos — commit oncesi staged dosya yok)

Not: yukaridaki M/?? girdilerinin HICBIRI bu gorevde olusturulmadi veya
degistirilmedi; hepsi calisma agacinda onceden mevcuttu. Bu commit YALNIZ
docs/audits/RTM_ENVANTER_RAW_2026-09-14.md dosyasini icerir.
```
