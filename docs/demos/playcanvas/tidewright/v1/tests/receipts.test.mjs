// The GPU receipt (docs/receipts/gpu-gate.json, written by tools/gpu-gate.cjs in headless Chromium) is judged again
// here: it must be made against today's limits and today's solver sources, and every number is re-judged against
// tests/limits.json instead of trusting its own pass flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const sha = (p) => createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex');
const limits = JSON.parse(readFileSync(new URL('tests/limits.json', root), 'utf8')).gates;
const judge = (rule, limit, v) => typeof v === 'number' && Number.isFinite(v) && (rule === 'at most' ? v <= limit : v >= limit);

for (const [file, kind] of [['docs/receipts/gpu-gate.json', 'gpu_agreement'], ['docs/receipts/level-gpu.json', 'level']]) {
  test(`${file}: current, and its numbers within ${kind}'s limits`, () => {
    assert.ok(existsSync(new URL(file, root)), `${file} is missing: run its tool`);
    const r = JSON.parse(readFileSync(new URL(file, root), 'utf8'));
    assert.equal(r.limits.sha256, sha('tests/limits.json'), 'receipt made against other limits');
    for (const [p, h] of Object.entries(r.sources)) assert.equal(h, sha(p), `${file} is stale: ${p} changed since it was made`);
    assert.ok(r.host && r.host.renderer, 'the receipt must name its renderer');
    assert.ok(r.checks.length > 0);
    for (const c of r.checks) {
      const L = kind === 'gpu_agreement' ? limits.gpu_agreement[c.metric] : limits.level[c.metric];
      if (L && typeof L === 'object' && 'limit' in L) { assert.equal(c.limit, L.limit); assert.equal(c.rule, L.rule); }
      const ok = c.rule === 'equal' ? c.observed === c.limit : judge(c.rule, c.limit, c.observed);
      assert.equal(c.pass, ok, `${c.case} ${c.metric}: the pass flag disagrees with its number`);
      assert.ok(ok, `${c.case} ${c.metric}: ${c.observed} ${c.rule} ${c.limit}`);
    }
    for (const t of r.twins) assert.ok(t.caught, `twin not caught: ${t.twin}`);
  });
}
