import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_MODES, ENCOUNTER_LEVELS, journeyPose } from '../journey.mjs';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vectorNear = (a, b, tolerance = 1e-9) => a.forEach((value, i) => near(value, b[i], tolerance));
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const normalize = v => v.map(value => value / Math.hypot(...v));
const rotate = (v, rotation) => {
  const [x, y, z, angle] = rotation, axis = [x, y, z];
  const c = Math.cos(angle), s = Math.sin(angle), d = dot(axis, v);
  const cross = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  return v.map((value, i) => value * c + cross[i] * s + axis[i] * d * (1 - c));
};

test('camera modes and encounter caps are explicit immutable options', () => {
  assert.deepEqual(CAMERA_MODES, ['witness', 'first-person']);
  assert.deepEqual(ENCOUNTER_LEVELS, ['geometry', 'craft', 'beings']);
  assert.ok(Object.isFrozen(CAMERA_MODES) && Object.isFrozen(ENCOUNTER_LEVELS));
});

test('first-person begins in the chamber, remains at the eyes through phase two, and returns', () => {
  for (const time of [0, 9, 18, 27, 36, 108]) {
    const pose = journeyPose(time, 'first-person');
    vectorNear(pose.position, [0, 42.1, -0.7]);
    vectorNear(pose.target, [0.25, 42.8, -1.25]);
  }
  vectorNear(journeyPose(90, 'first-person').position, [0, 187, 8]);
  vectorNear(journeyPose(90, 'first-person').target, [0, 197, -40]);
  vectorNear(journeyPose(54, 'first-person').target, [0.39, 42.46, -1.03]);
});

test('witness establishes the pyramid and returns to a close chamber view', () => {
  vectorNear(journeyPose(0).position, [340, 220, 420]);
  vectorNear(journeyPose(108).position, [0.8, 44.5, 7]);
  assert.ok(journeyPose(36).position[1] < 47);
  assert.ok(journeyPose(90).position[1] > 180);
});

test('all poses are finite, normalized and look toward their stated target', () => {
  for (const mode of CAMERA_MODES) for (let time = 0; time <= 108; time += 0.125) {
    const pose = journeyPose(time, mode);
    assert.ok([...pose.position, ...pose.orientation, ...pose.target, pose.fov].every(Number.isFinite));
    assert.ok(pose.fov > 0 && pose.fov < Math.PI);
    near(Math.hypot(...pose.orientation.slice(0, 3)), 1);
    const forward = rotate([0, 0, -1], pose.orientation);
    const aimed = normalize(pose.target.map((value, i) => value - pose.position[i]));
    near(dot(forward, aimed), 1, 1e-9);
    const right = rotate([1, 0, 0], pose.orientation), up = rotate([0, 1, 0], pose.orientation);
    near(Math.hypot(...right), 1); near(Math.hypot(...up), 1); near(Math.hypot(...forward), 1);
    near(dot(right, up), 0); near(dot(up, forward), 0); near(dot(right, forward), 0);
    assert.ok(up[1] > 0, 'camera should retain world-up without roll inversion');
  }
});

test('camera position, aim and FOV remain continuous across every phase boundary', () => {
  for (const mode of CAMERA_MODES) for (const time of [0, 18, 36, 54, 72, 90, 108]) {
    const exact = journeyPose(time, mode);
    for (const adjacent of [time - 1e-5, time + 1e-5]) {
      const pose = journeyPose(adjacent, mode);
      vectorNear(pose.position, exact.position, 1e-7);
      vectorNear(pose.target, exact.target, 1e-7);
      near(pose.fov, exact.fov, 1e-7);
      vectorNear(rotate([0, 0, -1], pose.orientation), rotate([0, 0, -1], exact.orientation), 1e-7);
    }
  }
});

test('segment interpolation cannot overshoot its keyframe position bounds', () => {
  for (const mode of CAMERA_MODES) for (let segment = 0; segment < 6; segment++) {
    const a = journeyPose(segment * 18, mode), b = journeyPose((segment + 1) * 18, mode);
    for (let i = 0; i <= 100; i++) {
      const pose = journeyPose(segment * 18 + i * 0.18, mode);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(pose.position[axis] >= Math.min(a.position[axis], b.position[axis]) - 1e-9);
        assert.ok(pose.position[axis] <= Math.max(a.position[axis], b.position[axis]) + 1e-9);
      }
    }
  }
});

test('encounter builds through machinery, geometry, craft and beings in order', () => {
  assert.deepEqual(journeyPose(0).stage, { geometry: 0, machinery: 0, craft: 0, beings: 0 });
  assert.ok(journeyPose(47).stage.machinery > 0);
  assert.equal(journeyPose(54).stage.machinery, 1);
  assert.equal(journeyPose(68).stage.geometry, 0);
  assert.equal(journeyPose(76).stage.geometry, 1);
  assert.equal(journeyPose(76).stage.craft, 0);
  assert.equal(journeyPose(82).stage.craft, 1);
  assert.equal(journeyPose(82).stage.beings, 0);
  assert.equal(journeyPose(90).stage.beings, 1);
  assert.equal(journeyPose(94).stage.beings, 1);
  assert.equal(journeyPose(100).stage.beings, 0.5);
  assert.deepEqual(journeyPose(106).stage, { geometry: 0, machinery: 0, craft: 0, beings: 0 });
  assert.equal(journeyPose(108).wasCoupling, 0);
});

test('every encounter stage and coupling value stays in [0,1] at every cap', () => {
  for (const level of ENCOUNTER_LEVELS) for (let time = 0; time <= 108; time += 0.2) {
    const pose = journeyPose(time, 'first-person', level);
    for (const value of [...Object.values(pose.stage), pose.wasCoupling]) assert.ok(value >= 0 && value <= 1);
    if (level === 'geometry') { assert.equal(pose.stage.machinery, 0); assert.equal(pose.stage.craft, 0); assert.equal(pose.stage.beings, 0); }
    if (level === 'craft') assert.equal(pose.stage.beings, 0);
  }
});

test('encounter caps preserve camera choreography and coupling', () => {
  for (const mode of CAMERA_MODES) for (const time of [0, 45, 73, 85, 90, 100, 108]) {
    const a = journeyPose(time, mode, 'geometry'), b = journeyPose(time, mode, 'beings');
    assert.deepEqual(a.position, b.position); assert.deepEqual(a.orientation, b.orientation);
    assert.equal(a.wasCoupling, b.wasCoupling);
  }
});

test('seeks are deterministic, bounded and return fresh arrays', () => {
  assert.deepEqual(journeyPose(-100), journeyPose(0));
  assert.deepEqual(journeyPose(1000), journeyPose(108));
  assert.deepEqual(journeyPose(83.71, 'first-person'), journeyPose(83.71, 'first-person'));
  const changed = journeyPose(0); changed.position[0] = -99; changed.target[0] = -99;
  assert.equal(journeyPose(0).position[0], 340);
  assert.equal(journeyPose(0).target[0], 0);
});

test('malformed times, camera modes and encounter caps are rejected', () => {
  for (const value of [undefined, null, '72', NaN, Infinity, {}, []]) assert.throws(() => journeyPose(value));
  for (const mode of ['', 'firstperson', null, 1, {}]) assert.throws(() => journeyPose(0, mode));
  for (const level of ['', 'aliens', null, 1, {}]) assert.throws(() => journeyPose(0, 'witness', level));
});
