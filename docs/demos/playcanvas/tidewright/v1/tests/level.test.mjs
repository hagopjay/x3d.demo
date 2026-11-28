// Spring Melt (tests/limits.json gates.level and gates.determinism): the X3D tether, the earth budget, the water
// ledger, the bot's plan holding, the naive plan and doing nothing failing, and same-tape-same-hash determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, toX3D, fromX3D, MATERIALS } from '../src/sim/level.js';
import { applyPlan, createEarthworks } from '../src/sim/earth.js';
import { runStormCPU } from '../src/sim/game.js';
import { judge } from '../src/sim/gates.js';
import { botPlan, naivePlan } from '../tools/bot.mjs';

const limits = JSON.parse(readFileSync(new URL('./limits.json', import.meta.url), 'utf8')).gates;
const LL = limits.level;
const text = readFileSync(new URL('../levels/spring-melt.x3d', import.meta.url), 'utf8');
const L = fromX3D(text);
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };

test('tether: levels/spring-melt.x3d is the generator output, and reads back to the same level', () => {
  const G = generate();
  assert.equal(text, toX3D(G), 'levels/ is stale: run node tools/build.mjs');
  assert.deepEqual(Array.from(L.bed), Array.from(G.bed, r3));
  assert.deepEqual(Array.from(L.mat), Array.from(G.mat));
  assert.deepEqual(L.houses.map((h) => [h.i, h.j]), G.houses.map((h) => [h.i, h.j]));
  assert.deepEqual(L.levee, G.levee);
  assert.deepEqual(L.hydrograph, G.hydrograph);
  assert.deepEqual(L.tarn, G.tarn);
  assert.deepEqual(L.materialManning, MATERIALS.map((m) => m.manning));
  assert.equal(L.nx * L.nz, L.bed.length);
});

test('earth is moved, never created: any plan conserves it, and both plans balance cut and fill', () => {
  for (const plan of [botPlan(L), naivePlan(L)]) {
    const E = applyPlan(L, plan);
    assert.ok(judge(LL.earth_conserved_m3.rule, LL.earth_conserved_m3.limit, Math.abs(E.imbalance())), `imbalance ${E.imbalance()}`);
    assert.ok(judge(LL.barrow_at_run_m3.rule, LL.barrow_at_run_m3.limit, E.barrow), `barrow ${E.barrow}`);
  }
  // a raise with an empty barrow moves nothing; rock cannot be dug; the town cannot be touched
  const E = createEarthworks(L);
  assert.equal(E.stroke({ tool: 'raise', x: 500, z: 400, radius: 20, amount: 1 }), 0);
  const rock = L.mat.indexOf(3), town = L.mat.indexOf(5);
  const at = (k) => ({ x: (k % L.nx) * L.dx, z: Math.floor(k / L.nx) * L.dx });
  E.stroke({ tool: 'dig', ...at(rock), radius: 1, amount: 1 }); assert.equal(E.bed[rock], L.bed[rock]);
  E.stroke({ tool: 'dig', ...at(town), radius: 1, amount: 1 }); assert.equal(E.bed[town], L.bed[town]);
});

const outcome = {};
for (const [name, plan] of [['bot', botPlan], ['naive', naivePlan], ['nothing', () => []]]) {
  test(`storm, ${name} plan: houses and the water ledger`, () => {
    const E = applyPlan(L, plan(L));
    const r = runStormCPU(L, E);
    outcome[name] = r;
    assert.ok(judge(LL.ledger_rel_cpu.rule, LL.ledger_rel_cpu.limit, r.ledger.rel), `ledger ${JSON.stringify(r.ledger)}`);
    const lim = LL[`${name}_houses_flooded`];
    assert.ok(judge(lim.rule, lim.limit, r.nFlooded), `${name}: ${r.nFlooded} houses flooded, needs ${lim.rule} ${lim.limit}`);
    if (name === 'bot') assert.ok(E.money <= L.budget, `bot spent $${E.money} of $${L.budget}`);
  });
}

test('determinism: the same tape gives the same hash after every step; one moved stroke changes them', () => {
  const tape = botPlan(L), seconds = 1200;
  const a = runStormCPU(L, applyPlan(L, tape), { seconds, hash: true });
  const b = runStormCPU(L, applyPlan(L, tape), { seconds, hash: true });
  assert.equal(a.hashes.length, Math.round(seconds / a.dt));
  let mismatches = 0; for (let k = 0; k < a.hashes.length; k++) if (a.hashes[k] !== b.hashes[k]) mismatches++;
  assert.ok(judge(limits.determinism.mismatches.rule, limits.determinism.mismatches.limit, mismatches), `${mismatches} differing steps`);
  const moved = tape.map((s, k) => (k === 7 ? { ...s, x: s.x + L.dx } : s));
  const c = runStormCPU(L, applyPlan(L, moved), { seconds, hash: true });
  const first = c.hashes.findIndex((h, k) => h !== a.hashes[k]);
  assert.ok(first >= 0, 'the twin tape gave the same hashes: the hash cannot see the change');
  console.log(`# determinism twin: first differing step ${first + 1} of ${c.hashes.length}`);
});
