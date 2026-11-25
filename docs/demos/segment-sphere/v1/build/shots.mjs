// Frames for Demo 78: X_ITE 16.7.1 in Playwright Chromium with SwiftShader WebGL2.
// Usage: NODE_PATH=... node build/shots.mjs http://127.0.0.1:8765/demos/segment-sphere/v1/ OUT_DIR [scale]
// Logs every console error and page error; a frame whose mean luminance is under 0.02 is reported BLACK.
// Also checks picking end to end: SEG.select(i) -> Script selected_changed -> page card.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const [url, outDir, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 1);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: scale });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GPU stall due to ReadPixels|404 \(File not found\)/.test(m.text())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.SEG && window.SEG.ready, null, { timeout: 180000 });
const readyMs = Date.now() - t0;
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const view = page.locator('#view');
const lumOf = () => page.evaluate(() => {
  const c = document.querySelector('x3d-canvas').shadowRoot?.querySelector('canvas') || document.querySelector('canvas');
  const t = document.createElement('canvas'); t.width = 160; t.height = 100;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
  const d = x.getImageData(0, 0, 160, 100).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return s / (d.length / 4);
});
const report = [];
async function shot(name, setup, wait) {
  await page.evaluate(setup);
  await page.waitForTimeout(wait);
  const st = await page.evaluate(() => ({ m: window.SEG.m, scriptMs: window.SEG.scriptMs, fps: X3D.getBrowser('#xite').currentFrameRate }));
  const file = path.join(outDir, name + '.png');
  await view.screenshot({ path: file });
  const lum = await lumOf();
  report.push({ name, m: Number((st.m ?? -1).toFixed(3)), script_ms: st.scriptMs, fps_swiftshader: Number((st.fps || 0).toFixed(2)), mean_luminance: Number(lum.toFixed(4)), black: lum < 0.02 });
  console.log(name, 'm', st.m?.toFixed(2), 'scriptMs', st.scriptMs, 'fps', st.fps?.toFixed(2), 'lum', lum.toFixed(4), lum < 0.02 ? 'BLACK' : '');
}
await page.waitForTimeout(5000);
await shot('00-hero', () => { SEG.mode(1, true); SEG.bind('VP_Sphere'); }, 5000);
await shot('01-wheel', () => { SEG.mode(0, true); SEG.bind('VP_Wheel'); }, 5000);
await shot('02-morph', () => { SEG.mode(0.5, true); SEG.bind('VP_Sphere'); }, 4000);
await shot('03-hopf', () => { SEG.mode(2, true); SEG.bind('VP_Hopf'); }, 6000);
await shot('04-hopf-tumble', () => { SEG.bind('VP_Pole'); }, 9000);
await shot('05-core', () => { SEG.mode(1, true); SEG.bind('VP_Core'); }, 5000);
await shot('06-category', () => { SEG.mode(1, true); SEG.bind('VP_C02'); }, 5000);
// picking round trip: select the first preview service through the Script, read the card back
const want = await page.evaluate(async () => { const r = await fetch('data/services.json').then(r => r.json()); return r.services.findIndex(v => v.status === 'preview'); });
await page.evaluate(i => { SEG.mode(1, true); SEG.select(i); }, want);
await page.evaluate(async i => { const r = await fetch('data/services.json').then(r => r.json()); SEG.bind('VP_C' + String(r.services[i].cat).padStart(2, '0')); }, want);
await page.waitForTimeout(3000);
const pick = await page.evaluate(() => ({ selected: window.SEG.selected, card: document.querySelector('#cName').textContent.trim() }));
await view.screenshot({ path: path.join(outDir, '07-select.png') });
// a short timed run in the Hopf view for the Script's own cost
await page.evaluate(() => { SEG.mode(2, true); SEG.bind('VP_Hopf'); });
await page.waitForTimeout(8000);
const hopfMs = await page.evaluate(() => window.SEG.scriptMs);
await page.evaluate(() => { SEG.mode(1, true); SEG.bind('VP_Sphere'); });
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(outDir, '08-page.png'), fullPage: false });
const ver = await page.evaluate(() => (window.X3D && X3D.getBrowser('#xite').version) || '?');
const rec = { x_ite: ver, chromium: browser.version(), webgl_renderer: gl, scale, ready_ms: readyMs, frames: report,
  pick: { asked: want, selected: pick.selected, card: pick.card, ok: pick.selected === want },
  script_ms: `Hopf view ${hopfMs} (301 fibers x 64 + 3 tori 40x40 + 301 gems + 19 bands per rebuild)`, console: log };
fs.writeFileSync(path.join(outDir, 'shots-receipt.json'), JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ x_ite: ver, chromium: browser.version(), gl, readyMs, pick: rec.pick, script_ms: rec.script_ms, console: log.slice(0, 20) }, null, 1));
await browser.close();
