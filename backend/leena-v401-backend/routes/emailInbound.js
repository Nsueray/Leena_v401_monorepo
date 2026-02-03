const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const { sendEmail } = require('../utils/email');

/**
 * Inbound Email → Direct Forward to Organizer
 */

router.post('/inbound', async (req, res) => {
  try {
    const from = req.body.from;     // visitor email
    const subject = req.body.subject || 'Visitor Reply';
    const text = req.body.text || '';

    console.log('📩 INBOUND REPLY FROM:', from);

    // Şimdilik: forward maili olan ilk organizer
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
      from: from,          // ✅ visitor email
      replyTo: from,       // organizer reply → visitor
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
    res.sendStatus(200); // SendGrid retry yapmasın
  }
});

module.exports = router;
