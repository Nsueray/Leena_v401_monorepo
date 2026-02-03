const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer(); // memory storage
const pool = require('../utils/db');
const { sendEmail } = require('../utils/email');

/**
 * SendGrid Inbound Parse → Organizer Forward
 * NOTE: SendGrid sends multipart/form-data
 */

// ⚠️ upload.none() is CRITICAL
router.post('/inbound', upload.none(), async (req, res) => {
  try {
    const from = req.body.from;
    const subject = req.body.subject || 'Visitor Reply';
    const text = req.body.text || '';

    console.log('📩 INBOUND REPLY FROM:', from);

    if (!from) {
      console.log('⚠️ Inbound email missing FROM field');
      return res.sendStatus(200);
    }

    // Get organizer forward emails
    const orgRes = await pool.query(
      `SELECT reply_forward_emails
       FROM organizers
       WHERE reply_forward_emails IS NOT NULL
       LIMIT 1`
    );

    if (orgRes.rows.length === 0) {
      console.log('⚠️ No reply_forward_emails defined');
      return res.sendStatus(200);
    }

    const forwardEmails = orgRes.rows[0].reply_forward_emails
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (forwardEmails.length === 0) {
      console.log('⚠️ Forward list empty');
      return res.sendStatus(200);
    }

    await sendEmail({
      to: forwardEmails,
      from: from,        // ✅ visitor email
      replyTo: from,     // organizer reply → visitor
      subject: `[Visitor Reply] ${subject}`,
      text: `
From: ${from}

--------------------
${text}
--------------------
      `
    });

    console.log('✅ Reply forwarded to:', forwardEmails.join(', '));
    res.sendStatus(200);

  } catch (err) {
    console.error('❌ Inbound forward error:', err);
    res.sendStatus(200); // avoid SendGrid retries
  }
});

module.exports = router;
