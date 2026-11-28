// Headless playtest: serves the repo, opens the game in Chromium with the scripted driver (?autodrive=1), takes
// screenshots along the climb and reports console errors and the outcome.
//   NODE_PATH=$(npm root -g) node tools/playtest.cjs --level=3 --power=diesel --seconds=40 --shots=4 --out=rec [--cam=1] [--setup=6x6,lockers,low,2]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.wasm': 'application/wasm', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);

(async () => {
  const out = path.resolve(flags.out || 'rec'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(flags.w || 1280), height: Number(flags.h || 720) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const level = flags.level || 1, power = flags.power || 'diesel';
  await page.goto(`http://localhost:${srv.address().port}/?level=${level}&power=${power}&autodrive=1`);
  try {
    await page.waitForFunction(() => window.__haul && window.__haul.mode === 'playing', null, { timeout: Number(flags.wait || 120) * 1000 });
  } catch (err) {
    const loading = await page.evaluate(() => document.getElementById('loading').textContent + ' | mode ' + (window.__haul && window.__haul.mode));
    console.log(JSON.stringify({ stuck: loading, errors }, null, 1));
    await page.screenshot({ path: path.join(out, 'stuck.png') });
    await browser.close(); srv.close(); return;
  }
  await page.evaluate(([cam, setup]) => {
    const s = window.__haul;
    if (cam) s.camMode = Number(cam);
    if (setup) { const [drive, lock, low, psi, fuel] = setup.split(','); Object.assign(s.sim.setup, { drive, lockers: lock === 'lockers', low: low === 'low', pressure: Number(psi), fuelMap: Number(fuel || 0) }); }
  }, [flags.cam, flags.setup]);
  const seconds = Number(flags.seconds || 30), shots = Number(flags.shots || 3);
  const report = [];
  for (let k = 0; k < shots; k++) {
    await page.waitForTimeout((seconds * 1000) / shots);
    const st = await page.evaluate(() => { const s = window.__haul.sim; return { t: s.time, x: s.out.pos.x, v: s.speed, status: s.status, wet: s.wetness, rpm: s.engine.rpm, gear: s.engine.gear + 1, smoke: s.engine.smoke }; });
    report.push(st);
    await page.screenshot({ path: path.join(out, `level${level}-${power}-${k}.png`) });
  }
  const fps = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(n / 2); }; requestAnimationFrame(f); }));
  console.log(JSON.stringify({ level, power, fps, report, errors: errors.slice(0, 8) }, null, 1));
  await browser.close(); srv.close();
})();
