// repair: the baseline optimizer. A deterministic hill-climb that moves palette colours
// the smallest distance that makes the grammar pass. It only ever changes OKLab lightness
// (hue and chroma are the style's identity), and it reports how far it moved.
// It is also the reference a learned optimizer has to beat (see evals.mjs).
import * as C from './color.mjs';
import { lint, resolve, bodyColour, dataColours, THRESHOLDS as T, idOf } from './grammar.mjs';

const setL = (hex, L) => { const [, c, h] = C.hexToOklch(hex); return C.oklchToHex([Math.min(0.97, Math.max(0.1, L)), c, h]); };
const failing = (s, scene, id) => { const r = lint(s, scene).rules.find(x => x.id === id); return r.applies && !r.pass; };

export function repair(styleIn, scene, { maxSteps = 400, step = 0.012 } = {}) {
  const before = lint(styleIn, scene);
  const s = JSON.parse(JSON.stringify(styleIn));
  const p = s.palette;
  let steps = 0;
  const log = [];
  const R = () => resolve(s);
  // G5: spread the ramp's lightness evenly between its two ends, keeping each stop's hue and chroma.
  if (failing(s, scene, 'G5')) {
    const L = p.sequential.map(C.lightness); let a = L[0], b = L[L.length - 1];
    if (Math.abs(b - a) < T.rampSpan) { const m = (a + b) / 2, d = (T.rampSpan / 2 + 0.02) * (b >= a ? 1 : -1); a = m - d; b = m + d; }
    p.sequential = p.sequential.map((h, i) => setL(h, a + (b - a) * i / (p.sequential.length - 1)));
    log.push('G5 ramp lightness made monotone');
  }
  // G4: push the closest pair of categories apart in lightness until both vision checks pass.
  while (failing(s, scene, 'G4') && steps < maxSteps) {
    const r = R(); const used = r.line.edges === 'data' ? p.categorical : p.categorical.map(d => bodyColour(r, d));
    let worst = null;
    for (const [kind, need] of [[null, T.categoryDE], ['deutan', T.categoryCvdDE], ['protan', T.categoryCvdDE]]) {
      const m = C.minPairDeltaE(used, kind); const gap = m.min / need;
      if (!worst || gap < worst.gap) worst = { gap, i: used.indexOf(m.pair[0]), j: used.indexOf(m.pair[1]) };
    }
    let { i, j } = worst; if (j === i) j = used.lastIndexOf(used[i]);
    const Li = C.lightness(p.categorical[i]), Lj = C.lightness(p.categorical[j]);
    const up = Li >= Lj ? i : j, down = up === i ? j : i;
    p.categorical[up] = setL(p.categorical[up], C.lightness(p.categorical[up]) + step);
    p.categorical[down] = setL(p.categorical[down], C.lightness(p.categorical[down]) - step);
    steps++;
  }
  if (steps) log.push(`G4 categories pushed apart in ${steps} steps`);
  // G3: move any body that sinks into the plate away from it.
  let g3 = 0;
  while (failing(s, scene, 'G3') && g3 < maxSteps) {
    const r = R(); const key = r.encode.hue === 'category' ? 'categorical' : r.encode.hue === 'value' ? 'sequential' : null;
    const Lp = C.lightness(p.plate);
    if (!key) { p.mass = setL(p.mass, C.lightness(p.mass) + (Lp > 0.6 ? -step : step)); g3++; continue; }
    const ds = p[key].map(h => C.deltaE(bodyColour(r, h), p.plate)); const k = ds.indexOf(Math.min(...ds));
    const L = C.lightness(p[key][k]);
    p[key][k] = setL(p[key][k], L + (Lp > 0.6 ? -step : step)); g3++;   // a light plate wants darker bodies, a dark plate lighter ones
  }
  if (g3) log.push(`G3 bodies moved off the plate in ${g3} steps`);
  // G2: darken or lighten the ink until labels read.
  let g2 = 0;
  while (failing(s, scene, 'G2') && g2 < maxSteps) { const L = C.lightness(p.ink); p.ink = setL(p.ink, L + (L >= C.lightness(p.ground) ? step : -step)); g2++; }
  if (g2) log.push(`G2 ink moved in ${g2} steps`);

  const after = lint(s, scene);
  const flat = o => [o.ground, o.plate, o.mass, o.ink, o.accent, o.alert, o.haze, ...o.sky, ...o.categorical, ...o.sequential];
  const A = flat(styleIn.palette), B = flat(p);
  const drifts = A.map((h, i) => C.deltaE(h, B[i]));
  const changed = drifts.filter(d => d > 1e-4).length;
  if (changed) { s.derivedFrom = [styleIn['@id']]; s.operator = 'repair'; }
  return { style: s, before: before.score, after: after.score, ok: after.ok, changed, colours: A.length,
    meanDrift: +(drifts.reduce((a, b) => a + b, 0) / A.length).toFixed(4), maxDrift: +Math.max(...drifts).toFixed(4), log, id: idOf(styleIn) };
}
