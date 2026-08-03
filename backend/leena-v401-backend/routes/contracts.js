// ============================================================================
// routes/contracts.js — LEENA Finance: convert endpoint (Slice 2)
// ----------------------------------------------------------------------------
// LIFFY signed quote (payload) → LEENA contract (INSERT).
//
// Tasarım kararları (paper trail):
//   - Payload-driven: cross-system fetch YOK (transport LIFFY aktivasyonuna
//     ertelendi). Convert eden taraf quote verisini body'de gönderir.
//   - No-recompute (ELIZA dersi): af_number/revenue/eur quote'tan OKUNUR, yeniden
//     hesaplanmaz. LIFFY GET /quotes/:id enrichQuote bunları zaten verir.
//   - Atomik tx: partners.js:61-104 deseni birebir (pool.connect/BEGIN/COMMIT/
//     ROLLBACK/finally release).
//   - Idempotency (ELIZA 027 dersi): source_quote_id partial UNIQUE index → aynı
//     quote ikinci kez convert edilirse 23505 → 409.
//   - Scope: organizer_id JWT'den (authMiddleware). Role-gate Faz 4'e ertelendi
//     (single-tenant, sadece iç ekip; user_permissions matrisi B21-B42 Faz 4'te).
//   - Bu dilimde NULL kalan: expo_id (Convert-1 dilimi), komisyon agent/sr/sd
//     (assignment endpoint'i doldurur), audit created_by/converted_by/converted_at
//     (Faz 4 kimlik).
// ============================================================================

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// LEENA contracts.status whitelist (migration 012 CHECK ile aynı — convert 'Active' yazar)
const CONTRACT_STATUSES = ['Active', 'On Hold', 'Transferred', 'Cancelled'];

// 23505 (unique) / 23503 (fk) / 23514 (check) → anlamlı HTTP yanıtı (expos.js mapWriteError deseni)
function mapWriteError(err) {
  if (err.code === '23505') {
    // source_quote_id partial UNIQUE → aynı quote zaten convert edilmiş
    if (err.constraint === 'idx_contracts_source_quote_id') {
      return { status: 409, body: { error: 'This quote has already been converted to a contract.' } };
    }
    // 018 partial UNIQUE → bir ödeme yalnız bir kez terslenebilir.
    // Yarış koşulunda 409 garantisi buradan gelir (DB seviyesi).
    if (err.constraint === 'uq_payments_reverses_payment_id') {
      return { status: 409, body: { error: 'Payment already reversed.' } };
    }
    // 019 partial UNIQUE → bir contract'ın en fazla bir devamı olur.
    if (err.constraint === 'uq_contracts_transferred_from') {
      return { status: 409, body: { error: 'Contract already transferred.' } };
    }
    // 019 partial UNIQUE → üretilen transfer af_number'ı çakıştı.
    if (err.constraint === 'uq_contracts_af_number') {
      return { status: 409, body: { error: 'Contract already transferred.' } };
    }
    return { status: 409, body: { error: 'Duplicate value violates a unique constraint.' } };
  }
  if (err.code === '23503') {
    return { status: 400, body: { error: 'Referenced record does not exist.' } };
  }
  if (err.code === '23514') {
    return { status: 400, body: { error: 'A value violates a database check constraint.' } };
  }
  return null; // bilinmeyen → caller 500 döner
}

// ----------------------------------------------------------------------------
// POST /api/contracts/convert
// Body (LIFFY signed quote payload — convert eden taraf gönderir):
//   {
//     quote_id:            UUID   (zorunlu)  → source_quote_id
//     status:              string (zorunlu)  → 'signed' olmalı
//     af_number:           string (zorunlu)  → quote'tan, no-recompute
//     company_name:        string (ops.)
//     revenue:             number (ops.)     → orijinal currency tutarı
//     currency:            string (ops.)     → ISO 4217
//     exchange_rate:       number (ops.)     → dondurulmuş kur
//     revenue_eur:         number (ops.)     → dondurulmuş EUR
//     contract_date:       date   (ops.)     → yoksa today
//     sales_owner_user_id: UUID   (ops.)     → LIFFY soft-ref
//     company_id:          UUID   (ops.)     → LIFFY soft-ref
//   }
// ----------------------------------------------------------------------------
router.post('/convert', authMiddleware, async (req, res) => {
  const b = req.body || {};
  const organizer_id = req.organizer_id;

  // FAZ 4: convert-permission kontrolü buraya (user_permissions matrisi B21-B42
  // aktif olunca — "kim convert eder" Owner'ın atadığı permission). Bugün
  // organizer-scope + geçerli JWT yeterli güvenlik sınırı (single-tenant, iç ekip).

  // --- Guard 1: zorunlu alanlar (manuel if-check, partners.js deseni) ---
  if (!b.quote_id) {
    return res.status(400).json({ error: 'quote_id is required.' });
  }
  if (!b.af_number) {
    return res.status(400).json({ error: 'af_number is required.' });
  }

  // --- Guard 2: quote signed olmalı (no-recompute — status payload'dan okunur) ---
  if (b.status !== 'signed') {
    return res.status(400).json({ error: 'Only a signed quote can be converted to a contract.' });
  }

  // --- Guard 3: line_items (opsiyonel, L3/L4) ---
  // YOKSA veya [] boşsa: satırsız contract (bugünkü davranış birebir korunur).
  // VARSA: her eleman doğrulanır; line_no + currency server tarafından yazılır.
  const rawItems = Array.isArray(b.line_items) ? b.line_items : [];
  if (b.line_items !== undefined && !Array.isArray(b.line_items)) {
    return res.status(400).json({ error: 'line_items must be an array.' });
  }
  const items = [];
  if (rawItems.length > 0) {
    // Satır varken contract currency zorunlu (server her satıra kopyalar; NOT NULL).
    if (!b.currency) {
      return res.status(400).json({ error: 'currency is required when line_items are present.' });
    }
    for (let i = 0; i < rawItems.length; i++) {
      const li = rawItems[i] || {};
      const n = i + 1; // line_no server atar (1'den)
      if (typeof li.description !== 'string' || li.description.trim() === '') {
        return res.status(400).json({ error: `line_items[${n}].description is required.` });
      }
      const qty = Number(li.quantity);
      if (li.quantity == null || !isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: `line_items[${n}].quantity must be a number greater than 0.` });
      }
      const price = Number(li.unit_price);
      if (li.unit_price == null || !isFinite(price) || price < 0) {
        return res.status(400).json({ error: `line_items[${n}].unit_price must be a number >= 0.` });
      }
      let disc = 0;
      if (li.discount_percent != null && li.discount_percent !== '') {
        disc = Number(li.discount_percent);
        if (!isFinite(disc) || disc < 0 || disc > 100) {
          return res.status(400).json({ error: `line_items[${n}].discount_percent must be between 0 and 100.` });
        }
      }
      const is_rf = li.is_registration_fee === true;
      // Satır toplamı — round2 yalnız pozitif girdilerle (ev kuralı; hepsi >=0).
      const line_total = round2(qty * price * (1 - disc / 100));
      items.push({ line_no: n, product_code: li.product_code || null,
                   description: li.description.trim(), quantity: qty, unit_price: price,
                   discount_percent: disc, is_registration_fee: is_rf, line_total });
    }

    // --- L4: grand_total ↔ revenue toleransı (INSERT'lerden ÖNCE) ---
    // grand_total tüm kalemleri kapsar (RF satırlar DAHİL — revenue hepsini içerir).
    const grand_total = round2(items.reduce((s, it) => s + it.line_total, 0));
    const revenue = Number(b.revenue);
    if (b.revenue == null || !isFinite(revenue)) {
      return res.status(400).json({ error: 'revenue is required (numeric) when line_items are present.' });
    }
    if (Math.abs(grand_total - revenue) > 0.01) {
      return res.status(400).json({
        error: `line_items total (${grand_total.toFixed(2)}) does not match revenue (${revenue.toFixed(2)}).`
      });
    }
  }

  // contract_date: payload'dan (signed_at) ya da bugün
  const contract_date = b.contract_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO contracts (
         organizer_id,
         af_number,
         company_name,
         contract_date,
         revenue,
         currency,
         exchange_rate,
         revenue_eur,
         status,
         source_quote_id,
         sales_owner_user_id,
         company_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        organizer_id,
        b.af_number,
        b.company_name || null,
        contract_date,
        b.revenue != null ? b.revenue : null,
        b.currency || null,
        b.exchange_rate != null ? b.exchange_rate : null,
        b.revenue_eur != null ? b.revenue_eur : null,
        'Active',                         // contract doğduğu an Active (no Draft)
        b.quote_id,                       // source_quote_id (idempotency anahtarı)
        b.sales_owner_user_id || null,    // LIFFY soft-ref
        b.company_id || null,             // LIFFY soft-ref
        // expo_id, komisyon agent/sr/sd, audit → bu dilimde NULL (sonraki dilimler)
      ]
    );
    const newContract = result.rows[0];

    // Satır INSERT'leri AYNI transaction'da — kısmi yazma imkânsız (atomik).
    // currency server tarafından contract'tan kopyalanır; CHECK ihlalleri (23514)
    // mapWriteError → 400 (aşağıdaki catch).
    for (const it of items) {
      await client.query(
        `INSERT INTO contract_line_items
           (contract_id, line_no, product_code, description, quantity,
            unit_price, discount_percent, is_registration_fee, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newContract.id, it.line_no, it.product_code, it.description, it.quantity,
         it.unit_price, it.discount_percent, it.is_registration_fee, b.currency]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ contract: newContract });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Contract convert failed:', err);
    return res.status(500).json({ error: 'Failed to convert quote to contract.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// GET /api/contracts
// Liste — organizer_id scope zorunlu, filtreler opsiyonel (expos.js:52-80 deseni).
// Liste YALIN kalır: türev alan (total_m2, paid vb.) burada hesaplanmaz.
// ----------------------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  const { expo_id, status } = req.query;

  const conditions = ['c.organizer_id = $1'];
  const values = [req.organizer_id];
  let p = 2;

  if (expo_id) { conditions.push(`c.expo_id = $${p++}`); values.push(expo_id); }
  if (status)  { conditions.push(`c.status = $${p++}`);  values.push(status); }

  try {
    const result = await pool.query(
      `SELECT c.id, c.af_number, c.company_name, c.contract_date, c.status,
              c.revenue, c.currency, c.revenue_eur,
              c.expo_id, e.name AS expo_name,
              c.sqm, c.sales_group, c.created_at,
              -- D2: paid/balance HESAPLANIR, saklanmaz. revenue_eur NULL ise
              -- balance_eur de NULL (uydurma 0 yok).
              p.paid_eur,
              CASE WHEN c.revenue_eur IS NULL THEN NULL
                   ELSE c.revenue_eur - p.paid_eur END AS balance_eur
         FROM contracts c
         LEFT JOIN expos e ON e.id = c.expo_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pm.amount_eur), 0)::numeric(14,2) AS paid_eur
             FROM payments pm
            WHERE pm.contract_id = c.id
         ) p ON TRUE
        WHERE ${conditions.join(' AND ')}
        ORDER BY c.contract_date DESC NULLS LAST, c.id DESC`,
      values
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching contracts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// GET /api/contracts/:id
// Detay — contracts.* + expo adı + üçlü komisyon agent adları + transfer zinciri.
// ----------------------------------------------------------------------------
// contractDetailSql: assignment PUT dönüşü de aynı join'li şekli verir.
const CONTRACT_DETAIL_SQL =
      `SELECT c.*,
              e.name   AS expo_name,
              -- Üçlü komisyon atfı (3b): agent / sr / sd.
              ag.name  AS agent_name,
              sr.name  AS sr_name,
              sd.name  AS sd_name,
              -- Transfer zinciri (3a-5): ham id yerine af_number gösterilir.
              tf.af_number AS transferred_from_af,
              tt.id        AS transferred_to_id,
              tt.af_number AS transferred_to_af,
              -- D2: paid/balance HESAPLANIR, saklanmaz.
              p.paid_eur,
              CASE WHEN c.revenue_eur IS NULL THEN NULL
                   ELSE c.revenue_eur - p.paid_eur END AS balance_eur
         FROM contracts c
         LEFT JOIN expos e          ON e.id  = c.expo_id
         LEFT JOIN sales_agents ag  ON ag.id = c.agent_sales_agent_id
         LEFT JOIN sales_agents sr  ON sr.id = c.sr_sales_agent_id
         LEFT JOIN sales_agents sd  ON sd.id = c.sd_sales_agent_id
         LEFT JOIN contracts tf     ON tf.id = c.transferred_from_contract_id
         -- uq_contracts_transferred_from sayesinde en fazla 1 satır → çoğalma yok
         LEFT JOIN contracts tt     ON tt.transferred_from_contract_id = c.id`;

// ----------------------------------------------------------------------------
// KOMİSYON MOTORU SABİTLERİ (M1) — tek-kaynak SQL ifadeleri
// ----------------------------------------------------------------------------
// Matrah (K7b): RF-hariç satır toplamı. GET /:id'deki commissionable_base ile
// AYNI ifade (yeniden icat yok).
const COMMISSIONABLE_BASE_EXPR =
  `SUM(ROUND(quantity * unit_price * (1 - discount_percent / 100), 2))
     FILTER (WHERE is_registration_fee = false)`;

// DİLİM ifadesi (M-c) — ödeme başına ham komisyon dilimi (YUVARLANMAZ, M-e):
//   pot_eur × amount_eur / revenue_eur
// Reversal, payments'ta NEGATİF amount_eur satırıyla temsil edilir (018 storno)
// → negatif dilim; SUM kendiliğinden netler (K7d), özel kod yok.
// ⚠️ TEK-KAYNAK: M2 kesim raporu bu ifadeyi PENCEREYLE (kümülatif-marjinal)
// kullanır; M1 contract görünümü ise ratio yolu (tavan LEAST) kullanır —
// overpayment'ta ikisi ayrışır (M-d tavan yalnız kesip atar). Bkz. computeCommission.
const SLICE_EUR_EXPR =
  `(pot_eur * pm.amount_eur / NULLIF(ctx.revenue_eur, 0))`;

// computeCommission — contract görünümü (M1). Tüm aritmetik SQL'de; JS round2
// komisyon için HİÇ çağrılmaz (M-e). base VAR (satır var) varsayımıyla çağrılır.
async function computeCommission(contractId, organizerId) {
  // Meta: base + paid_eur + ratio (M-d tavan) + overpayment (L4 toleransı).
  const meta = await pool.query(
    `SELECT
        (SELECT ${COMMISSIONABLE_BASE_EXPR}
           FROM contract_line_items WHERE contract_id = c.id) AS base,
        COALESCE((SELECT SUM(amount_eur) FROM payments WHERE contract_id = c.id), 0)::numeric AS paid_eur,
        c.revenue_eur,
        CASE WHEN c.revenue_eur IS NULL OR c.revenue_eur = 0 THEN NULL
             ELSE LEAST(COALESCE((SELECT SUM(amount_eur) FROM payments WHERE contract_id = c.id), 0)
                        / c.revenue_eur, 1) END AS ratio,
        (c.revenue_eur IS NOT NULL
          AND COALESCE((SELECT SUM(amount_eur) FROM payments WHERE contract_id = c.id), 0)
              - c.revenue_eur > 0.01) AS overpayment
       FROM contracts c
      WHERE c.id = $1 AND c.organizer_id = $2`,
    [contractId, organizerId]
  );
  const m = meta.rows[0];

  // Roller (agent XOR sr, sd). Oran çözümü (M-b): override > default; SD default
  // = default_director_pct, agent/sr default = default_commission_pct.
  // SD HÜKMÜ (kilitli): bağımsız, aynı matrah (sd_pct/100 × base). Kademeli değil.
  // pot = pct/100 × base [contract parası] · pot_eur = pot × exchange_rate [donmuş kur].
  // earned = ROUND(pot × ratio, 2) · earned_eur = ROUND(pot_eur × ratio, 2) [tek final ROUND, M-e].
  const roles = await pool.query(
    `WITH ctx AS (
       SELECT c.revenue_eur, c.exchange_rate,
              (SELECT ${COMMISSIONABLE_BASE_EXPR}
                 FROM contract_line_items WHERE contract_id = c.id) AS base,
              CASE WHEN c.revenue_eur IS NULL OR c.revenue_eur = 0 THEN NULL
                   ELSE LEAST(COALESCE((SELECT SUM(amount_eur) FROM payments WHERE contract_id = c.id), 0)
                              / c.revenue_eur, 1) END AS ratio,
              c.agent_sales_agent_id, c.sr_sales_agent_id, c.sd_sales_agent_id,
              c.agent_pct, c.sr_pct, c.sd_pct
         FROM contracts c
        WHERE c.id = $1 AND c.organizer_id = $2
     ),
     r AS (
       SELECT 'agent' AS role, 1 AS ord, agent_sales_agent_id AS fk, agent_pct AS override_pct FROM ctx
       UNION ALL SELECT 'sr', 2, sr_sales_agent_id, sr_pct FROM ctx
       UNION ALL SELECT 'sd', 3, sd_sales_agent_id, sd_pct FROM ctx
     ),
     resolved AS (
       SELECT r.role, r.ord, r.fk AS sales_agent_id, sa.name AS agent_name,
              r.override_pct,
              CASE WHEN r.role = 'sd' THEN sa.default_director_pct ELSE sa.default_commission_pct END AS default_pct
         FROM r LEFT JOIN sales_agents sa ON sa.id = r.fk
        WHERE r.fk IS NOT NULL
     ),
     computed AS (
       SELECT res.role, res.ord, res.sales_agent_id, res.agent_name,
              COALESCE(res.override_pct, res.default_pct) AS pct_used,
              CASE WHEN res.override_pct IS NOT NULL THEN 'override'
                   WHEN res.default_pct IS NOT NULL THEN 'default'
                   ELSE NULL END AS pct_source,
              -- pot (contract parası); pct_used NULL → NULL (rate missing)
              CASE WHEN COALESCE(res.override_pct, res.default_pct) IS NULL THEN NULL
                   ELSE COALESCE(res.override_pct, res.default_pct) / 100 * ctx.base END AS pot,
              ctx.exchange_rate, ctx.ratio, ctx.revenue_eur
         FROM resolved res CROSS JOIN ctx
     )
     SELECT role, sales_agent_id, agent_name, pct_used, pct_source,
            ROUND(pot, 2) AS full,
            CASE WHEN exchange_rate IS NULL OR pot IS NULL THEN NULL
                 ELSE ROUND(pot * exchange_rate, 2) END AS full_eur,
            -- earned: ratio NULL (revenue_eur missing) veya pot NULL → NULL
            CASE WHEN ratio IS NULL OR pot IS NULL THEN NULL
                 ELSE ROUND(pot * ratio, 2) END AS earned,
            CASE WHEN ratio IS NULL OR pot IS NULL OR exchange_rate IS NULL THEN NULL
                 ELSE ROUND(pot * exchange_rate * ratio, 2) END AS earned_eur,
            CASE WHEN pct_used IS NULL THEN 'rate missing'
                 WHEN revenue_eur IS NULL OR revenue_eur = 0 THEN 'revenue missing'
                 ELSE NULL END AS reason
       FROM computed
      ORDER BY ord`,
    [contractId, organizerId]
  );

  return {
    base: m.base,
    ratio: m.ratio,
    ...(m.overpayment ? { overpayment: true } : {}),
    roles: roles.rows.map(r => {
      const row = {
        role: r.role, sales_agent_id: r.sales_agent_id, agent_name: r.agent_name,
        pct_used: r.pct_used, pct_source: r.pct_source,
        full: r.full, full_eur: r.full_eur, earned: r.earned, earned_eur: r.earned_eur,
      };
      if (r.reason) row.reason = r.reason;
      return row;
    }),
  };
}

router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      CONTRACT_DETAIL_SQL + `
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pm.amount_eur), 0)::numeric(14,2) AS paid_eur
             FROM payments pm
            WHERE pm.contract_id = c.id
         ) p ON TRUE
        WHERE c.id = $1 AND c.organizer_id = $2`,
      [id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    const contract = result.rows[0];

    // Satır kalemleri (L1) — ORDER BY line_no. CONTRACT_DETAIL_SQL paylaşımlı
    // (assignment da kullanıyor) olduğu için ayrı sorgu; hesap yine SQL'de (D2).
    const li = await pool.query(
      `SELECT id, line_no, product_code, description, quantity, unit_price,
              discount_percent, is_registration_fee, currency
         FROM contract_line_items
        WHERE contract_id = $1
        ORDER BY line_no`,
      [id]
    );
    contract.line_items = li.rows;

    // commissionable_base (K7b) — türetilmiş, SAKLANMAZ (D2). RF satırlar hariç.
    // Satır hiç yoksa: null + reason (yalnız bu durumda reason alanı eklenir).
    if (li.rows.length === 0) {
      contract.commissionable_base = null;
      contract.commissionable_base_reason = 'line items missing';
      contract.commission = null;
      contract.commission_reason = 'line items missing';
    } else {
      const base = await pool.query(
        `SELECT ${COMMISSIONABLE_BASE_EXPR} AS commissionable_base
           FROM contract_line_items
          WHERE contract_id = $1`,
        [id]
      );
      // Yalnız RF satırları varsa FILTER boş → NULL; COALESCE ile 0.00'a çekilmez
      // (kalem VAR ama komisyona konu tutar 0 olabilir → 0.00 döndür).
      const cb = base.rows[0].commissionable_base;
      contract.commissionable_base = cb == null ? '0.00' : cb;

      // KOMİSYON MOTORU (M1, K7 + Sentez M-a..e) — türetilmiş, SAKLANMAZ (D2).
      contract.commission = await computeCommission(id, req.organizer_id);
    }

    res.json(contract);
  } catch (err) {
    console.error('Error fetching contract:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// PUT /api/contracts/:id/status
// Tek alan güncelleme (expos.js:500-515 deseni).
//
// Geçiş matrisi hâlâ YOK, tek istisna 'Transferred' (3a-5):
//   - Transferred'A elle geçiş KAPALI — o durumu yalnız Transfer aksiyonu
//     yazar (aksi hâlde devamı olmayan "transfer edilmiş" contract oluşurdu).
//   - Transferred'DAN çıkış SERBEST — hatalı transferin kaçış kapısı;
//     transfer geri alma (undo) yok, durum elle düzeltilebilir kalmalı.
// ----------------------------------------------------------------------------
router.put('/:id/status', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const status = req.body && req.body.status;

  // FAZ 4: status-change permission kontrolü buraya (user_permissions matrisi
  // B21-B42 aktif olunca). Bugün organizer-scope + geçerli JWT yeterli.

  // Uygulama whitelist'i — DB CHECK'e düşürmek yerine burada 400 döner
  // (CHECK ihlali 23514 → mapWriteError'da da 400, ama mesajı jenerik olurdu).
  if (!CONTRACT_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${CONTRACT_STATUSES.join(', ')}`
    });
  }

  // 'Transferred'ı yalnız Transfer aksiyonu yazar (yukarıdaki nota bak).
  if (status === 'Transferred') {
    return res.status(400).json({
      error: 'Use the Transfer action to mark a contract as Transferred.'
    });
  }

  try {
    const result = await pool.query(
      `UPDATE contracts
          SET status = $1, updated_at = NOW()
        WHERE id = $2 AND organizer_id = $3
        RETURNING id, status`,
      [status, id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    res.json({ message: 'Contract status updated', contract: result.rows[0] });
  } catch (err) {
    console.error('Error updating contract status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// PAYMENTS (Faz 3a-2) — fiili tahsilat kayıtları
// ----------------------------------------------------------------------------
// Model (req :1002): "each actual payment event is one Revenue record,
// attributed to the originating contract" — bir contract çok ödeme alır.
// D2 (req :1004, :519, :1543): contract'ın toplam tahsilatı payments'ın
// SUM'ıdır; contracts'a denormalize alan YAZILMAZ.
//
// ⚠️ amount_eur FORMÜLÜ: convert endpoint'i revenue_eur'u HESAPLAMAZ — quote
// payload'ından okur (no-recompute, :9-10 / :116). Bu yüzden yön oradan
// alınamadı; üç bağımsız kaynaktan doğrulandı:
//   1. LIFFY quotes.js computeTotals: grand_total_eur = round2(total * rate)
//   2. Defter :992 — "EUR-equivalent = toplam × donmuş kur"
//   3. Canlı contract id=1: 15000 USD × 0.92 = 13800 EUR
// → amount_eur = round2(amount × exchange_rate). Client'tan gelen amount_eur
//   YOK SAYILIR (server otoritesi).
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];

// LIFFY quotes.js:71-73 ile aynı yuvarlama
function round2(n) {
  return Math.round(n * 100) / 100;
}

// YYYY-MM-DD + takvimde gerçekten var olan gün (2026-02-31 reddedilir)
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ----------------------------------------------------------------------------
// POST /api/contracts/:id/payments
// Body: amount, currency, exchange_rate, payment_method, payment_date, notes?
// ----------------------------------------------------------------------------
router.post('/:id/payments', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  // FAZ 4: payment-create permission kontrolü buraya (user_permissions matrisi
  // B21-B42 aktif olunca). Bugün organizer-scope + geçerli JWT yeterli.

  // --- Guard: amount ---
  const amount = Number(b.amount);
  if (b.amount == null || b.amount === '' || !isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a number greater than 0.' });
  }

  // --- Guard: currency (3 harf, uppercase'e normalize edilir) ---
  // NOT: convert endpoint'i currency'yi normalize ETMEZ (:114, payload'ı aynen
  // yazar). Normalizasyon burada bilinçli olarak uygulanıyor.
  if (typeof b.currency !== 'string' || !/^[A-Za-z]{3}$/.test(b.currency.trim())) {
    return res.status(400).json({ error: 'currency is required and must be a 3-letter code.' });
  }
  const currency = b.currency.trim().toUpperCase();

  // --- Guard: exchange_rate ---
  const exchange_rate = Number(b.exchange_rate);
  if (b.exchange_rate == null || b.exchange_rate === '' || !isFinite(exchange_rate) || exchange_rate <= 0) {
    return res.status(400).json({ error: 'exchange_rate must be a number greater than 0.' });
  }

  // --- Guard: EUR ise kur 1.0 olmalı (req :1519 — EUR'da rate 1.0, özel durum yok) ---
  if (currency === 'EUR' && exchange_rate !== 1) {
    return res.status(400).json({ error: 'exchange_rate must be 1 when currency is EUR.' });
  }

  // --- Guard: payment_method ---
  if (!PAYMENT_METHODS.includes(b.payment_method)) {
    return res.status(400).json({
      error: `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}`
    });
  }

  // --- Guard: payment_date ---
  if (!isValidDate(b.payment_date)) {
    return res.status(400).json({ error: 'payment_date is required and must be a valid YYYY-MM-DD date.' });
  }

  // Server otoritesi: client'ın gönderdiği amount_eur yok sayılır.
  const amount_eur = round2(amount * exchange_rate);

  // TODO Faz 4: role gate (B21-B42)
  // received_office_id OPSİYONEL/nullable (PS2-A: "para nereye geldi"). Boş → NULL.
  const received_office_id = (b.received_office_id != null && b.received_office_id !== '')
    ? b.received_office_id : null;

  // TAH-04: opsiyonel taksit eşleştirmesi (nullable). Boş eşleştirme GEÇERLİ (C5);
  // form zorlamaz. schedule_item_id 026'da var; bu POST onu ilk kez yazan yer.
  const schedule_item_id = (b.schedule_item_id != null && b.schedule_item_id !== '')
    ? b.schedule_item_id : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Organizer scope + varlık kontrolü tek sorguda.
    // Contract status kontrolü YOK — her status'ta ödeme girilebilir (bilinçli
    // karar: iptal/askıdaki sözleşmeye de geçmiş tahsilat işlenebilmeli).
    const own = await client.query(
      'SELECT id FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }

    // Ofis ZORUNLU (PS2-C, W-6). Bu POST yalnız normal ödeme kurar; reverse (:737) ve
    // transfer (:929/947) AYRI bloklar, ofisi orijinalden devralır → MUAF (dokunulmadı).
    // NOT NULL DB'de yok (Z-1); zorunluluk yalnız API katmanında.
    if (received_office_id == null) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'office required' });
    }
    const off = await client.query(
      'SELECT id FROM offices WHERE id = $1 AND is_active = true',
      [received_office_id]
    );
    if (off.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'invalid office' });
    }

    // TAH-04: taksit verildiyse BU kontrata ait VE aktif (superseded_at IS NULL) olmalı.
    // Eşleştirme planın O ANKİ haline aittir (C8); superseded kaleme yeni eşleşme yazılmaz.
    if (schedule_item_id != null) {
      const si = await client.query(
        'SELECT id FROM payment_schedule_items WHERE id = $1 AND contract_id = $2 AND superseded_at IS NULL',
        [schedule_item_id, id]
      );
      if (si.rows.length === 0) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'invalid schedule item' });
      }
    }

    const result = await client.query(
      `INSERT INTO payments (
         organizer_id, contract_id, amount, currency, exchange_rate,
         amount_eur, payment_method, payment_date, notes, created_by, received_office_id,
         schedule_item_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.organizer_id,
        id,
        amount,
        currency,
        exchange_rate,
        amount_eur,
        b.payment_method,
        b.payment_date,
        b.notes || null,
        null,   // created_by: LEENA JWT'sinde user id YOK (authMiddleware:17
                // yalnız organizer_id veriyor) → Faz 4 kimlik birleşmesinde dolar
        received_office_id,
        schedule_item_id,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ payment: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Payment create failed:', err);
    return res.status(500).json({ error: 'Failed to create payment.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// GET /api/contracts/:id/payments
// Dönüş: { payments: [...], paid_eur, balance_eur } — ikisi de SORGUDA
// hesaplanır, hiçbir yere yazılmaz (D2).
// ----------------------------------------------------------------------------
router.get('/:id/payments', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const own = await pool.query(
      'SELECT revenue_eur FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const list = await pool.query(
      `SELECT * FROM payments
        WHERE contract_id = $1
        ORDER BY payment_date DESC, created_at DESC`,
      [id]
    );

    const totals = await pool.query(
      `SELECT COALESCE(SUM(amount_eur), 0)::numeric(14,2) AS paid_eur
         FROM payments WHERE contract_id = $1`,
      [id]
    );

    const paid_eur = totals.rows[0].paid_eur;
    const revenue_eur = own.rows[0].revenue_eur;
    // revenue_eur NULL ise balance hesaplanamaz — uydurma 0 yok.
    const balance_eur = revenue_eur == null
      ? null
      : (Number(revenue_eur) - Number(paid_eur)).toFixed(2);

    res.json({ payments: list.rows, paid_eur, balance_eur });
  } catch (err) {
    console.error('Error fetching payments:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/contracts/:id/payments/:paymentId/reverse
// Reversal = storno. Orijinal satıra DOKUNULMAZ (payments immutable event).
//
// Ters kayıt orijinali KOPYALAR — yeniden hesap YOK:
//   currency / exchange_rate / payment_method / organizer_id / contract_id aynen,
//   amount = -orijinal.amount, amount_eur = -orijinal.amount_eur.
// İşaret çevrimi SQL'de yapılır (numeric üzerinde), JS'e uğramaz: round2 çağrılsa
// negatif tarafta yuvarlama asimetrisi (round2(-x) ≠ -round2(x)) oluşabilirdi.
// Böylece ters kayıt orijinali kuruşu kuruşuna sıfırlar.
//
// payment_date = reversal günü (CURRENT_DATE), orijinalin tarihi değil.
// notes server tarafından yazılır; client'tan gelen body YOK SAYILIR.
// created_by NULL (mevcut desen — Faz 4 kimlik).
//
// paid/balance hesaplarına dokunulmaz: SUM negatifi kendiliğinden netler (D2).
// ----------------------------------------------------------------------------
router.post('/:id/payments/:paymentId/reverse', authMiddleware, async (req, res) => {
  const { id, paymentId } = req.params;

  // FAZ 4: reversal-permission kontrolü buraya (user_permissions matrisi
  // B21-B42 aktif olunca). Bugün organizer-scope + geçerli JWT yeterli.

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Organizer scope — contract bu organizer'a ait değilse hiç ilerleme.
    const own = await client.query(
      'SELECT id FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }

    // Hedef ödeme bu contract'a ait olmalı.
    const target = await client.query(
      'SELECT id, amount, currency, reverses_payment_id FROM payments WHERE id = $1 AND contract_id = $2',
      [paymentId, id]
    );
    if (target.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Payment not found' });
    }

    const orig = target.rows[0];

    // Reversal-of-reversal engeli uygulama katmanında (018'de trigger YOK).
    if (orig.reverses_payment_id !== null) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'Cannot reverse a reversal.' });
    }

    // Erken 409 — kesin garanti partial UNIQUE'ten gelir (aşağıdaki INSERT),
    // bu kontrol yalnız yaygın durumda daha net bir yanıt verir.
    const already = await client.query(
      'SELECT 1 FROM payments WHERE reverses_payment_id = $1',
      [orig.id]
    );
    if (already.rows.length > 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(409).json({ error: 'Payment already reversed.' });
    }

    const notes = `Reversal of payment #${orig.id} (${orig.amount} ${orig.currency})`;

    // Kopyalama + işaret çevrimi tek INSERT ... SELECT içinde (numeric korunur).
    const result = await client.query(
      `INSERT INTO payments (
         organizer_id, contract_id, amount, currency, exchange_rate,
         amount_eur, payment_method, payment_date, notes, created_by,
         reverses_payment_id, received_office_id, schedule_item_id
       )
       SELECT organizer_id, contract_id, -amount, currency, exchange_rate,
              -amount_eur, payment_method, CURRENT_DATE, $2, NULL,
              id, received_office_id, schedule_item_id
         FROM payments
        WHERE id = $1
       RETURNING *`,
      // TAH-04: schedule_item_id orijinalden DEVRALINIR (received_office_id ile aynı
      // TAH-01 deseni) → net sıfırlama taksidin İÇİNDE gerçekleşir (matched_i = 0).
      [orig.id, notes]
    );

    await client.query('COMMIT');
    return res.status(201).json({ payment: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Payment reverse failed:', err);
    return res.status(500).json({ error: 'Failed to reverse payment.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// TRANSFER (Faz 3a-5) — contract devri
// ----------------------------------------------------------------------------
// Transfer YENİ bir contract yaratır (klon); var olan bir contract'a bağlanmaz.
// Zincir append-only olduğu için A→B→A döngüsü yapısal olarak imkânsız
// (019 başlık yorumu). Kaynak 'Transferred'a çekilir, devamı yeni satırdır.
//
// AF SONEK KURALI: kaynak 'X' → 'X-T'; 'X-T' → 'X-T2'; 'X-T2' → 'X-T3' …
// Kök korunur, sayaç artar. Kaynağın af_number'ı NULL ise yeni af da NULL
// (uq_contracts_af_number partial olduğu için sorun değil).
function nextTransferAf(af) {
  if (af == null || af === '') return null;
  const m = String(af).match(/-T(\d*)$/);
  if (!m) return `${af}-T`;
  const root = String(af).replace(/-T(\d*)$/, '');
  const n = m[1] === '' ? 1 : parseInt(m[1], 10);
  return `${root}-T${n + 1}`;
}

// ----------------------------------------------------------------------------
// POST /api/contracts/:id/transfer
// Body: { expo_id }  — başka alan yok sayılır.
//
// ÖDEME TAŞIMA (storno-taşıma): kaynaktaki TERSLENMEMİŞ normal ödemeler için
// ödeme başına iki INSERT — kaynakta kapama (negatif, reverses set) + yenide
// pozitif kopya (orijinal payment_date korunur → ödeme geçmişi taşınır).
// Terslenmiş çiftler ve reversal satırları YERİNDE KALIR.
// round2 hiçbir yerde çağrılmaz; kopya ve işaret çevrimi SQL'de (numeric korunur).
// paid/balance koduna dokunulmaz — SUM her iki tarafı da kendiliğinden netler (D2).
// ----------------------------------------------------------------------------
router.post('/:id/transfer', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const expo_id = req.body && req.body.expo_id;

  // FAZ 4: transfer-permission kontrolü buraya (user_permissions matrisi
  // B21-B42 aktif olunca). Bugün organizer-scope + geçerli JWT yeterli.

  if (expo_id == null || expo_id === '') {
    return res.status(400).json({ error: 'expo_id is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const src = await client.query(
      'SELECT id, af_number, status FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (src.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }
    const source = src.rows[0];

    // Yalnız yaşayan sözleşmeler devredilebilir. Transferred da buraya düşer —
    // çifte transfer 409'a gelmeden, daha anlamlı bir 400 ile durur.
    if (source.status !== 'Active' && source.status !== 'On Hold') {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'Only Active or On Hold contracts can be transferred.' });
    }

    // Hedef expo aynı organizer'a ait olmalı.
    const expo = await client.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );
    if (expo.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'Target expo not found.' });
    }

    const newAf = nextTransferAf(source.af_number);

    // Klon — kopyalanan alanlar SELECT'ten gelir (numeric bozulmaz).
    // Komisyon atfı taşınır (req :402/:414, K8): agent/sr/sd FK + pct kopyalanır.
    // Operasyonel 9 kolon, source_quote_id, sales_owner_user_id, audit → NULL.
    const created = await client.query(
      `INSERT INTO contracts (
         organizer_id, company_name,
         agent_sales_agent_id, sr_sales_agent_id, sd_sales_agent_id,
         agent_pct, sr_pct, sd_pct,
         revenue, currency, exchange_rate, revenue_eur, company_id,
         expo_id, status, contract_date, transferred_from_contract_id, af_number
       )
       SELECT organizer_id, company_name,
              agent_sales_agent_id, sr_sales_agent_id, sd_sales_agent_id,
              agent_pct, sr_pct, sd_pct,
              revenue, currency, exchange_rate, revenue_eur, company_id,
              $2, 'Active', CURRENT_DATE, id, $3
         FROM contracts
        WHERE id = $1
       RETURNING *`,
      [source.id, expo_id, newAf]
    );
    const newContract = created.rows[0];

    // Taşınacak ödemeler: normal (reversal değil) VE üzerine reversal yazılmamış.
    // Önce listelenir, sonra yazılır — döngü içinde NOT EXISTS kayması olmasın.
    const carry = await client.query(
      `SELECT p.id
         FROM payments p
        WHERE p.contract_id = $1
          AND p.reverses_payment_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reverses_payment_id = p.id)
        ORDER BY p.id`,
      [source.id]
    );

    for (const row of carry.rows) {
      // 1) Kaynakta kapama satırı — 3a-4 INSERT..SELECT deseni birebir.
      // TAH-04: schedule_item_id kaynağın item'ından DEVRALINIR (reversal deseni) →
      // net sıfırlama kaynağın taksidinde gerçekleşir.
      await client.query(
        `INSERT INTO payments (
           organizer_id, contract_id, amount, currency, exchange_rate,
           amount_eur, payment_method, payment_date, notes, created_by,
           reverses_payment_id, received_office_id, schedule_item_id
         )
         SELECT organizer_id, contract_id, -amount, currency, exchange_rate,
                -amount_eur, payment_method, CURRENT_DATE, $2, NULL,
                id, received_office_id, schedule_item_id
           FROM payments
          WHERE id = $1`,
        [row.id, `Transferred to ${newAf} (payment #${row.id})`]
      );

      // 2) Yeni contract'ta pozitif kopya — orijinal payment_date KORUNUR.
      // TAH-04: schedule_item_id KOPYALANMAZ → klonda NULL. KAÇINILMAZ: klonun planı
      // YOK (A4: transfer payment_schedule_items'a dokunmaz), bağlanacak satır yok.
      // Klon planı sonradan üretilince kullanıcı elle eşleştirir.
      // ⚠️ OFS-05 SINIFI BORÇ: aynı schedule_item_id devralma kuralı reversal + transfer
      // bloklarında AYRI yazılıyor (ortak kod yok) — kural değişirse İKİ yer de güncellenir.
      await client.query(
        `INSERT INTO payments (
           organizer_id, contract_id, amount, currency, exchange_rate,
           amount_eur, payment_method, payment_date, notes, created_by,
           received_office_id
         )
         SELECT organizer_id, $2, amount, currency, exchange_rate,
                amount_eur, payment_method, payment_date, $3, NULL,
                received_office_id
           FROM payments
          WHERE id = $1`,
        [row.id, newContract.id, `Transferred from ${source.af_number} (payment #${row.id})`]
      );
    }

    await client.query(
      `UPDATE contracts SET status = 'Transferred', updated_at = NOW() WHERE id = $1`,
      [source.id]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      contract: newContract,
      transferred_payments: carry.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Contract transfer failed:', err);
    return res.status(500).json({ error: 'Failed to transfer contract.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// PUT /api/contracts/:id/assignment
// Komisyon atama — üçlü agent/sr/sd FK + override pct'ler.
//
// TAM SET semantiği (partial patch DEĞİL): atama tek ekrandan tam gönderilir,
// body'de olmayan alan NULL yazılır. Kısmi patch karmaşası bilinçli olarak yok.
//
// Doğrulama CHECK'e düşmeden anlaşılır 400'e çevrilir (DB CHECK son emniyet):
//   - FK'ler organizer scope'unda var mı → 400
//   - agent XOR sr → 400 · sd sr'sız → 400 · pct FK'siz → 400 · pct 0-100 → 400
//
// Status kısıtı YOK — atama her status'ta düzeltilebilir (Transferred'da bile;
// bilinçli: yanlış atama sonradan düzeltilebilmeli).
//
// Komisyon HESABI burada YOK — yalnız atama. Oran çözümü (override → yoksa
// sales_agents.default_commission_pct) motor diliminin işi.
// ----------------------------------------------------------------------------
function isPct(v) {
  if (v === null || v === undefined) return true; // nullable
  const n = Number(v);
  return isFinite(n) && n >= 0 && n <= 100;
}

router.put('/:id/assignment', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  // FAZ 4: assignment-permission kontrolü buraya (user_permissions B21-B42).

  // Tam set — gönderilmeyen alanlar NULL.
  const agent = b.agent_sales_agent_id != null ? b.agent_sales_agent_id : null;
  const sr    = b.sr_sales_agent_id != null ? b.sr_sales_agent_id : null;
  const sd    = b.sd_sales_agent_id != null ? b.sd_sales_agent_id : null;
  const agentPct = b.agent_pct != null && b.agent_pct !== '' ? b.agent_pct : null;
  const srPct    = b.sr_pct != null && b.sr_pct !== '' ? b.sr_pct : null;
  const sdPct    = b.sd_pct != null && b.sd_pct !== '' ? b.sd_pct : null;

  // --- Kural: agent XOR sr ---
  if (agent != null && sr != null) {
    return res.status(400).json({ error: 'Agent and SR are mutually exclusive.' });
  }
  // --- Kural: sd yalnız sr varken ---
  if (sd != null && sr == null) {
    return res.status(400).json({ error: 'SD requires an SR.' });
  }
  // --- Kural: pct ancak ilgili FK doluyken ---
  if (agentPct != null && agent == null) {
    return res.status(400).json({ error: 'Percentage requires an agent.' });
  }
  if (srPct != null && sr == null) {
    return res.status(400).json({ error: 'Percentage requires an agent.' });
  }
  if (sdPct != null && sd == null) {
    return res.status(400).json({ error: 'Percentage requires an agent.' });
  }
  // --- Kural: pct 0-100 ---
  if (!isPct(agentPct) || !isPct(srPct) || !isPct(sdPct)) {
    return res.status(400).json({ error: 'Percentage must be a number between 0 and 100.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const own = await client.query(
      'SELECT id FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }

    // FK'ler organizer scope'unda gerçekten var mı — CHECK'e düşmeden 400.
    const ids = [agent, sr, sd].filter(v => v != null);
    if (ids.length > 0) {
      const found = await client.query(
        'SELECT id FROM sales_agents WHERE organizer_id = $1 AND id = ANY($2::int[])',
        [req.organizer_id, ids]
      );
      if (found.rows.length !== new Set(ids).size) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'Unknown sales agent.' });
      }
    }

    await client.query(
      `UPDATE contracts SET
         agent_sales_agent_id = $1, sr_sales_agent_id = $2, sd_sales_agent_id = $3,
         agent_pct = $4, sr_pct = $5, sd_pct = $6, updated_at = NOW()
       WHERE id = $7 AND organizer_id = $8`,
      [agent, sr, sd, agentPct, srPct, sdPct, id, req.organizer_id]
    );

    // Detay SELECT'iyle aynı join'li şekil.
    const detail = await client.query(
      CONTRACT_DETAIL_SQL + ` LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pm.amount_eur), 0)::numeric(14,2) AS paid_eur
             FROM payments pm WHERE pm.contract_id = c.id
         ) p ON TRUE
        WHERE c.id = $1 AND c.organizer_id = $2`,
      [id, req.organizer_id]
    );

    await client.query('COMMIT');
    return res.json({ contract: detail.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Assignment update failed:', err);
    return res.status(500).json({ error: 'Failed to update assignment.' });
  } finally {
    client.release();
  }
});

// ============================================================================
// PAYMENT SCHEDULE (PS1) — plan kalemleri. Schedule PLAN, payments OLAY (S-6/S-13r):
// eşleştirme mantığı YOK. Kur dondurulmaz (S-4). Revizyon = superseded damgası +
// yeni satır (S-5). "matches_revenue" TÜRETİLİR, saklanmaz (S-7). Ofis listesi
// koda gömülmez (S-16r). Komisyon motoruna DOKUNULMAZ (S-8).
// ============================================================================
const SCHED_METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];

// Aktif planı süpersede edip yeni revizyon kalemlerini ekler (çağıranın tx'i içinde).
async function applyScheduleRevision(client, contractId, organizerId, items, currency, source, createdBy) {
  const maxRev = (await client.query(
    'SELECT COALESCE(MAX(revision), 0) AS m FROM payment_schedule_items WHERE contract_id = $1',
    [contractId]
  )).rows[0].m;
  const newRev = Number(maxRev) + 1;
  let droppedMatchCount = 0;
  if (Number(maxRev) > 0) {
    // C8: bu revizyon aktif kalemlere eşleşmiş ödemeleri DÜŞÜRÜR. Ödeme DEĞİŞMEZ (C4),
    // schedule_item_id boşaltılmaz — "düşmüş" = FK'nın gösterdiği satırın superseded_at'i
    // (türetilir, D2). Kullanıcı UYARILIR (PLN-07 deseni, ENGELLEME YOK).
    droppedMatchCount = Number((await client.query(
      `SELECT count(*) AS n FROM payments
        WHERE schedule_item_id IN
              (SELECT id FROM payment_schedule_items WHERE contract_id = $1 AND superseded_at IS NULL)`,
      [contractId]
    )).rows[0].n);
    // S-5: eski satır UPDATE/SİLİNMEZ — yalnız superseded_at damgalanır.
    await client.query(
      'UPDATE payment_schedule_items SET superseded_at = now() WHERE contract_id = $1 AND superseded_at IS NULL',
      [contractId]
    );
  }
  const inserted = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = await client.query(
      `INSERT INTO payment_schedule_items
         (organizer_id, contract_id, revision, item_no, due_date, amount, currency,
          percent, source, expected_office_id, expected_method, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [organizerId, contractId, newRev, i + 1, it.due_date, it.amount, currency,
       it.percent ?? null, source, it.expected_office_id ?? null, it.expected_method ?? null,
       it.notes ?? null, createdBy]
    );
    inserted.push(row.rows[0]);
  }
  return { active: inserted, dropped_match_count: droppedMatchCount };
}

// expected_office_id'ler offices'ta VE aktif mi (tx içinde).
async function validateOffices(client, items) {
  const ids = [...new Set(items.map(it => it.expected_office_id).filter(v => v != null))];
  if (ids.length === 0) return true;
  const found = await client.query(
    'SELECT id FROM offices WHERE id = ANY($1::int[]) AND is_active = true',
    [ids]
  );
  return found.rows.length === ids.length;
}

// GET /api/contracts/:id/schedule — aktif plan + history + türetilmiş totals (D2).
router.get('/:id/schedule', authMiddleware, async (req, res) => {
  const { id } = req.params;
  // TODO Faz 4: role gate (B21-B42)
  try {
    const own = await pool.query(
      'SELECT revenue, currency FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) return res.status(404).json({ error: 'Contract not found' });

    const active = await pool.query(
      'SELECT * FROM payment_schedule_items WHERE contract_id = $1 AND superseded_at IS NULL ORDER BY item_no',
      [id]
    );
    const history = await pool.query(
      'SELECT * FROM payment_schedule_items WHERE contract_id = $1 AND superseded_at IS NOT NULL ORDER BY revision DESC, item_no',
      [id]
    );
    const tot = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS scheduled_total
         FROM payment_schedule_items WHERE contract_id = $1 AND superseded_at IS NULL`,
      [id]
    );
    const scheduled_total = tot.rows[0].scheduled_total;
    const revenue = own.rows[0].revenue;
    // matches_revenue TÜRETİLİR (S-7); aktif kalem yoksa false.
    const matches_revenue = active.rows.length > 0 && revenue != null
      && Number(scheduled_total) === Number(revenue);

    res.json({
      active: active.rows,
      history: history.rows,
      totals: { scheduled_total, contract_revenue: revenue, currency: own.rows[0].currency, matches_revenue },
    });
  } catch (err) {
    console.error('Error fetching schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contracts/:id/schedule — ELLE plan (yüzde XOR tutar).
router.post('/:id/schedule', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  // TODO Faz 4: role gate (B21-B42)

  const items = Array.isArray(b.items) ? b.items : null;
  if (!items || items.length === 0) return res.status(400).json({ error: 'items required' });

  const hasPercent = items.some(it => it.percent != null && it.percent !== '');
  const hasAmount = items.some(it => it.amount != null && it.amount !== '');
  if (hasPercent && hasAmount) return res.status(400).json({ error: 'use either percent or amount for all items' });
  if (!hasPercent && !hasAmount) return res.status(400).json({ error: 'each item requires percent or amount' });

  for (const it of items) {
    if (!isValidDate(it.due_date)) return res.status(400).json({ error: 'valid due_date required for each item' });
    if (it.expected_method != null && it.expected_method !== '' && !SCHED_METHODS.includes(it.expected_method))
      return res.status(400).json({ error: 'invalid method' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = await client.query(
      'SELECT revenue, currency FROM contracts WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }
    const revenue = own.rows[0].revenue;
    const currency = own.rows[0].currency;
    // Defensif: currency NOT NULL — kontratta NULL ise raw 500 yerine net 400.
    if (currency == null) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'contract currency required' });
    }

    if (!(await validateOffices(client, items))) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({ error: 'invalid office' });
    }

    // due_date sırasına göre — item_no 1..n.
    const sorted = items.slice().sort((a, c) => (a.due_date < c.due_date ? -1 : a.due_date > c.due_date ? 1 : 0));

    const computed = [];
    let source, warning;
    if (hasPercent) {
      if (revenue == null) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'contract revenue required' });
      }
      let ptot = 0;
      for (const it of sorted) {
        const p = Number(it.percent);
        if (!isFinite(p) || p < 0 || p > 100) {
          await client.query('ROLLBACK').catch(() => {});
          return res.status(400).json({ error: 'percent must be between 0 and 100' });
        }
        ptot += p;
      }
      if (round2(ptot) !== 100) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'percent total must be 100' });
      }
      source = 'manual_percent';
      const rev = Number(revenue);
      let acc = 0;
      for (let i = 0; i < sorted.length; i++) {
        const it = sorted[i];
        // SON KALEM kalanı emer → Σ ≡ revenue TAM (S-3).
        const amt = (i === sorted.length - 1) ? round2(rev - acc) : round2(rev * Number(it.percent) / 100);
        if (i !== sorted.length - 1) acc = round2(acc + amt);
        if (!(amt > 0)) {
          await client.query('ROLLBACK').catch(() => {});
          return res.status(400).json({ error: 'each amount must be greater than 0' });
        }
        computed.push({ due_date: it.due_date, amount: amt, percent: it.percent,
          expected_office_id: it.expected_office_id, expected_method: it.expected_method || null, notes: it.notes });
      }
    } else {
      source = 'manual_amount';
      let sum = 0;
      for (const it of sorted) {
        const a = Number(it.amount);
        if (!isFinite(a) || !(a > 0)) {
          await client.query('ROLLBACK').catch(() => {});
          return res.status(400).json({ error: 'each amount must be greater than 0' });
        }
        const amt = round2(a);
        sum = round2(sum + amt);
        computed.push({ due_date: it.due_date, amount: amt, percent: null,
          expected_office_id: it.expected_office_id, expected_method: it.expected_method || null, notes: it.notes });
      }
      // S-9: Σ ≠ revenue KABUL edilir, uyarı döner (engellenmez).
      if (revenue == null || Number(sum) !== Number(revenue)) {
        warning = 'scheduled total does not match contract revenue';
      }
    }

    const rev = await applyScheduleRevision(client, id, req.organizer_id, computed, currency, source, null);
    await client.query('COMMIT');
    const resp = { active: rev.active };
    if (warning) resp.warning = warning;
    // C8: bu revizyon eşleşmiş ödemeleri düşürdüyse uyar (ENGELLEME YOK, PLN-07 deseni).
    if (rev.dropped_match_count > 0) {
      resp.dropped_match_count = rev.dropped_match_count;
      resp.matched_warning = `${rev.dropped_match_count} matched payment(s) dropped by this revision; re-match manually.`;
    }
    return res.status(201).json(resp);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Schedule create failed:', err);
    return res.status(500).json({ error: 'Failed to create schedule.' });
  } finally {
    client.release();
  }
});

// POST /api/contracts/:id/schedule/default — DEFAULT üretici (imza+7 / expo−30).
router.post('/:id/schedule/default', authMiddleware, async (req, res) => {
  const { id } = req.params;
  // TODO Faz 4: role gate (B21-B42)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Tarihleri string olarak al (TZ kayması önleme). Plan ofisi SUNUCUDA çözülür
    // (PS3-A): kontratın agent'ı → yoksa SR → o agent'ın office_id'si. is_active
    // KONTROL EDİLMEZ (plan tahmindir, P-9); çözülemezse NULL kalır, hata dönmez.
    // TODO Faz 4: role gate + actor (B21-B42)
    const own = await client.query(
      `SELECT to_char(c.contract_date, 'YYYY-MM-DD') AS contract_date, c.expo_id,
              c.revenue, c.currency, to_char(e.start_date, 'YYYY-MM-DD') AS expo_start,
              COALESCE(ag.office_id, sr.office_id) AS resolved_office_id
         FROM contracts c
         LEFT JOIN expos e        ON e.id = c.expo_id
         LEFT JOIN sales_agents ag ON ag.id = c.agent_sales_agent_id
         LEFT JOIN sales_agents sr ON sr.id = c.sr_sales_agent_id
        WHERE c.id = $1 AND c.organizer_id = $2`,
      [id, req.organizer_id]
    );
    if (own.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Contract not found' });
    }
    const r = own.rows[0];
    // ÖN KOŞUL — biri eksikse 400 + 0 satır (yarım plan YASAK, S-1).
    if (r.contract_date == null) { await client.query('ROLLBACK').catch(() => {}); return res.status(400).json({ error: 'contract_date required' }); }
    if (r.expo_id == null) { await client.query('ROLLBACK').catch(() => {}); return res.status(400).json({ error: 'expo required' }); }
    if (r.expo_start == null) { await client.query('ROLLBACK').catch(() => {}); return res.status(400).json({ error: 'expo start date required' }); }
    if (r.revenue == null) { await client.query('ROLLBACK').catch(() => {}); return res.status(400).json({ error: 'contract revenue required' }); }
    if (r.currency == null) { await client.query('ROLLBACK').catch(() => {}); return res.status(400).json({ error: 'contract currency required' }); }

    const d = await client.query(
      `SELECT to_char($1::date + 7, 'YYYY-MM-DD') AS d1, to_char($2::date - 30, 'YYYY-MM-DD') AS d2`,
      [r.contract_date, r.expo_start]
    );
    const d1 = d.rows[0].d1, d2 = d.rows[0].d2;
    const revenue = Number(r.revenue);

    // Plan ofisi: kontratın agent/SR ofisi (çözülemezse NULL — zorunlu değil, P-9).
    const planOffice = r.resolved_office_id;
    let computed;
    if (d2 <= d1) {
      // S-2 çekme+birleştirme tek ifadesi: TEK kalem %100 @ d1.
      computed = [{ due_date: d1, amount: round2(revenue), percent: 100, expected_office_id: planOffice, expected_method: null, notes: null }];
    } else {
      const a1 = round2(revenue * 0.40);
      const a2 = round2(revenue - a1);
      computed = [
        { due_date: d1, amount: a1, percent: 40, expected_office_id: planOffice, expected_method: null, notes: null },
        { due_date: d2, amount: a2, percent: 60, expected_office_id: planOffice, expected_method: null, notes: null },
      ];
    }

    const rev = await applyScheduleRevision(client, id, req.organizer_id, computed, r.currency, 'default', null);
    await client.query('COMMIT');
    const resp = { active: rev.active };
    // C8: default üretici de revizyon üretir; eşleşmiş ödeme düştüyse uyar (ENGELLEME YOK).
    if (rev.dropped_match_count > 0) {
      resp.dropped_match_count = rev.dropped_match_count;
      resp.matched_warning = `${rev.dropped_match_count} matched payment(s) dropped by this revision; re-match manually.`;
    }
    return res.status(201).json(resp);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Schedule default failed:', err);
    return res.status(500).json({ error: 'Failed to generate default schedule.' });
  } finally {
    client.release();
  }
});

module.exports = router;
// Tek-kaynak SQL fragment'ları — M2 kesim raporu (routes/commissions.js) matrahı
// AYNI ifadeden türetir (yeniden icat yok). SLICE_EUR_EXPR M1 contract görünümü
// içindir (amount_eur); M2 pencereli marjinal effective_pay kullanır (M-c/U1a) —
// bu yüzden fragment'ı referans/belge olarak export ediyoruz, matrah fragment'ı
// (COMMISSIONABLE_BASE_EXPR) ise M2'de birebir kullanılır.
module.exports.COMMISSIONABLE_BASE_EXPR = COMMISSIONABLE_BASE_EXPR;
module.exports.SLICE_EUR_EXPR = SLICE_EUR_EXPR;
