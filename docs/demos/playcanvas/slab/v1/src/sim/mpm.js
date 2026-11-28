// SLAB's snow: a 2D MLS-MPM solver (Hu et al. 2018) with APIC transfers (Jiang et al. 2015), quadratic B-splines,
// float64, no randomness, no clock. This file is the reference: the WebGL2 port (src/gpu/mpm-gl.js) is judged
// against it, the tests run it in Node, and the game runs it when there is no GPU.
//
// Materials, one per particle:
//   ELASTIC   fixed-corotated, no plasticity (the momentum, energy and wave gates; the "jelly" twin)
//   SNOW      Stomakhin et al. 2013: singular values clamped to [1 - thetaC, 1 + thetaS], hardening exp(xi (1 - Jp))
//   GRANULAR  Hencky elasticity with a plane Mohr-Coulomb return (Drucker-Prager in 2D, after Klar et al. 2016)
//             plus cohesion c and optional strain softening of c with accumulated plastic shear (the weak layer)
// Twins (opts.twin): 'pic' drops the m C affine term; 'flip' is pure FLIP; 'no_return' skips every return map;
// 'stress2' writes the MLS stress factor 4/dx^2 as 2/dx^2.

export const G = 9.81;
export const ELASTIC = 0, SNOW = 1, GRANULAR = 2;

/** A material with its Lame parameters. E in Pa, rho in kg/m^3, phi in degrees, c in Pa. */
export function material(m) {
  const E = m.E, nu = m.nu ?? 0.2;
  const out = { kind: ELASTIC, thetaC: 2.5e-2, thetaS: 7.5e-3, xi: 10, phi: 30, c: 0, soften: Infinity, ...m };
  out.mu = E / (2 * (1 + nu));
  out.la = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  out.sinPhi = Math.sin((out.phi * Math.PI) / 180);
  out.cosPhi = Math.cos((out.phi * Math.PI) / 180);
  return out;
}

/** 2x2 SVD, F = U diag(s1, s2) V^T, by polar decomposition then a symmetric eigensolve (as in Taichi's svd2d). */
export function svd2(a, b, c, d, out) {
  let x = a + d, y = c - b;
  let r = Math.hypot(x, y);
  let co = 1, si = 0;
  if (r > 0) { co = x / r; si = y / r; }
  // S = R^T F, symmetric
  const s00 = co * a + si * c, s01 = co * b + si * d, s11 = -si * b + co * d;
  let cs = 1, sn = 0;
  if (Math.abs(s01) > 1e-300) {
    const tau = 0.5 * (s00 - s11), w = Math.hypot(tau, s01);
    const t = tau > 0 ? s01 / (tau + w) : s01 / (tau - w);
    cs = 1 / Math.sqrt(t * t + 1); sn = -t * cs;
  }
  out[0] = cs * cs * s00 - 2 * cs * sn * s01 + sn * sn * s11; // s1
  out[1] = sn * sn * s00 + 2 * cs * sn * s01 + cs * cs * s11; // s2
  // eigenvectors (cs, -sn) and (sn, cs): V = [[cs, sn], [-sn, cs]], U = R V with R = [[co, -si], [si, co]]
  out[2] = co * cs + si * sn; out[3] = co * sn - si * cs; out[4] = si * cs - co * sn; out[5] = si * sn + co * cs; // U
  out[6] = cs; out[7] = sn; out[8] = -sn; out[9] = cs; // V
  return out;
}

const FIELDS = ['x', 'y', 'vx', 'vy', 'c00', 'c01', 'c10', 'c11', 'f00', 'f01', 'f10', 'f11', 'jp', 'dmg', 'coh', 'm', 'v0'];

export class Sim {
  /**
   * opts: nx, ny, dx (m), dt (s), cap (max particles), materials (array of material()), periodicX,
   * walls {left, right, bottom, top}: 'sticky' | 'slip' | 'separate' | 'free', gravity [gx, gy] in m/s^2,
   * ramp (s, smoothstep on gravity), twin.
   */
  constructor(o) {
    this.nx = o.nx; this.ny = o.ny; this.dx = o.dx; this.dt = o.dt;
    this.inv = 1 / o.dx;
    this.periodicX = !!o.periodicX;
    this.walls = { left: 'separate', right: 'separate', bottom: 'sticky', top: 'free', ...(o.walls || {}) };
    this.gravity = o.gravity || [0, -G];
    this.ramp = o.ramp || 0;
    this.twin = o.twin || null;
    this.mats = o.materials;
    this.bw = 2;
    const cap = o.cap || 100000;
    this.cap = cap; this.n = 0; this.t = 0; this.steps = 0;
    for (const f of FIELDS) this[f] = new Float64Array(cap);
    this.mat = new Uint8Array(cap);
    const nn = o.nx * o.ny;
    this.gm = new Float64Array(nn); this.gx = new Float64Array(nn); this.gy = new Float64Array(nn);
    this.gx0 = new Float64Array(nn); this.gy0 = new Float64Array(nn);
    this.loads = []; // { x, y, fx, fy } line loads in N/m, applied through B-spline weights
    this.ground = null; // optional Float64Array(nx): terrain height at each node column; nodes below it are sticky
    this.body = null; // dynamic rigid disc { x, y, vx, vy, r, M } (M in kg/m): the caught skier
    this._s = new Float64Array(10);
  }

  /** Fill [x0,x1] x [y0,y1] with ppc^2 particles per cell on a regular lattice. */
  addBlock(x0, y0, x1, y1, mi, { ppc = 2, vx = 0, vy = 0, spin = 0, cx = 0, cy = 0, inside = null } = {}) {
    const h = this.dx / ppc, M = this.mats[mi];
    const v0 = h * h;
    for (let y = y0 + h / 2; y < y1; y += h) {
      for (let x = x0 + h / 2; x < x1; x += h) {
        if (inside && !inside(x, y)) continue;
        if (this.n >= this.cap) throw new Error('particle capacity ' + this.cap);
        const p = this.n++;
        this.x[p] = x; this.y[p] = y;
        this.vx[p] = vx - spin * (y - cy); this.vy[p] = vy + spin * (x - cx);
        // a rigid spin carries an affine velocity field C = [[0, -w], [w, 0]]
        this.c00[p] = 0; this.c01[p] = -spin; this.c10[p] = spin; this.c11[p] = 0;
        this.f00[p] = 1; this.f01[p] = 0; this.f10[p] = 0; this.f11[p] = 1;
        this.jp[p] = 1; this.dmg[p] = 0; this.coh[p] = 1;
        this.m[p] = M.rho * v0; this.v0[p] = v0; this.mat[p] = mi;
      }
    }
    return this;
  }

  gscale() {
    if (!this.ramp) return 1;
    const s = Math.min(1, this.t / this.ramp);
    return s * s * (3 - 2 * s);
  }

  /** Kirchhoff stress tau = P F^T of particle p (also applies the return map when ret is true). Returns [t00,t01,t11]. */
  stress(p, ret, out) {
    const M = this.mats[this.mat[p]];
    const s = svd2(this.f00[p], this.f01[p], this.f10[p], this.f11[p], this._s);
    let s1 = s[0], s2 = s[1];
    const u00 = s[2], u01 = s[3], u10 = s[4], u11 = s[5], v00 = s[6], v01 = s[7], v10 = s[8], v11 = s[9];
    let mu = M.mu, la = M.la;
    if (M.kind === GRANULAR) {
      const e1 = Math.log(Math.max(s1, 1e-8)), e2 = Math.log(Math.max(s2, 1e-8));
      let e = e1 + e2, d = 0.5 * (e1 - e2);
      if (ret) {
        const K = mu + la;
        let c = M.c * this.coh[p];
        if (M.soften < Infinity) c *= Math.max(0, 1 - this.dmg[p] / M.soften);
        const cap = c * M.cosPhi - K * e * M.sinPhi; // allowed max shear stress (plane Mohr-Coulomb)
        if (cap <= 0) {
          // past the tension cut-off: back to the apex, stress-free in shear
          const ea = M.sinPhi > 0 ? (c * M.cosPhi) / (K * M.sinPhi) : 0;
          this.dmg[p] += 2 * Math.abs(d); e = ea; d = 0;
        } else if (2 * mu * Math.abs(d) > cap) {
          const dn = Math.sign(d) * (cap / (2 * mu));
          this.dmg[p] += 2 * Math.abs(d - dn); d = dn;
        }
        const n1 = Math.exp(0.5 * e + d), n2 = Math.exp(0.5 * e - d);
        // F = U diag(n) V^T
        this.f00[p] = u00 * n1 * v00 + u01 * n2 * v01; this.f01[p] = u00 * n1 * v10 + u01 * n2 * v11;
        this.f10[p] = u10 * n1 * v00 + u11 * n2 * v01; this.f11[p] = u10 * n1 * v10 + u11 * n2 * v11;
      }
      const t1 = 2 * mu * (0.5 * e + d) + la * e, t2 = 2 * mu * (0.5 * e - d) + la * e;
      out[0] = u00 * u00 * t1 + u01 * u01 * t2; out[1] = u00 * u10 * t1 + u01 * u11 * t2; out[2] = u10 * u10 * t1 + u11 * u11 * t2;
      return out;
    }
    if (M.kind === SNOW) {
      if (ret) {
        const J0 = s1 * s2;
        s1 = Math.min(Math.max(s1, 1 - M.thetaC), 1 + M.thetaS);
        s2 = Math.min(Math.max(s2, 1 - M.thetaC), 1 + M.thetaS);
        const J1 = s1 * s2;
        this.jp[p] *= J0 / J1;
        this.dmg[p] = Math.abs(Math.log(this.jp[p]));
        this.f00[p] = u00 * s1 * v00 + u01 * s2 * v01; this.f01[p] = u00 * s1 * v10 + u01 * s2 * v11;
        this.f10[p] = u10 * s1 * v00 + u11 * s2 * v01; this.f11[p] = u10 * s1 * v10 + u11 * s2 * v11;
      }
      const h = Math.exp(M.xi * (1 - this.jp[p]));
      mu *= h; la *= h;
    }
    // fixed corotated: tau = 2 mu (F - R) F^T + la J (J - 1) I, R = U V^T
    const r00 = u00 * v00 + u01 * v01, r01 = u00 * v10 + u01 * v11, r10 = u10 * v00 + u11 * v01, r11 = u10 * v10 + u11 * v11;
    const f00 = this.f00[p], f01 = this.f01[p], f10 = this.f10[p], f11 = this.f11[p];
    const a00 = f00 - r00, a01 = f01 - r01, a10 = f10 - r10, a11 = f11 - r11;
    const J = f00 * f11 - f01 * f10, lj = la * J * (J - 1);
    out[0] = 2 * mu * (a00 * f00 + a01 * f01) + lj;
    out[1] = 2 * mu * (a00 * f10 + a01 * f11);
    out[2] = 2 * mu * (a10 * f10 + a11 * f11) + lj;
    return out;
  }

  step() {
    const { nx, ny, dx, dt, inv, n } = this;
    const gm = this.gm, gx = this.gx, gy = this.gy;
    gm.fill(0); gx.fill(0); gy.fill(0);
    const twin = this.twin, per = this.periodicX;
    const sf = (twin === 'stress2' ? 2 : 4) * inv * inv;
    const useC = twin !== 'pic' && twin !== 'flip';
    const tau = [0, 0, 0];
    const X = this.x, Y = this.y, VX = this.vx, VY = this.vy;
    const wx = [0, 0, 0], wy = [0, 0, 0];
    // P2G
    for (let p = 0; p < n; p++) {
      const px = X[p] * inv, py = Y[p] * inv;
      const bx = Math.floor(px - 0.5), by = Math.floor(py - 0.5);
      const fx = px - bx, fy = py - by;
      wx[0] = 0.5 * (1.5 - fx) ** 2; wx[1] = 0.75 - (fx - 1) ** 2; wx[2] = 0.5 * (fx - 0.5) ** 2;
      wy[0] = 0.5 * (1.5 - fy) ** 2; wy[1] = 0.75 - (fy - 1) ** 2; wy[2] = 0.5 * (fy - 0.5) ** 2;
      this.stress(p, false, tau);
      const k = -dt * this.v0[p] * sf, m = this.m[p];
      let a00 = k * tau[0], a01 = k * tau[1], a10 = k * tau[1], a11 = k * tau[2];
      if (useC) { a00 += m * this.c00[p]; a01 += m * this.c01[p]; a10 += m * this.c10[p]; a11 += m * this.c11[p]; }
      const mvx = m * VX[p], mvy = m * VY[p];
      for (let i = 0; i < 3; i++) {
        let gi = bx + i;
        if (per) gi = ((gi % nx) + nx) % nx;
        const dpx = (i - fx) * dx;
        for (let j = 0; j < 3; j++) {
          const w = wx[i] * wy[j], dpy = (j - fy) * dx;
          const id = gi + (by + j) * nx;
          gm[id] += w * m;
          gx[id] += w * (mvx + a00 * dpx + a01 * dpy);
          gy[id] += w * (mvy + a10 * dpx + a11 * dpy);
        }
      }
    }
    // external line loads (N/m) through the same weights
    for (const L of this.loads) {
      const px = L.x * inv, py = L.y * inv, bx = Math.floor(px - 0.5), by = Math.floor(py - 0.5), fx = px - bx, fy = py - by;
      const ax = [0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2], ay = [0.5 * (1.5 - fy) ** 2, 0.75 - (fy - 1) ** 2, 0.5 * (fy - 0.5) ** 2];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let gi = bx + i; if (per) gi = ((gi % nx) + nx) % nx;
        const id = gi + (by + j) * nx;
        if (id < 0 || id >= nx * ny) continue;
        gx[id] += dt * ax[i] * ay[j] * L.fx; gy[id] += dt * ax[i] * ay[j] * L.fy;
      }
    }
    // grid update
    const gs = this.gscale(), ggx = this.gravity[0] * gs * dt, ggy = this.gravity[1] * gs * dt;
    const bw = this.bw, W = this.walls;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = i + j * nx, m = gm[id];
        if (m <= 0) { gx[id] = 0; gy[id] = 0; continue; }
        let vx = gx[id] / m, vy = gy[id] / m;
        this.gx0[id] = vx; this.gy0[id] = vy;
        vx += ggx; vy += ggy;
        if (j < bw) [vx, vy] = wall(W.bottom, vx, vy, 0, 1);
        if (this.ground && j * dx < this.ground[i]) { vx = 0; vy = 0; }
        if (j >= ny - bw) [vx, vy] = wall(W.top, vx, vy, 0, -1);
        if (!per) {
          if (i < bw) [vx, vy] = wall(W.left, vx, vy, 1, 0);
          if (i >= nx - bw) [vx, vy] = wall(W.right, vx, vy, -1, 0);
        }
        gx[id] = vx; gy[id] = vy;
      }
    }
    if (this.body) this.coupleBody(ggx, ggy);
    // G2P
    const flip = twin === 'flip', noRet = twin === 'no_return';
    for (let p = 0; p < n; p++) {
      const px = X[p] * inv, py = Y[p] * inv;
      const bx = Math.floor(px - 0.5), by = Math.floor(py - 0.5);
      const fx = px - bx, fy = py - by;
      wx[0] = 0.5 * (1.5 - fx) ** 2; wx[1] = 0.75 - (fx - 1) ** 2; wx[2] = 0.5 * (fx - 0.5) ** 2;
      wy[0] = 0.5 * (1.5 - fy) ** 2; wy[1] = 0.75 - (fy - 1) ** 2; wy[2] = 0.5 * (fy - 0.5) ** 2;
      let vx = 0, vy = 0, ox = 0, oy = 0, c00 = 0, c01 = 0, c10 = 0, c11 = 0;
      for (let i = 0; i < 3; i++) {
        let gi = bx + i;
        if (per) gi = ((gi % nx) + nx) % nx;
        const dpx = (i - fx) * dx;
        for (let j = 0; j < 3; j++) {
          const w = wx[i] * wy[j], dpy = (j - fy) * dx;
          const id = gi + (by + j) * nx;
          const gvx = gx[id], gvy = gy[id];
          vx += w * gvx; vy += w * gvy;
          if (flip) { ox += w * this.gx0[id]; oy += w * this.gy0[id]; }
          c00 += w * gvx * dpx; c01 += w * gvx * dpy; c10 += w * gvy * dpx; c11 += w * gvy * dpy;
        }
      }
      const k4 = 4 * inv * inv;
      c00 *= k4; c01 *= k4; c10 *= k4; c11 *= k4;
      if (flip) { VX[p] += vx - ox; VY[p] += vy - oy; } else { VX[p] = vx; VY[p] = vy; }
      this.c00[p] = c00; this.c01[p] = c01; this.c10[p] = c10; this.c11[p] = c11;
      X[p] += dt * vx; Y[p] += dt * vy;
      if (per) { const L = nx * dx; if (X[p] < 0) X[p] += L; else if (X[p] >= L) X[p] -= L; }
      // F <- (I + dt C) F
      const f00 = this.f00[p], f01 = this.f01[p], f10 = this.f10[p], f11 = this.f11[p];
      this.f00[p] = f00 + dt * (c00 * f00 + c01 * f10); this.f01[p] = f01 + dt * (c00 * f01 + c01 * f11);
      this.f10[p] = f10 + dt * (c10 * f00 + c11 * f10); this.f11[p] = f11 + dt * (c10 * f01 + c11 * f11);
      if (!noRet && this.mats[this.mat[p]].kind !== ELASTIC) this.stress(p, true, tau);
    }
    this.t += dt; this.steps++;
  }

  /** Perfectly inelastic exchange between the dynamic disc and the grid nodes it covers (momentum conserving). */
  coupleBody(ggx, ggy) {
    const B = this.body, { nx, ny, dx, gm, gx, gy } = this;
    B.vx += ggx; B.vy += ggy;
    const r2 = B.r * B.r;
    const i0 = Math.max(0, Math.floor((B.x - B.r) / dx)), i1 = Math.min(nx - 1, Math.ceil((B.x + B.r) / dx));
    const j0 = Math.max(0, Math.floor((B.y - B.r) / dx)), j1 = Math.min(ny - 1, Math.ceil((B.y + B.r) / dx));
    let M = B.M, px = B.M * B.vx, py = B.M * B.vy;
    const ids = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ddx = i * dx - B.x, ddy = j * dx - B.y;
      if (ddx * ddx + ddy * ddy > r2) continue;
      const id = i + j * nx;
      if (gm[id] <= 0) continue;
      M += gm[id]; px += gm[id] * gx[id]; py += gm[id] * gy[id]; ids.push(id);
    }
    const vx = px / M, vy = py / M;
    for (const id of ids) { gx[id] = vx; gy[id] = vy; }
    B.vx = vx; B.vy = vy;
    B.x += this.dt * vx; B.y += this.dt * vy;
    let floor = (this.bw + 0.5) * dx + B.r;
    if (this.ground) { const i = Math.min(nx - 1, Math.max(0, Math.round(B.x / dx))); floor = Math.max(floor, this.ground[i] + B.r); }
    if (B.y < floor) { B.y = floor; if (B.vy < 0) B.vy = 0; }
  }

  /** Radial blast: particles within R get a kick (1 - d/R) dv outward; granular ones inside lose cohesion. */
  blast(cx, cy, R, dv) {
    for (let p = 0; p < this.n; p++) {
      const ddx = this.x[p] - cx, ddy = this.y[p] - cy, d = Math.hypot(ddx, ddy);
      if (d >= R || d === 0) continue;
      const k = dv * (1 - d / R);
      this.vx[p] += (k * ddx) / d; this.vy[p] += (k * ddy) / d;
      if (this.mats[this.mat[p]].kind === GRANULAR) this.coh[p] = 0;
      this.dmg[p] += 1 - d / R;
    }
  }

  /** How close a granular particle is to yield: max shear over allowed max shear (>= 1: yielding). The HUD's stress overlay. */
  utilization(p) {
    const M = this.mats[this.mat[p]];
    if (M.kind !== GRANULAR) return 0;
    const s = svd2(this.f00[p], this.f01[p], this.f10[p], this.f11[p], this._s);
    const e1 = Math.log(Math.max(s[0], 1e-8)), e2 = Math.log(Math.max(s[1], 1e-8)), e = e1 + e2, d = 0.5 * (e1 - e2);
    let c = M.c * this.coh[p];
    if (M.soften < Infinity) c *= Math.max(0, 1 - this.dmg[p] / M.soften);
    const cap = c * M.cosPhi - (M.mu + M.la) * e * M.sinPhi;
    return cap <= 0 ? 2 : (2 * M.mu * Math.abs(d)) / cap;
  }

  momentum() {
    let px = 0, py = 0, L = 0, M = 0;
    const D = (this.dx * this.dx) / 4;
    for (let p = 0; p < this.n; p++) {
      const m = this.m[p];
      px += m * this.vx[p]; py += m * this.vy[p]; M += m;
      L += m * (this.x[p] * this.vy[p] - this.y[p] * this.vx[p]) + m * D * (this.c10[p] - this.c01[p]);
    }
    return { px, py, L, M };
  }

  /** Kinetic + gravitational (current gravity) + elastic energy, J per metre of width. */
  energy() {
    let ke = 0, pe = 0, el = 0;
    const gs = this.gscale(), gxv = this.gravity[0] * gs, gyv = this.gravity[1] * gs;
    for (let p = 0; p < this.n; p++) {
      const m = this.m[p], M = this.mats[this.mat[p]];
      ke += 0.5 * m * (this.vx[p] ** 2 + this.vy[p] ** 2);
      pe -= m * (gxv * this.x[p] + gyv * this.y[p]);
      const s = svd2(this.f00[p], this.f01[p], this.f10[p], this.f11[p], this._s);
      let mu = M.mu, la = M.la;
      if (M.kind === GRANULAR) {
        const e1 = Math.log(Math.max(s[0], 1e-8)), e2 = Math.log(Math.max(s[1], 1e-8));
        el += this.v0[p] * (mu * (e1 * e1 + e2 * e2) + 0.5 * la * (e1 + e2) ** 2);
      } else {
        if (M.kind === SNOW) { const h = Math.exp(M.xi * (1 - this.jp[p])); mu *= h; la *= h; }
        const J = s[0] * s[1];
        el += this.v0[p] * (mu * ((s[0] - 1) ** 2 + (s[1] - 1) ** 2) + 0.5 * la * (J - 1) ** 2);
      }
    }
    return { ke, pe, el, total: ke + pe + el };
  }

  /** FNV-1a over every float64 of the state that a snapshot restores. */
  hash() {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    const eat = (arr, n) => {
      const u = new Uint32Array(arr.buffer, arr.byteOffset, n * (arr.BYTES_PER_ELEMENT / 4 || 1));
      for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 0x01000193); h2 = Math.imul(h2 ^ u[i], 0x5bd1e995) ^ (h2 >>> 15); }
    };
    for (const f of FIELDS) eat(this[f], this.n);
    const tail = new Float64Array([this.t, this.steps, ...(this.body ? [this.body.x, this.body.y, this.body.vx, this.body.vy] : [])]);
    eat(tail, tail.length);
    const m8 = new Uint32Array(Math.ceil(this.n / 4)); new Uint8Array(m8.buffer).set(this.mat.subarray(0, this.n)); eat(m8, m8.length);
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
}

function wall(kind, vx, vy, nx, ny) {
  if (kind === 'free') return [vx, vy];
  if (kind === 'sticky') return [0, 0];
  const vn = vx * nx + vy * ny;
  if (kind === 'slip' || vn < 0) return [vx - vn * nx, vy - vn * ny];
  return [vx, vy];
}

export { FIELDS };
