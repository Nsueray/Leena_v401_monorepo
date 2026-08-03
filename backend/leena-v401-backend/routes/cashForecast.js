// Bu dosyadaki kural etiketleri KALICI kütük ID'leridir (ELL_LOCKED_KARARLAR_OZET.md).
// Tahsis YALNIZ kütükte yapılır; burada yalnız atıf var. İlgili gruplar:
//   RAP-01/02/03 (raporlama) · PLN-05/06/07/09/10/11 (vade planı) · OFS-06 (ofis).
// PS3-B dilimi geçici sayısal etiketler kullanmıştı; 2026-07-31'de kalıcı ID'lere çevrildi.
// ----------------------------------------------------------------------------
// GET /api/cash-forecast — Nakit öngörü raporu (PS3-B): ofis × vade, EUR.
// Tamamen TÜRETİLMİŞ (D2/S-11r) — migration YOK, saklama YOK. Tüm aritmetik
// SQL'de; JS'te round/toplama YOK (D2). Komisyon motoruna DOKUNULMAZ.
//
// MODEL (kilit — Sentez + DÜZELTME turu):
//  - PLN-05 Aktif plan = superseded_at IS NULL. MAX(revision) aktif seçmez.
//  - PLN-09 EUR çevrimi: plan_eur = amount × contracts.exchange_rate (kontratın KENDİ
//    kilitli kuru). Ö0b: exchange_rate nullable → NULL kur çevrilemez, DIŞLANIR +
//    contracts_unconvertible sayacında GÖRÜNÜR.
//  - PLN-10 Tahsilat düşümü: Σpayments.amount_eur (NET, reversal dahil, status filtresi
//    YOK) aktif satırlara due_date ASC, item_no ASC teleskopuyla düşülür
//    (commissionSlices effective_pay deseni; ikinci formül YOK). remaining < 0 olmaz.
//    FAZLA tahsilat = GREATEST(paid−Σplan,0) kontrat satırında ayrı sütun.
//    ⚠️ Hangi taksitin kapandığı KAYITLI DEĞİL (S-6) → sıra VARSAYIM; toplam kalan
//    doğru, ay dağılımı varsayıma dayalı (ekran dipnotu zorunlu).
//  - DÜZELTME 1: DEFAULT tarih filtresi YOK — from/to verilmezse TÜM aktif satırlar
//    gelir (vadesi geçmiş + kalanı>0 satır gizlenmez; OFS-06 gizleme yasağı). from/to
//    verilirse due_date aralığı uygulanır.
//  - PLN-11 OVERDUE (satır bayrağı, ayrı üst grup DEĞİL — eksen OFİS kalır):
//    is_overdue = (due_date < CURRENT_DATE AND remaining > 0). remaining=0 geçmiş
//    satır OVERDUE değildir ama gizlenmez. Ofis/grand toplamı overdue+upcoming'e
//    AYRILIR; total (mevcut alan) korunur = ikisinin toplamı.
//  - RAP-03 Dışlama (KARA LİSTE, beyaz DEĞİL): Transferred + Cancelled + On Hold girmez
//    (Ö0a). Bugün fiilen "yalnız Active" ama 5. statü eklenirse otomatik görünür.
//  - RAP-02 On Hold DIŞLANIR AMA SAYILIR: contracts_on_hold + on_hold_excluded_eur
//    (aynı PLN-09/PLN-10 mantığıyla kalan). NULL kur On Hold: sayıya girer, EUR toplamına
//    girmez, contracts_unconvertible'da da görünür.
//  - OFS-06 NULL ofis gizlenmez, kendi kovasında ("(No office)"). Ofis TAHMİN edilmez.
//  - RAP-01 Eksen = ofis × vade, toplamlar EUR. Para birimi satır bilgisi.
//  - RAP-02 Plansız kontrat (dışlanmamış statü, aktif satır yok) sayacı görünür.
//  - organizer scope (mimari, çok-kiracı invaryantı): tüm sorgular organizer_id filtreli.
//  - RAP-02 PLANLANMAMIŞ GELİR sayaçları (banner DEĞİŞMEZ — o tarihli planlanmış nakit;
//    bu sayaçlar planlanmamış geliri AYRI gösterir, birleştirilmez):
//      Y without_schedule_revenue_eur = plansız kontratların Σ revenue_eur
//      M/X incomplete_schedule_revenue_eur = planlı ama plan_total_eur<revenue_eur
//         olanların Σ(revenue_eur−plan_total_eur)
//    Y ve X BÖLÜNMEDİR (her kontrat tekinde; E2 ayrıklık). RAP-03 kara listesini uygular.
//    ⚠️ E1 BİLİNÇLİ ASİMETRİ: X yalnız EKSİK planlı (revenue>plan) toplar. FAZLA
//    planlı (plan>revenue) X'e GİRMEZ, X'i AZALTMAZ — netleşme yasak (S-9). Fazla
//    planlı kontrat matches_revenue ⚠ ile görünür. 4. sayaç AÇILMAZ (farklı anomali).
//    ⚠️ NULL KUR: plan_total_eur=amount×exchange_rate; exchange_rate NULL → plan_total
//    NULL → 'revenue>NULL' unknown → kontrat X'e GİREMEZ. KABUL EDİLMİŞ: o kontrat
//    contracts_unconvertible'da görünür. (Plansız kontratın kura ihtiyacı yok; Y
//    revenue_eur'dan doğrudan gelir.)
//    ⚠️ TEŞHİS EKSENİ: contracts_unconvertible + contracts_missing_revenue_eur
//    (revenue_eur IS NULL, yalnız SAYI — tutar bilinmiyor, uydurma EUR yok) X/Y ile
//    ÖRTÜŞEBİLİR; bu tasarım gereği, çifte sayım DEĞİL. Örn: plansız+revenue_eur NULL
//    kontrat → without_schedule sayısına girer, Y'ye 0 katkı, missing_revenue'da görünür.
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

// Ortak CTE bloğu (S-8 emsali). $1=organizer · $2=from (nullable) · $3=to (nullable).
// plan: aktif + çevrilebilir + terminal-olmayan (Transferred/Cancelled dışı) satırlar.
//   On Hold BURADA kalır (RAP-02 kalanını hesaplamak için); ana gruplarda status<>'On Hold'
//   ile elenir. NULL kur burada elenir (Ö0b).
const FORECAST_CTES = `
  WITH params AS (
    SELECT $2::date AS from_date, $3::date AS to_date   -- DÜZELTME 1: default filtre YOK
  ),
  plan AS (
    SELECT s.id, s.contract_id, s.item_no, s.due_date, s.amount, s.currency,
           c.exchange_rate, c.status, c.af_number, c.revenue_eur,
           s.expected_office_id,
           s.amount * c.exchange_rate AS plan_eur      -- PLN-09
      FROM payment_schedule_items s
      JOIN contracts c ON c.id = s.contract_id AND c.organizer_id = $1
     WHERE s.superseded_at IS NULL                     -- PLN-05
       AND c.status NOT IN ('Transferred', 'Cancelled')-- terminal (On Hold hariç: RAP-02)
       AND c.exchange_rate IS NOT NULL                 -- Ö0b
  ),
  -- TAH-04 matched_i: her AKTİF plan kalemine eşleşmiş ödeme toplamı (NET, reversal dahil).
  -- plan JOIN'i eşleşmeyi yalnız AKTİF kaleme sınırlar; superseded kaleme eşleşme buraya GİRMEZ.
  matched AS (
    SELECT p.schedule_item_id AS item_id, SUM(p.amount_eur) AS matched_eur
      FROM payments p
      JOIN plan pl ON pl.id = p.schedule_item_id
     GROUP BY p.schedule_item_id
  ),
  -- TAH-04 U: eşleşmemiş (schedule_item_id IS NULL) + DÜŞMÜŞ (superseded kaleme eşleşmiş,
  -- C8) ödemeler. Teleskoba bunlar döner → matched_active + U = paid_net (C3 korunur).
  unmatched AS (
    SELECT p.contract_id, COALESCE(SUM(p.amount_eur), 0) AS u_eur
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id AND c.organizer_id = $1
     WHERE p.schedule_item_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM payment_schedule_items s
                        WHERE s.id = p.schedule_item_id AND s.superseded_at IS NULL)
     GROUP BY p.contract_id
  ),
  -- Kontrat başına toplam tahsilat (özet için — değişmedi).
  paid AS (
    SELECT p.contract_id, COALESCE(SUM(p.amount_eur), 0) AS paid_net_eur  -- NET
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id AND c.organizer_id = $1
     GROUP BY p.contract_id
  ),
  -- Ö0b cap_i = LEAST(GREATEST(plan − matched, 0), plan) — alt VE üst kırpma.
  -- Üst kırpma: matched NEGATİF (yalnız reversal eşleşmiş) ise cap plan'ı aşmaz.
  capped AS (
    SELECT pl.*,
           COALESCE(m.matched_eur, 0) AS matched_eur,
           LEAST(GREATEST(pl.plan_eur - COALESCE(m.matched_eur, 0), 0), pl.plan_eur) AS cap_eur
      FROM plan pl
      LEFT JOIN matched m ON m.item_id = pl.id
  ),
  -- Teleskop cap ÜZERİNDE çalışır; havuz = U (yalnız eşleşmemiş, çifte sayım yok).
  tele AS (
    SELECT cp.*,
           COALESCE(u.u_eur, 0) AS u_eur,
           COALESCE(pd.paid_net_eur, 0) AS paid_net_eur,
           SUM(cp.cap_eur) OVER (PARTITION BY cp.contract_id
                                 ORDER BY cp.due_date, cp.item_no
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_after,
           SUM(cp.plan_eur) OVER (PARTITION BY cp.contract_id) AS plan_total_eur
      FROM capped cp
      LEFT JOIN unmatched u ON u.contract_id = cp.contract_id
      LEFT JOIN paid pd ON pd.contract_id = cp.contract_id
  ),
  calc AS (
    SELECT t.*,
           LEAST(t.u_eur, t.cum_after)
             - LEAST(t.u_eur, t.cum_after - t.cap_eur) AS covered_eur   -- PLN-10 üst katmanı (C2)
      FROM tele t
  ),
  calc2 AS (
    SELECT c.*,
           (c.cap_eur - c.covered_eur) AS remaining_raw,
           GREATEST(c.matched_eur - c.plan_eur, 0) AS excess_item_eur,   -- kalem aşırı tahsis (A7)
           (c.due_date < CURRENT_DATE AND (c.cap_eur - c.covered_eur) > 0) AS is_overdue  -- PLN-11
      FROM calc c
  ),
  -- RAP-02: kontrat başına tek satır (plan_total_eur pencere değeri satırlarda aynı).
  -- Yalnız çevrilebilir (exchange_rate NOT NULL) kontratlar — NULL kur burada yok.
  ct AS (
    SELECT DISTINCT contract_id, status, plan_total_eur, revenue_eur FROM calc2
  ),
  -- TAH-04/C1: NON-REVERSAL ödemelerin eşleşme durumu (matched aktif / unmatched NULL /
  -- dropped = superseded kaleme, C8). Üç durum tek sayaçta TOPLANMAZ (RAP-02). Kara liste
  -- UYGULANMAZ: contract 1 (Transferred, plansız) ödemeleri de unmatched sayılır (C9).
  paystat AS (
    SELECT p.amount_eur,
           CASE WHEN p.schedule_item_id IS NULL THEN 'unmatched'
                WHEN EXISTS (SELECT 1 FROM payment_schedule_items s
                              WHERE s.id = p.schedule_item_id AND s.superseded_at IS NULL) THEN 'matched'
                ELSE 'dropped' END AS mstatus
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id AND c.organizer_id = $1
     WHERE p.reverses_payment_id IS NULL
  )
`;

// Tarih aralığı opsiyonel (DÜZELTME 1): from/to NULL → sınırsız.
const IN_RANGE = `(p.from_date IS NULL OR c.due_date >= p.from_date)
              AND (p.to_date   IS NULL OR c.due_date <= p.to_date)`;

router.get('/', authMiddleware, async (req, res) => {
  // FAZ 4: finance-read permission kontrolü buraya (commissions emsali).
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
    // (1) Ofis kovaları — aralıktaki, On Hold hariç satırlar; overdue/upcoming ayrımı.
    const officeSql = `${FORECAST_CTES}
      SELECT c.expected_office_id AS office_id, o.name AS office_name,
             ROUND(COALESCE(SUM(c.remaining_raw), 0), 2) AS total_remaining_eur,
             ROUND(COALESCE(SUM(c.remaining_raw) FILTER (WHERE c.is_overdue), 0), 2) AS overdue_remaining_eur,
             ROUND(COALESCE(SUM(c.remaining_raw) FILTER (WHERE NOT c.is_overdue), 0), 2) AS upcoming_remaining_eur
        FROM calc2 c
        LEFT JOIN offices o ON o.id = c.expected_office_id
        CROSS JOIN params p
       WHERE c.status <> 'On Hold' AND ${IN_RANGE}
       GROUP BY c.expected_office_id, o.name
       ORDER BY o.name NULLS LAST`;

    // (2) Satırlar — aralıktaki aktif plan kalemleri, ofis adı + is_overdue.
    const lineSql = `${FORECAST_CTES}
      SELECT c.expected_office_id AS office_id, o.name AS office_name,
             c.contract_id, c.af_number, c.status,
             to_char(c.due_date, 'YYYY-MM-DD') AS due_date,   -- to_char: TZ-güvenli okuma (teknik)
             c.amount, c.currency,
             ROUND(c.plan_eur, 2)        AS amount_eur,
             ROUND(c.matched_eur, 2)     AS matched_eur,     -- TAH-04: kaleme eşleşmiş (NET)
             ROUND(c.covered_eur, 2)     AS covered_eur,     -- teleskop fallback (C1: ayırt et)
             ROUND(c.remaining_raw, 2)   AS remaining_eur,
             ROUND(c.excess_item_eur, 2) AS excess_eur,      -- kalem aşırı tahsis (A7)
             c.is_overdue
        FROM calc2 c
        LEFT JOIN offices o ON o.id = c.expected_office_id
        CROSS JOIN params p
       WHERE c.status <> 'On Hold' AND ${IN_RANGE}
       ORDER BY o.name NULLS LAST, c.is_overdue DESC, c.due_date, c.item_no`;

    // (3) Kontrat özeti — TÜM aktif satırlar (aralık filtresiz), On Hold hariç.
    const contractSql = `${FORECAST_CTES}
      SELECT DISTINCT c.contract_id, c.af_number, c.status,
             ROUND(c.plan_total_eur, 2) AS plan_total_eur,
             c.revenue_eur,
             (ROUND(c.plan_total_eur, 2) = c.revenue_eur) AS matches_revenue,  -- PLN-07
             ROUND(c.paid_net_eur, 2) AS paid_net_eur,
             GREATEST(ROUND(c.paid_net_eur - c.plan_total_eur, 2), 0)::numeric(14,2) AS excess_eur  -- PLN-10
        FROM calc2 c
       WHERE c.status <> 'On Hold'
       ORDER BY c.contract_id`;

    // (4) Grand toplamlar (overdue/upcoming/total) + sayaçlar. Hepsi SUNUCUDA (D2).
    const metaSql = `${FORECAST_CTES}
      SELECT
        (SELECT COALESCE(ROUND(SUM(c.remaining_raw), 2), 0)::numeric(14,2)
           FROM calc2 c CROSS JOIN params p
          WHERE c.status <> 'On Hold' AND ${IN_RANGE}) AS grand_total_remaining_eur,
        (SELECT COALESCE(ROUND(SUM(c.remaining_raw) FILTER (WHERE c.is_overdue), 2), 0)::numeric(14,2)
           FROM calc2 c CROSS JOIN params p
          WHERE c.status <> 'On Hold' AND ${IN_RANGE}) AS grand_overdue_remaining_eur,
        (SELECT COALESCE(ROUND(SUM(c.remaining_raw) FILTER (WHERE NOT c.is_overdue), 2), 0)::numeric(14,2)
           FROM calc2 c CROSS JOIN params p
          WHERE c.status <> 'On Hold' AND ${IN_RANGE}) AS grand_upcoming_remaining_eur,
        (SELECT count(*) FROM contracts c
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled', 'On Hold')
            AND NOT EXISTS (SELECT 1 FROM payment_schedule_items s
                             WHERE s.contract_id = c.id AND s.superseded_at IS NULL)
        ) AS contracts_without_schedule,                                       -- RAP-02
        -- RAP-02 Y: plansız kontratların Σ revenue_eur (NULL revenue_eur SUM'da atlanır → RAP-02 missing sayacı yakalar).
        (SELECT COALESCE(SUM(c.revenue_eur), 0)::numeric(14,2) FROM contracts c
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled', 'On Hold')
            AND NOT EXISTS (SELECT 1 FROM payment_schedule_items s
                             WHERE s.contract_id = c.id AND s.superseded_at IS NULL)
        ) AS without_schedule_revenue_eur,                                     -- RAP-02 (Y)
        -- RAP-02 M/X: planlı ama eksik (plan_total_eur < revenue_eur). E1 asimetri: yalnız EKSİK.
        (SELECT count(*) FROM ct
          WHERE ct.status <> 'On Hold' AND ct.plan_total_eur < ct.revenue_eur
        ) AS contracts_incomplete_schedule,                                    -- RAP-02 (M)
        (SELECT COALESCE(ROUND(SUM(ct.revenue_eur - ct.plan_total_eur), 2), 0)::numeric(14,2) FROM ct
          WHERE ct.status <> 'On Hold' AND ct.plan_total_eur < ct.revenue_eur
        ) AS incomplete_schedule_revenue_eur,                                  -- RAP-02 (X)
        -- RAP-02 Q: revenue_eur IS NULL (yalnız SAYI; tutar bilinmiyor, uydurma EUR yok). Teşhis ekseni, X/Y ile örtüşebilir.
        (SELECT count(*) FROM contracts c
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled', 'On Hold')
            AND c.revenue_eur IS NULL
        ) AS contracts_missing_revenue_eur,                                    -- RAP-02 (Q)
        (SELECT count(DISTINCT c.id) FROM contracts c
           JOIN payment_schedule_items s ON s.contract_id = c.id AND s.superseded_at IS NULL
          WHERE c.organizer_id = $1 AND c.status NOT IN ('Transferred', 'Cancelled')
            AND c.exchange_rate IS NULL
        ) AS contracts_unconvertible,                                          -- Ö0b (On Hold NULL kur dahil)
        (SELECT count(DISTINCT c.id) FROM contracts c
           JOIN payment_schedule_items s ON s.contract_id = c.id AND s.superseded_at IS NULL
          WHERE c.organizer_id = $1 AND c.status = 'On Hold'
        ) AS contracts_on_hold,                                                -- RAP-02
        (SELECT COALESCE(ROUND(SUM(c.remaining_raw), 2), 0)::numeric(14,2)
           FROM calc2 c WHERE c.status = 'On Hold') AS on_hold_excluded_eur,   -- RAP-02
        -- TAH-04 C1: eşleşme durumu sayaçları (non-reversal ödemeler). Üç durum AYRI.
        (SELECT count(*) FROM paystat WHERE mstatus = 'matched')   AS payments_matched,
        (SELECT count(*) FROM paystat WHERE mstatus = 'unmatched') AS payments_unmatched,
        (SELECT count(*) FROM paystat WHERE mstatus = 'dropped')   AS payments_unmatched_after_revision,  -- C8
        (SELECT COALESCE(ROUND(SUM(amount_eur), 2), 0)::numeric(14,2) FROM paystat WHERE mstatus = 'matched')   AS matched_payments_eur,
        (SELECT COALESCE(ROUND(SUM(amount_eur), 2), 0)::numeric(14,2) FROM paystat WHERE mstatus = 'unmatched') AS unmatched_payments_eur,
        (SELECT COALESCE(ROUND(SUM(amount_eur), 2), 0)::numeric(14,2) FROM paystat WHERE mstatus = 'dropped')   AS unmatched_after_revision_eur`;   // C8

    const [offRes, lineRes, conRes, metaRes] = await Promise.all([
      pool.query(officeSql, args),
      pool.query(lineSql, args),
      pool.query(contractSql, args),
      pool.query(metaSql, args),
    ]);

    // Ofis kovalarını kur, satırları içine yerleştir (JS yalnız gruplar — toplamaz).
    const NO_OFFICE = '(No office)';   // OFS-06
    const officeMap = new Map();
    const officeOrder = [];
    for (const r of offRes.rows) {
      const key = r.office_id == null ? 'null' : String(r.office_id);
      const b = {
        office_id: r.office_id,
        office_name: r.office_name || NO_OFFICE,
        total_remaining_eur: r.total_remaining_eur,
        overdue_remaining_eur: r.overdue_remaining_eur,
        upcoming_remaining_eur: r.upcoming_remaining_eur,
        lines: [],
      };
      officeMap.set(key, b);
      officeOrder.push(key);
    }
    for (const r of lineRes.rows) {
      const key = r.office_id == null ? 'null' : String(r.office_id);
      const b = officeMap.get(key);
      if (!b) continue;
      b.lines.push({
        contract_id: r.contract_id, af_number: r.af_number, status: r.status,
        due_date: r.due_date, amount: r.amount, currency: r.currency,
        amount_eur: r.amount_eur, matched_eur: r.matched_eur, covered_eur: r.covered_eur,
        remaining_eur: r.remaining_eur, excess_eur: r.excess_eur, is_overdue: r.is_overdue,
      });
    }
    const offices = officeOrder.map(k => officeMap.get(k));

    const meta = metaRes.rows[0] || {};
    res.json({
      offices,
      contracts: conRes.rows,
      grand_total_remaining_eur: meta.grand_total_remaining_eur ?? 0,
      grand_overdue_remaining_eur: meta.grand_overdue_remaining_eur ?? 0,
      grand_upcoming_remaining_eur: meta.grand_upcoming_remaining_eur ?? 0,
      contracts_without_schedule: Number(meta.contracts_without_schedule ?? 0),
      without_schedule_revenue_eur: meta.without_schedule_revenue_eur ?? 0,          // RAP-02 Y
      contracts_incomplete_schedule: Number(meta.contracts_incomplete_schedule ?? 0), // RAP-02 M
      incomplete_schedule_revenue_eur: meta.incomplete_schedule_revenue_eur ?? 0,     // RAP-02 X
      contracts_missing_revenue_eur: Number(meta.contracts_missing_revenue_eur ?? 0), // RAP-02 Q
      contracts_unconvertible: Number(meta.contracts_unconvertible ?? 0),
      contracts_on_hold: Number(meta.contracts_on_hold ?? 0),
      on_hold_excluded_eur: meta.on_hold_excluded_eur ?? 0,
      // TAH-04 C1/C8: eşleşme durumu sayaçları (non-reversal ödemeler), sıfırken bile görünür.
      payments_matched: Number(meta.payments_matched ?? 0),
      matched_payments_eur: meta.matched_payments_eur ?? 0,
      payments_unmatched: Number(meta.payments_unmatched ?? 0),
      unmatched_payments_eur: meta.unmatched_payments_eur ?? 0,
      payments_unmatched_after_revision: Number(meta.payments_unmatched_after_revision ?? 0),
      unmatched_after_revision_eur: meta.unmatched_after_revision_eur ?? 0,
    });
  } catch (err) {
    console.error('Error building cash forecast:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
