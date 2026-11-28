// Exact references for the analytic ladder (tests/ladder.test.mjs). Each is the continuum solution of the model
// the solver discretises; the measured gap is the scheme's error at the stated grid.
import { G } from './swe.js';

/** Ritter (1892): dam break onto a dry bed, dam at x0, depth h0 upstream. */
export function ritter(x, t, h0, x0 = 0, g = G) {
  const c0 = Math.sqrt(g * h0), xi = (x - x0) / t;
  if (xi <= -c0) return { h: h0, u: 0 };
  if (xi >= 2 * c0) return { h: 0, u: 0 };
  const s = 2 * c0 - xi;
  return { h: (s * s) / (9 * g), u: (2 / 3) * (xi + c0) };
}

/**
 * Stoker (1957): dam break onto still water of depth hr. The middle state (hm, um) joins a rarefaction from hl
 * (um = 2 (cl - cm)) to a shock into hr (Rankine-Hugoniot: um = (hm - hr) sqrt(g/2 (hm + hr) / (hm hr))).
 * Solved by bisection; returns the state at (x, t) and the structure (shock speed, middle state).
 */
export function stokerStructure(hl, hr, g = G) {
  const cl = Math.sqrt(g * hl);
  const f = (hm) => 2 * (cl - Math.sqrt(g * hm)) - (hm - hr) * Math.sqrt((g / 2) * (hm + hr) / (hm * hr));
  let lo = hr, hi = hl;
  for (let k = 0; k < 200; k++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
  const hm = 0.5 * (lo + hi), cm = Math.sqrt(g * hm), um = 2 * (cl - cm);
  const s = (hm * um) / (hm - hr);
  return { hm, um, cm, cl, shock: s };
}
export function stoker(x, t, hl, hr, x0 = 0, g = G, st = stokerStructure(hl, hr, g)) {
  const xi = (x - x0) / t;
  if (xi <= -st.cl) return { h: hl, u: 0 };
  if (xi <= st.um - st.cm) { const s = 2 * st.cl - xi; return { h: (s * s) / (9 * g), u: (2 / 3) * (xi + st.cl) }; }
  if (xi <= st.shock) return { h: st.hm, u: st.um };
  return { h: hr, u: 0 };
}

/**
 * Thacker (1981), planar surface in a paraboloid (SWASHES 4.2.2): bed z = -h0 (1 - r^2/a^2) about (cx, cy);
 * h = max(0, eta h0/a^2 (2 x' cos wt + 2 y' sin wt - eta) - z), u = -eta w sin wt, v = eta w cos wt,
 * w = sqrt(2 g h0)/a. The wet region is a disc of radius a whose centre is (cx + eta cos wt, cy + eta sin wt).
 */
export function thackerBed(x, y, p) { const dx = x - p.cx, dy = y - p.cy; return -p.h0 * (1 - (dx * dx + dy * dy) / (p.a * p.a)); }
export function thackerOmega(p, g = G) { return Math.sqrt(2 * g * p.h0) / p.a; }
export function thacker(x, y, t, p, g = G) {
  const w = thackerOmega(p, g), c = Math.cos(w * t), s = Math.sin(w * t);
  const dx = x - p.cx, dy = y - p.cy;
  const h = Math.max(0, (p.eta * p.h0) / (p.a * p.a) * (2 * dx * c + 2 * dy * s - p.eta) - thackerBed(x, y, p));
  return { h, u: h > 0 ? -p.eta * w * s : 0, v: h > 0 ? p.eta * w * c : 0, cx: p.cx + p.eta * c, cy: p.cy + p.eta * s };
}

/** Manning normal depth in a wide channel: q = (1/n) h^(5/3) sqrt(S)  =>  h = (q n / sqrt(S))^(3/5). */
export function manningNormalDepth(q, n, slope) { return Math.pow((q * n) / Math.sqrt(slope), 0.6); }

/**
 * Two tanks of plan areas A1, A2 joined by an orifice (area a, coefficient cd): the level difference D obeys
 * dD/dt = -cd a sqrt(2 g D) (1/A1 + 1/A2), so sqrt(D) = sqrt(D0) - cd a sqrt(2 g) (1/A1 + 1/A2) t / 2.
 */
export function orificeDrain(D0, t, { cd, a, A1, A2 }, g = G) {
  const r = Math.sqrt(D0) - (cd * a * Math.sqrt(2 * g) * (1 / A1 + 1 / A2) * t) / 2;
  return r > 0 ? r * r : 0;
}
