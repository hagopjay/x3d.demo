// A storm on a level: the solver set-up the game and the tests share (inflow, boundaries, friction by material, the
// fixed step from the level's depth cap), the observations (town gauge, levee freeboard, houses, the still tarn),
// the water ledger, and the score. The same functions drive the CPU solver in Node and the GPU solver in the page.
import { createSolver, cflDt, DRY } from './swe.js';
import { MATERIALS, initialWater, hydrographQ } from './level.js';

export function manningField(level) { const n = new Float64Array(level.nx * level.nz); for (let k = 0; k < n.length; k++) n[k] = MATERIALS[level.mat[k]].manning; return n; }

/** Solver options for a level and an (edited) bed. factor 2 = the coarse reference (2 x 2 cells averaged). */
export function stormOptions(level, bed, { factor = 1 } = {}) {
  const fine = { nx: level.nx, nz: level.nz, dx: level.dx, bed, h: initialWater(level, bed), manning: manningField(level) };
  const g = factor === 1 ? fine : coarsen(fine, factor);
  const [i0, j0, i1, j1] = level.inflow;
  const rect = factor === 1 ? [i0, j0, i1, j1] : [Math.floor(i0 / factor), Math.floor(j0 / factor), Math.floor(i1 / factor), Math.floor(j1 / factor)];
  const cells = []; for (let j = rect[1]; j <= rect[3]; j++) for (let i = rect[0]; i <= rect[2]; i++) cells.push(j * g.nx + i);
  return {
    nx: g.nx, ny: g.nz, dx: g.dx, bed: g.bed, h: g.h, manning: g.manning, bc: { w: 'wall', e: 'open', s: 'wall', n: 'wall' },
    dt: cflDt(g.dx, level.hCap, level.uCap), sources: [{ cells, rect, q: (t) => hydrographQ(level, t) }], factor,
  };
}

/** Average a fine grid onto a coarser one (volume-preserving for the water). */
export function coarsen(f, k) {
  const nx = Math.floor(f.nx / k), nz = Math.floor(f.nz / k), N = nx * nz;
  const bed = new Float64Array(N), h = new Float64Array(N), manning = new Float64Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let b = 0, w = 0, n = 0;
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) { const q = (j * k + y) * f.nx + i * k + x; b += f.bed[q]; w += f.h[q]; n += f.manning[q]; }
    const c = j * nx + i; bed[c] = b / (k * k); h[c] = w / (k * k); manning[c] = n / (k * k);
  }
  return { nx, nz, dx: f.dx * k, bed, h, manning };
}

/** What the HUD and the score read from a state (h, hu, hv, hmax arrays on the level's fine grid). */
export function observe(level, bed, st) {
  const { nx } = level;
  const gk = level.gauge.j * nx + level.gauge.i;
  const stage = st.h[gk] + bed[gk];
  let freeboard = Infinity, worst = -1;
  for (const [crest, river] of level.levee) {
    const fb = bed[crest] - (st.h[river] + bed[river]);
    const over = st.h[crest] > 0.02 ? -st.h[crest] : fb;          // water standing on the crest: it is over
    const f = Math.min(fb, over);
    if (f < freeboard) { freeboard = f; worst = crest; }
  }
  const flooded = level.houses.map((hs) => st.hmax[hs.j * nx + hs.i] > level.houseFloor);
  const depth = level.houses.map((hs) => st.h[hs.j * nx + hs.i]);
  let tarnU = 0;
  const t = level.tarn;
  for (let j = t.j0; j <= t.j1; j++) for (let i = t.i0; i <= t.i1; i++) {
    const k = j * nx + i;
    if (st.h[k] > DRY) { const u = st.hu[k] / st.h[k], v = st.hv[k] / st.h[k]; tarnU = Math.max(tarnU, Math.sqrt(u * u + v * v)); }
  }
  return { stage, freeboard, worstLeveeCell: worst, flooded, nFlooded: flooded.filter(Boolean).length, depth, tarnU };
}

export function score(level, { nFlooded, money, cut, prediction, peakStage, breached }) {
  const dry = level.houses.length - nFlooded;
  let s = 100 * dry - Math.round(money / 1000) - Math.round(cut / 200);
  const rows = [['houses dry', `${dry} / ${level.houses.length}`, 100 * dry], ['money', `$${Math.round(money).toLocaleString('en-US')}`, -Math.round(money / 1000)], ['earth moved', `${Math.round(cut).toLocaleString('en-US')} m³`, -Math.round(cut / 200)]];
  if (prediction) {
    const call = prediction.call === (breached ? 'breach' : 'hold');
    rows.push(['your call', `${prediction.call.toUpperCase()} · ${call ? 'right' : 'wrong'}`, call ? 150 : 0]); if (call) s += 150;
    if (prediction.peak != null) { const near = Math.abs(prediction.peak - peakStage) <= 0.15; rows.push(['your peak', `${prediction.peak.toFixed(2)} m vs ${peakStage.toFixed(2)} m`, near ? 100 : 0]); if (near) s += 100; }
  }
  return { score: s, rows };
}

/**
 * Run the whole storm on the CPU (Node, the bot, the tests). Returns the outcome, the gauge hydrograph (every 60 s),
 * the water ledger and, with { hash: true }, the per-step hashes. { seconds } stops early.
 */
export function runStormCPU(level, earth, { seconds = level.duration, hash = false, scheme = 'hr', factor = 1, every = 60 } = {}) {
  const o = stormOptions(level, earth.bed, { factor });
  const S = createSolver({ ...o, hash, scheme });
  const V0 = S.volume();
  const series = [];
  const nSteps = Math.round(seconds / o.dt), each = Math.max(1, Math.round(every / o.dt));
  let peak = -Infinity, minFb = Infinity;
  for (let n = 1; n <= nSteps; n++) {
    S.step();
    if (factor === 1 && (n % each === 0 || n === nSteps)) {
      const ob = observe(level, earth.bed, S);
      series.push([S.t, ob.stage, ob.freeboard, hydrographQ(level, S.t)]);
      peak = Math.max(peak, ob.stage); minFb = Math.min(minFb, ob.freeboard);
    }
  }
  const V = S.volume();
  const ledger = { V0, in: S.inflow, out: S.outflow, stored: V, lost: V - (V0 + S.inflow - S.outflow), clamped: S.clamped };
  ledger.rel = Math.abs(ledger.lost) / (V0 + S.inflow);
  const out = { steps: nSteps, dt: o.dt, ledger, series, peakStage: peak, minFreeboard: minFb, hashes: S.hashes, S };
  if (factor === 1) { const ob = observe(level, earth.bed, S); Object.assign(out, { flooded: ob.flooded, nFlooded: ob.nFlooded }); }
  return out;
}
