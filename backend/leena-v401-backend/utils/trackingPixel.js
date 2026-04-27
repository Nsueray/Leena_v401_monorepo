/**
 * Tracking Pixel & Unsubscribe Token Utilities
 * Leena EMS v403 — Email Campaigns
 *
 * - injectTrackingPixel(html, eventId) — adds 1x1 transparent pixel before </body>
 * - injectUnsubscribeLink(html, token, organizerName) — adds footer with unsubscribe link
 * - generateUnsubscribeToken(campaignId, recipientId, email) — HMAC-based token
 * - verifyUnsubscribeToken(token) — validates and returns { campaignId, recipientId, email }
 */

const crypto = require('crypto');

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET;
const BASE_URL = process.env.BASE_BADGE_URL || 'https://leena.app';

// 1x1 transparent PNG (68 bytes)
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Inject a 1x1 tracking pixel image tag into email HTML.
 * Inserted immediately before </body>. If no </body>, appended at end.
 */
function injectTrackingPixel(html, eventId) {
  if (!html || !eventId) return html || '';

  const pixelTag = `<img src="${BASE_URL}/api/email-track/open/${eventId}" width="1" height="1" style="display:none;" alt="">`;

  if (html.includes('</body>')) {
    return html.replace('</body>', pixelTag + '</body>');
  }
  return html + pixelTag;
}

/**
 * Inject an unsubscribe footer link into email HTML.
 * Inserted immediately before </body>. If no </body>, appended at end.
 */
function injectUnsubscribeLink(html, token, organizerName) {
  if (!html || !token) return html || '';

  const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;
  const footer = `<div style="text-align:center;margin-top:20px;padding:16px;font-size:11px;color:#888;border-top:1px solid #eee;">If you no longer wish to receive these emails from ${organizerName || 'this organizer'}, <a href="${unsubUrl}" style="color:#888;text-decoration:underline;">unsubscribe here</a>.</div>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', footer + '</body>');
  }
  return html + footer;
}

/**
 * Generate an HMAC-based unsubscribe token.
 * Format: base64url(campaignId.recipientId.email) + '.' + base64url(hmac_sha256)
 * No DB storage needed — verified on-demand via HMAC.
 */
function generateUnsubscribeToken(campaignId, recipientId, email) {
  if (!UNSUBSCRIBE_SECRET) throw new Error('UNSUBSCRIBE_SECRET not configured');

  const payload = `${campaignId}.${recipientId}.${email}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(payload).digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verify an unsubscribe token.
 * Returns { campaignId, recipientId, email } on success, null on failure.
 */
function verifyUnsubscribeToken(token) {
  if (!UNSUBSCRIBE_SECRET || !token) return null;

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }

  // Verify HMAC (safe: length check before timingSafeEqual, base64url decode)
  const expectedSig = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(payload).digest('base64url');

  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(signature, 'base64url');
    expectedBuf = Buffer.from(expectedSig, 'base64url');
  } catch (e) {
    return null;
  }

  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  // Parse payload: campaignId.recipientId.email
  const parts = payload.split('.');
  if (parts.length < 3) return null;

  const campaignId = parseInt(parts[0]);
  const recipientId = parseInt(parts[1]);
  const email = parts.slice(2).join('.'); // email may contain dots

  if (isNaN(campaignId) || isNaN(recipientId) || !email) return null;

  return { campaignId, recipientId, email };
}

/**
 * Wrap all eligible <a href> links in HTML for click tracking.
 * Rewrites: <a href="URL"> → <a href="BASE_URL/api/email-track/click/EVENT_ID?url=BASE64(URL)">
 * Skips: mailto:, tel:, #, javascript:, links to /api/email-track/*, empty/missing href
 */
function wrapClickLinks(html, eventId) {
  if (!html || !eventId) return html || '';

  const trackBase = `${BASE_URL}/api/email-track/`;

  return html.replace(/<a\s([^>]*?)href=["']([^"']+)["']/gi, (match, before, url) => {
    const trimmed = url.trim();
    // Skip non-http, tracking endpoints, and anchors
    if (!trimmed || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') ||
        trimmed.startsWith('#') || trimmed.startsWith('javascript:') ||
        trimmed.startsWith(trackBase)) {
      return match;
    }
    const encoded = Buffer.from(trimmed).toString('base64url');
    return `<a ${before}href="${BASE_URL}/api/email-track/click/${eventId}?url=${encoded}"`;
  });
}

/**
 * Append _lc campaign token to links pointing to Leena form pages.
 * Detects: URLs containing 'form-public.html' or '/form/' on the same domain.
 */
function appendCampaignTokenToFormLinks(html, campaignToken) {
  if (!html || !campaignToken) return html || '';

  return html.replace(/<a\s([^>]*?)href=["']([^"']+)["']/gi, (match, before, url) => {
    if (url.includes('form-public.html') || url.includes('/form/')) {
      const separator = url.includes('?') ? '&' : '?';
      return `<a ${before}href="${url}${separator}_lc=${campaignToken}"`;
    }
    return match;
  });
}

/**
 * Generate RFC 8058 List-Unsubscribe headers for Gmail/Outlook native unsubscribe.
 * Returns an object with List-Unsubscribe and List-Unsubscribe-Post headers.
 * Requires UNSUBSCRIBE_SECRET to be set.
 */
function getListUnsubscribeHeaders(campaignId, recipientId, email) {
  if (!UNSUBSCRIBE_SECRET) return {};

  const token = generateUnsubscribeToken(campaignId, recipientId, email);
  const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;

  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

module.exports = {
  TRANSPARENT_PIXEL,
  injectTrackingPixel,
  injectUnsubscribeLink,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  wrapClickLinks,
  appendCampaignTokenToFormLinks,
  getListUnsubscribeHeaders
};
