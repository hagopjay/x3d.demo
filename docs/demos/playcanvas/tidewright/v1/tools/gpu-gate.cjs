// The GPU-vs-CPU gate: serves the repo, opens tools/gpu-gate.html in headless Chromium (playwright), and writes
// docs/receipts/gpu-gate.json with the measured numbers, their limits from tests/limits.json, the browser and the
// renderer it reported, and sha256s of the solver sources (tests/receipts.test.mjs refuses a stale receipt).
//   NODE_PATH=$(npm root -g) node tools/gpu-gate.cjs [--only=lake] [--headed]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.x3d': 'model/x3d+xml' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
(async () => {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args, headless: !flags.headed });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  page.on('pageerror', (e) => console.log('page error:', String(e)));
  const t0 = Date.now();
  await page.goto(`http://localhost:${srv.address().port}/tools/gpu-gate.html${flags.only ? '?only=' + flags.only : ''}`);
  await page.waitForFunction(() => window.__gate && window.__gate.done, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const g = await page.evaluate(() => window.__gate);
  const limits = JSON.parse(fs.readFileSync(path.join(root, 'tests/limits.json'), 'utf8')).gates.gpu_agreement;
  const judge = (rule, limit, v) => typeof v === 'number' && Number.isFinite(v) && (rule === 'at most' ? v <= limit : v >= limit);
  const checks = [];
  for (const r of g.results) {
    if (r.extra) continue;
    if (!r.twin) {
      checks.push({ case: r.id, metric: 'l1_rel_diff', observed: r.l1_rel_diff, ...limits.l1_rel_diff, pass: judge(limits.l1_rel_diff.rule, limits.l1_rel_diff.limit, r.l1_rel_diff) });
      if (r.id === 'lake') checks.push({ case: r.id, metric: 'lake_umax_gpu', observed: r.gpu_umax, rule: limits.lake_umax_gpu.rule, limit: limits.lake_umax_gpu.limit, pass: judge(limits.lake_umax_gpu.rule, limits.lake_umax_gpu.limit, r.gpu_umax) });
      if (r.id === 'conservation') checks.push({ case: r.id, metric: 'volume_rel_gpu', observed: r.gpu_volume_rel, rule: limits.volume_rel_gpu.rule, limit: limits.volume_rel_gpu.limit, pass: judge(limits.volume_rel_gpu.rule, limits.volume_rel_gpu.limit, r.gpu_volume_rel) });
    }
  }
  const twin = g.results.find((r) => r.twin === 'naive');
  const twins = twin ? [{ twin: 'GPU bad maths (naive) on the lake', lake_umax_gpu: twin.gpu_umax, l1_rel_diff: twin.l1_rel_diff,
    caught: !judge(limits.lake_umax_gpu.rule, limits.lake_umax_gpu.limit, twin.gpu_umax) && !judge(limits.l1_rel_diff.rule, limits.l1_rel_diff.limit, twin.l1_rel_diff) }] : [];
  const lt = fs.readFileSync(path.join(root, 'tests/limits.json'));
  const receipt = {
    schema: 'tidewright.gpu-gate/1', date: new Date().toISOString(), seconds: (Date.now() - t0) / 1000,
    host: { browser: `chromium ${browser.version()} (playwright, headless)`, launch_args: args, user_agent: g.ua, renderer: g.renderer || null, node: process.version },
    limits: { path: 'tests/limits.json', sha256: crypto.createHash('sha256').update(lt).digest('hex') },
    sources: Object.fromEntries(['src/sim/swe.js', 'src/gpu/swe-gl.js', 'src/sim/ladder.js', 'tools/gpu-gate.html'].map((p) => [p, sha(p)])),
    pass: checks.length > 0 && checks.every((c) => c.pass) && twins.every((t) => t.caught) && !g.error,
    checks, twins, results: g.results, error: g.error || null,
  };
  if (!flags.only) fs.writeFileSync(path.join(root, 'docs/receipts/gpu-gate.json'), JSON.stringify(receipt, null, 1) + '\n');
  for (const c of checks) console.log(c.pass ? 'PASS' : 'FAIL', c.case, c.metric, c.observed);
  for (const t of twins) console.log(t.caught ? 'caught' : 'MISSED', t.twin, t.lake_umax_gpu, t.l1_rel_diff);
  for (const r of g.results) console.log(r.id, r.twin || '', 'ms', JSON.stringify(r.ms), 'reduction rel', r.reduction.rel, 'gpu own', JSON.stringify(r.gpu_own).slice(0, 200));
  if (g.error) console.log('ERROR', g.error);
  console.log('renderer', g.renderer, 'pass', receipt.pass);
  await browser.close(); srv.close();
})();
