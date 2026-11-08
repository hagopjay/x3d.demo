/* Gobbler demiurge, step 2: bird-first boot.
 *  1. an honest staged loader: every stage names itself, shows bytes and seconds, and a failure says what failed (no fixed "parsing" text)
 *  2. gzip delivery: the scene arrives as gobbler4-bird.x3d.gz (or base64 text for hosts that refuse binary) and is inflated here
 *  3. the bird alone first (scene about 0.2 MB gzipped); the graph, ontology block, anchors and receipt load after the first frame
 *  4. four controls (UI level, Face, Tour, zoom rail), anchor tags, flights, then the v4 hover layer on top
 * Config (window.GD_CFG, set by a published copy): bird, enc ('gz' | 'b64gz'), graph, graphEnc, onto, anchors, receipt.
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var q = new URLSearchParams(location.search);
  var CFG = Object.assign({ bird: 'data/bird/gobbler4-bird.x3d.gz', enc: 'gz', graph: 'data/bird/graph-v3.json.gz', graphEnc: 'gz', onto: '../gobbler-v4/data/onto-hover.json',
    anchors: 'data/bird/anchors.json', receipt: 'data/bird/receipt.json', world: 'data/bird/world.json' }, window.GD_CFG || {});
  if (q.get('look') === 'gold') CFG.bird = 'data/bird/gobbler4-bird-gold.x3d.gz';                    /* the A/B variant: the graph pulled toward gold (an additional file, the default is unchanged) */
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Boot = window.gdBoot = { log: [], stage: '', t0: performance.now(), ms: {}, bytes: {} };
  var busy = $('#busy'), stageEl = $('#stage');

  /* ---------- honest status line ---------- */
  var cur = null, beat = 0;
  function secs(t) { return ((performance.now() - t) / 1000).toFixed(1) + ' s'; }
  function kb(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + ' MB' : Math.round(n / 1e3) + ' KB'; }
  function show(text) { if (busy) { busy.hidden = false; busy.classList.remove('err'); busy.textContent = text; } }
  function stage(name, detail) {                 /* name the stage, keep the clock running on it */
    if (cur) Boot.ms[cur.name] = Math.round(performance.now() - cur.t);
    cur = { name: name, t: performance.now(), detail: detail || '' }; Boot.stage = name; stageEl.dataset.stage = name;
    Boot.log.push(secs(Boot.t0) + ' ' + name + (detail ? ' · ' + detail : '')); paint();
    if (!beat) beat = setInterval(paint, 500);
  }
  function paint() { if (cur && !Boot.done) show('Gobbler · ' + cur.name + (cur.detail ? ' · ' + cur.detail : '') + ' · ' + secs(cur.t)); }
  function fail(where, e) {
    clearInterval(beat); beat = 0; var msg = (e && e.message) || String(e);
    Boot.log.push('FAILED ' + where + ': ' + msg); Boot.failed = where + ': ' + msg; stageEl.dataset.stage = 'failed';
    if (busy) { busy.hidden = false; busy.classList.add('err'); busy.textContent = 'Gobbler could not load.\nStage: ' + where + '\n' + msg + '\nReload to try again.'; }
    console.error('[gobbler] ' + where, e);
  }

  /* ---------- fetch with progress, gzip inflate ---------- */
  function fetchBytes(url, label) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      var total = +r.headers.get('content-length') || 0, rd = r.body && r.body.getReader && r.body.getReader();
      if (!rd) return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      var parts = [], got = 0;
      return (function pump() {
        return rd.read().then(function (x) {
          if (x.done) { var out = new Uint8Array(got), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out; }
          parts.push(x.value); got += x.value.length; if (cur) cur.detail = kb(got) + (total ? ' of ' + kb(total) : ''); return pump();
        });
      })();
    });
  }
  function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser has no DecompressionStream, cannot unzip');
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  function fetchText(url, enc, label) {
    if (enc === 'b64gz') return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.text(); })
      .then(function (t) { var s = atob(t.replace(/\s+/g, '')), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); Boot.bytes[label] = b.length; return inflate(b); });
    if (enc === 'gz') return fetchBytes(url, label).then(function (b) { Boot.bytes[label] = b.length; if (cur) cur.detail = kb(b.length); return inflate(b); });
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.text(); });
  }

  /* ---------- canvas ---------- */
  function makeCanvas() {
    var el = document.createElement('x3d-canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.id = 'x3d'; el.setAttribute('splashScreen', 'false'); el.setAttribute('notifications', 'false'); el.setAttribute('contextMenu', 'false');
    el.setAttribute('update', 'auto'); el.setAttribute('contentScale', String(dpr)); el.setAttribute('multisampling', dpr >= 2 ? '4' : '8');
    el.setAttribute('toneMapping', 'KHR_PBR_NEUTRAL'); el.setAttribute('exposure', '1');
    stageEl.insertBefore(el, stageEl.firstChild); return el;
  }
  function frames(el, n) {                        /* resolve after n new rendered frames (X_ITE time advances per frame) */
    return new Promise(function (res) {
      var t0 = -1, seen = 0, start = performance.now();
      (function tick() {
        var t = -1; try { t = el.browser.getCurrentTime(); } catch (e) {}
        if (t !== t0) { t0 = t; seen++; }
        if (seen > n || performance.now() - start > 30000) return res(seen > n); requestAnimationFrame(tick);
      })();
    });
  }

  /* ---------- camera pose, flights, tags ---------- */
  var Cam = { pos: null, ori: null, fov: 0.72, ps: null };
  var SUN = [6.5, -2.6, 0.4];
  var STOPS = [                                   /* the zoom ladder: [name, label, pos, look, fov, extra] ; null = filled in when data/bird/world.json arrives (the village step) */
    ['face', 'Face', [3.0, -1.8, 13.2], [3.0, -1.8, 0], 0.74],
    ['ribcage', 'Dyson ribcage', [SUN[0] + 5.2, SUN[1] + 2.2, SUN[2] + 8.2], SUN, 0.8],
    ['heart', 'Heart', [SUN[0] + 0.5, SUN[1] + 0.3, SUN[2] + 2.3], SUN, 0.8],
    null, null, null, null,
    ['feather', 'A feather', [10.5, 6.4, 8.6], [11.9, 4.6, 3.0], 0.8]
  ];
  var LATER = ['Earth and Moon', 'Village from orbit', 'Plaza', 'A villager'];
  var VIEWS = { face: 0, ribcage: 1, heart: 2, earth: 3, village: 4, plaza: 5, villager: 6, feather: 7, establishing: -1 };
  var ESTABLISH = ['establishing', 'Establishing', [12.0, -1.5, 25.0], [12.0, -1.5, 0], 0.88];
  var fly = { raf: 0, probe: null, token: 0 };
  var WORLD = null;                               /* data/bird/world.json: Earth, the site of the village, the stops 4 to 7 (positions in the bird's own frame) */
  function lookAt(p, t, up) {                     /* orientation (axis-angle) of a camera at p looking at t with the given up (default +Y) */
    if (!up) return PX.lookAt(p, t);
    var f = nrm([t[0] - p[0], t[1] - p[1], t[2] - p[2]]), r = nrm(crs(f, up)), u = crs(r, f), z = [-f[0], -f[1], -f[2]];
    var m00 = r[0], m01 = u[0], m02 = z[0], m10 = r[1], m11 = u[1], m12 = z[1], m20 = r[2], m21 = u[2], m22 = z[2], tr = m00 + m11 + m22, qw, qx, qy, qz, s;
    if (tr > 0) { s = Math.sqrt(tr + 1) * 2; qw = s / 4; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / s; qx = s / 4; qy = (m01 + m10) / s; qz = (m02 + m20) / s; }
    else if (m11 > m22) { s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = s / 4; qz = (m12 + m21) / s; }
    else { s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = s / 4; }
    var sn = Math.sqrt(Math.max(0, 1 - qw * qw)); return sn < 1e-9 ? [0, 1, 0, 0] : [qx / sn, qy / sn, qz / sn, 2 * Math.acos(Math.max(-1, Math.min(1, qw)))];
  }
  function nrm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function crs(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function orbit(o) {                             /* the point the camera looks at, at distance d, from the current pose */
    var R = rot(o.ori), d = Math.hypot(o.pos[0] - o.look[0], o.pos[1] - o.look[1], o.pos[2] - o.look[2]) || 10;
    return [o.pos[0] - R[2] * d, o.pos[1] - R[5] * d, o.pos[2] - R[8] * d];
  }
  function rot(a) { var x = a[0], y = a[1], z = a[2], an = a[3], l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; var c = Math.cos(an), s = Math.sin(an), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]; }

  /* ---------- the sway, the bird's frame and the dive ----------
   * The whole bird (and everything in it: the Sun, the Earth, the village) sways about LOOM_C. That is a feature at the Face and a problem at the village, where one metre is 0.0004
   * units: so a flight to the stops 4 to 7 pauses the Sway timer (it resumes where it stopped when you fly back out), and the stops' positions, written in the bird's own frame,
   * are carried into the world through the rotation the bird froze at. Near and far planes follow the distance to the subject, with a logarithmic depth buffer while down there. */
  var LOOM_C = [0.72, -0.76, 0], sway = { paused: false, rot: [0, 1, 0, 0] }, ZONE = { on: false };
  function node(n) { try { return PX.el.browser.currentScene.getNamedNode(n); } catch (e) { return null; } }
  function pauseSway() {
    return new Promise(function (res) {
      var s = node('Sway'), L = node('Loom'); if (!s || !L || sway.paused) return res();
      try { s.pauseTime = PX.el.browser.getCurrentTime(); } catch (e) { return res(); }
      frames(PX.el, 3).then(function () { try { var r = L.rotation; sway.rot = [r.x, r.y, r.z, r.angle]; } catch (e) {} sway.paused = true; res(); });
    });
  }
  function resumeSway() { var s = node('Sway'); if (s && sway.paused) { try { s.resumeTime = PX.el.browser.getCurrentTime(); } catch (e) {} } sway.paused = false; sway.rot = [0, 1, 0, 0]; }
  function toWorld(p) {                           /* a point in the bird's frame -> the world, through the rotation the sway is frozen at */
    if (!sway.paused) return p.slice();
    var R = rot(sway.rot), d = [p[0] - LOOM_C[0], p[1] - LOOM_C[1], p[2] - LOOM_C[2]];
    return [LOOM_C[0] + R[0] * d[0] + R[1] * d[1] + R[2] * d[2], LOOM_C[1] + R[3] * d[0] + R[4] * d[1] + R[5] * d[2], LOOM_C[2] + R[6] * d[0] + R[7] * d[1] + R[8] * d[2]];
  }
  function dirToWorld(v) { if (!sway.paused) return v.slice(); var R = rot(sway.rot); return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
  function setDepth(on) { try { if (ZONE.on !== on) { PX.el.browser.setBrowserOption('LogarithmicDepthBuffer', on); ZONE.on = on; var air = node('AirShader'); if (air) air.logDepth = on ? 1 : 0; } } catch (e) {} }
  function setClip(v, near, far) { try { v.nearDistance = near; v.farDistance = far; } catch (e) {} }
  function ease(k) { return k * k * (3 - 2 * k); }
  function span(k, c, leaving) {                  /* progress along the flight; geometric in the distance to the subject when the two ends differ in scale */
    if (c < 0.7) return k; var den = Math.exp(c) - 1;
    return leaving ? (Math.exp(c * k) - 1) / den : 1 - (Math.exp(c * (1 - k)) - 1) / den;
  }
  function flyTo(stop, ms, then, keepTour) {
    var el = PX.el, inner = !!(stop[5] && stop[5].loom), v = node('Probe'); if (!v) return;
    if (!keepTour) { PX.tourStop(); tourLabel(false); } cancelAnimationFrame(fly.raf); var token = ++fly.token;
    var fromZone = !!(WORLD && Cam.pos && Math.hypot(Cam.pos[0] - WORLD.earth[0], Cam.pos[1] - WORLD.earth[1], Cam.pos[2] - WORLD.earth[2]) < 9);
    (inner ? pauseSway() : Promise.resolve(resumeSway())).then(function () { if (token === fly.token) begin(); });
    function begin() {
      var dyn = inner || fromZone;
      var pos = Cam.pos ? Cam.pos.slice() : (inner ? toWorld(stop[2]) : stop[2].slice()), ori = Cam.ori || [0, 0, 1, 0], a = pos;
      var b = inner ? toWorld(stop[2]) : stop[2], tgt1 = inner ? toWorld(stop[3]) : stop[3], tgt0 = Cam.pos ? orbit({ pos: pos, ori: ori, look: tgt1 }) : tgt1.slice();
      var fov0 = Cam.fov, fov1 = stop[4], t0 = performance.now(); fly.focus = tgt1.slice();
      var R0 = rot(ori), up0 = [R0[1], R0[4], R0[7]], up1 = inner ? dirToWorld(stop[5].up) : [0, 1, 0];
      var sA = Math.hypot(a[0] - tgt0[0], a[1] - tgt0[1], a[2] - tgt0[2]), sB = Math.hypot(b[0] - tgt1[0], b[1] - tgt1[1], b[2] - tgt1[2]);
      var c = dyn ? Math.min(9, Math.log(Math.max(sA, sB) / Math.max(1e-9, Math.min(sA, sB)))) : 0, leaving = sA < sB;
      var D = ms == null ? (REDUCED ? 0 : dyn ? Math.min(9500, 2600 + 650 * c) : 2200) : ms;
      if (dyn) setDepth(true);
      try { v.position = new X3D.SFVec3f(a[0], a[1], a[2]); v.orientation = new X3D.SFRotation(ori[0], ori[1], ori[2], ori[3]); v.fieldOfView = fov0; v.centerOfRotation = new X3D.SFVec3f(tgt1[0], tgt1[1], tgt1[2]); v.set_bind = true; } catch (e) {}
      var dv = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dl = Math.hypot(dv[0], dv[1], dv[2]) || 1, pv = [dv[1] * 0 - dv[2] * 1, dv[2] * 0 - dv[0] * 0, dv[0] * 1 - dv[1] * 0];      /* the flight bows a little off the straight line (up cross direction), seeded */
      var pl = Math.hypot(pv[0], pv[1], pv[2]) || 1, bow = SEED && D > 0 && !dyn ? (RND() - 0.5) * 0.34 * dl : 0;
      (function step() {
        if (token !== fly.token) return;
        var k = D <= 0 ? 1 : Math.min(1, (performance.now() - t0) / D), pk, tk, uk = k;
        if (dyn) { k = ease(k); pk = span(k, c, leaving); tk = pk; uk = k; } else { k = k * k * k * (k * (6 * k - 15) + 10); pk = tk = uk = k; }
        var bk = bow * Math.sin(Math.PI * k);
        var p = [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * pk + bk * pv[i] / pl; }), t = [0, 1, 2].map(function (i) { return tgt0[i] + (tgt1[i] - tgt0[i]) * tk; });
        var o = dyn ? lookAt(p, t, nrm([0, 1, 2].map(function (i) { return up0[i] + (up1[i] - up0[i]) * ease(uk); }))) : lookAt(p, t);
        try {
          v.position = new X3D.SFVec3f(p[0], p[1], p[2]); v.orientation = new X3D.SFRotation(o[0], o[1], o[2], o[3]); v.fieldOfView = Cam.fov = fov0 + (fov1 - fov0) * k;
          if (dyn) { var dist = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]); setClip(v, Math.max(1e-5, Math.min(0.12, 0.012 * dist)), 400); }
        } catch (e) {}
        if (k < 1) fly.raf = requestAnimationFrame(step);
        else {
          if (!inner) { setClip(v, -1, -1); setDepth(false); }
          if (then) then();
        }
      })();
    }
  }
  function installSensor(el) {
    var sc = el.browser.currentScene, ps = sc.createNode('ProximitySensor'); ps.size = new X3D.SFVec3f(1e7, 1e7, 1e7); sc.addRootNode(ps);
    ps.addFieldCallback('gd', 'position_changed', function (v) { Cam.pos = [v.x, v.y, v.z]; tagsDirty = true; });
    ps.addFieldCallback('gd', 'orientation_changed', function (v) { Cam.ori = [v.x, v.y, v.z, v.angle]; tagsDirty = true; });
    Cam.ps = ps;
    try { Cam.fov = el.browser.activeViewpoint.fieldOfView || Cam.fov; } catch (e) {}
  }

  var tags = [], tagsDirty = true, level = 'min';
  var TAGR = { earth: [0.35, 5], village: [0.012, 0.6], tether: [0.002, 0.45], villagers: [0.0006, 0.012], khachkar: [0.0006, 0.014] };      /* the world tags show between these distances (scene units) and carry their honest scale note */
  function buildTags(anchors) {
    var host = $('#gd-tags'); host.innerHTML = '';
    var cols = { heart: '#ffe9a8', ribcage: '#d6b25c', flywheel: '#f2c35f', blender: '#f5851a', fan_gltf: '#40d9ff', fan_usd: '#ffeebb', fan_video: '#f24dd9', tenders: '#8cf0a8', wing: '#9ed7ff',
      earth: '#7fc4ff', village: '#ffd27a', tether: '#ffe9a8', villagers: '#8cf0a8', mashtots: '#ffcf6a', khachkar: '#f2a987' };
    if (q.get('mashtots') === '0') anchors = anchors.filter(function (a) { return a.id !== 'mashtots'; });
    tags = anchors.map(function (a) {
      var mock = /mock/.test(a.tag), world = a.id in TAGR, d = document.createElement('div'); d.className = 'gd-tag' + (mock ? ' mock' : '') + (world ? ' world' : ''); d.style.setProperty('--c', cols[a.id] || '#e9cf8a');
      d.innerHTML = '<i></i><div><b></b><small></small></div>'; $('b', d).textContent = a.label + (/^fan_/.test(a.id) ? (mock ? ' · mock' : ' · simulated') : ''); $('small', d).textContent = world ? a.tag : '';
      d.title = a.tag; host.appendChild(d); return { a: a, el: d, shown: false };
    });
  }
  function projectTags() {
    if (!Cam.pos || !Cam.ori || !tags.length) return;
    var W = stageEl.clientWidth, H = stageEl.clientHeight, R = rot(Cam.ori), f = (Math.min(W, H) / 2) / Math.tan(Cam.fov / 2), p = Cam.pos;
    var inV = !!(WORLD && Math.hypot(p[0] - WORLD.site[0], p[1] - WORLD.site[1], p[2] - WORLD.site[2]) < 1.6);        /* down at the village only its own tags show: the bird's are a long way off */
    tags.forEach(function (t) {
      var P = sway.paused ? toWorld(t.a.pos) : t.a.pos, dx = P[0] - p[0], dy = P[1] - p[1], dz = P[2] - p[2], cz = R[2] * dx + R[5] * dy + R[8] * dz, on = false, rg = TAGR[t.a.id], dd = Math.hypot(dx, dy, dz);
      if (rg ? (cz < 0 && dd > rg[0] && dd < rg[1] && level !== 'none') : (!inV && cz < -0.5 && level !== 'none')) {
        var cx = R[0] * dx + R[3] * dy + R[6] * dz, cy = R[1] * dx + R[4] * dy + R[7] * dz, k = f / -cz, X = W / 2 + cx * k, Y = H / 2 - cy * k, dist = Math.hypot(dx, dy, dz);
        var near = t.a.level === 'full' ? dist < 15 : true;
        on = near && X > 30 && X < W - 30 && Y > 30 && Y < H - 30;
        if (on) t.el.style.transform = 'translate(' + Math.round(X + 10) + 'px,' + Math.round(Y - 6) + 'px)';
      }
      if (on !== t.shown) { t.shown = on; t.el.classList.toggle('on', on); }
    });
  }
  /* ---------- the scale bar: village metres, only down in the world (the planet is drawn 250 m in radius; one metre is 0.0004 scene units) ---------- */
  var NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  function updateScale() {
    var el = $('#gd-scale'); if (!el) return;
    var show = !!(WORLD && Cam.pos && Cam.ori && fly.focus && level !== 'none' && Math.hypot(Cam.pos[0] - WORLD.earth[0], Cam.pos[1] - WORLD.earth[1], Cam.pos[2] - WORLD.earth[2]) < 4);
    if (!show) { if (!el.hidden) el.hidden = true; return; }
    var H = stageEl.clientHeight, d = Math.max(1e-9, Math.hypot(Cam.pos[0] - fly.focus[0], Cam.pos[1] - fly.focus[1], Cam.pos[2] - fly.focus[2])), ppu = (H / 2) / Math.tan(Cam.fov / 2) / d, L = NICE[0];
    NICE.forEach(function (n) { if (n * WORLD.scale * ppu <= 150) L = n; });
    var px = Math.max(8, L * WORLD.scale * ppu), txt = (L >= 1000 ? (L / 1000) + ' km' : L + ' m') + ' · village scale';
    el.hidden = false; $('i', el).style.width = px.toFixed(1) + 'px'; if ($('b', el).textContent !== txt) $('b', el).textContent = txt;
  }
  (function loop() { if (tagsDirty) { tagsDirty = false; projectTags(); updateScale(); } requestAnimationFrame(loop); })();
  setInterval(function () { try { var f = PX.el.browser.activeViewpoint.fieldOfView; if (f) Cam.fov = f; } catch (e) {} tagsDirty = true; }, 400);       /* the sway moves the layers a little even when the camera rests */

  /* ---------- the four controls ---------- */
  function buildRail() {
    var rail = $('#gd-rail'); rail.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      (function (i) {
        var s = STOPS[i], b = document.createElement('button'); b.type = 'button';
        var label = s ? s[1] : LATER[i - 3], off = !s;
        b.className = off ? 'off' : ''; b.dataset.stop = i + 1; b.setAttribute('aria-label', (i + 1) + ' ' + label + (off ? ' (with the village step)' : ''));
        b.innerHTML = '<span>' + (i + 1) + ' · ' + label + (off ? ' · next step' : '') + '</span><i></i>';
        if (off) b.setAttribute('aria-disabled', 'true'); else b.addEventListener('click', function () { go(i); });
        rail.appendChild(b);
      })(i);
    }
  }
  var curStop = 0;
  function markStop(i) { curStop = i; [].forEach.call(document.querySelectorAll('#gd-rail button'), function (b) { b.classList.toggle('on', +b.dataset.stop === i + 1); }); }
  function go(i, ms) {
    var s = i < 0 ? ESTABLISH : STOPS[i]; if (!s) return; markStop(i);
    flyTo(s, ms);
  }
  /* ---------- the tour: the shot list on a spline (continuous velocity, no stop at every key), with seeded handheld drift ---------- */
  function rng32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var SEED = q.get('seed') === null ? 4 : (+q.get('seed') || 0), RND = rng32(SEED * 7919 + 13);          /* ?seed=0 turns the drift and the bows off; the same seed repeats a take exactly */
  function orbitPos(az, r, el) { var a = az * Math.PI / 180, e = el * Math.PI / 180; return [SUN[0] + r * Math.sin(a) * Math.cos(e), SUN[1] + r * Math.sin(e), SUN[2] + r * Math.cos(a) * Math.cos(e)]; }
  var SHOTS = [                                   /* the shot list: seconds, name, camera, look-at, field of view. At the Heart shot the tour dives to the village and back (diveChain) */
    [0, 'Establishing', [12, -1.5, 25], [12, -1.5, 0], 0.88],
    [9, 'Face', [3.0, -1.8, 13.2], [3.0, -1.8, 0], 0.74],
    [17, 'Push-in', [-0.4, -0.3, 8.4], [-0.8, 0.2, 0], 0.72],
    [26, 'Orbit', orbitPos(-35, 11, 14), SUN, 0.8],
    [33, 'Orbit', orbitPos(-95, 12, 38), SUN, 0.8],
    [40, 'Orbit', orbitPos(-150, 12.5, 30), SUN, 0.8],
    [46, 'Underside', [SUN[0] - 1, SUN[1] - 9, SUN[2] - 8], SUN, 0.8],           /* under the bird, clear of the wing, back to the front */
    [52, 'Underside', [SUN[0] + 3, SUN[1] - 8, SUN[2] + 7], SUN, 0.8],
    [58, 'Tenders', [SUN[0] + 4.6, SUN[1] + 3.0, SUN[2] + 5.4], SUN, 0.82],
    [65, 'Heart', [SUN[0] + 0.6, SUN[1] + 0.5, SUN[2] + 2.2], SUN, 0.8],                /* inside the shell: the picture judge (round 1) read the beads of the shell in front of the lens as clutter */
    [73, 'Fan reveal', [19.0, -1.0, 16.0], [21.5, -2.5, 0], 0.9],
    [83, 'Return', [12, -1.5, 25], [12, -1.5, 0], 0.88]];
  var TOURK = SHOTS.map(function (s) { return { t: s[0], v: s[2].concat(s[3], [s[4]]) }; }), TOURD = TOURK[TOURK.length - 1].t, LEAD = 2.4;
  var DRIFT = [0, 1, 2, 3, 4, 5].map(function () { return { f: 0.05 + RND() * 0.11, g: 0.17 + RND() * 0.16, p: RND() * 6.283, q: RND() * 6.283 }; });
  function sampleTour(tau) {
    var K = TOURK, i = 0; while (i < K.length - 2 && tau > K[i + 1].t) i++;
    var a = K[i], b = K[i + 1], dt = b.t - a.t, u = Math.max(0, Math.min(1, (tau - a.t) / dt)), u2 = u * u, u3 = u2 * u;
    var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return a.v.map(function (_, c) {
      var m0 = i === 0 ? 0 : (b.v[c] - K[i - 1].v[c]) / (b.t - K[i - 1].t), m1 = i + 1 === K.length - 1 ? 0 : (K[i + 2].v[c] - a.v[c]) / (K[i + 2].t - a.t);
      return h00 * a.v[c] + h10 * dt * m0 + h01 * b.v[c] + h11 * dt * m1;
    });
  }
  var tr = { on: false, held: false, t0: 0, heldAt: 0, raf: 0, vp: null, from: null, diving: false, dived: false, timer: 0 };
  var TOURAT = +q.get('tourat') || 0;             /* ?tourat=64 starts the tour 64 s in (a test hook: the dive comes at 65 s) */
  var DIVE_AT = 65;                               /* when the spline reaches the Heart shot the tour dives to the village (stops 4 to 7) and flies back out to that shot */
  function diveChain() {
    tr.diving = true; cancelAnimationFrame(tr.raf);
    var seq = [[3, 1200], [4, 1200], [5, 2200], [6, 3800]], i = 0;
    (function next() {
      if (!tr.diving) return;
      if (i < seq.length) { var st = seq[i][0], hold = seq[i][1]; i++; markStop(st); flyTo(STOPS[st], null, function () { tr.timer = setTimeout(next, hold); }, true); }
      else { markStop(2); flyTo(STOPS[2], 6500, tourResume, true); }
    })();
  }
  function tourResume() {                          /* back at the Heart shot: the spline carries on from its key */
    if (!tr.diving) return; tr.diving = false;
    var ori = Cam.ori || [0, 0, 1, 0], p = Cam.pos || SHOTS[9][2];
    try { tr.vp.position = new X3D.SFVec3f(p[0], p[1], p[2]); tr.vp.orientation = new X3D.SFRotation(ori[0], ori[1], ori[2], ori[3]); tr.vp.fieldOfView = Cam.fov; tr.vp.set_bind = true; } catch (e) {}
    tr.t0 = performance.now() - (LEAD + DIVE_AT) * 1000; tr.dived = true; tr.raf = requestAnimationFrame(trStep);
  }
  function trStep() {
    if (!tr.on || tr.diving) return;
    var t = (performance.now() - tr.t0) / 1000, v, k;
    if (t >= LEAD) { var tau = (t - LEAD) % TOURD; if (tau < DIVE_AT - 1) tr.dived = false; if (WORLD && STOPS[6] && !tr.dived && tau >= DIVE_AT) { tr.dived = true; return diveChain(); } }
    if (t < LEAD) { k = t / LEAD; k = k * k * k * (k * (6 * k - 15) + 10); var s0 = sampleTour(0); v = s0.map(function (x, c) { return tr.from[c] + (x - tr.from[c]) * k; }); }
    else v = sampleTour((t - LEAD) % TOURD);
    if (SEED) {                                   /* slow seeded drift, a little different every take of a different seed; it grows with the distance to the subject */
      var dist = Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]) / 12 + 0.25;
      for (var c = 0; c < 6; c++) { var d = DRIFT[c]; v[c] += (c < 3 ? 0.16 : 0.07) * dist * (Math.sin(6.283 * d.f * t + d.p) + 0.5 * Math.sin(6.283 * d.g * t + d.q)); }
      v[6] += 0.006 * Math.sin(6.283 * 0.07 * t + DRIFT[0].q);
    }
    var o = lookAt(v.slice(0, 3), v.slice(3, 6));
    try { tr.vp.position = new X3D.SFVec3f(v[0], v[1], v[2]); tr.vp.orientation = new X3D.SFRotation(o[0], o[1], o[2], o[3]); tr.vp.fieldOfView = Cam.fov = v[6]; } catch (e) {}
    tr.raf = requestAnimationFrame(trStep);
  }
  function trStart() {
    var sc = PX.el.browser.currentScene; try { tr.vp = sc.getNamedNode('TourCam'); } catch (e) { return; }
    cancelAnimationFrame(fly.raf); cancelAnimationFrame(tr.raf);
    var ori = Cam.ori || [0, 0, 1, 0], pos = Cam.pos ? Cam.pos.slice() : SHOTS[0][2].slice(), tg = Cam.pos ? orbit({ pos: pos, ori: ori, look: SHOTS[0][3] }) : SHOTS[0][3];
    tr.from = pos.concat(tg, [Cam.fov]);
    try { tr.vp.position = new X3D.SFVec3f(pos[0], pos[1], pos[2]); tr.vp.orientation = new X3D.SFRotation(ori[0], ori[1], ori[2], ori[3]); tr.vp.fieldOfView = Cam.fov; tr.vp.set_bind = true; } catch (e) {}
    resumeSway(); setDepth(false); tr.diving = false; tr.dived = false; clearTimeout(tr.timer);
    PX.tourOn = tr.on = true; tr.held = false; tr.t0 = performance.now() - (TOURAT ? (LEAD + TOURAT) * 1000 : 0); tr.raf = requestAnimationFrame(trStep);
  }
  function trStop() { PX.tourOn = tr.on = false; tr.held = false; cancelAnimationFrame(tr.raf); if (tr.diving) { tr.diving = false; clearTimeout(tr.timer); fly.token++; cancelAnimationFrame(fly.raf); } }
  function trHold() { if (!tr.on || tr.diving) return false; tr.heldAt = performance.now() - tr.t0; tr.held = true; PX.tourOn = tr.on = false; cancelAnimationFrame(tr.raf); return true; }
  function trRelease() { if (!tr.held || tr.diving) return false; tr.held = false; PX.tourOn = tr.on = true; tr.t0 = performance.now() - tr.heldAt; cancelAnimationFrame(tr.raf); tr.raf = requestAnimationFrame(trStep); return true; }
  function tourLabel(on) { var b = $('#btn-tour'); if (b) { b.classList.toggle('on', on); b.textContent = on ? 'Pause tour' : 'Tour'; } }
  function tourToggle() {
    if (PX.tourOn || PX.tourHeld()) { PX.tourStop(); tourLabel(false); }
    else { PX.tourStart(); tourLabel(true); }
  }

  /* ---------- fps ---------- */
  function hud(el) {
    var out = $('#hud'), frames = 0, last = performance.now(), lastT = -1;
    (function tick() {
      var t = -1; try { t = el.browser.getCurrentTime(); } catch (e) {} if (t !== lastT) { frames++; lastT = t; }
      var now = performance.now();
      if (now - last > 1500) { out.dataset.fps = (frames * 1000 / (now - last)).toFixed(0); out.textContent = out.dataset.fps + ' fps on this device' + (Boot.summary ? ' · ' + Boot.summary : ''); frames = 0; last = now; }
      requestAnimationFrame(tick);
    })();
  }

  /* ---------- go ---------- */
  function run() {
    var uiSaved = null; try { uiSaved = localStorage.getItem('gv4.ui'); } catch (e) {}
    level = q.get('ui') === 'none' ? 'none' : q.get('ui') === 'min' ? 'min' : (uiSaved === 'none' ? 'none' : 'min');
    $('#gv4').dataset.ui = level;
    stage('starting X_ITE');
    var el = PX.el = makeCanvas(), scene;
    var ready = el.browser ? Promise.resolve() : customElements.whenDefined('x3d-canvas').then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });
    var textP;
    ready.then(function () {
      stage('fetching the bird', CFG.bird.split('/').pop());
      return fetchText(CFG.bird, CFG.enc, 'bird');
    }).then(function (xml) {
      Boot.bytes.birdRaw = xml.length; stage('parsing the scene', kb(xml.length) + ' of X3D');
      return el.browser.createX3DFromString(xml);
    }).then(function (scn) {
      stage('drawing the first frame');
      return el.browser.replaceWorld(scn);
    }).then(function () { return frames(el, 2); }).then(function (ok) {
      if (cur) Boot.ms[cur.name] = Math.round(performance.now() - cur.t);
      Boot.done = true; clearInterval(beat); beat = 0; busy.hidden = true; stageEl.dataset.stage = 'bird';
      Boot.birdMs = Math.round(performance.now() - Boot.t0); Boot.log.push(secs(Boot.t0) + ' bird on screen (' + kb(Boot.bytes.bird || 0) + ' gzipped scene)');
      Boot.summary = 'bird ' + (Boot.birdMs / 1000).toFixed(1) + ' s · ' + kb(Boot.bytes.bird || 0);
      installSensor(el); hud(el); buildRail(); wire(el); weave(el);
      if (q.get('mashtots') === '0') { var mr = node('MashtotsRing'); if (mr) mr.visible = false; }             /* ?mashtots=0: the bird without the ring of letters (its tag goes too, see buildTags) */
      document.body.dataset.loaded = '1';
      later(el);
      var v = q.get('view'); if (v && v in VIEWS) { if (VIEWS[v] > 2 && VIEWS[v] < 7) worldP.then(function () { go(VIEWS[v], 0); }); else go(VIEWS[v], 0); }
    }).catch(function (e) { fail((cur && cur.name) || 'start', e); });
  }

  var worldP = new Promise(function (res) { worldDone = res; }), worldDone;
  function loadWorld() {                         /* stops 4 to 7: Earth and Moon, the village from orbit, the plaza, a villager (positions in the bird's own frame) */
    return fetch(CFG.world).then(function (r) { return r.ok ? r.json() : null; }).then(function (w) {
      if (!w) return; WORLD = w;
      ['earth', 'village', 'plaza', 'villager'].forEach(function (k, j) { var st = w.stops[k]; STOPS[3 + j] = [k, st.label, st.pos, st.look, st.fov, { loom: true, up: st.up }]; });
      buildRail(); Boot.log.push(secs(Boot.t0) + ' world: stops 4 to 7 ready');
    }).catch(function (e) { console.warn('world', e); }).then(function () { worldDone(); });
  }
  function later(el) {                           /* after the first frame: the graph, the ontology block, anchors, receipt */
    var t0 = performance.now(), saved = null; loadWorld();
    var graphP = fetchText(CFG.graph, CFG.graphEnc, 'graph').then(JSON.parse);
    var ontoP = fetch(CFG.onto).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    fetch(CFG.anchors).then(function (r) { return r.json(); }).then(buildTags).catch(function (e) { console.warn('anchors', e); });
    fetch(CFG.receipt).then(function (r) { return r.json(); }).then(function (r) { var v = r.validator || {}; if (v.xsd_valid) $('#gv4-valid').textContent = '✓ valid X3D 4.0 · ' + (v.label || 'fork validator'); }).catch(function () {});
    Promise.all([graphP, ontoP]).then(function (a) {
      var G = a[0]; Boot.graphMs = Math.round(performance.now() - t0); Boot.summary += ' · graph ' + kb(Boot.bytes.graph || 0) + ' after ' + (Boot.graphMs / 1000).toFixed(1) + ' s';
      $('#gv4-counts').textContent = 'bird first · ' + G.drawn.toLocaleString('en-US') + ' stars · ' + G.loops.length + ' loops';
      var hv = q.get('hover');
      window.gobbler = GobblerV4.start({ G: G, ONTO: a[1], el: el, stage: stageEl, root: $('#gv4'), level: level, hover: hv === null ? null : +hv, hoverTier: +q.get('tier') || 3, glass: q.get('glass') === '1', tune: q.get('tune') === '1' });
      document.body.dataset.v4 = '1';
    }).catch(function (e) { console.warn('[gobbler] graph', e); Boot.log.push('graph FAILED: ' + e.message); $('#gv4-counts').textContent = 'bird only · graph failed: ' + e.message; });
  }

  function weave(el) {                           /* the Armenian knot (tools/weave.py): its clock waits in the scene until the page starts it here; ?weave=0 hides it, ?weaveat=N starts N seconds in (a test hook) */
    var c = node('WeaveClock'), s = node('Weave'); if (!c || !s) return;
    if (q.get('weave') === '0') { s.whichChoice = -1; return; }
    c.startTime = Date.now() / 1000 - (+q.get('weaveat') || 0);              /* X_ITE's clock is the wall clock in seconds */
  }
  function wire(el) {
    PX.tourStart = trStart; PX.tourStop = trStop; PX.tourHold = trHold; PX.tourRelease = trRelease; PX.tourHeld = function () { return tr.held; };      /* the spline tour replaces the engine's; the hover layer holds and releases it the same way */
    var ts = PX.tourStop, tb = PX.tourStart;                    /* the engine writes 'Resume tour' on its own button; the page owns the label */
    PX.tourStop = function () { ts(); tourLabel(false); }; PX.tourStart = function () { tb(); tourLabel(true); };
    $('#gd-face').addEventListener('click', function () { go(0); });
    $('#btn-tour').addEventListener('click', tourToggle);
    el.addEventListener('pointerdown', function () { if (PX.tourOn || PX.tourHeld()) { PX.tourStop(); tourLabel(false); } });
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))) return;
      if (/^[1-8]$/.test(ev.key)) { go(+ev.key - 1); }
      else if (ev.key === 'F' && ev.shiftKey) { if (document.fullscreenElement) document.exitFullscreen(); else if (stageEl.requestFullscreen) stageEl.requestFullscreen(); }
        });
    window.addEventListener('keydown', function (ev) {      /* plan key rule: T = tour, Shift+T = the v4 tuning panel (the hover layer's own T handler never sees a plain t) */
      if (ev.key !== 't' || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))) return;
      ev.stopImmediatePropagation(); ev.preventDefault(); tourToggle();
    }, true);
    window.addEventListener('resize', function () { tagsDirty = true; });
    new MutationObserver(function () { level = $('#gv4').dataset.ui === 'none' ? 'none' : 'min'; tagsDirty = true; }).observe($('#gv4'), { attributes: true, attributeFilter: ['data-ui'] });   /* the hover layer owns U and the UI chip */
  }

  window.gdApi = { node: node, sun: SUN, go: go, tour: tourToggle, cam: function () { return Cam; }, stops: STOPS, tags: function () { return tags; }, flyTo: flyTo, world: function () { return WORLD; }, swayPaused: function () { return sway.paused; }, toWorld: toWorld, dirToWorld: dirToWorld, stopWorld: function (i) { var t = STOPS[i]; return t ? (t[5] && t[5].loom ? toWorld(t[2]) : t[2]) : null; }, ready: function () { return worldP; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
