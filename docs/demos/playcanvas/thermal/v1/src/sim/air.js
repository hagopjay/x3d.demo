// The air of a THERMAL level: physical units <-> lattice units, the lattice set-up (terrain mask, sponges, inflow
// profile, solar heating per column), sampling for the glider, and the cloud rule. Used by Node (tests, bots), the
// browser's CPU reference and, through airConfig(), the WebGL2 port.
import { createLBM } from './lbm.js';

export const g0 = 9.81, RHO_AIR = 1.2, CP_AIR = 1005;

export function units(level) {
  const { dx } = level.grid, a = level.air;
  const dt = (a.uLattice * dx) / level.wind.U;                     // s per step
  const Gamma = (a.N * a.N * a.theta0) / g0;                        // K per m (d theta / dz)
  return {
    dx, dt, Ulat: a.uLattice, toMs: dx / dt,
    GammaPhys: Gamma, GammaLat: Gamma * dx,                         // K per cell
    G: (g0 / a.theta0) * (dt * dt) / dx,                             // lattice acceleration per K
    Nlat: a.N * dt,
    heatPerWm2: dt / (RHO_AIR * CP_AIR * dx),                       // K per step per W/m^2 in a dx-thick cell
  };
}

/** Sun elevation (deg) at clock time t (s after the level's start); 0 at sunset, linear in between. */
export function sunElevation(level, t) {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const span = (toMin(level.sun.sunset) - toMin(level.sun.start)) * 60;
  return Math.max(0, level.sun.startElevation * (1 - t / span));
}
export function dayLength(level) {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return (toMin(level.sun.sunset) - toMin(level.sun.start)) * 60;
}

/**
 * Sensible heat into the first air cell of each column (K per step), for a sun at elevation el (deg) in the
 * west: flux = S0 x max(0, n.s) x (1 - albedo) x sensible fraction, n the terrain normal, s the sun direction.
 */
export function heatColumns(level, el) {
  const u = units(level), g = level.grid, out = new Float64Array(g.nx);
  const e = (el * Math.PI) / 180, sx = -Math.cos(e), sz = Math.sin(e);
  const albedo = level.albedo || [0.2, 0.22, 0.12, 0.8, 0.07], sens = level.sensibleFraction || [0.55, 0.35, 0.3, 0.05, 0.05];
  for (let i = 0; i < g.nx; i++) {
    const hl = level.heights[Math.max(0, i - 1)], hr = level.heights[Math.min(g.nx - 1, i + 1)];
    const slope = (hr - hl) / ((i > 0 && i < g.nx - 1 ? 2 : 1) * g.dx);
    const l = Math.hypot(slope, 1), nxv = -slope / l, nzv = 1 / l;
    const cos = Math.max(0, nxv * sx + nzv * sz);
    const s = level.surface[i];
    out[i] = level.sun.S0 * cos * (1 - albedo[s]) * sens[s] * u.heatPerWm2 * (el > 0 ? 1 : 0);
  }
  return out;
}

/**
 * Everything the lattice needs, as plain arrays (the GPU port uploads the same arrays).
 * opts: { wind = true, sun = true, collision, smag, buoyMode, frozenT }
 */
export function airConfig(level, opts = {}) {
  const u = units(level), g = level.grid, nx = g.nx, ny = g.ny, n = nx * ny;
  const solid = new Uint8Array(n), ground = new Int32Array(nx);
  for (let i = 0; i < nx; i++) {
    let top = -1;
    for (let j = 0; j < ny; j++) {
      const zc = g.zBottom + (j + 0.5) * g.dx;
      if (zc < level.heights[i]) { solid[i + j * nx] = 1; top = j; }
    }
    ground[i] = top + 1;                                            // first air row
  }
  const valley = Math.min(...level.heights);
  const U = opts.wind === false ? 0 : u.Ulat;
  const uTarget = new Float64Array(ny);
  for (let j = 0; j < ny; j++) {
    const agl = Math.max(0, g.zBottom + (j + 0.5) * g.dx - valley);
    uTarget[j] = U * Math.min(1, agl / level.wind.profileDepth) ** level.wind.profileExponent;
  }
  const sponge = new Float64Array(n);
  const jTop = Math.round(ny * 0.73), iFr = nx - 48;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    if (j >= jTop) s = Math.max(s, 0.05 * ((j - jTop) / (ny - jTop)) ** 2);
    if (i >= iFr) s = Math.max(s, 0.05 * ((i - iFr) / (nx - iFr)) ** 2);
    sponge[i + j * nx] = s;
  }
  const heatCol = heatColumns(level, opts.sun === false ? 0 : (opts.elevation ?? level.sun.startElevation));
  const heat = new Float64Array(n);
  for (let i = 0; i < nx; i++) heat[i + ground[i] * nx] = heatCol[i];
  // T is potential temperature minus theta0, referenced to the valley floor
  const T0 = (g.zBottom + 0.5 * g.dx - valley) * u.GammaPhys;
  const cfg = {
    nx, ny, solid, nu: level.air.nuLattice, collision: opts.collision || 'mrt', smag: opts.smag ?? level.air.smagorinsky,
    thermal: true, kappa: level.air.kappaLattice, prT: 0.7,
    ref: { T0, Gamma: u.GammaLat }, buoy: { G: u.G, mode: opts.buoyMode || 'profile', T0c: T0 },
    bottom: { type: 'noslip', T: 'ref' }, top: { type: 'freeslip', T: 'ref' }, solidT: 'ref',
    sponge, uTarget, heat, sun: 1, frozenT: !!opts.frozenT,
    init: (i, j) => ({ rho: 1, ux: solid[i + j * nx] ? 0 : uTarget[j], uy: 0 }),
  };
  return { cfg, units: u, ground, valley, heatColumns: heatCol };
}

/** The CPU air: an LBM with physical sampling. */
export function createAir(level, opts = {}) {
  const A = airConfig(level, opts);
  const sim = createLBM(A.cfg);
  return wrapAir(level, A, sim);
}

export function wrapAir(level, A, sim) {
  const g = level.grid, u = A.units, nx = g.nx, ny = g.ny;
  const air = {
    level, sim, units: u, A, time: 0,
    get step() { return sim.t; },
    advance(k = 1) { sim.steps(k); air.time = sim.t * u.dt; },
    setSun(el) { const h = heatColumns(level, el); for (let i = 0; i < nx; i++) A.cfg.heat[i + A.ground[i] * nx] = h[i]; },
    /** wind (m/s) and theta' (K) at x (m), z (m ASL): bilinear between cell centres; solid cells read as still */
    sample(x, z, fields = sim) { return sampleFields(level, u, fields, x, z); },
    zLCL: level.air.spread * 125 + A.valley,
  };
  return air;
}

export function sampleFields(level, u, F, x, z) {
  const g = level.grid, nx = g.nx, ny = g.ny;
  const fx = x / g.dx - 0.5, fz = (z - g.zBottom) / g.dx - 0.5;
  const i0 = Math.floor(fx), j0 = Math.max(0, Math.min(ny - 2, Math.floor(fz)));
  const tx = fx - i0, tz = Math.min(1, Math.max(0, fz - j0));
  let U = 0, Wv = 0, T = 0;
  for (let b = 0; b < 4; b++) {
    const ii = (((i0 + (b & 1)) % nx) + nx) % nx, jj = j0 + (b >> 1);
    const w = ((b & 1) ? tx : 1 - tx) * ((b >> 1) ? tz : 1 - tz);
    const c = ii + jj * nx;
    if (F.solid[c]) continue;
    U += w * F.ux[c]; Wv += w * F.uy[c]; T += w * F.T[c];
  }
  return { u: U * u.toMs, w: Wv * u.toMs, theta: T };
}

/**
 * The cloud rule: a cell is cloud when the air there is rising (w > 0.05 m/s), it is at or above the condensation
 * level, and its estimated origin (z + theta'/Gamma for lifted stable air; the ground for air warmer than the
 * profile by more than 0.1 K) is at or below that level. Returns the cloud cells' indices.
 * twin 'height': clouds wherever z >= z_LCL.
 */
export function cloudCells(level, A, F, twin = null) {
  const g = level.grid, u = A.units, nx = g.nx, ny = g.ny, out = [];
  const zLCL = level.air.spread * 125 + A.valley;
  for (let j = 0; j < ny; j++) {
    const z = g.zBottom + (j + 0.5) * g.dx;
    if (z < zLCL) continue;
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (F.solid[c]) continue;
      if (twin === 'height') { out.push(c); continue; }
      const w = F.uy[c] * u.toMs, th = F.T[c];
      if (!(w > 0.05)) continue;
      const origin = th > 0.1 ? level.heights[i] : z + th / u.GammaPhys;
      if (origin <= zLCL) out.push(c);
    }
  }
  return out;
}

/** Check a cloud list against the rule's three conditions; returns the number of violations. */
export function cloudViolations(level, A, F, cells) {
  const g = level.grid, u = A.units, nx = g.nx, zLCL = level.air.spread * 125 + A.valley;
  let bad = 0;
  for (const c of cells) {
    const i = c % nx, j = (c / nx) | 0, z = g.zBottom + (j + 0.5) * g.dx;
    const w = F.uy[c] * u.toMs, th = F.T[c];
    const origin = th > 0.1 ? level.heights[i] : z + th / u.GammaPhys;
    if (!(w > 0.05) || z < zLCL || origin > zLCL) bad++;
  }
  return bad;
}
