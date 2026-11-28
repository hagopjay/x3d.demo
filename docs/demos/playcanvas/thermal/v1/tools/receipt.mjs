// Run every gate once and write receipts/gates.json: measurements, verdicts, host, and the limits file's commit and
// sha256 (the limits commit is the second commit of the history; this tool reads it with git if a repository is here).
//   node tools/receipt.mjs
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { GATES, KNOWN_FAILURES } from '../tests/verdicts.mjs';

const root = new URL('..', import.meta.url);
const limitsText = readFileSync(new URL('tests/limits.json', root));
let limitsCommit = null;
try { limitsCommit = execSync('git log --format=%H --diff-filter=A -- tests/limits.json', { cwd: root, encoding: 'utf8' }).trim().split('\n').pop() || null; } catch { limitsCommit = null; }
const out = {
  schema: 'thermal.receipt/1', when: new Date().toISOString(),
  host: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? null, cores: os.cpus().length },
  limits: { path: 'tests/limits.json', commit: limitsCommit, sha256: createHash('sha256').update(limitsText).digest('hex') },
  gates: {},
};
const done = {};
for (const g of GATES) {
  const t0 = Date.now();
  const m = g.run(done); done[g.id] = m;
  const v = g.judge(m);
  out.gates[g.id] = { verdict: v, known_failure: KNOWN_FAILURES[g.id] || null, seconds: (Date.now() - t0) / 1000, measured: m };
  console.log(g.id, JSON.stringify(v), ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
mkdirSync(new URL('receipts', root), { recursive: true });
writeFileSync(new URL('receipts/gates.json', root), JSON.stringify(out, null, 1) + '\n');
