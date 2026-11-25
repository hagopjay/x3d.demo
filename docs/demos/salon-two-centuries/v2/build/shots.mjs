// Frames for Demo 79: X_ITE 16.7.1 in Playwright Chromium with SwiftShader WebGL2.
// Usage: node build/shots.mjs http://127.0.0.1:8765/demos/salon-two-centuries/v1/ OUT_DIR [scale] [only]
// Logs every console error and page error; a frame whose mean luminance is under 0.02 is reported BLACK.
// Also checks picking: SALON.card(id) after a fly-to, and the painting card shown.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const [url, outDir, scaleArg, only] = process.argv.slice(2);
const scale = Number(scaleArg || 1);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: scale });
const log = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GPU stall due to ReadPixels/.test(m.text())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => log.push(`[requestfailed] ${r.url()}`));
page.on('response', r => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.SALON && window.SALON.ready, null, { timeout: 300000 });
const readyMs = Date.now() - t0;
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const view = page.locator('#view');
const clipBox = async () => { await page.evaluate(() => document.querySelector('#view').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); const b = await view.boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
const lumOf = () => page.evaluate(() => {
  const c = document.querySelector('x3d-canvas').shadowRoot?.querySelector('canvas') || document.querySelector('canvas');
  const t = document.createElement('canvas'); t.width = 160; t.height = 100;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
  const d = x.getImageData(0, 0, 160, 100).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return s / (d.length / 4);
});
const report = [];
async function shot(name, caption, setup, wait = 6000) {
  if (only && !name.startsWith(only)) return;
  await page.evaluate(setup);
  await page.waitForTimeout(wait);
  const file = name + '.png';
  await page.screenshot({ path: path.join(outDir, file), clip: await clipBox(), timeout: 120000 });
  const lum = await lumOf();
  report.push({ file: name + '.webp', caption, mean_luminance: Number(lum.toFixed(4)), black: lum < 0.02 });
  console.log(name, 'lum', lum.toFixed(4), lum < 0.02 ? 'BLACK' : '');
}
await page.waitForTimeout(6000);
await shot('00-hero', 'The corridor from 1700: Baroque on the left, Rococo on the right, the Atlas sky overhead', () => SALON.bind('VP_00'), 9000);
await shot('01-rococo', 'Rococo: pastel boiserie, gilt rocaille and mirrors', () => SALON.bind('VP_02'));
await shot('02-neoclassicism', 'Neoclassicism: fluted columns and coffers, David and Ingres at real size', () => SALON.bind('VP_03'));
await shot('03-romanticism', 'Romanticism: Gothic Revival ribs and amber light', () => SALON.bind('VP_04'));
await shot('04-walkin-raft', 'Walk into The Raft of the Medusa (1819): depth-estimated relief', () => SALON.bind('VP_W_Q212616'), 8000);
await shot('05-impressionism', 'Impressionism under a glass roof', () => SALON.bind('VP_06'));
await shot('06-walkin-jatte', 'La Grande Jatte (1884) as 46,000 coloured points in depth', () => SALON.bind('VP_W_Q1044742'), 8000);
await shot('07-walkin-starry', 'Walk into The Starry Night (1889)', () => SALON.bind('VP_W_Q45585'), 8000);
await shot('08-symbolism', 'Symbolism: gold mosaic and violet dark', () => SALON.bind('VP_08'));
await shot('09-artnouveau', 'Art Nouveau: whiplash ironwork under glass', () => SALON.bind('VP_09'));
await shot('10-pigments', 'The Pigment Tower, 1704 to 1868', () => SALON.bind('VP_10'));
await shot('11-letters', 'Letters wing: life rails of 60 writers (gold = named in Western.Epic.md), books at their publication year', () => SALON.bind('VP_11'));
await shot('12-ideas', 'Ideas wing: 45 thinkers, tablets for The Wealth of Nations, Critique of Pure Reason, The Social Contract', () => SALON.bind('VP_12'));
await shot('13-music', 'Music wing: listening posts play public-domain scores, synthesised', () => SALON.bind('VP_13'));
await shot('14-building', 'Building wing: 30 buildings 1714 to 1889 as type models on plinths', () => SALON.bind('VP_14'));
await shot('15-eiffel', 'Eiffel Tower (1889) at 1:20, rising through the glass roof', () => SALON.bind('VP_15'), 8000);
await shot('16-crystal', 'The Crystal Palace (1851), glass and iron', () => SALON.bind('VP_16'), 8000);
await shot('17-atlas', 'The Atlas sky: 595 lives across painting, letters, ideas, music and building; magenta = cross-field influence', () => SALON.bind('VP_17'), 9000);
let pick = null;
if (!only || 'fly'.startsWith(only) || only === '18') {
  const target = await page.evaluate(async () => { const d = await fetch('data/paintings.json').then(r => r.json()); return d.paintings.find(p => p.title.startsWith('The Oath of the Horatii')).id; });
  await page.evaluate(id => { SALON.fly(id); SALON.card(id); }, target);
  await page.waitForTimeout(6000);
  pick = await page.evaluate(() => ({ selected: window.SALON.selected, card: document.querySelector('#cName').textContent.trim() }));
  pick.asked = target; pick.ok = pick.selected === target;
  await page.screenshot({ path: path.join(outDir, '18-fly.png'), clip: await clipBox(), timeout: 120000 });
  report.push({ file: '18-fly.webp', caption: 'Fly-to from the hang table: The Oath of the Horatii at real size (330 × 425 cm)', mean_luminance: Number((await lumOf()).toFixed(4)) });
}
await page.evaluate(() => SALON.bind('VP_00'));
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(outDir, '19-page.png'), fullPage: false });
report.push({ file: '19-page.webp', caption: 'The page: view, painting card, rooms' });
const ver = await page.evaluate(() => (window.X3D && X3D.getBrowser('#xite').version) || '?');
const rec = { x_ite: ver, chromium: browser.version(), webgl_renderer: gl, scale, ready_ms: readyMs, frames: report, pick, console: log };
fs.writeFileSync(path.join(outDir, 'shots-receipt.json'), JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ x_ite: ver, chromium: browser.version(), gl, readyMs, pick, console: log.slice(0, 30) }, null, 1));
await browser.close();
