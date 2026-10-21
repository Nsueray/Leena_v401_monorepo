#!/usr/bin/env node
// scripts/migrate.js — migration runner (Paket 1 P1-0, 2026-10-21)
//
// Render Shell'de, Suer koşar:
//   node scripts/migrate.js --dry-run   → bekleyenleri uygula + ROLLBACK + listele
//   node scripts/migrate.js             → bekleyenleri TEK transaction'da uygula + kaydet
//
// ── HÜKÜMLER ──
// - Bağlantı YALNIZ ortamdaki PG* ile (set-first-owner-password.js deseni). dotenv
//   YÜKLENMEZ, URL argümanı YOK — yerel .env ile canlıya bağlanma yolu yok.
//   PGSSLMODE=disable yalnız yerel test sunucusu içindir (SSL'siz Postgres).
// - migrations/ dizini sıralı okunur; schema_migrations'ta OLMAYANLAR tek transaction'da
//   uygulanır, her biri applied_at=now() ile kaydedilir. Biri patlarsa HİÇBİRİ kalmaz.
// - Önce hedef yazdırılır (current_database + session_user/current_user + sürüm).
//   EXPECTED_DB_NAME tanımlıysa (staging env'i) eşleşmeyen DB'de DUR (bootGuards).
// - DUR koşulları (hiçbir şey uygulanmaz, çıkış 2):
//     · kayıtlı-dosyasız — schema_migrations'ta olup migrations/'da dosyası olmayan sürüm
//     · yarım — kayıtsız dosyanın şema izi (tablo/kolon/index/fonksiyon/trigger/constraint)
//       veritabanında VAR (elle ya da kısmen uygulanmış)
//     · numara boşluğu / çakışması · tanınmayan .sql dosyası
//     · sıra dışı bekleyen — kayıtlı en büyük sürümden KÜÇÜK numaralı kayıtsız dosya
//     · aynı anda ikinci runner (advisory lock)
// - 036+ dosyaları kendi kaydını YAZMAZ; runner yazar. O dosyalar `ell.migration_runner`
//   ayarı 'on' değilse kendini reddeder (psql -f ile koşulamaz → kayıtsız uygulama yok).
// - `*_rollback.sql` migration değildir (013_schema_migrations.sql:73 notu) → atlanır.
// - Mantık fonksiyonlarda (test edilebilir); CLI yalnız bağlantı + yazdırma.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const NAME_RE = /^(\d{3})([a-z]?)_[A-Za-z0-9_]+\.sql$/;
const ROLLBACK_RE = /_rollback\.sql$/;
const LOCK_KEY = 'ell.migrate';

// 013_schema_migrations.sql:26-30 ile BİREBİR (DEFAULT yok — o dosyadaki gerekçe).
const REGISTRY_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text        NOT NULL,
  applied_at timestamptz,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
)`;

// ── Dosya listesi + numara denetimi ─────────────────────────────────────────
// Döner: { files: [{version, file, num, suffix}], skipped: [{file, reason}], problems: [] }
function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const out = { files: [], skipped: [], problems: [] };
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of names) {
    if (ROLLBACK_RE.test(f)) { out.skipped.push({ file: f, reason: 'rollback script (not a migration)' }); continue; }
    const m = f.match(NAME_RE);
    if (!m) { out.problems.push(`unrecognized file name: ${f}`); continue; }
    out.files.push({ version: f.slice(0, -4), file: f, num: parseInt(m[1], 10), suffix: m[2] });
  }
  out.files.sort((a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix));

  // Çakışma: aynı numara+sonek iki dosyada.
  const seen = new Map();
  for (const x of out.files) {
    const key = String(x.num).padStart(3, '0') + x.suffix;
    if (seen.has(key)) out.problems.push(`number conflict ${key}: ${seen.get(key)} / ${x.file}`);
    else seen.set(key, x.file);
  }
  // Boşluk: tam sayı kısmı ilkten sona kesintisiz; sonekli dosya tabanı olmadan duramaz.
  const bases = new Set(out.files.filter(x => x.suffix === '').map(x => x.num));
  if (out.files.length) {
    const lo = out.files[0].num, hi = out.files[out.files.length - 1].num;
    for (let n = lo; n <= hi; n++) {
      if (!bases.has(n)) out.problems.push(`number gap: ${String(n).padStart(3, '0')} missing`);
    }
  }
  for (const x of out.files) {
    if (x.suffix && !bases.has(x.num)) out.problems.push(`suffix without base: ${x.file}`);
  }
  return out;
}

// ── Şema izi: dosyanın YARATTIĞI nesneler ───────────────────────────────────
// Yorumlar ve $$…$$ gövdeleri çıkarılır (fonksiyon gövdesindeki metin iz sayılmaz).
function stripSql(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}
const ident = s => s.replace(/"/g, '').split('.').pop().toLowerCase();

function extractTraces(sql) {
  const s = stripSql(sql);
  const t = { relations: new Set(), functions: new Set(), triggers: [], columns: [], constraints: new Set() };
  let m;
  const rel = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = rel.exec(s))) t.relations.add(ident(m[1]));
  const tbl = /\bCREATE\s+(?:(?:UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = tbl.exec(s))) t.relations.add(ident(m[1]));
  const view = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = view.exec(s))) t.relations.add(ident(m[1]));
  const seq = /\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = seq.exec(s))) t.relations.add(ident(m[1]));
  const fn = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+("?[\w.]+"?)\s*\(/gi;
  while ((m = fn.exec(s))) t.functions.add(ident(m[1]));
  const trg = /\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+("?\w+"?)[\s\S]*?\bON\s+("?[\w.]+"?)/gi;
  while ((m = trg.exec(s))) t.triggers.push({ name: ident(m[1]), table: ident(m[2]) });
  // ALTER TABLE x ... ; → içindeki ADD COLUMN / ADD CONSTRAINT'ler.
  const alt = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?("?[\w.]+"?)([\s\S]*?);/gi;
  while ((m = alt.exec(s))) {
    const table = ident(m[1]);
    const body = m[2];
    let c;
    const col = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)/gi;
    while ((c = col.exec(body))) t.columns.push({ table, column: ident(c[1]) });
    const con = /\bADD\s+CONSTRAINT\s+("?\w+"?)/gi;
    while ((c = con.exec(body))) t.constraints.add(ident(c[1]));
  }
  // Takip tablosunun kendisi iz sayılmaz (runner bootstrap'ı da yaratır).
  t.relations.delete('schema_migrations');
  return t;
}

// Var olan izleri döndürür (boş dizi = iz yok). Şema = current_schema().
async function findExistingTraces(client, traces) {
  const found = [];
  for (const r of traces.relations) {
    const q = await client.query(
      `SELECT 1 FROM pg_class c WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace`, [r]);
    if (q.rows.length) found.push(`relation ${r}`);
  }
  for (const f of traces.functions) {
    const q = await client.query(
      `SELECT 1 FROM pg_proc WHERE proname = $1 AND pronamespace = current_schema()::regnamespace`, [f]);
    if (q.rows.length) found.push(`function ${f}`);
  }
  for (const tr of traces.triggers) {
    const q = await client.query(
      `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = $1 AND c.relname = $2 AND c.relnamespace = current_schema()::regnamespace`,
      [tr.name, tr.table]);
    if (q.rows.length) found.push(`trigger ${tr.name} on ${tr.table}`);
  }
  for (const c of traces.columns) {
    const q = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, [c.table, c.column]);
    if (q.rows.length) found.push(`column ${c.table}.${c.column}`);
  }
  for (const k of traces.constraints) {
    const q = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = current_schema()::regnamespace`, [k]);
    if (q.rows.length) found.push(`constraint ${k}`);
  }
  return found;
}

// ── Plan: kayıt ↔ dosya karşılaştırması + DUR koşulları ─────────────────────
// Döner: { registry: [version], pending: [file], problems: [string], skipped }
async function plan(client, dir = MIGRATIONS_DIR) {
  const listing = listMigrationFiles(dir);
  const problems = [...listing.problems];

  const reg = await client.query(
    `SELECT to_regclass('schema_migrations') IS NOT NULL AS has_table`);
  const registry = reg.rows[0].has_table
    ? (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r => r.version)
    : [];
  const regSet = new Set(registry);
  const fileSet = new Set(listing.files.map(f => f.version));

  for (const v of registry) {
    if (!fileSet.has(v)) problems.push(`recorded without file: ${v}`);
  }

  const pending = listing.files.filter(f => !regSet.has(f.version));
  const recordedFiles = listing.files.filter(f => regSet.has(f.version));
  const last = recordedFiles.length ? recordedFiles[recordedFiles.length - 1] : null;
  for (const f of pending) {
    if (last && (f.num < last.num || (f.num === last.num && f.suffix < last.suffix))) {
      problems.push(`out-of-order pending file: ${f.file} (last recorded ${last.version})`);
    }
  }
  for (const f of pending) {
    const traces = extractTraces(fs.readFileSync(path.join(dir, f.file), 'utf8'));
    const found = await findExistingTraces(client, traces);
    if (found.length) problems.push(`unrecorded but schema trace exists (half-applied?): ${f.version} → ${found.join(', ')}`);
  }
  return { registry, hasRegistry: reg.rows[0].has_table, pending, problems, skipped: listing.skipped };
}

// Tek dosyanın uygulanması — runner VE test kurulumu aynı yolu kullanır.
// Çağıran transaction içindedir. 036+ koruması için ayar YALNIZ bu transaction'da açık.
async function applyMigrationFile(client, version, sql) {
  await client.query("SET LOCAL ell.migration_runner = 'on'");
  await client.query(sql);
  await client.query(
    `INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())
     ON CONFLICT (version) DO NOTHING`, [version]);
}

// ── Çalıştır ────────────────────────────────────────────────────────────────
// Döner: { status: 'dur' | 'nothing' | 'dry_run' | 'applied', applied: [version],
//          problems, registry, skipped }. SQL hatası → throw (transaction geri alınmıştır).
async function run(client, { dir = MIGRATIONS_DIR, dryRun = false, log = () => {} } = {}) {
  await client.query('BEGIN');
  try {
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [LOCK_KEY]);
    if (!lock.rows[0].ok) {
      await client.query('ROLLBACK');
      return { status: 'dur', applied: [], problems: ['another migrate run holds the lock'], registry: [], skipped: [] };
    }
    const p = await plan(client, dir);
    if (p.problems.length) {
      await client.query('ROLLBACK');
      return { status: 'dur', applied: [], ...p };
    }
    if (!p.pending.length) {
      await client.query('ROLLBACK');
      return { status: 'nothing', applied: [], ...p };
    }
    if (!p.hasRegistry) await client.query(REGISTRY_DDL);   // boş DB: kayıt tablosu (013 ile aynı DDL)
    const applied = [];
    for (const f of p.pending) {
      const t0 = Date.now();
      log({ event: 'start', version: f.version });
      await applyMigrationFile(client, f.version, fs.readFileSync(path.join(dir, f.file), 'utf8'));
      applied.push(f.version);
      log({ event: 'done', version: f.version, ms: Date.now() - t0 });
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return { status: dryRun ? 'dry_run' : 'applied', applied, ...p };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const unknown = args.filter(a => a !== '--dry-run');
  if (unknown.length) {
    return { error: `unknown argument(s): ${unknown.join(' ')} — usage: node scripts/migrate.js [--dry-run] (connection only from PG* env)` };
  }
  return { dryRun: args.includes('--dry-run') };
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.error) { console.error(a.error); process.exit(1); }
  if (!process.env.PGHOST || !process.env.PGDATABASE) {
    console.error('PGHOST / PGDATABASE not set — run inside Render Shell. Nothing done.');
    process.exit(1);
  }
  const { Client } = require('pg');
  // utils/db.js ile aynı SSL ayarı; bağlantı bilgisi pg tarafından PG* env'den okunur.
  const client = new Client({ ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  client.on('notice', n => console.log(`    NOTICE: ${n.message}`));
  await client.connect();
  try {
    const t = await client.query(
      `SELECT current_database() AS db, session_user AS ses, current_user AS usr,
              current_setting('server_version') AS ver`);
    const id = t.rows[0];
    console.log(`Target: database=${id.db} session_user=${id.ses} current_user=${id.usr} server=${id.ver}`);
    const expected = process.env.EXPECTED_DB_NAME;
    if (expected && expected.trim() && expected.trim() !== id.db) {
      console.log(`DUR: EXPECTED_DB_NAME=${expected.trim()} but connected to ${id.db}. Nothing applied.`);
      process.exitCode = 2;
      return;
    }
    console.log(`Mode: ${a.dryRun ? 'DRY-RUN (everything is rolled back)' : 'APPLY (single transaction)'}`);

    const r = await run(client, {
      dryRun: a.dryRun,
      log: e => { if (e.event === 'done') console.log(`  ✓ ${e.version} (${e.ms} ms)`); else console.log(`  → ${e.version}`); },
    });
    const lastReg = r.registry.length ? r.registry[r.registry.length - 1] : '(none)';
    console.log(`Registry before run: ${r.registry.length} recorded, last ${lastReg}`);
    for (const s of r.skipped) console.log(`Skipped file: ${s.file} — ${s.reason}`);
    if (r.status === 'dur') {
      console.log('DUR — nothing applied:');
      for (const p of r.problems) console.log(`  - ${p}`);
      process.exitCode = 2;
      return;
    }
    if (r.status === 'nothing') { console.log('Nothing to apply — registry matches migrations/.'); return; }
    if (r.status === 'dry_run') {
      console.log(`DRY-RUN OK: ${r.applied.length} migration(s) applied then ROLLBACK — nothing persisted:`);
    } else {
      console.log(`COMMIT: ${r.applied.length} migration(s) applied and recorded in schema_migrations:`);
    }
    for (const v of r.applied) console.log(`  ${v}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('FAILED (rolled back, nothing applied):', err.message); process.exit(1); });
}

module.exports = {
  listMigrationFiles, extractTraces, findExistingTraces, plan, run, applyMigrationFile,
  parseArgs, MIGRATIONS_DIR, REGISTRY_DDL,
};
