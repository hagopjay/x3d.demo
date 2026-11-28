// Measurements for the glider gates in tests/limits.json (judged in tests/glider.test.mjs and tools/receipt.mjs).
import { createGlider, createSpeedHold } from '../src/sim/glider.js';
import { ASW28, FIT, fitPolar, modelSink, steadyGlide } from '../src/sim/polar.js';
import { LIMITS } from './gates-air.mjs';

const DT = 1 / 120;

export function polarFit() {
  const twin = fitPolar(ASW28, { parasiticOnly: true });
  return { CD0: FIT.CD0, k: FIT.k, residuals_ms: FIT.residuals, max_abs_ms: FIT.maxAbs, twin_max_abs_ms: twin.maxAbs };
}

/** Sink (m/s) after 60 s settling and 20 s averaging at kmh, mass. */
export function glideAt(kmh, mass = ASW28.referenceMass, flags = {}) {
  const g = createGlider({ z: 3000, speed: kmh / 3.6, water: mass - ASW28.referenceMass, flags });
  const ap = createSpeedHold(g, { target: kmh / 3.6 });
  let sink = 0, n = 0, V = 0;
  for (let k = 0; k < 80 * 120; k++) {
    ap.update(DT); g.step(DT);
    if (k >= 60 * 120) { sink -= g.st.vz; V += g.airspeed(); n++; }
  }
  return { kmh, sink: sink / n, V: V / n };
}

export function steadyGlides(flags = {}) {
  const speeds = [80, 92.6, 100, 120.38, 140, 148.16, 170, 200];
  const rows = speeds.map((v) => {
    const r = glideAt(v, ASW28.referenceMass, flags);
    const model = modelSink(r.V, ASW28.referenceMass);
    const pub = ASW28.points.find((p) => p[0] === v);
    return { kmh: v, sink: r.sink, model, rel_err_vs_model: Math.abs(r.sink / model - 1), published: pub ? pub[1] : null, abs_err_vs_published: pub ? Math.abs(r.sink - pub[1]) : null };
  });
  return {
    rows,
    max_rel_err_vs_model: Math.max(...rows.map((r) => r.rel_err_vs_model)),
    max_abs_err_vs_published: Math.max(...rows.filter((r) => r.published != null).map((r) => r.abs_err_vs_published)),
  };
}

/** Best L/D and its speed from a 1 km/h sweep of the simulated glider (parabola through the best three). */
export function bestLD(mass, flags = {}) {
  // coarse locate from the model, then simulate a 1 km/h sweep around it
  let vm = 80, bm = 0;
  for (let v = 70; v <= 160; v += 1) { const s = steadyGlide(v / 3.6, mass, ASW28.wingArea, FIT.CD0, FIT.k); if (s.LD > bm) { bm = s.LD; vm = v; } }
  const pts = [];
  for (let v = vm - 4; v <= vm + 4; v += 1) {
    const r = glideAt(v, mass, flags);
    pts.push([r.V * 3.6, Math.sqrt(r.V * r.V - r.sink * r.sink) / r.sink]);   // L/D = cot(gamma)
  }
  let k = 1; for (let i = 1; i < pts.length - 1; i++) if (pts[i][1] > pts[k][1]) k = i;
  const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
  const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den;
  const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
  const C = (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / den;
  const v = -B / (2 * A);
  return { mass, ld: C - (B * B) / (4 * A), kmh: v };
}

export function ballast(flags = {}) {
  const light = bestLD(310, flags), heavy = bestLD(510, flags);
  const sq = Math.sqrt(510 / 310);
  return { light, heavy, ld_ratio_rel_err: Math.abs(heavy.ld / light.ld - 1), speed_ratio: heavy.kmh / light.kmh, sqrt_weight_ratio: sq, speed_ratio_rel_err: Math.abs(heavy.kmh / light.kmh / sq - 1) };
}

/**
 * Drag-free energy: trimmed at 150 km/h by the speed hold (drag on, camber moment off), then drag and airbrake off and
 * 120 s of elevator doublets (+-0.004 rad about the trim, 1.5 s each way, every 20 s) and banked turns (+-0.4 rad).
 */
export function energyDrift(flags = {}) {
  const g = createGlider({ z: 2000, speed: 150 / 3.6, flags: { camber: false } });
  const ap = createSpeedHold(g, { target: 150 / 3.6 });
  for (let k = 0; k < 60 * 120; k++) { ap.update(DT); g.step(DT); }
  const de0 = g.ctl.de;
  Object.assign(g.flags, { drag: false, camber: false, ...flags });
  const E0 = g.energy();
  let worst = 0, vmin = Infinity, vmax = 0;
  const n = LIMITS.gates.energy_without_drag.seconds * 120;
  for (let k = 0; k < n; k++) {
    const t = k / 120;
    g.ctl.de = de0 + 0.004 * (Math.floor(t / 1.5) % 2 ? 1 : -1) * (t % 20 < 3 ? 1 : 0);
    g.ctl.bank = t > 30 && t < 70 ? 0.4 : t > 80 && t < 100 ? -0.4 : 0;
    g.step(DT);
    const d = Math.abs(g.energy() - E0) / E0;
    if (!(d <= worst)) worst = d;
    const V = g.airspeed() * 3.6; vmin = Math.min(vmin, V); vmax = Math.max(vmax, V);
  }
  return { rel_drift: worst, kmh_range: [vmin, vmax] };
}

/** Pull-up from 160 km/h to 90 km/h in still air; both varios through the same filter. */
export function teVario() {
  const g = createGlider({ z: 2000, speed: 160 / 3.6 });
  const ap = createSpeedHold(g, { target: 160 / 3.6 });
  for (let k = 0; k < 60 * 120; k++) { ap.update(DT); g.step(DT); }
  let teMax = -Infinity, rawMax = -Infinity, t = 0;
  g.vario.te = -modelSink(160 / 3.6, 310); g.vario.raw = g.vario.te;
  while (g.airspeed() > 90 / 3.6 && t < 30) {
    g.ctl.de = 0.12; g.step(DT); t += DT;
    teMax = Math.max(teMax, g.vario.te); rawMax = Math.max(rawMax, g.vario.raw);
  }
  return { te_max_ms: teMax, raw_max_ms: rawMax, pull_seconds: t };
}
