/**
 * Giza V — a user-rated lumped electrical bench for an authored Earth-coil story.
 * These ratings are scenario inputs, never measurements of Giza or the Earth.
 *
 * The reservoir capacitance (microfarads) and secondary capacitance (picofarads)
 * are separate circuit elements. Stored energy is in joules; power is in watts.
 * Height changes only a deliberately compressed display coordinate. Story mode
 * does not multiply voltage, power, gain, or reservoir energy.
 */
export const TESLA_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'mythic',
  voltageMV: 50,
  capacitanceUF: 10,
  supplyMW: 600,
  arcMW: 1000,
  leakageMW: 5,
  arcDuty: 0.6,
  frequencyKHz: 950,
  secondaryPF: 100,
  inductanceMH: 0.28,
  coupling: 0.65,
  skyHeightKm: 80,
  standingArcs: true,
  regional: true,
  globe: true,
  stormGlow: 0.75,
  q: 16,
});

const RANGES = Object.freeze({
  voltageMV: [0, 120], capacitanceUF: [0.01, 100],
  supplyMW: [0, 5000], arcMW: [0, 5000], leakageMW: [0, 100], arcDuty: [0, 1],
  frequencyKHz: [10, 2000], secondaryPF: [10, 5000], inductanceMH: [0.001, 100],
  coupling: [0, 1], skyHeightKm: [3.218688, 300], stormGlow: [0, 1], q: [2, 60],
});
const SWITCHES = ['enabled', 'standingArcs', 'regional', 'globe'];
const COUNTERS = ['time', 'energyJ', 'initialEnergyJ', 'suppliedJ', 'dissipatedJ', 'arcJ', 'unservedJ', 'spilledJ'];
const finite = (value, name, min = 0, max = Infinity) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and within [${min}, ${max}].`);
  }
  return value;
};

/** Strict bounded scenario import. Partial objects receive explicit defaults. */
export function sanitizeTesla(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Tesla settings must be an object.');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('Tesla settings must be a plain object.');
  for (const key of Object.keys(input)) if (!Object.hasOwn(TESLA_DEFAULTS, key)) throw new TypeError(`Unknown Tesla setting: ${key}`);
  const s = { ...TESLA_DEFAULTS, ...input };
  for (const [key, [min, max]] of Object.entries(RANGES)) finite(s[key], key, min, max);
  for (const key of SWITCHES) if (typeof s[key] !== 'boolean') throw new TypeError(`${key} must be boolean.`);
  if (!['reference', 'mythic'].includes(s.mode)) throw new TypeError('mode must be reference or mythic.');
  return s;
}

/**
 * Normalized SDOF response of a rated LC secondary, plus real SI unit conversion.
 * The assumed loaded Q is q/(1+coupling/2); this is not a field or arc solver.
 * gain is a dimensionless response factor, never a site voltage multiplier.
 * displayHeight is schematic world metres with a logarithmically compressed sky.
 */
export function teslaResponse(settings) {
  const s = sanitizeTesla(settings);
  const capacitanceF = s.capacitanceUF * 1e-6;
  const secondaryF = s.secondaryPF * 1e-12;
  const inductanceH = s.inductanceMH * 1e-3;
  const voltageV = s.voltageMV * 1e6;
  const f0KHz = 1 / (2 * Math.PI * Math.sqrt(inductanceH * secondaryF)) / 1000;
  const ratio = s.frequencyKHz / f0KHz;
  const effectiveQ = s.q / (1 + s.coupling * 0.5);
  const transfer = 1 / Math.hypot(1 - ratio * ratio, ratio / effectiveQ);
  const gain = s.enabled ? s.coupling * transfer : 0;
  return {
    f0KHz, ratio, gain, transfer, effectiveQ,
    phase: -Math.atan2(ratio / effectiveQ, 1 - ratio * ratio),
    capacityJ: 0.5 * capacitanceF * voltageV * voltageV,
    voltageV, capacitanceF, secondaryF, inductanceH,
    displayHeight: 320 + 180 * Math.log10(s.skyHeightKm / 3.218688),
    visualGain: gain / (1 + gain),
    requestedArcW: s.enabled && s.standingArcs ? s.arcMW * 1e6 * s.arcDuty : 0,
  };
}

/** An explicitly precharged fraction is initial energy, never free supplied power. */
export function createReservoir(settings, fraction = 0) {
  const s = sanitizeTesla(settings), r = teslaResponse(s);
  finite(fraction, 'Initial charge fraction', 0, 1);
  const energyJ = r.capacityJ * fraction;
  return {
    time: 0, energyJ, initialEnergyJ: energyJ,
    suppliedJ: 0, dissipatedJ: 0, arcJ: 0, unservedJ: 0, spilledJ: 0,
    capacityJ: r.capacityJ, chargeFraction: r.capacityJ > 0 ? fraction : 0,
    voltageV: r.capacityJ > 0 ? s.voltageMV * 1e6 * Math.sqrt(fraction) : 0,
    requestedArcW: r.requestedArcW, deliveredArcW: 0, deliveredLeakageW: 0, arcAvailability: 0,
  };
}

/**
 * Integrate constant rated powers exactly through empty/full boundary events.
 * Leakage has priority once the reservoir empties. Arcs then use only remaining
 * supply. A disabled bench disconnects source and arcs; passive leakage remains.
 *
 * Ledger: initialEnergyJ + suppliedJ = energyJ + dissipatedJ + arcJ + spilledJ.
 * unservedJ is requested arc energy that was not delivered, not another sink.
 * Lowering rated capacity spills existing excess explicitly. At zero rated
 * voltage, input spills and no arc or leakage power can leave the zero-energy bus.
 */
export function stepReservoir(state, settings, dt) {
  const s = sanitizeTesla(settings), r = teslaResponse(s);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Reservoir state must be an object.');
  for (const key of COUNTERS) finite(state[key], `state.${key}`);
  finite(dt, 'dt', 0, 3600);
  if (dt === 0) return { ...state };
  const capacity = r.capacityJ;
  const supplyW = s.enabled ? s.supplyMW * 1e6 : 0;
  const arcW = r.requestedArcW, leakW = s.leakageMW * 1e6;
  const supplied = supplyW * dt;
  let stored = Math.min(capacity, state.energyJ);
  let spilled = Math.max(0, state.energyJ - capacity), deliveredArc = 0, leaked = 0;
  if (capacity === 0) {
    spilled += supplied;
  } else {
    const demandW = leakW + arcW, netW = supplyW - demandW;
    if (netW >= 0) {
      leaked = leakW * dt;
      deliveredArc = arcW * dt;
      const next = stored + netW * dt;
      stored = Math.min(capacity, next);
      spilled += Math.max(0, next - capacity);
    } else {
      const activeTime = Math.min(dt, stored / -netW);
      const emptyTime = dt - activeTime;
      leaked = leakW * activeTime + Math.min(supplyW, leakW) * emptyTime;
      deliveredArc = arcW * activeTime + Math.min(arcW, Math.max(0, supplyW - leakW)) * emptyTime;
      stored = Math.max(0, stored + netW * activeTime);
    }
  }
  const requested = arcW * dt;
  return {
    time: state.time + dt,
    energyJ: stored,
    initialEnergyJ: state.initialEnergyJ,
    suppliedJ: state.suppliedJ + supplied,
    dissipatedJ: state.dissipatedJ + leaked,
    arcJ: state.arcJ + deliveredArc,
    unservedJ: state.unservedJ + Math.max(0, requested - deliveredArc),
    spilledJ: state.spilledJ + spilled,
    capacityJ: capacity,
    chargeFraction: capacity > 0 ? stored / capacity : 0,
    voltageV: Math.sqrt(2 * stored / r.capacitanceF),
    requestedArcW: arcW,
    deliveredArcW: deliveredArc / dt,
    deliveredLeakageW: leaked / dt,
    arcAvailability: requested > 0 ? Math.min(1, deliveredArc / requested) : 0,
  };
}

const ramp = (time, from, to) => {
  const x = Math.max(0, Math.min(1, (time - from) / (to - from)));
  return x * x * (3 - 2 * x);
};

/**
 * Authored visual staging only, not an energy source or arc-length prediction.
 * Multiply arc geometry brightness by stepReservoir().arcAvailability when
 * showing the bench. The story itself supplies no electrical energy.
 */
export function teslaChoreography(seconds, settings) {
  finite(seconds, 'seconds', -Infinity, Infinity);
  const s = sanitizeTesla(settings), t = Math.max(0, Math.min(108, seconds));
  if (!s.enabled) return { intensity: 0, regional: 0, sky: 0, earth: 0, arc: 0 };
  const fade = 1 - ramp(t, 90, 108);
  return {
    intensity: ramp(t, 12, 36) * fade * s.stormGlow,
    regional: s.regional ? ramp(t, 60, 78) * fade : 0,
    sky: ramp(t, 48, 72) * fade,
    earth: s.globe ? ramp(t, 78, 90) * fade : 0,
    arc: s.standingArcs && s.voltageMV > 0 && s.arcMW > 0
      ? ramp(t, 36, 60) * fade * s.arcDuty : 0,
  };
}
