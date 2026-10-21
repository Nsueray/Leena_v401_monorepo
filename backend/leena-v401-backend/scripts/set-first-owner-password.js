#!/usr/bin/env node
// scripts/set-first-owner-password.js — Faz 4 dilim 2 (Sentez K-B, 2026-10-08)
//
// İlk Owner'ın şifresini belirler. Render Shell'de, Suer koşar:
//   node scripts/set-first-owner-password.js
//
// ── GÜVENLİK HÜKÜMLERİ ──
// - Bağlantı YALNIZ ortamdaki PG* ile (Render Shell'de web servisinin env'i).
//   dotenv YÜKLENMEZ — yerel .env ile canlıya bağlanma yolu yok.
// - Önce hedef yazdırılır (current_database + session_user/current_user), sonra
//   SALT-OKUNUR ön kontrol: hash doluysa / Owner yoksa / belirsizse / 035 yoksa
//   HİÇBİR ŞEY SORULMADAN çıkılır (19 Eki notu). Ancak hazırsa "evet" onayı istenir.
// - Owner adı (Sentez K-F) sorulur, açık yazılır; boş bırakılırsa NULL (token e-posta taşır).
// - Şifre gizli sorulur (ekrana basılmaz), iki kez; eşleşmezse çıkılır.
//   Argümanla ya da env ile ALINMAZ, hiçbir yere loglanmaz.
// - Hash: mevcut giriş ile aynı bcrypt maliyeti (routes/auth.js:98 → 10).
// - YALNIZ is_owner AND is_active AND password_hash IS NULL satırına yazar.
//   Hash doluysa hiçbir şey yazmaz ("hash dolu, değişiklik yok"). EZME YOK.
// - password_must_change = false yazılır; ad verildiyse display_name aynı UPDATE'te yazılır.
// - Mantık setFirstOwnerPassword()'de (test edilebilir); CLI yalnız soru-cevap.

const BCRYPT_COST = 10;        // routes/auth.js:98
const MIN_PASSWORD_LENGTH = 6; // routes/auth.js:88

// Ad normalizasyonu: kırpılır; boş → NULL (035 CHECK'i boş metni zaten reddeder).
function normalizeDisplayName(name) {
  if (name == null) return null;
  const t = String(name).trim();
  return t === '' ? null : t;
}

// Salt-okunur ön kontrol — onaydan ÖNCE. Kilit almaz; yazım anındaki kesin kontrol
// setFirstOwnerPassword() içinde (FOR UPDATE) yeniden yapılır.
// Döner: { status: 'ready' | 'hash_present' | 'no_owner' | 'ambiguous', has_name_column }
async function ownerPasswordState(client) {
  const owners = await client.query(
    `SELECT (password_hash IS NULL) AS hash_null FROM users WHERE is_owner AND is_active`
  );
  const col = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'display_name'`
  );
  const empty = owners.rows.filter(r => r.hash_null).length;
  let status = 'ready';
  if (owners.rows.length === 0) status = 'no_owner';
  else if (empty === 0)         status = 'hash_present';
  else if (empty > 1)           status = 'ambiguous';
  return { status, has_name_column: col.rows.length === 1 };
}

// Mantık — bağlı bir pg client alır (transaction'ı kendisi yönetir).
// Döner: { status: 'written' | 'hash_present' | 'no_owner' | 'ambiguous' }
// displayName verilirse (boş değilse) display_name kolonu GEREKİR (035).
async function setFirstOwnerPassword(client, password, { bcrypt = require('bcrypt'), displayName = null } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const name = normalizeDisplayName(displayName);
  await client.query('BEGIN');
  try {
    const owners = await client.query(
      `SELECT id, (password_hash IS NULL) AS hash_null
         FROM users WHERE is_owner AND is_active
        FOR UPDATE`
    );
    const empty = owners.rows.filter(r => r.hash_null);
    if (owners.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'no_owner' }; }
    if (empty.length === 0)        { await client.query('ROLLBACK'); return { status: 'hash_present' }; }
    if (empty.length > 1)          { await client.query('ROLLBACK'); return { status: 'ambiguous' }; }

    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const upd = name === null
      ? await client.query(
          `UPDATE users SET password_hash = $1, password_must_change = false
            WHERE id = $2 AND is_owner AND is_active AND password_hash IS NULL`,
          [hash, empty[0].id])
      : await client.query(
          `UPDATE users SET password_hash = $1, password_must_change = false, display_name = $3
            WHERE id = $2 AND is_owner AND is_active AND password_hash IS NULL`,
          [hash, empty[0].id, name]);
    if (upd.rowCount !== 1) { await client.query('ROLLBACK'); return { status: 'hash_present' }; }
    await client.query('COMMIT');
    return { status: 'written' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function ask(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a); }));
}

// Gizli giriş: yazılanlar ekrana basılmaz.
function askHidden(question) {
  const readline = require('readline');
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) {
      if (s.includes(question)) rl.output.write(question);
    };
    rl.question(question, a => { rl.output.write('\n'); rl.close(); resolve(a); });
  });
}

const MESSAGES = {
  written:      'Owner password set; password_must_change = false.',
  hash_present: 'hash dolu, değişiklik yok (owner password already set — nothing changed).',
  no_owner:     'No active owner found. Nothing done.',
  ambiguous:    'More than one active owner without a password. Nothing done.',
};

async function main() {
  if (!process.env.PGHOST || !process.env.PGDATABASE) {
    console.error('PGHOST / PGDATABASE not set — run inside Render Shell. Nothing done.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  // utils/db.js ile aynı SSL ayarı; bağlantı bilgisi pg tarafından PG* env'den okunur.
  const pool = new Pool({ ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    const t = await client.query(
      'SELECT current_database() AS db, session_user AS ses, current_user AS usr');
    console.log(`Target: database=${t.rows[0].db} session_user=${t.rows[0].ses} current_user=${t.rows[0].usr}`);

    // Ön kontrol — hiçbir şey sorulmadan önce (19 Eki notu: hash doluysa onay bile istenmez).
    const pre = await ownerPasswordState(client);
    if (pre.status !== 'ready') { console.log(MESSAGES[pre.status]); return; }
    if (!pre.has_name_column) {
      console.log('users.display_name missing — run migration 035 first. Nothing done.');
      return;
    }

    const yes = await ask('Type "evet" to continue: ');
    if (yes.trim() !== 'evet') { console.log('Aborted. Nothing done.'); return; }

    const displayName = await ask('Owner display name (empty = none, email is shown): ');
    const p1 = await askHidden('New owner password: ');
    const p2 = await askHidden('Repeat password: ');
    if (p1 !== p2) { console.log('Passwords do not match. Nothing done.'); return; }

    const r = await setFirstOwnerPassword(client, p1, { displayName });
    console.log(MESSAGES[r.status]);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('Failed:', err.message); process.exit(1); });
}

module.exports = { setFirstOwnerPassword, ownerPasswordState, normalizeDisplayName, MIN_PASSWORD_LENGTH, BCRYPT_COST };
