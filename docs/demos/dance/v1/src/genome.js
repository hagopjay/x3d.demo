// A dancer's heritable style. Numbers have ranges; evolution mutates within
// them. `trans` holds move-family → move-family preference weights.
import { clamp, rng } from "./math.js";

export const FAMILIES = ["groove", "step", "footwork", "arms", "isolation", "travel", "turn", "hit", "social"];

export const GENES = {
  latency:        [0.06, 0.22, "s, how late the music is heard (then predicted forward)"],
  laidBack:       [-0.03, 0.045, "s, + sits behind the beat, − pushes ahead"],
  lockGain:       [0.8, 4.0, "how hard the body corrects toward the beat"],
  jitterMs:       [3, 22, "ms, per-beat human timing slip (pros: low)"],
  coupling:       [0.0, 0.6, "pull toward the partner's phase (resonance)"],
  bounce:         [0.5, 1.6, "depth of the groove layer"],
  amplitude:      [0.7, 1.25, "size of moves"],
  armStyle:       [0.0, 1.0, "how much arms join grooves"],
  looseness:      [0.5, 4.0, "deg, smooth body noise"],
  energyBias:     [0.7, 1.3, "matches more (or less) than the music's energy"],
  syncLove:       [0.0, 1.5, "appetite for off-beat moves when the music syncopates"],
  novelty:        [0.3, 2.0, "dislike of repeating recent moves"],
  checkInBars:    [1, 6, "bars between check-ins with the partner"],
  echo:           [0.0, 0.6, "chance to answer the partner with their move, mirrored"],
  hitLove:        [0.2, 1.0, "willingness to hit drops with a freeze or spin"],
  mistakeRate:    [0.0, 0.04, "per-move chance of a small slip (then a recovery)"],
  sway:           [0.2, 1.3, "two-beat weight transfer: hip shift and pelvis tilt"],
  counter:        [0.0, 1.0, "chest counter-rotation against the hips"],
  spring:         [0.6, 1.6, "follow-through stiffness (higher = tighter, less lag)"],
  stance:         [0.6, 1.5, "depth of the athletic stance"],
};

export function randomGenome(r, base = {}) {
  const g = { id: Math.floor(r() * 1e9).toString(36), parents: [], born: 0 };
  for (const [k, [lo, hi]] of Object.entries(GENES)) g[k] = base[k] ?? lo + (hi - lo) * r();
  g.trans = Object.fromEntries(FAMILIES.map((a) => [a, Object.fromEntries(FAMILIES.map((b) => [b, base.trans?.[a]?.[b] ?? 0.5 + r()]))]));
  return g;
}

/** Hand-set starting points: two pros with different feels. */
export const SEEDS = {
  ada: { latency: 0.1, laidBack: -0.008, lockGain: 2.6, jitterMs: 7, coupling: 0.25, bounce: 1.0, amplitude: 1.05, armStyle: 0.7,
         looseness: 2.0, energyBias: 1.05, syncLove: 1.1, novelty: 1.2, checkInBars: 2, echo: 0.3, hitLove: 0.7, mistakeRate: 0.006,
         sway: 0.9, counter: 0.6, spring: 1.1, stance: 1.0 },
  rex: { latency: 0.13, laidBack: 0.022, lockGain: 2.0, jitterMs: 10, coupling: 0.3, bounce: 1.3, amplitude: 1.0, armStyle: 0.45,
         looseness: 2.8, energyBias: 0.95, syncLove: 0.8, novelty: 1.0, checkInBars: 3, echo: 0.25, hitLove: 0.8, mistakeRate: 0.01,
         sway: 0.7, counter: 0.8, spring: 0.9, stance: 1.2 },
};

export function crossover(a, b, r) {
  const c = { id: Math.floor(r() * 1e9).toString(36), parents: [a.id, b.id], born: Math.max(a.born, b.born) + 1 };
  for (const k of Object.keys(GENES)) c[k] = r() < 0.5 ? a[k] : b[k];
  c.trans = {};
  for (const f of FAMILIES) c.trans[f] = r() < 0.5 ? { ...a.trans[f] } : { ...b.trans[f] };
  return c;
}

export function mutate(g, r, sigma = 0.12) {
  for (const [k, [lo, hi]] of Object.entries(GENES)) {
    if (r() < 0.35) g[k] = clamp(g[k] + r.normal() * sigma * (hi - lo), lo, hi);
  }
  for (const a of FAMILIES) for (const b of FAMILIES) {
    if (r() < 0.1) g.trans[a][b] = clamp(g.trans[a][b] * Math.exp(r.normal() * sigma * 2), 0.05, 4);
  }
  return g;
}
