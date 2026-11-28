// The X3D tether: the level files in levels/ are what src/sim/level.js generates, and the simulation reads them back
// to the same ground (heights, surfaces, puddles, pitches). The truck and trailer files carry their metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, fromX3D, toX3D } from '../src/sim/level.js';
import { parseXML, metaSet } from '../src/sim/x3dxml.js';
import { TRUCK } from '../src/sim/spec.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

for (let k = 1; k <= 5; k++) {
  test(`level ${k}: the shipped X3D file is the generator's, and reads back to the same ground`, () => {
    const text = read(`levels/level${k}.x3d`);
    assert.equal(text, toX3D(generate(k)), 'levels/ is stale: run node tools/build.mjs');
    const a = generate(k), b = fromX3D(text);
    assert.deepEqual(Array.from(b.heights, (v) => v + 0), Array.from(a.heights, (v) => v + 0));   // -0 and 0 are one height
    assert.deepEqual(Array.from(b.surface), Array.from(a.surface));
    assert.equal(b.pitches.length, a.pitches.length);
    assert.equal(b.summit, Math.round(a.summit * 1000) / 1000);
  });
}

test('truck X3D: hubs, exhaust and hitch match the simulation', () => {
  const meta = metaSet(parseXML(read('assets/truck.x3d')), 'kansei:haul-truck');
  assert.equal(meta.hubs.length, 18);
  assert.deepEqual(meta.exhaust, TRUCK.exhaust.flat());
  assert.deepEqual(meta.hitch, TRUCK.hitch);
  assert.equal(meta.wheelRadius[0], TRUCK.wheelRadius);
});
