#!/usr/bin/env node
/* ============================================================================
 * scripts/import-zoho-agents.js — Zoho Sales Agents → LEENA sales_agents
 * ----------------------------------------------------------------------------
 * TEK SEFERLİK IMPORT — SYNC DEĞİL. Bir kez koşulur; sonrasında agent modülü
 * LEENA-canonical olur (D3 canonical istisnası): Zoho agent modülü DONUK kabul
 * edilir, agent'lar bundan sonra LEENA UI/seed ile yönetilir. Bu script bir
 * cron/scheduler'a bağlanmamalıdır.
 *
 * İdempotent (D4): INSERT ... ON CONFLICT (zoho_record_id) DO NOTHING. Tekrar
 * koşarsa mevcut kayıtları ASLA UPDATE etmez — yalnız yeni Zoho kayıtlarını ekler.
 *
 * ÜÇ MOD:
 *   --probe    Zoho'ya bakar, hiçbir yere YAZMAZ. Alan/değer keşfi. Mühür
 *              GEREKMEZ — mühürü doldurmak için bu adım koşulur.
 *   --dry-run  Zoho'dan çeker + dönüştürür + raporlar. DB'ye YAZMAZ. Mühür şart.
 *   --import   Gerçek yazım (tek transaction). Mühür şart.
 *
 * Bağımsız: harici npm bağımlılığı yok (native fetch, Node 18+; pg zaten repoda).
 * ENV — Zoho: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 *       DB  : DATABASE_URL || DATABASE_INTERNAL_URL || PG* (utils/db.js deseni)
 * .env DEĞERLERİ burada okunmaz/basılmaz.
 * ============================================================================ */

'use strict';
const { Pool } = require('pg');

// ── MÜHÜR GUARD'I ───────────────────────────────────────────────────────────
// Alan adı TAHMİNİYLE import imkânsız olsun: probe çıktısına bakıp aşağıyı
// doldurun, sonra MAPPING_SEALED = true yapın. Değerler '?' iken --dry-run ve
// --import reddeder.
const MAPPING_SEALED = false;
const FIELDS = {
  name:     '?',   // Zoho alan adı → sales_agents.name
  type:     '?',   // → TYPE_MAP ile agent_type
  pct:      '?',   // → default_commission_pct
  email:    '?',   // → email
  group:    '?',   // → sales_group
  currency: '?',   // → commission_currency
  active:   '?',   // → is_active (aşağıdaki ACTIVE_TRUE_VALUES ile)
  company:  '?',   // → agent_company
  id:       'id',  // Zoho kayıt id'si → zoho_record_id (v2'de her zaman 'id')
};
// Zoho'daki hangi "active" değerleri true sayılır (probe DISTINCT'inden doldurun).
// Boolean true daima aktif kabul edilir; string değerler buraya (küçük harf).
const ACTIVE_TRUE_VALUES = ['true', 'active', 'yes', 'aktif'];

// ── DÖNÜŞÜM SABİTLERİ (Sentez kilitli — TYPE_MAP dışında değiştirmeyin) ──────
const TYPE_MAP = {
  'Employee':    'internal',            // 021 v1.2: user_id NULL geçerli
  'Sales Agent': 'external_freelance',
  'Partner':     'external_agency',
};

// ── Zoho auth (eliza/packages/zoho-sync/zohoAuth.js deseni) ─────────────────
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const API_BASE  = 'https://www.zohoapis.com/crm/v2';

async function getAccessToken() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Missing Zoho OAuth credentials (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN).');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  if (!res.ok) throw new Error(`Zoho token refresh failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token refresh returned no access_token.`);
  console.log('✓ Zoho access token refreshed');
  return data.access_token;
}

async function zohoGet(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: 'Zoho-oauthtoken ' + token },
  });
  if (res.status === 204) return { data: [], info: {} }; // Zoho: no content
  if (!res.ok) throw new Error(`Zoho GET ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Sayfalı çekme (syncExpos.js deseni: ?page&per_page=200, info.more_records)
async function fetchAllRecords(moduleApiName, token) {
  const all = [];
  let page = 1, hasMore = true;
  while (hasMore) {
    const body = await zohoGet(`/${moduleApiName}?page=${page}&per_page=200`, token);
    const records = body.data || [];
    all.push(...records);
    console.log(`  page ${page}: ${records.length} record`);
    hasMore = body.info && body.info.more_records;
    page++;
  }
  return all;
}

// ── DB pool (DATABASE_URL || DATABASE_INTERNAL_URL || PG*) ───────────────────
function makePool() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_INTERNAL_URL;
  if (url) {
    return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  if (!process.env.PGHOST && !process.env.PGDATABASE) {
    throw new Error('No DB connection: set DATABASE_URL / DATABASE_INTERNAL_URL or PG* variables.');
  }
  return new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'leena_v401',
    password: process.env.PGPASSWORD || '',
    port: process.env.PGPORT || 5432,
    ssl: { rejectUnauthorized: false },
  });
}

// ── Maskeleme (probe çıktısı) ────────────────────────────────────────────────
function maskEmail(v) {
  if (typeof v !== 'string' || !v.includes('@')) return v == null ? v : '***';
  const [u, d] = v.split('@');
  return `${u[0] || ''}***@***${d.slice(d.lastIndexOf('.'))}`;
}
function maskValue(key, v) {
  if (v == null) return v;
  const k = key.toLowerCase();
  if (k.includes('email') || k.includes('mail')) return maskEmail(String(v));
  if (k.includes('phone') || k.includes('mobile') || k.includes('tel')) {
    const s = String(v); return s.length <= 4 ? '***' : s.slice(0, 2) + '***' + s.slice(-2);
  }
  return v;
}

// ── PROBE ────────────────────────────────────────────────────────────────────
async function runProbe(token, moduleArg) {
  console.log('\n=== PROBE — modül keşfi ===');
  const mods = await zohoGet('/settings/modules', token);
  const candidates = (mods.modules || [])
    .filter(m => /agent/i.test(m.api_name || '') || /agent/i.test(m.module_name || ''))
    .map(m => `${m.api_name}  (label: ${m.module_name}${m.api_supported === false ? ', API DESTEKSİZ' : ''})`);
  console.log('Modül adayları (/agent/i):');
  console.log(candidates.length ? candidates.map(c => '  - ' + c).join('\n') : '  (eşleşme yok)');

  const targetModule = moduleArg || 'Sales_Agents';
  console.log(`\n=== PROBE — hedef modül: ${targetModule} ===`);
  console.log('(farklı modül için: --module=<api_name>)');

  let records;
  try {
    records = await fetchAllRecords(targetModule, token);
  } catch (e) {
    console.log(`\n⚠️  '${targetModule}' çekilemedi: ${e.message}`);
    console.log('Yukarıdaki modül adaylarından doğru api_name ile --module=... verin.');
    return;
  }

  console.log(`\nToplam kayıt: ${records.length}`);
  if (!records.length) return;

  // Alan adlarının TAM birleşimi
  const keyUnion = new Set();
  records.forEach(r => Object.keys(r).forEach(k => keyUnion.add(k)));
  const keys = [...keyUnion].sort();
  console.log(`\nAlan adları (key union, ${keys.length}):`);
  console.log('  ' + keys.join(', '));

  // Düşük-kardinaliteli (kategorik) alanların DISTINCT değer+adetleri —
  // Type / Sales Group / Currency / Active bu listede otomatik görünür.
  console.log('\nKategorik alanlar (≤25 distinct değer) — DISTINCT + adet:');
  keys.forEach(k => {
    const counts = new Map();
    let nonNull = 0;
    for (const r of records) {
      const v = r[k];
      if (v == null || v === '') continue;
      nonNull++;
      const key = typeof v === 'object' ? (v.name || JSON.stringify(v)) : String(v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (counts.size === 0 || counts.size > 25) return;
    const typeHint = /type|category|role|kind/i.test(k) ? '  ← TYPE adayı' : '';
    console.log(`  • ${k} (${nonNull} dolu, ${counts.size} distinct)${typeHint}`);
    [...counts.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([val, n]) => console.log(`      ${JSON.stringify(val)}: ${n}`));
  });

  // İlk kaydın tam dökümü — email/telefon MASKELİ
  console.log('\nİlk kayıt (email/telefon maskeli):');
  const first = records[0];
  const masked = {};
  Object.keys(first).sort().forEach(k => { masked[k] = maskValue(k, first[k]); });
  console.log(JSON.stringify(masked, null, 2));

  console.log('\n=== PROBE SONU — FIELDS ve ACTIVE_TRUE_VALUES\'ı doldurup MAPPING_SEALED=true yapın ===');
}

// ── DÖNÜŞÜM (Sentez kilitli) ─────────────────────────────────────────────────
function pick(record, fieldName) {
  const v = record[fieldName];
  if (v && typeof v === 'object') return v.name != null ? v.name : (v.id != null ? v.id : null);
  return v;
}

function transform(records) {
  const rows = [];
  const skipped = { noName: 0, unknownType: {} , unknownTypeNames: {} };
  const notes = { pctNulled: [], currencyNulled: [] };

  for (const rec of records) {
    const rawName = pick(rec, FIELDS.name);
    const name = (rawName == null ? '' : String(rawName)).trim();
    if (!name) { skipped.noName++; continue; }

    const rawType = pick(rec, FIELDS.type);
    const typeKey = rawType == null ? '' : String(rawType).trim();
    const agent_type = TYPE_MAP[typeKey];
    if (!agent_type) {
      skipped.unknownType[typeKey] = (skipped.unknownType[typeKey] || 0) + 1;
      (skipped.unknownTypeNames[typeKey] = skipped.unknownTypeNames[typeKey] || []).push(name);
      continue;
    }

    // pct
    let pct = null;
    const rawPct = pick(rec, FIELDS.pct);
    if (rawPct != null && rawPct !== '') {
      const n = Number(rawPct);
      if (!isFinite(n) || n < 0 || n > 100) notes.pctNulled.push(`${name}: ${rawPct}`);
      else pct = n;
    }

    // email / group / company
    const email = FIELDS.email !== '?' ? normStr(pick(rec, FIELDS.email), true) : null;
    const sales_group = FIELDS.group !== '?' ? normStr(pick(rec, FIELDS.group)) : null;
    const agent_company = FIELDS.company !== '?' ? normStr(pick(rec, FIELDS.company)) : null;

    // currency: 3 harf uppercase, değilse NULL + rapor
    let currency = null;
    if (FIELDS.currency !== '?') {
      const rawCur = pick(rec, FIELDS.currency);
      if (rawCur != null && rawCur !== '') {
        const c = String(rawCur).trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(c)) currency = c;
        else notes.currencyNulled.push(`${name}: ${rawCur}`);
      }
    }

    // active: truthy eşleme
    let is_active = true;
    if (FIELDS.active !== '?') {
      const rawAct = pick(rec, FIELDS.active);
      if (rawAct === true) is_active = true;
      else if (rawAct === false) is_active = false;
      else if (rawAct != null) is_active = ACTIVE_TRUE_VALUES.includes(String(rawAct).trim().toLowerCase());
    }

    rows.push({
      organizer_id: 1,
      name, agent_type,
      default_commission_pct: pct,
      email, sales_group, agent_company,
      commission_currency: currency,
      is_active,
      zoho_record_id: String(pick(rec, FIELDS.id)),
    });
  }
  return { rows, skipped, notes };
}
function normStr(v, lower) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return lower ? s.toLowerCase() : s;
}

// ── DRY-RUN / IMPORT ────────────────────────────────────────────────────────
function printSummary(fetched, rows, skipped, notes, wrote) {
  console.log('\n=== ÖZET ===');
  console.log(`Çekilen (Zoho)      : ${fetched}`);
  console.log(`Dönüştürülen (aday) : ${rows.length}`);
  if (wrote != null) {
    console.log(`Yazılan (INSERT)    : ${wrote.inserted}`);
    console.log(`DO NOTHING (mevcut) : ${wrote.conflicted}`);
  }
  console.log(`Atlanan — isim boş  : ${skipped.noName}`);
  const ut = Object.entries(skipped.unknownType);
  console.log(`Atlanan — bilinmeyen type: ${ut.reduce((s, [, n]) => s + n, 0)}`);
  ut.forEach(([val, n]) => {
    console.log(`    ${JSON.stringify(val)}: ${n}  → ${(skipped.unknownTypeNames[val] || []).join(', ')}`);
  });
  if (notes.pctNulled.length) console.log(`pct NULL'landı (${notes.pctNulled.length}): ${notes.pctNulled.join(' | ')}`);
  if (notes.currencyNulled.length) console.log(`currency NULL'landı (${notes.currencyNulled.length}): ${notes.currencyNulled.join(' | ')}`);
  if (ut.length) console.log('\n⚠️  Bilinmeyen type değerleri Suer kararına dönecek (TYPE_MAP genişletilecek mi / atlansın mı).');
}

async function runImport(token, moduleArg, write) {
  const targetModule = moduleArg || 'Sales_Agents';
  console.log(`\n=== ${write ? 'IMPORT' : 'DRY-RUN'} — modül: ${targetModule} ===`);
  const records = await fetchAllRecords(targetModule, token);
  const { rows, skipped, notes } = transform(records);

  if (!write) { printSummary(records.length, rows, skipped, notes, null); return; }

  const pool = makePool();
  const client = await pool.connect();
  let inserted = 0, conflicted = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const res = await client.query(
        `INSERT INTO sales_agents
           (organizer_id, name, agent_type, default_commission_pct,
            email, sales_group, agent_company, commission_currency,
            is_active, zoho_record_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (zoho_record_id) WHERE zoho_record_id IS NOT NULL DO NOTHING`,
        [r.organizer_id, r.name, r.agent_type, r.default_commission_pct,
         r.email, r.sales_group, r.agent_company, r.commission_currency,
         r.is_active, r.zoho_record_id]
      );
      if (res.rowCount === 1) inserted++; else conflicted++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  printSummary(records.length, rows, skipped, notes, { inserted, conflicted });
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const mode = args.find(a => ['--probe', '--dry-run', '--import'].includes(a));
  const moduleArg = (args.find(a => a.startsWith('--module=')) || '').split('=')[1] || null;

  if (!mode) {
    console.error('Kullanım: node scripts/import-zoho-agents.js --probe [--module=<api_name>] | --dry-run | --import');
    process.exit(1);
  }

  // Mühür guard'ı: dry-run ve import mühürsüz REDDEDER. probe serbest.
  if ((mode === '--dry-run' || mode === '--import') && !MAPPING_SEALED) {
    console.error('Run --probe first; mapping not sealed. (MAPPING_SEALED=false)');
    process.exit(1);
  }

  try {
    const token = await getAccessToken();
    if (mode === '--probe')        await runProbe(token, moduleArg);
    else if (mode === '--dry-run') await runImport(token, moduleArg, false);
    else if (mode === '--import')  await runImport(token, moduleArg, true);
  } catch (e) {
    console.error('HATA:', e.message);
    process.exit(1);
  }
})();
