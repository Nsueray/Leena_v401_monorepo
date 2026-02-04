const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const pool = require('../utils/db');
const { sendEmail } = require('../utils/email');

/**
 * SendGrid Inbound Parse
 * Forward replies to organizer emails
 */

router.post('/inbound', upload.none(), async (req, res) => {
  try {
    const subject = req.body.subject || 'Visitor Reply';
    const rawFrom = req.body.from || '';
    
    // SendGrid sends full email in 'email' field
    const rawEmail = req.body.email || '';
    
    // Extract text content from raw email
    let textContent = '';
    
    // Try to get text/html from body first (if SendGrid parsed it)
    if (req.body.text) {
      textContent = req.body.text;
    } else if (req.body.html) {
      textContent = req.body.html;
    } else if (rawEmail) {
      // Parse text content from raw email
      // Look for the actual message content (before quoted reply)
      const lines = rawEmail.split('\n');
      let inBody = false;
      let bodyLines = [];
      
      for (const line of lines) {
        // Skip headers until we hit empty line (start of body)
        if (!inBody) {
          if (line.trim() === '') {
            inBody = true;
          }
          continue;
        }
        
        // Stop at quoted reply indicator
        if (line.startsWith('On ') && line.includes(' wrote:')) {
          break;
        }
        if (line.startsWith('>')) {
          break;
        }
        if (line.includes('-------- Original Message --------')) {
          break;
        }
        
        bodyLines.push(line);
      }
      
      textContent = bodyLines.join('\n').trim();
      
      // If still empty, try to extract from multipart
      if (!textContent && rawEmail.includes('Content-Type: text/plain')) {
        const plainMatch = rawEmail.match(/Content-Type: text\/plain[^\n]*\n\n([\s\S]*?)(?=\n--|\n\nOn .* wrote:)/);
        if (plainMatch) {
          textContent = plainMatch[1].trim();
        }
      }
    }

    // Extract plain email from "Name <email>" or "email"
    let fromEmail = rawFrom;
    const match = rawFrom.match(/<([^>]+)>/);
    if (match && match[1]) {
      fromEmail = match[1].trim();
    } else {
      fromEmail = rawFrom.trim();
    }

    console.log('📩 INBOUND REPLY FROM:', fromEmail);
    console.log('📩 EXTRACTED TEXT:', textContent ? textContent.substring(0, 200) : 'EMPTY');

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

    // Build HTML email with extracted content
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
          <strong>From:</strong> ${fromEmail}
        </div>
        <div style="padding: 16px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;">
          <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${textContent || '(No message content)'}</pre>
        </div>
      </div>
    `;

    await sendEmail(
      forwardEmails,
      `[Visitor Reply] ${subject}`,
      html
    );

    console.log('✅ Reply forwarded to:', forwardEmails.join(', '));
    res.sendStatus(200);

  } catch (err) {
    console.error('❌ Inbound forward error:', err);
    res.sendStatus(200);
  }
});

module.exports = router;
