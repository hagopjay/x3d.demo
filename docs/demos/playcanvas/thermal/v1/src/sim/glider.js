// The THERMAL sailplane: a rigid body in its pitch plane (airspeed vector, angle of attack, pitch rate) with a
// coordinated-turn bank, flown through a sampled wind field. Two lifting surfaces, the wing and the tailplane, each
// with its lift perpendicular to its own local airflow (which includes the pitch rate's q x r), so with drag off
// the aerodynamic forces do no work and energy is conserved. Drag is the fitted polar on the total lift coefficient,
// so a trimmed glide lands on the polar whatever the tail carries. RK4 at a fixed step.
//
// Frames: ground x (downwind, east), y (along the ridge, north), z (up). Air velocity W(x, z) = (u, 0, w).
// The published polar and its fit are in polar.js. Everything else here is a stated estimate (no publication):
// chord, tail size and arm, lift slopes, downwash, inertia, elevator, flaps, airbrakes, stall.
import { ASW28, FIT, RHO0, G0 } from './polar.js';

export const AIRFRAME = {
  S: ASW28.wingArea, c: 0.7, St: 0.98,
  xw: 0.10, xt: -4.3,                     // wing and tail aerodynamic centres from the CG along the body axis (m)
  aw: 5.6, at: 4.2,                       // lift slopes (1/rad)
  alpha0: -0.045,                         // wing zero-lift angle of attack at flap 0 (rad)
  flapShift: -0.018,                      // zero-lift angle change per flap notch (rad), notches -2..+2
  clmax: 1.4, clmaxFlap: 0.06,            // stall CL at flap 0 and per notch
  deps: 0.35,                             // downwash per radian of wing angle above zero lift
  it: -0.02,                              // tail incidence (rad)
  tauE: 0.55, deMax: 0.35,                // elevator effectiveness and travel (rad)
  cm0: -0.08,                             // wing camber moment coefficient
  I: 900,                                 // pitch inertia (kg m^2), estimate
  pilotMass: ASW28.referenceMass, maxWater: ASW28.maxBallast, dumpRate: 4,   // kg, kg, kg/s
  brakeCD: 0.05, rollTau: 0.7, maxBank: 0.8,
};

export function createGlider(opts = {}) {
  const A = { ...AIRFRAME, ...(opts.airframe || {}) };
  const flags = { drag: true, camber: true, integrator: 'rk4', liftBodyNormal: false, clArea: 'wing', waterWeight: true, waterInertia: true, ...(opts.flags || {}) };
  const st = {
    x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 1000,
    vx: 0, vy: 0, vz: 0, alpha: 0.05, q: 0, lx: 0, ly: 0, lz: 1,   // l: the lift-plane normal (wings-level up)
    water: opts.water ?? 0, t: 0,
  };
  const V0 = opts.speed ?? 30, psi0 = opts.heading ?? 0;
  st.vx = V0 * Math.cos(psi0); st.vy = V0 * Math.sin(psi0);
  { const W0 = (opts.wind || (() => ({ u: 0, w: 0 })))(st.x, st.z); st.vx += W0.u; st.vz += W0.w; }
  const ctl = { de: 0, bank: 0, flap: 0, brake: 0, dump: false };
  const wind = opts.wind || (() => ({ u: 0, w: 0 }));
  const out = {};                                   // last evaluated aerodynamic state (for HUD and tests)

  const massOf = (water) => A.pilotMass + water;

  function deriv(s, d, rec) {
    const m = massOf(s.water);
    const mW = flags.waterWeight ? m : A.pilotMass, mI = flags.waterInertia ? m : A.pilotMass;
    const W = wind(s.x, s.z);
    const ax = s.vx - W.u, ay = s.vy, az = s.vz - W.w;
    const V = Math.sqrt(ax * ax + ay * ay + az * az);
    const ex = ax / V, ey = ay / V, ez = az / V;
    // the lift-plane normal l is carried as state (a bank angle measured from the vertical is singular in a loop);
    // here it is re-projected perpendicular to e
    const le = s.lx * ex + s.ly * ey + s.lz * ez;
    let lx = s.lx - le * ex, ly = s.ly - le * ey, lz = s.lz - le * ez;
    const lnn = Math.sqrt(lx * lx + ly * ly + lz * lz); lx /= lnn; ly /= lnn; lz /= lnn;
    // bank: the angle of l about e from the wings-level normal l0 (vertical's part perpendicular to e)
    let l0x = -ez * ex, l0y = -ez * ey, l0z = 1 - ez * ez;
    const ln = Math.sqrt(l0x * l0x + l0y * l0y + l0z * l0z);
    let phi = 0, rollOK = ln > 0.05;
    if (rollOK) {
      l0x /= ln; l0y /= ln; l0z /= ln;
      const s0x = ey * l0z - ez * l0y, s0y = ez * l0x - ex * l0z, s0z = ex * l0y - ey * l0x;
      phi = Math.atan2(lx * s0x + ly * s0y + lz * s0z, lx * l0x + ly * l0y + lz * l0z);
    }
    const ca = Math.cos(s.alpha), sa = Math.sin(s.alpha);
    const bxx = ca * ex + sa * lx, bxy = ca * ey + sa * ly, bxz = ca * ez + sa * lz;
    const bzx = -sa * ex + ca * lx, bzy = -sa * ey + ca * ly, bzz = -sa * ez + ca * lz;
    const qd = 0.5 * RHO0;
    let Fx = 0, Fy = 0, Fz = -mW * G0, M = 0, Lsum = 0;
    const a0 = A.alpha0 + A.flapShift * ctl.flap, clmax = A.clmax + A.clmaxFlap * ctl.flap;
    let alw = 0, clw = 0, alt = 0, clt = 0;
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      const xs = sIdx === 0 ? A.xw : A.xt;
      const vsx = ax + s.q * xs * bzx, vsy = ay + s.q * xs * bzy, vsz = az + s.q * xs * bzz;
      const vb = vsx * bxx + vsy * bxy + vsz * bxz, vn = vsx * bzx + vsy * bzy + vsz * bzz;
      const al = Math.atan2(-vn, vb), Vs2 = vsx * vsx + vsy * vsy + vsz * vsz;
      let CL, area;
      if (sIdx === 0) {
        const ae = al - a0;
        CL = A.aw * ae;
        const as = clmax / A.aw;
        if (ae > as) CL = clmax - 2.5 * (ae - as); else if (ae < -as) CL = -clmax - 2.5 * (ae + as);
        area = A.S; alw = al; clw = CL;
      } else {
        const eps = A.deps * (alw - a0);
        const ae = al - eps + A.it - A.tauE * ctl.de;
        CL = A.at * Math.max(-0.35, Math.min(0.35, ae));
        area = A.St; alt = ae; clt = CL;
      }
      const L = qd * Vs2 * area * CL;
      // lift direction: perpendicular to the local airflow, in the pitch plane, toward bz
      let dx, dy, dz;
      if (flags.liftBodyNormal) { dx = bzx; dy = bzy; dz = bzz; }
      else {
        const vm = Math.sqrt(Vs2), ux = vsx / vm, uy = vsy / vm, uz = vsz / vm;
        const dot = bzx * ux + bzy * uy + bzz * uz;
        dx = bzx - dot * ux; dy = bzy - dot * uy; dz = bzz - dot * uz;
        const dn = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= dn; dy /= dn; dz /= dn;
      }
      Fx += L * dx; Fy += L * dy; Fz += L * dz;
      M += xs * L * (dx * bzx + dy * bzy + dz * bzz);
      Lsum += L;
    }
    const qS = qd * V * V * A.S;
    const CLt = Lsum / (flags.clArea === 'wing+tail' ? qd * V * V * (A.S + A.St) : qS);
    let CD = 0;
    if (flags.drag) {
      CD = FIT.CD0 + FIT.k * CLt * CLt + A.brakeCD * ctl.brake;
      const ae = alw - a0, as = clmax / A.aw;
      if (Math.abs(ae) > as) CD += 1.2 * (Math.abs(ae) - as);
    }
    const D = qS * CD;
    Fx -= D * ex; Fy -= D * ey; Fz -= D * ez;
    if (flags.camber) M += A.cm0 * qS * A.c;
    const accx = Fx / mI, accy = Fy / mI, accz = Fz / mI;
    // the flight path's rotation in the lift plane, including the wind's change along the path (frozen field)
    const h = 1.0;
    const Wxp = wind(s.x + h, s.z), Wxm = wind(s.x - h, s.z), Wzp = wind(s.x, s.z + h), Wzm = wind(s.x, s.z - h);
    const dWu = ((Wxp.u - Wxm.u) / (2 * h)) * s.vx + ((Wzp.u - Wzm.u) / (2 * h)) * s.vz;
    const dWw = ((Wxp.w - Wxm.w) / (2 * h)) * s.vx + ((Wzp.w - Wzm.w) / (2 * h)) * s.vz;
    const dax = accx - dWu, day = accy, daz = accz - dWw;
    const along = dax * ex + day * ey + daz * ez;
    const dex = (dax - along * ex) / V, dey = (day - along * ey) / V, dez = (daz - along * ez) / V;
    const wPath = dex * lx + dey * ly + dez * lz;
    d.x = s.vx; d.y = s.vy; d.z = s.vz;
    d.vx = accx; d.vy = accy; d.vz = accz;
    d.alpha = s.q - wPath;
    d.q = M / A.I;
    const pc = Math.max(-A.maxBank, Math.min(A.maxBank, ctl.bank));
    const roll = rollOK ? (pc - phi) / A.rollTau : 0;
    // l turns with the flight path in the pitch plane, and rolls about e: dl = -wPath e + roll (e x l)
    d.lx = -wPath * ex + roll * (ey * lz - ez * ly);
    d.ly = -wPath * ey + roll * (ez * lx - ex * lz);
    d.lz = -wPath * ez + roll * (ex * ly - ey * lx);
    d.water = ctl.dump && s.water > 0 ? -A.dumpRate : 0;
    if (rec) Object.assign(out, { V, CL: CLt, CD, LD: CLt / Math.max(CD, 1e-9), clw, clt, alw, alt, Wu: W.u, Ww: W.w, M, mass: massOf(s.water), psi: Math.atan2(ay, ax), gamma: Math.asin(ez), phi, bx: [bxx, bxy, bxz], bz: [bzx, bzy, bzz], stall: Math.abs(alw - a0) > clmax / A.aw });
  }

  const KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'alpha', 'q', 'lx', 'ly', 'lz', 'water'];
  const k1 = {}, k2 = {}, k3 = {}, k4 = {}, tmp = {};
  function stepDt(dt) {
    if (flags.integrator === 'euler') {
      deriv(st, k1, true);
      for (const k of KEYS) st[k] += dt * k1[k];
    } else {
      deriv(st, k1, true);
      for (const k of KEYS) tmp[k] = st[k] + 0.5 * dt * k1[k];
      deriv(tmp, k2);
      for (const k of KEYS) tmp[k] = st[k] + 0.5 * dt * k2[k];
      deriv(tmp, k3);
      for (const k of KEYS) tmp[k] = st[k] + dt * k3[k];
      deriv(tmp, k4);
      for (const k of KEYS) st[k] += (dt / 6) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k]);
    }
    if (st.water < 0) st.water = 0;
    // keep l a unit vector perpendicular to the airspeed (a projection; forces stay perpendicular to the flow)
    { const W = wind(st.x, st.z), ax = st.vx - W.u, ay = st.vy, az = st.vz - W.w, V = Math.hypot(ax, ay, az);
      const ex = ax / V, ey = ay / V, ez = az / V, le = st.lx * ex + st.ly * ey + st.lz * ez;
      st.lx -= le * ex; st.ly -= le * ey; st.lz -= le * ez; const n = Math.hypot(st.lx, st.ly, st.lz); st.lx /= n; st.ly /= n; st.lz /= n; }
    st.t += dt;
    instruments(dt);
  }

  // instruments: TE (h + V^2/2g) and raw (h) varios through the same 1 s first-order filter
  const vario = { te: 0, raw: 0, eh: null, h: null };
  function instruments(dt) {
    const W = wind(st.x, st.z);
    const ax = st.vx - W.u, ay = st.vy, az = st.vz - W.w;
    const V2 = ax * ax + ay * ay + az * az;
    const eh = st.z + V2 / (2 * G0);
    if (vario.eh != null) {
      const a = dt / (1 + dt);
      vario.te += a * ((eh - vario.eh) / dt - vario.te);
      vario.raw += a * ((st.z - vario.h) / dt - vario.raw);
    }
    vario.eh = eh; vario.h = st.z;
  }

  const glider = {
    st, ctl, out, A, flags, vario,
    step: stepDt,
    mass: () => massOf(st.water),
    energy() { const m = massOf(st.water); return m * G0 * st.z + 0.5 * m * (st.vx ** 2 + st.vy ** 2 + st.vz ** 2) + 0.5 * A.I * st.q ** 2; },
    airspeed() { const W = wind(st.x, st.z); return Math.hypot(st.vx - W.u, st.vy, st.vz - W.w); },
    energyHeight() { const V = glider.airspeed(); return st.z + (V * V) / (2 * G0); },
    refresh() { deriv(st, k1, true); },
    /** FNV-1a over the 32-bit words of the Float64 state. */
    hash(h = 0x811c9dc5) {
      const buf = new Float64Array(KEYS.length); KEYS.forEach((k, i) => { buf[i] = st[k]; });
      const w = new Uint32Array(buf.buffer);
      for (let i = 0; i < w.length; i++) { h ^= w[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      return h >>> 0;
    },
  };
  glider.refresh();
  return glider;
}

/** Speed hold on the elevator: PI on airspeed error with acceleration damping. */
export function createSpeedHold(glider, opts = {}) {
  const Kp = opts.Kp ?? 0.02, Ki = opts.Ki ?? 0.006, Kd = opts.Kd ?? 0.08, Kq = opts.Kq ?? 0.4;
  let I = opts.de0 ?? 0, lastV = null;
  return {
    target: opts.target ?? 30,
    update(dt) {
      const V = glider.airspeed();
      const e = V - this.target;
      const dV = lastV == null ? 0 : (V - lastV) / dt; lastV = V;
      I += Ki * e * dt;
      I = Math.max(-glider.A.deMax, Math.min(glider.A.deMax, I));
      const de = I + Kp * e + Kd * dV - Kq * glider.st.q;
      glider.ctl.de = Math.max(-glider.A.deMax, Math.min(glider.A.deMax, de));
    },
  };
}
