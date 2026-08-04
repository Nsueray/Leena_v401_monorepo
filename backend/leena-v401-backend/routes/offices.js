// ----------------------------------------------------------------------------
// routes/offices.js — LEENA-master ofis referansı + YÖNETİM (M2). Mount: /api/offices
//   GET  /api/offices                    → aktif ofisler (dropdown beslemesi; OFS-01)
//   GET  /api/offices?include_inactive=1 → hepsi + is_active (ad çözümü + yönetim ekranı)
//   POST /api/offices                    → ekle (name UNIQUE, country_code FK)
//   PUT  /api/offices/:id                → düzenle (name/country_code/is_active); KAPAT = is_active=false
// ⚠️ DELETE YOK: ölçüm — her ofisin bağlı kaydı var (4 FK RESTRICT), silinemez → kapatma = is_active.
// ⚠️ ROL GATE YOK (Faz 4 ertelendi): yazma bugün HER kimliği doğrulanmış kullanıcıya açık.
//    BİLİNÇLİ karar, unutulmuş değil. offices global master'dır — organizer_id kolonu YOK.
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// name/country_code doğrulama (salesAgents.js validateBody emsali; sync).
function validateOffice(b) {
  const name = trimOrNull(b.name);
  if (!name) return { error: 'name is required.' };
  const cc = trimOrNull(b.country_code);
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return { error: 'country_code is required (2-letter code).' };
  return { ok: true, v: { name, country_code: cc.toUpperCase() } };
}
async function countryExists(code) {
  const r = await pool.query('SELECT code FROM core_countries WHERE code = $1', [code]);
  return r.rows.length > 0;
}

// GET /api/offices — VARSAYILAN aktif-only (mevcut davranış, DEĞİŞMEZ).
// ?include_inactive=1 → hepsi + is_active (H7: ayrı /all endpoint'i AÇILMAZ).
router.get('/', authMiddleware, async (req, res) => {
  // TODO Faz 4: role gate (B21-B42)
  const includeInactive = req.query.include_inactive === '1';
  try {
    const result = await pool.query(includeInactive
      ? 'SELECT id, name, country_code, is_active FROM offices ORDER BY name'
      : 'SELECT id, name, country_code FROM offices WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching offices:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/offices — ekle. is_active=true doğar (DB default).
router.post('/', authMiddleware, async (req, res) => {
  const r = validateOffice(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.v;
  try {
    if (!(await countryExists(v.country_code))) return res.status(400).json({ error: 'invalid country_code' });
    const result = await pool.query(
      'INSERT INTO offices (name, country_code) VALUES ($1, $2) RETURNING id, name, country_code, is_active',
      [v.name, v.country_code]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Office name already exists.' });   // offices_name_key
    console.error('Error creating office:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/offices/:id — düzenle. is_active=false → KAPAT (soft; DELETE yok).
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const r = validateOffice(b);
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.v;
  const is_active = b.is_active === false ? false : true;   // boolean; default true
  try {
    if (!(await countryExists(v.country_code))) return res.status(400).json({ error: 'invalid country_code' });
    const result = await pool.query(
      'UPDATE offices SET name = $1, country_code = $2, is_active = $3 WHERE id = $4 RETURNING id, name, country_code, is_active',
      [v.name, v.country_code, is_active, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Office not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Office name already exists.' });
    console.error('Error updating office:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
