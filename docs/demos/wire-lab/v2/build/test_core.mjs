// SPDX-License-Identifier: GPL-3.0-or-later
// node build/test_core.mjs : the browser core against the cases it shares with the Python core, and against the worlds.
import fs from 'node:fs';
import { Catalogue, Graph, weave, toPython, WireError } from '../wirelab.js';
const here = new URL('..', import.meta.url).pathname;
const read = f => JSON.parse(fs.readFileSync(here + f, 'utf8'));
const cat = new Catalogue(read('catalogue.json'));
let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('FAIL', label)); };

for (const [a, af, b, bf, expect] of read('build/route-cases.json').cases) ok(cat.verdict(a, af, b, bf) === expect, `${a}.${af} -> ${b}.${bf} expected ${expect}, got ${cat.verdict(a, af, b, bf)}`);

for (const id of ['door', 'counter', 'snake']) {
  const world = read(`worlds/${id}.json`);
  const g = new Graph(cat, world.graph);
  ok(g.routes.every(r => g.problem(...r) === null), `${id}: every starter route is legal`);
  ok(g.explain() === world.sentences, `${id}: explain() matches Python's`);
  const routeLines = s => (s.match(/<ROUTE[^>]*>/g) || []).map(l => l.replace(/\s*\/>/, '/>').replace(/ +/g, ' ')).sort().join('\n');
  ok(routeLines(weave(world.scene, g)) === routeLines(fs.readFileSync(`${here}worlds/${id}.x3d`, 'utf8')), `${id}: weave() writes the ROUTEs Python wrote`);
  ok(world.challenges.every(c => !g.solved(c)), `${id}: no challenge is solved at the start`);
  ok(toPython(g).split('\n').filter(l => l.includes('>>')).length === g.routes.length, `${id}: script has one line per ROUTE`);
}
{ // solve a challenge the way the hint says
  const g = new Graph(cat, read('worlds/door.json').graph), c = read('worlds/door.json').challenges[0];
  let code = null; try { g.route('Click', 'isOver', 'Timer', 'startTime'); } catch (e) { code = e instanceof WireError && e.code; }
  ok(code === 'type-mismatch', 'door: isOver -> startTime is refused');
  const t = g.add('TimeTrigger'); g.route('Click', 'isOver', t.id, 'set_boolean'); g.route(t.id, 'triggerTime', 'Timer', 'startTime');
  ok(g.solved(c), 'door: challenge 1 solved by the hinted wiring');
  g.remove(t.id); ok(!g.solved(c) && g.routes.length === 3, 'door: removing the node removes its routes');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
