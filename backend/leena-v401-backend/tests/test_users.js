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
