// Writes levels/level1..3.x3d, then re-proves every level's kansei:referee claims on the CPU solver (one child
// process per run, in parallel) and writes receipts/levels.json.   node tools/levels.mjs [--only=1]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { toX3D, fromX3D, DESIGNS } from '../src/sim/level.js';
import { Run } from '../src/sim/run.js';

const root = new URL('..', import.meta.url).pathname;
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
if (arg.child) {
  const [k, line, mode, T] = arg.child.split(',');
  const lv = fromX3D(readFileSync(`${root}levels/level${k}.x3d`, 'utf8'));
  const r = new Run(lv, { line: +line, mode }); r.runTo(+T);
  process.stdout.write(JSON.stringify({ particles: r.sim.n, ...r.summary() }));
  process.exit(0);
}
mkdirSync(root + 'levels', { recursive: true });
const ks = arg.only ? [+arg.only] : DESIGNS.map((_, i) => i + 1);
const manifest = [];
for (const k of ks) { const { L, text } = toX3D(k); writeFileSync(`${root}levels/level${k}.x3d`, text); manifest.push({ k, file: `level${k}.x3d`, name: L.name, c: L.c, deadly: L.deadly, safe: L.safe, index: { safe: L.safeIndex.index, natural: L.deadlyIndex.natural, skier: L.deadlyIndex.index } }); }
if (!arg.only) writeFileSync(root + 'levels/MANIFEST.json', JSON.stringify(manifest, null, 1) + '\n');
const jobs = [];
for (const k of ks) jobs.push([k, 0, 'ski', 9], [k, 1, 'idle', 9], [k, 1, 'ski', 10], [k, 1, 'patrol', 30]);
const run = (j) => new Promise((res) => execFile(process.execPath, [new URL(import.meta.url).pathname, `--child=${j.join(',')}`], { maxBuffer: 1 << 24 }, (e, out) => res(e ? { error: String(e) } : JSON.parse(out))));
const results = {}; let next = 0;
const par = Number(arg.par || 4), t0 = Date.now();
await Promise.all(Array.from({ length: par }, async () => { while (next < jobs.length) { const j = jobs[next++]; results[j.join(',')] = await run(j); console.log('done', j.join(','), ((Date.now() - t0) / 1000).toFixed(0) + 's'); } }));
const out = { when: new Date().toISOString(), host: { node: process.version }, levels: {} };
for (const k of ks) {
  const m = manifest.find((x) => x.k === k), R = (l, mode) => results[[k, l, mode, { ski: l ? 10 : 9, idle: 9, patrol: 30 }[mode]].join(',')];
  const safe = R(0, 'ski'), idle = R(1, 'idle'), ski = R(1, 'ski'), pat = R(1, 'patrol');
  const claims = [
    { claim: 'safe line index >= 1.5 and a skier crossing it does not release the slab', pass: m.index.safe >= 1.5 && !safe.released && safe.skier === 'out', index: m.index.safe, run: safe },
    { claim: 'deadly line: natural index > 1 and it holds with no skier; skier index < 1 and a skier crossing it releases the slab', pass: m.index.natural > 1 && m.index.skier < 1 && !idle.released && !!ski.released, index: m.index, idle, ski },
    { claim: 'after the patrol bot charges the deadly line it has released, and a skier then crosses without being caught', pass: !!pat.released && pat.skier === 'out', run: pat },
  ];
  out.levels[k] = { name: m.name, c: m.c, claims, pass: claims.every((c) => c.pass) };
  console.log(`level ${k} ${m.name}: ${claims.map((c) => (c.pass ? 'PASS' : 'FAIL')).join(' ')}`);
}
out.sources = Object.fromEntries(['src/sim/mpm.js', 'src/sim/level.js', 'src/sim/run.js', 'src/sim/referee.js', ...ks.map((k) => `levels/level${k}.x3d`)].map((f) => [f, createHash('sha256').update(readFileSync(root + f)).digest('hex')]));
writeFileSync(root + `receipts/levels${arg.only ? '-' + arg.only : ''}.json`, JSON.stringify(out, null, 1) + '\n');
