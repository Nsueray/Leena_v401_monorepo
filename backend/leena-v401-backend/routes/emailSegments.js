/**
 * Email Segments Routes
 * Leena EMS v402 Mini
 * 
 * Send emails to visitor segments based on visitor_event_status
 * 
 * Endpoints:
 *   POST /api/email-segments/send
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { processEmailTemplate, sendEmailWithReplyTo } = require('../utils/email');

// Apply JWT authentication to all routes
router.use(authMiddleware);

/**
 * POST /api/email-segments/send
 * 
 * Send emails to a visitor segment (checked_in or not_checked_in)
 * 
 * Body:
 *   expo_id: number (required)
 *   segment: "checked_in" | "not_checked_in" (required)
 *   template_id: number (required)
 * 
 * Returns:
 *   total_targeted: number
 *   total_sent: number
 *   total_failed: number
 */
router.post('/send', async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { expo_id, segment, template_id } = req.body;

        // Validate required fields
        if (!expo_id) {
            return res.status(400).json({
                success: false,
                message: 'expo_id is required'
            });
        }

        if (!segment) {
            return res.status(400).json({
                success: false,
                message: 'segment is required'
            });
        }

        if (!template_id) {
            return res.status(400).json({
                success: false,
                message: 'template_id is required'
            });
        }

        // Validate segment value
        if (segment !== 'checked_in' && segment !== 'not_checked_in') {
            return res.status(400).json({
                success: false,
                message: 'segment must be "checked_in" or "not_checked_in"'
            });
        }

        // Fetch template
        const templateRes = await pool.query(
            `SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2`,
            [template_id, organizerId]
        );

        if (templateRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        const template = templateRes.rows[0];

        // Fetch expo
        const expoRes = await pool.query(
            `SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2`,
            [expo_id, organizerId]
        );

        if (expoRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Expo not found'
            });
        }

        const expo = expoRes.rows[0];

        // Fetch visitors matching the segment
        let visitorsRes;

        if (segment === 'checked_in') {
            // checked_in: visitors with status = 'checked_in'
            visitorsRes = await pool.query(
                `SELECT v.id, v.name, v.last_name, v.email, v.company, v.country, v.job_title, v.qr_code, v.badge_url
                 FROM visitors v
                 INNER JOIN visitor_event_status ves ON ves.visitor_id = v.id AND ves.expo_id = v.expo_id
                 WHERE v.expo_id = $1 
                   AND v.organizer_id = $2 
                   AND ves.status = 'checked_in'
                   AND v.email IS NOT NULL 
                   AND v.email != ''`,
                [expo_id, organizerId]
            );
        } else {
            // not_checked_in: visitors with status != 'checked_in' OR no status record at all
            visitorsRes = await pool.query(
                `SELECT v.id, v.name, v.last_name, v.email, v.company, v.country, v.job_title, v.qr_code, v.badge_url
                 FROM visitors v
                 LEFT JOIN visitor_event_status ves ON ves.visitor_id = v.id AND ves.expo_id = v.expo_id
                 WHERE v.expo_id = $1 
                   AND v.organizer_id = $2 
                   AND (ves.status IS NULL OR ves.status != 'checked_in')
                   AND v.email IS NOT NULL 
                   AND v.email != ''`,
                [expo_id, organizerId]
            );
        }

        const visitors = visitorsRes.rows;
        const totalTargeted = visitors.length;
        let totalSent = 0;
        let totalFailed = 0;

        // Send emails to each visitor
        for (const visitor of visitors) {
            try {
                // Prepare email data for template processing
                const emailData = {
                    name: visitor.name || 'Guest',
                    last_name: visitor.last_name || '',
                    full_name: `${visitor.name || ''} ${visitor.last_name || ''}`.trim() || 'Guest',
                    email: visitor.email,
                    company: visitor.company || '',
                    country: visitor.country || '',
                    job_title: visitor.job_title || '',
                    expo_name: expo.name,
                    qr_code: visitor.qr_code ? `<img src="${process.env.BASE_BADGE_URL || 'https://leena.app'}/api/qr-image/${visitor.qr_code}" alt="QR Code" style="max-width: 200px;">` : '',
                    badge_url: visitor.badge_url || '',
                    date: new Date().toLocaleDateString()
                };

                // Process template
                const html = processEmailTemplate(template.html_content, emailData);
                const subject = processEmailTemplate(template.subject, emailData);

                // Send email
                // ALIGNED: sendEmail → sendEmailWithReplyTo (consistent with all other email flows)
                const success = await sendEmailWithReplyTo(visitor.email, subject, html, 'reply@replies.leena.app');

                if (success) {
                    totalSent++;
                } else {
                    totalFailed++;
                }

                // Log email
                await pool.query(
                    `INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                    [
                        organizerId,
                        template_id,
                        expo_id,
                        visitor.email,
                        visitor.email,
                        visitor.name,
                        subject,
                        success ? 'sent' : 'failed',
                        visitor.id
                    ]
                );

                // Rate limiting delay (300ms for SendGrid)
                await new Promise(r => setTimeout(r, 300));

            } catch (err) {
                console.error(`[emailSegments] Error sending to ${visitor.email}:`, err.message);
                totalFailed++;

                // Log failed email
                try {
                    await pool.query(
                        `INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                        [
                            organizerId,
                            template_id,
                            expo_id,
                            visitor.email,
                            visitor.email,
                            visitor.name,
                            template.subject,
                            'failed',
                            visitor.id
                        ]
                    );
                } catch (logErr) {
                    console.error('[emailSegments] Failed to log email error:', logErr.message);
                }
            }
        }

        // Return results
        res.json({
            success: true,
            segment: segment,
            total_targeted: totalTargeted,
            total_sent: totalSent,
            total_failed: totalFailed
        });

    } catch (err) {
        console.error('[emailSegments] Error:', err.message);
        res.status(500).json({
            success: false,
            message: 'Failed to send segment emails',
            error: err.message
        });
    }
});

module.exports = router;
