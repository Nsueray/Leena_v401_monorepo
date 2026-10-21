// ----------------------------------------------------------------------------
// routes/ledger.js — LEDGER (Paket 1: L-1…L-6). Mount: /api/ledger (index.js)
//   GET  /currencies                    → para birimleri (LED-02; arayüz listeleri — SEM-02)
//   POST /currencies                    → para birimi ekle
//   GET  /reference                     → gider kategorileri+tipleri · gelir kategorileri
//   POST /expense-categories | /expense-types | /income-categories   → ekle
//   PUT  /reference/:kind/:id           → ad / is_active (silme YOK — pasifleme)
//   GET  /accounts                      → hesaplar + TÜRETİLMİŞ bakiye (D2)
//   POST /accounts · PUT /accounts/:id  → hesap aç / ad·aktiflik·ofis varsayılanı·not
//   GET  /accounts/:id/statement        → ekstre: açılış, hareketler + yürüyen bakiye, kapanış
//   POST /transfers · GET /transfers · POST /transfers/:id/reverse      (L-2, LED-06)
//   POST /expenses  · GET /expenses  · POST /expenses/:id/reverse       (L-3, LED-08)
//   GET  /budgets/:expoId · POST /budgets/:expoId · POST /budgets/:expoId/lock   (L-5, LED-09)
//   GET  /summary                       → nakit / alacak / komisyon / owner cari (L-6, RAP-01)
//   GET  /suppliers · GET /suppliers/options · POST /suppliers · PUT /suppliers/:id
//   GET  /suppliers/:id/history         → tedarikçi ödeme geçmişi, ledger'dan türetilir (P1b-1)
//
// ── HÜKÜMLER ──
// - Bakiye SAKLANMAZ (D2): her okuma `ledger_lines` view'inden türetir (039, tek türetme yeri).
// - Değişmezlik (LED-05/06/08): UPDATE/DELETE endpoint'i YOK; düzeltme = ters kayıt.
// - Kur girişte donar (RAP-01): amount_eur = round2(amount × exchange_rate), sunucu otoritesi.
// - Organizer scope her sorguda; yeni tablolar bileşik FK ile kiracıya kilitli (036).
// - Rol gate YOK (Faz 4): "kim girebilir" yetki matrisi işidir (LED-08/09). İSTİSNA: bütçe
//   kilidi Owner'a özgüdür (LED-09) → users.is_owner (ui2 oturumu gerekir).
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { SLICE_CTES } = require('../utils/commissionSlices');
const ledger = require('../utils/ledger');
const { round2, isValidDate, trimOrNull, isIntLike, parseMoney, activeAccount, expoOfOrganizer } = ledger;

const ACCOUNT_TYPES = ['bank', 'cash', 'virtual'];                                // LED-03

// Deploy → migration arası (42P01): ödeme formunun para birimi listesi BOŞ kalmasın diye
// eski arayüz listesi (contract-detail.html:228 eski hali) döner. 040 her yerde uygulanınca
// bu satır silinir (SEM-02 sayacı: arayüzde 0 kopya, burada 1 geçici yedek).
const PRE_MIGRATION_CURRENCIES = ['EUR', 'USD', 'TRY', 'MAD', 'NGN', 'KES'];

// 23505 / 23503 / 23514 → anlamlı HTTP (contracts.js mapWriteError deseni)
function mapWriteError(err) {
  if (err.code === '23505') {
    if (err.constraint === 'uq_accounts_office_default') {
      return { status: 409, body: { error: 'This office already has a default account in this currency.' } };
    }
    if (err.constraint === 'accounts_org_name_key') {
      return { status: 409, body: { error: 'An account with this name already exists.' } };
    }
    if (/_reverses$/.test(err.constraint || '')) {
      return { status: 409, body: { error: 'Already reversed.' } };
    }
    if (err.constraint === 'uq_expo_budgets_active' || err.constraint === 'expo_budgets_expo_revision_key') {
      return { status: 409, body: { error: 'The budget changed meanwhile — reload and try again.' } };
    }
    if (err.constraint === 'uq_suppliers_org_name_country') {
      return { status: 409, body: { error: 'A supplier with this name already exists in this country.' } };
    }
    return { status: 409, body: { error: 'Duplicate value violates a unique constraint.' } };
  }
  if (err.code === '23503') return { status: 400, body: { error: 'Referenced record does not exist.' } };
  if (err.code === '23514') return { status: 400, body: { error: 'A value violates a database check constraint.' } };
  return null;
}
function fail(res, err, what) {
  const m = mapWriteError(err);
  if (m) return res.status(m.status).json(m.body);
  console.error(`Ledger ${what} failed:`, err);
  return res.status(500).json({ error: `Failed to ${what}.` });
}

// Ledger dışında kalan tahsilat / payout sayacı (RAP-02 — dışlanan sessizce kaybolmaz).
// officeId verilirse o ofisin satırları ayrıca sayılır (ekstrede bağlam).
async function notInLedger(db, organizerId, officeId = null) {
  const r = await db.query(
    `SELECT
       (SELECT count(*)::int FROM payments p
         WHERE p.organizer_id = $1 AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id)) AS payments_count,
       (SELECT COALESCE(SUM(p.amount_eur), 0)::numeric(14,2) FROM payments p
         WHERE p.organizer_id = $1 AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id)) AS payments_eur,
       (SELECT count(*)::int FROM commission_payouts cp
         WHERE cp.organizer_id = $1 AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payout_id = cp.id)) AS payouts_count,
       (SELECT COALESCE(SUM(cp.amount_eur), 0)::numeric(14,2) FROM commission_payouts cp
         WHERE cp.organizer_id = $1 AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payout_id = cp.id)) AS payouts_eur,
       (SELECT count(*)::int FROM payments p
         WHERE p.organizer_id = $1 AND $2::int IS NOT NULL AND p.received_office_id = $2
           AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id)) AS office_payments_count,
       (SELECT COALESCE(SUM(p.amount_eur), 0)::numeric(14,2) FROM payments p
         WHERE p.organizer_id = $1 AND $2::int IS NOT NULL AND p.received_office_id = $2
           AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id)) AS office_payments_eur`,
    [organizerId, officeId]);
  return r.rows[0];
}

// Tüm uçlar korumalı (authMiddleware deseni; 401/403 sözleşmesi aynı).
router.use(authMiddleware);

// ============================================================================
// PARA BİRİMLERİ (LED-02)
// ============================================================================
router.get('/currencies', async (req, res) => {
  const all = req.query.include_inactive === '1';
  try {
    const r = await pool.query(
      `SELECT code, is_active FROM currencies WHERE organizer_id = $1 ${all ? '' : 'AND is_active'}
        ORDER BY (code = 'EUR') DESC, code`,
      [req.organizer_id]);
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') {   // tablo yok = 036 henüz uygulanmadı
      return res.json(PRE_MIGRATION_CURRENCIES.map(code => ({ code, is_active: true, pre_migration: true })));
    }
    console.error('Error fetching currencies:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/currencies', async (req, res) => {
  const code = trimOrNull(req.body && req.body.code);
  if (!code || !/^[A-Za-z]{3}$/.test(code)) return res.status(400).json({ error: 'code must be a 3-letter ISO code.' });
  try {
    const r = await pool.query(
      `INSERT INTO currencies (organizer_id, code) VALUES ($1, $2)
       ON CONFLICT (organizer_id, code) DO UPDATE SET is_active = true
       RETURNING code, is_active`,
      [req.organizer_id, code.toUpperCase()]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'add currency'); }
});

// Migration öncesi (deploy → 036-040 arası) para birimi DIŞINDAKİ uçlar 503 döner —
// 500 yerine anlamlı yanıt; ödeme/payout akışı bu kapıdan geçmez (contracts.js / payouts.js).
router.use(async (req, res, next) => {
  try {
    if (await ledger.ledgerSchemaReady(pool)) return next();
    return res.status(503).json({ error: 'Ledger is not migrated yet (run scripts/migrate.js).' });
  } catch (err) { return next(err); }
});

// ============================================================================
// REFERANS VERİ — gider kategorisi → tip · gelir kategorisi
// ============================================================================
router.get('/reference', async (req, res) => {
  try {
    const cats = await pool.query(
      'SELECT id, name, is_active FROM expense_categories WHERE organizer_id = $1 ORDER BY id', [req.organizer_id]);
    const types = await pool.query(
      'SELECT id, category_id, name, is_active FROM expense_types WHERE organizer_id = $1 ORDER BY name', [req.organizer_id]);
    const inc = await pool.query(
      'SELECT id, name, is_active FROM income_categories WHERE organizer_id = $1 ORDER BY id', [req.organizer_id]);
    res.json({
      expense_categories: cats.rows.map(c => ({ ...c, types: types.rows.filter(t => t.category_id === c.id) })),
      income_categories: inc.rows,
    });
  } catch (err) {
    console.error('Error fetching ledger reference:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/expense-categories', async (req, res) => {
  const name = trimOrNull(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'name is required.' });
  try {
    const r = await pool.query(
      'INSERT INTO expense_categories (organizer_id, name) VALUES ($1, $2) RETURNING id, name, is_active',
      [req.organizer_id, name]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'add expense category'); }
});

router.post('/expense-types', async (req, res) => {
  const b = req.body || {};
  const name = trimOrNull(b.name);
  if (!name) return res.status(400).json({ error: 'name is required.' });
  if (!isIntLike(b.category_id)) return res.status(400).json({ error: 'category_id is required.' });
  try {
    const r = await pool.query(
      `INSERT INTO expense_types (organizer_id, category_id, name) VALUES ($1, $2, $3)
       RETURNING id, category_id, name, is_active`,
      [req.organizer_id, b.category_id, name]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'add expense type'); }
});

router.post('/income-categories', async (req, res) => {
  const name = trimOrNull(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'name is required.' });
  try {
    const r = await pool.query(
      'INSERT INTO income_categories (organizer_id, name) VALUES ($1, $2) RETURNING id, name, is_active',
      [req.organizer_id, name]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'add income category'); }
});

// Silme YOK (REQ:1728 "deactivation, not deletion"): yalnız ad / is_active.
const REF_TABLES = { 'expense-categories': 'expense_categories', 'expense-types': 'expense_types', 'income-categories': 'income_categories' };
router.put('/reference/:kind/:id', async (req, res) => {
  const table = REF_TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: 'Unknown reference kind.' });
  const b = req.body || {};
  const name = b.name === undefined ? undefined : trimOrNull(b.name);
  if (name === null) return res.status(400).json({ error: 'name cannot be empty.' });
  if (b.is_active !== undefined && typeof b.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean.' });
  try {
    const r = await pool.query(
      `UPDATE ${table} SET name = COALESCE($3, name), is_active = COALESCE($4, is_active)
        WHERE id = $1 AND organizer_id = $2 RETURNING *`,
      [req.params.id, req.organizer_id, name === undefined ? null : name, b.is_active === undefined ? null : b.is_active]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { return fail(res, err, 'update reference data'); }
});

// ============================================================================
// HESAPLAR (L-1) — bakiye türetilir
// ============================================================================
const ACCOUNT_LIST_SQL = `
  SELECT a.id, a.name, a.account_type, a.currency, a.office_id, o.name AS office_name,
         a.person_id, COALESCE(u.display_name, u.email) AS person_name, u.is_owner AS person_is_owner,
         a.is_office_default, a.is_active, a.notes, a.created_at,
         COALESCE(b.balance, 0)::numeric(14,2)     AS balance,
         COALESCE(b.balance_eur, 0)::numeric(14,2) AS balance_eur,
         COALESCE(b.n, 0)::int AS entry_count, b.last_entry_date
    FROM accounts a
    LEFT JOIN offices o ON o.id = a.office_id
    LEFT JOIN users u   ON u.id = a.person_id
    LEFT JOIN LATERAL (
      SELECT SUM(l.signed_amount) AS balance, SUM(l.signed_amount_eur) AS balance_eur,
             count(*) AS n, max(l.entry_date) AS last_entry_date
        FROM ledger_lines l WHERE l.account_id = a.id
    ) b ON TRUE
   WHERE a.organizer_id = $1`;

router.get('/accounts', async (req, res) => {
  const all = req.query.include_inactive === '1';
  try {
    const r = await pool.query(
      `${ACCOUNT_LIST_SQL} ${all ? '' : 'AND a.is_active'}
       ORDER BY a.is_active DESC, CASE a.account_type WHEN 'bank' THEN 1 WHEN 'cash' THEN 2 ELSE 3 END, a.name`,
      [req.organizer_id]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching accounts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/accounts', async (req, res) => {
  const b = req.body || {};
  const name = trimOrNull(b.name);
  if (!name) return res.status(400).json({ error: 'name is required.' });
  if (!ACCOUNT_TYPES.includes(b.account_type)) {
    return res.status(400).json({ error: `account_type must be one of: ${ACCOUNT_TYPES.join(', ')}` });
  }
  const currency = trimOrNull(b.currency);
  if (!currency || !/^[A-Za-z]{3}$/.test(currency)) return res.status(400).json({ error: 'currency is required (3-letter code).' });
  const office_id = isIntLike(b.office_id) ? Number(b.office_id) : null;
  if (b.office_id != null && b.office_id !== '' && office_id == null) return res.status(400).json({ error: 'invalid office' });
  const is_office_default = b.is_office_default === true;
  // LED-07: owner cari hesabı → person_id = istekteki Owner değil, açıkça verilen kullanıcı.
  // UI yalnız "Owner current account" seçeneğiyle Owner'ın id'sini gönderir.
  const person_id = trimOrNull(b.person_id);
  if (person_id && b.account_type !== 'virtual') return res.status(400).json({ error: 'only a virtual account can belong to a person.' });
  if (is_office_default && (office_id == null || b.account_type === 'virtual')) {
    return res.status(400).json({ error: 'an office default account needs an office and must be bank or cash.' });
  }
  try {
    const cur = await pool.query(
      'SELECT 1 FROM currencies WHERE organizer_id = $1 AND code = $2 AND is_active', [req.organizer_id, currency.toUpperCase()]);
    if (!cur.rows.length) return res.status(400).json({ error: 'unknown or inactive currency' });
    if (office_id != null) {
      const off = await pool.query('SELECT 1 FROM offices WHERE id = $1 AND is_active', [office_id]);
      if (!off.rows.length) return res.status(400).json({ error: 'invalid office' });
    }
    if (person_id) {
      const pu = await pool.query('SELECT 1 FROM users WHERE id::text = $1 AND organizer_id = $2', [person_id, req.organizer_id]);
      if (!pu.rows.length) return res.status(400).json({ error: 'invalid person' });
    }
    const r = await pool.query(
      `INSERT INTO accounts (organizer_id, name, account_type, currency, office_id, person_id,
                             is_office_default, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.organizer_id, name, b.account_type, currency.toUpperCase(), office_id, person_id,
       is_office_default, trimOrNull(b.notes), ledger.requestUserId(req)]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'create account'); }
});

// Kimlik alanları (para birimi / tür / ofis / kişi) DEĞİŞMEZ — yeni hesap açılır (036 trigger'ı da reddeder).
router.put('/accounts/:id', async (req, res) => {
  const b = req.body || {};
  for (const k of ['currency', 'account_type', 'office_id', 'person_id']) {
    if (b[k] !== undefined) return res.status(400).json({ error: `${k} cannot change — open a new account instead.` });
  }
  const name = b.name === undefined ? undefined : trimOrNull(b.name);
  if (name === null) return res.status(400).json({ error: 'name cannot be empty.' });
  for (const k of ['is_active', 'is_office_default']) {
    if (b[k] !== undefined && typeof b[k] !== 'boolean') return res.status(400).json({ error: `${k} must be boolean.` });
  }
  try {
    const r = await pool.query(
      `UPDATE accounts SET name = COALESCE($3, name), is_active = COALESCE($4, is_active),
              is_office_default = COALESCE($5, is_office_default),
              notes = CASE WHEN $6::boolean THEN $7 ELSE notes END
        WHERE id = $1 AND organizer_id = $2 RETURNING *`,
      [req.params.id, req.organizer_id, name === undefined ? null : name,
       b.is_active === undefined ? null : b.is_active,
       b.is_office_default === undefined ? null : b.is_office_default,
       b.notes !== undefined, trimOrNull(b.notes)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Account not found' });
    res.json(r.rows[0]);
  } catch (err) { return fail(res, err, 'update account'); }
});

// ── Ekstre: tek sıralı akış + yürüyen bakiye (R12), tarih filtresi ─────────
router.get('/accounts/:id/statement', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
  }
  try {
    const acc = await pool.query(`${ACCOUNT_LIST_SQL} AND a.id = $2`, [req.organizer_id, req.params.id]);
    if (!acc.rows.length) return res.status(404).json({ error: 'Account not found' });
    const account = acc.rows[0];
    // P1b-1: gider satırında tedarikçi adı (041 sonrası; öncesinde kolon yok → NULL).
    const sup = await ledger.featureReady(pool, 'suppliers');
    const supCol = sup ? 'sp.id AS supplier_id, sp.name AS supplier_name' : 'NULL::int AS supplier_id, NULL::text AS supplier_name';
    const supJoin = sup ? `LEFT JOIN expenses xe ON xe.id = l.expense_id
         LEFT JOIN suppliers sp          ON sp.id = xe.supplier_id` : '';

    // Yürüyen bakiye TÜM geçmiş üzerinden pencerelenir, sonra tarih süzülür → açılış dahil.
    const lines = await pool.query(
      `WITH l AS (
         SELECT l.*,
                SUM(l.signed_amount)     OVER w AS running_balance,
                SUM(l.signed_amount_eur) OVER w AS running_balance_eur
           FROM ledger_lines l
          WHERE l.organizer_id = $1 AND l.account_id = $2
         WINDOW w AS (ORDER BY l.entry_date, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
       )
       SELECT l.id, to_char(l.entry_date, 'YYYY-MM-DD') AS entry_date, l.entry_type, l.direction,
              l.amount, l.currency, l.exchange_rate, l.amount_eur, l.signed_amount, l.signed_amount_eur,
              l.running_balance::numeric(14,2) AS running_balance,
              l.running_balance_eur::numeric(14,2) AS running_balance_eur,
              l.reverses_entry_id, (SELECT r.id FROM ledger_entries r WHERE r.reverses_entry_id = l.id) AS reversed_by_entry_id,
              l.payment_id, l.contract_id, l.af_number, l.company_name, l.payer,
              l.payout_id, sa.name AS agent_name,
              l.expense_id, et.name AS expense_type, ec.name AS expense_category, l.counterparty, ${supCol},
              l.transfer_id, oa.name AS counter_account_name,
              ex.name AS expo_name, l.notes
         FROM l
         LEFT JOIN sales_agents sa       ON sa.id = l.sales_agent_id
         LEFT JOIN expense_types et      ON et.id = l.expense_type_id
         LEFT JOIN expense_categories ec ON ec.id = et.category_id
         LEFT JOIN expos ex              ON ex.id = l.expo_id
         LEFT JOIN ledger_entries ol     ON ol.transfer_id = l.transfer_id AND ol.id <> l.id
         LEFT JOIN accounts oa           ON oa.id = ol.account_id
         ${supJoin}
        WHERE ($3::date IS NULL OR l.entry_date >= $3) AND ($4::date IS NULL OR l.entry_date <= $4)
        ORDER BY l.entry_date, l.id`,
      [req.organizer_id, req.params.id, from, to]);

    const tot = await pool.query(
      `SELECT
         COALESCE(SUM(signed_amount)     FILTER (WHERE $3::date IS NOT NULL AND entry_date < $3), 0)::numeric(14,2) AS opening,
         COALESCE(SUM(signed_amount_eur) FILTER (WHERE $3::date IS NOT NULL AND entry_date < $3), 0)::numeric(14,2) AS opening_eur,
         COALESCE(SUM(amount)     FILTER (WHERE direction = 'in'  AND ($3::date IS NULL OR entry_date >= $3) AND ($4::date IS NULL OR entry_date <= $4)), 0)::numeric(14,2) AS total_in,
         COALESCE(SUM(amount)     FILTER (WHERE direction = 'out' AND ($3::date IS NULL OR entry_date >= $3) AND ($4::date IS NULL OR entry_date <= $4)), 0)::numeric(14,2) AS total_out,
         COALESCE(SUM(signed_amount)     FILTER (WHERE $4::date IS NULL OR entry_date <= $4), 0)::numeric(14,2) AS closing,
         COALESCE(SUM(signed_amount_eur) FILTER (WHERE $4::date IS NULL OR entry_date <= $4), 0)::numeric(14,2) AS closing_eur
         FROM ledger_lines WHERE organizer_id = $1 AND account_id = $2`,
      [req.organizer_id, req.params.id, from, to]);

    res.json({
      account,
      from, to,
      ...tot.rows[0],
      lines: lines.rows,
      not_in_ledger: await notInLedger(pool, req.organizer_id, account.office_id),
    });
  } catch (err) {
    console.error('Error building account statement:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// TRANSFERLER (L-2, LED-06) — tek olay + iki bacak, tek transaction
// ============================================================================
// Body: from_account_id, to_account_id, transfer_date, amount, exchange_rate,
//       amount_in? + exchange_rate_in? (YALNIZ para birimleri farklıysa zorunlu), notes?, expo_id?
// Aynı para birimi: bacaklar eşit (masraf ayrı gider — LED-11 önerisi).
router.post('/transfers', async (req, res) => {
  const b = req.body || {};
  if (!isValidDate(b.transfer_date)) return res.status(400).json({ error: 'transfer_date is required and must be a valid YYYY-MM-DD date.' });
  if (!isIntLike(b.from_account_id) || !isIntLike(b.to_account_id)) return res.status(400).json({ error: 'from_account_id and to_account_id are required.' });
  if (String(b.from_account_id) === String(b.to_account_id)) return res.status(400).json({ error: 'from and to accounts must differ.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const from = await activeAccount(client, req.organizer_id, b.from_account_id);
    const to = await activeAccount(client, req.organizer_id, b.to_account_id);
    if (!from || !to) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid account' }); }
    if (!from.is_active || !to.is_active) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'account is inactive' }); }

    const out = parseMoney(b, { currency: from.currency });
    if (out.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: out.error }); }
    let inn;
    if (from.currency === to.currency) {
      // Tek tutar, tek kur. Gönderilmişse eşit olmalı (sessiz düzeltme yok).
      if (b.amount_in != null && b.amount_in !== '' && Number(b.amount_in) !== out.amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'same-currency transfer: amount_in must equal amount (record fees as an expense).' });
      }
      inn = out;
    } else {
      inn = parseMoney(b, { amountKey: 'amount_in', rateKey: 'exchange_rate_in', currency: to.currency });
      if (inn.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: `cross-currency transfer: ${inn.error}` }); }
    }
    let expo = null;
    if (b.expo_id != null && b.expo_id !== '') {
      expo = await expoOfOrganizer(client, req.organizer_id, b.expo_id);
      if (!expo) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid expo' }); }
    }
    const actor = ledger.requestUserId(req);
    const t = await client.query(
      `INSERT INTO transfers (organizer_id, transfer_date, notes, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.organizer_id, b.transfer_date, trimOrNull(b.notes), actor]);
    const legSql = `INSERT INTO ledger_entries (organizer_id, account_id, direction, entry_type, entry_date,
                      amount, currency, exchange_rate, amount_eur, expo_id, transfer_id, created_by)
                    VALUES ($1,$2,$3,'transfer',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`;
    const legOut = await client.query(legSql, [req.organizer_id, from.id, 'out', b.transfer_date,
      out.amount, from.currency, out.rate, out.amount_eur, expo ? expo.id : null, t.rows[0].id, actor]);
    const legIn = await client.query(legSql, [req.organizer_id, to.id, 'in', b.transfer_date,
      inn.amount, to.currency, inn.rate, inn.amount_eur, expo ? expo.id : null, t.rows[0].id, actor]);
    await client.query('COMMIT');   // DEFERRED iki-bacak denetimi burada koşar
    res.status(201).json({ transfer: t.rows[0], out_entry_id: legOut.rows[0].id, in_entry_id: legIn.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'create transfer');
  } finally {
    client.release();
  }
});

router.get('/transfers', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  try {
    const r = await pool.query(
      `SELECT t.id, to_char(t.transfer_date, 'YYYY-MM-DD') AS transfer_date, t.notes, t.reverses_transfer_id,
              (SELECT x.id FROM transfers x WHERE x.reverses_transfer_id = t.id) AS reversed_by_transfer_id,
              o.account_id AS from_account_id, ao.name AS from_account, o.amount AS amount_out, o.currency AS currency_out,
              o.exchange_rate AS rate_out, o.amount_eur AS eur_out,
              i.account_id AS to_account_id, ai.name AS to_account, i.amount AS amount_in, i.currency AS currency_in,
              i.exchange_rate AS rate_in, i.amount_eur AS eur_in, ex.name AS expo_name
         FROM transfers t
         JOIN ledger_entries o ON o.transfer_id = t.id AND o.direction = 'out'
         JOIN ledger_entries i ON i.transfer_id = t.id AND i.direction = 'in'
         JOIN accounts ao ON ao.id = o.account_id
         JOIN accounts ai ON ai.id = i.account_id
         LEFT JOIN expos ex ON ex.id = o.expo_id
        WHERE t.organizer_id = $1
        ORDER BY t.transfer_date DESC, t.id DESC
        LIMIT $2`,
      [req.organizer_id, limit]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching transfers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ters transfer: yeni olay + iki bacak, her bacak orijinali AYNEN tersler (tutar/kur/EUR
// kopya — yeniden hesap yok, 018 gerekçesi). Tarih = bugün (ödeme reversal emsali).
router.post('/transfers/:id/reverse', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query('SELECT * FROM transfers WHERE id = $1 AND organizer_id = $2', [req.params.id, req.organizer_id]);
    if (!t.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transfer not found' }); }
    if (t.rows[0].reverses_transfer_id != null) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot reverse a reversal.' }); }
    const already = await client.query('SELECT 1 FROM transfers WHERE reverses_transfer_id = $1', [t.rows[0].id]);
    if (already.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Transfer already reversed.' }); }
    const actor = ledger.requestUserId(req);
    const rt = await client.query(
      `INSERT INTO transfers (organizer_id, transfer_date, notes, reverses_transfer_id, created_by)
       VALUES ($1, CURRENT_DATE, $2, $3, $4) RETURNING *`,
      [req.organizer_id, `Reversal of transfer #${t.rows[0].id}`, t.rows[0].id, actor]);
    await client.query(
      `INSERT INTO ledger_entries (organizer_id, account_id, direction, entry_type, entry_date,
                                   amount, currency, exchange_rate, amount_eur, expo_id,
                                   transfer_id, reverses_entry_id, created_by)
       SELECT organizer_id, account_id, CASE direction WHEN 'in' THEN 'out' ELSE 'in' END, 'transfer', CURRENT_DATE,
              amount, currency, exchange_rate, amount_eur, expo_id, $2, id, $3
         FROM ledger_entries WHERE transfer_id = $1 ORDER BY id`,
      [t.rows[0].id, rt.rows[0].id, actor]);
    await client.query('COMMIT');
    res.status(201).json({ transfer: rt.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'reverse transfer');
  } finally {
    client.release();
  }
});

// ============================================================================
// GİDERLER (L-3, LED-08) — onaysız, değişmez; her gider → hareket (çıkış)
// ============================================================================
// Doğrulama + yazım utils/ledger.js createExpense'te (taslak kabulü de AYNI yolu çağırır).
// counterparty metni API'de kabul edilmeye devam eder (mevcut davranış); ui2 formu artık
// tedarikçi SEÇTİRİR (Suer ilkesi), serbest metin göndermez.
router.post('/expenses', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await ledger.createExpense(client, {
      organizerId: req.organizer_id, body: req.body, actor: ledger.requestUserId(req) });
    if (r.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: r.error }); }
    await client.query('COMMIT');
    res.status(201).json({ expense: r.expense, ledger_entry_id: r.ledger_entry_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'create expense');
  } finally {
    client.release();
  }
});

router.get('/expenses', async (req, res) => {
  const { expo_id, from, to } = req.query;
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
  try {
    // P1b-1: tedarikçi kolonları ve süzgeci yalnız 041 uygulandıysa (öncesinde yanıt Paket 1 şeklinde).
    const sup = await ledger.featureReady(pool, 'suppliers');
    const r = await pool.query(
      `SELECT e.id, to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.amount, e.currency, e.exchange_rate, e.amount_eur,
              e.payment_method, e.counterparty, e.notes, e.document_url, e.reverses_expense_id,
              (SELECT x.id FROM expenses x WHERE x.reverses_expense_id = e.id) AS reversed_by_expense_id,
              e.expense_type_id, t.name AS expense_type, c.id AS category_id, c.name AS category,
              e.account_id, a.name AS account_name, e.expo_id, ex.name AS expo_name
              ${sup ? ', e.supplier_id, s.name AS supplier_name' : ''}
         FROM expenses e
         JOIN expense_types t      ON t.id = e.expense_type_id
         JOIN expense_categories c ON c.id = t.category_id
         JOIN accounts a           ON a.id = e.account_id
         LEFT JOIN expos ex        ON ex.id = e.expo_id
         ${sup ? 'LEFT JOIN suppliers s ON s.id = e.supplier_id' : ''}
        WHERE e.organizer_id = $1
          AND ($2::int IS NULL OR e.expo_id = $2)
          AND ($3::date IS NULL OR e.expense_date >= $3) AND ($4::date IS NULL OR e.expense_date <= $4)
          ${sup ? 'AND ($6::int IS NULL OR e.supplier_id = $6)' : ''}
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT $5`,
      [req.organizer_id, isIntLike(expo_id) ? Number(expo_id) : null, from || null, to || null, limit]
        .concat(sup ? [isIntLike(req.query.supplier_id) ? Number(req.query.supplier_id) : null] : []));
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ters gider: negatif kopya (tutar/kur/EUR SQL'de işaret çevrimi — 018 gerekçesi), bugün;
// hareket aynı hesaba giriş olarak, orijinal hareketi tersler.
router.post('/expenses/:id/reverse', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = await client.query('SELECT * FROM expenses WHERE id = $1 AND organizer_id = $2', [req.params.id, req.organizer_id]);
    if (!o.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Expense not found' }); }
    if (o.rows[0].reverses_expense_id != null) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot reverse a reversal.' }); }
    const already = await client.query('SELECT 1 FROM expenses WHERE reverses_expense_id = $1', [o.rows[0].id]);
    if (already.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Expense already reversed.' }); }
    const actor = ledger.requestUserId(req);
    // Tedarikçi de devralınır (041 sonrası) → tedarikçi geçmişinde gider + tersi net sıfır.
    const sup = (await ledger.featureReady(client, 'suppliers')) ? ', supplier_id' : '';
    const r = await client.query(
      `INSERT INTO expenses (organizer_id, expense_type_id, amount, currency, exchange_rate, amount_eur,
                             account_id, expo_id, counterparty, expense_date, payment_method, notes,
                             document_url, reverses_expense_id, created_by${sup})
       SELECT organizer_id, expense_type_id, -amount, currency, exchange_rate, -amount_eur,
              account_id, expo_id, counterparty, CURRENT_DATE, payment_method, $2,
              document_url, id, $3${sup}
         FROM expenses WHERE id = $1 RETURNING *`,
      [o.rows[0].id, `Reversal of expense #${o.rows[0].id}`, actor]);
    const origEntry = await ledger.findSourceEntry(client, 'expense', o.rows[0].id);
    const entryId = await ledger.insertSourceEntry(client, {
      organizerId: req.organizer_id, accountId: origEntry.account_id, kind: 'expense',
      sourceId: r.rows[0].id, direction: 'in', entryDate: null, reversesEntryId: origEntry.id, createdBy: actor,
    });
    await client.query('COMMIT');
    res.status(201).json({ expense: r.rows[0], ledger_entry_id: entryId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'reverse expense');
  } finally {
    client.release();
  }
});

// ============================================================================
// TEDARİKÇİLER (P1b-1) — para karşı tarafı kaydı; silinmez, pasiflenir; geçmiş TÜRETİLİR (D2)
// ============================================================================
// 041 uygulanmadıysa (deploy → migrate arası) bu uçlar 503 — gider akışı tedarikçisiz sürer.
async function needSuppliers(req, res, next) {
  try {
    if (await ledger.featureReady(pool, 'suppliers')) return next();
    return res.status(503).json({ error: 'Suppliers are not migrated yet (run scripts/migrate.js).' });
  } catch (err) { return next(err); }
}

// Gövde doğrulaması. partial = PUT (yalnız gönderilen alanlar). Döner { fields } | { error }.
async function supplierFields(db, b, partial) {
  const f = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has('name')) {
    f.name = trimOrNull(b.name);
    if (!f.name) return { error: 'name is required.' };
  }
  if (!partial || has('supplier_type')) {
    if (!ledger.SUPPLIER_TYPES.includes(b.supplier_type)) {
      return { error: `supplier_type must be one of: ${ledger.SUPPLIER_TYPES.join(', ')}` };
    }
    f.supplier_type = b.supplier_type;
  }
  if (!partial || has('country_code')) {
    const cc = trimOrNull(b.country_code);
    if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return { error: 'country_code is required (2-letter code).' };
    const c = await db.query('SELECT 1 FROM core_countries WHERE code = $1', [cc.toUpperCase()]);
    if (!c.rows.length) return { error: 'unknown country' };
    f.country_code = cc.toUpperCase();
  }
  if (has('office_id')) {
    if (b.office_id == null || b.office_id === '') f.office_id = null;
    else {
      if (!isIntLike(b.office_id)) return { error: 'invalid office' };
      const o = await db.query('SELECT 1 FROM offices WHERE id = $1 AND is_active', [b.office_id]);
      if (!o.rows.length) return { error: 'invalid office' };
      f.office_id = Number(b.office_id);
    }
  }
  if (has('tax_number')) f.tax_number = trimOrNull(b.tax_number);
  if (has('notes')) f.notes = trimOrNull(b.notes);
  if (partial && has('is_active')) {
    if (typeof b.is_active !== 'boolean') return { error: 'is_active must be boolean.' };
    f.is_active = b.is_active;
  }
  return { fields: f };
}

const SUPPLIER_LIST_SQL = `
  SELECT s.id, s.name, s.supplier_type, s.country_code, cc.name AS country_name,
         s.office_id, o.name AS office_name, s.tax_number, s.notes, s.is_active, s.created_at,
         COALESCE(h.n, 0)::int AS expense_count,
         COALESCE(h.paid_eur, 0)::numeric(14,2) AS paid_eur,
         to_char(h.last_date, 'YYYY-MM-DD') AS last_expense_date
    FROM suppliers s
    JOIN core_countries cc ON cc.code = s.country_code
    LEFT JOIN offices o    ON o.id = s.office_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE l.reverses_entry_id IS NULL) AS n,
             -SUM(l.signed_amount_eur) AS paid_eur, max(l.entry_date) AS last_date
        FROM ledger_lines l JOIN expenses e ON e.id = l.expense_id
       WHERE e.supplier_id = s.id
    ) h ON TRUE
   WHERE s.organizer_id = $1`;

router.get('/suppliers/options', needSuppliers, async (req, res) => {
  try {
    const c = await pool.query('SELECT code, name FROM core_countries ORDER BY name');
    res.json({ types: ledger.SUPPLIER_TYPES, countries: c.rows });
  } catch (err) {
    console.error('Error fetching supplier options:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ?q= → ad benzerliğine göre sıralı (score) — taslak eşleşmesiyle AYNI fonksiyon.
router.get('/suppliers', needSuppliers, async (req, res) => {
  const all = req.query.include_inactive === '1';
  const q = trimOrNull(req.query.q);
  try {
    const r = await pool.query(`${SUPPLIER_LIST_SQL} ${all ? '' : 'AND s.is_active'}
      ORDER BY s.is_active DESC, lower(s.name), s.country_code`, [req.organizer_id]);
    if (!q) return res.json(r.rows);
    const m = await ledger.matchSuppliers(pool, req.organizer_id, q, { limit: 20, includeInactive: all });
    res.json(m.map(x => ({ ...r.rows.find(s => s.id === x.id), score: x.score })).filter(x => x.id));
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/suppliers', needSuppliers, async (req, res) => {
  try {
    const v = await supplierFields(pool, req.body || {}, false);
    if (v.error) return res.status(400).json({ error: v.error });
    const f = v.fields;
    const r = await pool.query(
      `INSERT INTO suppliers (organizer_id, name, supplier_type, country_code, office_id, tax_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.organizer_id, f.name, f.supplier_type, f.country_code, f.office_id === undefined ? null : f.office_id,
       f.tax_number === undefined ? null : f.tax_number, f.notes === undefined ? null : f.notes, ledger.requestUserId(req)]);
    res.status(201).json(r.rows[0]);
  } catch (err) { return fail(res, err, 'create supplier'); }
});

// Silme YOK (pasifleme). Geçmiş giderler FK ile bağlı kalır; ad düzeltmesi geçmişte de görünür.
router.put('/suppliers/:id', needSuppliers, async (req, res) => {
  if (!isIntLike(req.params.id)) return res.status(404).json({ error: 'Supplier not found' });
  try {
    const v = await supplierFields(pool, req.body || {}, true);
    if (v.error) return res.status(400).json({ error: v.error });
    const keys = Object.keys(v.fields);
    if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
    const r = await pool.query(
      `UPDATE suppliers SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}
        WHERE id = $1 AND organizer_id = $2 RETURNING *`,
      [req.params.id, req.organizer_id, ...keys.map(k => v.fields[k])]);
    if (!r.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    res.json(r.rows[0]);
  } catch (err) { return fail(res, err, 'update supplier'); }
});

// Ödeme geçmişi = o tedarikçinin gider hareketleri (ledger_lines → expenses.supplier_id);
// ters kayıt aynı tedarikçiyle → net. Saklanmaz (D2), tarih aralığı süzgeci.
router.get('/suppliers/:id/history', needSuppliers, async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
  }
  if (!isIntLike(req.params.id)) return res.status(404).json({ error: 'Supplier not found' });
  try {
    const s = await pool.query(`${SUPPLIER_LIST_SQL} AND s.id = $2`, [req.organizer_id, req.params.id]);
    if (!s.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    const lines = await pool.query(
      `SELECT l.id, to_char(l.entry_date, 'YYYY-MM-DD') AS entry_date, l.direction,
              l.amount, l.currency, l.exchange_rate, l.amount_eur, l.signed_amount, l.signed_amount_eur,
              l.reverses_entry_id, (SELECT r.id FROM ledger_entries r WHERE r.reverses_entry_id = l.id) AS reversed_by_entry_id,
              l.expense_id, e.reverses_expense_id, et.name AS expense_type, ec.name AS expense_category,
              l.account_id, a.name AS account_name, ex.name AS expo_name, l.notes, e.document_url
         FROM ledger_lines l
         JOIN expenses e            ON e.id = l.expense_id
         JOIN expense_types et      ON et.id = e.expense_type_id
         JOIN expense_categories ec ON ec.id = et.category_id
         JOIN accounts a            ON a.id = l.account_id
         LEFT JOIN expos ex         ON ex.id = l.expo_id
        WHERE l.organizer_id = $1 AND e.supplier_id = $2
          AND ($3::date IS NULL OR l.entry_date >= $3) AND ($4::date IS NULL OR l.entry_date <= $4)
        ORDER BY l.entry_date, l.id`,
      [req.organizer_id, req.params.id, from, to]);
    const paid = round2(lines.rows.reduce((sum, l) => sum - Number(l.signed_amount_eur), 0));
    res.json({
      supplier: s.rows[0], from, to,
      paid_eur: paid.toFixed(2),                 // aralıkta (EUR, girişte donmuş kurla — RAP-01)
      entries: lines.rows.length,
      lines: lines.rows,
    });
  } catch (err) {
    console.error('Error building supplier history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// EXPO BÜTÇESİ (L-5, LED-09) — revizyon + kilit; gerçekleşen ledger'dan türetilir
// ============================================================================
async function budgetView(db, organizerId, expoId) {
  const hist = await db.query(
    `SELECT b.id, b.revision, b.income_target_eur, b.notes, b.locked_at, b.superseded_at, b.created_at,
            COALESCE(lu.display_name, lu.email) AS locked_by_name, COALESCE(cu.display_name, cu.email) AS created_by_name
       FROM expo_budgets b
       LEFT JOIN users lu ON lu.id = b.locked_by
       LEFT JOIN users cu ON cu.id = b.created_by
      WHERE b.organizer_id = $1 AND b.expo_id = $2
      ORDER BY b.revision DESC`, [organizerId, expoId]);
  const active = hist.rows.find(h => h.superseded_at == null) || null;
  const lines = active ? (await db.query(
    `SELECT l.id, l.category_id, c.name AS category, l.expense_type_id, t.name AS expense_type, l.amount_eur, l.notes
       FROM expo_budget_lines l
       JOIN expense_categories c ON c.id = l.category_id
       LEFT JOIN expense_types t ON t.id = l.expense_type_id
      WHERE l.budget_id = $1
      ORDER BY c.id, t.name NULLS FIRST`, [active.id])).rows : [];

  // Gerçekleşen gider: ledger'daki gider hareketleri (ters kayıtlar netler), expo'ya göre.
  const actual = await db.query(
    `SELECT et.category_id, l.expense_type_id, -SUM(l.signed_amount_eur)::numeric(14,2) AS actual_eur, count(*)::int AS entries
       FROM ledger_lines l JOIN expense_types et ON et.id = l.expense_type_id
      WHERE l.organizer_id = $1 AND l.entry_type = 'expense' AND l.expo_id = $2
      GROUP BY et.category_id, l.expense_type_id`, [organizerId, expoId]);
  // Gelir: tahsilat payments'tan (LED-04) — expo'nun kontratları; ledger'a girmiş kısmı ayrıca.
  const income = await db.query(
    `SELECT COALESCE(SUM(p.amount_eur), 0)::numeric(14,2) AS income_eur,
            COALESCE(SUM(p.amount_eur) FILTER (WHERE le.id IS NOT NULL), 0)::numeric(14,2) AS income_in_ledger_eur,
            count(p.id) FILTER (WHERE le.id IS NULL)::int AS payments_not_in_ledger
       FROM payments p JOIN contracts c ON c.id = p.contract_id
       LEFT JOIN ledger_entries le ON le.payment_id = p.id
      WHERE c.organizer_id = $1 AND c.expo_id = $2`, [organizerId, expoId]);

  // Kategori satırları: bütçe (tip + kategori düzeyi satırların toplamı) vs gerçekleşen.
  const cats = await db.query('SELECT id, name FROM expense_categories WHERE organizer_id = $1 ORDER BY id', [organizerId]);
  const byCat = cats.rows.map(c => {
    const bud = lines.filter(l => l.category_id === c.id).reduce((s, l) => s + Number(l.amount_eur), 0);
    const act = actual.rows.filter(a => a.category_id === c.id).reduce((s, a) => s + Number(a.actual_eur), 0);
    const hasBudget = lines.some(l => l.category_id === c.id);
    return { category_id: c.id, category: c.name, budget_eur: hasBudget ? round2(bud).toFixed(2) : null,
             actual_eur: round2(act).toFixed(2), variance_eur: hasBudget ? round2(bud - act).toFixed(2) : null };
  }).filter(r => r.budget_eur != null || Number(r.actual_eur) !== 0);
  const typeRows = lines.filter(l => l.expense_type_id != null).map(l => {
    const a = actual.rows.find(x => x.expense_type_id === l.expense_type_id);
    const act = a ? Number(a.actual_eur) : 0;
    return { category: l.category, expense_type: l.expense_type, budget_eur: l.amount_eur,
             actual_eur: round2(act).toFixed(2), variance_eur: round2(Number(l.amount_eur) - act).toFixed(2) };
  });
  // RAP-02: bütçe satırı olmayan kategoride gerçekleşen — görünür.
  const unbudgeted = byCat.filter(r => r.budget_eur == null);
  return { active, lines, history: hist.rows, by_category: byCat, by_type: typeRows,
           unbudgeted_actual_eur: round2(unbudgeted.reduce((s, r) => s + Number(r.actual_eur), 0)).toFixed(2),
           income: income.rows[0] };
}

router.get('/budgets/:expoId', async (req, res) => {
  try {
    const expo = await expoOfOrganizer(pool, req.organizer_id, req.params.expoId);
    if (!expo) return res.status(404).json({ error: 'Expo not found' });
    const v = await budgetView(pool, req.organizer_id, expo.id);
    res.json({ expo, ...v, viewer_is_owner: await ledger.requestIsOwner(pool, req) });
  } catch (err) {
    console.error('Error building budget view:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Yeni revizyon (PLN-05): aktif varsa superseded damgalanır. Aktif KİLİTLİYSE yalnız Owner.
// Body: income_target_eur?, notes?, lines: [{ category_id, expense_type_id?, amount_eur, notes? }]
router.post('/budgets/:expoId', async (req, res) => {
  const b = req.body || {};
  const lines = Array.isArray(b.lines) ? b.lines : [];
  let target = null;
  if (b.income_target_eur != null && b.income_target_eur !== '') {
    target = Number(b.income_target_eur);
    if (!isFinite(target) || target < 0) return res.status(400).json({ error: 'income_target_eur must be a number ≥ 0.' });
  }
  for (const l of lines) {
    const a = Number(l && l.amount_eur);
    if (!l || !isIntLike(l.category_id) || l.amount_eur == null || l.amount_eur === '' || !isFinite(a) || a < 0) {
      return res.status(400).json({ error: 'each line needs category_id and amount_eur ≥ 0.' });
    }
    if (l.expense_type_id != null && l.expense_type_id !== '' && !isIntLike(l.expense_type_id)) {
      return res.status(400).json({ error: 'invalid expense_type_id' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expo = await expoOfOrganizer(client, req.organizer_id, req.params.expoId);
    if (!expo) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Expo not found' }); }
    // Aynı expo'ya eşzamanlı iki revizyon: aktif satır kilitlenir (yarış → partial UNIQUE 409).
    const act = await client.query(
      'SELECT id, revision, locked_at FROM expo_budgets WHERE expo_id = $1 AND organizer_id = $2 AND superseded_at IS NULL FOR UPDATE',
      [expo.id, req.organizer_id]);
    const cur = act.rows[0] || null;
    if (cur && cur.locked_at && !(await ledger.requestIsOwner(client, req))) {
      await client.query('ROLLBACK');
      // 403 DEĞİL: leena-fetch 401/403'te oturumu siler (G45, /me 409 emsali) → 409 + kod.
      return res.status(409).json({ error: 'Budget is locked — only the Owner can create a new revision.', code: 'OWNER_REQUIRED' });
    }
    const next = await client.query(
      'SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM expo_budgets WHERE expo_id = $1', [expo.id]);
    if (cur) await client.query('UPDATE expo_budgets SET superseded_at = now() WHERE id = $1', [cur.id]);
    const actor = ledger.requestUserId(req);
    const h = await client.query(
      `INSERT INTO expo_budgets (organizer_id, expo_id, revision, income_target_eur, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.organizer_id, expo.id, next.rows[0].n, target, trimOrNull(b.notes), actor]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO expo_budget_lines (organizer_id, budget_id, category_id, expense_type_id, amount_eur, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.organizer_id, h.rows[0].id, l.category_id,
         (l.expense_type_id == null || l.expense_type_id === '') ? null : l.expense_type_id,
         round2(Number(l.amount_eur)), trimOrNull(l.notes)]);
    }
    await client.query('COMMIT');
    res.status(201).json({ budget: h.rows[0], lines: lines.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'create budget revision');
  } finally {
    client.release();
  }
});

// Kilit: yalnız Owner (LED-09), yalnız aktif + kilitsiz revizyonda; tek yönlü damga.
router.post('/budgets/:expoId/lock', async (req, res) => {
  try {
    if (!(await ledger.requestIsOwner(pool, req))) {
      return res.status(409).json({ error: 'Only the Owner can lock a budget (sign in through ui2).', code: 'OWNER_REQUIRED' });
    }
    const r = await pool.query(
      `UPDATE expo_budgets SET locked_at = now(), locked_by = $3
        WHERE organizer_id = $1 AND expo_id = $2 AND superseded_at IS NULL AND locked_at IS NULL
        RETURNING *`,
      [req.organizer_id, req.params.expoId, ledger.requestUserId(req)]);
    if (!r.rows.length) return res.status(409).json({ error: 'No unlocked active budget revision for this expo.' });
    res.json({ budget: r.rows[0] });
  } catch (err) { return fail(res, err, 'lock budget'); }
});

// ============================================================================
// ÖZET (L-6, R12/R15) — okuma anında, EUR (RAP-01); hiçbir şey saklanmaz (D2)
// ============================================================================
router.get('/summary', async (req, res) => {
  const org = req.organizer_id;
  try {
    const accounts = (await pool.query(`${ACCOUNT_LIST_SQL} ORDER BY a.is_active DESC, a.account_type, a.name`, [org])).rows;
    const sum = (rows) => round2(rows.reduce((s, a) => s + Number(a.balance_eur), 0)).toFixed(2);
    const cash = accounts.filter(a => a.account_type !== 'virtual');
    const person = accounts.filter(a => a.person_id != null);

    // Açık alacak — kontrat bakiyesi (contracts.js GET / ile aynı D2 ifadesi: revenue_eur − Σ amount_eur).
    // RAP-03 kara liste: Transferred (bakiye devamına taşındı) + Cancelled → dışarıda, SAYAÇTA.
    // RAP-02 E1: eksik ve fazla netleşmez — açık alacak yalnız pozitif bakiyeler; fazla ödeme ayrı.
    const rc = (await pool.query(
      `WITH b AS (
         SELECT c.id, c.status, c.revenue_eur,
                c.revenue_eur - COALESCE((SELECT SUM(p.amount_eur) FROM payments p WHERE p.contract_id = c.id), 0) AS balance_eur
           FROM contracts c WHERE c.organizer_id = $1)
       SELECT
         COALESCE(SUM(balance_eur) FILTER (WHERE status NOT IN ('Transferred','Cancelled') AND balance_eur > 0), 0)::numeric(14,2) AS open_eur,
         count(*) FILTER (WHERE status NOT IN ('Transferred','Cancelled') AND balance_eur > 0)::int AS open_contracts,
         COALESCE(-SUM(balance_eur) FILTER (WHERE status NOT IN ('Transferred','Cancelled') AND balance_eur < 0), 0)::numeric(14,2) AS overpaid_eur,
         count(*) FILTER (WHERE status NOT IN ('Transferred','Cancelled') AND balance_eur < 0)::int AS overpaid_contracts,
         COALESCE(SUM(balance_eur) FILTER (WHERE status = 'On Hold' AND balance_eur > 0), 0)::numeric(14,2) AS on_hold_open_eur,
         count(*) FILTER (WHERE status = 'Transferred')::int AS excluded_transferred,
         count(*) FILTER (WHERE status = 'Cancelled')::int   AS excluded_cancelled,
         count(*) FILTER (WHERE revenue_eur IS NULL)::int     AS missing_revenue_eur
         FROM b`, [org])).rows[0];

    // Ödenecek komisyon — agent ekstresiyle AYNI kaynak (SLICE_CTES, MOT-01) + payouts.
    // Agent başına ROUND (payouts.js statement deseni); pozitif = ödenecek, negatif = agent borçlu (netleşmez).
    const cm = (await pool.query(
      `WITH
${SLICE_CTES},
       earned AS (SELECT sales_agent_id, ROUND(SUM(slice_raw), 2) AS earned_eur
                    FROM sliced WHERE slice_raw IS NOT NULL GROUP BY sales_agent_id),
       paid AS (SELECT sales_agent_id, SUM(amount_eur) AS paid_eur
                  FROM commission_payouts WHERE organizer_id = $1 GROUP BY sales_agent_id),
       bal AS (SELECT COALESCE(e.sales_agent_id, p.sales_agent_id) AS sales_agent_id,
                      COALESCE(e.earned_eur, 0) - COALESCE(p.paid_eur, 0) AS balance_eur
                 FROM earned e FULL JOIN paid p ON p.sales_agent_id = e.sales_agent_id)
       SELECT COALESCE(SUM(balance_eur) FILTER (WHERE balance_eur > 0), 0)::numeric(14,2) AS payable_eur,
              count(*) FILTER (WHERE balance_eur > 0)::int AS payable_agents,
              COALESCE(-SUM(balance_eur) FILTER (WHERE balance_eur < 0), 0)::numeric(14,2) AS agents_owe_eur,
              count(*) FILTER (WHERE balance_eur < 0)::int AS owing_agents
         FROM bal`, [org])).rows[0];

    res.json({
      as_of: new Date().toISOString(),
      currency: 'EUR',
      accounts,
      total_cash_eur: sum(cash),                 // banka + kasa (pasif hesaplar dahil — bakiyesi varsa görünür)
      person_accounts_eur: sum(person),          // owner cari: eksi = şirketin sahibe borcu (LED-07)
      receivables: rc,
      commissions: cm,
      not_in_ledger: await notInLedger(pool, org),
    });
  } catch (err) {
    console.error('Error building ledger summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
