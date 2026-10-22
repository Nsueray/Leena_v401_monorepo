// ----------------------------------------------------------------------------
// utils/ledger.js — ledger ortak kuralları (Paket 1). TEK KAYNAK:
//   - hesap çözümü (ödeme / payout / gider aynı kuralı kullanır — OFS-05 sınıfı borç doğmasın)
//   - kaynaklı hareket yazımı (payment / payout / expense → ledger_entries)
//   - şema hazır mı (deploy migration'dan ÖNCE: eski davranış birebir sürer)
//   - istekteki kullanıcı (JWT user_id; klasik organizer token'ında yok → NULL)
//   - gider yazımı (Paket 1b: POST /api/ledger/expenses ve taslak kabulü AYNI fonksiyon)
//   - tedarikçi ad eşleşmesi (öneri; atama değil — OFS-05)
// ----------------------------------------------------------------------------
const jwt = require('jsonwebtoken');

const METHODS = ['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'];   // SEM-01 / LED-01
const SUPPLIER_TYPES = ['supplier', 'venue', 'contractor', 'other'];             // 041 CHECK ile aynı

// round2 / isValidDate — contracts.js:546-555 emsali birebir (payouts.js de aynı kopyayı taşır).
function round2(n) {
  return Math.round(n * 100) / 100;
}
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function isIntLike(v) {
  return v != null && v !== '' && /^\d+$/.test(String(v));
}

// Tutar + kur doğrulaması (contracts.js POST /:id/payments guard'larıyla aynı kurallar).
function parseMoney(b, { amountKey = 'amount', rateKey = 'exchange_rate', currency }) {
  const amount = Number(b[amountKey]);
  if (b[amountKey] == null || b[amountKey] === '' || !isFinite(amount) || amount <= 0) {
    return { error: `${amountKey} must be a number greater than 0.` };
  }
  const rate = Number(b[rateKey]);
  if (b[rateKey] == null || b[rateKey] === '' || !isFinite(rate) || rate <= 0) {
    return { error: `${rateKey} must be a number greater than 0.` };
  }
  if (currency === 'EUR' && rate !== 1) return { error: `${rateKey} must be 1 when currency is EUR.` };
  return { amount, rate, amount_eur: round2(amount * rate) };
}

async function activeAccount(db, organizerId, id) {
  if (!isIntLike(id)) return null;
  const r = await db.query(
    'SELECT id, name, currency, account_type, office_id, is_active, created_by::text AS created_by FROM accounts WHERE id = $1 AND organizer_id = $2',
    [id, organizerId]);
  return r.rows[0] || null;
}
async function expoOfOrganizer(db, organizerId, expoId) {
  if (!isIntLike(expoId)) return null;
  const r = await db.query('SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2', [expoId, organizerId]);
  return r.rows[0] || null;
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

// Paket 1b parçaları (041 suppliers, 042 expense_drafts) — aynı kural: yalnız OLUMLU önbellek.
// Deploy → migrate arasında gider akışı tedarikçisiz (bugünkü haliyle) sürer.
const FEATURE_SQL = {
  suppliers: `SELECT to_regclass('public.suppliers') IS NOT NULL
                 AND EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public' AND table_name = 'expenses'
                                AND column_name = 'supplier_id') AS ok`,
  drafts: `SELECT to_regclass('public.expense_drafts') IS NOT NULL AS ok`,
};
const featureCache = {};
async function featureReady(db, name) {
  if (featureCache[name]) return true;
  const r = await db.query(FEATURE_SQL[name]);
  featureCache[name] = r.rows[0].ok === true;
  return featureCache[name];
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

// ── Gider yazımı (L-3 + P1b) — TEK doğrulama yolu ──────────────────────────
// POST /api/ledger/expenses ve taslak kabulü (routes/expenseDrafts.js) bunu çağırır.
// Çağıran transaction içindedir (BEGIN/COMMIT onda). Döner: { error } ya da
// { expense, ledger_entry_id }. Hata sırası ve metinleri Paket 1 ucuyla birebir.
// canUseAccount (Paket 2, isteğe bağlı): yetki kapsamı denetimi — hesap bulununca çağrılır;
// false → { error, code: 'OUT_OF_SCOPE' } (çağıran 409 döner). Verilmezse eski davranış.
async function createExpense(db, { organizerId, body, actor = null, canUseAccount = null }) {
  const b = body || {};
  if (!isIntLike(b.expense_type_id)) return { error: 'expense_type_id is required.' };
  if (!isIntLike(b.account_id)) return { error: 'account_id is required.' };
  if (!isValidDate(b.expense_date)) return { error: 'expense_date is required and must be a valid YYYY-MM-DD date.' };
  if (!METHODS.includes(b.payment_method)) return { error: `payment_method must be one of: ${METHODS.join(', ')}` };
  const document_url = trimOrNull(b.document_url);
  if (document_url && !/^https?:\/\//i.test(document_url)) return { error: 'document_url must start with http:// or https://' };

  const acc = await activeAccount(db, organizerId, b.account_id);
  if (!acc) return { error: 'invalid account' };
  if (canUseAccount && !canUseAccount(acc)) return { error: 'This record is outside your permission scope.', code: 'OUT_OF_SCOPE' };
  if (!acc.is_active) return { error: 'account is inactive' };
  // Para birimi = hesabın para birimi (LED-11); verildiyse eşleşmeli.
  const currency = b.currency ? String(b.currency).trim().toUpperCase() : acc.currency;
  if (currency !== acc.currency) {
    return { error: `account currency (${acc.currency}) does not match expense currency (${currency})` };
  }
  const m = parseMoney(b, { currency });
  if (m.error) return { error: m.error };
  const ty = await db.query(
    `SELECT t.id FROM expense_types t JOIN expense_categories c ON c.id = t.category_id
      WHERE t.id = $1 AND t.organizer_id = $2 AND t.is_active AND c.is_active`, [b.expense_type_id, organizerId]);
  if (!ty.rows.length) return { error: 'invalid or inactive expense type' };
  let expo = null;
  if (b.expo_id != null && b.expo_id !== '') {
    expo = await expoOfOrganizer(db, organizerId, b.expo_id);
    if (!expo) return { error: 'invalid expo' };
  }
  // Tedarikçi (P1b-1): seçilmişse aynı kiracıda ve aktif olmalı. Migration öncesi seçilemez.
  const supReady = await featureReady(db, 'suppliers');
  let supplierId = null;
  if (b.supplier_id != null && b.supplier_id !== '') {
    if (!supReady) return { error: 'Suppliers are not available yet — save the expense without a supplier.' };
    const s = isIntLike(b.supplier_id)
      ? await db.query('SELECT id, is_active FROM suppliers WHERE id = $1 AND organizer_id = $2', [b.supplier_id, organizerId])
      : { rows: [] };
    if (!s.rows.length) return { error: 'invalid supplier' };
    if (!s.rows[0].is_active) return { error: 'supplier is inactive' };
    supplierId = s.rows[0].id;
  }
  const cols = ['organizer_id', 'expense_type_id', 'amount', 'currency', 'exchange_rate', 'amount_eur',
                'account_id', 'expo_id', 'counterparty', 'expense_date', 'payment_method', 'notes',
                'document_url', 'created_by'];
  const vals = [organizerId, b.expense_type_id, m.amount, currency, m.rate, m.amount_eur, acc.id,
                expo ? expo.id : null, trimOrNull(b.counterparty), b.expense_date, b.payment_method,
                trimOrNull(b.notes), document_url, actor];
  if (supReady) { cols.push('supplier_id'); vals.push(supplierId); }
  const e = await db.query(
    `INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals);
  const entryId = await insertSourceEntry(db, {
    organizerId, accountId: acc.id, kind: 'expense', sourceId: e.rows[0].id,
    direction: 'out', entryDate: b.expense_date, createdBy: actor,
  });
  return { expense: e.rows[0], ledger_entry_id: entryId };
}

// ── Tedarikçi ad eşleşmesi (P1b-3) — basit normalize + ILIKE; ÖNERİDİR ────────
// Otomatik atama YOK (OFS-05: öneri kilit değildir). Skor 0..1: normalize eşit = 1;
// biri diğerini içeriyorsa kısa/uzun oranı; değilse kelime örtüşmesi (Jaccard).
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function nameScore(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  let s = 0;
  if (x.includes(y) || y.includes(x)) s = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  const inter = [...tx].filter(t => ty.has(t)).length;
  s = Math.max(s, inter / new Set([...tx, ...ty]).size);
  return Math.round(s * 1000) / 1000;
}
async function matchSuppliers(db, organizerId, name, { limit = 5, includeInactive = false } = {}) {
  const tokens = normalizeName(name).split(' ').filter(t => t.length >= 2);
  if (!tokens.length) return [];
  const r = await db.query(
    `SELECT id, name, supplier_type, country_code, is_active FROM suppliers
      WHERE organizer_id = $1 ${includeInactive ? '' : 'AND is_active'} AND name ILIKE ANY ($2::text[])`,
    [organizerId, tokens.map(t => `%${t}%`)]);
  return r.rows.map(s => ({ ...s, score: nameScore(name, s.name) }))
    .filter(s => s.score > 0)
    .sort((p, q) => q.score - p.score || p.id - q.id)
    .slice(0, limit);
}

module.exports = {
  METHODS, SUPPLIER_TYPES,
  round2, isValidDate, trimOrNull, isIntLike, parseMoney, activeAccount, expoOfOrganizer,
  ledgerSchemaReady, featureReady, requestUserId, requestIsOwner,
  resolveAccount, insertSourceEntry, findSourceEntry,
  createExpense, normalizeName, nameScore, matchSuppliers,
};
