// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure sky and camera maths for the v4 stage. No DOM, no X_ITE: testable in node.
 *
 * Frames. Star positions in sky.x3d are equatorial J2000 stored as X3D (X, Y, Z) = (y, z, x), so the celestial
 * pole is +Y. The stage is X east, Y up, Z south. The rotation that carries a J2000 star into the stage is
 *   R = Rx(latitude - 90°) · Ry(-LST) · P(year)
 * with P the precession (ERFA ltp, sampled every 50 years in sky-data.json and slerped here).
 * Quaternions are [x, y, z, w].
 */
export const GIZA_LAT = 29.979175;
const RAD = Math.PI / 180;

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qaxis = (x, y, z, angle) => {
  const n = Math.hypot(x, y, z) || 1, s = Math.sin(angle / 2) / n;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
export function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((c) => -c); d = -d; }
  if (d > 0.9995) {
    const q = a.map((c, i) => c + (b[i] - c) * t), n = Math.hypot(...q);
    return q.map((c) => c / n);
  }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((c, i) => c * wa + b[i] * wb);
}
/** Quaternion -> X3D SFRotation numbers [x, y, z, angle]. */
export function qToAxisAngle(q) {
  const w = Math.max(-1, Math.min(1, q[3])), angle = 2 * Math.acos(w), s = Math.sqrt(1 - w * w);
  return s < 1e-9 ? [0, 1, 0, 0] : [q[0] / s, q[1] / s, q[2] / s, angle];
}
export const axisAngleToQ = (r) => qaxis(r[0], r[1], r[2], r[3]);

/** Camera quaternion that looks from pos to at with +Y up (X3D cameras look down -Z). */
export function lookAt(pos, at) {
  let f = [at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]];
  const fl = Math.hypot(...f); f = f.map((c) => c / fl);
  let r = [-f[2], 0, f[0]];                                  // f × up
  const rl = Math.hypot(...r);
  r = rl < 1e-6 ? [1, 0, 0] : r.map((c) => c / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  // rotation matrix columns: right, up, -forward
  const m = [r[0], u[0], -f[0], r[1], u[1], -f[1], r[2], u[2], -f[2]];
  const tr = m[0] + m[4] + m[8];
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s]; }
  return q;
}

/** Precession quaternion for an astronomical year (0 = 1 BC) from the sampled table. */
export function precessionQ(table, year) {
  const x = Math.max(0, Math.min(table.n - 1.000001, (year - table.y0) / table.step));
  const i = Math.floor(x), q = table.q;
  return qslerp(q.slice(4 * i, 4 * i + 4), q.slice(4 * i + 4, 4 * i + 8), x - i);
}

/** Rotation J2000 (file axes) -> stage, for a year, a local sidereal time in radians and a latitude in degrees. */
export function skyRotation(table, year, lst, lat = GIZA_LAT) {
  return qmul(qaxis(1, 0, 0, (lat - 90) * RAD), qmul(qaxis(0, 1, 0, -lst), precessionQ(table, year)));
}

/** Right ascension (radians, 0..2π) and declination (degrees) of date for a J2000 file-axes position. */
export function raDecOfDate(table, year, p) {
  const v = qrot(precessionQ(table, year), p), n = Math.hypot(...v);
  let ra = Math.atan2(v[0], v[2]);
  if (ra < 0) ra += 2 * Math.PI;
  return { ra, dec: Math.asin(v[1] / n) / RAD };
}

/** Altitude and azimuth (degrees; azimuth from north through east) of a stage-frame direction. */
export function altAz(d) {
  const n = Math.hypot(...d);
  let az = Math.atan2(d[0], -d[2]) / RAD;
  if (az < 0) az += 360;
  return { alt: Math.asin(d[1] / n) / RAD, az };
}

/** Position with linear space motion: p (light-years, J2000) + v (light-years per year) * (year - 2000). */
export const moved = (p, v, year) => [p[0] + v[0] * (year - 2000), p[1] + v[1] * (year - 2000), p[2] + v[2] * (year - 2000)];

/** Upper-culmination altitude at a latitude for a declination (degrees). */
export const culminationAltitude = (dec, lat = GIZA_LAT) => 90 - Math.abs(lat - dec);

/** Project a camera-space direction to pixels. fov is X3D's: the angle across the smaller side of the view. */
export function project(v, w, h, fov) {
  if (v[2] > -1e-6) return null;
  const f = Math.min(w, h) / 2 / Math.tan(fov / 2);
  return [w / 2 + (v[0] / -v[2]) * f, h / 2 - (v[1] / -v[2]) * f];
}

/** Historical label for an astronomical year. */
export const yearLabel = (y) => { y = Math.round(y); return y <= 0 ? `${1 - y} BC`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : `AD ${y}`; };

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
