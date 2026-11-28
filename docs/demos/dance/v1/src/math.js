// Small quaternion/vector kit. Euler conversion matches X_ITE 16.8 Rotation4/
// Quaternion.setEuler (gl-matrix fromEuler) so HAnimMotion channels written as
// "Zrotation Xrotation Yrotation" (order "ZXY") reproduce what we pose here.

export const DEG = Math.PI / 180;

export function quatFromEuler(xDeg, yDeg, zDeg, order = "ZXY") {
  const x = (xDeg * DEG) / 2, y = (yDeg * DEG) / 2, z = (zDeg * DEG) / 2;
  const sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z);
  const cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z);
  switch (order) {
    case "XYZ": return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
    case "ZXY": return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
    default: throw new Error("order " + order);
  }
}

export const qIdentity = () => [0, 0, 0, 1];

export function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
          aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

export function qAxisAngle(q) {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return [0, 0, 1, 0];
  return [x / s, y / s, z / s, 2 * Math.atan2(s, w)];
}

export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapHalf = (x) => x - Math.round(x); // into [-0.5, 0.5]

// Deterministic PRNG (mulberry32) so runs, tests and lineage replay.
export function rng(seed = 1) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.normal = () => {
    const u = Math.max(1e-12, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

// Smooth value noise for humanisation: sum of a few incommensurate sines.
export function wobble(seed) {
  const r = rng(seed);
  const parts = Array.from({ length: 3 }, () => ({ f: 0.15 + r() * 0.6, p: r() * Math.PI * 2, a: 0.5 + r() * 0.5 }));
  const norm = parts.reduce((s, p) => s + p.a, 0);
  return (t) => parts.reduce((s, p) => s + p.a * Math.sin(2 * Math.PI * p.f * t + p.p), 0) / norm;
}

// ---- for IK ---------------------------------------------------------------
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vScale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const vNorm = (a) => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];

export function qFromMat(m) { // m: row-major 3x3 [[..],[..],[..]]
  const t = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
  return [x, y, z, w];
}

export function qToMat(q) {
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}

/** Inverse of quatFromEuler(x, y, z, "ZXY") (= Rz·Rx·Ry), degrees. */
export function eulerZXYFromQuat(q) {
  const m = qToMat(q);
  const x = Math.asin(clamp(m[2][1], -1, 1));
  const y = Math.atan2(-m[2][0], m[2][2]);
  const z = Math.atan2(-m[0][1], m[1][1]);
  // the equivalent solution (π−x, y+π, z+π) keeps |y|,|z| small when |x| > 90°
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const alt = [wrap(Math.PI - x), wrap(y + Math.PI), wrap(z + Math.PI)];
  const pick = Math.abs(alt[1]) + Math.abs(alt[2]) < Math.abs(y) + Math.abs(z) ? alt : [x, y, z];
  return pick.map((v) => v / DEG);
}

/** Rotation taking frame (a1 primary, a2 secondary) onto (b1, b2). */
export function qFromFrames(a1, a2, b1, b2) {
  const frame = (p, s) => { const u = vNorm(p); const w = vNorm(vCross(u, s)); const v = vCross(w, u); return [u, v, w]; };
  const A = frame(a1, a2), B = frame(b1, b2);
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // M = B * A^T  (columns are the basis vectors)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) m[i][j] += B[k][i] * A[k][j];
  return qFromMat(m);
}

export function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = b.map((v) => -v); }
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => wa * v + wb * bb[i]);
}
