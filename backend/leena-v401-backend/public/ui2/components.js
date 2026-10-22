/**
 * ui2 BİLEŞENLERİ — TEK KAYNAK (UI-03). Sayfa dosyası işaretleme (sınıf, tablo, form, düğme)
 * YAZMAZ; yalnız buradaki fonksiyonları çağırır. test_ui2_ui0 "bileşen-kopya" testi sayfalarda
 * bileşen sınıfı / <table> / <form> / <input> / style= arar — bulursa KIRMIZI.
 *
 * Dört şablon: Liste (list) · Detay (page + section + detail) · Form (form + field + input/select/
 * button) · Özet kartları (stat / stats — href verilirse kart tıklanınca kayda iner, D2'nin ekran
 * karşılığı). Para çifti (pair): işlem birimi + EUR, Finance'ta zorunlu (RAP-01). Durumlar:
 * state('empty' | 'loading' | 'error').
 *
 * Saf metin üretir (DOM'a yalnız say() ve satır-bağlantısı dinleyicisi dokunur). Sunucunun verdiği
 * sayı OLDUĞU GİBİ gösterilir — bileşen aritmetik YAPMAZ (D2, RAP-02). Stil: styles/signal.css,
 * değerler: styles/tokens.css. Yükleme: shell.js'ten SONRA, ledger-ui.js / admin-ui.js'ten ÖNCE.
 * (Üst çubuk + alt menü işaretlemesi shell.js'tedir — nav.json'u yalnız o okur, UI-02.)
 */
(function () {
  'use strict';
  var C = window.ui2C = {};

  C.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  C.dash = function (v) { return (v == null || v === '') ? '—' : C.esc(v); };

  // Öznitelik: ham metin ('name="x" required') ya da nesne ({ name: 'x', required: true }; değerler kaçışlanır).
  function attrs(a) {
    if (!a) return '';
    if (typeof a === 'string') return ' ' + a;
    return Object.keys(a).map(function (k) {
      var v = a[k];
      if (v == null || v === false) return '';
      return v === true ? ' ' + k : ' ' + k + '="' + C.esc(v) + '"';
    }).join('');
  }
  C.attrs = attrs;

  // ── Para — sunucu metni olduğu gibi; yalnız biçim, aritmetik yok ──
  C.money = function (v, cur) { return (v == null || v === '') ? '—' : (cur ? C.esc(cur) + ' ' : '') + C.esc(v); };
  C.eur = function (v) { return (v == null || v === '') ? '—' : '€' + C.esc(v); };
  // Para çifti (RAP-01): işlem birimindeki tutar + sunucunun verdiği EUR karşılığı, tek bileşen.
  // EUR karşılığı sunucudan gelmediyse "—" görünür (RAP-02: eksik sessizce kaybolmaz).
  C.pair = function (amount, cur, eur) {
    var noEur = eur == null || eur === '';
    return '<span class="ui-pair"><span class="ui-pair-tx">' + C.money(amount, cur) + '</span>' +
      '<span class="ui-pair-eur"' + (noEur ? ' title="No EUR value from the server"' : '') + '>' + C.eur(eur) + '</span></span>';
  };

  // ── Durum: boş / yükleniyor / hata. text kaçışlanır; o.html (bağlantı vb.) olduğu gibi eklenir. ──
  C.state = function (kind, text, o) {
    o = o || {};
    kind = kind === 'loading' || kind === 'error' ? kind : 'empty';
    var t = text != null ? C.esc(text) : (kind === 'loading' ? 'Loading…' : kind === 'error' ? 'Something went wrong.' : 'Nothing here yet.');
    return '<div class="ui-state ui-state-' + kind + '" role="' + (kind === 'error' ? 'alert' : 'status') + '">' +
      (o.title ? '<strong class="ui-state-title">' + C.esc(o.title) + '</strong>' : '') + t + (o.html || '') + '</div>';
  };

  // ── Sayfa şablonu ──
  // page: başlık bloğu. o = { title | titleHtml, sub | subHtml, aside (html: bağlantılar / süzgeç formu) }
  C.page = function (o) {
    var sub = o.subHtml != null ? o.subHtml : (o.sub != null ? C.esc(o.sub) : null);
    return '<div class="ui-head"><div><h1>' + (o.titleHtml != null ? o.titleHtml : C.esc(o.title)) + '</h1>' +
      (sub != null ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
      (o.aside ? '<div class="ui-head-aside">' + o.aside + '</div>' : '') + '</div>';
  };
  C.stack = function (parts) { return '<div class="ui-stack">' + (parts || []).filter(Boolean).join('') + '</div>'; };
  // section: kart. o = { id, title, eyebrow, action (html), body (html), pad (gövdeyi iç boşlukla sar) }
  C.section = function (o) {
    var head = (o.title != null || o.eyebrow || o.action)
      ? '<div class="card-head"><span class="card-title">' + C.esc(o.title || '') + '</span>' +
        (o.eyebrow ? '<span class="card-eyebrow">' + C.esc(o.eyebrow) + '</span>' : '') + (o.action || '') + '</div>'
      : '';
    return '<section class="card"' + (o.id ? ' id="' + C.esc(o.id) + '"' : '') + '>' + head +
      (o.pad ? '<div class="card-pad">' + (o.body || '') + '</div>' : (o.body || '')) + '</section>';
  };
  C.text = function (html) { return '<div class="ui-text">' + html + '</div>'; };          // bölüm içi metin bloğu
  C.lines = function (list) { return C.text(list.map(function (h) { return '<div>' + h + '</div>'; }).join('')); };
  C.note = function (html, a) { return '<div class="ui-note"' + attrs(a) + '>' + html + '</div>'; };
  C.muted = function (html) { return '<span class="ui-note">' + html + '</span>'; };      // satır içi ikincil metin
  C.mono = function (text) { return '<span class="mono">' + C.esc(text) + '</span>'; };
  // links: bağlantı satırı. Öğe ham '<a href="…">…</a>' metni ya da { href, label } olabilir.
  C.links = function (list) {
    return '<div class="ui-links">' + (list || []).filter(Boolean).map(function (l) {
      return typeof l === 'string' ? l : '<a href="' + C.esc(l.href) + '"' + attrs(l.attrs) + '>' + C.esc(l.label) + '</a>';
    }).join('') + '</div>';
  };
  C.callout = function (html, tone) { return '<div class="ui-callout ui-callout-' + (tone || 'warn') + '">' + html + '</div>'; };
  C.subTitle = function (text) { return ' <span class="ui-sub-title">· ' + C.esc(text) + '</span>'; };

  // ── Rozet / etiket ──
  var TONES = { pos: 1, warn: 1, dang: 1, info: 1, primary: 1, signal: 1, neutral: 1 };
  C.chip = function (text, tone) { return '<span class="chip chip-' + (TONES[tone] ? tone : 'neutral') + '">' + C.esc(text) + '</span>'; };
  C.tag = function (text, tone) { return '<span class="ui-tag' + (tone === 'warn' || tone === 'dang' ? ' ui-tag-' + tone : '') + '">' + C.esc(text) + '</span>'; };
  C.missing = function () { return '<span class="ui-miss">missing</span>'; };   // eksik alan (kırmızı)
  C.neg = function (html, isNeg) { return isNeg ? '<span class="ui-neg">' + html + '</span>' : html; };

  // ── ÖZET KARTI (tek stat-card). o = { label, value (html), note (html), href, neg } ──
  // href verilirse kart bağlantıdır: tıklayınca rakamın arkasındaki kayda iner (D2).
  C.stat = function (o) {
    var inner = '<div class="ui-stat-l">' + C.esc(o.label) + (o.href ? '<span class="ui-stat-go" aria-hidden="true">→</span>' : '') + '</div>' +
      '<div class="ui-stat-v' + (o.neg ? ' ui-neg' : '') + '">' + o.value + '</div>' +
      (o.note != null && o.note !== '' ? '<div class="ui-stat-n">' + o.note + '</div>' : '');
    return o.href ? '<a class="ui-stat" href="' + C.esc(o.href) + '">' + inner + '</a>' : '<div class="ui-stat">' + inner + '</div>';
  };
  C.stats = function (list) { return '<div class="ui-stats">' + (list || []).filter(Boolean).map(C.stat).join('') + '</div>'; };

  // ── LİSTE. o = { columns: [{ label, num, neg(row), cell(row, i) }], rows, empty, href(row),
  //               after(row, i) (alt satır html), rowAttrs(row) } ──
  // href → satır tıklanınca detaya gider (aşağıdaki tek dinleyici; bağlantı/düğme/alan tıklaması hariç).
  // Her hücre data-label taşır: dar ekranda satır karta döner, yatay kaydırma olmaz (kabul 6).
  C.list = function (o) {
    var rows = o.rows || [];
    if (!rows.length) return C.state('empty', o.empty || 'Nothing to show.', o.emptyOpts);
    var cols = o.columns;
    var head = '<thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + C.esc(c.label || '') + '</th>'; }).join('') + '</tr></thead>';
    var body = rows.map(function (r, i) {
      var href = o.href ? o.href(r) : null;
      var tr = '<tr' + (href ? ' class="ui-row" data-href="' + C.esc(href) + '"' : '') + (o.rowAttrs ? attrs(o.rowAttrs(r)) : '') + '>' +
        cols.map(function (c) {
          var cls = (c.num ? 'num' : '') + (c.neg && c.neg(r) ? (c.num ? ' ' : '') + 'ui-neg' : '');
          return '<td data-label="' + C.esc(c.label || '') + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + c.cell(r, i) + '</td>';
        }).join('') + '</tr>';
      var extra = o.after ? o.after(r, i) : '';
      return tr + (extra ? '<tr class="ui-sub"><td colspan="' + cols.length + '">' + extra + '</td></tr>' : '');
    }).join('');
    return '<div class="ui-list"><table class="table">' + head + '<tbody>' + body + '</tbody></table></div>';
  };

  // ── DETAY: anahtar / değer. rows = [[etiket, html], ...] ──
  C.detail = function (rows) {
    return '<table class="table ui-kv"><tbody>' + (rows || []).map(function (r) {
      return '<tr><th>' + C.esc(r[0]) + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
  };

  // ── FORM. o = { id, fields: [html], actions: [html], msg (mesaj alanının id'si), layout: 'inline'
  //            (varsayılan) | 'stacked' (giriş ekranları) | 'flush' (başlık yanındaki süzgeç), attrs } ──
  C.form = function (o) {
    var lay = o.layout === 'stacked' ? ' stacked' : o.layout === 'flush' ? ' flush' : '';
    return '<form class="ui-form' + lay + '"' + (o.id ? ' id="' + C.esc(o.id) + '"' : '') + attrs(o.attrs) + '>' +
      (o.fields || []).join('') + (o.actions || []).join('') + '</form>' +
      (o.msg ? '<div class="ui-msg' + (lay ? ' flush' : '') + '" id="' + C.esc(o.msg) + '"></div>' : '');
  };
  // field: etiket + denetim. o = { wide, hidden, attrs }
  C.field = function (label, control, o) {
    o = o || {};
    return '<label class="field' + (o.wide ? ' wide' : '') + '"' + (o.hidden ? ' hidden' : '') + attrs(o.attrs) + '>' +
      '<span class="label">' + C.esc(label) + '</span>' + control + '</label>';
  };
  // o = { missing (kırmızı çerçeve — eksik alan), mono }
  function inputCls(o) { return 'input' + (o && o.missing ? ' ui-missing' : '') + (o && o.mono ? ' mono' : ''); }
  C.input = function (a, o) { return '<input class="' + inputCls(o) + '"' + attrs(a) + '>'; };
  C.select = function (a, optionsHtml, o) { return '<select class="' + inputCls(o) + '"' + attrs(a) + '>' + (optionsHtml || '') + '</select>'; };
  C.options = function (list, valueOf, labelOf, selected, emptyLabel) {
    var out = emptyLabel != null ? ['<option value="">' + C.esc(emptyLabel) + '</option>'] : [];
    (list || []).forEach(function (x) {
      var v = String(valueOf(x));
      out.push('<option value="' + C.esc(v) + '"' + (String(selected) === v ? ' selected' : '') + '>' + C.esc(labelOf(x)) + '</option>');
    });
    return out.join('');
  };
  C.check = function (a, text) { return '<span class="ui-check"><input type="checkbox"' + attrs(a) + '> ' + C.esc(text) + '</span>'; };
  // button: o = { kind: 'primary' | 'secondary' | 'ghost', submit, block, attrs }
  C.button = function (label, o) {
    o = o || {};
    return '<button class="btn btn-' + (o.kind || 'secondary') + (o.block ? ' btn-block' : '') + '" type="' + (o.submit ? 'submit' : 'button') + '"' +
      attrs(o.attrs) + '>' + C.esc(label) + '</button>';
  };
  C.linkButton = function (label, href, o) {
    o = o || {};
    return '<a class="btn btn-' + (o.kind || 'ghost') + (o.block ? ' btn-block' : '') + '" href="' + C.esc(href) + '">' + C.esc(label) + '</a>';
  };
  // Form mesajı (satır içi) — toast yok; hata/uyarı aynı yerde, okunur kalır.
  C.say = function (el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = String(el.className || '').replace(/\s*ui-msg-(ok|warn|error)/g, '') +
      ' ui-msg-' + (kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok');
  };

  // ── Liste satırı bağlantısı — tek dinleyici (sayfa başına ayrı tıklama kodu yok). ──
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tr = t.closest('tr[data-href]');
      if (!tr || t.closest('a, button, input, select, textarea, label')) return;
      window.location.href = tr.getAttribute('data-href');
    });
  }
})();
