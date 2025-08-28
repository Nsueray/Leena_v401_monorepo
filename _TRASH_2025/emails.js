// routes/emails.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');
const sgMail = require('@sendgrid/mail');
const QRCode = require('qrcode');
require('dotenv').config();

if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Helper function to replace placeholders
const replacePlaceholders = (text, data) => {
    let processedText = text;
    for (const key in data) {
        const placeholder = new RegExp(`\\[${key}\\]`, 'gi');
        processedText = processedText.replace(placeholder, data[key]);
    }
    return processedText;
};

// POST /send - Send an email to a visitor using a template
router.post('/send', authenticateToken, async (req, res) => {
    const { template_id, visitor_id } = req.body;
    if (!template_id || !visitor_id) {
        return res.status(400).json({ error: 'template_id and visitor_id are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const templateResult = await client.query('SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2', [template_id, req.organizer_id]);
        if (templateResult.rows.length === 0) throw new Error('Template not found');
        const template = templateResult.rows[0];

        const visitorResult = await client.query(
            `SELECT v.*, e.name as expo_name, e.location as expo_location, e.start_date, e.end_date, o.name as organizer_name
             FROM visitors v
             JOIN expos e ON v.expo_id = e.id
             JOIN organizers o ON v.organizer_id = o.id
             WHERE v.id = $1 AND v.organizer_id = $2`,
            [visitor_id, req.organizer_id]
        );
        if (visitorResult.rows.length === 0) throw new Error('Visitor not found');
        const visitor = visitorResult.rows[0];

        const visitorEmail = visitor.custom_fields?.email;
        if (!visitorEmail) throw new Error('Visitor does not have an email address');

        const qrCodeDataUrl = await QRCode.toDataURL(visitor.qr_code, { width: 300, margin: 2 });

        const replacementData = {
            ...visitor.custom_fields,
            expo_name: visitor.expo_name,
            expo_location: visitor.expo_location,
            expo_start_date: visitor.start_date ? new Date(visitor.start_date).toLocaleDateString() : '',
            expo_end_date: visitor.end_date ? new Date(visitor.end_date).toLocaleDateString() : '',
            organizer_name: visitor.organizer_name,
            qr_code: visitor.qr_code,
            qr_code_image: `<img src="${qrCodeDataUrl}" alt="QR Code" style="width: 250px; height: 250px;">`,
            registration_date: new Date(visitor.created_at).toLocaleDateString()
        };

        const processedSubject = replacePlaceholders(template.subject, replacementData);
        const processedBody = replacePlaceholders(template.body, replacementData);

        const msg = {
            to: visitorEmail,
            from: process.env.SENDER_EMAIL,
            subject: processedSubject,
            html: processedBody,
        };

        await sgMail.send(msg);

        await client.query(
            `INSERT INTO email_logs (template_id, visitor_id, organizer_id, recipient, subject, status, sent_at)
             VALUES ($1, $2, $3, $4, $5, 'sent', CURRENT_TIMESTAMP)`,
            [template_id, visitor_id, req.organizer_id, visitorEmail, processedSubject]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Email sent successfully' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Email sending error:', err);

        // Log the error
        try {
             await client.query(
                `INSERT INTO email_logs (template_id, visitor_id, organizer_id, recipient, subject, status, error_message)
                 VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
                [req.body.template_id, req.body.visitor_id, req.organizer_id, 'unknown', 'unknown', err.message]
            );
        } catch (logErr) {
            console.error('Failed to log email error:', logErr);
        }

        res.status(500).json({ error: 'Failed to send email', details: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
