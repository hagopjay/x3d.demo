// THERMAL's CPU reference lattice Boltzmann solver: D2Q9 flow + D2Q5 temperature on a vertical slice, Boussinesq
// buoyancy, Float64. The WebGL2 port (src/gpu/lbm-gl.js) mirrors this file pass for pass; the GPU-vs-CPU gate and
// the in-game INTEGRITY readout compare the two.
//
// The temperature lattice carries the deviation s = T - T_ref(z) from a linear reference profile
// T_ref = T0 + Gamma z, with the source -Gamma w that the reference's advection gives (the Boussinesq perturbation
// form). Carrying T itself put T div(u) errors of order T_ref into the field (see docs/PHYSICS.md).
// One step = (1) temperature: pull g from the neighbours (walls: anti-bounce-back Dirichlet or bounce-back
// adiabatic), s = sum g, BGK collision with the velocity and eddy viscosity of the previous step, sources (heat and
// -Gamma w), sponge; (2) flow: pull f (walls: halfway bounce-back, moving-wall term, specular free-slip), rho and u with the
// Guo half-force shift using the new T, MRT collision in the Lallemand & Luo (2000) moment basis with Guo forcing
// in moment space and Smagorinsky on the deviatoric non-equilibrium stress, sponge.
// Lattice units throughout (dx = dt = 1). Cell (i, j): x = i, z = j at the cell centre; walls sit half a cell out.

export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const W9 = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
export const MIRY = [0, 1, 4, 3, 2, 8, 7, 6, 5]; // reflect c_y
export const W5 = [1 / 3, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
export const SQRT2 = 1.4142135623730951;

export function feq9(rho, ux, uy, out, o = 0) {
  const uu = 1.5 * (ux * ux + uy * uy);
  for (let k = 0; k < 9; k++) {
    const cu = 3 * (CX[k] * ux + CY[k] * uy);
    out[o + k] = W9[k] * rho * (1 + cu + 0.5 * cu * cu - uu);
  }
}

/**
 * The s_q rule. Lambda = (1/s_nu - 1/2)(1/s_q - 1/2) sets where halfway bounce-back puts the wall: 3/16 puts it
 * exactly halfway for Poiseuille flow. Near tau = 1/2 that rule drives s_q to 0, and slowly relaxed q moments left
 * a checkerboard over the whole Ridge Day slice (index 0.66), so Lambda is blended to 0 below tau = 0.55:
 * Lambda = 3/16 min(1, ((tau - 1/2)/0.05)^2), which gives s_q = 1.915 at the game's tau = 0.5003.
 */
export const sqRule = (snu) => {
  const t = 1 / snu - 0.5;
  const lam = 0.1875 * Math.min(1, (t / 0.05) ** 2);
  return 1 / (0.5 + lam / t);
};

/**
 * cfg: {
 *   nx, ny, solid?: Uint8Array(nx*ny),
 *   nu, smag (C, 0 = off), collision: 'mrt' | 'bgk', se = 1.2,
 *   thermal: bool, kappa, prT = 0.7,
 *   ref: { T0, Gamma }               reference profile T_ref(z) = T0 + Gamma z; the lattice carries T - T_ref
 *                                    (initial T, wall 'ref' and the sponge target are T_ref)
 *   buoy: { G, mode: 'profile' | 'const', T0c?, sign = 1 }   F_y = sign G (T - T_b)
 *   force: [Fx, Fy]                  constant body force density
 *   bottom/top: { type: 'noslip' | 'freeslip', u = 0, T: number | 'ref' | 'adiabatic' }
 *   solidT: number | 'ref' | 'adiabatic'
 *   wallFactor = 6                   moving-wall term 6 w rho0 c.u (twin: 3)
 *   sponge?: Float64Array(n) sigma, uTarget?: Float64Array(ny) (x velocity per row)
 *   heat?: Float64Array(n) K per step at full sun; sun = 1
 *   frozenT: bool                    twin: temperature never advected (pass skipped)
 *   init?: (i, j) => { rho, ux, uy, T }
 * }
 */
export function createLBM(cfg) {
  const nx = cfg.nx, ny = cfg.ny, n = nx * ny;
  const solid = cfg.solid || new Uint8Array(n);
  const nu0 = cfg.nu, tau0 = 3 * nu0 + 0.5;
  const C = cfg.smag || 0, C2 = C * C;
  const bgk = cfg.collision === 'bgk';
  const se = cfg.se ?? 1.2, sqFix = cfg.sq ?? 0;
  const thermal = !!cfg.thermal;
  const kappa0 = cfg.kappa ?? 0, prT = cfg.prT ?? 0.7;
  const ref = cfg.ref || { T0: 0, Gamma: 0 };
  const buoy = cfg.buoy || { G: 0, mode: 'const', T0c: 0 };
  const G = buoy.G * (buoy.sign ?? 1);
  const bT0 = buoy.mode === 'profile' ? ref.T0 : (buoy.T0c ?? 0), bGam = buoy.mode === 'profile' ? ref.Gamma : 0;
  const Fx0 = cfg.force ? cfg.force[0] : 0, Fy0 = cfg.force ? cfg.force[1] : 0;
  const bottom = { type: 'noslip', u: 0, T: 'adiabatic', ...(cfg.bottom || {}) };
  const top = { type: 'noslip', u: 0, T: 'adiabatic', ...(cfg.top || {}) };
  const solidT = cfg.solidT ?? 'adiabatic';
  const wallFactor = cfg.wallFactor ?? 6;
  const sponge = cfg.sponge || null, uTarget = cfg.uTarget || null;
  const heat = cfg.heat || null;
  const frozenT = !!cfg.frozenT;
  const Tref = (z) => ref.T0 + ref.Gamma * z;

  const fluid = [];
  for (let c = 0; c < n; c++) if (!solid[c]) fluid.push(c);
  const F = Int32Array.from(fluid), nf = F.length;

  // pull tables: f_k(c) = mul * post[src*Q + sdir] + add
  const srcF = new Int32Array(nf * 9), dirF = new Uint8Array(nf * 9), addF = new Float64Array(nf * 9);
  const srcG = new Int32Array(nf * 5), dirG = new Uint8Array(nf * 5), mulG = new Float64Array(nf * 5), addG = new Float64Array(nf * 5);
  const wallT = (spec, z) => (spec === 'ref' ? 0 : spec - Tref(z)); // as a deviation s
  for (let a = 0; a < nf; a++) {
    const c = F[a], i = c % nx, j = (c / nx) | 0;
    for (let k = 0; k < 9; k++) {
      const si = (i - CX[k] + nx) % nx, sj = j - CY[k];
      let wall = null;
      if (sj < 0) wall = bottom; else if (sj >= ny) wall = top; else if (solid[si + sj * nx]) wall = { type: 'noslip', u: 0, T: solidT };
      const q = a * 9 + k;
      if (!wall) { srcF[q] = si + sj * nx; dirF[q] = k; }
      else if (wall.type === 'freeslip') { srcF[q] = si + j * nx; dirF[q] = MIRY[k]; }
      else { srcF[q] = c; dirF[q] = OPP[k]; addF[q] = wallFactor * W9[k] * 1.0 * (CX[k] * (wall.u || 0)); }
      if (k < 5) {
        const p = a * 5 + k;
        if (!wall) { srcG[p] = si + sj * nx; dirG[p] = k; mulG[p] = 1; }
        else {
          srcG[p] = c; dirG[p] = OPP[k];
          if (wall.T === 'adiabatic') { mulG[p] = 1; }
          else { mulG[p] = -1; addG[p] = 2 * W5[k] * wallT(wall.T, j - CY[k] / 2); }
          if (wall.type === 'freeslip' && wall.T === 'adiabatic') { srcG[p] = si + j * nx; dirG[p] = [0, 1, 4, 3, 2][k]; }
        }
      }
    }
  }

  let f = new Float64Array(n * 9), fn = new Float64Array(n * 9);
  let g = new Float64Array(n * 5), gn = new Float64Array(n * 5);
  const rho = new Float64Array(n), ux = new Float64Array(n), uy = new Float64Array(n), T = new Float64Array(n), nut = new Float64Array(n);
  const tmp = new Float64Array(9);
  for (let c = 0; c < n; c++) {
    const i = c % nx, j = (c / nx) | 0;
    const s = cfg.init ? cfg.init(i, j) : { rho: 1, ux: 0, uy: 0, T: Tref(j) };
    const r = s.rho ?? 1, vx = solid[c] ? 0 : s.ux || 0, vy = solid[c] ? 0 : s.uy || 0, t = s.T ?? Tref(j);
    rho[c] = r; ux[c] = vx; uy[c] = vy; T[c] = t - Tref(j);
    feq9(r, vx, vy, f, c * 9);
    for (let k = 0; k < 5; k++) g[c * 5 + k] = W5[k] * T[c] * (1 + 3 * (CX[k] * vx + CY[k] * vy));
  }

  const sim = {
    nx, ny, n, solid, fluid: F, t: 0, sun: cfg.sun ?? 1, cfg,
    rho, ux, uy, T, nut, Tref, Tabs: (c) => T[c] + Tref((c / nx) | 0),
    get f() { return f; }, get g() { return g; },
    step, steps(k) { for (let s = 0; s < k; s++) step(); },
    setState(fs, gs, nuts, uxs, uys, Ts) { f.set(fs); g.set(gs); if (nuts) nut.set(nuts); if (uxs) ux.set(uxs); if (uys) uy.set(uys); if (Ts) T.set(Ts); },
    hash, maxU, checkerboard,
  };

  function tempPass() {
    const sun = sim.sun;
    for (let a = 0; a < nf; a++) {
      const c = F[a];
      let Tc = 0;
      const g5 = tmp;
      for (let k = 0; k < 5; k++) {
        const p = a * 5 + k;
        const v = mulG[p] * g[srcG[p] * 5 + dirG[p]] + addG[p];
        g5[k] = v; Tc += v;
      }
      T[c] = Tc;
      const vx = ux[c], vy = uy[c];
      const tauT = 0.5 + 3 * (kappa0 + nut[c] / prT), om = 1 / tauT;
      const src = (heat ? heat[c] * sun : 0) - ref.Gamma * vy;
      const sg = sponge ? sponge[c] : 0;
      const ut = uTarget ? uTarget[(c / nx) | 0] : 0;
      const o = c * 5;
      for (let k = 0; k < 5; k++) {
        const eq = W5[k] * Tc * (1 + 3 * (CX[k] * vx + CY[k] * vy));
        let v = g5[k] - om * (g5[k] - eq) + W5[k] * src;
        if (sg > 0) v += sg * (0 - v);
        gn[o + k] = v;
      }
    }
    const s = g; g = gn; gn = s;
  }

  function flowPass() {
    for (let a = 0; a < nf; a++) {
      const c = F[a], j = (c / nx) | 0;
      const b = a * 9;
      const f0 = f[srcF[b] * 9 + dirF[b]] + addF[b];
      const f1 = f[srcF[b + 1] * 9 + dirF[b + 1]] + addF[b + 1];
      const f2 = f[srcF[b + 2] * 9 + dirF[b + 2]] + addF[b + 2];
      const f3 = f[srcF[b + 3] * 9 + dirF[b + 3]] + addF[b + 3];
      const f4 = f[srcF[b + 4] * 9 + dirF[b + 4]] + addF[b + 4];
      const f5 = f[srcF[b + 5] * 9 + dirF[b + 5]] + addF[b + 5];
      const f6 = f[srcF[b + 6] * 9 + dirF[b + 6]] + addF[b + 6];
      const f7 = f[srcF[b + 7] * 9 + dirF[b + 7]] + addF[b + 7];
      const f8 = f[srcF[b + 8] * 9 + dirF[b + 8]] + addF[b + 8];
      // moments
      const r = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const e = -4 * f0 - f1 - f2 - f3 - f4 + 2 * (f5 + f6 + f7 + f8);
      const ep = 4 * f0 - 2 * (f1 + f2 + f3 + f4) + f5 + f6 + f7 + f8;
      const jx = f1 - f3 + f5 - f6 - f7 + f8;
      const qx = -2 * f1 + 2 * f3 + f5 - f6 - f7 + f8;
      const jy = f2 - f4 + f5 + f6 - f7 - f8;
      const qy = -2 * f2 + 2 * f4 + f5 + f6 - f7 - f8;
      const pxx = f1 - f2 + f3 - f4;
      const pxy = f5 - f6 + f7 - f8;
      // force (Boussinesq + constant) and the Guo half-force velocity
      const Fx = Fx0;
      const Fy = Fy0 + (G !== 0 ? G * (T[c] + ref.T0 + ref.Gamma * j - (bT0 + bGam * j)) : 0);
      const vx = (jx + 0.5 * Fx) / r, vy = (jy + 0.5 * Fy) / r;
      const jxe = r * vx, jye = r * vy;
      const u2 = vx * vx + vy * vy;
      const eEq = -2 * r + 3 * r * u2, epEq = r - 3 * r * u2;
      const pxxEq = r * (vx * vx - vy * vy), pxyEq = r * vx * vy;
      // Smagorinsky on the deviatoric non-equilibrium stress
      let tau = tau0;
      if (C2 > 0) {
        const a1 = pxx - pxxEq, a2 = pxy - pxyEq;
        const Q = Math.sqrt(0.5 * a1 * a1 + 2 * a2 * a2);
        tau = 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + 18 * SQRT2 * C2 * Q / r));
      }
      nut[c] = (tau - tau0) / 3;
      const snu = 1 / tau;
      const sE = bgk ? snu : se, sQ = bgk ? snu : (sqFix > 0 ? sqFix : sqRule(snu));
      const uF = vx * Fx + vy * Fy;
      const e1 = e - sE * (e - eEq) + (1 - 0.5 * sE) * 6 * uF;
      const ep1 = ep - sE * (ep - epEq) + (1 - 0.5 * sE) * (-6 * uF);
      const jx1 = jx + Fx, jy1 = jy + Fy;
      const qx1 = qx - sQ * (qx + jxe) + (1 - 0.5 * sQ) * (-Fx);
      const qy1 = qy - sQ * (qy + jye) + (1 - 0.5 * sQ) * (-Fy);
      const pxx1 = pxx - snu * (pxx - pxxEq) + (1 - 0.5 * snu) * 2 * (vx * Fx - vy * Fy);
      const pxy1 = pxy - snu * (pxy - pxyEq) + (1 - 0.5 * snu) * (vx * Fy + vy * Fx);
      // back to populations: f = M^-1 m
      const R = r / 9, E1 = e1 / 36, E2 = e1 / 18, P1 = ep1 / 18, P2 = ep1 / 36;
      const JX = jx1 / 6, JY = jy1 / 6, QX = qx1 / 6, QY = qy1 / 6, QX2 = qx1 / 12, QY2 = qy1 / 12, PXX = pxx1 / 4, PXY = pxy1 / 4;
      const o = c * 9;
      let n0 = R - e1 / 9 + ep1 / 9;
      let n1 = R - E1 - P1 + JX - QX + PXX;
      let n2 = R - E1 - P1 + JY - QY - PXX;
      let n3 = R - E1 - P1 - JX + QX + PXX;
      let n4 = R - E1 - P1 - JY + QY - PXX;
      let n5 = R + E2 + P2 + JX + QX2 + JY + QY2 + PXY;
      let n6 = R + E2 + P2 - JX - QX2 + JY + QY2 - PXY;
      let n7 = R + E2 + P2 - JX - QX2 - JY - QY2 + PXY;
      let n8 = R + E2 + P2 + JX + QX2 - JY - QY2 - PXY;
      if (sponge && sponge[c] > 0) {
        const sg = sponge[c], ut = uTarget ? uTarget[j] : 0;
        feq9(r, ut, 0, tmp, 0);
        n0 += sg * (tmp[0] - n0); n1 += sg * (tmp[1] - n1); n2 += sg * (tmp[2] - n2);
        n3 += sg * (tmp[3] - n3); n4 += sg * (tmp[4] - n4); n5 += sg * (tmp[5] - n5);
        n6 += sg * (tmp[6] - n6); n7 += sg * (tmp[7] - n7); n8 += sg * (tmp[8] - n8);
      }
      fn[o] = n0; fn[o + 1] = n1; fn[o + 2] = n2; fn[o + 3] = n3; fn[o + 4] = n4;
      fn[o + 5] = n5; fn[o + 6] = n6; fn[o + 7] = n7; fn[o + 8] = n8;
      rho[c] = r; ux[c] = vx; uy[c] = vy;
    }
    const s = f; f = fn; fn = s;
  }

  function step() {
    if (thermal && !frozenT) tempPass();
    flowPass();
    sim.t++;
  }

  /** FNV-1a over the 32-bit words of the populations (f, g) and the step count. */
  function hash() {
    let h = 0x811c9dc5;
    const mix = (arr) => {
      const w = new Uint32Array(arr.buffer, arr.byteOffset, arr.length * 2);
      for (let i = 0; i < w.length; i++) { h ^= w[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    };
    mix(f); if (thermal) mix(g);
    h ^= sim.t; h = Math.imul(h, 0x01000193) >>> 0;
    return h >>> 0;
  }

  function maxU() {
    let m = 0;
    for (let a = 0; a < nf; a++) {
      const c = F[a];
      const v = Math.sqrt(ux[c] * ux[c] + uy[c] * uy[c]);
      if (!(v <= m)) m = v; // NaN propagates
    }
    return m;
  }

  /** rms of the 2x2 Nyquist component of w over all-fluid blocks, over rms w. */
  function checkerboard() {
    let sc = 0, nc = 0, sw = 0;
    for (let a = 0; a < nf; a++) sw += uy[F[a]] * uy[F[a]];
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const c00 = i + j * nx, c10 = c00 + 1, c01 = c00 + nx, c11 = c01 + 1;
        if (solid[c00] || solid[c10] || solid[c01] || solid[c11]) continue;
        const v = (uy[c00] - uy[c10] - uy[c01] + uy[c11]) / 4;
        sc += v * v; nc++;
      }
    }
    return Math.sqrt(sc / Math.max(nc, 1)) / Math.sqrt(sw / nf);
  }

  return sim;
}
