// page-shots.mjs: open the v2 page in headless Chromium (SwiftShader), wait for the live viewer, write shots/page.jpg and shots/live-*.png.
// usage: node build/page-shots.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.x3d': 'model/x3d+xml', '.spz': 'application/octet-stream' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
const port = srv.address().port; const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 2 }); const logs = [];
pg.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); pg.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await pg.goto(`http://127.0.0.1:${port}/index.html`); await pg.waitForFunction('window.__ready === true', null, { timeout: 240000 });
await pg.waitForTimeout(4000);
const hud = await pg.textContent('#hud');
const snap = async (f) => { const box = await pg.evaluate(() => { const e = document.querySelector('.viewer'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); await pg.screenshot({ path: path.join(ROOT, 'shots', f), clip: box, timeout: 120000 }); };
await snap('live-clean.png');
for (const i of [3, 16, 21]) { await pg.locator('#vps button').nth(i).click(); await pg.waitForTimeout(2500); await snap(`live-clean-${String(i).padStart(2, '0')}.png`); }
await pg.locator('#vps button').nth(0).click(); await pg.waitForTimeout(1500);
await pg.evaluate(async () => { for (const i of document.images) i.loading = 'eager'; await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((ok) => { i.onload = i.onerror = ok; }))); });
await pg.screenshot({ timeout: 180000, path: path.join(ROOT, 'shots', 'page.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
const m = await pg.evaluate(() => ({ w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, imgs: [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src) }));
console.log(JSON.stringify({ hud, logs, m })); await b.close(); srv.close();
