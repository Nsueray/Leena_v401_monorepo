// utils/callCenterReport.js
// SIEMA Call-Center daily report — factored out so both the /report/send-now
// endpoint (routes/callcenter.js) and the worker's 19:00 Casa auto-fire
// (email_worker.js) call the SAME buildReport() + sendDailyReport(). The
// caller decides HOW to send; sendDailyReport() enqueues Mode 1 rows into
// email_queue for every CALLCENTER_REPORT_TO recipient.
//
// Idempotency contract:
//   - This module does NOT check "already sent today". The caller
//     (worker scheduler) probes email_queue with a subject-prefix + Casa-
//     today boundary before invoking sendDailyReport().
//   - A manual /report/send-now earlier in the day therefore SUPPRESSES
//     that evening's auto-fire (same subject prefix, same Casa day).
//     Accepted behavior — sending twice is worse than the manual send
//     already having done the job.

const REPORT_SUBJECT_PREFIX = 'SIEMA Call-Center — ';

function casaTodayStartUtc() {
  const now = new Date();
  const casa = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const midnightUtc = new Date(`${casa}T00:00:00Z`);
  // Casablanca is UTC+1 fixed (no DST since 2018) → Casa 00:00 == UTC 23:00
  // previous day. Compute the offset programmatically anyway.
  const casaMidnightStr = new Date(midnightUtc.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
  const offsetMs = midnightUtc.getTime() - casaMidnightStr.getTime();
  return new Date(midnightUtc.getTime() - offsetMs).toISOString();
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseRecipients() {
  const raw = process.env.CALLCENTER_REPORT_TO || '';
  const seen = new Set();
  return raw.split(',').map(s => s.trim())
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function buildDailyReport(pool) {
  const todayStart = casaTodayStartUtc();
  const casaDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: 'long', day: 'numeric'
  }).format(new Date());

  const [perAgent, outcomes, regAfter, poolLeft] = await Promise.all([
    pool.query(
      `SELECT COALESCE(claimed_by, '(unclaimed)') AS agent,
              COUNT(*) FILTER (WHERE done_at >= $1)::int AS calls_today,
              COUNT(*) FILTER (WHERE outcome = 'mail_will_come'    AND done_at >= $1)::int AS mail_will,
              COUNT(*) FILTER (WHERE outcome = 'mail_wont_come'    AND done_at >= $1)::int AS mail_wont,
              COUNT(*) FILTER (WHERE outcome = 'no_mail_whatsapp_sent' AND done_at >= $1)::int AS whatsapp,
              COUNT(*) FILTER (WHERE outcome = 'callback'          AND done_at >= $1)::int AS callback_cnt,
              COUNT(*) FILTER (WHERE outcome = 'no_answer'         AND done_at >= $1)::int AS no_answer,
              COUNT(*) FILTER (WHERE outcome = 'wrong_number'      AND done_at >= $1)::int AS wrong_num,
              COUNT(*) FILTER (WHERE outcome = 'not_interested'    AND done_at >= $1)::int AS not_interested,
              COUNT(*) FILTER (WHERE outcome = 'registered_meanwhile' AND done_at >= $1)::int AS reg_meanwhile
       FROM callcenter_leads
       WHERE claimed_by IS NOT NULL AND done_at >= $1
       GROUP BY agent ORDER BY calls_today DESC`,
      [todayStart]
    ),
    pool.query(
      `SELECT COALESCE(outcome,'(none)') AS outcome, COUNT(*)::int AS n
       FROM callcenter_leads WHERE done_at >= $1
       GROUP BY outcome ORDER BY n DESC`,
      [todayStart]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS reg_after,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id))::int AS checked_in
       FROM callcenter_leads l
       JOIN visitors v ON v.expo_id = l.expo_id AND lower(v.email) = lower(l.email)
       WHERE l.done_at >= $1 AND v.created_at > l.done_at`,
      [todayStart]
    ),
    pool.query(
      `SELECT segment, COUNT(*)::int AS n
       FROM callcenter_leads
       WHERE status = 'new' OR (status = 'callback' AND callback_at <= NOW())
       GROUP BY segment ORDER BY segment`
    )
  ]);

  const agentRows = perAgent.rows.map(r => `
    <tr>
      <td>${esc(r.agent)}</td>
      <td style="text-align:right;">${r.calls_today}</td>
      <td style="text-align:right;">${r.mail_will}</td>
      <td style="text-align:right;">${r.mail_wont}</td>
      <td style="text-align:right;">${r.whatsapp}</td>
      <td style="text-align:right;">${r.callback_cnt}</td>
      <td style="text-align:right;">${r.no_answer}</td>
      <td style="text-align:right;">${r.wrong_num}</td>
      <td style="text-align:right;">${r.not_interested}</td>
      <td style="text-align:right;">${r.reg_meanwhile}</td>
    </tr>`).join('');
  const outcomeRows = outcomes.rows.map(r => `
    <tr><td>${esc(r.outcome)}</td><td style="text-align:right;">${r.n}</td></tr>`).join('');
  const poolRows = poolLeft.rows.map(r => `
    <tr><td>Segment ${esc(r.segment)}</td><td style="text-align:right;">${r.n}</td></tr>`).join('');

  const reg = regAfter.rows[0] || { reg_after: 0, checked_in: 0 };
  const totalCalls = perAgent.rows.reduce((s, r) => s + r.calls_today, 0);

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;">
<h2>SIEMA Call-Center — Daily Report</h2>
<p><strong>${esc(casaDate)}</strong> (Africa/Casablanca)</p>
<p>Total calls today: <strong>${totalCalls}</strong> · Agents active: <strong>${perAgent.rows.length}</strong> · Registered after call: <strong>${reg.reg_after}</strong> · Checked in at fair: <strong>${reg.checked_in}</strong></p>
<h3>Per agent</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <thead style="background:#f3f4f6;">
    <tr><th>Agent</th><th>Calls</th><th>Will come</th><th>Won't come</th><th>WhatsApp</th><th>Callback</th><th>No answer</th><th>Wrong #</th><th>Not int.</th><th>Reg. meanwhile</th></tr>
  </thead>
  <tbody>${agentRows || '<tr><td colspan="10" style="text-align:center;color:#888;">No calls today.</td></tr>'}</tbody>
</table>
<h3 style="margin-top:24px;">Outcome breakdown</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <thead style="background:#f3f4f6;"><tr><th>Outcome</th><th>Count</th></tr></thead>
  <tbody>${outcomeRows || '<tr><td colspan="2" style="text-align:center;color:#888;">—</td></tr>'}</tbody>
</table>
<h3 style="margin-top:24px;">Pool remaining</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <tbody>${poolRows || '<tr><td colspan="2" style="text-align:center;color:#888;">Pool empty.</td></tr>'}</tbody>
</table>
<p style="color:#888;font-size:12px;margin-top:24px;">Automated report from Leena call-center module.</p>
</body></html>`;

  const subject = `${REPORT_SUBJECT_PREFIX}${casaDate} — ${totalCalls} calls`;
  return { subject, html, casaDate, totalCalls, agents: perAgent.rows.length, reg };
}

// Enqueue the daily report as Mode 1 email_queue rows. Throws with
// err.code='REPORT_TO_NOT_SET' when CALLCENTER_REPORT_TO is unset.
async function sendDailyReport(pool) {
  const recipients = parseRecipients();
  if (recipients.length === 0) {
    const err = new Error('CALLCENTER_REPORT_TO env var not set or has no valid addresses');
    err.code = 'REPORT_TO_NOT_SET';
    throw err;
  }
  const { subject, html, totalCalls, agents, reg } = await buildDailyReport(pool);
  for (const rcpt of recipients) {
    await pool.query(
      `INSERT INTO email_queue (
         organizer_id, expo_id, visitor_id, template_id,
         recipient_email, subject, html_content,
         status, created_at
       ) VALUES (1, 9, NULL, NULL, $1, $2, $3, 'pending', NOW())`,
      [rcpt, subject, html]
    );
  }
  return {
    queued: recipients.length,
    recipients,
    subject,
    totals: { calls_today: totalCalls, agents, registered_after: reg.reg_after, checked_in: reg.checked_in }
  };
}

module.exports = { sendDailyReport, buildDailyReport, REPORT_SUBJECT_PREFIX, casaTodayStartUtc };
