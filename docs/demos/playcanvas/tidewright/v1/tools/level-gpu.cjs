// The level gate on the GPU: runs tools/level-gpu.html in headless Chromium (the bot, naive and do-nothing plans
// through the whole storm), runs the same plans on the CPU in Node, and writes docs/receipts/level-gpu.json.
//   NODE_PATH=$(npm root -g) node tools/level-gpu.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.x3d': 'model/x3d+xml' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
(async () => {
  const t0 = Date.now();
  const { fromX3D } = await import(path.join(root, 'src/sim/level.js'));
  const { applyPlan } = await import(path.join(root, 'src/sim/earth.js'));
  const { runStormCPU } = await import(path.join(root, 'src/sim/game.js'));
  const { PLANS } = await import(path.join(root, 'tools/bot.mjs'));
  const L = fromX3D(fs.readFileSync(path.join(root, 'levels/spring-melt.x3d'), 'utf8'));
  const cpu = {};
  for (const name of ['bot', 'naive', 'nothing']) { const r = runStormCPU(L, applyPlan(L, PLANS[name](L))); cpu[name] = { flooded: r.flooded.map((f) => (f ? 'X' : '.')).join(''), nFlooded: r.nFlooded, peakStage: r.peakStage, minFreeboard: r.minFreeboard, ledger: r.ledger }; console.log('cpu', name, cpu[name].flooded); }
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', String(e)));
  await page.goto(`http://localhost:${srv.address().port}/tools/level-gpu.html`);
  await page.waitForFunction(() => window.__level && window.__level.done, null, { timeout: 40 * 60 * 1000, polling: 2000 });
  const g = await page.evaluate(() => window.__level);
  const lim = JSON.parse(fs.readFileSync(path.join(root, 'tests/limits.json'), 'utf8')).gates.level;
  const checks = [];
  for (const r of g.results) {
    checks.push({ case: r.plan, metric: 'gpu_same_houses', observed: r.flooded, rule: 'equal', limit: cpu[r.plan].flooded, pass: r.flooded === cpu[r.plan].flooded });
    const v = r.ledger.rel;
    checks.push({ case: r.plan, metric: 'ledger_rel_gpu', observed: v, rule: lim.ledger_rel_gpu.rule, limit: lim.ledger_rel_gpu.limit, pass: Number.isFinite(v) && v <= lim.ledger_rel_gpu.limit });
  }
  const receipt = {
    schema: 'tidewright.level-gpu/1', date: new Date().toISOString(), seconds: (Date.now() - t0) / 1000,
    host: { browser: `chromium ${browser.version()} (playwright, headless)`, launch_args: args, user_agent: g.ua, renderer: g.renderer || null, node: process.version },
    limits: { path: 'tests/limits.json', sha256: sha('tests/limits.json') },
    sources: Object.fromEntries(['src/sim/swe.js', 'src/gpu/swe-gl.js', 'src/sim/game.js', 'src/sim/level.js', 'src/sim/earth.js', 'src/game/storm.js', 'tools/bot.mjs', 'levels/spring-melt.x3d', 'tools/level-gpu.html'].map((p) => [p, sha(p)])),
    pass: !g.error && checks.length === 6 && checks.every((c) => c.pass), checks, twins: [], cpu, gpu: g.results, error: g.error || null,
  };
  fs.writeFileSync(path.join(root, 'docs/receipts/level-gpu.json'), JSON.stringify(receipt, null, 1) + '\n');
  for (const c of checks) console.log(c.pass ? 'PASS' : 'FAIL', c.case, c.metric, c.observed, c.rule, c.limit);
  for (const r of g.results) console.log(r.plan, 'gpu ms', r.ms, 'steps', r.steps, 'peak', r.peakStage.toFixed(3), 'cpu peak', cpu[r.plan].peakStage.toFixed(3), 'integrity', JSON.stringify(r.integrity));
  if (g.error) console.log('ERROR', g.error);
  await browser.close(); srv.close();
})();
