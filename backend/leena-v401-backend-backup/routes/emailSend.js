const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { processEmailTemplate, sendEmail } = require('../utils/email');
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

        if (save_to_database) {
            const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            qrCode = generate_qr ? uuidv4() : null;

            if (qrCode) {
                badgeUrl = `${process.env.BASE_BADGE_URL || 'http://localhost:3000'}/badge-print.html?qr=${qrCode}`;
            }

            if (record_type === 'visitor') {
                const result = await pool.query(`
                    INSERT INTO visitors (name, email, company, expo_id, organizer_id, badge_id, qr_code, source, origin, badge_url, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', 'manual_email_send', $8, NOW())
                    RETURNING id
                `, [
                    recipient.name || 'Guest',
                    recipient.email,
                    recipient.company || null,
                    expo_id,
                    organizerId,
                    badge_id,
                    qrCode,
                    badgeUrl
                ]);
                visitorId = result.rows[0].id;
            }
        }

        const emailData = {
            name: recipient.name || 'Guest',
            email: recipient.email,
            company: recipient.company || '',
            expo_name: expo.name,
            qr_code: qrCode ? `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qrCode}" alt="QR Code" style="max-width: 200px;">` : '',
            badge_url: badgeUrl || '',
            date: new Date().toLocaleDateString()
        };

        const html = processEmailTemplate(template.html_content, emailData);
        const subject = processEmailTemplate(template.subject, emailData);

        const success = await sendEmail(recipient.email, subject, html);

        await pool.query(`
            INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `, [
            organizerId,
            template_id,
            expo_id,
            recipient.email,
            recipient.email,
            recipient.name,
            subject,
            success ? 'sent' : 'failed',
            visitorId
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

        for (const recipient of recipients) {
            try {
                let qrCode = null, badgeUrl = null, visitorId = null;

                if (!recipient.email) {
                    errors.push({ recipient: recipient.name || 'Unknown', error: 'Missing email' });
                    continue;
                }

                if (save_to_database) {
                    const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                    qrCode = generate_qr ? uuidv4() : null;

                    if (qrCode) {
                        badgeUrl = `${process.env.BASE_BADGE_URL || 'http://localhost:3000'}/badge-print.html?qr=${qrCode}`;
                    }

                    if (record_type === 'visitor') {
                        const existing = await pool.query(`SELECT id FROM visitors WHERE email = $1 AND expo_id = $2`, [recipient.email, expo_id]);
                        if (existing.rows.length === 0) {
                            const result = await pool.query(`
                                INSERT INTO visitors (name, email, company, expo_id, organizer_id, badge_id, qr_code, source, origin, badge_url, created_at)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', 'manual_email_send', $8, NOW())
                                RETURNING id
                            `, [
                                recipient.name || 'Guest',
                                recipient.email,
                                recipient.company || null,
                                expo_id,
                                organizerId,
                                badge_id,
                                qrCode,
                                badgeUrl
                            ]);
                            visitorId = result.rows[0].id;
                            saved++;
                        }
                    }
                }

                const emailData = {
                    name: recipient.name || 'Guest',
                    email: recipient.email,
                    company: recipient.company || '',
                    expo_name: expo.name,
                    qr_code: qrCode ? `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qrCode}" alt="QR Code" style="max-width: 200px;">` : '',
                    badge_url: badgeUrl || '',
                    date: new Date().toLocaleDateString()
                };

                const html = processEmailTemplate(template.html_content, emailData);
                const subject = processEmailTemplate(template.subject, emailData);

                const success = await sendEmail(recipient.email, subject, html);
                if (success) sent++;

                await pool.query(`
                    INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                `, [
                    organizerId,
                    template_id,
                    expo_id,
                    recipient.email,
                    recipient.email,
                    recipient.name,
                    subject,
                    success ? 'sent' : 'failed',
                    visitorId
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

module.exports = router;
