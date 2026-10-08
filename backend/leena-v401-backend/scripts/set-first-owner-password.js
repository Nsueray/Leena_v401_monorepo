#!/usr/bin/env node
// scripts/set-first-owner-password.js — Faz 4 dilim 2 (Sentez K-B, 2026-10-08)
//
// İlk Owner'ın şifresini belirler. Render Shell'de, Suer koşar:
//   node scripts/set-first-owner-password.js
//
// ── GÜVENLİK HÜKÜMLERİ ──
// - Bağlantı YALNIZ ortamdaki PG* ile (Render Shell'de web servisinin env'i).
//   dotenv YÜKLENMEZ — yerel .env ile canlıya bağlanma yolu yok.
// - Önce hedef yazdırılır (current_database + current_user), "evet" onayı istenir.
// - Şifre gizli sorulur (ekrana basılmaz), iki kez; eşleşmezse çıkılır.
//   Argümanla ya da env ile ALINMAZ, hiçbir yere loglanmaz.
// - Hash: mevcut giriş ile aynı bcrypt maliyeti (routes/auth.js:98 → 10).
// - YALNIZ is_owner AND is_active AND password_hash IS NULL satırına yazar.
//   Hash doluysa hiçbir şey yazmaz ("hash dolu, değişiklik yok"). EZME YOK.
// - password_must_change = false yazılır.
// - Mantık setFirstOwnerPassword()'de (test edilebilir); CLI yalnız soru-cevap.

const BCRYPT_COST = 10;        // routes/auth.js:98
const MIN_PASSWORD_LENGTH = 6; // routes/auth.js:88

// Mantık — bağlı bir pg client alır (transaction'ı kendisi yönetir).
// Döner: { status: 'written' | 'hash_present' | 'no_owner' | 'ambiguous' }
async function setFirstOwnerPassword(client, password, { bcrypt = require('bcrypt') } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
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
    const upd = await client.query(
      `UPDATE users SET password_hash = $1, password_must_change = false
        WHERE id = $2 AND is_owner AND is_active AND password_hash IS NULL`,
      [hash, empty[0].id]
    );
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
    const t = await client.query('SELECT current_database() AS db, current_user AS usr');
    console.log(`Target: database=${t.rows[0].db} user=${t.rows[0].usr}`);
    const yes = await ask('Type "evet" to continue: ');
    if (yes.trim() !== 'evet') { console.log('Aborted. Nothing done.'); return; }

    const p1 = await askHidden('New owner password: ');
    const p2 = await askHidden('Repeat password: ');
    if (p1 !== p2) { console.log('Passwords do not match. Nothing done.'); return; }

    const r = await setFirstOwnerPassword(client, p1);
    const msg = {
      written:      'Owner password set; password_must_change = false.',
      hash_present: 'hash dolu, değişiklik yok (owner password already set — nothing changed).',
      no_owner:     'No active owner found. Nothing done.',
      ambiguous:    'More than one active owner without a password. Nothing done.',
    }[r.status];
    console.log(msg);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('Failed:', err.message); process.exit(1); });
}

module.exports = { setFirstOwnerPassword, MIN_PASSWORD_LENGTH, BCRYPT_COST };
