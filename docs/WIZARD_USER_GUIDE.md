# Campaign Wizard — User Guide

The **Campaign Wizard** turns one uploaded Excel file (or a set of past expos) into two ready-to-send drip campaigns, split automatically by whether each person is already in our database. It lives on the **Re-activation** page as the third tab, next to *Create Campaign* and *View Campaigns*.

Everything in the wizard is preview-side and reversible until you click **Build**. All campaigns land as **drafts** — nothing sends until you activate them from the *Email Campaigns* page.

---

## The five panels

1. **Source** — pick a target expo and a source (Excel upload OR one/many past expos).
2. **Preview** — see counts before anything is written. G1/G2/G3 buckets, tokens to mint, overlap warnings.
3. **Templates** — one or more steps per wave. Each step's template is validated in-place.
4. **Confirm** — summary + **Holdout %**, **Activation page language**, **Activation page design** (see below).
5. **Build** — progress bar. On success, two draft campaigns appear on the *Email Campaigns* page.

## The two waves

**ACTIVATE wave** — people already in our database from any past expo. They get a one-click token link that activates their badge on the target expo. No re-registration.

**REGISTER wave** — people NOT in our database at all. They get a link to the registration form.

**What the wizard does not do:** it does not separate people who *attended* (checked in) from people who *registered but did not show up*. Both land in ACTIVATE. If you want to message those two groups differently, prepare two Excel files and run the wizard twice.

## Typical 4-step drip

| Step | Delay from previous | Send to |
|---|---|---|
| 1 | 0h (fires when you activate the campaign) | `all` |
| 2 | 120h (5 days) | `not_registered` |
| 3 | 120h (5 days) | `not_registered` |
| 4 | 120h (5 days) | `not_registered` |

Step 1's delay + condition are forced by the backend to `0` / `all` — the UI disables those inputs on row 1. Later steps use `not_registered` so people who register in between stop receiving reminders.

## Template validation

Each step is validated against its wave when you click **Validate**:

| Colour | Meaning |
|---|---|
| 🟢 Green | OK — no errors, no warnings. You can proceed. |
| 🟡 Amber | Warnings only. Does not block the Build button — but read the messages. |
| 🔴 Red | Errors. Blocks the Build button. Fix the template in the *Email Templates* page and re-Validate. |

**Common blockers:**
- `NO_GREETING_CHAIN` — body has bare `{{first_name}}` or `{{last_name}}` (renders empty when the field is missing). Use the chain: `{{first_name|last_name|company|"Dear Visitor"}}`.
- `MISSING_ACTIVATION_URL` — activate-wave template has no `<a href="…{{activation_url}}…">`. Recipients hold tokens; the CTA needs to use them.
- `UNRESOLVED_TOKEN` — a `{{token}}` that the wizard cannot fill at send time.

**Common warnings (do not block):**
- `BARE_NAME_FALLBACK` — bare `{{name}}` renders as "Guest" when the first name is empty. Not broken; not controllable.
- `NO_CTA` — no link in the body. Announcement-only? Fine, but usually a mistake.
- `DEAD_UNSUB_URL` — literal `{{unsubscribe_url}}` placeholder. The worker appends its own working unsub footer regardless; the literal renders empty.

## Cross-campaign overlap

If your source list contains people who are **already recipients of another campaign for the same target expo** (either an active one or a draft you built earlier), the Preview panel shows an amber warning row naming the overlapping campaigns.

Two copies:
- If every overlap is a **draft**: *"N of these people are also in another campaign for this expo that has not been sent yet (name1, name2, name3). If you activate both, they will receive both."*
- If at least one overlap is **active**: *"N of these people are already receiving another campaign for this expo (name1, name2, name3)."*

Click **Remove them from this campaign** to filter those people out before Build. The button re-runs Preview with a new server-side list and confirms with *"N people excluded — they are already in another campaign for this expo."* Only click if you don't want them mailed twice.

The wizard **does not** filter automatically. Some overlap is intentional (e.g. a "last-chance" campaign that deliberately re-hits a specific slice) — the wizard only surfaces the fact.

## Activation page language

On the **Confirm panel**, choose the language of the activation page recipients land on when they click the activate CTA. This is the language of `reactivate.html` (English) or `reactivate-fr.html` (French) — not the language of your email templates.

**Default:** auto-preselected from the target expo's country code (`MA` → **Français**, everything else → English). You can override for that session; the choice is sticky within the wizard flow. It picks up the country default again the next time you start a fresh wizard.

The same token works for either page — language is per-URL, not per-token. Changing the setting affects only which URL the CTA points at.

## Activation page design

Choose which **form's design** the activation page renders with. The dropdown lists your visitor-type forms for the target expo; the default is *"(default — yellow theme)"*.

If you pick a form (e.g. form 59 for SIEMA), the activation page inherits that form's design config: primary color, header/footer banners, fonts, button text, border radius. Recipients see the campaign's branded activation page instead of the yellow default.

**How this reaches the token:** on new tokens, the choice is written at mint time. On **reused** pending tokens (from a previous wizard run for the same recipient), the choice is written by Phase 2b — the wizard updates the token's `form_id` on every Build so a re-run of the wizard with a different form design will change what those recipients see.

## Phone number prefill

When you upload Excel with a `phone` column, each row's phone is normalised to **E.164** (starts with `+`) at Preview time and stored on the recipient's token. When the person clicks the activation CTA, the phone field on `reactivate.html` / `reactivate-fr.html` is prefilled — they don't have to type it.

**Country resolution order for a local number (no `+`):**
1. **Row's own `country` column** (Excel or from-expo source) — e.g. `France` for a French visitor whose target expo is Morocco → phone becomes `+33…`.
2. **Target expo's country** — fallback when the row has no country.
3. If neither is known → phone is stored empty (row still goes through).

A leading `+` always wins. Junk phones (`xxxxxxxxxx`, `12ab`) are stored empty; the row is not rejected.

**Re-running the wizard for the same recipient?** If the token's phone is empty and the new source row has one, Phase 2b fills it. If the token already has a phone, the wizard **never overwrites** it — good data is protected.

## Holdout (control group) — measure real lift

On the **Confirm panel** you can set a **Holdout %** (0–20). A random slice of your mailable recipients gets **no email and no token** — they receive nothing. They land in `campaign_recipients` with `status='holdout'` so that after the fair you can compare their registration rate to the mailed group's, isolating what the campaign actually did.

**Recommended: 5–10%** for a campaign whose real lift you want to measure. Skip it (leave at 0) for a routine reminder run where measurement isn't the point.

**What "no email, no token" means concretely:**
- No `reactivation_tokens` row is minted for held-out people
- No `email_queue` row is created for them at any step
- No step-1, no step-2, no step-3
- They appear on the *Email Campaigns* page as `status='holdout'` recipients, distinct from `active`

**Cross-campaign interaction:** holdouts count as **taken across campaigns**. If you build a second campaign against the same list, the wizard's overlap warning will flag them so we never accidentally mail the control group in a later run.

**Edge case:** if the mailable pool is too small for your % to round to at least 1 recipient, the summary line says so — try a higher %.

## Reading the lift after the campaign runs

Once the campaign has recipients and (optionally) the target expo has started, the campaign's Stats tab on the *Email Campaigns* page shows a single line above the recipient counts:

> **Mailed:** 21.4% registered · **Holdout:** 9.8% · **Lift** +11.6 pts

Before the fair opens (i.e. when only registrations exist and check-ins haven't started), a small sub-line says *"Registration only — check-in data arrives when the fair opens."*

Once the fair has opened, a second sub-line shows check-in lift:

> Check-in: Mailed 15.6% · Holdout 6.7% · Lift +8.9 pts

**How to read it honestly:**
- Lift is an **upper bound on attribution** — someone who would have registered anyway is still counted.
- With small holdouts (<50 people) the number wobbles a lot. Trust it more as sample size grows.
- The line only appears when the campaign has holdout rows. Campaigns built before the holdout feature (or built with 0%) show no line — same as before.

## FAQ

**Do I need to run the wizard for every campaign?**
No. The wizard is for the "one Excel → two drip campaigns" workflow. If you're doing a single-shot manual send, use the *Create Campaign* tab (unchanged).

**What if I upload the same file twice by accident?**
The Preview will show every mailable email as being *"in another campaign for this expo"* — a giant amber warning. Click "Remove them" or Back to source and start over.

**The Preview shows my counts have drifted between two clicks.**
Expected — new registrations arrive continuously. The G1 bucket in particular moves whenever someone registers via the public form or Zoho webhook.

**"Preview cached server-side for 30 minutes" — what happens after 30 minutes?**
Click Preview again to get a fresh preview_token. The wizard's Build button needs a fresh token.

**What if Render restarts mid-Build?**
The job status page will show "processing" indefinitely. Rare — deploys are typically 10-30 seconds. Contact Suer if you see this.

**Can I un-activate a campaign?**
No. Once activated, step 1 fires immediately. You can Pause (from the *Email Campaigns* detail) to stop further steps, but step 1 emails are already on their way to SendGrid.
