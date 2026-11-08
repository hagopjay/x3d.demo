/* Where is the subject on screen? Two sources for Place.choose's density(x, y) -> 0..1 (x, y in CSS px of the viewport).
 *   fromLuma:  the rendered frame, read back once and down-scaled (what the mock did on the stills); the truth, costs one GPU readback.
 *   fromStars / fromGraph: the projected stars (and tethers), no readback; the fallback when the readback is unavailable or all black.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Density = factory();
})(this, function () {
  'use strict';
  function blur3(g, w, h) {
    var b = new Float32Array(w * h), j, k, u, v, s, c;
    for (j = 0; j < h; j++) for (k = 0; k < w; k++) {
      s = 0; c = 0;
      for (v = -1; v <= 1; v++) for (u = -1; u <= 1; u++) { var xx = k + u, yy = j + v; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; c++; } }
      b[j * w + k] = s / c;
    }
    return b;
  }
  function sampler(b, w, h, kx, ky) {                 /* kx, ky: grid cells per px */
    return function (x, y) {
      var xx = Math.max(0, Math.min(w - 1, (x * kx) | 0)), yy = Math.max(0, Math.min(h - 1, (y * ky) | 0));
      return b[yy * w + xx];
    };
  }
  /* rgba: Uint8ClampedArray of a w x h down-scaled frame. Luminance below 4% is background, above 46% is full subject. */
  function fromLuma(rgba, w, h, W, H) {
    var g = new Float32Array(w * h), i, lum = 0;
    for (i = 0; i < w * h; i++) { var l = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765; g[i] = Math.max(0, Math.min(1, (l - 0.04) / 0.42)); lum += l; }
    var f = sampler(blur3(g, w, h), w, h, w / W, h / H);
    f.meanLuma = lum / (w * h);                     /* ~0 means the readback came back black: the caller falls back to fromStars */
    return f;
  }
  /* xs, ys: screen positions of the visible stars; n of them. A 48 px cell with 3 or more stars is full subject. */
  function fromStars(xs, ys, vis, n, W, H, cell) {
    cell = cell || 48; var w = Math.ceil(W / cell), h = Math.ceil(H / cell), g = new Float32Array(w * h), i;
    for (i = 0; i < n; i++) { var s = vis[i], c = ((ys[s] / cell) | 0) * w + ((xs[s] / cell) | 0); if (c >= 0 && c < g.length) g[c] += 1 / 3; }
    for (i = 0; i < g.length; i++) if (g[i] > 1) g[i] = 1;
    return sampler(g, w, h, 1 / cell, 1 / cell);                    /* no blur: the card's own 8 x 8 sampling already averages over ~50 cells */
  }
  /* stars plus the tethers between them: segs is a flat [x0,y0,x1,y1, ...] in screen px (either end may be off screen). Normalised so the busiest tenth of the cells reads as full. Still a proxy: the bird's own mesh is not in the graph, so it cannot see the bird. */
  function fromGraph(xs, ys, vis, n, segs, W, H, cell) {
    cell = cell || 48; var w = Math.ceil(W / cell), h = Math.ceil(H / cell), g = new Float32Array(w * h), i, k;
    for (i = 0; i < n; i++) { var s = vis[i], c = ((ys[s] / cell) | 0) * w + ((xs[s] / cell) | 0); if (c >= 0 && c < g.length) g[c] += 1 / 3; }
    for (k = 0; k + 3 < segs.length; k += 4) {
      var x0 = segs[k], y0 = segs[k + 1], x1 = segs[k + 2], y1 = segs[k + 3], len = Math.hypot(x1 - x0, y1 - y0), steps = Math.min(400, Math.ceil(len / (cell / 2)) + 1);
      if (!(len < 1e5)) continue;
      for (i = 0; i <= steps; i++) { var X = x0 + (x1 - x0) * i / steps, Y = y0 + (y1 - y0) * i / steps; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; g[((Y / cell) | 0) * w + ((X / cell) | 0)] += 1 / 6; }
    }
    var nz = []; for (i = 0; i < g.length; i++) if (g[i] > 0) nz.push(g[i]);
    if (nz.length) { nz.sort(function (a, b) { return a - b; }); var ref = nz[Math.floor(nz.length * 0.9)] || 1, sc = 0.85 / ref; for (i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] * sc); }   /* relative: the busiest tenth of the cells is full */
    return sampler(g, w, h, 1 / cell, 1 / cell);
  }
  return { fromLuma: fromLuma, fromStars: fromStars, fromGraph: fromGraph };
});
