// The analytic ladder (tests/limits.json): every gate passes at its declared limit and every wrong twin fails it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runGate, LADDER } from '../src/sim/gates.js';

const text = readFileSync(new URL('./limits.json', import.meta.url), 'utf8');
const limits = JSON.parse(text);

test('tests/limits.json is byte-identical to the commit that added it (limits are never edited)', (t) => {
  let first;
  try { first = execSync('git log --diff-filter=A --format=%H -- tests/limits.json', { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch { first = ''; }
  if (!first) { t.skip('no git history here'); return; }
  const then = execSync(`git show ${first}:./tests/limits.json`, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(text, then);
});

for (const g of LADDER) {
  test(`gate ${g}: within its limits, and its wrong twins are caught`, () => {
    const r = runGate(g, limits);
    for (const [k, c] of Object.entries(r.checks)) assert.ok(c.pass, `${g}.${k}: observed ${c.observed} ${c.rule} ${c.limit}`);
    assert.ok(r.twins.length > 0, `${g} has no wrong twin`);
    for (const tw of r.twins) assert.ok(tw.caught, `${g}: twin ${tw.twin} was not caught: ${JSON.stringify(tw.checks)}`);
  });
}
