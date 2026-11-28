// Headless playtest: serves the repo, opens THERMAL in Chromium (?bot=mc flies the task), takes screenshots and
// reports console errors, the task state and the INTEGRITY windows.
//   NODE_PATH=$(npm root -g) node tools/playtest.cjs --bot=mc --warp=4 --seconds=40 --shots=3 --cam=1 --glass=1 --out=rec
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const flags = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
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
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  const q = new URLSearchParams({ warp: flags.warp || 1, cam: flags.cam || 0, glass: flags.glass || 0, spin: flags.spin || 1200 });
  if (flags.bot) q.set('bot', flags.bot); else q.set('play', 1);
  await page.goto(`http://localhost:${srv.address().port}/?${q}`);
  try { await page.waitForFunction(() => window.__thermal && window.__thermal.mode === 'playing', null, { timeout: Number(flags.wait || 300) * 1000 }); }
  catch (err) {
    console.log(JSON.stringify({ stuck: await page.evaluate(() => document.getElementById('loading').textContent), errors }, null, 1));
    await page.screenshot({ path: path.join(out, 'stuck.png') }); await browser.close(); srv.close(); return;
  }
  const seconds = Number(flags.seconds || 30), shots = Number(flags.shots || 3), report = [];
  for (let k = 0; k < shots; k++) {
    await page.waitForTimeout((seconds * 1000) / shots);
    if (flags.keys) for (const key of String(flags.keys).split(',')) if (key.startsWith(k + ':')) await page.keyboard.press(key.slice(2));
    report.push(await page.evaluate(() => { const s = window.__thermal, g = s.glider; return { mode: s.mode, t: +s.t.toFixed(1), step: s.gpu ? s.gpu.t : null, x: Math.round(g.st.x), y: Math.round(g.st.y), z: Math.round(g.st.z), kmh: Math.round(g.airspeed() * 3.6), te: +g.vario.te.toFixed(2), task: s.task.status, leg: s.task.leg, clouds: s.cloudCount, integrity: s.integrity.last, windows: [s.integrity.pass, s.integrity.windows], blown: s.blown }; }));
    await page.screenshot({ path: path.join(out, `shot-${k}.png`) });
  }
  const fps = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(n / 2); }; requestAnimationFrame(f); }));
  const renderer = await page.evaluate(() => window.__thermal.renderer);
  console.log(JSON.stringify({ browser: browser.version(), renderer, fps, report, errors: errors.slice(0, 10) }, null, 1));
  await browser.close(); srv.close();
})();
