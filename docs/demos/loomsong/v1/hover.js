/* Loomsong hover: what the pointer rests on, read through the world's own TouchSensors (no Script nodes).
 *
 * The page listens to each sensor's hitPoint_changed and isOver through SAI, turns the hit into a place on the machine, and looks the place up in the score card's tables
 * (data/<piece>.json: the hole rectangles, the pins, the weave rows, the tile rows). The card then names the note: pitch, instrument, bar, beat, who wrote it, its id.
 *
 *   Ode      the tapestry    hit point -> cell -> the cell's thread -> the note that owns the cell (the shader's own integer hash picks the owner)
 *            the card chain  hit point in ribbon metres -> the hole -> the note
 *   Turca    the pins        hit point in the barrel's own frame -> lane and angle -> the pin -> its note head (and how many times it sounds)
 *            the floor       hit point -> sector (circle of fifths) and ring (octave) -> the tile; if a note is lighting it now, that note
 *
 * Shown in Learn mode only (ui.hover decides). Plain script. Exposes window.LoomHover.
 */
(function (global) {
  'use strict';
  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }

  /** The tapestry shader's owner pick (hash2u in tapestry_fs.glsl), 32-bit wrap-around arithmetic: the same numbers on every machine. */
  function hash2u(x, y) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function Hover(app) {
    this.app = app; this.ui = null; this.meta = null; this.px = 0; this.py = 0; this.down = false; this.cur = null; this.lastShow = 0;
    this.hits = 0;                       // how many times a sensor has reported a hit and the card has been updated for it: the hover test waits on this, so it never reads a card that is not for the place it aimed at
    this.pixels = null; this.cellsW = 0;
    var self = this, host = app.host;
    host.addEventListener('pointermove', function (e) { self.px = e.clientX; self.py = e.clientY; }, true);
    host.addEventListener('pointerdown', function () { self.down = true; self.clear(); }, true);
    var up = function () { self.down = false; };
    host.addEventListener('pointerup', up, true); host.addEventListener('pointercancel', up, true);
    app.on('frame', function (t, perf) { if (self.cur && perf - self.lastShow > 120) self.refresh(); });
  }

  Hover.prototype.attach = function (scene, meta) {
    var self = this, m = (this.meta = meta).map, id = this.app.piece.id;
    this.cur = null; this.pixels = null;
    // X_ITE picks on the GPU, so a faint light shaft in front of the tapestry still hides it from the pointer: the world names its effect shapes and the page lets the pointer through them
    // (Shape.pointerEvents is X3D 4.1; the worlds are 4.0 and stay valid as they are)
    (m.intangible || []).forEach(function (name) {
      try { scene.getNamedNode(name).pointerEvents = false; } catch (e) { global.console.warn('hover: ' + name + ' stays pickable: ' + e); }
    });
    var sense = function (def, fn) {
      var s = null;
      try { s = scene.getNamedNode(def); } catch (e) { s = null; }
      if (!s) return;
      s.addFieldCallback('loom-hover', 'hitPoint_changed', function (p) { self.cur = { fn: fn, p: { x: p.x, y: p.y, z: p.z } }; self.refresh(); self.hits++; });
      s.addFieldCallback('loom-hover', 'isOver', function (on) { if (!on) self.clear(); });
    };
    if (id === 'ode') {
      var im = scene.getNamedNode('Tex_cells').image;
      this.pixels = im.array; this.cellsW = im.width;
      sense('HoverTap', function (p) { return self.tapestry(p, m); });
      sense('HoverBelt', function (p) { return self.belt(p, m); });
    } else if (id === 'turca') {
      sense('HoverPins', function (p) { return self.pins(p, m); });
      sense('HoverTiles', function (p) { return self.tiles(p, m); });
    }
  };

  Hover.prototype.refresh = function () {
    if (!this.cur || this.down || !this.ui) return;
    this.lastShow = global.performance.now();
    var info = null;
    try { info = this.cur.fn(this.cur.p); } catch (e) { info = null; global.console.error('hover: ' + e); }
    this.ui.hover(info, this.px, this.py);
  };

  Hover.prototype.clear = function () { this.cur = null; if (this.ui) this.ui.hover(null, 0, 0); };

  Hover.prototype.cell = function (col, row) {
    var v = this.pixels[row * this.cellsW + Math.floor(col / 3)], c = col % 3;
    return (v >>> (24 - 8 * c)) & 255;
  };

  Hover.prototype.tapestry = function (p, m) {
    var tp = m.tap, col = clamp(Math.floor((p.x - tp.x0) / tp.w * tp.cols), 0, tp.cols - 1), row = clamp(Math.floor((tp.top - p.y) / tp.h * tp.rows), 0, tp.rows - 1);
    var code = this.cell(col, row) & 7;
    if (!code) return { what: 'tapestry', line1: 'bare warp', line2: 'no thread is laid here', line3: 'cell ' + col + ',' + row };
    var L = code - 1, layer = m.layers[L].name, sw = Math.min(L, 3), t0 = m.sweep[0][sw], t1 = m.sweep[1][sw];
    var tw = t0 + (row + 0.5) / tp.rows * (t1 - t0), t = this.app.t;
    if (t < tw) return { what: layer + ' thread', line1: 'not yet woven', line2: 'laid at ' + fmt(tw) + ' by statement ' + m.layers[L].section, line3: 'cell ' + col + ',' + row };
    var ids = m.weave[L * tp.rows + row];
    if (!ids || !ids.length) return { what: layer + ' thread', line1: 'woven', line2: 'no note sounded as this row was laid', line3: 'cell ' + col + ',' + row };
    return this.ui.noteInfo(ids[hash2u(col, row) % ids.length], layer + ' thread', 'cell ' + col + ',' + row);
  };

  Hover.prototype.belt = function (p, m) {
    var R = m.hole_rects, best = -1, bd = 1e9;
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      if (p.x < r[0] - 0.03 || p.x > r[1] + 0.03) continue;
      var dy = Math.abs(p.y - r[2]);
      if (dy > 0.06) continue;
      var dx = p.x < r[0] ? r[0] - p.x : (p.x > r[1] ? p.x - r[1] : 0), d = dy * dy + dx * dx;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) return this.ui.noteInfo(best, 'hole in the card chain', 'lane ' + m.lanes[R[best][3]]);
    var lane = clamp(Math.floor((1 - p.y) / (2 / m.lanes.length)), 0, m.lanes.length - 1);
    return { what: 'card chain', line1: m.lanes[lane] + ' lane', line2: 'beat ' + (Math.floor(p.x / m.card_p) + 1) + ' of the piece; no hole here' };
  };

  Hover.prototype.pins = function (p, m) {
    var psi = Math.atan2(p.y, p.z);
    if (psi < 0) psi += TAU;
    var tolA = 0.006 / m.barrel_r, best = -1, bd = 1e9, P = m.pins;
    for (var i = 0; i < P.length; i++) {
      var q = P[i], dx = Math.abs(p.x - q.x);
      if (dx > m.pin_w / 2 + 0.006) continue;
      var a = (((psi - q.th) % TAU) + TAU) % TAU;
      var da = a <= q.dp ? 0 : Math.min(a - q.dp, TAU - a);
      if (da > tolA) continue;
      var d = dx * dx + da * da * m.barrel_r * m.barrel_r;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    var pin = P[best], notes = pin.notes, N = this.meta.notes, t = this.app.t, pick = notes[0], gap = 1e9;
    for (var k = 0; k < notes.length; k++) { var g = Math.abs(N[notes[k]][3] - t); if (g < gap) { gap = g; pick = notes[k]; } }
    return this.ui.noteInfo(pick, 'pin on band ' + pin.band, 'head ' + pin.src + ', sounds ' + notes.length + (notes.length === 1 ? ' time' : ' times'));
  };

  Hover.prototype.tiles = function (p, m) {
    var f = m.floor, r = Math.hypot(p.x, p.z);
    if (r < f.r0 || r > f.r1) return null;
    var a = Math.atan2(p.x, -p.z);
    if (a < 0) a += TAU;
    var sector = Math.round(a / (TAU / f.sectors)) % f.sectors, ring = clamp(Math.floor((r - f.r0) / ((f.r1 - f.r0) / f.rings)), 0, f.rings - 1);
    var pc = (sector * 7) % 12, ids = m.tiles[ring * f.sectors + sector] || [], N = this.meta.notes, t = this.app.t;
    for (var k = 0; k < ids.length; k++) {
      var n = N[ids[k]];
      if (n[3] <= t && t <= n[3] + n[4]) return this.ui.noteInfo(ids[k], 'floor tile, lit now', PC[pc] + ' in octave ' + (ring + 2) + ', sector ' + (sector + 1) + ' of the circle of fifths');
    }
    return { what: 'floor tile', line1: PC[pc] + ' · octave ' + (ring + 2), line2: 'sector ' + (sector + 1) + ' of 12 on the circle of fifths', line3: ids.length + ' notes of the piece light this tile' };
  };

  global.LoomHover = Hover;
  global.LoomHash2u = hash2u;
})(window);
