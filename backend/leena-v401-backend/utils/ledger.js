// ----------------------------------------------------------------------------
// utils/ledger.js — ledger ortak kuralları (Paket 1). TEK KAYNAK:
//   - hesap çözümü (ödeme / payout / gider aynı kuralı kullanır — OFS-05 sınıfı borç doğmasın)
//   - kaynaklı hareket yazımı (payment / payout / expense → ledger_entries)
//   - şema hazır mı (deploy migration'dan ÖNCE: eski davranış birebir sürer)
//   - istekteki kullanıcı (JWT user_id; klasik organizer token'ında yok → NULL)
// ----------------------------------------------------------------------------
const jwt = require('jsonwebtoken');

// round2 / isValidDate — contracts.js:546-555 emsali birebir (payouts.js de aynı kopyayı taşır).
function round2(n) {
  return Math.round(n * 100) / 100;
}
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── Şema hazır mı? (036-040 uygulandı mı) ───────────────────────────────────
// 42703 fallback kuralının (CLAUDE.md) yazım tarafı: kod migration'dan önce deploy edilir;
// tablolar/kolonlar yoksa ödeme/payout akışı ESKİ haliyle (hesapsız, hareketsiz) çalışır.
// Yalnız OLUMLU sonuç önbelleğe alınır — migration sonrası ilk istekte kendiliğinden açılır.
let schemaReadyCache = false;
async function ledgerSchemaReady(db) {
  if (schemaReadyCache) return true;
  const r = await db.query(
    `SELECT to_regclass('public.ledger_entries') IS NOT NULL AS le,
            EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'payments'
                       AND column_name = 'account_id') AS pa`);
  schemaReadyCache = r.rows[0].le && r.rows[0].pa;
  return schemaReadyCache;
}

// ── İstekteki kullanıcı (users.id) — yalnız ui2 (users) oturumunda vardır ────
// authMiddleware'e DOKUNULMAZ (KAPI-2); token aynı sırla yeniden doğrulanır, yalnız okunur.
function requestUserId(req) {
  const h = req.headers && req.headers['authorization'];
  const tok = h && h.split(' ')[1];
  if (!tok || !process.env.JWT_SECRET) return null;
  try {
    const d = jwt.verify(tok, process.env.JWT_SECRET);
    return d && d.user_id ? d.user_id : null;
  } catch (_) {
    return null;
  }
}

// Owner mı? (LED-09: bütçe kilidi). B9: display_role DEĞİL, users.is_owner bayrağı.
async function requestIsOwner(db, req) {
  const uid = requestUserId(req);
  if (!uid) return false;
  const r = await db.query(
    'SELECT 1 FROM users WHERE id = $1 AND organizer_id = $2 AND is_owner AND is_active',
    [uid, req.organizer_id]);
  return r.rows.length === 1;
}

// ── Hesap çözümü (LED-12 önerisi) ───────────────────────────────────────────
// Sıra: açık hesap (doğrulanır) → ofisin (ofis, para birimi) varsayılan hesabı → yok.
// Hesap YOKSA hata DEĞİL: kayıt hesapsız + uyarı ile yazılır (KAPI-2 şartı: eski form 400
// almaz). Açık verilen hesap yanlışsa 400 (kullanıcının seçimi sessizce değiştirilmez).
// Döner: { account: {id, currency} | null, source: 'explicit'|'office_default'|null,
//          warning: string|null, error: string|null }
async function resolveAccount(db, { organizerId, accountId, officeId, currency, what = 'payment' }) {
  const cur = String(currency || '').toUpperCase();
  if (accountId != null && accountId !== '') {
    const r = await db.query(
      'SELECT id, currency, is_active FROM accounts WHERE id = $1 AND organizer_id = $2',
      [accountId, organizerId]);
    if (r.rows.length === 0) return { account: null, source: null, warning: null, error: 'invalid account' };
    const a = r.rows[0];
    if (!a.is_active) return { account: null, source: null, warning: null, error: 'account is inactive' };
    if (a.currency !== cur) {
      return { account: null, source: null, warning: null,
        error: `account currency (${a.currency}) does not match ${what} currency (${cur})` };
    }
    return { account: { id: a.id, currency: a.currency }, source: 'explicit', warning: null, error: null };
  }
  if (officeId != null && officeId !== '') {
    const r = await db.query(
      `SELECT id, currency FROM accounts
        WHERE organizer_id = $1 AND office_id = $2 AND currency = $3
          AND is_office_default AND is_active`,
      [organizerId, officeId, cur]);
    if (r.rows.length === 1) {
      return { account: { id: r.rows[0].id, currency: r.rows[0].currency }, source: 'office_default', warning: null, error: null };
    }
  }
  return { account: null, source: null, error: null,
    warning: `No account selected and no default ${cur} account for this office — ${what} saved without a ledger entry.` };
}

// ── Kaynaklı hareket ────────────────────────────────────────────────────────
// Tutar YAZILMAZ (LED-04) — trigger kaynakla hesap/para birimi/yön tutarlılığını denetler.
const SOURCE_COL = { payment: 'payment_id', payout: 'payout_id', expense: 'expense_id' };
const SOURCE_TYPE = { payment: 'income', payout: 'payout', expense: 'expense' };

// entryDate: 'YYYY-MM-DD' metni ya da null (= DB'nin CURRENT_DATE'i; ters kayıtlar kaynak
// satırla AYNI ifadeyi kullanır). pg DATE'i JS Date'e çevirir — geri parametre olarak
// GÖNDERİLMEZ (saat dilimi kayması riski).
async function insertSourceEntry(db, { organizerId, accountId, kind, sourceId, direction, entryDate = null,
                                        reversesEntryId = null, createdBy = null }) {
  const col = SOURCE_COL[kind];
  const r = await db.query(
    `INSERT INTO ledger_entries (organizer_id, account_id, direction, entry_type, entry_date,
                                 ${col}, reverses_entry_id, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8) RETURNING id`,
    [organizerId, accountId, direction, SOURCE_TYPE[kind], entryDate, sourceId, reversesEntryId, createdBy]);
  return r.rows[0].id;
}

// Bir kaynağın hareketi (yoksa null) — ters kayıt yalnız orijinalin hareketi varsa yazılır.
async function findSourceEntry(db, kind, sourceId) {
  const r = await db.query(
    `SELECT id, account_id, direction FROM ledger_entries WHERE ${SOURCE_COL[kind]} = $1`, [sourceId]);
  return r.rows[0] || null;
}

module.exports = {
  round2, isValidDate, ledgerSchemaReady, requestUserId, requestIsOwner,
  resolveAccount, insertSourceEntry, findSourceEntry,
};
