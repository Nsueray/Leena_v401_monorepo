// tests/test_ui2_ui0.js — PAKET UI-0 (Sentez 22 Eki, kütük UI-01..06) — DB YOK.
// N: nav.json TEK KAYNAK + iki yönlü test (UI-02) · G: giriş → Finance özet, Sales/Operations boş-durum (UI-06)
// K: bileşenler YALNIZ components.js'ten — sayfada kopya bileşen = KIRMIZI; para çifti; özet kartı (UI-03)
// H: tokens — ui2'de tokens.css dışında sabit renk 0 (UI-04) · T: /ui2/_sablon/ dört şablon × üç durum.
// Gerçek shell.js / components.js vm içinde koşulur (test_ui2_current_user deseni). Rakamların ekranda
// birebir görünmesi DB'li testte: tests/test_ui2_ui0_render.js.
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const BE = path.join(__dirname, '..');
const PUB = path.join(BE, 'public');
const UI2 = path.join(PUB, 'ui2');
const read = (f) => fs.readFileSync(path.join(UI2, f), 'utf8');
const NAV = JSON.parse(read('nav.json'));
const SHELL = read('shell.js');
const COMP = read('components.js');
const CSS = read('styles/signal.css');
const TOKENS = read('styles/tokens.css');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

function walk(dir, pred, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, pred, out); else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(UI2, p).split(path.sep).join('/');
const HTML = walk(UI2, p => p.endsWith('.html')).map(rel).sort();
const strip = (p) => String(p).replace(/[?#].*$/, '');
const ITEM = Object.fromEntries(NAV.items.map(it => [it.id, it]));
const REGISTRY = [...fs.readFileSync(path.join(BE, 'migrations/044_permissions.sql'), 'utf8').matchAll(/\('([a-z_]+\.[a-z]+)',\s+'/g)].map(m => m[1]);

// shell.js'i vm'de yükler (nav verisi tarayıcıda fetch edilir; burada hazır verilir).
function loadShell(store) {
  const mounts = { 'ui2-nav': { outerHTML: null }, 'ui2-subnav': { outerHTML: null } };
  const w = {};
  const ctx = { window: w, JSON, localStorage: { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem() {} },
    document: { addEventListener() {}, getElementById: (id) => mounts[id] || null } };
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx);
  w.ui2NavData = NAV;
  return { w, mounts };
}
function loadComponents() {
  const ctx = { window: {}, document: { addEventListener() {} } };
  vm.createContext(ctx);
  vm.runInContext(COMP, ctx);
  return ctx.window.ui2C;
}
const CLASSIC = { token: 'x.y.z', organizer: JSON.stringify({ name: 'Elan Expo' }), organizerId: '1' };

console.log('\n── N: nav.json tek kaynak + iki yönlü (UI-02) ──');
const KEYS = ['id', 'domain', 'group', 'label', 'path', 'status', 'permission'];
const DOMAINS = NAV.domains.map(d => d.id);
const schemaBad = [];
const ids = new Set();
for (const it of NAV.items) {
  if (!KEYS.every(k => Object.prototype.hasOwnProperty.call(it, k))) schemaBad.push(it.id + ': alan eksik');
  if (ids.has(it.id)) schemaBad.push(it.id + ': id tekrar'); ids.add(it.id);
  if (!['live', 'placeholder'].includes(it.status)) schemaBad.push(it.id + ': status ' + it.status);
  if (!DOMAINS.includes(it.domain) && it.domain !== 'shell') schemaBad.push(it.id + ': domain ' + it.domain);
  if (it.group != null) { const g = NAV.groups.find(x => x.id === it.group); if (!g || g.domain !== it.domain) schemaBad.push(it.id + ': group ' + it.group); }
  if (it.parent != null) { const p = ITEM[it.parent]; if (!p || p.domain !== it.domain || p.parent) schemaBad.push(it.id + ': parent ' + it.parent); }
  if (it.permission != null && !REGISTRY.includes(it.permission)) schemaBad.push(it.id + ': izin ' + it.permission);
}
for (const d of NAV.domains) {
  if (!['live', 'placeholder'].includes(d.status)) schemaBad.push('domain ' + d.id + ': status');
  if (d.permission != null && !REGISTRY.includes(d.permission)) schemaBad.push('domain ' + d.id + ': izin ' + d.permission);
}
ok(`N1 nav.json şeması: her öğede id · domain · group · label · path · status (live|placeholder) · permission; id tekil; grup/ebeveyn/domain tutarlı; izin kodları 044 kayıt defterinde (${REGISTRY.length} kod)`,
  schemaBad.length === 0 && REGISTRY.length >= 18, JSON.stringify(schemaBad));
const NAV_PATHS = NAV.items.map(it => strip(it.path)).concat(NAV.domains.map(d => strip(d.path)));
const deadNav = [...new Set(NAV_PATHS)].filter(p => !fs.existsSync(path.join(UI2, p)));
ok(`N2 iki yönlü (a): nav'daki her yol VAR (${new Set(NAV_PATHS).size} yol)`, deadNav.length === 0, JSON.stringify(deadNav));
const notInNav = HTML.filter(f => !NAV_PATHS.includes(f));
ok(`N3 iki yönlü (b): ui2'deki her sayfa nav'da (${HTML.length} HTML, alt klasörler dahil)`, notInNav.length === 0 && HTML.length >= 25, JSON.stringify(notInNav));
const fg = NAV.groups.filter(g => g.domain === 'finance');
const inG = (g) => NAV.items.filter(it => it.group === g).map(it => strip(it.path));
ok('N4 (UI-01) Finance alt menüsü 4 grup: Executive (özet) · Contracts (kontratlar, komisyonlar, agent\'lar) · Money (hesaplar, ekstre, transferler, giderler, tedarikçiler, gider taslakları) · Expo Finance (bütçe) · Intelligence YOK',
  JSON.stringify(fg.map(g => g.label)) === '["Executive","Contracts","Money","Expo Finance"]' &&
  inG('executive').includes('finance-summary.html') &&
  ['finance-contracts.html', 'finance-contract.html'].every(p => inG('contracts').includes(p)) &&
  ['commissions', 'agents'].every(id => ITEM[id] && ITEM[id].group === 'contracts' && ITEM[id].status === 'placeholder') &&
  ['finance-accounts.html', 'finance-account.html', 'finance-transfers.html', 'finance-expenses.html', 'finance-suppliers.html', 'finance-drafts.html'].every(p => inG('money').includes(p)) &&
  /draft/i.test(ITEM.drafts.label) && inG('expo-finance').includes('finance-budget.html') && !NAV.items.some(it => /intelligence/i.test(it.label + it.id)),
  JSON.stringify(fg.map(g => [g.label, inG(g.id)])));
const declBad = [];
for (const it of NAV.items.filter(x => x.domain === 'finance' || x.domain === 'admin')) {
  if (it.status === 'placeholder') continue;
  const s = read(strip(it.path));
  const act = (s.match(/UI2_ACTIVE='(\w+)'/) || [])[1], sub = (s.match(/UI2_SUBACTIVE='([\w-]+)'/) || [])[1];
  if (act !== it.domain || ![it.id, it.parent].includes(sub)) declBad.push(it.path + ' ' + act + '/' + sub);
}
for (const d of NAV.domains) if ((read(strip(d.path)).match(/UI2_ACTIVE='(\w+)'/) || [])[1] !== d.id) declBad.push('domain ' + d.path);
ok('N5 her ekran nav.json\'daki yerini bildirir: UI2_ACTIVE = domain · UI2_SUBACTIVE = kendi id\'si ya da ebeveyni (alt sayfa ebeveyni etkin yapar)', declBad.length === 0, JSON.stringify(declBad));
const leaked = NAV.items.filter(it => it.domain !== 'shell').flatMap(it => [strip(it.path), it.label]).filter(x => SHELL.includes("'" + x + "'"));
ok('N6 shell.js YALNIZ OKUR: nav içeriği (yol / etiket) shell.js\'te yok · kaynak /ui2/nav.json',
  leaked.length === 0 && /NAV_URL = '\/ui2\/nav\.json'/.test(SHELL) && !/UI2_SUBNAV|UI2_DOMAINS/.test(SHELL), JSON.stringify(leaked));
const ph = NAV.items.filter(it => it.status === 'placeholder');
const phBad = ph.filter(it => it.path !== 'placeholder.html?id=' + it.id || (it.legacy && !fs.existsSync(path.join(PUB, it.legacy))));
const phPage = read('placeholder.html');
ok(`N7 yer-tutucu öğeler (${ph.length}) ölü bağlantı değil: placeholder.html?id=<id> · bugünkü klasik ekran (legacy) VAR · sayfa öğeyi nav.json'dan okur`,
  ph.length >= 2 && phBad.length === 0 && /UI2_SUBACTIVE=new URLSearchParams\(location\.search\)\.get\('id'\)/.test(phPage) && /ui2LoadNav\(\)/.test(phPage) && /C\.state\('empty'/.test(phPage),
  JSON.stringify(phBad.map(x => x.id)));
const { w: wc, mounts: mc } = loadShell(CLASSIC);
wc.ui2RenderNav('finance'); wc.ui2RenderSubnav('finance', 'summary');
const placeholderLinks = [...(mc['ui2-subnav'].outerHTML || '').matchAll(/<a class="ph[^"]*" href="([^"]+)"[^>]*>/g)].map(m => m[1]);
ok('N8 yer-tutucu öğe menüde "soon" işaretli ve yer-tutucu ekranına gider (canlı öğeden ayırt edilir)',
  JSON.stringify(placeholderLinks) === JSON.stringify(ph.filter(x => x.domain === 'finance').map(x => x.path)) && /subnav-soon/.test(mc['ui2-subnav'].outerHTML),
  JSON.stringify(placeholderLinks));

console.log('\n── G: giriş → Finance özet · Sales/Operations boş-durum (UI-06) ──');
const land1 = loadShell(CLASSIC).w.ui2Landing();
const noFin = { token: 'a.b.c' + 'x'.repeat(16) };
noFin.ui2User = JSON.stringify({ user_id: 'u', email: 'e', token_tail: noFin.token.slice(-16), perms: { owner: false, codes: { 'users.read': 'all' }, areas: ['admin'] } });
const land2 = loadShell(noFin).w.ui2Landing();
ok('G1 giriş hedefi nav.json\'dan: landing = finance → finance-summary.html (klasik + Finance\'ı gören oturum) · Finance\'ı göremeyen kullanıcı ilk görünen alanına (Admin) · index.html bunu kullanır · ui2 login → index.html',
  NAV.landing === 'finance' && NAV.domains.find(d => d.id === 'finance').path === 'finance-summary.html' && land1 === 'finance-summary.html' &&
  land2 === 'admin-users.html' && /location\.replace\(window\.ui2Landing\(\)\)/.test(read('index.html')) && /var PANEL = 'index\.html'/.test(read('login.html')),
  JSON.stringify([land1, land2]));
const tabsHtml = mc['ui2-nav'].outerHTML || '';
const emptyBad = ['sales', 'operations'].filter(id => {
  const d = NAV.domains.find(x => x.id === id), s = read(d.path);
  return d.status !== 'placeholder' || !/C\.state\('empty'/.test(s) || /\/api\//.test(s) || !tabsHtml.includes("location.href='" + d.path + "'");
});
ok('G2 Sales / Operations sekmeleri ölü bağlantı değil: boş-durum ekranına gider (C.state empty, API çağrısı yok) · nav.json status = placeholder · alt menü yok',
  emptyBad.length === 0 && !NAV.groups.some(g => g.domain === 'sales' || g.domain === 'operations'), JSON.stringify(emptyBad));

console.log('\n── K: bileşenler YALNIZ components.js\'ten (UI-03) ──');
const SCAN = HTML.concat(['ledger-ui.js', 'admin-ui.js']);
const RAW_TAG = /<(table|thead|tbody|tfoot|tr|td|th|form|input|select|textarea|button|label|style)\b/i;
const copies = [];
for (const f of SCAN) {
  const s = read(f);
  const hits = [];
  if (RAW_TAG.test(s)) hits.push('etiket ' + s.match(RAW_TAG)[0]);
  const cls = [...s.matchAll(/class="([^"]*)"/g)].map(m => m[0]).filter(c => !/^class="ui-main( narrow| auth)?"$/.test(c));
  if (cls.length) hits.push('class: ' + cls.slice(0, 3).join(' '));
  if (/\sstyle="/.test(s) || /\.style\./.test(s)) hits.push('style');
  if (hits.length) copies.push(f + ' → ' + hits.join(' · '));
}
ok(`K1 BİLEŞEN-KOPYA TESTİ: ${SCAN.length} dosyada (tüm ui2 HTML + ledger-ui + admin-ui) ham tablo/form/düğme/etiket YOK, bileşen sınıfı YOK (yalnız sayfa çerçevesi <main class="ui-main">), style= YOK`,
  copies.length === 0, JSON.stringify(copies));
const shellClasses = [...new Set([...SHELL.matchAll(/class="([^"']+)"/g)].flatMap(m => m[1].split(/\s+/)))];
const NAV_CLASSES = ['brand', 'eliza-mark', 'eliza-glyph', 'eliza-word', 'on-dark', 'ui-nav-error', 'topnav', 'domain-tabs', 'spacer', 'nav-right', 'avatar',
  'subnav-glabel', 'subnav-group', 'subnav-soon', 'subbar', 'subnav', 'ph', 'active', 'd-main', 'd-sub', 'domain-tab'];
ok('K2 shell.js yalnız üst çubuk + alt menü işaretlemesi üretir (sayfa bileşeni sınıfı yok)', shellClasses.every(c => NAV_CLASSES.includes(c)), JSON.stringify(shellClasses.filter(c => !NAV_CLASSES.includes(c))));
const orderBad = [];
for (const f of HTML) {
  const s = read(f);
  const idx = (x) => s.indexOf(`src="${x}"`);
  const c = idx('components.js'), sh = idx('shell.js'), lu = idx('ledger-ui.js'), au = idx('admin-ui.js');
  if (c < 0 || (sh >= 0 && sh > c) || (lu >= 0 && lu < c) || (au >= 0 && au < c)) orderBad.push(f);
}
ok('K3 her sayfa components.js yükler: shell.js\'ten SONRA, ledger-ui.js / admin-ui.js\'ten ÖNCE', orderBad.length === 0, JSON.stringify(orderBad));
const C = loadComponents();
const p1 = C.pair('100000.00', 'TRY', '3000.00'), p2 = C.pair('5.00', 'EUR', null);
const MONEY_ALLOW = { 'finance-contract.html': 1, 'finance-account.html': 2, 'finance-drafts.html': 1 };
const PAIR_REQ = ['finance-summary.html', 'finance-contracts.html', 'finance-contract.html', 'finance-accounts.html', 'finance-account.html',
  'finance-transfers.html', 'finance-expenses.html', 'finance-supplier.html'];
const pairBad = [];
for (const f of HTML.filter(x => /^finance-/.test(x))) {
  const s = read(f);
  const nMoney = (s.match(/C\.money\(/g) || []).length;
  if (nMoney !== (MONEY_ALLOW[f] || 0)) pairBad.push(f + ' C.money×' + nMoney);
  if (PAIR_REQ.includes(f) && !/C\.pair\(/.test(s)) pairBad.push(f + ' C.pair yok');
}
const euroLeak = SCAN.filter(f => read(f).includes('€'));
ok('K4 PARA ÇİFTİ (RAP-01): C.pair işlem birimi + sunucunun EUR\'u, EUR yoksa "—" görünür · EUR karşılığı veren her Finance ekranı C.pair kullanır · tek birimli C.money yalnız EUR\'u API\'de OLMAYAN 4 yerde (kalem birim fiyatı · ekstre giriş/çıkış toplamı · taslak) · sayfada elle "€" yok',
  /TRY 100000\.00/.test(p1) && /€3000\.00/.test(p1) && /ui-pair-eur" title="No EUR value from the server">—/.test(p2) && pairBad.length === 0 && euroLeak.length === 0,
  JSON.stringify([pairBad, euroLeak]));
const sLink = C.stat({ label: 'Total', value: C.eur('1.00'), href: 'finance-accounts.html' }), sPlain = C.stat({ label: 'X', value: '1' });
const sumSrc = read('finance-summary.html');
const statsBlock = (sumSrc.match(/C\.stats\(\[([\s\S]*?)\]\)/) || [])[1] || '';
const statHrefs = [...statsBlock.matchAll(/href: '([^']+)'/g)].map(m => m[1]);
ok('K5 ÖZET KARTI (tek stat-card): href varsa <a> — tıklayınca kayda iner (D2) · href yoksa düz kart · Finance özetinin 4 kartının 4\'ü de nav\'daki bir ekrana iner',
  /^<a class="ui-stat" href="finance-accounts\.html">/.test(sLink) && /^<div class="ui-stat">/.test(sPlain) && statHrefs.length === 4 &&
  statHrefs.every(h => NAV_PATHS.includes(strip(h)) || NAV.items.some(it => it.path === h)), JSON.stringify(statHrefs));
const st = ['empty', 'loading', 'error'].map(k => C.state(k));
const dataPages = HTML.filter(f => /^(finance-|admin-)/.test(f));
const noLoading = dataPages.filter(f => !/L\.loading\(root\)|C\.state\('loading'\)/.test(read(f)));
ok('K6 ÜÇ DURUM bileşeni: boş / yükleniyor / hata ayrı sınıf + rol · boş liste → boş-durum · her veri ekranı önce "yükleniyor" çizer',
  /ui-state-empty" role="status"/.test(st[0]) && /ui-state-loading" role="status">Loading…/.test(st[1]) && /ui-state-error" role="alert"/.test(st[2]) &&
  /ui-state-empty/.test(C.list({ rows: [], columns: [], empty: 'None.' })) && noLoading.length === 0, JSON.stringify(noLoading));
const lst = C.list({ rows: [{ a: 1, b: 'x' }], columns: [{ label: 'Alpha', cell: r => String(r.a) }, { label: 'Beta', num: true, cell: r => r.b }], href: () => 'x.html' });
const tds = [...lst.matchAll(/<td([^>]*)>/g)].map(m => m[1]);
ok('K7 LİSTE (kabul 6): her hücre data-label taşır · satır bağlantısı data-href · signal.css ≤640 px\'te başlığı gizler, satırı karta çevirir (yatay kaydırma yok)',
  tds.length === 2 && tds[0].includes('data-label="Alpha"') && tds[1].includes('data-label="Beta"') && /data-href="x\.html"/.test(lst) &&
  /@media \(max-width: 640px\)[\s\S]*\.ui-list \.table thead \{ display: none; \}[\s\S]*\.ui-list \.table td\[data-label\]/.test(CSS) && /\.ui-list \{ overflow-x: visible; \}/.test(CSS));

console.log('\n── H: tokens (UI-04) ──');
const ALL = walk(UI2, p => /\.(html|js|css|json)$/.test(p)).map(rel).filter(f => f !== 'styles/tokens.css');
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
const hexHits = ALL.map(f => [f, (read(f).match(HEX) || []).length + (read(f).match(/\b(?:rgba?|hsla?)\(/g) || []).length]).filter(x => x[1] > 0);
ok(`H1 SABİT RENK 0: tokens.css DIŞINDA ${ALL.length} ui2 dosyasında #hex / rgb() / hsl() yok (tokens.css: ${(TOKENS.match(HEX) || []).length} hex — tek yer)`,
  hexHits.length === 0, JSON.stringify(hexHits));
const defined = new Set([...TOKENS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const used = new Set(walk(UI2, p => /\.(html|js|css)$/.test(p)).filter(p => !p.endsWith('tokens.css')).flatMap(p => [...fs.readFileSync(p, 'utf8').matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1])));
const undef = [...used].filter(v => !defined.has(v));
const themeVars = (sel) => new Set([...(TOKENS.split(sel)[1] || '').split('}')[0].matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const vSet = themeVars('html[data-theme="vermillion"] {'), cSet = themeVars('html[data-theme="cobalt"] {');
ok(`H2 kullanılan her token (${used.size}) tokens.css'te tanımlı · tema html[data-theme]: vermillion (varsayılan, :root) ve cobalt aynı renk anahtarlarını taşır`,
  undef.length === 0 && vSet.size >= 30 && vSet.size === cSet.size && [...vSet].every(v => cSet.has(v)) && /:root,\s*html\[data-theme="vermillion"\]/.test(TOKENS),
  JSON.stringify([undef, vSet.size, cSet.size]));
const styles = fs.readdirSync(path.join(UI2, 'styles')).sort();
const linkBad = HTML.filter(f => {
  const links = [...read(f).matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  return JSON.stringify(links) !== '["styles/tokens.css","styles/signal.css"]' || !/setAttribute\('data-theme'/.test(read(f));
});
ok('H3 stil dosyası yalnız iki: tokens.css (değerler) + signal.css (bileşen) · her sayfa tokens → signal sırasıyla yükler, başka stil yok · tema satırı her sayfada',
  JSON.stringify(styles) === '["signal.css","tokens.css"]' && linkBad.length === 0, JSON.stringify([styles, linkBad]));

console.log('\n── T: /ui2/_sablon/ dört şablon × üç durum (UI-03) ──');
const TPL = { 'list.html': /C\.list\(/, 'detail.html': /C\.detail\(/, 'form.html': /C\.form\(/, 'summary.html': /C\.stats\(/ };
const tplBad = [];
for (const [f, re] of Object.entries(TPL)) {
  const s = read('_sablon/' + f);
  if (!re.test(s) || !/state === 'loading'/.test(s) || !/state === 'error'/.test(s) || !/state === 'empty'|rows: state === 'empty'/.test(s) ||
      !/<base href="\/ui2\/">/.test(s) || /\/api\//.test(s)) tplBad.push(f);
}
ok('T1 dört şablon (Liste · Detay · Form · Özet kartları) kendi bileşeniyle, sahte veriyle (API çağrısı yok), üç durumu (?state=empty|loading|error) ile · /ui2/_sablon/index.html dizini',
  tplBad.length === 0 && fs.existsSync(path.join(UI2, '_sablon/index.html')) && /_sablon\/' \+ t\.id/.test(read('_sablon/index.html')), JSON.stringify(tplBad));

console.log(`\n═══ UI2 UI-0 SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
process.exit(fail === 0 ? 0 : 1);
