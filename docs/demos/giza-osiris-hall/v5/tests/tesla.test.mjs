import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TESLA_DEFAULTS, sanitizeTesla, teslaResponse, createReservoir,
  stepReservoir, teslaChoreography,
} from '../tesla.mjs';

const near = (a, b, relative = 1e-11, absolute = 1e-6) => {
  assert.ok(Math.abs(a - b) <= Math.max(absolute, relative * Math.max(Math.abs(a), Math.abs(b))), `${a} != ${b}`);
};
const balanced = state => near(state.initialEnergyJ + state.suppliedJ,
  state.energyJ + state.dissipatedJ + state.arcJ + state.spilledJ);

test('strict Tesla settings accept partial defaults and reject malformed ratings', () => {
  assert.deepEqual(sanitizeTesla({}), TESLA_DEFAULTS);
  assert.ok(Object.isFrozen(TESLA_DEFAULTS));
  for (const value of [null, [], 1, 'mythic', new Date()]) assert.throws(() => sanitizeTesla(value));
  for (const value of [NaN, Infinity, '50', -1, 121]) assert.throws(() => sanitizeTesla({ voltageMV: value }));
  assert.throws(() => sanitizeTesla({ secondaryPF: 0 }));
  assert.throws(() => sanitizeTesla({ skyHeightKm: 3.2 }));
  assert.throws(() => sanitizeTesla({ enabled: 'yes' }));
  assert.throws(() => sanitizeTesla({ mode: 'historically-proven' }));
  assert.throws(() => sanitizeTesla({ freePowerGW: 99 }));
});

test('SI conversion distinguishes reservoir energy from secondary resonance', () => {
  const r = teslaResponse(TESLA_DEFAULTS);
  near(r.capacitanceF, 10e-6, 1e-12, 1e-18);
  near(r.secondaryF, 100e-12, 1e-12, 1e-22);
  near(r.inductanceH, 0.28e-3, 1e-12, 1e-18);
  near(r.voltageV, 50e6);
  near(r.capacityJ, 12.5e9);
  near(r.f0KHz, 951.1327065021031, 1e-10);
  near(r.requestedArcW, 600e6);
  // Quadrupling the secondary C halves f0, without changing reservoir capacity.
  const changed = teslaResponse({ secondaryPF: 400 });
  near(changed.f0KHz, r.f0KHz / 2);
  near(changed.capacityJ, r.capacityJ);
});

test('resonator phase, loss and coupling remain finite at bounded ratings', () => {
  const baseline = teslaResponse(TESLA_DEFAULTS);
  const resonant = teslaResponse({ frequencyKHz: baseline.f0KHz });
  near(resonant.phase, -Math.PI / 2);
  near(resonant.gain, TESLA_DEFAULTS.coupling * resonant.effectiveQ);
  assert.ok(resonant.visualGain > 0 && resonant.visualGain < 1);
  assert.ok(teslaResponse({ q: 2 }).gain < teslaResponse({ q: 60 }).gain);
  assert.equal(teslaResponse({ coupling: 0 }).gain, 0);
  assert.equal(teslaResponse({ enabled: false }).gain, 0);
  for (const secondaryPF of [10, 5000]) for (const inductanceMH of [0.001, 100]) {
    const r = teslaResponse({ secondaryPF, inductanceMH });
    for (const value of Object.values(r)) assert.ok(Number.isFinite(value));
  }
});

test('sky height is display compression and cannot create energy or change circuit gain', () => {
  const low = teslaResponse({ skyHeightKm: 3.218688 });
  const high = teslaResponse({ skyHeightKm: 300 });
  near(low.displayHeight, 320);
  assert.ok(high.displayHeight > low.displayHeight && high.displayHeight < 700);
  for (const key of ['capacityJ', 'voltageV', 'gain', 'f0KHz', 'requestedArcW']) near(low[key], high[key]);
  const a = stepReservoir(createReservoir({ skyHeightKm: 3.218688 }), { skyHeightKm: 3.218688 }, 10);
  const b = stepReservoir(createReservoir({ skyHeightKm: 300 }), { skyHeightKm: 300 }, 10);
  assert.deepEqual(a, b);
  assert.deepEqual(teslaResponse({ mode: 'reference' }), teslaResponse({ mode: 'mythic' }));
});

test('precharge is explicitly accounted initial energy', () => {
  const empty = createReservoir(TESLA_DEFAULTS), full = createReservoir(TESLA_DEFAULTS, 1);
  assert.equal(empty.energyJ, 0); assert.equal(empty.initialEnergyJ, 0);
  near(full.energyJ, 12.5e9); near(full.initialEnergyJ, full.energyJ);
  near(full.voltageV, 50e6);
  const quarter = createReservoir(TESLA_DEFAULTS, 0.25);
  near(quarter.voltageV, 25e6);
  balanced(full); balanced(quarter);
  for (const fraction of [-1, 2, NaN, '1']) assert.throws(() => createReservoir(TESLA_DEFAULTS, fraction));
});

test('an empty reservoir can deliver only source power after passive leakage', () => {
  const s = { ...TESLA_DEFAULTS, supplyMW: 100, leakageMW: 5, arcMW: 1000, arcDuty: 1 };
  const state = stepReservoir(createReservoir(s), s, 2);
  assert.equal(state.energyJ, 0);
  near(state.dissipatedJ, 10e6);
  near(state.arcJ, 190e6);
  near(state.unservedJ, 1810e6);
  near(state.deliveredArcW, 95e6);
  near(state.arcAvailability, 0.095);
  balanced(state);
});

test('zero supply cannot sustain arcs from an empty reservoir', () => {
  const s = { ...TESLA_DEFAULTS, supplyMW: 0 };
  let state = createReservoir(s);
  for (let i = 0; i < 120; i++) state = stepReservoir(state, s, 0.1);
  assert.equal(state.energyJ, 0); assert.equal(state.arcJ, 0);
  assert.equal(state.dissipatedJ, 0); assert.equal(state.arcAvailability, 0);
  assert.ok(state.unservedJ > 0); balanced(state);
});

test('finite precharge depletes under arcs and cannot produce extra energy', () => {
  const s = { ...TESLA_DEFAULTS, supplyMW: 0, leakageMW: 0, arcMW: 1000, arcDuty: 1 };
  let state = stepReservoir(createReservoir(s, 1), s, 5);
  near(state.energyJ, 7.5e9); near(state.arcJ, 5e9); near(state.arcAvailability, 1);
  state = stepReservoir(state, s, 10);
  assert.equal(state.energyJ, 0); near(state.arcJ, 12.5e9);
  near(state.unservedJ, 2.5e9); near(state.arcAvailability, 0.75);
  state = stepReservoir(state, s, 1);
  assert.equal(state.deliveredArcW, 0); near(state.arcJ, 12.5e9); balanced(state);
});

test('full capacity spills excess input without losing the ledger', () => {
  const s = { ...TESLA_DEFAULTS, supplyMW: 5000, leakageMW: 0, standingArcs: false };
  const state = stepReservoir(createReservoir(s), s, 10);
  near(state.energyJ, 12.5e9); near(state.spilledJ, 37.5e9);
  assert.equal(state.arcJ, 0); assert.equal(state.unservedJ, 0);
  balanced(state);
});

test('lowering capacity spills stored excess, and zero voltage serves no arcs', () => {
  const full = createReservoir(TESLA_DEFAULTS, 1);
  const lowered = stepReservoir(full, { voltageMV: 25, supplyMW: 0, leakageMW: 0, arcMW: 0 }, 1);
  near(lowered.energyJ, 3.125e9); near(lowered.spilledJ, 9.375e9); balanced(lowered);
  const zero = stepReservoir(full, { voltageMV: 0 }, 2);
  assert.equal(zero.capacityJ, 0); assert.equal(zero.energyJ, 0);
  assert.equal(zero.deliveredArcW, 0); assert.equal(zero.voltageV, 0);
  assert.equal(zero.dissipatedJ, 0); near(zero.spilledJ, 13.7e9); balanced(zero);
});

test('disabled source and arcs leave only passive discharge', () => {
  const s = { ...TESLA_DEFAULTS, enabled: false };
  const state = stepReservoir(createReservoir(s, 1), s, 10);
  assert.equal(state.suppliedJ, 0); assert.equal(state.arcJ, 0);
  near(state.dissipatedJ, 50e6); near(state.energyJ, 12.45e9); balanced(state);
});

test('integration is invariant to partitioning through depletion and saturation', () => {
  const scenarios = [
    { settings: { supplyMW: 100, leakageMW: 5, arcMW: 1000, arcDuty: 1 }, charge: 0.5, time: 25 },
    { settings: { supplyMW: 5000, leakageMW: 5, arcMW: 20, arcDuty: 1 }, charge: 0.25, time: 25 },
    { settings: { supplyMW: 1, leakageMW: 5, standingArcs: false }, charge: 0.01, time: 100 },
  ];
  for (const scenario of scenarios) {
    const s = sanitizeTesla(scenario.settings);
    const whole = stepReservoir(createReservoir(s, scenario.charge), s, scenario.time);
    let divided = createReservoir(s, scenario.charge);
    for (let i = 0; i < 1000; i++) divided = stepReservoir(divided, s, scenario.time / 1000);
    for (const key of ['time', 'energyJ', 'initialEnergyJ', 'suppliedJ', 'dissipatedJ', 'arcJ', 'unservedJ', 'spilledJ']) near(divided[key], whole[key], 1e-9, 1e-3);
    balanced(whole); balanced(divided);
  }
});

test('energy balance and bounds hold across changing scenario ratings', () => {
  let state = createReservoir(TESLA_DEFAULTS, 0.37);
  for (let i = 0; i < 600; i++) {
    const s = sanitizeTesla({
      voltageMV: i % 97 === 0 ? 0 : 2 + (i * 17) % 118,
      capacitanceUF: 0.01 + (i * 7) % 99,
      supplyMW: (i * 701) % 5000, arcMW: (i * 137) % 5000,
      arcDuty: (i % 11) / 10, leakageMW: i % 101,
      enabled: i % 5 !== 0, standingArcs: i % 7 !== 0,
    });
    state = stepReservoir(state, s, 0.031 + i % 13 / 10);
    assert.ok(state.energyJ >= 0 && state.energyJ <= state.capacityJ);
    assert.ok(state.arcAvailability >= 0 && state.arcAvailability <= 1);
    balanced(state);
  }
});

test('state/time validation rejects corruption and zero dt preserves a state', () => {
  const state = createReservoir(TESLA_DEFAULTS, 0.25);
  assert.deepEqual(stepReservoir(state, TESLA_DEFAULTS, 0), state);
  for (const dt of [-1, NaN, Infinity, '1', 3601]) assert.throws(() => stepReservoir(state, TESLA_DEFAULTS, dt));
  assert.throws(() => stepReservoir({ ...state, energyJ: -1 }, TESLA_DEFAULTS, 1));
  assert.throws(() => stepReservoir({ ...state, arcJ: NaN }, TESLA_DEFAULTS, 1));
  assert.throws(() => stepReservoir(null, TESLA_DEFAULTS, 1));
});

test('choreography escalates, returns, clamps, and respects visibility controls', () => {
  assert.deepEqual(teslaChoreography(0, TESLA_DEFAULTS), { intensity: 0, regional: 0, sky: 0, earth: 0, arc: 0 });
  assert.equal(teslaChoreography(36, TESLA_DEFAULTS).intensity, 0.75);
  assert.equal(teslaChoreography(60, TESLA_DEFAULTS).arc, 0.6);
  assert.equal(teslaChoreography(78, TESLA_DEFAULTS).regional, 1);
  assert.equal(teslaChoreography(90, TESLA_DEFAULTS).earth, 1);
  assert.deepEqual(teslaChoreography(108, TESLA_DEFAULTS), { intensity: 0, regional: 0, sky: 0, earth: 0, arc: 0 });
  assert.deepEqual(teslaChoreography(-20, TESLA_DEFAULTS), teslaChoreography(0, TESLA_DEFAULTS));
  assert.deepEqual(teslaChoreography(400, TESLA_DEFAULTS), teslaChoreography(108, TESLA_DEFAULTS));
  assert.deepEqual(teslaChoreography(85, { enabled: false }), { intensity: 0, regional: 0, sky: 0, earth: 0, arc: 0 });
  const capped = teslaChoreography(85, { regional: false, globe: false, standingArcs: false });
  assert.equal(capped.arc, 0); assert.equal(capped.regional, 0); assert.equal(capped.earth, 0);
  assert.equal(teslaChoreography(85, { voltageMV: 0 }).arc, 0);
  assert.throws(() => teslaChoreography(NaN, TESLA_DEFAULTS));
  for (let time = 0; time <= 108; time += 0.1) for (const value of Object.values(teslaChoreography(time, TESLA_DEFAULTS))) assert.ok(value >= 0 && value <= 1);
});
