// The two GSAP helpers that need no import of gsap itself, so the Node exporter and a browser page (gsap as a global) share them.
export const clone = (v) => (typeof v === 'number' ? v : Object.fromEntries(Object.entries(v).filter(([k]) => k[0] !== '_').map(([k, x]) => [k, clone(x)])));   // GSAP hangs its own _gsap record on every target
// every tween start, end and repeat boundary in the (nested) timeline, with the tween: those instants stay keys
export function tweenSpans(tl, out = [], base = 0) {
  for (const c of tl.getChildren(false, true, true, 0)) {
    const s = base + c.startTime(), ts = c.timeScale() || 1;
    if (c.getChildren && c.getChildren(false, true, true).length) { tweenSpans(c, out, s); continue; }
    const d = c.duration() / ts, total = c.totalDuration() / ts, n = d > 0 ? Math.round(total / d) : 1; out.push({ tween: c, start: s, end: s + total, bounds: Array.from({ length: n + 1 }, (_, i) => +(s + d * i).toFixed(9)) });
  } return out;
}
export const tweenTimes = (tl) => new Set(tweenSpans(tl).flatMap((s) => s.bounds));
// the authored instants per animated channel: Map 'def.field' -> Set of times (tween starts, ends and repeat boundaries); targets is the tree the timeline animates
export function authoredTimes(tl, targets) {
  const idx = new Map(); for (const d in targets) for (const f in targets[d]) if (typeof targets[d][f] === 'object') idx.set(targets[d][f], d + '.' + f);
  const out = new Map(); for (const s of tweenSpans(tl)) for (const tg of s.tween.targets()) { const k = idx.get(tg); if (!k) continue; if (!out.has(k)) out.set(k, new Set()); for (const b of s.bounds) out.get(k).add(b); }
  return out;
}
