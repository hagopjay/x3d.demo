// The storm in the browser: the GPU solver at the game's resolution, the CPU solver on a 2 x 2 coarser grid as a
// running reference, the water ledger (in, out, stored, lost to numerics) and the INTEGRITY readout. No renderer
// here: the game draws from sample(), and tools/level-gpu.cjs runs the same object headless.
import { createGpuSolver } from '../gpu/swe-gl.js';
import { createSolver } from '../sim/swe.js';
import { stormOptions, observe } from '../sim/game.js';
import { hydrographQ } from '../sim/level.js';

export function createStorm(level, earth, { scheme = 'hr', canvas } = {}) {
  const o = stormOptions(level, earth.bed);
  const gpu = createGpuSolver({ ...o, scheme, canvas });
  const ro = stormOptions(level, earth.bed, { factor: 2 });
  const ref = createSolver(ro);
  const N = level.nx * level.nz, A = level.dx * level.dx;
  const arrays = { h: new Float32Array(N), hu: new Float32Array(N), hv: new Float32Array(N), hmax: new Float32Array(N) };
  function pull() {
    const s = gpu.read();
    for (let k = 0; k < N; k++) { arrays.h[k] = s[4 * k]; arrays.hu[k] = s[4 * k + 1]; arrays.hv[k] = s[4 * k + 2]; arrays.hmax[k] = s[4 * k + 3]; }
    let v = 0; for (let k = 0; k < N; k++) v += arrays.h[k];
    return v * A;
  }
  const V0 = pull();
  const refV0 = ref.volume();
  const gref = { i: Math.floor(level.gauge.i / 2), j: Math.floor(level.gauge.j / 2) };
  const S = {
    level, earth, gpu, ref, arrays, V0, t: 0, done: false, series: [], peakStage: -Infinity, minFreeboard: Infinity,
    renderer: gpu.renderer, stepsPerSecond: 0, last: null,
  };
  /** Advance by up to `seconds` of simulated time, stopping early after `maxSteps` GPU steps. Returns steps taken. */
  S.advance = function (seconds, maxSteps = 400) {
    if (S.done) return 0;
    const target = Math.min(level.duration, S.t + seconds);
    let n = 0;
    while (gpu.t + 0.5 * gpu.dt < target && n < maxSteps) { gpu.step(); n++; }
    while (ref.t + 0.5 * ref.dt < gpu.t) ref.step();
    S.t = gpu.t;
    if (S.t >= level.duration - 0.5 * gpu.dt) S.done = true;
    return n;
  };
  /** Read the GPU state back and compute everything the HUD shows. */
  S.sample = function () {
    const stored = pull();
    const ob = observe(level, earth.bed, arrays);
    const red = gpu.reduce();
    const ledger = { V0, in: gpu.inflow, out: gpu.outflow, stored, lost: stored - (V0 + gpu.inflow - gpu.outflow) };
    ledger.rel = Math.abs(ledger.lost) / (V0 + gpu.inflow);
    const rk = gref.j * ref.nx + gref.i;
    const refStage = ref.h[rk] + ref.b[rk];
    const refStored = ref.volume();
    const integrity = {
      stageDiff: ob.stage - refStage, refStage,
      storedDiffRel: (stored - refStored) / Math.max(1, refStored),
      refLedgerRel: Math.abs(refStored - (refV0 + ref.inflow - ref.outflow)) / (refV0 + ref.inflow),
      ledgerRel: ledger.rel, tarnU: ob.tarnU, courant: red.courant, reductionVolume: red.volume,
      scheme: gpu.naive ? 'naive' : 'hr', renderer: gpu.renderer,
    };
    if (ob.stage > S.peakStage) S.peakStage = ob.stage;
    if (S.t > 0 && ob.freeboard < S.minFreeboard) S.minFreeboard = ob.freeboard;
    const last = S.series[S.series.length - 1];
    if (!last || S.t - last[0] >= 30 || S.done) S.series.push([S.t, ob.stage, refStage, ob.freeboard, hydrographQ(level, S.t)]);
    S.last = { t: S.t, ...ob, ledger, integrity, q: hydrographQ(level, S.t) };
    return S.last;
  };
  S.setNaive = (v) => gpu.setNaive(v);
  S.destroy = () => gpu.destroy();
  return S;
}
