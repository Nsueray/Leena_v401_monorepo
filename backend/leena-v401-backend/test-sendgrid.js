require('dotenv').config();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: 'suer@elan-expo.com',
  from: 'noreply@leena.app', // doğrulanmış adres, manuel yazıyoruz
  subject: 'Test Email from Leena EMS',
  text: 'If you see this, email sending works!',
};

sgMail
  .send(msg)
  .then(() => console.log('✅ Test email sent successfully!'))
  .catch(error => {
    console.error('❌ SendGrid Error:', error.response?.body || error.message);
  });
