// tests/test_ui2_current_user.js — Faz 4 dilim 2 / SEM-05: ui2CurrentUser() SENKRON kalır.
// DB YOK. public/ui2/shell.js gerçek kaynağı vm içinde sahte localStorage/document ile koşulur;
// ui2/login.html'in 'ui2User' yazım biçimi burada aynen kurulur.
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const SHELL = fs.readFileSync(path.join(__dirname, '..', 'public/ui2/shell.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

// shell.js'i verilen localStorage içeriğiyle yükler, window'u döner (DOMContentLoaded tetiklenmez).
function loadShell(store) {
  const ls = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const window = {};
  const ctx = { window, localStorage: ls, document: { addEventListener() {}, getElementById() { return null; } }, JSON };
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx);
  return window;
}
// login.html'deki yazımın aynısı: payload'dan user_id + email, token'ın son 16 karakteri.
function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fakeToken(payload) { return 'eyJhbGciOiJIUzI1NiJ9.' + b64url(payload) + '.sig-' + Math.random().toString(36).slice(2, 14); }
function ui2LoginStore(token, extra = {}) {
  const claims = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  return Object.assign({
    token,
    ui2User: JSON.stringify({ user_id: claims.user_id, email: claims.email, display_role: 'Owner', is_owner: true, token_tail: token.slice(-16) }),
  }, extra);
}

console.log('\n── ui2CurrentUser() — SEM-05 senkron sözleşme ──');
const UID = '11111111-2222-4333-8444-555555555555';
const tok = fakeToken({ organizer_id: 1, email: 'owner@x.com', user_id: UID });

// C1 — ui2 login sonrası doğru kullanıcı, senkron (Promise DEĞİL)
const w1 = loadShell(ui2LoginStore(tok));
const r1 = w1.ui2CurrentUser();
ok('C1 senkron dönüş (Promise değil, düz nesne)', r1 && typeof r1.then !== 'function' && typeof r1 === 'object');
ok('C2 ui2 login sonrası → id = user_id, email doğru, session=user',
  r1.id === UID && r1.email === 'owner@x.com' && r1.session === 'user', JSON.stringify(r1));

// C3 — eski login anahtarları varken bile ui2 kaydı (token'a bağlı) öncelikli
const w3 = loadShell(ui2LoginStore(tok, { organizer: JSON.stringify({ name: 'Elan Expo' }), organizerId: '1' }));
ok('C3 eski organizer anahtarları dururken ui2 kullanıcısı döner', w3.ui2CurrentUser().id === UID);

// C4 — klasik login token'ı değiştirdi → ui2 kaydı BAYAT, yok sayılır, eski davranış
const stale = ui2LoginStore(tok, { organizer: JSON.stringify({ name: 'Elan Expo' }), organizerId: '1' });
stale.token = fakeToken({ organizer_id: 1, email: 'owner@x.com' });
const r4 = loadShell(stale).ui2CurrentUser();
ok('C4 token değişti (klasik login) → bayat ui2 kaydı yok sayılır → organizer davranışı',
  r4.name === 'Elan Expo' && r4.id === '1' && r4.session === undefined, JSON.stringify(r4));

// C5 — yalnız klasik login (ui2User yok) → eski davranış birebir
const r5 = loadShell({ token: 'x.y.z', organizer: JSON.stringify({ name: 'Elan Expo' }), organizerId: '1' }).ui2CurrentUser();
ok('C5 klasik login → {name: organizer.name, id: organizerId} (değişmedi)',
  JSON.stringify(r5) === JSON.stringify({ name: 'Elan Expo', id: '1' }), JSON.stringify(r5));

// C6 — hiçbir şey yok → {name:'User', id:null} (değişmedi)
const r6 = loadShell({}).ui2CurrentUser();
ok("C6 boş depolama → {name:'User', id:null} (değişmedi)", JSON.stringify(r6) === JSON.stringify({ name: 'User', id: null }), JSON.stringify(r6));

// C7 — bozuk ui2User → çökmez, eski davranışa düşer
const r7 = loadShell({ token: tok, ui2User: '{bozuk', organizerId: '1' }).ui2CurrentUser();
ok('C7 bozuk ui2User → fail-soft, eski davranış', r7.id === '1', JSON.stringify(r7));

// C8 — ui2/login.html gerçekten ui2User yazıyor ve organizer/organizerId yazmıyor (kaynak kontrolü)
const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'public/ui2/login.html'), 'utf8');
ok("C8 ui2/login.html 'ui2User' yazar, 'organizer'/'organizerId' YAZMAZ",
  /setItem\('ui2User'/.test(LOGIN) && !/setItem\('organizer/.test(LOGIN));

console.log(`\n═══ UI2 CURRENT USER SONUÇ: ${pass} geçti, ${fail} başarısız ═══`);
if (fail > 0) process.exitCode = 1;
