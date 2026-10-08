// tests/helpers/resetLineItems.js — test temizliği için contract_line_items silme.
// 034 (Sentez K-D) bu tabloda UPDATE/DELETE/TRUNCATE'i reddeder; kaçış anahtarı
// `ell.allow_line_item_reset` YALNIZ bu transaction süresince açılır (SET LOCAL),
// COMMIT/ROLLBACK ile kendiliğinden kapanır. Ürün kodunda bu anahtar YOKTUR.
module.exports = async function resetLineItems(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ell.allow_line_item_reset = 'on'");
    await c.query('DELETE FROM contract_line_items');
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
};
