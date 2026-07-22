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
//   - Bu dilimde NULL kalan: expo_id (Convert-1 dilimi), sales_agent_id (Faz 3b),
//     audit created_by/converted_by/converted_at (Faz 4 kimlik).
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
        // expo_id, sales_agent_id, audit → bu dilimde NULL (sonraki dilimler)
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ contract: result.rows[0] });
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
// Detay — contracts.* (29 kolon) + expo adı + sales agent adı.
// ----------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*,
              e.name  AS expo_name,
              sa.name AS sales_agent_name,
              -- D2: paid/balance HESAPLANIR, saklanmaz.
              p.paid_eur,
              CASE WHEN c.revenue_eur IS NULL THEN NULL
                   ELSE c.revenue_eur - p.paid_eur END AS balance_eur
         FROM contracts c
         LEFT JOIN expos e         ON e.id  = c.expo_id
         LEFT JOIN sales_agents sa ON sa.id = c.sales_agent_id
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching contract:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------------------------------------------------
// PUT /api/contracts/:id/status
// Tek alan güncelleme (expos.js:500-515 deseni). Geçiş matrisi YOK — dört durum
// arasında serbest hareket; iş kuralı gerekirse sonraki dilimde eklenir.
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

    const result = await client.query(
      `INSERT INTO payments (
         organizer_id, contract_id, amount, currency, exchange_rate,
         amount_eur, payment_method, payment_date, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
         reverses_payment_id
       )
       SELECT organizer_id, contract_id, -amount, currency, exchange_rate,
              -amount_eur, payment_method, CURRENT_DATE, $2, NULL,
              id
         FROM payments
        WHERE id = $1
       RETURNING *`,
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

module.exports = router;
