/**
 * ui2 Finance ekranlarının ortak VERİ yardımcıları (Paket 1). Yükleme: leena-fetch.js + shell.js +
 * components.js'ten SONRA. İşaretleme üretmez — görsel her şey components.js'te (UI-03); burada
 * yalnız API sarmalı, form okuma, yetki/hata durumunun bileşene bağlanması ve tür → ton eşlemesi.
 * Sayılar sunucudan geldiği gibi gösterilir; istemci bakiye HESAPLAMAZ (D2, RAP-02).
 */
(function () {
  'use strict';
  var C = window.ui2C;
  var L = window.ui2L = {};

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

  // Hesap / hareket / tedarikçi türü → rozet tonu (eşleme burada, rozetin kendisi components.js'te).
  var TYPE_TONE = { bank: 'info', cash: 'pos', virtual: 'signal',
                    income: 'pos', expense: 'warn', payout: 'warn', transfer: 'neutral', refund: 'dang' };
  L.chip = function (t) { return C.chip(t, TYPE_TONE[t] || 'neutral'); };

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
      root.innerHTML = C.state('empty', 'You do not have access to Finance.');
      return false;
    }
    return true;
  };
  // 503 = ledger migration'ı henüz koşulmadı (routes/ledger.js kapısı).
  L.httpError = function (root, r, what) {
    var msg = r.status === 503 ? 'Ledger is not migrated yet — run scripts/migrate.js.'
      : 'Could not load ' + what + ' (HTTP ' + r.status + (r.body && r.body.error ? ': ' + r.body.error : '') + ').';
    root.innerHTML = C.state('error', msg);
  };
  L.offline = function (root) { root.innerHTML = C.state('error', 'Could not reach the server. Please retry.'); };
  L.loading = function (root) { root.innerHTML = C.state('loading'); };

  L.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  };
})();
