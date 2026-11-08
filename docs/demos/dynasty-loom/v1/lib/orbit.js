/* orbit.js: the Dynasty Loom orbit camera. No dependencies; nothing is evaluated from strings (no eval, no Function constructor), so it is CSP-safe. In a page it sets window.DynastyOrbit;
   under node it is a module (the Core is plain maths and runs without a DOM).

   DynastyOrbit.Core   one camera state: pivot (the orbit centre), dist, q (orientation, [x, y, z, w]), fov. Everything that moves the camera
                       goes through it: the drags, the wheel, the keys, momentum, the idle orbit, the re-centre ease, and the page's flights
                       (setPose every frame), so no hand-off can jump.
     turntable         yaw about world +Y (the sphere's axis), pitch about the level right axis, pitch clamped; a roll left by a rolled shot or a
                       free drag eases out while the user orbits (relevel).
     trackball         a free rotation about the pivot (Shift-drag; the two-finger twist turns about the view axis once it passes twistDead rad,
                       and a pinch that never twisted past twistKeep rad eases level again when it ends, v5).
     momentum          the release velocity over the last `velWindow` ms of a drag, decaying as exp(-t / tau). The decay is integrated exactly
                       (displacement v tau (1 - exp(-dt / tau)) a frame), so it does not depend on the frame rate. Off under reduced motion.
                       v5: the first frame after a release integrates from the last move the drag applied to the end of that frame, so it
                       neither steps twice (the release in the last move's frame) nor stalls (the release a frame later); the pointerup's own
                       move is applied first. The lens glide keeps its release speed and caps its coast distance instead (tau_lens =
                       min(tau, cap / |v|), cap = hooks.lensCoast() px when the page gives it, so the page can tie it to the glass's size).
     zoom to cursor    a homothety about the point under the pointer (on the pivot's depth plane): every point on that ray keeps its pixel. The
                       log distance follows a critically damped spring (closed form, frame-rate independent) and is clamped.
     pan               the pivot moves in the view plane by the pointer's motion at the pivot's depth (the point there stays under the pointer).
     keys              a press orbits keyStep, eased (keyTau); a held key (its repeats) turns at a steady keyRate instead, eased in and out.
   DynastyOrbit.attach(el, core, hooks, opts)   pointer, wheel, touch (pinch, two-finger pan and twist), double-click and keys, wired to a Core.
     The page calls the returned flushGesture() at the start of its frame, so a pinch lands in the frame it was made in (v5).
   The camera looks down its -Z with +Y up; X_ITE's fieldOfView spans the smaller side of the viewport. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DynastyOrbit = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var Y = [0, 1, 0];
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; }
  function lerp(a, b, t) { return add(a, mul(sub(b, a), t)); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smoother(x) { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function qaa(ax, a) { ax = norm(ax); var s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; }
  function qmul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
  function qconj(a) { return [-a[0], -a[1], -a[2], a[3]]; }
  function qnorm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; }
  function qrot(q, v) { var p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [p[0], p[1], p[2]]; }
  function qFromBasis(x, y, z) {
    var m00 = x[0], m11 = y[1], m22 = z[2], t = m00 + m11 + m22, q;
    if (t > 0) { var s = Math.sqrt(t + 1) * 2; q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, 0.25 * s]; }
    else if (m00 > m11 && m00 > m22) { var s1 = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s1, (y[0] + x[1]) / s1, (z[0] + x[2]) / s1, (y[2] - z[1]) / s1]; }
    else if (m11 > m22) { var s2 = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(y[0] + x[1]) / s2, 0.25 * s2, (z[1] + y[2]) / s2, (z[0] - x[2]) / s2]; }
    else { var s3 = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(z[0] + x[2]) / s3, (z[1] + y[2]) / s3, 0.25 * s3, (x[1] - y[0]) / s3]; }
    return qnorm(q);
  }
  function lookQ(pos, tgt, up) {
    var z = norm(sub(pos, tgt)), x = cross(up || Y, z);
    if (len(x) < 1e-9) x = cross(Math.abs(z[1]) < 0.9 ? Y : [1, 0, 0], z);
    x = norm(x); return qFromBasis(x, cross(z, x), z);
  }
  function slerpV(a, b, t) { var c = clamp(dot(a, b), -1, 1), w = Math.acos(c); if (w < 1e-6) return norm(lerp(a, b, t)); var s = Math.sin(w); return norm(add(mul(a, Math.sin((1 - t) * w) / s), mul(b, Math.sin(t * w) / s))); }
  function qslerp(a, b, t) { var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
    if (d > 0.9995) return qnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    var w = Math.acos(d), s = Math.sin(w), k0 = Math.sin((1 - t) * w) / s, k1 = Math.sin(t * w) / s; return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1]; }
  function qAngle(a, b) { return 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))); }

  // ---------------------------------------------------------------- the camera state
  function Core(o) {
    o = o || {};
    this.pivot = [0, 0, 0]; this.dist = 3; this.q = [0, 0, 0, 1]; this.fov = 0.8;
    this.distMin = o.distMin || 0.03; this.distMax = o.distMax || 24; this.pitchMax = o.pitchMax || 1.45;
    this.tau = o.tau || 0.36;            // momentum time constant (s)
    this.velWindow = o.velWindow || 80;  // ms of drag that set the release velocity
    this.zoomOmega = o.zoomOmega || 15;  // zoom spring (rad/s), critically damped
    this.keyTau = o.keyTau || 0.12;      // key orbit ease (s)
    this.keyRate = o.keyRate || 1.309;   // a held arrow key's turn rate (rad/s, 75 deg/s; v5: each OS repeat added another step, about 470 deg/s)
    this.keyHoldTau = o.keyHoldTau || 0.12;   // its ease in and out (s)
    this.relevelTau = o.relevelTau || 0.4;
    this.relevelEps = o.relevelEps || 8.7e-4;   // rad (0.05 deg): a relevel runs until the roll is under this, or its time budget ends (v5)
    this.lensCoast = o.lensCoast || 170; // px: the lens glide's longest coast; a faster flick decays sooner, it is never slowed at release (v5)
    this.rotGain = o.rotGain || 1;       // turntable radians per (pixel / smaller viewport side * pi)
    this.reduced = !!o.reducedMotion;
    this.vel = { yaw: 0, pitch: 0, axis: null, rate: 0, lx: 0, ly: 0 };
    this.zoom = null; this.keys = { yaw: 0, pitch: 0, hy: 0, hp: 0, left: 0, vy: 0, vp: 0 }; this.idle = null; this.tween = null; this.relevel = 0;
    this.hooks = { lensDrag: null, lensCoast: null };
    this.shift = [0, 0]; this.shiftT = [0, 0]; this.shiftTau = o.shiftTau || 0.35;   // the view shift: the pivot sits at the centre of the free area
    this.ver = 0;
    this.dragT = null; this.shownT = null;   // v5: the time stamp of the last drag move applied, and of the one the last frame showed
  }
  var C = Core.prototype;
  C.dir = function () { return qrot(this.q, [0, 0, 1]); };                       // unit vector from the pivot to the camera
  C.position = function () {   // the camera slides parallel to the view by shift * dist (no turn), so the pivot shows off-centre by a fixed pixel offset
    var p = add(this.pivot, mul(this.dir(), this.dist)), s = this.shift; if (!s[0] && !s[1]) return p;
    return add(p, mul(add(mul(this.right(), s[0]), mul(this.up(), s[1])), this.dist));
  };
  C.setShift = function (cx, cy, W, H, snap) {   // put the pivot at (W/2 + cx, H/2 + cy) px: eased over shiftTau, at once under reduced motion
    var t = 2 * Math.tan(this.fov / 2) / Math.min(W, H); this.shiftT = [-cx * t, cy * t];
    if (snap || this.reduced) { if (this.shift[0] !== this.shiftT[0] || this.shift[1] !== this.shiftT[1]) { this.shift = this.shiftT.slice(); this.touch(); } }
  };
  C.fwd = function () { return qrot(this.q, [0, 0, -1]); };
  C.up = function () { return qrot(this.q, [0, 1, 0]); };
  C.right = function () { return qrot(this.q, [1, 0, 0]); };
  C.pose = function () { return { pos: this.position(), q: this.q.slice(), fov: this.fov, target: this.pivot.slice(), up: this.up(), dist: this.dist }; };
  C.touch = function () { this.ver++; };
  C.setPose = function (pos, tgt, up, fov) {
    this.pivot = tgt.slice(); this.dist = Math.max(len(sub(pos, tgt)), 1e-5); this.q = lookQ(pos, tgt, up || Y); if (fov != null) this.fov = fov; this.touch();
  };
  C.setPivotDist = function (pivot, dist) { this.pivot = pivot.slice(); this.dist = clamp(dist, 1e-5, 1e9); this.touch(); };
  C.elevation = function () { return Math.asin(clamp(this.dir()[1], -1, 1)); };
  C.yaw = function () { var d = this.dir(); return Math.atan2(d[0], d[2]); };
  C.roll = function () {   // signed angle about the view axis from the level up to the camera's up
    var f = this.fwd(), lu = sub(Y, mul(f, dot(f, Y))); if (len(lu) < 1e-6) return 0; lu = norm(lu);
    var u = this.up(); return Math.atan2(dot(cross(lu, u), f), dot(lu, u));
  };
  C.yawBy = function (a) { if (!a) return; this.q = qnorm(qmul(qaa(Y, a), this.q)); this.touch(); };
  C.pitchBy = function (a) {
    if (!a) return; var e = this.elevation(), pm = this.pitchMax, e2 = e + a;
    if (e2 > pm) e2 = Math.max(e, pm); if (e2 < -pm) e2 = Math.min(e, -pm);   // clamped; a pose already past the clamp may only come back
    var da = e2 - e; if (Math.abs(da) < 1e-12) return;
    var h = cross(this.dir(), Y); h = len(h) > 1e-6 ? norm(h) : this.right();
    this.q = qnorm(qmul(qaa(h, da), this.q)); this.touch();
  };
  C.rotate = function (axis, a) { if (!a || len(axis) < 1e-12) return; this.q = qnorm(qmul(qaa(axis, a), this.q)); this.touch(); };
  C.rollBy = function (a) { if (!a) return; this.rotate(this.fwd(), a); };
  C.panBy = function (d) { this.pivot = add(this.pivot, d); this.touch(); };
  C.zoomAbout = function (X, k) {   // homothety about X: the camera, the pivot and the distance scale by k (clamped)
    var d2 = clamp(this.dist * k, this.distMin, this.distMax); k = d2 / this.dist; if (Math.abs(k - 1) < 1e-12) return 1;
    this.pivot = add(X, mul(sub(this.pivot, X), k)); this.dist = d2; this.touch(); return k;
  };
  C.unitsPerPixel = function (W, H, depth) { return 2 * (depth == null ? this.dist : depth) * Math.tan(this.fov / 2) / Math.min(W, H); };
  C.ray = function (x, y, W, H) {   // world direction through pixel (x, y)
    var f = Math.tan(this.fov / 2), m = Math.min(W, H), nx = (2 * x - W) / m * f, ny = (H - 2 * y) / m * f;
    return norm(add(add(mul(this.right(), nx), mul(this.up(), ny)), this.fwd()));
  };
  C.pointAtPivotDepth = function (x, y, W, H) { var r = this.ray(x, y, W, H), c = dot(r, this.fwd()); return add(this.position(), mul(r, this.dist / Math.max(c, 1e-6))); };
  C.project = function (p, W, H) {
    var c = qrot(qconj(this.q), sub(p, this.position())), depth = -c[2]; if (depth < 1e-6) return null;
    var f = 1 / Math.tan(this.fov / 2), m = Math.min(W, H);
    return { x: W / 2 + c[0] / depth * f * m / 2, y: H / 2 - c[1] / depth * f * m / 2, depth: depth };
  };
  // ---- drags (pixels) -> motion
  C.dragGain = function (W, H) { return Math.PI / Math.min(W, H) * this.rotGain; };
  C.turntable = function (dx, dy, W, H) { var g = this.dragGain(W, H); this.yawBy(-dx * g); this.pitchBy(dy * g); };
  C.trackball = function (dx, dy, W, H) {
    var g = this.dragGain(W, H), ax = sub(mul(this.up(), -dx), mul(this.right(), dy)); this.rotate(ax, g * Math.sqrt(dx * dx + dy * dy));
  };
  C.pan = function (dx, dy, W, H) { var u = this.unitsPerPixel(W, H); this.panBy(add(mul(this.right(), -dx * u), mul(this.up(), dy * u))); };
  // ---- the animated parts
  C.stop = function () { this.vel = { yaw: 0, pitch: 0, axis: null, rate: 0, lx: 0, ly: 0, ltau: 0, tRel: null }; this.zoom = null; this.keys = { yaw: 0, pitch: 0, hy: 0, hp: 0, left: 0, vy: 0, vp: 0 }; this.tween = null; this.idle = null; };
  C.coast = function () {   // the momentum still to come, as a closed form a flight can carry on with (yaw and pitch rates, rad/s, decaying with tau)
    var v = this.vel; return (v.yaw || v.pitch) && !this.reduced ? { yaw: v.yaw, pitch: v.pitch, tau: this.tau } : null;
  };
  C.moving = function () { var v = this.vel; return !!(v.yaw || v.pitch || v.rate || v.lx || v.ly || this.zoom || this.keys.yaw || this.keys.pitch || this.keys.left > 0 || this.keys.vy || this.keys.vp || this.tween || this.idle); };
  C.fling = function (kind, vx, vy, W, H, tRel) {   // release velocity in px/s -> momentum (nothing under reduced motion); tRel: the time stamp (ms) of the
                                                     // last move the drag applied (v5; it was the release's own stamp, which left one dead frame)
    if (this.reduced) return;
    var g = this.dragGain(W, H); this.vel.tRel = tRel == null ? null : tRel;
    if (kind === 'orbit') { this.vel.yaw = -vx * g; this.vel.pitch = vy * g; }
    else if (kind === 'trackball') { var ax = sub(mul(this.up(), -vx), mul(this.right(), vy)), sp = Math.sqrt(vx * vx + vy * vy); if (sp > 0) { this.vel.axis = norm(ax); this.vel.rate = g * sp; } }
    else if (kind === 'lens') {   // a glide through hyperbolic space covers ground fast: the coast is capped at lensCoast px by a shorter decay, and the
                                  // release speed is kept, so the glide does not brake at the release (v5; the v2 prototype capped the speed)
      var sl = Math.sqrt(vx * vx + vy * vy), cap = this.hooks.lensCoast ? this.hooks.lensCoast() : this.lensCoast; if (!(cap > 0)) cap = this.lensCoast;
      this.vel.lx = vx; this.vel.ly = vy; this.vel.ltau = sl > 0 ? Math.min(this.tau, cap / sl) : this.tau; }
  };
  C.zoomTo = function (X, dLog) {   // add dLog to the target log distance; the spring carries the camera there about anchor X
    var L = Math.log(this.dist), z = this.zoom;
    var target = clamp((z ? z.target : L) + dLog, Math.log(this.distMin), Math.log(this.distMax));
    this.zoom = { target: target, x: L - target, v: z ? z.v : 0, X: X ? X.slice() : this.pivot.slice() };
  };
  C.orbitKey = function (dyaw, dpitch) { if (this.reduced) { this.yawBy(dyaw); this.pitchBy(dpitch); return; } this.keys.yaw += dyaw; this.keys.pitch += dpitch; };
  C.keyHold = function (sy, sp) {   // v5: an arrow key's OS repeat: turn at keyRate while the repeats keep coming (sy, sp: -1, 0 or 1), not another step each
    if (this.reduced) { this.yawBy(sy * this.keyRate / 30); this.pitchBy(sp * this.keyRate * 0.6 / 30); return; }
    var k = this.keys; k.hy = sy; k.hp = sp; k.left = 0.2;
  };
  C.keyRelease = function () { this.keys.left = 0; };
  C.recentre = function (P, dist, ms, dir) {   // ease the pivot to P and the distance to dist; with dir (unit, pivot to camera) also turn there, level
    this.vel = { yaw: 0, pitch: 0, axis: null, rate: 0, lx: 0, ly: 0 }; this.zoom = null;
    this.tween = { P0: this.pivot.slice(), P1: P.slice(), d0: this.dist, d1: clamp(dist == null ? this.dist : dist, this.distMin, this.distMax), t: 0, ms: this.reduced ? Math.min(ms, 180) : ms,
      D0: dir ? this.dir() : null, D1: dir ? norm(dir) : null, q0: this.q.slice() };
  };
  C.startIdle = function (rate, ramp) { if (this.reduced) return false; this.idle = { t: 0, rate: rate, ramp: ramp || 3 }; return true; };
  C.stopIdle = function (carry) {   // an input stops the idle orbit; its yaw rate becomes momentum, so the stop is a glide, not a jolt
    var i = this.idle; if (!i) return; this.idle = null;
    if (carry && !this.reduced) this.vel.yaw += i.rate * smoother(i.t / i.ramp);
  };
  C.step = function (dt, now) {   // seconds (now: the frame's time stamp, ms, on the events' clock; optional); returns true when the pose changed
    if (!(dt > 0)) return false; dt = Math.min(dt, 0.25);
    var v = this.vel, dm = dt, shown = this.shownT;
    if (v.tRel != null) {   // v5, release: the drag already moved the camera up to its last applied move (tRel). The first momentum frame integrates
      // only from there to the end of this frame (the time the last frame showed + dt): no catch-up jump when the release shares the last move's
      // frame (6.7 px against 3.4 px in the review), and no dead frame when the release comes a frame after the last move (17, 0, 16 px)
      if (now != null && shown != null) dm = clamp(shown + dt * 1000 - v.tRel, 0, dt * 1000) / 1000;
      v.tRel = null;
    }
    this.shownT = this.dragT;
    var v0 = this.ver, f = Math.exp(-dm / this.tau), k = this.tau * (1 - f);
    if (v.yaw || v.pitch) { this.yawBy(v.yaw * k); this.pitchBy(v.pitch * k); v.yaw *= f; v.pitch *= f; if (Math.abs(v.yaw) < 0.004 && Math.abs(v.pitch) < 0.004) { v.yaw = 0; v.pitch = 0; } }
    if (v.rate) { this.rotate(v.axis, v.rate * k); v.rate *= f; if (v.rate < 0.004) { v.rate = 0; v.axis = null; } }
    if (v.lx || v.ly) { var lt = v.ltau || this.tau, fl = Math.exp(-dm / lt), kl = lt * (1 - fl);
      if (this.hooks.lensDrag) this.hooks.lensDrag(v.lx * kl, v.ly * kl, true); v.lx *= fl; v.ly *= fl; if (Math.hypot(v.lx, v.ly) < 3) { v.lx = 0; v.ly = 0; v.ltau = 0; } }
    var z = this.zoom;
    if (z) {   // critically damped: x(t) = (x0 + (v0 + w x0) t) e^(-w t)
      var w = this.zoomOmega, e = Math.exp(-w * dt), B = z.v + w * z.x, x1 = (z.x + B * dt) * e, vv = (B - w * (z.x + B * dt)) * e;
      var L0 = Math.log(this.dist), L1 = z.target + x1; this.zoomAbout(z.X, Math.exp(L1 - L0)); z.x = x1; z.v = vv;
      if (Math.abs(x1) < 1e-4 && Math.abs(vv) < 1e-3) { this.zoomAbout(z.X, Math.exp(z.target - Math.log(this.dist))); this.zoom = null; }
    }
    var kk = this.keys;
    if (kk.yaw || kk.pitch) {
      var g = 1 - Math.exp(-dt / this.keyTau), ya = kk.yaw * g, pa = kk.pitch * g; this.yawBy(ya); this.pitchBy(pa); kk.yaw -= ya; kk.pitch -= pa;
      if (Math.abs(kk.yaw) < 2e-4) { this.yawBy(kk.yaw); kk.yaw = 0; } if (Math.abs(kk.pitch) < 2e-4) { this.pitchBy(kk.pitch); kk.pitch = 0; }
    }
    if (kk.left > 0 || kk.vy || kk.vp) {   // v5: a held key turns at a steady rate, eased in and out (keyHoldTau)
      var hon = kk.left > 0, ge = 1 - Math.exp(-dt / this.keyHoldTau);
      kk.vy += ((hon ? kk.hy * this.keyRate : 0) - kk.vy) * ge; kk.vp += ((hon ? kk.hp * this.keyRate * 0.6 : 0) - kk.vp) * ge;
      this.yawBy(kk.vy * dt); this.pitchBy(kk.vp * dt); kk.left = Math.max(0, kk.left - dt);
      if (!(kk.left > 0) && Math.abs(kk.vy) < 0.005 && Math.abs(kk.vp) < 0.005) { kk.vy = 0; kk.vp = 0; }
    }
    var tw = this.tween;
    if (tw) {
      tw.t += dt * 1000; var u = smoother(tw.t / tw.ms), dd = tw.d0 * Math.pow(tw.d1 / tw.d0, u);
      // the pivot's offset from the target scales with the distance, so the target's offset on screen (offset / distance) shrinks as (1 - u):
      // it never swings outward first, as a straight pivot path with a geometric zoom did (fix-1)
      this.pivot = add(tw.P1, mul(sub(tw.P0, tw.P1), (1 - u) * dd / tw.d0)); this.dist = dd;
      if (tw.D1) { var dd = slerpV(tw.D0, tw.D1, u), lv = lookQ(add(this.pivot, dd), this.pivot, Y); this.q = qslerp(tw.q0, lv, u); }
      this.touch();
      if (tw.t >= tw.ms) this.tween = null;
    }
    var sh = this.shift, sT = this.shiftT;
    if (sh[0] !== sT[0] || sh[1] !== sT[1]) {
      var fs = Math.exp(-dt / this.shiftTau); sh[0] = sT[0] + (sh[0] - sT[0]) * fs; sh[1] = sT[1] + (sh[1] - sT[1]) * fs;
      if (Math.abs(sh[0] - sT[0]) < 1e-5 && Math.abs(sh[1] - sT[1]) < 1e-5) this.shift = sT.slice(); this.touch();
    }
    if (this.idle) { var id = this.idle; id.t += dt; this.yawBy(id.rate * smoother(id.t / id.ramp) * dt); this.relevel = Math.max(this.relevel, 0.25); }
    if (this.relevel > 0) {   // ease a roll back to level (while the user orbits, and in the idle orbit)
      var r = this.roll(); if (Math.abs(r) > 1e-4) this.rollBy(-r * (1 - Math.exp(-dt / this.relevelTau)));
      // v5: it ends when the horizon is level (|roll| < relevelEps), its budget only a cap (a fixed 0.6 s left about a fifth of a pinch's roll)
      this.relevel = Math.abs(this.roll()) < this.relevelEps ? 0 : Math.max(0, this.relevel - dt);
    }
    return this.ver !== v0;
  };
  C.state = function () {
    var p = this.position();
    return { pivot: this.pivot.slice(), dist: this.dist, pos: p, q: this.q.slice(), fov: this.fov, yaw: this.yaw(), pitch: this.elevation(), roll: this.roll(),
      lastRelease: this.lastRelease || null, momentum: { yaw: this.vel.yaw, pitch: this.vel.pitch, rate: this.vel.rate, lx: this.vel.lx, ly: this.vel.ly, ltau: this.vel.ltau || 0 }, zooming: !!this.zoom, tween: !!this.tween,
      idle: this.idle ? { t: this.idle.t, rate: this.idle.rate } : null, shift: this.shift.slice(), shiftEasing: this.shift[0] !== this.shiftT[0] || this.shift[1] !== this.shiftT[1], keys: { yaw: this.keys.yaw, pitch: this.keys.pitch, held: this.keys.left > 0, rate: [this.keys.vy, this.keys.vp] }, reduced: this.reduced, tau: this.tau };
  };

  // ---------------------------------------------------------------- the DOM: pointer, wheel, touch, keys
  // hooks: viewport() -> [W, H]; input(kind) on any user input (the page cancels its flights and tours there); tap(x, y, e) -> the id it picked (or null);
  //        doubleTap(x, y, e, firstId): firstId is what the first tap picked (fix-1: the second tap is resolved against the first, so a scene that
  //        moved between the two taps cannot change the person); opts.dblMs (mouse, default 500 ms, the common OS default) and opts.dblMsTouch (450 ms),
  //        measured from the first release to the second press;
  //        hover(x, y, e); lens() -> true while the lens is on (a one-finger drag then moves the lens focus: lensDrag(dx, dy) in pixels);
  //        zoomAnchor(x, y, dy) -> the world point a zoom keeps under the pointer (default: the pointer's point on the pivot's depth plane; dy < 0 zooms in);
  //        reset() for the 0 key; keysEnabled(e) -> false to leave a key alone.
  function attach(el, core, hooks, opts) {
    hooks = hooks || {}; opts = opts || {};
    var ptrs = {}, drag = null, gesture = null, lastTap = null, samples = [];
    var TW_DEAD = opts.twistDead || 0.12, TW_KEEP = opts.twistKeep || 0.35;   // v5: a pinch's accidental twist (rad) does not roll the view
    var raf = opts.raf !== undefined ? opts.raf : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);   // v5: a pinch applies once a frame
    var now = function () { return (typeof performance !== 'undefined' ? performance : Date).now(); };
    var vp = function () { return hooks.viewport ? hooks.viewport() : [el.clientWidth, el.clientHeight]; };
    var local = function (e) { var r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function input(kind) { core.stopIdle(true); if (hooks.input) hooks.input(kind); }
    function kindFor(e) {
      var lensOn = hooks.lens && hooks.lens();
      if (e.button === 2 || e.button === 1) return lensOn ? (e.shiftKey ? 'trackball' : 'orbit') : 'pan';
      if (e.shiftKey) return 'trackball';
      if (e.altKey || e.ctrlKey) return lensOn ? 'orbit' : 'pan';
      return lensOn ? 'lens' : 'orbit';
    }
    function apply(kind, dx, dy) {
      var s = vp();
      if (kind === 'orbit') { core.relevel = Math.max(core.relevel, 0.6); core.turntable(dx, dy, s[0], s[1]); }
      else if (kind === 'trackball') core.trackball(dx, dy, s[0], s[1]);
      else if (kind === 'pan') core.pan(dx, dy, s[0], s[1]);
      else if (kind === 'lens' && hooks.lensDrag) hooks.lensDrag(dx, dy, false);
    }
    function stamp(e) { return e && e.timeStamp > 0 ? e.timeStamp : now(); }   // the event's own time: a slow frame between two events must not read as a pause
    function releaseVelocity(e) {   // px/s over the last velWindow ms (wider when the pointer reports slowly); zero if it had come to rest
      var t = stamp(e), n = samples.length, R = core.lastRelease = { n: n, why: '' }; if (n < 2) { R.why = 'one sample'; return [0, 0]; }
      var gap = samples[n - 1].t - samples[n - 2].t, win = clamp(2.2 * gap, core.velWindow, 220), rest = clamp(1.6 * gap, 60, 600);
      R.gap = gap; R.since = t - samples[n - 1].t; R.rest = rest;
      if (t - samples[n - 1].t > rest) { R.why = 'at rest before the release'; return [0, 0]; }
      var w = samples.filter(function (s) { return t - s.t <= win; }); if (w.length < 2) w = samples.slice(-2);   // a pointer that reports slowly (a busy frame): its last segment still carries the speed
      var a = w[0], b = w[w.length - 1], dts = (b.t - a.t) / 1000; if (dts < 0.008) { R.why = 'window too short'; return [0, 0]; }
      R.v = [(b.x - a.x) / dts, (b.y - a.y) / dts]; return R.v;
    }
    function pinchState() { var ids = Object.keys(ptrs); if (ids.length < 2) return null; var a = ptrs[ids[0]], b = ptrs[ids[1]];
      return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; }
    function onDown(e) {
      if (opts.ignore && opts.ignore(e)) return;
      var p = local(e); ptrs[e.pointerId] = { x: p[0], y: p[1], t0: now(), x0: p[0], y0: p[1], type: e.pointerType };
      try { el.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
      input('pointer'); core.vel = { yaw: 0, pitch: 0, axis: null, rate: 0, lx: 0, ly: 0 }; core.tween = null;
      var n = Object.keys(ptrs).length;
      if (n === 1) { drag = { kind: kindFor(e), x: p[0], y: p[1], moved: 0, t0: now(), id: e.pointerId }; samples = [{ t: stamp(e), x: p[0], y: p[1] }]; gesture = null; core.dragT = stamp(e); }
      else if (n === 2) { drag = null; gesture = pinchState(); gesture.lens = hooks.lens && hooks.lens(); gesture.tw = 0; gesture.rolled = 0; gesture.twMax = 0; gesture.pending = false; samples = []; }
      if (e.button === 2 || e.pointerType === 'touch') e.preventDefault();
    }
    function onMove(e) {
      var p = local(e), pt = ptrs[e.pointerId];
      if (!pt) { if (hooks.hover && !e.buttons) hooks.hover(p[0], p[1], e); return; }
      pt.x = p[0]; pt.y = p[1];
      if (gesture) {   // v5: both fingers' moves are gathered and the pinch is applied once a frame, so its anchor is read once
        if (!raf) applyGesture(); else if (!gesture.pending) { gesture.pending = true; raf(function () { if (gesture && gesture.pending) applyGesture(); }); }
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      var dx = p[0] - drag.x, dy = p[1] - drag.y; drag.x = p[0]; drag.y = p[1]; drag.moved += Math.abs(dx) + Math.abs(dy);
      samples.push({ t: stamp(e), x: p[0], y: p[1] }); if (samples.length > 64) samples.shift(); core.dragT = stamp(e);
      if (dx || dy) apply(drag.kind, dx, dy);
    }
    function applyGesture() {   // the pinch since the last application: zoom about the midpoint, pan (lens: orbit), and the twist past its dead zone
      gesture.pending = false; var g = pinchState(); if (!g) return; var s = vp();
      var X = core.pointAtPivotDepth(g.mx, g.my, s[0], s[1]);
      if (g.d > 1 && gesture.d > 1) core.zoomAbout(gesture.lens ? core.pivot : X, gesture.d / g.d);
      if (gesture.lens) core.turntable(g.mx - gesture.mx, g.my - gesture.my, s[0], s[1]); else core.pan(g.mx - gesture.mx, g.my - gesture.my, s[0], s[1]);
      var da = g.ang - gesture.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      var tw = gesture.tw + da, want = Math.abs(tw) > TW_DEAD ? tw - (tw > 0 ? TW_DEAD : -TW_DEAD) : 0;   // the twist rolls only past the dead zone
      if (want !== gesture.rolled) core.rollBy(-(want - gesture.rolled));
      g.lens = gesture.lens; g.tw = tw; g.rolled = want; g.twMax = Math.max(gesture.twMax, Math.abs(tw)); g.pending = false; gesture = g;
    }
    function onUp(e) {
      var pt = ptrs[e.pointerId]; if (!pt) return;
      if (gesture && gesture.pending) applyGesture();   // a move still waiting for its frame is applied before the finger goes
      delete ptrs[e.pointerId];
      var n = Object.keys(ptrs).length, p = local(e);
      if (gesture) { if (n < 2) { if (gesture.twMax <= TW_KEEP) core.relevel = Math.max(core.relevel, 3); gesture = null; drag = null; } return; }   // v5: an unmeant twist eases level (until it is)
      if (!drag || drag.id !== e.pointerId) return;
      var d = drag, t = now(), s = vp(); drag = null;
      var travel = Math.hypot(p[0] - pt.x0, p[1] - pt.y0);
      if (travel <= (pt.type === 'touch' ? 10 : 6) && t - d.t0 < 600) {   // a click or a tap
        var touch = pt.type === 'touch' || pt.type === 'pen', win = touch ? (opts.dblMsTouch || 450) : (opts.dblMs || 500), near = touch ? 36 : 20;
        if (lastTap && pt.t0 - lastTap.t < win && Math.hypot(p[0] - lastTap.x, p[1] - lastTap.y) < near) { var first = lastTap.id; lastTap = null; if (hooks.doubleTap) hooks.doubleTap(p[0], p[1], e, first); }
        else { lastTap = { t: t, x: p[0], y: p[1], id: null, touch: touch, win: win }; var got = hooks.tap ? hooks.tap(p[0], p[1], e) : null; lastTap.id = got == null ? null : got; }
        return;
      }
      if (e.type !== 'pointercancel' && (p[0] !== d.x || p[1] !== d.y)) {   // v5: the pointerup's own move (it was dropped)
        var ux = p[0] - d.x, uy = p[1] - d.y; samples.push({ t: stamp(e), x: p[0], y: p[1] }); core.dragT = stamp(e); apply(d.kind, ux, uy);
      }
      var v = releaseVelocity(e); core.fling(d.kind, v[0], v[1], s[0], s[1], core.dragT);
    }
    function onWheel(e) {
      if (opts.ignore && opts.ignore(e)) return;
      e.preventDefault(); input('wheel');
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp()[1] : 1), p = local(e), s = vp();
      var X = hooks.zoomAnchor ? hooks.zoomAnchor(p[0], p[1], dy) : null; if (!X) X = core.pointAtPivotDepth(p[0], p[1], s[0], s[1]);
      core.zoomTo(X, clamp(dy, -240, 240) * (opts.wheelGain || 0.0016));
    }
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hooks.keysEnabled && !hooks.keysEnabled(e)) return;
      var k = e.key, st = opts.keyStep || 0.2618, s = vp();
      if (!/^(Arrow(Left|Right|Up|Down)|\+|=|-|_|0)$/.test(k)) return;
      input('key'); e.preventDefault();   // first: the input hook stops a flight or a tour, so it must not cancel the reset's own flight below
      var ar = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
      if (ar && e.repeat) core.keyHold(ar[0], ar[1]);   // v5: a held key turns steadily
      else if (ar) core.orbitKey(ar[0] * st, ar[1] * st * 0.6);
      else if (k === '+' || k === '=') core.zoomTo(hooks.zoomAnchor ? hooks.zoomAnchor(s[0] / 2, s[1] / 2) : core.pivot, -0.35);
      else if (k === '-' || k === '_') core.zoomTo(hooks.zoomAnchor ? hooks.zoomAnchor(s[0] / 2, s[1] / 2) : core.pivot, 0.35);
      else if (k === '0') { if (hooks.reset) hooks.reset(); }
    }
    function onKeyUp(e) { if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) core.keyRelease(); }
    function onCtx(e) { e.preventDefault(); }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('contextmenu', onCtx);
    var keyEl = opts.keyTarget || (typeof document !== 'undefined' ? document : null); if (keyEl) { keyEl.addEventListener('keydown', onKey); keyEl.addEventListener('keyup', onKeyUp); }
    return { core: core, detach: function () {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel); el.removeEventListener('contextmenu', onCtx); if (keyEl) { keyEl.removeEventListener('keydown', onKey); keyEl.removeEventListener('keyup', onKeyUp); }
    }, dragging: function () { return !!(drag || gesture); },
      flushGesture: function () { if (gesture && gesture.pending) applyGesture(); },   // v5: the page calls it first in its frame
      tapWindow: function () { var t = now(); return lastTap && t - lastTap.t < lastTap.win ? { id: lastTap.id, left: lastTap.win - (t - lastTap.t), touch: lastTap.touch } : null; } };
  }
  return { Core: Core, attach: attach, util: { add: add, sub: sub, mul: mul, dot: dot, cross: cross, len: len, norm: norm, lerp: lerp, qaa: qaa, qmul: qmul, qrot: qrot, qconj: qconj, lookQ: lookQ, qAngle: qAngle, smoother: smoother } };
}));
