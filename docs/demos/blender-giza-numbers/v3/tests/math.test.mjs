// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry, targets, sensitivity, solarPosition, latitudeDelta, seededSamples } from '../lab-math.mjs';

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
}

test('3:4:5 section gives independently known square-pyramid dimensions', () => {
  const g = geometry(6, 4);
  assert.equal(g.half, 3);
  assert.equal(g.slant, 5);
  assert.equal(g.area, 36);
  assert.equal(g.lateralArea, 60);
  assert.equal(g.volume, 48);
  assert.equal(g.pi, 3);
  assert.equal(g.tau, 6);
  assert.equal(g.phi, 5 / 3);
  assert.equal(g.seked, 21 / 4);
});

test('dimensionless geometry is invariant across metres, feet and cubits', () => {
  const reference = geometry(230.363, 146.721);
  for (const scale of [1 / 0.3048, 1 / 0.5236, 1000]) {
    const g = geometry(reference.base * scale, reference.height * scale);
    for (const field of ['pi', 'tau', 'phi', 'seked', 'slopeDeg']) near(g[field], reference[field]);
    near(g.volume / reference.volume, scale ** 3, scale ** 3 * 1e-14);
    near(g.area / reference.area, scale ** 2, scale ** 2 * 1e-14);
  }
});

test('ideal targets satisfy their definitions and distinguish close slopes', () => {
  const base = 440;
  const seked = geometry(base, targets.seked.heightForBase(base));
  const pi = geometry(base, targets.pi.heightForBase(base));
  const phi = geometry(base, targets.phi.heightForBase(base));
  near(seked.height, 280);
  near(seked.seked, 5.5);
  near(seked.pi, 22 / 7);
  near(pi.pi, Math.PI);
  near(phi.phi, (1 + Math.sqrt(5)) / 2);
  assert.ok(targets.phi.slopeDeg < targets.seked.slopeDeg);
  assert.ok(targets.seked.slopeDeg < targets.pi.slopeDeg);
});

test('correlated proportional scale uncertainty cancels from ratios', () => {
  const u = sensitivity(230, 146, 0.23, 0.146, 1);
  near(u.piSigma, 0, 1e-17);
  near(u.phiSigma, 0, 1e-17);
  const independent = sensitivity(230, 146, 0.23, 0.146, 0);
  assert.ok(independent.piSigma > 0.004);
  near(independent.tauSigma, independent.piSigma * 2);
});

test('uncertainty propagation matches numerical derivatives', () => {
  const b = 230.363, h = 146.721, ub = 0.07, uh = 0.181, step = 1e-3;
  const u = sensitivity(b, h, ub, uh);
  for (const key of ['pi', 'tau', 'phi']) {
    const dB = (geometry(b + step, h)[key] - geometry(b - step, h)[key]) / (2 * step);
    const dH = (geometry(b, h + step)[key] - geometry(b, h - step)[key]) / (2 * step);
    near(u[`${key}Sigma`], Math.hypot(dB * ub, dH * uh), 1e-11);
  }
});

test('equinox Sun rises east, culminates south at Giza and sets west', () => {
  near(solarPosition(30, 0, -90).altitudeDeg, 0);
  near(solarPosition(30, 0, -90).azimuthDeg, 90);
  const noon = solarPosition(30, 0, 0);
  near(noon.altitudeDeg, 60);
  near(noon.azimuthDeg, 180);
  near(noon.shadowLengthFactor, 1 / Math.sqrt(3));
  near(solarPosition(30, 0, 90).azimuthDeg, 270);
  assert.equal(solarPosition(30, 0, 180).shadowLengthFactor, null);
});

test('solar zenith has zero shadow and undefined azimuth', () => {
  const sun = solarPosition(23.44, 23.44, 0);
  near(sun.altitudeDeg, 90);
  near(sun.shadowLengthFactor, 0);
  assert.equal(sun.azimuthDeg, null);
  near(solarPosition(30, -23.44, 0).altitudeDeg, 36.56);
});

test('latitude conversion has centimetre resolution and signed meridian distance', () => {
  near(latitudeDelta(30, 30 + 1e-7), 0.01108524425, 2e-9);
  near(latitudeDelta(0, 1), 110574.388558, 1e-5);
  near(latitudeDelta(30, 30.002), -latitudeDelta(30.002, 30), 1e-10);
  assert.equal(latitudeDelta(30, 30), 0);
  near(latitudeDelta(29.979175, 29.9792458), 7.848195, 0.001);
});

test('seeded correlated samples are reproducible and reproduce linearized spread', () => {
  const options = {base:230.363, height:146.721, baseSigma:0.07, heightSigma:0.181, rho:0.25};
  assert.deepEqual(seededSamples(8, 123, options), seededSamples(8, 123, options));
  assert.notDeepEqual(seededSamples(8, 123, options), seededSamples(8, 124, options));
  const samples = seededSamples(20000, 19, options);
  const mean = samples.reduce((sum, g) => sum + g.pi, 0) / samples.length;
  const variance = samples.reduce((sum, g) => sum + (g.pi - mean) ** 2, 0) / (samples.length - 1);
  const u = sensitivity(options.base, options.height, options.baseSigma, options.heightSigma, options.rho);
  near(Math.sqrt(variance) / u.piSigma, 1, 0.025);
  const scaleOnly = seededSamples(30, 42, {...options, baseSigma:options.base / 100, heightSigma:options.height / 100, rho:1});
  scaleOnly.forEach(g => near(g.pi, geometry(options.base, options.height).pi));
});

test('invalid or nonphysical inputs fail explicitly', () => {
  assert.throws(() => geometry(0, 1), RangeError);
  assert.throws(() => geometry(1, -1), RangeError);
  assert.throws(() => geometry(NaN, 1), TypeError);
  assert.throws(() => geometry('230', 146), TypeError);
  assert.throws(() => sensitivity(230, 146, -1, 0.1), RangeError);
  assert.throws(() => sensitivity(230, 146, 1, 0.1, 1.1), RangeError);
  assert.throws(() => solarPosition(91, 0, 0), RangeError);
  assert.throws(() => solarPosition(30, 0, Infinity), TypeError);
  assert.throws(() => latitudeDelta(-91, 30), RangeError);
  assert.throws(() => seededSamples(-1, 1, {}), RangeError);
});
