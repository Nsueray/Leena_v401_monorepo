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

module.exports = router;
