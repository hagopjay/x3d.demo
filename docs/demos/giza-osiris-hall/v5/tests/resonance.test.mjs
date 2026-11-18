import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, sanitizeSettings, response, sweep, createPiezoState, stepPiezo,
  journeyAt, JOURNEY_DURATION,
} from '../resonance.mjs';

const near = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`);
};

test('settings accept partial objects and reject malformed or unbounded assumptions', () => {
  assert.deepEqual(sanitizeSettings({}), DEFAULTS);
  assert.equal(sanitizeSettings({ drive: 0 }).drive, 0);
  for (const value of [null, [], 1, 'settings']) assert.throws(() => sanitizeSettings(value));
  for (const value of [NaN, Infinity, '0.8', -1, 2]) {
    assert.throws(() => sanitizeSettings({ drive: value }));
  }
  assert.throws(() => sanitizeSettings({ crystals: 1 }));
  assert.throws(() => sanitizeSettings({ conductor: 'false' }));
  assert.throws(() => sanitizeSettings({ mechanical: 'perpetual' }));
  assert.throws(() => sanitizeSettings({ megawatts: 42 }));
});

test('zero external drive gives no RF amplitude, stored energy or ongoing power', () => {
  for (const point of sweep({ drive: 0 })) assert.equal(point.gain, 0);
  const r = response({ ...DEFAULTS, drive: 0 });
  for (const key of ['gain', 'visualGain', 'stored', 'dissipated']) assert.equal(r[key], 0);
  near(r.input, 0);
});

test('natural-frequency response has quadrature phase and finite Q-limited gain', () => {
  const at = response(DEFAULTS, response(DEFAULTS).f0MHz);
  near(at.phase, -Math.PI / 2);
  near(at.gain, DEFAULTS.drive * at.effectiveQ);
  assert.ok(at.visualGain > 0 && at.visualGain < 1);
  assert.ok(response(DEFAULTS, 0.5).phase > -Math.PI / 2);
  assert.ok(response(DEFAULTS, 1.5).phase < -Math.PI / 2);
});

test('normalized steady-state supplied and dissipated rates balance across the sweep', () => {
  for (const moisture of [0, 0.5, 1]) for (const q of [2, 12, 40]) {
    for (const { frequency } of sweep({ moisture, q })) {
      const r = response({ moisture, q }, frequency);
      near(r.input, r.dissipated, 1e-9);
      assert.ok(r.effectiveQ > 0);
      assert.ok(Number.isFinite(r.gain) && Number.isFinite(r.stored));
    }
  }
});

test('moisture moves the assumed resonance and added loss reduces response at that frequency', () => {
  const dry = response({ moisture: 0 }), wet = response({ moisture: 1 });
  assert.ok(wet.f0MHz < dry.f0MHz);
  assert.ok(wet.effectiveQ < dry.effectiveQ);
  const a = response({ conductor: false });
  const b = response({ conductor: true });
  assert.ok(b.effectiveQ < a.effectiveQ);
  assert.ok(response({ conductor: true }, a.f0MHz).gain < response({ conductor: false }, a.f0MHz).gain);
});

test('sweep includes both endpoints and brackets its resonance peak', () => {
  const samples = sweep(DEFAULTS);
  assert.equal(samples.length, 161);
  assert.equal(samples[0].frequency, 0.5);
  assert.equal(samples.at(-1).frequency, 1.5);
  const peak = samples.reduce((a, b) => a.gain > b.gain ? a : b);
  assert.ok(Math.abs(peak.frequency - response(DEFAULTS).f0MHz) < 0.02);
});

test('static preload creates a finite transient and then decays without sustained output', () => {
  const s = { ...DEFAULTS, crystals: true, mechanical: 'static', quartz: 1, alignment: 1 };
  let state = stepPiezo(createPiezoState(), s, 0.01);
  assert.ok(state.voltage > 0);
  const start = state.voltage;
  state = stepPiezo(state, s, 30);
  assert.ok(Math.abs(state.voltage) < start * 1e-6);
  near(state.force, s.load);
  near(state.charge, state.voltage);
});

test('cyclic force sustains a response after the initial charge has leaked away', () => {
  const s = { ...DEFAULTS, crystals: true, mechanical: 'cyclic', quartz: 1, alignment: 1 };
  let state = stepPiezo(createPiezoState(), s, 30), square = 0;
  for (let i = 0; i < 120; i++) {
    state = stepPiezo(state, s, 1 / 60);
    square += state.voltage ** 2;
  }
  assert.ok(Math.sqrt(square / 120) > 0.05);
});

test('no enabled crystal coupling means no generated piezo charge', () => {
  for (const overrides of [{ crystals: false }, { crystals: true, quartz: 0 }, { crystals: true, alignment: 0 }]) {
    let state = createPiezoState();
    for (let i = 0; i < 100; i++) state = stepPiezo(state, { ...DEFAULTS, mechanical: 'cyclic', ...overrides }, 0.1);
    near(state.voltage, 0);
  }
});

test('analytical RC integration is invariant to timestep partition under unchanged settings', () => {
  for (const mechanical of ['static', 'cyclic']) {
    const s = { ...DEFAULTS, mechanical, crystals: true };
    const whole = stepPiezo(createPiezoState(), s, 7);
    let divided = createPiezoState();
    for (let i = 0; i < 700; i++) divided = stepPiezo(divided, s, 0.01);
    near(divided.time, whole.time, 1e-10);
    near(divided.voltage, whole.voltage, 1e-12);
    near(divided.force, whole.force, 1e-10);
  }
});

test('piezo rejects invalid time/state and zero dt preserves state', () => {
  const state = createPiezoState();
  assert.deepEqual(stepPiezo(state, DEFAULTS, 0), state);
  for (const dt of [-1, NaN, Infinity, '0.1']) assert.throws(() => stepPiezo(state, DEFAULTS, dt));
  assert.throws(() => stepPiezo({ ...state, voltage: Infinity }, DEFAULTS, 0.1));
});

test('journey is deterministic, bounded, seekable and returns to the chamber', () => {
  assert.equal(JOURNEY_DURATION, 108);
  assert.equal(journeyAt(-2).progress, 0);
  assert.equal(journeyAt(200).progress, 1);
  assert.equal(journeyAt(0).view, 'V_Overview');
  assert.equal(journeyAt(108).view, 'V_Chamber');
  assert.equal(journeyAt(108).ka, 0);
  assert.equal(journeyAt(108).cosmic, 0);
  assert.deepEqual(journeyAt(85.2), journeyAt(85.2));
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => journeyAt(i * 18).index), [0, 1, 2, 3, 4, 5]);
  for (let t = 0; t <= 108; t += 0.25) {
    const phase = journeyAt(t);
    for (const key of ['ka', 'cosmic', 'progress', 'phaseProgress']) assert.ok(phase[key] >= 0 && phase[key] <= 1);
  }
  assert.throws(() => journeyAt(NaN));
});
