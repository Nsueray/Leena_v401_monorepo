// utils/email.js
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    console.warn('⚠️ SENDGRID_API_KEY not found in environment variables');
}

/**
 * Send registration confirmation email with QR code
 * @param {object} visitor - Visitor data
 * @param {string} qrCodeDataUrl - QR code as base64 data URL
 * @param {string} badgeUrl - Badge print URL
 * @returns {Promise<boolean>} Success status
 */
async function sendRegistrationEmail(visitor, qrCodeDataUrl, badgeUrl) {
    try {
        // Check if SendGrid is configured
        if (!process.env.SENDGRID_API_KEY || !process.env.SENDER_EMAIL) {
            console.log('📧 Email service not configured, skipping email send');
            return false;
        }

        // Extract visitor email
        const recipientEmail = visitor.email || 
                              visitor.custom_fields?.email || 
                              visitor.custom_fields?.Email;
        
        if (!recipientEmail) {
            console.log('No email address found for visitor');
            return false;
        }

        // Generate email HTML
        const emailHtml = generateEmailTemplate(visitor, qrCodeDataUrl, badgeUrl);

        // Prepare email message
        const msg = {
            to: recipientEmail,
            from: process.env.SENDER_EMAIL,
            subject: 'Registration Confirmation - Your Event Badge',
            html: emailHtml,
            // Optional: Attach QR code as image
            attachments: [
                {
                    content: qrCodeDataUrl.split('base64,')[1],
                    filename: 'qr-badge.png',
                    type: 'image/png',
                    disposition: 'inline',
                    content_id: 'qrcode'
                }
            ]
        };

        // Send email
        await sgMail.send(msg);
        console.log(`✅ Registration email sent to ${recipientEmail}`);
        return true;

    } catch (error) {
        console.error('Error sending registration email:', error);
        // Don't throw error to prevent registration failure
        return false;
    }
}

/**
 * Generate email HTML template
 * @param {object} visitor - Visitor data
 * @param {string} qrCodeDataUrl - QR code as base64 data URL
 * @param {string} badgeUrl - Badge print URL
 * @returns {string} HTML email content
 */
function generateEmailTemplate(visitor, qrCodeDataUrl, badgeUrl) {
    const visitorName = visitor.name || 
                       visitor.custom_fields?.full_name || 
                       visitor.custom_fields?.name || 
                       'Valued Guest';
    
    const company = visitor.company || 
                   visitor.custom_fields?.company || 
                   '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
                            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">
                                Registration Confirmed! ✅
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="color: #333; margin: 0 0 10px 0; font-size: 24px;">
                                Hello ${visitorName}!
                            </h2>
                            ${company ? `<p style="color: #666; margin: 0 0 20px 0;">${company}</p>` : ''}
                            
                            <p style="color: #666; line-height: 1.6; margin: 20px 0;">
                                Thank you for registering! Your registration has been successfully received. 
                                Please save this email as it contains your event badge QR code.
                            </p>
                            
                            <!-- Badge Info -->
                            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 30px 0;">
                                <p style="color: #333; font-weight: 600; margin: 0 0 10px 0;">
                                    Your Badge Information:
                                </p>
                                <p style="color: #666; margin: 5px 0;">
                                    <strong>Badge ID:</strong> ${visitor.badge_id || 'N/A'}
                                </p>
                                <p style="color: #666; margin: 5px 0;">
                                    <strong>Registration Date:</strong> ${new Date(visitor.created_at).toLocaleDateString()}
                                </p>
                            </div>
                            
                            <!-- QR Code Section -->
                            <div style="text-align: center; margin: 40px 0;">
                                <h3 style="color: #333; margin: 0 0 20px 0;">Your Event QR Code</h3>
                                <p style="color: #666; margin: 0 0 20px 0; font-size: 14px;">
                                    Present this QR code at the event for quick check-in
                                </p>
                                <div style="background: white; padding: 20px; display: inline-block; border: 2px solid #e0e0e0; border-radius: 10px;">
                                    <img src="cid:qrcode" alt="Your QR Code" style="width: 250px; height: 250px;">
                                </div>
                            </div>
                            
                            <!-- Action Buttons -->
                            <div style="text-align: center; margin: 40px 0;">
                                <a href="${badgeUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: 600; margin: 0 10px;">
                                    🎫 Print Your Badge
                                </a>
                            </div>
                            
                            <!-- Instructions -->
                            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 30px 0;">
                                <p style="color: #856404; margin: 0; font-weight: 600;">
                                    Important Instructions:
                                </p>
                                <ul style="color: #856404; margin: 10px 0 0 0; padding-left: 20px;">
                                    <li>Save this email or take a screenshot of the QR code</li>
                                    <li>You can print your badge using the button above</li>
                                    <li>Present the QR code at the registration desk</li>
                                </ul>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8f9fa; padding: 30px; text-align: center; border-radius: 0 0 10px 10px;">
                            <p style="color: #999; margin: 0; font-size: 14px;">
                                If you have any questions, please contact our support team
                            </p>
                            <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">
                                © ${new Date().getFullYear()} Leena Events. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

module.exports = {
    sendRegistrationEmail,
    generateEmailTemplate
};
