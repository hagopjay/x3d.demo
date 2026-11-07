/* stemkit/js/nets.js (copied into each study's src/; tests keep the copies identical).
   Surface nets in the browser: a line-for-line port of lib/stemkit/mesh.py (surface_nets with two Newton
   projections, trilinear sampling, numpy-style gradients, vertex normals). The page meshes the verified
   fields itself and compares its vertex and triangle counts and enclosed volume with the builder's, frame by
   frame, so a porting slip shows up as a red row instead of a slightly wrong garden. */
"use strict";
const Nets = (() => {
  // corner c = x + 2y + 4z, listed z-major as in mesh.py
  const CORNERS = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) CORNERS.push([x, y, z]);
  const EDGES = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    const d = Math.abs(CORNERS[a][0] - CORNERS[b][0]) + Math.abs(CORNERS[a][1] - CORNERS[b][1]) + Math.abs(CORNERS[a][2] - CORNERS[b][2]);
    if (d === 1) EDGES.push([a, b]);
  }

  /* Pad an n^3 field of quantized values with one layer of 0, as (q / top) * vmax in float64. With abs, the
     magnitude |q| is used (signed fields are meshed by magnitude; the sign is read separately for colour),
     exactly as the Python builders do: pad(abs(q) / top * vmax). */
  function displayField(q, n, top, vmax, abs = false) {
    const m = n + 2, f = new Float64Array(m * m * m);
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const src = (x * n + y) * n, dst = ((x + 1) * m + (y + 1)) * m + 1;
      for (let z = 0; z < n; z++) f[dst + z] = ((abs ? Math.abs(q[src + z]) : q[src + z]) / top) * vmax;
    }
    return { f, shape: [m, m, m] };
  }

  /* numpy.gradient with unit spacing: central differences inside, first-order one-sided at the ends. */
  function gradient(F) {
    const [nx, ny, nz] = F.shape, f = F.f, sx = ny * nz, sy = nz, n = f.length;
    const g = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
      const i = x * sx + y * sy + z;
      g[0][i] = x === 0 ? f[i + sx] - f[i] : x === nx - 1 ? f[i] - f[i - sx] : (f[i + sx] - f[i - sx]) / 2;
      g[1][i] = y === 0 ? f[i + sy] - f[i] : y === ny - 1 ? f[i] - f[i - sy] : (f[i + sy] - f[i - sy]) / 2;
      g[2][i] = z === 0 ? f[i + 1] - f[i] : z === nz - 1 ? f[i] - f[i - 1] : (f[i + 1] - f[i - 1]) / 2;
    }
    return g;
  }

  /* Trilinear sample of array a (shape of F) at p = [x, y, z]; p is clamped to the grid like mesh.py. */
  function trilinear(a, shape, x, y, z) {
    const hx = shape[0] - 1, hy = shape[1] - 1, hz = shape[2] - 1;
    const ix = Math.min(Math.floor(x), hx - 1), iy = Math.min(Math.floor(y), hy - 1), iz = Math.min(Math.floor(z), hz - 1);
    const tx = x - ix, ty = y - iy, tz = z - iz, sx = shape[1] * shape[2], sy = shape[2];
    let out = 0;
    for (const [cx, cy, cz] of CORNERS) {
      const w = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz);
      out += w * a[(ix + cx) * sx + (iy + cy) * sy + (iz + cz)];
    }
    return out;
  }

  /* Exact gradient of the trilinear interpolant (mesh.py trilinear_grad): Newton's own derivative. */
  function trilinearGrad(a, shape, x, y, z) {
    const hx = shape[0] - 1, hy = shape[1] - 1, hz = shape[2] - 1;
    const ix = Math.min(Math.floor(x), hx - 1), iy = Math.min(Math.floor(y), hy - 1), iz = Math.min(Math.floor(z), hz - 1);
    const tx = x - ix, ty = y - iy, tz = z - iz, sx = shape[1] * shape[2], sy = shape[2];
    let gx = 0, gy = 0, gz = 0;
    for (const [cx, cy, cz] of CORNERS) {
      const fv = a[(ix + cx) * sx + (iy + cy) * sy + (iz + cz)];
      const wx = cx ? tx : 1 - tx, wy = cy ? ty : 1 - ty, wz = cz ? tz : 1 - tz;
      gx += (cx ? 1 : -1) * wy * wz * fv; gy += (cy ? 1 : -1) * wx * wz * fv; gz += (cz ? 1 : -1) * wx * wy * fv;
    }
    return [gx, gy, gz];
  }

  function surfaceNets(F, iso, project = 3) {
    const [nx, ny, nz] = F.shape, f = F.f, sx = ny * nz, sy = nz;
    const cx = nx - 1, cy = ny - 1, cz = nz - 1;
    const cellIndex = new Int32Array(cx * cy * cz).fill(-1);
    const pos = [];
    const c = new Float64Array(8);
    for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) for (let k = 0; k < cz; k++) {
      let above = 0;
      for (let m = 0; m < 8; m++) {
        const [ox, oy, oz] = CORNERS[m];
        c[m] = f[(i + ox) * sx + (j + oy) * sy + (k + oz)];
        if (c[m] > iso) above++;
      }
      if (above === 0 || above === 8) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        const fa = c[a], fb = c[b];
        if ((fa > iso) === (fb > iso)) continue;
        const t = (iso - fa) / (fb - fa), A = CORNERS[a], B = CORNERS[b];
        ax += A[0] + t * (B[0] - A[0]); ay += A[1] + t * (B[1] - A[1]); az += A[2] + t * (B[2] - A[2]); cnt++;
      }
      cellIndex[(i * cy + j) * cz + k] = pos.length / 3;
      pos.push(i + ax / cnt, j + ay / cnt, k + az / cnt);
    }
    const V = pos.length / 3, P = new Float64Array(pos);
    const G = gradient(F);      // smooth central differences, for shading normals only
    if (project) {
      const hi = [nx - 1, ny - 1, nz - 1];
      for (let s = 0; s < project; s++) for (let v = 0; v < V; v++) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
        const [gx, gy, gz] = trilinearGrad(f, F.shape, x, y, z);
        const g2 = gx * gx + gy * gy + gz * gz;
        const r = g2 > 1e-24 ? (trilinear(f, F.shape, x, y, z) - iso) / g2 : 0;
        let dx = r * gx, dy = r * gy, dz = r * gz;
        const ln = Math.hypot(dx, dy, dz), cap = Math.min(1, 0.5 / Math.max(ln, 1e-300));
        dx *= cap; dy *= cap; dz *= cap;
        P[3 * v] = Math.min(Math.max(x - dx, 0), hi[0]);
        P[3 * v + 1] = Math.min(Math.max(y - dy, 0), hi[1]);
        P[3 * v + 2] = Math.min(Math.max(z - dz, 0), hi[2]);
      }
    }
    // faces: one quad per sign-changing grid edge, counter-clockwise about +axis when f(p) > iso
    const t1 = [], t2 = [];
    const dist2 = (a, b) => { const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2]; return dx * dx + dy * dy + dz * dz; };
    const cell = (p) => cellIndex[(p[0] * cy + p[1]) * cz + p[2]];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, w = (axis + 2) % 3, step = [sx, sy, 1][axis], shape = [nx, ny, nz], lim = [nx, ny, nz];
      lim[axis] -= 1;
      for (let x = 0; x < lim[0]; x++) for (let y = 0; y < lim[1]; y++) for (let z = 0; z < lim[2]; z++) {
        const i0 = x * sx + y * sy + z, e0 = f[i0] > iso, e1 = f[i0 + step] > iso;
        if (e0 === e1) continue;
        const p = [x, y, z], q = [];
        for (const [du, dw] of [[-1, -1], [0, -1], [0, 0], [-1, 0]]) {
          const cc = p.slice(); cc[u] += du; cc[w] += dw;
          if (cc[u] < 0 || cc[w] < 0 || cc[u] > shape[u] - 2 || cc[w] > shape[w] - 2) throw Error("MESH_OPEN_AT_BOUNDARY");
          const id = cell(cc);
          if (id < 0) throw Error("MESH_DANGLING_QUAD");
          q.push(id);
        }
        if (!e0) q.reverse();
        if (dist2(q[0], q[2]) <= dist2(q[1], q[3])) { t1.push(q[0], q[1], q[2]); t2.push(q[0], q[2], q[3]); }
        else { t1.push(q[0], q[1], q[3]); t2.push(q[1], q[2], q[3]); }
      }
    }
    const index = new Int32Array(t1.length + t2.length);
    index.set(t1, 0); index.set(t2, t1.length);
    // normals from the field gradient, pointing from high to low
    const N = new Float32Array(3 * V);
    for (let v = 0; v < V; v++) {
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      const gx = -trilinear(G[0], F.shape, x, y, z), gy = -trilinear(G[1], F.shape, x, y, z), gz = -trilinear(G[2], F.shape, x, y, z);
      const l = Math.hypot(gx, gy, gz) || 1;
      N[3 * v] = gx / l; N[3 * v + 1] = gy / l; N[3 * v + 2] = gz / l;
    }
    return { positions: P, normals: N, index, vertices: V, triangles: index.length / 3 };
  }

  /* Divergence-theorem volume of the closed mesh (cells^3), as mesh.py computes it. */
  function volume(m) {
    const P = m.positions, I = m.index;
    let s = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const cx = P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1], cy = P[b + 2] * P[c] - P[b] * P[c + 2], cz = P[b] * P[c + 1] - P[b + 1] * P[c];
      s += P[a] * cx + P[a + 1] * cy + P[a + 2] * cz;
    }
    return s / 6;
  }

  return { displayField, surfaceNets, volume, trilinear, CORNERS };
})();
