// Test DB kurulumu (ell_comm_test) — SIFIRDAN, idempotent. psql yok, node/pg ile.
// Bağlantı env'den: TEST_DATABASE_URL (default localhost/ell_comm_test). Sır repoda YOK.
//
// ⚠️ İLKE (Sentez, 2026-09-13): "Test DB'si tüm veritabanının aynası değil,
//    TEST EDİLEN KODUN aynasıdır." Finans testleri → finans şeması (012+) +
//    bağlı olduğu OMURGA (organizers). Callcenter/campaign/email modülleri
//    (029/030/031) AYRI şema evreni — DIŞLA-listesinde, girmezler.
//
// ⚠️ Migration listesi SABİT DEĞİL: migrations/ dizini OKUNUR, 012'den sıralı
//    koşulur. 033+ finans migration'ı OTOMATİK girer (yalancı yeşil borcu kapandı).
//
// SIRA (FK bağımlılığı ölçüldü):
//   - expos stub, 012'den ÖNCE  (contracts.expo_id → expos(id))
//   - core_countries stub, 026'dan ÖNCE  (offices.country_code → core_countries(code))
//   - organizers stub, 032'den ÖNCE  (users.organizer_id → organizers(id) + ilk Owner seed)
//   - offices + 5 seed: migration 026'dan gelir (stub değil).
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const MIG = path.join(__dirname, '..', 'migrations');

// ── DIŞLA-LİSTESİ — her satır TEK CÜMLE gerekçeli. Kapsam = finans + omurga. ──
// Bakım: yeni bir email/callcenter migration'ı gelirse buraya eklenir (nadir).
// Unutulursa setup GÜRÜLTÜYLE patlar (eksik tablo hatası) — sessiz yalancı yeşil DEĞİL.
const EXCLUDE = new Set([
  '029_campaign_delivered_count.sql',       // email evreni: email_campaigns / email_queue test DB'de yok
  '030_callcenter_leads.sql',               // callcenter modülü: finans kapsamı dışı (bağımsız olsa da tutarlılık)
  '031_callcenter_email_queue_indexes.sql', // email_queue yok + CREATE INDEX CONCURRENTLY tx-içinde çalışmaz
]);

// 036+ dosyaları yalnız runner yoluyla uygulanır (kendini korur + kaydı runner yazar) —
// kurulum da AYNI fonksiyonu kullanır (scripts/migrate.js applyMigrationFile).
const { applyMigrationFile } = require(path.join(__dirname, '..', 'scripts', 'migrate.js'));
const RUNNER_ONLY_FROM = 36;
// İkinci DB: canlının Paket 1 ÖNCESİ şeması (≤ 035) — "deploy migration'dan önce" testleri
// (tests/test_ledger.js) ve runner'ın gerçek dosyalarla dry-run'ı (tests/test_migrate.js).
const PREMIG_MAX = 35;
// Üçüncü DB: canlının Paket 1b ÖNCESİ şeması (≤ 040) — tests/test_ledger_p1b_premig.js ve
// runner'ın Paket 1b dry-run'ı (tests/test_migrate.js R15-R17).
const P1_MAX = 40;

const CONN = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test';

// ── GUARD (whitelist) — hedef DB adı TAM 'ell_comm_test' değilse hiçbir şey yapma. ──
// DROP DATABASE prod'a karşı bugüne dek YALNIZ TESADÜFEN korunuyordu (Render'da
// TEST_DATABASE_URL tanımsız). Tesadüf güvenlik değil. Kontrol DROP'tan ÖNCE.
// ⚠️ Bağlantı string'i GÖSTERİLMEZ (şifre) — yalnız DB adı. Belirsizlik = ret.
let dbName;
try {
  dbName = decodeURIComponent(new URL(CONN).pathname.replace(/^\//, ''));
} catch (e) {
  console.error('GUARD: TEST_DATABASE_URL ayrıştırılamadı — reddedildi (belirsizlik = ret).');
  process.exit(1);
}
if (dbName !== 'ell_comm_test') {
  console.error(`GUARD: hedef DB '${dbName}' — yalnız 'ell_comm_test' kabul edilir. Hiçbir şey yapılmadı.`);
  process.exit(1);
}

// Admin bağlantısı: aynı sunucu, /postgres veritabanı (URL API — elle string kesme yok).
const adminU = new URL(CONN);
adminU.pathname = '/postgres';
const adminUrl = adminU.toString();

// premig DB adı ana adın türevidir ('ell_comm_test_premig') — guard ana adı zaten sabitledi.
const premigName = `${dbName}_premig`;
const premigU = new URL(CONN);
premigU.pathname = '/' + premigName;
const p1Name = `${dbName}_p1`;
const p1U = new URL(CONN);
p1U.pathname = '/' + p1Name;

async function buildDb(name, conn, maxNum) {
  // (1) Admin: DB düşür + yeniden yarat → idempotent (her koşuda sıfırdan).
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const c = new Client({ connectionString: conn });
  await c.connect();

  // (2) STUB'lar (migration'larda YOK, FK hedefi — ÖLÇÜLEN şema).
  await c.query(`CREATE TABLE expos (
    id serial PRIMARY KEY, name text, start_date date, end_date date, organizer_id integer)`);
  await c.query(`INSERT INTO expos (id, name, organizer_id)
                 SELECT g, 'Expo ' || g, 1 FROM generate_series(1, 5) g`);
  await c.query(`SELECT setval('expos_id_seq', 5, true)`);
  await c.query(`CREATE TABLE core_countries (
    code char(2) PRIMARY KEY, name varchar(100) NOT NULL)`);
  await c.query(`INSERT INTO core_countries (code, name) VALUES
    ('TR','Turkey'),('MA','Morocco'),('NG','Nigeria'),('KE','Kenya'),('CN','China')`);
  // organizers stub — OMURGA (authMiddleware okur; 032 users.organizer_id FK + ilk Owner
  // seed). MINIMUM = 032'nin ihtiyacı: id (FK hedefi) + email (ilk Owner DO bloğu eşleşmesi).
  // Canlı ölçüm (defter, 13 Eyl): organizers TEK SATIR, id=1, suer@elan-expo.com.
  await c.query(`CREATE TABLE organizers (
    id serial PRIMARY KEY, email text UNIQUE NOT NULL)`);
  await c.query(`INSERT INTO organizers (id, email) VALUES (1, 'suer@elan-expo.com')`);
  await c.query(`SELECT setval('organizers_id_seq', 1, true)`);

  // (3) Migration'lar — migrations/ dizininden, 012'den sıralı, DIŞLA hariç.
  //     Her biri kendi tx'inde (dosyalarda BEGIN/COMMIT yok).
  const files = fs.readdirSync(MIG)
    .filter(f => f.endsWith('.sql'))
    .filter(f => {
      const n = parseInt(f.slice(0, 3), 10);
      return Number.isInteger(n) && n >= 12 && n <= maxNum;   // 000-011: ELL-dışı çekirdek (stub'larla temsil)
    })
    .filter(f => !EXCLUDE.has(f))
    .sort((a, b) => parseInt(a.slice(0, 3), 10) - parseInt(b.slice(0, 3), 10));  // SAYISAL (alfabetik değil)

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIG, file), 'utf8');
    try {
      await c.query('BEGIN');
      if (parseInt(file.slice(0, 3), 10) >= RUNNER_ONLY_FROM) await applyMigrationFile(c, file.slice(0, -4), sql);
      else await c.query(sql);
      await c.query('COMMIT');
      console.log('  ✓ ' + file);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error('  ✗ ' + file + ' → ' + e.message);   // AÇIKÇA patla (sessiz atlama YOK)
      await c.end();
      process.exit(1);
    }
  }
  await c.end();
  console.log(`Test DB hazır: ${name}  (${files.length} migration + expos/core_countries/organizers stub)`);
}

(async () => {
  await buildDb(dbName, CONN, Infinity);
  await buildDb(premigName, premigU.toString(), PREMIG_MAX);
  await buildDb(p1Name, p1U.toString(), P1_MAX);
})().catch(e => { console.error('KURULUM HATASI:', e.message); process.exit(1); });
