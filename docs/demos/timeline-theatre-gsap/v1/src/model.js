// The neutral timeline model both authoring tools are read into, and everything X3D-specific about field types.
//   state tree : { DEF: { field: number | {x,y,z} | {r,g,b} | {x,y} } }   (rotation = Euler degrees, see math.js)
//   timeline   : { name, duration, channels: [{ def, field, type, keys: [{ t, v: number[] }] }] }
// Channel values: SFFloat [v]; SFVec2f [x,y]; SFVec3f [x,y,z]; SFColor [r,g,b]; SFRotation [ax,ay,az,angle] (radians).
import { eulerToQuat, quatToAxisAngle, axisAngleToQuat, quatToEuler, qangle, slerp } from './math.js';

export const FIELD_TYPES = {
  translation: 'SFVec3f', scale: 'SFVec3f', center: 'SFVec3f', size: 'SFVec3f', location: 'SFVec3f', direction: 'SFVec3f', position: 'SFVec3f', attenuation: 'SFVec3f', bboxCenter: 'SFVec3f',
  rotation: 'SFRotation', orientation: 'SFRotation', scaleOrientation: 'SFRotation',
  diffuseColor: 'SFColor', emissiveColor: 'SFColor', specularColor: 'SFColor', color: 'SFColor', skyColor: 'SFColor', backColor: 'SFColor',
  transparency: 'SFFloat', shininess: 'SFFloat', ambientIntensity: 'SFFloat', intensity: 'SFFloat', radius: 'SFFloat', height: 'SFFloat', bottomRadius: 'SFFloat', fieldOfView: 'SFFloat',
  beamWidth: 'SFFloat', cutOffAngle: 'SFFloat', visibilityLimit: 'SFFloat', speed: 'SFFloat', pitch: 'SFFloat', gain: 'SFFloat', whichChoice: 'SFInt32',
};
export const COMPONENTS = { SFFloat: null, SFInt32: null, SFVec2f: ['x', 'y'], SFVec3f: ['x', 'y', 'z'], SFColor: ['r', 'g', 'b'], SFRotation: ['x', 'y', 'z'] };
export const INTERPOLATOR = { SFFloat: 'ScalarInterpolator', SFVec2f: 'PositionInterpolator2D', SFVec3f: 'PositionInterpolator', SFColor: 'ColorInterpolator', SFRotation: 'OrientationInterpolator' };
export const TYPE_OF_INTERPOLATOR = Object.fromEntries(Object.entries(INTERPOLATOR).map(([t, i]) => [i, t]));
export const typeOf = (field) => { const t = FIELD_TYPES[field]; if (!t) throw new Error(`unknown animatable field '${field}' (known: ${Object.keys(FIELD_TYPES).join(', ')}); add it to FIELD_TYPES`); return t; };

// state value -> channel value
export function toChannelValue(type, s) {
  if (type === 'SFFloat' || type === 'SFInt32') return [s];
  if (type === 'SFRotation') return quatToAxisAngle(eulerToQuat(s.x, s.y, s.z));
  return COMPONENTS[type].map((c) => s[c]);
}
// channel value -> state value (inverse; rotation goes to Euler degrees)
export function toStateValue(type, v) {
  if (type === 'SFFloat' || type === 'SFInt32') return v[0];
  if (type === 'SFRotation') { const e = quatToEuler(axisAngleToQuat(v)); return { x: e[0], y: e[1], z: e[2] }; }
  return Object.fromEntries(COMPONENTS[type].map((c, i) => [c, v[i]]));
}
// interpolate two channel values the way the X3D interpolator for that type does
// X3D 19775-1 section 30.3.3: ColorInterpolator interpolates in HSV space (hue in degrees, the short way round); X_ITE does so, so the bake must too
export function rgbToHsv([r, g, b]) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx > 0 ? d / mx : 0, mx]; }
export function hsvToRgb([h, s, v]) { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c, k = Math.floor(((h % 360) + 360) % 360 / 60); const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k]; return [t[0] + m, t[1] + m, t[2] + m]; }
export function lerpHsv(a, b, t) {
  const A = rgbToHsv(a), B = rgbToHsv(b); let dh = B[0] - A[0]; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  return hsvToRgb([((A[0] + dh * t) % 360 + 360) % 360, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
export function lerpValue(type, a, b, t) {
  if (type === 'SFColor') return lerpHsv(a, b, t);
  if (type === 'SFRotation') return quatToAxisAngle(slerp(axisAngleToQuat(a), axisAngleToQuat(b), t));
  return a.map((x, i) => x + (b[i] - x) * t);
}
export function distValue(type, a, b) {   // the error unit: radians for rotations, value units otherwise (max over components)
  if (type === 'SFRotation') return qangle(axisAngleToQuat(a), axisAngleToQuat(b));
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m;
}
export function sampleChannel(ch, t) {   // what the interpolator outputs at time t (clamped outside the key range)
  const k = ch.keys; if (t <= k[0].t) return k[0].v.slice(); if (t >= k[k.length - 1].t) return k[k.length - 1].v.slice();
  let lo = 0, hi = k.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].t <= t) lo = m; else hi = m; }
  return lerpValue(ch.type, k[lo].v, k[hi].v, (t - k[lo].t) / (k[hi].t - k[lo].t));
}
