/* Screen-space picking for Gobbler v4: project every drawn star with the camera pose the page already knows, bucket the screen
 * points in a grid, answer "nearest star to the pointer within R px". No scene nodes, no per-star sensors, no DOM.
 * Measured on the Deep graph (docs/v4/mock/bench/pick_views.js): project + bucket ~19 us, query ~0.5 us for 2,476 stars.
 *
 *   var idx = new Pick.Index(nodes);          // nodes[i].xyz = [x,y,z], nodes[i].tier = 1|2|3
 *   idx.update({pos:[x,y,z], ori:[ax,ay,az,angle], fov}, W, H);
 *   idx.pick(x, y, {radius:30, all:false})    // -> {i, d, cands:[{i,d}, ...]} or null
 * fov is X3D fieldOfView (applies to the smaller screen side, like X_ITE): f = (min(W,H)/2) / tan(fov/2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Pick = factory();
})(this, function () {
  'use strict';
  var CELL = 32, NEAR = 0.05, LOD_ON = 10, LOD_OFF = 12, LOD_MIN_STARS = 30, LOD_SAMPLE = 120, LOD_EVERY = 4, CAND_PX = 12;

  function rot(ax) {                  /* axis-angle -> row-major 3x3 */
    var x = ax[0], y = ax[1], z = ax[2], a = ax[3], l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    var c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }

  function Index(nodes) {
    var N = this.N = nodes.length, i;
    this.xyz = new Float32Array(N * 3); this.tier = new Uint8Array(N);
    for (i = 0; i < N; i++) { var p = nodes[i].xyz || [0, 0, 0]; this.xyz[3 * i] = p[0]; this.xyz[3 * i + 1] = p[1]; this.xyz[3 * i + 2] = p[2]; this.tier[i] = nodes[i].tier || 2; }
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.depth = new Float32Array(N);
    this.vis = new Int32Array(N); this.nvis = 0; this.stamp = new Uint32Array(N); this.gen = 1;           /* stamp 0 = never seen, so nothing is visible before the first update */
    this.cellOf = new Int32Array(N); this.items = new Int32Array(N);
    this.W = 0; this.H = 0; this.gw = 0; this.gh = 0; this.cellStart = new Int32Array(1); this._fill = null;
    this.lodCore = false; this.medianGap = Infinity; this._lodAge = 0;
  }

  Index.prototype.update = function (cam, W, H, forceLod) {
    if (forceLod) this._lodAge = 0;
    var R = rot(cam.ori), f = (Math.min(W, H) / 2) / Math.tan(cam.fov / 2), px = cam.pos[0], py = cam.pos[1], pz = cam.pos[2];
    this.gen++; this.cam = { R: R, f: f, px: px, py: py, pz: pz };
    var xyz = this.xyz, sx = this.sx, sy = this.sy, dp = this.depth, vis = this.vis, n = 0, i;
    var r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    var gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL), cells = gw * gh;
    if (this.cellStart.length !== cells + 1) this.cellStart = new Int32Array(cells + 1); else this.cellStart.fill(0);
    var cs = this.cellStart, cellOf = this.cellOf;
    for (i = 0; i < this.N; i++) {
      var dx = xyz[3 * i] - px, dy = xyz[3 * i + 1] - py, dz = xyz[3 * i + 2] - pz;
      var cz = r2 * dx + r5 * dy + r8 * dz;                    /* camera space = R^T d; the camera looks down -z */
      if (cz >= -NEAR) continue;
      var cx = r0 * dx + r3 * dy + r6 * dz, cy = r1 * dx + r4 * dy + r7 * dz, k = f / -cz;
      var X = W / 2 + cx * k, Y = H / 2 - cy * k;
      if (!(X >= 0 && Y >= 0 && X < W && Y < H)) continue;      /* also drops NaN */
      sx[i] = X; sy[i] = Y; dp[i] = -cz; vis[n++] = i; this.stamp[i] = this.gen;
      var c = ((Y / CELL) | 0) * gw + ((X / CELL) | 0); cellOf[i] = c; cs[c + 1]++;
    }
    for (i = 0; i < cells; i++) cs[i + 1] += cs[i];            /* counting sort of the visible stars into cells */
    var fill = this._fill; if (!fill || fill.length !== cells) fill = this._fill = new Int32Array(cells); else fill.fill(0);
    for (i = 0; i < n; i++) { var s = vis[i], cc = cellOf[s]; this.items[cs[cc] + fill[cc]++] = s; }
    this.W = W; this.H = H; this.gw = gw; this.gh = gh; this.nvis = n;
    var jump = this._prevN != null && Math.abs(n - this._prevN) > 0.25 * Math.max(n, this._prevN, 50);      /* a new view (UI toggle, resize, end of the intro): do not trust the old crowding */
    this._prevN = n; if (jump) this._lodAge = 0;
    if (this._lodAge++ % LOD_EVERY === 0) this._lod();         /* the sky changes slowly: re-measure every few updates */
    return n;
  };

  /* median nearest-neighbour gap on a sample of the visible stars; core-only hover switches on below LOD_ON px and off above LOD_OFF */
  Index.prototype._lod = function () {
    var n = this.nvis;
    if (n < LOD_MIN_STARS) { this.medianGap = Infinity; this.lodCore = false; return; }
    var step = Math.max(1, Math.ceil(n / LOD_SAMPLE)), gaps = [], k;
    for (k = 0; k < n; k += step) gaps.push(this._nn(this.vis[k]));
    gaps.sort(function (a, b) { return a - b; });
    this.medianGap = gaps[gaps.length >> 1];
    if (this.lodCore) { if (this.medianGap > LOD_OFF) this.lodCore = false; } else if (this.medianGap < LOD_ON) this.lodCore = true;
  };
  Index.prototype._nn = function (s) {
    var x = this.sx[s], y = this.sy[s], cx = (x / CELL) | 0, cy = (y / CELL) | 0, gw = this.gw, gh = this.gh, cs = this.cellStart, items = this.items, sxs = this.sx, sys = this.sy;
    for (var reach = 1; reach <= 2; reach++) {                     /* 3x3 cells first (>= 32 px guaranteed), 5x5 only when that is empty */
      var best = 1e18;
      for (var v = Math.max(0, cy - reach); v <= Math.min(gh - 1, cy + reach); v++) for (var u = Math.max(0, cx - reach); u <= Math.min(gw - 1, cx + reach); u++) {
        var c = v * gw + u;
        for (var j = cs[c]; j < cs[c + 1]; j++) { var o = items[j]; if (o === s) continue; var dx = sxs[o] - x, dy = sys[o] - y, d = dx * dx + dy * dy; if (d < best) best = d; }
      }
      if (best < 1e18) return Math.sqrt(best);
    }
    return 2 * CELL;
  };

  /* every eligible star within r px of (x,y), nearest first (distance only; depth breaks ties) */
  Index.prototype.near = function (x, y, r, all) {
    var out = [];
    if (!(x > -r && y > -r && x < this.W + r && y < this.H + r)) return out;
    var cx0 = Math.max(0, ((x - r) / CELL) | 0), cx1 = Math.min(this.gw - 1, ((x + r) / CELL) | 0), cy0 = Math.max(0, ((y - r) / CELL) | 0), cy1 = Math.min(this.gh - 1, ((y + r) / CELL) | 0);
    var core = this.lodCore && !all, r2 = r * r, cs = this.cellStart, items = this.items;
    for (var v = cy0; v <= cy1; v++) for (var u = cx0; u <= cx1; u++) {
      var c = v * this.gw + u;
      for (var j = cs[c]; j < cs[c + 1]; j++) {
        var s = items[j]; if (core && this.tier[s] !== 1) continue;
        var dx = this.sx[s] - x, dy = this.sy[s] - y, d2 = dx * dx + dy * dy;
        if (d2 <= r2) out.push({ i: s, d: Math.sqrt(d2), z: this.depth[s] });
      }
    }
    out.sort(function (a, b) { return (a.d - b.d) || (a.z - b.z) || (a.i - b.i); });
    return out;
  };
  /* candidates for cycling are the eligible stars within CAND_PX of the snapped star (the "+k" in the tooltip) */
  Index.prototype.pick = function (x, y, o) {
    o = o || {};
    var list = this.near(x, y, o.radius == null ? 30 : o.radius, !!o.all);
    if (!list.length) return null;
    var head = list[0], sx = this.sx, sy = this.sy;
    var cands = list.filter(function (c) { return Math.hypot(sx[c.i] - sx[head.i], sy[c.i] - sy[head.i]) <= CAND_PX; });
    return { i: head.i, d: head.d, cands: cands };
  };
  /* screen position of any node, on screen or not (null only when it is behind the camera); used to rasterise tethers for the fallback density */
  Index.prototype.proj = function (i, out) {
    var c = this.cam; if (!c || i < 0 || i >= this.N) return null;
    var dx = this.xyz[3 * i] - c.px, dy = this.xyz[3 * i + 1] - c.py, dz = this.xyz[3 * i + 2] - c.pz, R = c.R, cz = R[2] * dx + R[5] * dy + R[8] * dz;
    if (cz >= -NEAR) return null; var k = c.f / -cz; out = out || {};
    out.x = this.W / 2 + (R[0] * dx + R[3] * dy + R[6] * dz) * k; out.y = this.H / 2 - (R[1] * dx + R[4] * dy + R[7] * dz) * k; return out;
  };
  Index.prototype.isVisible = function (i) { return this.stamp[i] === this.gen; };
  Index.prototype.screen = function (i) { return this.isVisible(i) ? { x: this.sx[i], y: this.sy[i], depth: this.depth[i], visible: true } : { x: NaN, y: NaN, depth: NaN, visible: false }; };

  return { Index: Index, rot: rot, CELL: CELL, LOD_ON: LOD_ON, LOD_OFF: LOD_OFF, CAND_PX: CAND_PX };
});
