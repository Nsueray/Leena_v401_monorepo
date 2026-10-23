// tests/ui0_compare.js — UI-0 taşıma öncesi / sonrası karşılaştırması (GERÇEK tarayıcı). npm test zincirinde
// DEĞİL: Playwright + Chromium ister (repo bağımlılığı yok). Elle koşulur, çıktı kanıt olarak defterde özetlenir.
//
//   PW=<playwright modülü> CHROME=<chromium yürütülebiliri> [BEFORE_REF=ce670ab] [OUT=<dizin>] node tests/ui0_compare.js
//
// Ne yapar: test DB'sine (ell_comm_test) ui0Seed tohumunu yazar; AYNI veri ve AYNI API'yle iki sunucu açar —
// "önce" = BEFORE_REF'teki public/ui2 (git archive), "sonra" = çalışma ağacı. Her sayfa iki sürümde açılır:
//   1) ekran görüntüsü (1280 px; "sonra" ayrıca 390 px) → OUT/shots/
//   2) <main> metninden ondalıklı sayılar (para, kur) → ÖNCE ⊆ SONRA (çoklu küme; para çifti EUR ekleyebilir,
//      ekler raporda listelenir) · contract 4 eşdeğeri (TABAN) €342.00 iki sürümde de
//   3) "sonra" 390 px'te belge ve her liste yatay kaydırmaz (scrollWidth ≤ clientWidth) — kabul 6
//   4) sayfa hatası / konsol hatası
// + uçtan uca: ui2 login (şifreli Finance kullanıcısı) → index → Finance özeti (kabul 1).
// Rapor: OUT/report.json + ekrana özet. Uyuşmazlık → çıkış kodu 1. Bitişte tohum silinir (reset).
process.env.JWT_SECRET = 'test-only-secret-not-production';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const BE = path.join(__dirname, '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const jwt = require(path.join(BE, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(BE, 'node_modules/bcrypt'));
const S = require('./helpers/ui0Seed');

if (!process.env.PW) { console.error('PW (playwright modül yolu) gerekli.'); process.exit(2); }
const { chromium } = require(process.env.PW);
const BEFORE_REF = process.env.BEFORE_REF || 'ce670ab';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'ui0_compare');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const PORT_NEW = 46021, PORT_OLD = 46022;

const money = (t) => (String(t).match(/-?\d+\.\d{2,}/g) || []);
function multisetMinus(a, b) {             // a'da olup b'de olmayanlar (çoklu küme farkı)
  const m = new Map(); b.forEach(x => m.set(x, (m.get(x) || 0) + 1));
  const out = []; a.forEach(x => { const n = m.get(x) || 0; if (n > 0) m.set(x, n - 1); else out.push(x); });
  return out;
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const beforeRoot = path.join(OUT, 'before');
  fs.rmSync(beforeRoot, { recursive: true, force: true }); fs.mkdirSync(beforeRoot, { recursive: true });
  const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: BE }).toString().trim();
  execSync(`git archive ${BEFORE_REF} backend/leena-v401-backend/public/ui2 | tar -x -C "${beforeRoot}"`, { cwd: repoRoot, shell: '/bin/bash' });
  const oldUi2 = path.join(beforeRoot, 'backend/leena-v401-backend/public/ui2');

  const appNew = S.buildApp(pool), appOld = S.buildApp(pool, { ui2Dir: oldUi2 });
  const sNew = appNew.listen(PORT_NEW), sOld = appOld.listen(PORT_OLD);
  const call = async (m, u, b, t) => {
    const o = { method: m, headers: t ? { Authorization: 'Bearer ' + t } : {} };
    if (b !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); }
    const r = await fetch(`http://127.0.0.1:${PORT_NEW}${u}`, o); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, body: j };
  };
  const report = { before_ref: BEFORE_REF, pages: [], login: null, ok: true };
  let browser;
  try {
    await S.reset(pool);
    const d = await S.seed(pool, call, jwt, process.env.JWT_SECRET);
    const ui2User = JSON.stringify({ user_id: d.ownerId, email: d.ownerEmail, name: 'UI0 Owner', token_tail: d.OWNER.slice(-16), perms: { owner: true, codes: {}, areas: [] } });
    browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
    const pages = [
      ['finance-summary.html', ''], ['finance-contracts.html', ''],
      ['finance-contract.html', '?contract=' + d.contracts.C342], ['finance-contract.html', '?contract=' + d.contracts.CTRY],
      ['finance-accounts.html', ''], ['finance-account.html', '?account=' + d.accounts.B], ['finance-account.html', '?account=' + d.accounts.T],
      ['finance-transfers.html', ''], ['finance-expenses.html', ''], ['finance-suppliers.html', ''],
      ['finance-supplier.html', '?supplier=' + d.supplier], ['finance-drafts.html', ''], ['finance-budget.html', '?expo=1'],
      ['admin-users.html', ''], ['admin-user.html', '?user=' + d.staff], ['whoami.html', ''], ['sales.html', ''], ['operations.html', ''],
    ];
    const open = async (port, file, q, viewport) => {
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript(([tok, u]) => { localStorage.setItem('token', tok); localStorage.setItem('ui2User', u); }, [d.OWNER, ui2User]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/status of 40[49]/.test(m.text())) errors.push('console: ' + m.text()); });
      const resp = await page.goto(`http://127.0.0.1:${port}/ui2/${file}${q}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !/Loading…/.test(document.querySelector('main') ? document.querySelector('main').innerText : ''), null, { timeout: 8000 }).catch(() => {});
      return { ctx, page, errors, status: resp.status() };
    };
    for (const [file, q] of pages) {
      const tag = file.replace('.html', '') + (q ? '_' + q.replace(/[?=]/g, '').replace(/-/g, '').slice(0, 20) : '');
      const o = await open(PORT_OLD, file, q, { width: 1280, height: 900 });
      const oText = await o.page.locator('main').innerText();
      await o.page.screenshot({ path: path.join(OUT, 'shots', `${tag}_before_1280.png`), fullPage: true });
      await o.ctx.close();
      const n = await open(PORT_NEW, file, q, { width: 1280, height: 900 });
      const nText = await n.page.locator('main').innerText();
      await n.page.screenshot({ path: path.join(OUT, 'shots', `${tag}_after_1280.png`), fullPage: true });
      await n.ctx.close();
      const m = await open(PORT_NEW, file, q, { width: 390, height: 844 });
      const overflow = await m.page.evaluate(() => {
        const doc = document.documentElement;
        const lists = [...document.querySelectorAll('.ui-list')].filter(el => el.scrollWidth > el.clientWidth + 1).length;
        return { doc: doc.scrollWidth - doc.clientWidth, lists };
      });
      await m.page.screenshot({ path: path.join(OUT, 'shots', `${tag}_after_390.png`), fullPage: true });
      await m.ctx.close();
      const before = money(oText), after = money(nText);
      const missing = multisetMinus(before, after), added = multisetMinus(after, before);
      const row = { page: file + q, status: [o.status, n.status], before_numbers: before.length, after_numbers: after.length,
        missing_after: missing, added_after: added, overflow_390: overflow, errors_before: o.errors, errors_after: n.errors.concat(m.errors) };
      if (file === 'finance-contract.html' && q.endsWith('=' + d.contracts.C342)) row.taban_342 = [/€342\.00/.test(oText), /€342\.00/.test(nText)];
      const bad = missing.length || overflow.doc > 0 || overflow.lists > 0 || row.errors_after.length || (row.taban_342 && !(row.taban_342[0] && row.taban_342[1]));
      if (bad) report.ok = false;
      report.pages.push(row);
      console.log(`${bad ? '❌' : '✅'} ${(file + q).padEnd(56)} sayı önce ${String(before.length).padStart(3)} · sonra ${String(after.length).padStart(3)} · eksik ${missing.length} · ek ${added.length} · 390px taşma ${overflow.doc}/${overflow.lists}` +
        (row.taban_342 ? ` · €342.00 önce ${row.taban_342[0]} sonra ${row.taban_342[1]}` : '') + (row.errors_after.length ? ' · HATA ' + JSON.stringify(row.errors_after) : ''));
    }

    // Yalnız "sonra" (önceki sürümde yok): /ui2/_sablon/ dört şablon × dört durum + yer-tutucu — 390 px'te yatay
    // kaydırma YOK (kabul 6: Liste şablonu), sayfa hatası yok.
    const tpl = ['_sablon/index.html', 'placeholder.html?id=commissions'];
    for (const t of ['list', 'detail', 'form', 'summary']) for (const s of ['data', 'empty', 'loading', 'error']) tpl.push(`_sablon/${t}.html?state=${s}`);
    for (const spec of tpl) {
      const [file, qs] = spec.split('?');
      const q = qs ? '?' + qs : '';
      const tag = 'new_' + spec.replace(/[/?=]/g, '_');
      const m = await open(PORT_NEW, file, q, { width: 390, height: 844 });
      const overflow = await m.page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lists: [...document.querySelectorAll('.ui-list')].filter(el => el.scrollWidth > el.clientWidth + 1).length,
        state: (document.querySelector('.ui-state') || { className: 'data' }).className }));
      await m.page.screenshot({ path: path.join(OUT, 'shots', `${tag}_390.png`), fullPage: true });
      await m.ctx.close();
      if (/state=data|index|placeholder/.test(spec)) {
        const w = await open(PORT_NEW, file, q, { width: 1280, height: 900 });
        await w.page.screenshot({ path: path.join(OUT, 'shots', `${tag}_1280.png`), fullPage: true });
        await w.ctx.close();
      }
      const bad = overflow.doc > 0 || overflow.lists > 0 || m.errors.length > 0;
      if (bad) report.ok = false;
      report.pages.push({ page: spec, only_after: true, overflow_390: overflow, errors_after: m.errors });
      console.log(`${bad ? '❌' : '✅'} ${spec.padEnd(56)} (yalnız sonra) 390px taşma ${overflow.doc}/${overflow.lists} · ${overflow.state}` + (m.errors.length ? ' · HATA ' + JSON.stringify(m.errors) : ''));
    }

    // Kabul 1 — uçtan uca: ui2 login → index → Finance özeti (şifreli Finance kullanıcısı)
    await pool.query('UPDATE users SET password_hash = $2, password_must_change = false WHERE id = $1', [d.staff, await bcrypt.hash('ui0-pass-123', 4)]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_NEW}/ui2/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#email', 'staff' + S.SFX); await page.fill('#password', 'ui0-pass-123');
    await Promise.all([page.waitForURL(/finance-summary\.html/, { timeout: 10000 }).catch(() => {}), page.click('button[type=submit]')]);
    await page.waitForLoadState('networkidle');
    const landed = page.url();
    const tabs = await page.locator('.domain-tab .d-main').allInnerTexts();
    const groups = await page.locator('.subnav-glabel').allTextContents();
    await page.screenshot({ path: path.join(OUT, 'shots', 'login_landing_after_1280.png'), fullPage: true });
    // /ui2/ dizin girişi de aynı yere iner (Owner oturumu)
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(([tok, u]) => { localStorage.setItem('token', tok); localStorage.setItem('ui2User', u); }, [d.OWNER, ui2User]);
    const p2 = await ctx2.newPage();
    await p2.goto(`http://127.0.0.1:${PORT_NEW}/ui2/`, { waitUntil: 'networkidle' });
    await p2.waitForURL(/finance-summary\.html/, { timeout: 8000 }).catch(() => {});
    report.login = { landed, tabs, groups, dir_entry: p2.url() };
    const loginOk = /\/ui2\/finance-summary\.html$/.test(landed) && JSON.stringify(tabs) === '["Finance"]' &&
      JSON.stringify(groups) === '["Executive","Contracts","Money","Expo Finance"]' && /\/ui2\/finance-summary\.html$/.test(p2.url());
    if (!loginOk) report.ok = false;
    console.log(`${loginOk ? '✅' : '❌'} kabul 1: login → ${landed.replace(/^https?:\/\/[^/]+/, '')} · sekmeler ${JSON.stringify(tabs)} · gruplar ${JSON.stringify(groups)} · /ui2/ → ${p2.url().replace(/^https?:\/\/[^/]+/, '')}`);
    await ctx.close(); await ctx2.close();
  } catch (e) {
    report.ok = false; report.error = String(e && e.stack || e);
    console.error('KARŞILAŞTIRMA HATASI:', e);
  } finally {
    if (browser) await browser.close();
    await S.reset(pool).catch(() => {});
    sNew.close(); sOld.close(); await pool.end();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n═══ UI0 COMPARE: ${report.ok ? 'UYUŞTU' : 'UYUŞMAZLIK VAR'} · rapor ${path.join(OUT, 'report.json')} · görüntüler ${path.join(OUT, 'shots')} ═══`);
  process.exit(report.ok ? 0 : 1);
}
main();
