const express = require('express');
const router = express.Router();

/**
 * SendGrid Inbound Parse endpoint
 * Receives incoming email replies
 * 
 * IMPORTANT:
 * - This endpoint is intentionally PUBLIC
 * - No auth middleware
 * - First phase: only log & acknowledge
 */

router.post('/inbound', async (req, res) => {
  try {
    console.log('📩 [INBOUND EMAIL RECEIVED]');
    console.log('--------------------------------');

    // Basic fields
    console.log('From:', req.body.from);
    console.log('To:', req.body.to);
    console.log('Subject:', req.body.subject);

    // Headers (critical for Message-ID matching later)
    if (req.body.headers) {
      console.log('Headers:', req.body.headers);
    }

    // Text / HTML content
    if (req.body.text) {
      console.log('Text Body:', req.body.text.substring(0, 500));
    }

    if (req.body.html) {
      console.log('HTML Body (truncated)');
    }

    console.log('--------------------------------');

    // MUST respond 200 OK, otherwise SendGrid retries
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Inbound email error:', error);

    // Still respond 200 to avoid retry storms
    res.status(200).send('ERROR');
  }
});

module.exports = router;
