// HAUL: boot, menus, keyboard, the fixed-step loop, cameras, effects and the results card.
// The simulation steps at 240 Hz (src/sim/truck.js); PlayCanvas draws between steps with interpolated poses.
import * as pc from '../../vendor/playcanvas.min.mjs';
import { fromX3D, uniform, wetnessAt } from '../sim/level.js';
import { createSim, HZ, DT } from '../sim/truck.js';
import { TRUCK, TRAILER, TYRE, DIESEL } from '../sim/spec.js';
import { loadX3D } from './x3d-pc.js';
import { buildWorld, updateWeather } from './world.js';
import { createAudio } from './audio.js';
import { drawTach, drawGrip, drawClimb } from './hud.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.start();

const params = new URLSearchParams(location.search);
const audio = createAudio();
const state = {
  level: Number(params.get('level') || 1), power: params.get('power') === 'ev' ? 'ev' : 'diesel',
  mode: 'menu', sim: null, world: null, camMode: 0, keys: new Set(), input: { throttle: 0, brake: 0, steer: 0 },
  acc: 0, weather: {}, fuel: 0, kwh0: 0, toastT: 0, hudT: 0, assets: {}, manifest: null, autodrive: params.get('autodrive'),
};
const setup = { drive: '6x4', lockers: false, low: false, pressure: TYRE.pressure.nominal, ballast: 0, fuelMap: 0, auto: true, traction: true, exhaustBrake: false };

// ---- camera ----
const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.5, 0.6, 0.7), farClip: 900, nearClip: 0.2, fov: 50 });
camera.camera.toneMapping = pc.TONEMAP_ACES;
camera.camera.gammaCorrection = pc.GAMMA_SRGB;
app.root.addChild(camera);
const CAMS = ['side', 'chase', 'cab'];
const camPos = new pc.Vec3(), camLook = new pc.Vec3();

let Ammo = null;
let truckEnt = null, truckDefs = null, trailerEnt = null, trailerDefs = null, trailerModel = null, fx = [];

async function text(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }

async function boot() {
  Ammo = await window.HaulAmmo({ locateFile: (f) => 'vendor/ammo/' + f });
  [state.assets.truck, state.assets.trailer] = await Promise.all([text('assets/truck.x3d'), text('assets/trailer.x3d')]);
  state.manifest = JSON.parse(await text('levels/MANIFEST.json'));
  buildMenu();
  $('loading').style.display = 'none';
  await loadLevel(state.level, true);
  if (params.get('play') || state.autodrive) startClimb();
  window.__haul = state;      // for the headless playtest
}

function buildMenu() {
  const box = $('levels');
  box.innerHTML = '';
  const items = state.manifest.levels.concat([{ level: 0, name: 'Test Hill', tagline: 'One grade, one surface: tinker here.', steepest: 0.3 }]);
  for (const L of items) {
    const b = document.createElement('button');
    b.className = 'card panel' + (L.level === state.level ? ' sel' : '');
    b.innerHTML = `<span class="n">${L.level}</span><span><b>${L.name}</b><small>${L.tagline}</small></span><span class="g">${Math.round(L.steepest * 100)}%</span>`;
    b.onclick = () => selectLevel(L.level);
    box.appendChild(b);
  }
  for (const c of document.querySelectorAll('#powers .chip')) c.onclick = () => selectPower(c.dataset.power);
  $('go').onclick = startClimb;
  $('res-next').onclick = () => { selectLevel(Math.min(5, state.level + 1)); startClimb(); };
  $('res-retry').onclick = () => startClimb();
  $('res-menu').onclick = () => showMenu();
}
function selectLevel(k) {
  state.level = k;
  document.querySelectorAll('#levels .card').forEach((c, i) => c.classList.toggle('sel', (i + 1) % 6 === k % 6 && (k ? i === k - 1 : i === 5)));
  loadLevel(k, true);
}
function selectPower(p) {
  state.power = p;
  document.querySelectorAll('#powers .chip').forEach((c) => c.classList.toggle('sel', c.dataset.power === p));
}

// ---- level and vehicles ----
async function loadLevel(k, preview = false) {
  const level = k === 0 ? uniform({ grade: 0.3, surface: 2, wetness: 0.4, length: 300 }) : fromX3D(await text(`levels/${state.manifest.levels[k - 1].file}`));
  if (state.world) state.world.root.destroy();
  for (const f of fx) f.destroy();
  fx = [];
  if (truckEnt) truckEnt.destroy();
  if (trailerEnt) { trailerEnt.destroy(); trailerEnt = null; }
  if (state.sim) state.sim.destroy();
  state.world = buildWorld(app, level);
  camera.camera.clearColor = new pc.Color(...state.world.sky.sky);
  // the truck from its X3D file; wheels are moved every frame
  const t = loadX3D(app, state.assets.truck);
  truckEnt = new pc.Entity('truck'); truckEnt.addChild(t.root); app.root.addChild(truckEnt);
  truckDefs = t.defs;
  truckDefs.Ballast.enabled = setup.ballast > 0;
  if (level.payload != null) {
    const cargo = ['pipe', 'excavator', 'logs', 'generator'].indexOf(level.cargo);
    const tr = loadX3D(app, state.assets.trailer, { choice: { Cargo: cargo } });
    trailerEnt = new pc.Entity('trailer'); trailerModel = tr.root; trailerEnt.addChild(tr.root); app.root.addChild(trailerEnt);
    trailerDefs = tr.defs;
  }
  state.sim = createSim(Ammo, level, { ...setup, power: state.power });
  if (trailerEnt) trailerModel.setLocalPosition(-state.sim.trailer.cgX, -state.sim.trailer.cgY, 0);
  // effects: two stacks (grey and black emitters each), spray and mud at each tandem and front wheel
  const W = state.world;
  state.stacks = TRUCK.exhaust.map((p, k) => {
    const grey = W.smoke('smoke' + k), black = W.smoke('soot' + k);
    black.particlesystem.colorGraph = new pc.CurveSet([[0, 0.05, 1, 0.25], [0, 0.05, 1, 0.25], [0, 0.05, 1, 0.26]]);
    app.root.addChild(grey); app.root.addChild(black); fx.push(grey, black);
    return { p, grey, black };
  });
  state.sprays = state.sim.wheels.map((w, k) => {
    const water = W.spray('water' + k, [0.75, 0.78, 0.82], -9.8, 0.7), mud = W.spray('mud' + k, [0.3, 0.21, 0.13], -12, 1.0);
    app.root.addChild(water); app.root.addChild(mud); fx.push(water, mud);
    return { w, water, mud };
  });
  state.fuel = 0; state.kwh0 = state.sim.battery.kwh; state.weather = {};
  state.prev = snapshot();
  $('lvl').innerHTML = k ? `level <b>${k}</b> · ${level.name}` : '<b>test hill</b>';
  if (preview) { state.mode = state.mode === 'playing' ? 'playing' : 'menu'; }
  placeVisuals(1);
  placeCamera(1, true);
}

function snapshot() {
  const s = state.sim;
  return { pos: { ...s.out.pos }, quat: { ...s.out.quat }, tpos: s.trailerOut ? { ...s.trailerOut.pos } : null, tquat: s.trailerOut ? { ...s.trailerOut.quat } : null };
}

const qa = new pc.Quat(), qb = new pc.Quat();
function lerpPose(ent, p0, q0, p1, q1, a) {
  ent.setPosition(p0.x + (p1.x - p0.x) * a, p0.y + (p1.y - p0.y) * a, p0.z + (p1.z - p0.z) * a);
  qa.set(q0.x, q0.y, q0.z, q0.w); qb.set(q1.x, q1.y, q1.z, q1.w);
  ent.setRotation(new pc.Quat().slerp(qa, qb, a));
}

function placeVisuals(alpha) {
  const s = state.sim, prev = state.prev;
  lerpPose(truckEnt, prev.pos, prev.quat, s.out.pos, s.out.quat, alpha);
  s.wheels.forEach((w, k) => {
    const hub = truckDefs['Hub' + k], wheel = truckDefs['Wheel' + k];
    hub.setLocalPosition(w.hub.x, w.hub.y - w.length, w.hub.z);
    hub.setLocalEulerAngles(0, w.steer * pc.math.RAD_TO_DEG, 0);
    wheel.setLocalEulerAngles(0, 0, -w.angle * pc.math.RAD_TO_DEG);
  });
  if (trailerEnt && s.trailerOut) {
    lerpPose(trailerEnt, prev.tpos, prev.tquat, s.trailerOut.pos, s.trailerOut.quat, alpha);
    s.trailer.wheels.forEach((w, k) => {
      const hub = trailerDefs['TrHub' + k], wheel = trailerDefs['TrWheel' + k];
      hub.setLocalPosition(w.hub.x + s.trailer.cgX, w.hub.y - w.length + s.trailer.cgY, w.hub.z);
      wheel.setLocalEulerAngles(0, 0, -w.angle * pc.math.RAD_TO_DEG);
    });
  }
}

const tmpV = new pc.Vec3();
function worldOf(ent, local) { return ent.getWorldTransform().transformPoint(new pc.Vec3(local[0], local[1], local[2]), tmpV).clone(); }

function placeCamera(dt, snap = false) {
  const s = state.sim, p = truckEnt.getPosition();
  const mode = CAMS[state.camMode];
  const fwd = truckEnt.right.clone();          // the truck's +x
  if (mode === 'side') {
    camPos.set(p.x - 9, p.y + 5.5, p.z - 21);
    camLook.set(p.x + 4, p.y + 1, p.z);
  } else if (mode === 'chase') {
    camPos.set(p.x - fwd.x * 20, p.y + 10 - fwd.y * 20, p.z - fwd.z * 20 - 5);
    camLook.set(p.x + fwd.x * 6, p.y + 1.5 + fwd.y * 6, p.z + fwd.z * 6);
  } else {
    const eye = worldOf(truckEnt, [2.6, 1.55, 0.55]), ahead = worldOf(truckEnt, [30, 0.5, 0.55]);
    camera.setPosition(eye); camera.lookAt(ahead);
    return;
  }
  const k = snap ? 1 : 1 - Math.exp(-dt * 4);
  const c = camera.getPosition();
  camera.setPosition(c.x + (camPos.x - c.x) * k, c.y + (camPos.y - c.y) * k, c.z + (camPos.z - c.z) * k);
  camera.lookAt(camLook);
  void s;
}

// ---- input ----
const TOGGLES = {
  KeyK: () => { setup.lockers = !setup.lockers; return setup.lockers ? 'LOCKERS ON' : 'LOCKERS OFF'; },
  KeyX: () => { setup.drive = setup.drive === '6x4' ? '6x6' : '6x4'; return setup.drive; },
  KeyL: () => { if (Math.abs(state.sim.speed) > 1.5) return 'STOP FOR LOW RANGE'; setup.low = !setup.low; return setup.low ? 'LOW RANGE' : 'HIGH RANGE'; },
  BracketLeft: () => { setup.pressure = Math.max(TYRE.pressure.min, setup.pressure - 0.5); return `TYRES ${setup.pressure.toFixed(1)} BAR`; },
  BracketRight: () => { setup.pressure = Math.min(TYRE.pressure.max, setup.pressure + 0.5); return `TYRES ${setup.pressure.toFixed(1)} BAR`; },
  KeyF: () => { setup.fuelMap = setup.fuelMap >= 1 ? 0 : setup.fuelMap + 0.5; return ['FUEL STOCK', 'FUEL RICH', 'ROLLING COAL'][setup.fuelMap * 2]; },
  KeyJ: () => { setup.exhaustBrake = !setup.exhaustBrake; return setup.exhaustBrake ? 'EXHAUST BRAKE ON' : 'EXHAUST BRAKE OFF'; },
  KeyM: () => { setup.auto = !setup.auto; return setup.auto ? 'AUTOMATIC' : 'MANUAL: Q / E'; },
  KeyT: () => { setup.traction = !setup.traction; return setup.traction ? 'TRACTION CONTROL ON' : 'TRACTION CONTROL OFF'; },
  KeyC: () => { state.camMode = (state.camMode + 1) % CAMS.length; return CAMS[state.camMode].toUpperCase() + ' CAMERA'; },
  KeyV: () => (audio.toggle() ? 'MUTED' : 'SOUND ON'),
};
let edge = {};
window.addEventListener('keydown', (ev) => {
  audio.start();
  if (ev.code === 'Tab') { ev.preventDefault(); document.body.classList.toggle('tuning'); return; }
  if (state.mode === 'menu') {
    if (/^Digit[0-5]$/.test(ev.code)) selectLevel(Number(ev.code.slice(5)));
    if (ev.code === 'KeyP') selectPower(state.power === 'diesel' ? 'ev' : 'diesel');
    if (ev.code === 'Enter') startClimb();
    return;
  }
  if (state.mode === 'result') { if (ev.code === 'Enter') startClimb(); if (ev.code === 'Escape') showMenu(); return; }
  if (ev.code === 'Escape') { showMenu(); return; }
  if (ev.code === 'Enter') { startClimb(); return; }
  if (!ev.repeat && TOGGLES[ev.code]) { toast(TOGGLES[ev.code]()); Object.assign(state.sim.setup, setup); }
  if (!ev.repeat) edge[ev.code] = true;
  state.keys.add(ev.code);
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(ev.code)) ev.preventDefault();
});
window.addEventListener('keyup', (ev) => state.keys.delete(ev.code));

function readInput(dt) {
  const k = state.keys, inp = state.input;
  const up = k.has('KeyW') || k.has('ArrowUp'), down = k.has('KeyS') || k.has('ArrowDown') || k.has('Space');
  const cap = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.4 : 1;
  inp.throttle = up ? Math.min(cap, inp.throttle + dt / 0.35) : Math.max(0, inp.throttle - dt / 0.15);
  inp.brake = down ? Math.min(k.has('Space') ? 1 : 0.7, inp.brake + dt / 0.25) : Math.max(0, inp.brake - dt / 0.1);
  const s = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
  inp.steer += (s - inp.steer) * Math.min(1, dt * (s === 0 ? 5 : 3));
  const out = { throttle: inp.throttle, brake: inp.brake, steer: inp.steer };
  if (edge.KeyE) out.shiftUp = true;
  if (edge.KeyQ) out.shiftDown = true;
  if (edge.KeyR) { state.reverse = !state.reverse; toast(state.reverse ? 'REVERSE' : 'DRIVE'); }
  out.reverse = !!state.reverse;
  edge = {};
  return out;
}

// a scripted driver for the headless playtest (?autodrive=1): follow the road, hold the tyres near their peak
import('../../tools/bot.mjs').then((m) => { state.bot = m.botInput; }).catch(() => {});

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); state.toastT = 1.6; }

function startClimb() {
  state.reverse = false;
  loadLevel(state.level).then(() => {
    state.mode = 'playing';
    document.body.classList.remove('menu');
    document.body.classList.add('playing');
    $('menu').classList.remove('show'); $('result').classList.remove('show');
    state.acc = 0;
  });
}
function showMenu() {
  state.mode = 'menu';
  document.body.classList.add('menu'); document.body.classList.remove('playing');
  $('menu').classList.add('show'); $('result').classList.remove('show');
}

function showResult() {
  const s = state.sim, won = s.status === 'summit';
  state.mode = 'result';
  document.body.classList.remove('playing'); document.body.classList.add('menu');
  $('result').classList.add('show');
  $('res-eyebrow').textContent = won ? `summit · level ${state.level || 'T'}` : s.status;
  $('res-title').textContent = won ? 'On top.' : { stuck: 'Spun out.', rolled: 'Over she goes.', fell: 'Off the edge.' }[s.status] || 'Stopped.';
  const used = s.setup.power === 'diesel' ? `${(state.fuel / 1000 / 0.835).toFixed(1)} l diesel` : `${(state.kwh0 - s.battery.kwh).toFixed(1)} kWh`;
  const passed = s.level.pitches.filter((p) => s.best + s.level.start >= p.x1);
  const rows = [
    ['time', fmt(s.time)], ['climbed', `${Math.max(0, s.best).toFixed(0)} of ${(s.level.summit - s.level.start).toFixed(0)} m`],
    ['steepest beaten', passed.length ? Math.round(Math.max(...passed.map((p) => p.g)) * 100) + '%' : '—'],
    ['used', used], ['wetness at the end', Math.round(s.wetness * 100) + '%'],
    ['setup', `${s.setup.power.toUpperCase()} · ${s.setup.drive} · ${s.setup.lockers ? 'lockers' : 'open diffs'} · ${s.setup.low ? 'low' : 'high'} · ${s.setup.pressure.toFixed(1)} bar${s.setup.fuelMap ? ' · fuel map ' + s.setup.fuelMap : ''}`],
  ];
  $('res-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  $('res-next').style.display = won && state.level && state.level < 5 ? '' : 'none';
  if (!won) $('res-table').innerHTML += `<tr><td>try</td><td>${hint(s)}</td></tr>`;
  window.__haulResult = { status: s.status, time: s.time, best: s.best };
}
function hint(s) {
  if (s.setup.drive === '6x4') return '6x6 (X) puts the front axle\'s weight to work';
  if (!s.setup.lockers) return 'lockers (K): open diffs give only the weaker wheel\'s grip';
  if (s.setup.pressure > 4) return 'air down ([): a longer footprint grips loose ground';
  if (s.setup.power === 'diesel' && !s.setup.fuelMap) return 'a richer fuel map (F) for more torque, and keep the revs up for boost';
  return 'carry speed into the steep pitch: the rain will not wait';
}
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---- the loop ----
app.on('update', (dt) => {
  if (!state.sim) return;
  dt = Math.min(dt, 0.1);
  const s = state.sim;
  if (state.mode === 'playing' && s.status === 'driving') {
    const inp = state.autodrive && state.bot ? { ...state.bot(s), reverse: false } : readInput(dt);
    state.acc += dt;
    let n = 0;
    while (state.acc >= DT && n < 40) {
      state.prev = snapshot();
      s.step(inp);
      inp.shiftUp = inp.shiftDown = false;
      state.fuel += s.engine.fuel * DT;
      state.acc -= DT; n++;
    }
    if (s.status !== 'driving') setTimeout(showResult, 900);
  } else if (state.mode === 'menu') {
    // the showroom: the truck idles at the start while the camera drifts
    s.step({ brake: 1 });
    state.prev = snapshot();
  }
  const alpha = state.mode === 'playing' ? Math.min(1, state.acc / DT) : 1;
  placeVisuals(alpha);
  if (state.mode === 'menu') {
    const p = truckEnt.getPosition(), t = performance.now() / 1000;
    camera.setPosition(p.x + 14 * Math.cos(t * 0.15), p.y + 5, p.z - 14 * Math.sin(t * 0.15) - 4);
    camera.lookAt(p.x, p.y + 1, p.z);
  } else placeCamera(dt);
  effects(dt);
  hud(dt);
});

function effects(dt) {
  const s = state.sim, W = state.world;
  const rainNow = s.level.rain > 0 ? Math.min(1, 0.35 + s.level.rain * 0.65) : 0;
  const ambient = updateWeather(W, s.wetness ?? wetnessAt(s.level, 0), rainNow, dt, camera, state.weather);
  if (ambient !== undefined) app.scene.ambientLight = new pc.Color(ambient, ambient * 1.03, ambient * 1.1);
  $('flash').style.opacity = String((state.weather.flash || 0) * 0.35);
  if (state.weather.thunder !== undefined) { state.weather.thunder -= dt; if (state.weather.thunder < 0) { state.weather.boom = 1; delete state.weather.thunder; } }
  state.weather.boom = Math.max(0, (state.weather.boom || 0) - dt * 0.7);
  // exhaust: grey from the fuel burnt, black from the fuel the turbo cannot yet burn
  const e = s.engine;
  for (const st of state.stacks) {
    const at = worldOf(truckEnt, st.p);
    st.grey.setPosition(at); st.black.setPosition(at);
    const grey = s.setup.power === 'diesel' ? 0.05 + e.fuel * 0.08 : 0;
    const soot = s.setup.power === 'diesel' ? e.soot * e.fuel * 0.12 : 0;
    setRate(st.grey, grey); setRate(st.black, soot);
  }
  for (const sp of state.sprays) {
    const w = sp.w;
    sp.water.setPosition(w.world.x - 0.4, w.world.y - w.radius * 0.6, w.world.z);
    sp.mud.setPosition(w.world.x - 0.4, w.world.y - w.radius * 0.6, w.world.z);
    const fast = Math.abs(s.speed), slip = Math.abs(w.slip);
    const wet = w.contact ? (w.puddle * 40 + s.wetness * 0.4) * Math.min(1, (fast + slip) / 4) : 0;
    const mud = w.contact && (w.surface === 3 || w.surface === 2) ? Math.min(1, slip / 3) * (w.surface === 3 ? 1 : 0.4) : 0;
    setRate(sp.water, wet > 0.1 ? wet : 0); setRate(sp.mud, mud > 0.05 ? mud * 2 : 0);
  }
  audio.update(s, rainNow, state.weather.boom || 0);
}
function setRate(ent, amount) {
  // PlayCanvas restarts an emitter's clock when its rate is set, so the rate is only touched when it moves by a
  // quarter or more; below a trickle the emitter stops (its particles live out their lives)
  const ps = ent.particlesystem;
  if (amount <= 0.001) { if (ps.isPlaying() && !ent._stopping) { ps.stop(); ent._stopping = true; } return; }
  if (!ps.isPlaying() || ent._stopping) { ps.play(); ent._stopping = false; }
  const r = 0.05 / (1 + amount * 25);
  if (!ent._rate || Math.abs(r / ent._rate - 1) > 0.25) { ps.rate = r; ps.rate2 = r * 1.6; ent._rate = r; }
}

function hud(dt) {
  if (state.mode !== 'playing') return;
  state.toastT -= dt;
  if (state.toastT < 0) $('toast').classList.remove('show');
  state.hudT -= dt;
  if (state.hudT > 0) return;
  state.hudT = 1 / 20;
  const s = state.sim;
  drawTach($('tach'), s);
  drawGrip($('grip'), s);
  drawClimb($('climb'), s, s.setup.drive === '6x6' && s.setup.lockers);
  $('time').textContent = fmt(s.time);
  $('dist').textContent = `${Math.max(0, s.distance).toFixed(0)} / ${(s.level.summit - s.level.start).toFixed(0)} m`;
  const f = s.out.fwd, grade = f.y / Math.max(0.2, Math.hypot(f.x, f.z));
  $('gradev').textContent = `${Math.round(grade * 100)}%`;
  const lamp = (id, on, label, warn) => { const el = $(id); el.className = 'lamp' + (warn ? ' warn' : on ? ' on' : ''); if (label) el.textContent = label; };
  lamp('l-power', true, s.setup.power === 'diesel' ? 'DIESEL' : `EV ${(s.battery.kwh).toFixed(0)} kWh`);
  lamp('l-drive', s.setup.drive === '6x6', s.setup.drive.toUpperCase());
  lamp('l-lock', s.setup.lockers, 'LOCK');
  lamp('l-low', s.setup.low, 'LOW');
  lamp('l-psi', s.setup.pressure < 6, `${s.setup.pressure.toFixed(1)} BAR`);
  if (s.setup.power === 'diesel') lamp('l-extra', s.setup.fuelMap > 0, ['FUEL STOCK', 'FUEL RICH', 'ROLLING COAL'][s.setup.fuelMap * 2], s.setup.exhaustBrake && s.throttle < 0.02);
  else lamp('l-extra', s.setup.traction, s.setup.traction ? 'TRACTION' : 'TC OFF', s.engine.derate < 0.99);
  $('tune-rows').innerHTML = [
    ['<kbd>X</kbd> drive', s.setup.drive], ['<kbd>K</kbd> lockers', s.setup.lockers ? 'on' : 'open'], ['<kbd>L</kbd> range', s.setup.low ? 'low x2.6' : 'high'],
    ['<kbd>[</kbd><kbd>]</kbd> tyres', `${s.setup.pressure.toFixed(1)} bar`], ['<kbd>F</kbd> fuel map', ['stock', 'rich', 'rolling coal'][s.setup.fuelMap * 2]],
    ['<kbd>J</kbd> exhaust brake', s.setup.exhaustBrake ? 'on' : 'off'], ['<kbd>M</kbd> gearbox', s.setup.auto ? 'auto' : 'manual Q/E'], ['<kbd>T</kbd> EV traction', s.setup.traction ? 'on' : 'off'],
    ['<kbd>C</kbd> camera', CAMS[state.camMode]], ['<kbd>R</kbd> direction', state.reverse ? 'reverse' : 'drive'], ['<kbd>Enter</kbd> / <kbd>Esc</kbd>', 'retry / menu'],
    ['grip of the front left tyre', `mu ${s.wheels[0].mu.toFixed(2)} · ${(s.wheels[0].fz / 1000).toFixed(0)} kN`],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
}

boot().catch((err) => { $('loading').textContent = 'HAUL could not start: ' + err.message; console.error(err); });
