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
