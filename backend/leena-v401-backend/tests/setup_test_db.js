// Test DB kurulumu (ell_comm_test) — SIFIRDAN, idempotent. psql yok, node/pg ile.
// Bağlantı env'den: TEST_DATABASE_URL (default localhost/ell_comm_test). Sır repoda YOK.
//
// ⚠️ Bu dosya, silinen setup_comm_db.js'in hatırlanan hali DEĞİLDİR. Şema AYAKTA DURAN
//    ell_comm_test'ten ÖLÇÜLEREK yazıldı (2026-08-04): stub tablolar = canlı 10 tablo
//    eksi migration'ların ürettiği 8 = expos + core_countries. Kaynak: ölçüm, hatıra değil.
//
// SIRA (FK bağımlılığı ölçüldü):
//   - expos stub, 012'den ÖNCE  (contracts.expo_id → expos(id))
//   - core_countries stub, 026'dan ÖNCE  (offices.country_code → core_countries(code))
//   - offices + 5 seed: migration 026'dan gelir (stub değil).
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const MIG = path.join(__dirname, '..', 'migrations');

// 012 → 028, hepsi, atlanan yok (ölçüldü).
const ORDER = [
  '012_finance_foundation', '013_schema_migrations', '014_sales_agents_invariants',
  '015_schema_migrations_normalize', '016_contract_operational_columns', '017_payments',
  '018_payment_reversal', '019_transfer_guards', '020_commission_agents',
  '021_sales_agents_import_prep', '022_sales_agents_import_prep2',
  '023_drop_contracts_sales_agent_id', '024_contract_line_items', '025_commission_payouts',
  '026_payment_schedule', '027_payout_office_method', '028_agent_office',
];

const URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test';
const m = URL.match(/^(.*)\/([^/?]+)(\?.*)?$/);
if (!m) { console.error('TEST_DATABASE_URL çözümlenemedi:', URL); process.exit(1); }
const [, base, dbName, qs = ''] = m;
if (!/^[A-Za-z0-9_]+$/.test(dbName)) { console.error('Güvensiz DB adı:', dbName); process.exit(1); }
const adminUrl = base + '/postgres' + qs;

(async () => {
  // (1) Admin bağlantısı: DB'yi düşür + yeniden yarat → idempotent (her koşuda sıfırdan).
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const c = new Client({ connectionString: URL });
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

  // (3) Migration'lar 012→028, her biri kendi tx'inde (dosyalarda BEGIN/COMMIT yok).
  for (const name of ORDER) {
    const sql = fs.readFileSync(path.join(MIG, name + '.sql'), 'utf8');
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('COMMIT');
      console.log('  ✓ ' + name);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error('  ✗ ' + name + ' → ' + e.message);
      await c.end();
      process.exit(1);
    }
  }
  await c.end();
  console.log('Test DB hazır: ' + dbName + '  (offices 5 seed + expos 1-5 + core_countries 5)');
})().catch(e => { console.error('KURULUM HATASI:', e.message); process.exit(1); });
