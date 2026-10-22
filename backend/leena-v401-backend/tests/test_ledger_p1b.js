// PAKET 1b testi — P1b-1 tedarikçi kaydı + P1b-3 gider taslağı. YEREL scratch DB (ell_comm_test),
// GERÇEK endpoint'ler. Kaynak = Suer ilkesi (serbest metin değil seçmeli) · LED-03/08/17/19 ·
// YZ-01/02/03 · OFS-05 (öneri kilit değildir) · D2 · S-16r · TABAN 342.00.
// Bitişte satırlar anahtarlı temizlikle silinir — sonraki suite'ler etkilenmez.
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
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
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
app.use('/api/expense-drafts', require(path.join(BE, 'routes/expenseDrafts.js')));
const PORT = 45999;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);   // klasik (organizer) oturum
let OWNER = null;                                                     // ui2 (users) oturumu — YZ-02: istemci bununla gelir
async function call(method, url, body, token = TOKEN) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
const n = async (sql, p) => Number((await q1(sql, p)).n);
async function dbErr(sql, p) { try { await pool.query(sql, p); return ''; } catch (e) { return e.message; } }

// Anahtarlı temizlik (034 deseni; ürün kodunda anahtar YOK — test_ledger I6 taraması).
async function reset() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ell.allow_ledger_reset = 'on'");
    await c.query("SET LOCAL ell.allow_line_item_reset = 'on'");
    for (const t of ['expense_drafts', 'ledger_entries', 'transfers', 'expenses', 'suppliers', 'expo_budget_lines', 'expo_budgets',
                     'payments', 'accounts', 'payment_schedule_items', 'commission_payouts', 'contract_line_items', 'contracts', 'sales_agents']) {
      await c.query(`DELETE FROM ${t}`);
    }
    await c.query('DELETE FROM organizers WHERE id = 2');
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

const server = app.listen(PORT, async () => {
  try {
    await reset();
    const turkey = (await q1("SELECT id FROM offices WHERE name='Turkey'")).id;
    let own = await q1('SELECT id FROM users WHERE organizer_id=1 AND is_owner AND is_active LIMIT 1');
    if (!own) own = await q1("INSERT INTO users (organizer_id,email,is_owner,display_role) VALUES (1,'owner-p1b@x.com',true,'Owner') RETURNING id");
    OWNER = jwt.sign({ organizer_id: 1, user_id: own.id, email: 'owner' }, process.env.JWT_SECRET);
    const B = (await call('POST', '/api/ledger/accounts', { name: 'TR Bank EUR', account_type: 'bank', currency: 'EUR', office_id: turkey, is_office_default: true })).body.id;
    const T = (await call('POST', '/api/ledger/accounts', { name: 'TR Bank TRY', account_type: 'bank', currency: 'TRY', office_id: turkey })).body.id;
    const ref = (await call('GET', '/api/ledger/reference')).body;
    const SALARY = ref.expense_categories.find(c => c.name === 'Office').types[0].id;
    const exp = (extra) => call('POST', '/api/ledger/expenses', Object.assign({ expense_type_id: SALARY, account_id: B, amount: 10,
      exchange_rate: 1, expense_date: '2026-09-01', payment_method: 'bank_transfer' }, extra));

    // ══ P1b-1 — tedarikçi kaydı ══
    console.log('\n── P1b-1 tedarikçi kaydı ──');
    const opt = await call('GET', '/api/ledger/suppliers/options');
    ok('S1 seçenekler: tür = 4 değer (expo_partners rolleriyle AYRI sözlük) · ülkeler core_countries\'ten (S-16r: koda gömülü değil)',
      opt.status === 200 && opt.body.types.join() === 'supplier,venue,contractor,other' &&
      opt.body.countries.length === (await n('SELECT count(*) n FROM core_countries')) && opt.body.countries.some(c => c.code === 'TR'),
      JSON.stringify([opt.status, opt.body && opt.body.types]));
    const sA = await call('POST', '/api/ledger/suppliers', { name: 'ACME Ltd.', supplier_type: 'supplier', country_code: 'tr', office_id: turkey, tax_number: '123', notes: 'stands' });
    const sDup = await call('POST', '/api/ledger/suppliers', { name: '  acme ltd. ', supplier_type: 'venue', country_code: 'TR' });
    const sNg = await call('POST', '/api/ledger/suppliers', { name: 'ACME Ltd.', supplier_type: 'supplier', country_code: 'NG' });
    const sV = await call('POST', '/api/ledger/suppliers', { name: 'Eko Hotel', supplier_type: 'venue', country_code: 'NG' });
    ok('S2 ekle → 201 (ülke kodu büyük harfe) · aynı ad + aynı ülke (büyük/küçük, boşluk farkı) → 409 · aynı ad başka ülke → 201',
      sA.status === 201 && sA.body.country_code === 'TR' && sDup.status === 409 && sNg.status === 201 && sV.status === 201,
      JSON.stringify([sA.status, sA.body && sA.body.country_code, sDup.status, sNg.status, sV.status]));
    const A = sA.body.id, V = sV.body.id;
    const bad = await Promise.all([
      call('POST', '/api/ledger/suppliers', { name: 'X', supplier_type: 'stand_contractor', country_code: 'TR' }),
      call('POST', '/api/ledger/suppliers', { name: 'X', supplier_type: 'supplier', country_code: 'ZZ' }),
      call('POST', '/api/ledger/suppliers', { name: 'X', supplier_type: 'supplier' }),
      call('POST', '/api/ledger/suppliers', { name: 'X', supplier_type: 'supplier', country_code: 'TR', office_id: 99999 }),
      call('POST', '/api/ledger/suppliers', { name: ' ', supplier_type: 'supplier', country_code: 'TR' })]);
    ok('S3 doğrulama: expo_partners rolü tür olamaz · bilinmeyen ülke · ülkesiz · geçersiz ofis · boş ad → 400', bad.every(r => r.status === 400),
      JSON.stringify(bad.map(r => [r.status, r.body && r.body.error])));
    const del = await dbErr('DELETE FROM suppliers WHERE id = $1', [A]);
    const org = await dbErr('UPDATE suppliers SET organizer_id = 2 WHERE id = $1', [A]);
    const tru = await dbErr('TRUNCATE suppliers CASCADE');
    ok('S4 (LED-03 deseni) tedarikçi SİLİNMEZ · kiracısı değişmez · TRUNCATE reddedilir (DB trigger)',
      /silinmez/.test(del) && /kimlik/.test(org) && /degistirilemez/.test(tru), JSON.stringify([del, org, tru]));

    const e1 = await exp({ amount: 100, expense_date: '2026-09-01', supplier_id: A });
    const e2 = await exp({ amount: 50, expense_date: '2026-09-20', supplier_id: A });
    const e3 = await exp({ amount: 7, expense_date: '2026-09-21' });
    const e4 = await exp({ amount: 3, expense_date: '2026-09-22', counterparty: 'Legacy taxi' });
    const list = (await call('GET', '/api/ledger/expenses')).body;
    const r1 = list.find(x => x.id === e1.body.expense.id), r4 = list.find(x => x.id === e4.body.expense.id);
    ok('S5 (Suer ilkesi) gider tedarikçi KAYDINA bağlanır (supplier_id + ad listede) · tedarikçisiz gider de geçer · eski counterparty metni API\'de kabul + görünür',
      [e1, e2, e3, e4].every(r => r.status === 201) && e1.body.expense.supplier_id === A && r1.supplier_name === 'ACME Ltd.' &&
      r1.counterparty === null && e3.body.expense.supplier_id === null && r4.counterparty === 'Legacy taxi' && r4.supplier_id === null,
      JSON.stringify([[e1, e2, e3, e4].map(r => r.status), r1 && [r1.supplier_id, r1.supplier_name], r4 && r4.counterparty]));
    const flt = (await call('GET', `/api/ledger/expenses?supplier_id=${A}`)).body;
    ok('S5b gider listesi tedarikçiye göre süzülür', flt.length === 2 && flt.every(x => x.supplier_id === A), JSON.stringify(flt.map(x => x.id)));

    await pool.query("INSERT INTO organizers (id, email) VALUES (2, 'org2-p1b@x.com') ON CONFLICT DO NOTHING");
    const foreign = (await q1("INSERT INTO suppliers (organizer_id, name, supplier_type, country_code) VALUES (2, 'Foreign Co', 'supplier', 'TR') RETURNING id")).id;
    const eF = await exp({ supplier_id: foreign });
    const fk = await dbErr(`INSERT INTO expenses (organizer_id, expense_type_id, amount, currency, exchange_rate, amount_eur, account_id,
      expense_date, payment_method, supplier_id) VALUES (1, $1, 1, 'EUR', 1, 1, $2, '2026-09-01', 'cash', $3)`, [SALARY, B, foreign]);
    ok('S6 (YON-07) başka kiracının tedarikçisi: API 400 "invalid supplier" · DB bileşik FK reddeder',
      eF.status === 400 && eF.body.error === 'invalid supplier' && /expenses_supplier_fkey/.test(fk), JSON.stringify([eF.status, eF.body, fk.slice(0, 80)]));

    const off = await call('PUT', `/api/ledger/suppliers/${V}`, { is_active: false });
    const eV = await exp({ supplier_id: V });
    const actList = (await call('GET', '/api/ledger/suppliers')).body.map(s => s.id);
    const allList = (await call('GET', '/api/ledger/suppliers?include_inactive=1')).body.map(s => s.id);
    ok('S7 pasifle → 200 · pasif tedarikçi yeni gidere seçilemez (400) · varsayılan liste pasifi göstermez, include_inactive gösterir',
      off.status === 200 && off.body.is_active === false && eV.status === 400 && eV.body.error === 'supplier is inactive' &&
      !actList.includes(V) && allList.includes(V), JSON.stringify([off.status, eV.status, eV.body && eV.body.error]));
    const ren = await call('PUT', `/api/ledger/suppliers/${A}`, { tax_number: null, notes: 'stand builder' });
    const badPut = await call('PUT', `/api/ledger/suppliers/${A}`, { supplier_type: 'hostess' });
    ok('S7b düzenle: vergi no temizlenir, not güncellenir → 200 · geçersiz tür → 400',
      ren.status === 200 && ren.body.tax_number === null && ren.body.notes === 'stand builder' && badPut.status === 400, JSON.stringify([ren.status, ren.body, badPut.status]));

    const rev = await call('POST', `/api/ledger/expenses/${e1.body.expense.id}/reverse`);
    const revRow = await q1('SELECT supplier_id FROM expenses WHERE id = $1', [rev.body.expense.id]);
    const hAll = (await call('GET', `/api/ledger/suppliers/${A}/history`)).body;
    const hSep = (await call('GET', `/api/ledger/suppliers/${A}/history?to=2026-09-30`)).body;
    const hMid = (await call('GET', `/api/ledger/suppliers/${A}/history?from=2026-09-10&to=2026-09-30`)).body;
    ok('S8 (D2) ödeme geçmişi ledger\'dan: ters gider tedarikçiyi devralır · tüm zaman 3 satır net €50.00 · Eylül 2 satır €150.00 · 10-30 Eyl 1 satır €50.00',
      rev.status === 201 && revRow.supplier_id === A && hAll.entries === 3 && hAll.paid_eur === '50.00' &&
      hSep.entries === 2 && hSep.paid_eur === '150.00' && hMid.entries === 1 && hMid.paid_eur === '50.00' && hMid.lines[0].expense_id === e2.body.expense.id,
      JSON.stringify([rev.status, revRow, [hAll.entries, hAll.paid_eur], [hSep.entries, hSep.paid_eur], [hMid.entries, hMid.paid_eur]]));
    const sRow = (await call('GET', '/api/ledger/suppliers')).body.find(s => s.id === A);
    const viaSql = await q1(`SELECT (-SUM(l.signed_amount_eur))::numeric(14,2)::text e FROM ledger_lines l JOIN expenses e ON e.id = l.expense_id WHERE e.supplier_id = $1`, [A]);
    ok('S8b listedeki toplam = ledger_lines\'tan SQL ile = geçmiş (tek türetme) · gider sayısı tersleri saymaz (2)',
      sRow.paid_eur === '50.00' && viaSql.e === '50.00' && sRow.expense_count === 2, JSON.stringify([sRow.paid_eur, viaSql.e, sRow.expense_count]));
    const hBad = await call('GET', `/api/ledger/suppliers/${A}/history?from=2026-02-30`);
    const h404 = await call('GET', '/api/ledger/suppliers/999999/history');
    ok('S8c geçersiz tarih → 400 · olmayan tedarikçi → 404', hBad.status === 400 && h404.status === 404, JSON.stringify([hBad.status, h404.status]));
    const stm = (await call('GET', `/api/ledger/accounts/${B}/statement`)).body;
    const stLine = stm.lines.find(l => l.expense_id === e2.body.expense.id);
    ok('S9 hesap ekstresinde gider satırı tedarikçi adını taşır', stLine && stLine.supplier_id === A && stLine.supplier_name === 'ACME Ltd.', JSON.stringify(stLine));
    const srch = (await call('GET', '/api/ledger/suppliers?q=acme%20limited')).body;
    ok('S10 ad araması (normalize + ILIKE) skorlu: "acme limited" → ACME Ltd. (TR) öne', srch.length >= 1 && srch[0].name === 'ACME Ltd.' && srch[0].score > 0,
      JSON.stringify(srch.map(s => [s.id, s.name, s.score])));
    const cols = await n(`SELECT count(*) n FROM information_schema.columns WHERE table_name IN ('suppliers','expense_drafts') AND column_name ~ 'balance|total|paid'`);
    ok('S11 (D2) suppliers / expense_drafts\'ta bakiye/toplam kolonu YOK', cols === 0, cols);

    // ══ P1b-3 — gider taslağı (LED-19, YZ-01) ══
    console.log('\n── P1b-3 gider taslağı ──');
    const led0 = await n('SELECT count(*) n FROM ledger_entries');
    const ex0 = await n('SELECT count(*) n FROM expenses');
    const d1 = await call('POST', '/api/expense-drafts', { source: 'ai', amount: 80, currency: 'EUR', supplier_name: 'acme ltd',
      notes: 'invoice 4411', confidence_note: 'amount read from photo; date unreadable' }, OWNER);
    const D1 = d1.body && d1.body.draft;
    ok('D1 yapay zeka taslağı → 201 · eksik alan listesi sunucuda (5 alan) · tedarikçi ÖNERİSİ (ACME, skor 1)',
      d1.status === 201 && JSON.stringify(D1.missing_fields) === JSON.stringify(['expense_type_id', 'account_id', 'exchange_rate', 'expense_date', 'payment_method']) &&
      D1.supplier_match_id === A && Number(D1.supplier_match_score) === 1 && D1.status === 'pending',
      JSON.stringify([d1.status, D1 && [D1.missing_fields, D1.supplier_match_id, D1.supplier_match_score]]));
    ok('D2 (LED-19 / YZ-01) taslak ledger\'a da gidere de YAZMAZ', (await n('SELECT count(*) n FROM ledger_entries')) === led0 && (await n('SELECT count(*) n FROM expenses')) === ex0);
    const vb = await Promise.all([
      call('POST', '/api/expense-drafts', { amount: 5 }),
      call('POST', '/api/expense-drafts', { source: 'bot', amount: 5 }),
      call('POST', '/api/expense-drafts', { source: 'ai', payment_method: 'swift' }),
      call('POST', '/api/expense-drafts', { source: 'ai', amount: -5 }),
      call('POST', '/api/expense-drafts', { source: 'ai', expense_date: '2026-13-01' }),
      call('POST', '/api/expense-drafts', { source: 'ai', account_id: 999999 }),
      call('POST', '/api/expense-drafts', { source: 'ai', expo_id: 999 }),
      call('POST', '/api/expense-drafts', { source: 'ai', document_url: 'ftp://x' })]);
    ok('D3 biçimce yanlış değer "eksik" sayılmaz → 400 (source yok / yanlış · yöntem · eksi tutar · tarih · olmayan hesap · başka expo · URL)',
      vb.every(r => r.status === 400), JSON.stringify(vb.map(r => [r.status, r.body && r.body.error])));
    const d2 = await call('POST', '/api/expense-drafts', { source: 'import', expense_type_id: SALARY, account_id: B, amount: 25, exchange_rate: 1,
      expense_date: '2026-10-01', payment_method: 'cash', supplier_name: 'Unknown Vendor XYZ' });
    const pend = (await call('GET', '/api/expense-drafts')).body.map(d => d.id);
    const missL = (await call('GET', '/api/expense-drafts?completeness=missing')).body.map(d => d.id);
    const compL = (await call('GET', '/api/expense-drafts?completeness=complete')).body.map(d => d.id);
    const badQ = await call('GET', '/api/expense-drafts?status=done');
    ok('D4 liste: varsayılan pending · eksikli/tam süzgeci ayırır · eşleşmeyen tedarikçi önerisi NULL · yanlış status → 400',
      pend.includes(D1.id) && pend.includes(d2.body.draft.id) && missL.includes(D1.id) && !missL.includes(d2.body.draft.id) &&
      compL.includes(d2.body.draft.id) && !compL.includes(D1.id) && d2.body.draft.supplier_match_id === null && d2.body.draft.missing_fields.length === 0 && badQ.status === 400,
      JSON.stringify([pend, missL, compL, d2.body.draft && d2.body.draft.supplier_match_id, badQ.status]));

    const a0 = await call('POST', `/api/expense-drafts/${D1.id}/accept`, {}, OWNER);
    const st0 = await q1('SELECT status FROM expense_drafts WHERE id = $1', [D1.id]);
    ok('D5 eksik alanlar doldurulmadan kabul → 400 (gider yolunun KENDİ mesajı) · taslak pending kalır · gider yok',
      a0.status === 400 && a0.body.error === 'expense_type_id is required.' && st0.status === 'pending' && (await n('SELECT count(*) n FROM expenses')) === ex0,
      JSON.stringify([a0.status, a0.body, st0]));
    const aT = await call('POST', `/api/expense-drafts/${D1.id}/accept`, { expense_type_id: SALARY, account_id: T, exchange_rate: 0.03,
      expense_date: '2026-10-02', payment_method: 'bank_transfer' }, OWNER);
    const direct = await call('POST', '/api/ledger/expenses', { expense_type_id: SALARY, account_id: T, currency: 'EUR', amount: 80, exchange_rate: 0.03,
      expense_date: '2026-10-02', payment_method: 'bank_transfer' });
    ok('D6 AYNI doğrulama: taslağın EUR\'su TRY hesabına → kabul ile doğrudan POST aynı 400 mesajı (LED-11)',
      aT.status === 400 && direct.status === 400 && aT.body.error === direct.body.error && /does not match/.test(aT.body.error),
      JSON.stringify([aT.body, direct.body]));
    const a1 = await call('POST', `/api/expense-drafts/${D1.id}/accept`, { expense_type_id: SALARY, account_id: B, exchange_rate: 1,
      expense_date: '2026-10-02', payment_method: 'bank_transfer', supplier_id: A }, OWNER);
    const E = a1.body && a1.body.expense;
    const le = E ? await q1('SELECT id, direction, account_id FROM ledger_entries WHERE expense_id = $1', [E.id]) : null;
    const dAcc = await q1('SELECT status, expense_id, reviewed_by::text rb, reviewed_at IS NOT NULL rat, amount::text amt, account_id FROM expense_drafts WHERE id = $1', [D1.id]);
    ok('D7 kabul → 201: gider doğdu (taslağın tutarı 80 + insanın tamamladıkları + seçilen tedarikçi) · ledger "out" hareketi · taslak accepted + expense_id + kim/ne zaman',
      a1.status === 201 && E.amount === '80.00' && E.supplier_id === A && E.notes === 'invoice 4411' && le && le.direction === 'out' && le.account_id === B &&
      a1.body.ledger_entry_id === le.id && dAcc.status === 'accepted' && dAcc.expense_id === E.id && dAcc.rb === own.id && dAcc.rat,
      JSON.stringify([a1.status, a1.body && (a1.body.error || [E.amount, E.supplier_id]), le, dAcc]));
    ok('D7b taslak İÇERİĞİ değişmedi (ne önerildiyse o: hesap NULL kaldı — düzeltme gider satırında)', dAcc.amt === '80.00' && dAcc.account_id === null, JSON.stringify(dAcc));
    const a2 = await call('POST', `/api/expense-drafts/${D1.id}/accept`, {}, OWNER);
    const r2 = await call('POST', `/api/expense-drafts/${D1.id}/reject`, undefined, OWNER);
    ok('D8 karar bir kez: kabul edilmişi tekrar kabul / ret → 409', a2.status === 409 && r2.status === 409, JSON.stringify([a2.status, r2.status]));

    const d3 = await call('POST', '/api/expense-drafts', { source: 'ai', expense_type_id: SALARY, account_id: B, amount: 12, exchange_rate: 1,
      expense_date: '2026-10-03', payment_method: 'cash', supplier_name: 'ACME LTD' });
    const a3 = await call('POST', `/api/expense-drafts/${d3.body.draft.id}/accept`, {});
    ok('D9 (OFS-05) otomatik atama YOK: öneri ACME olsa da kabul gövdesinde supplier_id yoksa gider tedarikçisiz doğar',
      d3.body.draft.supplier_match_id === A && a3.status === 201 && a3.body.expense.supplier_id === null, JSON.stringify([d3.body.draft.supplier_match_id, a3.status, a3.body.expense && a3.body.expense.supplier_id]));
    const led1 = await n('SELECT count(*) n FROM ledger_entries');
    const rj = await call('POST', `/api/expense-drafts/${d2.body.draft.id}/reject`, undefined, OWNER);
    const rjAgain = await call('POST', `/api/expense-drafts/${d2.body.draft.id}/reject`, undefined, OWNER);
    const rjRow = await q1('SELECT status, expense_id, reviewed_at IS NOT NULL rat FROM expense_drafts WHERE id = $1', [d2.body.draft.id]);
    ok('D10 ret → 200 rejected (satır SİLİNMEZ) · ledger\'a dokunmaz · ikinci ret → 409',
      rj.status === 200 && rjRow.status === 'rejected' && rjRow.expense_id === null && rjRow.rat && (await n('SELECT count(*) n FROM ledger_entries')) === led1 && rjAgain.status === 409,
      JSON.stringify([rj.status, rjRow, rjAgain.status]));
    const d4 = (await call('POST', '/api/expense-drafts', { source: 'manual', amount: 9 })).body.draft;
    const upd = await dbErr('UPDATE expense_drafts SET amount = 10 WHERE id = $1', [d4.id]);
    const updAcc = await dbErr("UPDATE expense_drafts SET status = 'pending', expense_id = NULL, reviewed_at = NULL WHERE id = $1", [D1.id]);
    const delD = await dbErr('DELETE FROM expense_drafts WHERE id = $1', [d4.id]);
    const sneak = await dbErr("UPDATE expense_drafts SET status = 'rejected', reviewed_at = now(), amount = 99 WHERE id = $1", [d4.id]);
    ok('D11 (DB trigger) taslak içeriği değişmez · karar geri alınmaz · silinmez · ret sırasında içerik değiştirilemez',
      /degistirilemez/.test(upd) && /karar verilmis/.test(updAcc) && /silinmez/.test(delD) && /degistirilemez/.test(sneak), JSON.stringify([upd, updAcc, delD, sneak]));
    const g = await call('GET', `/api/expense-drafts/${D1.id}`);
    const g404 = await call('GET', '/api/expense-drafts/999999');
    const noTok = await fetch(`http://127.0.0.1:${PORT}/api/expense-drafts`);
    ok('D12 tek taslak 200 (karar + gider bağı görünür) · olmayan 404 · token yok 401', g.status === 200 && g.body.status === 'accepted' && g.body.expense_id === E.id &&
      g404.status === 404 && noTok.status === 401, JSON.stringify([g.status, g404.status, noTok.status]));
    const aiCols = await n(`SELECT count(*) n FROM information_schema.columns WHERE column_name = 'is_ai' AND table_name IN ('users','expense_drafts')`);
    const drCreator = await q1('SELECT created_by::text cb FROM expense_drafts WHERE id = $1', [D1.id]);
    ok('D13 (YZ-02) is_ai bayrağı YOK · yapay zeka taslağı şirket hesabının (Owner) kimliğiyle kayıtlı', aiCols === 0 && drCreator.cb === own.id, JSON.stringify([aiCols, drCreator]));

    // ══ Değişmezler + TABAN ══
    console.log('\n── Değişmezler + TABAN ──');
    const inv = await q1(`SELECT
        count(*) FILTER (WHERE status = 'accepted' AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.expense_id = d.expense_id))::int AS acc_no_entry,
        count(*) FILTER (WHERE status <> 'accepted' AND expense_id IS NOT NULL)::int AS bad_link
        FROM expense_drafts d`);
    const balB = (await call('GET', '/api/ledger/accounts')).body.find(a => a.id === B);
    const sumB = await q1('SELECT COALESCE(SUM(signed_amount),0)::numeric(14,2)::text b FROM ledger_lines WHERE account_id = $1', [B]);
    const expNoEntry = await n('SELECT count(*) n FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.expense_id = e.id)');
    ok('I1 kabul edilen her taslağın gideri ledger\'da · bağ yalnız kabulde · hesap bakiyesi = Σ hareket · hareketsiz gider 0',
      inv.acc_no_entry === 0 && inv.bad_link === 0 && String(balB.balance) === sumB.b && expNoEntry === 0, JSON.stringify([inv, balB.balance, sumB.b, expNoEntry]));
    // TABAN: contract 4 deseni (T35 fixture'ı) — ödeme ledger üzerinden; tedarikçi/taslak işi komisyonu değiştirmez.
    const ag = (await q1("INSERT INTO sales_agents (organizer_id,name,default_commission_pct,agent_type) VALUES (1,'SR Base P1b',5,'external_freelance') RETURNING id")).id;
    const c35 = (await q1(`INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
       VALUES (1,1,'AF-P1B-35','Acme','2026-01-01',18600,'EUR',1,18600,'Active',$1) RETURNING id`, [ag])).id;
    await pool.query(`INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
                      VALUES ($1,1,'Item',1,17100,0,false,'EUR')`, [c35]);
    const p35 = await call('POST', `/api/contracts/${c35}/payments`, { amount: 7440, currency: 'EUR', exchange_rate: 1, payment_method: 'cash',
      payment_date: '2026-07-20', received_office_id: turkey });
    const sl35 = await q1(`WITH ${SLICE_CTES} SELECT ROUND(SUM(slice_raw),2)::text e FROM sliced WHERE contract_id=$2 AND role='sr'`, [1, c35]);
    ok('T35 TABAN sr earned 342.00 — Paket 1b şemasında, ödeme ledger hareketiyle, KAYMADI', p35.status === 201 && p35.body.ledger_entry_id != null && sl35.e === '342.00',
      JSON.stringify([p35.status, p35.body && p35.body.ledger_entry_id, sl35.e]));

    console.log(`\n═══ LEDGER P1b SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally {
    await reset().catch(e => { console.error('TEMİZLİK HATASI:', e.message); fail++; });
    server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1);
  }
});
