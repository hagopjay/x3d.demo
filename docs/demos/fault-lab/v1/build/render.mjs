// node build/render.mjs  : every scene case in X_ITE (headless Chromium), two viewpoints, pixel difference against the clean twin.
// Writes stills/<case>.<view>.jpg and data/render.json. The clean twin is rendered twice as the control (must differ by 0 pixels).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const HERE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = normalize(join(HERE, '../../..'));           // docs/
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.x3d': 'model/x3d+xml', '.json': 'application/json', '.css': 'text/css', '.gltf': 'model/gltf+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttl': 'text/turtle', '.usda': 'text/plain' };
const server = createServer((q, s) => { const p = join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!p.startsWith(ROOT) || !existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p)); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}/demos/fault-lab/v1/`;
const cases = JSON.parse(readFileSync(join(HERE, 'data/cases.json'))).cases.filter(c => c.id === 'clean' || c.changed?.file === 'scene').map(c => c.id);
const VIEWS = ['V_Overview', 'V_Osiris'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
const shots = {}; let rig = null;
async function shot(id, view) {
  await page.goto(`${base}build/still.html?case=${id}&view=${view}`);
  const info = await page.evaluate(() => window.STILL);
  rig = rig || { ...info, gl: await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const x = g.getExtension('WEBGL_debug_renderer_info'); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); }), chromium: browser.version() };
  return await page.locator('#c').screenshot({ type: 'png' });
}
for (const id of [...cases, 'clean#2']) for (const v of VIEWS) { shots[id + '|' + v] = await shot(id.replace('#2', ''), v); }
// compare in the page (decodes PNG with the browser): count pixels whose largest channel difference is over 8/255, and their bounding box
await page.goto('about:blank');
const diff = (a, b) => page.evaluate(async ([a, b]) => {
  const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height); };
  const A = await load(a), B = await load(b); let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, max = 0;
  for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])); if (d > max) max = d; if (d > 8) { n++; const p = i / 4, x = p % A.width, y = (p / A.width) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return { pixels: n, share: +(n / (A.width * A.height)).toFixed(5), max_channel_diff: max, bbox: n ? [x0, y0, x1, y1] : null, size: [A.width, A.height] };
}, [a.toString('base64'), b.toString('base64')]);
const out = { schema: 'fault-lab.render/1', rig: { engine: `${rig.name} ${rig.version}`, browser: `headless Chromium ${rig.chromium}`, gl: rig.gl, canvas: [640, 400] }, threshold: 'a pixel counts when its largest channel difference is over 8 of 255', views: VIEWS, control: {}, cases: {} };
for (const v of VIEWS) out.control[v] = await diff(shots['clean|' + v], shots['clean#2|' + v]);
const jpg = await browser.newPage({ viewport: { width: 640, height: 400 } });
for (const id of cases) { out.cases[id] = {}; for (const v of VIEWS) { if (id !== 'clean') out.cases[id][v] = await diff(shots['clean|' + v], shots[id + '|' + v]);
  await jpg.setContent(`<body style="margin:0"><img src="data:image/png;base64,${shots[id + '|' + v].toString('base64')}">`); await jpg.locator('img').screenshot({ path: join(HERE, `stills/${id}.${v}.jpg`), type: 'jpeg', quality: 82 }); } }
writeFileSync(join(HERE, 'data/render.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.rig), JSON.stringify(out.control));
for (const id of cases) if (id !== 'clean') console.log(id.padEnd(16), VIEWS.map(v => `${v} ${out.cases[id][v].pixels}px`).join('  '));
await browser.close(); server.close();
