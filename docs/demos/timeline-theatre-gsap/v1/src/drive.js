// Live driving: Theatre.js or GSAP (or our own sampler) keep the clock and the eases, the scene receives plain SAI field writes.
// Works on any engine that speaks the SAI subset  node[field] = new X3D.SFVec3f(...)  : X_ITE, and both bridges (Babylon, three.js) through x3d.webgpu's sai.js.
import { eulerToQuat, quatToAxisAngle } from './math.js';
import { typeOf, toChannelValue, sampleChannel, COMPONENTS } from './model.js';

export function toSai(X3D, type, v) {
  switch (type) {
    case 'SFFloat': case 'SFInt32': return v[0];
    case 'SFVec2f': return new X3D.SFVec2f(v[0], v[1]); case 'SFVec3f': return new X3D.SFVec3f(v[0], v[1], v[2]);
    case 'SFColor': return new X3D.SFColor(v[0], v[1], v[2]); case 'SFRotation': return new X3D.SFRotation(v[0], v[1], v[2], v[3]);
  } throw new Error('toSai: ' + type);
}
const same = (a, b) => a && a.length === b.length && a.every((x, i) => x === b[i]);
// write only what changed since the last call on this `cache` (a Map): a tween that holds still costs no events
export function writeChannelValue(X3D, scene, cache, def, field, type, v) {
  const k = def + '.' + field; if (same(cache.get(k), v)) return false; cache.set(k, v.slice());
  const n = scene.getNamedNode(def); if (!n) throw new Error(`driver: no node DEF '${def}' in the scene`); n[field] = toSai(X3D, type, v); return true;
}
export function applyState(X3D, scene, state, cache = new Map()) {   // state tree as the model describes it (rotation = Euler degrees)
  let n = 0; for (const [def, fs] of Object.entries(state)) for (const [field, val] of Object.entries(fs)) { if (field[0] === '_') continue; /* GSAP's own _gsap record on a target */ const type = typeOf(field); if (writeChannelValue(X3D, scene, cache, def, field, type, toChannelValue(type, val))) n++; } return n;
}
export function applyTimeline(X3D, scene, tl, t, cache = new Map()) { let n = 0; for (const ch of tl.channels) if (writeChannelValue(X3D, scene, cache, ch.def, ch.field, ch.type, sampleChannel(ch, t))) n++; return n; }
// GSAP: targets is the object tree the timeline animates (same shape as the state tree)
export function bindGsap(X3D, scene, tl, targets) { const cache = new Map(), push = () => applyState(X3D, scene, targets, cache); tl.eventCallback('onUpdate', push); push(); return () => tl.eventCallback('onUpdate', null); }
// Theatre: objects = { DEF: sheet.object(DEF, props) }; the object's own onValuesChange is the push
export function bindTheatre(X3D, scene, objects) { const cache = new Map(), offs = Object.entries(objects).map(([def, o]) => o.onValuesChange((v) => applyState(X3D, scene, { [def]: v }, cache))); return () => offs.forEach((f) => f()); }
// our own clock over a baked timeline (no GSAP, no Theatre), for pages that only want playback
export function playTimeline(X3D, scene, tl, { loop = true, now = () => performance.now() / 1000, raf = (f) => requestAnimationFrame(f) } = {}) {
  const cache = new Map(), t0 = now(); let live = true; (function tick() { if (!live) return; let t = now() - t0; if (loop) t %= tl.duration; else t = Math.min(t, tl.duration); applyTimeline(X3D, scene, tl, t, cache); if (loop || t < tl.duration) raf(tick); })(); return () => { live = false; };
}
