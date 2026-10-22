// PAKET 2 testi — kullanıcı yönetimi + yetki çekirdeği (P2-1..P2-4, KAPI-2). YEREL scratch DB
// (ell_comm_test), GERÇEK endpoint'ler. Kaynak = kütük B9/B10/B12/B21/B25/B27/B28/B30/B32/B40/B42 ·
// LED-09/15 · SEM-05 · OFS-05 · G45 · YON-11 · TABAN 342.00.
// Bitişte satırlar anahtarlı temizlikle silinir — sonraki suite'ler etkilenmez.
process.env.JWT_SECRET = 'test-only-secret-not-production';
delete process.env.INVITE_ECHO;
const path = require('path');
const fs = require('fs');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(BE, 'node_modules/bcrypt'));
const { SLICE_CTES } = require(path.join(BE, 'utils/commissionSlices'));
const perms = require(path.join(BE, 'utils/permissions'));
const app = express(); app.use(express.json());
app.use('/api/user-auth', require(path.join(BE, 'routes/userAuth.js')));
app.use('/api/users', require(path.join(BE, 'routes/users.js')));
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
app.use('/api/expense-drafts', require(path.join(BE, 'routes/expenseDrafts.js')));
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
app.use('/api/sales-agents', require(path.join(BE, 'routes/salesAgents.js')));
const PORT = 46010;
const SFX = '@p2.test';

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body, token) {
  const opts = { method, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
const n = async (sql, p) => Number((await q1(sql, p)).n);
async function dbErr(sql, p) { try { await pool.query(sql, p); return ''; } catch (e) { return e.message; } }
const CLASSIC = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const tok = (id) => jwt.sign({ organizer_id: 1, user_id: id, email: 'x' }, process.env.JWT_SECRET);
const roleId = async (name) => (await q1('SELECT id FROM roles WHERE organizer_id = 1 AND name = $1', [name])).id;
async function mkUser(local, { role = null, office = null, owner = false, password = null } = {}) {
  const hash = password ? await bcrypt.hash(password, 4) : null;
  return (await q1(
    `INSERT INTO users (organizer_id, email, is_owner, password_hash, password_must_change, role_id, office_id)
     VALUES (1, $1, $2, $3, false, $4, $5) RETURNING id::text AS id`,
    [local + SFX, owner, hash, role ? await roleId(role) : null, office])).id;
}
// console.log'u yakala (INVITE_ECHO kanıtı): fn sırasında yazılan satırlar.
async function captureLog(fn) {
  const lines = [], orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { return { result: await fn(), lines }; } finally { console.log = orig; }
}
const tokenFromQueue = async (email) => {
  const r = await q1(`SELECT html_content h FROM email_queue WHERE recipient_email = $1 ORDER BY id DESC LIMIT 1`, [email]);
  const m = r && /invite\.html#token=([A-Za-z0-9_\-%]+)/.exec(r.h);
  return m ? decodeURIComponent(m[1]) : null;
};

// Anahtarlı temizlik (034 deseni; ürün kodunda anahtar YOK).
async function reset() {
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
    await c.query("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE NOT is_system)");
    await c.query("DELETE FROM roles WHERE NOT is_system");
    await c.query(`DELETE FROM users WHERE email LIKE '%${SFX}'`);
    await c.query("UPDATE users SET is_active = true WHERE email = 'suer@elan-expo.com'");
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

const server = app.listen(PORT, async () => {
  try {
    await reset();
    const office = async (name) => (await q1('SELECT id FROM offices WHERE name = $1', [name])).id;
    const TR = await office('Turkey'), MA = await office('Morocco');
    const SUER = (await q1("SELECT id::text AS id FROM users WHERE email = 'suer@elan-expo.com'")).id;
    const OWNER = tok(SUER);
    const FIN = await mkUser('fin', { role: 'Finance' });
    const OM = await mkUser('om', { role: 'Office Manager', office: TR });
    const OMX = await mkUser('om-nooffice', { role: 'Office Manager' });
    const NOROLE = await mkUser('norole');
    const T_FIN = tok(FIN), T_OM = tok(OM), T_OMX = tok(OMX), T_NOROLE = tok(NOROLE);

    // ══ A — authMiddleware: users oturumunda aktiflik (KAPI-2) ══
    console.log('\n── A: aktiflik (authMiddleware, yalnız user token) ──');
    const GONE = await mkUser('gone', { role: 'Finance' });
    const a1 = [await call('GET', '/api/contracts', undefined, tok(GONE)), await call('GET', '/api/contracts', undefined, CLASSIC)];
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [GONE]);
    const a2 = [await call('GET', '/api/contracts', undefined, tok(GONE)), await call('GET', '/api/ledger/accounts', undefined, tok(GONE)),
                await call('GET', '/api/user-auth/me', undefined, tok(GONE)), await call('GET', '/api/contracts', undefined, CLASSIC)];
    ok('A1 aktif kullanıcı token\'ı + klasik token eski uçta 200 · pasifleşince AYNI token eski uçta da, ledger okumada da, /me\'de de 401 · klasik token etkilenmez',
      a1.every(r => r.status === 200) && a2[0].status === 401 && a2[1].status === 401 && a2[2].status === 401 && a2[3].status === 200,
      JSON.stringify([a1.map(r => r.status), a2.map(r => r.status)]));
    const amSrc = fs.readFileSync(path.join(BE, 'middleware/authMiddleware.js'), 'utf8');
    ok('A2 authMiddleware: DB\'ye yalnız user_id taşıyan token\'da gider (klasik yol `if (!decoded.user_id) return next()`) · 401/403 sözleşmesi aynı',
      /if \(!decoded\.user_id\) return next\(\);/.test(amSrc) && /sendStatus\(401\)/.test(amSrc) && /sendStatus\(403\)/.test(amSrc));
    // A3 — davranış ölçümü: authMiddleware'in TAZE kopyası, sorgu sayan sahte pool ile (33 route dosyası bunu kullanır).
    const amPath = require.resolve(path.join(BE, 'middleware/authMiddleware.js'));
    const savedAm = require.cache[amPath]; delete require.cache[amPath];
    const seen = [];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: (sql, p) => { seen.push(p); return Promise.resolve({ rows: [{ is_active: true }] }); } } };
    const am = require(amPath);
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
    require.cache[amPath] = savedAm;
    const runAm = (auth) => new Promise((resolve) => {
      const req = { headers: auth ? { authorization: auth } : {} };
      const res = { sendStatus: (s) => resolve({ status: s, req }), status: (s) => ({ json: () => resolve({ status: s, req }) }) };
      am(req, res, () => resolve({ next: true, req }));
    });
    const r0 = seen.length;
    const am1 = await runAm('Bearer ' + CLASSIC);
    const q0 = seen.length - r0;
    const am2 = await runAm(null), am3 = await runAm('Bearer not.a.jwt');
    const am4 = await runAm('Bearer ' + tok(FIN));
    ok('A3 klasik token: next() + organizer_id, user_id YOK, DB sorgusu 0 (eski davranış birebir) · token yok 401 · bozuk 403 · user token tek sorgu + user_id',
      am1.next && am1.req.organizer_id === 1 && am1.req.user_id === undefined && q0 === 0 && am2.status === 401 && am3.status === 403 &&
      am4.next && am4.req.user_id === FIN && seen.length - r0 === 1, JSON.stringify([am1.next, q0, am2.status, am3.status, am4.next, seen.length - r0]));

    // ══ R — çözümleme (utils/permissions.js, tek yer) ══
    console.log('\n── R: yetki çözümlemesi ──');
    const sOwner = await perms.permissionSummary(pool, { id: SUER, organizer_id: 1, is_owner: true, role_id: null });
    ok('R1 (B10/B25) Owner kısa devre: kayıt defterinin 18 kodunun HEPSİ, kapsam all, 4 alan',
      sOwner.owner === true && Object.keys(sOwner.codes).length === 18 && Object.values(sOwner.codes).every(s => s === 'all') && sOwner.areas.length === 4,
      JSON.stringify(sOwner).slice(0, 200));
    const finUser = await perms.loadUser(pool, 1, FIN);
    const eFin = await perms.effectivePermissions(pool, finUser);
    const FIN_CODES = ['budget.read', 'budget.write', 'commissions.read', 'contracts.read', 'expense_drafts.approve', 'expense_drafts.read',
      'expense_drafts.write', 'ledger.read', 'ledger.write', 'payouts.write', 'suppliers.read', 'suppliers.write'];
    ok('R2 Finance şablonu: 12 kod, hepsi all · reference.write / users.* / permissions.write YOK (REQ §3.1 Owner varsayılanı)',
      JSON.stringify(Object.keys(eFin.perms).sort()) === JSON.stringify(FIN_CODES) && Object.values(eFin.perms).every(p => p.scope === 'all' && p.source === 'role'),
      JSON.stringify(Object.keys(eFin.perms)));
    await pool.query(`INSERT INTO user_permissions (organizer_id, user_id, permission_code, effect, scope) VALUES
      (1,$1,'reference.write','grant','office'), (1,$1,'ledger.write','grant','own'), (1,$1,'budget.write','revoke',NULL)`, [FIN]);
    const eFin2 = await perms.effectivePermissions(pool, finUser);
    ok('R3 (B30/B42) şablon + kişi ezmesi: grant EKLER (kapsamıyla) · grant şablon kapsamını DEĞİŞTİRİR · revoke KALDIRIR',
      eFin2.perms['reference.write'].scope === 'office' && eFin2.perms['reference.write'].source === 'user' &&
      eFin2.perms['ledger.write'].scope === 'own' && !eFin2.perms['budget.write'] && eFin2.perms['ledger.read'].scope === 'all',
      JSON.stringify([eFin2.perms['reference.write'], eFin2.perms['ledger.write'], eFin2.perms['budget.write']]));
    await pool.query('DELETE FROM user_permissions WHERE user_id = $1', [FIN]);
    const u3 = { id: 'u-3', office_id: 3 }, uNo = { id: 'u-4', office_id: null };
    const S = (u, s, t) => perms.scopeAllows(perms.resolveScope(u, s), t);
    ok('R4 kapsam: all → her şey · office → yalnız kendi ofisi (ofissiz hedef / ofissiz kullanıcı → hayır) · own → yalnız kendi kaydı · team = own (reports_to yok) · bilinmeyen → hayır',
      S(u3, 'all', { office_id: null, created_by: null }) && S(u3, 'office', { office_id: 3 }) && !S(u3, 'office', { office_id: 4 }) &&
      !S(u3, 'office', { office_id: null }) && !S(uNo, 'office', { office_id: 3 }) && S(u3, 'own', { created_by: 'u-3' }) &&
      !S(u3, 'own', { created_by: 'u-9' }) && !S(u3, 'own', { created_by: null }) && S(u3, 'team', { created_by: 'u-3' }) &&
      !S(u3, 'team', { created_by: 'u-9' }) && !S(u3, 'bogus', { office_id: 3, created_by: 'u-3' }));
    const pSrc = fs.readFileSync(path.join(BE, 'utils/permissions.js'), 'utf8');
    const rf = { kind: 'office', officeIds: [3] };
    ok('R5 (SAT-04 yuvası) regionFilter tanımlı, bugün süzgeci DEĞİŞTİRMEZ · office ve team çözümlemesi onu ÇAĞIRIR',
      typeof perms.regionFilter === 'function' && perms.regionFilter(u3, rf) === rf &&
      /case 'office':\s*\n\s*return regionFilter\(/.test(pSrc) && /case 'team':\s*\n\s*return regionFilter\(/.test(pSrc));
    const byName = [];
    for (const f of ['routes/ledger.js', 'routes/expenseDrafts.js', 'routes/payouts.js', 'routes/users.js', 'utils/permissions.js', 'middleware/authMiddleware.js']) {
      const s = fs.readFileSync(path.join(BE, f), 'utf8');
      if (/(name|role_name|display_role)\s*[!=]==?\s*'(Owner|Finance|Project|Office Manager|Sales)'/.test(s) || /name\s*=\s*'Owner'/.test(s)) byName.push(f);
    }
    ok('R6 (B9) kapılı kodda rol ADI kontrolü YOK (Owner şablonu bayrakla tanınır: roles.owner_template)', byName.length === 0, JSON.stringify(byName));

    // ══ D — DB korumaları ══
    console.log('\n── D: DB korumaları ──');
    const finRole = await roleId('Finance');
    const d1 = [await dbErr("UPDATE roles SET name = 'Fin2' WHERE id = $1", [finRole]), await dbErr('DELETE FROM roles WHERE id = $1', [finRole]),
      await dbErr("INSERT INTO role_permissions (organizer_id, role_id, permission_code, scope) VALUES (1,$1,'reference.write','all')", [finRole]),
      await dbErr("DELETE FROM role_permissions WHERE role_id = $1 AND permission_code = 'ledger.write'", [finRole]),
      await dbErr("UPDATE role_permissions SET scope = 'own' WHERE role_id = $1 AND permission_code = 'ledger.write'", [finRole])];
    const cust = (await q1("INSERT INTO roles (organizer_id, name) VALUES (1, 'Custom P2') RETURNING id")).id;
    const d1c = [await dbErr("INSERT INTO role_permissions (organizer_id, role_id, permission_code, scope) VALUES (1,$1,'ledger.read','office')", [cust]),
      await dbErr('DELETE FROM role_permissions WHERE role_id = $1', [cust]), await dbErr('DELETE FROM roles WHERE id = $1', [cust])];
    ok('D1 (B27/B28) sistem şablonu: ad değişmez · silinmez · satırı eklenmez/silinmez/değişmez · ÖZEL şablon serbest',
      d1.every(m => /sistem sablon/.test(m)) && d1c.every(m => m === ''), JSON.stringify([d1, d1c]));
    const d2 = await dbErr("INSERT INTO user_permissions (organizer_id, user_id, permission_code, effect, scope) VALUES (1,$1,'ledger.read','grant','all')", [SUER]);
    const d2b = await dbErr("INSERT INTO roles (organizer_id, name, is_system, owner_template) VALUES (1, 'Owner 2', true, true)");
    ok('D2 Owner\'a kişi başı ezme yazılamaz (kısa devre değiştirilemez) · kiracı başına TEK Owner şablonu', /kisa devre/.test(d2) && /uq_roles_owner_template/.test(d2b),
      JSON.stringify([d2, d2b]));

    // ══ G — kapı (requirePermission) + kapsam ══
    console.log('\n── G: kapı + kapsam ──');
    const g1 = [await call('POST', '/api/ledger/accounts', { name: 'X', account_type: 'bank', currency: 'EUR' }, CLASSIC),
      await call('POST', '/api/agents/1/payouts', { amount: 1, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-01', paid_office_id: TR }, CLASSIC),
      await call('GET', '/api/expense-drafts', undefined, CLASSIC), await call('GET', '/api/users', undefined, CLASSIC),
      await call('GET', '/api/ledger/accounts', undefined, CLASSIC), await call('GET', '/api/ledger/reference', undefined, CLASSIC)];
    ok('G1 eski token (user_id YOK): kapılı uçlar 409 NOT_USER_SESSION (403 DEĞİL — G45) · kapısız okuma uçları 200 (eskisi gibi)',
      g1.slice(0, 4).every(r => r.status === 409 && r.body.code === 'NOT_USER_SESSION') && g1[4].status === 200 && g1[5].status === 200,
      JSON.stringify(g1.map(r => [r.status, r.body && r.body.code])));
    const g2 = [await call('POST', '/api/ledger/accounts', { name: 'X', account_type: 'bank', currency: 'EUR' }, T_NOROLE),
      await call('GET', '/api/ledger/accounts', undefined, T_NOROLE)];
    ok('G2 şablonsuz kullanıcı: yazma → 409 PERMISSION_REQUIRED (permission = ledger.write) · okuma 200',
      g2[0].status === 409 && g2[0].body.code === 'PERMISSION_REQUIRED' && g2[0].body.permission === 'ledger.write' && g2[1].status === 200,
      JSON.stringify(g2.map(r => [r.status, r.body && r.body.code])));

    const ref = (await call('GET', '/api/ledger/reference', undefined, OWNER)).body;
    const OFFICE_T = ref.expense_categories.find(c => c.name === 'Office').types[0].id;
    const accTR = await call('POST', '/api/ledger/accounts', { name: 'TR Bank P2', account_type: 'bank', currency: 'EUR', office_id: TR, is_office_default: true }, T_FIN);
    const accMA = await call('POST', '/api/ledger/accounts', { name: 'MA Bank P2', account_type: 'bank', currency: 'EUR', office_id: MA, is_office_default: true }, T_FIN);
    const ATR = accTR.body.id, AMA = accMA.body.id;
    const exp = (acc, extra) => Object.assign({ expense_type_id: OFFICE_T, account_id: acc, amount: 10, exchange_rate: 1,
      expense_date: '2026-10-20', payment_method: 'bank_transfer' }, extra);
    const ag = (await q1("INSERT INTO sales_agents (organizer_id, name, agent_type) VALUES (1, 'Agent P2', 'internal') RETURNING id")).id;
    const g3 = {
      e: await call('POST', '/api/ledger/expenses', exp(ATR), T_FIN),
      s: await call('POST', '/api/ledger/suppliers', { name: 'Fin Supplier', supplier_type: 'supplier', country_code: 'TR' }, T_FIN),
      p: await call('POST', `/api/agents/${ag}/payouts`, { amount: 5, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-20', paid_office_id: TR }, T_FIN),
      d: await call('POST', '/api/expense-drafts', { source: 'manual', amount: 7 }, T_FIN),
      b: await call('POST', '/api/ledger/budgets/1', { lines: [] }, T_FIN),
      r: await call('POST', '/api/ledger/expense-categories', { name: 'Nope' }, T_FIN),
      l: await call('POST', '/api/ledger/budgets/1/lock', undefined, T_FIN),
    };
    const g3a = await call('POST', `/api/expense-drafts/${g3.d.body.draft.id}/accept`, exp(ATR), T_FIN);
    ok('G3 Finance (kapsam all): hesap · gider · tedarikçi · payout · taslak + kabul · bütçe revizyonu → 201 · referans veri → 409 PERMISSION_REQUIRED · kilit → 409 OWNER_REQUIRED (LED-15 değişmedi)',
      accTR.status === 201 && accMA.status === 201 && g3.e.status === 201 && g3.s.status === 201 && g3.p.status === 201 && g3.d.status === 201 &&
      g3a.status === 201 && g3.b.status === 201 && g3.r.status === 409 && g3.r.body.permission === 'reference.write' &&
      g3.l.status === 409 && g3.l.body.code === 'OWNER_REQUIRED',
      JSON.stringify([accTR.status, accMA.status, ...Object.values(g3).map(r => r.status), g3a.status, g3.r.body, g3.l.body]));
    const lockOwn = await call('POST', '/api/ledger/budgets/1/lock', undefined, OWNER);
    const lockAudit = await q1(`SELECT actor_user_id::text a, target_type, diff->>'expo_id' expo FROM audit_log WHERE action = 'budget.lock' ORDER BY id DESC LIMIT 1`);
    ok('G3b (P2-4, LED-15) Owner kilidi → 200 + denetim kaydı budget.lock (kim · hedef · expo)', lockOwn.status === 200 && lockAudit &&
      lockAudit.a === SUER && lockAudit.target_type === 'expo_budget' && lockAudit.expo === '1', JSON.stringify([lockOwn.status, lockAudit]));

    const nExp = () => n('SELECT count(*) n FROM expenses');
    const before = await nExp();
    const g4 = {
      eTR: await call('POST', '/api/ledger/expenses', exp(ATR), T_OM),
      eMA: await call('POST', '/api/ledger/expenses', exp(AMA), T_OM),
      tr: await call('POST', '/api/ledger/transfers', { from_account_id: ATR, to_account_id: AMA, amount: 1, exchange_rate: 1, transfer_date: '2026-10-20' }, T_OM),
      aMA: await call('POST', '/api/ledger/accounts', { name: 'OM MA', account_type: 'cash', currency: 'EUR', office_id: MA }, T_OM),
      aTR: await call('POST', '/api/ledger/accounts', { name: 'OM TR', account_type: 'cash', currency: 'EUR', office_id: TR }, T_OM),
      sNo: await call('POST', '/api/ledger/suppliers', { name: 'OM Sup', supplier_type: 'supplier', country_code: 'TR' }, T_OM),
      sTR: await call('POST', '/api/ledger/suppliers', { name: 'OM Sup', supplier_type: 'supplier', country_code: 'TR', office_id: TR }, T_OM),
      sFin: await call('PUT', `/api/ledger/suppliers/${g3.s.body.id}`, { notes: 'x' }, T_OM),
      pTR: await call('POST', `/api/agents/${ag}/payouts`, { amount: 5, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-20', paid_office_id: TR }, T_OM),
      pMA: await call('POST', `/api/agents/${ag}/payouts`, { amount: 5, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-20', paid_office_id: MA }, T_OM),
      bud: await call('POST', '/api/ledger/budgets/2', { lines: [] }, T_OM),
    };
    const after = await nExp();
    const OOS = (r) => r.status === 409 && r.body.code === 'OUT_OF_SCOPE';
    ok('G4 Office Manager (Turkey, kapsam office): kendi ofisinin hesabında gider/hesap/tedarikçi/payout 201 · başka ofis / ofissiz kayıt 409 OUT_OF_SCOPE (yazılmadı) · bütçe şablonda yok → 409 PERMISSION_REQUIRED',
      g4.eTR.status === 201 && OOS(g4.eMA) && OOS(g4.tr) && OOS(g4.aMA) && g4.aTR.status === 201 && OOS(g4.sNo) && g4.sTR.status === 201 &&
      OOS(g4.sFin) && g4.pTR.status === 201 && OOS(g4.pMA) && g4.bud.status === 409 && g4.bud.body.code === 'PERMISSION_REQUIRED' && after === before + 1,
      JSON.stringify([Object.fromEntries(Object.entries(g4).map(([k, r]) => [k, r.status + ':' + (r.body && r.body.code)])), before, after]));
    const dr = (await call('POST', '/api/expense-drafts', { source: 'ai', amount: 9 }, T_FIN)).body.draft;
    const g4d = [await call('POST', `/api/expense-drafts/${dr.id}/accept`, exp(AMA), T_OM)];
    const drState = (await q1('SELECT status FROM expense_drafts WHERE id = $1', [dr.id])).status;
    g4d.push(await call('POST', `/api/expense-drafts/${dr.id}/accept`, exp(ATR), T_OM));
    ok('G4b taslak kabulü kapsamı HESAPTAN alır: başka ofis hesabıyla 409 OUT_OF_SCOPE + taslak pending kalır · kendi ofis hesabıyla 201',
      OOS(g4d[0]) && drState === 'pending' && g4d[1].status === 201, JSON.stringify([g4d.map(r => r.status), drState]));
    const g5 = await call('POST', '/api/ledger/expenses', exp(ATR), T_OMX);
    ok('G5 ofisi olmayan Office Manager: ofis kapsamı BOŞ çözülür → 409 OUT_OF_SCOPE (sessiz genişleme yok)', OOS(g5), JSON.stringify([g5.status, g5.body]));

    // B40: daraltma anında (aynı token, sonraki istek)
    const rv = await call('PUT', `/api/users/${FIN}/permissions/ledger.write`, { effect: 'revoke', reason: 'test' }, OWNER);
    const g6a = await call('POST', '/api/ledger/expenses', exp(ATR), T_FIN);
    const gr = await call('PUT', `/api/users/${FIN}/permissions/ledger.write`, { effect: 'grant', scope: 'own' }, OWNER);
    const finAcc = (await call('POST', '/api/ledger/accounts', { name: 'Fin own', account_type: 'cash', currency: 'EUR', office_id: TR }, T_FIN)).body;
    const ownerAcc = (await call('POST', '/api/ledger/accounts', { name: 'Owner acc', account_type: 'cash', currency: 'EUR', office_id: TR }, OWNER)).body;
    const g6b = [await call('POST', '/api/ledger/expenses', exp(finAcc.id), T_FIN), await call('POST', '/api/ledger/expenses', exp(ownerAcc.id), T_FIN)];
    ok('G6 (B40) yetki daraltma ANINDA: revoke → aynı token 409 PERMISSION_REQUIRED · grant own → kendi açtığı hesapta 201, başkasının hesabında 409 OUT_OF_SCOPE',
      rv.status === 200 && g6a.status === 409 && g6a.body.code === 'PERMISSION_REQUIRED' && gr.status === 200 && finAcc.id &&
      g6b[0].status === 201 && OOS(g6b[1]), JSON.stringify([rv.status, g6a.status, gr.status, g6b.map(r => r.status)]));
    await call('DELETE', `/api/users/${FIN}/permissions/ledger.write`, {}, OWNER);
    const g7 = await call('POST', '/api/ledger/expenses', exp(ATR, { currency: 'USD' }), OWNER);
    ok('G7 (B25) Owner kısa devresi yalnız YETKİYİ atlar: iş doğrulaması aynı (para birimi uyuşmazlığı → 400, aynı mesaj)',
      g7.status === 400 && g7.body.error === 'account currency (EUR) does not match expense currency (USD)', JSON.stringify(g7));

    // ══ U — kullanıcı yönetimi API ══
    console.log('\n── U: kullanıcılar + davet ──');
    const u1 = await call('GET', '/api/users', undefined, OWNER);
    const suerRow = (u1.body || []).find(u => u.id === SUER);
    ok('U1 Owner listesi: 200 · tohumlanan Owner görünür (Owner şablonu, şifresiz → durum no_password, davet yok)',
      u1.status === 200 && suerRow && suerRow.is_owner && suerRow.role_name === 'Owner' && suerRow.status === 'no_password', JSON.stringify(suerRow));
    await q1("INSERT INTO sales_agents (organizer_id, name, agent_type, email) VALUES (1, 'Ayse Agent', 'internal', 'ayse@p2.test') RETURNING id");
    const ayseAgent = (await q1("SELECT id FROM sales_agents WHERE email = 'ayse@p2.test'")).id;
    const inv1 = await captureLog(() => call('POST', '/api/users/invite', { email: ' Ayse@P2.test ', display_name: 'Ayşe', role_id: finRole,
      office_id: TR, sales_agent_id: ayseAgent }, OWNER));
    const r1 = inv1.result;
    const ayse = r1.body && r1.body.user;
    const row1 = ayse && await q1(`SELECT password_hash IS NULL AS nohash, password_must_change mc, role_id, office_id, is_active,
        (SELECT user_id::text FROM sales_agents WHERE id = $2) AS agent_user FROM users WHERE id = $1`, [ayse.id, ayseAgent]);
    const iv1 = ayse && await q1(`SELECT token_hash, round(extract(epoch FROM expires_at - created_at) / 3600) AS hours, used_at, revoked_at
        FROM user_invites WHERE user_id = $1`, [ayse.id]);
    const mq1 = await q1(`SELECT campaign_id, status, subject, recipient_email, html_content FROM email_queue WHERE recipient_email = 'ayse@p2.test'`);
    const TOK1 = await tokenFromQueue('ayse@p2.test');
    ok('U2 davet: users satırı (e-posta küçük harf, şifre NULL, must_change, şablon + ofis) · temsilci bağı · token DB\'de YALNIZ SHA-256 (64 hex, düz metin değil) · 72 saat',
      r1.status === 201 && ayse.email === 'ayse@p2.test' && ayse.status === 'invited' && row1.nohash && row1.mc && row1.role_id === finRole &&
      row1.office_id === TR && row1.is_active && row1.agent_user === ayse.id && /^[0-9a-f]{64}$/.test(iv1.token_hash) && TOK1 &&
      iv1.token_hash !== TOK1 && iv1.token_hash === require('crypto').createHash('sha256').update(TOK1).digest('hex') && Number(iv1.hours) === 72,
      JSON.stringify([r1.status, r1.body && r1.body.error, row1, iv1 && iv1.hours]));
    ok('U3 e-posta TRANSACTIONAL kuyrukta: campaign_id NULL · pending · konu · link /ui2/invite.html#token= (fragment) · INVITE_ECHO YOK → yanıtta link yok, log\'da token yok',
      mq1 && mq1.campaign_id === null && mq1.status === 'pending' && /invited to ELIZA/.test(mq1.subject) && /\/ui2\/invite\.html#token=/.test(mq1.html_content) &&
      !('invite_url' in r1.body) && !inv1.lines.some(l => l.includes(TOK1) || /INVITE_ECHO/.test(l)),
      JSON.stringify([mq1 && mq1.campaign_id, Object.keys(r1.body), inv1.lines]));
    const u4 = [await call('POST', '/api/users/invite', { email: 'AYSE@p2.test' }, OWNER), await call('POST', '/api/users/invite', { email: 'not-an-email' }, OWNER),
      await call('POST', '/api/users/invite', { email: 'x1@p2.test', role_id: await roleId('Owner') }, OWNER),
      await call('POST', '/api/users/invite', { email: 'x2@p2.test', sales_agent_id: ayseAgent }, OWNER)];
    ok('U4 davet doğrulaması: aynı e-posta (büyük/küçük farkı) 409 · geçersiz e-posta 400 · Owner şablonu atanamaz 400 · başkasına bağlı temsilci 400',
      u4[0].status === 409 && u4[1].status === 400 && u4[2].status === 400 && u4[3].status === 400, JSON.stringify(u4.map(r => [r.status, r.body.error])));
    process.env.INVITE_ECHO = '1';
    const inv2 = await captureLog(() => call('POST', '/api/users/invite', { email: 'mehmet@p2.test', role_id: finRole }, OWNER));
    delete process.env.INVITE_ECHO;
    const TOK2 = await tokenFromQueue('mehmet@p2.test');
    ok('U5 INVITE_ECHO=1 (yalnız staging): yanıtta link (kuyruktakiyle aynı) + log satırı',
      inv2.result.status === 201 && inv2.result.body.invite_url && inv2.result.body.invite_url.endsWith('#token=' + encodeURIComponent(TOK2)) &&
      inv2.lines.some(l => /\[invite\] INVITE_ECHO=1/.test(l) && l.includes(TOK2)), JSON.stringify([inv2.result.status, inv2.lines]));
    const MEHMET = inv2.result.body.user.id;

    const GENERIC = 'This invitation link is invalid or has expired. Ask for a new invitation.';
    const c1 = await call('POST', '/api/user-auth/invite/check', { token: TOK1 });
    const c2 = await call('POST', '/api/user-auth/invite/check', { token: 'x'.repeat(43) });
    const lgBefore = await call('POST', '/api/user-auth/login', { email: 'ayse@p2.test', password: 'ayse-pass-1' });
    const ac0 = await call('POST', '/api/user-auth/invite/accept', { token: TOK1, password: '123' });
    const ac1 = await call('POST', '/api/user-auth/invite/accept', { token: TOK1, password: 'ayse-pass-1', display_name: 'Ayşe K.' });
    const after1 = await q1(`SELECT password_hash IS NOT NULL AS has, password_must_change mc, display_name,
        (SELECT used_at IS NOT NULL FROM user_invites WHERE user_id = u.id) AS used FROM users u WHERE id = $1`, [ayse.id]);
    const ac2 = await call('POST', '/api/user-auth/invite/accept', { token: TOK1, password: 'another-pass' });
    const c3 = await call('POST', '/api/user-auth/invite/check', { token: TOK1 });
    const acAudit = await q1(`SELECT actor_user_id::text a FROM audit_log WHERE action = 'user.invite_accept' AND target_id = $1`, [ayse.id]);
    ok('U6 kabul: kontrol 200 (e-posta) · kabulden ÖNCE giriş 401 · kısa şifre 400 · kabul 200 → şifre yazıldı, must_change=false, ad, davet kullanıldı · denetim (aktör = kişi)',
      c1.status === 200 && c1.body.email === 'ayse@p2.test' && lgBefore.status === 401 && ac0.status === 400 && ac1.status === 200 &&
      after1.has && !after1.mc && after1.display_name === 'Ayşe K.' && after1.used && acAudit && acAudit.a === ayse.id,
      JSON.stringify([c1.status, lgBefore.status, ac0.status, ac1.status, after1, acAudit]));
    ok('U7 TEK KULLANIM + genel hata: ikinci kabul 400 · kullanılmış token kontrolü 400 · uydurma token 400 — üçünde AYNI mesaj (hangisi olduğu sızmaz)',
      ac2.status === 400 && c3.status === 400 && c2.status === 400 && [ac2, c3, c2].every(r => r.body.error === GENERIC), JSON.stringify([ac2.body, c3.body, c2.body]));
    // Süresi geçmiş + iptal edilmiş davet → aynı genel hata
    const EXP = await mkUser('expired');
    const crypto = require('crypto');
    const tExp = crypto.randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO user_invites (organizer_id, user_id, token_hash, expires_at, created_at)
                      VALUES (1, $1, $2, now() - interval '8 hours', now() - interval '80 hours')`, [EXP, crypto.createHash('sha256').update(tExp).digest('hex')]);
    const cExp = [await call('POST', '/api/user-auth/invite/check', { token: tExp }), await call('POST', '/api/user-auth/invite/accept', { token: tExp, password: 'whatever-1' })];
    const rs = await call('POST', `/api/users/${MEHMET}/invite`, undefined, OWNER);
    const TOK2b = await tokenFromQueue('mehmet@p2.test');
    const cRes = [await call('POST', '/api/user-auth/invite/check', { token: TOK2 }), await call('POST', '/api/user-auth/invite/check', { token: TOK2b })];
    const rsAyse = await call('POST', `/api/users/${ayse.id}/invite`, undefined, OWNER);
    ok('U8 süresi geçmiş davet → aynı genel 400 · yeniden davet eski token\'ı İPTAL eder (eski 400, yeni 200) · şifresi olan kullanıcıya yeniden davet 409',
      cExp.every(r => r.status === 400 && r.body.error === GENERIC) && rs.status === 201 && TOK2b !== TOK2 &&
      cRes[0].status === 400 && cRes[1].status === 200 && rsAyse.status === 409, JSON.stringify([cExp.map(r => r.status), rs.status, cRes.map(r => r.status), rsAyse.status]));

    const lg = await call('POST', '/api/user-auth/login', { email: 'ayse@p2.test', password: 'ayse-pass-1' });
    const T_AYSE = lg.body.token;
    const me = await call('GET', '/api/user-auth/me', undefined, T_AYSE);
    ok('U9 davetli giriş yapar → /me: şablon Finance · ofis Turkey · etkin yetki 12 kod · alan yalnız finance (Admin menüsü görünmez)',
      lg.status === 200 && me.status === 200 && me.body.role.name === 'Finance' && me.body.office.id === TR &&
      Object.keys(me.body.permissions.codes).length === 12 && JSON.stringify(me.body.permissions.areas) === '["finance"]' && me.body.permissions.owner === false,
      JSON.stringify([lg.status, me.body && me.body.role, me.body && me.body.permissions && me.body.permissions.areas]));
    const uAyse = await call('GET', '/api/users', undefined, T_AYSE);
    ok('U10 Finance kullanıcısı users ekranına GİREMEZ: GET /api/users → 409 PERMISSION_REQUIRED (users.read)',
      uAyse.status === 409 && uAyse.body.code === 'PERMISSION_REQUIRED' && uAyse.body.permission === 'users.read', JSON.stringify(uAyse));

    const dv = [await call('POST', `/api/users/${ayse.id}/deactivate`, {}, OWNER), await call('POST', `/api/users/${SUER}/deactivate`, { reason: 'x' }, OWNER),
      await call('POST', `/api/users/${ayse.id}/deactivate`, { reason: 'left the company' }, OWNER)];
    const dvAudit = await q1(`SELECT reason, diff->'is_active'->>'to' AS to_ FROM audit_log WHERE action = 'user.deactivate' AND target_id = $1`, [ayse.id]);
    const afterDv = [await call('POST', '/api/user-auth/login', { email: 'ayse@p2.test', password: 'ayse-pass-1' }),
      await call('GET', '/api/user-auth/me', undefined, T_AYSE), await call('GET', '/api/contracts', undefined, T_AYSE),
      await call('POST', '/api/ledger/expenses', exp(ATR), T_AYSE)];
    ok('U11 pasifleştirme: sebepsiz 400 (B12) · kendini 409 SELF_EDIT · sebepli 200 + denetim (sebep) → giriş 401 · eldeki token /me + eski uç + yazma 401',
      dv[0].status === 400 && dv[1].status === 409 && dv[1].body.code === 'SELF_EDIT' && dv[2].status === 200 && dv[2].body.user.status === 'inactive' &&
      dvAudit && dvAudit.reason === 'left the company' && dvAudit.to_ === 'false' && afterDv.every(r => r.status === 401),
      JSON.stringify([dv.map(r => r.status), dvAudit, afterDv.map(r => r.status)]));
    const dvM = await call('POST', `/api/users/${MEHMET}/deactivate`, { reason: 'no longer needed' }, OWNER);
    const cM = await call('POST', '/api/user-auth/invite/check', { token: TOK2b });
    const act = await call('POST', `/api/users/${ayse.id}/activate`, {}, OWNER);
    const lgAgain = await call('POST', '/api/user-auth/login', { email: 'ayse@p2.test', password: 'ayse-pass-1' });
    ok('U12 davetli kişi pasifleşince açık daveti İPTAL (link 400) · yeniden aktifleştirme 200 → giriş tekrar 200',
      dvM.status === 200 && cM.status === 400 && act.status === 200 && lgAgain.status === 200, JSON.stringify([dvM.status, cM.status, act.status, lgAgain.status]));

    // Owner kuralları (B10) + B32
    const OWN2 = await mkUser('owner2', { owner: true });
    const ADM = await mkUser('admin');
    for (const c of ['users.read', 'users.write', 'permissions.write']) {
      await pool.query("INSERT INTO user_permissions (organizer_id, user_id, permission_code, effect, scope) VALUES (1,$1,$2,'grant','all')", [ADM, c]);
    }
    await pool.query("INSERT INTO user_permissions (organizer_id, user_id, permission_code, effect, scope) VALUES (1,$1,'ledger.read','grant','office')", [ADM]);
    const T_ADM = tok(ADM);
    const o1 = [await call('POST', `/api/users/${OWN2}/deactivate`, { reason: 'x' }, T_ADM), await call('PUT', `/api/users/${OWN2}/role`, { role_id: finRole }, OWNER),
      await call('PUT', `/api/users/${SUER}/role`, { role_id: finRole }, OWNER), await call('PUT', `/api/users/${ADM}/permissions/ledger.write`, { effect: 'grant', scope: 'all' }, T_ADM),
      await call('PUT', `/api/users/${ADM}`, { office_id: TR }, T_ADM), await call('POST', `/api/users/${OWN2}/deactivate`, { reason: 'second owner test' }, OWNER)];
    const b10 = await dbErr("UPDATE users SET is_active = false WHERE email = 'suer@elan-expo.com'");
    ok('U13 (B10/B32) Owner\'ı Owner olmayan pasifleştiremez (409 OWNER_REQUIRED) · Owner hedefin şablonu değişmez (OWNER_FIXED) · kendi şablonu/yetkisi/ofisi değişmez (SELF_EDIT, Owner dahil) · Owner ikinci Owner\'ı pasifleştirir · son aktif Owner DB\'de korunur',
      o1[0].status === 409 && o1[0].body.code === 'OWNER_REQUIRED' && o1[1].body.code === 'OWNER_FIXED' && o1[2].body.code === 'SELF_EDIT' &&
      o1[3].body.code === 'SELF_EDIT' && o1[4].body.code === 'SELF_EDIT' && o1[5].status === 200 && /B10/.test(b10),
      JSON.stringify([o1.map(r => [r.status, r.body && r.body.code]), b10.slice(0, 40)]));
    const gx = [await call('PUT', `/api/users/${NOROLE}/permissions/reference.write`, { effect: 'grant', scope: 'all' }, T_ADM),
      await call('PUT', `/api/users/${NOROLE}/permissions/ledger.read`, { effect: 'grant', scope: 'all' }, T_ADM),
      await call('PUT', `/api/users/${NOROLE}/permissions/ledger.read`, { effect: 'grant', scope: 'office' }, T_ADM),
      await call('PUT', `/api/users/${NOROLE}/role`, { role_id: finRole }, T_ADM)];
    ok('U14 Owner olmayan yönetici sahip olmadığını / kendi kapsamından genişini VEREMEZ (409 GRANT_EXCEEDS_OWN) · kendi kapsamı içinde verir (200) · tam yetkili şablonu atayamaz',
      gx[0].body.code === 'GRANT_EXCEEDS_OWN' && gx[1].body.code === 'GRANT_EXCEEDS_OWN' && gx[2].status === 200 && gx[3].body.code === 'GRANT_EXCEEDS_OWN',
      JSON.stringify(gx.map(r => [r.status, r.body && r.body.code])));

    const rc = await call('PUT', `/api/users/${NOROLE}/role`, { role_id: await roleId('Project'), reason: 'moved to projects' }, OWNER);
    const rcAud = await q1(`SELECT diff->'role' AS d, reason FROM audit_log WHERE action = 'user.role_change' AND target_id = $1 ORDER BY id DESC LIMIT 1`, [NOROLE]);
    const pc = await call('DELETE', `/api/users/${NOROLE}/permissions/ledger.read`, { reason: 'cleanup' }, OWNER);
    const detOwner = await call('GET', `/api/users/${NOROLE}`, undefined, OWNER);
    const detAdm = await call('GET', `/api/users/${NOROLE}`, undefined, T_ADM);
    const evs = (detOwner.body.history || []).map(h => h.action);
    ok('U15 (P2-4) şablon değişimi + kişi başı yetki set/clear DENETİME yazılır (diff: önce/sonra, sebep) · detayda etkin yetki · geçmiş yalnız Owner\'a (REQ §3.1)',
      rc.status === 200 && rcAud.d.from === null && rcAud.d.to === 'Project' && rcAud.reason === 'moved to projects' && pc.status === 200 &&
      evs.includes('user.role_change') && evs.includes('user.permission_set') && evs.includes('user.permission_clear') &&
      detOwner.body.effective.codes['budget.write'] === 'all' && !detOwner.body.effective.codes['ledger.read'] && detAdm.status === 200 && detAdm.body.history === null,
      JSON.stringify([rc.status, rcAud, pc.status, evs, detAdm.body && detAdm.body.history]));
    // users.read kapsamı office → yalnız o ofisin kullanıcıları
    await pool.query("UPDATE user_permissions SET scope = 'office' WHERE user_id = $1 AND permission_code = 'users.read'", [ADM]);
    await pool.query('UPDATE users SET office_id = $2 WHERE id = $1', [ADM, TR]);
    const lsAdm = await call('GET', '/api/users', undefined, T_ADM);
    ok('U16 liste kapsamla süzülür: users.read office (Turkey) → yalnız Turkey kullanıcıları', lsAdm.status === 200 && lsAdm.body.length > 0 &&
      lsAdm.body.every(u => u.office_id === TR), JSON.stringify((lsAdm.body || []).map(u => [u.email, u.office_id])));
    const ofc = await call('PUT', `/api/users/${OM}`, { office_id: MA }, OWNER);
    const ofAud = await q1(`SELECT diff->'office_id' d FROM audit_log WHERE action = 'user.update' AND target_id = $1 ORDER BY id DESC LIMIT 1`, [OM]);
    const omAfter = await call('POST', '/api/ledger/expenses', exp(ATR), T_OM);
    ok('U17 ofis = kapsam girdisi: Owner Office Manager\'ın ofisini değiştirir (denetim) → aynı token eski ofisin hesabında ANINDA 409 OUT_OF_SCOPE',
      ofc.status === 200 && ofAud && ofAud.d.from === TR && ofAud.d.to === MA && OOS(omAfter), JSON.stringify([ofc.status, ofAud, omAfter.status]));

    // ══ Regresyon + TABAN ══
    console.log('\n── Regresyon (kapısız eski uçlar) + TABAN ──');
    const rg = [await call('POST', '/api/sales-agents', { name: 'Classic Agent P2', agent_type: 'external_freelance', default_commission_pct: 5 }, CLASSIC),
      await call('GET', '/api/offices', undefined, CLASSIC), await call('GET', '/api/contracts', undefined, CLASSIC)];
    ok('X1 kapısız eski uçlar klasik token\'la eskisi gibi: sales-agents POST 201 · offices 200 · contracts 200', rg[0].status === 201 && rg[1].status === 200 && rg[2].status === 200,
      JSON.stringify(rg.map(r => [r.status, r.body && r.body.error])));
    const ag35 = (await q1("INSERT INTO sales_agents (organizer_id,name,default_commission_pct,agent_type) VALUES (1,'SR Base P2',5,'external_freelance') RETURNING id")).id;
    const c35 = (await q1(`INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
       VALUES (1,1,'AF-P2-35','Acme','2026-01-01',18600,'EUR',1,18600,'Active',$1) RETURNING id`, [ag35])).id;
    await pool.query(`INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
                      VALUES ($1,1,'Item',1,17100,0,false,'EUR')`, [c35]);
    const p35 = await call('POST', `/api/contracts/${c35}/payments`, { amount: 7440, currency: 'EUR', exchange_rate: 1, payment_method: 'cash',
      payment_date: '2026-07-20', received_office_id: TR }, CLASSIC);
    const sl35 = await q1(`WITH ${SLICE_CTES} SELECT ROUND(SUM(slice_raw),2)::text e FROM sliced WHERE contract_id=$2 AND role='sr'`, [1, c35]);
    ok('T35 TABAN sr earned 342.00 — Paket 2 şemasında, ödeme (kapısız eski uç, klasik token) ledger hareketiyle, KAYMADI',
      p35.status === 201 && p35.body.ledger_entry_id != null && sl35.e === '342.00', JSON.stringify([p35.status, p35.body && p35.body.ledger_entry_id, sl35.e]));

    console.log(`\n═══ USERS ADMIN SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally {
    await reset().catch(e => { console.error('TEMİZLİK HATASI:', e.message); fail++; });
    server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1);
  }
});
