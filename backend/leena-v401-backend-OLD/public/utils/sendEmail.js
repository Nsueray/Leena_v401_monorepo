const sgMail = require('@sendgrid/mail');
const fs = require('fs');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail({ to, templateKey = null, variables, subject, html }) {
  try {
    let emailHtml = html;

    // Eğer templateKey verildiyse dosyadan oku
    if (templateKey && !html) {
      const templatePath = `email_templates/${templateKey}.html`;
      emailHtml = fs.readFileSync(templatePath, 'utf-8');
    }

    // Değişkenleri yerine koy
    Object.keys(variables).forEach(key => {
      const pattern = new RegExp(`\$begin:math:display$${key}\\$end:math:display$`, 'g');
      emailHtml = emailHtml.replace(pattern, variables[key]);
    });

    const msg = {
      to,
      from: process.env.SENDER_EMAIL || 'noreply@leena.app',
      subject: subject || 'Your registration is confirmed',
      html: emailHtml
    };

    await sgMail.send(msg);
  } catch (err) {
    console.error('SendGrid Email Error:', err);
    throw err;
  }
}

module.exports = sendEmail;
