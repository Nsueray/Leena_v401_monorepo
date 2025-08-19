const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');
const generateQR = require('../utils/generateQR');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// eşanlamlı alanlar eşlemesi
const fieldMap = {
  name: ['name', 'first name', 'firstname'],
  last_name: ['last_name', 'lastname', 'surname', 'last name'],
  email: ['email', 'e-mail', 'mail'],
  company: ['company', 'company name', 'organization'],
  country: ['country', 'nation'],
  job_title: ['job title', 'title', 'position'],
  source: ['source'],
  origin: ['origin']
};

function mapFields(row) {
  const normalized = {};
  const keys = Object.keys(row);

  for (const targetField in fieldMap) {
    const aliases = fieldMap[targetField];
    const match = keys.find(k => aliases.includes(k.trim().toLowerCase()));
    normalized[targetField] = match ? row[match] : '';
  }

  return normalized;
}

router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  const { expoId, source, origin, sendEmail: sendEmailFlag, templateId } = req.body;
  const file = req.file;

  if (!expoId || !file) {
    return res.status(400).json({ error: 'expoId and file are required' });
  }

  const results = [];
  const failed = [];
  const organizerId = req.organizer_id;
  console.log('🟡 Starting import process...');

  // dosya tipi kontrolü
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.xlsx') {
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    sheet.forEach(row => results.push(row));
  } else {
    await new Promise((resolve, reject) => {
      fs.createReadStream(file.path)
        .pipe(csv())
        .on('data', row => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });
  }

  console.log(`📦 ${results.length} total rows read from CSV/Excel`);

  // Email şablonu varsa önceden çek
  let emailTemplate = null;
  if (sendEmailFlag === 'true' && templateId) {
    const tplRes = await pool.query(
      'SELECT subject, body FROM email_templates WHERE id = $1 AND organizer_id = $2 AND expo_id = $3',
      [templateId, organizerId, expoId]
    );
    if (tplRes.rows.length > 0) {
      emailTemplate = tplRes.rows[0];
      console.log(`📧 Email template loaded: ${emailTemplate.subject}`);
    }
  }

  let successCount = 0;
  for (const rawRow of results) {
    const row = mapFields(rawRow);

    const name = row.name?.trim();
    const lastName = row.last_name?.trim() || '';
    const email = row.email?.trim();
    const company = row.company?.trim() || '';
    const country = row.country?.trim() || '';
    const jobTitle = row.job_title?.trim() || '';
    const visitorSource = source || row.source || '';
    const visitorOrigin = origin || row.origin || '';

    if (!name || !email) {
      console.warn('⚠️ Skipped row due to missing required fields:', {
        name,
        email,
        originalRow: row
      });
      failed.push(row);
      continue;
    }

    const qrText = `${expoId}_${email}_${Date.now()}`;
    const qrFilename = `${Date.now()}_${Math.floor(Math.random() * 10000)}.png`;
    const qrPath = path.join(__dirname, '..', 'public', 'qr', qrFilename);
    const qrUrl = `http://localhost:3000/qr/${qrFilename}`;

    try {
      await generateQR(qrText, qrPath);

      await pool.query(
        `INSERT INTO visitors
          (organizer_id, expo_id, name, last_name, email, company, country, job_title, source, origin, qr_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          organizerId,
          expoId,
          name,
          lastName,
          email,
          company,
          country,
          jobTitle,
          visitorSource,
          visitorOrigin,
          qrFilename
        ]
      );

      if (sendEmailFlag === 'true' && emailTemplate) {
        await sendEmail({
          to: email,
          templateKey: null,
          variables: {
            NAME: name,
            COMPANY: company,
            QR: qrUrl
          },
          subject: emailTemplate.subject,
          html: emailTemplate.body
        });
      }

      successCount++;
    } catch (err) {
      console.error('Error processing row:', err);
      failed.push(row);
    }
  }

  fs.unlinkSync(file.path);
  console.log(`✅ Import complete: ${successCount} success, ${failed.length} failed`);
  res.json({ successCount, failedCount: failed.length });
});

module.exports = router;
