// render_x3d.mjs: draw an X3D world through the X3D -> three.js bridge (x3d.loom x3d.threejs/bridge) at every Viewpoint
// and write, per Viewpoint: the bridge's own picture (PNG), planar depth as raw float32 (rows top to bottom,
// 0 = no surface) and the camera three.js actually used (world matrix, projection matrix).
// The depth pass draws the bridge's own meshes with a material that writes view-space z, so the depth sent to
// Atlas is the depth of what the bridge draws, not of a second model.
//
// usage: node render_x3d.mjs <world.x3d> <outDir> [--bridge DIR] [--three DIR] [--width 1280 --height 720]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const BRIDGE = opt('--bridge', process.env.BRIDGE_DIR || '/home/user/x3d.loom/x3d.threejs/bridge');
const THREE_DIR = opt('--three', process.env.THREE_DIR || '/tmp/tj/node_modules/three/build');
const XITE_DIR = opt('--xite', process.env.XITE_DIR || '/tmp/tj/node_modules/x_ite/dist');
const W = +opt('--width', 1280), H = +opt('--height', 720);
const [worldFile, outDir] = args;
if (!worldFile || !outDir) { console.error('usage: node render_x3d.mjs <world.x3d> <outDir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const bundle = require(path.join(BRIDGE, 'tools', 'bundle.js'))('body');
const { chromium } = require('playwright');

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<canvas id=c width=${W} height=${H} style="width:${W}px;height:${H}px;display:block"></canvas>
<script type="importmap">{"imports":{"three":"/three/three.module.js"}}</script>
<script type="module">
import * as THREE from '/three/three.module.js'; window.THREE = THREE;
const add = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.body.appendChild(s); });
window.pageReady = add('/bundle-body.js').then(async () => {
  const body = new Body(document.getElementById('c'), { tone: 'none', fontBase: '/x_ite/assets/fonts/', onNote: (m) => (window.__notes = window.__notes || []).push(m) });
  await body.init(); X3DSAI.setBody(body); window.__body = body; });
window.loadWorld = async (xml) => { await window.pageReady; const sc = await X3DSAI.B.createX3DFromString(xml); await X3DSAI.B.replaceWorld(sc); await X3DSAI.B.nextFrame(); await X3DSAI.B.nextFrame();
  const b = window.__body; return { viewpoints: b.world.nodes.filter((n) => n.type === 'Viewpoint').map((n) => n.def), three: THREE.REVISION, notes: window.__notes || [],
    gl: (() => { const g = b.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })(),
    floatTarget: !!b.renderer.getContext().getExtension('EXT_color_buffer_float') }; };
const depthMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
  vertexShader: 'varying float vz; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vz = -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'varying float vz; void main() { gl_FragColor = vec4(vz, 0.0, 0.0, 1.0); }' });
let rt = null;
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
window.shootViewpoint = async (i) => {
  const b = window.__body, vp = b.world.nodes.filter((n) => n.type === 'Viewpoint')[i];
  b.bindViewpoint(vp, true); if (b.tr) { b.pose = b.tr.to; b.tr = null; b.applyCamera(); }      // a cut, not a transition
  const png = b.shot(); const cam = b.cam; cam.updateMatrixWorld(true);
  // depth: the same scene graph and camera, every mesh drawn with the view-z material; sky, lines and points hidden
  const hidden = []; b.scene.traverse((o) => { if (o.visible && (o.renderOrder <= -900 || o.isLine || o.isPoints || o.isSprite)) { o.visible = false; hidden.push(o); } });
  rt = rt || new THREE.WebGLRenderTarget(${W}, ${H}, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, samples: 0 });
  const r = b.renderer, bg = b.scene.background, fog = b.scene.fog, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
  b.scene.background = null; b.scene.fog = null; b.scene.overrideMaterial = depthMat; r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, true, true); r.render(b.scene, cam);
  const px = new Float32Array(${W} * ${H} * 4); r.readRenderTargetPixels(rt, 0, 0, ${W}, ${H}, px);
  r.setRenderTarget(null); b.scene.overrideMaterial = null; b.scene.background = bg; b.scene.fog = fog; r.setClearColor(cc, ca); for (const o of hidden) o.visible = true;
  const z = new Float32Array(${W} * ${H}); for (let y = 0; y < ${H}; y++) { const src = (${H} - 1 - y) * ${W}; for (let x = 0; x < ${W}; x++) z[y * ${W} + x] = px[(src + x) * 4]; }   // GL rows are bottom-up; Atlas rows are top-down
  return { def: vp.def, png, depth: b64(new Uint8Array(z.buffer)), matrixWorld: Array.from(cam.matrixWorld.elements), projection: Array.from(cam.projectionMatrix.elements), near: cam.near, far: cam.far, fov: cam.fov, aspect: cam.aspect, hidden: hidden.length };
};
</script>`;

const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const send = (buf, type) => { r.writeHead(200, { 'content-type': type }); r.end(buf); };
  if (u === '/' || u === '/index.html') return send(PAGE, 'text/html');
  if (u === '/bundle-body.js') return send(bundle, 'text/javascript');
  for (const [pre, dir] of [['/three/', THREE_DIR], ['/x_ite/', XITE_DIR]]) if (u.startsWith(pre)) { const f = path.join(dir, u.slice(pre.length)); if (f.startsWith(dir) && fs.existsSync(f)) return send(fs.readFileSync(f), mime[path.extname(f)] || 'application/octet-stream'); }
  r.writeHead(404); r.end();
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const info = await page.evaluate((xml) => window.loadWorld(xml), fs.readFileSync(worldFile, 'utf8'));
const meta = { world: path.basename(worldFile), width: W, height: H, rig: { chromium: browser.version(), gl: info.gl, three: info.three, floatTarget: info.floatTarget }, notes: info.notes, frames: [] };
for (let i = 0; i < info.viewpoints.length; i++) {
  const s = await page.evaluate((k) => window.shootViewpoint(k), i);
  const stem = `${path.basename(worldFile, '.x3d')}-${String(i).padStart(2, '0')}`;
  fs.writeFileSync(path.join(outDir, stem + '-bridge.png'), Buffer.from(s.png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(outDir, stem + '-depth.f32'), Buffer.from(s.depth, 'base64'));
  meta.frames.push({ index: i, def: s.def, matrixWorld: s.matrixWorld, projection: s.projection, near: s.near, far: s.far, fov: s.fov, aspect: s.aspect, hidden: s.hidden });
  console.log(`${stem} ${s.def} hidden ${s.hidden}`);
}
meta.errors = errors;
fs.writeFileSync(path.join(outDir, path.basename(worldFile, '.x3d') + '-bridge.json'), JSON.stringify(meta, null, 1));
await browser.close(); server.close();
if (errors.length) { console.error('page errors:', errors.slice(0, 5)); process.exit(1); }
