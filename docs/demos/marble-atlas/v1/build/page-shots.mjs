// Demo 76 page frames. Usage: node build/page-shots.mjs http://127.0.0.1:8776/demos/marble-atlas/v1/ OUT_DIR
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
const [url, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: Number(process.env.DPR || 1) });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GPU stall/.test(m.text())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.ATLAS_READY, null, { timeout: 300000 });
const loadMs = Date.now() - t0;
const shots = [['fused-points-overview', '0', 'Overview', false], ['splats-overview', '1', 'Overview', false], ['mesh-colliders-overview', '2', 'Overview', true],
  ['points-plan', '0', 'Plan', false], ['splats-cam3', '1', 'Cam3', false], ['points-cam8', '0', 'Cam8', false]];
const frames = [];
for (const [name, body, vp, coll] of shots) {
  await page.evaluate(([body, vp, coll]) => { const s = X3D.getBrowser('#xite').currentScene; s.getNamedNode('Body').whichChoice = +body;
    s.getNamedNode('Colliders').whichChoice = coll ? 0 : -1; s.getNamedNode(vp).set_bind = true; }, [body, vp, coll]);
  await page.waitForTimeout(Number(process.env.SETTLE || 5000));
  const bb = await page.locator('#view').boundingBox();
  await page.screenshot({ path: path.join(out, name + '.png'), clip: bb, timeout: 180000 });
  frames.push(name); console.log(name);
}
await page.evaluate(() => { const s = X3D.getBrowser('#xite').currentScene; s.getNamedNode('Body').whichChoice = 0; s.getNamedNode('Overview').set_bind = true; });
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(out, 'page-top.png') });
await page.screenshot({ path: path.join(out, 'page-full.png'), fullPage: true, timeout: 180000 });
const meta = { x_ite: await page.evaluate(() => X3D.getBrowser('#xite').version), chromium: browser.version(), load_ms: loadMs,
  webgl: await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; }),
  frames, console: log.slice(0, 30) };
fs.writeFileSync(path.join(out, 'page-shots-meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
await browser.close();
