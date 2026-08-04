// ============================================================================
// routes/salesAgents.js — sales agents: liste + create/edit
// ----------------------------------------------------------------------------
// GET default: yalnız aktifler (B6 — pasif agent yeni atamada seçilemez;
// assignment dropdown'ı değişmeden doğru davranışa kavuşur). ?include_inactive=1
// liste sayfası için hepsini döner.
// zoho_record_id yalnız import'un alanı — LEENA-doğumlu kayıtlarda NULL, hiçbir
// endpoint YAZMAZ/DEĞİŞTİRMEZ. user_id Faz 4 (kimlik) — burada yazılmaz.
// ============================================================================
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

const AGENT_TYPES = ['internal', 'external_freelance', 'external_agency'];

const SELECT_COLS =
  `id, name, agent_type, sales_group, sales_team, country, email,
   agent_company, commission_currency, default_commission_pct,
   default_director_pct, is_active, zoho_record_id, office_id`;

// pct: null geçerli; 0-100 sayı (0 dahil) → değer; aksi → hata sinyali (undefined).
function normPct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 100) return undefined; // invalid
  return n;
}
// currency: payments deseni (contracts.js:354-357) — 3-harf, uppercase'e normalize.
function normCurrency(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z]{3}$/.test(v.trim())) return undefined; // invalid
  return v.trim().toUpperCase();
}
function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// ----------------------------------------------------------------------------
// GET /api/sales-agents  (?include_inactive=1 → hepsi; default yalnız aktif)
// ----------------------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  const includeInactive = req.query.include_inactive === '1';
  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLS}
         FROM sales_agents
        WHERE organizer_id = $1
          ${includeInactive ? '' : 'AND is_active = true'}
        ORDER BY name ASC`,
      [req.organizer_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales agents:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ortak alan doğrulama — POST ve PUT paylaşır. Geçerliyse {ok:true, v}, değilse {error}.
function validateBody(b) {
  const name = trimOrNull(b.name);
  if (!name) return { error: 'name is required.' };
  if (!AGENT_TYPES.includes(b.agent_type)) {
    return { error: `agent_type must be one of: ${AGENT_TYPES.join(', ')}` };
  }
  const pct = normPct(b.default_commission_pct);
  if (pct === undefined) return { error: 'default_commission_pct must be a number between 0 and 100.' };
  const dirPct = normPct(b.default_director_pct);
  if (dirPct === undefined) return { error: 'default_director_pct must be a number between 0 and 100.' };
  const currency = normCurrency(b.commission_currency);
  if (currency === undefined) return { error: 'commission_currency must be a 3-letter code.' };

  // M5: office_id opsiyonel (NULL kabul, OFS-04 ruhu). Format kontrolü burada (sync);
  // offices'ta VARLIK kontrolü POST/PUT'ta (async DB — payment emsali contracts.js).
  let office_id = null;
  if (b.office_id !== null && b.office_id !== undefined && b.office_id !== '') {
    const oid = Number(b.office_id);
    if (!Number.isInteger(oid) || oid <= 0) return { error: 'office_id must be a positive integer.' };
    office_id = oid;
  }

  return {
    ok: true,
    v: {
      name,
      agent_type: b.agent_type,
      email: trimOrNull(b.email) ? String(b.email).trim().toLowerCase() : null,
      sales_group: trimOrNull(b.sales_group),
      sales_team: trimOrNull(b.sales_team),
      country: trimOrNull(b.country),
      agent_company: trimOrNull(b.agent_company),
      commission_currency: currency,
      default_commission_pct: pct,
      default_director_pct: dirPct,
      office_id,
    },
  };
}

// M5: office_id verilmişse offices'ta var mı (is_active şartı YOK — düzenlemede
// pasifleşmiş ofisi koruyabilmek için varlık yeter). Payment ofis kontrolü emsali.
async function officeExists(office_id) {
  if (office_id == null) return true;
  const off = await pool.query('SELECT id FROM offices WHERE id = $1', [office_id]);
  return off.rows.length > 0;
}

// ----------------------------------------------------------------------------
// POST /api/sales-agents  (create)
// user_id + zoho_record_id YAZILMAZ (Faz 4 / yalnız import). is_active=true doğar.
// ----------------------------------------------------------------------------
router.post('/', authMiddleware, async (req, res) => {
  const r = validateBody(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.v;
  try {
    if (!(await officeExists(v.office_id))) return res.status(400).json({ error: 'invalid office' });
    const result = await pool.query(
      `INSERT INTO sales_agents
         (organizer_id, name, agent_type, email, sales_group, sales_team,
          country, agent_company, commission_currency,
          default_commission_pct, default_director_pct, office_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLS}`,
      [req.organizer_id, v.name, v.agent_type, v.email, v.sales_group, v.sales_team,
       v.country, v.agent_company, v.commission_currency,
       v.default_commission_pct, v.default_director_pct, v.office_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating sales agent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// PUT /api/sales-agents/:id  (edit)
// TAM SET (assignment deseni): gönderilmeyen ops. alan NULL'lanır; name/
// agent_type her zaman zorunlu. user_id + zoho_record_id ASLA değişmez
// (UPDATE listesinde yok). is_active boolean.
// B5 NOTU: deactivate reason-log'u Faz 4 audit'e ertelendi (bilinçli).
// ----------------------------------------------------------------------------
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const r = validateBody(b);
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.v;
  const is_active = b.is_active === false ? false : true; // boolean; default true

  try {
    if (!(await officeExists(v.office_id))) return res.status(400).json({ error: 'invalid office' });
    const result = await pool.query(
      `UPDATE sales_agents SET
         name = $1, agent_type = $2, email = $3, sales_group = $4, sales_team = $5,
         country = $6, agent_company = $7, commission_currency = $8,
         default_commission_pct = $9, default_director_pct = $10, office_id = $11,
         is_active = $12, updated_at = NOW()
       WHERE id = $13 AND organizer_id = $14
       RETURNING ${SELECT_COLS}`,
      [v.name, v.agent_type, v.email, v.sales_group, v.sales_team, v.country,
       v.agent_company, v.commission_currency, v.default_commission_pct,
       v.default_director_pct, v.office_id, is_active, id, req.organizer_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales agent not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating sales agent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
