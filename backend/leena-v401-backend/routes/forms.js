const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const jwt = require('jsonwebtoken');

router.post('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const organizer_id = decoded.organizer_id;
  let {
    expoSlug,
    formSlug,
    formName,
    source,
    origin,
    topBanner,
    bottomBanner,
    fields
  } = req.body;

  expoSlug = expoSlug.toLowerCase().replace(/\s+/g, '-');

  if (!expoSlug || !formSlug || !formName || !fields || fields.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const expoResult = await pool.query('SELECT id FROM expos WHERE slug = $1', [expoSlug]);

    if (expoResult.rows.length === 0) {
      return res.status(400).json({ error: 'Expo not found' });
    }

    const expo_id = expoResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO forms (
        organizer_id, expo_id, form_name, source, origin, top_banner, bottom_banner, fields, slug
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [organizer_id, expo_id, formName, source, origin, topBanner, bottomBanner, JSON.stringify(fields), formSlug]
    );

    res.status(201).json({ message: 'Form created successfully', form: result.rows[0] });
  } catch (err) {
    console.error('Error inserting form:', err);
    console.error('Payload Debug:', {
      organizer_id,
      expoSlug,
      formSlug,
      formName,
      source,
      origin,
      topBanner,
      bottomBanner,
      fields
    });
    res.status(500).json({ error: 'Failed to save form' });
  }
});

// ✅ Get form by expoSlug and formSlug
router.get('/slug/:expoSlug/:formSlug', async (req, res) => {
  const { expoSlug, formSlug } = req.params;

  try {
    const expoResult = await pool.query('SELECT id FROM expos WHERE slug = $1', [expoSlug]);

    if (expoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }

    const expoId = expoResult.rows[0].id;

    const formResult = await pool.query(
      'SELECT * FROM forms WHERE expo_id = $1 AND slug = $2',
      [expoId, formSlug]
    );

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    res.json(formResult.rows[0]);
  } catch (err) {
    console.error('Error fetching form by slug:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ NEW: Get all forms by expo ID (for form-list.html)
router.get('/by-expo/:expoId', async (req, res) => {
  const { expoId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM forms WHERE expo_id = $1 ORDER BY created_at DESC',
      [expoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching forms by expoId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
