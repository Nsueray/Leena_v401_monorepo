// LEDGER — "deploy migration'dan ÖNCE" testi (Paket 1). Hedef: ell_comm_test_premig (şema ≤ 035,
// canlının bugünkü hali). Sıra canlıda: push → deploy → Shell'de migrate. Arada kalan pencerede
// YENİ KOD + ESKİ ŞEMA: ödeme/payout akışı eski davranışla BİREBİR çalışmalı (42703 fallback kuralı).
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const base = new URL(process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test');
base.pathname = base.pathname.replace(/\/?$/, '') + '_premig';
const pool = new Pool({ connectionString: base.toString() });
const resetLineItems = require(path.join(__dirname, 'helpers/resetLineItems.js'));
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const app = express(); app.use(express.json());
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
app.use('/api/ledger', require(path.join(BE, 'routes/ledger.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45988;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, body: j };
}
const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
async function reset() {
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM commission_payouts');
  await resetLineItems(pool);
  await pool.query('DELETE FROM contracts');
  await pool.query('DELETE FROM sales_agents');
}

const server = app.listen(PORT, async () => {
  try {
    console.log('\n── Deploy → migration arası (şema ≤ 035) ──');
    const sch = await q1(`SELECT to_regclass('public.ledger_entries') IS NULL AS no_ledger,
        NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name IN ('account_id','payer')) AS no_cols,
        (SELECT max(version) FROM schema_migrations) AS last`);
    ok('M0 hedef şema canlının bugünkü hali: ledger tablosu yok · payments.account_id/payer yok · son kayıt 035',
      sch.no_ledger && sch.no_cols && sch.last === '035_users_display_name', JSON.stringify(sch));
    await reset();
    const turkey = (await q1("SELECT id FROM offices WHERE name='Turkey'")).id;
    const k = (await q1(`INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
       VALUES (1,1,'AF-PM-1','X','2026-01-01',1000,'EUR',1,1000,'Active') RETURNING id`)).id;
    // contract-detail.html submitPayment gövdesi BİREBİR (bugünkü canlı form).
    const oldBody = { amount: '100', currency: 'EUR', exchange_rate: '1', payment_method: 'cash', payment_date: '2026-10-21',
                      notes: null, received_office_id: String(turkey), schedule_item_id: null };
    const m1 = await call('POST', `/api/contracts/${k}/payments`, oldBody);
    ok('M1 eski form gövdesi → 201 · payment satırı eski şekliyle (account_id/payer anahtarı YOK) · uyarı yok',
      m1.status === 201 && m1.body.payment && !('account_id' in m1.body.payment) && m1.body.ledger_entry_id === null && m1.body.warning === null,
      JSON.stringify([m1.status, m1.body]));
    const m2 = await call('POST', `/api/contracts/${k}/payments`, Object.assign({}, oldBody, { account_id: 5, payer: 'Someone' }));
    ok('M2 yeni form (hesap + payer) eski şemaya → 201 + "ledger not available" uyarısı (400/500 DEĞİL)',
      m2.status === 201 && /not available yet/.test(m2.body.warning || ''), JSON.stringify([m2.status, m2.body && (m2.body.warning || m2.body.error)]));
    const m3 = await call('POST', `/api/contracts/${k}/payments/${m1.body.payment.id}/reverse`);
    const m3t = await call('POST', `/api/contracts/${k}/transfer`, { expo_id: 2 });
    ok('M3 ödeme tersleme → 201 · kontrat devri → 201 (eski şemada INSERT kolonları değişmedi)', m3.status === 201 && m3t.status === 201,
      JSON.stringify([m3.status, m3.body && m3.body.error, m3t.status, m3t.body && m3t.body.error]));
    const ag = (await q1("INSERT INTO sales_agents (organizer_id,name,agent_type,default_commission_pct) VALUES (1,'PM Agent','external_freelance',10) RETURNING id")).id;
    const m4 = await call('POST', `/api/agents/${ag}/payouts`, { amount: 10, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-21', paid_office_id: turkey, payout_method: 'cash' });
    const m4r = await call('POST', `/api/agents/${ag}/payouts`, { amount: -10, currency: 'EUR', exchange_rate: 1, payout_date: '2026-10-21', reverses_payout_id: m4.body.payout && m4.body.payout.id });
    ok('M4 payout + ters payout → 201 / 201', m4.status === 201 && m4r.status === 201, JSON.stringify([m4.status, m4r.status]));
    const cur = await call('GET', '/api/ledger/currencies');
    ok('M5 para birimi listesi tablo yokken eski 6\'lı listeye düşer (form boş kalmaz)',
      cur.status === 200 && cur.body.map(c => c.code).join(',') === 'EUR,USD,TRY,MAD,NGN,KES' && cur.body.every(c => c.pre_migration),
      JSON.stringify([cur.status, cur.body]));
    const acc = await call('GET', '/api/ledger/accounts');
    const unauth = await fetch(`http://127.0.0.1:${PORT}/api/ledger/accounts`);
    ok('M6 ledger ekranları migration öncesi 503 (500 değil, anlamlı mesaj) · token yoksa 401 önce', acc.status === 503 && /not migrated/.test(acc.body.error) && unauth.status === 401,
      JSON.stringify([acc.status, acc.body, unauth.status]));
    await reset();
    console.log(`\n═══ LEDGER PREMIG SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
