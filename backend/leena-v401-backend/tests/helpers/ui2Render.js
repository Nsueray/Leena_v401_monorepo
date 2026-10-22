// tests/helpers/ui2Render.js — bir ui2 sayfasını TARAYICISIZ çizer (DB'li test sunucusuna karşı).
// Sayfanın <script> sırası aynen koşulur (leena-fetch.js → shell.js → components.js → … → satır içi betik),
// gerçek fetch test sunucusuna gider; DOMContentLoaded tetiklenir, ağ boşalınca #ui-root'un HTML'i döner.
// Sahte DOM yalnız sayfaların İLK ÇİZİMDE kullandığı yüzeydir (getElementById, innerHTML/outerHTML,
// addEventListener). Tıklama/gönderme akışı burada ölçülmez (Playwright karşılaştırması: tests/ui0_compare.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

// Sahte öğe: tanımsız alan okunursa (f.amount, f.exchange_rate …) yine sahte öğe döner — form alanlarına
// dokunan ilk-çizim kodu (sync) çökmez. Değer atamaları saklanır.
function fakeEl(id) {
  const base = {
    id, _html: '', _outer: null, textContent: '', className: '', hidden: false, value: '', dataset: {}, style: {}, readOnly: false,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get outerHTML() { return this._outer; }, set outerHTML(v) { this._outer = String(v); },
    addEventListener() {}, querySelectorAll() { return []; }, focus() {}, elements: [],
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t || typeof k !== 'string') return t[k];
      t[k] = fakeEl(k);
      return t[k];
    },
  });
}

// HTML metni → okunur metin (etiket sil, varlık çöz, boşluk sıkıştır).
function textOf(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// opts: { origin: 'http://127.0.0.1:PORT', page: 'ui2/finance-summary.html', query: '?x=1', storage: {token, ui2User}, root?: string, timeoutMs }
async function renderPage(opts) {
  const file = path.join(PUBLIC, opts.page);
  const html = fs.readFileSync(file, 'utf8');
  const hasBase = /<base href="\/ui2\/">/.test(html);
  const baseDir = hasBase ? path.join(PUBLIC, 'ui2') : path.dirname(file);
  const scripts = [...html.matchAll(/<script(?:\s+src="([^"]+)")?>([\s\S]*?)<\/script>/g)].map(m => (
    m[1] ? { src: m[1], code: fs.readFileSync(m[1].startsWith('/') ? path.join(PUBLIC, m[1]) : path.join(baseDir, m[1]), 'utf8') } : { src: '(inline)', code: m[2] }));

  const store = Object.assign({}, opts.storage || {});
  const els = {};
  const docListeners = [];
  let pending = 0;
  const errors = [];
  const hostFetch = (url, o) => {
    const abs = /^https?:/.test(url) ? url : opts.origin + (String(url).startsWith('/') ? url : '/ui2/' + url);
    pending++;
    return fetch(abs, o).finally(() => { pending--; });
  };
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    setTimeout, clearTimeout, AbortController, URLSearchParams, atob, fetch: hostFetch,
    localStorage: { getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search: opts.query || '', hash: '', pathname: '/' + opts.page, href: opts.origin + '/' + opts.page + (opts.query || ''), replace() {} },
    history: { replaceState() {} },
    alert() {}, confirm() { return false; },
    document: {
      readyState: 'loading',
      documentElement: { setAttribute() {} },
      addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') docListeners.push(fn); },
      getElementById: id => (els[id] = els[id] || fakeEl(id)),
      querySelectorAll: () => [],
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const s of scripts) {
    try { vm.runInContext(s.code, ctx, { filename: s.src }); } catch (e) { errors.push(s.src + ': ' + e.message); }
  }
  ctx.document.readyState = 'complete';
  for (const fn of docListeners) { try { fn(); } catch (e) { errors.push('DOMContentLoaded: ' + e.message); } }
  const rootId = opts.root || 'ui-root';
  const deadline = Date.now() + (opts.timeoutMs || 8000);
  let idle = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 25));
    const loading = /ui-state-loading/.test((els[rootId] || {})._html || '');
    idle = (pending === 0 && !loading) ? idle + 1 : 0;
    if (idle >= 3) break;
  }
  const root = els[rootId] || fakeEl(rootId);
  return { html: root._html, text: textOf(root._html), nav: (els['ui2-nav'] || {})._outer, subnav: (els['ui2-subnav'] || {})._outer, errors, store };
}

module.exports = { renderPage, textOf };
