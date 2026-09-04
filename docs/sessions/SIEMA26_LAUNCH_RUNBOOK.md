# SIEMA26 — Launch Runbook

> **STATE — BUILT 4 Sep 15:26 UTC.** Both drafts exist on production expo 9. **Monday = activation only, no other prep.**
>
> Campaign ids and full build report: `docs/sessions/SIEMA26_BUILD_20260904.md`.
>
> - **Campaign 78** — `Morocco Siema Expo 2026 Leena Registered – Re-activation` (activate wave / G2 bucket). 16,472 active + 867 holdout. 5 steps (templates 74-78). Activate Mon 8 Sep 11:00 Istanbul.
> - **Campaign 79** — `Morocco Siema Expo 2026 Past Visitors – Registration` (register wave / G3 bucket). 16,350 active + 861 holdout. 3 steps (templates 79-81). Activate Mon 8 Sep 13:00 Istanbul.
>
> All 8 steps `condition='not_registered'` (see `DEPLOY_STEP1_NOT_REGISTERED_20260904.md` for the code that made step-1 `not_registered` honourable). All 16,471 minted tokens carry `form_id=59`. 15,735 phones in E.164.
>
> Operational plan below written 3 Sep before Yaprak ran the wizard. State-of-affairs sections (source list, wizard settings, drip topology, activation window, monitoring) held true through build — kept as reference. **Pre-flight checklist §6 is closed** (build happened; template re-audit PASS in the build doc).
>
> Companion docs:
> - `DEPLOY_SIEMA_BATCH_20260903.md` — the 8 code commits behind the wizard state used here
> - `MANUAL_DB_CHANGES_20260903.md` — the preheader / subject / test-token DB ops
> - `DEPLOY_STEP1_NOT_REGISTERED_20260904.md` — the 4 Sep code deploys that made `not_registered` on step 1 work end-to-end (used for the first time in this build)
> - `SIEMA26_BUILD_20260904.md` — the actual build numbers + template re-audit + Monday plan
> - `docs/campaigns/SIEMA26/` — the 8 launch templates dumped from DB (reference set)

---

## 1. Source list — single merged run

**Inputs:**
- **Leena expo-1 export** — 21,330 valid rows (all-caps names title-cased, phones already normalised where present)
- **Zoho export** — 42,891 distinct emails

**Merge:**
- **Distinct emails after dedupe = 43,955.** Leena row wins on any collision (better data quality, phone typically already E.164).
- All-caps names title-cased.
- **Canonical header set:** `email, name, last_name, company, country, job_title, phone, source` (extra `source` column for post-launch attribution).

**MillionVerifier pass (pending tonight, 3-4 Sep):**
- MillionVerifier **accepts CSV**, **not openpyxl-written xlsx** (G31 — the tool's column-sniff fails to find *"column with email addresses"* in openpyxl xlsx; CSV works).
- **Its column sniff also misreads digit-leading emails as phones** — screen the source for `^\d.*@` addresses before upload if any exist.
- Result → the wizard file (the "Good" subset only). Uploaded into the wizard via Import from Excel.

---

## 2. Wizard settings for the launch

| Field | Value |
|---|---|
| Source | Import from Excel (the MV "Good" file) |
| Target expo | **9** — Morocco Siema Expo 2026 |
| Holdout % | **5** |
| Activation page language | **Français** (auto-preselected from `expos.country_code='MA'` per Small Add in `52cc517`; sticky within session via `dataset.userTouched`) |
| Activation page design | **Form 59** — `Formulaire d'inscription des visiteurs` |
| Cross-campaign overlap | Expect flags for the four internal addresses on campaigns 59/60 (see `MANUAL_DB_CHANGES §4`); leave them in the send |
| Exclude already-in-campaign | **No** — do not exclude; internal addresses are expected overlap |

Two drafts land after Build, both `status='draft'`:
- **Activate wave** — A1 → A5 (templates 74–78)
- **Register wave** — R1 → R3 (templates 79–81)

---

## 3. Drip schedule

### Activate wave (5 steps, templates 74–78)

| Step | Template | Delay from previous | Send-to | Fires (assumes activation Mon 7 Sep 11:00 Istanbul) |
|---|---|---|---|---|
| 1 | 74 `01_invitation` | 0 h | `not_registered` | **Mon 7 Sep** |
| 2 | 75 `02_univers_exposants` | 72 h | `not_registered` | **Thu 10 Sep** |
| 3 | 76 `03_programme_conferences` | 96 h | `not_registered` | **Mon 14 Sep** |
| 4 | 77 `04_plan_de_visite` | 72 h | `not_registered` | **Thu 17 Sep** |
| 5 | 78 `05_dernier_appel` | 96 h | `not_registered` | **Mon 21 Sep** |

Total: 0 → 72 → 96 → 72 → 96 h. Backend `normaliseStep1` forces step 1 `delay_hours=0`; condition is PRESERVED as sent (wizard divergence, 3 Sep — see `docs/sessions/DEPLOY_STEP1_NOT_REGISTERED_20260904.md`).

### Register wave (3 steps, templates 79–81)

| Step | Template | Delay from previous | Send-to | Fires (assumes activation Mon 7 Sep 13:00 Istanbul) |
|---|---|---|---|---|
| 1 | 79 `R1_invitation` | 0 h | `not_registered` | **Mon 7 Sep** |
| 2 | 80 `R2_plan_de_visite` | 240 h | `not_registered` | **Thu 17 Sep** |
| 3 | 81 `R3_dernier_appel` | 96 h | `not_registered` | **Mon 21 Sep** |

Total: 0 → 240 → 96 h.

### ⚠️ Date-sensitive subjects — templates 77 / 80 / 81

- **77 `04_plan_de_visite`** subject **`J-5 : préparez votre visite à SIEMA`** — must fire ≥17 Sep (5 days before 22 Sep opening).
- **80 `R2_plan_de_visite`** subject **`J-5 : votre plan de visite pour SIEMA`** — same J-5 window.
- **78 `05_dernier_appel`** subject **`{{first_name|"Bonjour"}}, SIEMA ouvre demain`** and **81 `R3_dernier_appel`** subject **`Demain : SIEMA ouvre. Inscrivez-vous ce soir`** — must fire on **Sun 20 Sep / Mon 21 Sep** (the "demain" is 22 Sep).

**If activation slips 24 h (e.g. Tue 8 Sep instead of Mon 7 Sep)**, either:
- **Bump activate wave step 4 delay** from 72 → 48 h and register wave step 2 from 240 → 216 h (keeps the "J-5" and "demain" copy accurate), **OR**
- **Rewrite the subjects** for 77 / 80 / 78 / 81 in the DB before activation (they are DATA, not code — trivial `UPDATE email_templates SET subject=... WHERE id=N`).

**⚠️ G10 recap** — step delays are measured from the previous step's **enqueue time**, not from wall-clock intent. If activation runs earlier than 11:00 IST on 7 Sep, everything downstream shifts by that amount.

---

## 4. Activation window

- **Activate wave** — Mon 7 Sep **11:00 Europe/Istanbul (09:00 Africa/Casablanca)**.
- **Register wave** — Mon 7 Sep **13:00 Europe/Istanbul (11:00 Africa/Casablanca)**.

**Two-hour stagger** by design: activate wave (14,000+ recipients from Leena history) leaves sender reputation cleaner before the larger register wave (~29,000 cold contacts). Ramps volume against `em5759.leena.app`'s ~200/hour recent baseline.

**Manual activation via `POST /api/campaigns/:id/activate`** or the *Email Campaigns* Activate button on the campaign detail page. **Scheduled-start does NOT exist yet** — see §7 backlog.

---

## 5. Sender identity

**Render env var set 3 Sep on `leena-email-worker` service:**
```
CAMPAIGN_SENDER_NAME=Elan Expo
```

Applies to ALL active campaigns until unset. Also **covers Madesign 1 Oct** (single global name is fine — no concurrent campaigns for different fairs during that window).

**Fallback chain (`email_worker.js:256-265` after `fec84bf`):**
1. `process.env.CAMPAIGN_SENDER_NAME` — wins when set
2. **Cached expo name** — one query per campaign lifetime (`_getExpoNameForCampaign`, non-fatal on DB error)
3. `null` — bare `noreply@leena.app` as pre-3-Sep

If the env var is ever unset by mistake, mail still ships with the expo name as display name. Never breaks.

**Reset checklist for post-SIEMA / post-Madesign:**
- Change `CAMPAIGN_SENDER_NAME` on the Render worker service to the next campaign's brand, OR unset entirely and let expo-name fallback take over
- Worker restart picks it up on next `processTask` cycle (no code change)

---

## 6. Pre-flight checklist

Run through in order before hitting Activate:

- [ ] **MillionVerifier file loaded** — CSV, not openpyxl xlsx (G31).
- [ ] **Wizard Preview counts** captured — sanity check `will_receive` ≈ 43k, `excluded` reasonable (mostly G1 already-registered), `tokens_to_mint` ≈ G2 mailable minus holdout.
- [ ] **Template validation all green** — 8 templates (74–81) each pass the wave-aware validator (activate wave for 74–78, register wave for 79–81). Bare `{{name}}` is amber `BARE_NAME_FALLBACK`, not blocking; treat every red as blocking.
- [ ] **Cross-campaign overlap:** expect flags naming campaigns 59/60 (four internal addresses) — leave them in.
- [ ] **Confirm panel:** target expo 9 · holdout 5 · Français · form 59.
- [ ] **Form 59 attribution decision.** Form 59 does NOT carry `hear_about_event` field (see `SIEMA_PRELAUNCH_AUDIT_20260902.md §D.2`). Registrations via form 59 will land in `visitors` with no `hear_about_event` — attribution silently lost for the French sub-segment. **Yaprak: either add the field to form 59 before 7 Sep, or accept the loss.**
- [ ] **Env var confirmed:** `CAMPAIGN_SENDER_NAME=Elan Expo` on `leena-email-worker` (Render Shell: `echo $CAMPAIGN_SENDER_NAME` on that service).
- [ ] **Worker healthy** — `SELECT status, COUNT(*) FROM email_queue GROUP BY status;` — no stuck `processing` older than 5 min.
- [ ] **`expos.country_code` for expo 9** = `'MA'` (drives French footer + `activation_lang='fr'` default).

Then Activate wave at 11:00 IST → Register wave at 13:00 IST.

---

## 7. Day-of monitoring

**Watch:**
- **SendGrid dashboard** — the only source for bounces + complaints. **G9 bounce webhook is still absent** — no auto-insert into `email_unsubscribes` on bounce. Manual triage if bounce rate spikes.
- **`email_queue`** status distribution — running `SELECT status, COUNT(*) FROM email_queue WHERE campaign_id IN (activate_id, register_id) GROUP BY status;` every 10 min for the first hour.
- **`email_campaigns.total_sent`** — enqueue counter, NOT delivery (per G14 the two numbers can be 4× apart during drain). Use `email_queue.status='sent'` as the live delivery-truth source until the campaign completes.
- **`campaign_recipients WHERE status='active'`** — mailable pool.
- **Reactivation activations** — `SELECT COUNT(*) FROM reactivation_tokens WHERE target_expo_id=9 AND activated_at::date = CURRENT_DATE`.

**Thresholds (from prior SIEMA-like campaigns):**
- Bounce rate above 3% → pause step 2 immediately.
- Complaint rate above 0.1% → pause the wave.
- SPF/DKIM/DMARC failures → investigate immediately; Sep-3 verification confirmed all three pass via `em5759.leena.app` bounce subdomain.

---

## 8. Post-fair follow-up

- **`/lift` line on Stats tab** — shipped in `f6e7f44`. After the fair opens (23 Sep onwards), the campaign detail page shows:
  > **Mailed:** X% registered · **Holdout:** Y% · **Lift** +Z pts
  and, once `checkins` populate:
  > Check-in: Mailed X% · Holdout Y% · Lift +Z pts
- **Attribution honesty** — lift is an upper bound; someone who would have registered anyway is still counted (see `docs/WIZARD_USER_GUIDE.md`).
- **Post-fair cleanup of test tokens** covered by standard cleanup pattern.

---

## 9. Known gaps — owners

| Gap | Owner | Trigger to fix |
|---|---|---|
| `hear_about_event` missing on form 59 | **Yaprak** | Before 7 Sep launch |
| SendGrid bounce webhook (G9) | **Backend** | Post-fair — bundle with reply-to-unsubscribe automation (todo #9) |
| Footer per-country office address | **Backend** | Before next non-Morocco campaign uses `enqueueStepEmail` (todo P2, `3f4da63`-era) |
| Per-campaign From display name | **Backend** | First concurrent campaigns needing distinct names (todo P2, `52cc517`-era) |
| Cross-campaign scope widening | **Backend** | First multi-expo drip pattern (todo P2, `72a29d4`-era) |
| Scheduled campaign start | **Backend** | Post-SIEMA (todo P2) |
| MillionVerifier API integration (verify once, store on visitor) | **Backend** | Post-SIEMA (todo P2) |
| App-log surface for Claude Code diagnostics | **Infra** | Standing P1 since v4.0.11 (todo #2) |
| G4 recurring — DB inbound-IP whitelist drift | **Standing** | Every session start: `psql $RENDER_DATABASE_READONLY_URL -c 'SELECT 1'` before touching anything |
