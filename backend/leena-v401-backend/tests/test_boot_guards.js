// tests/test_boot_guards.js — staging hazırlık (21 Eki): DB-adı koruması + CORS_EXTRA_ORIGINS +
// anahtarsız açılış. index.js GERÇEK alt süreçte koşulur (tests/helpers/bootDbStub.js ile test DB).
// Alt süreç .env'siz bir dizinde başlar ve anahtar alanları BOŞ verilir → dotenv yerel .env'deki
// gerçek anahtarları içeri alamaz (dotenv tanımlı değişkeni ezmez).
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const { checkDatabaseName, parseExtraOrigins } = require(path.join(BE, 'utils/bootGuards'));
const TEST_DB = 'postgresql://postgres@localhost:5432/ell_comm_test';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || TEST_DB });

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

// Anahtarsız staging env'i: zorunlu iki sır sahte, diğer anahtarlar BOŞ (tanımlı ama boş).
const KEYLESS = {
  JWT_SECRET: 'boot-guard-test-secret', UNSUBSCRIBE_SECRET: 'boot-guard-test-unsub',
  SENDGRID_API_KEY: '', SENDER_EMAIL: '', ADMIN_EMAIL: '', ZOHO_WEBHOOK_TOKEN: '',
  CALLCENTER_KEY: '', CALLCENTER_SUPERVISOR_KEY: '', CALLCENTER_AGENTS: '', CALLCENTER_REPORT_TO: '',
  PGHOST: '', PGUSER: '', PGPASSWORD: '', PGDATABASE: '', PGPORT: '', DATABASE_URL: '',
};

function boot(port, extraEnv, { waitMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const env = Object.assign({ PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port),
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || TEST_DB }, KEYLESS, extraEnv);
    const child = spawn(process.execPath, ['-r', path.join(BE, 'tests/helpers/bootDbStub.js'), path.join(BE, 'index.js')],
      { cwd: os.tmpdir(), env });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const done = (state) => resolve({ child, state, out: () => out });
    const t = setTimeout(() => done('timeout'), waitMs);
    child.on('exit', (code) => { clearTimeout(t); resolve({ child, state: 'exit', code, out: () => out }); });
    const iv = setInterval(() => {
      if (/backend is running/.test(out) && /current_database=/.test(out)) { clearInterval(iv); clearTimeout(t); done('listening'); }
    }, 100);
    child.on('exit', () => clearInterval(iv));
  });
}
async function req(port, method, url, { body, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}
const stop = (c) => new Promise(r => { if (c.exitCode !== null) return r(); c.on('exit', r); c.kill('SIGTERM'); });

(async () => {
  try {
    console.log('\n── BOOT GUARDS (staging hazırlık) — birim ──');
    const dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d;
    const g1 = await checkDatabaseName(pool, undefined);
    ok('G1 beklenen ad yok → ok, ad okunur (canlı davranışı)', g1.ok && g1.actual === dbName, JSON.stringify(g1));
    const g2 = await checkDatabaseName(pool, dbName);
    ok('G2 beklenen ad = bağlı DB → ok', g2.ok && g2.expected === dbName, JSON.stringify(g2));
    const g3 = await checkDatabaseName(pool, 'leena_staging_db');
    ok('G3 beklenen ad ≠ bağlı DB → ok=false', !g3.ok && g3.actual === dbName, JSON.stringify(g3));
    const broken = { query: async () => { throw new Error('connection refused'); } };
    const g4 = await checkDatabaseName(broken, 'leena_staging_db');
    const g5 = await checkDatabaseName(broken, '');
    ok('G4 sorgu hatası + beklenen ad → ok=false (fail closed)', !g4.ok && g4.error === 'connection refused', JSON.stringify(g4));
    ok('G5 sorgu hatası, beklenen ad yok/boş → ok (canlı davranışı değişmez)', g5.ok && g5.actual === null, JSON.stringify(g5));
    const warns = [];
    const o1 = parseExtraOrigins(' https://leena-staging.onrender.com , http://localhost:3456/,https://leena-staging.onrender.com,foo,https://x.com/path,ftp://y.com', w => warns.push(w));
    ok('G6 CORS_EXTRA_ORIGINS: geçerli tam origin\'ler, tekrar ve sondaki / temiz; yol/şema/çöp uyarıyla atlanır',
      JSON.stringify(o1) === JSON.stringify(['https://leena-staging.onrender.com', 'http://localhost:3456']) && warns.length === 3,
      JSON.stringify(o1) + ' warns=' + warns.length);
    ok('G7 CORS_EXTRA_ORIGINS tanımsız/boş → [] (izin listesi değişmez)',
      parseExtraOrigins(undefined).length === 0 && parseExtraOrigins('  ').length === 0);

    console.log('\n── BOOT GUARDS — gerçek süreç (index.js) ──');
    // B1 — EXPECTED_DB_NAME yanlış → hiç dinlemeden çıkar
    const b1 = await boot(45911, { EXPECTED_DB_NAME: 'leena_staging_db' });
    ok('B1 EXPECTED_DB_NAME ≠ bağlı DB → exit 1, FATAL loglu, hiç dinlemedi',
      b1.state === 'exit' && b1.code === 1 && /FATAL: EXPECTED_DB_NAME=leena_staging_db/.test(b1.out()) && !/backend is running/.test(b1.out()),
      `${b1.state}/${b1.code}`);
    await stop(b1.child);

    // B2 — EXPECTED_DB_NAME doğru + CORS_EXTRA_ORIGINS + anahtarsız
    const P2 = 45912, ORIGIN = `http://127.0.0.1:${P2}`;
    const b2 = await boot(P2, { EXPECTED_DB_NAME: dbName, CORS_EXTRA_ORIGINS: ORIGIN });
    try {
      ok('B2 EXPECTED_DB_NAME = bağlı DB → dinler, current_database loglu',
        b2.state === 'listening' && new RegExp(`current_database=${dbName}`).test(b2.out()), b2.state);
      const lp = await req(P2, 'GET', '/ui2/login.html');
      ok('B3 anahtarsız açılış: /ui2/login.html 200', lp.status === 200, lp.status);
      const lg = await req(P2, 'POST', '/api/user-auth/login', { body: { email: 'no@x.com', password: 'x' }, origin: ORIGIN });
      ok('B4 CORS_EXTRA_ORIGINS origin\'inden login POST → CORS geçer (401, 500 değil)', lg.status === 401, lg.status);
      // B4b — anahtarsız env'de gerçek giriş: Owner'a şifre (script mantığı) → login 200 → /me
      const { setFirstOwnerPassword } = require(path.join(BE, 'scripts/set-first-owner-password.js'));
      await pool.query("UPDATE users SET password_hash = NULL, password_must_change = true WHERE email = 'suer@elan-expo.com'");
      const sc = await pool.connect();
      try { await setFirstOwnerPassword(sc, 'boot-guard-pw-1', { bcrypt: require(path.join(BE, 'node_modules/bcrypt')) }); } finally { sc.release(); }
      const li = await req(P2, 'POST', '/api/user-auth/login', { body: { email: 'suer@elan-expo.com', password: 'boot-guard-pw-1' }, origin: ORIGIN });
      const me = li.body && li.body.token ? await fetch(`http://127.0.0.1:${P2}/api/user-auth/me`, { headers: { Authorization: 'Bearer ' + li.body.token } }) : { status: 0 };
      await pool.query("UPDATE users SET password_hash = NULL, password_must_change = true WHERE email = 'suer@elan-expo.com'");
      ok('B4b anahtarsız env: Owner login 200 + /me 200', li.status === 200 && me.status === 200, `${li.status}/${me.status}`);
      const cc = await req(P2, 'POST', '/api/callcenter/next?agent=Test', { body: {} });
      ok('B5 CALLCENTER_KEY yok → callcenter 503 (fail closed, çökme yok)', cc.status === 503, cc.status);
      // B6 — SendGrid yok: mail yolu çökmez, GÖNDERMEZ, true döner (çağıran "gönderildi" sanır —
      // davranış BİLGİSİ, değiştirilmedi). Test DB'de organizers.name yok (YON-09) → register
      // burada ölçülemez; mail yardımcısı ayrı süreçte, anahtarsız env'le koşulur.
      const mailProbe = await new Promise((resolve) => {
        const code = "process.env.SENDGRID_API_KEY='';const e=require(" + JSON.stringify(path.join(BE, 'utils/email')) +
          ");e.sendEmail('nobody@example.com','s','<p>x</p>').then(r=>console.log('RESULT='+r))";
        const c = spawn(process.execPath, ['-e', code], { cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } });
        let o = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { o += d; });
        c.on('exit', (code) => resolve({ code, o }));
      });
      ok('B6 SendGrid yok → utils/email yüklenir, gönderim atlanır ("SendGrid not configured"), true döner, süreç ayakta',
        mailProbe.code === 0 && /SendGrid not configured/.test(mailProbe.o) && /RESULT=true/.test(mailProbe.o) && b2.child.exitCode === null,
        mailProbe.o.slice(0, 120));
    } finally { await stop(b2.child); }

    // B7 — canlı env şekli: iki değişken de YOK → hemen dinler, yabancı origin hâlâ reddedilir
    const P3 = 45913;
    const b3 = await boot(P3, {});
    try {
      ok('B7 EXPECTED_DB_NAME yok → dinler + current_database loglu (canlı davranışı)',
        b3.state === 'listening' && /current_database=/.test(b3.out()), b3.state);
      const fo = await req(P3, 'POST', '/api/user-auth/login', { body: { email: 'no@x.com', password: 'x' }, origin: 'https://evil.example.com' });
      ok('B8 CORS_EXTRA_ORIGINS yok → yabancı origin eskisi gibi reddedilir (500 CORS)',
        fo.status === 500 && fo.body && /CORS not allowed/.test(fo.body.error || ''), fo.status);
    } finally { await stop(b3.child); }

    console.log(`\n═══ BOOT GUARDS SONUÇ: ${pass} geçti, ${fail} başarısız ═══`);
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (fail > 0) process.exitCode = 1;
  }
})();
