// setup-fresh-db.js
// Leena EMS v401 — SAFE fresh-database setup.
//
// AMAC: Bos bir veritabanina initial.sql + migrations/*.sql'i dogru sirada
// uygulayarak semayi SIFIRDAN kurmak. Production'i ASLA silmemek.
//
// migrate.js'ten farki: migrate.js yalniz initial.sql'i (DROP CASCADE'li)
// kosulsuz calistirir. Bu script IKI guard ile korunur:
//   GUARD 1: acik `--fresh` flag'i yoksa  -> reddet, cik.
//   GUARD 2: hedef DB'de cekirdek tablolar (visitors/expos) ZATEN varsa
//            -> reddet, cik. (initial.sql'in DROP CASCADE'i ASLA calismaz.)
// Yani DROP yalnizca (--fresh VE bos DB) kosulu birlikte saglaninca tetiklenir.
//
// Kullanim:  DATABASE_URL=... node setup-fresh-db.js --fresh
//
// NOT: migrate.js ve initial.sql degistirilmedi. Bu sadece yeni bir arac.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const FRESH = process.argv.includes('--fresh');
const CORE_TABLES = ['visitors', 'expos']; // varsa = bos olmayan/kurulu DB

function refuse(msg) {
  console.error('🛑 REDDEDILDI: ' + msg);
  console.error('   Hicbir sey yapilmadi (DROP/CREATE calismadi).');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL .env icinde tanimli degil');
  process.exit(1);
}

// GUARD 1 — acik niyet flag'i
if (!FRESH) {
  refuse("'--fresh' flag'i verilmedi. Bu script bos bir DB'yi sifirdan kurar; "
       + "yanlislikla calistirmayi onlemek icin acik onay gerekir.");
}

// Lokal (test) baglantilarda SSL kapali; uzak (Render) baglantilarda acik.
const conn = process.env.DATABASE_URL;
const isLocal = /@?(localhost|127\.0\.0\.1)/.test(conn) || !/@/.test(conn);
const client = new Client({
  connectionString: conn,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  try {
    // GUARD 2 — cekirdek tablo var mi? (DROP'tan ONCE kontrol)
    const checks = CORE_TABLES.map(t => `to_regclass('public.${t}') IS NOT NULL`).join(' OR ');
    const { rows } = await client.query(`SELECT (${checks}) AS has_core`);
    if (rows[0].has_core) {
      // Burada CIKIYORUZ — initial.sql (DROP CASCADE) calismadan.
      refuse(`Hedef DB'de cekirdek tablolar (${CORE_TABLES.join('/')}) ZATEN var. `
           + `Bu muhtemelen kurulu/production bir DB. Veri kaybini onlemek icin durduruldu.`);
    }

    // Buraya ulastiysak: --fresh verildi VE DB bos. Guvenli kurulum.
    const base = __dirname;
    const initialPath = path.join(base, 'initial.sql');
    const migDir = path.join(base, 'migrations');
    const files = fs.readdirSync(migDir)
      .filter(f => /^\d.*\.sql$/.test(f) && !f.includes('rollback'))
      .sort(); // lexicographic: 000_ < 000a < 001 ... < 009

    console.log('✅ Bos DB + --fresh dogrulandi. Sema kuruluyor...');
    console.log('▶ initial.sql');
    await client.query(fs.readFileSync(initialPath, 'utf-8'));

    let n = 1;
    for (const f of files) {
      console.log(`▶ ${f}`);
      await client.query(fs.readFileSync(path.join(migDir, f), 'utf-8'));
      n++;
    }
    console.log(`🎉 Tamamlandi: initial.sql + ${files.length} migration uygulandi (${n} adim).`);
  } catch (err) {
    console.error('❌ Kurulum hatasi:', err.message || err);
    process.exitCode = 2;
  } finally {
    await client.end();
  }
})();
