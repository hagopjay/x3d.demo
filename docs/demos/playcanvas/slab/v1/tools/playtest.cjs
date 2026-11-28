// Headless playtest: serves the repo, opens SLAB in Chromium, lets a bot play (?bot=naive|patrol|safe|airbag),
// takes screenshots, and reports console errors and the game state.
//   NODE_PATH=$(npm root -g) node tools/playtest.cjs --bot=naive --level=1 --seconds=60 --shots=4 --cam=0 --keys=2:s --out=rec
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
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
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  const q = new URLSearchParams({ level: flags.level || 1, cam: flags.cam || 0, budget: flags.budget || 60 });
  if (flags.bot) q.set('bot', flags.bot);
  await page.goto(`http://localhost:${srv.address().port}/?${q}`);
  try { await page.waitForFunction(() => window.__slab && window.__slab.mode === 'ready', null, { timeout: Number(flags.wait || 240) * 1000 }); }
  catch (e) { console.log(JSON.stringify({ stuck: await page.evaluate(() => window.__slab && window.__slab.mode), errors }, null, 1)); await page.screenshot({ path: path.join(out, 'stuck.png') }); await browser.close(); srv.close(); return; }
  const seconds = Number(flags.seconds || 40), shots = Number(flags.shots || 3), report = [];
  for (let k = 0; k < shots; k++) {
    await page.waitForTimeout((seconds * 1000) / shots);
    if (flags.keys) for (const key of String(flags.keys).split(',')) if (key.startsWith(k + ':')) await page.keyboard.press(key.slice(2));
    if (flags.until) await page.waitForFunction((u) => { const r = window.__slab.runs[window.__slab.line]; return r && r.sim.t >= Number(u.split('|')[0]); }, String(flags.until).split(',')[k] || '0', { timeout: 600000 }).catch(() => {});
    report.push(await page.evaluate(() => { const G = window.__slab, r = G.runs[G.line]; return { mode: G.mode, line: G.line, t: r ? +r.sim.t.toFixed(2) : null, ratio: +G.ratio.toFixed(3), released: r && r.released, skier: r && r.skier.state, moved: r && r.home ? +r.moved().toFixed(2) : 0, msg: document.getElementById('msg').textContent, integrity: G.integrity && { ok: G.integrity.ok, dx: G.integrity.dx, dv: G.integrity.dv } }; }));
    await page.screenshot({ path: path.join(out, `shot-${k}.png`) });
  }
  const renderer = await page.evaluate(() => window.__slab.integrity && window.__slab.integrity.renderer);
  console.log(JSON.stringify({ browser: browser.version(), renderer, report, errors: errors.slice(0, 10) }, null, 1));
  await browser.close(); srv.close();
})();
