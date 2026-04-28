const sgMail = require('@sendgrid/mail');
const { generateQRCode, generateBadgeUrl } = require('./qrcode');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Replace placeholders in template
 * @param {string} template - HTML with {{placeholders}}
 * @param {object} data - Key-value data
 * @returns {string}
 */
function processEmailTemplate(template, data) {
    if (!template) return '';

    return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
        const parts = expr.split('|').map(p => p.trim());
        for (const part of parts) {
            if (/^".*"$/.test(part)) return part.slice(1, -1);
            if (data[part]) return data[part];
        }
        return '';
    });
}

/**
 * Send a single email using SendGrid
 * @param {string} to - Recipient
 * @param {string} subject - Email subject
 * @param {string} html - HTML body
 * @returns {Promise<boolean>}
 */
async function sendEmail(to, subject, html) {
    try {
        if (!process.env.SENDGRID_API_KEY) {
            console.log('SendGrid not configured. Skipping send.');
            return true;
        }

        const msg = {
            to,
            from: process.env.SENDER_EMAIL || 'noreply@leena.app',
            subject,
            html
        };

        await sgMail.send(msg);
        console.log(`📧 Email sent to: ${to}`);
        return true;
    } catch (err) {
        console.error(`❌ SendGrid error to ${to}:`, err.message || err);
        return false;
    }
}

/**
 * Send a single email with Reply-To using SendGrid
 * @param {string} to - Recipient
 * @param {string} subject - Email subject
 * @param {string} html - HTML body
 * @param {string} replyToEmail - Reply-To address
 * @param {object} [extraHeaders] - Optional additional headers (e.g. List-Unsubscribe)
 * @returns {Promise<boolean>}
 */
async function sendEmailWithReplyTo(to, subject, html, replyToEmail, extraHeaders) {
    try {
        if (!process.env.SENDGRID_API_KEY) {
            console.log('SendGrid not configured. Skipping send.');
            return true;
        }

        const msg = {
            to,
            from: process.env.SENDER_EMAIL || 'noreply@leena.app',
            replyTo: replyToEmail,
            subject,
            html,
            ...(extraHeaders && Object.keys(extraHeaders).length > 0 ? { headers: extraHeaders } : {})
        };

        await sgMail.send(msg);
        console.log(`📧 Email sent to: ${to} (reply-to: ${replyToEmail})`);
        return true;
    } catch (err) {
        console.error(`❌ SendGrid error to ${to}:`, err.message || err);
        return false;
    }
}

/**
 * Send registration confirmation with generated QR and badge link
 * @param {object} visitor
 * @returns {Promise<boolean>}
 */
async function sendRegistrationEmail(visitor) {
    const qr_code = visitor.qr_code || visitor.qrCode || visitor.badge_id || '';
    const badgeUrl = generateBadgeUrl(qr_code);
    const qrCodeDataUrl = await generateQRCode(qr_code);

    const template = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #667eea; color: white; padding: 30px; text-align: center; }
                .content { padding: 30px; background: #f8f9fa; text-align: center; }
                .button { padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; display: inline-block; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>Registration Confirmed</h1></div>
                <div class="content">
                    <p>Hello ${visitor.name || 'Guest'},</p>
                    <p>Thank you for registering for ${visitor.expoName || 'our event'}.</p>
                    ${qrCodeDataUrl ? `<p><img src="${qrCodeDataUrl}" alt="QR Code" style="max-width: 150px;" /></p>` : ''}
                    ${badgeUrl ? `<p><a href="${badgeUrl}" class="button">Download Badge</a></p>` : ''}
                </div>
            </div>
        </body>
        </html>
    `;

    return await sendEmail(visitor.email, 'Registration Confirmation', template);
}

/**
 * Send bulk emails using template
 * @param {array} recipients
 * @param {string} subject
 * @param {string} htmlTemplate
 * @param {object} commonData
 * @returns {Promise<object>}
 */
async function sendBulkEmails(recipients, subject, htmlTemplate, commonData = {}) {
    const results = { sent: [], failed: [] };

    for (const recipient of recipients) {
        try {
            const data = {
                ...commonData,
                name: recipient.name || 'Guest',
                email: recipient.email,
                company: recipient.company || '',
                ...recipient.custom_data
            };

            const html = processEmailTemplate(htmlTemplate, data);
            const subj = processEmailTemplate(subject, data);

            const ok = await sendEmail(recipient.email, subj, html);
            if (ok) results.sent.push(recipient.email);
            else results.failed.push(recipient.email);

            await new Promise(r => setTimeout(r, 100)); // Delay
        } catch (err) {
            console.error('❌ Bulk email error:', err);
            results.failed.push(recipient.email);
        }
    }

    return results;
}

/**
 * Format conference_topic for email templates.
 * Single topic → plain text. Multiple topics (separated by " || ") → HTML ordered list.
 * @param {string} raw - Raw conference_topic string (e.g. "Topic A || Topic B")
 * @returns {string} - Formatted HTML string
 */
function formatConferenceTopic(raw) {
    if (!raw) return '';
    const str = String(raw).trim();
    if (!str) return '';

    const topics = str.split(' || ').map(t => t.trim()).filter(Boolean);
    if (topics.length === 0) return '';
    if (topics.length === 1) return topics[0];

    const items = topics.map(t =>
        `<li style="margin-bottom:4px;font-size:13px;color:#1e1b4b;line-height:1.5;">${t}</li>`
    ).join('');
    return `<ul style="margin:4px 0 0 0;padding-left:20px;list-style-type:disc;">${items}</ul>`;
}

module.exports = {
    processEmailTemplate,
    formatConferenceTopic,
    sendEmail,
    sendEmailWithReplyTo,
    sendRegistrationEmail,
    sendBulkEmails
};
