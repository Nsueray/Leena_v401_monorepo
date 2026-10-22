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
  // Paket 2: 'admin' (kullanıcı yönetimi) YALNIZ users oturumunda ve yetkiyle görünür (userOnly) —
  // klasik oturumda nav eskisi gibi 3 sekme (K-G: eski davranış değişmez).
  var UI2_DOMAINS = [
    { key: 'sales',      main: 'Sales',      sub: 'liffy', href: 'sales.html' },
    { key: 'operations', main: 'Operations', sub: 'leena', href: 'operations.html' },
    { key: 'finance',    main: 'Finance',    sub: '',      href: 'finance-contract.html' },
    { key: 'admin',      main: 'Admin',      sub: '',      href: 'admin-users.html', userOnly: true },
  ];

  // ── Alt-nav (subnav) — TEK KAYNAK, domain'e göre. ──
  // Emsal: tasarımda her Finance mockup'ı AYNI subnav'ı kendi içine KOPYALIYOR
  // (War Room·Expos·Ledger·Contracts·Commissions·Reports) — kaçındığımız tekrar.
  // Burada tek kaynaktan üretilir; ekran yalnız hangi öğenin aktif olduğunu bildirir.
  // KURAL: yalnız GERÇEK ekranı olan öğe listelenir ("gösterilemeyen görünmez").
  // Paket 1 (ledger L-1…L-6): beş gerçek ekran eklendi (hesap ekstresi Accounts'un altında).
  // Paket 2 (K-G): Suppliers + Drafts SONA eklendi (eski 6 öğe yerinde, sırası aynı). `perm` = öğeyi
  // gösteren okuma izni — yalnız users oturumunda okunur (menü UX; güvenlik sınırı sunucuda).
  var UI2_SUBNAV = {
    finance: [
      { key: 'contract',  label: 'Contracts',   href: 'finance-contract.html',  perm: 'contracts.read' },
      { key: 'summary',   label: 'Summary',     href: 'finance-summary.html',   perm: 'ledger.read' },
      { key: 'accounts',  label: 'Accounts',    href: 'finance-accounts.html',  perm: 'ledger.read' },
      { key: 'transfers', label: 'Transfers',   href: 'finance-transfers.html', perm: 'ledger.read' },
      { key: 'expenses',  label: 'Expenses',    href: 'finance-expenses.html',  perm: 'ledger.read' },
      { key: 'budget',    label: 'Expo budget', href: 'finance-budget.html',    perm: 'budget.read' },
      { key: 'suppliers', label: 'Suppliers',   href: 'finance-suppliers.html', perm: 'suppliers.read' },
      { key: 'drafts',    label: 'Drafts',      href: 'finance-drafts.html',    perm: 'expense_drafts.read' },
    ],
    sales: [],
    operations: [],
    admin: [
      { key: 'users',     label: 'Users',       href: 'admin-users.html',       perm: 'users.read' },
    ],
  };

  // ── KİMLİK — TEK NOKTA. "Kullanıcı kim?" ──
  // Faz 4 dilim 2 (SEM-05): SENKRON kalır. ui2 login (users) ile girildiyse 'ui2User'
  // kaydını okur — yalnız kayıt ŞU ANKİ token'a aitse (token_tail eşleşmesi). Aksi hâlde
  // eski davranış (klasik login: 'organizer' / 'organizerId'). Fetch YOK.
  // Ekran kodu bunu çağırır, kullanıcıyı kendi çözmez.
  window.ui2CurrentUser = function () {
    try {
      var u = JSON.parse(localStorage.getItem('ui2User') || 'null');
      var tok = localStorage.getItem('token') || '';
      if (u && u.user_id && tok && u.token_tail === tok.slice(-16)) {
        // name (K-F): token'daki ad (ad yoksa sunucu zaten e-posta koyar); ad alanı olmayan
        // eski kayıt → e-posta (K-G: eski davranış değişmez).
        return { name: u.name || u.email || 'User', id: u.user_id, email: u.email, session: 'user' };
      }
    } catch (e) { /* fail-soft → eski davranış */ }
    var name = 'User';
    try {
      var org = JSON.parse(localStorage.getItem('organizer') || 'null');
      if (org && org.name) name = org.name;
    } catch (e) { /* fail-soft */ }
    return { name: name, id: localStorage.getItem('organizerId') || null };
  };

  // ── YETKİ — TEK NOKTA. "Bu kullanıcı X'i görebilir mi?" ──
  // Paket 2: users oturumunda etkin yetki özetini okur (GET /api/user-auth/me → ui2User.perms;
  // sunucu çözümler, istemci yalnız okur). SENKRON kalır (SEM-05): özet önbellekten okunur, sayfa
  // açılışında arka planda tazelenir. Özet yoksa (klasik oturum / henüz okunmadı / migration
  // öncesi) ESKİ davranış: TRUE — yalnız yeni 'admin' alanı (userOnly) gizli. Ekran kodu DEĞİŞMEZ.
  // İkinci argüman (isteğe bağlı): tek bir izin kodu ('ledger.read' gibi).
  function ui2Access() {
    var u = window.ui2CurrentUser();
    if (u.session !== 'user') return null;
    try {
      var rec = JSON.parse(localStorage.getItem('ui2User') || 'null');
      return rec && rec.perms && typeof rec.perms === 'object' ? rec.perms : null;
    } catch (e) { return null; }
  }
  window.ui2CanSee = function (domainKey, permCode) {
    var acc = ui2Access();
    if (!acc) {
      if (permCode) return true;
      var d = UI2_DOMAINS.filter(function (x) { return x.key === domainKey; })[0];
      return !(d && d.userOnly);
    }
    if (acc.owner) return true;
    if (permCode) return !!(acc.codes && acc.codes[permCode]);
    return (acc.areas || []).indexOf(domainKey) !== -1;
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
      '<nav class="topnav" id="ui2-nav">' +
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
    var items = (UI2_SUBNAV[domainKey] || []).filter(function (it) { return !it.perm || window.ui2CanSee(domainKey, it.perm); });
    if (!window.ui2CanSee(domainKey) || items.length === 0) {
      mount.outerHTML = '';           // öğe yoksa subbar hiç görünmez (boş çubuk bırakma)
      return;
    }
    var links = items.map(function (it) {
      var cls = it.key === activeSubKey ? ' class="active"' : '';
      return '<a' + cls + ' href="' + esc(it.href) + '">' + esc(it.label) + '</a>';
    }).join('');
    mount.outerHTML = '<div class="subbar" id="ui2-subnav"><nav class="subnav">' + links + '</nav></div>';
  };

  // ── Etkin yetki tazeleme (Paket 2) — users oturumunda sayfa açılışında bir kez. ──
  // /me'nin özeti ui2User kaydına yazılır (aynı token'a bağlı kayıt); değiştiyse nav + subnav yeniden
  // çizilir. 401 → leena-fetch oturumu kapatır (pasifleştirilen kullanıcı). 409/503/ağ hatası → sessiz.
  window.ui2RefreshAccess = function (onChange) {
    var u = window.ui2CurrentUser();
    if (u.session !== 'user' || typeof window.leenaFetch !== 'function') return;
    window.leenaFetch('/api/user-auth/me').then(function (res) {
      if (res.status !== 200) return null;
      return res.json();
    }).then(function (me) {
      if (!me) return;
      var rec;
      try { rec = JSON.parse(localStorage.getItem('ui2User') || 'null'); } catch (e) { rec = null; }
      if (!rec) return;
      var next = me.permissions || null;
      var before = JSON.stringify(rec.perms || null);
      rec.perms = next;
      rec.role = me.role || null;
      rec.office = me.office || null;
      try { localStorage.setItem('ui2User', JSON.stringify(rec)); } catch (e) { /* fail-soft */ }
      if (before !== JSON.stringify(next) && typeof onChange === 'function') onChange();
    }).catch(function () { /* fail-soft: menü önbellekle kalır */ });
  };

  // ── Oto-init: token kapısı + nav + subnav. Sayfa UI2_ACTIVE / UI2_SUBACTIVE bildirir. ──
  document.addEventListener('DOMContentLoaded', function () {
    if (!requireAuth()) return;
    window.ui2RenderNav(window.UI2_ACTIVE || null);
    window.ui2RenderSubnav(window.UI2_ACTIVE || null, window.UI2_SUBACTIVE || null);
    window.ui2RefreshAccess(function () {
      window.ui2RenderNav(window.UI2_ACTIVE || null);
      window.ui2RenderSubnav(window.UI2_ACTIVE || null, window.UI2_SUBACTIVE || null);
    });
  });
})();
