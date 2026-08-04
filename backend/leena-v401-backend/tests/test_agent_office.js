// M5 agent-office testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Ayrı dosya: farklı domain (sales_agents), cash-forecast suite'inden bağımsız.
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
app.use('/api/sales-agents', require(path.join(BE, 'routes/salesAgents.js')));
app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45922;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const officeId = async (name) => (await pool.query('SELECT id FROM offices WHERE name=$1', [name])).rows[0].id;
async function resetAgents() {
  // FK sırası: contracts sales_agents'a bağlı olabilir → önce contract zinciri.
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM payment_schedule_items');
  await pool.query('DELETE FROM commission_payouts');
  await pool.query('DELETE FROM contract_line_items');
  await pool.query('DELETE FROM contracts');
  await pool.query('DELETE FROM sales_agents');
}
const base = (extra) => Object.assign({ name: 'Agent X', agent_type: 'external_freelance' }, extra);

const server = app.listen(PORT, async () => {
  try {
    await resetAgents();
    const turkey = await officeId('Turkey');
    const morocco = await officeId('Morocco');

    console.log('\n── M5 agent-office (A1-A6) ──');

    // A1 POST office_id ile → dolu
    const a1 = await call('POST', '/api/sales-agents', base({ office_id: turkey }));
    ok('A1 POST office_id ile → 201, office_id dolu', a1.status === 201 && a1.body.office_id === turkey, JSON.stringify([a1.status, a1.body && a1.body.office_id]));

    // A2 POST office_id'siz → NULL (zorunlu değil)
    const a2 = await call('POST', '/api/sales-agents', base({}));
    ok('A2 POST office_id\'siz → 201, office_id NULL', a2.status === 201 && a2.body.office_id === null, JSON.stringify([a2.status, a2.body && a2.body.office_id]));

    // A3 PUT ile ofis değiştir → yeni değer
    const id3 = a2.body.id;
    const a3 = await call('PUT', `/api/sales-agents/${id3}`, base({ office_id: morocco }));
    ok('A3 PUT ofis değiştir → office_id = Morocco', a3.status === 200 && a3.body.office_id === morocco, JSON.stringify([a3.status, a3.body && a3.body.office_id]));

    // A4 PUT ile ofis boşalt (null) → NULL
    const a4 = await call('PUT', `/api/sales-agents/${id3}`, base({ office_id: null }));
    ok('A4 PUT ofis boşalt (null) → office_id NULL', a4.status === 200 && a4.body.office_id === null, JSON.stringify([a4.status, a4.body && a4.body.office_id]));

    // A5 geçersiz office_id → 400, kayıt yaratılmaz
    const before = (await pool.query('SELECT count(*) c FROM sales_agents')).rows[0].c;
    const a5 = await call('POST', '/api/sales-agents', base({ office_id: 999999 }));
    const after = (await pool.query('SELECT count(*) c FROM sales_agents')).rows[0].c;
    ok('A5 geçersiz office_id → 400 invalid office, kayıt yaratılmadı', a5.status === 400 && a5.body.error === 'invalid office' && before === after, JSON.stringify([a5.status, a5.body && a5.body.error, before, after]));

    // A6 GET yanıtında office_id döner
    const a6 = await call('GET', '/api/sales-agents?include_inactive=1');
    const withOffice = (a6.body || []).find(x => x.id === a1.body.id);
    ok('A6 GET yanıtında office_id döner', a6.status === 200 && withOffice && withOffice.office_id === turkey, JSON.stringify([a6.status, withOffice && withOffice.office_id]));

    console.log(`\n═══ AGENT-OFFICE SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
