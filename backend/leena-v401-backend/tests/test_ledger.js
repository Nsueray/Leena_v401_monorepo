// LEDGER (Paket 1: L-1…L-6) testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Kaynak = KÜTÜK LED-01..09 + D2 / RAP-01..03 / TAH-01 / ODE-03 / MOT-01 + Paket 1 kriterleri
// (KAPI-2 şartı: hesap alanı olmayan eski ödeme formu 400 ALMAZ).
// Bitişte ledger satırları anahtarlı temizlikle silinir — sonraki suite'ler payments'ı silebilsin.
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const fs = require('fs');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const { SLICE_CTES } = require(path.join(BE, 'utils/commissionSlices'));
const app = express(); app.use(express.json());
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
const PORT = 45977;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
let TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);   // klasik (organizer) oturum
let OWNER = null, STAFF = null;                                     // ui2 (users) oturumları
async function call(method, url, body, token = TOKEN) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
const officeId = async (name) => (await q1('SELECT id FROM offices WHERE name=$1', [name])).id;
async function dbErr(sql, p) { try { await pool.query(sql, p); return ''; } catch (e) { return e.message; } }

// Anahtarlı temizlik (034 deseni) — ürün kodunda bu anahtarlar YOK (L-SRC testi).
async function reset() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ell.allow_ledger_reset = 'on'");
    await c.query("SET LOCAL ell.allow_line_item_reset = 'on'");
    for (const t of ['ledger_entries', 'transfers', 'expenses', 'expo_budget_lines', 'expo_budgets', 'payments',
                     'accounts', 'payment_schedule_items', 'commission_payouts', 'contract_line_items', 'contracts', 'sales_agents']) {
      await c.query(`DELETE FROM ${t}`);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
let afSeq = 0;
async function mkContract(extra = {}) {
  const o = Object.assign({ revenue: 1000, currency: 'EUR', exchange_rate: 1, revenue_eur: 1000, status: 'Active', expo_id: 1, sr: null }, extra);
  return (await q1(
    `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
     VALUES (1,$1,$2,'Acme','2026-01-01',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [o.expo_id, 'AF-L-' + (++afSeq), o.revenue, o.currency, o.exchange_rate, o.revenue_eur, o.status, o.sr])).id;
}
const acct = async (body, token) => call('POST', '/api/ledger/accounts', body, token);
const bal = async (id) => {
  const a = (await call('GET', '/api/ledger/accounts?include_inactive=1')).body.find(x => x.id === id);
  return a ? [String(a.balance), String(a.balance_eur)] : null;
};
const sumEntries = async (id) => q1(
  `SELECT COALESCE(SUM(signed_amount),0)::numeric(14,2)::text b, COALESCE(SUM(signed_amount_eur),0)::numeric(14,2)::text e
     FROM ledger_lines WHERE account_id=$1`, [id]);
const payBody = (extra) => Object.assign({ amount: 100, currency: 'EUR', exchange_rate: 1, payment_method: 'bank_transfer',
  payment_date: '2026-09-01' }, extra);

const server = app.listen(PORT, async () => {
  try {
    const turkey = await officeId('Turkey'), morocco = await officeId('Morocco'), kenya = await officeId('Kenya');
    // Owner (032 tohumu) + Owner OLMAYAN bir kullanıcı (bütçe kilidi testi)
    let own = await q1('SELECT id FROM users WHERE organizer_id=1 AND is_owner AND is_active LIMIT 1');
    if (!own) own = await q1("INSERT INTO users (organizer_id,email,is_owner,display_role) VALUES (1,'owner-ledger@x.com',true,'Owner') RETURNING id");
    let st = await q1("SELECT id FROM users WHERE email='ledger-staff@x.com'");
    if (!st) st = await q1("INSERT INTO users (organizer_id,email,is_owner) VALUES (1,'ledger-staff@x.com',false) RETURNING id");
    OWNER = jwt.sign({ organizer_id: 1, user_id: own.id, email: 'owner' }, process.env.JWT_SECRET);
    STAFF = jwt.sign({ organizer_id: 1, user_id: st.id, email: 'staff' }, process.env.JWT_SECRET);
    await reset();

    // ══ L-1 — hesaplar + referans (LED-02 / LED-03 / D2) ══
    console.log('\n── L-1 hesaplar + referans ──');
    const cur = await call('GET', '/api/ledger/currencies');
    const codes = (cur.body || []).map(c => c.code);
    ok('A1 (LED-02) para birimi TABLODAN: REQ\'nin 8 ISO kodu, EUR ilk, TL değil TRY',
      cur.status === 200 && codes[0] === 'EUR' && ['EUR','NGN','MAD','TRY','USD','KES','DZD','GHS'].every(c => codes.includes(c)) && !codes.includes('TL'),
      JSON.stringify(codes));
    const ref = await call('GET', '/api/ledger/reference');
    const catNames = ref.body.expense_categories.map(c => c.name);
    const typeCount = ref.body.expense_categories.reduce((s, c) => s + c.types.length, 0);
    ok('A2 tohum: 6 gider kategorisi (REQ:1680 AYNEN) · 4 belgeli tip · 4 gelir kategorisi',
      JSON.stringify(catNames) === JSON.stringify(['Office','Operation','Pre-Event','Sales','Marketing','Conference']) && typeCount === 4 && ref.body.income_categories.length === 4,
      JSON.stringify([catNames, typeCount, ref.body.income_categories.length]));
    const bankEUR = await acct({ name: 'TR Bank EUR', account_type: 'bank', currency: 'EUR', office_id: turkey, is_office_default: true });
    const cashEUR = await acct({ name: 'TR Cash EUR', account_type: 'cash', currency: 'EUR', office_id: turkey });
    const bankTRY = await acct({ name: 'TR Bank TRY', account_type: 'bank', currency: 'TRY', office_id: turkey, is_office_default: true });
    const ownerAcc = await acct({ name: 'Owner current account', account_type: 'virtual', currency: 'EUR', person_id: own.id });
    ok('A3 (LED-03/07) hesap aç: banka · kasa · sanal owner cari → 201', [bankEUR, cashEUR, bankTRY, ownerAcc].every(r => r.status === 201),
      JSON.stringify([bankEUR, cashEUR, bankTRY, ownerAcc].map(r => [r.status, r.body && r.body.error])));
    const B = bankEUR.body.id, C = cashEUR.body.id, T = bankTRY.body.id, O = ownerAcc.body.id;
    const dupDef = await acct({ name: 'TR Bank EUR 2', account_type: 'bank', currency: 'EUR', office_id: turkey, is_office_default: true });
    const badCur = await acct({ name: 'X', account_type: 'bank', currency: 'XYZ' });
    const personBank = await acct({ name: 'Y', account_type: 'bank', currency: 'EUR', person_id: own.id });
    ok('A4 ofis×para birimi başına tek varsayılan → 409 · bilinmeyen para birimi → 400 · kişiye banka hesabı → 400',
      dupDef.status === 409 && badCur.status === 400 && personBank.status === 400, JSON.stringify([dupDef.status, badCur.status, personBank.status]));
    const putCur = await call('PUT', `/api/ledger/accounts/${B}`, { currency: 'USD' });
    const dbCur = await dbErr('UPDATE accounts SET currency = $1 WHERE id = $2', ['USD', B]);
    const dbDel = await dbErr('DELETE FROM accounts WHERE id = $1', [C]);
    ok('A5 (LED-03) para birimi değişmez (API 400 + DB trigger) · hesap SİLİNMEZ (DB trigger)',
      putCur.status === 400 && /kimlik/.test(dbCur) && /silinmez/.test(dbDel), JSON.stringify([putCur.status, dbCur.slice(0, 50), dbDel.slice(0, 50)]));
    const tmp = await acct({ name: 'Old till', account_type: 'cash', currency: 'EUR' });
    const deact = await call('PUT', `/api/ledger/accounts/${tmp.body.id}`, { is_active: false });
    const listAct = (await call('GET', '/api/ledger/accounts')).body.map(a => a.id);
    const listAll = (await call('GET', '/api/ledger/accounts?include_inactive=1')).body.map(a => a.id);
    ok('A6 pasifleme: varsayılan listeden düşer, include_inactive=1 ile görünür', deact.status === 200 && !listAct.includes(tmp.body.id) && listAll.includes(tmp.body.id),
      JSON.stringify([deact.status, listAct.length, listAll.length]));
    const balCols = (await q1(`SELECT count(*)::int n FROM information_schema.columns
       WHERE table_name IN ('accounts','ledger_entries','transfers','expenses','expo_budgets','expo_budget_lines') AND column_name ~ 'balance|total|actual'`)).n;
    ok('A7 (D2) ledger tablolarında bakiye/toplam/gerçekleşen kolonu YOK', balCols === 0, balCols);
    const salesCat = ref.body.expense_categories.find(c => c.name === 'Sales');
    const officeCat = ref.body.expense_categories.find(c => c.name === 'Office');
    const newType = await call('POST', '/api/ledger/expense-types', { category_id: officeCat.id, name: 'Rent/Maintenance/Utilities' });
    const dupType = await call('POST', '/api/ledger/expense-types', { category_id: officeCat.id, name: 'Rent/Maintenance/Utilities' });
    ok('A8 referans veri admin\'den eklenir (tip) · aynı kategoride aynı ad → 409', newType.status === 201 && dupType.status === 409, JSON.stringify([newType.status, dupType.status]));
    const RENT = newType.body.id;
    const SALARY = officeCat.types.find(t => t.name === 'Salaries/Wages').id;

    // ══ L-2 — transfer (LED-06) + owner hesabı (LED-07) ══
    console.log('\n── L-2 transfer + owner cari ──');
    const t1 = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: C, transfer_date: '2026-09-02', amount: 100, exchange_rate: 1, notes: 'cash for fair' });
    const legs = (await pool.query('SELECT direction, account_id, amount::text FROM ledger_entries WHERE transfer_id=$1 ORDER BY direction', [t1.body.transfer && t1.body.transfer.id])).rows;
    ok('T1 (LED-06) transfer = 1 olay + 2 bağlı bacak (out banka / in kasa) · bakiye: banka -100 · kasa +100',
      t1.status === 201 && legs.length === 2 && legs[0].direction === 'in' && legs[0].account_id === C && legs[1].account_id === B &&
      JSON.stringify(await bal(B)) === '["-100.00","-100.00"]' && JSON.stringify(await bal(C)) === '["100.00","100.00"]',
      JSON.stringify([t1.status, t1.body && t1.body.error, legs, await bal(B), await bal(C)]));
    const t2 = await call('POST', '/api/ledger/transfers', { from_account_id: T, to_account_id: B, transfer_date: '2026-09-03',
      amount: 3600, exchange_rate: 0.0275, amount_in: 99, exchange_rate_in: 1 });
    const l2 = (await pool.query('SELECT direction, amount::text, currency, amount_eur::text FROM ledger_entries WHERE transfer_id=$1 ORDER BY direction', [t2.body.transfer && t2.body.transfer.id])).rows;
    ok('T2 (LED-05/RAP-01) çapraz para birimi: her bacak kendi tutarı + girişte donan kuru (TRY 3600→EUR 99.00; TRY bacağı EUR 99.00)',
      t2.status === 201 && l2[1].currency === 'TRY' && l2[1].amount === '3600.00' && l2[1].amount_eur === '99.00' && l2[0].currency === 'EUR' && l2[0].amount === '99.00' &&
      JSON.stringify(await bal(T)) === '["-3600.00","-99.00"]', JSON.stringify([t2.status, t2.body && t2.body.error, l2, await bal(T)]));
    const t3 = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: C, transfer_date: '2026-09-03', amount: 100, exchange_rate: 1, amount_in: 98 });
    const t3b = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: T, transfer_date: '2026-09-03', amount: 100, exchange_rate: 1 });
    const t4 = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: B, transfer_date: '2026-09-03', amount: 1, exchange_rate: 1 });
    const t4b = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: tmp.body.id, transfer_date: '2026-09-03', amount: 1, exchange_rate: 1 });
    ok('T3 aynı para biriminde bacaklar eşit değil → 400 · çapraz para biriminde amount_in yok → 400 · aynı hesap → 400 · pasif hesap → 400',
      t3.status === 400 && t3b.status === 400 && t4.status === 400 && t4b.status === 400, JSON.stringify([t3.status, t3b.status, t4.status, t4b.status]));
    // DB seviyesi: tek bacaklı transfer commit'te düşer (DEFERRABLE).
    const one = await pool.connect(); let oneErr = '';
    try {
      await one.query('BEGIN');
      const tid = (await one.query("INSERT INTO transfers (organizer_id, transfer_date) VALUES (1,'2026-09-04') RETURNING id")).rows[0].id;
      await one.query(`INSERT INTO ledger_entries (organizer_id,account_id,direction,entry_type,entry_date,amount,currency,exchange_rate,amount_eur,transfer_id)
                       VALUES (1,$1,'out','transfer','2026-09-04',5,'EUR',1,5,$2)`, [B, tid]);
      await one.query('COMMIT');
    } catch (e) { oneErr = e.message; await one.query('ROLLBACK').catch(() => {}); } finally { one.release(); }
    ok('T5 (LED-06) DB: tek bacaklı transfer COMMIT\'te reddedilir (iki hareket tek atomik yazım)', /iki bacakli/.test(oneErr), oneErr.slice(0, 80));
    const upd = await dbErr('UPDATE ledger_entries SET entry_date = entry_date');
    const delT = await dbErr('DELETE FROM transfers');
    const trn = await dbErr('TRUNCATE ledger_entries CASCADE');
    ok('T6 değişmezlik: ledger_entries UPDATE · transfers DELETE · TRUNCATE → reddedilir', [upd, delT, trn].every(m => /degistirilemez/.test(m)),
      JSON.stringify([upd, delT, trn].map(m => m.slice(0, 40))));
    const rv = await call('POST', `/api/ledger/transfers/${t1.body.transfer.id}/reverse`);
    const rv2 = await call('POST', `/api/ledger/transfers/${t1.body.transfer.id}/reverse`);
    const rvrv = await call('POST', `/api/ledger/transfers/${rv.body.transfer && rv.body.transfer.id}/reverse`);
    ok('T7 (LED-05) ters transfer: bacaklar AYNEN tersler (kasa 0) · ikinci kez → 409 · tersin tersi → 400',
      rv.status === 201 && JSON.stringify(await bal(C)) === '["0.00","0.00"]' && rv2.status === 409 && rvrv.status === 400,
      JSON.stringify([rv.status, await bal(C), rv2.status, rvrv.status]));
    // Owner cari: sahibin cebinden gider → owner hesabı eksiye; geri ödeme = banka→owner transfer.
    const ownExp = await call('POST', '/api/ledger/expenses', { expense_type_id: SALARY, account_id: O, amount: 40, exchange_rate: 1,
      expense_date: '2026-09-05', payment_method: 'cash', counterparty: 'Courier' });
    const ownNeg = await bal(O);
    const repay = await call('POST', '/api/ledger/transfers', { from_account_id: B, to_account_id: O, transfer_date: '2026-09-06', amount: 40, exchange_rate: 1, notes: 'repay owner' });
    ok('T8 (LED-07) sahip cebinden ödedi → owner cari -40 (şirketin borcu) · banka→owner transfer → 0',
      ownExp.status === 201 && JSON.stringify(ownNeg) === '["-40.00","-40.00"]' && repay.status === 201 && JSON.stringify(await bal(O)) === '["0.00","0.00"]',
      JSON.stringify([ownExp.status, ownNeg, repay.status, await bal(O)]));

    // ══ L-3 — gider (LED-08) ══
    console.log('\n── L-3 giderler ──');
    const e1 = await call('POST', '/api/ledger/expenses', { expense_type_id: RENT, account_id: B, amount: 50, exchange_rate: 1, expo_id: 1,
      expense_date: '2026-09-07', payment_method: 'bank_transfer', counterparty: 'Hall owner', document_url: 'https://drive.google.com/x' });
    const e1row = e1.body && e1.body.ledger_entry_id ? await q1('SELECT direction, amount, entry_type FROM ledger_entries WHERE id=$1', [e1.body.ledger_entry_id]) : {};
    const statusCols = (await q1(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='expenses' AND column_name ~ 'status|approv'`)).n;
    ok('E1 (LED-08) gider → 201 + hareket (out, expense; tutar KOPYALANMADI) · onay/statü kolonu YOK',
      e1.status === 201 && e1row.direction === 'out' && e1row.entry_type === 'expense' && e1row.amount === null && statusCols === 0,
      JSON.stringify([e1.status, e1.body && e1.body.error, e1row, statusCols]));
    const e2a = await call('POST', '/api/ledger/expenses', { expense_type_id: RENT, account_id: T, currency: 'EUR', amount: 5, exchange_rate: 1, expense_date: '2026-09-07', payment_method: 'cash' });
    const e2b = await call('POST', '/api/ledger/expenses', { expense_type_id: RENT, account_id: B, amount: 5, exchange_rate: 1, expense_date: '2026-09-07', payment_method: 'cash', document_url: 'ftp://x' });
    const e2c = await call('POST', '/api/ledger/expenses', { expense_type_id: RENT, account_id: B, amount: 5, exchange_rate: 1, expense_date: '2026-09-07', payment_method: 'swift' });
    ok('E2 hesap≠gider para birimi → 400 · belge bağlantısı http(s) değil → 400 · yöntem SEM-01 dışı → 400',
      e2a.status === 400 && e2b.status === 400 && e2c.status === 400, JSON.stringify([e2a.status, e2b.status, e2c.status]));
    const before = await bal(B);
    const er = await call('POST', `/api/ledger/expenses/${e1.body.expense.id}/reverse`);
    const er2 = await call('POST', `/api/ledger/expenses/${e1.body.expense.id}/reverse`);
    ok('E3 (LED-08) düzeltme = ters gider (negatif satır + giriş hareketi) → banka +50 · ikinci kez → 409',
      er.status === 201 && Number(er.body.expense.amount) === -50 && Number((await bal(B))[0]) - Number(before[0]) === 50 && er2.status === 409,
      JSON.stringify([er.status, er.body && er.body.expense && er.body.expense.amount, before, await bal(B), er2.status]));
    const e4 = await dbErr(`INSERT INTO ledger_entries (organizer_id,account_id,direction,entry_type,entry_date,expense_id,amount,currency,exchange_rate,amount_eur)
                           VALUES (1,$1,'out','expense','2026-09-07',$2,1,'EUR',1,1)`, [B, e1.body.expense.id]);
    ok('E4 (LED-04) DB: kaynaklı harekette tutar saklanamaz (CHECK)', /amount_home_check/.test(e4), e4.slice(0, 80));
    // Gerçek gider (bütçe için kalır): expo 1, Salaries 30 + Rent 20
    await call('POST', '/api/ledger/expenses', { expense_type_id: SALARY, account_id: B, amount: 30, exchange_rate: 1, expo_id: 1, expense_date: '2026-09-08', payment_method: 'bank_transfer' });
    await call('POST', '/api/ledger/expenses', { expense_type_id: RENT, account_id: B, amount: 20, exchange_rate: 1, expo_id: 1, expense_date: '2026-09-08', payment_method: 'bank_transfer' });

    // ══ L-4 — ödeme ↔ ledger (LED-04 + KAPI-2 şartı) ══
    console.log('\n── L-4 ödeme / payout ↔ ledger ──');
    const k1 = await mkContract();
    // Eski contract-detail.html gövdesi BİREBİR (account_id / payer YOK) — ofisin varsayılan hesabı yok (Morocco).
    const p0 = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: morocco, notes: null, schedule_item_id: null }));
    ok('P1 (KAPI-2) eski form gövdesi, ofisin varsayılan hesabı YOK → 201 (400 DEĞİL) · hesapsız + uyarı · hareket yok',
      p0.status === 201 && p0.body.payment.account_id === null && p0.body.ledger_entry_id === null && /without a ledger entry/.test(p0.body.warning || ''),
      JSON.stringify([p0.status, p0.body && (p0.body.error || p0.body.warning)]));
    const bB = await bal(B);
    const p1 = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: turkey, amount: 200 }));
    const p1e = p1.body.ledger_entry_id ? await q1('SELECT account_id, direction, entry_type, amount, currency FROM ledger_entries WHERE id=$1', [p1.body.ledger_entry_id]) : {};
    ok('P2 (KAPI-2) eski form gövdesi, ofisin EUR varsayılanı VAR → 201 · account_id = varsayılan · gelir hareketi (in, tutar KOPYALANMADI) · banka +200',
      p1.status === 201 && p1.body.payment.account_id === B && p1e.account_id === B && p1e.direction === 'in' && p1e.entry_type === 'income' && p1e.amount === null && p1e.currency === null &&
      Number((await bal(B))[0]) - Number(bB[0]) === 200 && p1.body.warning === null,
      JSON.stringify([p1.status, p1.body && p1.body.error, p1e, bB, await bal(B)]));
    const p3a = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: turkey, account_id: T }));
    const p3b = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: turkey, account_id: tmp.body.id }));
    const p3c = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: turkey, account_id: 999999 }));
    ok('P3 açık hesap yanlışsa 400 (sessiz değiştirme yok): para birimi uyuşmaz · pasif · yok',
      p3a.status === 400 && /does not match/.test(p3a.body.error) && p3b.status === 400 && p3c.status === 400, JSON.stringify([p3a.body, p3b.status, p3c.status]));
    const p4 = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: kenya, account_id: C, payer: '  Panar Pipes Ltd ', amount: 70, payment_method: 'cash' }));
    const p4b = await call('POST', `/api/contracts/${k1}/payments`, payBody({ received_office_id: kenya, account_id: C, payer: '   ', amount: 1, payment_method: 'cash' }));
    ok('P4 (R7) açık hesap (kasa) + payer kırpılır · boş payer → NULL', p4.status === 201 && p4.body.payment.account_id === C && p4.body.payment.payer === 'Panar Pipes Ltd' && p4b.body.payment.payer === null,
      JSON.stringify([p4.status, p4.body && p4.body.payment && p4.body.payment.payer, p4b.body && p4b.body.payment && p4b.body.payment.payer]));
    const bB2 = await bal(B);
    const pr = await call('POST', `/api/contracts/${k1}/payments/${p1.body.payment.id}/reverse`);
    const pre = pr.body.ledger_entry_id ? await q1('SELECT account_id, direction, reverses_entry_id FROM ledger_entries WHERE id=$1', [pr.body.ledger_entry_id]) : {};
    const pr0 = await call('POST', `/api/contracts/${k1}/payments/${p0.body.payment.id}/reverse`);
    ok('P5 (TAH-01) ters ödeme hesabı DEVRALIR · ters hareket (out, aynı hesap, orijinali tersler) → banka -200 · hesapsız ödemenin tersi → hareket YOK',
      pr.status === 201 && pr.body.payment.account_id === B && pre.direction === 'out' && pre.account_id === B && pre.reverses_entry_id === p1.body.ledger_entry_id &&
      Number(bB2[0]) - Number((await bal(B))[0]) === 200 && pr0.status === 201 && pr0.body.ledger_entry_id === null && pr0.body.payment.account_id === null,
      JSON.stringify([pr.status, pre, bB2, await bal(B), pr0.status, pr0.body && pr0.body.ledger_entry_id]));
    // Kontrat devri: hareketli ödeme (p4, kasa) taşınır → kapama + kopya hareketi, kasa bakiyesi DEĞİŞMEZ.
    const cBefore = await bal(C);
    const tr = await call('POST', `/api/contracts/${k1}/transfer`, { expo_id: 2 });
    const trRows = (await pool.query(`SELECT p.id, p.amount::text, p.account_id, p.payer, le.direction, le.reverses_entry_id IS NOT NULL AS rev
         FROM payments p LEFT JOIN ledger_entries le ON le.payment_id = p.id
        WHERE p.notes LIKE 'Transferred%' AND p.account_id = $1 ORDER BY p.id`, [C])).rows;
    ok('P6 kontrat devri: kapama + kopya hesabı ve payer\'ı DEVRALIR · aynı hesapta out(ters)+in · kasa bakiyesi DEĞİŞMEDİ',
      tr.status === 201 && trRows.length === 4 && trRows.every(r => r.account_id === C && r.direction != null) &&
      trRows.filter(r => r.direction === 'out' && r.rev).length === 2 && trRows.some(r => r.payer === 'Panar Pipes Ltd') &&
      JSON.stringify(await bal(C)) === JSON.stringify(cBefore), JSON.stringify([tr.status, trRows, cBefore, await bal(C)]));
    // Payout ↔ ledger
    const ag = (await q1("INSERT INTO sales_agents (organizer_id,name,agent_type,default_commission_pct) VALUES (1,'Ledger Agent','external_freelance',10) RETURNING id")).id;
    const bB3 = await bal(B);
    const po = await call('POST', `/api/agents/${ag}/payouts`, { amount: 25, currency: 'EUR', exchange_rate: 1, payout_date: '2026-09-10', paid_office_id: turkey, payout_method: 'bank_transfer' });
    const poe = po.body.ledger_entry_id ? await q1('SELECT account_id, direction, entry_type, amount FROM ledger_entries WHERE id=$1', [po.body.ledger_entry_id]) : {};
    ok('P7 (LED-04) payout → ödeyen ofisin varsayılan hesabından çıkış (payout, tutar KOPYALANMADI) · banka -25',
      po.status === 201 && poe.account_id === B && poe.direction === 'out' && poe.entry_type === 'payout' && poe.amount === null &&
      Number(bB3[0]) - Number((await bal(B))[0]) === 25, JSON.stringify([po.status, po.body && po.body.error, poe, bB3, await bal(B)]));
    const poBad = await call('POST', `/api/agents/${ag}/payouts`, { amount: -25, currency: 'MAD', exchange_rate: 0.09, payout_date: '2026-09-11', reverses_payout_id: po.body.payout.id });
    const poRev = await call('POST', `/api/agents/${ag}/payouts`, { amount: -25, currency: 'EUR', exchange_rate: 1, payout_date: '2026-09-11', reverses_payout_id: po.body.payout.id });
    const porE = poRev.body.ledger_entry_id ? await q1('SELECT account_id, direction, reverses_entry_id FROM ledger_entries WHERE id=$1', [poRev.body.ledger_entry_id]) : {};
    ok('P8 (ODE-03) ters payout → aynı hesaba giriş, orijinali tersler · para birimi orijinalden farklı → 400',
      poBad.status === 400 && poRev.status === 201 && porE.account_id === B && porE.direction === 'in' && porE.reverses_entry_id === po.body.ledger_entry_id,
      JSON.stringify([poBad.status, poRev.status, porE]));
    const poNo = await call('POST', `/api/agents/${ag}/payouts`, { amount: 10, currency: 'EUR', exchange_rate: 1, payout_date: '2026-09-12', paid_office_id: morocco, payout_method: 'cash' });
    ok('P9 payout: ofisin varsayılanı yok → 201 + uyarı, hareket yok (mevcut akış kırılmaz)',
      poNo.status === 201 && poNo.body.ledger_entry_id === null && /without a ledger entry/.test(poNo.body.warning || ''), JSON.stringify([poNo.status, poNo.body && poNo.body.warning]));
    const k1pay = await call('GET', `/api/contracts/${k1}/payments`);
    const k1sum = await q1('SELECT COALESCE(SUM(amount_eur),0)::numeric(14,2)::text s FROM payments WHERE contract_id=$1', [k1]);
    ok('P10 (D2) kontrat paid_eur ledger\'dan BAĞIMSIZ, payments toplamı (değişmedi)', k1pay.status === 200 && String(k1pay.body.paid_eur) === k1sum.s,
      JSON.stringify([k1pay.body && k1pay.body.paid_eur, k1sum.s]));

    // ══ L-5 — expo bütçesi (LED-09) ══
    console.log('\n── L-5 expo bütçesi ──');
    const b1 = await call('POST', '/api/ledger/budgets/1', { income_target_eur: 50000, lines: [
      { category_id: officeCat.id, expense_type_id: RENT, amount_eur: 100 },
      { category_id: officeCat.id, amount_eur: 10 } ] });
    const g1 = await call('GET', '/api/ledger/budgets/1');
    const offRow = (g1.body.by_category || []).find(r => r.category === 'Office');
    const rentRow = (g1.body.by_type || []).find(r => r.expense_type === 'Rent/Maintenance/Utilities');
    ok('B1 bütçe rev1 (tip + kategori satırı) · gerçekleşen LEDGER\'dan türetilir: Office bütçe 110 / gerçekleşen 50 (30+20; terslenen 50 netlendi) · Rent 100 / 20',
      b1.status === 201 && g1.body.active.revision === 1 && offRow && offRow.budget_eur === '110.00' && offRow.actual_eur === '50.00' && offRow.variance_eur === '60.00' &&
      rentRow && rentRow.actual_eur === '20.00', JSON.stringify([b1.status, b1.body && b1.body.error, offRow, rentRow]));
    const lkStaff = await call('POST', '/api/ledger/budgets/1/lock', undefined, STAFF);
    const lkOrg = await call('POST', '/api/ledger/budgets/1/lock');
    const lkOwn = await call('POST', '/api/ledger/budgets/1/lock', undefined, OWNER);
    const lkTwice = await call('POST', '/api/ledger/budgets/1/lock', undefined, OWNER);
    // Owner değil → 409 OWNER_REQUIRED (403 DEĞİL: leena-fetch 401/403'te oturumu siler — G45).
    ok('B2 (LED-09) kilidi YALNIZ Owner atar: kullanıcı → 409 OWNER_REQUIRED · klasik oturum → 409 · Owner → 200 · ikinci kilit → 409',
      lkStaff.status === 409 && lkStaff.body.code === 'OWNER_REQUIRED' && lkOrg.status === 409 && lkOrg.body.code === 'OWNER_REQUIRED' &&
      lkOwn.status === 200 && lkTwice.status === 409 && !lkTwice.body.code, JSON.stringify([lkStaff.status, lkOrg.status, lkOwn.status, lkTwice.status]));
    const b2Staff = await call('POST', '/api/ledger/budgets/1', { lines: [{ category_id: officeCat.id, amount_eur: 999 }] }, STAFF);
    const b2Own = await call('POST', '/api/ledger/budgets/1', { income_target_eur: 60000, lines: [{ category_id: officeCat.id, expense_type_id: RENT, amount_eur: 120 }] }, OWNER);
    const hist = (await call('GET', '/api/ledger/budgets/1')).body.history;
    ok('B3 (LED-09) kilitliyken yeni revizyon: kullanıcı → 409 OWNER_REQUIRED · Owner → 201 rev2 · rev1 superseded, kilit kaydı (kim/ne zaman) KORUNDU',
      b2Staff.status === 409 && b2Staff.body.code === 'OWNER_REQUIRED' && b2Own.status === 201 && hist.length === 2 && hist[0].revision === 2 && hist[0].superseded_at === null &&
      hist[1].superseded_at !== null && hist[1].locked_at !== null && hist[1].locked_by_name != null,
      JSON.stringify([b2Staff.status, b2Own.status, hist.map(h => [h.revision, !!h.superseded_at, !!h.locked_at, h.locked_by_name])]));
    const bu1 = await dbErr('UPDATE expo_budget_lines SET amount_eur = 1');
    const bu2 = await dbErr('UPDATE expo_budgets SET income_target_eur = 1 WHERE revision = 1');
    const bu3 = await dbErr('DELETE FROM expo_budgets');
    ok('B4 (PLN-05/LED-09) DB: satır UPDATE · başlık tutarı UPDATE · başlık DELETE → reddedilir',
      /degistirilemez/.test(bu1) && /yeni revizyondur/.test(bu2) && /silinmez/.test(bu3), JSON.stringify([bu1, bu2, bu3].map(m => m.slice(0, 40))));
    await call('POST', '/api/ledger/expenses', { expense_type_id: salesCat.types[0].id, account_id: B, amount: 7, exchange_rate: 1, expo_id: 1, expense_date: '2026-09-09', payment_method: 'cash' });
    const g3 = (await call('GET', '/api/ledger/budgets/1')).body;
    ok('B5 (RAP-02) bütçe satırı olmayan kategoride gerçekleşen GÖRÜNÜR (Sales 7.00, unbudgeted 7.00)',
      g3.unbudgeted_actual_eur === '7.00' && g3.by_category.some(r => r.category === 'Sales' && r.budget_eur === null && r.actual_eur === '7.00'), JSON.stringify([g3.unbudgeted_actual_eur, g3.by_category]));

    // ══ L-6 — özet (RAP-01/02/03) ══
    console.log('\n── L-6 özet ──');
    // "Ledger öncesi" ödeme: doğrudan SQL (canlıdaki 15 satırın durumu: hesapsız, hareketsiz)
    const k2 = await mkContract({ revenue: 500, revenue_eur: 500 });
    await pool.query(`INSERT INTO payments (organizer_id,contract_id,amount,currency,exchange_rate,amount_eur,payment_method,payment_date)
                      VALUES (1,$1,600,'EUR',1,600,'cash','2026-01-05')`, [k2]);   // fazla ödeme: bakiye -100
    const k3 = await mkContract({ revenue: 800, revenue_eur: 800, status: 'Cancelled' });
    const sm = await call('GET', '/api/ledger/summary');
    const accs = (await call('GET', '/api/ledger/accounts?include_inactive=1')).body;
    const cashSum = accs.filter(a => a.account_type !== 'virtual').reduce((s, a) => s + Number(a.balance_eur), 0).toFixed(2);
    const nil = await q1(`SELECT count(*)::int n, COALESCE(SUM(amount_eur),0)::numeric(14,2)::text e FROM payments p
                           WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id)`);
    ok('S1 (RAP-01) toplam nakit = Σ banka+kasa EUR bakiyesi · owner cari ayrı · ledger dışı tahsilat SAYAÇTA (RAP-02)',
      sm.status === 200 && sm.body.total_cash_eur === cashSum && sm.body.person_accounts_eur === '0.00' &&
      sm.body.not_in_ledger.payments_count === nil.n && String(sm.body.not_in_ledger.payments_eur) === nil.e,
      JSON.stringify([sm.status, sm.body.total_cash_eur, cashSum, sm.body.person_accounts_eur, sm.body.not_in_ledger, nil]));
    const rcv = sm.body.receivables;
    ok('S2 (RAP-02 E1 / RAP-03) açık alacak ile fazla ödeme NETLEŞMEZ (overpaid 100.00 ayrı) · Cancelled + Transferred dışarıda ve SAYILIR',
      rcv.overpaid_eur === '100.00' && rcv.overpaid_contracts === 1 && rcv.excluded_cancelled === 1 && rcv.excluded_transferred === 1 && Number(rcv.open_eur) > 0,
      JSON.stringify(rcv));
    const stm = (await call('GET', `/api/agents/${ag}/statement`)).body;
    ok('S3 (MOT-01) ödenecek komisyon agent ekstresiyle AYNI kaynaktan: ekstre bakiyesi negatif → "agents owe" ile görünür, payable\'a karışmaz',
      Number(stm.balance_eur) < 0 && sm.body.commissions.agents_owe_eur === (-Number(stm.balance_eur)).toFixed(2) && sm.body.commissions.payable_eur === '0.00',
      JSON.stringify([stm.balance_eur, sm.body.commissions]));

    // ══ İNVARYANTLAR ══
    console.log('\n── İnvaryantlar ──');
    let invBal = true; const invDetail = [];
    for (const a of accs) {
      const s = await sumEntries(a.id);
      const stt = (await call('GET', `/api/ledger/accounts/${a.id}/statement`)).body;
      const last = stt.lines.length ? stt.lines[stt.lines.length - 1] : null;
      const good = s.b === String(a.balance) && s.e === String(a.balance_eur) && String(stt.closing) === s.b &&
                   (last ? String(last.running_balance) === s.b : s.b === '0.00');
      if (!good) { invBal = false; invDetail.push([a.name, s, a.balance, stt.closing, last && last.running_balance]); }
    }
    ok('I1 her hesap: Σ hareket = liste bakiyesi = ekstre kapanışı = son yürüyen bakiye (native + EUR)', invBal, JSON.stringify(invDetail));
    const legsBad = (await q1(`SELECT count(*)::int n FROM transfers t WHERE
        (SELECT count(*) FROM ledger_entries le WHERE le.transfer_id=t.id AND direction='in') <> 1 OR
        (SELECT count(*) FROM ledger_entries le WHERE le.transfer_id=t.id AND direction='out') <> 1`)).n;
    const tcount = (await q1('SELECT count(*)::int n FROM transfers')).n;
    // 4 transfer: T1 · T2 · T1'in tersi · owner geri ödemesi (başarısız denemeler kayıt bırakmaz).
    ok(`I2 (LED-06) her transfer (${tcount}) tam iki bacak: bir in + bir out · reddedilenler iz bırakmadı`, legsBad === 0 && tcount === 4, JSON.stringify([legsBad, tcount]));
    const payInv = (await q1(`SELECT
        count(*) FILTER (WHERE p.account_id IS NOT NULL AND le.id IS NULL)::int AS acct_no_entry,
        count(*) FILTER (WHERE p.account_id IS NULL AND le.id IS NOT NULL)::int AS entry_no_acct,
        count(*) FILTER (WHERE le.id IS NOT NULL AND le.account_id <> p.account_id)::int AS mismatch,
        count(*)::int AS total
        FROM payments p LEFT JOIN ledger_entries le ON le.payment_id = p.id`));
    ok('I3 ödeme: account_id dolu ⇔ hareket var · hareketin hesabı = ödemenin hesabı', payInv.acct_no_entry === 0 && payInv.entry_no_acct === 0 && payInv.mismatch === 0 && payInv.total > 5,
      JSON.stringify(payInv));
    const copied = (await q1(`SELECT count(*)::int n FROM ledger_entries WHERE transfer_id IS NULL AND num_nonnulls(amount,currency,exchange_rate,amount_eur) > 0`)).n;
    ok('I4 (LED-04) kaynaklı hareketlerin HİÇBİRİNDE tutar saklı değil', copied === 0, copied);
    // TABAN: contract 4 deseni (T35 fixture'ı) — ödeme LEDGER ÜZERİNDEN girilir, komisyon değişmez.
    const ag35 = (await q1("INSERT INTO sales_agents (organizer_id,name,default_commission_pct,agent_type) VALUES (1,'SR Base',5,'external_freelance') RETURNING id")).id;
    const c35 = await mkContract({ revenue: 18600, revenue_eur: 18600, sr: ag35 });
    await pool.query(`INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
                      VALUES ($1,1,'Item',1,17100,0,false,'EUR')`, [c35]);
    const p35 = await call('POST', `/api/contracts/${c35}/payments`, payBody({ amount: 7440, received_office_id: turkey, payment_date: '2026-07-20', payment_method: 'cash' }));
    const cd35 = (await call('GET', `/api/contracts/${c35}`)).body;
    const sr35 = ((cd35.commission && cd35.commission.roles) || []).find(r => r.role === 'sr');
    const sl35 = await q1(`WITH ${SLICE_CTES} SELECT ROUND(SUM(slice_raw),2)::text e FROM sliced WHERE contract_id=$2 AND role='sr'`, [1, c35]);
    ok('I5 TABAN sr earned 342.00 — ödeme ledger hareketiyle girildi, komisyon motoru KAYMADI (detay + SLICE_CTES)',
      p35.status === 201 && p35.body.ledger_entry_id != null && sr35 && String(sr35.earned) === '342.00' && sl35.e === '342.00',
      JSON.stringify([p35.status, p35.body && p35.body.ledger_entry_id, sr35 && sr35.earned, sl35.e]));
    // Kaynak taraması: kaçış anahtarları ürün kodunda YOK (034 L-SRC deseni).
    const scan = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/node_modules|public|tests|uploads|exports/.test(p)) walk(p); }
      else if (f.endsWith('.js') && /allow_ledger_reset/.test(fs.readFileSync(p, 'utf8'))) scan.push(path.relative(BE, p)); } };
    walk(BE);
    const runnerSet = [];
    const walk2 = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/node_modules|public|tests|uploads|exports/.test(p)) walk2(p); }
      else if (f.endsWith('.js') && /SET LOCAL ell\.migration_runner/.test(fs.readFileSync(p, 'utf8'))) runnerSet.push(path.relative(BE, p)); } };
    walk2(BE);
    ok('I6 kaynak taraması: ell.allow_ledger_reset ürün .js kodunda 0 · ell.migration_runner\'ı YALNIZ scripts/migrate.js açar',
      scan.length === 0 && JSON.stringify(runnerSet) === JSON.stringify(['scripts/migrate.js']), JSON.stringify([scan, runnerSet]));

    console.log(`\n═══ LEDGER SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally {
    await reset().catch(e => { console.error('TEMİZLİK HATASI:', e.message); fail++; });
    server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1);
  }
});
