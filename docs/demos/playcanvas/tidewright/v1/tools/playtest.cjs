// Headless playtest: serves the repo, opens the game in Chromium (playwright), applies a plan, runs the storm at a
// chosen speed, takes screenshots along the way, and reports console errors and the outcome.
//   NODE_PATH=$(npm root -g) node tools/playtest.cjs --plan=bot --speed=16 --shots=3 --out=rec [--bad=1] [--cam=yaw,pitch,dist,x,z]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
(async () => {
  const out = path.resolve(flags.out || 'rec'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(flags.w || 1440), height: Number(flags.h || 860) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const q = new URLSearchParams({ play: '1', speed: String(flags.speed || 16) });
  if (flags.plan) q.set('plan', flags.plan); if (flags.bad) q.set('bad', '1'); if (flags.cam) q.set('cam', flags.cam);
  await page.goto(`http://localhost:${srv.address().port}/?${q}`);
  await page.waitForFunction(() => window.__tide && window.__tide.mode === 'plan', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const tag = flags.tag || flags.plan || 'none';
  await page.screenshot({ path: path.join(out, `${tag}-plan.png`) });
  if (flags.planOnly) { console.log(JSON.stringify({ errors })); await browser.close(); srv.close(); return; }
  await page.evaluate(() => window.__tideApi.runStorm());
  const shots = Number(flags.shots || 3), report = [];
  const dur = await page.evaluate(() => window.__tide.level.duration);
  for (let k = 1; k <= shots; k++) {
    const target = (dur * k) / (shots + 1);
    await page.waitForFunction((t) => !window.__tide.storm || window.__tide.storm.t >= t || window.__tide.mode === 'result', target, { timeout: 30 * 60 * 1000, polling: 500 });
    const st = await page.evaluate(() => { const s = window.__tide.storm; if (!s || !s.last) return null; const o = s.last; return { t: o.t, stage: o.stage, fb: o.freeboard, flooded: o.nFlooded, integrity: o.integrity, ledgerRel: o.ledger.rel }; });
    report.push(st);
    await page.screenshot({ path: path.join(out, `${tag}-storm-${k}.png`) });
  }
  await page.waitForFunction(() => window.__tide.mode === 'result', null, { timeout: 30 * 60 * 1000, polling: 1000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${tag}-result.png`) });
  const res = await page.evaluate(() => window.__tide.result);
  const fps = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(n / 2); }; requestAnimationFrame(f); }));
  console.log(JSON.stringify({ plan: flags.plan || null, browser: browser.version(), fps_result_screen: fps, result: res, report, errors: errors.slice(0, 10) }, null, 1));
  await browser.close(); srv.close();
})();
