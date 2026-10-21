// tests/test_users.js — users tablosu ŞEMA + KISIT + B10 TRIGGER testi (Faz 4 dilim 1).
// ⚠️ ENDPOINT YOK (users route dilim 2, 4 Ekim) → test doğrudan pool.query + hata yakalama.
// Kurallar (kütük + migration):
//   B10 (en az 1 aktif Owner, trigger enforce_min_one_active_owner) — 032; kütük B10
//   SEM-03 (users.id uuid, default gen_random_uuid) — 032; kütük SEM-03
//   SEM-04 (password_hash nullable, NULL="henüz şifre yok") — 032; kütük SEM-04
//   FK sales_agents.user_id → users(id) — 032
//   021 external_user_null_check: CHECK (agent_type='internal' OR user_id IS NULL) — 021, 032'yle anlam kazandı
//   email UNIQUE · organizer_id FK — 032
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
// Faz 4 dilim 2: route'lar test pool'unu kullanır (diğer suite'lerin require.cache deseni).
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(BE, 'node_modules/bcrypt'));
const { setFirstOwnerPassword, ownerPasswordState, normalizeDisplayName } = require(path.join(BE, 'scripts/set-first-owner-password.js'));
const fs = require('fs');
const app = express(); app.use(express.json());
app.use('/api/user-auth', require(path.join(BE, 'routes/userAuth.js')));
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
const PORT = 45906;
async function call(method, url, { token, body } = {}) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

// Bir sorgunun REDDEDİLMESİNİ bekler (CHECK / FK / UNIQUE / trigger RAISE).
async function expectReject(label, fn) {
  try { await fn(); ok(label, false, 'REDDEDİLMEDİ (kısıt/trigger çalışmadı?)'); }
  catch (e) { ok(label, true); }
}
// Bir sorgunun GEÇMESİNİ bekler.
async function expectPass(label, fn) {
  try { await fn(); ok(label, true); }
  catch (e) { ok(label, false, e.message.slice(0, 70)); }
}

const SUER = 'suer@elan-expo.com';
// ── RESET STRATEJİSİ ──
// Seed Suer = TEK aktif Owner. Negatif B10 testleri onu düşürmeye çalışır → trigger RAISE
// query'yi GERİ ALIR, Suer state'i bozulmaz. Reset yine de garanti eder: extra user/agent
// silinir, Suer aktif+owner. sales_agents ÖNCE (user_id FK → users). Suer korunduğu için
// DELETE/UPDATE'te count≥1 → trigger geçer.
async function resetUsers() {
  await pool.query('DELETE FROM sales_agents');
  await pool.query('DELETE FROM users WHERE email <> $1', [SUER]);
  await pool.query('UPDATE users SET is_owner = true, is_active = true WHERE email = $1', [SUER]);
}
const suerId = async () => (await pool.query('SELECT id FROM users WHERE email=$1', [SUER])).rows[0].id;

(async () => {
  try {
    console.log('\n── users ŞEMA + KISIT + B10 TRIGGER (Faz 4 dilim 1) ──');

    // U1 (SEM-03) — id uuid default üretilir (INSERT'te id verilmeden)
    await resetUsers();
    const u1 = await pool.query(
      "INSERT INTO users (organizer_id, email, is_owner) VALUES (1, 'u1@x.com', false) RETURNING id");
    ok('U1 (SEM-03) INSERT id verilmeden → uuid üretildi',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u1.rows[0].id), u1.rows[0].id);

    // U2 (SEM-04) — password_hash NULL kabul (yeni user + seed Owner)
    await resetUsers();
    const seedNull = await pool.query('SELECT password_hash FROM users WHERE email=$1', [SUER]);
    await expectPass('U2 (SEM-04) yeni user password_hash NULL ile INSERT geçer', async () =>
      pool.query("INSERT INTO users (organizer_id, email, password_hash) VALUES (1, 'u2@x.com', NULL)"));
    ok('U2b (SEM-04) seed Owner password_hash NULL', seedNull.rows[0].password_hash === null, String(seedNull.rows[0].password_hash));

    // U3 (email UNIQUE) — ikinci suer@elan-expo.com reddedilir
    await resetUsers();
    await expectReject('U3 (email UNIQUE) aynı e-posta ikinci kez → REDDEDİLİR', async () =>
      pool.query("INSERT INTO users (organizer_id, email) VALUES (1, $1)", [SUER]));

    // U4 (organizer_id FK) — olmayan organizer reddedilir
    await resetUsers();
    await expectReject('U4 (organizer_id FK) olmayan organizer → REDDEDİLİR', async () =>
      pool.query("INSERT INTO users (organizer_id, email) VALUES (99999, 'u4@x.com')"));

    // U5 (B10) — tek aktif Owner is_active=false → REDDEDİLİR (UPDATE kapsamda)
    await resetUsers();
    await expectReject('U5 (B10) tek Owner is_active=false → REDDEDİLİR (trigger)', async () =>
      pool.query('UPDATE users SET is_active=false WHERE email=$1', [SUER]));

    // U6 (B10) — tek Owner DELETE → REDDEDİLİR
    await resetUsers();
    await expectReject('U6 (B10) tek Owner DELETE → REDDEDİLİR (trigger)', async () =>
      pool.query('DELETE FROM users WHERE email=$1', [SUER]));

    // U7 (B10) — tek Owner is_owner=false → REDDEDİLİR (UPDATE kapsamda; INSERT değil)
    await resetUsers();
    await expectReject('U7 (B10) tek Owner is_owner=false → REDDEDİLİR (trigger)', async () =>
      pool.query('UPDATE users SET is_owner=false WHERE email=$1', [SUER]));

    // U8 (B10 pozitif) — 2 Owner varken birini pasife çek → GEÇER (Suer aktif kalır)
    await resetUsers();
    await pool.query("INSERT INTO users (organizer_id, email, is_owner, is_active) VALUES (1, 'owner2@x.com', true, true)");
    await expectPass('U8 (B10+) 2 Owner varken ikinciyi pasife çek → GEÇER', async () =>
      pool.query("UPDATE users SET is_active=false WHERE email='owner2@x.com'"));

    // U9 (FK sales_agents.user_id → users(id)) — olmayan uuid → REDDEDİLİR
    await resetUsers();
    await expectReject('U9 (FK) sales_agents.user_id olmayan uuid → REDDEDİLİR', async () =>
      pool.query("INSERT INTO sales_agents (organizer_id, name, agent_type, user_id) VALUES (1, 'A', 'internal', '00000000-0000-0000-0000-000000000000')"));

    // U10 (021 negatif) — external_freelance + user_id dolu → REDDEDİLİR (CHECK)
    await resetUsers();
    const sid = await suerId();
    await expectReject('U10 (021) external_freelance + user_id dolu → REDDEDİLİR (CHECK)', async () =>
      pool.query("INSERT INTO sales_agents (organizer_id, name, agent_type, user_id) VALUES (1, 'B', 'external_freelance', $1)", [sid]));

    // U11 (021 pozitif) — internal + geçerli user_id → GEÇER (032 ile anlam kazandı, ilk kez test)
    await resetUsers();
    const sid2 = await suerId();
    await expectPass('U11 (021) internal + geçerli user_id → GEÇER', async () =>
      pool.query("INSERT INTO sales_agents (organizer_id, name, agent_type, user_id) VALUES (1, 'C', 'internal', $1)", [sid2]));

    // ════ FAZ 4 DİLİM 2 — users ile giriş + ilk şifre + TRUNCATE guard (033) ════
    console.log('\n── FAZ 4 DİLİM 2: user-login · me · change-password · ilk şifre · 033 ──');
    const server = app.listen(PORT);
    // Reset: Suer'in şifresi NULL + must_change=true'ya döner (U2b'nin seed varsayımı
    // korunur → suite tekrar koşulabilir, idempotent).
    const resetAuth = async () => {
      await resetUsers();
      await pool.query('UPDATE users SET password_hash = NULL, password_must_change = true, display_name = NULL WHERE email = $1', [SUER]);
    };
    const PW = 'suer-test-pw-1';
    const hashOf = async () => (await pool.query('SELECT password_hash FROM users WHERE email=$1', [SUER])).rows[0].password_hash;
    try {
      // S0 (19 Eki notu) — ön kontrol onaydan ÖNCE: hash NULL → ready, 035 kolonu görünür
      await resetAuth();
      const s0c = await pool.connect();
      const s0 = await ownerPasswordState(s0c); s0c.release();
      ok('S0 ön kontrol: hash NULL → ready + display_name kolonu var',
        s0.status === 'ready' && s0.has_name_column === true, JSON.stringify(s0));

      // S1 (K-B) — script mantığı: hash NULL → yazar, must_change=false
      const s1c = await pool.connect();
      const s1 = await setFirstOwnerPassword(s1c, PW, { bcrypt }); s1c.release();
      const s1row = (await pool.query('SELECT password_hash, password_must_change FROM users WHERE email=$1', [SUER])).rows[0];
      ok('S1 (K-B) script: hash NULL → yazar, must_change=false',
        s1.status === 'written' && s1row.password_hash !== null && s1row.password_must_change === false, JSON.stringify(s1));

      // S2 (K-B) — hash doluyken yazmaz, hash değişmez
      const before = await hashOf();
      const s2c = await pool.connect();
      const s2 = await setFirstOwnerPassword(s2c, 'another-pw-22', { bcrypt }); s2c.release();
      ok('S2 (K-B) script: hash dolu → "hash_present", değişiklik yok', s2.status === 'hash_present' && (await hashOf()) === before, s2.status);
      const s2pc = await pool.connect();
      const s2p = await ownerPasswordState(s2pc); s2pc.release();
      ok('S2b ön kontrol: hash dolu → hash_present (CLI hiçbir şey sormadan çıkar)', s2p.status === 'hash_present', s2p.status);

      // L1 — user-login başarı (S1'in şifresiyle)
      const l1 = await call('POST', '/api/user-auth/login', { body: { email: SUER, password: PW } });
      const dec = l1.body && l1.body.token ? jwt.decode(l1.body.token) : {};
      ok('L1 user-login başarı → token (organizer_id + email + user_id, SEM-05) + bayraklar',
        l1.status === 200 && dec.organizer_id === 1 && dec.email === SUER && !!dec.user_id &&
        l1.body.is_owner === true && l1.body.password_must_change === false, l1.status);
      ok('N1 (K-F) ad yokken token name = e-posta, yanıt name = e-posta',
        dec.name === SUER && l1.body.name === SUER, `${dec.name}/${l1.body && l1.body.name}`);
      const userToken = l1.body && l1.body.token;

      // L2..L5 — tüm hatalar AYNI 401 + AYNI mesaj
      const h = await bcrypt.hash(PW, 4);
      await pool.query("INSERT INTO users (organizer_id, email, password_hash, is_active) VALUES (1, 'pasif@x.com', $1, false)", [h]);
      await pool.query("INSERT INTO users (organizer_id, email, password_hash) VALUES (1, 'nohash@x.com', NULL)");
      const lPasif = await call('POST', '/api/user-auth/login', { body: { email: 'pasif@x.com', password: PW } });
      const lNull  = await call('POST', '/api/user-auth/login', { body: { email: 'nohash@x.com', password: PW } });
      const lWrong = await call('POST', '/api/user-auth/login', { body: { email: SUER, password: 'wrong-password' } });
      const lNone  = await call('POST', '/api/user-auth/login', { body: { email: 'yok@x.com', password: PW } });
      const msg = lWrong.body && lWrong.body.error;
      ok('L2 pasif kullanıcı → 401', lPasif.status === 401, lPasif.status);
      ok('L3 password_hash NULL → 401', lNull.status === 401, lNull.status);
      ok('L4 yanlış şifre → 401', lWrong.status === 401, lWrong.status);
      ok('L5 olmayan e-posta → 401', lNone.status === 401, lNone.status);
      ok('L6 dört hata da AYNI mesaj', [lPasif, lNull, lNone].every(r => r.body && r.body.error === msg) && !!msg, msg);

      // L7 — yeni token mevcut korumalı uçta (authMiddleware) çalışır
      const c7 = await call('GET', '/api/contracts', { token: userToken });
      ok('L7 user token → GET /api/contracts 200 (organizer_id aynı)', c7.status === 200 && Array.isArray(c7.body), c7.status);

      // M1 — me doğru kullanıcıyı döner
      const m1 = await call('GET', '/api/user-auth/me', { token: userToken });
      ok('M1 me → oturumdaki kullanıcı', m1.status === 200 && m1.body.email === SUER && m1.body.user_id === dec.user_id && m1.body.session === 'user', m1.status);

      // M2 — eski-login token'ı (user_id yok) → 409 NOT_USER_SESSION (401/403 değil)
      const legacy = jwt.sign({ organizer_id: 1, email: SUER }, process.env.JWT_SECRET, { expiresIn: '30d' });
      const m2 = await call('GET', '/api/user-auth/me', { token: legacy });
      ok('M2 eski-login token → me 409 NOT_USER_SESSION', m2.status === 409 && m2.body && m2.body.code === 'NOT_USER_SESSION', m2.status);

      // P1..P5 — must_change akışı
      const hm = await bcrypt.hash('first-pw-1', 4);
      await pool.query("INSERT INTO users (organizer_id, email, password_hash, password_must_change) VALUES (1, 'must@x.com', $1, true)", [hm]);
      const p1 = await call('POST', '/api/user-auth/login', { body: { email: 'must@x.com', password: 'first-pw-1' } });
      ok('P1 must_change kullanıcı login → password_must_change=true', p1.status === 200 && p1.body.password_must_change === true, p1.status);
      const mt = p1.body && p1.body.token;
      const p2 = await call('POST', '/api/user-auth/change-password', { token: mt, body: { current_password: 'nope', new_password: 'second-pw-2' } });
      ok('P2 yanlış mevcut şifre → 400 INVALID_CURRENT_PASSWORD', p2.status === 400 && p2.body.code === 'INVALID_CURRENT_PASSWORD', p2.status);
      const p3 = await call('POST', '/api/user-auth/change-password', { token: mt, body: { current_password: 'first-pw-1', new_password: 'short' } });
      ok('P3 kısa yeni şifre (<6) → 400', p3.status === 400, p3.status);
      const p4 = await call('POST', '/api/user-auth/change-password', { token: mt, body: { current_password: 'first-pw-1', new_password: 'second-pw-2' } });
      const p4me = await call('GET', '/api/user-auth/me', { token: mt });
      ok('P4 doğru değişim → 200, me must_change=false', p4.status === 200 && p4me.body.password_must_change === false, p4.status);
      const p5new = await call('POST', '/api/user-auth/login', { body: { email: 'must@x.com', password: 'second-pw-2' } });
      const p5old = await call('POST', '/api/user-auth/login', { body: { email: 'must@x.com', password: 'first-pw-1' } });
      ok('P5 yeni şifre girer, eski şifre 401', p5new.status === 200 && p5old.status === 401, `${p5new.status}/${p5old.status}`);

      // N2 (K-F) — script adı yazar (kırpılmış), token ve /me adı taşır
      await resetAuth();
      const n2c = await pool.connect();
      const n2 = await setFirstOwnerPassword(n2c, PW, { bcrypt, displayName: '  Suer Test  ' }); n2c.release();
      const n2row = (await pool.query('SELECT display_name FROM users WHERE email=$1', [SUER])).rows[0];
      const n2l = await call('POST', '/api/user-auth/login', { body: { email: SUER, password: PW } });
      const n2dec = n2l.body && n2l.body.token ? jwt.decode(n2l.body.token) : {};
      const n2me = await call('GET', '/api/user-auth/me', { token: n2l.body && n2l.body.token });
      ok('N2 (K-F) script adı kırpıp yazar → token name + /me name/display_name = ad',
        n2.status === 'written' && n2row.display_name === 'Suer Test' && n2dec.name === 'Suer Test' &&
        n2me.body.name === 'Suer Test' && n2me.body.display_name === 'Suer Test',
        `${n2.status}/${n2row.display_name}/${n2dec.name}/${n2me.body && n2me.body.name}`);

      // N3 (K-F) — "ad yok" yalnız NULL: boş ad script'te NULL'a döner, DB boş metni reddeder
      ok('N3a script: yalnız-boşluk ad → NULL', normalizeDisplayName('   ') === null && normalizeDisplayName(null) === null);
      await expectReject('N3b (035 CHECK) display_name boş metin → REDDEDİLİR',
        () => pool.query("UPDATE users SET display_name = '  ' WHERE email = $1", [SUER]));

      // N4 (tek değişken) — 035 UYGULANMADAN deploy: kolon yokken login + /me çalışır, ad = e-posta
      const MIG035 = fs.readFileSync(path.join(BE, 'migrations/035_users_display_name.sql'), 'utf8');
      await pool.query('ALTER TABLE users DROP COLUMN display_name');
      try {
        const n4l = await call('POST', '/api/user-auth/login', { body: { email: SUER, password: PW } });
        const n4dec = n4l.body && n4l.body.token ? jwt.decode(n4l.body.token) : {};
        const n4me = await call('GET', '/api/user-auth/me', { token: n4l.body && n4l.body.token });
        const n4pc = await pool.connect();
        const n4p = await ownerPasswordState(n4pc); n4pc.release();
        ok('N4 kolon yokken: login 200 + token name = e-posta + /me 200 (display_name null)',
          n4l.status === 200 && n4dec.name === SUER && n4me.status === 200 && n4me.body.display_name === null,
          `${n4l.status}/${n4dec.name}/${n4me.status}`);
        ok('N4b kolon yokken ön kontrol has_name_column=false (CLI "035 first" der)', n4p.has_name_column === false, JSON.stringify(n4p));
      } finally {
        // N5 — 035 iki kez koşulur: kolonu geri kurar, ikinci koşu hatasız (idempotent)
        await pool.query(MIG035);
      }
      let n5err = '';
      try { await pool.query(MIG035); } catch (e) { n5err = e.message.slice(0, 70); }
      const n5 = (await pool.query(`SELECT
          (SELECT count(*)::int FROM information_schema.columns WHERE table_name='users' AND column_name='display_name') AS col,
          (SELECT count(*)::int FROM pg_constraint WHERE conname='users_display_name_not_blank') AS chk,
          (SELECT count(*)::int FROM schema_migrations WHERE version='035_users_display_name') AS rec`)).rows[0];
      ok('N5 (035) idempotent: ikinci koşu hatasız, kolon 1 · CHECK 1 · kayıt 1',
        !n5err && n5.col === 1 && n5.chk === 1 && n5.rec === 1, n5err || JSON.stringify(n5));

      // T1 (033) — TRUNCATE users REDDEDİLİR (CASCADE dahil; tx içinde, geri alınır)
      await resetAuth();
      const nBefore = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
      const tc = await pool.connect();
      let truncRejected = false, truncMsg = '';
      try {
        await tc.query('BEGIN');
        // CASCADE contract_line_items'a da iner; 034 (K-D) onu B10'dan ÖNCE reddederdi.
        // Bu test B10'u ölçer → K-D anahtarı yalnız bu (geri alınan) transaction'da açık.
        await tc.query("SET LOCAL ell.allow_line_item_reset = 'on'");
        await tc.query('TRUNCATE users CASCADE');
      } catch (e) { truncRejected = /B10/.test(e.message); truncMsg = e.message.slice(0, 60); }
      finally { await tc.query('ROLLBACK').catch(() => {}); tc.release(); }
      const nAfter = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
      ok('T1 (033) TRUNCATE users CASCADE → B10 ile REDDEDİLİR, satırlar yerinde', truncRejected && nAfter === nBefore, truncMsg);

      // R1 (033) — geriye dönük kayıt yalnız şema izi kanıtlıysa: test DB'de 032 VAR, 029-031 YOK
      const sm = (await pool.query("SELECT version FROM schema_migrations WHERE version ~ '^(029|03[0-3])_' ORDER BY 1")).rows.map(r => r.version);
      ok('R1 (033) schema_migrations: 032 + 033 var, izi olmayan 029/030/031 YOK',
        JSON.stringify(sm) === JSON.stringify(['032_users_and_first_owner', '033_users_truncate_guard']), JSON.stringify(sm));
    } finally {
      server.close();
      await resetAuth();
    }

    await resetUsers();
    console.log(`\n═══ USERS SONUÇ: ${pass} geçti, ${fail} başarısız ═══`);
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    if (fail > 0) process.exitCode = 1;
  }
})();
