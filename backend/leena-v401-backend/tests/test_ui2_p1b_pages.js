// tests/test_ui2_p1b_pages.js — Paket 1b ui2 ekranları (DB YOK). Ekranlar Expenses altında yaşar
// (subnav'a öğe EKLENMEDİ — Paket 1'in 6'lı subnav testi aynen geçer); oraya sayfa içi bağlantıyla gidilir.
const path = require('path');
const fs = require('fs');
const PUB = path.join(__dirname, '..', 'public');
const UI2 = path.join(PUB, 'ui2');
const read = (f) => fs.readFileSync(path.join(UI2, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

console.log('\n── ui2 Paket 1b ekranları ──');
const PAGES = ['finance-suppliers.html', 'finance-supplier.html', 'finance-drafts.html'];
const bad = [];
for (const p of PAGES) {
  if (!fs.existsSync(path.join(UI2, p))) { bad.push(p + ' yok'); continue; }
  const s = read(p);
  const order = ['/leena-fetch.js', 'shell.js', 'ledger-ui.js'].map(x => s.indexOf(`src="${x}"`));
  if (!/UI2_ACTIVE='finance'/.test(s) || !/UI2_SUBACTIVE='expenses'/.test(s) || order.some(i => i < 0) || !(order[0] < order[1] && order[1] < order[2])) bad.push(p);
}
ok('P1 3 yeni ekran var · Finance > Expenses altında · script sırası leena-fetch → shell → ledger-ui', bad.length === 0, JSON.stringify(bad));

const exp = read('finance-expenses.html');
ok('P2 (Suer ilkesi) gider formunda serbest metin karşı taraf alanı YOK · tedarikçi datalist\'ten seçilir + "New supplier" kısayolu',
  !/name="counterparty"/.test(exp) && /list="sup-list"/.test(exp) && /<datalist id="sup-list">/.test(exp) && /id="new-sup-btn"/.test(exp),
  JSON.stringify([/name="counterparty"/.test(exp), /list="sup-list"/.test(exp)]));
ok('P3 gider ekranından tedarikçi listesine ve bekleyen taslaklara bağlantı var (görünmeyen ekran yok)',
  /href="finance-suppliers\.html"/.test(exp) && /href="finance-drafts\.html"/.test(exp));

// Ekranların çağırdığı uçlar router'larda VAR mı (ölü bağlantı yok).
const LROUTER = fs.readFileSync(path.join(__dirname, '..', 'routes/ledger.js'), 'utf8');
const lroots = [...LROUTER.matchAll(/router\.(get|post|put)\('([^']+)'/g)].map(m => m[2].split('/')[1]);
const DROUTER = fs.readFileSync(path.join(__dirname, '..', 'routes/expenseDrafts.js'), 'utf8');
const droutes = [...DROUTER.matchAll(/router\.(get|post|put)\('([^']+)'/g)].map(m => m[1] + ' ' + m[2]);
const usedL = new Set(), usedD = new Set();
for (const f of PAGES.concat(['finance-expenses.html', 'finance-account.html'])) {
  const s = read(f);
  for (const m of s.matchAll(/\/api\/ledger\/([a-z-]+)/g)) usedL.add(m[1]);
  if (/'\/api\/expense-drafts\?/.test(s)) usedD.add('get /');
  if (/'POST', '\/api\/expense-drafts'/.test(s)) usedD.add('post /');
  if (/\/accept'/.test(s)) usedD.add('post /:id/accept');
  if (/\/reject'/.test(s)) usedD.add('post /:id/reject');
}
const deadL = [...usedL].filter(u => !lroots.includes(u));
const deadD = [...usedD].filter(u => !droutes.includes(u));
ok(`P4 kullanılan /api/ledger kökleri (${usedL.size}) ve /api/expense-drafts uçları (${usedD.size}) router'larda tanımlı`,
  deadL.length === 0 && deadD.length === 0 && usedL.has('suppliers') && usedD.size === 4, JSON.stringify([[...usedL], deadL, [...usedD], deadD]));

const dr = read('finance-drafts.html');
const css = read('styles/ledger.css');
ok('P5 taslak ekranı eksik alanı KIRMIZI gösterir (liste "missing" + formda çerçeve) · stiller ledger.css\'te tanımlı',
  /lg-miss/.test(dr) && /lg-missing/.test(dr) && /\.lg-miss\s*\{[^}]*--dang/.test(css) && /\.lg-missing[^{]*\{[^}]*--dang/.test(css));
ok('P6 (OFS-05) kabul formunda tedarikçi SEÇMELİ ve "— no supplier —" seçeneği var (öneri atama değil)',
  /name="supplier_id"/.test(dr) && /— no supplier —/.test(dr) && /supplier_match_id/.test(dr));
ok('P7 tedarikçi detayı geçmişi SUNUCUDAN alır (istemci toplamaz) · tarih süzgeci var',
  /\/history/.test(read('finance-supplier.html')) && /name="from"/.test(read('finance-supplier.html')) && !/reduce\(/.test(read('finance-supplier.html')));

console.log(`\n═══ UI2 P1b PAGES SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
process.exit(fail === 0 ? 0 : 1);
