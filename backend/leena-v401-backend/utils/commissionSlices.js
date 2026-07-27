// ----------------------------------------------------------------------------
// commissionSlices.js — KOMİSYON DİLİMİ TEK KAYNAĞI (S-8)
// ----------------------------------------------------------------------------
// M2 kesim raporu (routes/commissions.js) VE agent statement (routes/payouts.js)
// AYNI dilim üretimini kullanır. İkinci bir komisyon formülü YOKTUR.
//
// SLICE_CTES: `pay` (pencere cum_after) + `eff` (effective_pay/capped/cut_date +
// tavan kümülatif-marjinal) + `sliced` (rol başına slice_raw = pot_eur ×
// effective_pay / revenue_eur). Metin routes/commissions.js:75-125'ten AYNEN
// taşındı (SALT ÇIKARMA — davranış/çıktı/yuvarlama sırası DEĞİŞMEDİ).
//
// Sözleşme:
//   - $1 = organizer_id (pay CTE'sinin JOIN filtresi).
//   - Matrah tek-kaynak: contracts.js'ten COMMISSIONABLE_BASE_EXPR (yeniden icat yok).
//   - Çağıran WITH zincirine yerleştirir; sonrası kendi agregasyonu:
//       M2      → cut_date + tarih filtresi + (cut_date, agent) pencere toplamı.
//       payout  → agent bazında SUM(slice_raw), tek final ROUND, tarih filtresiz.
//   - sliced çıktısı `slice_raw` HAM'dır (yuvarlanmaz); NULL slice → çağıran süzer.
// ----------------------------------------------------------------------------
const { COMMISSIONABLE_BASE_EXPR } = require('../routes/contracts');

const SLICE_CTES = `      pay AS (
        SELECT
          p.id AS payment_id, p.contract_id, p.payment_date, p.amount_eur, p.reverses_payment_id,
          c.af_number, c.status AS contract_status, c.revenue_eur, c.exchange_rate,
          c.agent_sales_agent_id, c.sr_sales_agent_id, c.sd_sales_agent_id,
          c.agent_pct, c.sr_pct, c.sd_pct,
          (SELECT ${COMMISSIONABLE_BASE_EXPR}
             FROM contract_line_items li WHERE li.contract_id = c.id) AS base,
          SUM(p.amount_eur) OVER (
            PARTITION BY p.contract_id ORDER BY p.payment_date, p.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_after
        FROM payments p
        JOIN contracts c ON c.id = p.contract_id AND c.organizer_id = $1
      ),
      eff AS (
        SELECT pay.*,
          LEAST(cum_after, revenue_eur)
            - LEAST(cum_after - amount_eur, revenue_eur) AS effective_pay,
          (cum_after > revenue_eur OR (cum_after - amount_eur) > revenue_eur) AS capped,
          (reverses_payment_id IS NOT NULL) AS reversal,
          CASE WHEN EXTRACT(DAY FROM payment_date) <= 15
               THEN date_trunc('month', payment_date)::date + 14
               ELSE (date_trunc('month', payment_date) + interval '1 month')::date - 1
          END AS cut_date,
          (EXTRACT(DAY FROM payment_date) <= 15) AS first_half
        FROM pay
        WHERE revenue_eur IS NOT NULL AND revenue_eur <> 0 AND base IS NOT NULL
      ),
      sliced AS (
        SELECT
          e.cut_date, e.first_half, e.contract_id, e.af_number, e.contract_status,
          e.payment_id, e.payment_date, e.amount_eur, e.capped, e.reversal,
          r.role, r.sales_agent_id, sa.name AS agent_name,
          -- pot_eur × effective_pay / revenue_eur ; pot_eur = base × pct/100 × exchange_rate.
          -- pct: override > default (sd → default_director_pct, diğer → default_commission_pct).
          -- HAM (yuvarlanmaz); NULL pct/exchange_rate → slice_raw NULL → dışlanır.
          ( e.base
            * COALESCE(r.override_pct,
                       CASE WHEN r.role = 'sd' THEN sa.default_director_pct
                            ELSE sa.default_commission_pct END) / 100
            * e.exchange_rate
            * e.effective_pay / e.revenue_eur ) AS slice_raw
        FROM eff e
        CROSS JOIN LATERAL (VALUES
           ('agent', e.agent_sales_agent_id, e.agent_pct),
           ('sr',    e.sr_sales_agent_id,    e.sr_pct),
           ('sd',    e.sd_sales_agent_id,    e.sd_pct)
        ) AS r(role, sales_agent_id, override_pct)
        JOIN sales_agents sa ON sa.id = r.sales_agent_id
        WHERE r.sales_agent_id IS NOT NULL
      )`;

module.exports = { SLICE_CTES };
