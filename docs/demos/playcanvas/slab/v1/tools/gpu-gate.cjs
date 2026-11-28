// SLAB's GPU-vs-CPU gate (adapted from THERMAL's) in headless Chromium: serves the repo, opens tools/gpu-gate.html, writes receipts/gpu-cpu.json
// bound to the sha256 of the sources it ran.
//   NODE_PATH=$(npm root -g) node tools/gpu-gate.cjs [--steps=400]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
(async () => {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${srv.address().port}/tools/gpu-gate.html?steps=${flags.steps || 300}`);
  await page.waitForFunction(() => window.__gate, null, { timeout: 600000 });
  const out = await page.evaluate(() => window.__gate);
  const limits = JSON.parse(fs.readFileSync(path.join(root, 'tests/limits.json'), 'utf8')).gates.gpu_vs_cpu;
  const judge = (r) => !!r && r.finite && r.max_dx_m <= limits.max_dx_m && r.max_dv_mps <= limits.max_dv_mps;
  const receipt = {
    gate: 'gpu_vs_cpu', when: new Date().toISOString(),
    host: { browser: 'chromium ' + browser.version(), playwright: require('playwright/package.json').version, launch_args: args, userAgent: out.userAgent, node: process.version },
    limits, renderer: out.renderer, error: out.error || null,
    float32: out.float32, pic_twin: out.pic_twin,
    pass: judge(out.float32), twin_caught: !judge(out.pic_twin),
    sources: Object.fromEntries(['src/sim/mpm.js', 'src/gpu/mpm-gl.js', 'src/sim/cases.js', 'tools/gpu-gate.html', 'tests/limits.json'].map((f) => [f, sha(f)])),
    errors,
  };
  fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'receipts/gpu-cpu.json'), JSON.stringify(receipt, null, 1) + '\n');
  console.log(JSON.stringify(receipt, null, 1));
  await browser.close(); srv.close();
})();
