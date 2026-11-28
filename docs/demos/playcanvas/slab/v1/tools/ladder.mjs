// Runs every CPU gate and its wrong twins against tests/limits.json and writes receipts/gates.json.
//   node tools/ladder.mjs [gate ...]     (no names: all gates)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as C from '../src/sim/cases.js';

const root = new URL('..', import.meta.url).pathname;
const L = JSON.parse(readFileSync(root + 'tests/limits.json', 'utf8')).gates;
const only = process.argv.slice(2);
const out = existsSync(root + 'receipts/gates.json') ? JSON.parse(readFileSync(root + 'receipts/gates.json', 'utf8')) : { gates: {} };
const timed = (f) => { const t0 = performance.now(); const r = f(); return { ...r, seconds: +((performance.now() - t0) / 1000).toFixed(2) }; };

const GATES = {
  momentum: () => {
    const m = timed(() => C.momentumCase()), pic = timed(() => C.momentumCase('pic')), flip = timed(() => C.momentumCase('flip'));
    const ok = (r) => r.rel_linear <= L.momentum.max_rel_linear && r.rel_angular <= L.momentum.max_rel_angular;
    return { pass: ok(m), measured: m, twins: { pic: { ...pic, caught: !ok(pic) }, flip: { ...flip, caught: !ok(flip) } } };
  },
  energy: () => {
    const e = timed(() => C.energyCase()), flip = timed(() => C.energyCase('flip'));
    const ok = (r) => r.max_rise_rel <= L.energy.max_rise_rel;
    return { pass: ok(e), measured: e, twins: { flip: { ...flip, caught: !ok(flip) } } };
  },
  repose: () => {
    const r = timed(() => C.reposeCase()), nr = timed(() => C.reposeCase('no_return'));
    const ok = (x) => x.mean_deg != null && Math.abs(x.mean_deg - L.repose.phi_deg) <= L.repose.tolerance_deg;
    const strip = ({ profile, ...rest }) => rest;
    return { pass: ok(r), measured: strip(r), profile: r.profile, twins: { no_return: { ...strip(nr), caught: !ok(nr) } } };
  },
  infinite_slope: () => {
    const ref = C.slopeReferees();
    const s = timed(() => C.infiniteSlopeCase({ res: L.infinite_slope.bisection_resolution_deg }));
    const strong = timed(() => C.infiniteSlopeCase({ strongWeak: true }));
    const d = s.release_deg;
    const pass = d != null && Math.abs(d - ref.davis_deg) <= L.infinite_slope.tolerance_deg && Math.abs(ref.naive_deg - ref.davis_deg) >= L.infinite_slope.naive_gap_min_deg;
    return { pass, referees: ref, measured: s, off_davis_deg: d == null ? null : d - ref.davis_deg, off_naive_deg: d == null ? null : d - ref.naive_deg,
      twins: { strong_weak_layer: { ...strong, caught: strong.release_deg == null } } };
  },
  pwave: () => {
    const p = timed(() => C.pwaveCase()), t = timed(() => C.pwaveCase('stress2'));
    const ok = (r) => r.rel_err != null && r.rel_err <= L.pwave.max_rel_err;
    return { pass: ok(p), measured: p, twins: { stress2: { ...t, caught: !ok(t) } } };
  },
  determinism: () => { const d = timed(() => C.determinismCase()); return { pass: d.mismatch === 0, measured: d, twins: { nudge: { caught: d.twin_differs } } }; },
  resume_x3d: () => {
    const r = timed(() => C.resumeCase());
    return { pass: r.mismatch === 0, measured: r, twins: { float32: { caught: r.float32_twin_differs }, no_affine: { caught: r.no_affine_twin_differs } } };
  },
};

const sha = (f) => createHash('sha256').update(readFileSync(root + f)).digest('hex');
for (const [name, run] of Object.entries(GATES)) {
  if (only.length && !only.includes(name)) continue;
  const r = run();
  out.gates[name] = { ...r, when: new Date().toISOString() };
  const tw = Object.entries(r.twins || {}).map(([k, v]) => `${k}:${v.caught ? 'caught' : 'MISSED'}`).join(' ');
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${name}  ${tw}`);
}
out.host = { node: process.version, platform: process.platform + ' ' + process.arch };
out.sources = Object.fromEntries(['src/sim/mpm.js', 'src/sim/cases.js', 'src/sim/referee.js', 'src/x3d/snapshot.js', 'src/x3d/x3dxml.js', 'tests/limits.json'].map((f) => [f, sha(f)]));
mkdirSync(root + 'receipts', { recursive: true });
writeFileSync(root + 'receipts/gates.json', JSON.stringify(out, null, 1) + '\n');
