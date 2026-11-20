// SPDX-License-Identifier: GPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { geometry, IDEAL_SLOPES, modelSweep, crossSection, similarityFit, angularSeparation, tangentPlane } from "../instrument-math.mjs";

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const pointsNear = (actual, expected, tolerance = 1e-10) => actual.forEach((point, i) => point.forEach((coordinate, j) => near(coordinate, expected[i][j], tolerance)));

test("independent 3-4-5 pyramid section has known lengths, areas and volume", () => {
  const g = geometry(6, Math.atan(4 / 3) * 180 / Math.PI);
  near(g.half, 3); near(g.height, 4); near(g.slant, 5);
  near(g.pi, 3); near(g.tau, 6); near(g.phi, 5 / 3); near(g.seked, 21 / 4);
  near(g.volume, 48); near(g.baseArea, 36); near(g.lateralArea, 60);
});

test("shape ratios are unit invariant while areas and volumes scale appropriately", () => {
  const a = geometry(230.363, 51 + 52 / 60), b = geometry(230.363 / 0.3048, 51 + 52 / 60), k = 1 / .3048;
  for (const key of ["pi", "tau", "phi", "seked"]) near(a[key], b[key]);
  near(b.height / a.height, k); near(b.baseArea / a.baseArea, k * k); near(b.volume / a.volume, k ** 3);
});

test("ideal hypotheses meet their own definitions and do not equate pi with phi", () => {
  const pi = geometry(230.363, IDEAL_SLOPES.pi), phi = geometry(230.363, IDEAL_SLOPES.phi), seked = geometry(230.363, IDEAL_SLOPES.seked);
  near(pi.pi, Math.PI); near(phi.phi, (1 + Math.sqrt(5)) / 2); near(seked.seked, 5.5); near(seked.pi, 22 / 7);
  assert.ok(Math.abs(pi.phi - phi.phi) > .0001);
  near(Math.abs(IDEAL_SLOPES.pi - IDEAL_SLOPES.phi), .02668, .000002);
  const sweep = modelSweep(230.363, 52);
  assert.deepEqual(sweep.map(g => g.key), ["measured", "seked", "pi", "phi"]);
  near(sweep[0].heightDelta, 0); near(sweep[0].slopeDeg, 52);
});

test("horizontal slices conserve volume and put seven eighths below half height", () => {
  const g = geometry(6, 45), base = crossSection(6, 45, 0), mid = crossSection(6, 45, .5), apex = crossSection(6, 45, 1);
  near(base.side, 6); near(base.volumeBelow, 0); near(base.volumeAbove, g.volume);
  near(mid.side, 3); near(mid.area, 9); near(mid.fractionBelow, 7 / 8);
  near(mid.volumeBelow + mid.volumeAbove, g.volume);
  near(apex.side, 0); near(apex.area, 0); near(apex.volumeBelow, g.volume);
  assert.ok(crossSection(6, 45, 1e-16).fractionBelow > 0);
});

test("proper similarity fit recovers a known quarter turn, scale and translation", () => {
  const source = [[0, 0], [2, 0], [0, 1], [3, 2]];
  const target = source.map(([x, y]) => [11 - 3 * y, -7 + 3 * x]);
  const fit = similarityFit(source, target);
  near(fit.rotationDeg, 90); near(fit.scale, 3); pointsNear([fit.translation], [[11, -7]]);
  near(fit.rms, 0); pointsNear(fit.transformed, target);
  assert.equal(fit.reflected, false); assert.ok(fit.residuals.every(r => r.distance < 1e-12));
});

test("fitting paired points reports residuals in target units without silently reflecting", () => {
  const source = [[0, 0], [3, 0], [0, 1], [1, 2]], target = source.map(([x, y]) => [-2 * x + 10, 2 * y + 5]);
  const proper = similarityFit(source, target), mirrored = similarityFit(source, target, { reflect: true });
  assert.ok(proper.rms > .5); near(mirrored.rms, 0); near(mirrored.scale, 2);
  near(mirrored.rotationDeg, 0); pointsNear([mirrored.translation], [[10, 5]]); assert.equal(mirrored.reflected, true);
  const movedTarget = target.map(([x, y]) => [x + 50, y - 32]);
  near(similarityFit(source, movedTarget).rms, proper.rms);
});

test("noisy fit is least squares, with zero mean residual and correct RMS definition", () => {
  const source = [[-1, -1], [1, -1], [1, 1], [-1, 1]], target = [[-1, -.9], [1.1, -1], [1, 1.1], [-.9, 1]];
  const fit = similarityFit(source, target);
  near(fit.residuals.reduce((sum, r) => sum + r.dx, 0), 0);
  near(fit.residuals.reduce((sum, r) => sum + r.dy, 0), 0);
  near(fit.rms ** 2, fit.residuals.reduce((sum, r) => sum + r.dx ** 2 + r.dy ** 2, 0) / 4);
  // Translating the least-squares solution by +1 along X must add exactly 1 to MSE.
  const shiftedMSE = fit.transformed.reduce((sum, [x, y], i) => sum + (target[i][0] - x - 1) ** 2 + (target[i][1] - y) ** 2, 0) / 4;
  near(shiftedMSE, fit.rms ** 2 + 1);
});

test("angular separation remains accurate near coincidence and antipodes", () => {
  near(angularSeparation([1, 0, 0], [0, 3, 0]), 90);
  near(angularSeparation([1, 0, 0], [-1, 0, 0]), 180);
  const tiny = 1e-10;
  near(angularSeparation([1, 0, 0], [Math.cos(tiny), Math.sin(tiny), 0]), tiny * 180 / Math.PI, 1e-16);
  near(angularSeparation([1e100, 0, 0], [2e100, 0, 0]), 0);
});

test("orthographic star projection uses directions, east-right and north-up", () => {
  const angle = Math.PI / 6, directions = [[0, 0, 20], [Math.sin(angle), 0, Math.cos(angle)], [0, Math.sin(angle), Math.cos(angle)], [0, 0, -1]];
  const projected = tangentPlane(directions, [0, 0, 100]);
  pointsNear(projected.points, [[0, 0], [.5, 0], [0, .5], [0, 0]]);
  assert.deepEqual(projected.visible, [true, true, true, false]); near(projected.depths[1], Math.cos(angle));
  const polar = tangentPlane([[1, 0, 0], [0, 1, 0]], [0, 1, 0]);
  assert.ok(polar.points.flat().every(Number.isFinite));
});

test("nonphysical geometry, invalid coordinates and degenerate fits fail explicitly", () => {
  for (const [base, slope] of [[0, 50], [-3, 50], [3, 0], [3, 90], [3, NaN]]) assert.throws(() => geometry(base, slope));
  assert.throws(() => crossSection(6, 45, 1.01)); assert.throws(() => crossSection(6, 45, -1));
  assert.throws(() => similarityFit([[0, 0]], [[1, 1]]));
  assert.throws(() => similarityFit([[0, 0], [0, 0]], [[0, 0], [1, 0]]), /Coincident/);
  assert.throws(() => similarityFit([[0, 0], [1, 0]], [[2, 2], [2, 2]]), /Coincident/);
  assert.throws(() => similarityFit([[0, 0], [1, NaN]], [[0, 0], [1, 0]]));
  assert.throws(() => angularSeparation([0, 0, 0], [1, 0, 0]));
  assert.throws(() => tangentPlane([[1, 0]], [1, 0, 0]));
});
