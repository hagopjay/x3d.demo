// The gate cases, exactly as tests/limits.json describes them. Each returns measurements; judging is done by
// tests/ and tools/ladder.mjs against the committed limits.

import { Sim, material, ELASTIC, SNOW, GRANULAR, G } from './mpm.js';
import { releaseAngle, pwave } from './referee.js';
import { snapshotX3D, resumeX3D } from '../x3d/snapshot.js';

const rad = (d) => (d * Math.PI) / 180;

export function disc({ twin = null, gravity = [0, 0], floor = false } = {}) {
  const dx = 0.02;
  const S = new Sim({ nx: 100, ny: 100, dx, dt: 1e-4, gravity, twin, walls: { bottom: floor ? 'sticky' : 'slip', top: 'slip' },
    materials: [material({ kind: ELASTIC, E: 1e5, nu: 0.3, rho: 400, label: 'jelly' })] });
  return S.addBlock(0.8, 0.8, 1.2, 1.2, 0, { vx: 0.5, vy: 0.2, spin: 2, cx: 1, cy: 1, inside: (x, y) => (x - 1) ** 2 + (y - 1) ** 2 < 0.04 });
}

export function momentumCase(twin = null, steps = 1000) {
  const S = disc({ twin });
  const a = S.momentum();
  for (let i = 0; i < steps; i++) S.step();
  const b = S.momentum(), P = Math.hypot(a.px, a.py);
  return { particles: S.n, steps, rel_linear: Math.max(Math.abs(b.px - a.px), Math.abs(b.py - a.py)) / P, rel_angular: Math.abs(b.L - a.L) / Math.abs(a.L) };
}

function energyRun(S, steps, every) {
  const e0 = S.energy().total;
  let worst = -Infinity;
  for (let i = 1; i <= steps; i++) { S.step(); if (i % every === 0) worst = Math.max(worst, (S.energy().total - e0) / Math.abs(e0)); }
  return { e0, max_rise_rel: worst, e_end: S.energy().total };
}

/** Granular column on a sticky floor (the repose case). */
export function column({ twin = null } = {}) {
  const dx = 0.0125, rho = 200;
  const S = new Sim({ nx: 160, ny: 40, dx, dt: 1.25e-4, twin, walls: { left: 'separate', right: 'separate', bottom: 'sticky', top: 'free' },
    materials: [material({ kind: GRANULAR, E: 1e5, nu: 0.3, rho, phi: 30, c: 0, label: 'dry granular' })] });
  // a one-cell bed of the same grains inside the floor's node rows carries the column's weight (see pwaveCase)
  S.addBlock(0.5, dx, 1.5, 2 * dx, 0);
  const y0 = 2 * dx;
  return S.addBlock(0.75, y0, 1.25, y0 + 0.25, 0);
}

export function energyCase(twin = null) {
  const a = energyRun(disc({ twin }), 1000, 20);
  const b = energyRun(column({ twin }), 6000, 100);
  return { disc: a, column: b, max_rise_rel: Math.max(a.max_rise_rel, b.max_rise_rel) };
}

/** Deposit flank angle: surface height per column, fitted between 20% and 80% of peak on each side. */
export function flankAngle(S, y0) {
  const { dx } = S, nb = S.nx, h = new Float64Array(nb);
  for (let p = 0; p < S.n; p++) { const b = Math.floor(S.x[p] / dx); if (b >= 0 && b < nb) h[b] = Math.max(h[b], S.y[p] - y0 + dx / 4); }
  let H = 0, ip = 0;
  for (let i = 0; i < nb; i++) if (h[i] > H) { H = h[i]; ip = i; }
  const fit = (lo, hi, dir) => {
    const xs = [], ys = [];
    for (let i = lo; i !== hi; i += dir) if (h[i] >= 0.2 * H && h[i] <= 0.8 * H) { xs.push((i + 0.5) * dx); ys.push(h[i]); }
    if (xs.length < 2) return null;
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
    return (Math.atan(Math.abs(sxy / sxx)) * 180) / Math.PI;
  };
  // walk outward from the peak's plateau on each side
  let l = ip; while (l > 0 && h[l - 1] >= 0.8 * H) l--;
  let r = ip; while (r < nb - 1 && h[r + 1] >= 0.8 * H) r++;
  const left = fit(l, -1, -1), right = fit(r, nb, 1);
  const both = [left, right].filter((v) => v != null);
  return { peak_m: H, left_deg: left, right_deg: right, mean_deg: both.length ? both.reduce((a, b) => a + b) / both.length : null, profile: Array.from(h, (v) => +v.toFixed(4)) };
}

export function reposeCase(twin = null, seconds = 1.5) {
  const S = column({ twin });
  const steps = Math.round(seconds / S.dt);
  for (let i = 0; i < steps; i++) S.step();
  const r = flankAngle(S, 2 * S.dx);
  let vmax = 0; for (let p = 0; p < S.n; p++) vmax = Math.max(vmax, Math.hypot(S.vx[p], S.vy[p]));
  return { ...r, seconds, max_speed_end: vmax };
}

export const SLOPE = {
  layers: [{ name: 'weak', rho: 200, h: 0.15 }, { name: 'slab', rho: 250, h: 0.6 }],
  weak: { kind: GRANULAR, E: 2e5, nu: 0.2, rho: 200, phi: 30, c: 250, label: 'weak layer' },
  slab: { kind: SNOW, E: 1e6, nu: 0.2, rho: 250, label: 'slab' },
};

/** The periodic infinite slope at theta degrees (gravity tilted, x downslope). */
export function slope(theta, { twin = null, strongWeak = false } = {}) {
  const dx = 0.05, nx = 16, ny = 24;
  const mats = [material(SLOPE.slab), material(strongWeak ? { ...SLOPE.slab, rho: SLOPE.weak.rho, label: 'weak layer with slab strength' } : SLOPE.weak)];
  const S = new Sim({ nx, ny, dx, dt: 2e-4, periodicX: true, twin, ramp: 0.4, materials: mats,
    walls: { bottom: 'sticky', top: 'free' }, gravity: [G * Math.sin(rad(theta)), -G * Math.cos(rad(theta))] });
  const y0 = 2 * dx, L = nx * dx;
  S.addBlock(0, dx, L, y0, 1); // the bed: one cell of weak-layer grains inside the sticky floor's node rows
  S.addBlock(0, y0, L, y0 + SLOPE.layers[0].h, 1);
  S.addBlock(0, y0 + SLOPE.layers[0].h, L, y0 + SLOPE.layers[0].h + SLOPE.layers[1].h, 0);
  return S;
}

export function slabSpeed(S) {
  let m = 0, mv = 0;
  for (let p = 0; p < S.n; p++) if (S.mat[p] === 0) { m += S.m[p]; mv += S.m[p] * S.vx[p]; }
  return mv / m;
}

/** Released when the slab's mean downslope speed at 1.2 s exceeds 0.01 m/s and is still rising over 0.2 s. */
export function slopeTrial(theta, opts = {}) {
  const S = slope(theta, opts);
  const n1 = Math.round(1.0 / S.dt), n2 = Math.round(1.2 / S.dt);
  let v1 = 0;
  for (let i = 1; i <= n2; i++) { S.step(); if (i === n1) v1 = slabSpeed(S); }
  const v2 = slabSpeed(S);
  return { theta, v_1s: v1, v_1_2s: v2, released: v2 > 0.01 && v2 > v1 };
}

export function infiniteSlopeCase({ twin = null, strongWeak = false, lo = 20, hi = 50, res = 0.25 } = {}) {
  const trials = [];
  const run = (th) => { const r = slopeTrial(th, { twin, strongWeak }); trials.push(r); return r.released; };
  if (!run(hi)) return { release_deg: null, trials, holds_at_deg: hi };
  if (run(lo)) return { release_deg: lo, trials, note: 'released at the low end' };
  while (hi - lo > res) { const m = 0.5 * (lo + hi); if (run(m)) hi = m; else lo = m; }
  return { release_deg: 0.5 * (lo + hi), bracket: [lo, hi], trials };
}

export function slopeReferees() {
  const base = { layers: SLOPE.layers, c: SLOPE.weak.c, phi: SLOPE.weak.phi };
  return { davis_deg: releaseAngle({ ...base, psi: 0 }), naive_deg: releaseAngle({ ...base, psi: SLOPE.weak.phi }) };
}

export function pwaveCase(twin = null) {
  const dx = 0.02, nx = 32, ny = 12, E = 1e5, nu = 0.3, rho = 400;
  const c = pwave(E, nu, rho), L = nx * dx, A = 1e-3 * c;
  const S = new Sim({ nx, ny, dx, dt: 2e-4, periodicX: true, twin, gravity: [0, 0], walls: { bottom: 'slip', top: 'slip' },
    materials: [material({ kind: ELASTIC, E, nu, rho, label: 'elastic' })] });
  // material runs into the wall node rows (y from dx to (ny - 1.5) dx), so the slip walls carry its edge traction;
  // ending it at the walls (2 dx .. (ny - 2) dx) left that traction unsupported and the column sloshed in y
  S.addBlock(0, dx, L, (ny - 1.5) * dx, 0);
  const k = (2 * Math.PI) / L;
  for (let p = 0; p < S.n; p++) { S.vx[p] = A * Math.sin(k * S.x[p]); S.c00[p] = A * k * Math.cos(k * S.x[p]); }
  const q = () => { let s = 0; for (let p = 0; p < S.n; p++) s += S.m[p] * S.vx[p] * Math.sin(k * S.x[p]); return s; };
  const T0 = L / c, steps = Math.round((3.2 * T0) / S.dt), zs = [];
  let prev = q(), tprev = 0;
  for (let i = 1; i <= steps; i++) {
    S.step();
    const cur = q();
    if (prev > 0 !== cur > 0) zs.push(tprev + (S.t - tprev) * (prev / (prev - cur)));
    prev = cur; tprev = S.t;
  }
  const half = zs.length > 1 ? (zs[zs.length - 1] - zs[0]) / (zs.length - 1) : null;
  const cm = half ? L / (2 * half) : null;
  return { c_ref: c, c_measured: cm, rel_err: cm ? Math.abs(cm / c - 1) : null, zero_crossings: zs.length };
}

export function determinismCase() {
  const run = (nudge) => { const S = slope(36); if (nudge) S.x[7] += 1e-12; for (let i = 0; i < 2000; i++) S.step(); return S.hash(); };
  const a = run(false), b = run(false), c = run(true);
  return { hash_a: a, hash_b: b, mismatch: a === b ? 0 : 1, twin_hash: c, twin_differs: c !== a };
}

export function resumeCase() {
  const whole = slope(36);
  for (let i = 0; i < 2000; i++) whole.step();
  const ref = whole.hash();
  const run = (opts) => {
    const S = slope(36);
    for (let i = 0; i < 1000; i++) S.step();
    const text = snapshotX3D(S, { ...opts, title: 'resume gate' });
    const R = resumeX3D(text);
    if (opts.skip) for (const f of opts.skip) R[f].fill(0);
    for (let i = 0; i < 1000; i++) R.step();
    return { hash: R.hash(), bytes: text.length };
  };
  const exact = run({}), f32 = run({ float32: true }), noC = run({ skip: ['c00', 'c01', 'c10', 'c11'] });
  return { reference: ref, resumed: exact.hash, mismatch: exact.hash === ref ? 0 : 1, snapshot_bytes: exact.bytes,
    float32_twin_differs: f32.hash !== ref, no_affine_twin_differs: noC.hash !== ref };
}
