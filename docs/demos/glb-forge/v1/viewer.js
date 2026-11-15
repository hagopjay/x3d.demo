// three.js side of the page: one canvas, two scenes (original, forged), one camera. Wipe mode scissors the two renders at a draggable divider;
// difference mode renders both into targets and shows |A-B| (after sRGB encoding, times a gain) as a heat map, and reads both back for the numbers.
// Loaded lazily (dynamic import) after first paint. three.js comes from the pinned jsDelivr URLs in the page's import map.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const REVISION = THREE.REVISION;
const LIBS = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/`;
const BG = 0x0b101c, FILL = 0.3;

const FRAG_COMMON = `
varying vec2 vUv;
vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createViewer(host, cb = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D view of the original and the forged glb. Drag to orbit, scroll to zoom, arrow keys pan.');
  host.insertBefore(canvas, host.firstChild);
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const adapter = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'adapter name hidden by the browser';

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.listenToKeyEvents(canvas);
  const sides = { A: { scene: new THREE.Scene(), root: null, info: null }, B: { scene: new THREE.Scene(), root: null, info: null } };
  for (const s of Object.values(sides)) s.scene.background = new THREE.Color(BG);
  const bgBytes = (() => { const o = {}; new THREE.Color(BG).getRGB(o, THREE.SRGBColorSpace); return [Math.round(o.r * 255), Math.round(o.g * 255), Math.round(o.b * 255)]; })();

  // ---- loader with every decoder wired ----
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager).setDecoderPath(LIBS + 'draco/gltf/');
  const ktx2 = new KTX2Loader(manager).setTranscoderPath(LIBS + 'basis/').detectSupport(renderer);
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

  // ---- state ----
  let mode = 'wipe', split = 0.5, gain = 8, framed = null, needs = false, lastCounts = { A: null, B: null }, lastDiff = null, measureTimer = 0, fillOn = true, disposed = false;
  let env = null, envOK = false;
  const halfOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

  // ---- wipe handle ----
  const wipe = document.createElement('div');
  wipe.className = 'wipe';
  wipe.innerHTML = '<button type="button" class="grip" role="slider" aria-label="Wipe divider: original on the left, forged on the right" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  host.appendChild(wipe);
  const grip = wipe.querySelector('.grip');
  const place = () => { wipe.style.left = (split * 100).toFixed(2) + '%'; grip.setAttribute('aria-valuenow', String(Math.round(split * 100))); };
  const setSplitFromX = (clientX) => { const r = host.getBoundingClientRect(); split = Math.min(0.98, Math.max(0.02, (clientX - r.left) / r.width)); place(); request(); };
  grip.addEventListener('pointerdown', (e) => { grip.setPointerCapture(e.pointerId); grip.dataset.drag = '1'; e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (grip.dataset.drag) setSplitFromX(e.clientX); });
  const endDrag = (e) => { delete grip.dataset.drag; try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02; let v = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = split - step; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = split + step;
    else if (e.key === 'Home') v = 0.02; else if (e.key === 'End') v = 0.98;
    if (v != null) { split = Math.min(0.98, Math.max(0.02, v)); place(); request(); e.preventDefault(); }
  });
  place();

  // ---- difference pipeline ----
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const matDiff = new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, gain: { value: gain } }, vertexShader: VERT, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: FRAG_COMMON + `
uniform sampler2D tA; uniform sampler2D tB; uniform float gain;
vec3 heat(float t){
  vec3 c0 = vec3(0.02, 0.0, 0.12), c1 = vec3(0.30, 0.05, 0.62), c2 = vec3(0.86, 0.18, 0.40), c3 = vec3(1.0, 0.66, 0.10), c4 = vec3(1.0, 0.97, 0.80);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}
void main(){
  vec3 a = enc(texture2D(tA, vUv).rgb), b = enc(texture2D(tB, vUv).rgb);
  vec3 d = abs(a - b); float m = max(d.r, max(d.g, d.b)); float t = clamp(m * gain, 0.0, 1.0);
  float g = dot(a, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(vec3(g) * 0.30, heat(sqrt(t)), smoothstep(0.0, 0.012, t)), 1.0);
}` });
  const matEnc = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null } }, vertexShader: VERT, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: FRAG_COMMON + 'uniform sampler2D tex; void main(){ gl_FragColor = vec4(enc(texture2D(tex, vUv).rgb), 1.0); }' });
  let T = null; // { w, h, A, B, eA, eB }
  const makeTarget = (w, h, type, samples) => { const t = new THREE.WebGLRenderTarget(w, h, { type, samples, depthBuffer: true }); t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter; return t; };
  function targets() {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2()), w = sz.x, h = sz.y;
    if (T && T.w === w && T.h === h) return T;
    if (T) { for (const k of ['A', 'B', 'eA', 'eB']) T[k].dispose(); }
    const type = halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    let A, B;
    try { A = makeTarget(w, h, type, 4); B = makeTarget(w, h, type, 4); } catch { A = makeTarget(w, h, type, 0); B = makeTarget(w, h, type, 0); }
    const e = () => { const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false }); t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter; return t; };
    T = { w, h, A, B, eA: e(), eB: e() };
    return T;
  }

  // ---- lighting ----
  function hasLights(s) { let n = 0; s.scene.traverse((o) => { if (o.isLight) n++; }); return n; }
  function applyLighting() {
    if (!envOK) { const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); envOK = true; }
    const lit = hasLights(sides.A) + hasLights(sides.B) > 0;
    for (const s of Object.values(sides)) {
      s.scene.environment = lit && !fillOn ? null : env;
      s.scene.environmentIntensity = lit ? FILL : 1;
    }
    return lit ? (fillOn ? 'glb lights + room fill ' + FILL : 'glb lights only') : 'no lights in the glb: room environment';
  }

  // ---- render ----
  function renderSceneTo(side, target) {
    renderer.info.reset();
    renderer.setRenderTarget(target);
    renderer.render(sides[side].scene, camera);
    lastCounts[side] = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
  function frame() {
    needs = false;
    if (disposed) return;
    const r = host.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (mode === 'wipe' || !(sides.A.root && sides.B.root)) {
      wipe.style.display = '';
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, w, h); renderer.setScissorTest(true);
      const x = Math.round(split * w);
      renderer.setScissor(0, 0, x, h); renderer.info.reset(); renderer.render(sides.A.scene, camera); lastCounts.A = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      renderer.setScissor(x, 0, w - x, h); renderer.info.reset(); renderer.render(sides.B.scene, camera); lastCounts.B = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      renderer.setScissorTest(false);
    } else {
      wipe.style.display = 'none';
      const t = targets();
      renderer.setScissorTest(false);
      renderSceneTo('A', t.A); renderSceneTo('B', t.B);
      renderer.setRenderTarget(null);
      matDiff.uniforms.tA.value = t.A.texture; matDiff.uniforms.tB.value = t.B.texture; matDiff.uniforms.gain.value = gain;
      quad.material = matDiff; renderer.render(quadScene, quadCam);
    }
    cb.onFrame && cb.onFrame(lastCounts);
  }
  function request() { if (!needs) { needs = true; requestAnimationFrame(frame); } }
  controls.addEventListener('change', request);
  controls.addEventListener('end', () => { if (mode === 'diff') scheduleMeasure(); });
  const ro = new ResizeObserver(() => { request(); if (mode === 'diff') scheduleMeasure(); });
  ro.observe(host);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cb.onError && cb.onError('gl', 'The WebGL context was lost. Reload the page to get the 3D view back.'); });

  // ---- difference numbers ----
  function scheduleMeasure() { clearTimeout(measureTimer); measureTimer = setTimeout(() => { measure().then((d) => cb.onDiff && cb.onDiff(d)).catch((e) => cb.onError && cb.onError('diff', String(e.message || e))); }, 350); }
  async function measure() {
    if (!(sides.A.root && sides.B.root)) return null;
    const t = targets();
    renderer.setScissorTest(false);
    renderSceneTo('A', t.A); renderSceneTo('B', t.B);
    quad.material = matEnc;
    matEnc.uniforms.tex.value = t.A.texture; renderer.setRenderTarget(t.eA); renderer.render(quadScene, quadCam);
    matEnc.uniforms.tex.value = t.B.texture; renderer.setRenderTarget(t.eB); renderer.render(quadScene, quadCam);
    const n = t.w * t.h, a = new Uint8Array(n * 4), b = new Uint8Array(n * 4);
    renderer.readRenderTargetPixels(t.eA, 0, 0, t.w, t.h, a); renderer.readRenderTargetPixels(t.eB, 0, 0, t.w, t.h, b);
    renderer.setRenderTarget(null);
    const [br, bg, bb] = bgBytes;
    let sumAbs = 0, sumSq = 0, max = 0, cov = 0, covAbs = 0, covSq = 0, diffPx = 0;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const dr = Math.abs(a[o] - b[o]), dg = Math.abs(a[o + 1] - b[o + 1]), db = Math.abs(a[o + 2] - b[o + 2]);
      const s = dr + dg + db, q = dr * dr + dg * dg + db * db, m = Math.max(dr, dg, db);
      if (s) diffPx++;
      sumAbs += s; sumSq += q; if (m > max) max = m;
      if (a[o] !== br || a[o + 1] !== bg || a[o + 2] !== bb || b[o] !== br || b[o + 1] !== bg || b[o + 2] !== bb) { cov++; covAbs += s; covSq += q; }
    }
    const psnr = (sq, k) => (sq === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sq / (3 * k))));
    lastDiff = { width: t.w, height: t.h, pixels: n, gain, meanAbs: sumAbs / (3 * n), maxAbs: max, psnr: psnr(sumSq, n), covered: cov, covMeanAbs: cov ? covAbs / (3 * cov) : 0, covPsnr: cov ? psnr(covSq, cov) : Infinity, diffPixels: diffPx, halfFloat: halfOK };
    request();
    return lastDiff;
  }

  // ---- models ----
  function disposeRoot(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
    });
  }
  function describe(root, gltf) {
    let meshes = 0, instancedMeshes = 0, instances = 0, tris = 0, lights = 0, lines = 0, points = 0;
    root.traverse((o) => {
      if (o.isLight) lights++;
      if (o.isMesh) {
        meshes++; const g = o.geometry, n = o.isInstancedMesh ? o.count : 1;
        if (o.isInstancedMesh) { instancedMeshes++; instances += n; }
        tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * n;
      } else if (o.isLine) lines++; else if (o.isPoints) points++;
    });
    return { meshes, instancedMeshes, instances, triangles: Math.round(tris), lights, lines, points, extensions: (gltf.parser.json.extensionsUsed || []).slice().sort() };
  }
  function frameCamera(root) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const dir = new THREE.Vector3(0.55, 0.35, 1).normalize(), f = dir.clone().negate(), up = new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), th = tv * camera.aspect, margin = 1.1;
    let d = 0;
    for (let k = 0; k < 8; k++) {
      const p = new THREE.Vector3(k & 1 ? half.x : -half.x, k & 2 ? half.y : -half.y, k & 4 ? half.z : -half.z);
      d = Math.max(d, Math.max(margin * Math.abs(p.dot(r)) / th, margin * Math.abs(p.dot(u)) / tv) - p.dot(f));
    }
    if (!(d > 0)) d = margin * half.length() / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
    return { target: c.toArray(), position: c.clone().addScaledVector(dir, d).toArray(), near: 0.01 * d, far: 100 * d, diagonal: half.length() * 2 };
  }
  function goHome() {
    if (!framed) return;
    camera.near = framed.near; camera.far = framed.far; camera.updateProjectionMatrix();
    camera.position.fromArray(framed.position); controls.target.fromArray(framed.target); controls.update(); request();
  }

  async function load(side, buf, { frame: doFrame = false } = {}) {
    const s = sides[side], t0 = performance.now();
    const gltf = await new Promise((ok, no) => loader.parse(buf.slice ? buf.slice(0) : buf, '', ok, (e) => no(e && e.message ? e : new Error(String(e)))));
    if (s.root) { s.scene.remove(s.root); disposeRoot(s.root); s.root = null; }
    s.root = gltf.scene; s.scene.add(s.root);
    s.info = { ...describe(s.root, gltf), parseMs: Math.round(performance.now() - t0) };
    if (doFrame || !framed) { framed = frameCamera(s.root); goHome(); }
    const light = applyLighting();
    request();
    if (mode === 'diff') scheduleMeasure();
    return { ...s.info, light, diagonal: framed && framed.diagonal };
  }
  function clear(side) { const s = sides[side]; if (s.root) { s.scene.remove(s.root); disposeRoot(s.root); s.root = null; s.info = null; request(); } }

  return {
    adapter, halfFloat: halfOK, revision: REVISION, canvas, controls,
    load, clear, measure, resetView: goHome,
    setMode(m) { mode = m; request(); if (m === 'diff') scheduleMeasure(); else { lastDiff = null; } },
    setGain(g) { gain = g; request(); if (mode === 'diff') scheduleMeasure(); },
    setSplit(v) { split = Math.min(0.98, Math.max(0.02, v)); place(); request(); },
    setFill(on) { fillOn = on; const l = applyLighting(); request(); if (mode === 'diff') scheduleMeasure(); return l; },
    setTouchOrbit(on) { canvas.style.touchAction = on ? 'none' : 'pan-y'; },
    request, get counts() { return lastCounts; }, get diff() { return lastDiff; }, get bgBytes() { return bgBytes; },
    info: (side) => sides[side].info,
    dispose() { disposed = true; ro.disconnect(); controls.dispose(); renderer.dispose(); },
  };
}
