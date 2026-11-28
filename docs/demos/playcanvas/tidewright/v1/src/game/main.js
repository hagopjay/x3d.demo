// TIDEWRIGHT: boot, the planning phase (brush tools under the earth budget, the call), the storm (GPU solver at
// 1x..16x with the coarse CPU reference beside it), the HUD (ledger, freeboard, gauge, INTEGRITY), the "bad maths"
// toggle, and the result card. The level is one X3D file: the solver reads its ElevationGrid, PlayCanvas draws it.
import * as pc from '../../vendor/playcanvas.min.mjs';
import { fromX3D, initialWater, MATERIALS } from '../sim/level.js';
import { createEarthworks } from '../sim/earth.js';
import { score } from '../sim/game.js';
import { createStorm } from './storm.js';
import { buildWorld } from './world.js';
import { drawForecast, drawGauge, gaugeScale, mins } from './hud.js';
import { botPlan, naivePlan } from '../../tools/bot.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $('stage');
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.start();

const SPEEDS = [1, 2, 4, 8, 16], SIM_PER_X = 30;
const state = {
  mode: 'menu', level: null, text: null, earth: null, world: null, storm: null, limits: null,
  tool: 'dig', radius: 20, speed: Number(params.get('speed') || 4), paused: false, bad: params.get('bad') === '1', usedBad: false,
  prediction: { call: 'hold', peak: null }, painting: false, lastStroke: 0, dirty: true, rate: 0, toastT: 0, hover: null,
};

// ---- camera: orbit about a target ----
const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.6, 0.68, 0.76), farClip: 6000, nearClip: 1, fov: 45 });
camera.camera.toneMapping = pc.TONEMAP_ACES; camera.camera.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);
const cam = { target: new pc.Vec3(880, 24, 470), yaw: 196, pitch: 34, dist: 760 };
function placeCamera() {
  const y = (cam.yaw * Math.PI) / 180, p = (cam.pitch * Math.PI) / 180;
  camera.setPosition(cam.target.x + cam.dist * Math.cos(p) * Math.sin(y), cam.target.y + cam.dist * Math.sin(p), cam.target.z + cam.dist * Math.cos(p) * Math.cos(y));
  camera.lookAt(cam.target);
}
if (params.get('cam')) { const [yaw, pitch, dist, tx, tz] = params.get('cam').split(',').map(Number); Object.assign(cam, { yaw, pitch, dist }); if (Number.isFinite(tx)) cam.target.set(tx, 24, tz); }
placeCamera();

async function text(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }

async function boot() {
  state.text = await text('levels/spring-melt.x3d');
  state.level = fromX3D(state.text);
  state.limits = JSON.parse(await text('tests/limits.json'));
  state.earth = createEarthworks(state.level);
  state.world = buildWorld(app, state.level, state.text);
  state.prediction.peak = Math.round(leveeLines().low * 20) / 20;
  $('lvl').innerHTML = `level <b>1</b> · ${state.level.name}`;
  buildSpeeds();
  wireUI();
  $('loading').style.display = 'none';
  if (params.get('plan')) { applyNamedPlan(params.get('plan')); }
  if (params.get('play') || params.get('plan') || params.get('autostart')) enterPlan();
  if (params.get('autostart')) runStorm();
  window.__tide = state;      // for the headless playtest
  window.__pcApp = app;
  window.__tideApi = { runStorm, enterPlan, applyNamedPlan, setSpeed, toggleBad, placeCamera, cam };
}

// ---- modes ----
function setMode(m) {
  state.mode = m;
  for (const c of ['menu', 'plan', 'storm', 'result']) document.body.classList.toggle(c, c === m);
  $('menu').classList.toggle('show', m === 'menu');
  $('result').classList.toggle('show', m === 'result');
}
function enterPlan() {
  if (state.storm) { state.storm.destroy(); state.storm = null; }
  setMode('plan'); state.dirty = true; state.paused = false;
  document.body.classList.toggle('bad', state.bad);
}
function runStorm() {
  if (state.mode === 'storm') return;
  if (!state.earth.balanced()) { toast(`CUT MUST BALANCE FILL: ${Math.round(state.earth.barrow)} M³ IN THE BARROW`); return; }
  try { state.storm = createStorm(state.level, state.earth, { scheme: state.bad ? 'naive' : 'hr' }); }
  catch (e) { toast('WEBGL2 FLOAT TEXTURES UNAVAILABLE'); console.error(e); return; }
  state.usedBad = state.bad;
  state.storm.sample();
  setMode('storm');
  toast('THE STORM IS COMING');
}
function finishStorm() {
  const S = state.storm, last = S.last, E = state.earth;
  const breached = S.minFreeboard < 0 || last.nFlooded > 0;
  const sc = score(state.level, { nFlooded: last.nFlooded, money: E.money, cut: E.cut, prediction: state.prediction, peakStage: S.peakStage, breached });
  setMode('result');
  const held = last.nFlooded === 0;
  $('res-eyebrow').textContent = `the storm has passed · ${state.level.name}${state.usedBad ? ' · bad maths' : ''}`;
  $('res-title').textContent = held ? (S.minFreeboard < 0 ? 'Wet feet, dry floors.' : 'Held.') : last.nFlooded > 7 ? 'The town went under.' : 'Breached.';
  const rows = sc.rows.map(([a, b, p]) => [a, b, p > 0 ? `+${p}` : String(p)]);
  rows.push(['peak at the gauge', `${S.peakStage.toFixed(2)} m`, ''], ['lowest freeboard', `${S.minFreeboard.toFixed(2)} m`, ''],
    ['lost to numerics', `${last.ledger.lost.toFixed(2)} m³ (${last.ledger.rel.toExponential(1)})`, ''], ['score', '', String(sc.score)]);
  $('res-table').innerHTML = rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('');
  state.result = { held, nFlooded: last.nFlooded, flooded: last.flooded, score: sc.score, peakStage: S.peakStage, minFreeboard: S.minFreeboard, ledger: last.ledger, integrity: last.integrity };
}

// ---- plans and tools ----
function applyNamedPlan(name) {
  state.earth.reset();
  const plan = name === 'bot' ? botPlan(state.level) : name === 'naive' ? naivePlan(state.level) : [];
  for (const s of plan) state.earth.stroke(s);
  state.dirty = true;
  toast(name === 'bot' ? 'BOT PLAN: WASHLAND, SILL, LEVEE' : name === 'naive' ? 'NAIVE PLAN: PATCH THE LOW SPOT' : 'RESET');
}
function leveeLines(bed = state.earth ? state.earth.bed : state.level.bed) {
  const crests = state.level.levee.map(([c]) => bed[c]).sort((a, b) => a - b);
  const floor = Math.min(...state.level.houses.map((h) => h.ground)) + state.level.houseFloor;
  return { crest: crests[Math.floor(crests.length / 2)], low: crests[0], floor };
}

// picking: march the eye ray down onto the (edited) bed
const near = new pc.Vec3(), far = new pc.Vec3();
function pick(x, y) {
  camera.camera.screenToWorld(x, y, camera.camera.nearClip, near);
  camera.camera.screenToWorld(x, y, 4000, far);
  const d = far.clone().sub(near), L = d.length(); d.mulScalar(1 / L);
  const bed = state.earth.bed, W = state.world;
  let prev = 0;
  for (let s = 0; s < L; s += 3) {
    const px = near.x + d.x * s, py = near.y + d.y * s, pz = near.z + d.z * s;
    if (px < 0 || pz < 0 || px > (state.level.nx - 1) * state.level.dx || pz > (state.level.nz - 1) * state.level.dx) { prev = s; continue; }
    if (py <= W.bedAt(bed, px, pz)) {
      let a = prev, b = s;
      for (let k = 0; k < 20; k++) { const m = 0.5 * (a + b); const qx = near.x + d.x * m, qy = near.y + d.y * m, qz = near.z + d.z * m; if (qy <= W.bedAt(bed, qx, qz)) b = m; else a = m; }
      const qx = near.x + d.x * b, qz = near.z + d.z * b;
      return { x: qx, z: qz, y: W.bedAt(bed, qx, qz) };
    }
    prev = s;
  }
  return null;
}
function strokeAt(p) {
  if (!p || state.mode !== 'plan') return;
  const v = state.earth.stroke({ tool: state.tool, x: p.x, z: p.z, radius: state.radius, amount: 0.15 });
  if (v === 0 && state.tool === 'raise' && state.earth.barrow <= 0) toast('THE BARROW IS EMPTY: DIG FIRST');
  else if (v === 0 && state.tool === 'dig') { const k = Math.round(p.z / state.level.dx) * state.level.nx + Math.round(p.x / state.level.dx); toast(`${MATERIALS[state.level.mat[k]].name.toUpperCase()} CANNOT BE DUG`); }
  else if (v === 0 && state.tool === 'sandbag') toast(state.earth.bagsUsed >= state.level.sandbags ? 'NO SANDBAGS LEFT' : 'NO BAGS THERE');
  state.dirty = true;
}

// ---- input ----
let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pan = e.button === 1 || (e.button === 0 && e.shiftKey);
  drag = { x: e.clientX, y: e.clientY, mode: pan ? 'pan' : e.button === 2 ? 'orbit' : 'paint' };
  if (drag.mode === 'paint' && state.mode === 'plan') { state.painting = true; strokeAt(pick(e.clientX, e.clientY)); state.lastStroke = performance.now(); }
});
canvas.addEventListener('pointermove', (e) => {
  state.hover = state.mode === 'plan' ? pick(e.clientX, e.clientY) : null;
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === 'orbit') { cam.yaw -= dx * 0.3; cam.pitch = Math.max(8, Math.min(85, cam.pitch + dy * 0.25)); placeCamera(); }
  if (drag.mode === 'pan') {
    const y = (cam.yaw * Math.PI) / 180, s = cam.dist / 900;
    cam.target.x += (-Math.cos(y) * dx - Math.sin(y) * dy) * s; cam.target.z += (Math.sin(y) * dx - Math.cos(y) * dy) * s; placeCamera();
  }
});
canvas.addEventListener('pointerup', () => { drag = null; state.painting = false; });
canvas.addEventListener('wheel', (e) => { cam.dist = Math.max(120, Math.min(2200, cam.dist * Math.exp(e.deltaY * 0.001))); placeCamera(); e.preventDefault(); }, { passive: false });

function setTool(t) { state.tool = t; document.querySelectorAll('#toolrow .chip').forEach((c) => c.classList.toggle('sel', c.dataset.tool === t)); }
function setSpeed(s) { state.speed = s; document.querySelectorAll('#speeds .chip').forEach((c) => c.classList.toggle('sel', Number(c.dataset.s) === s)); }
function setCall(c) { state.prediction.call = c; document.querySelectorAll('#predict .chip').forEach((b) => b.classList.toggle('sel', b.dataset.call === c)); }
function toggleBad() {
  state.bad = !state.bad;
  if (state.storm) { state.storm.setNaive(state.bad); if (state.bad) state.usedBad = true; }
  document.body.classList.toggle('bad', state.bad);
  toast(state.bad ? 'BAD MATHS: NO HYDROSTATIC RECONSTRUCTION' : 'WELL-BALANCED SCHEME');
}
function buildSpeeds() { $('speeds').innerHTML = SPEEDS.map((s) => `<button class="chip" data-s="${s}">${s}x</button>`).join(''); document.querySelectorAll('#speeds .chip').forEach((c) => (c.onclick = () => setSpeed(Number(c.dataset.s)))); setSpeed(state.speed); }
function wireUI() {
  $('go').onclick = enterPlan;
  $('res-retry').onclick = enterPlan; $('res-menu').onclick = () => setMode('menu');
  document.querySelectorAll('#toolrow .chip').forEach((c) => (c.onclick = () => setTool(c.dataset.tool)));
  document.querySelectorAll('#predict .chip').forEach((c) => (c.onclick = () => setCall(c.dataset.call)));
  $('b-reset').onclick = () => { state.earth.reset(); state.dirty = true; toast('RESET'); };
  $('b-bot').onclick = () => applyNamedPlan('bot');
  $('b-naive').onclick = () => applyNamedPlan('naive');
  $('b-run').onclick = runStorm;
  $('gauge').addEventListener('pointerdown', (e) => {
    if (state.mode !== 'plan') return;
    const r = $('gauge').getBoundingClientRect(), { lo, hi } = gaugeScale(state.level, leveeLines());
    const v = lo + ((r.height - 18 - (e.clientY - r.top)) / (r.height - 18 - 22)) * (hi - lo);
    state.prediction.peak = Math.round(v * 20) / 20;
  });
}
window.addEventListener('keydown', (e) => {
  if (state.mode === 'menu') { if (e.code === 'Enter') enterPlan(); return; }
  if (state.mode === 'result') { if (e.code === 'Enter') enterPlan(); if (e.code === 'Escape') setMode('menu'); return; }
  if (e.code === 'Escape') { if (state.storm) { state.storm.destroy(); state.storm = null; } setMode('menu'); return; }
  if (e.code === 'KeyB') toggleBad();
  if (state.mode === 'plan') {
    if (e.code === 'Digit1') setTool('dig'); if (e.code === 'Digit2') setTool('raise'); if (e.code === 'Digit3') setTool('sandbag');
    if (e.code === 'BracketLeft') state.radius = Math.max(10, state.radius - 5); if (e.code === 'BracketRight') state.radius = Math.min(50, state.radius + 5);
    if (e.code === 'KeyR') { state.earth.reset(); state.dirty = true; toast('RESET'); }
    if (e.code === 'KeyG') applyNamedPlan('bot'); if (e.code === 'KeyN') applyNamedPlan('naive');
    if (e.code === 'KeyH') setCall('hold'); if (e.code === 'KeyJ') setCall('breach');
    if (e.code === 'ArrowUp') state.prediction.peak = Math.round((state.prediction.peak + 0.05) * 100) / 100;
    if (e.code === 'ArrowDown') state.prediction.peak = Math.round((state.prediction.peak - 0.05) * 100) / 100;
    if (e.code === 'Enter') runStorm();
  } else if (state.mode === 'storm') {
    if (e.code === 'Space') { state.paused = !state.paused; toast(state.paused ? 'PAUSED' : 'RUNNING'); }
    if (e.code === 'Minus') setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(state.speed) - 1)]);
    if (e.code === 'Equal') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(state.speed) + 1)]);
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
});
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); state.toastT = 1.8; }

// ---- HUD ----
const fmt = (v) => Math.round(v).toLocaleString('en-US');
function cls(v, band) { return v <= band.green ? 'ok' : v <= band.amber ? 'amber' : 'no'; }
function hudPlan() {
  const E = state.earth;
  $('cut').textContent = `${fmt(E.cut)} m³`; $('fill').textContent = `${fmt(E.fill)} m³`;
  $('barrow').textContent = `${fmt(E.barrow)} m³`; $('barrow').className = E.balanced() ? 'ok' : 'amber';
  $('bags').textContent = `${E.bagsUsed} / ${state.level.sandbags}`;
  $('money').textContent = `$${fmt(E.money)} / $${fmt(state.level.budget)}`; $('money').className = E.money <= state.level.budget ? '' : 'no';
  $('radius').textContent = state.radius;
  $('balance').innerHTML = E.balanced() ? '<span class="ok">cut balances fill: ready</span>' : `<span class="amber">${fmt(E.barrow)} m³ still in the barrow: raise something with it</span>`;
  $('b-run').disabled = !E.balanced() || state.mode !== 'plan';
  $('pk').textContent = state.prediction.peak == null ? '—' : state.prediction.peak.toFixed(2);
}
function hudStorm(o) {
  const R = state.limits.readout;
  const L = o.ledger, I = o.integrity;
  $('l-in').textContent = fmt(L.in); $('l-out').textContent = fmt(L.out); $('l-st').textContent = fmt(L.stored);
  $('l-lost').innerHTML = `<span class="${cls(L.rel, R.ledger_rel)}">${L.lost.toFixed(2)} (${L.rel.toExponential(1)})</span>`;
  $('i-scheme').innerHTML = I.scheme === 'hr' ? '<span class="ok">well-balanced (hydrostatic reconstruction)</span>' : '<span class="no">BAD MATHS: no reconstruction</span>';
  $('i-stage').innerHTML = `<span class="${cls(Math.abs(I.stageDiff), R.gauge_stage_vs_coarse_cpu_m)}">${I.stageDiff >= 0 ? '+' : ''}${I.stageDiff.toFixed(3)} m</span>`;
  $('i-vol').textContent = `${(100 * I.storedDiffRel).toFixed(2)} %`;
  $('i-ledger').innerHTML = `<span class="${cls(I.ledgerRel, R.ledger_rel)}">${I.ledgerRel.toExponential(1)}</span>`;
  $('i-tarn').innerHTML = `<span class="${cls(I.tarnU, R.tarn_umax_m_s)}">${I.tarnU.toExponential(1)} m/s</span>`;
  $('i-cfl').innerHTML = `<span class="${cls(I.courant, R.courant)}">${I.courant.toFixed(2)}</span>`;
  $('i-gpu').textContent = `GPU: ${I.renderer}`;
  $('clock').textContent = mins(o.t);
  $('rate').textContent = state.paused ? 'PAUSED' : `ACTUAL ${(state.rate / SIM_PER_X).toFixed(1)}x · Q ${Math.round(o.q)} m³/s`;
  $('fb').textContent = o.freeboard.toFixed(2); $('fb').className = 'big ' + (o.freeboard > 0.3 ? 'ok' : o.freeboard > 0 ? 'amber' : 'no');
  $('dry').textContent = `${state.level.houses.length - o.nFlooded}/${state.level.houses.length}`; $('dry').className = 'big ' + (o.nFlooded ? 'no' : 'ok');
}

// ---- the frame ----
let hudT = 0;
app.on('update', (dt) => {
  if (!state.level || !state.world || !state.limits) return;
  if (state.toastT > 0 && (state.toastT -= dt) <= 0) $('toast').classList.remove('show');
  const W = state.world, E = state.earth;
  if (state.mode === 'plan' || state.mode === 'menu') {
    if (state.painting && state.tool !== 'sandbag' && performance.now() - state.lastStroke > 70 && drag) { strokeAt(pick(drag.x, drag.y)); state.lastStroke = performance.now(); }
    if (state.dirty) {
      W.setBed(E.bed, E.b0, E.bags);
      const h = initialWater(state.level, E.bed), z = new Float32Array(h.length);
      W.setWater({ h, hu: z, hv: z }, E.bed); W.setHouses(null);
      state.dirty = false;
    }
    const col = { dig: [1, 0.36, 0.2], raise: [0.2, 0.9, 1], sandbag: [1, 0.8, 0.3] }[state.tool];
    W.setBrush(state.mode === 'plan' ? state.hover : null, state.tool === 'sandbag' ? 6 : state.radius, col);
    hudT -= dt;
    if (state.mode === 'plan' && hudT <= 0) {
      hudT = 0.1; hudPlan();
      drawForecast($('forecast'), state.level, null);
      drawGauge($('gauge'), state.level, [], leveeLines(), state.prediction);
    }
    return;
  }
  if (state.mode === 'storm' && state.storm) {
    W.setBrush(null);
    const S = state.storm;
    if (!state.paused) {
      const want = Math.min(0.1, dt) * SIM_PER_X * state.speed;
      const t0 = S.t; S.advance(want, 400);
      state.rate = state.rate * 0.9 + (0.1 * (S.t - t0)) / Math.max(1e-3, Math.min(0.1, dt));
    }
    const o = S.sample();
    W.setWater(S.arrays, E.bed, state.bad ? [1, 0.25, 0.3] : null);
    W.setHouses(o.flooded);
    hudStorm(o);
    drawForecast($('forecast'), state.level, o.t);
    drawGauge($('gauge'), state.level, S.series, leveeLines(), state.prediction, { bad: state.bad });
    if (S.done) finishStorm();
  }
});

boot().catch((e) => { $('loading').textContent = 'FAILED: ' + e.message; console.error(e); });
