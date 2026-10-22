// MIGRATION RUNNER (Paket 1 P1-0) testi — scripts/migrate.js.
//  (a) Fixture senaryoları: ell_comm_test içinde geçici ŞEMALARDA (search_path) — boş / yarım /
//      tam / kayıtlı-dosyasız / boşluk / çakışma / sıra dışı / atomiklik / kilit / 036+ koruması.
//  (b) GERÇEK dosyalar (Paket 1 kümesine, ≤ 040, dondurulmuş): ell_comm_test_premig (şema ≤ 035) üzerinde dry-run;
//      sonra onun KOPYASINDA CLI (PG* env) ile dry-run → apply → tekrar → DUR.
//  (c) Paket 1b: ell_comm_test_p1 (şema ≤ 040) üzerinde gerçek migrations/ + gerçek CLI.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const BE = path.join(__dirname, '..');
const { Client } = require(path.join(BE, 'node_modules/pg'));
const M = require(path.join(BE, 'scripts/migrate.js'));
const MAIN = new URL(process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test');
const dbUrl = (name) => { const u = new URL(MAIN); u.pathname = '/' + name; return u.toString(); };
const MAIN_NAME = decodeURIComponent(MAIN.pathname.replace(/^\//, ''));
const PREMIG = MAIN_NAME + '_premig';
const COPY = MAIN_NAME + '_premig_run';
const P1 = MAIN_NAME + '_p1';             // şema ≤ 040 (Paket 1 canlıda, Paket 1b öncesi)
const COPY_P1 = MAIN_NAME + '_p1_run';

// (b) bölümünün R9-R14'ü Paket 1 GEÇİŞİNİN (035 → 040) provasıdır: dosya kümesi o pakete
// DONDURULUR — gerçek dosyaların ≤ 040 kopyası + runner'ın birebir kopyası (CLI aynı kodla
// koşar). Böylece sonraki paketlerin dosyaları bu provanın beklentisini değiştirmez.
// Paket 1b geçişi (040 → 042) R15-R17'de, gerçek migrations/ dizini üzerinde.
const FROZEN = fs.mkdtempSync(path.join(os.tmpdir(), 'ell-mig-p1-'));
fs.mkdirSync(path.join(FROZEN, 'migrations'));
fs.mkdirSync(path.join(FROZEN, 'scripts'));
for (const f of fs.readdirSync(M.MIGRATIONS_DIR)) {
  if (/^\d{3}/.test(f) && parseInt(f, 10) <= 40) fs.copyFileSync(path.join(M.MIGRATIONS_DIR, f), path.join(FROZEN, 'migrations', f));
}
fs.copyFileSync(path.join(BE, 'scripts/migrate.js'), path.join(FROZEN, 'scripts/migrate.js'));
fs.symlinkSync(path.join(BE, 'node_modules'), path.join(FROZEN, 'node_modules'), 'dir');
const FROZEN_MIG = path.join(FROZEN, 'migrations');
const FROZEN_CLI = path.join(FROZEN, 'scripts/migrate.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ell-mig-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}
const A = 'CREATE TABLE a (id int);';
const Bsql = 'CREATE TABLE b (id int); ALTER TABLE a ADD COLUMN x int;';
const Csql = 'CREATE INDEX ix_b ON b (id);';
async function schemaClient(schema) {
  const c = new Client({ connectionString: dbUrl(MAIN_NAME) });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await c.query(`CREATE SCHEMA ${schema}`);
  await c.query(`SET search_path TO ${schema}`);
  return c;
}
const rel = async (c, n) => (await c.query('SELECT to_regclass($1) IS NOT NULL AS e', [n])).rows[0].e;
const regRows = async (c) => (await rel(c, 'schema_migrations'))
  ? (await c.query('SELECT version, applied_at IS NOT NULL AS dated FROM schema_migrations ORDER BY 1')).rows : [];
async function seedRegistry(c, versions) {
  await c.query(M.REGISTRY_DDL);
  for (const v of versions) await c.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NULL)', [v]);
}
function cli(db, args, extraEnv = {}, script = FROZEN_CLI) {
  const u = new URL(dbUrl(db));
  const env = Object.assign({}, process.env, {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username || 'postgres'),
    PGPASSWORD: decodeURIComponent(u.password || ''), PGDATABASE: db, PGSSLMODE: 'disable',
  }, extraEnv);
  delete env.EXPECTED_DB_NAME;
  if (extraEnv.EXPECTED_DB_NAME) env.EXPECTED_DB_NAME = extraEnv.EXPECTED_DB_NAME;
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', cwd: BE });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  const schemas = [];
  try {
    // ══ (a) Fixture senaryoları ══
    console.log('\n── Runner: fixture senaryoları ──');
    const dir3 = fixture({ '001_a.sql': A, '002_b.sql': Bsql, '003_c.sql': Csql });

    let c = await schemaClient('mig_empty'); schemas.push('mig_empty');
    const dry = await M.run(c, { dir: dir3, dryRun: true });
    const afterDry = [await rel(c, 'a'), await rel(c, 'schema_migrations')];
    ok('R1a BOŞ DB --dry-run: 3 dosya uygulanıp ROLLBACK · tablo da kayıt tablosu da kalmadı',
      dry.status === 'dry_run' && dry.applied.join() === '001_a,002_b,003_c' && !afterDry[0] && !afterDry[1], JSON.stringify([dry.status, dry.applied, afterDry]));
    const real = await M.run(c, { dir: dir3 });
    const reg = await regRows(c);
    ok('R1b BOŞ DB uygula: tek transaction, 3 kayıt applied_at=now() · nesneler var',
      real.status === 'applied' && reg.length === 3 && reg.every(r => r.dated) && await rel(c, 'ix_b'), JSON.stringify([real.status, reg]));
    const again = await M.run(c, { dir: dir3 });
    ok('R1c TAM DB: ikinci koşu "nothing" (kayıt = dosyalar)', again.status === 'nothing' && again.applied.length === 0, again.status);
    await c.end();

    c = await schemaClient('mig_half'); schemas.push('mig_half');
    await seedRegistry(c, ['001_a']); await c.query(A); await c.query('CREATE TABLE b (id int)');   // 002 yarım: tablo var, kayıt yok
    const half = await M.run(c, { dir: dir3 });
    ok('R2 YARIM: kayıtsız 002\'nin izi (relation b) var → DUR · hiçbir şey uygulanmadı (003 index yok, kayıt 1)',
      half.status === 'dur' && half.problems.some(p => /002_b/.test(p) && /relation b/.test(p)) && !(await rel(c, 'ix_b')) && (await regRows(c)).length === 1,
      JSON.stringify([half.status, half.problems]));
    await c.end();

    c = await schemaClient('mig_ghost'); schemas.push('mig_ghost');
    await seedRegistry(c, ['001_a', '002_b', '003_c', '004_ghost']);
    const ghost = await M.run(c, { dir: dir3 });
    ok('R3 KAYITLI-DOSYASIZ: 004_ghost kayıtlı, dosyası yok → DUR', ghost.status === 'dur' && ghost.problems.some(p => /recorded without file: 004_ghost/.test(p)), JSON.stringify(ghost.problems));
    await c.end();

    const gap = M.listMigrationFiles(fixture({ '001_a.sql': A, '003_c.sql': Csql }));
    const dup = M.listMigrationFiles(fixture({ '001_a.sql': A, '002_x.sql': A, '002_y.sql': A }));
    const odd = M.listMigrationFiles(fixture({ '001_a.sql': A, 'notes.sql': A, '002_b_rollback.sql': A }));
    ok('R4 NUMARA: boşluk (002 yok) · çakışma (002 iki dosya) · tanınmayan ad → problem · *_rollback.sql atlanır',
      gap.problems.some(p => /gap: 002/.test(p)) && dup.problems.some(p => /conflict 002/.test(p)) &&
      odd.problems.some(p => /unrecognized file name: notes.sql/.test(p)) && odd.skipped.some(s => s.file === '002_b_rollback.sql'),
      JSON.stringify([gap.problems, dup.problems, odd.problems, odd.skipped]));

    c = await schemaClient('mig_order'); schemas.push('mig_order');
    await seedRegistry(c, ['001_a', '003_c']); await c.query(A);
    const order = await M.run(c, { dir: dir3 });
    ok('R5 SIRA DIŞI: 003 kayıtlıyken kayıtsız 002 → DUR', order.status === 'dur' && order.problems.some(p => /out-of-order pending file: 002_b/.test(p)), JSON.stringify(order.problems));
    await c.end();

    c = await schemaClient('mig_atomic'); schemas.push('mig_atomic');
    let thrown = '';
    try { await M.run(c, { dir: fixture({ '001_a.sql': A, '002_b.sql': Bsql, '003_bad.sql': 'CREATE TABLEX nope;' }) }); }
    catch (e) { thrown = e.message; }
    ok('R6 ATOMİK: 3. dosya patlar → 1. ve 2. de geri alınır (tek transaction), kayıt tablosu bile yok',
      /syntax/.test(thrown) && !(await rel(c, 'a')) && !(await rel(c, 'b')) && !(await rel(c, 'schema_migrations')), thrown.slice(0, 60));
    await c.end();

    c = await schemaClient('mig_lock'); schemas.push('mig_lock');
    const holder = new Client({ connectionString: dbUrl(MAIN_NAME) }); await holder.connect();
    await holder.query('BEGIN'); await holder.query("SELECT pg_advisory_xact_lock(hashtext('ell.migrate'))");
    const locked = await M.run(c, { dir: dir3 });
    await holder.query('ROLLBACK'); await holder.end();
    ok('R7 KİLİT: ikinci runner aynı anda → DUR, hiçbir şey uygulanmadı', locked.status === 'dur' && /lock/.test(locked.problems[0]) && !(await rel(c, 'a')), JSON.stringify(locked.problems));
    await c.end();

    // 036+ koruması: dosya psql -f gibi DOĞRUDAN koşulursa kendini reddeder.
    c = await schemaClient('mig_guard'); schemas.push('mig_guard');
    let guardErr = '';
    try { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(M.MIGRATIONS_DIR, '036_ledger_reference.sql'), 'utf8')); }
    catch (e) { guardErr = e.message; } finally { await c.query('ROLLBACK').catch(() => {}); }
    const guarded = fs.readdirSync(M.MIGRATIONS_DIR).filter(f => parseInt(f, 10) >= 36)
      .filter(f => !/current_setting\('ell\.migration_runner', true\)/.test(fs.readFileSync(path.join(M.MIGRATIONS_DIR, f), 'utf8')));
    const selfRecord = fs.readdirSync(M.MIGRATIONS_DIR).filter(f => parseInt(f, 10) >= 36)
      .filter(f => /INSERT INTO schema_migrations/i.test(fs.readFileSync(path.join(M.MIGRATIONS_DIR, f), 'utf8')));
    ok('R8 036+ koruması: 036 doğrudan koşulunca reddeder · 036+ dosyalarının HEPSİ korumalı · hiçbiri kendi kaydını yazmıyor (runner yazar)',
      /yalniz scripts\/migrate\.js/.test(guardErr) && guarded.length === 0 && selfRecord.length === 0, JSON.stringify([guardErr.slice(0, 50), guarded, selfRecord]));
    await c.end();

    // ══ (b) GERÇEK dosyalar ══
    console.log('\n── Runner: gerçek migrations/ (canlı şekilli şema ≤ 035) ──');
    let p = new Client({ connectionString: dbUrl(PREMIG) }); await p.connect();
    // Canlıyla AYNI kayıt (ölçüldü 21 Eki: canlı + staging 37 kayıt = 37 dosya, ≤ 035): test DB'si
    // 029-031'i DIŞLAR (YON-09) ve 016 kendi kaydını yazmayan bir dosyadır (canlıda elle kayıtlı).
    for (const f of M.listMigrationFiles().files.filter(x => x.num <= 35)) {
      await p.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NULL) ON CONFLICT DO NOTHING', [f.version]);
    }
    const regCount = (await p.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
    const notices = [];
    p.on('notice', n => notices.push(n.message));
    const pd = await M.run(p, { dryRun: true, dir: FROZEN_MIG });
    const leftover = await rel(p, 'ledger_entries');
    ok('R9 GERÇEK dosyalar --dry-run (37 kayıt, canlı şekli): bekleyen TAM 036-040 · uygulandı + ROLLBACK · iz kalmadı',
      regCount === 37 && pd.status === 'dry_run' &&
      pd.applied.join() === '036_ledger_reference,037_ledger_reference_seed,038_payments_account_payer,039_ledger_core,040_expo_budgets' && !leftover,
      JSON.stringify([regCount, pd.status, pd.applied, pd.problems, leftover]));
    ok('R10 dry-run NOTICE\'leri: 037 tohum sayıları + 038 payments satır sayısı', notices.some(n => /^037: organizer 1 → currencies \+8/.test(n)) && notices.some(n => /^038: payments \d+ rows/.test(n)),
      JSON.stringify(notices));
    await p.end();

    // Kopya DB'de gerçek CLI (Suer'in koşacağı komut) — premig'e dokunmadan.
    const admin = new Client({ connectionString: dbUrl('postgres') }); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${COPY}`);
    await admin.query(`CREATE DATABASE ${COPY} TEMPLATE ${PREMIG}`);
    await admin.end();
    const badArg = cli(COPY, ['--url', 'postgres://x']);
    const exp = cli(COPY, ['--dry-run'], { EXPECTED_DB_NAME: 'leena_v401_db' });
    ok('R11 CLI: URL argümanı REDDEDİLİR (çıkış 1) · EXPECTED_DB_NAME uyuşmazsa DUR (çıkış 2), hiçbir şey uygulanmaz',
      badArg.code === 1 && /unknown argument/.test(badArg.out) && exp.code === 2 && /DUR: EXPECTED_DB_NAME/.test(exp.out), JSON.stringify([badArg.code, exp.code, exp.out.slice(0, 160)]));
    const cDry = cli(COPY, ['--dry-run']);
    const cApply = cli(COPY, []);
    const cAgain = cli(COPY, []);
    ok('R12 CLI uçtan uca: --dry-run "DRY-RUN OK: 5" → uygula "COMMIT: 5" → tekrar "Nothing to apply" (çıkış 0/0/0)',
      cDry.code === 0 && /DRY-RUN OK: 5 migration/.test(cDry.out) && cApply.code === 0 && /COMMIT: 5 migration/.test(cApply.out) &&
      cAgain.code === 0 && /Nothing to apply/.test(cAgain.out), JSON.stringify([cDry.code, cApply.code, cAgain.code, cApply.out.slice(-300)]));
    p = new Client({ connectionString: dbUrl(COPY) }); await p.connect();
    const after = (await p.query(`SELECT count(*)::int n, count(*) FILTER (WHERE version >= '036' AND applied_at IS NOT NULL)::int dated,
        (SELECT count(*)::int FROM currencies) cur, to_regclass('public.ledger_lines') IS NOT NULL AS view
        FROM schema_migrations`)).rows[0];
    ok('R13 uygulama sonrası: 42 kayıt (036-040 applied_at dolu) · tohum + ledger_lines view var', after.n === 42 && after.dated === 5 && after.cur === 8 && after.view,
      JSON.stringify(after));
    await p.query('CREATE TABLE junk_unrecorded (id int)');   // kayıtsız iz, ama dosyası yok → plan'ı etkilemez
    await p.query("INSERT INTO schema_migrations (version, applied_at) VALUES ('041_not_a_file', NULL)");
    const cGhost = cli(COPY, []);
    ok('R14 CLI DUR: kayıtlı-dosyasız sürüm → çıkış 2 + "DUR — nothing applied"', cGhost.code === 2 && /DUR — nothing applied/.test(cGhost.out) && /041_not_a_file/.test(cGhost.out),
      JSON.stringify([cGhost.code, cGhost.out.slice(-200)]));
    await p.end();
    const admin2 = new Client({ connectionString: dbUrl('postgres') }); await admin2.connect();
    await admin2.query(`DROP DATABASE IF EXISTS ${COPY}`); await admin2.end();

    // ══ (c) Paket 1b geçişi — GERÇEK migrations/ + gerçek CLI, canlı şekli ≤ 040 (42 kayıt) ══
    console.log('\n── Runner: Paket 1b (şema ≤ 040, canlının Paket 1 sonrası hali) ──');
    p = new Client({ connectionString: dbUrl(P1) }); await p.connect();
    // Canlı + staging ölçümü (21 Eki): 42 kayıt = 42 dosya (≤ 040). Test DB'si 029-031'i DIŞLAR ve
    // 016'yı kaydetmez → aynı kayıt kümesi elle kurulur (R9 gerekçesi).
    for (const f of M.listMigrationFiles().files.filter(x => x.num <= 40)) {
      await p.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NULL) ON CONFLICT DO NOTHING', [f.version]);
    }
    const reg1 = (await p.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
    const n1 = [];
    p.on('notice', n => n1.push(n.message));
    const d1 = await M.run(p, { dryRun: true });
    const left1 = [await rel(p, 'suppliers'), await rel(p, 'expense_drafts')];
    ok('R15 Paket 1b --dry-run (42 kayıt, canlı şekli): bekleyen TAM 041-042 · uygulandı + ROLLBACK · iz kalmadı · DUR yok',
      reg1 === 42 && d1.status === 'dry_run' && d1.applied.join() === '041_suppliers,042_expense_drafts' &&
      d1.problems.length === 0 && !left1[0] && !left1[1], JSON.stringify([reg1, d1.status, d1.applied, d1.problems, left1]));
    ok('R16 dry-run NOTICE: 041 mevcut gider satırlarını sayar, supplier_id hepsinde NULL', n1.some(n => /^041: expenses \d+ rows — supplier_id NULL/.test(n)),
      JSON.stringify(n1));
    await p.end();
    const admin3 = new Client({ connectionString: dbUrl('postgres') }); await admin3.connect();
    await admin3.query(`DROP DATABASE IF EXISTS ${COPY_P1}`);
    await admin3.query(`CREATE DATABASE ${COPY_P1} TEMPLATE ${P1}`);
    await admin3.end();
    const REAL_CLI = path.join(BE, 'scripts/migrate.js');
    const q1Dry = cli(COPY_P1, ['--dry-run'], {}, REAL_CLI);
    const q1Apply = cli(COPY_P1, [], {}, REAL_CLI);
    const q1Again = cli(COPY_P1, [], {}, REAL_CLI);
    p = new Client({ connectionString: dbUrl(COPY_P1) }); await p.connect();
    const after1 = (await p.query(`SELECT count(*)::int n, count(*) FILTER (WHERE version >= '041' AND applied_at IS NOT NULL)::int dated,
        to_regclass('public.suppliers') IS NOT NULL AS sup, to_regclass('public.expense_drafts') IS NOT NULL AS dr
        FROM schema_migrations`)).rows[0];
    await p.end();
    ok('R17 gerçek CLI: "DRY-RUN OK: 2" → "COMMIT: 2" → "Nothing to apply" · 44 kayıt (041-042 tarihli) · iki tablo var',
      q1Dry.code === 0 && /DRY-RUN OK: 2 migration/.test(q1Dry.out) && q1Apply.code === 0 && /COMMIT: 2 migration/.test(q1Apply.out) &&
      q1Again.code === 0 && /Nothing to apply/.test(q1Again.out) && after1.n === 44 && after1.dated === 2 && after1.sup && after1.dr,
      JSON.stringify([q1Dry.code, q1Apply.code, q1Again.code, after1, q1Apply.out.slice(-200)]));
    const admin4 = new Client({ connectionString: dbUrl('postgres') }); await admin4.connect();
    await admin4.query(`DROP DATABASE IF EXISTS ${COPY_P1}`); await admin4.end();

    console.log(`\n═══ MIGRATE RUNNER SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally {
    const c = new Client({ connectionString: dbUrl(MAIN_NAME) }); await c.connect();
    for (const s of schemas) await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await c.end();
    fs.rmSync(FROZEN, { recursive: true, force: true });
    process.exit(fail === 0 ? 0 : 1);
  }
})();
