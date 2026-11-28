// dr.test.js: each of the nine dead-reckoning algorithms against references that do not use dis-dr.js.
//
// Two kinds of reference are used and both are written out in this file:
//   closed form  a formula for one simple motion, derived by hand (stated at each test);
//   RK4          a fourth-order Runge-Kutta integration, step 1 ms, of the motion model the algorithm stands for:
//                  dP/dt = v_world,  dB/dt = B W  (B is body-to-world, W the skew matrix of the body angular
//                  velocity),  v_world = V + A t  for world algorithms,  v_world = B (Vb + Ab t)  for body algorithms.
// The RK4 reference runs on random states with all three axes turning, which the closed forms do not cover.
//
// Run:  node --test tests/dr.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deadReckon, eulerToMatrix, matrixToEuler, transpose, mul, apply, skew, angleBetween, distance, DRM, DRM_NAME, drmRotates, drmUsesBody, drmUsesAcceleration } from '../src/dis-dr.js';
import { record } from './results.js';

// A small seeded generator so that every run uses the same states.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const uniform = (r, a, b) => a + (b - a) * r();

const results = {};
const keep = (alg, reference, posErr, angErr, cases) => {
  const k = `${alg} ${DRM_NAME[alg]}`;
  results[k] ??= { references: [] };
  results[k].references.push({ reference, cases, max_position_error_m: posErr, max_orientation_error_rad: angErr });
  console.log(`DRM ${alg} ${DRM_NAME[alg].padEnd(6)} ${reference}: max position error ${posErr.toExponential(2)} m, max orientation error ${angErr === null ? 'n/a' : angErr.toExponential(2) + ' rad'} over ${cases} cases`);
};

// ---- reference 1: quaternion closed form for constant body angular velocity -----------------------------------------
// q(t) = q0 * [cos(|w| t / 2), sin(|w| t / 2) w / |w|]  (body-to-world, Hamilton product). This is a different
// formulation from the DR matrix of the standard and shares no code with it.
function quatFromMatrix(B) { // body-to-world matrix to quaternion [w, x, y, z]
  const tr = B[0] + B[4] + B[8];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [s / 4, (B[7] - B[5]) / s, (B[2] - B[6]) / s, (B[3] - B[1]) / s]; }
  if (B[0] > B[4] && B[0] > B[8]) { const s = Math.sqrt(1 + B[0] - B[4] - B[8]) * 2; return [(B[7] - B[5]) / s, s / 4, (B[1] + B[3]) / s, (B[2] + B[6]) / s]; }
  if (B[4] > B[8]) { const s = Math.sqrt(1 + B[4] - B[0] - B[8]) * 2; return [(B[2] - B[6]) / s, (B[1] + B[3]) / s, s / 4, (B[5] + B[7]) / s]; }
  const s = Math.sqrt(1 + B[8] - B[0] - B[4]) * 2; return [(B[3] - B[1]) / s, (B[2] + B[6]) / s, (B[5] + B[7]) / s, s / 4];
}
const quatMul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
function quatToMatrix(q) {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
function quaternionReference(orientation, w, t) {
  const B0 = transpose(eulerToMatrix(orientation.psi, orientation.theta, orientation.phi));
  const n = Math.hypot(...w);
  const dq = n === 0 ? [1, 0, 0, 0] : [Math.cos(n * t / 2), ...w.map((x) => Math.sin(n * t / 2) * x / n)];
  return transpose(quatToMatrix(quatMul(quatFromMatrix(B0), dq))); // world-to-body
}

// ---- reference 2: RK4 on the motion model ---------------------------------------------------------------------------
function rk4Reference(state, T, h = 1e-3) {
  const alg = state.algorithm, body = drmUsesBody(alg), rot = drmRotates(alg), acc = drmUsesAcceleration(alg);
  // In the body algorithms the path always follows the angular velocity (R1 and R2 contain it); only the reported
  // orientation is held for the F algorithms. In the world algorithms the path does not depend on orientation.
  const W = skew(state.angularVelocity);
  const A = acc ? state.linearAcceleration : [0, 0, 0];
  const f = (t, y) => {
    const B = y.slice(3, 12);
    const v = body ? apply(B, [0, 1, 2].map((i) => state.linearVelocity[i] + A[i] * t)) : [0, 1, 2].map((i) => state.linearVelocity[i] + A[i] * t);
    return [...v, ...mul(B, W)];
  };
  let y = [...state.location, ...transpose(eulerToMatrix(state.orientation.psi, state.orientation.theta, state.orientation.phi))];
  const steps = Math.round(T / h);
  const add = (a, b, s) => a.map((x, i) => x + s * b[i]);
  for (let i = 0; i < steps; i++) {
    const t = i * h;
    const k1 = f(t, y), k2 = f(t + h / 2, add(y, k1, h / 2)), k3 = f(t + h / 2, add(y, k2, h / 2)), k4 = f(t + h, add(y, k3, h));
    y = y.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  const worldToBody = rot ? transpose(y.slice(3, 12)) : eulerToMatrix(state.orientation.psi, state.orientation.theta, state.orientation.phi);
  return { location: y.slice(0, 3), matrix: worldToBody };
}

function randomState(r, alg) {
  return {
    algorithm: alg,
    // offsets of a few kilometres, so that the comparison is not limited by the 1e-9 m granularity of numbers near 6.4e6
    location: [uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3)],
    linearVelocity: [uniform(r, -250, 250), uniform(r, -250, 250), uniform(r, -250, 250)],
    linearAcceleration: [uniform(r, -15, 15), uniform(r, -15, 15), uniform(r, -15, 15)],
    angularVelocity: [uniform(r, -0.6, 0.6), uniform(r, -0.6, 0.6), uniform(r, -0.6, 0.6)],
    orientation: { psi: uniform(r, -3, 3), theta: uniform(r, -1.3, 1.3), phi: uniform(r, -3, 3) },
  };
}

test('Euler angles to matrix and back', () => {
  const r = rng(11);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const e = { psi: uniform(r, -3.14, 3.14), theta: uniform(r, -1.55, 1.55), phi: uniform(r, -3.14, 3.14) };
    const R = eulerToMatrix(e.psi, e.theta, e.phi);
    const back = matrixToEuler(R);
    worst = Math.max(worst, Math.abs(back.psi - e.psi), Math.abs(back.theta - e.theta), Math.abs(back.phi - e.phi));
    const I = mul(R, transpose(R));
    worst = Math.max(worst, Math.abs(I[0] - 1), Math.abs(I[4] - 1), Math.abs(I[8] - 1), Math.abs(I[1]), Math.abs(I[5]));
  }
  console.log(`Euler round trip and orthogonality: worst deviation ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-12);
  // The matrix turns world coordinates into body coordinates: an entity with heading psi = 90 degrees (nose along
  // world +y) sees the world +y axis as its own +x.
  const v = apply(eulerToMatrix(Math.PI / 2, 0, 0), [0, 1, 0]);
  assert.ok(Math.abs(v[0] - 1) < 1e-15 && Math.abs(v[1]) < 1e-15);
});

test('DRM 1 Static: the entity stays where the PDU put it', () => {
  const r = rng(1); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const s = randomState(r, DRM.STATIC); const out = deadReckon(s, uniform(r, 0, 30));
    pos = Math.max(pos, distance(out.location, s.location));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(s.orientation.psi, s.orientation.theta, s.orientation.phi)));
  }
  keep(1, 'closed form: P(t) = P0, orientation unchanged, whatever velocity the PDU carries', pos, ang, 100);
  assert.equal(pos, 0); assert.equal(ang, 0);
});

test('DRM 2 FPW: constant velocity in world coordinates', () => {
  const r = rng(2); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const s = randomState(r, DRM.FPW), t = uniform(r, 0, 10); const out = deadReckon(s, t);
    const ref = [s.location[0] + s.linearVelocity[0] * t, s.location[1] + s.linearVelocity[1] * t, s.location[2] + s.linearVelocity[2] * t];
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(s.orientation.psi, s.orientation.theta, s.orientation.phi)));
  }
  keep(2, 'closed form: straight line P0 + V t, orientation unchanged', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.equal(ang, 0);
  let rk = 0; const r2 = rng(22);
  for (let i = 0; i < 20; i++) { const s = randomState(r2, DRM.FPW); rk = Math.max(rk, distance(deadReckon(s, 5).location, rk4Reference(s, 5).location)); }
  keep(2, 'RK4 of dP/dt = V over 5 s', rk, null, 20);
  assert.ok(rk < 1e-8);
});

test('DRM 3 RPW: constant velocity, constant body angular velocity', () => {
  const r = rng(3); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const s = randomState(r, DRM.RPW), t = uniform(r, 0, 10); const out = deadReckon(s, t);
    const ref = [0, 1, 2].map((k) => s.location[k] + s.linearVelocity[k] * t);
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, quaternionReference(s.orientation, s.angularVelocity, t)));
  }
  keep(3, 'closed form: P0 + V t; orientation q(t) = q0 * exp(w t / 2) as a quaternion', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.ok(ang < 1e-12);
  // yaw from level flight: the heading grows linearly
  const s = { algorithm: DRM.RPW, location: [0, 0, 0], linearVelocity: [10, 0, 0], linearAcceleration: [0, 0, 0], angularVelocity: [0, 0, 0.3], orientation: { psi: 0.4, theta: 0, phi: 0 } };
  const e = deadReckon(s, 2.5).orientation;
  const yawErr = Math.max(Math.abs(e.psi - (0.4 + 0.3 * 2.5)), Math.abs(e.theta), Math.abs(e.phi));
  keep(3, 'closed form: level yaw, psi(t) = psi0 + r t', 0, yawErr, 1);
  assert.ok(yawErr < 1e-12);
  let rkp = 0, rka = 0; const r2 = rng(33);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.RPW); const a = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a.location, b.location)); rka = Math.max(rka, angleBetween(a.matrix, b.matrix)); }
  keep(3, 'RK4 of dP/dt = V, dB/dt = B W over 5 s', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka < 1e-10);
});

test('DRM 4 RVW: constant acceleration in world coordinates, constant body angular velocity', () => {
  const r = rng(4); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const s = randomState(r, DRM.RVW), t = uniform(r, 0, 10); const out = deadReckon(s, t);
    const ref = [0, 1, 2].map((k) => s.location[k] + s.linearVelocity[k] * t + 0.5 * s.linearAcceleration[k] * t * t);
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, quaternionReference(s.orientation, s.angularVelocity, t)));
  }
  keep(4, 'closed form: parabola P0 + V t + A t^2 / 2; orientation by quaternion', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.ok(ang < 1e-12);
  let rkp = 0, rka = 0; const r2 = rng(44);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.RVW); const a = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a.location, b.location)); rka = Math.max(rka, angleBetween(a.matrix, b.matrix)); }
  keep(4, 'RK4 of dP/dt = V + A t, dB/dt = B W over 5 s', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka < 1e-10);
});

test('DRM 5 FVW: constant acceleration in world coordinates, orientation held', () => {
  const r = rng(5); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const s = randomState(r, DRM.FVW), t = uniform(r, 0, 10); const out = deadReckon(s, t);
    const ref = [0, 1, 2].map((k) => s.location[k] + s.linearVelocity[k] * t + 0.5 * s.linearAcceleration[k] * t * t);
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(s.orientation.psi, s.orientation.theta, s.orientation.phi)));
  }
  keep(5, 'closed form: parabola P0 + V t + A t^2 / 2, orientation unchanged', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.equal(ang, 0);
  // a falling body: 100 m/s east, gravity 9.81 down the world z axis, after 3 s
  const out = deadReckon({ algorithm: 5, location: [0, 0, 0], linearVelocity: [0, 100, 0], linearAcceleration: [0, 0, 9.81], angularVelocity: [0, 0, 0], orientation: { psi: 0, theta: 0, phi: 0 } }, 3);
  assert.ok(distance(out.location, [0, 300, 44.145]) < 1e-12);
});

test('DRM 6 FPB: constant velocity in body coordinates, orientation held', () => {
  const r = rng(6); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const psi = uniform(r, -3, 3), theta = uniform(r, -1.3, 1.3), u = uniform(r, 1, 250), t = uniform(r, 0, 10), P0 = [uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3)];
    const s = { algorithm: DRM.FPB, location: P0, linearVelocity: [u, 0, 0], linearAcceleration: [0, 0, 0], angularVelocity: [0, 0, 0], orientation: { psi, theta, phi: uniform(r, -3, 3) } };
    const out = deadReckon(s, t);
    // the nose points along (cos theta cos psi, cos theta sin psi, -sin theta) in world coordinates
    const ref = [P0[0] + u * t * Math.cos(theta) * Math.cos(psi), P0[1] + u * t * Math.cos(theta) * Math.sin(psi), P0[2] - u * t * Math.sin(theta)];
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(psi, theta, s.orientation.phi)));
  }
  keep(6, 'closed form: forward speed u along the nose, P0 + u t (cos th cos psi, cos th sin psi, -sin th); zero angular velocity', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.equal(ang, 0);
  let rkp = 0, rka = 0; const r2 = rng(66);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.FPB); const a = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a.location, b.location)); rka = Math.max(rka, angleBetween(a.matrix, b.matrix)); }
  keep(6, 'RK4 of dP/dt = B Vb, dB/dt = B W over 5 s, reported orientation held (non-zero angular velocity)', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka === 0);
});

test('DRM 7 RPB: constant velocity in body coordinates while turning', () => {
  const r = rng(7); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const psi0 = uniform(r, -3, 3), u = uniform(r, 1, 250), rate = uniform(r, 0.01, 0.6) * (r() < 0.5 ? -1 : 1), t = uniform(r, 0, 10), P0 = [uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3)];
    const s = { algorithm: DRM.RPB, location: P0, linearVelocity: [u, 0, 0], linearAcceleration: [0, 0, 0], angularVelocity: [0, 0, rate], orientation: { psi: psi0, theta: 0, phi: 0 } };
    const out = deadReckon(s, t);
    // a level turn at constant speed is a circle of radius u / rate
    const ref = [P0[0] + u / rate * (Math.sin(psi0 + rate * t) - Math.sin(psi0)), P0[1] - u / rate * (Math.cos(psi0 + rate * t) - Math.cos(psi0)), P0[2]];
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(psi0 + rate * t, 0, 0)));
  }
  keep(7, 'closed form: level turn, circle of radius u / r: x = x0 + (u/r)(sin(psi0 + r t) - sin psi0), y = y0 - (u/r)(cos(psi0 + r t) - cos psi0); heading psi0 + r t', pos, ang, 100);
  assert.ok(pos < 1e-8); assert.ok(ang < 1e-12);
  let rkp = 0, rka = 0; const r2 = rng(77);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.RPB); const a = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a.location, b.location)); rka = Math.max(rka, angleBetween(a.matrix, b.matrix)); }
  keep(7, 'RK4 of dP/dt = B Vb, dB/dt = B W over 5 s, all three axes turning', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka < 1e-10);
});

test('DRM 8 RVB: constant acceleration in body coordinates while turning', () => {
  const r = rng(8); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const psi0 = uniform(r, -3, 3), u = uniform(r, 1, 250), a = uniform(r, -15, 15), rate = uniform(r, 0.01, 0.6) * (r() < 0.5 ? -1 : 1), t = uniform(r, 0, 10), P0 = [uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3)];
    const s = { algorithm: DRM.RVB, location: P0, linearVelocity: [u, 0, 0], linearAcceleration: [a, 0, 0], angularVelocity: [0, 0, rate], orientation: { psi: psi0, theta: 0, phi: 0 } };
    const out = deadReckon(s, t);
    // forward speed u + a s along a heading psi0 + r s; integrate (u + a s)(cos, sin)(psi0 + r s) ds by parts
    const X = (s_) => (u + a * s_) * Math.sin(psi0 + rate * s_) / rate + a * Math.cos(psi0 + rate * s_) / (rate * rate);
    const Y = (s_) => -(u + a * s_) * Math.cos(psi0 + rate * s_) / rate + a * Math.sin(psi0 + rate * s_) / (rate * rate);
    const ref = [P0[0] + X(t) - X(0), P0[1] + Y(t) - Y(0), P0[2]];
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(psi0 + rate * t, 0, 0)));
  }
  keep(8, 'closed form: level turn with forward speed u + a t: x = x0 + [(u + a s) sin(psi0 + r s)/r + a cos(psi0 + r s)/r^2] from 0 to t, y likewise with -cos and sin', pos, ang, 100);
  assert.ok(pos < 1e-8); assert.ok(ang < 1e-12);
  let rkp = 0, rka = 0; const r2 = rng(88);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.RVB); const a_ = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a_.location, b.location)); rka = Math.max(rka, angleBetween(a_.matrix, b.matrix)); }
  keep(8, 'RK4 of dP/dt = B (Vb + Ab t), dB/dt = B W over 5 s, all three axes turning', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka < 1e-10);
});

test('DRM 9 FVB: constant acceleration in body coordinates, orientation held', () => {
  const r = rng(9); let pos = 0, ang = 0;
  for (let i = 0; i < 100; i++) {
    const psi = uniform(r, -3, 3), theta = uniform(r, -1.3, 1.3), u = uniform(r, 1, 250), a = uniform(r, -15, 15), t = uniform(r, 0, 10), P0 = [uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3), uniform(r, -5e3, 5e3)];
    const s = { algorithm: DRM.FVB, location: P0, linearVelocity: [u, 0, 0], linearAcceleration: [a, 0, 0], angularVelocity: [0, 0, 0], orientation: { psi, theta, phi: uniform(r, -3, 3) } };
    const out = deadReckon(s, t);
    const d = u * t + 0.5 * a * t * t;
    const ref = [P0[0] + d * Math.cos(theta) * Math.cos(psi), P0[1] + d * Math.cos(theta) * Math.sin(psi), P0[2] - d * Math.sin(theta)];
    pos = Math.max(pos, distance(out.location, ref));
    ang = Math.max(ang, angleBetween(out.matrix, eulerToMatrix(psi, theta, s.orientation.phi)));
  }
  keep(9, 'closed form: distance u t + a t^2 / 2 along the nose; zero angular velocity', pos, ang, 100);
  assert.ok(pos < 1e-9); assert.equal(ang, 0);
  let rkp = 0, rka = 0; const r2 = rng(99);
  for (let i = 0; i < 20; i++) { const st = randomState(r2, DRM.FVB); const a_ = deadReckon(st, 5), b = rk4Reference(st, 5); rkp = Math.max(rkp, distance(a_.location, b.location)); rka = Math.max(rka, angleBetween(a_.matrix, b.matrix)); }
  keep(9, 'RK4 of dP/dt = B (Vb + Ab t), dB/dt = B W over 5 s, reported orientation held (non-zero angular velocity)', rkp, rka, 20);
  assert.ok(rkp < 1e-8 && rka === 0);
});

test('small angular velocity: the series branch joins the closed form', () => {
  // The matrices switch to a power series below |w| t = 1e-3 (2e-2 for R2). Compare both sides of the switch with RK4.
  let worst = 0;
  for (const scale of [1e-9, 1e-6, 9e-4, 1.1e-3, 1.9e-2, 2.1e-2]) {
    for (const alg of [3, 4, 7, 8]) {
      const s = { algorithm: alg, location: [100, 200, 300], linearVelocity: [200, 10, -5], linearAcceleration: [3, -2, 1], angularVelocity: [0.6 * scale, -0.5 * scale, 0.62 * scale], orientation: { psi: 1, theta: 0.3, phi: -0.4 } };
      const a = deadReckon(s, 1), b = rk4Reference(s, 1);
      worst = Math.max(worst, distance(a.location, b.location), angleBetween(a.matrix, b.matrix));
    }
  }
  console.log(`series and closed-form branches against RK4: worst deviation ${worst.toExponential(2)} (m or rad)`);
  assert.ok(worst < 1e-9);
});

test('zero elapsed time returns the PDU state for every algorithm', () => {
  const r = rng(10);
  for (let alg = 0; alg <= 9; alg++) {
    const s = randomState(r, alg); const out = deadReckon(s, 0);
    assert.ok(distance(out.location, s.location) === 0);
    assert.equal(angleBetween(out.matrix, eulerToMatrix(s.orientation.psi, s.orientation.theta, s.orientation.phi)), 0);
  }
});

test('record the numbers', () => {
  const table = {};
  for (const [k, v] of Object.entries(results)) {
    table[k] = { references: v.references, max_position_error_m: Math.max(...v.references.map((x) => x.max_position_error_m)), max_orientation_error_rad: Math.max(...v.references.map((x) => x.max_orientation_error_rad ?? 0)) };
  }
  record('dr', { instrument: `node ${process.version}, IEEE 754 doubles`, algorithms: table });
  assert.equal(Object.keys(table).length, 9);
});
