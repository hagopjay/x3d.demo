/* Trace viewer: claims on the left, the text with the quote marked in the middle, the box in the 3D scene on the right.
   Data: data/claims.json (statements), data/report-<set>-<policy>.json (x3dtrace verdicts and loci), data/places-<set>.json
   (the locus of every place a repeated quote stands in), data/<source files>. Live re-check: check.js (find + number compare). */
(function () {
  'use strict';
  var TC = window.TraceCheck;
  var $ = function (id) { return document.getElementById(id); };
  var Q = new URLSearchParams(location.search);
  var XS = Q.get('xite') || '../../blender-x3d-io/v1/vendor/x_ite/x_ite.min.js';
  var G = { verified: '✓', check: '✕', reworded: '≈', unchecked: '–' };
  var S = { set: Q.get('set') || 'scene', policy: Q.get('policy') === 'strict' ? 'strict' : 'default', idx: +(Q.get('claim') || 0), place: null, edit: false,
            orig: {}, text: {}, sha: {}, claims: null, rep: {}, places: {}, B: null, xready: null, sceneKey: '', seq: 0, overlay: false };
  var SCENE_SRC = 'e2-cornell-box.x3d';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function get(url, json) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return json ? r.json() : r.text(); }); }
  function set() { return S.claims.sets.filter(function (s) { return s.id === S.set; })[0]; }
  function report() { return S.rep[S.set + '-' + S.policy]; }
  function claim() { return set().claims[S.idx]; }
  function item() { return report().sources[S.idx]; }
  function changed(srcId) { return S.text[srcId] !== S.orig[srcId]; }
  function sourceOf(c) { return set().sources.filter(function (s) { return s.id === c.source; })[0]; }
  function url(patch) { var p = new URLSearchParams(location.search); Object.keys(patch).forEach(function (k) { p.set(k, patch[k]); }); try { history.replaceState(null, '', '?' + p.toString()); } catch (e) {} }

  /* effective verdict of claim i: the recorded one, or the live one when its text was edited */
  function verdictOf(i) {
    var c = set().claims[i], it = report().sources[i];
    if (c.source && changed(c.source)) { var L = TC.live(S.text[c.source], c); return { v: L.verdict, live: true, L: L, it: it }; }
    return { v: it.verdict, live: false, it: it };
  }

  /* ---------- left: tabs, tally, list ---------- */
  function renderTabs() {
    var t = $('tabs'); t.textContent = '';
    S.claims.sets.forEach(function (s) {
      var b = el('button', 'tab', s.label + ' · ' + s.claims.length); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(s.id === S.set));
      b.onclick = function () { S.set = s.id; S.idx = 0; S.place = null; url({ set: s.id, claim: 0 }); renderAll(); };
      t.appendChild(b);
    });
  }
  function renderTally() {
    var n = { verified: 0, check: 0, reworded: 0, unchecked: 0 }, cited = 0, cl = set().claims, anyLive = false;
    cl.forEach(function (c, i) { var x = verdictOf(i); n[x.v]++; anyLive = anyLive || x.live; if (c.quote && c.quote.trim()) cited++; });
    var t = $('tally'); t.textContent = '';
    ['verified', 'check', 'reworded', 'unchecked'].forEach(function (k) { if (n[k] || k === 'verified') t.appendChild(el('span', 'chip v-' + k + (anyLive ? ' live' : ''), G[k] + ' ' + n[k] + ' ' + k)); });
    $('covline').textContent = 'coverage ' + cited + ' of ' + cl.length + ' (' + Math.round(100 * cited / cl.length) + '%) came with a quote';
    $('blurb').textContent = set().blurb;
  }
  function renderList() {
    var ul = $('list'); ul.textContent = '';
    set().claims.forEach(function (c, i) {
      var x = verdictOf(i), it = x.it, li = el('li'), b = el('button'); b.type = 'button'; b.setAttribute('aria-current', String(i === S.idx));
      var m = el('span', 'meta');
      m.appendChild(el('span', 'chip v-' + x.v + (x.live ? ' live' : ''), G[x.v] + ' ' + x.v));
      var occ = x.live ? x.L.places.length : it.occurrences;
      if (occ > 1) m.appendChild(el('span', 'tag', occ + ' places'));
      if (c.kind === 'planted') m.appendChild(el('span', 'tag planted', 'planted error'));
      if (c.kind === 'gap') m.appendChild(el('span', 'tag gap', 'no quote'));
      b.appendChild(m); b.appendChild(el('span', 'st', c.statement));
      b.onclick = function () { select(i); };
      li.appendChild(b); ul.appendChild(li);
    });
  }
  $('list').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); var n = set().claims.length, i = (S.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; select(i);
    var b = $('list').children[i].firstChild; if (b) b.focus();
  });

  /* ---------- middle: text with the quote marked ---------- */
  function currentPlaces() {
    var c = claim(), text = S.text[c.source] || '';
    return c.source ? TC.findAll(text, c.quote) : [];
  }
  function defaultPlace(pl, it) {   /* the place the report chose: the one that holds its recorded span */
    if (!pl.length) return 0;
    if (!changed(claim().source) && it.span) for (var i = 0; i < pl.length; i++) if (pl[i].s <= it.span[0] && it.span[1] <= pl[i].e) return i;
    return 0;
  }
  function renderSource() {
    var c = claim(), it = item(), srcId = c.source, wrap = $('code'), text = S.text[srcId];
    $('srcname').textContent = srcId || '(no source)';
    $('sha').textContent = '';
    if (srcId) {
      var rec = (report().source_files.filter(function (f) { return f.id === srcId; })[0] || {}).sha256 || '';
      var ok = S.sha[srcId] && S.sha[srcId] === rec;
      var s = el('span', 'chip ' + (ok ? 'v-verified' : 'v-check'), ok ? '✓ sha-256 matches the report' : '✕ text differs from the report');
      $('sha').appendChild(s);
    }
    var banner = $('banner'); banner.hidden = !(srcId && changed(srcId));
    banner.textContent = 'The text was edited, so the recorded verdicts no longer apply to it. Chips show the live check only: find and a number or version compare. Policy, conversions and boxes are not re-run.';
    $('reset').hidden = !(srcId && changed(srcId));
    wrap.textContent = '';
    if (!srcId) { wrap.appendChild(el('div', 'ln', '  This claim came with no quote and no source: there is nothing to show. It counts against coverage.')); renderPlaceNav([]); return; }
    var pl = currentPlaces(); if (S.place == null || S.place >= pl.length) S.place = defaultPlace(pl, it);
    var lines = text.split('\n'), off = 0, selEl = null;
    lines.forEach(function (ln, k) {
      var row = el('div', 'ln'), no = el('span', 'no', String(k + 1)), tx = el('span', 'tx'), pos = 0;
      pl.forEach(function (p, pi) {
        var a = Math.max(p.s, off), b = Math.min(p.e, off + ln.length);
        if (b <= a && !(p.s === p.e && p.s >= off && p.s <= off + ln.length)) return;
        if (a - off > pos) tx.appendChild(document.createTextNode(ln.slice(pos, a - off)));
        var m = el('mark', pi === S.place ? 'sel' : '', ln.slice(a - off, b - off)); m.title = 'place ' + (pi + 1) + ' of ' + pl.length;
        tx.appendChild(m); if (pi === S.place && !selEl) selEl = m; pos = b - off;
      });
      if (pos < ln.length) tx.appendChild(document.createTextNode(ln.slice(pos)));
      if (!ln.length) tx.appendChild(document.createTextNode(' '));
      row.appendChild(no); row.appendChild(tx); wrap.appendChild(row); off += ln.length + 1;
    });
    if (selEl) wrap.scrollTop = Math.max(0, selEl.parentNode.parentNode.offsetTop - wrap.clientHeight / 2);
    else wrap.scrollTop = 0;
    renderPlaceNav(pl);
  }
  function renderPlaceNav(pl) {
    var many = pl.length > 1;
    $('prev').hidden = !many; $('next').hidden = !many; $('placeno').textContent = many ? 'place ' + (S.place + 1) + ' of ' + pl.length : '';
  }
  $('prev').onclick = function () { var n = currentPlaces().length; S.place = (S.place + n - 1) % n; renderSource(); renderDetail(); drawBox(); };
  $('next').onclick = function () { var n = currentPlaces().length; S.place = (S.place + 1) % n; renderSource(); renderDetail(); drawBox(); };

  /* edit mode: a textarea over the same text; every keystroke re-runs the live check */
  $('edit').onclick = function () {
    S.edit = !S.edit; $('edit').setAttribute('aria-pressed', String(S.edit)); $('edit').textContent = S.edit ? 'Show marked text' : 'Edit the text';
    var c = claim(); if (!c.source) { S.edit = false; $('edit').setAttribute('aria-pressed', 'false'); return; }
    if (S.edit) {
      var ta = el('textarea', 'code'); ta.value = S.text[c.source]; ta.spellcheck = false; ta.setAttribute('aria-label', 'Editable source text');
      ta.addEventListener('input', function () { onEdit(c.source, ta.value); });
      var wrapper = $('codewrap'); wrapper.textContent = ''; wrapper.appendChild(ta); ta.focus();
    } else { var w = $('codewrap'); w.textContent = ''; var d = el('div', 'code'); d.id = 'code'; d.tabIndex = 0; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Source text with the quote marked'); w.appendChild(d); S.place = null; renderSource(); }
  };
  $('reset').onclick = function () {
    var c = claim(); S.text[c.source] = S.orig[c.source]; S.sha[c.source] = S.shaOrig[c.source];
    if (S.edit) { $('edit').click(); }
    S.place = null; renderAll(); if (c.source === SCENE_SRC) draw(true);
  };
  var editTimer = 0;
  function onEdit(srcId, value) {
    S.text[srcId] = value;
    TC.sha256Hex(value).then(function (h) { S.sha[srcId] = h; if (!S.edit) renderSource(); updateSha(srcId); });
    S.place = null; renderList(); renderTally(); renderDetail(); $('banner').hidden = !changed(srcId); $('banner').textContent = 'The text was edited, so the recorded verdicts no longer apply to it. Chips show the live check only: find and a number or version compare. Policy, conversions and boxes are not re-run.'; $('reset').hidden = !changed(srcId);
    clearTimeout(editTimer); if (srcId === SCENE_SRC) editTimer = setTimeout(function () { draw(false); }, 500);
  }
  function updateSha(srcId) {
    var rec = (report().source_files.filter(function (f) { return f.id === srcId; })[0] || {}).sha256 || ''; var ok = S.sha[srcId] === rec;
    $('sha').textContent = ''; $('sha').appendChild(el('span', 'chip ' + (ok ? 'v-verified' : 'v-check'), ok ? '✓ sha-256 matches the report' : '✕ text differs from the report'));
  }

  /* ---------- middle bottom: the claim's three questions ---------- */
  function renderDetail() {
    var d = $('detail'), c = claim(), it = item(), x = verdictOf(S.idx); d.textContent = '';
    d.appendChild(el('h2', null, c.statement));
    var dl = el('dl');
    function row(k, v) { dl.appendChild(el('dt', null, k)); var dd = el('dd'); if (v instanceof Node) dd.appendChild(v); else dd.textContent = v; dl.appendChild(dd); }
    row('field', c.field);
    row('value', JSON.stringify(c.value));
    var q = el('span', 'q', c.quote ? c.quote : '(none)'); row('quote', q);
    var pl = x.live ? x.L.places : currentPlaces();
    if (!c.quote) row('find', 'no quote came with this value, so nothing to find');
    else if (!pl.length) row('find', 'the quote is not in ' + c.source + (x.live ? ' (as edited)' : ''));
    else row('find', pl.length === 1 ? 'found, one place' : 'found in ' + pl.length + ' places' + (!x.live && it.disambiguated_by ? '; the report picked place ' + (S.place + 1) + ' using ' + it.disambiguated_by : '; the report took the first'));
    if (c.quote && pl.length) {
      var vs = x.live ? x.L.value : it.value_status;
      row('compare', (vs === 'match' ? 'the value is inside the quote' : vs === 'mismatch' ? 'the value is NOT inside the quote' : vs) + (!x.live && it.derivation && it.derivation.length ? ' (' + it.derivation.join(', ') + ')' : ''));
      var lo = it.locus || {};
      if (!x.live && lo.line) row('locate', 'line ' + lo.line + ', column ' + lo.col + (lo.xpath ? ' · ' + lo.xpath : ''));
    }
    row('verdict', el('span', 'chip v-' + x.v + (x.live ? ' live' : ''), G[x.v] + ' ' + x.v + (x.live ? ' (live)' : ' (' + S.policy + ' policy)')));
    d.appendChild(dl);
    if (c.note) d.appendChild(el('p', 'note', c.note));
  }

  /* ---------- right: X_ITE and the box ---------- */
  var OVL = (function () {
    var wire = '<Shape DEF="OVW"><Appearance><Material emissiveColor="1 0.72 0.2"/></Appearance><IndexedLineSet coordIndex="0 1 2 3 0 -1 4 5 6 7 4 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1"><Coordinate point="-.5 -.5 -.5 .5 -.5 -.5 .5 .5 -.5 -.5 .5 -.5 -.5 -.5 .5 .5 -.5 .5 .5 .5 .5 -.5 .5 .5"/></IndexedLineSet></Shape>';
    var fill = '<Shape DEF="OVF"><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 0.72 0.2" transparency="0.8"/></Appearance><Box size="1 1 1"/></Shape>';
    var s = '<Switch DEF="OVS0" whichChoice="-1"><Transform DEF="OVT0">' + wire + fill + '</Transform></Switch>';
    for (var i = 1; i < 5; i++) s += '<Switch DEF="OVS' + i + '" whichChoice="-1"><Transform DEF="OVT' + i + '"><Shape USE="OVW"/><Shape USE="OVF"/></Transform></Switch>';
    s += '<Switch DEF="OVSM" whichChoice="-1"><Transform DEF="OVTM"><Shape><Appearance><Material emissiveColor="1 0.72 0.2"/></Appearance><IndexedLineSet coordIndex="0 1 -1 2 3 -1 4 5 -1"><Coordinate point="-.45 0 0 .45 0 0 0 -.45 0 0 .45 0 0 0 -.45 0 0 .45"/></IndexedLineSet></Shape>' +
         '<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 0.72 0.2"/></Appearance><Sphere radius="0.12"/></Shape></Transform></Switch>';
    return s;
  })();
  function withOverlay(text) { var i = text.lastIndexOf('</Scene>'); return i < 0 ? text : text.slice(0, i) + OVL + text.slice(i); }

  function loadX() {
    if (S.xready) return S.xready;
    S.xready = new Promise(function (res) {
      var sc = document.createElement('script'); sc.src = XS;
      sc.onload = function () {
        var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = XS.replace('x_ite.min.js', 'x_ite.css'); document.head.appendChild(css);
        try { S.B = X3D.getBrowser($('xc')); $('xver').textContent = 'X_ITE ' + (X3D.version || S.B.version || ''); } catch (e) { S.B = null; }
        res(S.B);
      };
      sc.onerror = function () { $('stagemsg').textContent = 'X_ITE failed to load; the text side still works.'; res(null); };
      document.head.appendChild(sc);
    });
    return S.xready;
  }
  function draw(force) {
    var my = ++S.seq;
    return loadX().then(function (B) {
      if (!B) return;
      var text = S.text[SCENE_SRC]; if (!text) return;
      return B.createX3DFromString(withOverlay(text)).then(function (sc) { if (my !== S.seq) return; return B.replaceWorld(sc); }).then(function () {
        if (my !== S.seq) return; $('stagemsg').textContent = changed(SCENE_SRC) ? 'the edited scene' : 'the scene as published'; S.overlay = true; drawBox();
      }).catch(function (e) { if (my === S.seq) $('stagemsg').textContent = 'X_ITE could not load this text: ' + String(e && e.message || e).slice(0, 120); });
    });
  }
  function boxOf(loc) { var a = loc && loc.aabb_e6 && loc.aabb_e6[0]; return a ? a.map(function (v) { return v / 1e6; }) : null; }
  function markerOf(loc) {
    if (!loc || !loc.xpath) return null;
    try {
      var doc = new DOMParser().parseFromString(S.orig[SCENE_SRC].replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');
      var n = doc.evaluate(loc.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      var a = n && (n.getAttribute('location') || n.getAttribute('position'));
      return a ? a.trim().split(/\s+/).map(Number) : null;
    } catch (e) { return null; }
  }
  function drawBox() {
    var c = claim(), it = item(), lo = $('locus'); lo.textContent = '';
    var isScene = c.source === SCENE_SRC && !changed(SCENE_SRC), loc = null;
    var places = S.places[S.set] && S.places[S.set][String(S.idx)];
    if (isScene) loc = places && places.length ? places[Math.min(S.place || 0, places.length - 1)] : it.locus;
    var dl = el('dl');
    function row(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    var box = boxOf(loc), mk = null;
    if (isScene && (!box || loc.aabb_owner === '/X3D/Scene')) { mk = markerOf(loc); box = null; }
    var nm = isScene ? (loc && loc.node) : null;
    if (!isScene) {
      row('place', c.source === SCENE_SRC ? 'the scene text was edited: boxes belong to the published text, so none is drawn' : 'this claim is about a text file, not about the scene: no place in 3D');
    } else if (box) {
      row('node', loc.node || '');
      row('xpath', loc.xpath || '');
      row('box (m)', box.slice(0, 3).map(function (v) { return v.toFixed(3); }).join(' ') + '  to  ' + box.slice(3).map(function (v) { return v.toFixed(3); }).join(' '));
      row('size (m)', [box[3] - box[0], box[4] - box[1], box[5] - box[2]].map(function (v) { return v.toFixed(3); }).join(' × '));
      row('from', 'the report\'s world-space box of the nearest node that has geometry');
    } else if (mk) {
      row('node', nm + ' (no geometry of its own)'); row('marker', 'at ' + mk.join(' ') + ' (its location attribute)');
    } else {
      row('place', 'no geometry and no position for this node (' + (nm || 'attribute') + '): nothing to draw');
    }
    lo.appendChild(dl);
    if (!S.B || !S.overlay) return;
    var N = {};
    ['OVS0', 'OVS1', 'OVS2', 'OVS3', 'OVS4', 'OVSM', 'OVT0', 'OVT1', 'OVT2', 'OVT3', 'OVT4', 'OVTM'].forEach(function (n) { try { N[n] = S.B.currentScene.getNamedNode(n); } catch (e) { } });
    for (var i = 0; i < 5; i++) if (N['OVS' + i]) N['OVS' + i].whichChoice = -1;
    if (N.OVSM) N.OVSM.whichChoice = -1;
    function put(t, b) {
      var cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2, sx = Math.max(b[3] - b[0], 0.004), sy = Math.max(b[4] - b[1], 0.004), sz = Math.max(b[5] - b[2], 0.004);
      t.translation = new X3D.SFVec3f(cx, cy, cz); t.scale = new X3D.SFVec3f(sx * 1.01, sy * 1.01, sz * 1.01);
    }
    if (box && N.OVT0) { put(N.OVT0, box); N.OVS0.whichChoice = 0; }
    else if (mk && N.OVTM) { N.OVTM.translation = new X3D.SFVec3f(mk[0], mk[1], mk[2]); N.OVSM.whichChoice = 0; }
  }

  /* ---------- selection and the whole page ---------- */
  function select(i) { S.idx = i; S.place = null; url({ claim: i }); if (S.edit) { $('edit').click(); } renderList(); renderSource(); renderDetail(); drawBox(); }
  function renderAll() { renderTabs(); renderTally(); renderList(); renderSource(); renderDetail(); drawBox(); }
  Array.prototype.forEach.call(document.getElementsByName('pol'), function (r) {
    r.checked = r.value === S.policy;
    r.onchange = function () { S.policy = r.value; url({ policy: r.value }); renderAll(); };
  });

  function checks(list) {
    var ul = $('checklist'); ul.textContent = '';
    list.forEach(function (c) { var li = el('li'); li.appendChild(el('b', null, c.what + ': ')); li.appendChild(document.createTextNode(c.result + ' ')); li.appendChild(el('span', 'mono', '(' + c.how + ')')); ul.appendChild(li); });
  }

  function start() {
    get('data/claims.json', true).then(function (cj) {
      S.claims = cj;
      var jobs = [];
      cj.sets.forEach(function (s) {
        ['default', 'strict'].forEach(function (p) { jobs.push(get('data/report-' + s.id + '-' + p + '.json', true).then(function (r) { S.rep[s.id + '-' + p] = r; })); });
        jobs.push(get('data/places-' + s.id + '.json', true).then(function (r) { S.places[s.id] = r; }));
        s.sources.forEach(function (src) { if (!(src.id in S.orig)) jobs.push(get('data/' + src.file).then(function (t) { S.orig[src.id] = t; S.text[src.id] = t; })); });
      });
      jobs.push(get('data/checks.json', true).then(checks).catch(function () {}));
      return Promise.all(jobs);
    }).then(function () {
      S.shaOrig = {}; return Promise.all(Object.keys(S.orig).map(function (k) { return TC.sha256Hex(S.orig[k]).then(function (h) { S.sha[k] = h; S.shaOrig[k] = h; }); }));
    }).then(function () {
      if (!S.claims.sets.some(function (s) { return s.id === S.set; })) S.set = S.claims.sets[0].id;
      if (!(S.idx >= 0 && S.idx < set().claims.length)) S.idx = 0;
      renderAll(); draw(false);
      window.__traceReady = true;
    }).catch(function (e) { $('blurb').textContent = 'Could not load the data: ' + e.message; });
  }
  window.__trace = S;
  start();
})();
