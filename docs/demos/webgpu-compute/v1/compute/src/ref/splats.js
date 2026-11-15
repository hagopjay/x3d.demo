/* CPU reference for splats.wgsl: projection in f64 from the same f32 inputs, and a CPU sort of the GPU's own keys to check the bitonic network exactly. */
export function lookAt(eye, target = [0, 0, 0], up = [0, 1, 0]) {   // column-major view matrix, camera looks down -Z
  const sub = (a, b) => a.map((x, i) => x - b[i]), nrm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); }, cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = nrm(sub(target, eye)), r = nrm(cr(f, up)), u = cr(r, f);
  return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dt(r, eye), -dt(u, eye), dt(f, eye), 1]);
}
export function packCam(C) { const a = new ArrayBuffer(96), fl = new Float32Array(a), u = new Uint32Array(a); fl.set(C.view, 0); fl[16] = C.fx; fl[17] = C.fy; fl[18] = C.w; fl[19] = C.h; u[20] = C.n; fl[21] = C.znear; return a; }
export function project(C, pos, scl, quat, n) {
  const out = new Float32Array(n * 8), vis = new Uint8Array(n), zs = new Float64Array(n), why = new Uint8Array(n), V = C.view;   // why: 0 visible, 1 behind / inside znear, 2 degenerate covariance, 3 off screen
  for (let i = 0; i < n; i++) {
    const px = pos[i * 4], py = pos[i * 4 + 1], pz = pos[i * 4 + 2];
    const tx = V[0] * px + V[4] * py + V[8] * pz + V[12], ty = V[1] * px + V[5] * py + V[9] * pz + V[13], tz = V[2] * px + V[6] * py + V[10] * pz + V[14], z = -tz;
    zs[i] = z; if (!(z > C.znear)) { why[i] = 1; continue; }
    const [x, y, zq, w] = [quat[i * 4], quat[i * 4 + 1], quat[i * 4 + 2], quat[i * 4 + 3]], s = [scl[i * 4], scl[i * 4 + 1], scl[i * 4 + 2]];
    const R = [[1 - 2 * (y * y + zq * zq), 2 * (x * y - w * zq), 2 * (x * zq + w * y)], [2 * (x * y + w * zq), 1 - 2 * (x * x + zq * zq), 2 * (y * zq - w * x)], [2 * (x * zq - w * y), 2 * (y * zq + w * x), 1 - 2 * (x * x + y * y)]];
    const Wm = [[V[0], V[4], V[8]], [V[1], V[5], V[9]], [V[2], V[6], V[10]]];
    const M = R.map((row) => row.map((e, k) => e * s[k]));
    const T = Wm.map((row) => [0, 1, 2].map((k) => row[0] * M[0][k] + row[1] * M[1][k] + row[2] * M[2][k]));
    const j0 = [C.fx / z, 0, C.fx * tx / (z * z)], j1 = [0, -C.fy / z, -C.fy * ty / (z * z)];
    const u0 = [0, 1, 2].map((k) => j0[0] * T[0][k] + j0[1] * T[1][k] + j0[2] * T[2][k]), u1 = [0, 1, 2].map((k) => j1[0] * T[0][k] + j1[1] * T[1][k] + j1[2] * T[2][k]);
    const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cxx = d(u0, u0) + 0.3, cxy = d(u0, u1), cyy = d(u1, u1) + 0.3, det = cxx * cyy - cxy * cxy;
    if (!(det > 1e-12)) { why[i] = 2; continue; }
    const mid = 0.5 * (cxx + cyy), lam = mid + Math.sqrt(Math.max(0.1, mid * mid - det)), rad = Math.ceil(3 * Math.sqrt(lam)), cx = C.fx * tx / z + 0.5 * C.w, cy = -C.fy * ty / z + 0.5 * C.h;
    if (cx + rad < 0 || cx - rad > C.w || cy + rad < 0 || cy - rad > C.h) { why[i] = 3; continue; }
    out.set([cx, cy, cyy / det, -cxy / det, cxx / det, rad, pos[i * 4 + 3], z], i * 8); vis[i] = 1;
  }
  return { out, vis, zs, why };
}
/* order a (key, value) set the way the shader's compare does */
export function sortPairs(keys, vals) { const idx = Array.from(keys.keys()).sort((a, b) => keys[a] - keys[b] || vals[a] - vals[b]); return idx.map((i) => vals[i]); }
export const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(512, n)));   // >= 512: the tiled sort works on 512-element tiles
/* naive bitonic passes: [[j,k],...] */
export function passes(n) { const l = []; for (let k = 2; k <= n; k <<= 1) for (let j = k >> 1; j > 0; j >>= 1) l.push([j, k]); return l; }
/* deterministic splat cloud: a thick disc ("pavilion floor") of n anisotropic gaussians with random yaw; fromX3D reads the same fields X_ITE's GaussianSplats uses */
export function cloud(n, seed = 7, R = 6, randomQuat = false) {
  let s = seed >>> 0; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pos = new Float32Array(n * 4), scl = new Float32Array(n * 4), quat = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = r() * 2 * Math.PI, rr = Math.sqrt(r()) * R, yaw = r() * 2 * Math.PI;
    pos.set([rr * Math.cos(a), (r() - 0.5) * 0.6, rr * Math.sin(a), 0.4 + 0.6 * r()], i * 4);
    scl.set([0.05 + r() * 0.12, 0.01 + r() * 0.05, 0.05 + r() * 0.12, 0], i * 4);
    if (randomQuat) { const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...q) || 1; quat.set(q.map((x) => x / l), i * 4); } else quat.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], i * 4);
  }
  return { pos, scl, quat, n };
}
/* X3D fixture -> cloud. GaussianSplats: positions (MFVec3f), scales (MFVec3f), orientations (MFRotation read as quaternion x y z w, as in the repo's Pavilion fixture), opacities (MFFloat) */
export function fromX3D(doc) {
  const e = doc.getElementsByTagName('GaussianSplats')[0]; if (!e) throw new Error('fixture needs GaussianSplats');
  const nums = (a) => (e.getAttribute(a) || '').trim().split(/[\s,]+/).filter(Boolean).map(Number), p = nums('positions'), sc = nums('scales'), q = nums('orientations'), o = nums('opacities'), n = p.length / 3;
  if (sc.length !== n * 3 || q.length !== n * 4 || o.length !== n) throw new Error('GaussianSplats field lengths disagree');
  const pos = new Float32Array(n * 4), scl = new Float32Array(n * 4), quat = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { pos.set([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], o[i]], i * 4); scl.set([sc[i * 3], sc[i * 3 + 1], sc[i * 3 + 2], 0], i * 4); const l = Math.hypot(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]); quat.set([q[i * 4] / l, q[i * 4 + 1] / l, q[i * 4 + 2] / l, q[i * 4 + 3] / l], i * 4); }
  return { pos, scl, quat, n };
}
/* tiled bitonic plan: [['local_sort'], ['global', j, k] ..., ['local_merge', k] ...] for n a power of two >= 512 */
export function tiledPlan(n) { const p = [['local_sort']]; for (let k = 1024; k <= n; k <<= 1) { for (let j = k >> 1; j >= 512; j >>= 1) p.push(['global', j, k]); p.push(['local_merge', k]); } return p; }
