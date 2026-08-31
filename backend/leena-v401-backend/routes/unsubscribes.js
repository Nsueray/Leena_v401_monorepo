/**
 * Unsubscribe management — admin UI backend
 *
 * Endpoints (all JWT-auth, organizer-scoped):
 *   GET    /api/unsubscribes/status?email=X  — current subscribed/unsubscribed state
 *   POST   /api/unsubscribes                  — add (idempotent) + deactivate active campaign_recipients
 *   DELETE /api/unsubscribes                  — remove (re-subscribe; idempotent)
 *
 * Mirrors UNSUBSCRIBE_ANALYSIS_20260826.md §5.1 / §5.2 ops SQL exactly.
 * See also: routes/emailTracking.js:213-224 (the user-facing counterpart).
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

const REASON_MAXLEN = 200;

function normEmail(e) {
    return String(e || '').toLowerCase().trim();
}

/**
 * GET /api/unsubscribes/status?email=X
 * Returns { unsubscribed: bool, since: iso|null, reason: string|null,
 *           expo_name: string|null, campaign_name: string|null }
 */
router.get('/status', async (req, res) => {
    try {
        const email = normEmail(req.query.email);
        if (!email) return res.status(400).json({ success: false, message: 'email query param required' });

        const r = await pool.query(`
            SELECT eu.created_at, eu.reason, eu.expo_id, eu.campaign_id,
                   e.name AS expo_name, c.name AS campaign_name
            FROM email_unsubscribes eu
            LEFT JOIN expos e ON e.id = eu.expo_id
            LEFT JOIN email_campaigns c ON c.id = eu.campaign_id
            WHERE LOWER(TRIM(eu.email)) = $1
              AND eu.organizer_id = $2
            LIMIT 1
        `, [email, req.organizer_id]);

        if (r.rows.length === 0) {
            return res.json({ success: true, unsubscribed: false, since: null, reason: null, expo_name: null, campaign_name: null });
        }
        const row = r.rows[0];
        res.json({
            success: true,
            unsubscribed: true,
            since: row.created_at,
            reason: row.reason,
            expo_name: row.expo_name,
            campaign_name: row.campaign_name
        });
    } catch (err) {
        console.error('[unsubscribes/status]', err.message);
        res.status(500).json({ success: false, message: 'Status lookup failed' });
    }
});

/**
 * POST /api/unsubscribes
 * Body: { email: string, reason: string, expo_id?: number }
 * - INSERT ... ON CONFLICT DO NOTHING (idempotent per (email, organizer_id))
 * - UPDATE campaign_recipients status='unsubscribed' on organizer's active campaigns
 * Both writes in a single transaction (matches routes/emailTracking.js:213-224 pattern).
 */
router.post('/', async (req, res) => {
    const email = normEmail(req.body && req.body.email);
    const rawReason = String((req.body && req.body.reason) || '').trim();
    const expoId = req.body && req.body.expo_id ? parseInt(req.body.expo_id, 10) : null;

    if (!email) return res.status(400).json({ success: false, message: 'email required' });
    if (!rawReason) return res.status(400).json({ success: false, message: 'reason required' });

    const reason = rawReason.length > REASON_MAXLEN ? rawReason.slice(0, REASON_MAXLEN) : rawReason;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ins = await client.query(`
            INSERT INTO email_unsubscribes (email, organizer_id, expo_id, campaign_id, reason)
            VALUES ($1, $2, $3, NULL, $4)
            ON CONFLICT (email, organizer_id) DO NOTHING
            RETURNING id, created_at
        `, [email, req.organizer_id, expoId, reason]);

        const upd = await client.query(`
            UPDATE campaign_recipients
            SET status = 'unsubscribed', updated_at = NOW()
            WHERE LOWER(TRIM(email)) = $1
              AND status = 'active'
              AND campaign_id IN (SELECT id FROM email_campaigns WHERE organizer_id = $2)
        `, [email, req.organizer_id]);

        await client.query('COMMIT');

        const inserted = ins.rows.length > 0;
        res.json({
            success: true,
            email,
            inserted,
            campaign_recipients_deactivated: upd.rowCount,
            since: inserted ? ins.rows[0].created_at : null,
            message: inserted
                ? `Unsubscribed. ${upd.rowCount} active campaign recipient(s) deactivated.`
                : `Already on unsubscribe list. ${upd.rowCount} active campaign recipient(s) deactivated.`
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[unsubscribes/POST]', err.message);
        res.status(500).json({ success: false, message: 'Unsubscribe failed' });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/unsubscribes
 * Body: { email: string }
 * Removes the unsubscribe row for this organizer (idempotent).
 * Does NOT re-add to campaign_recipients — matches §5.2 note.
 */
router.delete('/', async (req, res) => {
    try {
        const email = normEmail(req.body && req.body.email);
        if (!email) return res.status(400).json({ success: false, message: 'email required' });

        const r = await pool.query(`
            DELETE FROM email_unsubscribes
            WHERE LOWER(TRIM(email)) = $1 AND organizer_id = $2
            RETURNING id, reason, created_at
        `, [email, req.organizer_id]);

        res.json({
            success: true,
            email,
            removed: r.rowCount,
            previous_reason: r.rows[0] ? r.rows[0].reason : null,
            message: r.rowCount > 0
                ? 'Re-subscribed (row removed). Not re-added to any campaign — do that manually if needed.'
                : 'Not on unsubscribe list — nothing to remove.'
        });
    } catch (err) {
        console.error('[unsubscribes/DELETE]', err.message);
        res.status(500).json({ success: false, message: 'Re-subscribe failed' });
    }
});

module.exports = router;
