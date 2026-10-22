// tests/helpers/ui0Seed.js — UI-0 ekran testleri için ortak düzen + tohum (test DB, GERÇEK uçlar).
// Kullanan: tests/test_ui2_ui0_render.js (npm test) · tests/ui0_compare.js (tarayıcı, elle koşulur).
// Uygulama: ürün route'ları test pool'uyla mount edilir (test_users_admin deseni) + public/ statik.
// /api/expos için STUB uç: gerçek routes/expos.js test DB'sinde olmayan EMS kolonlarını okur (YON-09 —
// test DB'si test edilen kodun aynasıdır; ekranlar yalnız { id, name } kullanır).
// Tohum: TABAN kontratı (contract sr earned = 342.00) + TRY kontratı + On Hold kontrat + hesaplar +
// kur farklı transfer + tedarikçi + giderler (biri ters) + eksik alanlı taslak + kilitli bütçe + 2. kullanıcı.
// Bitişte reset() — sonraki suite'ler etkilenmez. Ürün kodunda anahtar YOK (034 / Paket 1 / Paket 2 emsali).
const path = require('path');
const BE = path.join(__dirname, '..', '..');

const SFX = '@ui0.test';

function buildApp(pool, opts = {}) {
  const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  const express = require(path.join(BE, 'node_modules/express'));
  const authMiddleware = require(path.join(BE, 'middleware/authMiddleware.js'));
  const app = express(); app.use(express.json());
  app.use('/api/user-auth', require(path.join(BE, 'routes/userAuth.js')));
  app.use('/api/users', require(path.join(BE, 'routes/users.js')));
  app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
  app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
  app.use('/api/expense-drafts', require(path.join(BE, 'routes/expenseDrafts.js')));
  app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
  app.get('/api/expos', authMiddleware, async (req, res) => {
    const r = await pool.query('SELECT id, name FROM expos WHERE organizer_id = $1 ORDER BY id', [req.organizer_id]);
    res.json(r.rows);
  });
  // ui2 statik: ölçülen ağaç (opts.ui2Dir — karşılaştırmada eski sürüm) + public/ kökü (leena-fetch.js vb.).
  if (opts.ui2Dir) app.use('/ui2', express.static(opts.ui2Dir));
  app.use(express.static(path.join(BE, 'public')));
  return app;
}

async function reset(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ell.allow_ledger_reset = 'on'");
    await c.query("SET LOCAL ell.allow_line_item_reset = 'on'");
    await c.query("SET LOCAL ell.allow_user_admin_reset = 'on'");
    for (const t of ['expense_drafts', 'ledger_entries', 'transfers', 'expenses', 'suppliers', 'expo_budget_lines', 'expo_budgets',
                     'payments', 'accounts', 'payment_schedule_items', 'commission_payouts', 'contract_line_items', 'contracts', 'sales_agents',
                     'audit_log', 'user_permissions', 'user_invites', 'email_queue']) {
      await c.query(`DELETE FROM ${t}`);
    }
    await c.query(`DELETE FROM users WHERE email LIKE '%${SFX}'`);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// call(method, url, body, token) → { status, body }
async function seed(pool, call, jwt, secret) {
  const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const must = (r, what) => { if (r.status !== 201 && r.status !== 200) throw new Error(`seed ${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  let own = await q1('SELECT id::text AS id, email FROM users WHERE organizer_id = 1 AND is_owner AND is_active LIMIT 1');
  if (!own) own = await q1(`INSERT INTO users (organizer_id, email, is_owner, display_role) VALUES (1, 'owner${SFX}', true, 'Owner') RETURNING id::text AS id, email`);
  const OWNER = jwt.sign({ organizer_id: 1, user_id: own.id, email: own.email, name: 'UI0 Owner' }, secret);
  const office = async (name) => (await q1('SELECT id FROM offices WHERE name = $1', [name])).id;
  const turkey = await office('Turkey');

  // Hesaplar: EUR banka (ofis varsayılanı) · TRY banka (ofis varsayılanı) · EUR kasa · owner sanal
  const acc = async (b) => must(await call('POST', '/api/ledger/accounts', b, OWNER), 'account ' + b.name).id;
  const B = await acc({ name: 'UI0 Bank EUR', account_type: 'bank', currency: 'EUR', office_id: turkey, is_office_default: true });
  const T = await acc({ name: 'UI0 Bank TRY', account_type: 'bank', currency: 'TRY', office_id: turkey, is_office_default: true });
  const K = await acc({ name: 'UI0 Cash EUR', account_type: 'cash', currency: 'EUR', office_id: turkey });
  const O = await acc({ name: 'UI0 Owner current account', account_type: 'virtual', currency: 'EUR', person_id: own.id });

  // TABAN: 18600 EUR, kalem 17100, SR %5, ödeme 7440 → oran 0.4 → 855 × 0.4 = 342.00 (T35 ile aynı kurgu)
  const ag = (await q1("INSERT INTO sales_agents (organizer_id, name, default_commission_pct, agent_type) VALUES (1, 'UI0 SR Base', 5, 'external_freelance') RETURNING id")).id;
  const mkContract = async (af, company, revenue, currency, rate, revenueEur, status, sr) => (await q1(
    `INSERT INTO contracts (organizer_id, expo_id, af_number, company_name, contract_date, revenue, currency, exchange_rate, revenue_eur, status, sr_sales_agent_id)
     VALUES (1, 1, $1, $2, '2026-01-01', $3, $4, $5, $6, $7, $8) RETURNING id`, [af, company, revenue, currency, rate, revenueEur, status, sr])).id;
  const line = (cid, desc, price, cur, rf) => pool.query(
    `INSERT INTO contract_line_items (contract_id, line_no, description, quantity, unit_price, discount_percent, is_registration_fee, currency)
     VALUES ($1, 1, $2, 1, $3, 0, $4, $5)`, [cid, desc, price, rf, cur]);
  const C342 = await mkContract('AF-UI0-342', 'UI0 Base Co', 18600, 'EUR', 1, 18600, 'Active', ag);
  await line(C342, 'Stand 9 m²', 17100, 'EUR', false);
  const CTRY = await mkContract('AF-UI0-TRY', 'UI0 Lira Ltd', 100000, 'TRY', 0.03, 3000, 'Active', ag);
  await line(CTRY, 'Registration', 100000, 'TRY', true);
  const CHOLD = await mkContract('AF-UI0-HOLD', 'UI0 Paused Inc', 5000, 'EUR', 1, 5000, 'On Hold', null);
  const pay = (cid, body) => call('POST', `/api/contracts/${cid}/payments`,
    Object.assign({ payment_method: 'bank_transfer', payment_date: '2026-07-20', received_office_id: turkey }, body), OWNER);
  must(await pay(C342, { amount: 7440, currency: 'EUR', exchange_rate: 1 }), 'payment 342');
  must(await pay(CTRY, { amount: 20000, currency: 'TRY', exchange_rate: 0.03 }), 'payment TRY');

  // Kur farklı transfer: TRY → EUR (10000 TRY @0.03 = 300 EUR çıkış · 290 EUR giriş)
  must(await call('POST', '/api/ledger/transfers', { from_account_id: T, to_account_id: B, transfer_date: '2026-08-01',
    amount: 10000, exchange_rate: 0.03, amount_in: 290, exchange_rate_in: 1, notes: 'UI0 conversion' }, OWNER), 'transfer');
  must(await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: K, transfer_date: '2026-08-02',
    amount: 150, exchange_rate: 1, notes: 'UI0 cash for fair' }, OWNER), 'transfer 2');

  // Tedarikçi + giderler (biri ters kayıtla düzeltilir) + owner cebinden gider
  const ref = (await call('GET', '/api/ledger/reference', undefined, OWNER)).body;
  const cats = ref.expense_categories.filter(c => c.types.length);
  const TYPE1 = cats[0].types[0].id, TYPE2 = (cats[1] || cats[0]).types[0].id, CAT1 = cats[0].id;
  const S = must(await call('POST', '/api/ledger/suppliers', { name: 'UI0 Venue Ltd', supplier_type: 'venue', country_code: 'TR', office_id: turkey }, OWNER), 'supplier').id;
  const exp = (b) => call('POST', '/api/ledger/expenses', Object.assign({ payment_method: 'bank_transfer', exchange_rate: 1 }, b), OWNER);
  const E1 = must(await exp({ expense_type_id: TYPE1, account_id: B, amount: 1200, expense_date: '2026-08-05', expo_id: 1, supplier_id: S }), 'expense 1').expense.id;
  const E2 = must(await exp({ expense_type_id: TYPE2, account_id: B, amount: 75.5, expense_date: '2026-08-06', expo_id: 1, supplier_id: S }), 'expense 2').expense.id;
  must(await exp({ expense_type_id: TYPE2, account_id: T, amount: 500, exchange_rate: 0.03, expense_date: '2026-08-07' }), 'expense TRY');
  must(await exp({ expense_type_id: TYPE1, account_id: O, amount: 40, expense_date: '2026-08-08', payment_method: 'cash' }), 'expense owner');
  must(await call('POST', `/api/ledger/expenses/${E2}/reverse`, undefined, OWNER), 'reverse');

  // Eksik alanlı taslak (amount yok) + tam taslak
  must(await call('POST', '/api/expense-drafts', { source: 'manual', expense_type_id: TYPE1, account_id: B, expense_date: '2026-08-09', supplier_name: 'UI0 Venue', notes: 'UI0 partial' }, OWNER), 'draft partial');
  must(await call('POST', '/api/expense-drafts', { source: 'import', expense_type_id: TYPE1, account_id: B, amount: 33.3, exchange_rate: 1,
    payment_method: 'cash', expense_date: '2026-08-10', notes: 'UI0 complete' }, OWNER), 'draft complete');

  // Bütçe (expo 1) + kilit (Owner)
  must(await call('POST', '/api/ledger/budgets/1', { income_target_eur: 50000, notes: 'UI0 rev 1',
    lines: [{ category_id: CAT1, amount_eur: 2000 }, { category_id: cats[0].id, expense_type_id: TYPE1, amount_eur: 900 }] }, OWNER), 'budget');
  must(await call('POST', '/api/ledger/budgets/1/lock', undefined, OWNER), 'budget lock');

  // İkinci kullanıcı (Finance şablonu, Turkey) — Admin ekranları için
  const fin = (await q1("SELECT id FROM roles WHERE organizer_id = 1 AND name = 'Finance'")).id;
  const STAFF = (await q1(`INSERT INTO users (organizer_id, email, is_owner, display_name, role_id, office_id) VALUES (1, 'staff${SFX}', false, 'UI0 Staff', $1, $2) RETURNING id::text AS id`, [fin, turkey])).id;

  return { OWNER, ownerId: own.id, ownerEmail: own.email, accounts: { B, T, K, O }, contracts: { C342, CTRY, CHOLD }, supplier: S, expense: E1, staff: STAFF, expo: 1 };
}

module.exports = { buildApp, reset, seed, SFX };
