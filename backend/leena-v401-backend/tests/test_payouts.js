// M4/ODE payout testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Ayrı dosya (domain: payout/cari hesap). Kaynak = KÜTÜK ODE-01/02/03 (hatıra değil).
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
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45933;

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
async function reset() {
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM payment_schedule_items');
  await pool.query('DELETE FROM commission_payouts');
  await pool.query('DELETE FROM contract_line_items');
  await pool.query('DELETE FROM contracts');
  await pool.query('DELETE FROM sales_agents');
}
let afSeq = 0;
// earned=100 fixture: agent(sr, %10) + contract(revenue_eur 1000, kur 1) + line 1000 + payment 1000 (ratio 1)
async function mkAgentEarned100() {
  const ag = (await pool.query(
    "INSERT INTO sales_agents (organizer_id,name,agent_type,default_commission_pct) VALUES (1,'Payout Agent','external_freelance',10) RETURNING id")).rows[0].id;
  const c = (await pool.query(
    `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
     VALUES (1,1,$1,'X','2026-01-01',1000,'EUR',1,1000,'Active',$2) RETURNING id`,
    ['AF-PO-' + (++afSeq), ag])).rows[0].id;
  await pool.query(
    `INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
     VALUES ($1,1,'Item',1,1000,0,false,'EUR')`, [c]);
  await pool.query(
    `INSERT INTO payments (organizer_id,contract_id,amount,currency,exchange_rate,amount_eur,payment_method,payment_date)
     VALUES (1,$1,1000,'EUR',1,1000,'cash','2026-07-01')`, [c]);
  return ag;
}
const payout = (ag, extra) => call('POST', `/api/agents/${ag}/payouts`, Object.assign({ amount: 40, currency: 'EUR', exchange_rate: 1, payout_date: '2026-08-01', paid_office_id: null, payout_method: 'cash' }, extra));
const stmt = (ag) => call('GET', `/api/agents/${ag}/statement`);

const server = app.listen(PORT, async () => {
  try {
    const turkey = await officeId('Turkey');
    const po = (ag, extra) => payout(ag, Object.assign({ paid_office_id: turkey }, extra));

    // ══ ODE-01: "Payout modeli CARİ HESAPTIR; kayıtta dönem/kesim kolonu yoktur, bakiye her okumada türetilir." ══
    console.log('\n── ODE-01 cari hesap / türetme ──');
    await reset();
    const A = await mkAgentEarned100();
    const s0 = await stmt(A);
    ok('O1a (ODE-01) statement türetir: earned 100.00 · paid 0.00 · balance 100.00', s0.status === 200 && String(s0.body.earned_eur) === '100.00' && String(s0.body.paid_eur) === '0.00' && String(s0.body.balance_eur) === '100.00', JSON.stringify([s0.body.earned_eur, s0.body.paid_eur, s0.body.balance_eur]));
    const cols = (await pool.query("SELECT count(*) c FROM information_schema.columns WHERE table_name='commission_payouts' AND column_name IN ('period','cut_date','cycle','cut','period_id')")).rows[0].c;
    ok('O1b (ODE-01) commission_payouts\'ta dönem/kesim kolonu YOK', cols === '0', cols);
    await po(A, { amount: 40 });
    const s1 = await stmt(A);
    ok('O1c (ODE-01) payout 40 → balance HER OKUMADA türetilir: paid 40.00 · balance 60.00', String(s1.body.paid_eur) === '40.00' && String(s1.body.balance_eur) === '60.00', JSON.stringify([s1.body.paid_eur, s1.body.balance_eur]));
    ok('O1d (ODE-01) earned payout\'tan BAĞIMSIZ (türetilmiş, saklanmaz): hâlâ 100.00', String(s1.body.earned_eur) === '100.00', s1.body.earned_eur);

    // ══ ODE-02: "Clawback ayrı mekanizma değildir; fazla ödeme bakiyeyi negatife düşürür, sonraki ödemede mahsuplaşır." ══
    console.log('\n── ODE-02 fazla ödeme → negatif bakiye / mahsup ──');
    await reset();
    const B = await mkAgentEarned100();
    const over = await po(B, { amount: 150 });   // earned 100'den fazla
    const sB = await stmt(B);
    ok('O2a (ODE-02) fazla ödeme 150 → 201 (ENGELLENMEZ) · balance -50.00 (negatif, cari hesap)', over.status === 201 && String(sB.body.balance_eur) === '-50.00', JSON.stringify([over.status, sB.body.balance_eur]));
    await po(B, { amount: -150, reverses_payout_id: over.body.payout.id });   // mahsup (reversal)
    const sB2 = await stmt(B);
    ok('O2b (ODE-02) reversal ile mahsuplaşır → balance 100.00\'e döner', String(sB2.body.balance_eur) === '100.00' && String(sB2.body.paid_eur) === '0.00', JSON.stringify([sB2.body.balance_eur, sB2.body.paid_eur]));

    // ══ ODE-03: "Payout immutable'dır; UPDATE/DELETE yok, düzeltme = negatif tutarlı yeni satır + reverses_payout_id." ══
    console.log('\n── ODE-03 immutable / reversal düzeltme ──');
    await reset();
    const C = await mkAgentEarned100();
    const p1 = await po(C, { amount: 40 });
    const rev = await po(C, { amount: -40, reverses_payout_id: p1.body.payout.id });
    const sC = await stmt(C);
    ok('O3a (ODE-03) düzeltme = negatif yeni satır (reverses) → paid 0.00, 2 satır', rev.status === 201 && String(sC.body.paid_eur) === '0.00' && sC.body.payouts.length === 2, JSON.stringify([rev.status, sC.body.paid_eur, sC.body.payouts.length]));
    const rev2 = await po(C, { amount: -40, reverses_payout_id: p1.body.payout.id });   // aynısını 2. kez tersle
    ok('O3b (ODE-03) aynı payout 2. kez terslenemez → 409 (partial UNIQUE)', rev2.status === 409, JSON.stringify([rev2.status, rev2.body && rev2.body.error]));
    const revrev = await po(C, { amount: -40, reverses_payout_id: rev.body.payout.id });   // reversal'ı tersle
    ok('O3c (ODE-03) reversal terslenemez → 400 "Cannot reverse a reversal"', revrev.status === 400 && /Cannot reverse a reversal/.test(revrev.body.error || ''), JSON.stringify([revrev.status, revrev.body && revrev.body.error]));
    const D = await mkAgentEarnedOther();   // farklı agent (cross-agent testi)
    // D endpoint'ine C'nin payout'unu (p1) tersletmeye çalış → same-agent kuralı reddetmeli
    const crossReal = await call('POST', `/api/agents/${D}/payouts`, { amount: -40, currency: 'EUR', exchange_rate: 1, payout_date: '2026-08-01', reverses_payout_id: p1.body.payout.id });
    ok('O3d (ODE-03) başka agent\'ın payout\'unu tersleme → 400 (same agent)', crossReal.status === 400 && /same agent/i.test(crossReal.body.error || ''), JSON.stringify([crossReal.status, crossReal.body && crossReal.body.error]));
    const putRes = await call('PUT', `/api/agents/${C}/payouts/${p1.body.payout.id}`, { amount: 999 });
    ok('O3e (ODE-03) UPDATE endpoint\'i YOK (immutable) → PUT 404', putRes.status === 404, putRes.status);
    const negNoRev = await call('POST', `/api/agents/${C}/payouts`, { amount: -40, currency: 'EUR', exchange_rate: 1, payout_date: '2026-08-01', paid_office_id: turkey, payout_method: 'cash' });
    ok('O3f (ODE-03) reverses\'sız negatif payout → 400 (düzeltme yalnız reversal ile)', negNoRev.status === 400, JSON.stringify([negNoRev.status, negNoRev.body && negNoRev.body.error]));

    console.log(`\n═══ PAYOUTS SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});

// farklı agent (cross-agent testi için), earned gerekmez
async function mkAgentEarnedOther() {
  return (await pool.query(
    "INSERT INTO sales_agents (organizer_id,name,agent_type,default_commission_pct) VALUES (1,'Other Agent','external_freelance',10) RETURNING id")).rows[0].id;
}
