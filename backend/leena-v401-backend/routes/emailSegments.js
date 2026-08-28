/**
 * Email Segments Routes — Leena EMS
 *
 * Sends to segments via email_queue (Mode 1: pre-processed HTML).
 * Worker drains at its own cadence. Response returns immediately.
 *
 * Endpoints:
 *   POST /api/email-segments/preview  — Dry-run: count + sample, no INSERT
 *   POST /api/email-segments/send     — Batch INSERT into email_queue
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { processEmailTemplate } = require('../utils/email');
const { loadUnsubscribeSet } = require('../utils/unsubscribe');

router.use(authMiddleware);

const LAGOS_TZ = 'Africa/Lagos';
const CHUNK_SIZE = 500;              // 500 rows × 8 params = 4,000 params (well under 65,535)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse segment string → SQL WHERE fragment.
 * Returns { clause, params } — params appended after caller's $1=expo_id, $2=organizer_id.
 * Throws on unknown segment / bad date.
 */
function buildSegmentFilter(segment, nextParamIdx) {
    // Backwards-compatible aliases
    if (segment === 'checked_in') segment = 'attended_any';
    if (segment === 'not_checked_in') segment = 'noshow_any';

    const [kind, dateStr] = segment.split(':');

    if (kind === 'attended_any') {
        return {
            clause: `EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id)`,
            params: []
        };
    }
    if (kind === 'noshow_any') {
        // Anti-join form: uncorrelated subquery lets PG evaluate the inner set ONCE
        // (~few thousand visitor_ids per expo), build a hash, then anti-join against
        // visitors. The prior NOT EXISTS with c.expo_id = v.expo_id was correlated and
        // forced a nested loop that hit statement_timeout on large expos.
        // $1 is the outer expo_id (reusable — PG allows the same param position
        // to appear multiple times).
        return {
            clause: `v.id NOT IN (SELECT visitor_id FROM checkins WHERE expo_id = $1 AND visitor_id IS NOT NULL)`,
            params: []
        };
    }
    if (kind === 'attended_on') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
            throw new Error(`attended_on requires YYYY-MM-DD suffix, got: ${segment}`);
        }
        return {
            clause: `EXISTS (
                SELECT 1 FROM checkins c
                WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id
                  AND DATE(c.checkin_time AT TIME ZONE '${LAGOS_TZ}') = $${nextParamIdx}::date
            )`,
            params: [dateStr]
        };
    }
    if (kind === 'noshow_asof') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
            throw new Error(`noshow_asof requires YYYY-MM-DD suffix, got: ${segment}`);
        }
        // Anti-join form — same reasoning as noshow_any. Inner subquery filtered
        // by expo_id ($1) and date ($nextParamIdx), evaluated once.
        return {
            clause: `v.created_at::date <= $${nextParamIdx}::date
                     AND v.id NOT IN (
                         SELECT visitor_id FROM checkins
                         WHERE expo_id = $1
                           AND visitor_id IS NOT NULL
                           AND DATE(checkin_time AT TIME ZONE '${LAGOS_TZ}') <= $${nextParamIdx}::date
                     )`,
            params: [dateStr]
        };
    }
    throw new Error(`Unknown segment: ${segment}. Expected: attended_any | noshow_any | attended_on:DATE | noshow_asof:DATE`);
}

/**
 * Common resolver: validates + fetches template/expo/visitors + applies unsub + invalid-email filter.
 * Returns { template, expo, targeted, skipped_unsubscribed, skipped_invalid, raw_count }
 * or { error, status } on validation failure.
 */
async function resolveSegment(organizerId, body) {
    const { expo_id, segment, template_id } = body;
    if (!expo_id) return { error: 'expo_id is required', status: 400 };
    if (!segment) return { error: 'segment is required', status: 400 };
    if (!template_id) return { error: 'template_id is required', status: 400 };

    let filter;
    try { filter = buildSegmentFilter(segment, 3); }
    catch (e) { return { error: e.message, status: 400 }; }

    const templateRes = await pool.query(
        `SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2`,
        [template_id, organizerId]
    );
    if (templateRes.rows.length === 0) return { error: 'Template not found', status: 404 };

    const expoRes = await pool.query(
        `SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2`,
        [expo_id, organizerId]
    );
    if (expoRes.rows.length === 0) return { error: 'Expo not found', status: 404 };

    const visitorsRes = await pool.query(`
        SELECT v.id, v.name, v.last_name, v.email, v.company, v.country, v.job_title, v.qr_code, v.badge_url
        FROM visitors v
        WHERE v.expo_id = $1 AND v.organizer_id = $2
          AND ${filter.clause}
          AND v.email IS NOT NULL AND v.email != ''
    `, [expo_id, organizerId, ...filter.params]);

    const unsubSet = await loadUnsubscribeSet(organizerId);
    const targeted = [];
    let skipped_unsubscribed = 0;
    let skipped_invalid = 0;
    for (const v of visitorsRes.rows) {
        const email = (v.email || '').toLowerCase().trim();
        if (!EMAIL_RE.test(email)) { skipped_invalid++; continue; }
        if (unsubSet.has(email)) { skipped_unsubscribed++; continue; }
        targeted.push(v);
    }

    return {
        template: templateRes.rows[0],
        expo: expoRes.rows[0],
        targeted,
        raw_count: visitorsRes.rows.length,
        skipped_unsubscribed,
        skipped_invalid
    };
}

/**
 * POST /api/email-segments/preview
 * Dry-run — returns counts + sample of 5 recipients. Zero side effects.
 */
router.post('/preview', async (req, res) => {
    try {
        const r = await resolveSegment(req.organizer_id, req.body);
        if (r.error) return res.status(r.status).json({ success: false, message: r.error });

        const sample = r.targeted.slice(0, 5).map(v => ({
            email: v.email,
            name: `${v.name || ''} ${v.last_name || ''}`.trim() || '(no name)',
            company: v.company || ''
        }));

        res.json({
            success: true,
            targeted: r.targeted.length,
            skipped_unsubscribed: r.skipped_unsubscribed,
            skipped_invalid: r.skipped_invalid,
            skipped_total: r.skipped_unsubscribed + r.skipped_invalid,
            raw_match_count: r.raw_count,
            template_name: r.template.name,
            template_subject: r.template.subject,
            expo_name: r.expo.name,
            sample
        });
    } catch (err) {
        console.error('[emailSegments/preview] Error:', err.message);
        res.status(500).json({ success: false, message: 'Preview failed', error: err.message });
    }
});

/**
 * POST /api/email-segments/send
 * Batch INSERT into email_queue (Mode 1). Response returns queued count in ~1s.
 * Worker drains at its own cadence.
 */
router.post('/send', async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const r = await resolveSegment(organizerId, req.body);
        if (r.error) return res.status(r.status).json({ success: false, message: r.error });

        const { template, expo, targeted, skipped_unsubscribed, skipped_invalid } = r;

        if (targeted.length === 0) {
            return res.json({
                success: true,
                targeted: 0,
                skipped_unsubscribed, skipped_invalid,
                skipped_total: skipped_unsubscribed + skipped_invalid,
                queued: 0,
                message: 'No recipients matched — nothing queued.'
            });
        }

        // Pre-process templates per visitor (Mode 1 stores final HTML in the queue row)
        const now = new Date();
        const baseBadgeUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
        const rows = targeted.map(v => {
            const emailData = {
                name: v.name || 'Guest',
                last_name: v.last_name || '',
                full_name: `${v.name || ''} ${v.last_name || ''}`.trim() || 'Guest',
                email: v.email,
                company: v.company || '',
                country: v.country || '',
                job_title: v.job_title || '',
                expo_name: expo.name,
                qr_code: v.qr_code
                    ? `<img src="${baseBadgeUrl}/api/qr-image/${v.qr_code}" alt="QR Code" style="max-width:200px;">`
                    : '',
                badge_url: v.badge_url || '',
                date: now.toLocaleDateString()
            };
            return {
                visitor_id: v.id,
                recipient_email: v.email,
                subject: processEmailTemplate(template.subject, emailData),
                html_content: processEmailTemplate(template.html_content, emailData)
            };
        });

        // Batch INSERT in CHUNK_SIZE-row chunks
        const cols = ['visitor_id', 'expo_id', 'organizer_id', 'template_id',
                      'recipient_email', 'subject', 'html_content', 'status'];
        let queued = 0;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const valueClauses = [];
            const values = [];
            chunk.forEach((row, idx) => {
                const b = idx * 8;
                valueClauses.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`);
                values.push(row.visitor_id, expo.id, organizerId, template.id,
                            row.recipient_email, row.subject, row.html_content, 'pending');
            });
            await pool.query(
                `INSERT INTO email_queue (${cols.join(',')}) VALUES ${valueClauses.join(',')}`,
                values
            );
            queued += chunk.length;
        }

        console.log(`[emailSegments] Queued ${queued} rows for expo ${expo.id} (skipped ${skipped_unsubscribed} unsub, ${skipped_invalid} invalid)`);

        res.json({
            success: true,
            targeted: targeted.length,
            skipped_unsubscribed, skipped_invalid,
            skipped_total: skipped_unsubscribed + skipped_invalid,
            queued,
            message: `${queued} emails queued. Worker is draining — check Email History for delivery status.`
        });

    } catch (err) {
        console.error('[emailSegments/send] Error:', err.message);
        res.status(500).json({ success: false, message: 'Queue insert failed', error: err.message });
    }
});

module.exports = router;
