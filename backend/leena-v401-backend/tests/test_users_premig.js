// PAKET 2 — "deploy migration'dan ÖNCE" testi. Hedef: ell_comm_test_p1b (şema ≤ 042, canlının
// Paket 1b sonrası hali). Canlı sırası: push → deploy → Shell'de migrate. Arada kalan pencerede
// YENİ KOD + ESKİ ŞEMA: kapılar ESKİ davranışa düşer (42703 kuralı — klasik oturum yazmaya devam
// eder), kullanıcı yönetimi / davet uçları 500 değil anlamlı 503 döner, /me eski şeklini korur.
// authMiddleware'in aktiflik denetimi users (032) üzerinde olduğundan bu pencerede de çalışır.
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const base = new URL(process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test');
base.pathname = base.pathname.replace(/\/?$/, '') + '_p1b';
const pool = new Pool({ connectionString: base.toString() });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const app = express(); app.use(express.json());
app.use('/api/user-auth', require(path.join(BE, 'routes/userAuth.js')));
app.use('/api/users', require(path.join(BE, 'routes/users.js')));
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
app.use('/api/expense-drafts', require(path.join(BE, 'routes/expenseDrafts.js')));
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
const CLASSIC = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 46012;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body, token = CLASSIC) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
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
    for (const t of ['expense_drafts', 'ledger_entries', 'expenses', 'expo_budget_lines', 'expo_budgets', 'commission_payouts', 'accounts', 'sales_agents']) {
      await c.query(`DELETE FROM ${t}`);
    }
    await c.query("DELETE FROM users WHERE email LIKE '%@p2pre.test'");
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

const server = app.listen(PORT, async () => {
  try {
    console.log('\n── Deploy → migration arası (şema ≤ 042) ──');
    const sch = await q1(`SELECT to_regclass('public.user_invites') IS NULL AS no_inv, to_regclass('public.roles') IS NULL AS no_roles,
        to_regclass('public.audit_log') IS NULL AS no_audit, to_regclass('public.suppliers') IS NOT NULL AS sup,
        NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('role_id','office_id')) AS no_cols`);
    ok('Q0 hedef şema canlının bugünkü hali: suppliers VAR · user_invites / roles / audit_log / users.role_id+office_id YOK',
      sch.no_inv && sch.no_roles && sch.no_audit && sch.sup && sch.no_cols, JSON.stringify(sch));
    await reset();
    const turkey = (await q1("SELECT id FROM offices WHERE name='Turkey'")).id;
    const suer = (await q1("SELECT id::text id FROM users WHERE email = 'suer@elan-expo.com'")).id;
    const OWNER = jwt.sign({ organizer_id: 1, user_id: suer, email: 'x' }, process.env.JWT_SECRET);
    const acc = await call('POST', '/api/ledger/accounts', { name: 'Pre Bank', account_type: 'bank', currency: 'EUR', office_id: turkey });
    const ref = (await call('GET', '/api/ledger/reference')).body;
    const T = ref.expense_categories.find(c => c.name === 'Office').types[0].id;
    const e = await call('POST', '/api/ledger/expenses', { expense_type_id: T, account_id: acc.body.id, amount: 3, exchange_rate: 1,
      expense_date: '2026-10-22', payment_method: 'cash' });
    const ag = (await q1("INSERT INTO sales_agents (organizer_id, name, agent_type) VALUES (1,'Pre Agent','internal') RETURNING id")).id;
    const p = await call('POST', `/api/agents/${ag}/payouts`, { amount: 2, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-22', paid_office_id: turkey });
    const d = await call('POST', '/api/expense-drafts', { source: 'manual', amount: 4 });
    ok('Q1 kapılar ESKİ davranışta: klasik oturum hesap / gider / payout / taslak yazar → 201 (bugünkü canlı akış kesilmez)',
      acc.status === 201 && e.status === 201 && p.status === 201 && d.status === 201, JSON.stringify([acc.status, e.status, p.status, d.status]));
    const u = await call('GET', '/api/users', undefined, OWNER);
    const ic = await call('POST', '/api/user-auth/invite/check', { token: 'x'.repeat(43) });
    const ia = await call('POST', '/api/user-auth/invite/accept', { token: 'x'.repeat(43), password: 'whatever-1' });
    ok('Q2 kullanıcı yönetimi + davet uçları migration öncesi 503 (anlamlı mesaj, 500 değil)',
      u.status === 503 && /not migrated/.test(u.body.error) && ic.status === 503 && ia.status === 503, JSON.stringify([u.status, ic.status, ia.status]));
    const me = await call('GET', '/api/user-auth/me', undefined, OWNER);
    ok('Q3 /me eski şekliyle 200 (permissions / role / office anahtarı YOK)', me.status === 200 && me.body.session === 'user' &&
      !('permissions' in me.body) && !('role' in me.body), JSON.stringify(me.body));
    const gone = (await q1("INSERT INTO users (organizer_id, email, is_owner, is_active) VALUES (1,'gone@p2pre.test',false,false) RETURNING id::text id")).id;
    const g = await call('GET', '/api/contracts', undefined, jwt.sign({ organizer_id: 1, user_id: gone }, process.env.JWT_SECRET));
    ok('Q4 pasif kullanıcının token\'ı bu pencerede de 401 (authMiddleware aktiflik denetimi 032 üzerinde)', g.status === 401, g.status);
    await call('POST', '/api/ledger/budgets/1', { lines: [] });
    const lk = await call('POST', '/api/ledger/budgets/1/lock', undefined, OWNER);
    ok('Q5 bütçe kilidi audit_log yokken de 200 (denetim yazımı atlanır, kilit akışı kesilmez)', lk.status === 200, JSON.stringify(lk));
    await reset();
    console.log(`\n═══ USERS PREMIG SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (err) { console.error('TEST HATASI:', err); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
