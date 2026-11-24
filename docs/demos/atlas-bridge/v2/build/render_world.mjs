// render_world.mjs: draw an X3D world that holds GaussianSplats through the X3D -> three.js bridge, with the bridge's
// GaussianSplats node (bridge-node/GaussianSplats.js) and Spark handed over as window.SPARK. The world is loaded by URL,
// so its Inline and its splatFile resolve against the folder it sits in.
// usage: node render_world.mjs <folder> <world.x3d> <outDir> [--only 0,6] [--show DEF,DEF] [--hide DEF,DEF] [--tag name] [--no-spark] [--settle 6]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BRIDGE = opt('--bridge', process.env.BRIDGE_DIR || '/home/user/x3d.loom/x3d.threejs/bridge');
const THREE_DIR = opt('--three', process.env.THREE_DIR || '/tmp/tj/node_modules/three/build');
const XITE_DIR = opt('--xite', process.env.XITE_DIR || '/tmp/tj/node_modules/x_ite/dist');
const SPARK_DIR = opt('--spark', '/tmp/tj/node_modules/@sparkjsdev/spark/dist');
const NODE_FILE = opt('--node', null);   // only for a bridge checkout that has no src/nodes/GaussianSplats.js yet
const W = +opt('--width', 1280), H = +opt('--height', 720), ONLY = opt('--only', null), TAG = opt('--tag', 'world'), SETTLE = +opt('--settle', 6);
const SHOW = (opt('--show', '') || '').split(',').filter(Boolean), HIDE = (opt('--hide', '') || '').split(',').filter(Boolean), NOSPARK = flag('--no-spark');
const [folder, worldName, outDir] = args;
if (!folder || !worldName || !outDir) { console.error('usage: node render_world.mjs <folder> <world.x3d> <outDir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const bundle = require(path.join(BRIDGE, 'tools', 'bundle.js'))('body');
const nodeSrc = NODE_FILE ? '(function () { const R = window.__R;\n' + fs.readFileSync(NODE_FILE, 'utf8') + '\n})();' : '';
const { chromium } = require('playwright');
const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<canvas id=c width=${W} height=${H} style="width:${W}px;height:${H}px;display:block"></canvas>
<script type="importmap">{"imports":{"three":"/three/three.module.js","three/addons/":"/addons/"}}</script>
<script type="module">
import * as THREE from '/three/three.module.js'; window.THREE = THREE;
${NOSPARK ? '' : "const SP = await import('/spark/spark.module.js'); window.SPARK = SP;"}
const add = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.body.appendChild(s); });
window.pageReady = add('/bundle-body.js').then(() => add('/node-GaussianSplats.js')).then(async () => {
  const body = new Body(document.getElementById('c'), { tone: 'none', fontBase: '/x_ite/assets/fonts/', onNote: (m) => (window.__notes = window.__notes || []).push(m) });
  await body.init(); X3DSAI.setBody(body); window.__body = body; });
window.loadWorld = async (url, show, hide) => { await window.pageReady; const t0 = performance.now();
  const xml = await (await fetch(url)).text(); const sc = await X3DSAI.B.createX3DFromString(xml, new URL(url, location.href).href); await X3DSAI.B.replaceWorld(sc); await X3DSAI.B.nextFrame();
  const b = window.__body; for (const r of (b.splats || [])) await r.ready;
  const byDef = (d) => b.world.nodes.find((n) => n.def === d);
  for (const [list, on] of [[show, true], [hide, false]]) for (const d of list) { const n = byDef(d), r = n && b.rec.get(n.id); if (r && r.tn) r.tn.visible = on; else (window.__notes = window.__notes || []).push('no record for DEF ' + d); }
  await X3DSAI.B.nextFrame();
  return { ms: performance.now() - t0, viewpoints: b.viewpoints.map((n) => n.def), notes: window.__notes || [], three: THREE.REVISION,
    splats: (b.splats || []).map((r) => ({ def: r.node.def, drawer: r.drawer, inline: r.count, file: r.file ? r.file.split('/').pop() : null, fileCount: r.fileCount || null })),
    gl: (() => { const g = b.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })() }; };
window.shoot = async (i, settle) => { const b = window.__body, vp = b.viewpoints[i];
  b.bindViewpoint(vp, true); if (b.tr) { b.pose = b.tr.to; b.tr = null; b.applyCamera(); }
  for (let k = 0; k < settle; k++) { b.shot(); await new Promise((r) => setTimeout(r, 200)); }      // let the splat sort settle for this camera
  return { def: vp.def, png: b.shot() }; };
</script>`;
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json', '.x3d': 'model/x3d+xml', '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const send = (buf, type) => { r.writeHead(200, { 'content-type': type }); r.end(buf); };
  if (u === '/' || u === '/index.html') return send(PAGE, 'text/html');
  if (u === '/bundle-body.js') return send(bundle, 'text/javascript');
  if (u === '/node-GaussianSplats.js') return send(nodeSrc, 'text/javascript');
  for (const [pre, dir] of [['/three/', THREE_DIR], ['/x_ite/', XITE_DIR], ['/spark/', SPARK_DIR], ['/addons/', path.join(THREE_DIR, '..', 'examples', 'jsm')], ['/w/', path.resolve(folder)]])
    if (u.startsWith(pre)) { const f = path.join(dir, u.slice(pre.length)); if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(fs.readFileSync(f), mime[path.extname(f)] || 'application/octet-stream'); }
  r.writeHead(404); r.end();
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.loadWorld === 'function', null, { timeout: 120000 });
const info = await page.evaluate(([u, s, h]) => window.loadWorld(u, s, h), ['/w/' + worldName, SHOW, HIDE]);
console.log('loaded', JSON.stringify({ ms: Math.round(info.ms), splats: info.splats, viewpoints: info.viewpoints.length, notes: info.notes.slice(0, 6) }));
const want = ONLY ? ONLY.split(',').map(Number) : info.viewpoints.map((_, i) => i);
const stem0 = path.basename(worldName, '.x3d');
for (const i of want) { const t0 = Date.now(); const s = await page.evaluate(([k, n]) => window.shoot(k, n), [i, SETTLE]);
  fs.writeFileSync(path.join(outDir, `${stem0}-${String(i).padStart(2, '0')}-${TAG}.png`), Buffer.from(s.png.split(',')[1], 'base64')); console.log(`${stem0}-${String(i).padStart(2, '0')}-${TAG} ${s.def} ${Date.now() - t0} ms`); }
fs.writeFileSync(path.join(outDir, `${stem0}-${TAG}.json`), JSON.stringify({ rig: { chromium: browser.version(), gl: info.gl, three: info.three, spark: NOSPARK ? null : '2.4.0' }, world: worldName, show: SHOW, hide: HIDE, load: info, views: want, errors }, null, 1));
await browser.close(); server.close();
if (errors.length) { console.error('page errors:', errors.slice(0, 5)); process.exit(1); }
