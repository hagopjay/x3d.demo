/* v4 engine: the Gobbler 3 Deep common.js plus PX.tourHold/tourRelease (see gobbler-v4/tools/patch_engine.py). */
/* PolyXandria shared engine: one viewer, splat loader, bird's-eye tour and lights-out mode for every demo page. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PX = window.PX = { cfg: null, el: null, tourOn: false };

  /* ---------- small helpers ---------- */
  function sec(ms) { return (ms / 1000).toFixed(1) + ' s'; }
  function busy(msg) { var b = $('#busy'); if (!b) return; if (msg) { b.hidden = false; b.textContent = msg; } else b.hidden = true; }
  function fetchParts(urls) {
    return Promise.all(urls.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.text(); }); }))
      .then(function (parts) { var s = atob(parts.join('').replace(/\s+/g, '')); var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; });
  }
  function gunzip(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }

  /* ---------- orientation that looks from pos at target (Y up, camera looks down -Z) ---------- */
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function lookAt(pos, tgt) {
    var f = norm([tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]]);
    var up = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    var r = norm(cross(f, up)), u = cross(r, f), z = [-f[0], -f[1], -f[2]];
    /* rotation matrix columns r, u, z -> axis-angle */
    var m00 = r[0], m01 = u[0], m02 = z[0], m10 = r[1], m11 = u[1], m12 = z[1], m20 = r[2], m21 = u[2], m22 = z[2];
    var tr = m00 + m11 + m22, qw, qx, qy, qz;
    if (tr > 0) { var s = Math.sqrt(tr + 1) * 2; qw = s / 4; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { var s1 = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / s1; qx = s1 / 4; qy = (m01 + m10) / s1; qz = (m02 + m20) / s1; }
    else if (m11 > m22) { var s2 = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / s2; qx = (m01 + m10) / s2; qy = s2 / 4; qz = (m12 + m21) / s2; }
    else { var s3 = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / s3; qx = (m02 + m20) / s3; qy = (m12 + m21) / s3; qz = s3 / 4; }
    var ang = 2 * Math.acos(Math.max(-1, Math.min(1, qw))), sn = Math.sqrt(1 - qw * qw);
    return sn < 1e-6 ? [0, 1, 0, 0] : [qx / sn, qy / sn, qz / sn, ang];
  }
  PX.lookAt = lookAt;

  /* ---------- canvas ---------- */
  function makeCanvas(look) {
    var el = document.createElement('x3d-canvas');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.id = 'x3d'; el.setAttribute('splashScreen', 'false'); el.setAttribute('notifications', 'false'); el.setAttribute('contextMenu', 'false');
    el.setAttribute('update', 'auto'); el.setAttribute('contentScale', String(dpr)); el.setAttribute('multisampling', dpr >= 2 ? '4' : '8');
    el.setAttribute('toneMapping', (look && look.toneMapping) || 'KHR_PBR_NEUTRAL'); el.setAttribute('exposure', String((look && look.exposure) || 1));
    $('#stage').insertBefore(el, $('#stage').firstChild);
    return el;
  }

  /* ---------- frame-rate readout ---------- */
  function hud(el) {
    var out = $('#hud'); if (!out) return;
    var frames = 0, last = performance.now(), lastT = -1;
    (function tick() {
      var t = -1; try { t = el.browser.getCurrentTime(); } catch (e) {}
      if (t !== lastT) { frames++; lastT = t; }
      var now = performance.now();
      if (now - last > 1500) { out.dataset.fps = (frames * 1000 / (now - last)).toFixed(0); out.textContent = out.dataset.fps + ' fps on this device'; frames = 0; last = now; }
      requestAnimationFrame(tick);
    })();
  }

  /* ---------- the tour: a camera on a descending spiral around a centre ---------- */
  var tourVp = null, tourT0 = 0, tourRaf = 0, tourHeld = false, tourHeldAt = 0;   /* v4: tourHeld = paused by hover, tourHeldAt = elapsed ms at the pause */
  function tourStep() {
    var T = PX.cfg.tour; if (!PX.tourOn || !tourVp) return;
    var t = (performance.now() - tourT0) / 1000, d = T.duration || 40;
    var u = (t % d) / d, e = u < .5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);          /* ease in/out over one pass */
    var k = T.loop === 'pingpong' ? (Math.floor(t / d) % 2 ? 1 - e : e) : e;
    if (T.kind === 'keys') {                                   /* waypoints [time, px,py,pz, tx,ty,tz], eased between keys, played forward then back */
      var K = T.keys, D = K[K.length - 1][0], tt = t % (2 * D); if (tt > D) tt = 2 * D - tt;
      var i = 0; while (i < K.length - 2 && tt > K[i + 1][0]) i++;
      var a = K[i], b = K[i + 1], f = Math.max(0, Math.min(1, (tt - a[0]) / (b[0] - a[0]))); f = f * f * (3 - 2 * f);
      var P = [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f], G = [a[4] + (b[4] - a[4]) * f, a[5] + (b[5] - a[5]) * f, a[6] + (b[6] - a[6]) * f];
      var ok = lookAt(P, G);
      try { tourVp.position = new X3D.SFVec3f(P[0], P[1], P[2]); tourVp.orientation = new X3D.SFRotation(ok[0], ok[1], ok[2], ok[3]); } catch (e5) {}
      tourRaf = requestAnimationFrame(tourStep); return;
    }
    if (T.kind === 'path') {                                   /* straight-on dolly or tilt: camera p0 to p1, target t0 to t1 */
      var lp = function (a, b) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
      var pp = lp(T.p0, T.p1), oo = lookAt(pp, lp(T.t0, T.t1));
      try { tourVp.position = new X3D.SFVec3f(pp[0], pp[1], pp[2]); tourVp.orientation = new X3D.SFRotation(oo[0], oo[1], oo[2], oo[3]); } catch (e3) {}
      tourRaf = requestAnimationFrame(tourStep); return;
    }
    var r = T.r0 + (T.r1 - T.r0) * k, el = (T.e0 + (T.e1 - T.e0) * k) * Math.PI / 180;
    var az = (T.a0 || 0) * Math.PI / 180 + t * (T.spin || 0.12);
    var c = T.center, pos = [c[0] + r * Math.cos(el) * Math.sin(az), c[1] + r * Math.sin(el), c[2] + r * Math.cos(el) * Math.cos(az)];
    var o = lookAt(pos, T.target || c);
    try { tourVp.position = new X3D.SFVec3f(pos[0], pos[1], pos[2]); tourVp.orientation = new X3D.SFRotation(o[0], o[1], o[2], o[3]); } catch (e2) {}
    tourRaf = requestAnimationFrame(tourStep);
  }
  function tourStart() {
    var T = PX.cfg.tour; if (!T) return;
    var scene = PX.el.browser.currentScene;
    try { tourVp = T.vp ? scene.getNamedNode(T.vp) : null; } catch (e) { tourVp = null; }
    if (!tourVp && scene.__pxVp) tourVp = scene.__pxVp;
    if (!tourVp) {                                         /* scenes without a suitable viewpoint get one made here */
      tourVp = scene.createNode('Viewpoint'); tourVp.description = 'Tour'; tourVp.fieldOfView = T.fov || 0.8; scene.addRootNode(tourVp); scene.__pxVp = tourVp;
    }
    if (T.fov) { try { tourVp.fieldOfView = T.fov; } catch (e4) {} }
    try { tourVp.set_bind = true; } catch (e3) {}
    PX.tourOn = true; tourHeld = false; tourT0 = performance.now(); cancelAnimationFrame(tourRaf); tourRaf = requestAnimationFrame(tourStep);
    var b = $('#btn-tour'); if (b) { b.classList.add('on'); b.textContent = 'Pause tour'; }
  }
  function tourStop() {
    PX.tourOn = false; tourHeld = false; cancelAnimationFrame(tourRaf);
    var b = $('#btn-tour'); if (b) { b.classList.remove('on'); b.textContent = 'Resume tour'; }
  }
  /* v4: pause the tour without losing its phase (the button keeps saying "Pause tour"); a later tourStop() or tourStart() cancels the hold */
  function tourHold() { if (!PX.tourOn) return false; tourHeldAt = performance.now() - tourT0; tourHeld = true; PX.tourOn = false; cancelAnimationFrame(tourRaf); return true; }
  function tourRelease() { if (!tourHeld) return false; tourHeld = false; PX.tourOn = true; tourT0 = performance.now() - tourHeldAt; cancelAnimationFrame(tourRaf); tourRaf = requestAnimationFrame(tourStep); return true; }
  PX.tourStart = tourStart; PX.tourStop = tourStop; PX.tourHold = tourHold; PX.tourRelease = tourRelease; PX.tourHeld = function () { return tourHeld; };

  /* ---------- viewpoint buttons ---------- */
  function bindVp(name) {
    tourStop();
    try { var n = PX.el.browser.currentScene.getNamedNode(name); n.set_bind = true; } catch (e) { console.warn('no viewpoint', name, e); }
    document.querySelectorAll('.vp').forEach(function (b) { b.classList.toggle('on', b.dataset.vp === name); });
  }

  /* ---------- spooky overlay (lights out): flashlight follows the pointer, rare lightning, drifting fog ---------- */
  function spooky(on) {
    document.body.classList.toggle('lights-out', on);
    var b = $('#btn-dark'); if (b) { b.classList.toggle('on', on); b.textContent = on ? 'Lights on' : 'Lights out'; }
  }
  function spookyInit(def) {
    var stage = $('#stage');
    spooky(def);
    stage.addEventListener('pointermove', function (ev) { var r = stage.getBoundingClientRect(); stage.style.setProperty('--mx', (ev.clientX - r.left) + 'px'); stage.style.setProperty('--my', (ev.clientY - r.top) + 'px'); });
    var g = $('.grain'); if (g) { var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), d = x.createImageData(128, 128);
      for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 40; } x.putImageData(d, 0, 0); g.style.backgroundImage = 'url(' + c.toDataURL() + ')'; }
    if (!REDUCED) (function storm() {
      setTimeout(function () {
        if (document.body.classList.contains('lights-out')) {
          var f = $('.flash'); if (f) { f.style.transition = 'none'; f.style.opacity = .55;
            setTimeout(function () { f.style.transition = 'opacity .5s'; f.style.opacity = 0; }, 70);
            setTimeout(function () { f.style.transition = 'none'; f.style.opacity = .3; setTimeout(function () { f.style.transition = 'opacity .7s'; f.style.opacity = 0; }, 60); }, 190); }
        }
        storm();
      }, 7000 + Math.random() * 14000);
    })();
  }

  /* ---------- loading: a scene url, or gzip+base64 parts (splats), optionally slotted into a stage file ---------- */
  function loadScene(el, cfg) {
    var t0 = performance.now();
    if (cfg.parts) {
      busy('Fetching ' + (cfg.splats || '').toLocaleString('en-US') + ' splats (' + cfg.mb + ' MB)');
      var t1, t2;
      return fetchParts(cfg.parts).then(function (b) { t1 = performance.now(); busy('Unpacking'); return gunzip(b); })
        .then(function (xml) {
          t2 = performance.now(); busy('Parsing ' + (xml.length / 1e6).toFixed(0) + ' MB of X3D 4.1');
          if (!cfg.stage) return el.browser.createX3DFromString(xml);
          return fetch(cfg.stage).then(function (r) { return r.text(); }).then(function (st) {
            var i = xml.indexOf('<Scene>'), j = xml.lastIndexOf('</Scene>');
            return el.browser.createX3DFromString(st.replace(/<Inline DEF="Evidence"[^>]*\/>/, function () { return '<Group DEF="Evidence">' + xml.slice(i + 7, j) + '</Group>'; }));
          });
        })
        .then(function (scn) { el.browser.replaceWorld(scn); return { msg: 'fetch ' + sec(t1 - t0) + ' · unzip ' + sec(t2 - t1) + ' · parse ' + sec(performance.now() - t2) }; });
    }
    busy('Loading the scene');
    return el.browser.loadURL(new X3D.MFString(cfg.scene)).then(function () { return { msg: 'loaded in ' + sec(performance.now() - t0) }; });
  }
  PX.load = function (cfg2) {   /* swap the scene in place (used by multi-scene pages) */
    tourStop(); var el = PX.el;
    return loadScene(el, cfg2).then(function (r) { busy(''); var h = $('#hud'); if (h) h.dataset.load = r.msg; return r; }).catch(function (e) { busy('Could not load: ' + e); });
  };

  /* ---------- wipe comparison ---------- */
  PX.wipe = function (host, leftSrc, rightSrc, leftLabel, rightLabel) {
    host.classList.add('wipe');
    host.innerHTML = '<img alt="' + leftLabel + '" src="' + leftSrc + '"><img class="top-img" alt="' + rightLabel + '" src="' + rightSrc + '">' +
      '<span class="handle"></span><span class="lab l">' + leftLabel + '</span><span class="lab r">' + rightLabel + '</span>';
    function set(ev) { var r = host.getBoundingClientRect(); var p = Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100)); host.style.setProperty('--p', p + '%'); }
    var down = false; host.addEventListener('pointerdown', function (e) { down = true; host.setPointerCapture(e.pointerId); set(e); });
    host.addEventListener('pointermove', function (e) { if (down) set(e); }); host.addEventListener('pointerup', function () { down = false; });
  };

  /* ---------- boot ---------- */
  PX.boot = function (cfg) {
    PX.cfg = cfg;
    spookyInit(!!cfg.darkDefault);
    var el = PX.el = makeCanvas(cfg.look);
    $('#btn-dark').addEventListener('click', function () { spooky(!document.body.classList.contains('lights-out')); });
    $('#btn-full').addEventListener('click', function () { var s = $('#stage'); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen(); });
    var cb = $('#btn-clean'); var clean = PX.clean = function (on) { $('#stage').classList.toggle('clean', on); cb.classList.toggle('on', on); cb.textContent = on ? 'Show text' : 'Hide text'; };
    cb.addEventListener('click', function () { clean(!$('#stage').classList.contains('clean')); });
    /* v4: the H key belongs to the overlay (hold = momentary UI none), so the v3 toggle is gone */
    var tb = $('#btn-tour'); if (tb) tb.addEventListener('click', function () { (PX.tourOn || tourHeld) ? tourStop() : tourStart(); });   /* v4: a held tour still counts as running */
    (cfg.tours || []).forEach(function (t, i) {
      var b = document.createElement('button'); b.className = 'chip tourchip' + (i ? '' : ' on'); b.textContent = t.label;
      b.addEventListener('click', function () { document.querySelectorAll('.tourchip').forEach(function (x) { x.classList.toggle('on', x === b); }); PX.cfg.tour = t; tourStop(); tourStart(); });
      $('#vps').appendChild(b);
    });
    if (cfg.tours && cfg.tours.length) cfg.tour = cfg.tours[0];
    (cfg.viewpoints || []).forEach(function (v) {
      var b = document.createElement('button'); b.className = 'chip vp'; b.textContent = v[1]; b.dataset.vp = v[0];
      b.addEventListener('click', function () { bindVp(v[0]); }); $('#vps').appendChild(b);
    });
    el.addEventListener('pointerdown', function () { if (PX.tourOn || tourHeld) tourStop(); });
    var go = function () {
      loadScene(el, cfg).then(function (r) {
        busy(''); var p = $('.poster'); if (p) p.hidden = true; hud(el);
        var hh = $('#hud'); if (hh) hh.dataset.load = r.msg;
        var li = $('#loadinfo'); if (li) li.textContent = (cfg.loadLabel || 'Loaded') + ': ' + r.msg;
        if (cfg.tour && cfg.tour.auto !== false && !REDUCED) setTimeout(tourStart, cfg.tour.delay || 600);
        if (cfg.autoClean) setTimeout(function () { if (!document.body.dataset.touched) PX.clean(true); }, cfg.autoClean);
        if (cfg.onLoaded) cfg.onLoaded(el);
        document.body.dataset.loaded = '1';
      }).catch(function (e) { busy('Could not load: ' + e); console.error(e); });
    };
    if (el.browser) go(); else customElements.whenDefined('x3d-canvas').then(function () { setTimeout(go, 0); });
  };
})();
