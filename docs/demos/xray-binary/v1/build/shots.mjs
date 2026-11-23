// Frames for Demo 74: X_ITE 16.7.1 in Playwright Chromium with SwiftShader WebGL2.
// Usage: node build/shots.mjs http://127.0.0.1:8765/demos/xray-binary/v1/ OUT_DIR [scale]
// Logs every console error and page error; a frame whose mean luminance is under
// 0.02 is reported as BLACK and must be retaken, never scored.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');  // resolves through NODE_PATH
import fs from 'node:fs';
import path from 'node:path';

const [url, outDir, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 1);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: scale });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.XRAY && window.XRAY.ready, null, { timeout: 120000 });
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const view = page.locator('#view');
const plan = [
  ['00-hero', 'VP_Hero', 0], ['01-overview', 'VP_Overview', 0], ['02-gdb-world', 'VP_Overview', 1], ['03-vault', 'VP_Vault', 1],
  ['04-helix', 'VP_Helix', 0], ['05-lattice', 'VP_Lattice', 0], ['06-imports', 'VP_Imports', 0], ['07-gatekeeper', 'VP_Gatekeeper', 0]];
const report = [];
await page.waitForTimeout(6000);
for (const [name, vp, w] of plan) {
  await page.evaluate(([vp, w]) => { window.XRAY.world(w); window.XRAY.bind(vp); }, [vp, w]);
  await page.waitForTimeout(4500);
  const file = path.join(outDir, name + '.png');
  await view.screenshot({ path: file });
  const lum = await page.evaluate(() => {
    const c = document.querySelector('x3d-canvas').shadowRoot?.querySelector('canvas') || document.querySelector('canvas');
    const t = document.createElement('canvas'); t.width = 160; t.height = 100;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
    const d = x.getImageData(0, 0, 160, 100).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return s / (d.length / 4);
  });
  report.push({ name, vp, world: w, mean_luminance: Number(lum.toFixed(4)), black: lum < 0.02 });
  console.log(name, vp, 'world', w, 'lum', lum.toFixed(4), lum < 0.02 ? 'BLACK' : '');
}
const full = path.join(outDir, '08-page.png');
await page.evaluate(() => { window.XRAY.world(0); window.XRAY.bind('VP_Overview'); });
await page.waitForTimeout(3000);
await page.screenshot({ path: full, fullPage: false });
const ver = await page.evaluate(() => (window.X3D && X3D.getBrowser('#xite').version) || '?');
fs.writeFileSync(path.join(outDir, 'shots-receipt.json'), JSON.stringify({ x_ite: ver, chromium: browser.version(), webgl_renderer: gl, scale, frames: report, console: log }, null, 1));
console.log('x_ite', ver, 'chromium', browser.version(), 'gl', gl);
console.log(log.slice(0, 30).join('\n'));
await browser.close();
