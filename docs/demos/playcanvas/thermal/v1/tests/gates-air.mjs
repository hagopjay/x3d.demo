// Measurements for the air gates in tests/limits.json. Each function returns the measured numbers; the tests
// (tests/air.test.mjs) and the receipt tool (tools/receipt.mjs) judge them against the committed limits.
import { readFileSync } from 'node:fs';
import { createLBM } from '../src/sim/lbm.js';

export const LIMITS = JSON.parse(readFileSync(new URL('./limits.json', import.meta.url), 'utf8'));
const L = LIMITS.gates;

const relL2 = (a, b) => { let n = 0, d = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - b[i]) ** 2; d += b[i] ** 2; } return Math.sqrt(n / d); };
const column = (sim, i) => { const out = []; for (let j = 0; j < sim.ny; j++) out.push(sim.ux[i + j * sim.nx]); return out; };

export function poiseuille(tau, twin = false) {
  const H = 32, nu = (tau - 0.5) / 3, Fx = L.poiseuille.force;
  const sim = createLBM({ nx: 4, ny: H, nu, collision: 'mrt', smag: 0, force: [Fx, 0],
    bottom: { type: twin ? 'freeslip' : 'noslip' }, top: { type: twin ? 'freeslip' : 'noslip' } });
  const steps = Math.round((8 * H * H) / nu);
  sim.steps(steps);
  const u = column(sim, 0), ref = u.map((_, y) => (Fx / (2 * nu)) * (y + 0.5) * (H - 0.5 - y));
  return { tau, steps, rel_l2: relL2(u, ref) };
}

export function couette(twin = false) {
  const H = 32, tau = 0.8, nu = (tau - 0.5) / 3, U = 0.05;
  const sim = createLBM({ nx: 4, ny: H, nu, collision: 'mrt', smag: 0, top: { type: 'noslip', u: U }, wallFactor: twin ? 3 : 6 });
  const steps = Math.round((8 * H * H) / nu);
  sim.steps(steps);
  const u = column(sim, 0), ref = u.map((_, y) => (U * (y + 0.5)) / H);
  return { steps, rel_l2: relL2(u, ref) };
}

/**
 * Rayleigh-Benard: growth rate of the kinetic energy's square root over steps 10000..30000 after the seed.
 * The start is the conduction state: a 20000-step pre-run from uniform density, then the populations of two
 * consecutive steps averaged. The average removes the undamped period-2 (Nyquist) mode that the first steps excite
 * in a closed box with a non-uniform force (see docs/PHYSICS.md); then the seed is added to g at equilibrium.
 */
export function rbGrowth(Ra, sign = 1) {
  const H = 20, nx = 40, nu = 0.1, Pr = 0.71, kappa = nu / Pr, dT = 1;
  const G = (Ra * nu * kappa) / (dT * H ** 3);
  const sim = createLBM({
    nx, ny: H, nu, collision: 'mrt', smag: 0, thermal: true, kappa,
    ref: { T0: 0.5 - 0.5 / H, Gamma: -1 / H }, buoy: { G, mode: 'const', T0c: 0, sign },
    bottom: { type: 'noslip', T: 0.5 }, top: { type: 'noslip', T: -0.5 },
    init: (i, j) => ({ rho: 1, ux: 0, uy: 0, T: 0.5 - (j + 0.5) / H }),
  });
  sim.steps(20000);
  const fa = sim.f.slice(), ga = sim.g.slice();
  sim.step();
  const fs = sim.f.map((v, k) => 0.5 * (v + fa[k])), gs = sim.g.map((v, k) => 0.5 * (v + ga[k]));
  for (let c = 0; c < sim.n; c++) {
    const i = c % nx, j = (c / nx) | 0;
    const d = 1e-4 * Math.cos((2 * Math.PI * i) / nx) * Math.sin((Math.PI * (j + 0.5)) / H);
    for (let k = 0; k < 5; k++) gs[c * 5 + k] += (k === 0 ? 1 / 3 : 1 / 6) * d;
  }
  sim.setState(fs, gs);
  const ts = [], ys = [];
  for (let s = 1; s <= 30000; s++) {
    sim.step();
    if (s % 500 === 0) {
      let ke = 0; for (let c = 0; c < sim.n; c++) ke += sim.ux[c] ** 2 + sim.uy[c] ** 2;
      ts.push(s); ys.push(0.5 * Math.log(ke));
    }
  }
  const fit = (a, b) => {
    const X = [], Y = []; ts.forEach((t, k) => { if (t >= a && t <= b) { X.push(t); Y.push(ys[k]); } });
    const m = X.length, mt = X.reduce((p, q) => p + q) / m, my = Y.reduce((p, q) => p + q) / m;
    let sxy = 0, sxx = 0; for (let i = 0; i < m; i++) { sxy += (X[i] - mt) * (Y[i] - my); sxx += (X[i] - mt) ** 2; }
    return sxy / sxx;
  };
  // as written in limits.json: 10000..30000; changed after the first run (docs/PHYSICS.md): 2000..8000, because
  // Ra = 2000 grows by e^(6.8e-4 per step) and has saturated by step 13000
  return { Ra, sigma: fit(10000, 30000), sigma_early: fit(2000, 8000) };
}

export function rayleighBenard() {
  const g = L.rayleigh_benard_onset;
  const lo = rbGrowth(g.ra_below), hi = rbGrowth(g.ra_above), twin = rbGrowth(g.ra_above, -1);
  const est = (a, b) => lo.Ra + ((0 - a) * (hi.Ra - lo.Ra)) / (b - a);
  const raC = est(lo.sigma, hi.sigma), raC2 = est(lo.sigma_early, hi.sigma_early);
  return {
    as_written: { sigma_below: lo.sigma, sigma_above: hi.sigma, ra_c_estimate: raC, ra_c_rel_err: Math.abs(raC / 1707.76 - 1), twin_sigma_above: twin.sigma },
    window_2000_8000: { sigma_below: lo.sigma_early, sigma_above: hi.sigma_early, ra_c_estimate: raC2, ra_c_rel_err: Math.abs(raC2 / 1707.76 - 1), twin_sigma_above: twin.sigma_early },
  };
}

/** Lee waves behind an Agnesi hill (limits.json lee_wave). */
export function leeWave(twin = false) {
  const g = L.lee_wave;
  const nx = 400, ny = 128, U = 0.08, lam = g.lambda_ref_cells, N = (2 * Math.PI * U) / lam, nu = 3e-4 / 3 * 1;
  const h0 = 3, a = 5, x0 = 80, ground = 2;
  const Gamma = 0.01; const G = (N * N) / Gamma; // N^2 = G Gamma
  const solid = new Uint8Array(nx * ny), hgt = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    hgt[i] = ground + h0 / (1 + ((i - x0) / a) ** 2);
    for (let j = 0; j < ny; j++) if (j + 0.5 < hgt[i]) solid[i + j * nx] = 1;
  }
  const sponge = new Float64Array(nx * ny), uT = new Float64Array(ny).fill(U);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    if (i >= 340) s = Math.max(s, 0.05 * ((i - 340) / 60) ** 2);
    if (j >= 88) s = Math.max(s, 0.05 * ((j - 88) / 40) ** 2);
    sponge[i + j * nx] = s;
  }
  const sim = createLBM({
    nx, ny, solid, nu: 1e-4, collision: 'mrt', smag: 0.17, thermal: true, kappa: 2e-3,
    ref: { T0: 10, Gamma }, buoy: { G, mode: 'profile' },
    bottom: { type: 'noslip', T: 'ref' }, top: { type: 'freeslip', T: 'ref' }, solidT: 'ref',
    sponge, uTarget: uT, frozenT: twin,
    init: (i, j) => ({ rho: 1, ux: U, uy: 0, T: 10 + Gamma * j }),
  });
  void nu;
  sim.steps(g.steps);
  const rows = [20, 30].map((dz) => ground + dz);
  const out = rows.map((j) => {
    const w = []; for (let i = 100; i <= 300; i++) w.push(sim.uy[i + j * nx]);
    const ups = [];
    for (let k = 1; k < w.length; k++) if (w[k - 1] < 0 && w[k] >= 0) ups.push(100 + k - 1 + (-w[k - 1]) / (w[k] - w[k - 1]));
    const lambda = ups.length >= 2 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : null;
    const rms = Math.sqrt(w.reduce((s, v) => s + v * v, 0) / w.length);
    return { row_above_ground: j - ground, upcrossings: ups.length, lambda, rms, amp_ratio: rms / ((U * h0) / a) };
  });
  return { rows: out, maxU: sim.maxU() };
}

export function leeWavePass(r) {
  const g = L.lee_wave;
  return r.rows.every((x) => x.upcrossings >= g.min_upcrossings && x.lambda != null && Math.abs(x.lambda / g.lambda_ref_cells - 1) <= g.lambda_rel_max && x.amp_ratio >= g.amp_min_over_U_h0_a);
}

export function cavity(twin = false) {
  const g = L.lid_cavity_ghia;
  const N = 64, nx = N + 2, ny = N, U = 0.1, nu = (U * N) / 100;
  const solid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) { solid[j * nx] = 1; solid[nx - 1 + j * nx] = 1; }
  const sim = createLBM({ nx, ny, solid, nu, collision: 'mrt', smag: 0, top: { type: 'noslip', u: U }, wallFactor: twin ? 3 : 6 });
  sim.steps(30000);
  // centreline between fluid columns N/2 and N/2 + 1 (fluid columns are 1..N)
  const u = []; for (let j = 0; j < ny; j++) u.push((sim.ux[N / 2 + j * nx] + sim.ux[N / 2 + 1 + j * nx]) / (2 * U));
  let maxErr = 0;
  const pts = [];
  for (let k = 0; k < g.ghia_y.length; k++) {
    const y = g.ghia_y[k];
    if (y <= 0 || y >= 1) continue;
    const jf = y * N - 0.5, j0 = Math.max(0, Math.min(N - 2, Math.floor(jf))), t = jf - j0;
    const v = u[j0] * (1 - t) + u[j0 + 1] * t;
    const err = Math.abs(v - g.ghia_u[k]);
    pts.push([y, +v.toFixed(5), g.ghia_u[k]]);
    if (!(err <= maxErr)) maxErr = err;
  }
  return { max_abs_err_over_U: maxErr, points: pts };
}
