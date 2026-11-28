// HAUL physics gates (tests/limits.json): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { G, SURFACES, TRUCK, surfaceMu } from '../src/sim/spec.js';
import { generate, uniform } from '../src/sim/level.js';
import { createSim, HZ, digest } from '../src/sim/truck.js';
import { margin, steepest, truckMass, BEST } from '../src/sim/feasible.js';
import { runBot, botInput } from '../tools/bot.mjs';

const require = createRequire(import.meta.url);
const Ammo = await require('../tools/ammo-node.cjs')();
const LIMITS = JSON.parse(readFileSync(new URL('./limits.json', import.meta.url))).gates;
const SURF = Object.fromEntries(SURFACES.map((s) => [s.name, s.id]));
const run = (sim, seconds, input) => { for (let i = 0; i < seconds * HZ; i++) sim.step(typeof input === 'function' ? input(sim) : input); return sim; };

test('static load: the tyres carry the weight', () => {
  const sim = run(createSim(Ammo, uniform(), {}), 4, { brake: 1 });
  const carried = sim.wheels.reduce((a, w) => a + w.fz * w.normal.y, 0);
  const weight = truckMass(0) * G;
  assert.ok(Math.abs(carried / weight - 1) <= LIMITS.static_load.rel_max, `carried ${carried.toFixed(0)} N, weight ${weight.toFixed(0)} N`);
});

for (const [name, wet] of LIMITS.brake_hold.cases) {
  test(`brake hold on ${name}, wetness ${wet}: holds below atan(mu), slides above`, () => {
    const mu = surfaceMu(SURF[name], wet);
    const thetaC = Math.atan(mu);
    for (const [factor, holds] of [[LIMITS.brake_hold.hold_at, true], [LIMITS.brake_hold.slide_at, false]]) {
      const grade = Math.tan(thetaC * factor);
      const sim = createSim(Ammo, uniform({ grade, surface: SURF[name], wetness: wet, runup: 0, startOnSlope: true }), {});
      run(sim, 1.5, { brake: 1 });            // settle
      const x0 = sim.out.pos.x;
      run(sim, LIMITS.brake_hold.seconds, { brake: 1 });
      const drift = Math.abs(sim.out.pos.x - x0);
      if (holds) assert.ok(drift <= LIMITS.brake_hold.hold_drift_max_m, `${(factor * 100).toFixed(0)} % of theta_c: drifted ${drift.toFixed(3)} m`);
      else assert.ok(drift >= LIMITS.brake_hold.slide_drift_min_m, `${(factor * 100).toFixed(0)} % of theta_c: only ${drift.toFixed(3)} m`);
    }
  });
}

for (const [name, wet] of LIMITS.traction_budget.cases) {
  test(`traction budget on ${name}, wetness ${wet}: climbs above +${LIMITS.traction_budget.margin}, spins below -${LIMITS.traction_budget.margin}`, () => {
    // the budget is peak grip, so the driver must hold the tyres at the peak: the EV's traction control does
    // (full diesel throttle spins past it, where asphalt keeps 76 %). Its battery mass is in the budget.
    const setup = { power: 'ev', drive: '6x6', lockers: true, pressure: BEST.pressure };
    const budget = { ...BEST, ballast: 2500 };
    const m = LIMITS.traction_budget.margin;
    for (const [want, climbs] of [[m, true], [-m, false]]) {
      const grade = steepest(SURF[name], wet, budget, null, want);
      assert.ok(Math.abs(margin(grade, SURF[name], wet, budget, null) - want) < 1e-3);
      const sim = createSim(Ammo, uniform({ grade, surface: SURF[name], wetness: wet, runup: 0, startOnSlope: true }), setup);
      run(sim, 1.5, { brake: 1 });
      const x0 = sim.out.pos.x;
      run(sim, LIMITS.traction_budget.seconds, { throttle: 1 });
      const gain = sim.out.pos.x - x0;
      if (climbs) assert.ok(gain >= LIMITS.traction_budget.climb_min_m, `grade ${(grade * 100).toFixed(1)} %: gained ${gain.toFixed(1)} m`);
      else assert.ok(gain <= LIMITS.traction_budget.spin_max_m, `grade ${(grade * 100).toFixed(1)} %: gained ${gain.toFixed(1)} m`);
    }
  });
}

test('coast-down on the flat matches rolling resistance and drag', () => {
  const sim = createSim(Ammo, uniform({ grade: 0, surface: SURF.asphalt, length: 600 }), { power: 'ev' });
  run(sim, 1, { brake: 1 });
  run(sim, 60, (s) => ({ throttle: s.speed < 10.5 ? 1 : 0.3 }));            // get to speed
  const v0 = sim.speed; const t0 = sim.time;
  run(sim, 3, { neutral: true });            // coasting in neutral: no drive, no regeneration
  const measured = (v0 - sim.speed) / (sim.time - t0);
  const m = truckMass(0) + 2500;
  const v = (v0 + sim.speed) / 2;
  const predicted = G * SURFACES[0].rr + 0.5 * 1.2 * TRUCK.dragArea * v * v / m;
  assert.ok(Math.abs(measured / predicted - 1) <= LIMITS.coast_down.rel_max, `measured ${measured.toFixed(4)} m/s2, predicted ${predicted.toFixed(4)}`);
});

test('wrong twin: open diffs spin out on split asphalt|mud where lockers climb', () => {
  // one side on the road, one in a mud ditch, at the grade where open diffs are 15 % short and lockers have 33 %
  // to spare (changed after the first run; see docs/PHYSICS.md, 'Changed after the first run').
  const split = [SURF.asphalt, SURF.mud];
  const grade = steepest(split, 0.6, { drive: '6x6', lockers: false, pressure: 7.5 }, null, -0.15);
  assert.ok(margin(grade, split, 0.6, { drive: '6x6', lockers: true, pressure: 7.5 }, null) > 0.2);
  const go = (lockers) => {
    const sim = createSim(Ammo, uniform({ grade, surface: split, wetness: 0.6, runup: 0, startOnSlope: true }), { drive: '6x6', lockers, low: true });
    run(sim, 1.5, { brake: 1 });
    const x0 = sim.out.pos.x;
    run(sim, 20, (s) => ({ throttle: botInput(s).throttle }));     // a feathering driver, as on the levels
    return sim.out.pos.x - x0;
  };
  const locked = go(true), open = go(false);
  assert.ok(locked > 8, `lockers gained ${locked.toFixed(1)} m (open ${open.toFixed(1)} m)`);
  assert.ok(open <= 0, `open diffs gained ${open.toFixed(1)} m (lockers ${locked.toFixed(1)} m)`);
  console.log(`split mu ${(grade * 100).toFixed(1)} %: lockers ${locked.toFixed(1)} m, open ${open.toFixed(1)} m`);
});

test('levels ramp: steeper each level; naive fails 3-5, the best setups clear all', () => {
  let last = 0;
  const naive = [], diesel = [], ev = [];
  for (let k = 1; k <= 5; k++) {
    const L = generate(k);
    const top = Math.max(...L.pitches.map((p) => p.g));
    assert.ok(top > last, `level ${k} steepest ${top}`); last = top;
    naive.push(runBot(createSim(Ammo, L, {})).status);
    diesel.push(runBot(createSim(Ammo, L, { drive: '6x6', lockers: true, pressure: 2, fuelMap: 1 })).status);
    ev.push(runBot(createSim(Ammo, L, { power: 'ev', drive: '6x6', lockers: true, pressure: 2 })).status);
  }
  assert.equal(naive[0], 'summit');
  for (const k of [2, 3, 4]) assert.notEqual(naive[k], 'summit', `naive cleared level ${k + 1}`);
  assert.deepEqual(diesel, Array(5).fill('summit'), 'best diesel: ' + diesel);
  assert.deepEqual(ev, Array(5).fill('summit'), 'best EV: ' + ev);
});

test('determinism: same inputs, same state', () => {
  const go = () => run(createSim(Ammo, generate(3), { drive: '6x6' }), 20, (s) => ({ throttle: 1, steer: Math.sin(s.time) * 0.3 }));
  assert.equal(digest(go()), digest(go()));
});
