// loom:sim
// TIDEWRIGHT's CPU reference solver: the 2D shallow-water equations for (h, hu, hv) over a bed b, cell-centred
// finite volumes on a uniform grid (dx = dy). Hydrostatic reconstruction (Audusse, Bouchut, Bristeau, Klein &
// Perthame, SIAM J. Sci. Comput. 25, 2004) makes the scheme well balanced (a lake at rest stays at rest) and keeps
// depths non-negative; the face fluxes are HLL; Manning friction is semi-implicit; time steps are a FIXED dt chosen
// within CFL from a depth cap (cflDt). The WebGL2 port (src/gpu/swe-gl.js) does the same arithmetic in float32.
//
// Only + - * / and sqrt are used (portable math, PHYSICS-PLAYBOOK pattern 20): h^(4/3) uses a Newton cube root.
// Wrong twins (tests/limits.json) are switches on the same code: scheme 'naive' (no reconstruction: the "bad maths"
// a player can toggle), and twins { davisDry, pressureTypo, zeroFilms, frictionH, culvertNo2 }.

export const G = 9.81;
export const DRY = 1e-4;                       // m: below this a cell has no velocity

/** The fixed step: 0.4 dx / (uCap + sqrt(g hCap)). */
export function cflDt(dx, hCap, uCap = 0, cfl = 0.4, g = G) { return cfl * dx / (uCap + Math.sqrt(g * hCap)); }

/** x^(1/3) for x >= 0 with + - * / only: scale into [1, 8) by powers of 8, then Newton. */
export function cbrt(x) {
  if (!(x > 0)) return 0;
  let s = 1, y = x;
  while (y >= 8) { y /= 8; s *= 2; }
  while (y < 1) { y *= 8; s /= 2; }
  let r = 1 + (y - 1) * 0.1428571428571428 * 1.4;   // a rough start in [1, 2)
  for (let k = 0; k < 7; k++) r = r - (r * r * r - y) / (3 * r * r);
  return r * s;
}

/**
 * createSolver(opts):
 *  nx, ny, dx            grid (cells), spacing (m)
 *  bed                   Float64Array(nx*ny), m (cell-centred)
 *  h, hu, hv             optional initial state arrays
 *  manning               number or Float64Array(nx*ny) (s m^-1/3); 0 = frictionless
 *  bc                    { w, e, s, n }: 'wall' | 'open'
 *  dt                    fixed step (s)
 *  scheme                'hr' (hydrostatic reconstruction) | 'naive' (bad maths)
 *  sources               [{ cells: number[], q: (t) => m^3/s }]
 *  culverts              [{ a, b, area, cd }]   a, b: cell rectangles [i0, j0, i1, j1] (inclusive);
 *                        Q = cd area sqrt(2 g |mean eta_a - mean eta_b|)
 *  twins                 { davisDry, pressureTypo, zeroFilms, frictionH, culvertNo2 }
 *  hash                  true: keep an FNV-1a hash of (h, hu, hv, hmax, b) after every step
 */
export function createSolver(o) {
  const nx = o.nx, ny = o.ny, N = nx * ny, dx = o.dx, g = o.g ?? G;
  const b = Float64Array.from(o.bed);
  const h = o.h ? Float64Array.from(o.h) : new Float64Array(N);
  const hu = o.hu ? Float64Array.from(o.hu) : new Float64Array(N);
  const hv = o.hv ? Float64Array.from(o.hv) : new Float64Array(N);
  const hmax = Float64Array.from(h);
  const man = typeof o.manning === 'number' || o.manning == null ? new Float64Array(N).fill(o.manning || 0) : Float64Array.from(o.manning);
  const bc = { w: 'wall', e: 'wall', s: 'wall', n: 'wall', ...(o.bc || {}) };
  const tw = o.twins || {};
  const naive = o.scheme === 'naive';
  const sources = o.sources || [], culverts = o.culverts || [];
  const FXh = new Float64Array((nx + 1) * ny), FXu = new Float64Array((nx + 1) * ny), FXv = new Float64Array((nx + 1) * ny);
  const FYh = new Float64Array(nx * (ny + 1)), FYu = new Float64Array(nx * (ny + 1)), FYv = new Float64Array(nx * (ny + 1));
  const src = new Float64Array(N);
  const F = new Float64Array(3);
  const half = tw.pressureTypo ? 1.0 : 0.5;
  const S = {
    nx, ny, dx, g, dt: o.dt, b, h, hu, hv, hmax, man, t: 0, n: 0,
    inflow: 0, outflow: 0, clamped: 0, hashes: o.hash ? [] : null,
    scheme: naive ? 'naive' : 'hr', sources, culverts, culvertFlow: culverts.map(() => 0),
  };

  // HLL flux normal to a face. (hL, unL, utL): reconstructed depth, normal and tangential velocity on each side.
  // Written as FL + sL ((FL - FR) + sR (UR - UL)) / (sR - sL), so equal states give FL to the bit (lake at rest).
  function hll(hL, unL, utL, hR, unR, utR) {
    if (hL <= 0 && hR <= 0) { F[0] = 0; F[1] = 0; F[2] = 0; return; }
    const cL = Math.sqrt(g * hL), cR = Math.sqrt(g * hR);
    let sL, sR;
    if (hL <= 0 && !tw.davisDry) { sL = unR - 2 * cR; sR = unR + cR; }
    else if (hR <= 0 && !tw.davisDry) { sL = unL - cL; sR = unL + 2 * cL; }
    else { sL = Math.min(unL - cL, unR - cR); sR = Math.max(unL + cL, unR + cR); }
    const qL = hL * unL, qR = hR * unR;
    const f0L = qL, f1L = qL * unL + half * g * hL * hL, f2L = qL * utL;
    if (sL >= 0 && !tw.hllNoBranches) { F[0] = f0L; F[1] = f1L; F[2] = f2L; return; }
    const f0R = qR, f1R = qR * unR + half * g * hR * hR, f2R = qR * utR;
    if (sR <= 0 && !tw.hllNoBranches) { F[0] = f0R; F[1] = f1R; F[2] = f2R; return; }
    const k = sL / (sR - sL);
    F[0] = f0L + k * ((f0L - f0R) + sR * (hR - hL));
    F[1] = f1L + k * ((f1L - f1R) + sR * (qR - qL));
    F[2] = f2L + k * ((f2L - f2R) + sR * (hR * utR - hL * utL));
  }
  // desingularised velocity (Kurganov & Petrova 2007): q/h above the dry threshold, smoothly to 0 below it
  const D4 = DRY * DRY * DRY * DRY;
  const rectCells = ([i0, j0, i1, j1]) => { const out = []; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(j * nx + i); return out; };
  const vel = (hh, q) => { if (!(hh > 0)) return 0; if (hh >= DRY) return q / hh; const h4 = hh * hh * hh * hh; return (1.4142135623730951 * hh * q) / Math.sqrt(h4 + D4); };

  // one face: left cell state (h, normal q, tangential q, b), right cell state
  function face(hl, ql, tl, bl, hr, qr, tr, br) {
    const unL = vel(hl, ql), utL = vel(hl, tl), unR = vel(hr, qr), utR = vel(hr, tr);
    if (naive) { hll(hl, unL, utL, hr, unR, utR); return; }
    const bm = bl > br ? bl : br;
    let a = hl + bl - bm; if (a < 0) a = 0;
    let c = hr + br - bm; if (c < 0) c = 0;
    hll(a, unL, utL, c, unR, utR);
  }

  // ghost-cell beds: a wall mirrors the edge cell; an open side continues the bed's slope (2 b_edge - b_inner),
  // so a uniform flow leaves without a backwater from a flat outlet
  const ghostW = (k) => (bc.w === 'open' && nx > 1 ? 2 * b[k] - b[k + 1] : b[k]);
  const ghostE = (k) => (bc.e === 'open' && nx > 1 ? 2 * b[k] - b[k - 1] : b[k]);
  const ghostS = (k) => (bc.s === 'open' && ny > 1 ? 2 * b[k] - b[k + nx] : b[k]);
  const ghostN = (k) => (bc.n === 'open' && ny > 1 ? 2 * b[k] - b[k - nx] : b[k]);

  function fluxes() {
    // x faces: index i + j (nx + 1), face i lies between cells i-1 and i
    for (let j = 0; j < ny; j++) {
      const row = j * nx, fr = j * (nx + 1);
      for (let i = 0; i <= nx; i++) {
        let kl = row + i - 1, kr = row + i;
        let hl, ql, tl, bl, hr, qr, tr, br;
        if (i === 0) {
          hr = h[kr]; qr = hu[kr]; tr = hv[kr]; br = b[kr];
          hl = hr; tl = tr; bl = ghostW(kr); ql = bc.w === 'wall' ? -qr : qr;
        } else if (i === nx) {
          hl = h[kl]; ql = hu[kl]; tl = hv[kl]; bl = b[kl];
          hr = hl; tr = tl; br = ghostE(kl); qr = bc.e === 'wall' ? -ql : ql;
        } else {
          hl = h[kl]; ql = hu[kl]; tl = hv[kl]; bl = b[kl];
          hr = h[kr]; qr = hu[kr]; tr = hv[kr]; br = b[kr];
        }
        if (hl <= 0 && hr <= 0) { FXh[fr + i] = 0; FXu[fr + i] = 0; FXv[fr + i] = 0; continue; }   // dry | dry: no flux
        face(hl, ql, tl, bl, hr, qr, tr, br);
        FXh[fr + i] = F[0]; FXu[fr + i] = F[1]; FXv[fr + i] = F[2];
      }
    }
    // y faces: index i + j nx, face j lies between cells j-1 and j (normal = v)
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const kl = (j - 1) * nx + i, kr = j * nx + i;
        let hl, ql, tl, bl, hr, qr, tr, br;
        if (j === 0) {
          hr = h[kr]; qr = hv[kr]; tr = hu[kr]; br = b[kr];
          hl = hr; tl = tr; bl = ghostS(kr); ql = bc.s === 'wall' ? -qr : qr;
        } else if (j === ny) {
          hl = h[kl]; ql = hv[kl]; tl = hu[kl]; bl = b[kl];
          hr = hl; tr = tl; br = ghostN(kl); qr = bc.n === 'wall' ? -ql : ql;
        } else {
          hl = h[kl]; ql = hv[kl]; tl = hu[kl]; bl = b[kl];
          hr = h[kr]; qr = hv[kr]; tr = hu[kr]; br = b[kr];
        }
        const f = j * nx + i;
        if (hl <= 0 && hr <= 0) { FYh[f] = 0; FYv[f] = 0; FYu[f] = 0; continue; }
        face(hl, ql, tl, bl, hr, qr, tr, br);
        FYh[f] = F[0]; FYv[f] = F[1]; FYu[f] = F[2];
      }
    }
  }

  // the reconstructed depth this cell shows at the face it shares with a neighbour of bed bn
  const rec = (hh, bb, bn) => { const bm = bb > bn ? bb : bn; const a = hh + bb - bm; return a > 0 ? a : 0; };

  function step() {
    const dt = S.dt, r = dt / dx, t = S.t;
    fluxes();
    src.fill(0);
    for (const s of sources) {
      const q = s.q(t);
      const dh = q * dt / (s.cells.length * dx * dx);
      for (const k of s.cells) src[k] += dh;
      S.inflow += q * dt;
    }
    for (let c = 0; c < culverts.length; c++) {
      // a culvert joins two rectangles of cells (its inlet and outlet pools): the mean levels drive it, the flow
      // is split evenly over the cells, and it never takes more than a quarter of the upstream pool per step
      const cv = culverts[c], A = cv.cellsA || (cv.cellsA = rectCells(cv.a)), B = cv.cellsB || (cv.cellsB = rectCells(cv.b));
      let ea = 0, eb = 0, ha = 0, hb = 0;
      for (const k of A) { ea += h[k] + b[k]; ha += h[k]; }
      for (const k of B) { eb += h[k] + b[k]; hb += h[k]; }
      ea /= A.length; eb /= B.length;
      const d = ea - eb;
      let q = cv.cd * cv.area * Math.sqrt((tw.culvertNo2 ? 1 : 2) * g * (d > 0 ? d : -d));
      const cap = 0.25 * (d > 0 ? ha : hb) * dx * dx / dt;
      if (q > cap) q = cap;
      if (d < 0) q = -q;
      const da = q * dt / (A.length * dx * dx), db = q * dt / (B.length * dx * dx);
      for (const k of A) src[k] -= da;
      for (const k of B) src[k] += db;
      S.culvertFlow[c] = q;
    }
    // boundary outflow (open sides): mass through the outer faces
    let out = 0;
    for (let j = 0; j < ny; j++) {
      if (bc.w === 'open') out -= FXh[j * (nx + 1)];
      if (bc.e === 'open') out += FXh[j * (nx + 1) + nx];
    }
    for (let i = 0; i < nx; i++) {
      if (bc.s === 'open') out -= FYh[i];
      if (bc.n === 'open') out += FYh[ny * nx + i];
    }
    S.outflow += out * dt * dx;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, fx = j * (nx + 1) + i, fy = j * nx + i;
        const hk = h[k], bk = b[k];
        // a dry cell with no flux through any face and no source stays dry and still (the same numbers, sooner)
        if (hk === 0 && src[k] === 0 && FXh[fx] === 0 && FXh[fx + 1] === 0 && FYh[fy] === 0 && FYh[fy + nx] === 0 &&
            FXu[fx] === 0 && FXu[fx + 1] === 0 && FYv[fy] === 0 && FYv[fy + nx] === 0 && FXv[fx] === 0 && FXv[fx + 1] === 0 &&
            FYu[fy] === 0 && FYu[fy + nx] === 0 && hu[k] === 0 && hv[k] === 0) continue;
        let hn = hk - r * (FXh[fx + 1] - FXh[fx]) - r * (FYh[fy + nx] - FYh[fy]) + src[k];
        let un, vn;
        if (naive) {
          // central bed slope source -g h db/dx: not balanced against the HLL pressure flux
          const bw = i > 0 ? b[k - 1] : ghostW(k), be = i < nx - 1 ? b[k + 1] : ghostE(k);
          const bs = j > 0 ? b[k - nx] : ghostS(k), bn = j < ny - 1 ? b[k + nx] : ghostN(k);
          un = hu[k] - r * (FXu[fx + 1] - FXu[fx]) - r * (FYu[fy + nx] - FYu[fy]) - dt * g * hk * (be - bw) / (2 * dx);
          vn = hv[k] - r * (FXv[fx + 1] - FXv[fx]) - r * (FYv[fy + nx] - FYv[fy]) - dt * g * hk * (bn - bs) / (2 * dx);
        } else {
          // Audusse: + g/2 (h_{i+1/2-}^2 - h_{i-1/2+}^2) / dx, with the cell's own reconstructed depths
          const bw = i > 0 ? b[k - 1] : ghostW(k), be = i < nx - 1 ? b[k + 1] : ghostE(k);
          const bs = j > 0 ? b[k - nx] : ghostS(k), bn = j < ny - 1 ? b[k + nx] : ghostN(k);
          const he = rec(hk, bk, be), hw = rec(hk, bk, bw), hN = rec(hk, bk, bn), hs = rec(hk, bk, bs);
          const pe = half * g * he * he, pw = half * g * hw * hw, pn = half * g * hN * hN, ps = half * g * hs * hs;
          un = hu[k] - r * ((FXu[fx + 1] - pe) - (FXu[fx] - pw)) - r * (FYu[fy + nx] - FYu[fy]);
          vn = hv[k] - r * ((FYv[fy + nx] - pn) - (FYv[fy] - ps)) - r * (FXv[fx + 1] - FXv[fx]);
        }
        if (hn < 0) { S.clamped -= hn * dx * dx; hn = 0; }
        if (tw.zeroFilms && hn < DRY) hn = 0;
        if (hn < DRY) { const u = vel(hn, un), v = vel(hn, vn); un = hn * u; vn = hn * v; }
        else if (man[k] > 0) {
          const u = un / hn, v = vn / hn, sp = Math.sqrt(u * u + v * v);
          const h43 = tw.frictionH ? hn : hn * cbrt(hn);
          const f = 1 + dt * g * man[k] * man[k] * sp / h43;
          un /= f; vn /= f;
        }
        h[k] = hn; hu[k] = un; hv[k] = vn;
        if (hn > hmax[k]) hmax[k] = hn;
      }
    }
    S.t = t + dt; S.n++;
    if (S.hashes) S.hashes.push(hashState());
  }

  // the hash covers every array the next step depends on or reports: the water, its maximum, and the bed
  const u32 = [h, hu, hv, hmax, b].map((a) => new Uint32Array(a.buffer));
  function hashState() {
    let x = 0x811c9dc5;
    for (const a of u32) for (let k = 0; k < a.length; k++) { x ^= a[k]; x = Math.imul(x, 0x01000193); }
    return x >>> 0;
  }
  function volume() { let v = 0; for (let k = 0; k < N; k++) v += h[k]; return v * dx * dx; }
  function maxSpeed() { let m = 0; for (let k = 0; k < N; k++) if (h[k] > DRY) { const u = hu[k] / h[k], v = hv[k] / h[k]; const s = Math.sqrt(u * u + v * v); if (s > m) m = s; } return m; }
  function courant() { let m = 0; for (let k = 0; k < N; k++) if (h[k] > DRY) { const c = Math.sqrt(g * h[k]); const s = Math.abs(hu[k] / h[k]) + c, s2 = Math.abs(hv[k] / h[k]) + c; if (s > m) m = s; if (s2 > m) m = s2; } return m * S.dt / dx; }
  Object.assign(S, { step, run(n) { for (let k = 0; k < n; k++) step(); }, volume, maxSpeed, courant, hashState });
  return S;
}

/** FNV-1a over a list of 32-bit hashes' decimal text, for a trace stamp. */
export function traceHash(hashes) {
  let x = 0x811c9dc5;
  const s = hashes.join(',');
  for (let k = 0; k < s.length; k++) { x ^= s.charCodeAt(k); x = Math.imul(x, 0x01000193); }
  return (x >>> 0).toString(16).padStart(8, '0');
}
