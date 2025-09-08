require('dotenv').config();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: 'suer@elan-expo.com',
  from: 'noreply@leena.app', // doğrulanmış eposta adresi
  subject: 'Test Email',
  text: 'This is a test email',
  html: '<strong>This is a test email</strong>',
};

sgMail
  .send(msg)
  .then(() => {
    console.log('Email sent successfully!');
  })
  .catch((error) => {
    console.error('Error:', error.response?.body || error);
  });
