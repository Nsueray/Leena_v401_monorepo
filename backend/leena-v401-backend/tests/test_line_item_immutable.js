// tests/test_line_item_immutable.js — 034 (Sentez K-D): contract_line_items değiştirilemez.
// Kurallar:
//   UPDATE / DELETE / TRUNCATE → anahtar `ell.allow_line_item_reset` tam 'on' değilse REDDEDİLİR
//   INSERT → serbest
//   Anahtar yalnız test kurulumu/temizliği açar (SET LOCAL); ürün kodunda anahtar YOK (kaynak taraması).
// ⚠️ ENDPOINT YOK — doğrudan pool.query + hata yakalama (test_users.js deseni).
const path = require('path');
const fs = require('fs');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const resetLineItems = require(path.join(__dirname, 'helpers/resetLineItems.js'));
const KEY = 'ell.allow_line_item_reset';

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };

// Bir sorgunun 034 trigger'ıyla REDDEDİLMESİNİ bekler (mesaj K-D taşır).
async function expectKD(label, fn) {
  try { await fn(); ok(label, false, 'REDDEDİLMEDİ'); }
  catch (e) { ok(label, /K-D/.test(e.message), e.message.slice(0, 70)); }
}
// Tek bağlantıda, transaction içinde çalıştırır; her zaman ROLLBACK (yan etki yok).
async function inTx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); return await fn(c); }
  finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
const countItems = async (cid) =>
  (await pool.query('SELECT count(*)::int AS n FROM contract_line_items WHERE contract_id=$1', [cid])).rows[0].n;

// Kaynak taraması: migrations/ ve tests/ DIŞINDAKİ backend kaynaklarında anahtar adı GEÇMEZ.
function scanSources() {
  const hits = [];
  const skip = new Set(['node_modules', 'migrations', 'tests', '.git']);
  const exts = /\.(js|mjs|cjs|html|sql|json|sh)$/;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.test(e.name) && fs.readFileSync(p, 'utf8').includes(KEY)) hits.push(path.relative(BE, p));
    }
  })(BE);
  return hits;
}

(async () => {
  let cid = null;
  try {
    console.log('\n── 034 contract_line_items DEĞİŞTİRİLEMEZ (Sentez K-D) ──');
    await resetLineItems(pool);
    await pool.query("DELETE FROM payments");
    await pool.query("DELETE FROM payment_schedule_items");
    await pool.query("DELETE FROM commission_payouts");
    await pool.query("DELETE FROM contracts");
    cid = (await pool.query(
      `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
       VALUES (1,1,'AF-LI-IMM','X','2026-01-01',100,'EUR',1,100,'Active') RETURNING id`)).rows[0].id;

    // I1 — INSERT serbest (anahtar kapalı)
    try {
      await pool.query(
        `INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,currency)
         VALUES ($1,1,'Stand',1,100,'EUR')`, [cid]);
      ok('I1 INSERT anahtar kapalıyken GEÇER', (await countItems(cid)) === 1);
    } catch (e) { ok('I1 INSERT anahtar kapalıyken GEÇER', false, e.message.slice(0, 70)); }

    // I2..I4 — anahtar kapalı: UPDATE / DELETE / TRUNCATE REDDEDİLİR
    await expectKD('I2 UPDATE anahtar kapalı → REDDEDİLİR',
      () => pool.query('UPDATE contract_line_items SET unit_price = 1 WHERE contract_id=$1', [cid]));
    await expectKD('I3 DELETE anahtar kapalı → REDDEDİLİR',
      () => pool.query('DELETE FROM contract_line_items WHERE contract_id=$1', [cid]));
    await expectKD('I4 TRUNCATE anahtar kapalı → REDDEDİLİR',
      () => pool.query('TRUNCATE contract_line_items'));
    ok('I5 reddedilen işlemlerden sonra satır yerinde', (await countItems(cid)) === 1);

    // I6 — anahtar 'on' dışında bir değer → yine kapalı
    await expectKD("I6 anahtar 'off' → DELETE yine REDDEDİLİR",
      () => inTx(async (c) => { await c.query(`SET LOCAL ${KEY} = 'off'`); await c.query('DELETE FROM contract_line_items'); }));
    await expectKD("I7 anahtar 'true' (tam 'on' değil) → DELETE yine REDDEDİLİR",
      () => inTx(async (c) => { await c.query(`SET LOCAL ${KEY} = 'true'`); await c.query('DELETE FROM contract_line_items'); }));

    // I8 — anahtar açık (SET LOCAL, transaction içinde) → temizlik GEÇER
    let i8 = false, i8m = '';
    try {
      i8 = await inTx(async (c) => {
        await c.query(`SET LOCAL ${KEY} = 'on'`);
        const d = await c.query('DELETE FROM contract_line_items WHERE contract_id=$1', [cid]);
        return d.rowCount === 1;
      });
    } catch (e) { i8m = e.message.slice(0, 70); }
    ok('I8 anahtar açık (SET LOCAL) → DELETE GEÇER', i8, i8m);

    // I9 — SET LOCAL transaction bitince kapanır: aynı bağlantıda sonraki UPDATE reddedilir
    const c9 = await pool.connect();
    try {
      await c9.query('BEGIN'); await c9.query(`SET LOCAL ${KEY} = 'on'`); await c9.query('ROLLBACK');
      await expectKD('I9 SET LOCAL transaction sonrası kapanır → aynı bağlantıda UPDATE REDDEDİLİR',
        () => c9.query('UPDATE contract_line_items SET unit_price = 2 WHERE contract_id=$1', [cid]));
    } finally { c9.release(); }

    // I10 — yardımcı (tests/helpers/resetLineItems.js) temizliği geçer
    let i10m = '';
    try { await resetLineItems(pool); } catch (e) { i10m = e.message.slice(0, 70); }
    ok('I10 resetLineItems (anahtarlı temizlik) GEÇER', !i10m && (await countItems(cid)) === 0, i10m);

    // I11 — kaynak taraması: ürün kodunda anahtar adı YOK
    const hits = scanSources();
    ok('I11 migrations/ ve tests/ dışında anahtar adı GEÇMEZ (routes/utils/middleware/scripts/public/index.js/email_worker.js …)',
      hits.length === 0, hits.join(', '));

    console.log(`\n═══ LINE-ITEM IMMUTABLE SONUÇ: ${pass} geçti, ${fail} başarısız ═══`);
  } catch (e) {
    console.error('TEST HATASI:', e.message);
    process.exitCode = 1;
  } finally {
    if (cid) {
      await resetLineItems(pool).catch(() => {});
      await pool.query('DELETE FROM contracts WHERE id=$1', [cid]).catch(() => {});
    }
    await pool.end();
    if (fail > 0) process.exitCode = 1;
  }
})();
