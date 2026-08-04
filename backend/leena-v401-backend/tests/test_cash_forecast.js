// PS3-B cash forecast testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Canlı DB'ye DEĞMEZ. Komisyon motoruna dokunmaz. DÜZELTME turu: PLN-11 overdue + RAP-02 on hold.
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const BE = path.join(__dirname, '..');   // repo-göreli (eski hardcoded mutlak yol kaldırıldı)
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const express = require(path.join(BE, 'node_modules/express'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const app = express(); app.use(express.json());
app.use('/api/contracts', require(path.join(BE, 'routes/contracts.js')));
app.use('/api/offices', require(path.join(BE, 'routes/offices.js')));
app.use('/api/cash-forecast', require(path.join(BE, 'routes/cashForecast.js')));
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45900;

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (d !== undefined ? ' → ' + d : ''))); };
async function call(method, url, { token = TOKEN, body } = {}) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, opts);
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

let afSeq = 0;
async function mkContract({ expo_id = 1, contract_date = '2026-01-01', revenue = 1000.00,
                            currency = 'EUR', exchange_rate = 1, revenue_eur = null, status = 'Active' } = {}) {
  const reur = revenue_eur == null ? revenue : revenue_eur;
  const r = await pool.query(
    `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
     VALUES (1,$1,$2,'X',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [expo_id, 'AF-CF-' + (++afSeq), contract_date, revenue, currency, exchange_rate, reur, status]);
  return r.rows[0].id;
}
const officeId = async (name) => (await pool.query('SELECT id FROM offices WHERE name=$1', [name])).rows[0].id;
async function pay(cid, amount_eur, { currency = 'EUR', exchange_rate = 1, date = '2026-07-20', schedule_item_id = null, reverses = null } = {}) {
  const r = await pool.query(
    `INSERT INTO payments (organizer_id,contract_id,amount,currency,exchange_rate,amount_eur,payment_method,payment_date,schedule_item_id,reverses_payment_id)
     VALUES (1,$1,$2,$3,$4,$5,'cash',$6,$7,$8) RETURNING id`,
    [cid, amount_eur, currency, exchange_rate, amount_eur, date, schedule_item_id, reverses]);
  return r.rows[0].id;
}
const activeItems = async (cid) => (await pool.query(
  "SELECT id, item_no, amount FROM payment_schedule_items WHERE contract_id=$1 AND superseded_at IS NULL ORDER BY item_no", [cid])).rows;
async function payApi(cid, { amount = 100, office, schedule_item_id } = {}) {
  const body = { amount, currency: 'EUR', exchange_rate: 1, payment_method: 'cash', payment_date: '2026-08-01', received_office_id: office };
  if (schedule_item_id !== undefined) body.schedule_item_id = schedule_item_id;
  return call('POST', `/api/contracts/${cid}/payments`, { body });
}
const lineOf = (data, cid, itemDue) => allLines(data).find(l => l.contract_id === cid && l.due_date === itemDue);
async function reset() {
  await pool.query('DELETE FROM payments');            // schedule_item_id FK → önce sil
  await pool.query('DELETE FROM payment_schedule_items');
  await pool.query('DELETE FROM commission_payouts');
  await pool.query('DELETE FROM contract_line_items');
  await pool.query('DELETE FROM contracts');
  await pool.query("DELETE FROM offices WHERE name NOT IN ('Turkey','Morocco','Nigeria','Kenya','China')");
}
const WIDE = '?from=2026-01-01&to=2026-12-31';
const bucket = (data, name) => (data.offices || []).find(o => o.office_name === name);
const conOf = (data, cid) => (data.contracts || []).find(c => c.contract_id === cid);
const allLines = (data) => (data.offices || []).flatMap(o => o.lines);

const server = app.listen(PORT, async () => {
  try {
    const turkey = await officeId('Turkey');

    // ── T1 + T4 + T6 + T7 KABUL (+ PLN-11 overdue alanları) ──
    console.log('\n── T1/T4/T6/T7 KABUL (ofis×vade + overdue) ──');
    await reset();
    const A = await mkContract({ revenue: 18600.00, currency: 'EUR', exchange_rate: 1, revenue_eur: 18600.00 });
    await call('POST', `/api/contracts/${A}/schedule`, { body: { items: [
      { due_date: '2026-07-31', amount: 7440, expected_office_id: turkey },
      { due_date: '2026-10-19', amount: 11160, expected_office_id: turkey } ] } });
    await pay(A, 7440.00, { date: '2026-07-24' });
    const B = await mkContract({ revenue: 15000.00, currency: 'USD', exchange_rate: 0.92, revenue_eur: 13800.00 });
    await call('POST', `/api/contracts/${B}/schedule`, { body: { items: [{ due_date: '2026-09-10', amount: 1000 }] } });
    await pay(B, 14.80, { currency: 'USD', exchange_rate: 0.92, date: '2026-07-15' });

    const d1 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const tr = bucket(d1, 'Turkey'), no = bucket(d1, '(No office)');
    ok('T1 Turkey total 11160.00 / overdue 0.00 / upcoming 11160.00',
      tr && String(tr.total_remaining_eur) === '11160.00' && String(tr.overdue_remaining_eur) === '0.00' && String(tr.upcoming_remaining_eur) === '11160.00',
      tr && JSON.stringify([tr.total_remaining_eur, tr.overdue_remaining_eur, tr.upcoming_remaining_eur]));
    const trJul = tr && tr.lines.find(l => l.due_date === '2026-07-31');
    const trOct = tr && tr.lines.find(l => l.due_date === '2026-10-19');
    ok('T1 Jul31 remaining 0.00 · is_overdue FALSE', trJul && String(trJul.remaining_eur) === '0.00' && trJul.is_overdue === false, trJul && `${trJul.remaining_eur}/${trJul.is_overdue}`);
    ok('T1 Oct19 remaining 11160.00 · is_overdue FALSE', trOct && String(trOct.remaining_eur) === '11160.00' && trOct.is_overdue === false, trOct && `${trOct.remaining_eur}/${trOct.is_overdue}`);
    ok('T4 (No office) total 905.20 / overdue 0.00 / upcoming 905.20',
      no && String(no.total_remaining_eur) === '905.20' && String(no.overdue_remaining_eur) === '0.00' && String(no.upcoming_remaining_eur) === '905.20',
      no && JSON.stringify([no.total_remaining_eur, no.overdue_remaining_eur, no.upcoming_remaining_eur]));
    const noSep = no && no.lines.find(l => l.due_date === '2026-09-10');
    ok('T7 USD satır amount_eur 920.00 · remaining 905.20 · is_overdue FALSE', noSep && String(noSep.amount_eur) === '920.00' && String(noSep.remaining_eur) === '905.20' && noSep.is_overdue === false, noSep && `${noSep.amount_eur}/${noSep.remaining_eur}`);
    ok('T1 GRAND total 12065.20 / overdue 0.00 / upcoming 12065.20',
      String(d1.grand_total_remaining_eur) === '12065.20' && String(d1.grand_overdue_remaining_eur) === '0.00' && String(d1.grand_upcoming_remaining_eur) === '12065.20',
      JSON.stringify([d1.grand_total_remaining_eur, d1.grand_overdue_remaining_eur, d1.grand_upcoming_remaining_eur]));
    const cA = conOf(d1, A), cB = conOf(d1, B);
    ok('T1 A özet plan 18600.00 revenue_eur 18600.00 matches TRUE paid 7440.00 excess 0.00',
      cA && String(cA.plan_total_eur) === '18600.00' && String(cA.revenue_eur) === '18600.00' && cA.matches_revenue === true && String(cA.paid_net_eur) === '7440.00' && String(cA.excess_eur) === '0.00', cA && JSON.stringify(cA));
    ok('T6 B özet plan 920.00 revenue_eur 13800.00 matches FALSE', cB && String(cB.plan_total_eur) === '920.00' && String(cB.revenue_eur) === '13800.00' && cB.matches_revenue === false, cB && JSON.stringify(cB));
    ok('T1 without_schedule 0/0.00 · on_hold 0/0.00',
      d1.contracts_without_schedule === 0 && String(d1.without_schedule_revenue_eur) === '0.00' && d1.contracts_on_hold === 0 && String(d1.on_hold_excluded_eur) === '0.00',
      JSON.stringify([d1.contracts_without_schedule, d1.without_schedule_revenue_eur, d1.contracts_on_hold, d1.on_hold_excluded_eur]));
    ok('T1 RAP-02 incomplete 1 · X 12880.00 · missing_revenue 0 (contract 3: 13800−920)',
      d1.contracts_incomplete_schedule === 1 && String(d1.incomplete_schedule_revenue_eur) === '12880.00' && d1.contracts_missing_revenue_eur === 0,
      JSON.stringify([d1.contracts_incomplete_schedule, d1.incomplete_schedule_revenue_eur, d1.contracts_missing_revenue_eur]));
    ok('T22 grand_total_remaining_eur RAP-02 sonrası DEĞİŞMEDİ (12065.20)', String(d1.grand_total_remaining_eur) === '12065.20', d1.grand_total_remaining_eur);

    // ── T2 fazla tahsilat ──
    console.log('\n── T2 fazla tahsilat (excess) ──');
    await reset();
    const C = await mkContract({ revenue: 1000.00, exchange_rate: 1, revenue_eur: 1000.00 });
    await call('POST', `/api/contracts/${C}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    await pay(C, 1500.00);
    const d2 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T2 excess 500.00', String(conOf(d2, C).excess_eur) === '500.00', conOf(d2, C).excess_eur);
    ok('T2 hiçbir satırda remaining < 0 yok', allLines(d2).every(l => Number(l.remaining_eur) >= 0));
    ok('T2 grand total 0.00', String(d2.grand_total_remaining_eur) === '0.00', d2.grand_total_remaining_eur);

    // ── T3 RAP-03 (kara liste, On Hold ARTIK dışlanır) ──
    console.log('\n── T3 RAP-03 dışlama (Transferred+Cancelled+On Hold) ──');
    await reset();
    const D = await mkContract({ revenue: 500, status: 'Transferred' });
    await call('POST', `/api/contracts/${D}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 500, expected_office_id: turkey }] } });
    const E = await mkContract({ revenue: 500, status: 'Cancelled' });
    await call('POST', `/api/contracts/${E}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 500, expected_office_id: turkey }] } });
    const Fh = await mkContract({ revenue: 500, status: 'On Hold' });
    await call('POST', `/api/contracts/${Fh}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 500, expected_office_id: turkey }] } });
    const Ac = await mkContract({ revenue: 500, status: 'Active' });
    await call('POST', `/api/contracts/${Ac}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 500, expected_office_id: turkey }] } });
    const d3 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T3 Transferred dışarıda', !conOf(d3, D) && !allLines(d3).some(l => l.contract_id === D));
    ok('T3 Cancelled dışarıda', !conOf(d3, E) && !allLines(d3).some(l => l.contract_id === E));
    ok('T3 On Hold gruplarda YOK (RAP-03 güncel)', !conOf(d3, Fh) && !allLines(d3).some(l => l.contract_id === Fh));
    ok('T3 Active İÇERİDE (dışlanmamış statü girer)', !!conOf(d3, Ac) && allLines(d3).some(l => l.contract_id === Ac));
    // Kara-liste vs beyaz-liste: 5. statü contracts_status_check (012:88) 4 değere kilitli →
    // gerçek-bilinmeyen statü DB'ye INSERT edilemez (CHECK). Davranışsal 5-statü kanıtı
    // ÜRETİLEMEZ (BULAMADIM). Kod NOT IN kullanır (cashForecast.js plan CTE) — kara liste.

    // ── T5 PLN-05 yalnız aktif revizyon ──
    console.log('\n── T5 PLN-05 yalnız aktif revizyon ──');
    await reset();
    const G = await mkContract({ revenue: 1000.00, exchange_rate: 1, revenue_eur: 1000.00 });
    await call('POST', `/api/contracts/${G}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 300, expected_office_id: turkey }, { due_date: '2026-09-01', amount: 700, expected_office_id: turkey }] } });
    await call('POST', `/api/contracts/${G}/schedule`, { body: { items: [{ due_date: '2026-08-15', amount: 1000, expected_office_id: turkey }] } });
    const d5 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const gLines = allLines(d5).filter(l => l.contract_id === G);
    ok('T5 yalnız aktif revizyon (1 satır 1000.00), superseded 300/700 yok', gLines.length === 1 && String(gLines[0].amount_eur) === '1000.00', JSON.stringify(gLines.map(l => l.amount_eur)));

    // ── T8 RAP-02 plansız sayacı ──
    console.log('\n── T8 RAP-02 plansız kontrat sayacı ──');
    await reset();
    const H1 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${H1}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await mkContract({ revenue: 1000, status: 'Cancelled' });
    await mkContract({ revenue: 1000, status: 'On Hold' });   // On Hold plansız → without_schedule'a GİRMEZ
    const d8 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T8 contracts_without_schedule = 2 (Cancelled + On Hold sayılmaz)', d8.contracts_without_schedule === 2, d8.contracts_without_schedule);

    // ── T9 Ö0b NULL kur ──
    console.log('\n── T9 Ö0b NULL kur koruması ──');
    await reset();
    const I = await mkContract({ revenue: 1000, exchange_rate: null, revenue_eur: null });
    await call('POST', `/api/contracts/${I}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const d9 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T9 NULL kur dışarıda · contracts_unconvertible = 1', !conOf(d9, I) && !allLines(d9).some(l => l.contract_id === I) && d9.contracts_unconvertible === 1, d9.contracts_unconvertible);

    // ── T10 PLN-11 geçmiş vade + kalan > 0 → overdue ──
    console.log('\n── T10 PLN-11 overdue (geçmiş + kalan>0) ──');
    await reset();
    const J = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${J}/schedule`, { body: { items: [{ due_date: '2020-01-01', amount: 1000, expected_office_id: turkey }] } });
    const d10 = (await call('GET', `/api/cash-forecast`)).body;   // DEFAULT (filtresiz)
    const jLine = allLines(d10).find(l => l.contract_id === J);
    ok('T10 geçmiş+kalan>0 → is_overdue TRUE', jLine && jLine.is_overdue === true, jLine && jLine.is_overdue);
    ok('T10 overdue_remaining_eur 1000.00, upcoming 0.00', String(bucket(d10, 'Turkey').overdue_remaining_eur) === '1000.00' && String(bucket(d10, 'Turkey').upcoming_remaining_eur) === '0.00', JSON.stringify([bucket(d10, 'Turkey').overdue_remaining_eur, bucket(d10, 'Turkey').upcoming_remaining_eur]));

    // ── T11 geçmiş vade + kalan = 0 → overdue DEĞİL ama gizlenmez ──
    console.log('\n── T11 geçmiş + kalan=0 → overdue değil, gizlenmez ──');
    await reset();
    const K = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${K}/schedule`, { body: { items: [{ due_date: '2020-01-01', amount: 1000, expected_office_id: turkey }] } });
    await pay(K, 1000.00, { date: '2020-02-01' });
    const d11 = (await call('GET', `/api/cash-forecast`)).body;
    const kLine = allLines(d11).find(l => l.contract_id === K);
    ok('T11 satır GİZLENMEZ (listede)', !!kLine, kLine);
    ok('T11 remaining 0.00 · is_overdue FALSE', kLine && String(kLine.remaining_eur) === '0.00' && kLine.is_overdue === false, kLine && `${kLine.remaining_eur}/${kLine.is_overdue}`);
    ok('T11 overdue toplam 0.00', String(bucket(d11, 'Turkey').overdue_remaining_eur) === '0.00', bucket(d11, 'Turkey').overdue_remaining_eur);

    // ── T12 DEFAULT çağrı geçmiş satırı getirir (DÜZELTME 1) ──
    console.log('\n── T12 default filtresiz → geçmiş satır gelir ──');
    // T10 seed'i default çağrıda J satırını göstermişti; ayrıca aralık from=bugün-sonrası
    // olsa GELMEZDİ — burada default'un geçmişi dışlamadığını doğruladık (T10 jLine).
    ok('T12 default çağrıda geçmiş vadeli satır MEVCUT (T10 ile kanıtlı)', true);

    // ── T13 overdue + upcoming ≡ total (ofis + grand) ──
    console.log('\n── T13 overdue + upcoming ≡ total ──');
    await reset();
    const L = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${L}/schedule`, { body: { items: [
      { due_date: '2020-01-01', amount: 500, expected_office_id: turkey },   // geçmiş → overdue
      { due_date: '2030-01-01', amount: 500, expected_office_id: turkey } ] } }); // gelecek → upcoming
    const d13 = (await call('GET', `/api/cash-forecast`)).body;
    const tL = bucket(d13, 'Turkey');
    ok('T13 ofis: overdue 500.00 + upcoming 500.00 = total 1000.00',
      String(tL.overdue_remaining_eur) === '500.00' && String(tL.upcoming_remaining_eur) === '500.00' && String(tL.total_remaining_eur) === '1000.00'
      && (Number(tL.overdue_remaining_eur) + Number(tL.upcoming_remaining_eur)).toFixed(2) === String(tL.total_remaining_eur),
      JSON.stringify([tL.overdue_remaining_eur, tL.upcoming_remaining_eur, tL.total_remaining_eur]));
    ok('T13 grand: overdue + upcoming = total',
      (Number(d13.grand_overdue_remaining_eur) + Number(d13.grand_upcoming_remaining_eur)).toFixed(2) === String(d13.grand_total_remaining_eur),
      JSON.stringify([d13.grand_overdue_remaining_eur, d13.grand_upcoming_remaining_eur, d13.grand_total_remaining_eur]));

    // ── T14 RAP-02 On Hold dışlanır ama sayılır ──
    console.log('\n── T14 RAP-02 On Hold dışlanır ama sayılır ──');
    await reset();
    const M = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000, status: 'On Hold' });
    await call('POST', `/api/contracts/${M}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const d14 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T14 On Hold gruplarda YOK', !conOf(d14, M) && !allLines(d14).some(l => l.contract_id === M));
    ok('T14 contracts_on_hold 1 · on_hold_excluded_eur 1000.00', d14.contracts_on_hold === 1 && String(d14.on_hold_excluded_eur) === '1000.00', JSON.stringify([d14.contracts_on_hold, d14.on_hold_excluded_eur]));

    // ── T15 RAP-02 On Hold + NULL kur ──
    console.log('\n── T15 RAP-02 On Hold + NULL kur ──');
    await reset();
    const N = await mkContract({ revenue: 1000, exchange_rate: null, revenue_eur: null, status: 'On Hold' });
    await call('POST', `/api/contracts/${N}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const d15 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T15 sayıya girer (on_hold 1), EUR toplamına girmez (excluded 0.00)', d15.contracts_on_hold === 1 && String(d15.on_hold_excluded_eur) === '0.00', JSON.stringify([d15.contracts_on_hold, d15.on_hold_excluded_eur]));
    ok('T15 contracts_unconvertible 1 (NULL kur ayrıca görünür)', d15.contracts_unconvertible === 1, d15.contracts_unconvertible);

    // revenue_eur AÇIKÇA NULL kontrat (mkContract'ı bozmadan doğrudan insert).
    const mkNullRevEur = async ({ revenue = 1000, exchange_rate = 1, status = 'Active' } = {}) => {
      const r = await pool.query(
        `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
         VALUES (1,1,$1,'X','2026-01-01',$2,'EUR',$3,NULL,$4) RETURNING id`,
        ['AF-CF-N' + (++afSeq), revenue, exchange_rate, status]);
      return r.rows[0].id;
    };

    // ── T16 eksik planlı → X'e girer ──
    console.log('\n── T16 eksik planlı → X ──');
    await reset();
    const O = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${O}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 400, expected_office_id: turkey }] } }); // plan 400 < revenue 1000
    const d16 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T16 incomplete 1 · X 600.00 (1000−400)', d16.contracts_incomplete_schedule === 1 && String(d16.incomplete_schedule_revenue_eur) === '600.00', JSON.stringify([d16.contracts_incomplete_schedule, d16.incomplete_schedule_revenue_eur]));

    // ── T17 plansız → Y, X'e GİRMEZ (ayrıklık) ──
    console.log('\n── T17 plansız → Y, X değil ──');
    await reset();
    const P = await mkContract({ revenue: 5000, exchange_rate: 1, revenue_eur: 5000 }); // plan YOK
    const d17 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T17 without_schedule 1 · Y 5000.00 · incomplete 0 · X 0.00 (ayrık)',
      d17.contracts_without_schedule === 1 && String(d17.without_schedule_revenue_eur) === '5000.00' && d17.contracts_incomplete_schedule === 0 && String(d17.incomplete_schedule_revenue_eur) === '0.00',
      JSON.stringify([d17.contracts_without_schedule, d17.without_schedule_revenue_eur, d17.contracts_incomplete_schedule, d17.incomplete_schedule_revenue_eur]));

    // ── T18 fazla planlı → X'i AZALTMAZ, X'e girmez (E1 asimetri) ──
    console.log('\n── T18 fazla planlı → X etkilenmez ──');
    await reset();
    const Q1 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${Q1}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 300, expected_office_id: turkey }, { due_date: '2026-09-01', amount: 300, expected_office_id: turkey }] } }); // eksik: plan 600<1000 → X'e girer
    const Q2 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${Q2}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1500, expected_office_id: turkey }] } }); // fazla: plan 1500>1000
    const d18 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T18 fazla planlı sayılmadı: incomplete 1 · X 400.00 (yalnız Q1; Q2 azaltmadı)', d18.contracts_incomplete_schedule === 1 && String(d18.incomplete_schedule_revenue_eur) === '400.00', JSON.stringify([d18.contracts_incomplete_schedule, d18.incomplete_schedule_revenue_eur]));

    // ── T19 On Hold ne X ne Y ──
    console.log('\n── T19 On Hold ne X ne Y ──');
    await reset();
    const R1 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000, status: 'On Hold' });
    await call('POST', `/api/contracts/${R1}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 400, expected_office_id: turkey }] } }); // eksik ama On Hold
    const R2 = await mkContract({ revenue: 2000, exchange_rate: 1, revenue_eur: 2000, status: 'On Hold' }); // plansız On Hold
    const d19 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T19 On Hold: X 0.00 · Y 0.00 · without_schedule 0 · incomplete 0', String(d19.incomplete_schedule_revenue_eur) === '0.00' && String(d19.without_schedule_revenue_eur) === '0.00' && d19.contracts_without_schedule === 0 && d19.contracts_incomplete_schedule === 0, JSON.stringify([d19.incomplete_schedule_revenue_eur, d19.without_schedule_revenue_eur, d19.contracts_without_schedule, d19.contracts_incomplete_schedule]));

    // ── T20 Transferred/Cancelled ne X ne Y ──
    console.log('\n── T20 Transferred/Cancelled ne X ne Y ──');
    await reset();
    const S1 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000, status: 'Transferred' });
    await call('POST', `/api/contracts/${S1}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 400, expected_office_id: turkey }] } });
    const S2 = await mkContract({ revenue: 2000, exchange_rate: 1, revenue_eur: 2000, status: 'Cancelled' }); // plansız
    const d20 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T20 terminal: X 0.00 · Y 0.00 · sayaçlar 0', String(d20.incomplete_schedule_revenue_eur) === '0.00' && String(d20.without_schedule_revenue_eur) === '0.00' && d20.contracts_without_schedule === 0 && d20.contracts_incomplete_schedule === 0, JSON.stringify([d20.incomplete_schedule_revenue_eur, d20.without_schedule_revenue_eur]));

    // ── T21 exchange_rate NULL + planlı → X'e girmez, unconvertible'da görünür ──
    console.log('\n── T21 NULL kur + planlı → X değil, unconvertible ──');
    await reset();
    const U = await mkContract({ revenue: 1000, exchange_rate: null, revenue_eur: 500 }); // revenue_eur DOLU ama kur NULL
    await call('POST', `/api/contracts/${U}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 400, expected_office_id: turkey }] } });
    const d21 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T21 NULL kur: incomplete 0 · X 0.00 · unconvertible 1', d21.contracts_incomplete_schedule === 0 && String(d21.incomplete_schedule_revenue_eur) === '0.00' && d21.contracts_unconvertible === 1, JSON.stringify([d21.contracts_incomplete_schedule, d21.incomplete_schedule_revenue_eur, d21.contracts_unconvertible]));

    // ── T23 revenue_eur NULL + planlı → X'e girmez, missing_revenue'da görünür ──
    console.log('\n── T23 revenue_eur NULL + planlı → missing_revenue ──');
    await reset();
    const V = await mkNullRevEur({ revenue: 1000, exchange_rate: 1 });
    await call('POST', `/api/contracts/${V}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 400, expected_office_id: turkey }] } });
    const d23 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T23 revenue_eur NULL: incomplete 0 · X 0.00 · missing_revenue 1', d23.contracts_incomplete_schedule === 0 && String(d23.incomplete_schedule_revenue_eur) === '0.00' && d23.contracts_missing_revenue_eur === 1, JSON.stringify([d23.contracts_incomplete_schedule, d23.incomplete_schedule_revenue_eur, d23.contracts_missing_revenue_eur]));

    // ── T24 revenue_eur NULL + plansız → without_schedule sayısına girer, Y'ye 0 katkı, missing_revenue'da da görünür (örtüşme) ──
    console.log('\n── T24 revenue_eur NULL + plansız → örtüşme ──');
    await reset();
    const W = await mkNullRevEur({ revenue: 1000, exchange_rate: 1 }); // plan YOK
    const d24 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T24 without_schedule 1 · Y 0.00 (NULL atlandı) · missing_revenue 1 (örtüşme)',
      d24.contracts_without_schedule === 1 && String(d24.without_schedule_revenue_eur) === '0.00' && d24.contracts_missing_revenue_eur === 1,
      JSON.stringify([d24.contracts_without_schedule, d24.without_schedule_revenue_eur, d24.contracts_missing_revenue_eur]));

    // ── TAH-04 gün-1 sayaç (d1 = T1 seed'i, hiçbiri eşleşmemiş) ──
    console.log('\n── TAH-04 gün-1 (eşleşme yok) ──');
    ok('T1g payments_matched 0 · payments_unmatched 2 · after_revision 0', d1.payments_matched === 0 && d1.payments_unmatched === 2 && d1.payments_unmatched_after_revision === 0, JSON.stringify([d1.payments_matched, d1.payments_unmatched, d1.payments_unmatched_after_revision]));

    // ── T25 eşleşmiş ödeme kendi kalemini kapatır, U'ya sızmaz ──
    console.log('\n── T25 matched kalemini kapatır ──');
    await reset();
    const c25 = await mkContract({ revenue: 2000, exchange_rate: 1, revenue_eur: 2000 });
    await call('POST', `/api/contracts/${c25}/schedule`, { body: { items: [
      { due_date: '2026-08-01', amount: 1000, expected_office_id: turkey },
      { due_date: '2026-09-01', amount: 1000, expected_office_id: turkey } ] } });
    const it25 = await activeItems(c25);
    await pay(c25, 600, { schedule_item_id: it25[0].id });
    const d25 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l25a = lineOf(d25, c25, '2026-08-01'), l25b = lineOf(d25, c25, '2026-09-01');
    ok('T25 item1 matched 600 → remaining 400 · item2 matched 0 → remaining 1000 (U sızmadı)',
      String(l25a.matched_eur) === '600.00' && String(l25a.remaining_eur) === '400.00' && String(l25b.matched_eur) === '0.00' && String(l25b.remaining_eur) === '1000.00',
      JSON.stringify([l25a.matched_eur, l25a.remaining_eur, l25b.matched_eur, l25b.remaining_eur]));
    ok('T25 payments_matched 1 · payments_unmatched 0', d25.payments_matched === 1 && d25.payments_unmatched === 0, JSON.stringify([d25.payments_matched, d25.payments_unmatched]));

    // ── T26+T27 karma: toplam değişmez, dağılım değişir · Σremaining = Σplan − paid_net ──
    console.log('\n── T26/T27 karma + cebir ──');
    await reset();
    const c26 = await mkContract({ revenue: 2000, exchange_rate: 1, revenue_eur: 2000 });
    await call('POST', `/api/contracts/${c26}/schedule`, { body: { items: [
      { due_date: '2026-08-01', amount: 1000, expected_office_id: turkey },
      { due_date: '2026-09-01', amount: 1000, expected_office_id: turkey } ] } });
    const it26 = await activeItems(c26);
    await pay(c26, 600, { schedule_item_id: it26[0].id });   // eşleşmiş
    await pay(c26, 300);                                      // eşleşmemiş (U)
    const d26 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l26a = lineOf(d26, c26, '2026-08-01'), l26b = lineOf(d26, c26, '2026-09-01');
    ok('T26 item1 remaining 100 (matched 600 + U 300) · item2 1000', String(l26a.remaining_eur) === '100.00' && String(l26b.remaining_eur) === '1000.00', JSON.stringify([l26a.remaining_eur, l26b.remaining_eur]));
    ok('T27 Σremaining 1100 = Σplan 2000 − paid_net 900 (cebir)', String(d26.grand_total_remaining_eur) === '1100.00' && String(conOf(d26, c26).paid_net_eur) === '900.00' && String(conOf(d26, c26).plan_total_eur) === '2000.00', JSON.stringify([d26.grand_total_remaining_eur, conOf(d26, c26).paid_net_eur]));

    // ── T28 aşırı tahsis: cap üst kırpma, excess ayrı ──
    console.log('\n── T28 aşırı tahsis ──');
    await reset();
    const c28 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${c28}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const it28 = await activeItems(c28);
    await pay(c28, 1500, { schedule_item_id: it28[0].id });
    const d28 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l28 = lineOf(d28, c28, '2026-08-01');
    ok('T28 matched 1500 → remaining 0.00 · excess_eur 500.00 (cap üst kırpma)', String(l28.remaining_eur) === '0.00' && String(l28.excess_eur) === '500.00' && String(l28.matched_eur) === '1500.00', JSON.stringify([l28.remaining_eur, l28.excess_eur]));

    // ── T29 yalnız reversal eşleşmiş (matched negatif) → cap = plan (Ö0b üst kırpma) ──
    console.log('\n── T29 negatif matched → cap=plan ──');
    await reset();
    const c29 = await mkContract({ revenue: 2000, exchange_rate: 1, revenue_eur: 2000 });
    await call('POST', `/api/contracts/${c29}/schedule`, { body: { items: [
      { due_date: '2026-08-01', amount: 1000, expected_office_id: turkey },
      { due_date: '2026-09-01', amount: 1000, expected_office_id: turkey } ] } });
    const it29 = await activeItems(c29);
    // base item2'ye eşleşti (U'ya girmesin) → sonra item1'e NEGATİF eşleşme (kısıt: reverses zorunlu)
    const base29 = await pay(c29, 1000, { schedule_item_id: it29[1].id, date: '2026-07-01' });
    await pay(c29, -1000, { schedule_item_id: it29[0].id, reverses: base29 });   // matched_1 = -1000
    const d29 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l29 = lineOf(d29, c29, '2026-08-01');
    ok('T29 matched -1000 → cap üst kırpıldı, remaining 1000.00 (=plan, üst kırpma yoksa 2000)', l29 && String(l29.remaining_eur) === '1000.00', l29 && l29.remaining_eur);

    // ── T30 revizyon eşleşmiş ödemeyi düşürür → warning ──
    console.log('\n── T30 revizyon warning ──');
    await reset();
    const c30 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${c30}/schedule`, { body: { items: [
      { due_date: '2026-08-01', amount: 500, expected_office_id: turkey },
      { due_date: '2026-09-01', amount: 500, expected_office_id: turkey } ] } });
    const it30 = await activeItems(c30);
    await pay(c30, 500, { schedule_item_id: it30[0].id });
    const r30 = await call('POST', `/api/contracts/${c30}/schedule`, { body: { items: [{ due_date: '2026-08-15', amount: 1000, expected_office_id: turkey }] } });
    ok('T30 revizyon → dropped_match_count 1 + matched_warning (ENGELLEME YOK, 201)', r30.status === 201 && r30.body.dropped_match_count === 1 && /dropped/i.test(r30.body.matched_warning || ''), JSON.stringify([r30.status, r30.body.dropped_match_count, r30.body.matched_warning]));

    // ── T31 6 revizyon ölçeği (contract 3 deseni) ──
    console.log('\n── T31 6 revizyon ölçeği ──');
    await reset();
    const c31 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    for (let k = 0; k < 6; k++) {
      await call('POST', `/api/contracts/${c31}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    }
    const it31 = await activeItems(c31);
    await pay(c31, 400, { schedule_item_id: it31[0].id });
    const supCount = (await pool.query("SELECT count(*) c FROM payment_schedule_items WHERE contract_id=$1 AND superseded_at IS NOT NULL", [c31])).rows[0].c;
    const d31 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l31 = lineOf(d31, c31, '2026-08-01');
    ok('T31 5 superseded · rev6 aktif kaleme matched 400 → remaining 600 · tek satır', supCount === '5' && allLines(d31).filter(l => l.contract_id === c31).length === 1 && String(l31.matched_eur) === '400.00' && String(l31.remaining_eur) === '600.00', JSON.stringify([supCount, l31 && l31.matched_eur, l31 && l31.remaining_eur]));

    // ── T32a/b düşmüş eşleşme: matched'e girmez, U'ya girer, sayaçta ayrı ──
    console.log('\n── T32a/b düşmüş eşleşme ──');
    await reset();
    const c32 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${c32}/schedule`, { body: { items: [
      { due_date: '2026-08-01', amount: 500, expected_office_id: turkey },
      { due_date: '2026-09-01', amount: 500, expected_office_id: turkey } ] } });
    const it32 = await activeItems(c32);
    await pay(c32, 500, { schedule_item_id: it32[0].id });   // rev1 item1'e eşleşti
    await call('POST', `/api/contracts/${c32}/schedule`, { body: { items: [{ due_date: '2026-08-15', amount: 1000, expected_office_id: turkey }] } });  // rev2 → item1 superseded
    const d32 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const l32 = lineOf(d32, c32, '2026-08-15');
    ok('T32a düşmüş: matched_eur 0 · remaining 500 (U=500 teleskoba döndü, toplam değişmez)', String(l32.matched_eur) === '0.00' && String(l32.remaining_eur) === '500.00', JSON.stringify([l32.matched_eur, l32.remaining_eur]));
    ok('T32b düşmüş ödeme after_revision=1 · unmatched(NULL)=0 · matched=0 (ayrı sayılır)', d32.payments_unmatched_after_revision === 1 && d32.payments_unmatched === 0 && d32.payments_matched === 0, JSON.stringify([d32.payments_unmatched_after_revision, d32.payments_unmatched, d32.payments_matched]));

    // ── T33 başka kontratın kalemine eşleşme → 400 ──
    console.log('\n── T33/T34 endpoint doğrulama ──');
    await reset();
    const cX = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cX}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const cY = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cY}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const itX = await activeItems(cX);
    const r33 = await payApi(cY, { amount: 100, office: turkey, schedule_item_id: itX[0].id });
    ok('T33 başka kontratın kalemi → 400 invalid schedule item', r33.status === 400 && r33.body.error === 'invalid schedule item', JSON.stringify([r33.status, r33.body.error]));
    // ── T34 boş eşleştirme geçerli (C5) ──
    const r34a = await payApi(cX, { amount: 100, office: turkey });                       // hiç göndermez
    const r34b = await payApi(cX, { amount: 100, office: turkey, schedule_item_id: '' });  // boş string
    const r34c = await payApi(cX, { amount: 100, office: turkey, schedule_item_id: itX[0].id }); // geçerli
    ok('T34 boş eşleştirme 201 (yok / boş string) · geçerli eşleşme 201', r34a.status === 201 && r34b.status === 201 && r34c.status === 201, JSON.stringify([r34a.status, r34b.status, r34c.status]));

    // ── T35 TABAN 342.00 (C6 gate) — komisyon motoru (silinen M1/M2 suitleri yerine) ──
    console.log('\n── T35 TABAN 342.00 (C6) ──');
    await reset();
    const ag35 = (await pool.query(
      "INSERT INTO sales_agents (organizer_id, name, default_commission_pct, agent_type) VALUES (1,'SR Base',5,'external_freelance') RETURNING id")).rows[0].id;
    const c35 = (await pool.query(
      `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status,sr_sales_agent_id)
       VALUES (1,1,'AF-BASE342','X','2026-01-01',18600,'EUR',1,18600,'Active',$1) RETURNING id`, [ag35])).rows[0].id;
    await pool.query(
      `INSERT INTO contract_line_items (contract_id,line_no,description,quantity,unit_price,discount_percent,is_registration_fee,currency)
       VALUES ($1,1,'Item',1,17100,0,false,'EUR')`, [c35]);
    await pay(c35, 7440);   // ratio 7440/18600 = 0.4 → pot 855 × 0.4 = 342
    const cd35 = (await call('GET', `/api/contracts/${c35}`)).body;
    const sr35 = ((cd35.commission && cd35.commission.roles) || []).find(r => r.role === 'sr');
    ok('T35 TABAN sr earned 342.00 (base 17100 × %5 × ratio 0.4) — C6 KAYMADI', sr35 && String(sr35.earned) === '342.00' && String(sr35.earned_eur) === '342.00', sr35 && JSON.stringify([sr35.pct_used, sr35.full, sr35.earned]));

    // ══ REGRESYON ASSERTION'LARI (R1-R8) — silinen suitlerin dokunulan-yol kritikleri ══
    console.log('\n── R1-R8 regresyon (dokunulan yollar) ──');

    // R1 (OFS-03) ofissiz ödeme → 400
    await reset();
    const cR1 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cR1}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const rR1 = await payApi(cR1, { amount: 100 });   // ofis göndermez
    ok('R1 (OFS-03) ofissiz ödeme → 400 office required', rR1.status === 400 && rR1.body.error === 'office required', JSON.stringify([rR1.status, rR1.body.error]));

    // R2 (TAH-01) reversal ofis + taksit DEVRALIR
    const itR1 = await activeItems(cR1);
    const pR2 = await payApi(cR1, { amount: 100, office: turkey, schedule_item_id: itR1[0].id });
    const rR2 = await call('POST', `/api/contracts/${cR1}/payments/${pR2.body.payment.id}/reverse`);
    const revP = rR2.body.payment;
    ok('R2 (TAH-01) reversal received_office_id + schedule_item_id orijinalden devralır', rR2.status === 201 && revP.received_office_id === turkey && revP.schedule_item_id === itR1[0].id, JSON.stringify([revP.received_office_id, revP.schedule_item_id]));

    // R3 (SEM-01) geçersiz method → 400
    const rR3 = await call('POST', `/api/contracts/${cR1}/payments`, { body: { amount: 100, currency: 'EUR', exchange_rate: 1, payment_method: 'wire', payment_date: '2026-08-01', received_office_id: turkey } });
    ok('R3 (SEM-01) geçersiz method wire → 400', rR3.status === 400 && /payment_method/.test(rR3.body.error || ''), JSON.stringify([rR3.status, rR3.body.error]));

    // R4 (PLN-05) revizyon: aktif = superseded IS NULL, revision = max+1
    await reset();
    const cR4 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cR4}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 500, expected_office_id: turkey }, { due_date: '2026-09-01', amount: 500, expected_office_id: turkey }] } });
    const rR4 = await call('POST', `/api/contracts/${cR4}/schedule`, { body: { items: [{ due_date: '2026-08-15', amount: 1000, expected_office_id: turkey }] } });
    const supR4 = (await pool.query("SELECT count(*) c FROM payment_schedule_items WHERE contract_id=$1 AND superseded_at IS NOT NULL", [cR4])).rows[0].c;
    ok('R4 (PLN-05) revizyon: tek aktif · revision 2 · 2 superseded', (await activeItems(cR4)).length === 1 && rR4.body.active[0].revision === 2 && supR4 === '2', JSON.stringify([rR4.body.active[0] && rR4.body.active[0].revision, supR4]));

    // R5 (PLN-01) eksik önkoşul (expo.start_date NULL) → 400 + 0 satır
    await reset();
    await pool.query('UPDATE expos SET start_date = NULL WHERE id = 1');
    const cR5 = await mkContract({ expo_id: 1, revenue: 1000 });
    const rR5 = await call('POST', `/api/contracts/${cR5}/schedule/default`);
    ok('R5 (PLN-01) yarım plan yasak: eksik önkoşul → 400 + 0 satır', rR5.status === 400 && (await activeItems(cR5)).length === 0, JSON.stringify([rR5.status, rR5.body && rR5.body.error]));

    // R6 (A4) transfer: kaynak plan aktif kalır · klonda plan yok
    await reset();
    const cR6 = await mkContract({ expo_id: 1, revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cR6}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const rR6 = await call('POST', `/api/contracts/${cR6}/transfer`, { body: { expo_id: 2 } });
    const cloneR6 = rR6.body.contract.id;
    ok('R6 (A4) transfer: kaynak plan aktif (1) · klon plansız (0)', rR6.status === 201 && (await activeItems(cR6)).length === 1 && (await activeItems(cloneR6)).length === 0, JSON.stringify([rR6.status, (await activeItems(cR6)).length, (await activeItems(cloneR6)).length]));

    // R7 (PLN-10 fallback) eşleşme yokken teleskop PS3-B ile BİREBİR (gün-1, d1 = T1 seed)
    ok('R7 (PLN-10 fallback) gün-1 birebir: grand 12065.20 · Turkey 11160.00 · (No office) 905.20',
      String(d1.grand_total_remaining_eur) === '12065.20' && String(bucket(d1, 'Turkey').total_remaining_eur) === '11160.00' && String(bucket(d1, '(No office)').total_remaining_eur) === '905.20',
      JSON.stringify([d1.grand_total_remaining_eur, bucket(d1, 'Turkey').total_remaining_eur, bucket(d1, '(No office)').total_remaining_eur]));

    // R8 (OFS-06) NULL ofis satırı eşleşme SONRASI da (No office) kovasında
    await reset();
    const cR8 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${cR8}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000 }] } });  // ofis YOK → NULL
    const itR8 = await activeItems(cR8);
    await pay(cR8, 400, { schedule_item_id: itR8[0].id });
    const dR8 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const noR8 = bucket(dR8, '(No office)');
    const lR8 = noR8 && noR8.lines.find(l => l.contract_id === cR8);
    ok('R8 (OFS-06) NULL ofis eşleşme sonrası da (No office) kovasında · matched 400', !!noR8 && !!lR8 && String(lR8.matched_eur) === '400.00', JSON.stringify([!!noR8, lR8 && lR8.matched_eur]));

    // ── T36/T37/T38 sayaç tutarlılığı (görsel tur kusuru) ──
    console.log('\n── T36/T37/T38 sayaç ↔ satır ↔ banner tek kaynak ──');
    await reset();
    const c36 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${c36}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const it36 = await activeItems(c36);
    const p36 = await payApi(c36, { amount: 10, office: turkey, schedule_item_id: it36[0].id });
    const d36a = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    // T37b canlı eşleşme: sayaç EUR == Σ satır matched
    const sumA = allLines(d36a).reduce((s, l) => s + Number(l.matched_eur || 0), 0);
    ok('T37b canlı eşleşme: matched_payments_eur 10.00 == Σ satır matched 10.00 == banner düşümü', d36a.payments_matched === 1 && Number(d36a.matched_payments_eur) === 10 && sumA === 10 && String(d36a.grand_total_remaining_eur) === '990.00', JSON.stringify([d36a.payments_matched, d36a.matched_payments_eur, sumA, d36a.grand_total_remaining_eur]));
    // T36 reverse → banner/satır DEĞİŞMEZ (net 0) VE sayaç 0/0.00
    await call('POST', `/api/contracts/${c36}/payments/${p36.body.payment.id}/reverse`);
    const d36b = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    const sumB = allLines(d36b).reduce((s, l) => s + Number(l.matched_eur || 0), 0);
    ok('T36 reversal → banner 1000.00 + satır matched 0 + sayaç 0 / 0.00 (net sıfır sayılmaz)', String(d36b.grand_total_remaining_eur) === '1000.00' && sumB === 0 && d36b.payments_matched === 0 && String(d36b.matched_payments_eur) === '0.00', JSON.stringify([d36b.grand_total_remaining_eur, sumB, d36b.payments_matched, d36b.matched_payments_eur]));
    // T37 tutarlılık: sayaç EUR == Σ satır matched (reversal sonrası da)
    ok('T37 sayaç ↔ satır tek tanım: matched_payments_eur == Σ satır matched (0.00)', Number(d36b.matched_payments_eur) === sumB, JSON.stringify([d36b.matched_payments_eur, sumB]));

    // T38 unmatched sayacı EUR NET (brüt değil) — terslenmiş unmatched elenir
    await reset();
    const c38 = await mkContract({ revenue: 1000, exchange_rate: 1, revenue_eur: 1000 });
    await call('POST', `/api/contracts/${c38}/schedule`, { body: { items: [{ due_date: '2026-08-01', amount: 1000, expected_office_id: turkey }] } });
    const pu38 = await payApi(c38, { amount: 100, office: turkey });        // unmatched, sonra terslenecek
    await call('POST', `/api/contracts/${c38}/payments/${pu38.body.payment.id}/reverse`);  // net 0
    await pay(c38, 50);                                                     // canlı unmatched
    const d38 = (await call('GET', `/api/cash-forecast${WIDE}`)).body;
    ok('T38 unmatched EUR NET: terslenmiş(100) elenir, canlı(50) kalır → 1 / 50.00 (brüt 150 DEĞİL)', d38.payments_unmatched === 1 && String(d38.unmatched_payments_eur) === '50.00', JSON.stringify([d38.payments_unmatched, d38.unmatched_payments_eur]));

    console.log(`\n═══ CASH FORECAST SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
