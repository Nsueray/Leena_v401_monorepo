// 🔁 BOZMADAN TAM DOSYA SAĞLANIYOR
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, processEmailTemplate } = require('../utils/email');
const authMiddleware = require('../middleware/authMiddleware');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const upload = multer({ storage: multer.memoryStorage() });

// ✅ ✅ ✅ SADECE BU BÖLÜM GÜNCELLENDİ
router.get('/paginated', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id); // 🟡 EXPLICIT PARSE
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    const filters = ['expo_id = $1'];
    const values = [expo_id];
    let idx = 2;

    // 🔍 Search
    if (req.query.search) {
      filters.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(company) LIKE $${idx})`);
      values.push(`%${req.query.search.toLowerCase()}%`);
      idx++;
    }

    // 📅 Date Filters
    if (req.query.startDate) {
      filters.push(`created_at >= $${idx}`);
      values.push(req.query.startDate);
      idx++;
    }

    if (req.query.endDate) {
      filters.push(`created_at <= $${idx}`);
      values.push(req.query.endDate + ' 23:59:59');
      idx++;
    }

    // 🧭 Source
    if (req.query.source) {
      const sourceList = req.query.source.split(',');
      filters.push(`source = ANY($${idx})`);
      values.push(sourceList);
      idx++;
    }

    // 🧭 Origin
    if (req.query.origin) {
      const originList = req.query.origin.split(',');
      filters.push(`origin = ANY($${idx})`);
      values.push(originList);
      idx++;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataResult = await pool.query(`
      SELECT id, name, last_name, company, country, email, source, origin, created_at
      FROM visitors
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...values, limit, offset]);

    return res.json({
      success: true,
      total,
      totalPages: Math.ceil(total / limit),
      visitors: dataResult.rows
    });

  } catch (err) {
    console.error('❌ Paginated visitor fetch error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
