/**
 * Seekable authored camera choreography for Giza IV.
 *
 * Coordinates: metres in the schematic X3D world; +Y up, -Z forward.
 * Chamber eyes: [0, 42.1, -0.7]. Portal: [0, 190, -30].
 * Encounter platform: [0, 180, -30]. First-person arrival eye:
 * [0, 187, 8], facing the tall visitors near [0, 197, -40].
 * All positions and encounter stages are invented staging, not survey data.
 * The six narrative phases remain owned by resonance.mjs.
 */
import { journeyAt, JOURNEY_DURATION } from './resonance.mjs';

export const CAMERA_MODES = Object.freeze(['witness', 'first-person']);
export const ENCOUNTER_LEVELS = Object.freeze(['geometry', 'craft', 'beings']);

const EYES = [0, 42.1, -0.7];
// A raised gaze that includes the was-sceptre at the lower edge of the view.
const UPWARD = [0.25, 42.8, -1.25];
const WAS = [0.39, 42.46, -1.03];

// Smoothstep interpolation stays inside each pair's coordinate bounds and has
// zero velocity at the keys. Camera switches and arbitrary seeks are deterministic.
const PATHS = {
  witness: [
    { t: 0, p: [340, 220, 420], at: [0, 65, 0], fov: 0.72 },
    { t: 18, p: [210, 122, 260], at: [0, 65, 0], fov: 0.76 },
    { t: 36, p: [5.2, 46, 7.2], at: [0, 43, 0], fov: 0.88 },
    { t: 54, p: [2.8, 43.2, 3], at: WAS, fov: 0.82 },
    { t: 72, p: [3.5, 53, 12], at: [0, 100, -25], fov: 0.86 },
    { t: 90, p: [24, 191, 35], at: [0, 197, -40], fov: 0.9 },
    { t: 108, p: [0.8, 44.5, 7], at: [0, 42.5, -0.7], fov: 0.86 },
  ],
  'first-person': [
    { t: 0, p: EYES, at: UPWARD, fov: 0.95 },
    { t: 18, p: EYES, at: UPWARD, fov: 0.95 },
    { t: 36, p: EYES, at: UPWARD, fov: 0.95 },
    { t: 54, p: [0, 43.5, 1], at: WAS, fov: 0.9 },
    { t: 72, p: [0, 55, 5], at: [0, 124, -28], fov: 0.94 },
    { t: 90, p: [0, 187, 8], at: [0, 197, -40], fov: 0.82 },
    { t: 108, p: EYES, at: UPWARD, fov: 0.95 },
  ],
};

const ease = value => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};
const ramp = (time, from, to) => ease((time - from) / (to - from));
const lerp = (a, b, amount) => a + (b - a) * amount;
const blend = (a, b, amount) => a.map((value, i) => lerp(value, b[i], amount));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = value => Math.hypot(...value);
const normalize = value => { const magnitude = length(value); return value.map(v => v / magnitude); };

/** A world-up look-at rotation with local camera -Z aimed at target. */
function lookAt(position, target) {
  const forward = normalize(target.map((value, i) => value - position[i]));
  let right = cross(forward, [0, 1, 0]);
  // The authored path never points exactly vertically. This fallback also
  // keeps look-at well defined if later keyframes deliberately do so.
  if (length(right) < 1e-9) right = cross(forward, [0, 0, 1]);
  right = normalize(right);
  const up = normalize(cross(right, forward));
  const back = forward.map(v => -v);
  // Matrix columns are the camera's right, up and back axes in world space.
  const m00 = right[0], m01 = up[0], m02 = back[0];
  const m10 = right[1], m11 = up[1], m12 = back[1];
  const m20 = right[2], m21 = up[2], m22 = back[2];
  let x, y, z, w;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const magnitude = Math.hypot(x, y, z, w);
  [x, y, z, w] = [x, y, z, w].map(value => value / magnitude);
  // q and -q describe the same rotation. Prefer an angle from zero to pi.
  if (w < 0) [x, y, z, w] = [-x, -y, -z, -w];
  const sine = Math.hypot(x, y, z);
  if (sine < 1e-12) return [0, 1, 0, 0];
  return [x / sine, y / sine, z / sine, 2 * Math.atan2(sine, Math.max(0, w))];
}

/**
 * @returns {{position:number[], orientation:number[], target:number[], fov:number,
 * stage:{geometry:number,machinery:number,craft:number,beings:number}, wasCoupling:number}}
 * fov and axis-angle orientation use radians, as X3D Viewpoint expects.
 * Encounter caps affect visibility only; they do not alter the camera path.
 */
export function journeyPose(seconds, mode = 'witness', level = 'beings') {
  const phase = journeyAt(seconds); // Shared finite-time validation and duration.
  if (!CAMERA_MODES.includes(mode)) throw new TypeError('Unknown journey camera mode.');
  if (!ENCOUNTER_LEVELS.includes(level)) throw new TypeError('Unknown encounter level.');
  const t = Math.max(0, Math.min(JOURNEY_DURATION, seconds));
  const keys = PATHS[mode];
  const index = Math.min(keys.length - 2, phase.index);
  const a = keys[index], b = keys[index + 1], fraction = ease((t - a.t) / (b.t - a.t));
  const position = blend(a.p, b.p, fraction), target = blend(a.at, b.at, fraction);
  const returnFade = 1 - ramp(t, 94, 106);
  const cap = ENCOUNTER_LEVELS.indexOf(level);
  return {
    position,
    orientation: lookAt(position, target),
    target,
    fov: lerp(a.fov, b.fov, fraction),
    stage: {
      geometry: ramp(t, 68, 76) * returnFade,
      machinery: cap >= 1 ? ramp(t, 40, 54) * returnFade : 0,
      craft: cap >= 1 ? ramp(t, 76, 82) * returnFade : 0,
      beings: cap >= 2 ? ramp(t, 82, 90) * returnFade : 0,
    },
    wasCoupling: ramp(t, 36, 66) * returnFade,
  };
}
