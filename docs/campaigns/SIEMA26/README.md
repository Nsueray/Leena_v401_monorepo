# SIEMA26 launch templates — reference dump

The 8 email templates for the SIEMA FoodExpo 2026 launch (expo 9, Casablanca, 22-24 Sep 2026), dumped verbatim from production `email_templates` on **3 Sep 2026** after Suer's DB-side authoring pass.

**These files are the approved version.** The DB rows are canonical — this directory is a snapshot for review/version-control only. Editing files here does not change what SendGrid ships; edits must go through the DB.

Suer removed the top logo from `01_invitation` deliberately (visual polish decision, not a bug).

## Templates

| id | Wave | Filename | Subject (as stored) |
|---:|---|---|---|
| **74** | Activate A1 | `74_01_invitation.html` | `{{first_name|"Bonjour"}}, votre badge SIEMA 2026 est prêt` |
| **75** | Activate A2 | `75_02_univers_exposants.html` | `Qui exposera à SIEMA 2026 ? Machines, emballage, food` |
| **76** | Activate A3 | `76_03_programme_conferences.html` | `10 conférences incluses avec votre badge SIEMA` |
| **77** | Activate A4 | `77_04_plan_de_visite.html` | `J-5 : préparez votre visite à SIEMA` |
| **78** | Activate A5 | `78_05_dernier_appel.html` | `{{first_name|"Bonjour"}}, SIEMA ouvre demain` |
| **79** | Register R1 | `79_R1_invitation.html` | `Invitation : SIEMA FoodExpo, 22-24 septembre, Casablanca` |
| **80** | Register R2 | `80_R2_plan_de_visite.html` | `J-5 : votre plan de visite pour SIEMA` |
| **81** | Register R3 | `81_R3_dernier_appel.html` | `Demain : SIEMA ouvre. Inscrivez-vous ce soir` |

## Notes for readers

- Preheaders were repaired via Render-Shell splice on 3 Sep — see `docs/sessions/MANUAL_DB_CHANGES_20260903.md §1` for the eight stored preheader strings.
- Subject 79 was updated on 3 Sep from a bare `SIEMA FoodExpo, 22-24 septembre, Casablanca` (no prefix) to the current value — see `MANUAL_DB_CHANGES §2`.
- All 8 templates use the greeting fallback chain `{{first_name|"Bonjour"}}` and pass wave-aware validation green in the wizard's `POST /api/campaigns/reactivation/validate-template` (activate wave for 74-78, register wave for 79-81).
- Unsubscribe footer is appended by the worker (`utils/trackingPixel.js:injectUnsubscribeLink`) at send-time — the templates themselves do NOT carry an unsubscribe link. `expoCountryCode='MA'` produces the French footer sentence + Morocco address (see `52cc517` and `3f4da63`).
- Launch schedule + drip topology live in `docs/sessions/SIEMA26_LAUNCH_RUNBOOK.md`.
