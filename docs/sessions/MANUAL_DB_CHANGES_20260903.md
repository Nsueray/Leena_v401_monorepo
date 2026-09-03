# MANUAL DB CHANGES — 3 Sep 2026

> Everything Suer ran in Render Shell today, with the SQL and the observed
> result. Nothing here is reproducible from the repo — this doc is the record.
> All UPDATE/DELETE counts read live; verification via read-only 3 Sep post-run.

---

## 1. Preheader repair on templates 74-81 (`8 × UPDATE 1`)

**Why.** Yaprak's initial preheaders were placeholders. Suer rewrote all eight in the DB directly (they are DATA, not code) using a `position() + left() + substr()` splice pattern to swap the old preheader string in-place inside the hidden `<div>` block without touching surrounding HTML.

**Method.** For each template, one statement of the shape:
```sql
UPDATE email_templates
SET html_content =
    left(html_content, position('<OLD_PREHEADER_STRING>' IN html_content) - 1)
    || '<NEW_PREHEADER_STRING>'
    || substr(html_content,
              position('<OLD_PREHEADER_STRING>' IN html_content)
              + length('<OLD_PREHEADER_STRING>'))
WHERE id = N;
```

Each returned `UPDATE 1`.

**The eight NEW preheader strings now stored** (read verbatim from the DB via `regexp_matches(h, '<div[^>]*display[^>]*none[^>]*>([^<]+)</div>')` on 3 Sep):

| id | template name | stored preheader |
|---|---|---|
| 74 | `01_invitation` | `Vous étiez avec nous en 2025. Un clic suffit pour l'activer, aucun formulaire à remplir.` |
| 75 | `02_univers_exposants` | `Un aperçu des fournisseurs présents du 22 au 24 septembre, univers par univers.` |
| 76 | `03_programme_conferences` | `Souveraineté, compétitivité, IA industrielle : plus de 10 sessions sur 3 jours, sans frais.` |
| 77 | `04_plan_de_visite` | `Lieu, horaires, parking. Activez votre badge avant d'arriver et évitez la file d'attente.` |
| 78 | `05_dernier_appel` | `Activez votre badge ce soir : il arrive par e-mail, entrée directe demain dès 10h.` |
| 79 | `R1_invitation` | `Machines, emballage, food : le rendez-vous de l'agroalimentaire. Entrée gratuite sur inscription.` |
| 80 | `R2_plan_de_visite` | `Lieu, horaires, accès. Inscription en une minute, badge par e-mail, entrée sans attendre.` |
| 81 | `R3_dernier_appel` | `Une minute pour vous inscrire, badge par e-mail, entrée directe demain dès 10h.` |

Each preheader is followed by the standard invisible-padding pattern
(`&zwnj;&nbsp;` repeats) that the templates already carry — the splice preserved that block unchanged.

**Verification (read-only 3 Sep).** All 8 preheaders read back with the expected sentence. No trailing garbage, no truncation. Live-mail rendering confirmed via the Run 2 delivery on template 74 (see `DEPLOY_SIEMA_BATCH_20260903.md §3`).

---

## 2. Subject 79 → correct invitation line

**Why.** R1 (id 79) was entered without the `Invitation :` prefix.

```sql
UPDATE email_templates
SET subject = 'Invitation : SIEMA FoodExpo, 22-24 septembre, Casablanca'
WHERE id = 79;
```
Returned `UPDATE 1`.

**Verification (read-only 3 Sep).** `SELECT id, subject FROM email_templates WHERE id=79` → `Invitation : SIEMA FoodExpo, 22-24 septembre, Casablanca` (byte-verbatim).

---

## 3. Test tokens on expo 9 for the 4 internal addresses (`DELETE 4`)

**Why.** The four internal addresses (`suer@elan-expo.com`, `elif@elan-expo.com`, `info@elanexpo.net`, `info@plusdesignmaroc.com`) already had stale pending tokens on expo 9 from earlier campaign 42 drips. Deleting them ensured campaign 60 (post-Phase-2b) minted **fresh** tokens rather than reused ones — the whole point of demonstrating Item 3 (`form_id`) + Item 4 (phone) live.

```sql
DELETE FROM reactivation_tokens
WHERE target_expo_id = 9
  AND email IN ('suer@elan-expo.com','elif@elan-expo.com','info@elanexpo.net','info@plusdesignmaroc.com');
```
Returned `DELETE 4`.

Campaign 60 then re-minted these four tokens at `2026-09-03 16:32:49` — see `DEPLOY_SIEMA_BATCH_20260903.md §3` for the four rows with `form_id=59` and correct E.164 phones.

---

## 4. Campaign 42 forced to `status='completed'`

**Why.** Campaign 42 (`reactivate` on expo 9) was still dripping to tokens that no longer existed after §3. Forcing it complete stopped the worker's scheduler from picking it up on the next cycle.

```sql
UPDATE email_campaigns SET status='completed' WHERE id=42;
```
Returned `UPDATE 1`.

**Why not `DELETE FROM email_campaigns WHERE id IN (1, 42, 59)`?** `email_queue` rows retain their `campaign_id` FK on completed rows (they are purged 1 h post-completion per G13 but not immediately), and the FK is `ON DELETE RESTRICT` on `campaign_recipient_id`. So campaigns **1, 42, 59, and 60 all remain on expo 9** — they cannot be deleted until every child queue row is gone.

**Expected side effect:** the wizard's cross-campaign overlap query will now flag the 4 internal addresses as *"already in another campaign for this expo"* on any future run against expo 9 (because campaigns 59/60 have active-status `campaign_recipients` rows for them). This is correct behaviour — the warning exists exactly for this pattern.

**Read-only post-check (3 Sep):**
```
 id |                 name                  |  status
----+---------------------------------------+-----------
  1 | Test                                  | completed
 42 | reactivate                            | completed
 59 | Morocco Siema Expo 2026 Activate Wave | completed
 60 | Morocco Siema Expo 2026 Activate Wave | completed
```

---

## 5. Smoke cleanups (four DELETEs per run)

**When.** Programmatic cleanup runs at the end of every `tests/test_wizard_silent.js` execution (`programmaticCleanup(probeTemplateId, probeFormId)` — see `7e34f9e`). Belt-and-braces cleanup SQL is always printed to stdout regardless of pass/fail.

**Standard four cleanup DELETEs printed at test end:**
```sql
-- 1) Draft campaigns (campaign_recipients + campaign_steps CASCADE):
DELETE FROM email_campaigns
WHERE expo_id = 17 AND name LIKE '[SMOKE-WIZARD]%';

-- 2) Reactivation tokens for smoke emails on target expo:
DELETE FROM reactivation_tokens
WHERE target_expo_id = 17
  AND email IN ('wizard-smoke-1@test.local', ..., 'wizard-smoke-5@test.local');

-- 3) G2 seed visitors imported to expo 11 at test start:
DELETE FROM visitors
WHERE expo_id = 11 AND email IN ('wizard-smoke-1@test.local','wizard-smoke-2@test.local','wizard-smoke-3@test.local');

-- 4) Belt-and-braces: any visitors on target expo 17 (should be 0):
DELETE FROM visitors
WHERE expo_id = 17 AND email IN (all 5 smoke emails);

-- 5) In-flight probe template (deleted by API in normal flow):
DELETE FROM email_templates WHERE name LIKE '[SMOKE-WIZARD-PROBE]%';

-- 6) In-flight probe form (deleted by API in normal flow):
DELETE FROM forms
WHERE name LIKE '[SMOKE-WIZARD-PROBE]%' AND expo_id = 17;
```

**Verification (read-only 3 Sep, post final smoke of the day):**

| target | expected | measured |
|---|---:|---:|
| `email_campaigns WHERE name LIKE '[SMOKE-WIZARD]%'` on expos 11/17 | 0 | **0** |
| `reactivation_tokens WHERE target_expo_id=17 AND email LIKE 'wizard-smoke-%'` | 0 | **0** |
| `visitors WHERE expo_id=11 AND email LIKE 'wizard-smoke-%'` | 0 | **0** |
| `email_templates WHERE name LIKE '[SMOKE-WIZARD-PROBE]%'` | 0 | **0** |
| `forms WHERE name LIKE '[SMOKE-WIZARD-PROBE]%'` | 0 | **0** |

Nothing smoke-related remains on the trash expos.

---

## 6. 2 Sep — `expos.country_code` backfill (cross-reference)

Not run today, but load-bearing for all footer-language and phone-normalisation code that shipped 3 Sep. `expos.country_code` populated for **14 / 17** rows on 2 Sep via the one-off SQL in `docs/sessions/IMPORT_PHONE_NORMALISATION_20260901.md §7` (Preview 3). Test expos 11 / 15 / 16 stay NULL (deliberately — the code fails open when country_code is NULL, per `docs/sessions/DEPLOY_PHONE_NORMALISATION_20260902.md §B-2` resolution order).

**Verified read-only 3 Sep:** `SELECT COUNT(*) AS total, COUNT(country_code) AS with_cc, COUNT(*) FILTER (WHERE country_code IS NULL) AS null_cc FROM expos;` → `total=17, with_cc=14, null_cc=3`.

The 3 NULL rows do not affect production campaigns (they are test expos). Backfill for real expos SIEMA (expo 9, `MA`), Madesign (expo 10, `MA`), etc. is already correct.
