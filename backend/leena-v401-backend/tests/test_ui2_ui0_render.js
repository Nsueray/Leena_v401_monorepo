// tests/test_ui2_ui0_render.js — PAKET UI-0 kabul 8: Finance rakamları ekranda BİREBİR (K-G: API sözleşmesi ve
// rakamlar değişmez). YEREL test DB (ell_comm_test), GERÇEK uçlar: ui0Seed tohumu → her ui2 ekranı tarayıcısız çizilir
// (helpers/ui2Render: sayfanın kendi betik sırası, gerçek fetch) → aynı uçların JSON'undaki her rakam ekran metninde
// AYNEN aranır (istemci hesaplamaz — D2 / RAP-02). TABAN contract sr earned = 342.00 ekranda.
// Taşıma öncesi / sonrası görsel + sayı karşılaştırması ayrı: tests/ui0_compare.js (Playwright, elle).
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const S = require('./helpers/ui0Seed');
const { renderPage } = require('./helpers/ui2Render');
const PORT = 46020;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body, token) {
  const opts = { method, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(ORIGIN + url, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const E = (v) => '€' + v;                       // EUR biçimi (components.js C.eur)
const M = (v, cur) => cur + ' ' + v;             // işlem birimi biçimi (C.money / C.pair)
// Beklenen dizgelerden ekranda OLMAYANLAR.
const missingIn = (text, list) => list.filter(s => s != null && !text.includes(String(s)));

const server = S.buildApp(pool).listen(PORT, async () => {
  try {
    await S.reset(pool);
    const d = await S.seed(pool, call, jwt, process.env.JWT_SECRET);
    const T = d.OWNER;
    const storage = { token: T, ui2User: JSON.stringify({ user_id: d.ownerId, email: d.ownerEmail, name: 'UI0 Owner', token_tail: T.slice(-16),
      perms: { owner: true, codes: {}, areas: [] } }) };
    const errs = {};
    const page = async (p, q) => { const r = await renderPage({ origin: ORIGIN, page: 'ui2/' + p, query: q || '', storage }); if (r.errors.length) errs[p + (q || '')] = r.errors; return r; };
    const api = async (u) => (await call('GET', u, undefined, T)).body;

    console.log('\n── TABAN + kontratlar ──');
    const c4 = await api(`/api/contracts/${d.contracts.C342}`);
    const c4p = await api(`/api/contracts/${d.contracts.C342}/payments`);
    const r1 = await page('finance-contract.html', '?contract=' + d.contracts.C342);
    const sr = c4.commission.roles.find(r => r.role === 'sr');
    ok('R1 TABAN contract sr earned = 342.00 EKRANDA (€342.00, API earned_eur ile aynı) · gelir para çifti (EUR 18600.00 + €18600.00) · ödenen / bakiye · ödeme çifti',
      sr.earned_eur === '342.00' && r1.text.includes('SR UI0 SR Base 5.00% €342.00') && missingIn(r1.text, [M(c4.revenue, c4.currency), E(c4.revenue_eur), E(c4.paid_eur),
        E(c4.balance_eur), M(c4.line_items[0].unit_price, c4.line_items[0].currency), M(c4p.payments[0].amount, 'EUR'), E(c4p.payments[0].amount_eur)]).length === 0,
      JSON.stringify([sr.earned_eur, r1.text.slice(0, 300)]));
    const ct = await api(`/api/contracts/${d.contracts.CTRY}`);
    const ctp = await api(`/api/contracts/${d.contracts.CTRY}/payments`);
    const r1b = await page('finance-contract.html', '?contract=' + d.contracts.CTRY);
    const m1b = missingIn(r1b.text, [M(ct.revenue, 'TRY'), E(ct.revenue_eur), E(ct.paid_eur), E(ct.balance_eur), M(ctp.payments[0].amount, 'TRY'), E(ctp.payments[0].amount_eur), ctp.payments[0].exchange_rate]);
    ok('R2 TRY kontratı: işlem birimi (TRY) + sunucunun EUR\'u yan yana — istemci çevirmez (RAP-01)', m1b.length === 0, JSON.stringify(m1b));
    const list = await api('/api/contracts');
    const r2 = await page('finance-contracts.html');
    const m2 = missingIn(r2.text, list.flatMap(c => [c.af_number, M(c.revenue, c.currency), E(c.revenue_eur), E(c.paid_eur), E(c.balance_eur)]));
    ok(`R3 kontrat listesi: ${list.length} kontratın gelir çifti / ödenen / bakiye rakamları ekranda`, list.length === 3 && m2.length === 0, JSON.stringify(m2));

    console.log('\n── Finance özet + hesaplar ──');
    const sm = await api('/api/ledger/summary');
    const r3 = await page('finance-summary.html');
    const rc = sm.receivables, cm = sm.commissions, nl = sm.not_in_ledger;
    const m3 = missingIn(r3.text, [E(sm.total_cash_eur), E(rc.open_eur), E(cm.payable_eur), E(sm.person_accounts_eur), E(rc.overpaid_eur), E(rc.on_hold_open_eur),
      E(cm.agents_owe_eur), E(nl.payments_eur), E(nl.payouts_eur), rc.open_contracts + ' contracts', cm.payable_agents + ' agents']
      .concat(sm.accounts.flatMap(a => [M(a.balance, a.currency), E(a.balance_eur)])));
    ok('R4 Finance özeti: 4 kart + "kept apart" sayaçları + hesap bakiyeleri (çift) API ile birebir · komisyon borcu €342.00',
      m3.length === 0 && cm.payable_eur === '342.00', JSON.stringify([m3, cm.payable_eur]));
    const accs = await api('/api/ledger/accounts?include_inactive=1');
    const r4 = await page('finance-accounts.html');
    const m4 = missingIn(r4.text, accs.flatMap(a => [a.name, M(a.balance, a.currency), E(a.balance_eur), String(a.entry_count)]));
    ok(`R5 hesap listesi (${accs.length}): bakiye çifti + hareket sayısı`, accs.length === 4 && m4.length === 0, JSON.stringify(m4));
    const stB = await api(`/api/ledger/accounts/${d.accounts.B}/statement?`);
    const r5 = await page('finance-account.html', '?account=' + d.accounts.B);
    const m5 = missingIn(r5.text, [M(stB.opening, 'EUR'), E(stB.opening_eur), M(stB.total_in, 'EUR'), M(stB.total_out, 'EUR'), M(stB.closing, 'EUR'), E(stB.closing_eur)]
      .concat(stB.lines.flatMap(l => [M(l.amount, 'EUR'), E(l.signed_amount_eur), l.running_balance])));
    ok(`R6 ekstre (EUR hesabı, ${stB.lines.length} hareket): açılış / giriş / çıkış / kapanış + her satırın tutar çifti ve yürüyen bakiyesi`, stB.lines.length >= 6 && m5.length === 0, JSON.stringify(m5));
    const stT = await api(`/api/ledger/accounts/${d.accounts.T}/statement?`);
    const r5b = await page('finance-account.html', '?account=' + d.accounts.T);
    const m5b = missingIn(r5b.text, [M(stT.closing, 'TRY'), E(stT.closing_eur)].concat(stT.lines.flatMap(l => [M(l.amount, 'TRY'), E(l.signed_amount_eur), l.running_balance, l.exchange_rate])));
    ok('R7 ekstre (TRY hesabı): TRY tutar + hareketin donmuş EUR\'u + kur', m5b.length === 0, JSON.stringify(m5b));

    console.log('\n── transfer · gider · tedarikçi · taslak · bütçe ──');
    const trs = await api('/api/ledger/transfers');
    const r6 = await page('finance-transfers.html');
    const m6 = missingIn(r6.text, trs.flatMap(t => [M(t.amount_out, t.currency_out), E(t.eur_out), M(t.amount_in, t.currency_in), E(t.eur_in)]));
    ok(`R8 transferler (${trs.length}, biri kur farklı): çıkış ve giriş bacakları ayrı çift — 300.00 → 290.00 EUR görünür`, trs.length === 2 && m6.length === 0 &&
      r6.text.includes('TRY 10000.00 €300.00') && r6.text.includes('EUR 290.00 €290.00'), JSON.stringify(m6));
    const exs = await api('/api/ledger/expenses');
    const r7 = await page('finance-expenses.html');
    const m7 = missingIn(r7.text, exs.flatMap(x => [M(x.amount, x.currency), E(x.amount_eur)]));
    ok(`R9 giderler (${exs.length}, ters kayıt dahil): tutar çifti · TRY gideri sunucunun EUR'uyla`, exs.length === 5 && m7.length === 0, JSON.stringify(m7));
    const sups = await api('/api/ledger/suppliers');
    const r8 = await page('finance-suppliers.html');
    const sh = await api(`/api/ledger/suppliers/${d.supplier}/history`);
    const r8b = await page('finance-supplier.html', '?supplier=' + d.supplier);
    const m8 = missingIn(r8.text, sups.flatMap(s => [s.name, E(s.paid_eur), String(s.expense_count)]))
      .concat(missingIn(r8b.text, [E(sh.paid_eur), E(sh.supplier.paid_eur), sh.entries + ' entries'].concat(sh.lines.flatMap(l => [M(l.amount, l.currency), E(l.signed_amount_eur)]))));
    ok('R10 tedarikçi listesi + detay: ödenen (aralık / tüm zaman) + geçmiş satırlarının imzalı EUR\'u', m8.length === 0, JSON.stringify(m8));
    const drs = await api('/api/expense-drafts?status=pending');
    const r9 = await page('finance-drafts.html');
    const partial = drs.find(x => (x.missing_fields || []).includes('amount')), full = drs.find(x => !(x.missing_fields || []).length);
    ok('R11 taslaklar: eksik alan "missing" (kırmızı bileşen) · tam taslağın tutarı ekranda', partial && full && /#\d+ manual .*missing/.test(r9.text) &&
      r9.text.includes(M(full.amount, full.currency || full.account_currency)) && /ui-miss/.test(r9.html), JSON.stringify(drs.map(x => [x.id, x.missing_fields])));
    const bg = await api('/api/ledger/budgets/1');
    const r10 = await page('finance-budget.html', '?expo=1');
    const m10 = missingIn(r10.text, [E(bg.active.income_target_eur), E(bg.income.income_eur), E(bg.income.income_in_ledger_eur), E(bg.unbudgeted_actual_eur)]
      .concat(bg.by_category.flatMap(r => [E(r.budget_eur), E(r.actual_eur), E(r.variance_eur)])).concat(bg.by_type.flatMap(r => [E(r.actual_eur), E(r.variance_eur)])));
    ok('R12 bütçe: hedef / tahsil / kategori + tip satırları (bütçe · gerçekleşen · fark) · kilit bilgisi', m10.length === 0 && /locked by/.test(r10.text), JSON.stringify(m10));

    console.log('\n── Admin · kabuk · nav ──');
    const us = await api('/api/users');
    const r11 = await page('admin-users.html');
    const r11b = await page('admin-user.html', '?user=' + d.staff);
    ok('R13 Admin: kullanıcı listesi (e-posta + durum) · kullanıcı detayı (ofis, şablon, yetki matrisi)', missingIn(r11.text, us.map(u => u.email)).length === 0 &&
      r11b.text.includes('staff' + S.SFX) && /Role & permissions/.test(r11b.text) && /ledger\.read/.test(r11b.text), JSON.stringify(missingIn(r11.text, us.map(u => u.email))));
    const rs = await page('sales.html'), ro = await page('operations.html'), rp = await page('placeholder.html', '?id=agents');
    ok('R14 Sales / Operations boş-durum ekranı · yer-tutucu (Agents) klasik ekrana bağlantı verir', /Nothing here yet/.test(rs.text) && /Nothing here yet/.test(ro.text) &&
      /ui-state-empty/.test(rs.html) && /Agents/.test(rp.text) && /href="\/sales-agents\.html"/.test(rp.html));
    ok('R15 nav.json\'dan çizilen menü: Finance ekranında 4 grup etiketi + aktif öğe · üst sekmeler Sales · Operations · Finance · Admin (Owner)',
      /data-group="executive"[\s\S]*data-group="contracts"[\s\S]*data-group="money"[\s\S]*data-group="expo-finance"/.test(r5.subnav || '') &&
      /<a class="active" href="finance-accounts\.html">/.test(r5.subnav || '') && (r3.nav || '').match(/d-main/g).length === 4, (r5.subnav || '').slice(0, 200));
    ok('R16 çizilen hiçbir ekranda betik hatası yok', Object.keys(errs).length === 0, JSON.stringify(errs));
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  try { await S.reset(pool); } catch (e) { console.error('TEMİZLİK HATASI:', e); fail++; }
  console.log(`\n═══ UI2 UI-0 RENDER SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  server.close(); await pool.end();
  process.exit(fail === 0 ? 0 : 1);
});
