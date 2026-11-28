// dis-geo.js: WGS 84 geodesy for DIS world coordinates, and the change of frame from DIS to an X3D scene.
// No dependencies.
//
// DIS world coordinates are geocentric (Earth-centred, Earth-fixed). A browser scene wants small local numbers, so
// a local tangent frame is set up at an origin given as latitude, longitude and height:
//   east, north, up (ENU) in metres, and from that the X3D frame  x = east, y = up, z = -north (south).
// Body axes in DIS are x forward, y right, z down. A model drawn for this runtime has its nose along +x, its top
// along +y and its right side along +z, so that  model (x, y, z) = body (x, -z, y).

import { mul, transpose, apply, eulerToMatrix, matrixToEuler } from './dis-dr.js';

export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const RAD = Math.PI / 180;

export function geodeticToEcef(latDeg, lonDeg, h) {
  const lat = latDeg * RAD, lon = lonDeg * RAD, s = Math.sin(lat), c = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  return [(N + h) * c * Math.cos(lon), (N + h) * c * Math.sin(lon), (N * (1 - WGS84_E2) + h) * s];
}

// Iterative inverse; converges to well under a millimetre in a few rounds for points near the surface.
export function ecefToGeodetic(p) {
  const [x, y, z] = p;
  const lon = Math.atan2(y, x), r = Math.hypot(x, y);
  if (r < 1e-9) { const b = WGS84_A * (1 - WGS84_F); return [z >= 0 ? 90 : -90, 0, Math.abs(z) - b]; }
  let lat = Math.atan2(z, r * (1 - WGS84_E2)), h = 0;
  for (let i = 0; i < 12; i++) {
    const s = Math.sin(lat), N = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
    h = r / Math.cos(lat) - N;
    const next = Math.atan2(z, r * (1 - WGS84_E2 * N / (N + h)));
    if (Math.abs(next - lat) < 1e-14) { lat = next; break; }
    lat = next;
  }
  return [lat / RAD, lon / RAD, h];
}

// Rows are the unit vectors north, east, down written in geocentric coordinates: the matrix turns a geocentric
// vector into NED components.
export function ecefToNedMatrix(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD, sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return [-sl * co, -sl * so, cl, -so, co, 0, -cl * co, -cl * so, -sl];
}

// Body-to-NED attitude from heading (clockwise from north), pitch (nose up) and roll (right wing down), radians.
// It is the same z-y-x Euler construction as the DIS angles, taken about the local NED axes.
export const nedToBodyMatrix = (heading, pitch, roll) => eulerToMatrix(heading, pitch, roll);

// A local frame at a geodetic origin, with the conversions the runtime and the scripted exercise need.
export class LocalFrame {
  constructor(latDeg, lonDeg, h = 0) {
    this.lat = latDeg; this.lon = lonDeg; this.h = h;
    this.originEcef = geodeticToEcef(latDeg, lonDeg, h);
    this.ecefToNed = ecefToNedMatrix(latDeg, lonDeg);
    this.nedToEcef = transpose(this.ecefToNed);
    // X3D x = east = NED y; X3D y = up = -NED z; X3D z = south = -NED x
    this.nedToX3d = [0, 1, 0, 0, 0, -1, -1, 0, 0];
    this.ecefToX3d = mul(this.nedToX3d, this.ecefToNed);
    this.x3dToEcef = transpose(this.ecefToX3d);
  }
  // positions
  ecefToLocal(p) { return apply(this.ecefToX3d, [p[0] - this.originEcef[0], p[1] - this.originEcef[1], p[2] - this.originEcef[2]]); }
  localToEcef(q) { const d = apply(this.x3dToEcef, q); return [d[0] + this.originEcef[0], d[1] + this.originEcef[1], d[2] + this.originEcef[2]]; }
  nedToEcefPoint(n) { const d = apply(this.nedToEcef, n); return [d[0] + this.originEcef[0], d[1] + this.originEcef[1], d[2] + this.originEcef[2]]; }
  // free vectors (velocity, acceleration)
  ecefVectorToLocal(v) { return apply(this.ecefToX3d, v); }
  localVectorToEcef(v) { return apply(this.x3dToEcef, v); }
  // orientation: DIS Euler angles (relative to geocentric axes) from a body-to-NED attitude in this frame
  eulerFromNedAttitude(heading, pitch, roll) {
    return matrixToEuler(mul(nedToBodyMatrix(heading, pitch, roll), this.ecefToNed));
  }
  // heading, pitch, roll in this frame from DIS Euler angles
  nedAttitudeFromEuler(psi, theta, phi) {
    const e = matrixToEuler(mul(eulerToMatrix(psi, theta, phi), this.nedToEcef));
    return { heading: e.psi, pitch: e.theta, roll: e.phi };
  }
  // The X3D rotation matrix (model to scene, row-major 3x3) for a DIS world-to-body matrix.
  modelToSceneMatrix(worldToBody) {
    // model (x, y, z) -> body (x, z, -y)
    const modelToBody = [1, 0, 0, 0, 0, 1, 0, -1, 0];
    return mul(this.ecefToX3d, mul(transpose(worldToBody), modelToBody));
  }
  // and back: the DIS world-to-body matrix for an X3D model-to-scene rotation matrix
  worldToBodyFromModelMatrix(modelToScene) {
    const bodyToModel = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    return transpose(mul(this.x3dToEcef, mul(modelToScene, bodyToModel)));
  }
}

// Rotation matrix (row-major 3x3) to X3D axis and angle [x, y, z, angle].
export function matrixToAxisAngle(m) {
  // via a quaternion, which stays well behaved near angle 0 and near pi
  const tr = m[0] + m[4] + m[8];
  let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4; }
  const n = Math.hypot(x, y, z);
  if (n < 1e-12) return [0, 0, 1, 0];
  const angle = 2 * Math.atan2(n, w);
  return [x / n, y / n, z / n, angle];
}

export function axisAngleToMatrix(a) {
  const n = Math.hypot(a[0], a[1], a[2]) || 1, x = a[0] / n, y = a[1] / n, z = a[2] / n, c = Math.cos(a[3]), s = Math.sin(a[3]), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
