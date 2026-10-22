// ----------------------------------------------------------------------------
// utils/invites.js — davet token'ı + davet e-postası (Paket 2 P2-1).
//
// ── HÜKÜMLER ──
// - Token: 32 rastgele bayt (base64url). DB'de YALNIZ SHA-256 özeti (043 CHECK: 64 hex).
// - Süre 72 saat (Sentez P2-1); tek kullanımlık; yeniden davet eskisini iptal eder (routes/users.js).
// - Link, token'ı URL FRAGMENT'ında taşır (/ui2/invite.html#token=…): fragment sunucuya gitmez →
//   erişim loglarına ve Referer'a düşmez (B20). Sayfa token'ı POST gövdesiyle gönderir.
// - Link tabanı: isteğin origin'i YALNIZ izinli origin listesindeyse (index.js CORS listesi +
//   CORS_EXTRA_ORIGINS) kullanılır; değilse https://leena.app — Host başlığıyla link yönlendirilemez.
// - E-posta: email_queue'ya transactional satır (campaign_id NULL → worker'ın 1. öncelik kuyruğu,
//   Mode 1 hazır HTML). Doğrudan SendGrid çağrısı YOK (CLAUDE.md kuralı).
// - INVITE_ECHO=1 (yalnız staging env'i; SendGrid anahtarı yok): link yanıtta döner ve loglanır.
//   Bayrak yoksa link HİÇBİR yere (yanıt / log) yazılmaz. Canlıda bayrak YOK.
// - ⚠️ Bilinen sınır (🔶): Mode 1 gereği link email_queue.html_content'te düz metin durur —
//   DB okuma yetkisi olan görebilir; token tek kullanımlık ve 72 saatle sınırlı.
// ----------------------------------------------------------------------------
const crypto = require('crypto');
const { parseExtraOrigins } = require('./bootGuards');

const INVITE_TTL_HOURS = 72;
const FALLBACK_BASE = 'https://leena.app';
const INVALID_INVITE = { error: 'This invitation link is invalid or has expired. Ask for a new invitation.' };

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}
function newInviteToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function echoEnabled() {
  return process.env.INVITE_ECHO === '1';
}

function inviteBaseUrl(req) {
  const allowed = ['https://leena.app', 'https://www.leena.app', ...parseExtraOrigins(process.env.CORS_EXTRA_ORIGINS, () => {})];
  const fwd = (req.get && req.get('x-forwarded-proto')) || '';
  const proto = fwd.split(',')[0].trim() || req.protocol || 'https';
  const host = req.get && req.get('host');
  const origin = host ? `${proto}://${host}` : null;
  return origin && allowed.includes(origin) ? origin : FALLBACK_BASE;
}
function inviteUrl(req, token) {
  return `${inviteBaseUrl(req)}/ui2/invite.html#token=${encodeURIComponent(token)}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inviteEmailHtml({ url, inviterName }) {
  return '<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5">' +
    '<p>Hello,</p>' +
    `<p>${esc(inviterName || 'Your administrator')} invited you to ELIZA.</p>` +
    `<p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#c8442b;color:#fff;text-decoration:none;border-radius:6px">Set your password</a></p>` +
    `<p style="color:#666;font-size:13px">This link works once and expires in ${INVITE_TTL_HOURS} hours. ` +
    'If you did not expect this email, you can ignore it.</p>' +
    '</body></html>';
}

// Transactional satır (campaign_id NULL). Döner: email_queue.id
async function enqueueInviteEmail(db, { organizerId, email, url, inviterName }) {
  const r = await db.query(
    `INSERT INTO email_queue (organizer_id, recipient_email, subject, html_content, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [organizerId, email, 'You are invited to ELIZA', inviteEmailHtml({ url, inviterName })]);
  return r.rows[0].id;
}

module.exports = {
  INVITE_TTL_HOURS, INVALID_INVITE, hashToken, newInviteToken, echoEnabled, inviteBaseUrl, inviteUrl,
  inviteEmailHtml, enqueueInviteEmail,
};
