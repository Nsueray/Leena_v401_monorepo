// utils/unsubscribe.js
// Shared unsubscribe check + preloader.
// Mirrors email_worker.js:537-548 pattern but case/whitespace-insensitive
// (email_unsubscribes.email may contain mixed case from the token endpoint;
//  ops manual inserts use LOWER(TRIM); comparison must normalize both sides).
//
// Compliance: no fail-open. If the DB check errors, the caller's send will
// throw — safer than silently sending to a potentially-unsubscribed address.

const pool = require('./db');

/**
 * Check if a single email address is unsubscribed for a given organizer.
 * Case-insensitive, whitespace-trimmed.
 * @param {string} email
 * @param {number} organizerId
 * @returns {Promise<boolean>}
 */
async function isUnsubscribed(email, organizerId) {
  if (!email || !organizerId) return false;
  const res = await pool.query(
    `SELECT 1 FROM email_unsubscribes
     WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND organizer_id = $2
     LIMIT 1`,
    [email, organizerId]
  );
  return res.rows.length > 0;
}

/**
 * Preload the full unsubscribe set for an organizer as a lowercase-trimmed Set.
 * O(1) lookups afterwards — use for bulk/segment sends.
 * Mirrors routes/campaigns.js:570 pattern.
 * @param {number} organizerId
 * @returns {Promise<Set<string>>}
 */
async function loadUnsubscribeSet(organizerId) {
  const res = await pool.query(
    `SELECT LOWER(TRIM(email)) AS email FROM email_unsubscribes WHERE organizer_id = $1`,
    [organizerId]
  );
  return new Set(res.rows.map(r => r.email));
}

module.exports = { isUnsubscribed, loadUnsubscribeSet };
