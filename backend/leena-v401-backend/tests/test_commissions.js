// M4/MOT komisyon motoru testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Ayrı dosya (domain: komisyon/kesim raporu). Kaynak = KÜTÜK MOT-01..05 (hatıra değil).
const fs = require('fs');
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
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/commissions', require(path.join(BE, 'routes/commissions.js')));
app.use('/api/agents', require(path.join(BE, 'routes/payouts.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45944;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
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
}
let afSeq = 0;
// SR komisyonlu kontrat: agent(sr, srPct%) + contract(revenue_eur, kur) + line(unitPrice) + payments[].
async function mkComm({ srPct, unitPrice, revenue, rate = 1, payments = [] }) {
  const ag = (await pool.query(
    "INSERT INTO sales_agents (organizer_id,name,agent_type,default_commission_pct) VALUES (1,'MOT Agent','external_freelance',$1) RETURNING id", [srPct])).rows[0].id;
  const c = (await pool.query(
    `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
     VALUES (1,1,$1,'X','2026-01-01',$2,'EUR',$3,$4,'Active',$5) RETURNING id`,
    ['AF-MOT-' + (++afSeq), revenue / rate, rate, revenue, ag])).rows[0].id;
  await pool.query(
    `INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
     VALUES ($1,1,'Item',1,$2,0,false,'EUR')`, [c, unitPrice]);
  for (const p of payments) {
    await pool.query(
      `INSERT INTO payments (organizer_id,contract_id,amount,currency,exchange_rate,amount_eur,payment_method,payment_date)
       VALUES (1,$1,$2,'EUR',1,$2,'cash',$3)`, [c, p.amount_eur, p.date]);
  }
  return { ag, c };
}
const srEarnedDetail = async (c) => {
  const d = await call('GET', `/api/contracts/${c}`);
  const sr = ((d.body.commission && d.body.commission.roles) || []).find(r => r.role === 'sr');
  return sr ? sr.earned : null;
};
const stmtEarned = async (ag) => (await call('GET', `/api/agents/${ag}/statement`)).body.earned_eur;
const WIDE = '?from=2026-01-01&to=2026-12-31';
const allSlices = (rep) => (rep.periods || []).flatMap(p => p.agents.flatMap(a => a.slices.map(s => Object.assign({ cut_date: p.cut_date }, s))));

const server = app.listen(PORT, async () => {
  try {
    // ══ MOT-01: "Dilim CTE'leri commissionSlices.js → SLICE_CTES'te tek kaynaktır; ikinci komisyon formülü açılmaz." ══
    console.log('\n── MOT-01 tek kaynak (3 ayak) ──');
    await reset();
    // EL HESABI (literal, motordan DEĞİL): base 17.100 × %5 = 855 ; 855 × (7440/18600 = 0.40) = 342.00
    const HAND_342 = '342.00';
    const { ag: agA, c: cA } = await mkComm({ srPct: 5, unitPrice: 17100, revenue: 18600, rate: 1, payments: [{ amount_eur: 7440, date: '2026-07-24' }] });
    const detailEarned = await srEarnedDetail(cA);   // (a) M1 computeCommission (ratio)
    const stEarned = await stmtEarned(agA);          // (b) statement (SLICE_CTES)
    ok('M01a (MOT-01) 3 ayak eşit: M1 computeCommission == statement == EL HESABI 342.00', String(detailEarned) === HAND_342 && String(stEarned) === HAND_342, JSON.stringify([detailEarned, stEarned, HAND_342]));
    // Hafif yapısal: iki tüketici de commissionSlices'ı require eder (inline yeniden tanımlamaz).
    const commSrc = fs.readFileSync(path.join(BE, 'routes/commissions.js'), 'utf8');
    const payoutSrc = fs.readFileSync(path.join(BE, 'routes/payouts.js'), 'utf8');
    ok('M01b (MOT-01) yapısal: commissions.js + payouts.js ikisi de commissionSlices require eder', /require\([^)]*commissionSlices/.test(commSrc) && /require\([^)]*commissionSlices/.test(payoutSrc));

    // ══ MOT-02: "Komisyon tahsilat oranına bağlıdır (paid_eur/revenue_eur), vade planına DEĞİL." ══
    console.log('\n── MOT-02 tahsilat oranı, plan değil ──');
    await reset();
    // pot = 1000 × %10 = 100 ; ratio 500/1000 = 0.5 → earned 50
    const { ag: agB, c: cB } = await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 500, date: '2026-07-10' }] });
    ok('M02a (MOT-02) earned = pot × tahsilat oranı: 100 × 0.5 = 50.00', String(await stmtEarned(agB)) === '50.00', await stmtEarned(agB));
    // Plan EKLE (full 1000) → earned DEĞİŞMEZ (komisyon plana bağlı DEĞİL).
    await pool.query(
      `INSERT INTO payment_schedule_items (organizer_id,contract_id,revision,item_no,due_date,amount,currency,source)
       VALUES (1,$1,1,1,'2026-08-01',1000,'EUR','manual_amount')`, [cB]);
    ok('M02b (MOT-02) plan eklenince earned DEĞİŞMEZ (hâlâ 50.00) — plana bağlı değil', String(await stmtEarned(agB)) === '50.00', await stmtEarned(agB));

    // ══ MOT-03: "Tavan kümülatif-marjinal uygulanır ve dilimlere '(cap)' notuyla yansır." ══
    console.log('\n── MOT-03 tavan (cap) ──');
    await reset();
    // pot 100 ; 800 + 400 = 1200 > revenue 1000 → tavan pot'ta (100), ikinci dilim capped
    const { ag: agC } = await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 800, date: '2026-07-05' }, { amount_eur: 400, date: '2026-07-20' }] });
    ok('M03a (MOT-03) aşırı tahsilat tavanı: earned pot\'u AŞMAZ → 100.00 (120 değil)', String(await stmtEarned(agC)) === '100.00', await stmtEarned(agC));
    const repC = (await call('GET', `/api/commissions${WIDE}`)).body;
    const capped = allSlices(repC).some(s => s.capped === true);
    ok('M03b (MOT-03) tavana takılan dilim "(cap)" notlu (capped=true)', capped, JSON.stringify(allSlices(repC).map(s => ({ slice: s.slice_eur, capped: s.capped }))));

    // ══ MOT-04: "Kesim takvim günüdür (payment_date DATE, TZ yok)." gün≤15→ayın 15'i · ≥16→ayın SON günü ══
    console.log('\n── MOT-04 kesim (cut_date) ──');
    await reset();
    await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 100, date: '2026-07-10' }] });  // gün 10 ≤ 15
    const cutsLow = allSlices((await call('GET', `/api/commissions${WIDE}`)).body).map(s => s.cut_date);
    ok('M04a (MOT-04) gün 10 (≤15) → cut_date ayın 15\'i (2026-07-15)', cutsLow.includes('2026-07-15'), JSON.stringify(cutsLow));
    await reset();
    await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 100, date: '2026-07-24' }] });  // gün 24 ≥ 16
    const cutsHi = allSlices((await call('GET', `/api/commissions${WIDE}`)).body).map(s => s.cut_date);
    ok('M04b (MOT-04) gün 24 (≥16) → cut_date ayın SON günü (2026-07-31)', cutsHi.includes('2026-07-31'), JSON.stringify(cutsHi));
    // Sınır: gün 15 → 15 ; gün 16 → son gün
    await reset();
    await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 100, date: '2026-07-15' }] });
    const cut15 = allSlices((await call('GET', `/api/commissions${WIDE}`)).body).map(s => s.cut_date);
    ok('M04c (MOT-04) sınır gün 15 → 2026-07-15 (ayın 15\'i)', cut15.includes('2026-07-15'), JSON.stringify(cut15));
    await reset();
    await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 100, date: '2026-07-16' }] });
    const cut16 = allSlices((await call('GET', `/api/commissions${WIDE}`)).body).map(s => s.cut_date);
    ok('M04d (MOT-04) sınır gün 16 → 2026-07-31 (ayın SON günü)', cut16.includes('2026-07-31'), JSON.stringify(cut16));

    // ══ MOT-05: "Rapor yalnız hak edilmişi gösterir; potansiyel detayda kalır." ══
    console.log('\n── MOT-05 rapor yalnız hak edilmiş ──');
    await reset();
    await mkComm({ srPct: 10, unitPrice: 1000, revenue: 1000, rate: 1, payments: [{ amount_eur: 500, date: '2026-07-10' }] });
    const rep5 = (await call('GET', `/api/commissions${WIDE}`)).body;
    const sl = allSlices(rep5)[0];
    ok('M05a (MOT-05) dilimde slice_eur (hak edilmiş) VAR', sl && sl.slice_eur != null, JSON.stringify(sl));
    ok('M05b (MOT-05) dilimde potansiyel/full alanı YOK (rapor yalnız hak edilmişi gösterir)', sl && sl.full === undefined && sl.potential === undefined && sl.pot === undefined, sl && JSON.stringify(Object.keys(sl)));

    console.log(`\n═══ COMMISSIONS SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
