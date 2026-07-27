// ----------------------------------------------------------------------------
// GET /api/commissions — Kesim-dönemi komisyon raporu (M2)
// K7c (kesim) + U1a (tavan kümülatif-marjinal) + U2a (payment_date DATE, takvim)
// + U3a (yalnız hak edilmiş dilimler). Tüm aritmetik SQL'de; ara yuvarlama YOK,
// TEK final ROUND (M-e).
//
// MODEL (kilit):
//  - KESİM (K7c): gün ≤ 15 → cut_date = ayın 15'i · gün ≥ 16 → ayın SON günü.
//    Kesim günü DAHİL. Cycle SAKLANMAZ — SQL'de türetilir. TZ hesabı yok.
//  - DİLİM (M-c + U1a — tavan kümülatif-marjinal):
//    sıra: PARTITION BY contract ORDER BY payment_date, id
//    cum_after = pencere SUM(amount_eur) (satır dahil) · cum_before = cum_after − amount_eur
//    effective_pay = LEAST(cum_after, revenue_eur) − LEAST(cum_before, revenue_eur)
//    slice_raw(rol) = pot_eur(rol) × effective_pay / revenue_eur   [HAM]
//    pot_eur(rol) = base × pct/100 × exchange_rate  (M1 türetimi; SD bağımsız hüküm).
//  - Reversal: NEGATİF amount_eur satırı → negatif effective_pay → negatif dilim;
//    tavan-üstü reversal → 0 (fazlalığa komisyon doğmamıştı, clawback YOK). Özel kod yok.
//  - İNVARYANT: Σ HAM dilim ≡ pot_eur × LEAST(paid/revenue,1) (telescoping).
//  - Cancelled (kilitli hüküm): rapor status-agnostik; contract_status satırda taşınır.
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
// Dilim üretimi TEK KAYNAK (S-8): pay/eff/sliced CTE'leri commissionSlices.js'te;
// M2 ile agent statement AYNI ifadeyi kullanır (ikinci formül yok).
const { SLICE_CTES } = require('../utils/commissionSlices');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

// Etiket biçimi: "Jul 1–15, 2026 (cut Jul 15)" / "Jul 16–31, 2026 (cut Jul 31)".
// cut_date + first_half'tan türetilir (start = 1|16, end = cut günü, cut günü = end).
function buildLabel(cut, firstHalf) {
  const [y, m, d] = cut.split('-').map(Number);
  const mon = MON[m - 1];
  const start = firstHalf ? 1 : 16;
  return `${mon} ${start}–${d}, ${y} (cut ${mon} ${d})`;
}

router.get('/', authMiddleware, async (req, res) => {
  // FAZ 4: commission-read permission kontrolü buraya (convert emsali; bugün
  // organizer-scope + geçerli JWT yeterli).
  const from = req.query.from;
  const to = req.query.to;
  if (from != null && from !== '' && !isValidDate(from)) {
    return res.status(400).json({ error: 'from must be a valid YYYY-MM-DD date.' });
  }
  if (to != null && to !== '' && !isValidDate(to)) {
    return res.status(400).json({ error: 'to must be a valid YYYY-MM-DD date.' });
  }

  try {
    // NOT: cum_after penceresi TÜM ödeme geçmişini görür (tarih filtresi YOK) —
    // kümülatif doğru olsun diye. Tarih filtresi yalnız GÖSTERİLECEK dönemleri
    // (cut_date) süzer; default aralık SQL'de (önceki ayın 1'i → bugün).
    const sql = `
      WITH params AS (
        SELECT
          COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS from_date,
          -- ⚠️ SAPMA (işaretli): brief default to = "bugün" der; ama filtre cut_date'e
          -- uygulanır ve içinde bulunulan dönemin cut_date'i (ör. gün 24 → ayın SON günü)
          -- bugünden İLERİDE olur → literal "bugün" mevcut dönemi dışlar (G5a çelişkisi).
          -- Bu yüzden default to = BUGÜNÜN AİT OLDUĞU DÖNEMİN cut_date'i (dönem sonu).
          COALESCE($3::date,
            CASE WHEN EXTRACT(DAY FROM CURRENT_DATE) <= 15
                 THEN date_trunc('month', CURRENT_DATE)::date + 14
                 ELSE (date_trunc('month', CURRENT_DATE) + interval '1 month')::date - 1
            END) AS to_date
      ),
${SLICE_CTES},
      filtered AS (
        SELECT s.*,
          -- TEK final ROUND (M-e): dönem×agent HAM dilim toplamı, tek yuvarlama.
          -- Pencere WHERE'den SONRA çalışır → yalnız aralıktaki dilimleri toplar.
          ROUND(SUM(s.slice_raw) OVER (PARTITION BY s.cut_date, s.sales_agent_id), 2) AS agent_total_eur
        FROM sliced s, params
        WHERE s.slice_raw IS NOT NULL
          AND s.cut_date >= params.from_date
          AND s.cut_date <= params.to_date
      )
      SELECT
        to_char(cut_date, 'YYYY-MM-DD') AS cut_date,
        first_half,
        sales_agent_id, agent_name, agent_total_eur,
        contract_id, af_number, contract_status,
        role, payment_id,
        to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
        amount_eur,
        ROUND(slice_raw, 2) AS slice_eur,
        capped, reversal
      FROM filtered
      ORDER BY cut_date DESC, agent_name, payment_date, payment_id, role`;

    const { rows } = await pool.query(sql, [
      req.organizer_id,
      from == null || from === '' ? null : from,
      to == null || to === '' ? null : to,
    ]);

    // Nesting: period (cut_date) → agent (sales_agent_id) → slices.
    // Map ekleme sırasını korur → SQL ORDER BY sırası nesne dizisine yansır.
    const periodMap = new Map();
    for (const r of rows) {
      let per = periodMap.get(r.cut_date);
      if (!per) {
        per = { cut_date: r.cut_date, label: buildLabel(r.cut_date, r.first_half), agents: new Map() };
        periodMap.set(r.cut_date, per);
      }
      let ag = per.agents.get(r.sales_agent_id);
      if (!ag) {
        ag = { sales_agent_id: r.sales_agent_id, agent_name: r.agent_name, total_eur: r.agent_total_eur, slices: [] };
        per.agents.set(r.sales_agent_id, ag);
      }
      // U3a: potansiyel/full alanı YOK — yalnız hak edilmiş dilim.
      const slice = {
        contract_id: r.contract_id, af_number: r.af_number, contract_status: r.contract_status,
        role: r.role, payment_id: r.payment_id, payment_date: r.payment_date,
        amount_eur: r.amount_eur, slice_eur: r.slice_eur,
      };
      if (r.capped) slice.capped = true;
      if (r.reversal) slice.reversal = true;
      ag.slices.push(slice);
    }

    const periods = [...periodMap.values()].map(p => ({
      cut_date: p.cut_date, label: p.label, agents: [...p.agents.values()],
    }));

    res.json({ periods });
  } catch (err) {
    console.error('Error building commission report:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
