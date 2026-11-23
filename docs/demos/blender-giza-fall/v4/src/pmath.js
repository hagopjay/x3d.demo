// loom:sim
// Portable math for the simulation. Only + - * / and Math.sqrt, Math.floor, Math.round, Math.abs, Math.min,
// Math.max (all exact in IEEE 754), so Node and every browser compute the same bits. Math.sin, cos, atan2,
// exp and pow are approximate per engine and are not used anywhere in the sim (Loom PHYSICS-PLAYBOOK pattern 20).

export const PI = 3.141592653589793, TAU = 6.283185307179586;

// sine by range reduction to [-pi, pi], then to [-pi/2, pi/2], then a degree-17 odd Taylor polynomial
// (truncation below 1e-11 on the reduced range)
export function psin(x) {
  let k = Math.round(x / TAU); x = x - k * TAU;
  if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 / 355687428096000))))))));
}
export const pcos = (x) => psin(x + PI / 2);

// ---------- vectors as plain [x, y, z] ----------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
export const clampLen = (a, m) => { const l = len(a); return l > m ? mul(a, m / l) : a; };
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- quaternions as {x, y, z, w} (Rapier's shape) ----------
export const qid = () => ({ x: 0, y: 0, z: 0, w: 1 });
export function qmul(a, b) {
  return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
export const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qnorm(q) { const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; }
export function qrot(q, v) {   // rotate vector v by unit quaternion q
  const t = mul(cross([q.x, q.y, q.z], v), 2);
  return add(add(v, mul(t, q.w)), cross([q.x, q.y, q.z], t));
}
// rotation about a unit axis by angle a (portable sine/cosine of a/2)
export function qaxis(axis, a) { const s = psin(a / 2); return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: pcos(a / 2) }; }
// shortest rotation taking unit vector a onto unit vector b (no trig: the half-vector form)
export function qfromTo(a, b) {
  const d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); ax = norm(ax); return { x: ax[0], y: ax[1], z: ax[2], w: 0 }; }
  const c = cross(a, b); return qnorm({ x: c[0], y: c[1], z: c[2], w: 1 + d });
}
// yaw that turns local +Z (a figure's forward) to the horizontal direction dir
export function qyaw(dir) { const h = norm([dir[0], 0, dir[2]]); return len(h) > 0 ? qfromTo([0, 0, 1], h) : qid(); }
// rotation error from q to target t as a rotation vector, small-angle form 2*vec(t q^-1) (sign chosen for the short way)
export function qerr(t, q) { let e = qmul(t, qconj(q)); if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w }; return [2 * e.x, 2 * e.y, 2 * e.z]; }

// ---------- seeded random: sfc32 (integer only, so identical everywhere) ----------
export class Rng {
  constructor(seed) { this.s = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0]; for (let i = 0; i < 15; i++) this.u32(); }
  u32() {
    let [a, b, c, d] = this.s; const t = (((a + b) >>> 0) + d) >>> 0; d = (d + 1) >>> 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = ((c << 21) | (c >>> 11)) >>> 0; c = (c + t) >>> 0; this.s = [a >>> 0, b, c, d]; return t;
  }
  next() { return this.u32() / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  pick(arr) { return arr[this.int(arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  state() { return this.s.slice(); }
  restore(s) { this.s = s.slice(); }
}
export function seedOf(str) { let h = 2166136261 >>> 0; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }

// ---------- FNV-1a over float32 bits ----------
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export class Hasher {
  constructor() { this.h = 2166136261 >>> 0; }
  f(x) { F32[0] = x; let u = U32[0]; for (let i = 0; i < 4; i++) { this.h ^= u & 0xff; this.h = Math.imul(this.h, 16777619) >>> 0; u >>>= 8; } return this; }
  i(n) { n = n >>> 0; for (let i = 0; i < 4; i++) { this.h ^= n & 0xff; this.h = Math.imul(this.h, 16777619) >>> 0; n >>>= 8; } return this; }
  hex() { return this.h.toString(16).padStart(8, '0'); }
}
