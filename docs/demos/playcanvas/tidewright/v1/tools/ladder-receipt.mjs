// Run the analytic ladder in Node and write docs/receipts/ladder-node.json: every gate's numbers, its limit from
// tests/limits.json (with that file's sha256 and the commit that added it), and every wrong twin's verdict.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { runGate, LADDER } from '../src/sim/gates.js';
const root = new URL('..', import.meta.url);
const text = readFileSync(new URL('tests/limits.json', root), 'utf8');
const limits = JSON.parse(text);
let commit = null; try { commit = execSync('git log --diff-filter=A --format=%H -- tests/limits.json', { cwd: root, encoding: 'utf8' }).trim().split('\n').pop() || null; } catch { commit = null; }
const out = { schema: 'tidewright.ladder/1', host: `node ${process.version} (${process.platform} ${process.arch})`, date: new Date().toISOString(), limits: { path: 'tests/limits.json', sha256: createHash('sha256').update(text).digest('hex'), commit }, gates: [] };
for (const g of LADDER) { const r = runGate(g, limits); out.gates.push(r); console.log(g, r.pass ? 'PASS' : 'FAIL', JSON.stringify(Object.fromEntries(Object.entries(r.checks).map(([k, c]) => [k, c.observed]))), 'twins', r.twins.map((t) => `${t.twin}:${t.caught ? 'caught' : 'MISSED'}`).join(' '), r.seconds + 's'); }
writeFileSync(new URL('docs/receipts/ladder-node.json', root), JSON.stringify(out, null, 1) + '\n');
