// ----------------------------------------------------------------------------
// GET /api/cash-forecast — Nakit öngörü raporu (PS3-B): ofis × vade, EUR.
// Tamamen TÜRETİLMİŞ (K2/S-11r) — migration YOK, saklama YOK. Tüm aritmetik
// SQL'de; JS'te round/toplama YOK (D2). Komisyon motoruna DOKUNULMAZ.
//
// MODEL (kilit — Sentez):
//  - K3 Aktif plan = superseded_at IS NULL. MAX(revision) aktif seçmez.
//  - K7 EUR çevrimi: plan_eur = amount × contracts.exchange_rate (kontratın KENDİ
//    kilitli kuru; "bugünkü kur" icat edilmez). Plana kolon eklenmez, rapor anında.
//    Ö0b: exchange_rate nullable/korumasız → NULL kur = çevrilemez, DIŞLANIR +
//    contracts_unconvertible sayacında GÖRÜNÜR (sessiz kaybolmaz).
//  - K8 Tahsilat düşümü: Σpayments.amount_eur (NET, reversal dahil, status filtresi
//    YOK) aktif satırlara due_date ASC, eşitlikte item_no ASC teleskopuyla düşülür.
//    effective_pay deseni utils/commissionSlices.js ile BİREBİR aynı (ikinci formül
//    YOK). remaining yapısal olarak < 0 olmaz. FAZLA tahsilat = GREATEST(paid−Σplan,0)
//    kontrat satırında ayrı sütun. ⚠️ Hangi taksitin kapandığı KAYITLI DEĞİL (S-6;
//    payments.schedule_item_id kodda kullanılmıyor) → sıra bir VARSAYIMDIR; toplam
//    kalan doğru, ay dağılımı varsayıma dayalı (ekran dipnotu zorunlu).
//  - K10 Dışlama (kara liste, beyaz liste DEĞİL): Transferred + Cancelled girmez
//    (Ö0a: contracts_status_check). Diğer TÜM statüler girer, statü sütunda görünür.
//  - K1 NULL ofis gizlenmez, kendi kovasında ("(No office)"). Ofis TAHMİN edilmez.
//  - K9 Eksen = ofis × vade, toplamlar EUR. Para birimi satır bilgisi (amount+currency
//    görünür), toplama ekseni değil.
//  - K13 Plansız kontrat (dışlanmamış statü, aktif satır yok) sayacı görünür.
//  - K12 organizer scope: tüm sorgular organizer_id filtreli.
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

// Ortak CTE bloğu (S-8 emsali: tek kaynak, dört sorgu aynı türetimi paylaşır).
// $1 = organizer_id · $2 = from (default bugün) · $3 = to (default açık/NULL).
// Kur-suz/dışlanmış statü/superseded satırlar burada elenir → hesaba hiç girmez.
const FORECAST_CTES = `
  WITH params AS (
    SELECT COALESCE($2::date, CURRENT_DATE) AS from_date,
           $3::date AS to_date
  ),
  plan AS (
    SELECT s.id, s.contract_id, s.item_no, s.due_date, s.amount, s.currency,
           c.exchange_rate, c.status, c.af_number, c.revenue_eur,
           s.expected_office_id,
           s.amount * c.exchange_rate AS plan_eur      -- K7: kontratın kilitli kuru
      FROM payment_schedule_items s
      JOIN contracts c ON c.id = s.contract_id AND c.organizer_id = $1
     WHERE s.superseded_at IS NULL                     -- K3
       AND c.status NOT IN ('Transferred', 'Cancelled')-- K10 (Ö0a)
       AND c.exchange_rate IS NOT NULL                 -- Ö0b: çevrilemez → dışla
  ),
  paid AS (
    SELECT p.contract_id, COALESCE(SUM(p.amount_eur), 0) AS paid_net_eur  -- K8: NET
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id AND c.organizer_id = $1
     GROUP BY p.contract_id
  ),
  tele AS (
    SELECT pl.*,
           COALESCE(pd.paid_net_eur, 0) AS paid_net_eur,
           -- K8 teleskop: kümülatif plan (commissionSlices effective_pay deseni).
           SUM(pl.plan_eur) OVER (PARTITION BY pl.contract_id
                                  ORDER BY pl.due_date, pl.item_no
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_after,
           SUM(pl.plan_eur) OVER (PARTITION BY pl.contract_id) AS plan_total_eur
      FROM plan pl
      LEFT JOIN paid pd ON pd.contract_id = pl.contract_id
  ),
  calc AS (
    SELECT t.*,
           -- covered = LEAST(paid, cum_after) − LEAST(paid, cum_before); < 0 olmaz.
           LEAST(t.paid_net_eur, t.cum_after)
             - LEAST(t.paid_net_eur, t.cum_after - t.plan_eur) AS covered_eur
      FROM tele t
  )
`;

const IN_RANGE = `c.due_date >= p.from_date AND (p.to_date IS NULL OR c.due_date <= p.to_date)`;

router.get('/', authMiddleware, async (req, res) => {
  // FAZ 4: finance-read permission kontrolü buraya (commissions emsali; bugün
  // organizer-scope + geçerli JWT yeterli).
  const from = req.query.from;
  const to = req.query.to;
  if (from != null && from !== '' && !isValidDate(from)) {
    return res.status(400).json({ error: 'from must be a valid YYYY-MM-DD date.' });
  }
  if (to != null && to !== '' && !isValidDate(to)) {
    return res.status(400).json({ error: 'to must be a valid YYYY-MM-DD date.' });
  }
  const args = [
    req.organizer_id,
    from == null || from === '' ? null : from,
    to == null || to === '' ? null : to,
  ];

  try {
    // (1) Ofis kovaları — yalnız aralıktaki satırlar; toplam SUNUCUDA (D2).
    const officeSql = `${FORECAST_CTES}
      SELECT c.expected_office_id AS office_id, o.name AS office_name,
             ROUND(SUM(c.plan_eur - c.covered_eur), 2) AS total_remaining_eur
        FROM calc c
        LEFT JOIN offices o ON o.id = c.expected_office_id
        CROSS JOIN params p
       WHERE ${IN_RANGE}
       GROUP BY c.expected_office_id, o.name
       ORDER BY o.name NULLS LAST`;

    // (2) Satırlar — aralıktaki aktif plan kalemleri, ofis adıyla.
    const lineSql = `${FORECAST_CTES}
      SELECT c.expected_office_id AS office_id, o.name AS office_name,
             c.contract_id, c.af_number, c.status,
             to_char(c.due_date, 'YYYY-MM-DD') AS due_date,   -- K11: TZ-güvenli
             c.amount, c.currency,
             ROUND(c.plan_eur, 2)                 AS amount_eur,
             ROUND(c.covered_eur, 2)              AS covered_eur,
             ROUND(c.plan_eur - c.covered_eur, 2) AS remaining_eur
        FROM calc c
        LEFT JOIN offices o ON o.id = c.expected_office_id
        CROSS JOIN params p
       WHERE ${IN_RANGE}
       ORDER BY o.name NULLS LAST, c.due_date, c.item_no`;

    // (3) Kontrat özeti — TÜM aktif satırlar (aralık filtresiz; bütün-kontrat).
    const contractSql = `${FORECAST_CTES}
      SELECT DISTINCT c.contract_id, c.af_number, c.status,
             ROUND(c.plan_total_eur, 2) AS plan_total_eur,
             c.revenue_eur,
             (ROUND(c.plan_total_eur, 2) = c.revenue_eur) AS matches_revenue,  -- K4
             ROUND(c.paid_net_eur, 2) AS paid_net_eur,
             GREATEST(ROUND(c.paid_net_eur - c.plan_total_eur, 2), 0)::numeric(14,2) AS excess_eur  -- K8
        FROM calc c
       ORDER BY c.contract_id`;

    // (4) Grand total (aralık) + sayaçlar. Hepsi SUNUCUDA (D2).
    const metaSql = `${FORECAST_CTES}
      SELECT
        (SELECT COALESCE(ROUND(SUM(c.plan_eur - c.covered_eur), 2), 0)
           FROM calc c CROSS JOIN params p WHERE ${IN_RANGE}) AS grand_total_remaining_eur,
        (SELECT count(*) FROM contracts c
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled')
            AND NOT EXISTS (SELECT 1 FROM payment_schedule_items s
                             WHERE s.contract_id = c.id AND s.superseded_at IS NULL)
        ) AS contracts_without_schedule,                                       -- K13
        (SELECT count(DISTINCT c.id) FROM contracts c
           JOIN payment_schedule_items s ON s.contract_id = c.id AND s.superseded_at IS NULL
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled')
            AND c.exchange_rate IS NULL
        ) AS contracts_unconvertible`;                                         // Ö0b

    const [offRes, lineRes, conRes, metaRes] = await Promise.all([
      pool.query(officeSql, args),
      pool.query(lineSql, args),
      pool.query(contractSql, args),
      pool.query(metaSql, args),
    ]);

    // Ofis kovalarını kur, satırları içine yerleştir (JS yalnız gruplar — toplamaz).
    const NO_OFFICE = '(No office)';   // K1
    const officeMap = new Map();
    const officeOrder = [];
    for (const r of offRes.rows) {
      const key = r.office_id == null ? 'null' : String(r.office_id);
      const bucket = {
        office_id: r.office_id,
        office_name: r.office_name || NO_OFFICE,
        total_remaining_eur: r.total_remaining_eur,
        lines: [],
      };
      officeMap.set(key, bucket);
      officeOrder.push(key);
    }
    for (const r of lineRes.rows) {
      const key = r.office_id == null ? 'null' : String(r.office_id);
      const bucket = officeMap.get(key);
      if (!bucket) continue;  // aralık filtreleri aynı → oluşmaması beklenmez
      bucket.lines.push({
        contract_id: r.contract_id, af_number: r.af_number, status: r.status,
        due_date: r.due_date, amount: r.amount, currency: r.currency,
        amount_eur: r.amount_eur, covered_eur: r.covered_eur, remaining_eur: r.remaining_eur,
      });
    }
    const offices = officeOrder.map(k => officeMap.get(k));

    const meta = metaRes.rows[0] || {};
    res.json({
      offices,
      contracts: conRes.rows,
      grand_total_remaining_eur: meta.grand_total_remaining_eur ?? 0,
      contracts_without_schedule: Number(meta.contracts_without_schedule ?? 0),
      contracts_unconvertible: Number(meta.contracts_unconvertible ?? 0),
    });
  } catch (err) {
    console.error('Error building cash forecast:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
