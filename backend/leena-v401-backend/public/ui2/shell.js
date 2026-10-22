/**
 * ui2 shell — nav + kimlik + yetki kancası.
 * Yüklenme: <script src="/leena-fetch.js"></script> SONRA <script src="shell.js"></script>
 *
 * NAV TEK KAYNAK = nav.json (UI-02). Bu dosya nav içeriği TAŞIMAZ, yalnız okur: üst sekmeler
 * (domains), alt menü grupları (groups) ve öğeler (items; status live | placeholder, permission kodu).
 * Menü değişikliği yalnız nav.json'da. Üst çubuk + alt menü işaretlemesi burada (tek yer); sayfa
 * gövdesindeki bileşenler components.js'te.
 * Kimlik ve yetki tek noktadan sorulur — ekran kodu bunları ÇAĞIRIR, kendi çözmez. Yetki SUNUCUDA
 * çözülür (Paket 2, utils/permissions.js); burası yalnız /me özetini okur — rol motoru TAKLİT EDİLMEZ.
 */
(function () {
  'use strict';

  var NAV_URL = '/ui2/nav.json';
  // window.ui2NavData: nav.json içeriği (ui2LoadNav doldurur; test ortamı hazır veriyle koyar).
  function nav() { return window.ui2NavData || null; }
  function domainOf(key) {
    var n = nav();
    return n ? n.domains.filter(function (d) { return d.id === key; })[0] : undefined;
  }
  function itemOf(id) {
    var n = nav();
    return n ? n.items.filter(function (x) { return x.id === id; })[0] : undefined;
  }

  window.ui2LoadNav = function () {
    if (nav()) return Promise.resolve(nav());
    return fetch(NAV_URL, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('nav.json HTTP ' + res.status);
      return res.json();
    }).then(function (data) { window.ui2NavData = data; return data; });
  };

  // ── KİMLİK — TEK NOKTA. "Kullanıcı kim?" ──
  // Faz 4 dilim 2 (SEM-05): SENKRON kalır. ui2 login (users) ile girildiyse 'ui2User'
  // kaydını okur — yalnız kayıt ŞU ANKİ token'a aitse (token_tail eşleşmesi). Aksi hâlde
  // eski davranış (klasik login: 'organizer' / 'organizerId'). Fetch YOK.
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
  // sunucu çözümler, istemci yalnız okur). SENKRON kalır (SEM-05). Özet yoksa (klasik oturum /
  // henüz okunmadı / migration öncesi) ESKİ davranış: TRUE — yalnız userOnly alan (Admin) gizli.
  // İkinci argüman (isteğe bağlı): tek bir izin kodu (nav.json öğesinin `permission` alanı).
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
      var d = domainOf(domainKey);
      return !(d && d.userOnly);
    }
    if (acc.owner) return true;
    if (permCode) return !!(acc.codes && acc.codes[permCode]);
    return (acc.areas || []).indexOf(domainKey) !== -1;
  };

  // Giriş hedefi (UI-06 asgarisi: ui2 girişi → Finance özet). Finance görünmüyorsa ilk görünen alan.
  window.ui2Landing = function () {
    var n = nav();
    if (!n) return 'whoami.html';
    var order = [n.landing].concat(n.domains.map(function (d) { return d.id; }));
    for (var i = 0; i < order.length; i++) {
      var d = domainOf(order[i]);
      if (d && window.ui2CanSee(d.id)) return d.path;
    }
    return 'whoami.html';
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

  // Sayfa domain'ini bildirmediyse (yer-tutucu sayfası) aktif öğenin domain'i kullanılır.
  function activeDomain(activeKey, subKey) {
    if (activeKey) return activeKey;
    var it = subKey ? itemOf(subKey) : null;
    return it ? it.domain : null;
  }

  // ── NAV render — üst sekmeler nav.json `domains`'ten (sıra = dosyadaki sıra). ──
  window.ui2RenderNav = function (activeKey) {
    var mount = document.getElementById('ui2-nav');
    if (!mount) return;
    var n = nav();
    var user = window.ui2CurrentUser();
    var initials = (user.name || 'U').trim().slice(0, 2).toUpperCase();
    var brand = '<a class="brand" href="index.html"><span class="eliza-mark">' +
      '<span class="eliza-glyph"><i></i><i></i><i></i></span>' +
      '<span class="eliza-word on-dark">ELIZA</span></span></a>';
    var tabs = n
      ? n.domains.filter(function (d) { return window.ui2CanSee(d.id); }).map(function (d) {
          var isActive = d.id === activeKey ? ' active' : '';
          var onclick = d.id === activeKey ? '' : " onclick=\"location.href='" + d.path + "'\"";
          return '<button class="domain-tab' + isActive + '"' + onclick + '>' +
                 '<span class="d-main">' + esc(d.label) + '</span>' +
                 '<span class="d-sub">' + (d.sub ? esc(d.sub) : '&nbsp;') + '</span></button>';
        }).join('')
      : '<span class="ui-nav-error">Navigation unavailable — reload the page.</span>';

    mount.outerHTML =
      '<nav class="topnav" id="ui2-nav">' + brand +
        '<div class="domain-tabs">' + tabs + '</div>' +
        '<div class="spacer"></div>' +
        '<div class="nav-right">' +
          '<a class="avatar" href="whoami.html" title="' + esc(user.name) + '">' + esc(initials) + '</a>' +
        '</div>' +
      '</nav>';
  };

  // ── SUBNAV render — nav.json `groups` + `items`. Mount #ui2-subnav olan sayfalarda çalışır. ──
  // Öğe görünürlüğü: domain görünür + öğenin `permission`'ı (ui2CanSee). `parent` taşıyan öğe
  // menüde ayrı satır DEĞİL; o sayfadayken ebeveyni etkin görünür. Yer-tutucu öğe ölü bağlantı
  // değildir: yer-tutucu ekranına gider ("soon" işaretli).
  window.ui2RenderSubnav = function (domainKey, activeSubKey) {
    var mount = document.getElementById('ui2-subnav');
    if (!mount) return;
    var n = nav();
    if (!n) return;                   // nav.json henüz gelmedi — yüklenince çizilir
    domainKey = activeDomain(domainKey, activeSubKey);
    var act = itemOf(activeSubKey);
    var activeId = act ? (act.parent || act.id) : activeSubKey;
    var groups = n.groups.filter(function (g) { return g.domain === domainKey; }).map(function (g) {
      var items = n.items.filter(function (it) {
        return it.domain === domainKey && it.group === g.id && !it.parent &&
               (!it.permission || window.ui2CanSee(domainKey, it.permission));
      });
      return { g: g, items: items };
    }).filter(function (x) { return x.items.length; });
    if (!window.ui2CanSee(domainKey) || groups.length === 0) {
      mount.outerHTML = '';           // öğe yoksa subbar hiç görünmez (boş çubuk bırakma)
      return;
    }
    var html = groups.map(function (x) {
      var label = groups.length > 1 ? '<span class="subnav-glabel">' + esc(x.g.label) + '</span>' : '';
      return '<div class="subnav-group" data-group="' + esc(x.g.id) + '">' + label + x.items.map(function (it) {
        if (it.status === 'placeholder') {
          var cls = it.id === activeId ? 'ph active' : 'ph';
          return '<a class="' + cls + '" href="' + esc(it.path) + '" title="Not in ui2 yet">' + esc(it.label) +
                 ' <span class="subnav-soon">soon</span></a>';
        }
        var a = it.id === activeId ? ' class="active"' : '';
        return '<a' + a + ' href="' + esc(it.path) + '">' + esc(it.label) + '</a>';
      }).join('') + '</div>';
    }).join('');
    mount.outerHTML = '<div class="subbar" id="ui2-subnav"><nav class="subnav">' + html + '</nav></div>';
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

  // ── Oto-init: token kapısı + nav.json + nav + subnav. Sayfa UI2_ACTIVE / UI2_SUBACTIVE bildirir. ──
  function renderAll() {
    var sub = window.UI2_SUBACTIVE || null;
    var dom = activeDomain(window.UI2_ACTIVE || null, sub);
    window.ui2RenderNav(dom);
    window.ui2RenderSubnav(dom, sub);
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (!requireAuth()) return;
    window.ui2LoadNav().then(renderAll, function () { renderAll(); });   // hata → "Navigation unavailable"
    window.ui2RefreshAccess(function () { renderAll(); });
  });
})();
