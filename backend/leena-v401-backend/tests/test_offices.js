// M2 ofis yönetimi testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Ayrı dosya (domain: offices CRUD + kapatma).
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const app = express(); app.use(express.json());
app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45966;
const BASE = ['Turkey', 'Morocco', 'Nigeria', 'Kenya', 'China'];

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
async function reset() {
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM payment_schedule_items');
  await pool.query('DELETE FROM commission_payouts');
  await pool.query('DELETE FROM contract_line_items');
  await pool.query('DELETE FROM contracts');
  await pool.query('DELETE FROM sales_agents');
  await pool.query("DELETE FROM offices WHERE name NOT IN ('Turkey','Morocco','Nigeria','Kenya','China')");
  await pool.query("UPDATE offices SET is_active = true WHERE name = ANY($1)", [BASE]);
}

const server = app.listen(PORT, async () => {
  try {
    await reset();

    console.log('\n── M2 offices CRUD (F1-F8) ──');

    // F1 GET varsayılan → yalnız aktif (5 base, is_active alanı YOK — davranış korunuyor)
    const g1 = await call('GET', '/api/offices');
    ok('F1 GET varsayılan → yalnız aktif (5 base) · is_active alanı yok (davranış korundu)', g1.status === 200 && g1.body.length === 5 && g1.body.every(o => o.is_active === undefined), JSON.stringify([g1.body.length, g1.body[0]]));

    // F2 GET ?include_inactive=1 → hepsi + is_active alanı
    const g2 = await call('GET', '/api/offices?include_inactive=1');
    ok('F2 GET ?include_inactive=1 → hepsi + is_active alanı', g2.status === 200 && g2.body.length === 5 && g2.body.every(o => typeof o.is_active === 'boolean'), JSON.stringify([g2.body.length, g2.body[0]]));

    // F3 POST → ofis oluşur (is_active=true doğar)
    const p3 = await call('POST', '/api/offices', { name: 'Test Office', country_code: 'TR' });
    ok('F3 POST → 201, ofis oluşur, is_active=true', p3.status === 201 && p3.body.name === 'Test Office' && p3.body.is_active === true, JSON.stringify([p3.status, p3.body]));

    // F4 POST aynı isim → 409 (UNIQUE)
    const p4 = await call('POST', '/api/offices', { name: 'Test Office', country_code: 'MA' });
    ok('F4 POST aynı isim → 409 (UNIQUE reddedildi)', p4.status === 409, JSON.stringify([p4.status, p4.body && p4.body.error]));

    // F5 POST geçersiz country_code → 400
    const p5 = await call('POST', '/api/offices', { name: 'Bad Country Office', country_code: 'ZZ' });
    ok('F5 POST geçersiz country_code (ZZ) → 400 invalid country_code', p5.status === 400 && p5.body.error === 'invalid country_code', JSON.stringify([p5.status, p5.body && p5.body.error]));

    // F6 PUT is_active=false → kapanır; varsayılan GET'te YOK, include_inactive'de VAR
    const oid = p3.body.id;
    const put6 = await call('PUT', `/api/offices/${oid}`, { name: 'Test Office', country_code: 'TR', is_active: false });
    const gDef = await call('GET', '/api/offices');
    const gAll = await call('GET', '/api/offices?include_inactive=1');
    ok('F6 PUT is_active=false → kapandı · varsayılan GET\'te YOK · include_inactive\'de VAR',
      put6.status === 200 && put6.body.is_active === false && !gDef.body.some(o => o.id === oid) && gAll.body.some(o => o.id === oid && o.is_active === false),
      JSON.stringify([put6.body.is_active, gDef.body.some(o => o.id === oid), gAll.body.some(o => o.id === oid)]));

    // F7 kapalı ofis yeniden açılabilir
    const put7 = await call('PUT', `/api/offices/${oid}`, { name: 'Test Office', country_code: 'TR', is_active: true });
    const gDef7 = await call('GET', '/api/offices');
    ok('F7 kapalı ofis yeniden açılır (is_active=true) → varsayılan GET\'te GÖRÜNÜR', put7.status === 200 && put7.body.is_active === true && gDef7.body.some(o => o.id === oid), JSON.stringify([put7.body.is_active, gDef7.body.some(o => o.id === oid)]));

    // F8 kapalı ofise bağlı kayıt hâlâ o ofisi gösterir (FK bozulmadı, ad çözülebilir)
    const c8 = (await pool.query(
      `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
       VALUES (1,1,'AF-OFF-1','X','2026-01-01',100,'EUR',1,100,'Active') RETURNING id`)).rows[0].id;
    await pool.query(
      `INSERT INTO payments (organizer_id,contract_id,amount,currency,exchange_rate,amount_eur,payment_method,payment_date,received_office_id)
       VALUES (1,$1,10,'EUR',1,10,'cash','2026-07-01',$2)`, [c8, oid]);
    await call('PUT', `/api/offices/${oid}`, { name: 'Test Office', country_code: 'TR', is_active: false });   // kapat
    const payRef = (await pool.query('SELECT received_office_id FROM payments WHERE contract_id=$1', [c8])).rows[0].received_office_id;
    const gAll8 = await call('GET', '/api/offices?include_inactive=1');
    const stillThere = gAll8.body.find(o => o.id === oid);
    ok('F8 kapalı ofise bağlı ödeme hâlâ onu gösterir (FK sağlam) + ad include_inactive\'de çözülebilir', payRef === oid && stillThere && stillThere.name === 'Test Office', JSON.stringify([payRef, oid, stillThere && stillThere.name]));

    console.log(`\n═══ OFFICES SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
