// tests/test_ui2_p2_pages.js — Paket 2 ui2: menü etkin yetkiyi okur (K-G: eski davranış değişmez,
// ekleme geriye uyumlu ve TESTLİ) + Admin ekranları + davet sayfası + davet yardımcıları. DB YOK.
// Gerçek shell.js vm içinde sahte localStorage/document ile koşulur (test_ui2_current_user deseni).
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const BE = path.join(__dirname, '..');
const UI2 = path.join(BE, 'public/ui2');
const read = (f) => fs.readFileSync(path.join(UI2, f), 'utf8');
const SHELL = read('shell.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + b64url({ organizer_id: 1, user_id: 'u-1', email: 'a@x.com' }) + '.sig-abcdefghijklmnop';
function store(perms) {
  if (perms === 'classic') return { token: 'x.y.z', organizer: JSON.stringify({ name: 'Elan Expo' }), organizerId: '1' };
  const rec = { user_id: 'u-1', email: 'a@x.com', token_tail: TOKEN.slice(-16) };
  if (perms) rec.perms = perms;
  return { token: TOKEN, ui2User: JSON.stringify(rec) };
}
// shell.js'i yükler; nav + subnav'ı çizer. Döner: { tabs: [...], sub: [...hrefs], w }
function render(st, domain, sub) {
  const mounts = { 'ui2-nav': { outerHTML: null }, 'ui2-subnav': { outerHTML: null } };
  const ls = { getItem: (k) => (Object.prototype.hasOwnProperty.call(st, k) ? st[k] : null), setItem() {}, removeItem() {} };
  const w = {};
  const ctx = { window: w, localStorage: ls, JSON, document: { addEventListener() {}, getElementById: (id) => mounts[id] || null } };
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx);
  w.ui2RenderNav(domain); w.ui2RenderSubnav(domain, sub);
  const tabs = [...(mounts['ui2-nav'].outerHTML || '').matchAll(/<span class="d-main">([^<]+)<\/span>/g)].map(m => m[1]);
  const subs = [...(mounts['ui2-subnav'].outerHTML || '').matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  return { tabs, subs, w, nav: mounts['ui2-nav'].outerHTML, subHtml: mounts['ui2-subnav'].outerHTML };
}
const FIN = ['budget.read', 'budget.write', 'commissions.read', 'contracts.read', 'expense_drafts.approve', 'expense_drafts.read',
  'expense_drafts.write', 'ledger.read', 'ledger.write', 'payouts.write', 'suppliers.read', 'suppliers.write'];
const codes = (list, scope = 'all') => Object.fromEntries(list.map(c => [c, scope]));

console.log('\n── shell.js: menü etkin yetkiyi okur (K-G) ──');
const c = render(store('classic'), 'finance', 'accounts');
ok('S1 klasik oturum: nav ESKİSİ GİBİ 3 sekme (Admin YOK) · Finance subnav\'ın 8 öğesi görünür (öğe gizleme yalnız users oturumunda)',
  JSON.stringify(c.tabs) === '["Sales","Operations","Finance"]' && c.subs.length === 8, JSON.stringify([c.tabs, c.subs]));
const old = render(store(null), 'finance', 'accounts');
ok('S2 users oturumu ama özet henüz yok (Paket 2 öncesi kayıt / /me gelmedi): eski davranış — 3 sekme, 8 öğe',
  JSON.stringify(old.tabs) === '["Sales","Operations","Finance"]' && old.subs.length === 8, JSON.stringify([old.tabs, old.subs]));
const fin = render(store({ owner: false, codes: codes(FIN), areas: ['finance'] }), 'finance', 'accounts');
ok('S3 Finance kullanıcısı: yalnız Finance sekmesi (Sales / Operations / Admin GİZLİ) · 8 Finance öğesi',
  JSON.stringify(fin.tabs) === '["Finance"]' && fin.subs.length === 8, JSON.stringify([fin.tabs, fin.subs]));
const om = render(store({ owner: false, codes: codes(['ledger.read', 'suppliers.read', 'expense_drafts.read', 'contracts.read'], 'office'), areas: ['finance'] }), 'finance', 'accounts');
ok('S4 öğe izni yoksa öğe görünmez: budget.read yok → "Expo budget" subnav\'da YOK, diğerleri var',
  !om.subs.includes('finance-budget.html') && om.subs.includes('finance-accounts.html') && om.subs.length === 7, JSON.stringify(om.subs));
const own = render(store({ owner: true, codes: {}, areas: [] }), 'admin', 'users');
ok('S5 Owner: 4 sekme (Admin dahil) · Admin subnav\'ı Users',
  JSON.stringify(own.tabs) === '["Sales","Operations","Finance","Admin"]' && JSON.stringify(own.subs) === '["admin-users.html"]', JSON.stringify([own.tabs, own.subs]));
const cs = fin.w.ui2CanSee('admin'), cs2 = fin.w.ui2CanSee('finance', 'ledger.write'), cs3 = fin.w.ui2CanSee('finance', 'reference.write');
ok('S6 ui2CanSee SENKRON boolean döner (SEM-05) · ikinci argüman = tek izin kodu', cs === false && cs2 === true && cs3 === false &&
  typeof c.w.ui2CanSee('finance') === 'boolean', JSON.stringify([cs, cs2, cs3]));
ok('S7 yeniden çizim: nav + subbar kendi mount id\'sini taşır · açılışta /me ile tazeleme (ui2RefreshAccess) · 401 dışı hata sessiz',
  /id="ui2-nav"/.test(c.nav) && /id="ui2-subnav"/.test(c.subHtml) && /ui2RefreshAccess\(function \(\)/.test(SHELL) &&
  /leenaFetch\('\/api\/user-auth\/me'\)/.test(SHELL), '');

console.log('\n── Ekranlar ──');
const USERS_ROUTER = fs.readFileSync(path.join(BE, 'routes/users.js'), 'utf8');
const AUTH_ROUTER = fs.readFileSync(path.join(BE, 'routes/userAuth.js'), 'utf8');
const uroutes = [...USERS_ROUTER.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g)].map(m => m[1].toUpperCase() + ' ' + m[2]);
const bad = [];
for (const p of ['admin-users.html', 'admin-user.html']) {
  const s = read(p);
  const order = ['/leena-fetch.js', 'shell.js', 'ledger-ui.js', 'admin-ui.js'].map(x => s.indexOf(`src="${x}"`));
  if (!/UI2_ACTIVE='admin'/.test(s) || !/UI2_SUBACTIVE='users'/.test(s) || order.some(i => i < 0) || !order.every((v, i) => i === 0 || order[i - 1] < v)) bad.push(p);
}
ok('S8 Admin ekranları var · Admin > Users altında · script sırası leena-fetch → shell → ledger-ui → admin-ui', bad.length === 0, JSON.stringify(bad));
const used = new Set();
for (const p of ['admin-users.html', 'admin-user.html']) {
  const s = read(p);
  for (const m of s.matchAll(/L\.api\('(GET|POST|PUT|DELETE)', '\/api\/users([^']*)'(?=\s*[,)])/g)) used.add(m[1] + ' ' + (m[2] || '/'));
  for (const m of s.matchAll(/L\.api\('(GET|POST|PUT|DELETE)', (base|url|'\/api\/users\/' \+ encodeURIComponent\(id\)) \+ '([^']*)'/g)) used.add(m[1] + ' /:id' + m[3]);
  for (const m of s.matchAll(/L\.api\('(GET|POST|PUT|DELETE)', base[,)]/g)) used.add(m[1] + ' /:id');
}
const norm = (u) => u.replace(/\?.*$/, '').replace(/\/' \+ encodeURIComponent\(id\)/, '/:id');
const dead = [...used].map(norm).filter(u => !uroutes.includes(u) && !(u.startsWith('PUT /:id/permissions') || u.startsWith('DELETE /:id/permissions')));
ok(`S9 Admin ekranlarının çağırdığı ${used.size} /api/users ucu router'da tanımlı (ölü bağlantı yok)`,
  dead.length === 0 && uroutes.includes('PUT /:id/permissions/:code') && uroutes.includes('DELETE /:id/permissions/:code') && used.size >= 6,
  JSON.stringify([[...used], dead]));
const inv = read('invite.html');
ok('S10 davet sayfası: kimlik doğrulamasız (shell.js / leena-fetch YOK) · Referrer no-referrer (B20) · token URL FRAGMENT\'ından okunur ve adres çubuğundan silinir · POST gövdesiyle gönderilir',
  !/src="shell\.js"/.test(inv) && !/src="\/leena-fetch\.js"/.test(inv) && /<meta name="referrer" content="no-referrer">/.test(inv) &&
  /location\.hash/.test(inv) && /history\.replaceState/.test(inv) && /'\/api\/user-auth\/invite\/check', \{ token: token \}/.test(inv) &&
  /'\/api\/user-auth\/invite\/accept'/.test(inv) && /router\.post\('\/invite\/check'/.test(AUTH_ROUTER) && /router\.post\('\/invite\/accept'/.test(AUTH_ROUTER));
const login = read('login.html');
ok('S11 ui2 login: girişten sonra /me özeti kayda yazılır (ilk ekranın menüsü doğru) · davetten dönüşte e-posta dolu · eski anahtarlara yazılmaz',
  /fetch\('\/api\/user-auth\/me'/.test(login) && /rec\.perms = me\.permissions/.test(login) && /q\.get\('invited'\) === '1'/.test(login) &&
  !/setItem\('organizer/.test(login));
const who = read('whoami.html');
ok('S12 "Who is signed in": Role (şablon) · Office · Access (alanlar) satırları', /\['Office', /.test(who) && /\['Access', /.test(who) && /u\.role && u\.role\.name/.test(who));

console.log('\n── Davet yardımcıları (utils/invites.js) ──');
const I = require(path.join(BE, 'utils/invites'));
const mkReq = (host, proto) => ({ protocol: 'http', get: (h) => ({ host, 'x-forwarded-proto': proto }[h.toLowerCase()]) });
delete process.env.INVITE_ECHO;
const e0 = I.echoEnabled();
process.env.INVITE_ECHO = 'true';
const e1 = I.echoEnabled();
process.env.INVITE_ECHO = '1';
const e2 = I.echoEnabled();
delete process.env.INVITE_ECHO;
ok('S13 INVITE_ECHO yalnız TAM "1" ile açılır (bayraksız / başka değer → kapalı)', e0 === false && e1 === false && e2 === true);
process.env.CORS_EXTRA_ORIGINS = 'https://leena-staging.onrender.com';
const b1 = I.inviteBaseUrl(mkReq('leena-staging.onrender.com', 'https'));
const b2 = I.inviteBaseUrl(mkReq('evil.example.com', 'https'));
const b3 = I.inviteBaseUrl(mkReq('leena.app', 'https'));
delete process.env.CORS_EXTRA_ORIGINS;
const t = I.newInviteToken();
const url = I.inviteUrl(mkReq('leena.app', 'https'), t.token);
ok('S14 link tabanı yalnız İZİNLİ origin (CORS listesi + CORS_EXTRA_ORIGINS) — Host başlığıyla yönlendirilemez · token fragment\'ta · DB\'ye giden özet 64 hex ve token\'dan farklı',
  b1 === 'https://leena-staging.onrender.com' && b2 === 'https://leena.app' && b3 === 'https://leena.app' &&
  url === 'https://leena.app/ui2/invite.html#token=' + encodeURIComponent(t.token) && /^[0-9a-f]{64}$/.test(t.hash) && t.hash !== t.token && I.INVITE_TTL_HOURS === 72,
  JSON.stringify([b1, b2, b3, url.slice(0, 50)]));

console.log(`\n═══ UI2 P2 PAGES SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
process.exit(fail === 0 ? 0 : 1);
