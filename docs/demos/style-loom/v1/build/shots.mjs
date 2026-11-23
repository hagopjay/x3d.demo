// Frames for Demo 75: X_ITE in Playwright Chromium (SwiftShader WebGL2).
// Usage: NODE_PATH=$(npm root -g) node build/shots.mjs http://127.0.0.1:8765/demos/style-loom/v1/ OUT_DIR [scale]
// One frame per style from the page's own live compile, plus operator and view frames.
// A frame whose mean luminance is under 0.02 is reported BLACK. Each style's declared
// intent.key (low / mid / high) is compared with the frame's measured mean luminance.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const [url, outDir, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 1);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: scale });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.STYLELOOM && window.STYLELOOM.ready, null, { timeout: 180000 });
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const ids = await page.evaluate(() => fetch('data/catalogue.jsonld').then(r => r.json()).then(c => c['@graph'].map(s => [s['@id'].replace('xst:', ''), s.intent.key])));
await page.addStyleTag({ content: '.hud,#tag{display:none!important}' });
const view = page.locator('#view');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const plan = [...ids.map(([id, key]) => [id, id, {}, key]),
  ['op-transpose-neon-in-manuscript', 'neon-noir', { palette: 'manuscript' }], ['op-transpose-maquette-in-thermal', 'maquette', { palette: 'thermal' }],
  ['op-invert-maquette', 'maquette', { inverted: true }], ['op-invert-neon-repaired', 'neon-noir', { inverted: true, repair: true }],
  ['op-mix-terracotta-brass-50', 'terracotta', { mixWith: 'brass', t: 0.5 }], ['op-mix-ink-atlas-50', 'ink-wash', { mixWith: 'atlas', t: 0.5 }],
  ['view-plan-blueprint', 'blueprint', { vp: 'VP_Plan' }], ['view-street-terracotta', 'terracotta', { vp: 'VP_Street' }], ['view-street-neon', 'neon-noir', { vp: 'VP_Street' }], ['view-plan-atlas', 'atlas', { vp: 'VP_Plan' }]]
  .filter(p => !only || only.includes(p[0]));
const frames = [];
for (const [name, id, o, key] of plan) {
  await page.evaluate(([id, o]) => window.STYLELOOM.pick(id, o), [id, o]);
  await page.waitForFunction(() => !window.STYLELOOM.busy, null, { timeout: 120000 });
  await page.waitForTimeout(Number(process.env.SETTLE || 3500));
  await page.evaluate(() => document.querySelector('#view').scrollIntoView({ block: 'center' }));
  const bb = await view.boundingBox();
  await page.screenshot({ path: path.join(outDir, name + '.png'), clip: bb, timeout: 120000 });
  const lum = await page.evaluate(() => {
    const c = document.querySelector('x3d-canvas').shadowRoot?.querySelector('canvas') || document.querySelector('canvas');
    const t = document.createElement('canvas'); t.width = 160; t.height = 100;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
    const d = x.getImageData(0, 0, 160, 100).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return s / (d.length / 4);
  });
  const info = await page.evaluate(() => ({ lint: window.STYLELOOM.lint, compile_ms: +window.STYLELOOM.compileMs.toFixed(0) }));
  const band = key ? (key === 'low' ? lum < 0.3 : key === 'high' ? lum > 0.55 : lum >= 0.2 && lum <= 0.75) : null;
  frames.push({ name, style: id, ops: o, mean_luminance: +lum.toFixed(4), black: lum < 0.02, declared_key: key || null, key_agrees: band, ...info });
  console.log(name.padEnd(36), 'lum', lum.toFixed(4), lum < 0.02 ? 'BLACK' : '', key ? `key ${key} ${band ? 'agrees' : 'DISAGREES'}` : '', 'lint', info.lint, info.compile_ms + 'ms');
}
if (!only) {
  await page.addStyleTag({ content: '.hud,#tag{display:flex!important}#tag{display:block!important}' });
  await page.evaluate(() => window.STYLELOOM.pick('manuscript', {}));
  await page.waitForFunction(() => !window.STYLELOOM.busy); await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(outDir, 'page-manuscript.png') });
  await page.evaluate(() => window.STYLELOOM.pick('neon-noir', {}));
  await page.waitForFunction(() => !window.STYLELOOM.busy); await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(outDir, 'page-neon-noir.png') });
  await page.screenshot({ path: path.join(outDir, 'page-full.png'), fullPage: true });
}
const ver = await page.evaluate(() => (window.X3D && X3D.getBrowser('#xite').version) || '?');
const keyed = frames.filter(f => f.declared_key);
const receipt = { x_ite: ver, chromium: browser.version(), webgl_renderer: gl, scale, rig: 'Playwright headless Chromium, 1500x1000 viewport, #view element, page live compile',
  key: { checked: keyed.length, agree: keyed.filter(f => f.key_agrees).length, bands: 'mean sRGB luma of the frame: low < 0.30, mid 0.20..0.75, high > 0.55' }, frames, console: log };
const rp = path.join(outDir, 'shots-receipt.json');
if (only && fs.existsSync(rp)) {   // a partial re-run replaces only the frames it retook
  const old = JSON.parse(fs.readFileSync(rp, 'utf8'));
  old.frames = old.frames.map(f => frames.find(n => n.name === f.name) || f);
  const k = old.frames.filter(f => f.declared_key); old.key.checked = k.length; old.key.agree = k.filter(f => f.key_agrees).length;
  old.retaken = [...(old.retaken || []), ...frames.map(f => f.name)];
  fs.writeFileSync(rp, JSON.stringify(old, null, 1));
} else if (!only) fs.writeFileSync(rp, JSON.stringify(receipt, null, 1));
console.log('x_ite', ver, 'chromium', browser.version(), 'gl', gl, 'key', receipt.key.agree + '/' + receipt.key.checked);
console.log(log.slice(0, 20).join('\n'));
await browser.close();
