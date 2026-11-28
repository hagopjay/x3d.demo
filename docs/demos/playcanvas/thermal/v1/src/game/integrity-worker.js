// The in-game INTEGRITY referee: the Float64 CPU reference in a worker. The page sends it the GPU's full state at a
// step S (and the operator and heating in force); it runs the same number of steps and returns its fields, which
// the page compares with the GPU's own fields at S + steps.
import { fromX3D } from '../sim/level.js';
import { airConfig } from '../sim/air.js';
import { createLBM } from '../sim/lbm.js';

let level = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'level') { level = fromX3D(m.text); return; }
  if (m.type === 'window') {
    const A = airConfig(level, {});
    A.cfg.heat = m.heat;
    if (m.bgk) { A.cfg.collision = 'bgk'; A.cfg.smag = 0; }
    const sim = createLBM(A.cfg);
    sim.setState(m.f, m.g, m.nut, m.ux, m.uy, m.T);
    const t0 = performance.now();
    sim.steps(m.steps);
    self.postMessage({ type: 'result', id: m.id, ux: sim.ux, uy: sim.uy, T: sim.T, ms: performance.now() - t0 });
  }
};
