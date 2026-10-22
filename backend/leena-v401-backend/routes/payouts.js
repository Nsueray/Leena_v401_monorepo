// ----------------------------------------------------------------------------
// routes/payouts.js — Agent komisyon ödemeleri (PAYOUT P1) + cari hesap statement
// Mount: /api/agents  (index.js)
//   POST /api/agents/:id/payouts     → fiili ödeme kaydı (immutable olay)
//   GET  /api/agents/:id/statement   → earned (türetilmiş) / paid / balance / payouts[]
//
// MODEL (cari hesap, D2): earned HER OKUMADA türetilir (commissionSlices tek
// kaynak), asla saklanmaz. Bakiye = earned − paid, okuma anında. Düzeltme =
// yeni satır + negatif amount + reverses_payout_id (UPDATE/DELETE yok).
// Ödeme deseni routes/contracts.js POST /:id/payments'tan birebir (validasyon,
// atomik tx, mapWriteError, organizer scope).
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const { SLICE_CTES } = require('../utils/commissionSlices');
const ledger = require('../utils/ledger');
const perms = require('../utils/permissions');

// round2 / isValidDate — contracts.js:546-555 emsali birebir.
function round2(n) {
  return Math.round(n * 100) / 100;
}
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 23505 (unique) / 23503 (fk) / 23514 (check) → anlamlı HTTP (contracts.js:31 emsali)
function mapWriteError(err) {
  if (err.code === '23505') {
    // 025 partial UNIQUE → bir payout yalnız bir kez terslenebilir.
    if (err.constraint === 'uq_commission_payouts_reverses') {
      return { status: 409, body: { error: 'Payout already reversed.' } };
    }
    return { status: 409, body: { error: 'Duplicate value violates a unique constraint.' } };
  }
  if (err.code === '23503') {
    return { status: 400, body: { error: 'Referenced record does not exist.' } };
  }
  if (err.code === '23514') {
    return { status: 400, body: { error: 'A value violates a database check constraint.' } };
  }
  return null; // bilinmeyen → caller 500
}

// ----------------------------------------------------------------------------
// POST /api/agents/:id/payouts
// Body: amount, currency (default 'EUR'), exchange_rate (EUR ise 1),
//       payout_date, notes?, reverses_payout_id?, account_id? (Paket 1 L-4)
// Ledger (036-040 uygulandıysa): normal payout → hesap = açık hesap → ödeyen ofisin
// varsayılan hesabı → yok (hesapsız + `warning`, 400 DEĞİL). Reversal → orijinalin
// hareketi varsa aynı hesapta ters hareket; istemcinin account_id'si yok sayılır (TAH-01).
// Hesap commission_payouts'ta SAKLANMAZ — hareket satırında yaşar (tablo değişmedi).
// ----------------------------------------------------------------------------
// Paket 2 KAPI: payouts.write (utils/permissions.js). Kapsam = ödeyen ofis (normal: istemcinin
// doğrulanmış ofisi · reversal: orijinalden devralınan). commission_payouts.created_by integer
// (organizer) olduğundan own/team kapsamı payout'ta eşleşmez → yalnız office / all geçer.
router.post('/:id/payouts', authMiddleware, perms.requirePermission('payouts.write'), async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  const isReversal = b.reverses_payout_id != null;

  // --- Guard: amount (reversal → negatif; normal → pozitif; DB CHECK ile de zorlanır) ---
  const amount = Number(b.amount);
  if (b.amount == null || b.amount === '' || !isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number.' });
  }
  if (!isReversal && amount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0 for a payout.' });
  }
  if (isReversal && amount >= 0) {
    return res.status(400).json({ error: 'amount must be negative when reversing a payout.' });
  }

  // --- Guard: currency (3 harf, uppercase; default 'EUR') ---
  const rawCur = b.currency == null || b.currency === '' ? 'EUR' : b.currency;
  if (typeof rawCur !== 'string' || !/^[A-Za-z]{3}$/.test(rawCur.trim())) {
    return res.status(400).json({ error: 'currency must be a 3-letter code.' });
  }
  const currency = rawCur.trim().toUpperCase();

  // --- Guard: exchange_rate (EUR ise 1) ---
  const exchange_rate = Number(b.exchange_rate);
  if (b.exchange_rate == null || b.exchange_rate === '' || !isFinite(exchange_rate) || exchange_rate <= 0) {
    return res.status(400).json({ error: 'exchange_rate must be a number greater than 0.' });
  }
  if (currency === 'EUR' && exchange_rate !== 1) {
    return res.status(400).json({ error: 'exchange_rate must be 1 when currency is EUR.' });
  }

  // --- Guard: payout_date ---
  if (!isValidDate(b.payout_date)) {
    return res.status(400).json({ error: 'payout_date is required and must be a valid YYYY-MM-DD date.' });
  }

  // Server otoritesi: client'ın gönderdiği amount_eur yok sayılır.
  const amount_eur = round2(amount * exchange_rate);

  // TODO Faz 4: actor (B21-B42)
  // paid_office_id (para ÇIKTI) + payout_method — OPSİYONEL/nullable (PS2-B1).
  // W-3: REVERSAL'da istemci değeri YOK SAYILIR; ofis/method orijinalden devralınır.
  // Normal payout'ta doğrulanır. Sözlük payments.payment_method ile AYNI (H7).
  const PAYOUT_METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];
  const paidOfficeIn = (b.paid_office_id != null && b.paid_office_id !== '') ? b.paid_office_id : null;
  const payoutMethodIn = (b.payout_method != null && b.payout_method !== '') ? b.payout_method : null;
  if (!isReversal && payoutMethodIn != null && !PAYOUT_METHODS.includes(payoutMethodIn)) {
    return res.status(400).json({ error: 'invalid method' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Agent organizer scope + varlık kontrolü.
    const agent = await client.query(
      'SELECT id FROM sales_agents WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (agent.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Normal payout: ofis ZORUNLU (PS2-C, W-6). Reversal MUAF — ofisi orijinalden
    // devralır (aşağıda). NOT NULL DB'de yok (Z-1); zorunluluk yalnız API katmanında.
    if (!isReversal) {
      if (paidOfficeIn == null) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'office required' });
      }
      const off = await client.query(
        'SELECT id FROM offices WHERE id = $1 AND is_active = true',
        [paidOfficeIn]
      );
      if (off.rows.length === 0) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'invalid office' });
      }
    }

    // Reversal hedefi doğrulaması: aynı agent + aynı organizer + orijinal (pozitif).
    // W-3: ofis/method da OKUNUR → reversal satırına orijinalden yazılır.
    let tgtRow = null;
    if (isReversal) {
      const tgt = await client.query(
        'SELECT id, sales_agent_id, amount, currency, payout_method, paid_office_id FROM commission_payouts WHERE id = $1 AND organizer_id = $2',
        [b.reverses_payout_id, req.organizer_id]
      );
      if (tgt.rows.length === 0) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'reverses_payout_id does not exist.' });
      }
      if (String(tgt.rows[0].sales_agent_id) !== String(id)) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'Reversal must target a payout of the same agent.' });
      }
      if (Number(tgt.rows[0].amount) < 0) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: 'Cannot reverse a reversal.' });
      }
      tgtRow = tgt.rows[0];
    }

    // W-3: reversal → orijinalden devral; normal → doğrulanmış istemci değeri.
    const finalOffice = isReversal ? tgtRow.paid_office_id : paidOfficeIn;
    const finalMethod = isReversal ? tgtRow.payout_method : payoutMethodIn;
    if (!perms.checkScope(req, { office_id: finalOffice, created_by: null })) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(409).json(perms.OUT_OF_SCOPE);
    }

    // L-4: hesap çözümü (utils/ledger.js tek kural) — yalnız normal payout'ta.
    const ledgerReady = await ledger.ledgerSchemaReady(client);
    let account = null;
    let warning = null;
    let origEntry = null;
    if (ledgerReady && !isReversal) {
      const ra = await ledger.resolveAccount(client, {
        organizerId: req.organizer_id, accountId: b.account_id, officeId: finalOffice,
        currency, what: 'payout',
      });
      if (ra.error) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: ra.error });
      }
      account = ra.account;
      warning = ra.warning;
    } else if (ledgerReady && isReversal) {
      origEntry = await ledger.findSourceEntry(client, 'payout', tgtRow.id);
      // Ters hareket orijinalin hesabına yazılır → para birimi orijinalle aynı olmalı (LED-11).
      if (origEntry && currency !== String(tgtRow.currency).toUpperCase()) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({ error: `reversal currency must match the original payout (${tgtRow.currency}).` });
      }
    } else if (b.account_id != null && b.account_id !== '') {
      warning = 'Ledger is not available yet — account was not saved.';
    }

    const result = await client.query(
      `INSERT INTO commission_payouts (
         organizer_id, sales_agent_id, amount, currency, exchange_rate,
         amount_eur, payout_date, notes, reverses_payout_id, created_by,
         paid_office_id, payout_method
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.organizer_id,
        id,
        amount,
        currency,
        exchange_rate,
        amount_eur,
        b.payout_date,
        b.notes || null,
        isReversal ? b.reverses_payout_id : null,
        null, // created_by: LEENA JWT'sinde user id yok (Faz 4 kimlik birleşmesinde dolar)
        finalOffice,
        finalMethod,
      ]
    );

    let ledger_entry_id = null;
    if (account) {
      ledger_entry_id = await ledger.insertSourceEntry(client, {
        organizerId: req.organizer_id, accountId: account.id, kind: 'payout',
        sourceId: result.rows[0].id, direction: 'out', entryDate: b.payout_date,
        createdBy: ledger.requestUserId(req),
      });
    } else if (origEntry) {
      ledger_entry_id = await ledger.insertSourceEntry(client, {
        organizerId: req.organizer_id, accountId: origEntry.account_id, kind: 'payout',
        sourceId: result.rows[0].id, direction: 'in', entryDate: b.payout_date,
        reversesEntryId: origEntry.id, createdBy: ledger.requestUserId(req),
      });
    }

    await client.query('COMMIT');
    return res.status(201).json({ payout: result.rows[0], ledger_entry_id, warning });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const mapped = mapWriteError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error('Payout create failed:', err);
    return res.status(500).json({ error: 'Failed to create payout.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// GET /api/agents/:id/statement
// Cari hesap: earned (türetilmiş, tüm zaman) / paid / balance / payouts[].
// ----------------------------------------------------------------------------
router.get('/:id/statement', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // Agent organizer scope + varlık. office_id ön-doldurma için döner (W-7, ek sorgu yok).
    const agent = await pool.query(
      'SELECT id, name, office_id FROM sales_agents WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );
    if (agent.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // earned_eur — ORTAK dilim ifadesi (S-8), tarih filtresi YOK, tüm zaman,
    // agent bazında toplanır; HAM dilimler → TEK final ROUND (commissions.js:130 deseni).
    // Status filtresi YOK (S-7 — Cancelled dâhil, tahsilat komisyon doğurur).
    // $1 = organizer_id (SLICE_CTES sözleşmesi), $2 = sales_agent_id.
    const earnedQ = await pool.query(
      `WITH
${SLICE_CTES}
       SELECT COALESCE(ROUND(SUM(slice_raw), 2), 0)::numeric(14,2) AS earned_eur
         FROM sliced
        WHERE sales_agent_id = $2 AND slice_raw IS NOT NULL`,
      [req.organizer_id, id]
    );
    const earned_eur = earnedQ.rows[0].earned_eur;

    // paid_eur — reversal'lar negatif olduğu için SUM doğal netler (ayrı filtre yok).
    const paidQ = await pool.query(
      `SELECT COALESCE(SUM(amount_eur), 0)::numeric(14,2) AS paid_eur
         FROM commission_payouts
        WHERE sales_agent_id = $1 AND organizer_id = $2`,
      [id, req.organizer_id]
    );
    const paid_eur = paidQ.rows[0].paid_eur;

    // balance_eur = earned − paid (negatif olabilir — cari hesap, normaldir).
    const balance_eur = (Number(earned_eur) - Number(paid_eur)).toFixed(2);

    const payouts = await pool.query(
      `SELECT * FROM commission_payouts
        WHERE sales_agent_id = $1 AND organizer_id = $2
        ORDER BY payout_date DESC, id DESC`,
      [id, req.organizer_id]
    );

    res.json({
      sales_agent_id: Number(id),
      agent_name: agent.rows[0].name,
      agent_office_id: agent.rows[0].office_id,   // ön-doldurma kaynağı (W-7)
      earned_eur,
      paid_eur,
      balance_eur,
      payouts: payouts.rows,
    });
  } catch (err) {
    console.error('Error building agent statement:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
