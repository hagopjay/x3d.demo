/* lens.js: the CPU mirror of the Dynasty Loom hyperbolic lens (nav/lib/lens_glsl.py holds the GLSL and the Python twin). No dependencies;
   nothing evaluated from strings (no eval, no Function constructor). In a page it sets window.DynastyLens; under node it is a module.

   pocket p -> ball x = c g(|p|/R) p/|p|, g(s) = tanh(k s)/tanh(k) (k = 0: x = p c / R);  x' = (-a) (+) x (Mobius addition);  p' = x' R;
   drawn at mix(p, p', st.mix). A state is { a: [x, y, z] (the focus, ball units), mix: 0..1, c, k, R, h0, h1, floor, rim: [r0, r1] }.
   The page places every node the shaders do not draw (HTML labels, the portrait plate, the seed and the bead Transforms) with map() and
   scale(), and picks in lens mode by projecting map() of each person's pick points. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DynastyLens = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function neg(a) { return [-a[0], -a[1], -a[2]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function atanh(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }
  function smooth(e0, e1, x) { var t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }

  // u (+) v = ((1 + 2<u,v> + |v|^2) u + (1 - |u|^2) v) / (1 + 2<u,v> + |u|^2 |v|^2)
  function mobAdd(u, v) {
    var uv = dot(u, v), uu = dot(u, u), vv = dot(v, v), k1 = 1 + 2 * uv + vv, k2 = 1 - uu, den = 1 + 2 * uv + uu * vv;
    return [(k1 * u[0] + k2 * v[0]) / den, (k1 * u[1] + k2 * v[1]) / den, (k1 * u[2] + k2 * v[2]) / den];
  }
  function mobScalar(t, v) { var n = len(v); if (n < 1e-15) return [0, 0, 0]; return mul(v, Math.tanh(t * atanh(Math.min(n, 1 - 1e-15))) / n); }
  // the geodesic from a0 (t = 0) to a1 (t = 1): a0 (+) (t (x) ((-a0) (+) a1)); from the centre it is tanh(t artanh|a1|) a1/|a1|
  function geodesic(a0, a1, t) { if (t >= 1) return a1.slice(); if (t <= 0) return a0.slice(); return mobAdd(a0, mobScalar(t, mobAdd(neg(a0), a1))); }
  function clampBall(a, rmax) { var n = len(a); return n > rmax ? mul(a, rmax / n) : a.slice(); }

  function rad(s, k) { return k > 1e-4 ? Math.tanh(k * s) / Math.tanh(k) : s; }   // the radial profile g(s), g(1) = 1
  function radInv(r, k) { return k > 1e-4 ? atanh(Math.min(r * Math.tanh(k), 1 - 1e-15)) / k : r; }
  function ratio(s, k) { return k > 1e-4 ? (s < 1e-9 ? k / Math.tanh(k) : rad(s, k) / s) : 1; }   // g(s)/s: the stretch across the radius
  function toBall(p, st) { return mul(p, st.c * ratio(len(p) / st.R, st.k || 0) / st.R); }
  function map(p, st) {
    if (!(st.mix > 0)) return p.slice();
    var y = mul(mobAdd(neg(st.a), toBall(p, st)), st.R), m = st.mix;
    return [p[0] + (y[0] - p[0]) * m, p[1] + (y[1] - p[1]) * m, p[2] + (y[2] - p[2]) * m];
  }
  // the inverse at mix 1: a drawn point back to its pocket point (x = a (+) x')
  function unmap(q, st) {
    var x = mobAdd(st.a, mul(q, 1 / st.R)), k = st.k || 0; if (!(k > 1e-4)) return mul(x, st.R / st.c);
    var n = len(x); return n < 1e-15 ? [0, 0, 0] : mul(x, st.R * radInv(n / st.c, k) / n);
  }
  function scale(p, st) {
    if (!(st.mix > 0)) return 1;
    var x = toBall(p, st), aa = dot(st.a, st.a), lam = (1 - aa) / Math.max(1 - 2 * dot(st.a, x) + aa * dot(x, x), 1e-6);
    return 1 + (st.c * ratio(len(p) / st.R, st.k || 0) * lam - 1) * st.mix;
  }
  function dist(p, st) { return 2 * atanh(Math.min(len(mobAdd(neg(st.a), toBall(p, st))), 0.999999)); }
  function fade(p, st) {
    if (!(st.mix > 0)) return 1;
    var r = Math.min(len(mobAdd(neg(st.a), toBall(p, st))), 0.999999), d = 2 * atanh(r), rim = st.rim || [0.975, 0.997];
    var f = (1 + (st.floor - 1) * smooth(st.h0, st.h1, d)) * (1 - smooth(rim[0], rim[1], r));
    return 1 + (f - 1) * st.mix;
  }
  // the time shell |p| = rk under the lens: { c: centre, r: radius } (pocket units), exact at mix 0 and 1
  function sphere(rk, st) {
    var m = st.mix > 0 ? st.mix : 0, s = st.c * rad(rk / st.R, st.k || 0), al = len(st.a), ah = al > 1e-9 ? mul(st.a, 1 / al) : [0, 0, 1];
    var e1 = (s - al) / (1 - al * s), e2 = (-s - al) / (1 + al * s);
    return { c: mul(ah, 0.5 * (e1 + e2) * st.R * m), r: rk + (0.5 * (e1 - e2) * st.R - rk) * m };
  }
  // the focus that puts pocket point p at the centre
  function focusOf(p, st, amax) { return clampBall(toBall(p, st), amax == null ? 0.9 : amax); }
  // H3 drag: the content near the centre follows a view-plane displacement d (ball units): a <- a (+) (-d)
  function drag(a, d, amax) { return clampBall(mobAdd(a, neg(d)), amax == null ? 0.9 : amax); }
  function state(o) {
    o = o || {};
    return { a: (o.a || [0, 0, 0]).slice(), mix: o.mix || 0, c: o.c == null ? 0.9 : o.c, k: o.k || 0, R: o.R == null ? 1.1 : o.R, h0: o.h0 == null ? 1.7 : o.h0,
      h1: o.h1 == null ? 4.6 : o.h1, floor: o.floor == null ? 0.16 : o.floor, rim: (o.rim || [0.975, 0.997]).slice() };
  }
  return { mobAdd: mobAdd, mobScalar: mobScalar, geodesic: geodesic, clampBall: clampBall, toBall: toBall, map: map, unmap: unmap, scale: scale,
    dist: dist, fade: fade, sphere: sphere, focusOf: focusOf, drag: drag, state: state, neg: neg };
}));
