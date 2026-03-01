const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { processEmailTemplate, sendEmail, sendEmailWithReplyTo } = require('../utils/email');
const { generateQRCode } = require('../utils/qrcode');
const { v4: uuidv4 } = require('uuid');

// Send single email
router.post('/single', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { template_id, expo_id, recipient, save_to_database, record_type, generate_qr } = req.body;

        if (!template_id || !expo_id || !recipient || !recipient.email) {
            return res.status(400).json({ success: false, message: 'Template, expo and recipient email required' });
        }

        const templateRes = await pool.query(`SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2`, [template_id, organizerId]);
        if (templateRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        const template = templateRes.rows[0];

        const expoRes = await pool.query(`SELECT name FROM expos WHERE id = $1 AND organizer_id = $2`, [expo_id, organizerId]);
        if (expoRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Expo not found' });
        }
        const expo = expoRes.rows[0];

        let qrCode = null;
        let badgeUrl = null;
        let visitorId = null;
        let visitorCustomFields = {};

        if (save_to_database) {
            const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            qrCode = generate_qr ? uuidv4() : null;

            if (qrCode) {
                badgeUrl = `${process.env.BASE_BADGE_URL || 'https://leena.app'}/badge-print.html?qr=${qrCode}`;
            }

            const visitorType = record_type || 'visitor';

            const result = await pool.query(`
                INSERT INTO visitors (name, email, company, expo_id, organizer_id, badge_id, qr_code, visitor_type, source, origin, badge_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'email', 'manual_email_send', $9, NOW())
                RETURNING id
            `, [
                recipient.name || 'Guest',
                recipient.email,
                recipient.company || null,
                expo_id,
                organizerId,
                badge_id,
                qrCode,
                visitorType,
                badgeUrl
            ]);
            visitorId = result.rows[0].id;
        }

        // If no QR was generated, try to find existing visitor's QR and custom_fields
        if (!qrCode) {
            const existingVisitor = await pool.query(
                `SELECT qr_code, badge_url, custom_fields FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1`,
                [recipient.email, expo_id]
            );
            if (existingVisitor.rows.length > 0) {
                if (existingVisitor.rows[0].qr_code) {
                    qrCode = existingVisitor.rows[0].qr_code;
                    badgeUrl = existingVisitor.rows[0].badge_url || badgeUrl;
                }
                visitorCustomFields = existingVisitor.rows[0].custom_fields || {};
            }
        }

        const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
        const emailData = {
            ...(visitorCustomFields || {}),
            name: recipient.name || 'Guest',
            email: recipient.email,
            company: recipient.company || '',
            expo_name: expo.name,
            qr_code: qrCode ? `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width: 200px;">` : '',
            badge_url: badgeUrl || '',
            date: new Date().toLocaleDateString()
        };

        const html = processEmailTemplate(template.html_content, emailData);
        const subject = processEmailTemplate(template.subject, emailData);

        const success = await sendEmailWithReplyTo(recipient.email, subject, html, 'reply@replies.leena.app');

        // Log email
        await pool.query(`
            INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [
            organizerId,
            expo_id,
            visitorId,
            template_id,
            recipient.email,
            success ? 'sent' : 'failed',
            `Subject: ${subject} | To: ${recipient.name || 'Guest'}`
        ]);

        res.json({
            success: true,
            message: 'Email sent',
            visitor_id: visitorId,
            badge_url: badgeUrl
        });

    } catch (err) {
        console.error('Error sending single email:', err);
        res.status(500).json({ success: false, message: 'Email send failed' });
    }
});

// Send bulk emails
router.post('/bulk', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { template_id, expo_id, recipients, save_to_database, record_type, generate_qr } = req.body;

        if (!template_id || !expo_id || !recipients || recipients.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const templateRes = await pool.query(`SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2`, [template_id, organizerId]);
        if (templateRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Template not found' });
        const template = templateRes.rows[0];

        const expoRes = await pool.query(`SELECT name FROM expos WHERE id = $1 AND organizer_id = $2`, [expo_id, organizerId]);
        if (expoRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Expo not found' });
        const expo = expoRes.rows[0];

        let sent = 0, saved = 0, errors = [];
        const visitorType = record_type || 'visitor';

        for (const recipient of recipients) {
            try {
                let qrCode = null, badgeUrl = null, visitorId = null, visitorCustomFields = {};

                if (!recipient.email) {
                    errors.push({ recipient: recipient.name || 'Unknown', error: 'Missing email' });
                    continue;
                }

                if (save_to_database) {
                    const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                    qrCode = generate_qr ? uuidv4() : null;

                    if (qrCode) {
                        badgeUrl = `${process.env.BASE_BADGE_URL || 'https://leena.app'}/badge-print.html?qr=${qrCode}`;
                    }

                    const existing = await pool.query(`SELECT id, qr_code, badge_url, custom_fields FROM visitors WHERE email = $1 AND expo_id = $2`, [recipient.email, expo_id]);
                    if (existing.rows.length === 0) {
                        const result = await pool.query(`
                            INSERT INTO visitors (name, email, company, expo_id, organizer_id, badge_id, qr_code, visitor_type, source, origin, badge_url, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'email', 'manual_email_send', $9, NOW())
                            RETURNING id
                        `, [
                            recipient.name || 'Guest',
                            recipient.email,
                            recipient.company || null,
                            expo_id,
                            organizerId,
                            badge_id,
                            qrCode,
                            visitorType,
                            badgeUrl
                        ]);
                        visitorId = result.rows[0].id;
                        saved++;
                    } else {
                        // Existing visitor — use their QR code and custom_fields
                        visitorId = existing.rows[0].id;
                        visitorCustomFields = existing.rows[0].custom_fields || {};
                        if (!qrCode && existing.rows[0].qr_code) {
                            qrCode = existing.rows[0].qr_code;
                            badgeUrl = existing.rows[0].badge_url || badgeUrl;
                        }
                    }
                }

                // If no QR was generated and not saved, try to find existing visitor's QR and custom_fields
                if (!qrCode) {
                    const existingVisitor = await pool.query(
                        `SELECT qr_code, badge_url, custom_fields FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1`,
                        [recipient.email, expo_id]
                    );
                    if (existingVisitor.rows.length > 0) {
                        if (existingVisitor.rows[0].qr_code) {
                            qrCode = existingVisitor.rows[0].qr_code;
                            badgeUrl = existingVisitor.rows[0].badge_url || badgeUrl;
                        }
                        if (!Object.keys(visitorCustomFields).length) {
                            visitorCustomFields = existingVisitor.rows[0].custom_fields || {};
                        }
                    }
                }

                const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
                const emailData = {
                    ...(visitorCustomFields || {}),
                    name: recipient.name || 'Guest',
                    email: recipient.email,
                    company: recipient.company || '',
                    expo_name: expo.name,
                    qr_code: qrCode ? `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width: 200px;">` : '',
                    badge_url: badgeUrl || '',
                    date: new Date().toLocaleDateString()
                };

                const html = processEmailTemplate(template.html_content, emailData);
                const subject = processEmailTemplate(template.subject, emailData);

                const success = await sendEmailWithReplyTo(recipient.email, subject, html, 'reply@replies.leena.app');
                if (success) sent++;

                // Log email
                await pool.query(`
                    INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                `, [
                    organizerId,
                    expo_id,
                    visitorId,
                    template_id,
                    recipient.email,
                    success ? 'sent' : 'failed',
                    `Subject: ${subject} | To: ${recipient.name || 'Guest'}`
                ]);

                await new Promise(r => setTimeout(r, 100)); // Delay

            } catch (err) {
                console.error(`Bulk error: ${recipient.email}`, err);
                errors.push({ recipient: recipient.email, error: err.message });
            }
        }

        res.json({
            success: true,
            sent_count: sent,
            saved_count: saved,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (err) {
        console.error('Bulk send error:', err);
        res.status(500).json({ success: false, message: 'Bulk email send failed' });
    }
});

// Email send history (paginated, filtered)
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const expoId = req.query.expo_id;

        if (!expoId) {
            return res.status(400).json({ success: false, message: 'expo_id required' });
        }

        // Build WHERE clause
        let whereClause = 'WHERE el.organizer_id = $1 AND el.expo_id = $2';
        const params = [organizerId, expoId];
        let idx = 3;

        if (req.query.status && ['sent', 'failed'].includes(req.query.status)) {
            whereClause += ` AND el.status = $${idx}`;
            params.push(req.query.status);
            idx++;
        }

        if (req.query.template_id) {
            whereClause += ` AND el.template_id = $${idx}`;
            params.push(parseInt(req.query.template_id));
            idx++;
        }

        if (req.query.search) {
            whereClause += ` AND el.email ILIKE $${idx}`;
            params.push(`%${req.query.search}%`);
            idx++;
        }

        // Count total
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM email_logs el ${whereClause}`, params
        );
        const total = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        // Fetch logs with template name and visitor name
        const logsResult = await pool.query(
            `SELECT el.id, el.email, el.status, el.message, el.sent_at, el.template_id, el.visitor_id,
                    et.name as template_name,
                    v.name as visitor_name, v.last_name as visitor_last_name
             FROM email_logs el
             LEFT JOIN email_templates et ON el.template_id = et.id
             LEFT JOIN visitors v ON el.visitor_id = v.id
             ${whereClause}
             ORDER BY el.sent_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset]
        );

        // Quick stats for this expo
        const statsResult = await pool.query(
            `SELECT
                COUNT(*) as total_emails,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as total_sent,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as total_failed
             FROM email_logs
             WHERE organizer_id = $1 AND expo_id = $2`,
            [organizerId, expoId]
        );
        const stats = statsResult.rows[0];

        res.json({
            success: true,
            logs: logsResult.rows,
            total,
            page,
            totalPages,
            stats: {
                total_emails: parseInt(stats.total_emails),
                total_sent: parseInt(stats.total_sent),
                total_failed: parseInt(stats.total_failed)
            }
        });

    } catch (err) {
        console.error('Error fetching email history:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch email history' });
    }
});

module.exports = router;
