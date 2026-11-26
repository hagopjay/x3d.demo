// Frames for Demo 81: X_ITE in Playwright Chromium with SwiftShader WebGL2.
// Usage: node build/shots.mjs http://127.0.0.1:8765/demos/open3d-ml-bridge/v1/ OUT_DIR
// Logs console errors; a frame whose mean luminance is under 0.02 is reported BLACK.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs'; import path from 'node:path';
const [url, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GPU stall due to ReadPixels/.test(m.text())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.SEG && window.SEG.ready, null, { timeout: 240000 });
const readyMs = Date.now() - t0;
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const xv = await page.evaluate(() => X3D.getBrowser('#xite').name + ' ' + (X3D.getBrowser('#xite').version || ''));
const view = page.locator('#view');
const lum = () => page.evaluate(() => { const c = document.querySelector('x3d-canvas').shadowRoot?.querySelector('canvas') || document.querySelector('canvas'); const t = document.createElement('canvas'); t.width = 160; t.height = 100; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 160, 100); const d = x.getImageData(0, 0, 160, 100).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; return s / (d.length / 4); });
const report = [];
async function shot(name, setup, wait = 4000) {
  await page.evaluate(setup); await page.waitForTimeout(wait);
  await view.screenshot({ path: path.join(outDir, name + '.jpg'), type: 'jpeg', quality: 86 });
  const l = await lum(); report.push({ name, mean_luminance: Number(l.toFixed(4)), black: l < 0.02 });
  console.log(name, l.toFixed(4), l < 0.02 ? 'BLACK' : '');
}
await page.waitForTimeout(4000);
await shot('00-hero', () => { SEG.all(); SEG.boxes(false); SEG.lens(0); });
await shot('01-rgb', () => SEG.lens(1));
await shot('02-confidence', () => SEG.lens(2));
await shot('03-boxes', () => { SEG.lens(0); SEG.boxes(true); });
await shot('04-door', () => { SEG.boxes(false); SEG.only('door'); });
await shot('05-top', () => { SEG.all(); SEG.lens(0); SEG.bind('VP_Overview'); });
await page.screenshot({ path: path.join(outDir, 'page.jpg'), type: 'jpeg', quality: 70, fullPage: true });
fs.writeFileSync(path.join(outDir, 'shots-receipt.json'), JSON.stringify({ x_ite: xv, chromium: browser.version(), webgl_renderer: gl, ready_ms: readyMs, console: log, frames: report }, null, 1));
console.log('ready ms', readyMs, gl, xv, 'console lines', log.length); log.forEach(l => console.log(l));
await browser.close();
