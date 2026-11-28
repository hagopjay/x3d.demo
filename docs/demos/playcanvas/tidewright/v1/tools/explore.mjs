// Exploration before the limits were declared (SCIENCE-PLAYBOOK 1.2-1.3): the ladder cases on grids coarser than the
// gated ones, shorter where marked, and the candidate wrong twins. Its numbers informed the scale of the limits in
// tests/limits.json. Gated grids: ritter, stoker, thacker at scale 2; lake, conservation, manning, culvert at scale 1.
// None of the gated configurations was run before tests/limits.json was committed.
import { CASES } from '../src/sim/ladder.js';
import { runCase } from '../src/sim/ladder-run.js';
import { writeFileSync } from 'node:fs';
const out = { what: 'exploration on coarser grids, before tests/limits.json', host: `node ${process.version}`, runs: [] };
const rec = (id, scale, variant, m) => { out.runs.push({ id, scale, variant, ...m }); console.log(id, scale, variant, JSON.stringify(m, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)).slice(0, 300)); };
const strip = (m) => { const o = { ...m }; delete o.rows; return o; };
for (const s of [0.25, 0.5, 1]) {
  rec('ritter', s, 'hr', runCase(CASES.ritter(s)).metrics);
  rec('stoker', s, 'hr', runCase(CASES.stoker(s)).metrics);
  rec('thacker', s, 'hr', runCase(CASES.thacker(s)).metrics);
}
rec('ritter', 0.5, 'twin hllNoBranches', runCase(CASES.ritter(0.5), { twins: { hllNoBranches: true } }).metrics);
rec('thacker', 0.5, 'twin hllNoBranches', runCase(CASES.thacker(0.5), { twins: { hllNoBranches: true } }).metrics);
rec('thacker', 0.5, 'twin pressureTypo', runCase(CASES.thacker(0.5), { twins: { pressureTypo: true } }).metrics);
rec('thacker', 0.5, 'twin davisDry', runCase(CASES.thacker(0.5), { twins: { davisDry: true } }).metrics);
rec('ritter', 0.5, 'twin davisDry', runCase(CASES.ritter(0.5), { twins: { davisDry: true } }).metrics);
rec('stoker', 0.5, 'twin pressureTypo', runCase(CASES.stoker(0.5), { twins: { pressureTypo: true } }).metrics);
rec('thacker', 0.5, 'twin naive', runCase(CASES.thacker(0.5), { scheme: 'naive' }).metrics);
rec('lake', 0.5, 'hr', runCase(CASES.lake(0.5)).metrics);
rec('lake', 0.5, 'twin naive', runCase(CASES.lake(0.5), { scheme: 'naive' }).metrics);
rec('conservation', 0.5, 'hr 600 s', runCase(CASES.conservation(0.5, 600)).metrics);
rec('conservation', 0.5, 'twin zeroFilms 600 s', runCase(CASES.conservation(0.5, 600), { twins: { zeroFilms: true } }).metrics);
rec('manning', 0.5, 'hr', runCase(CASES.manning(0.5)).metrics);
rec('manning', 0.5, 'twin frictionH', runCase(CASES.manning(0.5), { twins: { frictionH: true } }).metrics);
{ // culvert: a variant (orifice area 0.1 m2, 500 s), not the gated configuration
  const c = CASES.culvert(1); c.culverts[0].area = 0.1; c.steps = Math.round(500 / c.dt);
  const m = runCase(c).metrics; rec('culvert', 1, 'hr variant area 0.1, 500 s (measure uses area 0.05: see note)', { note: 'measure() compares against area 0.05; rows recomputed below', rows: undefined });
  const { orificeDrain } = await import('../src/sim/analytic.js');
  const S2 = runCase(c).S; void S2;
  const rows = m.rows.map(([t, D]) => { const De = orificeDrain(1, t, { cd: 0.8, a: 0.1, A1: m.A1, A2: m.A2 }); return { t, D, De, rel: Math.abs(D - De) / De }; });
  rec('culvert', 1, 'variant area 0.1 rows', { worst_rel: Math.max(...rows.map((r) => r.rel)), rows });
  const cn = CASES.culvert(1); cn.culverts[0].area = 0.1; cn.steps = Math.round(500 / cn.dt);
  const mn = runCase(cn, { twins: { culvertNo2: true } }).metrics;
  const rn = mn.rows.map(([t, D]) => { const De = orificeDrain(1, t, { cd: 0.8, a: 0.1, A1: mn.A1, A2: mn.A2 }); return Math.abs(D - De) / De; });
  rec('culvert', 1, 'variant area 0.1, twin culvertNo2', { worst_rel: Math.max(...rn) });
}
writeFileSync(new URL('../docs/receipts/exploration.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
