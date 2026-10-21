/**
 * ui2 ledger ekranlarının ortak yardımcıları (Paket 1). Yükleme: leena-fetch.js + shell.js'ten SONRA.
 * İskelet — cila yok. Sayılar sunucudan geldiği gibi gösterilir; istemci bakiye HESAPLAMAZ (D2, RAP-02).
 */
(function () {
  'use strict';
  var L = window.ui2L = {};

  L.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  L.dash = function (v) { return (v == null || v === '') ? '—' : L.esc(v); };
  L.money = function (v, cur) { return (v == null || v === '') ? '—' : (cur ? L.esc(cur) + ' ' : '') + L.esc(v); };
  L.eur = function (v) { return (v == null || v === '') ? '—' : '€' + L.esc(v); };
  // Yerel takvim günü (YYYY-MM-DD) — tarih alanlarının varsayılanı.
  L.today = function () {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  L.qs = function (k) { return new URLSearchParams(location.search).get(k); };

  // leenaFetch sarmalı: { status, body }. 401/403 → leena-fetch oturumu kapatır; /ui2'den mutlak login.
  L.api = function (method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.leenaFetch(url, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) { return { status: res.status, body: j }; });
    }).catch(function (err) {
      if (err && err.status === 401) { window.location.href = '/login.html'; }
      throw err;
    });
  };

  L.options = function (list, valueOf, labelOf, selected, emptyLabel) {
    var out = emptyLabel != null ? ['<option value="">' + L.esc(emptyLabel) + '</option>'] : [];
    (list || []).forEach(function (x) {
      var v = String(valueOf(x));
      out.push('<option value="' + L.esc(v) + '"' + (String(selected) === v ? ' selected' : '') + '>' + L.esc(labelOf(x)) + '</option>');
    });
    return out.join('');
  };

  var TYPE_CHIP = { bank: 'chip-info', cash: 'chip-pos', virtual: 'chip-signal',
                    income: 'chip-pos', expense: 'chip-warn', payout: 'chip-warn', transfer: 'chip-neutral', refund: 'chip-dang' };
  L.chip = function (t) { return '<span class="chip ' + (TYPE_CHIP[t] || 'chip-neutral') + '">' + L.esc(t) + '</span>'; };

  // Form mesajı (inline) — toast yok; hata/uyarı aynı yerde, okunur kalır.
  L.say = function (el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'error' ? 'var(--dang)' : kind === 'warn' ? 'var(--warn)' : 'var(--pos)';
  };
  L.formJson = function (form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled && el.type !== 'hidden') return;
      if (el.type === 'checkbox') { o[el.name] = el.checked; return; }
      if (el.value !== '') o[el.name] = el.value;
    });
    return o;
  };

  L.guard = function (root) {
    if (typeof window.ui2CanSee === 'function' && !window.ui2CanSee('finance')) {
      root.innerHTML = '<div class="lg-empty">You do not have access to Finance.</div>';
      return false;
    }
    return true;
  };
  // 503 = ledger migration'ı henüz koşulmadı (routes/ledger.js kapısı).
  L.httpError = function (root, r, what) {
    var msg = r.status === 503 ? 'Ledger is not migrated yet — run scripts/migrate.js.'
      : 'Could not load ' + what + ' (HTTP ' + r.status + (r.body && r.body.error ? ': ' + r.body.error : '') + ').';
    root.innerHTML = '<div class="lg-empty">' + L.esc(msg) + '</div>';
  };

  L.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  };
})();
