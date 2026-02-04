/**
 * Terminal Check-in Routes
 * Leena EMS v402
 * 
 * Tokenless terminal-only endpoints
 * Uses terminalAuth middleware (NOT JWT)
 * 
 * Features:
 *   - Expo settings support (auto_checkin_on_badge_print, duplicate_threshold_seconds)
 *   - Duplicate check-in prevention (same visitor + terminal + threshold)
 *   - Badge printed tracking (is_badge_printed, badge_printed_at)
 *   - Visit/Revisit detection (different day = revisit)
 * 
 * Endpoints:
 *   GET  /api/terminal/visitor-by-qr
 *   POST /api/terminal/checkin
 *   POST /api/terminal/badge-print
 *   GET  /api/terminal/status
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const terminalAuth = require('../middleware/terminalAuth');

// Apply terminal authentication to all routes in this file
router.use(terminalAuth);

/**
 * Helper: Get expo settings
 */
async function getExpoSettings(expoId) {
    const result = await pool.query(
        `SELECT settings FROM expos WHERE id = $1`,
        [expoId]
    );
    if (result.rows.length === 0) {
        return {
            auto_checkin_on_badge_print: true,
            duplicate_threshold_seconds: 120
        };
    }
    return result.rows[0].settings || {
        auto_checkin_on_badge_print: true,
        duplicate_threshold_seconds: 120
    };
}

/**
 * Helper: Check for duplicate check-in
 * Returns true if this is a duplicate (should be ignored)
 */
async function isDuplicateCheckin(client, visitorId, expoId, terminal, thresholdSeconds) {
    const result = await client.query(
        `SELECT id, checkin_time 
         FROM checkins 
         WHERE visitor_id = $1 
           AND expo_id = $2 
           AND terminal = $3
           AND checkin_time > NOW() - INTERVAL '1 second' * $4
         ORDER BY checkin_time DESC
         LIMIT 1`,
        [visitorId, expoId, terminal, thresholdSeconds]
    );
    return result.rows.length > 0;
}

/**
 * Helper: Check if this is a revisit (different day)
 */
async function isRevisitToday(client, visitorId, expoId) {
    // Check if visitor has any check-in on a PREVIOUS day
    const result = await client.query(
        `SELECT DISTINCT DATE(checkin_time) as checkin_date
         FROM checkins
         WHERE visitor_id = $1 AND expo_id = $2
         ORDER BY checkin_date`,
        [visitorId, expoId]
    );
    
    const today = new Date().toISOString().split('T')[0];
    const previousDays = result.rows.filter(r => r.checkin_date.toISOString().split('T')[0] !== today);
    
    return previousDays.length > 0;
}

/**
 * GET /api/terminal/visitor-by-qr
 * 
 * Look up visitor by QR code for the terminal's expo
 * 
 * Query params:
 *   qr - The QR code string
 * 
 * Returns visitor info + current event status + role + badge status
 */
router.get('/visitor-by-qr', async (req, res) => {
    try {
        const { qr } = req.query;
        const { expoId, organizerId } = req.terminal;

        if (!qr) {
            return res.status(400).json({
                success: false,
                error: 'QR code is required',
                code: 'MISSING_QR'
            });
        }

        // Look up visitor by qr_code within the terminal's expo scope
        const visitorResult = await pool.query(
            `SELECT 
               v.id,
               v.name,
               v.last_name,
               v.email,
               v.phone,
               v.company,
               v.country,
               v.job_title,
               v.qr_code,
               v.badge_id,
               v.badge_url,
               v.source,
               v.origin,
               v.custom_fields,
               v.visitor_type,
               v.is_badge_printed,
               v.badge_printed_at,
               ves.status AS event_status,
               ves.updated_at AS status_updated_at
             FROM visitors v
             LEFT JOIN visitor_event_status ves 
               ON ves.visitor_id = v.id AND ves.expo_id = v.expo_id
             WHERE v.qr_code = $1 
               AND v.expo_id = $2 
               AND v.organizer_id = $3`,
            [qr, expoId, organizerId]
        );

        if (visitorResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Visitor not found',
                code: 'VISITOR_NOT_FOUND'
            });
        }

        const visitor = visitorResult.rows[0];

        // Get check-in count and dates for this visitor
        const checkinResult = await pool.query(
            `SELECT 
               COUNT(*) AS checkin_count,
               COUNT(DISTINCT DATE(checkin_time)) AS visit_days,
               MAX(checkin_time) AS last_checkin
             FROM checkins
             WHERE visitor_id = $1 AND expo_id = $2`,
            [visitor.id, expoId]
        );

        const checkinCount = parseInt(checkinResult.rows[0].checkin_count, 10);
        const visitDays = parseInt(checkinResult.rows[0].visit_days, 10);
        const lastCheckin = checkinResult.rows[0].last_checkin;

        // Determine role
        const role = visitor.visitor_type || 'visitor';

        // Check if today is a revisit day
        const today = new Date().toISOString().split('T')[0];
        const lastCheckinDate = lastCheckin ? new Date(lastCheckin).toISOString().split('T')[0] : null;
        const isRevisit = visitDays > 0 && lastCheckinDate !== today;

        return res.json({
            success: true,
            visitor: {
                id: visitor.id,
                name: visitor.name,
                lastName: visitor.last_name,
                email: visitor.email,
                phone: visitor.phone,
                company: visitor.company,
                country: visitor.country,
                jobTitle: visitor.job_title,
                qrCode: visitor.qr_code,
                badgeId: visitor.badge_id,
                badgeUrl: visitor.badge_url,
                source: visitor.source,
                origin: visitor.origin,
                customFields: visitor.custom_fields,
                role: role,
                eventStatus: visitor.event_status || 'registered',
                statusUpdatedAt: visitor.status_updated_at,
                // Badge status
                isBadgePrinted: visitor.is_badge_printed || false,
                badgePrintedAt: visitor.badge_printed_at,
                // Check-in stats
                checkinCount: checkinCount,
                visitDays: visitDays,
                lastCheckin: lastCheckin,
                isRevisit: isRevisit
            }
        });
    } catch (err) {
        console.error('[terminal/visitor-by-qr] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to look up visitor',
            code: 'LOOKUP_ERROR'
        });
    }
});

/**
 * POST /api/terminal/badge-print
 * 
 * Record badge print event
 * Optionally creates check-in based on expo settings
 * 
 * Body:
 *   visitor_id - The visitor's ID (required)
 */
router.post('/badge-print', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { visitor_id } = req.body;
        const { expoId, organizerId, hall, terminalNo } = req.terminal;

        if (!visitor_id) {
            return res.status(400).json({
                success: false,
                error: 'visitor_id is required',
                code: 'MISSING_VISITOR_ID'
            });
        }

        // Get expo settings
        const settings = await getExpoSettings(expoId);
        const autoCheckin = settings.auto_checkin_on_badge_print !== false;
        const threshold = settings.duplicate_threshold_seconds || 120;

        // Verify visitor exists
        const visitorCheck = await client.query(
            `SELECT id, name, last_name, email, company, is_badge_printed
             FROM visitors
             WHERE id = $1 AND expo_id = $2 AND organizer_id = $3`,
            [visitor_id, expoId, organizerId]
        );

        if (visitorCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Visitor not found',
                code: 'VISITOR_NOT_FOUND'
            });
        }

        const visitor = visitorCheck.rows[0];

        await client.query('BEGIN');

        // Update badge printed status
        await client.query(
            `UPDATE visitors 
             SET is_badge_printed = TRUE, badge_printed_at = NOW()
             WHERE id = $1`,
            [visitor_id]
        );

        let checkinCreated = false;
        let checkinId = null;
        let checkinTime = null;

        // If auto_checkin_on_badge_print is enabled, create check-in
        if (autoCheckin) {
            // Check for duplicate
            const isDuplicate = await isDuplicateCheckin(client, visitor_id, expoId, terminalNo, threshold);
            
            if (!isDuplicate) {
                const checkinResult = await client.query(
                    `INSERT INTO checkins (
                       visitor_id, expo_id, terminal, hall, 
                       checkin_type, staff_id, source, checkin_time
                     )
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                     RETURNING id, checkin_time`,
                    [visitor_id, expoId, terminalNo, hall, 'entry', organizerId, 'badge-print']
                );

                checkinCreated = true;
                checkinId = checkinResult.rows[0].id;
                checkinTime = checkinResult.rows[0].checkin_time;

                // Upsert visitor_event_status
                await client.query(
                    `INSERT INTO visitor_event_status (visitor_id, expo_id, status, created_at, updated_at)
                     VALUES ($1, $2, 'checked_in', NOW(), NOW())
                     ON CONFLICT (visitor_id, expo_id)
                     DO UPDATE SET status = 'checked_in', updated_at = NOW()`,
                    [visitor_id, expoId]
                );
            }
        }

        await client.query('COMMIT');

        return res.json({
            success: true,
            badgePrint: {
                visitorId: visitor_id,
                visitorName: visitor.name,
                visitorEmail: visitor.email,
                badgePrintedAt: new Date(),
                autoCheckinEnabled: autoCheckin,
                checkinCreated: checkinCreated,
                checkinId: checkinId,
                checkinTime: checkinTime
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[terminal/badge-print] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to record badge print',
            code: 'BADGE_PRINT_ERROR'
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/terminal/checkin
 * 
 * Record a check-in from a terminal (QR scan without badge print)
 * Used when visitor already has badge (re-entry, turnike, etc.)
 * 
 * Body:
 *   visitor_id - The visitor's ID (required)
 *   notes - Optional notes for this check-in
 */
router.post('/checkin', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { visitor_id, notes } = req.body;
        const { expoId, organizerId, hall, terminalNo } = req.terminal;

        if (!visitor_id) {
            return res.status(400).json({
                success: false,
                error: 'visitor_id is required',
                code: 'MISSING_VISITOR_ID'
            });
        }

        // Get expo settings
        const settings = await getExpoSettings(expoId);
        const threshold = settings.duplicate_threshold_seconds || 120;

        // Verify visitor exists
        const visitorCheck = await client.query(
            `SELECT id, name, last_name, email, company
             FROM visitors
             WHERE id = $1 AND expo_id = $2 AND organizer_id = $3`,
            [visitor_id, expoId, organizerId]
        );

        if (visitorCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Visitor not found',
                code: 'VISITOR_NOT_FOUND'
            });
        }

        const visitor = visitorCheck.rows[0];

        await client.query('BEGIN');

        // Check for duplicate check-in
        const isDuplicate = await isDuplicateCheckin(client, visitor_id, expoId, terminalNo, threshold);

        if (isDuplicate) {
            await client.query('ROLLBACK');
            return res.json({
                success: true,
                duplicate: true,
                message: `Check-in ignored: duplicate within ${threshold} seconds`,
                checkin: null
            });
        }

        // Check if this is a revisit
        const isRevisit = await isRevisitToday(client, visitor_id, expoId);

        // Insert check-in record
        const checkinResult = await client.query(
            `INSERT INTO checkins (
               visitor_id, expo_id, terminal, hall, notes,
               checkin_type, staff_id, source, checkin_time
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             RETURNING id, checkin_time`,
            [visitor_id, expoId, terminalNo, hall, notes || null, 'entry', organizerId, 'terminal']
        );

        const checkin = checkinResult.rows[0];

        // Upsert visitor_event_status
        await client.query(
            `INSERT INTO visitor_event_status (visitor_id, expo_id, status, created_at, updated_at)
             VALUES ($1, $2, 'checked_in', NOW(), NOW())
             ON CONFLICT (visitor_id, expo_id)
             DO UPDATE SET status = 'checked_in', updated_at = NOW()`,
            [visitor_id, expoId]
        );

        // Get updated stats
        const countResult = await client.query(
            `SELECT 
               COUNT(*) AS checkin_count,
               COUNT(DISTINCT DATE(checkin_time)) AS visit_days
             FROM checkins
             WHERE visitor_id = $1 AND expo_id = $2`,
            [visitor_id, expoId]
        );

        const checkinCount = parseInt(countResult.rows[0].checkin_count, 10);
        const visitDays = parseInt(countResult.rows[0].visit_days, 10);

        await client.query('COMMIT');

        return res.json({
            success: true,
            duplicate: false,
            checkin: {
                id: checkin.id,
                visitorId: visitor_id,
                visitorName: visitor.name,
                visitorLastName: visitor.last_name,
                visitorEmail: visitor.email,
                visitorCompany: visitor.company,
                expoId: expoId,
                terminal: terminalNo,
                hall: hall,
                checkinType: 'entry',
                checkinTime: checkin.checkin_time,
                checkinCount: checkinCount,
                visitDays: visitDays,
                isRevisit: isRevisit
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[terminal/checkin] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to record check-in',
            code: 'CHECKIN_ERROR'
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/terminal/status
 * 
 * Health check / terminal info endpoint
 * Returns terminal configuration and expo settings
 */
router.get('/status', async (req, res) => {
    try {
        const terminal = req.terminal;
        const settings = await getExpoSettings(terminal.expoId);

        return res.json({
            success: true,
            terminal: {
                id: terminal.id,
                hall: terminal.hall,
                terminalNo: terminal.terminalNo,
                expoId: terminal.expoId,
                autoCheckin: terminal.autoCheckin
            },
            expoSettings: settings
        });
    } catch (err) {
        console.error('[terminal/status] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to get terminal status',
            code: 'STATUS_ERROR'
        });
    }
});

module.exports = router;
