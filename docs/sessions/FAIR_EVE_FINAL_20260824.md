# MP26 fair-eve final — conference/certificate verification + scanner hardening proposal
**Taken:** 2026-08-24 09:43 Lagos · **Doors 25 Aug 10:00 Lagos.**
Part A read-only. **Part B is a proposal — nothing implemented.**

Prior: `FAIR_EVE_MECHANICS_20260824.md` → **this**.

---

# PART A — read-only report

## A1. What ops created since this morning

**Two new terminals, both live and both verified against the production API.**

| id | hall / no | kind | template | manual | auto_ci | created (Lagos) |
|---|---|---|---|---|---|---|
| **41** | Bulk Print / **MP26 Exhibitor Bulk Print** | **bulk_print** | 13 Exhibitor | false | false | 24 Aug **06:51** |
| **42** | Hall 1 / **Conference** | scanner | 12 Standard | true | true | 24 Aug **07:15** |

**Terminal 41** — Suer ran the SQL from `MONDAY_PREFAIR_20260824.md` §3.5 verbatim. Live check
returns `kind:"bulk_print"`, `expoId:13`, template 13 `visitor_type=exhibitor`. **The bulk-print
blocker is closed.** URL as issued:

```
https://leena.app/bulk-badge-print.html?key=15b1182e-632d-493d-9201-7d01e0d63d59
```

**Terminal 42 — is it what `conference-scanner.html` expects? Yes.**
The page authenticates with `terminalAuth`, **not** `dualAuth`, and `terminalAuth` never inspects
`kind` — it only requires `is_active = TRUE`. So `kind='scanner'` is correct here; a
`bulk_print` kind would have been wrong. Both endpoints the page calls answered live with this
key: `/api/conference-certificates/topics` → 200 with 7 topics, `/blocked-topics` → 200 with an
empty list (the Cool Plus block is expo-7/form-39 specific and correctly does not apply).

```
https://leena.app/conference-scanner.html?terminal_key=80b25686-a65e-4811-839a-35ea72024fc5
```

⚠️ Note the param name is **`terminal_key`** here, while bulk print uses **`key`**. Different
pages, different spellings — hand out the URLs, not the keys.

The bound badge template (12) is irrelevant on this page — the conference scanner issues
certificates, it does not print badges.

## A2. Form 55 topics — and a correction to yesterday's report

**Form 55 is unchanged** (`updated_at` 10 Aug 13:37, still 4 options). Visitor data still holds
101 canonical segments and **8 orphan holders** (topics numbered 6 and 7, plus one `Choice One`).

### ⚠️ CORRECTION — the orphans are NOT unreachable

Yesterday I wrote that the hostess dropdown is built from form 55's canonical options, so the 8
orphans "cannot be matched … and would require force". **That was wrong.**
`GET /api/conference-certificates/topics` builds the list from **`visitors.custom_fields`**, not
from the form:

```sql
SELECT custom_fields->>'conference_topic' AS topic, COUNT(*)
FROM visitors WHERE expo_id = $1 AND custom_fields->>'conference_topic' IS NOT NULL ...
```

Live response for terminal 42 — **all 7 topics are selectable**:

| registered | topic |
|---:|---|
| 63 | 1. Panel Session \| Building the Future of Nigeria… |
| 24 | 2. Panel Session \| Smart Cities, Green Technology… |
| 9 | 3. Plenary Session \| Institutionalizing ESG… |
| 6 | 4. Panel Session \| Decarbonizing the Built Environment… |
| **4** | **7. Panel Session \| Costarchem; Building A Strong Future** |
| **3** | **6. Panel Session \| The leading manufacturer of pipes in Nigeria** |
| **1** | **Choice One** |

Because both sides of `isVisitorRegisteredForTopic` read the same stored strings, those 8 people
match **exactly** and certify normally. **No force needed.** The residual issue is cosmetic: three
junk rows in the dropdown, one of them the obvious leftover `Choice One`.

(Counts total 110 against 107 topic-holding visitors — multi-topic people count once per topic.)

## A3. 🔴 Certificate system — expo 13 would issue **Ghana** certificates

**This is the blocker of the evening.**

### How May's generation worked

Certificates are **not** data-driven. Both the email body and the certificate page are
**hardcoded in the repo**, selected by a literal expo id:

- `routes/conferenceCertificates.js:25` — `CERT_EMAIL_TEMPLATE` (Ghana)
- `routes/conferenceCertificates.js:85` — `CERT_EMAIL_TEMPLATE_NG` (Nigeria May)
- `:329` (issue) and `:616` (resend) — `const emailTemplate = (Number(expoId) === 7) ? CERT_EMAIL_TEMPLATE_NG : CERT_EMAIL_TEMPLATE;`
- `public/certificate.html:523-524` — `if (Number(cert.expo_id) === 7) location.replace('certificate-ng.html' + location.search)`

This is the **Method A2** pattern recorded in CLAUDE.md v4.0.5 (commit `9a20641`): a separate page
file plus a redirect branch, chosen over DOM override because the two designs diverge structurally.

Storage per certificate is minimal — `conference_certificates` holds
`visitor_id, expo_id, conference_topic, certificate_token, email_sent`. **There is no per-topic
config and no per-expo template table.** One page serves every topic; the page binds three
elements from `GET /verify/:token` (`certificate-ng.html:636-638`): `.field` (name), `.topic`,
`.cert-id`.

Usage to date: **expo 5 (Ghana) 480 certificates · expo 7 (May Nigeria) 2 · expo 13 zero.**

### What expo 13 gets today

`13 !== 7`, so **every branch falls through to the Ghana template.** An MP26 attendee scanned
tomorrow would receive:

- **Email**: Mega Clima Ghana logo, red `#d6232a`, header text
  *"3–5 March 2026 • The Palms Convention Centre, Accra, Ghana"*
- **Certificate page**: `<title>Mega Clima Certificate</title>`, Ghana logo, and the body line
  *"has successfully participated in the **Mega Clima Ghana 2026** — HVAC+R Technical Conference &
  Exhibition held on **3–5 March 2026** at **The Palms Convention Centre, Accra, Ghana**"*,
  signed *"Authorized by Ashrae Ghana Chapter"*

Wrong event, wrong country, wrong dates, wrong venue, wrong authorising body. **Terminal 42 is
live right now**, so the first hostess scan issues this.

### What we need from ops tonight to install a real one

**One file, not seven.** The topic is injected at render time, so a single template covers all
sessions.

| | required |
|---|---|
| **Format** | A complete **HTML file** (self-contained, inline CSS), the same shape as `certificate-ng.html`. A PDF or an image cannot be used — the page must inject name/topic/cert-id at runtime. |
| **Dimensions** | **A4 landscape** print CSS, matching `certificate-ng.html`'s existing `@page` rules. Screen layout is fluid; print is what matters. |
| **Per topic?** | **No — one file.** It must contain the three binding hooks: an element with class **`.field`** (attendee name), **`.topic`** (session title), **`.cert-id`** (certificate number). |
| **Assets** | Absolute `https://` URLs for logos/signatures — the page is public and unauthenticated. |
| **Copy** | Event name, dates (25–27 Aug 2026), venue (Landmark Centre, Lagos), authorising body, and the desired cert-id prefix (May used `MCN-2026-<token[0:10]>`). |
| **Email banner** | Logo URL + header/accent colour + the one-line event/venue/date string for the email body. |

### Install steps (≈4 edits, one deploy)

1. Add `public/certificate-mp26.html` — ops' markup verbatim, plus the `<script>` block copied
   from `certificate-ng.html:624-640` (fetch `/verify/:token`, bind `.field` / `.topic` /
   `.cert-id`, hide before fetch, error overlay).
2. `public/certificate.html` — add a second branch beside `:523`:
   `if (Number(cert.expo_id) === 13) location.replace('certificate-mp26.html' + location.search);`
3. `routes/conferenceCertificates.js` — add `CERT_EMAIL_TEMPLATE_MP26` (clone the NG constant's
   **structure**, swap branding only), then extend both selectors at `:329` and `:616` to
   `expoId === 13 ? MP26 : expoId === 7 ? NG : GHANA`.
4. Deploy, then issue one certificate against a test visitor on expo 13 and open the emailed link.

Ghana (`expo 5`) and May (`expo 7`) paths must stay **byte-identical** — additive branches only.

⚠️ **Until this ships, terminal 42 should not be used**, or every attendee gets a Ghana
certificate. Deactivating terminal 42 is a one-line UI toggle if the file does not arrive tonight.

## A4. Keyboard-wedge behaviour for USB scanners

A wedge scanner types the payload and appends **Enter**. The page handles that correctly:

| requirement | state |
|---|---|
| Enter submits | ✅ `qrscanner.html:542` — `keypress` → `if (e.key === 'Enter' && !isProcessing) handleQRScan()` |
| Field focused on load | ✅ `:139` `<input … autofocus>` |
| Double-fire protection | ✅ the `isProcessing` guard blocks a second scan mid-flight |
| Field cleared + refocused after success | ✅ `:630` |
| Field cleared + refocused after error | ✅ `:636` |
| Long payloads | ✅ plain text input, no maxlength |
| Email fallback | ✅ typing an address instead of scanning resolves via `/terminal/visitor-by-email` (`:584`) |

**The gap: there is no focus-restore safety net.** No `window` focus handler, no click-to-refocus,
no interval. Focus can be lost three ways — the badge popup takes it (`badge.html:412`
auto-prints after 300 ms and **never closes itself**), a stray tap on the page chrome, or the
manual-registration toggle. Once lost, the next wedge scan **types into nothing and silently does
nothing** — no error, no beep, no row.

The `.focus()` at `:630` fires immediately *after* `window.open`, i.e. while the parent is already
backgrounded, so it depends on the browser restoring the last-focused element when the popup is
dismissed. **May proves it works in practice** (2,212 scans) — but it is unguarded.

For a supermarket-style setup: **tell hostesses to close the badge popup after each print**, and
if scans stop registering, click the input box once. A one-line refocus net is listed as an
optional extra in Part B.

---

# PART B — `qrscanner.html` hardening (PROPOSAL, not implemented)

## B1. What changes and why

| # | change | rationale |
|---|---|---|
| 1 | Remove the Auto Check-in switch; check-in is always on | It is a live client-side switch that silently converts the desk into a badge printer that records nothing. `terminals.auto_checkin` is dead config (stored, editable, read by no route), so nothing else disagrees. The real server switch, `expos.settings.auto_checkin_on_badge_print`, stays authoritative. |
| 2 | **Fail closed** — badge opens only after `POST /terminal/checkin` succeeds | Today `performCheckin` swallows every error (`:733`) and the badge prints anyway. A wifi blip means people walk in unrecorded and nobody notices. |
| 3 | Duplicate becomes visible | The backend already returns `duplicate:true`; the UI discards it. A re-scan and a first scan look identical. |

**⚠️ Change 2 inverts the failure mode, deliberately.** Today a broken API means silent
under-counting but the queue keeps moving. After this, a broken API **stops the queue**. That is
the right trade for a system whose whole purpose is the attendance record — but it is Suer's call,
and it is the reason this is a proposal rather than a commit.

## B2. The diff — `public/qrscanner.html` only

### (a) Remove the switch — delete markup at `:396-404`

```diff
@@ -393,12 +393,6 @@
-                <div class="setting-item">
-                    <div>
-                        <div class="setting-label">Auto Check-in</div>
-                        <div class="setting-description">Automatically check-in visitor after badge print</div>
-                    </div>
-                    <div class="form-check form-switch">
-                        <input class="form-check-input" type="checkbox" id="autoCheckin" checked>
-                    </div>
-                </div>
```

```diff
@@ -415 +409 @@
-        let autoCheckinEnabled = true;
+        // Check-in is ALWAYS on. The former UI switch silently turned the desk into a
+        // badge printer that recorded nothing; terminals.auto_checkin is dead config.
+        // Server-side authority remains expos.settings.auto_checkin_on_badge_print.
```

```diff
@@ -551 +545 @@
-            document.getElementById('autoCheckin').addEventListener('change', (e) => { autoCheckinEnabled = e.target.checked; });
```

### (b) New UI — blocking error panel + duplicate note (insert after `:134`)

```diff
@@ -134,6 +134,17 @@
             <div id="alertMessage" class="alert" style="display: none;"></div>
+            <!-- fail-closed check-in failure: blocking, requires Retry or Cancel -->
+            <div id="checkinError" style="display:none;background:#c0392b;color:#fff;padding:18px 20px;
+                 border-radius:8px;margin-bottom:14px;text-align:center;">
+              <div style="font-size:20px;font-weight:700;margin-bottom:6px;">⚠ CHECK-IN FAILED</div>
+              <div id="checkinErrorMsg" style="font-size:14px;opacity:.95;margin-bottom:12px;"></div>
+              <div style="font-size:13px;opacity:.9;margin-bottom:12px;">Badge NOT printed. Do not let the visitor through.</div>
+              <button id="checkinRetryBtn" class="btn btn-light" style="font-weight:600;">Retry</button>
+              <button id="checkinCancelBtn" class="btn btn-outline-light" style="margin-left:8px;">Cancel</button>
+            </div>
+            <!-- duplicate: informational only, badge still prints -->
+            <div id="dupNote" style="display:none;background:#f9e79f;color:#7d6608;padding:10px 14px;
+                 border-radius:6px;margin-bottom:12px;font-weight:600;text-align:center;"></div>
```

### (c) `performCheckin` returns a result instead of swallowing (`:720-752`)

```diff
-        async function performCheckin(visitorId) {
+        // Returns { ok, duplicate, error }. NEVER throws — callers branch on .ok.
+        async function performCheckin(visitorId) {
             const { expoId } = getStorageData();
 
             if (terminalKey) {
-                if (!visitorId) return;
+                if (!visitorId) return { ok:false, duplicate:false, error:'No visitor id returned' };
                 try {
                     const response = await fetch(`${API_BASE_URL}/terminal/checkin`, {
                         method: 'POST',
                         headers: buildHeaders(true),
                         body: JSON.stringify({ visitor_id: visitorId, notes: `Scanned at ${hall || 'main'} - Terminal ${terminal || '1'}` })
                     });
                     const result = await response.json();
-                    if (response.ok) console.log('Terminal check-in successful');
-                    else console.warn('Terminal check-in failed:', result);
+                    if (!response.ok || result.success === false) {
+                        return { ok:false, duplicate:false, error: (result && (result.message || result.error)) || `HTTP ${response.status}` };
+                    }
+                    return { ok:true, duplicate: result.duplicate === true, error:null };
-                } catch (error) { console.error('Terminal check-in error:', error); }
-                return;
+                } catch (error) {
+                    return { ok:false, duplicate:false, error: 'Network error — ' + (error.message || 'request failed') };
+                }
             }
 
-            if (!expoId || !visitorId) return;
+            if (!expoId || !visitorId) return { ok:false, duplicate:false, error:'Missing expo or visitor id' };
             try {
                 const response = await fetch(`${API_BASE_URL}/checkins`, { /* unchanged body */ });
                 const result = await response.json();
-                if (response.ok) console.log('Check-in successful');
-                else console.warn('Check-in failed:', result);
-            } catch (error) { console.error('Check-in error:', error); }
+                if (!response.ok || result.success === false) {
+                    return { ok:false, duplicate:false, error: (result && (result.message || result.error)) || `HTTP ${response.status}` };
+                }
+                return { ok:true, duplicate: result.duplicate === true, error:null };
+            } catch (error) {
+                return { ok:false, duplicate:false, error: 'Network error — ' + (error.message || 'request failed') };
+            }
         }
```

### (d) Helpers (new, add beside the UI helpers at `:755`)

```diff
+        let pendingCheckin = null;   // { visitorId, qrCode, afterSuccess }
+
+        function beep(ok) {
+            try {
+                const ctx = new (window.AudioContext || window.webkitAudioContext)();
+                const o = ctx.createOscillator(), g = ctx.createGain();
+                o.connect(g); g.connect(ctx.destination);
+                o.frequency.value = ok ? 880 : 220;
+                g.gain.value = 0.15;
+                o.start(); setTimeout(() => { o.stop(); ctx.close(); }, ok ? 120 : 500);
+            } catch (e) { /* audio unavailable — visual state is the primary signal */ }
+        }
+        function showCheckinError(msg, ctx) {
+            pendingCheckin = ctx;
+            document.getElementById('checkinErrorMsg').textContent = msg;
+            document.getElementById('checkinError').style.display = 'block';
+            beep(false);
+        }
+        function hideCheckinError() {
+            document.getElementById('checkinError').style.display = 'none';
+            pendingCheckin = null;
+        }
+        function showDupNote(show) {
+            const el = document.getElementById('dupNote');
+            el.textContent = 'Already checked in — reprinting badge';
+            el.style.display = show ? 'block' : 'none';
+        }
+        function openBadgeAndReset(qrCode) {
+            window.open(buildBadgeUrl(qrCode), '_blank', 'width=600,height=400');
+            const si = document.getElementById('scanInput');
+            si.value = ''; si.focus();
+        }
+        // wired in setupEventListeners():
+        //   checkinRetryBtn  → hideCheckinError(); retryCheckin();
+        //   checkinCancelBtn → hideCheckinError(); scanInput.value=''; scanInput.focus();
+        async function retryCheckin() {
+            if (!pendingCheckin) return;
+            const ctx = pendingCheckin;
+            showLoading(true);
+            const ci = await performCheckin(ctx.visitorId);
+            showLoading(false);
+            if (!ci.ok) { showCheckinError(ci.error, ctx); return; }
+            showDupNote(ci.duplicate);
+            ctx.afterSuccess(ci);
+        }
```

### (e) Scan flow — fail closed (`:605-630`)

```diff
+                hideCheckinError(); showDupNote(false);
                 if (terminalKey) {
                     const response = await fetch(`${API_BASE_URL}/terminal/visitor-by-qr?...`, { headers: buildHeaders() });
                     if (!response.ok) throw new Error('Badge not found');
                     const result = await response.json();
                     const visitor = result.visitor;
-                    if (autoCheckinEnabled && visitor.id) {
-                        await performCheckin(visitor.id);
-                    }
+                    const ci = await performCheckin(visitor.id);
+                    if (!ci.ok) {
+                        showCheckinError(ci.error, { visitorId: visitor.id, qrCode,
+                            afterSuccess: () => openBadgeAndReset(qrCode) });
+                        return;                       // ← NO BADGE
+                    }
+                    showDupNote(ci.duplicate);
                 } else {
                     /* normal mode — identical shape against visitorData.id */
                 }
-                // Badge print for ALL visitor types
-                window.open(buildBadgeUrl(qrCode), '_blank', 'width=600,height=400'); document.getElementById('scanInput').value = ''; document.getElementById('scanInput').focus();
+                // Badge prints ONLY after a confirmed check-in
+                openBadgeAndReset(qrCode);
```

`return` inside the `try` still runs the `finally` block, so `isProcessing` is released and the
next scan works while the error panel is up.

### (f) Manual registration — same treatment (`:700-709`)

```diff
-                if (autoCheckinEnabled && result.visitor_id) {
-                    await performCheckin(result.visitor_id);
-                }
-                showAlert('Registration successful!', 'success');
+                const ci = await performCheckin(result.visitor_id);
+                if (!ci.ok) {
+                    // The visitor row EXISTS — say so, or the hostess will re-register them.
+                    showCheckinError('Visitor registered, but check-in failed: ' + ci.error
+                        + ' — do NOT re-register, press Retry.',
+                        { visitorId: result.visitor_id, qrCode, afterSuccess: () => finishManual(qrCode) });
+                    isProcessing = false; showLoading(false);
+                    return;                            // ← NO BADGE
+                }
+                showDupNote(ci.duplicate);
+                showAlert('Registration successful!', 'success');
                 isProcessing = false;
                 showLoading(false);
-                setTimeout(() => { window.open(...); ...reset form... }, 500);
+                finishManual(qrCode);   // same body, extracted so Retry can reuse it
```

The wording matters: on the manual path the **visitor has already been created**. Without that
sentence a hostess seeing "CHECK-IN FAILED" will re-type the person and produce a duplicate — the
upsert protects the QR, but it wastes 30 seconds in a queue.

### (g) OPTIONAL — the focus net from §A4 (approve or drop separately)

```diff
+            // Wedge scanners type into whatever has focus. If the badge popup or a stray
+            // tap steals it, scans go nowhere silently. Cheapest possible net:
+            document.addEventListener('click', () => {
+                if (document.getElementById('manualForm').classList.contains('active')) return;
+                if (document.getElementById('checkinError').style.display === 'block') return;
+                document.getElementById('scanInput').focus();
+            });
```

## B3. Blast radius

**One file: `public/qrscanner.html`.** No backend change, no schema change, no other page imports
it. `POST /api/terminal/checkin` and its duplicate semantics are untouched — the diff only stops
discarding the response.

| | |
|---|---|
| Lines touched | ~9 regions: markup `:134`, `:396-404`; JS `:415`, `:551`, `:605-630`, `:700-709`, `:720-752`, plus ~60 new lines of helpers |
| Deploy | Render web service restart — **10–50 s of HTTP 502** (G3). The email worker is a separate service and is not restarted. |
| **In-progress hostess session** | **Sees nothing.** A deploy does not reload an open tab; she keeps running the old code — old switch, old silent-failure behaviour — until someone refreshes. **The new behaviour requires a manual refresh on every tablet.** |
| Mid-scan during the 502 | A scan landing in the restart window fails at `/terminal/visitor-by-qr` and shows the existing "Badge not found" message. Re-scan works. Same as today. |
| Rollback | `git revert` + redeploy; single file, no state to unwind. |
| Reversibility of behaviour | Total. Nothing persists; the only durable artefacts are `checkins` rows, which are written by the unchanged backend. |

**Recommended deploy window: tonight, then refresh every tablet and run B4.** Deploying after
10:00 tomorrow means tablets run mixed code until each is refreshed.

## B4. Smoke test — 4 minutes, run on the actual tablet

Use terminal **T1** (`?terminal_key=b3b32aae-d70a-4370-a9f0-d35129929ff4`) and a disposable
visitor, not a real attendee.

| # | action | expected |
|---|---|---|
| 1 | Confirm the Auto Check-in switch is **gone** from Settings | no switch rendered |
| 2 | Scan the test QR | badge popup opens; no yellow note; **+1** `checkins` row |
| 3 | **Scan the same QR again** within 120 s | badge popup opens; **yellow "Already checked in — reprinting badge"**; `checkins` count **unchanged** |
| 4 | Turn wifi/airplane mode **off**, scan | **red CHECK-IN FAILED panel**, low beep, **no badge popup**, Retry + Cancel visible |
| 5 | Restore wifi, press **Retry** | panel clears, badge opens, **+1** row |
| 6 | Press **Cancel** on a failed scan instead | panel clears, no badge, input refocused, next scan works |
| 7 | Manual registration with wifi off | red panel reading *"Visitor registered, but check-in failed … do NOT re-register"*; visitor row exists; Retry then completes it |

Verification query between steps (read-only):

```sql
SELECT id, visitor_id, terminal, source, checkin_time
FROM checkins WHERE expo_id = 13 ORDER BY id DESC LIMIT 5;
```

Baseline before testing: **13 rows**, all from setup. Remove test rows afterwards if the count
matters for opening-day reporting.

---

## Standing

**Closed today:** bulk print (terminal 41 live), conference terminal (42 live and answering),
and the orphan-topic worry was my error — all 7 topics are selectable and the 8 people certify
normally.

**Open, in order:**
1. 🔴 **Certificate branding** — terminal 42 currently issues **Ghana** certificates. Needs ops'
   HTML tonight, or deactivate terminal 42.
2. 🟠 **Part B** — awaiting Suer's decision; requires a tablet refresh after deploy.
3. 🟠 T3/T4 mis-badging (0 speakers, 0 VIPs on expo 13).
4. 🟡 Tablet login for the walk-in path; hostesses told to keep the badge popup closed.

---

# PART C — MP26 certificate install (PROPOSAL, ships with Part B)

Added after ops confirmed the expo-13 certificate as a standalone A4-landscape HTML using
`{{name}} {{last_name}} {{conference_topic}}` and external assets from `nigeriamegaproject.com`.
**Suer supplies the file; nothing below is implemented.** Method: Option 1 / the proven May
`expoId`-switch (commit `9a20641`), Ghana default and expo-7 NG both left byte-identical.

## C1. Fix 1 — the certificate number

Ops' file carries `MPN-2026-{{name}}`, which prints the attendee's first name as the certificate
number. **Replace it with the certificate token prefix**, not `badge_id`. Three reasons, in order
of weight:

1. **Uniqueness.** `conference_certificates` is UNIQUE on `(visitor_id, expo_id, conference_topic)`
   — one person attending two sessions holds **two** certificates. `badge_id` is per *visitor*, so
   both would print the same number. `certificate_token` is per *certificate*.
2. **Verifiability.** The token **is** the lookup key: the printed number is a visible prefix of
   the `/verify/:token` URL the certificate was opened from, so a number can be checked against
   the live record. `badge_id` maps to nothing an auditor can query here.
3. **It is already available.** `GET /verify/:token` returns `name, last_name, company, job_title,
   country, conference_topic, expo_name, expo_id, created_at` (`conferenceCertificates.js:519-524`)
   — **`badge_id` and `qr_code` are not in that payload.** Using `badge_id` would mean widening a
   public unauthenticated endpoint; the token needs no change at all, it is in `location.search`.

**Format:** `MPN-2026-` + first 10 hex chars of the 64-char token, uppercased — mirroring May's
`MCN-2026-<token[0:10]>`. Collision space 16¹⁰ ≈ 1.1 × 10¹² against ~100 certificates.

**Install edit to ops' file — one substitution:**

```diff
-              <div class="cert-id">CERTIFICATE No: MPN-2026-{{name}}</div>
+              <div class="cert-id">CERTIFICATE No: {{certificate_id}}</div>
```

## C2. Fix 2 — `{{conference_topic}}` and the pipe trap

**Measured across all 482 certificate rows in production:**

| | |
|---|---:|
| Rows whose topic contains a **single** `\|` (part of the name) | **482 / 482 — 100%** |
| Rows containing the ` \|\| ` multi-topic separator | **0** |

Every certificate topic in the system contains a single pipe — *"Technical Talk | ASHRAE and its
Role in Code Development"*, *"1. Panel Session | Building the Future of Nigeria…"*. On expo 13, 6
of the 7 distinct topics do.

**So the correct handling is to not split at all.** `conference_certificates.conference_topic`
holds exactly **one** topic — the one selected at scan time — never the visitor's merged string.
`issueCertificate` inserts the single selected topic; the ` || ` merge lives only in
`visitors.custom_fields`.

**Any renderer that splits on `|` would shred 100% of certificate topics.** The proposal renders
the stored value **verbatim**, with one defensive branch that has never fired in 482 rows:

```js
// conference_certificates holds ONE topic. Verbatim is correct.
// Split ONLY on the exact " || " separator — never on a bare "|", which is
// part of every topic NAME we have ever issued (482/482). See G-series.
var topic = c.conference_topic || '';
if (topic.indexOf(' || ') !== -1) topic = topic.split(' || ').map(t => t.trim()).join('  •  ');
```

## C3. New file — `public/certificate-mp26.html`

Ops' markup verbatim, plus this script before `</body>`. It replaces placeholders **in text nodes
only**, via `nodeValue` assignment, which never parses HTML — so a visitor named `<script>` is
inert by construction. No `innerHTML`, no escaping helper needed.

```diff
+<script>
+(function () {
+  var params = new URLSearchParams(location.search);
+  var token  = params.get('token') || '';
+  var root   = document.body;
+  root.style.visibility = 'hidden';          // never show raw {{placeholders}}
+
+  function fail(msg) {
+    root.style.visibility = 'visible';
+    root.innerHTML = '<div style="font-family:Arial,sans-serif;text-align:center;padding:60px;">'
+      + '<h2 style="color:#c0392b;">Certificate not available</h2><p>' + msg + '</p></div>';
+  }
+  if (!token) { fail('No certificate token in the link.'); return; }
+
+  fetch('/api/conference-certificates/verify/' + encodeURIComponent(token))
+    .then(function (r) { return r.json(); })
+    .then(function (d) {
+      if (!d || !d.success || !d.certificate) { fail('This certificate link is invalid or expired.'); return; }
+      var c = d.certificate;
+
+      // See C2 — split ONLY on " || ", never on a bare "|".
+      var topic = c.conference_topic || '';
+      if (topic.indexOf(' || ') !== -1) {
+        topic = topic.split(' || ').map(function (t) { return t.trim(); }).filter(Boolean).join('  •  ');
+      }
+
+      var values = {
+        name:             c.name || '',
+        last_name:        c.last_name || '',
+        conference_topic: topic,
+        company:          c.company || '',
+        job_title:        c.job_title || '',
+        country:          c.country || '',
+        expo_name:        c.expo_name || '',
+        // See C1 — token prefix, not badge_id: unique per certificate and verifiable.
+        certificate_id:   'MPN-2026-' + token.slice(0, 10).toUpperCase()
+      };
+
+      // Text nodes ONLY. Assigning nodeValue never parses HTML → XSS-safe by construction.
+      // NOTE: placeholders inside ATTRIBUTES are deliberately not substituted.
+      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
+      var node, pending = [];
+      while ((node = walker.nextNode())) { if (node.nodeValue.indexOf('{{') !== -1) pending.push(node); }
+      pending.forEach(function (n) {
+        n.nodeValue = n.nodeValue.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, key) {
+          return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m;
+        });
+      });
+
+      root.style.visibility = 'visible';
+    })
+    .catch(function () { fail('Could not load this certificate. Please try again.'); });
+})();
+</script>
```

**Contract for ops' file** — three things must hold, checkable in one grep at install:
- placeholders appear in **text content**, not inside attributes (`alt="{{name}}"` will not fill);
- asset URLs are absolute `https://` (the page is public and unauthenticated);
- keep a manual **Print / Save PDF** button as `certificate-ng.html:443` does — do **not** add
  `window.print()` on load, or it fires before the `nigeriamegaproject.com` images arrive.

## C4. `public/certificate.html` — add the expo-13 branch

```diff
@@ -521,6 +521,10 @@
         if (Number(cert.expo_id) === 7) {
           location.replace('certificate-ng.html' + location.search);
+          return;
+        }
+        if (Number(cert.expo_id) === 13) {
+          location.replace('certificate-mp26.html' + location.search);
           return;
         }
```

Ghana rendering below this point is untouched.

## C5. `routes/conferenceCertificates.js` — email template + selector

```diff
@@ -84,6 +84,17 @@
 const CERT_EMAIL_TEMPLATE_NG = `
 ...unchanged...
 `;
+
+// --- Certificate email — Nigeria Mega Project Expo 2026 (expo_id=13) ---
+// Same STRUCTURE as CERT_EMAIL_TEMPLATE_NG (a tested email-client layout);
+// branding values below are lifted from ops' delivered certificate file.
+const CERT_EMAIL_TEMPLATE_MP26 = `
+  ...NG structure, with:
+     header background  → ‹MP26 accent colour from ops file›
+     logo               → https://nigeriamegaproject.com/‹logo asset›
+     header sub-line    → 25–27 August 2026 &bull; Landmark Centre, Lagos, Nigeria
+     CTA href           → {{certificate_url}}   (unchanged mechanism)
+`;
```

```diff
@@ -329 +340 @@ issueCertificate
-  const emailTemplate = (Number(expoId) === 7) ? CERT_EMAIL_TEMPLATE_NG : CERT_EMAIL_TEMPLATE;
+  const emailTemplate = (Number(expoId) === 13) ? CERT_EMAIL_TEMPLATE_MP26
+                      : (Number(expoId) === 7)  ? CERT_EMAIL_TEMPLATE_NG
+                      : CERT_EMAIL_TEMPLATE;
@@ -616 +628 @@ /resend
-    const emailTemplate = (Number(cert.expo_id) === 7) ? CERT_EMAIL_TEMPLATE_NG : CERT_EMAIL_TEMPLATE;
+    const emailTemplate = (Number(cert.expo_id) === 13) ? CERT_EMAIL_TEMPLATE_MP26
+                        : (Number(cert.expo_id) === 7)  ? CERT_EMAIL_TEMPLATE_NG
+                        : CERT_EMAIL_TEMPLATE;
```

**Both selectors must change.** Missing `/resend` is how a resent certificate silently reverts to
Ghana branding — the exact class of bug the May notes warn about.

## C6. Combined deploy — Part B + Part C

| file | change | risk |
|---|---|---|
| `public/qrscanner.html` | Part B: no switch, fail-closed, visible duplicate | behaviour inversion — see B1 |
| `public/certificate-mp26.html` | **new** | none — nothing links to it until C4 lands |
| `public/certificate.html` | +5 lines, expo-13 branch | none for expo 5/7 |
| `routes/conferenceCertificates.js` | +1 constant, 2 selectors | **backend** — see below |

⚠️ **This is no longer a frontend-only deploy.** Part B alone touched one static file; adding
`conferenceCertificates.js` means the Node process restarts — still the same single Render web
service and the same 10–50 s 502 window (G3), but now the conference/certificate API is in scope.
The email worker is a separate service and is untouched.

**Ordering:** ship C **before** anyone uses terminal 42. It is live right now and would issue
Ghana certificates today (§A3). If ops' file does not arrive tonight, deactivate terminal 42
rather than deploying B alone and leaving the certificate path armed.

**Zero existing rows are affected.** Expo 13 has **0** certificates, so there is nothing to
re-render or migrate — this is forward-only, exactly as the May install was.

## C7. Smoke test — certificate (run after B4)

1. On `conference-scanner.html?terminal_key=80b25686-…`, pick a topic and scan a **test** visitor.
2. Expect success, and an email whose header reads **25–27 August 2026 • Landmark Centre, Lagos** —
   **not** Accra. Any mention of Ghana means the selector at `:340` did not take.
3. Open the emailed link → must land on `certificate-mp26.html`, not `certificate.html`.
4. Verify on the page: full name, the **exact** session title *including its single pipe*, and a
   cert number of the form `MPN-2026-XXXXXXXXXX`. **No `{{ }}` anywhere.**
5. Confirm that cert number's 10 chars are the opening characters of `?token=` in the URL bar.
6. Press **Print / Save PDF** → A4 landscape, images present.
7. Re-scan the same visitor + topic → duplicate overlay → **Resend Certificate** → the resent
   email must be MP26-branded too (this is what proves `:628` was changed).
8. Regression: open any **expo 5** certificate link → still the Ghana page, unchanged.

## C8. What is still needed from Suer

1. **The HTML file** — then C1's one-line cert-id substitution and the C3 script append.
2. **Email branding values**: logo URL, accent colour, and confirmation of the header line
   *"25–27 August 2026 • Landmark Centre, Lagos, Nigeria"*.
3. **Approval to deploy B + C together**, and the window. Tablets need a manual refresh after
   deploy for Part B to take effect (§B3).

---

# PART D — deploy record + verification results (24 Aug, night)

**Shipped and live.** Four commits, one Render deploy cycle each for the last two.

| commit | scope |
|---|---|
| `e900b70` | scanner: fail-closed check-in, switch removed, duplicate note |
| `3e14bf8` | `certificate-mp26.html` + expo-13 redirect branch |
| `d06069e` | MP26 email template + selectors at issue **and** resend |
| `668fd5c` | walker guard (found during verification, see D3) |

Deploy windows measured: **~60 s** and **~50 s**, each with ~30 s of 502 — consistent with G3.

## D1. Certificate smoke test — PASS

Issued against **visitor 59725** (`elan02@elan-expo.com`, Elan's own address), deliberately
chosen because it holds a ` || ` multi-topic value *and* topics whose names contain single pipes —
the exact trap.

| check | result |
|---|---|
| Issue via terminal 42 | ✅ `success:true`, certificate **id 612** |
| Cert number | ✅ **`MPN-2026-107466E308`** — matches token `107466e308…` |
| Topic rendered | ✅ *"1. Panel Session **\|** Building the Future of Nigeria: State Infrastructure Priorities, Investment Opportunities & Innovative Financing"* — **single pipe intact, not shredded** |
| Name rendered | ✅ "Elahe Dorreh" |
| Unfilled `{{ }}` | ✅ none |
| Email branding | ✅ MP26 logo · `#009846` · "25–27 August 2026 • Landmark Centre, VI Lagos" |
| **Ghana leak** | ✅ **none** — no "Ghana", "Accra", "Mega Clima" or `westafricahvacexpo` anywhere |
| Duplicate re-scan | ✅ `duplicate:true`, same token, no second certificate |
| **Resend** | ✅ **also MP26-branded** — this is what proves the `:676` selector took |
| Check-in row | ✅ id 20312, `terminal='Conference'`, `source='conference-cert'` |
| Expo-5 Ghana regression | ✅ unchanged |
| Page mechanics | ✅ A4 landscape, manual print button, no `window.print()` on load |

**Test artefacts left in production** — remove before opening if the counts matter:

```sql
DELETE FROM conference_certificates WHERE id = 612;
DELETE FROM checkins WHERE id = 20312;
```

## D2. Scanner — live, verification is Suer's laptop test

Confirmed served from production: `id="autoCheckin"` **0 occurrences**, `autoCheckinEnabled`
**0**, `id="checkinError"` present, `id="dupNote"` present, `retryCheckin` present.

**⚠️ Every laptop must be refreshed.** A deploy does not reload an open tab — a browser opened
before tonight keeps running the old switch-and-silent-failure code.

### Test plan — 4 minutes per laptop, T1 key `b3b32aae-d70a-4370-a9f0-d35129929ff4`

| # | do | expect |
|---|---|---|
| 1 | Open scanner, **hard refresh** (Ctrl/Cmd+Shift+R) | Settings shows **no Auto Check-in switch** |
| 2 | Scan a test badge | badge popup opens, no yellow note, check-in count **+1** |
| 3 | Scan the **same** badge again within 2 min | badge opens, **yellow "Already checked in — reprinting badge"**, count **unchanged** |
| 4 | **Turn wifi off**, scan | **red CHECK-IN FAILED**, low beep, **no badge**, Retry + Cancel |
| 5 | Wifi on, press **Retry** | panel clears, badge opens, count **+1** |
| 6 | Cancel instead of Retry | panel clears, no badge, cursor back in the box, next scan works |
| 7 | Manual registration with wifi off | red panel: *"Visitor registered, but check-in failed … do NOT re-register, press Retry"* |

```sql
SELECT id, visitor_id, terminal, source, checkin_time
FROM checkins WHERE expo_id = 13 ORDER BY id DESC LIMIT 5;
```

## D3. Two things found during verification

**(a) Walker guard — fixed in `668fd5c`.** `NodeFilter.SHOW_TEXT` walks text inside `<script>`,
and the renderer's own source contains a literal `{{` in a comment, so it was visiting itself. No
live bug — nothing matched a values key, and rewriting a script's text after execution changes
nothing — but fixed because a future `{{name}}` inside a `<style>` would start mutating source.

**(b) 🟠 10 C17 emails stuck in `processing` — NOT caused by this deploy.**

Rows `410455-410464`, campaign 17 step 3, enqueued **08:23:03**, `try_count=0`, `sent_at` null.
Rows with higher ids have sent (max sent id 416649), and the queue is flowing at **369.8/min**, so
these are orphaned, not queued behind anything. Same ten ids after 12 seconds — no turnover.

The email worker is a **separate Render service** and web deploys do not restart it, so tonight's
two deploys are not the cause. `try_count=0` says the worker claimed the batch and died or threw
before incrementing. This is known risk **R5 (stale `processing` recovery)**, logged in May:
`fetchNextTask` claims with `FOR UPDATE SKIP LOCKED` and sets `status='processing'`, and **nothing
ever re-claims a row that is left there**.

**Impact: 10 people out of 25,735 never got Monday's step-3 email, and never will.** These are the
only such rows in the entire table's history — zero stuck rows before id 410455.

Recovery, if Suer wants them sent (safe: `sent_at` is null, so no double-send):

```sql
UPDATE email_queue SET status = 'pending'
 WHERE status = 'processing' AND sent_at IS NULL AND id BETWEEN 410455 AND 410464;
```

Post-fair: a sweep that returns `processing` rows older than N minutes to `pending`.

## D4. Reminder list — tonight's laptop setup

**On every hostess laptop, in this order:**

1. **Log in** at `leena.app/login.html`, then **select Nigeria Mega Project Expo 2026** on the expo
   screen. Both steps are required — walk-in registration posts with the JWT, not the terminal
   key, and dies with *"Missing required data. Please login again."* without them.
2. **Open the terminal URL and hard-refresh** (Ctrl/Cmd+Shift+R) so the new scanner code loads.
3. **Run the D2 test plan**, including the wifi-off step. Do it now, not in the queue.
4. **Allow pop-ups for leena.app** — the badge opens in one.
5. **Bookmark the lane URL**, so nobody retypes a key at 10:00:
   - T1 Visitor `qrscanner.html?terminal_key=b3b32aae-d70a-4370-a9f0-d35129929ff4`
   - T2 Exhibitor `…29279c38-4e72-4bf4-81bd-1eb997d2e957`
   - T3 Speaker `…4399d46d-f16c-493e-b979-f589d7e9e5f2`
   - T4 VIP `…492e20c3-4eea-47b0-87e0-87843f9dde32`
   - Conference `conference-scanner.html?terminal_key=80b25686-a65e-4811-839a-35ea72024fc5`
   - Bulk print `bulk-badge-print.html?key=15b1182e-632d-493d-9201-7d01e0d63d59` *(`key=`, not
     `terminal_key=` — different spelling on this page)*
6. **Test the scanner gun** into the box before closing the lid — one real scan end to end.

**Tell the hostesses three things:**
- **Red panel = stop.** The badge did not print and the person is not checked in. Press **Retry**.
  Never wave someone through on a red panel.
- **Yellow note is fine** — it means they were already checked in and the badge is a reprint.
- **Close the badge popup after each print.** It never closes itself, and while it is on top the
  scanner gun may be typing into it instead of the scan box.

**Still open going into tomorrow:**
- 🟠 **T3 Speaker / T4 VIP mis-badge.** Expo 13 has **0 speakers and 0 VIPs**; the layout comes
  from the terminal's template, so an ordinary visitor scanned at T4 gets a VIP badge **with no
  job title**. Close those lanes or repoint them at template 12.
- 🟡 Three junk rows in the conference topic dropdown (topics 6, 7, `Choice One`) — they work, they
  are just untidy.
- 🟡 The 10 stuck emails above — Suer's call.
