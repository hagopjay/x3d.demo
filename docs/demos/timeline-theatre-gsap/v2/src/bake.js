// Bake any time function (Theatre sequence, GSAP timeline) into X3D-ready channels: sample on a grid plus the authored key times,
// then drop every sample the interpolator reproduces within a tolerance (Ramer-Douglas-Peucker with the X3D interpolation rule).
// X3D interpolators are piecewise linear (slerp for rotations); eases and Beziers are therefore approximated, and the error is MEASURED
// on an independent grid and returned, never assumed.
import { typeOf, toChannelValue, lerpValue, distValue, sampleChannel } from './model.js';

export const DEFAULT_TOL = { float: 0.002, color: 1 / 512, rotation: 0.002 };   // fraction of channel range (float, vector), absolute in colour units, radians
const tolFor = (type, vals, rel) => {
  if (type === 'SFRotation') return DEFAULT_TOL.rotation * (rel ?? 1);
  if (type === 'SFColor') return DEFAULT_TOL.color * (rel ?? 1);
  let lo = Infinity, hi = -Infinity; for (const v of vals) for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return Math.max(1e-6, (hi - lo) * DEFAULT_TOL.float * (rel ?? 1));
};

export function reduceKeys(type, keys, tol, mustT) {
  const keep = new Set([0, keys.length - 1]); const must = new Set(mustT.map((t) => keys.findIndex((k) => Math.abs(k.t - t) < 1e-9)).filter((i) => i >= 0));
  for (const i of must) keep.add(i);
  const marks = [...keep].sort((a, b) => a - b), stack = []; for (let i = 0; i + 1 < marks.length; i++) stack.push([marks[i], marks[i + 1]]);
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = -1, we = 0;
    for (let i = a + 1; i < b; i++) { const f = (keys[i].t - keys[a].t) / (keys[b].t - keys[a].t), e = distValue(type, lerpValue(type, keys[a].v, keys[b].v, f), keys[i].v); if (e > we) { we = e; worst = i; } }
    if (we > tol && worst > 0) { keep.add(worst); stack.push([a, worst], [worst, b]); }
  }
  return [...keep].sort((a, b) => a - b).map((i) => keys[i]);
}

// evalAt(t) -> state tree; rest = the state tree at rest (names which def/field pairs are animated); must = times that must stay keys.
// opts: duration (s), fps (sample rate, default 60), tol (multiplier of DEFAULT_TOL), only (def/field filter fn), constants (keep never-changing channels, default false),
//   must: times that stay keys. An array applies to every channel; a Map from 'def.field' to a Set or array of times applies per channel (the right choice: a staggered timeline has hundreds of instants, each belongs to one channel)
export function bake(name, evalAt, rest, { duration, fps = 60, must = [], tol = 1, only = null, constants = false } = {}) {
  if (!(duration > 0)) throw new Error('bake: duration must be > 0');
  const n = Math.max(2, Math.ceil(duration * fps)), grid = new Set(); for (let i = 0; i <= n; i++) grid.add(+(duration * i / n).toFixed(9));
  const mustMap = must instanceof Map, mustAll = mustMap ? [...must.values()].flatMap((v) => [...v]) : must, clampT = (a) => [...a].filter((t) => t >= 0 && t <= duration).map((t) => +t.toFixed(9));
  for (const t of [0, duration, ...clampT(mustAll)]) grid.add(+t.toFixed(9));
  const times = [...grid].sort((a, b) => a - b), states = times.map((t) => evalAt(t));
  const channels = [], report = [];
  for (const def of Object.keys(rest)) for (const field of Object.keys(rest[def])) {
    if (only && !only(def, field)) continue; const type = typeOf(field);
    const raw = times.map((t, i) => ({ t, v: toChannelValue(type, states[i][def][field]) }));
    if (type === 'SFRotation') for (let i = 1; i < raw.length; i++) { const a = raw[i - 1].v, b = raw[i].v; /* same rotation, either sign of axis: keep the axis continuous */ if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0 && b[3] > 1e-9) raw[i].v = [-b[0], -b[1], -b[2], -b[3]]; }
    const moving = raw.some((k) => distValue(type, k.v, raw[0].v) > 1e-9); if (!moving && !constants) continue;
    const tl = tolFor(type, raw.map((k) => k.v), tol), mine = mustMap ? clampT(must.get(def + '.' + field) || []) : clampT(must);
    const keys = moving ? reduceKeys(type, raw, tl, mine.filter((t) => t > 0 && t < duration)) : [raw[0], raw[raw.length - 1]];
    channels.push({ def, field, type, keys }); report.push({ def, field, type, samples: raw.length, keys: keys.length, tol: tl });
  }
  // independent check: 4x the grid, offset by a third of a step, against the oracle itself
  const m = n * 4, checkT = Array.from({ length: m }, (_, i) => duration * (i + 1 / 3) / m).filter((t) => t < duration);
  const worst = new Map(); for (const t of checkT) { const s = evalAt(t); for (const ch of channels) { const e = distValue(ch.type, sampleChannel(ch, t), toChannelValue(ch.type, s[ch.def][ch.field])), k = ch.def + '.' + ch.field; if (e > (worst.get(k) || 0)) worst.set(k, e); } }
  for (const r of report) r.maxErr = worst.get(r.def + '.' + r.field) || 0;
  return { timeline: { name, duration, channels }, report, checkPoints: checkT.length };
}
