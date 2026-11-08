/* Gobbler v4 hover controller: guided mouse, UI levels, dwell tiers, corner cards.
 * It reads the camera from a ProximitySensor added to the in-memory scene at run time (the .x3d file is never touched, and in UI none nothing is added),
 * projects the graph's own star coordinates (pick.js), and draws everything as DOM and SVG above the canvas.
 *   GobblerV4.start({G, ONTO, el, stage, root, level, hover, hoverTier}) -> window.gobbler
 * o.glass: never drop the blur behind cards (frames for the judge and the docs). o.tune: open the tuning panel (key T). Settings persist in localStorage (try/catch). Uses globals Cards, Pick, Place, Density (src/*.js) and the engine's PX (engine/common.js).
 */
(function () {
  'use strict';
  var DWELL = { label: 150, card: 450, deep: 1200 }, MARGIN = 22, GAP = 10, IDLE_CLOSE = 1200, RELEASE = 800, RESUME = 120, DRAG_PX = 5, FLY_MS = 1500, TAP_MS = 4000;
  var SVGNS = 'http://www.w3.org/2000/svg';
  /* the tuning panel (key T): the taste calls of the spec as live settings; ranges are [min, max, step] */
  var TUNE_DEF = { snap: 30, label: 150, card: 450, deep: 1200, dim: 1, halo: 96, core: true, leader: true, glass: 'auto' };
  var TUNE_SPEC = { snap: [10, 60, 1], label: [0, 600, 10], card: [100, 1500, 10], deep: [300, 3000, 50], dim: [0, 1.5, 0.05], halo: [40, 200, 4] };
  var TUNE_ROWS = [['snap', 'Snap distance', 'px'], ['label', 'Tooltip after', 'ms'], ['card', 'Card after', 'ms'], ['deep', 'Deep card after', 'ms'], ['dim', 'Focus dim', 'x'], ['halo', 'Card keeps clear of the star', 'px']];
  function cleanTune(src, base) {
    var t = {}, k; for (k in TUNE_DEF) t[k] = base && k in base ? base[k] : TUNE_DEF[k];
    if (src) {
      for (k in TUNE_SPEC) if (typeof src[k] === 'number' && isFinite(src[k])) t[k] = Math.min(TUNE_SPEC[k][1], Math.max(TUNE_SPEC[k][0], src[k]));
      if (typeof src.core === 'boolean') t.core = src.core; if (typeof src.leader === 'boolean') t.leader = src.leader; if (/^(auto|on|off)$/.test(src.glass)) t.glass = src.glass;
    }
    t.card = Math.max(t.card, t.label); t.deep = Math.max(t.deep, t.card); return t;
  }

  function start(o) {
    var G = o.G, el = o.el, stage = o.stage, root = o.root, C = Cards.create(G, o.ONTO), idx = new Pick.Index(G.nodes.slice(0, G.drawn));
    var $ = function (s) { return root.querySelector(s); };
    var dim = $('.gv4-dim'), svg = $('.gv4-svg'), tip = $('.gv4-tip'), card = $('.gv4-card');
    var S = { level: 'min', hold: false, ready: false, W: 0, H: 0, pos: null, ori: null, fov: 0.9, camDirty: true, camT: 0, ps: null, gates: { Intro: false, Dissolve: false }, gate: false,
      ptr: { x: 0, y: 0, x0: 0, y0: 0, in: false, down: false, drag: false, onCard: false, onUi: false, type: 'mouse' }, shift: false, lastMoveT: 0, lastSnapT: 0, resumeAt: 0,
      snap: -1, snapT: 0, tier: 0, cands: [], userPick: -1, pin: -1, forced: -1, forcedTier: 3, open: -1, openTier: 0, echo: -1, touchStar: -1, touchT: 0,
      held: false, lastWant: 0, openT: 0, capRetryAt: 0, capFailT: 0, density: null, denKind: '', lumaStale: true, capBusy: false, capFail: 0, cardSize: null, prevSlot: null, place: null, chips: null, raf: 0, flyRaf: 0, sig: {}, solid: false };

    var T; try { T = cleanTune(JSON.parse(localStorage.getItem('gv4.tune'))); } catch (e) { T = cleanTune(null); }
    if (o.glass) T.glass = 'on';                          /* ?glass=1: frames for the docs and the judge keep the blur */

    /* ---------- svg layers ---------- */
    function sv(tag, attrs, parent) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
    sv('defs', {}).innerHTML = '<filter id="gv4-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    var leadShadow = sv('path', { fill: 'none', stroke: 'rgba(0,0,0,.62)', 'stroke-width': 4.6, 'stroke-linecap': 'round' }), lead = sv('path', { fill: 'none', stroke: '#f2dc9b', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
    var leadDot = sv('circle', { r: 3.2, fill: '#f2dc9b', stroke: 'rgba(0,0,0,.6)', 'stroke-width': 1.5 });
    var echo = sv('circle', { r: 11, fill: 'none', stroke: '#fff6dc', 'stroke-width': 1.4, 'stroke-dasharray': '3 3' });
    var rings = [0, 1].map(function () {
      var g = sv('g', {}); return { g: g, halo: sv('circle', { r: 15, fill: 'none', stroke: '#e9cf8a', 'stroke-width': 1.6, filter: 'url(#gv4-glow)' }, g), dot: sv('circle', { r: 4.5, fill: '#fff6dc' }, g), arc: sv('circle', { r: 22, fill: 'none', 'stroke-width': 2.6, 'stroke-linecap': 'round' }, g) };
    });
    function show(e, on) { e.style.display = on ? '' : 'none'; }
    [leadShadow, lead, leadDot, echo].forEach(function (e) { show(e, false); }); rings.forEach(function (r) { show(r.g, false); });

    /* ---------- camera from a ProximitySensor, fov from the active viewpoint ---------- */
    function br() { return el.browser; }
    function ensureSensor() {
      if (S.ps) { S.ps.enabled = true; return; }
      var sc = br().currentScene, ps = sc.createNode('ProximitySensor');
      ps.size = new X3D.SFVec3f(1e7, 1e7, 1e7); sc.addRootNode(ps);
      ps.addFieldCallback('gv4', 'position_changed', function (v) { S.pos = [v.x, v.y, v.z]; camChanged(); });
      ps.addFieldCallback('gv4', 'orientation_changed', function (v) { S.ori = [v.x, v.y, v.z, v.angle]; camChanged(); });
      S.ps = ps;
    }
    function camChanged() {
      S.camDirty = true; S.camT = performance.now(); S.lumaStale = true;
      if (S.pendingFly != null && S.pos && S.ori) { var i = S.pendingFly; S.pendingFly = null; fly(i, 0); }      /* ?hover= waits for the first camera pose */
      if (S.ptr.in || S.open >= 0 || S.pin >= 0 || S.forced >= 0) kick();
    }
    function refreshFov() { try { var f = br().activeViewpoint.fieldOfView; if (f && f !== S.fov) { S.fov = f; S.camDirty = true; S.lumaStale = true; } } catch (e) {} }
    function project() { if (!S.pos || !S.ori) return false; if (S.camDirty || S.W !== idx.W || S.H !== idx.H) { idx.update({ pos: S.pos, ori: S.ori, fov: S.fov }, S.W, S.H); S.camDirty = false; S.starDen = null; } return true; }
    function watchGates() {
      var sc = br().currentScene;
      ['Intro', 'Dissolve'].forEach(function (name) {
        try {
          var n = sc.getNamedNode(name); S.gates[name] = !!n.isActive;
          n.addFieldCallback('gv4', 'isActive', function (v) { S.gates[name] = !!v; setGate(); });
        } catch (e) { console.warn('gv4: no ' + name + ' timer', e); }
      });
      setGate();
    }
    function setGate() { var g = S.gates.Intro || S.gates.Dissolve; if (g !== S.gate) { S.gate = g; if (g) closeAll(true); S.camDirty = true; S.lumaStale = true; kick(); } }

    /* ---------- UI level ---------- */
    function setLevel(l, persist) {
      S.level = l; root.dataset.ui = S.hold ? 'none' : l;
      if (window.PX && PX.clean) PX.clean(l === 'none');
      var b = document.getElementById('gv4-ui'); if (b) b.innerHTML = '◐ UI<span class="k">' + (l === 'none' ? 'none' : 'minimal') + '</span>';
      if (l === 'none') { closeAll(); if (S.ps) S.ps.enabled = false; releaseTour(true); } else if (S.ready) { ensureSensor(); S.camDirty = true; kick(); }
      if (persist) try { localStorage.setItem('gv4.ui', l); } catch (e) {}
    }
    function momentary(on) { S.hold = on; root.dataset.ui = on ? 'none' : S.level; if (on) { closeAll(true); releaseTour(true); } else kick(); }

    /* ---------- chips: measured boxes feed the placement ---------- */
    function chipBoxes() {
      if (S.chips) return S.chips;
      var rr = root.getBoundingClientRect(), obstacles = [], reserved = {};
      [].forEach.call(root.querySelectorAll('.gv4-corner, .gv4-tune'), function (c) {
        var r = c.getBoundingClientRect(); if (!r.width || !r.height) return; var b = { x: r.left - rr.left, y: r.top - rr.top, w: r.width, h: r.height };
        obstacles.push({ x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }); if (c.dataset.corner) reserved[c.dataset.corner] = { h: b.h + GAP };
      });
      return (S.chips = { obstacles: obstacles, reserved: reserved });
    }
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { S.chips = null; S.camDirty = true; kick(); }); [].forEach.call(root.querySelectorAll('.gv4-corner'), function (c) { ro.observe(c); }); ro.observe(root); }

    /* ---------- density for the card placement: the frame itself when we can read it, the projected stars otherwise ---------- */
    function starDensity() {                           /* the fallback: projected stars and the tethers between them */
      if (S.starDen) return S.starDen;
      var segs = [], a = {}, b = {}, E = G.edges, k;
      for (k = 0; k < E.length; k++) { var e = E[k]; if (e.s >= G.drawn || e.t >= G.drawn) continue; if (idx.proj(e.s, a) && idx.proj(e.t, b)) segs.push(a.x, a.y, b.x, b.y); }
      return (S.starDen = Density.fromGraph(idx.sx, idx.sy, idx.vis, idx.nvis, segs, S.W, S.H));
    }
    function canCapture(now) {                          /* a hard failure (exception, black frame) three times switches the readback off for 15 s; a timeout only waits 1.5 s */
      if (S.capFail >= 3 && now - S.capFailT > 15000) S.capFail = 0;
      return S.lumaStale && !S.capBusy && S.capFail < 3 && now >= S.capRetryAt && now - S.camT > 250;
    }
    function capture() {                                /* one readback inside the frame that was just drawn: the drawing buffer is valid there without preserveDrawingBuffer */
      if (S.capBusy) return; S.capBusy = true; var t0 = S.camT, done = false;
      var finish = function (res, timedOut) {
        if (done) return; done = true; S.capBusy = false;
        try { br().finishEvents().removeFieldCallback('gv4cap'); } catch (e) {}
        if (res && res.meanLuma > 0.001) { if (S.denKind !== 'luma') S.prevSlot = null; S.density = res; S.denKind = 'luma';   /* a new basis: no hysteresis from a slot chosen on the proxy */
          S.lumaStale = S.camT !== t0; S.capFail = 0; }
        else { if (timedOut) S.capRetryAt = performance.now() + 1500; else { S.capFail++; S.capFailT = performance.now(); S.lumaStale = false; } S.denKind = 'stars'; S.density = null; }
        kick();
      };
      try {
        var cv = br().getCanvas(), w = 192, h = Math.max(1, Math.round(w * S.H / S.W)), t = S.cv || (S.cv = document.createElement('canvas')); t.width = w; t.height = h;
        var cx = t.getContext('2d', { willReadFrequently: true });
        br().finishEvents().addFieldCallback('gv4cap', function () {
          try { cx.drawImage(cv, 0, 0, w, h); finish(Density.fromLuma(cx.getImageData(0, 0, w, h).data, w, h, S.W, S.H)); } catch (e) { finish(null); }
        });
        try { br().nextFrame(); } catch (e) {}
        setTimeout(function () { finish(null, true); }, 800);
      } catch (e) { finish(null); }
    }

    /* ---------- draw ---------- */
    function starXY(i) { var p = idx.screen(i); return p.visible ? p : null; }
    function setTip(i, extra, x, y) {
      var t = C.tip(i, extra), sig = i + ':' + extra;
      if (S.sig.tip !== sig) { var hint = document.getElementById('gv4-hint'); if (hint && !hint.hidden) hint.hidden = true; tip.innerHTML = t.html; S.sig.tip = sig; S.tipSize = null; tip.className = 'gv4-tip gv4-glass on'; }
      if (!S.tipSize) S.tipSize = { w: tip.offsetWidth, h: tip.offsetHeight };
      var w = S.tipSize.w, px = x + 24, py = y - 48;
      if (px + w > S.W - 8) px = x - 24 - w; if (px < 8) px = 8; if (py < 8) py = y + 24; if (py + S.tipSize.h > S.H - 8) py = S.H - 8 - S.tipSize.h;
      tip.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
    }
    function hideTip() { if (S.sig.tip) { tip.className = 'gv4-tip gv4-glass'; S.sig.tip = ''; } }
    function setRing(r, p, hex, prog) {
      if (!p) { show(r.g, false); return; }
      show(r.g, true); [r.halo, r.dot, r.arc].forEach(function (c) { c.setAttribute('cx', p.x.toFixed(1)); c.setAttribute('cy', p.y.toFixed(1)); });
      if (prog == null || prog >= 1) show(r.arc, false); else {
        var R = 22, L = 2 * Math.PI * R; show(r.arc, true); r.arc.setAttribute('stroke', hex); r.arc.setAttribute('stroke-dasharray', (L * prog).toFixed(1) + ' ' + L.toFixed(1)); r.arc.setAttribute('transform', 'rotate(-90 ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');
      }
    }
    function setDim(p, a) { if (!p) { dim.classList.remove('on'); return; } dim.style.setProperty('--cx', p.x.toFixed(0) + 'px'); dim.style.setProperty('--cy', p.y.toFixed(0) + 'px'); dim.style.setProperty('--a', a); dim.classList.add('on'); }
    function renderCard(i, tier) {
      var c = C.card(i, tier), sig = i + ':' + tier;
      if (S.sig.card === sig) return; var hint = document.getElementById('gv4-hint'); if (hint) hint.hidden = true; S.sig.card = sig; S.openTier = tier;
      card.innerHTML = c.html; card.className = 'gv4-card gv4-glass on'; card.style.maxHeight = ''; card.style.width = ''; S.cardSize = null; S.sig.place = '';     /* new content: size it again and re-apply the sheet and shrink styles even if the rect comes out the same */
    }
    function hideCard() { if (S.sig.card) { card.className = 'gv4-card gv4-glass'; S.sig.card = ''; S.cardSize = null; S.prevSlot = null; } show(leadShadow, false); show(lead, false); show(leadDot, false); }
    function placeCard(i) {
      var p = starXY(i), W = S.W, H = S.H, chips = chipBoxes();
      var hover = p ? { x: p.x, y: p.y } : { x: W / 2, y: H / 2 };          /* star off screen: dock anywhere clear of the middle, no leader */
      if (!S.cardSize) { card.classList.remove('sheet', 'shrunk'); card.style.width = W < Place.NARROW ? Math.max(1, W - 2 * MARGIN) + 'px' : ''; card.style.maxHeight = ''; S.cardSize = { w: card.offsetWidth, h: card.offsetHeight }; }
      var res = Place.choose({ W: W, H: H, hover: hover, size: S.cardSize, density: S.density || starDensity(), margin: MARGIN, reserved: chips.reserved, obstacles: chips.obstacles, halo: T.halo, prev: S.prevSlot });
      S.prevSlot = res.slot; S.place = { slot: res.slot, rect: res.rect, shrunk: res.shrunk, fallback: res.fallback, kind: S.denKind || 'stars' };
      var r = res.rect, sig = res.slot + ':' + Math.round(r.x) + ':' + Math.round(r.y) + ':' + Math.round(r.h);
      if (S.sig.place !== sig) {
        S.sig.place = sig; card.style.transform = 'translate(' + Math.round(r.x) + 'px,' + Math.round(r.y) + 'px)'; card.classList.toggle('sheet', res.slot === 'SHEET'); card.classList.toggle('shrunk', !!res.shrunk);
        card.style.width = res.slot === 'SHEET' ? r.w + 'px' : ''; card.style.maxHeight = res.shrunk || res.slot === 'SHEET' ? Math.round(r.h) + 'px' : '';
      }
      if (p && res.leader && T.leader && !S.waitPaint) {        /* leader: star to the nearest point of the card, fading with distance */
        var q = res.leader, dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        var d = 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' Q' + ((p.x + q.x) / 2 + nx * L * 0.1).toFixed(1) + ' ' + ((p.y + q.y) / 2 + ny * L * 0.1).toFixed(1) + ' ' + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
        var op = Math.max(0.35, 1 - L / 1400).toFixed(2);
        [leadShadow, lead].forEach(function (e) { e.setAttribute('d', d); e.setAttribute('opacity', op); show(e, true); }); leadDot.setAttribute('cx', q.x.toFixed(1)); leadDot.setAttribute('cy', q.y.toFixed(1)); leadDot.setAttribute('opacity', op); show(leadDot, true);
      } else { show(leadShadow, false); show(lead, false); show(leadDot, false); }
    }
    function closeAll(soft) {
      hideTip(); hideCard(); setDim(null); rings.forEach(function (r) { show(r.g, false); }); show(echo, false);
      S.open = -1; S.snap = -1; S.tier = 0; S.snapT = 0;
      if (!soft) { S.pin = -1; S.forced = -1; S.touchStar = -1; }
    }
    function releaseTour(force) { if (S.held && window.PX && PX.tourRelease && (force || performance.now() - S.lastWant > RELEASE)) { PX.tourRelease(); S.held = false; } }

    /* ---------- the frame ---------- */
    function kick() { if (!S.raf) S.raf = requestAnimationFrame(frame); }
    function frame() {
      S.raf = 0;
      if (S.level === 'none' || S.hold || !S.ready) return;
      var now = performance.now(), W = stage.clientWidth, H = stage.clientHeight;
      if (W !== S.W || H !== S.H) { S.W = W; S.H = H; S.camDirty = true; S.chips = null; S.density = null; S.denKind = ''; S.lumaStale = true; S.sig.place = ''; S.cardSize = null; }
      if (S.gate) { return; }
      refreshFov();
      var pt = S.ptr, mouse = pt.type !== 'touch', pointing = mouse && pt.in && !pt.drag && !pt.onUi && !pt.onCard && now >= S.resumeAt;
      var havePose = project(), loop = false;

      /* pick and dwell */
      var snap = -1;
      if (pt.onCard) snap = S.snap; else if (pointing && havePose) {
        var pk = idx.pick(pt.x, pt.y, { radius: T.snap, all: S.shift || !T.core });
        if (pk) { snap = pk.i; S.cands = pk.cands; if (S.userPick >= 0 && pk.cands.some(function (c) { return c.i === S.userPick; })) snap = S.userPick; else S.userPick = -1; } else { S.cands = []; S.userPick = -1; }
      }
      if (snap !== S.snap) { S.snap = snap; S.snapT = now; }
      if (snap >= 0) S.lastSnapT = now;
      var dt = snap >= 0 ? now - S.snapT : 0, tier = snap < 0 ? 0 : dt >= DWELL.deep ? 3 : dt >= DWELL.card ? 2 : dt >= DWELL.label ? 1 : 0;
      if (pt.onCard) tier = S.tier; S.tier = tier;

      /* which star owns the card */
      var open = S.open, want = 2;
      if (S.pin >= 0) { open = S.pin; want = 3; }
      else if (S.forced >= 0) { open = S.forced; want = S.forcedTier; }
      else if (snap >= 0 && tier >= 2) { open = snap; want = tier; }
      else if (S.open >= 0) { want = S.openTier; if (!pt.onCard && snap < 0 && now - Math.max(S.lastMoveT, S.lastSnapT) > IDLE_CLOSE) open = -1; else if (!pt.in && now - S.lastMoveT > IDLE_CLOSE) open = -1; }
      if (open !== S.open) { S.open = open; if (open < 0) { hideCard(); } else { S.prevSlot = null; S.openT = now; if (S.denKind !== 'luma') S.lumaStale = true; } }

      /* hold the tour still while something is being read */
      if (S.held && window.PX && PX.tourHeld && !PX.tourHeld()) S.held = false;       /* the engine's Pause button ends a hold: re-hold next time */
      var wantHold = (snap >= 0 && tier >= 1) || open >= 0;
      if (wantHold) { S.lastWant = now; if (!S.held && window.PX && PX.tourHold) S.held = PX.tourHold(); } else releaseTour(false);

      /* draw */
      var tipStar = snap >= 0 && tier >= 1 && snap !== open ? snap : (S.touchStar >= 0 && now - S.touchT < TAP_MS && open !== S.touchStar ? S.touchStar : -1);
      var sp = snap >= 0 ? starXY(snap) : null, op = open >= 0 ? starXY(open) : null;
      if (tipStar >= 0) { var tp = tipStar === snap ? sp : starXY(tipStar); if (tp) setTip(tipStar, tipStar === snap ? Math.max(0, S.cands.length - 1) : 0, tp.x, tp.y); else hideTip(); } else hideTip();
      setRing(rings[0], sp && snap !== open ? sp : null, snap >= 0 ? C.hex(G.nodes[snap]) : '#e9cf8a', snap !== open && tier < 2 ? Math.min(1, dt / DWELL.card) : null);
      setRing(rings[1], op, '#e9cf8a', null);
      if (tier >= 1 && open < 0 && canCapture(now)) capture();       /* read the frame while the dwell runs, so the card appears already placed */
      if (open >= 0) {
        renderCard(open, want);
        if (canCapture(now)) capture();
        S.waitPaint = !(S.denKind === 'luma' || S.capFail >= 3 || now - S.openT > 500);                                   /* decided first: no leader points at a card that is still hidden */
        placeCard(open); card.style.visibility = S.waitPaint ? 'hidden' : ''; setDim(op, (S.waitPaint ? 0.34 : 0.46) * T.dim);
      } else { S.waitPaint = false; setDim(sp && tier >= 1 ? sp : null, 0.34 * T.dim); }
      var ep = S.echo >= 0 ? starXY(S.echo) : null; show(echo, !!ep); if (ep) { echo.setAttribute('cx', ep.x.toFixed(1)); echo.setAttribute('cy', ep.y.toFixed(1)); }
      if ((snap >= 0 && tier < 3) || S.camDirty || S.held || (open >= 0 && S.waitPaint) || (pt.in && now < S.resumeAt) || (tipStar >= 0 && S.touchStar >= 0) || (open >= 0 && (S.pin < 0 && S.forced < 0 || S.lumaStale || S.capBusy))) loop = true;     /* otherwise events (pointer, camera, keys) wake it */
      if (loop) kick();
    }

    /* ---------- pointer and keys ---------- */
    function inUi(t, sel) { return !!(t && t.closest && t.closest(sel)); }
    stage.addEventListener('pointermove', function (ev) {
      if (S.level === 'none' || S.hold) return;
      var r = root.getBoundingClientRect(), p = S.ptr; p.x = ev.clientX - r.left; p.y = ev.clientY - r.top; p.in = true; p.type = ev.pointerType || 'mouse'; S.shift = ev.shiftKey; S.lastMoveT = performance.now();
      p.onCard = inUi(ev.target, '.gv4-card'); p.onUi = !p.onCard && inUi(ev.target, '.gv4-corner, .gv4-peek, .gv4-tune');
      if (p.down && !p.drag && Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) > DRAG_PX) { p.drag = true; closeAll(true); }
      kick();
    }, { passive: true });
    stage.addEventListener('pointerleave', function () { S.ptr.in = false; S.ptr.onCard = false; S.ptr.onUi = false; kick(); });
    stage.addEventListener('pointerdown', function (ev) {
      var p = S.ptr; p.down = ev.button === 0 && !inUi(ev.target, '.gv4-card, .gv4-corner, .gv4-peek, .gv4-tune'); p.drag = false; p.x0 = ev.clientX; p.y0 = ev.clientY; p.type = ev.pointerType || 'mouse';
    });
    window.addEventListener('pointerup', function (ev) {
      var p = S.ptr, was = p.down, drag = p.drag; p.down = false; p.drag = false;
      if (!was || S.level === 'none' || S.hold) return;
      if (drag) { S.resumeAt = performance.now() + RESUME; S.camDirty = true; kick(); return; }
      var r = root.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, now = performance.now();
      if (ev.pointerType === 'touch') {                                         /* tap = label, second tap on the same star = card */
        project(); var pk = idx.pick(x, y, { radius: 40 });
        if (pk && pk.i === S.touchStar && now - S.touchT < TAP_MS) { S.pin = pk.i; } else if (pk) { S.touchStar = pk.i; S.touchT = now; } else { S.pin = -1; S.touchStar = -1; S.forced = -1; }
        kick(); return;
      }
      if (S.snap >= 0) { S.pin = S.snap; S.forced = -1; } else if (!S.gate) closeAll();
      kick();
    });
    stage.addEventListener('dblclick', function (ev) { if (inUi(ev.target, '.gv4-card, .gv4-corner, .gv4-peek, .gv4-tune')) return; var i = S.pin >= 0 ? S.pin : S.snap >= 0 ? S.snap : S.open; if (i >= 0) fly(i); });
    card.addEventListener('click', function (ev) { var li = ev.target.closest && ev.target.closest('li[data-go]'); if (li) { var i = +li.dataset.go; S.pin = i; S.forced = -1; fly(i); } });
    card.addEventListener('pointerover', function (ev) { var li = ev.target.closest && ev.target.closest('li[data-go]'); S.echo = li ? +li.dataset.go : -1; kick(); });
    card.addEventListener('pointerleave', function () { S.echo = -1; kick(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))) return;
      var k = ev.key;
      if (k === 'u' || k === 'U') { if (!ev.repeat) setLevel(S.level === 'none' ? 'min' : 'none', true); }
      else if (k === 'h' || k === 'H') { if (!ev.repeat) momentary(true); }
      else if (S.level === 'none') return;
      else if (k === 't' || k === 'T') { if (!ev.repeat) toggleTune(tune.hidden); }
      else if (k === 'Escape') { S.pin = -1; S.forced = -1; S.touchStar = -1; closeAll(); kick(); }
      else if (k === 'f' || k === 'F') { var i = S.pin >= 0 ? S.pin : S.open >= 0 ? S.open : S.snap; if (i >= 0) fly(i); }
      else if (k === 'Shift') { S.shift = true; kick(); }
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && S.cands.length > 1) {
        var cur = S.cands.findIndex(function (c) { return c.i === S.snap; }), nx = S.cands[(cur + (k === 'ArrowRight' ? 1 : -1) + S.cands.length) % S.cands.length].i;
        S.userPick = nx; S.snapT = performance.now(); kick(); ev.preventDefault();
      }
    });
    function dropKeys() { S.shift = false; S.ptr.down = false; S.ptr.drag = false; if (S.hold) momentary(false); }       /* keyup never arrives if the window loses focus first */
    window.addEventListener('blur', dropKeys); document.addEventListener('visibilitychange', function () { if (document.hidden) dropKeys(); });
    document.addEventListener('keyup', function (ev) { if (ev.key === 'h' || ev.key === 'H') momentary(false); else if (ev.key === 'Shift') { S.shift = false; kick(); } });
    var peek = $('.gv4-peek'); if (peek) peek.addEventListener('click', function () { setLevel('min', true); });
    var tg = document.getElementById('gv4-ui'); if (tg) tg.addEventListener('click', function () { setLevel(S.level === 'none' ? 'min' : 'none', true); });

    /* ---------- tuning panel (key T) ---------- */
    var tune = document.createElement('div'); tune.className = 'gv4-tune gv4-glass'; tune.id = 'gv4-tune'; tune.hidden = true; tune.setAttribute('role', 'group'); tune.setAttribute('aria-label', 'Tuning');
    tune.innerHTML = '<div class="gv4-th"><b>Tune</b><button type="button" class="x" data-act="reset" id="gv4-t-reset" title="Back to the defaults">reset</button><button type="button" class="x" data-act="close" id="gv4-t-close" aria-label="Close">&times;</button></div>'
      + TUNE_ROWS.map(function (r) { var sp = TUNE_SPEC[r[0]]; return '<label class="r" for="gv4-t-' + r[0] + '"><span>' + r[1] + '</span><output id="gv4-o-' + r[0] + '"></output><input type="range" id="gv4-t-' + r[0] + '" data-k="' + r[0] + '" min="' + sp[0] + '" max="' + sp[1] + '" step="' + sp[2] + '"></label>'; }).join('')
      + '<label class="cb" for="gv4-t-core"><input type="checkbox" id="gv4-t-core" data-k="core"><span>Crowded views: hover core stars only (Shift = all)</span></label>'
      + '<label class="cb" for="gv4-t-leader"><input type="checkbox" id="gv4-t-leader" data-k="leader"><span>Leader line from star to card</span></label>'
      + '<label class="cb" for="gv4-t-glass"><span>Frosted glass</span><select id="gv4-t-glass" data-k="glass"><option value="auto">auto</option><option value="on">always</option><option value="off">off</option></select></label>'
      + '<div class="gv4-tk">U ui &middot; hold H to hide &middot; T tune &middot; Shift all stars &middot; F fly &middot; Esc close</div>';
    root.appendChild(tune);
    function syncTune() {
      TUNE_ROWS.forEach(function (r) { var k = r[0], inp = tune.querySelector('#gv4-t-' + k), out = tune.querySelector('#gv4-o-' + k); if (+inp.value !== T[k]) inp.value = T[k]; out.textContent = (k === 'dim' ? T[k].toFixed(2) : Math.round(T[k])) + ' ' + r[2]; });
      tune.querySelector('#gv4-t-core').checked = T.core; tune.querySelector('#gv4-t-leader').checked = T.leader; tune.querySelector('#gv4-t-glass').value = T.glass;
    }
    function applyTune(save) {
      DWELL.label = T.label; DWELL.card = T.card; DWELL.deep = T.deep;
      S.solid = T.glass === 'off'; root.classList.toggle('gv4-solid', S.solid); slow = 0;
      S.sig.place = ''; S.cardSize = null; S.camDirty = true; syncTune(); kick();
      if (save) try { localStorage.setItem('gv4.tune', JSON.stringify(T)); } catch (e) {}
    }
    function toggleTune(on) { tune.hidden = !on; S.chips = null; S.sig.place = ''; S.cardSize = null; kick(); }
    tune.addEventListener('input', function (ev) { var el = ev.target, k = el.dataset && el.dataset.k; if (!k) return; var patch = {}; patch[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value; T = cleanTune(patch, T); applyTune(true); });
    tune.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('button[data-act]'); if (!b) return; if (b.dataset.act === 'close') toggleTune(false); else { T = cleanTune(o.glass ? { glass: 'on' } : null); applyTune(true); } });
    if (window.ResizeObserver) { var ro2 = new ResizeObserver(function () { S.chips = null; kick(); }); ro2.observe(tune); }

    /* ---------- fly (through the scene's Probe viewpoint, from the real camera pose) ---------- */
    function fly(i, ms) {
      if (!window.PX || !S.pos || !S.ori || !G.nodes[i]) return; var p = G.nodes[i].xyz, v;
      PX.tourStop(); S.held = false;
      try { v = br().currentScene.getNamedNode('Probe'); } catch (e) { return; }
      var a = S.pos.slice(), b = [p[0] + 0.35, p[1] + 0.4, p[2] + 2.6], t0 = performance.now(), D = ms == null ? FLY_MS : ms;
      try { v.position = new X3D.SFVec3f(a[0], a[1], a[2]); v.orientation = new X3D.SFRotation(S.ori[0], S.ori[1], S.ori[2], S.ori[3]); v.fieldOfView = S.fov; v.set_bind = true; } catch (e) {}
      S.resumeAt = t0 + D + 100; cancelAnimationFrame(S.flyRaf);
      (function step() {
        var k = D <= 0 ? 1 : Math.min(1, (performance.now() - t0) / D); k = k * k * (3 - 2 * k);
        var q = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], ori = PX.lookAt(q, p);
        try { v.position = new X3D.SFVec3f(q[0], q[1], q[2]); v.orientation = new X3D.SFRotation(ori[0], ori[1], ori[2], ori[3]); } catch (e) {}
        if (k < 1) S.flyRaf = requestAnimationFrame(step);
      })();
    }

    /* ---------- health: drop the blur behind cards if the frame rate sags ---------- */
    var slow = 0;
    setInterval(function () {
      if (S.level === 'none' || S.open < 0 || S.solid || T.glass !== 'auto') return; var hud = document.getElementById('hud'), f = hud && +hud.dataset.fps;
      if (f && f < 50) { if (++slow >= 2) { S.solid = true; root.classList.add('gv4-solid'); } } else slow = 0;
    }, 1500);

    /* ---------- go ---------- */
    var api = window.gobbler = {
      version: 'gobbler-v4 live hover',
      hover: function (i, tier) { if (!(i >= 0 && i < G.drawn && i % 1 === 0)) return false; PX.tourStop(); S.forced = i; S.forcedTier = tier || 3; S.pin = -1; if (S.level === 'none') setLevel('min'); if (S.pos && S.ori) fly(i, 0); else S.pendingFly = i; kick(); return true; },
      fly: function (i) { fly(i); },
      ui: function (l) { if (l) setLevel(l === 'none' ? 'none' : 'min', true); return S.level; },
      screen: function (i) { project(); return idx.screen(i); },
      camera: function () { return { pos: S.pos, ori: S.ori, fov: S.fov }; },
      pickAt: function (x, y, all) { project(); var k = idx.pick(x, y, { radius: T.snap, all: !!all || !T.core }); return k && { i: k.i, d: k.d, cands: k.cands.map(function (c) { return c.i; }) }; },
      state: function () { return { level: S.level, hold: S.hold, ready: S.ready, gate: S.gate, snap: S.snap, tier: S.tier, open: S.open, openTier: S.openTier, pin: S.pin, held: S.held, nvis: idx.nvis, medianGap: idx.medianGap, lodCore: idx.lodCore, density: S.denKind, place: S.place, sensor: !!S.ps, W: S.W, H: S.H, solid: S.solid, havePose: !!(S.pos && S.ori), capFail: S.capFail }; },
      node: function (i) { return G.nodes[i]; },
      tune: function (patch) { if (patch) { T = cleanTune(patch, T); applyTune(true); } var c = {}; for (var k in T) c[k] = T[k]; return c; },
      dwell: function (o) { for (var k in o) if (k in DWELL) DWELL[k] = o[k]; return DWELL; },          /* test hook: stretch a tier to capture its frame */
      /* test hook: both density sources sampled on a gx x gy grid (after a fresh readback) */
      densityDump: function (gx, gy) {
        project(); S.lumaStale = true; capture();
        return new Promise(function (res) { var tries = 0; (function wait() { if (S.denKind === 'luma' && !S.lumaStale) { var out = { luma: [], stars: [] }, sd = starDensity(); for (var j = 0; j < gy; j++) for (var i = 0; i < gx; i++) { var x = (i + 0.5) * S.W / gx, y = (j + 0.5) * S.H / gy; out.luma.push(+S.density(x, y).toFixed(2)); out.stars.push(+sd(x, y).toFixed(2)); } res(out); } else if (++tries > 40) res(null); else setTimeout(wait, 150); })(); });
      },
      /* test hook: which corner would the card for star i take with the frame's pixels and with the projected stars only (acceptance test 4) */
      placeBoth: function (i, size) {
        project(); var p = starXY(i); if (!p) return Promise.resolve(null); var chips = chipBoxes(), sz = size || { w: 348, h: 380 };
        var run = function (den) { return Place.choose({ W: S.W, H: S.H, hover: { x: p.x, y: p.y }, size: sz, density: den, margin: MARGIN, reserved: chips.reserved, obstacles: chips.obstacles, halo: T.halo }); };
        var table = function (r) { var t = {}; r.scores.forEach(function (x) { t[x.slot] = x.feasible ? +x.score.toFixed(3) : null; }); return t; };
        return new Promise(function (res) { var tries = 0; (function wait() { if (S.denKind === 'luma' && !S.lumaStale) { var a = run(S.density), b = run(starDensity()); res({ luma: a.slot, stars: b.slot, lumaScores: table(a), starScores: table(b) }); } else { S.lumaStale = true; capture(); if (++tries > 40) res(null); else setTimeout(wait, 150); } })(); });
      }
    };
    S.W = stage.clientWidth; S.H = stage.clientHeight; S.ready = true;
    watchGates(); applyTune(false); setLevel(o.level === 'none' ? 'none' : 'min', false); if (o.tune) toggleTune(true);
    if (o.hover != null && !isNaN(o.hover)) api.hover(o.hover, o.hoverTier);
    return api;
  }
  window.GobblerV4 = { start: start };
})();
