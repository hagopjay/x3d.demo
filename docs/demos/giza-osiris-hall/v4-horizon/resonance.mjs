/**
 * Giza IV — dimensionless learning models, not a Maxwell solution or an
 * archaeological reconstruction. Coefficients below are authored assumptions.
 *
 * RF: x'' + x'/Q + x = drive cos(r t), r = f/f0.
 * Piezo: dV/dt + V/tau = k dF/dt, with dimensionless C = 1.
 * A static load gives a charging transient; it is not a continuing energy source.
 * Piezo time is illustrative seconds. RF motion shown in the scene is slowed.
 */

export const DEFAULTS = Object.freeze({
  frequency: 0.95, drive: 0.65, q: 12, moisture: 0.25,
  quartz: 0.3, alignment: 0.15, conductor: false, crystals: false,
  mechanical: 'static', load: 0.65,
});

const RANGES = Object.freeze({
  frequency: [0.5, 1.5], drive: [0, 1], q: [2, 40], moisture: [0, 1],
  quartz: [0, 1], alignment: [0, 1], load: [0, 1],
});

/** Validate saved assumptions strictly; omitted known fields use defaults. */
export function sanitizeSettings(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Settings must be an object.');
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new TypeError(`Unknown setting: ${key}`);
  }
  const out = { ...DEFAULTS, ...input };
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    finite(out[key], key, min, max);
  }
  for (const key of ['conductor', 'crystals']) {
    if (typeof out[key] !== 'boolean') throw new TypeError(`${key} must be boolean.`);
  }
  if (!['static', 'cyclic'].includes(out.mechanical)) {
    throw new TypeError('mechanical must be static or cyclic.');
  }
  return out;
}

function finite(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and within [${min}, ${max}].`);
  }
  return value;
}

function resolvedResponse(s, frequency) {
  // Moisture shifts the assumed natural frequency and increases damping.
  // A fictional conductor adds loss; this is not a material conductivity solver.
  const f0MHz = 0.95 / Math.sqrt(1 + 0.8 * (s.moisture - 0.25));
  const effectiveQ = s.q / (1 + 2 * s.moisture + (s.conductor ? 0.6 : 0));
  const r = frequency / f0MHz;
  const transfer = 1 / Math.hypot(1 - r * r, r / effectiveQ);
  const gain = s.drive * transfer;
  const phase = -Math.atan2(r / effectiveQ, 1 - r * r);
  // These use normalized oscillator units, never volts, joules, or watts.
  // Stored is energy-like; input/dissipated are rate-like and cannot be added.
  const stored = gain * gain * (1 + r * r) / 4;
  const dissipated = gain * gain * r * r / (2 * effectiveQ);
  const input = -s.drive * gain * r * Math.sin(phase) / 2;
  return {
    f0MHz, effectiveQ, gain, transfer, phase,
    visualGain: gain / (1 + gain), input, stored, dissipated,
  };
}

/** Steady-state driven response. gain may exceed one without creating energy. */
export function response(settings, frequencyMHz = settings?.frequency ?? DEFAULTS.frequency) {
  const s = sanitizeSettings(settings);
  finite(frequencyMHz, 'frequencyMHz', 0.5, 1.5);
  return resolvedResponse(s, frequencyMHz);
}

/** 161 equally spaced RF samples from 0.5 through 1.5 MHz. */
export function sweep(settings) {
  const s = sanitizeSettings(settings);
  return Array.from({ length: 161 }, (_, i) => {
    const frequency = 0.5 + i / 160;
    const { gain, phase } = resolvedResponse(s, frequency);
    return { frequency, gain, phase };
  });
}

export function createPiezoState() {
  return { time: 0, voltage: 0, force: 0, charge: 0, coupling: 0, tau: 1 };
}

/**
 * Exact RC integration for constant or sinusoidal force, including a load-change
 * impulse at the beginning of a step. Splitting a step preserves the result.
 * "voltage" is a dimensionless potential proxy, not a pyramid voltage estimate.
 * Cyclic forcing presumes continual mechanical work from an external source.
 */
export function stepPiezo(state, settings, dt) {
  const s = sanitizeSettings(settings);
  if (!state || typeof state !== 'object') throw new TypeError('Piezo state required.');
  const time = finite(state.time, 'state.time', 0);
  const voltage = finite(state.voltage, 'state.voltage');
  const oldForce = finite(state.force, 'state.force');
  finite(dt, 'dt', 0, 3600);
  if (dt === 0) return { ...state };
  const coupling = s.crystals ? s.quartz * s.alignment : 0;
  const tau = 3 / (1 + 3 * s.moisture + (s.conductor ? 2 : 0));
  const a = 1 / tau, w = 2 * Math.PI * 0.75;
  const amplitude = s.mechanical === 'cyclic' ? 0.35 * s.load : 0;
  const forceAt = t => s.load + amplitude * Math.sin(w * t);
  const force0 = forceAt(time), end = time + dt;
  const decay = Math.exp(-a * dt);
  let next = (voltage + coupling * (force0 - oldForce)) * decay;
  if (amplitude !== 0 && coupling !== 0) {
    const primitive = t => a * Math.cos(w * t) + w * Math.sin(w * t);
    next += coupling * amplitude * w *
      (primitive(end) - decay * primitive(time)) / (a * a + w * w);
  }
  return { time: end, voltage: next, force: forceAt(end), charge: next, coupling, tau };
}

const PHASES = Object.freeze([
  ['The inundation', 'Moonlit water reveals the imagined circuit beneath the plateau.', 'V_Overview'],
  ['The stone remembers', 'A changing load can move charge. A resting load cannot supply endless power.', 'V_Cutaway'],
  ['The tuning of the hall', 'Sweep the external drive; resonance redistributes supplied energy.', 'V_Chamber'],
  ['Heart and horizon', 'In this authored ritual, the ankh and a second instrument focus the passage.', 'V_Ritual'],
  ['The opening of the ways', 'An imagined luminous double crosses into a celestial architecture.', 'V_Stars'],
  ['Return with a witness', 'Return to the chamber and carry your assumptions back for examination.', 'V_Chamber'],
]);
export const JOURNEY_DURATION = 108;

/** Deterministic, seekable authored fiction; never a scientific prediction. */
export function journeyAt(seconds) {
  finite(seconds, 'seconds');
  const t = Math.max(0, Math.min(JOURNEY_DURATION, seconds));
  const index = Math.min(PHASES.length - 1, Math.floor(t / 18));
  const phaseProgress = Math.min(1, (t - index * 18) / 18);
  const [label, caption, view] = PHASES[index];
  const ease = x => x * x * (3 - 2 * x);
  const ka = index === 4 ? ease(phaseProgress) : index === 5 ? 1 - ease(phaseProgress) : 0;
  const cosmic = index === 4 ? ease(Math.min(1, phaseProgress * 3)) : index === 5 ? 1 - ease(phaseProgress) : 0;
  return { index, label, caption, view, progress: t / JOURNEY_DURATION, phaseProgress, ka, cosmic };
}
