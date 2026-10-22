/**
 * ui2 Admin ekranlarının ortak yardımcıları (Paket 2). Yükleme: leena-fetch.js + shell.js + components.js +
 * ledger-ui.js'ten SONRA. İşaretleme components.js'ten (UI-03). Yetki SUNUCUDA denetlenir; burası yalnız
 * yanıtı okunur metne çevirir.
 */
(function () {
  'use strict';
  var C = window.ui2C;
  var A = window.ui2A = {};

  var STATUS = { active: ['pos', 'active'], invited: ['info', 'invited'],
                 invite_expired: ['warn', 'invite expired'], no_password: ['warn', 'no password'],
                 inactive: ['neutral', 'inactive'] };
  A.statusChip = function (s) {
    var x = STATUS[s] || ['neutral', s];
    return C.chip(x[1], x[0]);
  };

  // Kapı yanıtları (409 + kod) — 403 kullanılmaz (G45: leena-fetch 401/403'te oturumu siler).
  A.errorText = function (r) {
    var b = r.body || {};
    if (r.status === 503) return 'User management is not migrated yet — run scripts/migrate.js.';
    if (b.code === 'NOT_USER_SESSION') return 'Sign in with your user account (/ui2/login.html) to manage users.';
    if (b.code === 'PERMISSION_REQUIRED') return 'You do not have permission for this (' + (b.permission || 'unknown') + ').';
    return b.error || ('Request failed (HTTP ' + r.status + ').');
  };
  // 409 (yetki / oturum türü) bilgi durumudur; diğer her şey hata.
  A.httpError = function (root, r, what) {
    root.innerHTML = C.state(r.status === 409 ? 'empty' : 'error', r.status === 200 ? 'Could not load ' + what + '.' : A.errorText(r));
  };

  // Bağlanabilir internal temsilciler; e-postası TEK temsilciyle eşleşirse o seçili gelir (öneri).
  A.agentOptions = function (agents, email, currentId, currentName) {
    var em = String(email || '').trim().toLowerCase();
    var hits = em ? agents.filter(function (a) { return String(a.email || '').trim().toLowerCase() === em; }) : [];
    var pick = currentId != null ? String(currentId) : (hits.length === 1 ? String(hits[0].id) : '');
    var list = agents.slice();
    if (currentId != null && !list.some(function (a) { return String(a.id) === String(currentId); })) {
      list.unshift({ id: currentId, name: currentName || ('#' + currentId), email: '', is_active: true });
    }
    return C.options(list, function (a) { return a.id; }, function (a) {
      return a.name + (a.email ? ' — ' + a.email : '') + (a.is_active ? '' : ' (inactive)') +
        (hits.length === 1 && String(a.id) === String(hits[0].id) && currentId == null ? '  ← email match' : '');
    }, pick, '— no link —');
  };

  // Davet sonucu: e-posta kuyruğa yazıldı; INVITE_ECHO açıksa (yalnız staging) link de gösterilir.
  A.showInviteResult = function (msgEl, linkEl, inv) {
    C.say(msgEl, 'Invitation queued for ' + inv.email + ' — expires ' + String(inv.expires_at).replace('T', ' ').slice(0, 16) + ' UTC.', 'ok');
    if (linkEl) linkEl.innerHTML = inv.invite_url
      ? C.callout('INVITE_ECHO is on (staging only) — invitation link:<br>' + C.input({ readonly: true, value: inv.invite_url }, { mono: true }), 'warn')
      : '';
  };
})();
