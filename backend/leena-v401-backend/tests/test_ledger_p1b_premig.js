// PAKET 1b — "deploy migration'dan ÖNCE" testi. Hedef: ell_comm_test_p1 (şema ≤ 040, canlının
// Paket 1 sonrası hali). Canlı sırası: push → deploy → Shell'de migrate. Arada kalan pencerede
// YENİ KOD + ESKİ ŞEMA: gider akışı Paket 1 davranışıyla BİREBİR sürmeli (42703 fallback kuralı);
// tedarikçi / taslak uçları 500 değil anlamlı 503 döner.
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const base = new URL(process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test');
base.pathname = base.pathname.replace(/\/?$/, '') + '_p1';
const pool = new Pool({ connectionString: base.toString() });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const app = express(); app.use(express.json());
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
app.use('/api/expense-drafts', require(path.join(BE, 'routes/expenseDrafts.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 46001;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
async function reset() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ell.allow_ledger_reset = 'on'");
    for (const t of ['ledger_entries', 'expenses', 'accounts']) await c.query(`DELETE FROM ${t}`);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

const server = app.listen(PORT, async () => {
  try {
    console.log('\n── Deploy → migration arası (şema ≤ 040) ──');
    const sch = await q1(`SELECT to_regclass('public.suppliers') IS NULL AS no_sup, to_regclass('public.expense_drafts') IS NULL AS no_dr,
        NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='supplier_id') AS no_col,
        to_regclass('public.ledger_entries') IS NOT NULL AS ledger`);
    ok('Q0 hedef şema canlının bugünkü hali: ledger VAR · suppliers / expense_drafts / expenses.supplier_id YOK',
      sch.no_sup && sch.no_dr && sch.no_col && sch.ledger, JSON.stringify(sch));
    await reset();
    const turkey = (await q1("SELECT id FROM offices WHERE name='Turkey'")).id;
    const B = (await call('POST', '/api/ledger/accounts', { name: 'P1 Bank EUR', account_type: 'bank', currency: 'EUR', office_id: turkey })).body.id;
    const ref = (await call('GET', '/api/ledger/reference')).body;
    const SALARY = ref.expense_categories.find(c => c.name === 'Office').types[0].id;
    // finance-expenses.html Paket 1 gövdesi BİREBİR (bugünkü canlı form).
    const oldBody = { expense_type_id: String(SALARY), account_id: String(B), amount: '40', exchange_rate: '1', expense_date: '2026-10-21',
                      payment_method: 'bank_transfer', counterparty: 'Payroll' };
    const e1 = await call('POST', '/api/ledger/expenses', oldBody);
    ok('Q1 Paket 1 gider formu gövdesi → 201 + ledger hareketi · satırda supplier_id anahtarı YOK (eski şekil)',
      e1.status === 201 && e1.body.ledger_entry_id != null && !('supplier_id' in e1.body.expense) && e1.body.expense.counterparty === 'Payroll',
      JSON.stringify([e1.status, e1.body]));
    const e2 = await call('POST', '/api/ledger/expenses', Object.assign({}, oldBody, { supplier_id: 1 }));
    ok('Q2 tedarikçi seçilmiş gövde eski şemaya → 400 anlamlı mesaj (500 DEĞİL), gider yazılmadı',
      e2.status === 400 && /not available yet/.test(e2.body.error), JSON.stringify([e2.status, e2.body]));
    const list = await call('GET', '/api/ledger/expenses');
    const rev = await call('POST', `/api/ledger/expenses/${e1.body.expense.id}/reverse`);
    const stm = await call('GET', `/api/ledger/accounts/${B}/statement`);
    ok('Q3 gider listesi 200 (tedarikçi kolonu yok) · ters gider 201 · ekstre 200 (supplier_name NULL)',
      list.status === 200 && list.body.length === 1 && !('supplier_name' in list.body[0]) && rev.status === 201 &&
      stm.status === 200 && stm.body.lines.every(l => l.supplier_name === null), JSON.stringify([list.status, rev.status, stm.status]));
    const s1 = await call('GET', '/api/ledger/suppliers');
    const s2 = await call('GET', '/api/ledger/suppliers/options');
    const s3 = await call('POST', '/api/ledger/suppliers', { name: 'X', supplier_type: 'supplier', country_code: 'TR' });
    ok('Q4 tedarikçi uçları migration öncesi 503 (anlamlı mesaj)', [s1, s2, s3].every(r => r.status === 503) && /not migrated/.test(s1.body.error),
      JSON.stringify([s1.status, s2.status, s3.status]));
    const d1 = await call('GET', '/api/expense-drafts');
    const d2 = await call('POST', '/api/expense-drafts', { source: 'ai', amount: 5 });
    const d3 = await fetch(`http://127.0.0.1:${PORT}/api/expense-drafts`);
    ok('Q5 taslak uçları migration öncesi 503 · token yoksa 401 önce', d1.status === 503 && d2.status === 503 && /not migrated/.test(d1.body.error) && d3.status === 401,
      JSON.stringify([d1.status, d2.status, d3.status]));
    await reset();
    console.log(`\n═══ LEDGER P1b PREMIG SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
