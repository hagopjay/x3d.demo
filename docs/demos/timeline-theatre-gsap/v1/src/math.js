// Quaternion and Euler helpers. Convention (documented in README, "Rotation"): a Theatre or GSAP rotation is three Euler angles in DEGREES,
// applied about the fixed X, then Y, then Z axes: q = qz * qy * qx. X3D SFRotation is axis + angle in radians.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];   // [x,y,z,w]
export function eulerToQuat(xd, yd, zd) {
  const f = (d) => [Math.sin(d * D2R / 2), Math.cos(d * D2R / 2)], [sx, cx] = f(xd), [sy, cy] = f(yd), [sz, cz] = f(zd);
  return qmul(qmul([0, 0, sz, cz], [0, sy, 0, cy]), [sx, 0, 0, cx]);
}
export function quatToEuler(q) {   // inverse of eulerToQuat, degrees; angles of the Z*Y*X product matrix
  const [x, y, z, w] = q, m20 = 2 * (x * z - w * y), m10 = 2 * (x * y + w * z), m00 = 1 - 2 * (y * y + z * z), m21 = 2 * (y * z + w * x), m22 = 1 - 2 * (x * x + y * y);
  const sy = Math.max(-1, Math.min(1, -m20)), ey = Math.asin(sy);
  if (Math.abs(sy) > 0.999999) { const m01 = 2 * (x * y - w * z), m11 = 1 - 2 * (x * x + z * z); return [Math.atan2(-(2 * (y * z - w * x)), m11) * R2D, ey * R2D, 0]; }
  return [Math.atan2(m21, m22) * R2D, ey * R2D, Math.atan2(m10, m00) * R2D];
}
export function quatToAxisAngle(q) {
  let [x, y, z, w] = q; const n = Math.hypot(x, y, z, w) || 1; x /= n; y /= n; z /= n; w /= n;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z); if (s < 1e-9) return [0, 0, 1, 0];
  return [x / s, y / s, z / s, 2 * Math.atan2(s, w)];
}
export function axisAngleToQuat([ax, ay, az, a]) { const n = Math.hypot(ax, ay, az) || 1, s = Math.sin(a / 2) / n; return [ax * s, ay * s, az * s, Math.cos(a / 2)]; }
export const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const qangle = (a, b) => { const r = qmul([-a[0], -a[1], -a[2], a[3]], b); return 2 * Math.atan2(Math.hypot(r[0], r[1], r[2]), Math.abs(r[3])); };   // rotation between two unit quaternions, radians (atan2 form: acos loses 1e-8 near 0)
export function slerp(a, b, t) {   // shortest path, as the X3D OrientationInterpolator (and X_ITE's) does
  let d = qdot(a, b), bb = b; if (d < 0) { d = -d; bb = b.map((v) => -v); }
  if (d > 0.999999) { const r = a.map((v, i) => v + (bb[i] - v) * t), n = Math.hypot(...r); return r.map((v) => v / n); }
  const th = Math.acos(d), s = Math.sin(th), k1 = Math.sin((1 - t) * th) / s, k2 = Math.sin(t * th) / s; return a.map((v, i) => v * k1 + bb[i] * k2);
}
