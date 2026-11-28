// dis-dr.js: the nine dead-reckoning algorithms of IEEE 1278.1 (Annex E of the 2012 edition). No dependencies.
//
// Conventions, as in the standard:
//   World coordinates are right-handed and geocentric (X through the prime meridian at the equator, Z through the
//   north pole). Entity (body) coordinates are x forward, y right, z down.
//   Orientation is three Euler angles psi, theta, phi (rotate about z, then the new y, then the new x) that take the
//   world axes onto the body axes. R(psi, theta, phi) below is the matrix that turns world coordinates of a vector
//   into body coordinates; its transpose turns body coordinates into world coordinates.
//   Angular velocity is in body coordinates, in radians per second.
//
// Algorithm names are three letters: F or R (orientation Fixed or Rotating), P or V (rate of Position only, or rate
// of Velocity too, that is with acceleration), W or B (velocity and acceleration given in World or Body coordinates).
//
//   1 Static  P = P0
//   2 FPW     P = P0 + V0 t
//   3 RPW     P = P0 + V0 t                          R = DR(t) R0
//   4 RVW     P = P0 + V0 t + A0 t^2 / 2             R = DR(t) R0
//   5 FVW     P = P0 + V0 t + A0 t^2 / 2
//   6 FPB     P = P0 + R0^T (R1(t) Vb)
//   7 RPB     P = P0 + R0^T (R1(t) Vb)               R = DR(t) R0
//   8 RVB     P = P0 + R0^T (R1(t) Vb + R2(t) Ab)    R = DR(t) R0
//   9 FVB     P = P0 + R0^T (R1(t) Vb + R2(t) Ab)
//
// with W the skew matrix of the body angular velocity w, |w| its length, and
//   DR(t) = exp(-W t)             = I - sin(|w|t)/|w| W + (1 - cos(|w|t))/|w|^2 W^2
//   R1(t) = integral of exp(W s)  = I t + (1 - cos(|w|t))/|w|^2 W + (|w|t - sin(|w|t))/|w|^3 W^2
//   R2(t) = integral of s exp(W s)= I t^2/2 + (sin(|w|t) - |w|t cos(|w|t))/|w|^3 W
//                                   + (|w|^2 t^2/2 - cos(|w|t) - |w|t sin(|w|t) + 1)/|w|^4 W^2
// These are the standard's matrices rewritten with W^2 = w w^T - |w|^2 I. For algorithms 8 and 9 the body
// acceleration Ab is the rate of change of the body-coordinate velocity components.
// For algorithms 6 and 9 the orientation is held, yet the position formula still contains R1 and R2, so a sender
// that fills in a non-zero angular velocity gets a curved path; with zero angular velocity both are straight lines.

export const DRM = Object.freeze({ OTHER: 0, STATIC: 1, FPW: 2, RPW: 3, RVW: 4, FVW: 5, FPB: 6, RPB: 7, RVB: 8, FVB: 9 });
export const DRM_NAME = Object.freeze(['Other', 'Static', 'FPW', 'RPW', 'RVW', 'FVW', 'FPB', 'RPB', 'RVB', 'FVB']);
export const DRM_LONG_NAME = Object.freeze([
  'Other (treated as static)', 'Static: the entity does not move', 'FPW: fixed orientation, constant velocity, world coordinates',
  'RPW: rotating, constant velocity, world coordinates', 'RVW: rotating, constant acceleration, world coordinates',
  'FVW: fixed orientation, constant acceleration, world coordinates', 'FPB: fixed orientation, constant velocity, body coordinates',
  'RPB: rotating, constant velocity, body coordinates', 'RVB: rotating, constant acceleration, body coordinates',
  'FVB: fixed orientation, constant acceleration, body coordinates',
]);
export const drmUsesBody = (a) => a >= 6 && a <= 9;
export const drmRotates = (a) => a === 3 || a === 4 || a === 7 || a === 8;
export const drmUsesAcceleration = (a) => a === 4 || a === 5 || a === 8 || a === 9;

// ---- 3x3 matrices as flat row-major arrays of 9 ---------------------------------------------------------------------

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export function mul(a, b) {
  const m = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return m;
}
export const transpose = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export const apply = (a, v) => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
export const skew = (w) => [0, -w[2], w[1], w[2], 0, -w[0], -w[1], w[0], 0];
const combine = (a, A, b, B, c, C) => A.map((_, i) => a * A[i] + b * B[i] + c * C[i]);

// World-to-body matrix from the DIS Euler angles.
export function eulerToMatrix(psi, theta, phi) {
  const cp = Math.cos(psi), sp = Math.sin(psi), ct = Math.cos(theta), st = Math.sin(theta), cf = Math.cos(phi), sf = Math.sin(phi);
  return [
    ct * cp, ct * sp, -st,
    sf * st * cp - cf * sp, sf * st * sp + cf * cp, sf * ct,
    cf * st * cp + sf * sp, cf * st * sp - sf * cp, cf * ct,
  ];
}

// DIS Euler angles from a world-to-body matrix. theta is in [-pi/2, pi/2]; at theta = +-pi/2 phi is set to 0.
export function matrixToEuler(R) {
  const st = Math.max(-1, Math.min(1, -R[2]));
  const theta = Math.asin(st);
  if (Math.abs(st) > 1 - 1e-12) {
    return { psi: Math.atan2(-R[3], R[4]), theta, phi: 0 };
  }
  return { psi: Math.atan2(R[1], R[0]), theta, phi: Math.atan2(R[5], R[8]) };
}

// Below this value of |w| t the closed forms lose digits to cancellation, so the power series is used instead.
const SERIES_BELOW = 1e-3;

export function drMatrix(w, t) {
  const W = skew(w), W2 = mul(W, W);
  const n = Math.hypot(w[0], w[1], w[2]), x = n * t;
  let a, b;
  if (Math.abs(x) < SERIES_BELOW) { a = t * (1 - x * x / 6); b = t * t * (0.5 - x * x / 24); }
  else { a = Math.sin(x) / n; b = (1 - Math.cos(x)) / (n * n); }
  return combine(1, IDENTITY, -a, W, b, W2);
}

export function r1Matrix(w, t) {
  const W = skew(w), W2 = mul(W, W);
  const n = Math.hypot(w[0], w[1], w[2]), x = n * t;
  let b, c;
  if (Math.abs(x) < SERIES_BELOW) { b = t * t * (0.5 - x * x / 24); c = t * t * t * (1 / 6 - x * x / 120); }
  else { b = (1 - Math.cos(x)) / (n * n); c = (x - Math.sin(x)) / (n * n * n); }
  return combine(t, IDENTITY, b, W, c, W2);
}

export function r2Matrix(w, t) {
  const W = skew(w), W2 = mul(W, W);
  const n = Math.hypot(w[0], w[1], w[2]), x = n * t;
  let b, c;
  if (Math.abs(x) < 2e-2) { b = t * t * t * (1 / 3 - x * x / 30 + x ** 4 / 840); c = t ** 4 * (1 / 8 - x * x / 144 + x ** 4 / 5760); }
  else { b = (Math.sin(x) - x * Math.cos(x)) / n ** 3; c = (0.5 * x * x - Math.cos(x) - x * Math.sin(x) + 1) / n ** 4; }
  return combine(0.5 * t * t, IDENTITY, b, W, c, W2);
}

// Extrapolate one entity state by `dt` seconds.
//   state = { algorithm, location [3], linearVelocity [3], linearAcceleration [3], angularVelocity [3],
//             orientation { psi, theta, phi } }
// For algorithms 6 to 9 linearVelocity and linearAcceleration are body coordinates, as carried in the PDU.
// Returns { location, orientation, matrix (world to body), velocityWorld }.
export function deadReckon(state, dt) {
  const alg = state.algorithm | 0;
  const P0 = state.location, V = state.linearVelocity ?? [0, 0, 0], A = state.linearAcceleration ?? [0, 0, 0], w = state.angularVelocity ?? [0, 0, 0];
  const o = state.orientation;
  const R0 = eulerToMatrix(o.psi, o.theta, o.phi);
  let location, matrix = R0, orientation = { psi: o.psi, theta: o.theta, phi: o.phi }, velocityWorld;

  if (alg < DRM.FPW || alg > DRM.FVB) { // Static, Other, or a value this module does not know
    return { location: [P0[0], P0[1], P0[2]], orientation, matrix, velocityWorld: [0, 0, 0] };
  }
  if (!drmUsesBody(alg)) {
    const acc = drmUsesAcceleration(alg);
    location = [0, 1, 2].map((i) => P0[i] + V[i] * dt + (acc ? 0.5 * A[i] * dt * dt : 0));
    velocityWorld = [0, 1, 2].map((i) => V[i] + (acc ? A[i] * dt : 0));
  } else {
    const acc = drmUsesAcceleration(alg);
    let d = apply(r1Matrix(w, dt), V);
    if (acc) { const d2 = apply(r2Matrix(w, dt), A); d = [d[0] + d2[0], d[1] + d2[1], d[2] + d2[2]]; }
    const dw = apply(transpose(R0), d);
    location = [P0[0] + dw[0], P0[1] + dw[1], P0[2] + dw[2]];
    // world velocity at time dt: body-to-world at dt applied to the body velocity at dt
    const vb = [0, 1, 2].map((i) => V[i] + (acc ? A[i] * dt : 0));
    velocityWorld = apply(transpose(mul(drMatrix(w, dt), R0)), vb);
  }
  if (drmRotates(alg)) {
    matrix = mul(drMatrix(w, dt), R0);
    orientation = matrixToEuler(matrix);
  }
  return { location, orientation, matrix, velocityWorld };
}

// Smallest rotation angle, in radians, between two world-to-body matrices. The Frobenius norm of the difference
// of two rotation matrices is 2 sqrt(2) sin(angle / 2); unlike the arccosine of the trace this keeps its digits
// for small angles.
export function angleBetween(Ra, Rb) {
  let s = 0;
  for (let i = 0; i < 9; i++) s += (Ra[i] - Rb[i]) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s) / (2 * Math.SQRT2)));
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
