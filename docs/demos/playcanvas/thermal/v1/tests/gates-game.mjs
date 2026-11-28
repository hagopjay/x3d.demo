// Measurements for the Ridge Day gates: stratified rest, collision stability, clouds, determinism, the level
// tether and the bots (judged in tests/game.test.mjs and tools/receipt.mjs).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateRidgeDay, toX3D, fromX3D } from '../src/sim/level.js';
import { createAir, airConfig, cloudCells, cloudViolations } from '../src/sim/air.js';
import { createLBM } from '../src/sim/lbm.js';
import { createGlider, createSpeedHold } from '../src/sim/glider.js';
import { createTask, createBot, flyBots } from '../src/sim/task.js';
import { LIMITS } from './gates-air.mjs';

const L = LIMITS.gates;
export const LEVEL_URL = new URL('../levels/ridge-day.x3d', import.meta.url);
export const shippedLevel = () => fromX3D(readFileSync(LEVEL_URL, 'utf8'));

export function levelTether() {
  const text = readFileSync(LEVEL_URL, 'utf8');
  const gen = toX3D(generateRidgeDay());
  const lv = fromX3D(text), src = generateRidgeDay();
  let maxErr = 0;
  for (let i = 0; i < src.heights.length; i++) maxErr = Math.max(maxErr, Math.abs(lv.heights[i] - src.heights[i]));
  const A = airConfig(lv);
  // the lattice's terrain is the ElevationGrid read back: every column's first air row sits above its height
  let maskOK = true;
  for (let i = 0; i < lv.grid.nx; i++) {
    const j = A.ground[i], zc = lv.grid.zBottom + (j + 0.5) * lv.grid.dx, zb = lv.grid.zBottom + (j - 0.5) * lv.grid.dx;
    if (!(zc >= lv.heights[i] && zb < lv.heights[i])) maskOK = false;
  }
  const meta = JSON.stringify([lv.surface, lv.wind, lv.air, lv.task]) === JSON.stringify([src.surface, src.wind, src.air, src.task]);
  return { byte_equal: text === gen, sha256: createHash('sha256').update(text).digest('hex'), rows_uniform: lv.rowsUniform, max_height_err_m: maxErr, mask_matches_heights: maskOK, metadata_round_trips: meta };
}

export function stratifiedRest(twin = false) {
  const lv = shippedLevel();
  const A = airConfig(lv, { wind: false, sun: false, buoyMode: twin ? 'const' : 'profile' });
  const sim = createLBM(A.cfg);
  sim.steps(L.stratified_rest.steps);
  return { max_u: sim.maxU(), max_u_ms: sim.maxU() * A.units.toMs };
}

/** The game air for `steps` (12000 per limits.json), plus the cloud rule on the final field. */
export function stability(opts = {}) {
  const lv = shippedLevel();
  const air = createAir(lv, opts);
  const steps = L.collision_stability.steps;
  let blew = null;
  for (let s = 1; s <= steps; s++) {
    air.advance(1);
    if (s % 200 === 0) { const m = air.sim.maxU(); if (!(m <= L.collision_stability.u_max)) { blew = s; break; } }
  }
  const out = { steps_run: air.step, blew_up_at: blew, max_u: air.sim.maxU(), checkerboard: air.sim.checkerboard(), minutes: (air.step * air.units.dt) / 60 };
  if (!opts.collision && blew == null) {
    const cells = cloudCells(lv, air.A, air.sim), twinCells = cloudCells(lv, air.A, air.sim, 'height');
    out.clouds = { cells: cells.length, violations: cloudViolations(lv, air.A, air.sim, cells), twin_cells: twinCells.length, twin_violations: cloudViolations(lv, air.A, air.sim, twinCells), zLCL: air.zLCL };
  }
  return out;
}

/** The same tape twice (and once perturbed): per-step hashes of the air and the glider. */
export function determinism() {
  const g = L.determinism;
  const lv = shippedLevel();
  const tape = []; for (let k = 0; k < g.glider_steps; k++) tape.push(0.01 * Math.sin(k / 37) + 0.003 * Math.cos(k / 11));
  const run = (perturb) => {
    const air = createAir(lv);
    const airH = [];
    for (let s = 0; s < g.air_steps; s++) { air.advance(1); airH.push(air.sim.hash()); }
    const gl = createGlider({ x: 6500, z: 1150, speed: 30, heading: Math.PI / 2, wind: (x, z) => air.sample(x, z) });
    const ap = createSpeedHold(gl, { target: 30 });
    const gH = [];
    for (let k = 0; k < g.glider_steps; k++) {
      ap.update(1 / 120);
      gl.ctl.de += tape[k] + (perturb && k === 600 ? 1e-12 : 0);
      gl.ctl.bank = k > 1200 ? 0.3 : 0;
      gl.step(1 / 120);
      gH.push(gl.hash());
    }
    return { airH, gH };
  };
  const a = run(false), b = run(false), c = run(true);
  const diff = (x, y) => { let n = 0, first = null; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { n++; if (first == null) first = i; } return { mismatches: n, first_mismatch: first }; };
  const trace = (h) => createHash('sha256').update(h.join(',')).digest('hex');
  return {
    air: { steps: g.air_steps, ...diff(a.airH, b.airH), trace_sha256: trace(a.airH) },
    glider: { steps: g.glider_steps, ...diff(a.gH, b.gH), trace_sha256: trace(a.gH) },
    twin: diff(a.gH, c.gH),
  };
}

export function bots() {
  const lv = shippedLevel();
  const air = createAir(lv);
  air.advance(1500);
  const s = lv.task.start;
  const mk = (kind) => {
    const g = createGlider({ x: s.x, y: s.y, z: s.z, speed: s.speed / 3.6, heading: Math.PI / 2 + 0.4, wind: (x, z) => air.sample(x, z) });
    const task = createTask(lv);
    return { kind, g, task, bot: createBot(kind, lv, air, g, task), trace: [] };
  };
  const E = [mk('mc'), mk('naive')];
  flyBots(lv, air, E, { trace: true });
  return Object.fromEntries(E.map((e) => [e.kind, { status: e.task.status, finish_s: e.task.finishTime, reached: e.task.reached.map((r) => ({ name: r.name, t: +r.t.toFixed(1), z: Math.round(r.z) })), landed: e.task.log[0] || null, trace: e.trace }]));
}
