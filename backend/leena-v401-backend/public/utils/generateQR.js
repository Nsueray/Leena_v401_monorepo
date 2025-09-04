const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

async function generateQR(text, filepath) {
  try {
    // filepath artık tam yol olmalı, sadece klasörü kontrol et ve oluştur
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await QRCode.toFile(filepath, text, {
      width: 300,
      errorCorrectionLevel: 'H'
    });

    return true;
  } catch (err) {
    console.error('QR code generation error:', err);
    throw err;
  }
}

module.exports = generateQR;
