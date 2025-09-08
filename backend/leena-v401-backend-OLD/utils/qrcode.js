const QRCode = require('qrcode');
require('dotenv').config(); // ✅ .env dosyasını yükle

/**
 * Generate QR code as base64 data URL
 * @param {string} data - Data to encode in QR
 * @param {object} options - QR code options
 * @returns {Promise<string>} Base64 data URL of QR code
 */
async function generateQRCode(data, options = {}) {
    try {
        const qrOptions = {
            width: options.width || 300,
            margin: options.margin || 2,
            color: {
                dark: options.darkColor || '#000000',
                light: options.lightColor || '#FFFFFF'
            },
            errorCorrectionLevel: options.errorCorrectionLevel || 'M'
        };

        const dataUrl = await QRCode.toDataURL(data, qrOptions);
        return dataUrl;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw new Error('Failed to generate QR code');
    }
}

/**
 * Generate QR code as buffer (for attachments)
 * @param {string} data - Data to encode in QR
 * @param {object} options - QR code options
 * @returns {Promise<Buffer>} Buffer of QR code image
 */
async function generateQRCodeBuffer(data, options = {}) {
    try {
        const qrOptions = {
            width: options.width || 300,
            margin: options.margin || 2,
            color: {
                dark: options.darkColor || '#000000',
                light: options.lightColor || '#FFFFFF'
            },
            errorCorrectionLevel: options.errorCorrectionLevel || 'M'
        };

        const buffer = await QRCode.toBuffer(data, qrOptions);
        return buffer;
    } catch (error) {
        console.error('Error generating QR code buffer:', error);
        throw new Error('Failed to generate QR code buffer');
    }
}

/**
 * Generate badge print URL
 * @param {string} qrCode - QR code UUID
 * @param {string} baseUrl - Optional override
 * @returns {string} Badge print URL
 */
function generateBadgeUrl(qrCode, baseUrl) {
    const fallback = baseUrl || process.env.BASE_BADGE_URL || 'http://localhost:3000';
    return `${fallback}/badge-print.html?qr=${qrCode}`;
}

module.exports = {
    generateQRCode,
    generateQRCodeBuffer,
    generateBadgeUrl
};
