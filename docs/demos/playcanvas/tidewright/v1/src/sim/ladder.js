// The analytic ladder's cases, written once and run by two hosts: Node (tests/ladder.test.mjs, the CPU solver) and
// headless Chromium (tools/gpu-gate.cjs, the CPU solver and the WebGL2 port side by side). A case is plain data
// (grid, bed, initial state, boundaries, dt, steps) plus measure(state) -> metrics; `scale` refines the grid.
import { G, cflDt } from './swe.js';
import { ritter, stoker, stokerStructure, thacker, thackerBed, thackerOmega, manningNormalDepth, orificeDrain } from './analytic.js';

function line(nx, dx, fn) { const bed = new Float64Array(nx), h = new Float64Array(nx); for (let i = 0; i < nx; i++) { const x = (i + 0.5) * dx; const r = fn(x); bed[i] = r.b || 0; h[i] = r.h; } return { bed, h }; }

function damBreak(kind, scale = 1) {
  const L = 1000, x0 = 500, hl = 1, hr = kind === 'ritter' ? 0 : 0.1, T = 40;
  const nx = Math.round(400 * scale), dx = L / nx, cl = Math.sqrt(G * hl);
  const { bed, h } = line(nx, dx, (x) => ({ h: x < x0 ? hl : hr }));
  const dt = cflDt(dx, hl, cl), steps = Math.round(T / dt);
  const st = kind === 'stoker' ? stokerStructure(hl, hr) : null;
  return {
    id: kind, nx, ny: 1, dx, bed, h, dt, steps, manning: 0, bc: { w: 'wall', e: 'wall', s: 'wall', n: 'wall' },
    measure(S) {
      const t = steps * dt, exact = (x) => (kind === 'ritter' ? ritter(x, t, hl, x0) : stoker(x, t, hl, hr, x0, G, st));
      const xa = x0 - cl * t - 25, xb = x0 + (kind === 'ritter' ? 2 * cl * t : st.shock * t) + 25;
      let e = 0, ref = 0, xf = -Infinity, xs = -Infinity;
      const tip = 1e-3, mid = st ? 0.5 * (st.hm + hr) : 0;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, he = exact(x).h, hn = S.h[i];
        if (x >= xa && x <= xb) { e += Math.abs(hn - he); ref += he; }
        if (hn > tip) xf = x;
        if (st && hn > mid) xs = x;
      }
      const m = { t, l1_rel: e / ref, steps, dx, dt };
      if (kind === 'ritter') {
        const xtip = x0 + (2 * cl - Math.sqrt(9 * G * tip)) * t;
        m.front_m = xf; m.front_exact_m = xtip; m.front_ideal_m = x0 + 2 * cl * t;
        m.front_rel = Math.abs(xf + 0.5 * dx - xtip) / (2 * cl * t);
      } else {
        m.shock_m = xs + 0.5 * dx; m.shock_exact_m = x0 + st.shock * t; m.shock_rel = Math.abs(m.shock_m - m.shock_exact_m) / (st.shock * t);
        m.hm_exact = st.hm;
      }
      return m;
    },
  };
}

export const ritterCase = (scale) => damBreak('ritter', scale);
export const stokerCase = (scale) => damBreak('stoker', scale);

/** Lake at rest over a bumpy bed with dry islands and a slope: |u| must stay at round-off. */
export function lakeCase(scale = 1) {
  const nx = Math.round(64 * scale), ny = Math.round(64 * scale), dx = 10 / scale, eta = 1.0, N = nx * ny;
  const bed = new Float64Array(N), h = new Float64Array(N);
  const bumps = [[150, 200, 60, 1.3], [420, 380, 80, 0.9], [300, 520, 50, 1.6], [520, 120, 70, 0.7], [90, 520, 40, 1.1]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
    let z = 0.002 * x - 0.4 + 0.15 * Math.sin(x / 37) * Math.cos(y / 53);
    for (const [bx, by, r, a] of bumps) { const d2 = ((x - bx) ** 2 + (y - by) ** 2) / (r * r); z += a * Math.exp(-d2); }
    bed[j * nx + i] = z; h[j * nx + i] = Math.max(0, eta - z);
  }
  const dt = cflDt(dx, 1.5), steps = 2000;
  return {
    id: 'lake', nx, ny, dx, bed, h, dt, steps, manning: 0.03, bc: {},
    measure(S) {
      let umax = 0, dry = 0, wet = 0;
      for (let k = 0; k < N; k++) { if (S.h[k] > 1e-4) { wet++; const u = S.hu[k] / S.h[k], v = S.hv[k] / S.h[k]; umax = Math.max(umax, Math.sqrt(u * u + v * v)); } else dry++; }
      return { umax, wet, dry, steps, t: steps * dt };
    },
  };
}

/** Thacker's planar surface in a paraboloid: an exact moving shoreline. Measured after one period. */
export function thackerCase(scale = 1, periods = 1) {
  const p = { a: 1, h0: 0.1, eta: 0.5, cx: 2, cy: 2 }, L = 4;
  const nx = Math.round(100 * scale), dx = L / nx, N = nx * nx, w = thackerOmega(p);
  const bed = new Float64Array(N), h = new Float64Array(N), hu = new Float64Array(N), hv = new Float64Array(N);
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dx, k = j * nx + i, e = thacker(x, y, 0, p);
    bed[k] = thackerBed(x, y, p); h[k] = e.h; hu[k] = e.h * e.u; hv[k] = e.h * e.v;
  }
  const T = (2 * Math.PI) / w, dt = cflDt(dx, p.h0, p.eta * w), steps = Math.round((periods * T) / dt);
  return {
    id: 'thacker', nx, ny: nx, dx, bed, h, hu, hv, dt, steps, manning: 0, bc: {},
    measure(S) {
      const t = steps * dt;
      let e = 0, ref = 0, vol = 0, mx = 0, my = 0, ex = null;
      for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx, y = (j + 0.5) * dx, k = j * nx + i, he = thacker(x, y, t, p);
        ex = he; e += Math.abs(S.h[k] - he.h); ref += he.h;
        vol += S.h[k]; mx += S.h[k] * x; my += S.h[k] * y;
      }
      const cx = mx / vol, cy = my / vol;
      return { t, periods, steps, dx, l1_rel: e / ref, centroid: [cx, cy], centroid_exact: [ex.cx, ex.cy], shoreline_rel: Math.hypot(cx - ex.cx, cy - ex.cy) / p.a };
    },
  };
}

/** A closed basin, wet and dry, with friction, sloshing for one simulated hour: the volume must not change. */
export function conservationCase(scale = 1, seconds = 3600) {
  const nx = Math.round(96 * scale), ny = Math.round(96 * scale), dx = 5 / scale, N = nx * ny;
  const bed = new Float64Array(N), h = new Float64Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx - 240, y = (j + 0.5) * dx - 240;
    const z = 2.2 * ((x * x + y * y) / (240 * 240)) - 0.6 + 0.35 * Math.sin(x / 23) * Math.sin(y / 31) + 0.9 * Math.exp(-((x - 60) ** 2 + (y + 40) ** 2) / 900);
    bed[j * nx + i] = z;
    const eta = 0.6 + 0.004 * x + 0.8 * Math.exp(-((x + 90) ** 2 + (y - 70) ** 2) / 1600);
    h[j * nx + i] = Math.max(0, eta - z);
  }
  const dt = cflDt(dx, 3), steps = Math.round(seconds / dt);
  return {
    id: 'conservation', nx, ny, dx, bed, h, dt, steps, manning: 0.03, bc: {},
    measure(S, V0) { const V = S.volume(); return { V0, V, rel: Math.abs(V - V0) / V0, clamped_m3: S.clamped, steps, t: steps * dt }; },
  };
}

/** A long uniform channel fed q m^2/s at the top: the middle settles at Manning's normal depth. */
export function manningCase(scale = 1) {
  const L = 3000, nx = Math.round(300 * scale), dx = L / nx, S0 = 1e-3, n = 0.03, q = 2;
  const bed = new Float64Array(nx); for (let i = 0; i < nx; i++) bed[i] = S0 * (L - (i + 0.5) * dx);
  const dt = cflDt(dx, 3, 2), steps = Math.round(3 * 3600 / dt);
  return {
    id: 'manning', nx, ny: 1, dx, bed, h: new Float64Array(nx), dt, steps, manning: n, bc: { w: 'wall', e: 'open' },
    sources: [{ cells: [0], q: () => q * dx }],          // q per metre of width; the cell is dx wide
    measure(S) {
      let sum = 0, c = 0, qs = 0;
      for (let i = 0; i < nx; i++) { const x = (i + 0.5) * dx; if (x >= 1000 && x <= 2000) { sum += S.h[i]; qs += S.hu[i]; c++; } }
      const hn = manningNormalDepth(q, n, S0), hmid = sum / c;
      return { h_mid: hmid, h_normal: hn, rel: Math.abs(hmid - hn) / hn, q_mid: qs / c, steps, t: steps * dt };
    },
  };
}

/** Two tanks joined by a culvert: the level difference drains as the orifice law says. */
export function culvertCase(scale = 1) {
  const nx = 41 * scale, ny = 20 * scale, dx = 1 / scale, N = nx * ny, wall = 20 * scale;
  const bed = new Float64Array(N), h = new Float64Array(N);
  const left = [], right = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (i < wall) { h[k] = 2; left.push(k); } else if (i > wall) { h[k] = 1; right.push(k); } else bed[k] = 5;
  }
  const A1 = left.length * dx * dx, A2 = right.length * dx * dx;
  const m = ny >> 1, ca = wall >> 1, cb = wall + 1 + (wall >> 1);
  const cv = { a: [ca - 2, m - 2, ca + 2, m + 2], b: [cb - 2, m - 2, cb + 2, m + 2], area: 0.05, cd: 0.8 };      // 5 x 5 pools
  const dt = cflDt(dx, 2.5), steps = Math.round(1000 / dt), every = Math.round(100 / dt);
  return {
    id: 'culvert', nx, ny, dx, bed, h, dt, steps, every, manning: 0, bc: {}, culverts: [cv],
    sample(S) {
      let e1 = 0, e2 = 0; for (const k of left) e1 += S.h[k]; for (const k of right) e2 += S.h[k];
      return e1 / left.length - e2 / right.length;
    },
    measure(S, samples) {
      let worst = 0;
      const rows = samples.map(([t, D]) => { const De = orificeDrain(1, t, { cd: cv.cd, a: cv.area, A1, A2 }); const r = Math.abs(D - De) / De; worst = Math.max(worst, r); return [t, D, De]; });
      return { worst_rel: worst, rows, A1, A2 };
    },
  };
}

export const CASES = { ritter: ritterCase, stoker: stokerCase, lake: lakeCase, thacker: thackerCase, conservation: conservationCase, manning: manningCase, culvert: culvertCase };
