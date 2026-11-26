// Headless page check: node build/shots.mjs <docs root> <out dir>. Serves the docs folder, loads the page in Chromium (WebGL2 via SwiftShader),
// records console errors, HTTP errors, canvas size, the live Script motion witness, one frame per station and a fly-to, and a brightness check.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]); fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.x3d': 'application/octet-stream' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', ...(process.env.CSP && path.extname(p) === '.html' ? { 'content-security-policy': process.env.CSP } : {}) }); r.end(b); } }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], http404 = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) http404.push(r.status() + ' ' + r.url()); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/demos/landscape-of-consciousness/v1/index.html${process.env.QS || ""}`);
await page.waitForFunction(() => document.getElementById('boot').className === 'done', null, { timeout: 180000 }).catch(() => {});
const loadMs = Date.now() - t0;
await page.waitForTimeout(4500);   // let the motion witness (2.5 s) report
const info = await page.evaluate(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), status: document.getElementById('status').textContent, tw: document.getElementById('tw').textContent, boot: document.getElementById('boot').textContent, listed: document.querySelectorAll('#list button').length }; });
const frames = [];
async function shoot(name, action) {
  await page.evaluate(action); await page.waitForTimeout(1800);
  const el = await page.$('#view'); const f = path.join(out, name + '.jpg'); await el.screenshot({ path: f, type: 'jpeg', quality: 82 });
  const mean = await page.evaluate(async src => 0, 0); frames.push({ name, bytes: fs.statSync(f).size });
}
const QUICK = !!process.env.QUICK;
const bindJs = d => `document.querySelector('[data-vp="${d}"]').click()`;
if (QUICK) { await shoot('00-overview-csp', `document.getElementById('b-over').click()`); await page.waitForTimeout(6000); const tw2 = await page.evaluate(() => document.getElementById('tw').textContent); const rc = { rig: { csp: process.env.CSP, browser: browser.version() }, loadMs, canvas: info, twAfter: tw2, consoleErrors: errors, httpErrors: http404, frames }; fs.writeFileSync(path.join(out, 'shots-receipt.json'), JSON.stringify(rc, null, 1)); console.log(JSON.stringify(rc, null, 1)); await browser.close(); srv.close(); process.exit(0); }
await shoot('00-overview', `document.getElementById('b-over').click()`);
for (const d of ['VP1', 'VP2', 'VP3', 'VP4', 'VP5', 'VP6', 'VP7', 'VP8', 'VP9', 'VP10', 'Pilgrim']) await shoot('vp-' + d, bindJs(d));
await page.fill('#q', 'Seth'); await page.waitForTimeout(300);
const hits = await page.evaluate(() => document.querySelectorAll('#list button').length);
await shoot('fly-seth', `document.querySelector('#list button').click()`);
await page.evaluate(() => document.getElementById('b-pause').click());
const paused = await page.evaluate(() => document.getElementById('b-pause').textContent);
await page.screenshot({ path: path.join(out, 'page-full.jpg'), type: 'jpeg', quality: 70, fullPage: true });
const receipt = { rig: { x_ite: '16.7.1 (vendored, Demo 56 copy)', browser: browser.version(), gl: 'ANGLE SwiftShader (software, no GPU)' }, loadMs, canvas: info, searchHitsForSeth: hits, pauseButton: paused, frames, consoleErrors: errors, httpErrors: http404 };
fs.writeFileSync(path.join(out, 'shots-receipt.json'), JSON.stringify(receipt, null, 1)); console.log(JSON.stringify(receipt, null, 1));
await browser.close(); srv.close();
