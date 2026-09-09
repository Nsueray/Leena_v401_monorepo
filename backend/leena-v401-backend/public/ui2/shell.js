/**
 * ui2 shell — TEK KAYNAK: nav + kimlik + yetki kancası.
 * Yüklenme: <script src="/leena-fetch.js"></script> SONRA <script src="shell.js"></script>
 *
 * Neden tek dosya: nav içeriği YALNIZ burada yaşar (30 dosyada menü tekrarı hatasını
 * önler). Kimlik ve yetki de tek noktadan sorulur — ekran kodu bunları ÇAĞIRIR,
 * kendi çözmez. Bugün cevaplar sabit (kullanıcı sistemi + rol motoru YOK, ölçüldü
 * 2026-08-04); Faz 4'te aynı fonksiyonlar users / user_permissions'ı okur, EKRAN
 * KODU DEĞİŞMEZ. Rol motoru TAKLİT EDİLMEZ — sahte "yetki gerekli" ekranı yok.
 */
(function () {
  'use strict';

  // ── Domain tanımı — TEK KAYNAK. Menü değişikliği yalnız burada. ──
  // Alt-etiket brief :32-34: Sales(liffy) · Operations(leena) · Finance(yok).
  var UI2_DOMAINS = [
    { key: 'sales',      main: 'Sales',      sub: 'liffy', href: 'sales.html' },
    { key: 'operations', main: 'Operations', sub: 'leena', href: 'operations.html' },
    { key: 'finance',    main: 'Finance',    sub: '',      href: 'finance-contract.html' },
  ];

  // ── Alt-nav (subnav) — TEK KAYNAK, domain'e göre. ──
  // Emsal: tasarımda her Finance mockup'ı AYNI subnav'ı kendi içine KOPYALIYOR
  // (War Room·Expos·Ledger·Contracts·Commissions·Reports) — kaçındığımız tekrar.
  // Burada tek kaynaktan üretilir; ekran yalnız hangi öğenin aktif olduğunu bildirir.
  // KURAL: yalnız GERÇEK ekranı olan öğe listelenir ("gösterilemeyen görünmez").
  // Bugün Finance'ta tek gerçek ekran var (Contract); yapı ikinciyi taşımaya hazır —
  // ikinci ekran gelince buraya bir satır eklenir, ekran kodu değişmez.
  var UI2_SUBNAV = {
    finance: [
      { key: 'contract', label: 'Contracts', href: 'finance-contract.html' },
    ],
    sales: [],
    operations: [],
  };

  // ── KİMLİK — TEK NOKTA. "Kullanıcı kim?" ──
  // Bugün: tek kişi (kullanıcı sistemi YOK). Faz 4: users tablosunu okur.
  // Ekran kodu bunu çağırır, kullanıcıyı kendi çözmez.
  window.ui2CurrentUser = function () {
    var name = 'User';
    try {
      var org = JSON.parse(localStorage.getItem('organizer') || 'null');
      if (org && org.name) name = org.name;
    } catch (e) { /* fail-soft */ }
    return { name: name, id: localStorage.getItem('organizerId') || null };
  };

  // ── YETKİ — TEK NOKTA. "Bu kullanıcı X'i görebilir mi?" ──
  // Bugün: HER ZAMAN TRUE (rol motoru YOK, taklit edilmez).
  // Faz 4: user_permissions matrisini okur. Ekran kodu DEĞİŞMEZ.
  window.ui2CanSee = function (/* domainKey */) {
    return true;
  };

  // ── AUTH kapısı — mevcut leenaFetch deseni (token localStorage['token']). ──
  function requireAuth() {
    var token = localStorage.getItem('token');
    if (!token) {
      // Mevcut giriş sayfası (public kökünde). ui2 ayrı giriş İSTEMEZ (aynı origin).
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── NAV render — tasarım (signal.css) sınıflarını kullanır: .topnav/.domain-tabs/... ──
  window.ui2RenderNav = function (activeKey) {
    var mount = document.getElementById('ui2-nav');
    if (!mount) return;
    var user = window.ui2CurrentUser();
    var initials = (user.name || 'U').trim().slice(0, 2).toUpperCase();

    // Yalnız görülebilir domain'ler (yetki tek noktadan; bugün hepsi TRUE).
    var tabs = UI2_DOMAINS.filter(function (d) { return window.ui2CanSee(d.key); }).map(function (d) {
      var isActive = d.key === activeKey ? ' active' : '';
      var onclick = d.key === activeKey ? '' : " onclick=\"location.href='" + d.href + "'\"";
      return '<button class="domain-tab' + isActive + '"' + onclick + '>' +
             '<span class="d-main">' + esc(d.main) + '</span>' +
             '<span class="d-sub">' + (d.sub ? esc(d.sub) : '&nbsp;') + '</span></button>';
    }).join('');

    mount.outerHTML =
      '<nav class="topnav">' +
        '<div class="brand"><div class="eliza-mark">' +
          '<span class="eliza-glyph"><i></i><i></i><i></i></span>' +
          '<span class="eliza-word on-dark">ELIZA</span></div></div>' +
        '<div class="domain-tabs">' + tabs + '</div>' +
        '<div class="spacer"></div>' +
        '<div class="nav-right">' +
          '<div class="avatar" style="background:var(--ink-2)" title="' + esc(user.name) + '">' + esc(initials) + '</div>' +
        '</div>' +
      '</nav>';
  };

  // ── SUBNAV render — TEK KAYNAK. Mount #ui2-subnav olan sayfalarda çalışır. ──
  // Yetki tek noktadan: görülemeyen domain'in subnav'ı da çıkmaz (bugün hepsi TRUE).
  window.ui2RenderSubnav = function (domainKey, activeSubKey) {
    var mount = document.getElementById('ui2-subnav');
    if (!mount) return;
    var items = (UI2_SUBNAV[domainKey] || []);
    if (!window.ui2CanSee(domainKey) || items.length === 0) {
      mount.outerHTML = '';           // öğe yoksa subbar hiç görünmez (boş çubuk bırakma)
      return;
    }
    var links = items.map(function (it) {
      var cls = it.key === activeSubKey ? ' class="active"' : '';
      return '<a' + cls + ' href="' + esc(it.href) + '">' + esc(it.label) + '</a>';
    }).join('');
    mount.outerHTML = '<div class="subbar"><nav class="subnav">' + links + '</nav></div>';
  };

  // ── Oto-init: token kapısı + nav + subnav. Sayfa UI2_ACTIVE / UI2_SUBACTIVE bildirir. ──
  document.addEventListener('DOMContentLoaded', function () {
    if (!requireAuth()) return;
    window.ui2RenderNav(window.UI2_ACTIVE || null);
    window.ui2RenderSubnav(window.UI2_ACTIVE || null, window.UI2_SUBACTIVE || null);
  });
})();
