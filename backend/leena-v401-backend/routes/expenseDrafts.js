// ----------------------------------------------------------------------------
// routes/expenseDrafts.js — GİDER TASLAKLARI (Paket 1b P1b-3). Mount: /api/expense-drafts
//   POST /             → taslak yaz (yazar: yapay zeka istemcisi dahil — YZ-03; source ai|import|manual)
//   GET  /             → liste (?status=pending|accepted|rejected|all · ?completeness=missing|complete)
//   GET  /:id          → tek taslak
//   POST /:id/accept   → insan kabulü: gider MEVCUT yoldan doğar (utils/ledger.js createExpense)
//   POST /:id/reject   → ret (silinmez)
//
// ── HÜKÜMLER ──
// - LED-08 DEĞİŞMEZ: gider onay statüsü taşımaz; onay bu ayrı tablodadır (042).
// - YZ-01 + LED-19: yapay zeka yalnız TASLAK yazar. Taslak ledger'a HİÇ yazmaz; hareket
//   yalnız kabulde, gider satırıyla birlikte doğar.
// - Taslak içeriği değişmez (042 trigger'ı): insanın düzelttiği/tamamladığı değerler kabul
//   gövdesinde gelir ve doğan gider satırına yazılır; taslak "ne önerildi" kaydı olarak kalır.
// - Tedarikçi eşleşmesi ÖNERİDİR (OFS-05): sunucu supplier_match_* yazar; giderin tedarikçisi
//   kabul gövdesindeki supplier_id'dir — gövdede yoksa gider tedarikçisiz doğar (otomatik atama YOK).
// - YZ-02: yapay zeka istemcisi şirket hesabının oturumuyla gelir (bugün Owner token'ı;
//   is_ai bayrağı YOK — "servis kullanıcısı" kararı Paket 2'de).
// - Paket 2 KAPI: okuma expense_drafts.read · yazma expense_drafts.write · kabul/ret
//   expense_drafts.approve. Kapsam KABULDE hesap üzerinden (gider orada doğar — ledger kuralı);
//   taslak yazımı ve ret para hareketi yazmaz → kapsam denetlenmez (yalnız izin).
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const ledger = require('../utils/ledger');
const { trimOrNull, isIntLike, isValidDate, METHODS } = ledger;
const perms = require('../utils/permissions');

const SOURCES = ['ai', 'import', 'manual'];
const STATUSES = ['pending', 'accepted', 'rejected'];
// Gider için ZORUNLU olup taslakta boş olabilecek alanlar (createExpense'in istedikleri).
const REQUIRED = ['expense_type_id', 'account_id', 'amount', 'exchange_rate', 'expense_date', 'payment_method'];
// Kabulde gövdeyle ezilebilen gider alanları (+ supplier_id: insanın seçimi).
const EXPENSE_FIELDS = ['expense_type_id', 'account_id', 'amount', 'currency', 'exchange_rate', 'expo_id',
                        'expense_date', 'payment_method', 'notes', 'document_url'];

function fail(res, err, what) {
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist.' });
  if (err.code === '23514') return res.status(400).json({ error: 'A value violates a database check constraint.' });
  if (err.code === '23505') return res.status(409).json({ error: 'This draft was already decided.' });
  console.error(`Expense draft ${what} failed:`, err);
  return res.status(500).json({ error: `Failed to ${what}.` });
}

// Gönderilen değer BİÇİMCE yanlışsa 400 (sessizce "eksik" sayılmaz); boşsa eksik listesine girer.
function parseDraft(b) {
  const d = {};
  const given = (k) => b[k] != null && b[k] !== '';
  for (const k of ['expense_type_id', 'account_id', 'expo_id']) {
    if (!given(k)) { d[k] = null; continue; }
    if (!isIntLike(b[k])) return { error: `${k} must be an integer id.` };
    d[k] = Number(b[k]);
  }
  for (const k of ['amount', 'exchange_rate']) {
    if (!given(k)) { d[k] = null; continue; }
    const n = Number(b[k]);
    if (!isFinite(n) || n <= 0) return { error: `${k} must be a number greater than 0.` };
    d[k] = n;
  }
  if (given('currency')) {
    if (!/^[A-Za-z]{3}$/.test(String(b.currency).trim())) return { error: 'currency must be a 3-letter ISO code.' };
    d.currency = String(b.currency).trim().toUpperCase();
  } else d.currency = null;
  if (given('expense_date')) {
    if (!isValidDate(b.expense_date)) return { error: 'expense_date must be a valid YYYY-MM-DD date.' };
    d.expense_date = b.expense_date;
  } else d.expense_date = null;
  if (given('payment_method')) {
    if (!METHODS.includes(b.payment_method)) return { error: `payment_method must be one of: ${METHODS.join(', ')}` };
    d.payment_method = b.payment_method;
  } else d.payment_method = null;
  d.document_url = trimOrNull(b.document_url);
  if (d.document_url && !/^https?:\/\//i.test(d.document_url)) return { error: 'document_url must start with http:// or https://' };
  d.notes = trimOrNull(b.notes);
  d.supplier_name = trimOrNull(b.supplier_name);
  d.confidence_note = trimOrNull(b.confidence_note);
  d.missing_fields = REQUIRED.filter(k => d[k] == null);
  return { draft: d };
}

const DRAFT_SELECT = `
  SELECT d.id, d.source, d.status,
         d.expense_type_id, t.name AS expense_type, c.name AS expense_category,
         d.account_id, a.name AS account_name, a.currency AS account_currency,
         d.amount, d.currency, d.exchange_rate, d.expo_id, ex.name AS expo_name,
         to_char(d.expense_date, 'YYYY-MM-DD') AS expense_date, d.payment_method, d.notes, d.document_url,
         d.supplier_name, d.supplier_match_id, s.name AS supplier_match_name, s.country_code AS supplier_match_country,
         d.supplier_match_score, d.confidence_note, d.missing_fields,
         d.expense_id, d.reviewed_at, COALESCE(ru.display_name, ru.email) AS reviewed_by_name,
         d.created_at, COALESCE(cu.display_name, cu.email) AS created_by_name
    FROM expense_drafts d
    LEFT JOIN expense_types t      ON t.id = d.expense_type_id
    LEFT JOIN expense_categories c ON c.id = t.category_id
    LEFT JOIN accounts a           ON a.id = d.account_id
    LEFT JOIN expos ex             ON ex.id = d.expo_id
    LEFT JOIN suppliers s          ON s.id = d.supplier_match_id
    LEFT JOIN users ru             ON ru.id = d.reviewed_by
    LEFT JOIN users cu             ON cu.id = d.created_by
   WHERE d.organizer_id = $1`;

router.use(authMiddleware);

// 042 uygulanmadıysa (deploy → migrate arası) 503 — anlamlı yanıt, 500 değil.
router.use(async (req, res, next) => {
  try {
    if (await ledger.featureReady(pool, 'drafts')) return next();
    return res.status(503).json({ error: 'Expense drafts are not migrated yet (run scripts/migrate.js).' });
  } catch (err) { return next(err); }
});

router.post('/', perms.requirePermission('expense_drafts.write'), async (req, res) => {
  const b = req.body || {};
  if (!SOURCES.includes(b.source)) return res.status(400).json({ error: `source must be one of: ${SOURCES.join(', ')}` });
  const p = parseDraft(b);
  if (p.error) return res.status(400).json({ error: p.error });
  const d = p.draft;
  try {
    if (d.expo_id != null && !(await ledger.expoOfOrganizer(pool, req.organizer_id, d.expo_id))) {
      return res.status(400).json({ error: 'invalid expo' });
    }
    // Öneri: en yüksek skorlu aktif tedarikçi (yoksa NULL). Atama DEĞİL.
    const best = d.supplier_name ? (await ledger.matchSuppliers(pool, req.organizer_id, d.supplier_name, { limit: 1 }))[0] : null;
    const r = await pool.query(
      `INSERT INTO expense_drafts (organizer_id, source, expense_type_id, account_id, amount, currency, exchange_rate,
                                   expo_id, expense_date, payment_method, notes, document_url, supplier_name,
                                   supplier_match_id, supplier_match_score, confidence_note, missing_fields, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18) RETURNING id`,
      [req.organizer_id, b.source, d.expense_type_id, d.account_id, d.amount, d.currency, d.exchange_rate,
       d.expo_id, d.expense_date, d.payment_method, d.notes, d.document_url, d.supplier_name,
       best ? best.id : null, best ? best.score : null, d.confidence_note, JSON.stringify(d.missing_fields),
       ledger.requestUserId(req)]);
    const row = await pool.query(`${DRAFT_SELECT} AND d.id = $2`, [req.organizer_id, r.rows[0].id]);
    res.status(201).json({ draft: row.rows[0] });
  } catch (err) { return fail(res, err, 'create'); }
});

router.get('/', perms.requirePermission('expense_drafts.read'), async (req, res) => {
  const status = req.query.status || 'pending';
  if (status !== 'all' && !STATUSES.includes(status)) return res.status(400).json({ error: 'status must be pending, accepted, rejected or all.' });
  const comp = req.query.completeness || null;
  if (comp && comp !== 'missing' && comp !== 'complete') return res.status(400).json({ error: 'completeness must be missing or complete.' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  try {
    const r = await pool.query(
      `${DRAFT_SELECT}
         AND ($2::text IS NULL OR d.status = $2)
         AND ($3::text IS NULL OR ($3 = 'missing') = (jsonb_array_length(d.missing_fields) > 0))
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $4`,
      [req.organizer_id, status === 'all' ? null : status, comp, limit]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching expense drafts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', perms.requirePermission('expense_drafts.read'), async (req, res) => {
  if (!isIntLike(req.params.id)) return res.status(404).json({ error: 'Draft not found' });
  try {
    const r = await pool.query(`${DRAFT_SELECT} AND d.id = $2`, [req.organizer_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Draft not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Error fetching expense draft:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Kabul: taslak alanları + gövde (insanın tamamladığı/düzelttiği değerler, supplier_id seçimi)
// → createExpense (POST /api/ledger/expenses ile AYNI doğrulama) → taslak accepted + expense_id.
// Hata → 400, taslak pending kalır (tek transaction).
router.post('/:id/accept', perms.requirePermission('expense_drafts.approve'), async (req, res) => {
  if (!isIntLike(req.params.id)) return res.status(404).json({ error: 'Draft not found' });
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, status, expense_type_id, account_id, amount, currency, exchange_rate, expo_id,
              to_char(expense_date, 'YYYY-MM-DD') AS expense_date, payment_method, notes, document_url
         FROM expense_drafts WHERE id = $1 AND organizer_id = $2 FOR UPDATE`,
      [req.params.id, req.organizer_id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Draft not found' }); }
    const dr = r.rows[0];
    if (dr.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Draft is already ${dr.status}.` }); }
    const body = {};
    for (const k of EXPENSE_FIELDS) body[k] = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : dr[k];
    body.supplier_id = b.supplier_id;
    const actor = ledger.requestUserId(req);
    const e = await ledger.createExpense(client, { organizerId: req.organizer_id, body, actor,
      canUseAccount: (a) => perms.checkScope(req, { office_id: a.office_id, created_by: a.created_by }) });
    if (e.error) { await client.query('ROLLBACK'); return res.status(e.code === 'OUT_OF_SCOPE' ? 409 : 400).json(e.code ? perms.OUT_OF_SCOPE : { error: e.error }); }
    await client.query(
      `UPDATE expense_drafts SET status = 'accepted', expense_id = $2, reviewed_by = $3, reviewed_at = now()
        WHERE id = $1`, [dr.id, e.expense.id, actor]);
    await client.query('COMMIT');
    const row = await pool.query(`${DRAFT_SELECT} AND d.id = $2`, [req.organizer_id, dr.id]);
    res.status(201).json({ draft: row.rows[0], expense: e.expense, ledger_entry_id: e.ledger_entry_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'accept');
  } finally {
    client.release();
  }
});

// Ret: yalnız durum + kim/ne zaman; satır silinmez, ledger'a dokunulmaz.
router.post('/:id/reject', perms.requirePermission('expense_drafts.approve'), async (req, res) => {
  if (!isIntLike(req.params.id)) return res.status(404).json({ error: 'Draft not found' });
  try {
    const r = await pool.query(
      `UPDATE expense_drafts SET status = 'rejected', reviewed_by = $3, reviewed_at = now()
        WHERE id = $1 AND organizer_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.organizer_id, ledger.requestUserId(req)]);
    if (!r.rows.length) {
      const x = await pool.query('SELECT status FROM expense_drafts WHERE id = $1 AND organizer_id = $2', [req.params.id, req.organizer_id]);
      if (!x.rows.length) return res.status(404).json({ error: 'Draft not found' });
      return res.status(409).json({ error: `Draft is already ${x.rows[0].status}.` });
    }
    const row = await pool.query(`${DRAFT_SELECT} AND d.id = $2`, [req.organizer_id, r.rows[0].id]);
    res.json({ draft: row.rows[0] });
  } catch (err) { return fail(res, err, 'reject'); }
});

module.exports = router;
