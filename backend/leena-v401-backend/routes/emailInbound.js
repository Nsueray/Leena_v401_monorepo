const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const pool = require('../utils/db');
const { sendEmail } = require('../utils/email');

/**
 * SendGrid Inbound Parse
 * Forward replies to organizer emails
 * NOTE: Uses existing sendEmail(to, subject, html)
 */

router.post('/inbound', upload.none(), async (req, res) => {
  try {
    const subject = req.body.subject || 'Visitor Reply';
    const text = req.body.text || '';
    const rawFrom = req.body.from || '';

    // Extract plain email from "Name <email>" or "email"
    let fromEmail = rawFrom;
    const match = rawFrom.match(/<([^>]+)>/);
    if (match && match[1]) {
      fromEmail = match[1].trim();
    } else {
      fromEmail = rawFrom.trim();
    }

    console.log('📩 INBOUND REPLY FROM:', fromEmail);
    console.log('📩 INBOUND BODY KEYS:', Object.keys(req.body));
    console.log('📩 INBOUND TEXT:', req.body.text ? req.body.text.substring(0, 200) : 'EMPTY');
    console.log('📩 INBOUND HTML:', req.body.html ? req.body.html.substring(0, 200) : 'EMPTY');

    // Get organizer forward emails
    const orgRes = await pool.query(`
      SELECT reply_forward_emails
      FROM organizers
      WHERE reply_forward_emails IS NOT NULL
      LIMIT 1
    `);

    if (orgRes.rows.length === 0) {
      console.log('⚠️ No reply_forward_emails defined');
      return res.sendStatus(200);
    }

    const forwardEmails = orgRes.rows[0].reply_forward_emails
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (forwardEmails.length === 0) {
      return res.sendStatus(200);
    }

    // Build simple HTML email
    const html = `
      <p><strong>From:</strong> ${fromEmail}</p>
      <hr/>
      <pre style="white-space:pre-wrap;">${text}</pre>
    `;

    // IMPORTANT:
    // sendEmail(to, subject, html)
    // to can be string or array of strings
    await sendEmail(
      forwardEmails,
      `[Visitor Reply] ${subject}`,
      html
    );

    console.log('✅ Reply forwarded to:', forwardEmails.join(', '));
    res.sendStatus(200);

  } catch (err) {
    console.error('❌ Inbound forward error:', err);
    res.sendStatus(200); // avoid SendGrid retries
  }
});

module.exports = router;
