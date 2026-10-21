// utils/bootGuards.js — açılış korumaları (staging hazırlık, Sentez 21 Eki)
//
// ── HÜKÜMLER ──
// - Koda "staging ise" dalı YAZILMAZ; fark yalnız env. Her iki değişken de canlı env'de
//   YOK → canlı davranış değişmez (yalnız current_database() satırı loglanır).
// - EXPECTED_DB_NAME: tanımlıysa bağlanılan veritabanının adı buna EŞİT olmalı; değilse ya
//   da ad okunamazsa (sorgu hatası) sonuç ok=false → index.js process'i durdurur
//   (fail closed). Amaç: staging servisinin env'i yanlışlıkla canlı DB'yi gösterirse
//   hiçbir istek karşılanmadan çökmek.
// - CORS_EXTRA_ORIGINS: virgülle ayrılmış TAM origin listesi (şema + host [+ port], yol
//   YOK). index.js'teki sabit izin listesine EKLENİR, onu değiştirmez. Geçersiz öğe
//   sessizce değil, uyarıyla atlanır.

// Döner: { ok, actual, expected, error }. Asla reject etmez.
async function checkDatabaseName(pool, expected) {
  const want = typeof expected === 'string' && expected.trim() !== '' ? expected.trim() : null;
  try {
    const r = await pool.query('SELECT current_database() AS db');
    const actual = r.rows[0].db;
    return { ok: want === null || actual === want, actual, expected: want, error: null };
  } catch (err) {
    // Beklenen ad varsa doğrulanamayan bağlantı = başarısız; yoksa davranış değişmez.
    return { ok: want === null, actual: null, expected: want, error: err.message };
  }
}

// "https://a.example.com, http://localhost:3456" → ['https://a.example.com', 'http://localhost:3456']
function parseExtraOrigins(raw, warn = console.warn) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const out = [];
  for (const item of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    let u;
    try { u = new URL(item); } catch (_) { u = null; }
    if (!u || !/^https?:$/.test(u.protocol) || item.replace(/\/$/, '') !== u.origin) {
      warn(`[bootGuards] CORS_EXTRA_ORIGINS: ignored invalid origin "${item}"`);
      continue;
    }
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}

module.exports = { checkDatabaseName, parseExtraOrigins };
