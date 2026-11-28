// Diagnostic, not a gate: the quasi-static repose angle of the cohesionless weak-layer grains, found as the
// infinite-slope release angle with c = 0, against Davis's psi = 0 prediction atan(sin phi) and the naive phi.
import { Sim, material, GRANULAR, SNOW, G } from '../src/sim/mpm.js';
import { releaseAngle } from '../src/sim/referee.js';
import { SLOPE, slabSpeed } from '../src/sim/cases.js';
import { writeFileSync } from 'node:fs';
const rad = (d) => d * Math.PI / 180;
const trial = (th) => {
  const dx = 0.05, nx = 16, ny = 24;
  const S = new Sim({ nx, ny, dx, dt: 2e-4, periodicX: true, ramp: 0.4, walls: { bottom: 'sticky', top: 'free' }, gravity: [G * Math.sin(rad(th)), -G * Math.cos(rad(th))],
    materials: [material(SLOPE.slab), material({ ...SLOPE.weak, c: 0 })] });
  S.addBlock(0, dx, nx * dx, 2 * dx, 1); S.addBlock(0, 2 * dx, nx * dx, 2 * dx + 0.15, 1); S.addBlock(0, 2 * dx + 0.15, nx * dx, 2 * dx + 0.75, 0);
  let v1 = 0; for (let i = 1; i <= 6000; i++) { S.step(); if (i === 5000) v1 = slabSpeed(S); }
  const v2 = slabSpeed(S); return { th, v1, v2, released: v2 > 0.01 && v2 > v1 };
};
let lo = 15, hi = 35; const trials = [];
while (hi - lo > 0.25) { const m = (lo + hi) / 2, r = trial(m); trials.push(r); if (r.released) hi = m; else lo = m; }
const out = { release_deg: (lo + hi) / 2, davis_deg: releaseAngle({ layers: SLOPE.layers, c: 0, phi: 30, psi: 0 }), naive_deg: 30, trials };
writeFileSync(new URL('../receipts/diag-repose.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ release_deg: out.release_deg, davis_deg: out.davis_deg, naive_deg: 30 }));
