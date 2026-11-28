// Run one ladder case on the CPU solver: the same driver for Node tests, the exploration script and the browser.
import { createSolver } from './swe.js';

export function runCase(c, extra = {}) {
  const S = createSolver({ nx: c.nx, ny: c.ny, dx: c.dx, bed: c.bed, h: c.h, hu: c.hu, hv: c.hv, manning: c.manning, bc: c.bc, dt: c.dt, sources: c.sources, culverts: c.culverts, ...extra });
  const V0 = S.volume();
  if (c.sample) {
    const samples = [];
    for (let k = 1; k <= c.steps; k++) { S.step(); if (k % c.every === 0) samples.push([S.t, c.sample(S)]); }
    return { metrics: c.measure(S, samples), S };
  }
  S.run(c.steps);
  return { metrics: c.measure(S, V0), S };
}
