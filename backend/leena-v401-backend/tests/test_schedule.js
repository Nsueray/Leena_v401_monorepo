// M4/PLN plan üretimi testi — YEREL scratch DB (ell_comm_test). GERÇEK endpoint'ler.
// Ayrı dosya (domain: ödeme planı). Kaynak = KÜTÜK PLN-01..08 (hatıra değil).
// PLN-09/10/11 cash-forecast'ta test edilir — burada YAZILMAZ (çift değil).
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
const TOKEN = jwt.sign({ organizer_id: 1 }, process.env.JWT_SECRET);
const PORT = 45955;

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
}
let afSeq = 0;
const setExpoStart = (expoId, d) => pool.query('UPDATE expos SET start_date=$2 WHERE id=$1', [expoId, d]);
async function mkContract({ expo_id = 1, contract_date = '2026-01-01', revenue = 1000, currency = 'EUR' } = {}) {
  const r = await pool.query(
    `INSERT INTO contracts (organizer_id,expo_id,af_number,company_name,contract_date,revenue,currency,exchange_rate,revenue_eur,status)
     VALUES (1,$1,$2,'X',$3,$4,$5,1,$4,'Active') RETURNING id`,
    [expo_id, 'AF-SCH-' + (++afSeq), contract_date, revenue, currency]);
  return r.rows[0].id;
}
const defGen = (cid) => call('POST', `/api/contracts/${cid}/schedule/default`);
const manual = (cid, items) => call('POST', `/api/contracts/${cid}/schedule`, { items });
// Aktif kalemler — to_char ile TZ-güvenli (POST yanıtına güvenme).
const itemsOf = (cid) => pool.query(
  "SELECT item_no, to_char(due_date,'YYYY-MM-DD') AS due, amount::text AS amount, percent::text AS percent, superseded_at FROM payment_schedule_items WHERE contract_id=$1 AND superseded_at IS NULL ORDER BY item_no", [cid]).then(r => r.rows);
const rowCount = (cid) => pool.query('SELECT count(*) c FROM payment_schedule_items WHERE contract_id=$1', [cid]).then(r => r.rows[0].c);

const server = app.listen(PORT, async () => {
  try {
    // ══ PLN-01: "Yarım plan yasaktır; contract_date/expo_id/expo.start_date/revenue'dan biri NULL ise 400 + 0 satır." ══
    console.log('\n── PLN-01 yarım plan yasak ──');
    await reset(); await setExpoStart(1, '2026-06-01');
    const c01a = await mkContract({ expo_id: null });
    const r01a = await defGen(c01a);
    ok('S01a (PLN-01) expo_id NULL → 400 "expo required" + 0 satır', r01a.status === 400 && r01a.body.error === 'expo required' && (await rowCount(c01a)) === '0', JSON.stringify([r01a.status, r01a.body && r01a.body.error]));
    const c01b = await mkContract({ revenue: null });
    const r01b = await defGen(c01b);
    ok('S01b (PLN-01) revenue NULL → 400 "contract revenue required" + 0 satır', r01b.status === 400 && r01b.body.error === 'contract revenue required' && (await rowCount(c01b)) === '0', JSON.stringify([r01b.status, r01b.body && r01b.body.error]));
    const c01c = await mkContract({ contract_date: null });
    const r01c = await defGen(c01c);
    ok('S01c (PLN-01) contract_date NULL → 400 "contract_date required" + 0 satır', r01c.status === 400 && r01c.body.error === 'contract_date required' && (await rowCount(c01c)) === '0', JSON.stringify([r01c.status, r01c.body && r01c.body.error]));
    await setExpoStart(2, null);
    const c01d = await mkContract({ expo_id: 2 });
    const r01d = await defGen(c01d);
    ok('S01d (PLN-01) expo.start_date NULL → 400 "expo start date required" + 0 satır', r01d.status === 400 && r01d.body.error === 'expo start date required' && (await rowCount(c01d)) === '0', JSON.stringify([r01d.status, r01d.body && r01d.body.error]));

    // ══ PLN-02: "d2 ≤ d1 ise tek kalem %100 @ d1; değilse %40 @ d1 + kalan @ d2." (d1=cd+7, d2=expo_start−30) ══
    console.log('\n── PLN-02 %40/%60 bölünmesi ──');
    await reset(); await setExpoStart(1, '2026-06-01');   // d2 = 2026-05-02 > d1 = 2026-01-08
    const c02 = await mkContract({ contract_date: '2026-01-01', revenue: 1000 });
    await defGen(c02);
    const it02 = await itemsOf(c02);
    // el hesabı: 1000 × %40 = 400,00 @ d1 ; kalan 600,00 @ d2 ; d1 = 2026-01-01+7 = 2026-01-08 ; d2 = 2026-06-01−30 = 2026-05-02
    ok('S02a (PLN-02) d2>d1 → 2 kalem: 400.00 @ 2026-01-08 (%40) + 600.00 @ 2026-05-02 (%60)',
      it02.length === 2 && it02[0].amount === '400.00' && it02[0].due === '2026-01-08' && String(it02[0].percent) === '40.00' && it02[1].amount === '600.00' && it02[1].due === '2026-05-02' && String(it02[1].percent) === '60.00',
      JSON.stringify(it02.map(x => [x.amount, x.due, x.percent])));
    await reset(); await setExpoStart(1, '2026-01-20');   // d2 = 2025-12-21 ≤ d1 = 2026-01-08 → birleşme
    const c02b = await mkContract({ contract_date: '2026-01-01', revenue: 1000 });
    await defGen(c02b);
    const it02b = await itemsOf(c02b);
    ok('S02b (PLN-02) d2≤d1 → TEK kalem %100: 1000.00 @ 2026-01-08', it02b.length === 1 && it02b[0].amount === '1000.00' && it02b[0].due === '2026-01-08' && String(it02b[0].percent) === '100.00', JSON.stringify(it02b.map(x => [x.amount, x.due, x.percent])));

    // ══ PLN-03: "Yuvarlama artığı İKİNCİ kaleme yazılır; Σ kalem ≡ revenue TAM olur." ══
    console.log('\n── PLN-03 yuvarlama artığı ──');
    await reset(); await setExpoStart(1, '2026-06-01');
    const c03 = await mkContract({ contract_date: '2026-01-01', revenue: 100.01 });
    await defGen(c03);
    const it03 = await itemsOf(c03);
    // el hesabı: 100.01 × %40 = 40.004 → 40.00 (ilk) ; artık İKİNCİ kaleme: 100.01 − 40.00 = 60.01 ; Σ = 100.01 TAM
    ok('S03a (PLN-03) artık İKİNCİ kaleme: ilk 40.00, ikinci 60.01 (60% yerine artık emilmiş)', it03[0].amount === '40.00' && it03[1].amount === '60.01', JSON.stringify(it03.map(x => x.amount)));
    const sum03 = (Number(it03[0].amount) + Number(it03[1].amount)).toFixed(2);
    ok('S03b (PLN-03) Σ kalem ≡ revenue TAM: 40.00 + 60.01 = 100.01', sum03 === '100.01', sum03);

    // ══ PLN-04: "Planda kur dondurulmaz; exchange_rate/amount_eur kolonu yoktur." ══
    console.log('\n── PLN-04 planda kur yok ──');
    const noKur = (await pool.query("SELECT count(*) c FROM information_schema.columns WHERE table_name='payment_schedule_items' AND column_name IN ('exchange_rate','amount_eur')")).rows[0].c;
    ok('S04a (PLN-04) payment_schedule_items\'ta exchange_rate/amount_eur kolonu YOK', noKur === '0', noKur);

    // ══ PLN-05: "Tutar/tarih ASLA UPDATE edilmez; revizyonda superseded_at + revision=max+1. Aktif = superseded_at IS NULL." ══
    console.log('\n── PLN-05 revizyon / immutable ──');
    await reset(); await setExpoStart(1, '2026-06-01');
    const c05 = await mkContract({ contract_date: '2026-01-01', revenue: 1000 });
    await manual(c05, [{ due_date: '2026-02-01', amount: 400 }, { due_date: '2026-03-01', amount: 600 }]);
    const before = (await pool.query('SELECT id, amount::text, to_char(due_date,\'YYYY-MM-DD\') AS due FROM payment_schedule_items WHERE contract_id=$1 ORDER BY item_no', [c05])).rows;
    const r05 = await manual(c05, [{ due_date: '2026-02-15', amount: 1000 }]);   // revizyon 2
    const oldRows = (await pool.query('SELECT amount::text, to_char(due_date,\'YYYY-MM-DD\') AS due, superseded_at FROM payment_schedule_items WHERE id = ANY($1::int[])', [before.map(x => x.id)])).rows;
    ok('S05a (PLN-05) eski satırlar UPDATE EDİLMEZ: amount/due DEĞİŞMEMİŞ + superseded_at DOLU',
      oldRows.every(o => o.superseded_at != null) && oldRows.some(o => o.amount === '400.00' && o.due === '2026-02-01') && oldRows.some(o => o.amount === '600.00' && o.due === '2026-03-01'),
      JSON.stringify(oldRows.map(o => [o.amount, o.due, !!o.superseded_at])));
    const act05 = await itemsOf(c05);
    ok('S05b (PLN-05) aktif = superseded IS NULL: tek revizyon (revision 2, 1 kalem 1000.00)', r05.status === 201 && r05.body.active[0].revision === 2 && act05.length === 1 && act05[0].amount === '1000.00', JSON.stringify([r05.body.active[0] && r05.body.active[0].revision, act05.length]));

    // ══ PLN-06: "Ödeme durumu saklanmaz; türetilir (kontrat seviyesi)." ══
    console.log('\n── PLN-06 ödeme durumu saklanmaz ──');
    const noPaid = (await pool.query("SELECT count(*) c FROM information_schema.columns WHERE table_name='payment_schedule_items' AND column_name IN ('paid','is_paid','status','settled_at','paid_at')")).rows[0].c;
    ok('S06a (PLN-06) payment_schedule_items\'ta ödeme-durumu kolonu YOK (saklanmaz)', noPaid === '0', noPaid);
    await reset(); await setExpoStart(1, '2026-06-01');
    const c06 = await mkContract({ revenue: 1000 });
    await manual(c06, [{ due_date: '2026-02-01', amount: 1000 }]);
    const g06 = await call('GET', `/api/contracts/${c06}/schedule`);
    ok('S06b (PLN-06) scheduled_total + matches_revenue TÜRETİLİR (Σ=1000=revenue → true)', String(g06.body.totals.scheduled_total) === '1000.00' && g06.body.totals.matches_revenue === true, JSON.stringify([g06.body.totals.scheduled_total, g06.body.totals.matches_revenue]));

    // ══ PLN-07: "Σ ≠ revenue engellenmez; elle girişte warning döner." ══
    console.log('\n── PLN-07 Σ≠revenue → warning ──');
    await reset(); await setExpoStart(1, '2026-06-01');
    const c07 = await mkContract({ revenue: 1000 });
    const r07a = await manual(c07, [{ due_date: '2026-02-01', amount: 300 }, { due_date: '2026-03-01', amount: 300 }]);   // Σ=600 ≠ 1000
    ok('S07a (PLN-07) Σ≠revenue → 201 (ENGELLENMEZ) + warning', r07a.status === 201 && /does not match/i.test(r07a.body.warning || '') && r07a.body.active.length === 2, JSON.stringify([r07a.status, r07a.body.warning]));
    await reset(); await setExpoStart(1, '2026-06-01');
    const c07b = await mkContract({ revenue: 1000 });
    const r07b = await manual(c07b, [{ due_date: '2026-02-01', amount: 400 }, { due_date: '2026-03-01', amount: 600 }]);   // Σ=1000 = revenue
    ok('S07b (PLN-07) Σ=revenue → 201, warning YOK', r07b.status === 201 && !('warning' in r07b.body), JSON.stringify([r07b.status, r07b.body.warning]));

    console.log(`\n═══ SCHEDULE SONUÇ: ${pass} geçti, ${fail} başarısız ═══\n`);
  } catch (e) { console.error('TEST HATASI:', e); fail++; }
  finally { server.close(); await pool.end(); process.exit(fail === 0 ? 0 : 1); }
});
