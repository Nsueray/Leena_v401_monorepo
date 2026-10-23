// tests/test_ui2_ledger_pages.js — Paket 1 ui2 ekranları (DB YOK). K-G: shell.js'e ekleme
// geriye uyumlu ve TESTLİ olmalı. Gerçek shell.js vm içinde koşulur (test_ui2_current_user deseni).
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const UI2 = path.join(PUB, 'ui2');
const SHELL = fs.readFileSync(path.join(UI2, 'shell.js'), 'utf8');
// UI-0 (UI-02): nav TEK KAYNAK nav.json — tarayıcıda shell.js fetch eder; burada aynı veri hazır verilir (fixture).
const NAV = JSON.parse(fs.readFileSync(path.join(UI2, 'nav.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

function renderSubnav(domain, active) {
  const mount = { outerHTML: null };
  const ctx = { window: {}, localStorage: { getItem: () => null }, JSON,
    document: { addEventListener() {}, getElementById: (id) => (id === 'ui2-subnav' ? mount : null) } };
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx);
  ctx.window.ui2NavData = NAV;
  ctx.window.ui2RenderSubnav(domain, active);
  return mount.outerHTML;
}

console.log('\n── ui2 ledger ekranları ──');
const html = renderSubnav('finance', 'accounts');
const links = [...html.matchAll(/<a( class="active")? href="([^"]+)">([^<]+)<\/a>/g)].map(m => ({ active: !!m[1], href: m[2], label: m[3] }));
// UI-0 (Sentez 22 Eki, UI-02): "6 öğe" SAYI testi SİLİNDİ (Paket 2'de 8'e çıkmıştı). Yerine yapı ölçülür: Finance alt menüsü
// nav.json'dan, 4 grup Executive · Contracts · Money · Expo Finance (UI-01); Paket 1 ekranları kendi gruplarında; aktif öğe işaretli.
const GROUPS = [...html.matchAll(/<div class="subnav-group" data-group="([^"]+)">/g)].map(m => m[1]);
const inGroup = (g, href) => new RegExp('data-group="' + g + '">(?:(?!subnav-group).)*href="' + href.replace('.', '\\.') + '"').test(html);
ok('U1 Finance subnav nav.json\'dan 4 grup (Executive · Contracts · Money · Expo Finance) · Paket 1 ekranları kendi grubunda · aktif öğe Accounts',
  JSON.stringify(GROUPS) === '["executive","contracts","money","expo-finance"]' && inGroup('executive', 'finance-summary.html') &&
  inGroup('contracts', 'finance-contracts.html') && ['finance-accounts.html', 'finance-transfers.html', 'finance-expenses.html'].every(h => inGroup('money', h)) &&
  inGroup('expo-finance', 'finance-budget.html') && links.filter(l => l.active).map(l => l.label).join() === 'Accounts',
  JSON.stringify([GROUPS, links]));
const missing = links.filter(l => !fs.existsSync(path.join(UI2, l.href))).map(l => l.href);
ok('U2 "gösterilemeyen görünmez": her subnav bağlantısının dosyası VAR', missing.length === 0, JSON.stringify(missing));
ok('U3 Sales / Operations subnav değişmedi (boş → çubuk yok)', renderSubnav('sales', null) === '' && renderSubnav('operations', null) === '');

const PAGES = ['finance-summary.html', 'finance-accounts.html', 'finance-account.html', 'finance-transfers.html', 'finance-expenses.html', 'finance-budget.html'];
const keys = links.map(l => (l.href.match(/finance-(\w+)\.html/) || [])[1]);
const bad = [];
for (const p of PAGES) {
  const s = fs.readFileSync(path.join(UI2, p), 'utf8');
  const sub = (s.match(/UI2_SUBACTIVE='(\w+)'/) || [])[1];
  const order = ['/leena-fetch.js', 'shell.js', 'ledger-ui.js'].map(x => s.indexOf(`src="${x}"`));
  const subKey = { contract: 'contract' }[sub] || sub;
  if (!/UI2_ACTIVE='finance'/.test(s) || !links.some(l => l.href.includes(subKey)) || order.some(i => i < 0) || !(order[0] < order[1] && order[1] < order[2])) bad.push(p);
}
// UI-0: sayı parçası (keys.length === 8) silindi — UI-02 "sayı testi silinir"; bağlantıların varlığı U2'de, iki yönlü nav test_ui2_ui0'da.
ok('U4 6 ekranın hepsi: Finance + subnav\'da var olan aktif öğe · script sırası leena-fetch → shell → ledger-ui', bad.length === 0 && keys.length > 0, JSON.stringify(bad));

// Ekranların çağırdığı /api/ledger uçları router'da VAR mı (ölü bağlantı yok).
const ROUTER = fs.readFileSync(path.join(__dirname, '..', 'routes/ledger.js'), 'utf8');
const routes = [...ROUTER.matchAll(/router\.(get|post|put)\('([^']+)'/g)].map(m => m[2].split('/')[1]);
const used = new Set();
for (const f of PAGES.map(p => path.join(UI2, p)).concat(['contract-detail.html', 'agent-statement.html', 'sales-agents.html'].map(p => path.join(PUB, p)))) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\/api\/ledger\/([a-z-]+)/g)) used.add(m[1]);
}
const dead = [...used].filter(u => !routes.includes(u));
ok(`U5 ekranların kullandığı ${used.size} /api/ledger kökünün hepsi router\'da tanımlı`, dead.length === 0 && used.size >= 7, JSON.stringify([...used, dead]));

// SEM-02 / LED-02: arayüzde sabit para birimi listesi kalmadı.
const copies = [];
const scan = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f);
  if (fs.statSync(p).isDirectory()) { if (f === 'ui2') scan(p); continue; }
  if (!/\.(html|js)$/.test(f) || /backup/.test(f)) continue;
  const s = fs.readFileSync(p, 'utf8');
  if (/\[\s*'EUR'\s*,\s*'USD'/.test(s) || /<option value="NGN">/.test(s)) copies.push(path.relative(PUB, p)); } };
scan(PUB);
ok('U6 (SEM-02) public/ altında sabit para birimi listesi 0 (liste /api/ledger/currencies\'ten)', copies.length === 0, JSON.stringify(copies));

console.log(`\n═══ UI2 LEDGER PAGES SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
process.exit(fail === 0 ? 0 : 1);
