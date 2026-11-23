// page-shots.mjs: open the demo page itself in headless Chromium and photograph the live viewer, layer by layer.
// The pinned CDN modules (three r187, Spark 2.4.0) are answered from local copies of the same versions, so the
// run needs no network. usage: node build/page-shots.mjs [--world 0] [--vp 0] [--out shots] [--layers splats,mesh,blockout,colliders] [--wait 60]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODS = opt('--modules', process.env.MODULES_DIR || '/tmp/tj/node_modules'), WORLD = +opt('--world', 0), VP = +opt('--vp', 0), OUT = path.resolve(HERE, opt('--out', 'shots'));
const LAYERS = opt('--layers', 'splats,mesh,blockout,colliders').split(','), WAIT = +opt('--wait', 60) * 1000, FULL = args.includes('--full');
const { chromium } = require('playwright');
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.x3d': 'model/x3d+xml', '.spz': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.md': 'text/plain' };
const server = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]), f = path.join(HERE, u === '/' ? 'index.html' : u);
  if (!f.startsWith(HERE) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
await page.route('https://cdn.jsdelivr.net/**', (route) => { const u = new URL(route.request().url()).pathname.replace(/^\/npm\//, '').replace(/^((?:@[^/]+\/)?[^/@]+)@[^/]+/, '$1'), f = path.join(MODS, u);
  if (fs.existsSync(f)) route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }); else { errors.push('no local copy of ' + u); route.abort(); } });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
const cur = await page.evaluate(() => [...document.querySelectorAll('#worlds button')].findIndex((b) => b.classList.contains('on')));
if (WORLD !== cur) { await page.evaluate((i) => { window.__ready = false; window.__load(i); }, WORLD); await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 }); }
const info = await page.evaluate(() => { const b = window.__body(); return { splats: (b.splats || []).map((r) => ({ drawer: r.drawer, count: r.count, fileCount: r.fileCount || null })), hud: document.getElementById('hud').innerText, worlds: [...document.querySelectorAll('#worlds button')].map((x) => x.textContent) }; });
console.log(JSON.stringify(info));
const click = async (sel, text) => page.evaluate(([s, t]) => { const b = [...document.querySelectorAll(s + ' button')].find((x) => x.textContent === t); if (b) b.click(); return !!b; }, [sel, text]);
await page.evaluate((i) => document.querySelectorAll('#vps button')[i].click(), VP);
const NAMES = { splats: 'Atlas splats', mesh: 'Atlas mesh', blockout: 'X3D blockout', colliders: 'Collider boxes' };
const slug = info.worlds[WORLD].split(' · ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const state = { 'Atlas splats': true, 'Atlas mesh': false, 'X3D blockout': false, 'Collider boxes': false };
const want = { splats: ['Atlas splats'], mesh: ['Atlas mesh'], blockout: ['X3D blockout'], colliders: ['X3D blockout', 'Collider boxes'] };
for (const L of LAYERS) {
  for (const [name, on] of Object.entries(state)) { const target = want[L].includes(name); if (on !== target) { await click('#layers', name); state[name] = target; } }
  await page.waitForTimeout(WAIT);
  const png = await page.evaluate(() => window.__body().shot());
  fs.writeFileSync(path.join(OUT, `live-${slug}-${String(VP).padStart(2, '0')}-${L}.png`), Buffer.from(png.split(',')[1], 'base64')); console.log('shot', L);
}
if (FULL) { for (const [name, on] of Object.entries(state)) { const target = name === 'Atlas splats'; if (on !== target) await click('#layers', name); } await page.waitForTimeout(WAIT); await page.screenshot({ path: path.join(OUT, `page-${slug}.png`), fullPage: true, timeout: 400000 }); }
const notes = await page.evaluate(() => document.getElementById('hud').innerText);
fs.writeFileSync(path.join(OUT, `live-${slug}-${String(VP).padStart(2, '0')}.json`), JSON.stringify({ rig: { chromium: browser.version(), gl: 'ANGLE SwiftShader (software)', three: 'r187', spark: '2.4.0' }, info, hud: notes, errors }, null, 1));
await browser.close(); server.close();
if (errors.length) { console.error('page errors:', errors.slice(0, 6)); process.exit(1); }
