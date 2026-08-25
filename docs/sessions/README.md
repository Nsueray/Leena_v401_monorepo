# Session Documents

Working analyses, audits and health snapshots produced during a session. They are **point-in-time
records**, not living documentation — each is true as of its stated timestamp and is not updated
afterwards.

**Canonical documentation lives in `CLAUDE.md` and `todo.md`.** When these disagree with
`CLAUDE.md`, `CLAUDE.md` wins.

## 18-19 August 2026 — MP26 Reactivation Campaign Launch

Chronological. See `CLAUDE.md` → *v4.0.7* for the durable summary.

| file | what it is |
|---|---|
| `DISCOVERY_20260818.md` | Read-only discovery of the whole system 3 months after the May fair. Found the repo was not dormant (ELL finance + an undocumented Expo Operations module), identified the Zoho `job_title` root cause, the purple success-card cause, and a pre-fair risk snapshot. |
| `EXEC_BRIEF_02_FINDINGS.md` | Analysis + proposed diffs for the reactivate required-fields fix, the webhook `title` fix, and the check-in report fallback. Includes the `??` vs `\|\|` investigation resolved from production data. |
| `SIEMA_REACTIVATION_DISCOVERY_20260818.md` | Funnel analysis across all past reactivation campaigns. Established that ~3% activation is a **conversion** problem, not delivery — 28% open, 15.6% of openers click, 47% of clickers convert. |
| `SIEMA_MERGE_OPTIONS_20260818.md` | Options A/B/C for merging the reactivation experience with multi-step sending, measured against the code with change-size estimates. |
| `SIEMA_OPTION_A_GAPS_20260818.md` | Gap closure for the chosen option: the exact bridge change set, Group 2/3 data flows, and the discovery that reactivation tokens expired **before** the fair. |
| `REACTIVATION_SEGMENTATION_SQL_20260818.md` | Pre-written read-only segmentation SQL (G1/G2/G3) + recipient-sheet column contracts. Parameterised on `:target_expo_id`. |
| `HEALTH_SNAPSHOT_20260818_NIGHT.md` | Post-launch baseline, 18 Aug 21:17 IST. First identification of the 28.4/min worker cap. |
| `MORNING_CHECK_20260819.md` | 19 Aug 09:48 IST. C16 fully delivered, bridge integrity 100%, overnight funnel results. |
| `CHECKIN_FORENSICS_20260819.md` | 19 Aug. How check-ins actually happened at the May fair. Confirms the print-desk model, corrects the source attribution (`terminal` not `badge-print`), shows the 2-per-person ratio belongs to expo 1 and stems from a log-recovery double-insert, and sizes gate-scanning for expo 13 at 0-3 lines. |
| `DAY1_MIDDAY_20260825.md` | 25 Aug 12:16. Midday pulse: 594 check-ins, +27.8% ahead of May on the visitor-side race, walk-up desk accelerating to 63/hour, campaign registrants converting at 43% of the non-campaign rate, and the conference lane found running the wrong scanner page (0 certificates). |
| `DAY1_VS_MEGACLIMA_20260825.md` | 25 Aug 10:07. Day-1 like-for-like against May's Mega Clima at the same venue, both Tuesday openings. Hourly race, the 19.7% pre-registration deficit, and the finding that half of May's attendance was same-day walk-ups converting at 65% against 9.46% for its pre-registered list. |
| `FAIR_DAY1_OPENING_20260825.md` | 25 Aug 09:51, nine minutes before doors. Pre-opening snapshot: 100 check-ins (exhibitor-dominated), 404 registrations, zero system failures, the stuck-10 recovery confirmed, evidence of badges being used to test lanes, and confirmation that last night's test rows are still present but do not pollute today's counters. |
| `SUNDAY_SOURCES_20260824.md` | 24 Aug 20:34. Registration-source breakdown for the expo's biggest day (1,198, 3.06x yesterday) — driven by campaign step 3 and two ops imports, not ads. Campaign attribution at 17.8% cumulative, the ads+organic baseline for SIEMA budget math, and phone-format verification of the re-run Meta/Pixad import. |
| `FAIR_DAY_TOOLS_20260824.md` | 24 Aug night. Four read-only audits: the missed-day-1 mailing path (works today), live dashboard accuracy (one wrong country stat), manual-registration field parity vs form 53 (silent `N/A`/`Nigeria` defaults, no phone), and phantom check-ins (no undo path anywhere, but May ran at 0.15%). |
| `DEPLOY_MANUAL_REG_20260824.md` | 24 Aug night. Manual registration restored to terminal-key auth (scope forced from the terminal row, type clamped, both kinds isolated), popup setTimeout removed, registration failures fail closed. 14-point production smoke test with no login, test-row cleanup SQL, and the one-command recovery for the 10 stuck emails. |
| `FAIR_EVE_FINAL_20260824.md` | 24 Aug 09:43. Conference + bulk-print terminals verified live; correction that the 8 orphan topics ARE selectable; the blocker that expo 13 would issue Ghana-branded certificates, with install steps; keyboard-wedge audit; the proposed qrscanner fail-closed / no-switch / visible-duplicate diff, and the MP26 certificate install (expoId-switch, token-based cert number, pipe-safe topic injection) — all NOT implemented. |
| `FAIR_EVE_MECHANICS_20260824.md` | 24 Aug evening. Print-to-check-in chain traced to path:line and validated against May's 2,223 real check-ins; double-scan, walk-in and onsite-form behaviour; the walk-in path's hidden login requirement and the silent-failure modes that could embarrass us at 10:00. |
| `MONDAY_PREFAIR_20260824.md` | 24 Aug 08:32, day before doors. Step-3 sends verified (682 wrong sends suppressed, 0 unexplained), a correction showing the `delivered_count` snapshot defect is NOT single-step-only, T1's badge template confirmed fixed, exhibitor bulk print blocked on a missing API field with ready-to-run SQL, and the opening-morning runbook. |
| `SATURDAY_CHECK_20260822.md` | 22 Aug 23:25. C18's first 24h measured like-for-like against C16 step 1 on the identical 14,229 people (clicks 2.7x, opens slightly down), the single-step `delivered_count` snapshot defect, C19 shown to be a strict superset of Monday's step-3 audience, and a third no-movement report on the three ops gates. |
| `FRIDAY_NIGHT_20260821.md` | 21 Aug 23:15. The "Dear ," diagnosis, forensic proof that all 96,227 live sends rendered a real name (and a correction to the reported 77/23 split), template timeline, and the C18 activation / C19 hold. |
| `FRIDAY_STATUS_20260821.md` | 21 Aug, 4 days to fair. Step 2 fired on time and drained 10x faster; Wednesday's fix suppressed 111 wrong sends with 0 unexplained. Gate readiness unchanged for 3 days — 3 blocking items. Withdraws the conference-form-topics finding from TERMINAL_CHECK as a measurement error. |
| `CAMPAIGN_STATUS_20260819_EOD.md` | 19 Aug EOD. Funnel numbers for both campaigns on day 1: C16 190 registered (1.27%) vs C17 23 (0.09%) — the reactivation token quantified at ~14x. |
| `CAMPAIGN_UI_DESIGN_20260819.md` | 19 Aug. Design for a self-service "Reactivate via Campaign" wizard so ops can run SIEMA without SQL or Excel. Inventories what exists (~70%), what's needed, and sizes it at ~1,020 lines across 4 files. Design only, no code. |
| `SCANNER_INSPECTION_20260819.md` | 19 Aug. Deep read of the scan page before putting a hostess on a gate. Headline: `qrscanner.html` has no camera — it is a keyboard-wedge page for a USB barcode gun. Documents two silent failure modes and sizes three options. |
| `TERMINAL_CHECK_20260819.md` | 19 Aug. Expo-13 terminal readiness vs the expo-7 baseline. Found the visitor gate on a test badge template with `show_job_title` off, and no conference or bulk-print terminal. Ops punch list. |

## Note on reproducibility

Several outcomes recorded here exist **only in the production database** and cannot be rebuilt
from this repo:

- Email templates #54-#59 (authored in the UI, patched via API)
- Campaigns 16/17, their steps and recipients
- `reactivation_tokens` for expo 13
- The `job_title` backfill (backup table `job_title_backup_20260818`)
- Render worker env vars (`EMAIL_WORKER_BATCH_SIZE`, `CAMPAIGN_SCHEDULER_*`)

`CLAUDE.md` v4.0.7 documents each of these under *DATA OPERATIONS — production changes NOT in git*.
