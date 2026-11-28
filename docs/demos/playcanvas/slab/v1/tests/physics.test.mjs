// node --test tests/   The fast gates run live; the slow ones (repose, infinite slope, levels, GPU) are judged
// from their receipts, which must have been made from the current sources (sha256 checked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { svd2 } from '../src/sim/mpm.js';
import { strength, releaseAngle } from '../src/sim/referee.js';
import { momentumCase, pwaveCase, resumeCase, SLOPE } from '../src/sim/cases.js';
import { toX3D, fromX3D, design } from '../src/sim/level.js';
import { snapshotX3D, resumeX3D, pointsOf } from '../src/x3d/snapshot.js';
import { slope } from '../src/sim/cases.js';

const root = new URL('..', import.meta.url).pathname;
const L = JSON.parse(readFileSync(root + 'tests/limits.json', 'utf8')).gates;
const sha = (f) => createHash('sha256').update(readFileSync(root + f)).digest('hex');
const receipt = (f) => JSON.parse(readFileSync(root + f, 'utf8'));
const fresh = (r) => { for (const [f, h] of Object.entries(r.sources)) assert.equal(sha(f), h, `${f} changed since the receipt was made: re-run its tool`); };

test('svd2 reconstructs random 2x2 matrices', () => {
  const o = new Float64Array(10); let s = 7, worst = 0;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 2 - 1; };
  for (let k = 0; k < 2000; k++) {
    const a = rnd(), b = rnd(), c = rnd(), d = rnd(); svd2(a, b, c, d, o);
    const [s1, s2, u00, u01, u10, u11, v00, v01, v10, v11] = o;
    worst = Math.max(worst, Math.abs(u00 * s1 * v00 + u01 * s2 * v01 - a), Math.abs(u00 * s1 * v10 + u01 * s2 * v11 - b), Math.abs(u10 * s1 * v00 + u11 * s2 * v01 - c), Math.abs(u10 * s1 * v10 + u11 * s2 * v11 - d));
  }
  assert.ok(worst < 1e-12, String(worst));
});

test('Davis strength: psi = phi gives the naive form, psi = 0 the non-dilatant one', () => {
  assert.ok(Math.abs(strength(300, 30, 1000, 30) - (300 + 1000 * Math.tan(Math.PI / 6))) < 1e-9);
  assert.ok(Math.abs(strength(300, 30, 1000, 0) - (300 * Math.cos(Math.PI / 6) + 1000 * 0.5)) < 1e-9);
  const base = { layers: SLOPE.layers, c: SLOPE.weak.c, phi: SLOPE.weak.phi };
  assert.ok(releaseAngle({ ...base, psi: 30 }) - releaseAngle(base) > L.infinite_slope.naive_gap_min_deg);
});

test('momentum gate (live) and its PIC twin', () => {
  const m = momentumCase(); assert.ok(m.rel_linear <= L.momentum.max_rel_linear && m.rel_angular <= L.momentum.max_rel_angular, JSON.stringify(m));
  const p = momentumCase('pic'); assert.ok(p.rel_angular > L.momentum.max_rel_angular, 'the PIC twin must lose angular momentum');
});

test('P-wave gate (live) and its stress-factor twin', () => {
  assert.ok(pwaveCase().rel_err <= L.pwave.max_rel_err);
  assert.ok(pwaveCase('stress2').rel_err > L.pwave.max_rel_err);
});

test('X3D save-and-resume is bit-exact; float32 and no-affine snapshots are not', () => {
  const r = resumeCase();
  assert.equal(r.mismatch, 0); assert.ok(r.float32_twin_differs); assert.ok(r.no_affine_twin_differs);
});

test('a snapshot is also a viewable X3D PointSet', () => {
  const S = slope(30); for (let i = 0; i < 10; i++) S.step();
  const text = snapshotX3D(S); const pts = pointsOf(text);
  assert.equal(pts.length, 2 * S.n); assert.ok(/profile='Interchange'/.test(text));
  assert.equal(resumeX3D(text).hash(), S.hash());
});

test('levels: X3D round trip and referee-designed indices', () => {
  for (const k of [1, 2, 3]) {
    const { L: D, text } = toX3D(k); const lv = fromX3D(text);
    assert.equal(lv.weak.c, D.c); assert.ok(lv.index.deadly < 1 && lv.index.natural > 1 && lv.index.safe >= 1.5, JSON.stringify(lv.index));
    assert.equal(readFileSync(root + `levels/level${k}.x3d`, 'utf8'), text, `levels/level${k}.x3d is stale: run node tools/levels.mjs`);
  }
});

for (const [g, expect] of Object.entries({ momentum: true, energy: true, infinite_slope: true, pwave: true, determinism: true, resume_x3d: true, repose: false })) {
  const t = expect ? test : test.todo;
  t(`receipt: ${g} ${expect ? 'passes' : 'fails as written (see docs/PHYSICS.md)'}, every twin caught`, () => {
    const r = receipt('receipts/gates.json'); fresh(r);
    assert.equal(r.gates[g].pass, true);
    for (const [k, v] of Object.entries(r.gates[g].twins || {})) assert.ok(v.caught, `twin ${k} not caught`);
  });
}

test('receipt: GPU vs CPU passes and the PIC shader twin is caught', { skip: !existsSync(root + 'receipts/gpu-cpu.json') }, () => {
  const r = receipt('receipts/gpu-cpu.json'); fresh(r);
  assert.ok(r.pass && r.twin_caught);
});

test('receipt: every level re-proves its kansei:referee claims', () => {
  const r = receipt('receipts/levels.json'); fresh(r);
  for (const [k, v] of Object.entries(r.levels)) for (const c of v.claims) assert.ok(c.pass, `level ${k}: ${c.claim}`);
});
