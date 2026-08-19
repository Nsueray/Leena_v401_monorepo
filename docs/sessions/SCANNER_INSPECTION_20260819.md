# Scanner Inspection — before stationing a hostess at expo 13's gate
**Date:** 2026-08-19 · **Mode:** read-only. Nothing changed.
Every claim is **MEASURED** (`path:line` or command output) or **HYPOTHESIS** (labelled).

---

# 🔴 HEADLINE — `qrscanner.html` cannot be used on a phone or iPad

**MEASURED: `public/qrscanner.html` contains no camera code at all.**

```
grep -n "getUserMedia|<video|html5-qrcode|Html5Qrcode|camera|jsQR|ZXing" public/qrscanner.html
→ (no matches)
```

Its only external script is Bootstrap (`qrscanner.html:409`). The input is a **text box**:

```html
139:  <input type="text" class="scan-input" id="scanInput"
       placeholder="Scan or enter badge QR code..." autofocus>
542:  scanInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isProcessing) handleQRScan(); });
```

**This is a keyboard-wedge page** — built for a USB/Bluetooth barcode gun attached to a
laptop, which types the code and presses Enter. That matches exactly what the check-in
forensics found: `V1`/`E1` were badge desks with hardware scanners, not gates.

**On a phone, a hostess would face a text field and an on-screen keyboard.** There is nothing
to point at a QR code.

**Only two pages in the codebase can use a camera** (both load `html5-qrcode@2.3.8` from unpkg):

| page | line | purpose |
|---|---|---|
| `public/conference-scanner.html` | 9 | conference check-in **+ certificate issuance** |
| `public/lead-scan.html` | 9 | exhibitor lead capture (public, exhibitor-authed) |

**Neither is a gate check-in page.** Everything below therefore assesses two different things:
**(A)** `qrscanner.html` as it stands, and **(B)** `conference-scanner.html` as the only
camera-capable candidate — because the question "can a hostess scan at the gate today" is
answered by B, not A.

---

## 1. URL & access

### 1.1 The URL — MEASURED

**`qrscanner.html` accepts BOTH spellings** (`qrscanner.html:486`):
```js
486:  const urlTerminalKey = urlParams.get('terminalKey') || urlParams.get('terminal_key');
```
so the May `terminal_key` vs `terminalKey` inconsistency is **already tolerated on this page**.

**The inconsistency is real across pages, though — MEASURED:**

| page | parameter it reads |
|---|---|
| `qrscanner.html` | **`terminalKey` OR `terminal_key`** + `hall`, `terminal` |
| `conference-scanner.html` | **`terminal_key` only** (`:256`) |
| `bulk-badge-print.html` | **`key` only** |

For an expo-13 gate terminal (e.g. terminal 37, `T1 Visitor`, hall `Hall 1`):

```
https://leena.app/qrscanner.html?terminal_key=<KEY>&hall=Hall%201&terminal=T1%20Visitor
https://leena.app/conference-scanner.html?terminal_key=<KEY>          ← camera page
```

`hall` and `terminal` in the URL are **display/localStorage only** — the server derives the
real hall and terminal_no from the key (`middleware/terminalAuth.js`, `req.terminal`). A wrong
`hall=` in the URL does not mis-attribute a check-in. **MEASURED.**

### 1.2 Wrong or deactivated key — MEASURED (`middleware/terminalAuth.js`)

| condition | response |
|---|---|
| Header missing | `401 MISSING_TERMINAL_KEY` |
| Key not in `terminals` | `401 INVALID_TERMINAL_KEY` |
| `is_active = false` | `403 TERMINAL_INACTIVE` |

**Terminal keys never expire** — there is no TTL column and no expiry check. A key works until
`is_active` is set false.

🔴 **But `qrscanner.html` does not surface any of this.** The key is only used inside
`handleQRScan`, so a bad key produces the generic catch at `:632`:

```js
632:  showAlert('Badge not found. Please try manual registration.', 'danger');
```

**A hostess with a wrong key is told "Badge not found" on every single scan.** She would
conclude the visitor's badge is broken, not that her URL is wrong. There is no startup
validation.

**`conference-scanner.html` does this correctly** — it validates up front (`:258-264`):
```js
258:  if (!terminalKey) { showError('Missing Terminal Key', 'Please open this page with a valid terminal_key parameter.'); }
264:  const res = await apiFetch('/api/terminal/status');
```

### 1.3 Refresh / sleep-wake / back button — MEASURED

**Refresh: survives.** The key is persisted (`qrscanner.html:490`):
```js
490:  if (urlTerminalKey) { localStorage.setItem('terminalKey', urlTerminalKey); … }
496:  if (!terminalKey) terminalKey = localStorage.getItem('terminalKey') || null;
```
Once opened with the key, later loads work even without the query string — for that browser
profile on that device.

⚠️ **This is also a security property worth knowing: the key persists in localStorage
indefinitely.** A borrowed or returned device retains gate authority until localStorage is
cleared or the terminal is deactivated.

**Back button: survives** (same localStorage path).

**Sleep-wake — HYPOTHESIS, not tested.** For `qrscanner.html` there is no camera to restart, so
the page itself should resume; the practical risk is that focus leaves `#scanInput` and a
hardware scanner's keystrokes go nowhere. There is no `visibilitychange` handler in the file
(**MEASURED** — grep returns nothing), so **focus is not re-acquired automatically on wake**.
`autofocus` (`:139`) only fires on initial load.

For **`conference-scanner.html` the camera must be restarted after wake** — also no
`visibilitychange` handler. **HYPOTHESIS: iOS Safari suspends the video track on sleep and the
scanner will appear frozen until the page is reloaded.** Not verified — needs a device test.

---

## 2. Speed path — end to end

### 2.1 Initial page load — MEASURED

**`qrscanner.html`** — 771 lines, three external requests: Bootstrap CSS 5.1.3 + Bootstrap
Icons 1.8.1 + Bootstrap JS bundle, all from `cdn.jsdelivr.net`.
**HYPOTHESIS (uncached, typical sizes): ~350-450 KB.**

**`conference-scanner.html`** — adds `html5-qrcode@2.3.8` from `unpkg.com`.
**HYPOTHESIS: ~450-600 KB uncached.**

⚠️ **Both depend on third-party CDNs (jsdelivr, unpkg) at gate-open time.** If the venue's
network blocks or throttles them, the page renders unstyled — and for the camera page,
**`Html5Qrcode` would be undefined and scanning would not start at all**. There is no local
fallback copy. **MEASURED** (no vendored copies under `public/`).

### 2.2 Round-trips per scan — MEASURED

**`qrscanner.html` terminal mode, one scan:**

| # | call | `path:line` |
|---|---|---|
| 1 | `GET /api/terminal/visitor-by-qr?qr=…` | `qrscanner.html:605` |
| 2 | `POST /api/terminal/checkin` | `qrscanner.html:726` (via `performCheckin`) |
| 3 | `window.open(badge.html?qr=…)` → new document load | `qrscanner.html:630` |
| 4 | `POST /api/terminal/badge-print` from the popup | `badge.html:259` |

**4 network operations per scan, one of which is a full page load.** Calls 1 and 2 are
sequential (`await`), not parallel.

Call 4's check-in is then discarded by the 120-second duplicate guard — see the check-in
forensics report. **So one of the four round-trips is, by design, wasted work.**

### 2.3 Server-side work per check-in — MEASURED

`POST /api/terminal/checkin` (`routes/terminalCheckins.js:~395-500`) issues **7 `client.query`
calls** inside one transaction:

1. `getExpoSettings(expoId)` — settings lookup
2. visitor existence check — `WHERE id=$1 AND expo_id=$2 AND organizer_id=$3`
3. `BEGIN`
4. `isDuplicateCheckin` — `WHERE visitor_id AND expo_id AND terminal AND checkin_time > NOW()-120s`
5. `isRevisitToday` — `SELECT DISTINCT DATE(checkin_time) …`
6. `INSERT INTO checkins`
7. `INSERT … visitor_event_status … ON CONFLICT` + `COMMIT`

**Do any of these grow with visitor count?** — the question the `/paginated` weakness taught us
to ask.

**MEASURED: `checkins` has only two indexes** — `checkins_pkey (id)` and
`idx_checkins_expo_id (expo_id)`. There is **no index on `visitor_id`**.

Queries 4 and 5 both filter on `visitor_id`. Postgres will most likely use
`idx_checkins_expo_id` and then filter — meaning **the cost scales with the number of check-in
rows for that expo, not with the number for that visitor.**

**HYPOTHESIS (not EXPLAINed — I did not run EXPLAIN ANALYZE):** at expo-13 scale this is
negligible. Expo 1's worst case was 14,988 rows; a filtered scan of ~15k rows is sub-millisecond
in Postgres. **This is a real shape concern but not a practical one at fair scale.** It is
already logged in `todo.md` as `idx_checkins_visitor_id` from the May sprint.

### 2.4 Realistic scans per minute — HYPOTHESIS with stated assumptions

**Assumptions:** Nigerian 4G, 80-250 ms RTT to Render Oregon *(note: Oregon is far from Lagos —
RTT is dominated by distance, ~250-300 ms is realistic)*; server work ~10-30 ms; hostess
handling ~2-4 s per visitor; page already loaded and warm.

| step | estimate |
|---|---|
| Camera decode (`conference-scanner`, `fps: 10`) | 0.3-1.5 s depending on light |
| Call 1 visitor-by-qr | ~0.3-0.5 s |
| Call 2 checkin (sequential) | ~0.3-0.5 s |
| Badge popup load + call 4 | ~1-2 s |
| Human handling | 2-4 s |

**qrscanner.html with a hardware gun on a laptop: ~10-15 scans/min** — the badge popup is the
bottleneck, and this matches the May measurement (expo 7's busiest hour was 539 check-ins ≈
**9/min sustained across all desks**).

**conference-scanner.html on a phone: ~6-10 scans/min**, capped by a hard-coded pause:
```js
371:  (decodedText) => { scanner.pause(); processQR(decodedText);
373:      setTimeout(() => { try { scanner.resume(); } catch(e) {} }, 3000); }
```
**A 3-second forced pause after every scan = a hard ceiling of 20/min**, before any network or
human time. **MEASURED.**

⚠️ **HYPOTHESIS:** for a 3,700-visitor fair arriving over ~3 hours on day 1, peak arrival could
exceed 20/min at a single gate. One camera device would become the queue.

---

## 3. Failure modes at a gate

### (a) QR from a different expo — **MEASURED: correctly rejected, no leak**

`routes/terminalCheckins.js` `/visitor-by-qr`:
```sql
WHERE v.qr_code = $1 AND v.expo_id = $2 AND v.organizer_id = $3
```
`expoId`/`organizerId` come from `req.terminal`, derived from the key — **not from the client.**
A QR from expo 7 scanned on an expo-13 terminal returns 404. **No cross-expo data leak.**

🟡 But the hostess sees the generic `'Badge not found. Please try manual registration.'`
(`qrscanner.html:632`) — indistinguishable from a damaged code or an unregistered visitor. She
would likely re-register someone who is already in a *different* expo.

### (b) Same badge twice in a row — **MEASURED: silent success, no visible difference**

Server (`terminalCheckins.js`, `/checkin`): within 120 s on the same terminal it returns
**HTTP 200** with `{success:true, duplicate:true, message:'Check-in ignored: duplicate…'}`.

Client: `performCheckin` (`qrscanner.html:726-733`) only does
```js
731:  if (response.ok) console.log('Terminal check-in successful');
```
— **it never inspects `result.duplicate`,** and `console.log` is invisible on a phone.
The badge popup then opens exactly as it does for a first scan.

🔴 **The hostess cannot tell a duplicate from a fresh check-in.** Worse, the badge **reprints**,
so a double-scan silently produces a second badge.

*(For contrast: `conference-scanner.html` does handle duplicates explicitly, with a persistent
overlay and a resend button — `:640-660`.)*

### (c) Network drop mid-scan — **MEASURED: the scan is lost, silently**

There is **no offline capability anywhere**: no service worker, no queue, no retry, no
`localStorage` buffer of pending check-ins (**MEASURED** — grep finds no `serviceWorker`,
no retry logic).

Behaviour by failure point:
- **Call 1 fails** → catch at `:631` → `'Badge not found'` → scan lost, hostess retries.
- **Call 2 fails** → `performCheckin`'s own catch (`:734`) logs to console and **returns
  normally**. Execution continues to `window.open(badge.html)` at `:630`.

🔴 **So a network blip during the check-in call prints the badge and records nothing.** The
visitor walks in holding a valid badge with no check-in row, and the hostess sees a normal
success. **This is the most dangerous failure mode found**, because it is silent in both
directions.

### (d) Camera permission — **N/A for `qrscanner.html`** (no camera).

For `conference-scanner.html` — **MEASURED**: `scanner.start({facingMode:'environment'}, …)`
with a `.catch` that merely shrinks the container and logs `'Camera not available'` (`:377-379`).

**HYPOTHESIS (standard browser behaviour, not tested here):** iOS Safari requires HTTPS (satisfied)
and re-prompts per-origin after the site is closed; Android Chrome remembers the grant. iOS is
also stricter about the video element after backgrounding. **A hostess who denies the prompt once
gets a silently non-functional page** — the catch does not tell her to re-enable permission.

### (e) Cracked / dim screen, inverted codes — **HYPOTHESIS, library-documented**

`html5-qrcode@2.3.8` wraps ZXing-js. Per its documentation it supports standard QR decoding;
**inverted (light-on-dark) codes are not decoded by default** — ZXing requires a separate
inverted-scan pass, and no such option is set here (`:370` passes only `{fps, qrbox}`).

**MEASURED config:** `fps: 10`, `qrbox` = 60% of the smaller viewfinder dimension, min 120 px
(`:363-369`). That is a reasonable target box.

**HYPOTHESIS:** email-rendered QR codes on a dim or cracked phone at low brightness will be the
main real-world failure. Screen glare under exhibition lighting is a bigger factor than the
library. Untested — needs a physical trial.

---

## 4. UX gaps for a gate role

Assessed against `qrscanner.html`, with `conference-scanner.html` as the in-house comparison.

| need | `qrscanner.html` | `conference-scanner.html` |
|---|---|---|
| **Audible success** | 🔴 **none** — grep finds no `Audio`/`beep` | ✅ WebAudio oscillator beep (`:299-325`) |
| **Vibration** | 🔴 **none** | ✅ `navigator.vibrate` (`:327-329`), Android only — iOS unsupported, noted in code |
| **Visual success** | 🔴 **none** — no success `showAlert` on the happy path; the only signal is the badge popup opening | ✅ result cards + coloured overlays |
| **Visitor name shown** | 🔴 **no** — `visitor` is fetched (`:609`) and used only for `visitor.id`; never rendered | ✅ `pv-name` preview card (`:537`) |
| **Visitor type shown** | 🔴 no | ✅ |
| **Running scan count** | 🔴 **none** | ✅ scan log list (`:236-238`) |
| **Continuous scanning** | ✅ input auto-clears + refocuses (`:630`) — good for a gun | 🟡 3 s forced pause per scan (`:373`) |
| **Startup key validation** | 🔴 no | ✅ (`:258-264`) |
| **Duplicate feedback** | 🔴 no | ✅ persistent overlay |

**MEASURED — the success path in full** (`qrscanner.html:629-630`):
```js
// Badge print for ALL visitor types
window.open(buildBadgeUrl(qrCode), '_blank', 'width=600,height=400');
document.getElementById('scanInput').value = '';
document.getElementById('scanInput').focus();
```

**There is no success message of any kind.** The confirmation *is* the popup. In a noisy hall,
on a phone where a popup may be blocked entirely, **the hostess has no signal that anything
happened.**

🔴 **Popup blocking is a distinct risk on mobile: `window.open` inside an `async` function,
after `await`, is no longer inside the user-gesture context.** Desktop browsers usually allow
it; **mobile Safari frequently blocks it.** **HYPOTHESIS — untested**, but if blocked, the
hostess sees literally nothing on a successful scan.

---

## 5. Punch list

| # | Gap | Severity for a gate | Fix size |
|---|---|---|---|
| 1 | **`qrscanner.html` has no camera** — unusable on phone/iPad | 🔴 **blocker** | Add `html5-qrcode` + start/stop + decode handler, ~60-90 lines, 1 file. *Or* station a laptop + USB gun and change nothing. |
| 2 | **Network drop after lookup prints a badge with no check-in row** | 🔴 **blocker** — silent data loss | ~10 lines in `performCheckin`: return a status and gate the `window.open` on it |
| 3 | **Duplicate scan is invisible** and reprints the badge | 🔴 high | ~8 lines — read `result.duplicate` at `qrscanner.html:731` and branch the UI |
| 4 | **No success feedback (sound/vibration/visual/name)** | 🔴 high in a noisy hall | ~40-60 lines, 1 file — the `beep`/`vibrate` helpers already exist in `conference-scanner.html:299-329` and can be lifted verbatim |
| 5 | **No startup key validation** — bad key looks like "badge not found" forever | 🟡 medium | ~12 lines — copy the `/api/terminal/status` probe from `conference-scanner.html:258-264` |
| 6 | **`window.open` may be popup-blocked on mobile** | 🟡 medium | 0 lines if gap 4 is done (on-page confirmation replaces the popup as the signal) |
| 7 | **No offline queue** — any drop loses the scan | 🟡 medium | Real work: ~80-150 lines (localStorage queue + replay). Not a pre-fair change. |
| 8 | **No running scan count** | 🟡 motivation/reconciliation | ~15 lines, client-side counter |
| 9 | **Cross-expo QR shows generic "not found"** | 🟢 low — the security behaviour is correct | ~5 lines to distinguish 404-wrong-expo from 404-unknown |
| 10 | **3 s forced pause caps `conference-scanner` at 20 scans/min** | 🟡 medium if used at a gate | 1 line (`:373`) — but the pause exists to prevent double-decode; needs thought, not just a smaller number |
| 11 | **CDN dependency at gate-open** | 🟡 medium | Vendor `html5-qrcode` + Bootstrap locally, ~3 lines + 2 files |
| 12 | **Terminal key persists in localStorage forever** | 🟡 medium (device loss) | 0 lines — operational: deactivate the terminal after the fair |
| 13 | **No `visibilitychange` handler** — focus/camera not restored after sleep | 🟡 medium | ~10 lines |
| 14 | **No index on `checkins.visitor_id`** | 🟢 low at fair scale | 1 migration line — already in `todo.md` |

### The decision this forces

**MEASURED: there is no page today that does camera-based *gate check-in*.**

- `qrscanner.html` — right endpoints, no camera.
- `conference-scanner.html` — right camera and UX, **but it issues conference certificates**;
  it is not a gate page.

**Three options, sized:**

| option | work | note |
|---|---|---|
| **A. Laptop + USB barcode gun per gate** | **0 lines** | Exactly the May setup. Proven at 539 check-ins/hour. Requires hardware + power at the gate. |
| **B. Add camera to `qrscanner.html`** | ~60-90 lines + gaps 2/3/4 (~60 lines) | One file. Reuses proven endpoints. |
| **C. Fork `conference-scanner.html` into a gate page** | ~40-60 lines removed/changed | Inherits camera, beep, vibrate, name display, scan log, key validation — swap the certificate POST for `/terminal/checkin`. **Cheapest route to a working phone gate.** |

**HYPOTHESIS:** option C is the lowest-risk path to a phone-based gate, because every UX gap in
the punch list (1, 3, 4, 5) is already solved in that file and battle-tested at the May fair.
Not a recommendation — a sizing.

**Nothing above was implemented.**
