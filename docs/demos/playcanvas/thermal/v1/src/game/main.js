// THERMAL: boot, the air (WebGL2 lattice Boltzmann, or the CPU reference where WebGL2 float targets are missing),
// the glider, keyboard, cameras, clouds, the glass sky, the INTEGRITY referee, the HUD and the results card.
import * as pc from '../../vendor/playcanvas.min.mjs';
import { fromX3D, terrainAt } from '../sim/level.js';
import { airConfig, heatColumns, sunElevation, dayLength, cloudCells, sampleFields } from '../sim/air.js';
import { createLBM } from '../sim/lbm.js';
import { createGPULBM } from '../gpu/lbm-gl.js';
import { createGlider, createSpeedHold } from '../sim/glider.js';
import { createTask, createBot, arrivalHeight } from '../sim/task.js';
import { speedToFly } from '../sim/polar.js';
import { loadX3D, elevationMesh } from './x3d-pc.js';
import { drawVario, drawTape, drawDirector } from './hud.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $('stage');
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.start();

const audio = createAudio();
const LIM = { max_du: 1e-4, max_dT: 1e-3, steps: 200 };      // tests/limits.json gpu_vs_cpu (the in-game window is 200 steps)
const S = {
  mode: 'loading', level: null, A: null, gpu: null, cpuAir: null, F: null, renderer: 'CPU reference (no WebGL2 float targets)',
  glider: null, hold: null, task: null, bot: params.get('bot'), t: 0, nextAir: 0, warp: Number(params.get('warp') || 1),
  keys: new Set(), stick: 0, bankIn: 0, trim: 0, stf: true, mc: 1.0, water: 0, raw: false, bgk: false, glass: params.get('glass') === '1',
  cam: Number(params.get('cam') || 0), integrity: { state: 'waiting', windows: 0, pass: 0, last: null }, blown: false, spin: null, lastFull: -1,
};
window.__thermal = S;

// ---- scene ----
const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.42, 0.55, 0.72), farClip: 60000, nearClip: 0.5, fov: 55 });
camera.camera.toneMapping = pc.TONEMAP_ACES;
camera.camera.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);
const sunLight = new pc.Entity('sun');
sunLight.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.86, 0.68), intensity: 1.6, castShadows: false });
app.root.addChild(sunLight);
app.scene.ambientLight = new pc.Color(0.28, 0.31, 0.38);
const W = (x, y, z) => new pc.Vec3(x, z, -y);                 // sim (x east, y north, z up) -> world (x, y up, z south)

async function text(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }
const enc = (v) => Math.round(255 * Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
function mat(color, opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...color); m.useLighting = opts.lit !== false;
  if (opts.emissive) { m.emissive = new pc.Color(...opts.emissive); }
  if (opts.opacity != null) { m.opacity = opts.opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
  m.cull = pc.CULLFACE_NONE; m.update(); return m;
}

let levelText = null, worker = null, cloudPool = [], glass = null, gliderEnt = null, marker = null;

async function boot() {
  levelText = await text('levels/ridge-day.x3d');
  const level = fromX3D(levelText);
  S.level = level;
  $('tagline').textContent = level.tagline;
  $('taskinfo').innerHTML = level.task.turnpoints.map((t) => t.name).join(' → ') + '<br>' + level.wind.U + ' m/s W · N ' + level.air.N + ' s⁻¹';
  $('lvl').innerHTML = `level <b>1</b> · ${level.name}`;
  buildWorld(level);
  const gx = loadX3D(app, await text('assets/glider.x3d'));
  gliderEnt = new pc.Entity('glider'); gliderEnt.addChild(gx.root); app.root.addChild(gliderEnt);
  // a marker so the glider can be found in the side view (shown only there)
  marker = new pc.Entity('marker'); marker.addComponent('render', { type: 'sphere', material: mat([1, 0.24, 0.5], { lit: false, emissive: [1, 0.24, 0.5] }) });
  marker.setLocalScale(22, 22, 22); app.root.addChild(marker);
  // the air
  S.A = airConfig(level, {});
  const init = createLBM(S.A.cfg);
  try {
    if (params.get('cpu')) throw new Error('CPU requested');
    S.gpu = createGPULBM(S.A.cfg, init);
    S.renderer = S.gpu.renderer;
    S.F = { solid: S.A.cfg.solid, ...S.gpu.readMacro() };
  } catch (e) {
    console.warn('WebGL2 air unavailable, using the CPU reference:', e.message);
    S.gpu = null; S.cpuAir = init; S.F = init;
  }
  // spin the air up before launch
  const spin = Number(params.get('spin') || 1200);
  let done = 0;
  await new Promise((res) => {
    const tick = () => {
      const k = Math.min(40, spin - done);
      for (let s = 0; s < k; s++) airStep();
      done += k;
      $('loading').textContent = `SPINNING UP THE AIR · ${done} / ${spin} STEPS · ${Math.round((done * S.A.units.dt) / 60)} MIN OF WIND`;
      if (done >= spin) res(); else setTimeout(tick, 0);
    };
    tick();
  });
  readFull();
  if (S.gpu) S.spin = S.gpu.readState();
  // the INTEGRITY referee
  if (S.gpu) {
    worker = new Worker(new URL('./integrity-worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'level', text: levelText });
    worker.onmessage = onIntegrity;
  }
  $('loading').style.display = 'none';
  menu();
  S.mode = 'menu';
  if (params.get('play') || S.bot) launch();
}

function buildWorld(level) {
  const eg = level.elevationGrid, n = eg.nx * eg.nz, cols = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) { for (let c = 0; c < 3; c++) cols[k * 4 + c] = enc(level.colors[k * 3 + c]); cols[k * 4 + 3] = 255; }
  const mesh = elevationMesh(app.graphicsDevice, { nx: eg.nx, nz: eg.nz, dx: eg.dx, dz: eg.dz, heights: eg.heights }, cols);
  const tm = new pc.StandardMaterial(); tm.diffuseVertexColor = true; tm.diffuse = new pc.Color(1, 1, 1); tm.gloss = 0.1; tm.update();
  const terrain = new pc.Entity('terrain');
  terrain.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, tm)] });
  terrain.setLocalPosition(level.grid.dx / 2, 0, -((eg.nz - 1) * eg.dz) / 2);
  app.root.addChild(terrain);
  // turnpoint cylinders and the airfield strip
  for (const tp of level.task.turnpoints) {
    const e = new pc.Entity(tp.name);
    e.addComponent('render', { type: 'cylinder', material: mat(tp.finish ? [0.2, 1, 0.6] : [1, 0.78, 0.3], { opacity: 0.13, emissive: tp.finish ? [0.05, 0.3, 0.15] : [0.35, 0.25, 0.05] }) });
    e.setLocalScale(2 * tp.r, 1600, 2 * tp.r);
    e.setPosition(W(tp.x, tp.y, terrainAt(level, tp.x) + 800));
    app.root.addChild(e);
  }
  const strip = new pc.Entity('strip');
  strip.addComponent('render', { type: 'box', material: mat([0.5, 0.48, 0.42]) });
  strip.setLocalScale(700, 1, 40); strip.setPosition(W(3500, 0, terrainAt(level, 3500) + 0.6));
  app.root.addChild(strip);
  // clouds: a pool of soft puffs
  const cm = mat([1, 1, 1], { opacity: 0.55, emissive: [0.55, 0.55, 0.58] });
  for (let k = 0; k < 320; k++) {
    const e = new pc.Entity('cloud' + k); e.addComponent('render', { type: 'sphere', material: cm, castShadows: false }); e.enabled = false;
    app.root.addChild(e); cloudPool.push(e);
  }
  // the glass sky: the simulated vertical wind on a vertical plane through the glider
  const g = level.grid;
  const tex = new pc.Texture(app.graphicsDevice, { width: g.nx, height: g.ny, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  const gm = new pc.StandardMaterial();
  gm.useLighting = false; gm.diffuse = new pc.Color(0, 0, 0); gm.emissive = new pc.Color(1, 1, 1); gm.emissiveMap = tex;
  gm.opacityMap = tex; gm.opacityMapChannel = 'a'; gm.blendType = pc.BLEND_NORMAL; gm.depthWrite = false; gm.cull = pc.CULLFACE_NONE; gm.update();
  const plane = new pc.Entity('glass');
  plane.addComponent('render', { type: 'plane', material: gm, castShadows: false });
  plane.setLocalScale(g.nx * g.dx, 1, g.ny * g.dx);
  plane.setLocalEulerAngles(90, 0, 0);
  plane.enabled = S.glass;
  app.root.addChild(plane);
  glass = { tex, plane };
}

function menu() {
  document.body.className = 'menu';
  $('menu').classList.add('show'); $('result').classList.remove('show');
  for (const c of document.querySelectorAll('#water .chip')) c.onclick = () => { S.water = Number(c.dataset.w); document.querySelectorAll('#water .chip').forEach((d) => d.classList.toggle('sel', d === c)); };
  $('go').onclick = launch; $('res-retry').onclick = launch; $('res-menu').onclick = menu;
}

function launch() {
  const L = S.level, s = L.task.start;
  const wind = (x, z) => { const r = sampleFields(L, S.A.units, S.F, x, z); return Number.isFinite(r.u + r.w) ? r : { u: 0, w: 0, theta: 0 }; };
  S.glider = createGlider({ x: s.x, y: s.y, z: s.z, speed: s.speed / 3.6, heading: Math.PI / 2 + 0.4, water: S.water, wind });
  S.hold = createSpeedHold(S.glider, { target: s.speed / 3.6 });
  S.task = createTask(L);
  S.airLike = { sample: wind };
  S.botObj = S.bot ? createBot(S.bot === 'naive' ? 'naive' : 'mc', L, S.airLike, S.glider, S.task) : null;
  S.t = 0; S.nextAir = S.A.units.dt; S.stick = 0; S.bankIn = 0; S.stf = true;
  S.mode = 'playing';
  document.body.className = 'playing' + (S.glass ? ' glass' : '');
  $('menu').classList.remove('show'); $('result').classList.remove('show');
  toast(S.bot ? `BOT: ${S.bot === 'naive' ? 'NAIVE · 190 KM/H ALWAYS' : 'MACCREADY'}` : 'RELEASED · 110 KM/H · RUN THE RIDGE NORTH');
}

// ---- the air ----
function airStep() {
  if (S.gpu) S.gpu.step(); else S.cpuAir.step();
  const st = S.gpu ? S.gpu.t : S.cpuAir.t;
  if (S.integrity.pending && st === S.integrity.pending.target) S.integrity.pending.gpu = S.gpu.readMacro();
}
function airT() { return S.gpu ? S.gpu.t : S.cpuAir.t; }
function readFull() {
  if (!S.gpu) return;
  const m = S.gpu.readMacro(); S.F.ux = m.ux; S.F.uy = m.uy; S.F.T = m.T; S.F.nut = m.nut;
  let bad = false; for (let c = 0; c < m.ux.length; c += 7) if (!Number.isFinite(m.ux[c])) { bad = true; break; }
  if (bad && !S.blown) { S.blown = true; toast('THE AIR BLEW UP · PLAIN BGK AT τ = 0.5003 · R TO RESET', 6); }
}
/** Refresh the cells around the glider from the GPU (every frame). */
function readNear() {
  if (!S.gpu || !S.glider) return;
  const g = S.level.grid, i0 = Math.max(0, Math.floor(S.glider.st.x / g.dx) - 8), j0 = Math.max(0, Math.floor((S.glider.st.z - g.zBottom) / g.dx) - 6);
  const w = Math.min(16, g.nx - i0), h = Math.min(12, g.ny - j0);
  const r = S.gpu.readWindow(i0, j0, w, h);
  for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) { const c = i0 + a + (j0 + b) * g.nx, k = a + b * w; S.F.ux[c] = r.ux[k]; S.F.uy[c] = r.uy[k]; S.F.T[c] = r.T[k]; }
}
function setSun(el) {
  const h = heatColumns(S.level, el), heat = S.A.cfg.heat, nx = S.level.grid.nx;
  for (let i = 0; i < nx; i++) heat[i + S.A.ground[i] * nx] = h[i];
  if (S.gpu) S.gpu.setHeat(heat);
}
function startIntegrity() {
  if (!worker || S.integrity.pending || S.blown) return;
  setSun(sunElevation(S.level, S.t));
  const st = S.gpu.readState(), S0 = S.gpu.t;
  S.integrity.pending = { id: S0, target: S0 + LIM.steps, gpu: null, cpu: null };
  worker.postMessage({ type: 'window', id: S0, steps: LIM.steps, heat: S.A.cfg.heat, bgk: S.bgk, ...st });
  S.integrity.state = 'running';
}
function onIntegrity(e) { if (S.integrity.pending && e.data.id === S.integrity.pending.id) { S.integrity.pending.cpu = e.data; S.integrity.pending.cpuMs = e.data.ms; } }
function finishIntegrity() {
  const P = S.integrity.pending; if (!P || !P.gpu || !P.cpu) return;
  const solid = S.A.cfg.solid; let du = 0, dT = 0, nan = false;
  for (let c = 0; c < solid.length; c++) {
    if (solid[c]) continue;
    const a = Math.max(Math.abs(P.gpu.ux[c] - P.cpu.ux[c]), Math.abs(P.gpu.uy[c] - P.cpu.uy[c])), b = Math.abs(P.gpu.T[c] - P.cpu.T[c]);
    if (!Number.isFinite(a + b)) nan = true; if (a > du) du = a; if (b > dT) dT = b;
  }
  const pass = !nan && du <= LIM.max_du && dT <= LIM.max_dT;
  S.integrity.windows++; if (pass) S.integrity.pass++;
  S.integrity.last = { from: P.id, to: P.target, du, dT, nan, pass, cpuMs: P.cpuMs };
  S.integrity.state = pass ? 'pass' : 'fail';
  S.integrity.pending = null;
}

// ---- input ----
window.addEventListener('keydown', (e) => {
  audio.start();
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
  if (S.mode !== 'playing') { if (k === 'enter') launch(); return; }
  if (k === ' ') { S.stf = !S.stf; if (!S.stf) S.trim = S.glider.ctl.de; toast(S.stf ? 'SPEED-TO-FLY HOLD' : 'HAND FLYING · Q/E TRIM'); e.preventDefault(); }
  if (k === '[') S.mc = Math.max(0, S.mc - 0.5);
  if (k === ']') S.mc = Math.min(5, S.mc + 0.5);
  if (k === 'f') S.glider.ctl.flap = e.shiftKey ? Math.max(-2, S.glider.ctl.flap - 1) : (S.glider.ctl.flap >= 2 ? -2 : S.glider.ctl.flap + 1);
  if (k === 'b') S.glider.ctl.brake = S.glider.ctl.brake > 0 ? 0 : 1;
  if (k === 'j') { S.glider.ctl.dump = !S.glider.ctl.dump; toast(S.glider.ctl.dump ? 'DUMPING WATER' : 'DUMP CLOSED'); }
  if (k === 't') { S.warp = S.warp >= 8 ? 1 : S.warp * 2; }
  if (k === 'c') S.cam = (S.cam + 1) % 3;
  if (k === 'g') { S.glass = !S.glass; glass.plane.enabled = S.glass; document.body.classList.toggle('glass', S.glass); }
  if (k === 'v') { S.raw = !S.raw; toast(S.raw ? 'WRONG TWIN: UNCOMPENSATED VARIO · PULL UP AND WATCH IT LIE' : 'TE VARIO'); }
  if (k === 'k') setBGK(!S.bgk);
  if (k === 'r') resetAir();
  if (k === 'm') toast(audio.toggle() ? 'SOUND ON' : 'SOUND OFF');
});
window.addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
function setBGK(on) {
  S.bgk = on; if (S.gpu) S.gpu.setOperator(on); else { S.cpuAir.cfg.collision = on ? 'bgk' : 'mrt'; }
  toast(on ? 'WRONG TWIN: PLAIN BGK AT τ = 0.5003, NO SMAGORINSKY' : 'MRT + SMAGORINSKY', 4);
}
function resetAir() {
  if (S.gpu && S.spin) { S.gpu.setState(S.spin.f, S.spin.g, S.spin.nut, S.spin.ux, S.spin.uy, S.spin.T); readFull(); }
  S.blown = false; S.integrity.pending = null; toast('AIR RESET TO THE SPUN-UP STATE');
}
let toastT = 0;
function toast(msg, s = 2.5) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = s; }

// ---- the loop ----
const DT = 1 / 120;
let fullT = 0, cloudT = 0, integT = 3;
app.on('update', (dtReal) => {
  if (toastT > 0 && (toastT -= dtReal) <= 0) $('toast').classList.remove('show');
  if (S.mode !== 'playing') { idleCamera(dtReal); return; }
  const g = S.glider, st = g.st;
  // controls
  const held = (k) => S.keys.has(k);
  const stickT = held('w') || held('arrowup') ? -1 : held('s') || held('arrowdown') ? 1 : 0;
  S.stick += Math.max(-dtReal * 3, Math.min(dtReal * 3, stickT - S.stick));
  const bankT = held('a') || held('arrowleft') ? -1 : held('d') || held('arrowright') ? 1 : 0;
  S.bankIn += Math.max(-dtReal * 2, Math.min(dtReal * 2, bankT - S.bankIn));
  if (held('q')) S.trim -= 0.03 * dtReal; if (held('e')) S.trim += 0.03 * dtReal;
  const here = S.airLike.sample(st.x, st.z);
  const stf = speedToFly(g.mass(), here.w, S.mc, 0);
  S.stfNow = stf;
  // physics: glider at 120 Hz, air every units.dt
  const steps = Math.min(120, Math.round((Math.min(dtReal, 0.1) * S.warp) / DT));
  for (let k = 0; k < steps && S.task.status === 'flying'; k++) {
    if (S.botObj) S.botObj.update(DT);
    else {
      if (S.stf) { S.hold.target = stf; S.hold.update(DT); g.ctl.de += 0.12 * S.stick; }
      else g.ctl.de = Math.max(-0.35, Math.min(0.35, S.trim + 0.12 * S.stick));
      g.ctl.bank = 0.75 * S.bankIn;
    }
    g.step(DT);
    S.t += DT;
    S.task.update(g, S.t);
    if (S.t >= S.nextAir) { airStep(); S.nextAir += S.A.units.dt; }
  }
  // the field near the glider every frame; the whole slice twice a second
  fullT -= dtReal; if (fullT <= 0) { fullT = 0.5; readFull(); } else readNear();
  integT -= dtReal; if (integT <= 0) { integT = 4; startIntegrity(); }
  finishIntegrity();
  cloudT -= dtReal; if (cloudT <= 0) { cloudT = 0.5; updateClouds(); if (S.glass) updateGlass(); }
  if (S.task.status !== 'flying') return finish();
  // draw
  placeGlider(); placeCamera(dtReal); sky();
  hud(here, stf);
  audio.update(dtReal, S.raw ? g.vario.raw : g.vario.te, g.airspeed());
});

function placeGlider() {
  const st = S.glider.st, o = S.glider.out;
  gliderEnt.setPosition(W(st.x, st.y, st.z));
  marker.enabled = S.cam === 1; marker.setPosition(W(st.x, st.y, st.z + 30));
  if (o.bx) {
    const bx = new pc.Vec3(o.bx[0], o.bx[2], -o.bx[1]), up = new pc.Vec3(o.bz[0], o.bz[2], -o.bz[1]);
    const right = new pc.Vec3().cross(bx, up).normalize();
    const m = new pc.Mat4();
    const d = m.data;
    d[0] = bx.x; d[1] = bx.y; d[2] = bx.z; d[4] = up.x; d[5] = up.y; d[6] = up.z; d[8] = right.x; d[9] = right.y; d[10] = right.z;
    gliderEnt.setRotation(new pc.Quat().setFromMat4(m));
  }
  if (glass && S.glass) { const g = S.level.grid; glass.plane.setPosition((g.nx * g.dx) / 2, g.zBottom + (g.ny * g.dx) / 2, -st.y); }
}
const camPos = new pc.Vec3(), camLook = new pc.Vec3();
function placeCamera(dt) {
  const st = S.glider.st, p = W(st.x, st.y, st.z), o = S.glider.out;
  const fwd = new pc.Vec3(Math.cos(o.psi || 0), 0, -Math.sin(o.psi || 0));
  let want, look;
  if (S.cam === 0) { want = p.clone().add(fwd.clone().mulScalar(-38)).add(new pc.Vec3(0, 9, 0)); look = p.clone().add(fwd.clone().mulScalar(30)); }
  else if (S.cam === 1) { want = new pc.Vec3(p.x - 150, p.y + 120, p.z + 1100); look = new pc.Vec3(p.x + 250, p.y - 120, p.z); }
  else { want = p.clone().add(fwd.clone().mulScalar(0.9)).add(new pc.Vec3(0, 0.9, 0)); look = p.clone().add(fwd.clone().mulScalar(60)).add(new pc.Vec3(0, -4, 0)); }
  const a = S.cam === 2 ? 1 : Math.min(1, dt * 4);
  camPos.lerp(camPos.lengthSq() ? camPos : want, want, a); camLook.lerp(camLook.lengthSq() ? camLook : look, look, a);
  camera.setPosition(camPos); camera.lookAt(camLook);
}
function idleCamera(dt) {
  if (!S.level) return;
  const t = performance.now() / 1000;
  camera.setPosition(6200 + 1500 * Math.sin(t * 0.05), 1700, 5200); camera.lookAt(7200, 900, 0);
  sky();
}
function sky() {
  const el = S.level ? sunElevation(S.level, S.t) : 6, k = Math.min(1, el / 8);
  camera.camera.clearColor = new pc.Color(0.34 + 0.2 * (1 - k), 0.46 + 0.12 * k, 0.66 + 0.14 * k);
  sunLight.setEulerAngles(-Math.max(2, el + 6), -90, 0);
  sunLight.light.intensity = 0.5 + 0.6 * k;
}

function updateClouds() {
  const cells = cloudCells(S.level, S.A, S.F), g = S.level.grid, y0 = S.glider ? S.glider.st.y : 0;
  let k = 0;
  for (const c of cells) {
    const i = c % g.nx, j = (c / g.nx) | 0;
    if ((i + 2 * j) % 3) continue;
    for (let r = 0; r < 2 && k < cloudPool.length; r++) {
      const h = (Math.imul(c * 2654435761 + r * 40503, 0x9e3779b1) >>> 0) / 4294967296;
      const e = cloudPool[k++]; e.enabled = true;
      const s = 110 + 120 * h;
      e.setLocalScale(s * 1.6, s, s * 1.3);
      const h2 = (Math.imul(c * 97 + r * 7919, 0x85ebca6b) >>> 0) / 4294967296;
      e.setPosition(W((i + 0.5) * g.dx + (h2 - 0.5) * 80, Math.round(y0 / 2000) * 2000 + (h - 0.5) * 14000, g.zBottom + (j + 0.5) * g.dx + (h2 - 0.5) * 50));
    }
    if (k >= cloudPool.length) break;
  }
  for (; k < cloudPool.length; k++) cloudPool[k].enabled = false;
  S.cloudCount = cells.length;
}
function updateGlass() {
  const g = S.level.grid, px = glass.tex.lock(), toMs = S.A.units.toMs;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const c = i + j * g.nx, o = (i + (g.ny - 1 - j) * g.nx) * 4;
    if (S.F.solid[c]) { px[o + 3] = 0; continue; }
    const w = S.F.uy[c] * toMs, a = Math.min(1, Math.max(0, Math.abs(w) - 0.25) / 3.5);
    if (!Number.isFinite(w)) { px[o] = 255; px[o + 1] = 255; px[o + 2] = 0; px[o + 3] = 230; continue; }
    px[o] = w > 0 ? 255 : 43; px[o + 1] = w > 0 ? 61 : 107; px[o + 2] = w > 0 ? 61 : 255; px[o + 3] = Math.round(150 * a);
  }
  glass.tex.unlock();
}

function hud(here, stf) {
  const g = S.glider, st = g.st, L = S.level, task = S.task, tp = task.target;
  drawVario($('vario'), { vario: S.raw ? g.vario.raw : g.vario.te, raw: S.raw, mc: S.mc });
  drawDirector($('director'), { airspeed: g.airspeed() * 3.6, stf: stf * 3.6 });
  const fin = L.task.turnpoints[L.task.turnpoints.length - 1];
  const vf = speedToFly(g.mass(), 0, S.mc, 0);
  drawTape($('tape'), {
    z: st.z, eh: g.energyHeight(), ground: terrainAt(L, st.x), crest: Math.max(...L.heights), lcl: L.air.spread * 125 + S.A.valley,
    arriveNext: tp.finish ? null : arrivalHeight(L, g, tp, vf, here.u), groundNext: terrainAt(L, tp.x), nextName: tp.name.split(' ')[0].toUpperCase(),
    arriveFinish: arrivalHeight(L, g, fin, vf, here.u), groundFinish: terrainAt(L, fin.x),
  });
  const d = Math.hypot(tp.x - st.x, tp.y - st.y);
  $('task').innerHTML = L.task.turnpoints.map((t, k) => `<span class="tp ${k < task.leg ? 'done' : k === task.leg ? 'on' : ''}">${k + 1} ${t.name}</span>`).join('') + `<span><b>${(d / 1000).toFixed(1)} km</b></span>`;
  const day = dayLength(L), clock = 17 * 60 + 30 + S.t / 60, left = Math.max(0, day - S.t);
  $('time').textContent = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
  $('sun').textContent = `SUN ${sunElevation(L, S.t).toFixed(1)}° · SUNSET IN ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  const I = S.integrity, last = I.last;
  $('integ').innerHTML = !S.gpu ? '<span class="v wait">CPU REFERENCE ONLY · no WebGL2 float targets</span>'
    : (last ? `<span class="v ${last.pass ? '' : 'bad'}">${last.pass ? 'PASS' : 'FAIL'}</span> · steps ${last.from}→${last.to}<br>max |Δu| ${(last.du * S.A.units.toMs).toExponential(1)} m/s (≤ ${(LIM.max_du * S.A.units.toMs).toFixed(3)})<br>max |ΔT| ${last.dT.toExponential(1)} K (≤ ${LIM.max_dT})<br>` : '<span class="v wait">first window running</span><br>')
      + `windows ${I.pass}/${I.windows} pass · ${I.pending ? 'running' : 'idle'}<br><span style="color:var(--dim)">${String(S.renderer).slice(0, 46)}</span>`;
  const lamp = (id, on, txt, cls = 'on') => { const e = $(id); e.className = 'lamp' + (on ? ' ' + cls : ''); if (txt) e.textContent = txt; };
  lamp('l-vario', true, S.raw ? 'RAW VARIO (TWIN)' : 'TE VARIO', S.raw ? 'warn' : 'on');
  lamp('l-coll', true, S.bgk ? (S.blown ? 'BGK · BLOWN UP' : 'BGK τ≈½ (TWIN)') : 'MRT + SMAG', S.bgk ? 'warn' : 'on');
  lamp('l-glass', S.glass); lamp('l-flap', g.ctl.flap !== 0, 'FLAP ' + (g.ctl.flap > 0 ? '+' : '') + g.ctl.flap, 'gold');
  lamp('l-brake', g.ctl.brake > 0, 'BRAKES', 'warn'); lamp('l-water', st.water > 0, `WATER ${Math.round(st.water)} KG${g.ctl.dump ? ' · DUMP' : ''}`, 'gold');
  lamp('l-auto', S.botObj || S.stf, S.botObj ? 'BOT ' + S.botObj.kind.toUpperCase() : 'STF HOLD'); lamp('l-warp', S.warp > 1, '×' + S.warp, 'gold');
}

function finish() {
  if (S.mode !== 'playing') return;
  S.mode = 'result';
  const T = S.task, L = S.level, g = S.glider;
  const title = { finished: 'Home before dark.', 'landed out': 'Landed out.', sunset: 'The sun went down.' }[T.status];
  $('res-eyebrow').textContent = T.status;
  $('res-title').textContent = title;
  const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const rows = [['Time', mm(S.t)], ['Turnpoints', T.reached.map((r) => r.name).join(' · ') || 'none'],
    ['Where', `${(g.st.x / 1000).toFixed(1)} km E, ${(g.st.y / 1000).toFixed(1)} km N, ${Math.round(g.st.z - terrainAt(L, g.st.x))} m above ground`],
    ['Water', `${Math.round(g.st.water)} kg`], ['Integrity', `${S.integrity.pass} / ${S.integrity.windows} windows pass`]];
  $('res-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  document.body.className = 'menu';
  $('result').classList.add('show');
}

boot().catch((e) => { $('loading').textContent = 'FAILED · ' + e.message; console.error(e); });
