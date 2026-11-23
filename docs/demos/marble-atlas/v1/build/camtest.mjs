// Demo 76: render each Atlas camera's X3D Viewpoint in X_ITE and save the frame for build/compare.py.
// Usage: node build/camtest.mjs http://127.0.0.1:8776/demos/marble-atlas/v1/ OUT_DIR
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
const meta = { chromium: browser.version(), worlds: {} };
for (const w of ['correct', 'fov-horizontal', 'pose-inverted', 'rdf-unconverted']) {
  const t0 = Date.now();
  await page.goto(`${base}build/camtest.html?world=../worlds/labels-${w}.x3d`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.READY, null, { timeout: 120000 });
  meta.worlds[w] = { load_ms: Date.now() - t0 };
  for (let i = 0; i < 10; i++) {
    await page.evaluate(i => window.bindCam('Cam' + i), i);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${w}_cam${i}.png`), clip: { x: 0, y: 0, width: 1280, height: 720 } });
  }
  console.log(w, meta.worlds[w].load_ms, 'ms');
}
meta.x_ite = await page.evaluate(() => X3D.getBrowser('#c').version);
meta.webgl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; });
meta.console = log.slice(0, 30);
fs.writeFileSync(path.join(out, 'camtest-meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
await browser.close();
