const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const pool = require('../utils/db');
const { sendEmail } = require('../utils/email');

router.post('/inbound', upload.none(), async (req, res) => {
  try {
    const subject = req.body.subject || 'Visitor Reply';
    const text = req.body.text || '';

    // Parse FROM
    let fromEmail = req.body.from;

    const match = req.body.from && req.body.from.match(/<(.+)>/);
    if (match) {
      fromEmail = match[1].trim();
    }

    console.log('📩 INBOUND REPLY FROM:', fromEmail);

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
      return res.sendStatus(200);
    }

    await sendEmail({
      to: forwardEmails,
      from: fromEmail,          // ✅ STRING — mevcut sistemle %100 uyumlu
      replyTo: fromEmail,
      subject: `[Visitor Reply] ${subject}`,
      text: `
From: ${req.body.from}

--------------------
${text}
--------------------
      `
    });

    console.log('✅ Reply forwarded to:', forwardEmails.join(', '));
    res.sendStatus(200);

  } catch (err) {
    console.error('❌ Inbound forward error:', err);
    res.sendStatus(200);
  }
});

module.exports = router;
