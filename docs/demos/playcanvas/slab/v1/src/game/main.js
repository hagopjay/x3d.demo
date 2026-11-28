// SLAB: the game. The mountain, the skier and the snowpack's saved states are X3D; PlayCanvas draws them; the snow
// is the MLS-MPM solver of src/sim/mpm.js running a 2D slice under the chosen line (CPU float64 reference); the
// WebGL2 port is checked against it live in the INTEGRITY panel.
import * as pc from '../../vendor/playcanvas.min.mjs';
import { fromX3D } from '../sim/level.js';
import { Run, SETTLE } from '../sim/run.js';
import { skierIndex } from '../sim/referee.js';
import { snapshotX3D, resumeX3D } from '../x3d/snapshot.js';
import { el, fmt } from '../x3d/x3dxml.js';
import { loadX3D, elevationMesh } from './x3d-pc.js';
import { GpuMpm } from '../gpu/mpm-gl.js';
import { disc } from '../sim/cases.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.start();

const SKY = { clear: { sky: [0.5, 0.68, 0.9], fog: [0.8, 0.86, 0.94], sun: 1.8, amb: 0.5 }, wind: { sky: [0.6, 0.66, 0.74], fog: [0.76, 0.79, 0.83], sun: 1.3, amb: 0.55 },
  dawn: { sky: [0.93, 0.6, 0.47], fog: [0.88, 0.74, 0.68], sun: 1.2, amb: 0.45 } };
const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.68, 0.9), farClip: 600, nearClip: 0.1, fov: 45 });
camera.camera.toneMapping = pc.TONEMAP_ACES; camera.camera.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);
const sun = new pc.Entity('sun');
sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.97, 0.92), intensity: 1.8, castShadows: true, shadowDistance: 60, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.05 });
sun.setEulerAngles(-50, -35, 0);
app.root.addChild(sun);

const G = { k: Number(Q.get('level') || 1), level: null, line: Number(Q.get('line') ?? 1), runs: [null, null], view: null, overlay: false, cam: Number(Q.get('cam') || 0),
  predict: null, score: 0, budget: Number(Q.get('budget') || 22), msPerStep: 1, ratio: 0, tune: {}, mode: 'loading', logSeen: 0, ents: [], scored: false, audio: null };
window.__slab = G;
let skierText = '', limits = null, skierModel = null;

// ---------------------------------------------------------------- level
async function loadLevel(k) {
  G.mode = 'loading'; $('loading').style.display = 'grid';
  const text = await (await fetch(`levels/level${k}.x3d`)).text();
  const L = fromX3D(text);
  G.k = k; G.level = L; G.runs = [null, null]; G.view = null; G.predict = null; G.scored = false; G.logSeen = 0;
  for (const e of G.ents) e.destroy();
  G.ents = [];
  const sky = SKY[L.sky] || SKY.clear;
  camera.camera.clearColor = new pc.Color(...sky.sky);
  app.scene.ambientLight = new pc.Color(sky.amb, sky.amb * 1.02, sky.amb * 1.08);
  app.scene.fog.type = pc.FOG_LINEAR; app.scene.fog.color = new pc.Color(...sky.fog); app.scene.fog.start = 40; app.scene.fog.end = 240;
  sun.light.intensity = sky.sun;
  // the mountain: the level's ElevationGrid, read by the same parser the solver used for its terrain
  const g = L.grid, colors = new Uint8Array(g.nxg * g.nzg * 4);
  for (let j = 0; j < g.nzg; j++) for (let i = 0; i < g.nxg; i++) {
    const n = i + j * g.nxg, z = -L.zw / 2 + j * g.sz, edge = Math.min(1, Math.abs(z) / (L.zw / 2));
    colors.set([236 - 30 * edge * edge, 241 - 26 * edge * edge, 250 - 14 * edge * edge, 255], n * 4);
  }
  const terrain = new pc.Entity('terrain');
  const tm = new pc.StandardMaterial(); tm.diffuse = new pc.Color(1, 1, 1); tm.diffuseVertexColor = true; tm.gloss = 0.35; tm.useMetalness = true; tm.metalness = 0; tm.update();
  terrain.addComponent('render', { meshInstances: [new pc.MeshInstance(elevationMesh(app.graphicsDevice, { nx: g.nxg, nz: g.nzg, dx: g.sx, dz: g.sz, heights: g.heights }, colors), tm)], receiveShadows: true });
  terrain.setPosition(0, -0.02, -L.zw / 2);
  app.root.addChild(terrain); G.ents.push(terrain);
  // two flags at the top of each line, and a wider apron of mountain around the strip
  for (const [li, col] of [[0, [0.2, 0.85, 0.5]], [1, [0.95, 0.25, 0.2]]]) {
    const f = box([0.06, 1.6, 0.06], [0.2, 0.2, 0.2]); f.setPosition(1.5, L.height(1.5, L.lines[li].z) + 0.8, L.lines[li].z); app.root.addChild(f); G.ents.push(f);
    const flag = box([0.5, 0.32, 0.02], col, true); flag.setPosition(1.78, L.height(1.5, L.lines[li].z) + 1.42, L.lines[li].z); app.root.addChild(flag); G.ents.push(flag);
  }
  // a snowfield and distant ridges around the level strip, so it does not float in the sky
  let hmin = Infinity; for (const v of g.heights) hmin = Math.min(hmin, v);
  const field = box([600, 1, 600], [0.9, 0.93, 0.97], false, false); field.setPosition(L.span / 2, hmin - 0.6, 0); app.root.addChild(field); G.ents.push(field);
  for (const [x, z, w, hgt] of [[-30, -70, 90, 46], [40, -95, 120, 62], [110, -60, 80, 38], [-60, 40, 70, 30]]) {
    const m = box([w, hgt, 30], [0.84, 0.87, 0.93], false, false); m.setPosition(x, hmin + hgt / 2 - 8, z); m.setEulerAngles(0, 25, 0); app.root.addChild(m); G.ents.push(m);
  }
  if (!skierModel) skierModel = loadX3D(app, skierText);
  if (!skierModel.root.parent) app.root.addChild(skierModel.root);
  skierModel.root.enabled = false;
  $('lvl').innerHTML = `<h3>LEVEL ${k} OF 3</h3><b style="font-size:16px">${L.name}</b><div class="tag">${L.tagline}</div>`;
  buildTinker();
  $('loading').style.display = 'none';
  G.mode = 'settling';
  say(`settling the ${L.lines[G.line].name} snowpack…`);
}

function box(size, col, unlit = false, shadows = true) {
  const e = new pc.Entity(), m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...col); if (unlit) { m.emissive = new pc.Color(...col); m.useLighting = false; } m.update();
  e.addComponent('render', { type: 'box', material: m, castShadows: shadows, receiveShadows: shadows }); e.setLocalScale(...size); return e;
}

// ---------------------------------------------------------------- runs and their meshes
function run() {
  if (G.view) return G.view;
  if (!G.runs[G.line]) {
    const r = new Run(G.level, { line: G.line, mode: 'idle', tune: G.tune, speed: G.tune['skier.speed'] ?? 6, chargeDv: G.tune['charge.dv'] ?? 4, airbagR: G.tune['airbag.r'] ?? 0.55 });
    r.mesh = snowMesh(r.sim, G.level.lines[G.line].z);
    G.runs[G.line] = r;
  }
  return G.runs[G.line];
}

function snowMesh(sim, z) {
  const n = sim.n, dev = app.graphicsDevice;
  const pos = new Float32Array(n * 12), col = new Uint8Array(n * 16), idx = new Uint32Array(n * 6);
  for (let p = 0; p < n; p++) { const v = p * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], p * 6); }
  const mesh = new pc.Mesh(dev); mesh.setPositions(pos); mesh.setColors32(col); mesh.setIndices(idx); mesh.update(pc.PRIMITIVE_TRIANGLES);
  const m = new pc.StandardMaterial(); m.useLighting = false; m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 1, 1); m.emissiveVertexColor = true; m.cull = pc.CULLFACE_NONE; m.update();
  const e = new pc.Entity('snow'); e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, m)] }); app.root.addChild(e);
  // the top surface: a 3 m wide strip following the highest particles
  const NB = Math.ceil((sim.nx * sim.dx) / 0.2) + 1, spos = new Float32Array(NB * 2 * 3), snor = new Float32Array(NB * 2 * 3), sidx = [];
  for (let b = 0; b < NB - 1; b++) { const v = b * 2; sidx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  for (let i = 0; i < NB * 2; i++) snor[i * 3 + 1] = 1;
  const sm = new pc.Mesh(dev); sm.setPositions(spos); sm.setNormals(snor); sm.setIndices(sidx); sm.update(pc.PRIMITIVE_TRIANGLES);
  const smat = new pc.StandardMaterial(); smat.diffuse = new pc.Color(0.97, 0.98, 1); smat.gloss = 0.45; smat.useMetalness = true; smat.metalness = 0; smat.cull = pc.CULLFACE_NONE; smat.update();
  const se = new pc.Entity('snow-top'); se.addComponent('render', { meshInstances: [new pc.MeshInstance(sm, smat)], castShadows: true }); app.root.addChild(se);
  G.ents.push(e, se);
  return { mesh, pos, col, e, sm, spos, se, NB, z };
}

const C_SLAB = [244, 248, 255], C_WEAK = [140, 158, 196], C_BED = [96, 104, 122];
function drawSnow(r) {
  const S = r.sim, M = r.mesh, meta = S.meta || { marginX: 0, y0: 0, groundAt: () => 0 };
  const ox = -meta.marginX, oy = -meta.y0, z = M.z + 1.5, h = S.dx * 0.34;
  const { pos, col } = M, top = new Float32Array(M.NB).fill(-1e9);
  for (let p = 0; p < S.n; p++) {
    const x = S.x[p] + ox, y = S.y[p] + oy, v = p * 12;
    pos[v] = x - h; pos[v + 1] = y - h; pos[v + 2] = z; pos[v + 3] = x + h; pos[v + 4] = y - h; pos[v + 5] = z;
    pos[v + 6] = x + h; pos[v + 7] = y + h; pos[v + 8] = z; pos[v + 9] = x - h; pos[v + 10] = y + h; pos[v + 11] = z;
    let c;
    const bed = S.mat[p] === 1 && S.y[p] < meta.groundAt(S.x[p]);
    if (G.overlay && S.mat[p] === 1 && !bed) { const u = Math.min(1.2, S.utilization(p)) / 1.2; c = [255 * Math.min(1, 2 * u), 255 * Math.min(1, 2 * (1 - u)), 60]; }
    else {
      c = S.mat[p] === 0 ? C_SLAB : bed ? C_BED : C_WEAK;
      const d = Math.min(1, S.mat[p] === 0 ? Math.max(0, S.dmg[p] - 0.02) * 8 : S.dmg[p] * 20);
      if (d > 0.05) c = [c[0] * (1 - d) + 255 * d, c[1] * (1 - d) + 92 * d, c[2] * (1 - d) + 70 * d];
      if (G.overlay && S.mat[p] === 0) { const sp = Math.min(1, Math.hypot(S.vx[p], S.vy[p]) / 3); c = [c[0], c[1] * (1 - sp * 0.5), c[2] * (1 - sp)]; }
    }
    for (let q = 0; q < 4; q++) col.set([c[0], c[1], c[2], 255], p * 16 + q * 4);
    const b = Math.floor(S.x[p] / 0.2);
    if (b >= 0 && b < M.NB && S.mat[p] === 0 && y > top[b]) top[b] = y;
  }
  M.mesh.setPositions(pos); M.mesh.setColors32(col); M.mesh.update(pc.PRIMITIVE_TRIANGLES);
  for (let b = 0; b < M.NB; b++) {
    const x = b * 0.2 + ox, y = top[b] > -1e8 ? top[b] + h : meta.groundAt(b * 0.2) + oy + 0.02;
    M.spos.set([x, y, M.z - 1.5, x, y, M.z + 1.5], b * 6);
  }
  M.sm.setPositions(M.spos); M.sm.update(pc.PRIMITIVE_TRIANGLES);
}

// ---------------------------------------------------------------- actions
function ski() {
  const r = run(); if (r.viewer || G.mode !== 'ready' || r.skier.state === 'skiing' || r.skier.state === 'caught') return;
  const S = r.sim;
  Object.assign(r.skier, { x: S.meta.snowX[0] + 0.5, state: 'waiting', start: S.t + 0.3 });
  r.o.speed = G.tune['skier.speed'] ?? 6; r.o.airbag = false; S.body = null; G.scored = false;
  skierModel.root.enabled = true; setAirbag(false);
  say(`dropping into the ${G.level.lines[G.line].name}…`); audio('swish');
}
function charge() {
  const r = run(); if (r.viewer || G.mode !== 'ready' || (r.charge && !r.charge.done)) return;
  r.charge = { x: r.sim.meta.pitchX[0], at: r.sim.t + 0.2, done: false };
  r.o.chargeDv = G.tune['charge.dv'] ?? 4;
  say('patrol: charge placed at the top of the pitch. Fire in the hole!', 'hot');
}
function airbag() { const r = run(); if (r.skier && r.skier.state === 'caught' && !r.o.airbag) { r.o.airbag = true; setAirbag(true); say('AIRBAG!', 'ok'); } }
function setAirbag(on) { const sw = skierModel.defs.Airbag; if (sw && sw.children[0]) sw.children[0].enabled = on; }

function pit() {
  const L = G.level, line = L.lines[G.line], lay = [L.weak, { ...L.slab, h: G.tune['slab.h'] ?? L.slab.h }], c = G.tune['weak.c'] ?? L.weak.c;
  const k = skierIndex({ layersAbove: lay, D: lay[0].h + lay[1].h, theta: line.theta, c, phi: L.weak.phi });
  const hard = (rho) => (rho < 150 ? 'F' : rho < 230 ? '4F' : rho < 300 ? '1F' : 'P');
  const test = k.index < 1 ? '<b class="hot">ECTP 11</b> · the crack runs' : k.index < 1.5 ? '<b class="warn">ECTN 21</b> · breaks, does not run' : '<b class="ok">ECTX</b> · no break';
  $('pit').style.display = 'block';
  $('pit').innerHTML = `<h3>PIT · ${line.name.toUpperCase()} · ${line.theta}° PITCH</h3><table>
    <tr><td>slab</td><td class="r">${lay[1].h.toFixed(2)} m</td><td class="r">${lay[1].rho} kg/m³</td><td class="r">${hard(lay[1].rho)}</td><td>rounds</td></tr>
    <tr><td>weak layer</td><td class="r">${lay[0].h.toFixed(2)} m</td><td class="r">${lay[0].rho} kg/m³</td><td class="r">${hard(lay[0].rho)}</td><td>surface hoar</td></tr>
    <tr><td>bed</td><td colspan="4" style="color:var(--dim)">old, hard, bonded to the ground</td></tr></table>
    <div style="margin-top:6px">compression test: ${test}</div>
    <div style="color:var(--dim);margin-top:4px">the test is the game's reading of the Föhn-style index below, not a field measurement</div>
    <div style="margin-top:6px">index alone <b>${k.natural.toFixed(2)}</b> · with a skier <b class="${k.index < 1 ? 'hot' : k.index < 1.5 ? 'warn' : 'ok'}">${k.index.toFixed(2)}</b> (&lt; 1 fails)</div>
    <div style="margin-top:6px">now predict: will it release? <b>Y</b> / <b>N</b></div>`;
  G.pitIndex = k;
}

function snapshot() {
  const r = run(), S = r.sim, meta = S.meta || { marginX: 0, y0: 0 }, sk = r.skier || {};
  const extra = sk.state && sk.state !== 'none' ? [el('Transform', { DEF: 'SkierAt', translation: `${fmt(+(sk.x - meta.marginX).toFixed(3))} ${fmt(+(sk.y - meta.y0).toFixed(3))} 0` },
    el('Shape', {}, el('Appearance', {}, el('PhysicalMaterial', { baseColor: '0.95 0.78 0.1' })), el('Sphere', { radius: String(S.body ? S.body.r : 0.3) })))] : [];
  const text = snapshotX3D(S, { title: `SLAB ${G.k} ${G.level.name}, ${G.level.lines[G.line].name}, t ${S.t.toFixed(2)} s`, extra });
  G.lastSnapshot = { bytes: text.length, t: S.t, hash: S.hash() };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'model/x3d+xml' }));
  a.download = `slab-L${G.k}-${G.level.lines[G.line].name.toLowerCase()}-t${S.t.toFixed(2)}.x3d`; a.click();
  say(`saved the snowpack as X3D (${(text.length / 1e6).toFixed(1)} MB): it resumes bit-exactly, and any X3D browser shows it`, 'ok');
}
async function resumeFile(file) {
  const text = await file.text();
  try {
    const sim = resumeX3D(text), base = run();
    sim.meta = base.sim.meta && base.sim.nx === sim.nx ? base.sim.meta : { marginX: 0, y0: 0, groundAt: () => -1e9 };
    const v = { viewer: true, sim, skier: { state: 'none' }, events: [{ t: sim.t, what: `resumed ${file.name} at t ${sim.t.toFixed(2)} s, hash ${sim.hash()}` }], advance(n) { for (let i = 0; i < n; i++) sim.step(); } };
    v.mesh = snowMesh(sim, G.level.lines[G.line].z);
    G.view = v; G.logSeen = 0; say(`resumed ${file.name}: ${sim.n} particles at t ${sim.t.toFixed(2)} s`, 'ok');
  } catch (e) { say('not a SLAB snapshot: ' + e.message, 'hot'); }
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) resumeFile(e.dataTransfer.files[0]); });

function reset(keepLevel = true) { for (const r of G.runs) if (r) { r.mesh.e.destroy(); r.mesh.se.destroy(); } if (G.view) { G.view.mesh.e.destroy(); G.view.mesh.se.destroy(); } G.runs = [null, null]; G.view = null; G.mode = 'settling'; G.scored = false; G.predict = null; $('pit').style.display = 'none'; skierModel.root.enabled = false; if (!keepLevel) loadLevel(G.k); }

window.addEventListener('keydown', (e) => {
  audioInit();
  const k = e.key.toLowerCase();
  if (k === '1' || k === '2') { G.line = k === '1' ? 0 : 1; G.view = null; $('pit').style.display = 'none'; if (!G.runs[G.line]) G.mode = 'settling'; }
  else if (k === 'enter') ski(); else if (k === 'c') charge(); else if (k === 'a') airbag(); else if (k === 'p') pit();
  else if (k === 'y' || k === 'n') { G.predict = k === 'y'; say(`you predict: it ${G.predict ? 'WILL' : 'will NOT'} release`); }
  else if (k === 's') G.overlay = !G.overlay; else if (k === 'v') G.cam = (G.cam + 1) % 4; else if (k === 't') { const t = $('tink'); t.style.display = t.style.display === 'block' ? 'none' : 'block'; }
  else if (k === 'r') reset(); else if (k === 'l') { reset(); loadLevel((G.k % 3) + 1); } else if (k === 'f9') { e.preventDefault(); snapshot(); }
  else if (k === 'b') integrity(true);
});

function buildTinker() {
  const box = $('tinkl'); box.innerHTML = '';
  for (const t of G.level.tunables) {
    const f = t.field, [lo, hi, st] = t.range;
    const cur = G.tune[f] ?? { 'slab.h': G.level.slab.h, 'weak.c': G.level.weak.c, 'charge.dv': 4, 'skier.speed': 6, 'airbag.r': 0.55 }[f];
    const lab = document.createElement('label'); lab.innerHTML = `${t.label}: <b>${cur}</b> ${t.unit}`;
    const inp = document.createElement('input'); Object.assign(inp, { type: 'range', min: lo, max: hi, step: st, value: cur });
    inp.oninput = () => { G.tune[f] = Number(inp.value); lab.innerHTML = `${t.label}: <b>${inp.value}</b> ${t.unit}`; };
    box.append(lab, inp);
  }
}

// ---------------------------------------------------------------- audio
function audioInit() { if (G.audio) return; try { G.audio = new AudioContext(); } catch { G.audio = null; } }
function audio(kind) {
  const A = G.audio; if (!A) return;
  const dur = kind === 'whumpf' ? 0.9 : kind === 'boom' ? 1.4 : 0.4, n = Math.floor(A.sampleRate * dur), buf = A.createBuffer(1, n, A.sampleRate), d = buf.getChannelData(0);
  let s = 12345; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647 * 2 - 1) * Math.exp(-i / (n * (kind === 'swish' ? 0.3 : 0.25))); }
  const src = A.createBufferSource(); src.buffer = buf;
  const f = A.createBiquadFilter(); f.type = kind === 'swish' ? 'highpass' : 'lowpass'; f.frequency.value = { whumpf: 90, boom: 260, swish: 2500 }[kind];
  const g = A.createGain(); g.gain.value = kind === 'swish' ? 0.15 : 0.9;
  src.connect(f).connect(g).connect(A.destination); src.start();
}

// ---------------------------------------------------------------- integrity: the WebGL2 port against the CPU reference, live
function integrity(twin = false) {
  const out = $('integl');
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const steps = 100, cpu = disc({ gravity: [0, -9.81], floor: true }), gpu = new GpuMpm(gl, disc({ gravity: [0, -9.81], floor: true, twin: twin ? 'pic' : null }));
    gpu.step(steps); for (let i = 0; i < steps; i++) cpu.step();
    const a = gpu.read(0); let dx = 0, dv = 0;
    for (let p = 0; p < cpu.n; p++) { dx = Math.max(dx, Math.abs(a[p * 4] - cpu.x[p]), Math.abs(a[p * 4 + 1] - cpu.y[p])); dv = Math.max(dv, Math.abs(a[p * 4 + 2] - cpu.vx[p]), Math.abs(a[p * 4 + 3] - cpu.vy[p])); }
    const lim = limits.gates.gpu_vs_cpu, ok = dx <= lim.max_dx_m && dv <= lim.max_dv_mps;
    G.integrity = { ok, dx, dv, renderer, twin };
    out.innerHTML = `<span class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</span> ${twin ? '· <b class="hot">PIC TWIN (B)</b> ' : ''}· ${cpu.n} particles, ${steps} steps<br>max |Δx| ${dx.toExponential(1)} m (≤ ${lim.max_dx_m}) · max |Δv| ${dv.toExponential(1)} m/s (≤ ${lim.max_dv_mps})<br><span style="color:var(--dim)">${renderer}</span><div id="solver"></div>`;
  } catch (e) { G.integrity = { ok: false, error: String(e) }; out.innerHTML = `<span class="fail">GPU path unavailable</span>: ${e.message}<div id="solver"></div>`; }
}

// ---------------------------------------------------------------- frame loop
function say(t, cls = '') { $('msg').textContent = t; $('msg').className = 'p ' + cls; }
let hudT = 0;
app.on('update', (dtReal) => {
  if (G.mode === 'loading' || !G.level) return;
  const r = run(), S = r.sim;
  // step the solver within a time budget per frame
  const t0 = performance.now(), simT0 = S.t;
  const target = G.mode === 'settling' ? 400 : Math.max(1, Math.floor(G.budget / G.msPerStep));
  let n = 0;
  while (n < target && performance.now() - t0 < (G.mode === 'settling' ? 60 : G.budget)) { r.advance(4); n += 4; }
  const ms = performance.now() - t0; if (n) G.msPerStep = 0.9 * G.msPerStep + 0.1 * (ms / n);
  G.ratio = 0.95 * G.ratio + 0.05 * ((S.t - simT0) / Math.max(dtReal, 1e-3));
  if (G.mode === 'settling' && S.t >= SETTLE + 0.1) { G.mode = 'ready'; say(`${G.level.lines[G.line].name}: the pack has settled. Dig a pit (P), predict (Y/N), then ski (Enter) or charge it (C).`); botTick(true); }
  drawSnow(r);
  // the skier
  const meta = S.meta || { marginX: 0, y0: 0, groundAt: () => 0 }, sk = r.skier;
  if (sk && sk.state && sk.state !== 'none' && sk.state !== 'waiting' && skierModel) {
    skierModel.root.enabled = true;
    const x = sk.x - meta.marginX, y = (S.body ? S.body.y - S.body.r : sk.y) - meta.y0;
    const sl = Math.atan2(meta.groundAt(sk.x + 0.5) - meta.groundAt(sk.x - 0.5), 1);
    skierModel.root.setPosition(x, y, G.level.lines[G.line].z);
    if (sk.state === 'caught') { G.tumble = (G.tumble || 0) + dtReal * 240 * Math.min(1, Math.hypot(S.body.vx, S.body.vy)); skierModel.root.setEulerAngles(0, 0, G.tumble); }
    else skierModel.root.setEulerAngles(0, 0, (sl * 180) / Math.PI);
  }
  // events, sounds, scoring
  const ev = r.events || [];
  for (; G.logSeen < ev.length; G.logSeen++) {
    const e = ev[G.logSeen];
    if (/released/.test(e.what)) { audio('whumpf'); say('WHUMPF — the slab is running!', 'hot'); }
    if (/charge/.test(e.what)) audio('boom');
    if (/caught/.test(e.what)) say('CAUGHT! Pull the airbag (A)!', 'hot');
    $('logl').innerHTML = ev.slice(-7).map((x) => `${x.t.toFixed(2)} s · ${x.what}`).join('<br>');
  }
  if (!G.scored && G.predict != null && sk && (sk.state === 'out' || (sk.state === 'caught' && S.t > r.caughtAt + 4))) {
    G.scored = true; const right = G.predict === !!r.released; G.score += right ? 1 : 0;
    say(`${r.released ? 'It released.' : 'It held.'} Your prediction was ${right ? 'RIGHT' : 'WRONG'}. ${sk.state === 'caught' ? `Burial: ${Math.max(0, r.burial()).toFixed(2)} m.` : 'You skied out.'}`, right ? 'ok' : 'hot');
  }
  cameraTick(r, dtReal);
  botTick(false);
  if (performance.now() - hudT > 200) { hudT = performance.now(); hud(r); }
});

function cameraTick(r, dt) {
  const L = G.level, z = L.lines[G.line].z, S = r.sim, meta = S.meta || { marginX: 0, y0: 0 };
  const mx = L.top + L.pitch / 2, my = L.height(mx, z);
  let p, t;
  if (G.cam === 0) { p = [mx + 1, my + 1, z + 21]; t = [mx + 1, my - 0.5, z]; }
  else if (G.cam === 1 && r.skier && r.skier.state !== 'none' && r.skier.state !== 'waiting') { const x = r.skier.x - meta.marginX, y = r.skier.y - meta.y0; p = [x - 7, y + 4, z + 6]; t = [x + 2, y - 1, z]; }
  else if (G.cam === 3) {
    // close cross-section, like a pit wall: follows the skier, else frames the top of the pitch
    const live = r.skier && r.skier.state !== 'none' && r.skier.state !== 'waiting';
    const x = live ? r.skier.x - meta.marginX : L.top + 3, y = L.height(x, z);
    p = [x + 0.5, y + 0.6, z + 7.5]; t = [x + 0.5, y - 0.3, z + 1.5];
  }
  else { p = [-9, 9, z + 16]; t = [mx + 2, my - 3, z]; }
  const c = camera.getPosition(), far = Math.hypot(c.x - p[0], c.y - p[1], c.z - p[2]) > 25, k = far ? 1 : Math.min(1, dt * 3);
  camera.setPosition(c.x + (p[0] - c.x) * k, c.y + (p[1] - c.y) * k, c.z + (p[2] - c.z) * k);
  camera.lookAt(t[0], t[1], t[2]);
}

function hud(r) {
  const S = r.sim, L = G.level, line = L.lines[G.line];
  let local = '';
  if (r.skier && (r.skier.state === 'skiing' || r.skier.state === 'waiting') && S.meta) {
    const th = (Math.atan(Math.abs(S.meta.groundAt(r.skier.x + 0.5) - S.meta.groundAt(r.skier.x - 0.5))) * 180) / Math.PI;
    const k = skierIndex({ layersAbove: [L.weak, L.slab], D: L.weak.h + L.slab.h, theta: Math.max(0.5, th), c: L.weak.c, phi: L.weak.phi });
    local = `<div style="margin-top:6px">under your skis: ${th.toFixed(0)}° · index <b class="${k.index < 1 ? 'hot' : k.index < 1.5 ? 'warn' : 'ok'}">${k.index.toFixed(2)}</b></div><div class="bar"><i style="left:${Math.min(100, (k.index / 2) * 100)}%"></i></div>`;
  }
  const moved = r.moved && r.home ? r.moved() : 0;
  $('idx').innerHTML = `<h3>STABILITY · ${line.name.toUpperCase()} (${line.theta}°)</h3>
    <div>line <b>${G.line + 1}</b> of 2 · predicted index with a skier <b class="${line.theta > 30 ? 'hot' : 'ok'}">${(G.line ? L.index.deadly : L.index.safe).toFixed(2)}</b></div>${local}
    <div style="margin-top:6px">slab moved ≥ 0.5 m: <b class="${moved > 0.5 ? 'hot' : ''}">${(moved * 100).toFixed(0)}%</b> · skier: <b>${r.skier ? r.skier.state : '-'}</b>${r.burial && r.sim.body ? ` · burial ${Math.max(0, r.burial()).toFixed(2)} m` : ''}</div>
    <div style="color:var(--dim)">score ${G.score} · overlay ${G.overlay ? 'ON: weak layer green→red = shear / strength' : 'off (S)'}</div>`;
  const sv = $('solver');
  if (sv) sv.innerHTML = `<div style="margin-top:6px">solver: CPU float64 MLS-MPM · ${S.n} particles · grid ${S.nx}×${S.ny} · dt ${(S.dt * 1000).toFixed(1)} ms<br>t ${S.t.toFixed(2)} s · sim at <b>${G.ratio.toFixed(2)}×</b> real time · ${(1000 / Math.max(1e-3, app.stats.frame.ms || 16)).toFixed(0)} fps</div>`;
}

// ---------------------------------------------------------------- bots (?bot=naive | patrol | safe | airbag)
function botTick(ready) {
  const b = Q.get('bot'); if (!b || G.mode !== 'ready') return;
  const r = run();
  if (ready && !G.botStarted) {
    G.botStarted = true;
    if (b === 'safe') { G.line = 0; G.mode = run().sim.t >= SETTLE ? 'ready' : 'settling'; }
    pit(); G.predict = b === 'patrol'; say(`bot (${b}) predicts: ${G.predict ? 'it will release' : 'it holds'}`);
    if (b === 'patrol') charge(); else setTimeout(() => ski(), 300);
    return;
  }
  if (b === 'patrol' && r.released && !G.botSkied) {
    // like the test bot: ski once the debris has been at rest (slab mean speed < 0.2 m/s) for 1 s
    const S = r.sim; let m = 0, v = 0; for (let p = 0; p < S.n; p += 4) if (S.mat[p] === 0) { m++; v += Math.hypot(S.vx[p], S.vy[p]); }
    if (v / m < 0.2) { G.calm = G.calm ?? S.t; if (S.t - G.calm >= 1) { G.botSkied = true; ski(); } } else G.calm = null;
  }
  if (b === 'airbag' && r.skier.state === 'caught') airbag();
}

// ---------------------------------------------------------------- start
(async () => {
  [skierText, limits] = await Promise.all([fetch('assets/skier.x3d').then((r) => r.text()), fetch('tests/limits.json').then((r) => r.json())]);
  integrity(false);
  await loadLevel(G.k);
  if (Q.get('bot') === 'safe') G.line = 0;
})();
