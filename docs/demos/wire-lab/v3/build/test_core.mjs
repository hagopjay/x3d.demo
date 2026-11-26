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

// ---- v3: feedback cycles (components, simpleCycles) ----
{
  const { components, simpleCycles } = await import('../wirelab.js');
  const graphOf = (ids, routes) => { const g = new Graph(cat, { nodes: ids.map(id => ({ id, type: 'BooleanFilter', role: 'behaviour', fields: {} })), routes: [] }); g.routes = routes.map(([a, b]) => [a, 'inputNegate', b, 'set_boolean']); return g; };
  let g = graphOf(['A', 'B', 'C', 'D'], [['A', 'B'], ['B', 'C'], ['C', 'D']]);
  ok(components(g).cyclic.length === 0, 'v3: a pipeline has no cyclic component');
  g = graphOf(['A', 'B', 'C', 'D'], [['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D']]);
  let c = components(g); ok(c.cyclic.length === 1 && c.cyclic[0].slice().sort().join() === 'A,B,C', 'v3: one ring A B C, D is outside');
  let sc = simpleCycles(g, c.cyclic[0]); ok(sc.cycles.length === 1 && sc.cycles[0].length === 3 && !sc.capped, 'v3: exactly one simple cycle of three');
  g = graphOf(['A', 'B'], [['A', 'A']]); ok(components(g).cyclic.length === 1, 'v3: a ROUTE to itself is a cycle');
  g = graphOf(['A', 'B', 'C'], [['A', 'B'], ['B', 'A'], ['B', 'C'], ['C', 'B']]); sc = simpleCycles(g, components(g).cyclic[0]);
  ok(components(g).cyclic.length === 1 && sc.cycles.length === 2, 'v3: two rings sharing B make one component with two simple cycles');
  const ids = Array.from({ length: 8 }, (_, i) => 'N' + i), all = []; ids.forEach(a => ids.forEach(b => { if (a !== b) all.push([a, b]); }));
  g = graphOf(ids, all); sc = simpleCycles(g, components(g).cyclic[0], 60); ok(sc.capped && sc.cycles.length === 60, 'v3: the cycle list is capped');
}

// ---- v3: event accounting (Flow) : arithmetic on whatever it is fed, nothing else ----
{
  const { Flow, compact } = await import('../flow.js');
  const f = new Flow(), routes = [{ index: 0, from: 'A', ff: 'x', to: 'B', tf: 'y', type: 'SFTime' }, { index: 1, from: 'B', ff: 'z', to: 'C', tf: 'w', type: 'SFFloat' }, { index: 2, from: 'D', ff: 'p', to: 'E', tf: 'q', type: 'SFBool' }];
  f.reset(routes, 0);
  ok(f.total === 0 && f.wires.every(w => w.count === 0) && f.stream.length === 0, 'v3 flow: nothing recorded, nothing counted');
  f.record(0, 100, 10, '1'); f.record(1, 100, 11, '0.5'); f.record(2, 101, 400, 'true'); f.record(0, 102, 900, '2');
  ok(f.total === 4 && f.wires.map(w => w.count).join() === '2,1,1', 'v3 flow: counts per wire equal the records made');
  ok(f.log.length === 4 && f.log.filter(e => e.index === 0).length === 2, 'v3 flow: the log holds one entry per record');
  ok(f.sharing === 2 && f.deepest === 2, 'v3 flow: two events at one stamp on a connected path make a cascade of 2');
  f.record(2, 101, 910, 'false'); ok(f.sharing === 2, 'v3 flow: a later stamp does not enlarge it');
  const g2 = new Flow(); g2.reset(routes, 0); g2.record(0, 5, 1, 'a'); g2.record(2, 5, 2, 'b'); ok(g2.sharing === 2 && g2.deepest === 1, 'v3 flow: two unconnected events at one stamp share a stamp but are not one cascade');
  ok(f.perSecond(1000) === 5 && f.perSecond(1500) === 2 && f.perSecond(5000) === 0, 'v3 flow: events per second counts only the last second');
  const h = new Flow(); h.reset(routes, 0); for (let i = 0; i < 30; i++) h.record(0, i, i * 16, String(i));
  ok(h.stream.length === 1 && h.stream[0].continuous && h.stream[0].count >= 29 && h.wires[0].count === 30, 'v3 flow: a fast stream is one updating line and still counts every event');
  const k = new Flow({ keep: 10 }); k.reset(routes, 0); for (let i = 0; i < 50; i++) k.record(0, i, i * 1000, 'x'); ok(k.log.length === 10 && k.wires[0].count === 50 && k.total === 50, 'v3 flow: a short log never shortens a count');
  ok(h.takePending().length === 1 && h.takePending().length === 0, 'v3 flow: pending packets are handed over once');
  ok(compact('0.123456 2 3') === '0.12 2 3' && compact('hello') === 'hello' && compact('x'.repeat(50)).length === 30, 'v3 flow: compact values');
  const before = f.total; f.reset(routes, 5); ok(f.total === 0 && before === 5, 'v3 flow: reset forgets every count');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
