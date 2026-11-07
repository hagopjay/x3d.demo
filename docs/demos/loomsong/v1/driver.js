/* Loomsong driver: the page's half of "the page owns the clock, X3D owns the world".
 *
 * One number crosses to the world each frame: FractionBus.set_fraction = t / D (SAI). Everything else in the scene (every interpolator, every shader's u_time) follows from that.
 * The directed camera lives in the world (Cam, driven by interpolators). When the viewer grabs it, the page binds the world's second viewpoint (Free) and sets its pose each frame to
 * the directed pose plus the viewer's offset; after four idle seconds the offset eases to nothing and Cam is bound again. C freezes the camera where it is (free) and back.
 * No Script nodes anywhere, no eval, no CDN: X_ITE is this page's own file.
 *
 * Plain script. Exposes window.LoomApp (the class) and, once started, window.Loomsong (the instance).
 */
(function (global) {
  'use strict';

  var IDLE_MS = 4000, EASE_MS = 450;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  // ---------------------------------------------------------------------------------------------------- camera rig
  function Rig(app) {
    this.app = app;
    this.mode = 'directed';                 // 'directed' | 'grabbed' | 'free'
    this.yaw = 0; this.pitch = 0; this.px = 0; this.py = 0; this.dolly = 0;
    this.lastInput = 0; this.lastPerf = 0; this.frozen = null;
    this.speed = 3;
  }

  /** A new world: the rig starts directed, with the viewer's pace for this world's size. */
  Rig.prototype.reset = function (piece) {
    this.mode = 'directed'; this.frozen = null; this._zero();
    this.speed = piece && piece.camScale ? piece.camScale : 3;
  };

  Rig.prototype._pose = function () {
    var cam = this.app.nodes.cam;
    return { p: cam.position, r: cam.orientation, fov: cam.fieldOfView };
  };

  Rig.prototype._zero = function () { this.yaw = this.pitch = this.px = this.py = this.dolly = 0; };

  Rig.prototype._grab = function (perf) {
    var n = this.app.nodes, base = this._pose();
    n.free.position = base.p; n.free.orientation = base.r; n.free.fieldOfView = base.fov;
    this._zero();
    this.mode = 'grabbed'; this.lastInput = perf; this.lastPerf = perf;
    n.free.set_bind = true;
    this.app.emit('camera', this.mode);
  };

  Rig.prototype.release = function () {
    this._zero(); this.frozen = null;
    if (this.mode !== 'directed') { this.app.nodes.cam.set_bind = true; this.mode = 'directed'; this.app.emit('camera', this.mode); }
  };

  /** kind: 'look' (dx, dy in pixels), 'pan' (pixels) or 'dolly' (metres of travel along the view). */
  Rig.prototype.input = function (kind, dx, dy, perf) {
    if (!this.app.nodes.free) return;
    if (this.mode === 'directed') this._grab(perf);
    this.lastInput = perf;
    var s = this.speed;
    if (kind === 'look') { this.yaw -= dx * 0.004; this.pitch = clamp(this.pitch - dy * 0.004, -1.4, 1.4); }
    else if (kind === 'pan') { this.px -= dx * 0.004 * s; this.py += dy * 0.004 * s; }
    else if (kind === 'dolly') this.dolly += dx * s * 0.25;
  };

  /** C: freeze the camera where it is (no ease-back), or hand it back to the directed track. */
  Rig.prototype.toggleFree = function (perf) {
    if (this.mode === 'free') { this.release(); return; }
    if (this.mode === 'directed') this._grab(perf);
    // a frozen base must be the pose the viewer sees now, offset included: Free's pose, which update() has been setting
    var n = this.app.nodes;
    this.frozen = { p: n.free.position, r: n.free.orientation, fov: n.free.fieldOfView };
    this._zero();
    this.mode = 'free';
    this.app.emit('camera', this.mode);
  };

  Rig.prototype.update = function (perf) {
    if (this.mode === 'directed') return;
    var X = global.X3D, n = this.app.nodes, dt = perf - this.lastPerf;
    this.lastPerf = perf;
    if (this.mode === 'grabbed' && perf - this.lastInput > IDLE_MS) {
      var k = Math.exp(-dt / EASE_MS);
      this.yaw *= k; this.pitch *= k; this.px *= k; this.py *= k; this.dolly *= k;
      if (Math.abs(this.yaw) + Math.abs(this.pitch) + Math.abs(this.px) + Math.abs(this.py) + Math.abs(this.dolly) < 2e-3) { this.release(); return; }
    }
    var b = this.mode === 'free' ? this.frozen : this._pose();
    var r = b.r.multiply(new X.SFRotation(0, 1, 0, this.yaw)).multiply(new X.SFRotation(1, 0, 0, this.pitch));
    var move = b.r.multVec(new X.SFVec3f(this.px, this.py, -this.dolly));
    n.free.position = b.p.add(move);
    n.free.orientation = r;
    n.free.fieldOfView = b.fov;
  };

  Rig.prototype.attach = function (el) {
    var self = this, last = null, pts = new Map(), pinch = 0;
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.ls-ui')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey });
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      pinch = 0;
    });
    el.addEventListener('pointermove', function (e) {
      var p = pts.get(e.pointerId);
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2) {
        var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch) self.input('dolly', (d - pinch) * 0.05, 0, e.timeStamp);
        pinch = d;
        self.input('pan', dx / 2, dy / 2, e.timeStamp);
      } else if (p.b === 2 || p.shift) self.input('pan', dx, dy, e.timeStamp);
      else self.input('look', dx, dy, e.timeStamp);
    });
    var up = function (e) { pts.delete(e.pointerId); pinch = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) { e.preventDefault(); self.input('dolly', -e.deltaY * 0.01, 0, e.timeStamp); }, { passive: false });
  };

  // ---------------------------------------------------------------------------------------------------- the app
  function LoomApp(cfg) {
    this.cfg = cfg; this.pieces = cfg.pieces;
    this.piece = null; this.meta = null; this.D = 0; this.t = 0; this.lastSent = -1;
    this.clock = new global.LoomClock();
    this.nodes = {}; this.rig = null; this.canvas = null; this.browser = null; this.host = null;
    this.listeners = {}; this.calm = false; this.errors = []; this.frameMs = 0; this._lastPerf = 0;
    this.manual = /[?&]clock=manual/.test(global.location.search);
    this.ready = null;
    var self = this;
    global.addEventListener('error', function (e) { self.errors.push(String(e.message || e)); });
    global.addEventListener('unhandledrejection', function (e) { self.errors.push(String(e.reason)); });
  }

  LoomApp.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
  LoomApp.prototype.emit = function (ev, a, b) { (this.listeners[ev] || []).forEach(function (fn) { try { fn(a, b); } catch (e) { global.console.error('listener ' + ev + ': ' + e); } }); };

  LoomApp.prototype.start = function (host, firstId) {
    var self = this;
    this.host = host;
    this.ready = this.openPiece(firstId || this.pieces[0].id, false).then(function () {
      self._loop = function (perf) { self.frame(perf); global.requestAnimationFrame(self._loop); };
      global.requestAnimationFrame(self._loop);
      return true;
    });
    return this.ready;
  };

  /** Poll for the scene's own nodes: the bus is how we know the new world, not the old one, is current. */
  LoomApp.prototype._sceneReady = async function (piece, timeoutMs) {
    var X = global.X3D, t0 = global.performance.now();
    for (;;) {
      try {
        var sc = X.getBrowser(this.canvas).currentScene, bus = sc && sc.getNamedNode('FractionBus'), sec = sc && sc.getNamedNode('SecondsBus');
        if (bus && sec) {
          var kv = sec.keyValue;
          if (Math.abs(kv[kv.length - 1] - piece.D) < 0.01) return sc;
        }
      } catch (e) { /* not there yet */ }
      if (global.performance.now() - t0 > timeoutMs) throw new Error('the world did not load: ' + piece.world);
      await new Promise(function (r) { setTimeout(r, 60); });
    }
  };

  LoomApp.prototype.openPiece = async function (id, autoplay) {
    var X = global.X3D, p = this.pieces.find(function (q) { return q.id === id; });
    if (!p) throw new Error('no such piece ' + id);
    this.emit('loading', p);
    this.clock.stop();
    if (this.rig) this.rig.release();
    if (!this.canvas) {
      var c = global.document.createElement('x3d-canvas');
      c.setAttribute('src', p.world);
      ['splashScreen', 'contextMenu', 'notifications', 'timings'].forEach(function (a) { c.setAttribute(a, 'false'); });
      c.setAttribute('class', 'ls-canvas');
      this.host.appendChild(c);
      this.canvas = c;
    } else {
      await X.getBrowser(this.canvas).loadURL(new X.MFString(p.world));
    }
    var sc = await this._sceneReady(p, 120000);
    this.browser = X.getBrowser(this.canvas);
    this.piece = p; this.D = p.D;
    this.nodes = { bus: sc.getNamedNode('FractionBus'), sec: sc.getNamedNode('SecondsBus'), cam: sc.getNamedNode('Cam'), free: sc.getNamedNode('Free') };
    this.nodes.shaders = (p.shaders || []).map(function (n) { try { return sc.getNamedNode(n); } catch (e) { return null; } }).filter(Boolean);
    if (!this.rig) { this.rig = new Rig(this); this.rig.attach(this.host); }       // one rig for the life of the page: its listeners belong to the page, not to a world
    this.rig.reset(p);
    var meta = await (await global.fetch(p.meta)).json();
    this.meta = meta;
    if (this.manual) this.clock.useManual(p.D); else await this.clock.load(p.audio, p.D);
    this.lastSent = -1; this.t = 0;
    this.setCalm(this.calm);
    this.emit('piece', p, meta);
    if (autoplay) await this.play();
  };

  LoomApp.prototype.setCalm = function (on) {
    this.calm = !!on;
    var v = this.calm ? 1 : 0;
    (this.nodes.shaders || []).forEach(function (s) { try { s.u_calm = v; } catch (e) { /* a shader without the field */ } });
    this.emit('calm', this.calm);
  };

  LoomApp.prototype.frame = function (perf) {
    if (!this.nodes.bus) return;
    if (this._lastPerf) { var dt = perf - this._lastPerf; this.frameMs = this.frameMs ? this.frameMs * 0.9 + dt * 0.1 : dt; }
    this._lastPerf = perf;
    var t = this.clock.now();
    this.t = t;
    if (t !== this.lastSent) { this.nodes.bus.set_fraction = clamp(t / this.D, 0, 1); this.lastSent = t; }
    if (this.rig) this.rig.update(perf);
    this.emit('frame', t, perf);
  };

  /** Play. From the piece's first moment it also says "opening", which the cards (page/cards.js) answer with the piece's opening picture; the clock never waits for them. */
  LoomApp.prototype.play = function () {
    var self = this, fresh = !this.clock.playing && this.clock.now() < 0.05 && !!this.piece;
    return this.clock.play().then(function () { if (fresh) self.emit('opening', self.piece); return true; });
  };
  LoomApp.prototype.pause = function () { this.clock.pause(); };
  LoomApp.prototype.toggle = function () { var self = this; return Promise.resolve(this.clock.toggle()).then(function () { self.emit('state', self.clock.playing); }); };
  LoomApp.prototype.seek = function (t) { return this.clock.seek(t); };

  /** Seek by whole bars: +1 next downbeat, -1 this bar's start (or the previous one when less than a second into it). */
  LoomApp.prototype.seekBar = function (delta) {
    var m = this.meta;
    if (!m) return Promise.resolve();
    var starts = m.bar_t, t = this.clock.now(), i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= t + 1e-6) i++;
    var j = delta > 0 ? Math.min(starts.length - 1, i + 1) : (t - starts[i] > 1.0 ? i : Math.max(0, i - 1));
    return this.seek(j === 0 && delta < 0 ? 0 : starts[j]);
  };

  LoomApp.prototype.nextPiece = function () {
    var i = this.pieces.findIndex(function (q) { return q.id === this.piece.id; }, this);
    return this.openPiece(this.pieces[(i + 1) % this.pieces.length].id, this.clock.playing || this.clock.ended);
  };

  /** Where the page is in the score now: bar, beat, the pass it is in. Pure function of the meta, so the witnesses can call it too. */
  LoomApp.prototype.where = function (t) {
    var m = this.meta;
    if (!m) return null;
    var q = quarters(m.tempo, t), bar, beat;
    var rel = q - m.pickup;
    if (rel < 0) { bar = 0; beat = 1 + (m.beats - m.pickup) + q; } else { bar = 1 + Math.floor(rel / m.beats + 1e-9); beat = 1 + (rel % m.beats); }
    var pass = null;
    for (var i = 0; i < m.passes.length; i++) if (t >= m.passes[i].t0 - 1e-6) pass = m.passes[i];
    return { bar: bar, beat: beat, q: q, pass: pass };
  };

  /** Quarters at t seconds through a tempo map [[q, qpm], ...] (piecewise-constant tempo, as the card defines it). */
  function quarters(tempo, t) {
    var s = 0, q = 0;
    for (var i = 0; i < tempo.length; i++) {
      var q0 = tempo[i][0], qpm = tempo[i][1], q1 = i + 1 < tempo.length ? tempo[i + 1][0] : Infinity;
      var segS = (q1 - q0) * 60 / qpm;
      if (t - s <= segS || i + 1 === tempo.length) return q0 + (t - s) * qpm / 60;
      s += segS;
    }
    return q;
  }

  global.LoomApp = LoomApp;
  global.LoomQuarters = quarters;
})(window);
