// Offline contracts for Giza VI. Run from v6/: node --test tests/v6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as W from '../world.mjs';
import { ACTS, LEDGER, GRADES, TOTAL, flatShots } from '../story.mjs';
import { TESLA_DEFAULTS, createReservoir, stepReservoir, teslaResponse } from '../../v5/tesla.mjs';

const here = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);

test('world is deterministic and finite', () => {
  const a = W.world(), b = W.world();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  for (const m of a) {
    if (m.lines) { for (const l of m.lines) for (const p of l) assert.ok(p.every(Number.isFinite), m.id); continue; }
    assert.ok(m.positions.every(Number.isFinite), m.id);
    const n = m.positions.length / 3; assert.ok(m.indices.every(i => Number.isInteger(i) && i >= 0 && i < n), m.id);
    assert.equal(m.indices.length % 3, 0, m.id); assert.equal(m.uvs.length / 2, n, m.id);
  }
});
test('census matches the receipt in VALIDATION.md', () => {
  const c = W.census();
  assert.deepEqual([c.meshes, c.vertices, c.triangles, c.linePoints], [40, 67726, 111850, 2354]);
  assert.deepEqual(c.byGrade, { L: 12, C: 14, A: 10, S: 4 });
});
test('every mesh carries a known grade, every authored mesh says so', () => {
  for (const m of W.world()) { assert.ok(GRADES[m.grade], m.id); if (['horizon', 'coil'].includes(m.layer)) assert.equal(m.grade, 'A', m.id + ' is invention'); }
});
test('winding contract: world arrays clockwise-front (Babylon RH), X3D twin counter-clockwise', () => {
  const g = W.terrain(); const P = g.positions, I = g.indices.slice(); for (let k = 0; k < I.length; k += 3) [I[k + 1], I[k + 2]] = [I[k + 2], I[k + 1]]; let up = 0;
  for (let k = 0; k < I.length; k += 3) { const [a, b, c] = [I[k], I[k + 1], I[k + 2]].map(i => P.slice(i * 3, i * 3 + 3));
    const u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - a[i]); up += u[2] * v[0] - u[0] * v[2]; }
  assert.ok(up > 0, 'after the exporter swap the ground is counter-clockwise seen from above (+y), the X3D ccw=TRUE front');
});
test('pyramid summits match the published heights', () => {
  for (const [id, P] of Object.entries(W.PYRAMIDS)) { const m = W.pyramid(id, P)[P.casing ? 1 : 0]; let top = -1e9; for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]); assert.ok(Math.abs(top - P.today) < 1e-3, id); }
});
test('story: unique shots, graded captions, durations add up', () => {
  const s = flatShots(); assert.equal(new Set(s.map(x => x.id)).size, s.length); assert.equal(s.length, 16);
  for (const x of s) { assert.ok(x.cap.length >= 2, x.id); for (const [g, t] of x.cap) { assert.ok(GRADES[g], x.id); assert.ok(t.length > 20, x.id); } }
  assert.equal(TOTAL, s.reduce((a, x) => a + x.dur, 0)); assert.equal(TOTAL, 216);
  for (const a of ACTS) assert.ok(GRADES[a.grade]);
});
test('ledger: unique ids, known grades, every grade used', () => {
  assert.equal(new Set(LEDGER.map(r => r.id)).size, LEDGER.length);
  for (const g of Object.keys(GRADES)) assert.ok(LEDGER.some(r => r.g === g), g);
  for (const r of LEDGER) if (r.url) assert.match(r.url, /^https:\/\//);
});
test('Tesla ledger: 12.5 GJ, supply-off drain 20.66 s, books balance', () => {
  const s = { ...TESLA_DEFAULTS }; assert.ok(Math.abs(teslaResponse(s).capacityJ - 12.5e9) < 1);
  assert.ok(Math.abs(12.5e9 / 605e6 - 20.661) < 1e-3);
  let st = createReservoir(s, 1); st = stepReservoir(st, { ...s, supplyMW: 0 }, 20.6); assert.ok(st.energyJ > 0);
  st = stepReservoir(st, { ...s, supplyMW: 0 }, 0.1); assert.equal(st.energyJ, 0);
  const res = st.initialEnergyJ + st.suppliedJ - (st.energyJ + st.dissipatedJ + st.arcJ + st.spilledJ); assert.ok(Math.abs(res) < 1e-3 * 12.5e9 / 1e6);
  assert.ok(Math.abs(teslaResponse(s).displayHeight - 571.2) < 0.1);
});
test('sky numbers quoted in captions come from GizaSky', () => {
  const Sky = require('../../v3/sky-math.js'), data = JSON.parse(readFileSync(here + '../v3/stars_v2.json', 'utf8')), m = Sky.createModel(data);
  const alt = ep => { const M = m.matrixAt(ep).matrix, v = data.named.find(x => x.n === 'Alnilam').v, d = Sky.dated(v, M), lst = Sky.equatorial(d).ra * 12 / Math.PI; return Sky.horizontal(d, lst).alt * Sky.RAD; };
  assert.ok(Math.abs(alt(-10499) - 10.0) < 0.2); assert.ok(Math.abs(alt(-2559) - 45.0) < 0.3); assert.ok(Math.abs(alt(2000) - 58.8) < 0.2);
});
test('Giza to Hawara great-circle distance is 81.6 km', () => {
  const R = 6371.0088, r = x => x * Math.PI / 180, [a, b, c, d] = [29.97917, 31.13417, 29.27417, 30.89889];
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; assert.ok(Math.abs(2 * R * Math.asin(Math.sqrt(h)) - 81.6) < 0.1);
});
test('X3D twin rebuilds byte-identical and matches its receipt', () => {
  const out = here + 'tests/.rebuild.x3d'; execFileSync(process.execPath, [here + 'build/export_x3d.mjs', out], { cwd: here });
  const a = readFileSync(out), b = readFileSync(here + 'giza-vi.x3d'); assert.ok(a.equals(b), 'rebuild differs from committed giza-vi.x3d');
  const rec = JSON.parse(readFileSync(here + 'validation-vi.json', 'utf8')); assert.equal(rec.sha256, createHash('sha256').update(b).digest('hex'), 'receipt is for other bytes');
  assert.equal(rec.xsd, true); assert.equal(rec.sem_e, 0);
});
