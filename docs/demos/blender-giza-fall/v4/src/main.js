// page: the director. Steps the simulation at 120 Hz under a time scale, records every step for review,
// keeps a full checkpoint every 2 s for the Ankh (branching rewind), runs the fall cinematics, the HUD, the
// director deck, the bet and attract mode. The clock lives here, never in the simulation.
import RAPIER from '../vendor/rapier3d-deterministic-compat-0.21.0.mjs';
import { Duel, DT } from './sim.js';
import { OMENS, OMEN_IDS, FAMILIES } from './omens.js';
import { View, PAINT_IDX, TILE_CODES } from './view.js';
import { Audio } from './audio.js';
import { seedOf } from './pmath.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('giza-duel.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('giza-duel.' + k, JSON.stringify(v)); } catch { /* private window */ } } };
const NAMES = ['Explorer', 'Pusher'];
const audio = new Audio();

// ---------- fall time-curves: a different one every fall (scale as a function of sim seconds since the fall) ----------
const CURVES = {
  'Bullet dip': (t) => (t < 0.35 ? 1 - t * 2.6 : t < 3.4 ? 0.07 : Math.min(1, 0.07 + (t - 3.4) * 0.35)),
  'Stutter': (t) => ((Math.floor(t / 0.42) % 2) ? 1 : 0.1),
  'Long exhale': (t) => (t < 6 ? Math.max(0.16, 1 - t / 2.5) : Math.min(1.6, 0.16 + (t - 6) * 0.3)),
  'Freeze frames': () => 1,
  'Dream': (t) => 0.28 + 0.1 * Math.sin(t * 2.1),
  'Fast-forward': (t) => (t < 1.2 ? 0.2 : 2.4),
  'Random walk': null,   // filled per fall from the view's own random numbers
};
let rnd = Math.random;
function viewRng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

// ---------- state ----------
let R, data, view, sim, round = 0, seed = 0, rec = [], cps = [], inputLog = [], markers = [], hashes = [];
let mode = 'live', reviewStep = 0, reviewRate = 0, speed = 1, acc = 0, last = 0, prev = null, cur = null;
let fallCurve = null, curveName = '', freeze = 0, results = null, nextAt = 0, attract = true, bet = -1;
let tilesCode = null, tilesSig = '';
const score = store.get('score', { explorer: 0, pusher: 0, draws: 0, streak: 0, best: 0 });

function frame() {
  const st = sim.state, W = sim.world;
  const sig = st.tiles.join(); if (sig !== tilesSig) { tilesSig = sig; tilesCode = Uint8Array.from(st.tiles, t => TILE_CODES.indexOf(t)); }
  const pel = new Float32Array(st.pellets.length * 4); st.pellets.forEach((p, i) => { pel.set([p.p[0], p.p[1], p.p[2], PAINT_IDX.indexOf(p.paint)], i * 4); });
  const deb = []; for (const h of st.debris) { const b = W.getRigidBody(h); if (b) { const t = b.translation(), r = b.rotation(); deb.push(h, t.x, t.y, t.z, r.x, r.y, r.z, r.w); } }
  const mag = st.omens.find(o => o.id === 'magstorm');
  return { step: sim.step, t: st.t, poses: Float32Array.from(sim.poses()), deck: [st.deckQ.x, st.deckQ.y, st.deckQ.z, st.deckQ.w], tiles: tilesCode, pellets: pel, debris: Float32Array.from(deb),
    shells: st.shells.map(s => ({ ...s })), omen: { eddy: st.eddy && { ...st.eddy }, gates: st.gates, laser: st.laser && st.laser.slice(), ra: st.ra && { ...st.ra }, pole: mag && mag.pole, wind: st.field.wind.slice(), B: st.field.B },
    figs: sim.figs.map(f => ({ mode: f.s.mode, b: f.s.b, pink: f.s.pink, charge: f.s.charge, grav: f.s.grav, feather: f.s.feather > 0, slip: f.s.slipT > 0, mag: f.s.mag, reload: f.s.reload > 0 })),
    omens: st.omens.map(o => o.id), fall: st.fall && { ...st.fall }, kmult: st.kmult };
}

function newRound(s, keepBet) {
  round++; seed = s >>> 0; rnd = viewRng(seed ^ 0x5bd1e995);
  sim = new Duel(R, data, seed, { chaos: +$('chaos').value, families: families() });
  view.bindSim(sim); rec = [frame()]; prev = cur = rec[0]; cps = [{ step: 0, ck: sim.checkpoint(), log: 0 }]; inputLog = []; markers = []; hashes = [[0, sim.hash()]];
  mode = 'live'; reviewRate = 0; acc = 0; fallCurve = null; curveName = ''; freeze = 0; results = null; if (!keepBet) bet = -1;
  $('result').hidden = true; $('fallhud').hidden = true; feedClear();
  history.replaceState(null, '', '#seed=' + seed);
  $('seed').textContent = 'seed ' + seed; $('round').textContent = 'Duel ' + round;
  updateBet(); feed(`Duel ${round}. The Explorer and the Pusher meet on Khufu's summit, 138.5 m up.`);
}
function families() { const f = {}; for (const k of Object.keys(FAMILIES)) f[k] = $('fam-' + k).checked ? 1 : 0; return f; }
function input(a, v) { if (mode !== 'live' || !sim || sim.state.done) return; sim.input(a, v); inputLog.push({ step: sim.step, a, v }); }

// ---------- one simulation step, with everything the page does about it ----------
function step() {
  sim.tick();
  for (const e of sim.events) handle(e);
  prev = cur; cur = frame(); rec.push(cur);
  if (sim.step % 240 === 0) cps.push({ step: sim.step, ck: sim.checkpoint(), log: inputLog.length });
  if (sim.step % 120 === 0) hashes.push([sim.step, sim.hash()]);
}
function handle(e) {
  const fig = e.fig !== undefined ? NAMES[e.fig] : '';
  switch (e.type) {
    case 'fire': audio.pop(); break;
    case 'hit': audio.splat(); if (e.paint === 'pink') feed(`${fig} is hit with pink paint: easier to throw now.`, 'pink'); break;
    case 'paint': case 'splat': if (Math.random() < 0.3) audio.splat(); break;
    case 'shove': audio.shove(); feed(`${NAMES[e.fig]} shoves ${NAMES[1 - e.fig]} (${e.J.toFixed(0)} N·s).`); mark('shove', '#ffe9b0'); break;
    case 'impact': audio.impact(e.part, e.J, 1); break;
    case 'omen': { const O = OMENS[e.id]; audio.chord(O.family); banner(O); feed(`${O.glyph} ${O.name}: ${O.line}`, O.family); mark(e.id, FAM_COLOR[O.family]); break; }
    case 'strike': audio.thunder(); feed(`Lightning strikes the mast and arcs to the ${NAMES[e.fig]}.`, 'electro'); break;
    case 'launch': audio.whistle(e.T); break;
    case 'slug': audio.zap(); break;
    case 'explode': audio.boom(e.kind === 'slug' ? 1.3 : 1); mark('explode', '#ff8a3a'); break;
    case 'teleport': audio.portal(); feed(`The ${NAMES[e.fig]} steps through the Duat.`, 'meta'); break;
    case 'sunhit': audio.chord('super'); break;
    case 'sudden-death': feed("Ma'at's judgement: from now on, every 5 s, every blow lands 20 % harder.", 'military'); break;
    case 'round-fall': onFall(e); break;
    case 'double-fall': feed('Both of them are going over. Nobody wins this one.'); break;
    case 'round-end': onRoundEnd(e); break;
  }
  view.event(e);
}
const FAM_COLOR = { electro: '#7fb8ff', super: '#ffd36b', meta: '#c48bff', military: '#ff8a5a', paint: '#ff6fbf' };
function mark(kind, color) { markers.push({ step: sim.step, color, kind }); }

// ---------- the fall: pick a time curve, cut cameras, keep score ----------
function onFall(e) {
  const names = Object.keys(CURVES); curveName = names[Math.floor(rnd() * names.length)];
  if (curveName === 'Random walk') { const segs = []; let t = 0; while (t < 60) { const d = 0.4 + rnd() * 1.8; segs.push([t, [0.05, 0.12, 0.25, 0.5, 1, 1.6, 2.4][Math.floor(rnd() * 7)]]); t += d; } fallCurve = (x) => { let v = 1; for (const [t0, s] of segs) if (x >= t0) v = s; return v; }; }
  else fallCurve = CURVES[curveName];
  view.cam.shot = Math.floor(rnd() * 4); view.cam.shotT = 0; view.fallCut = 1.8 + rnd() * 3;
  mark('fall', '#ffffff'); audio.fanfare();
  feed(`${NAMES[e.fig]} goes over the edge! ${e.winner >= 0 ? NAMES[e.winner] + ' holds the summit.' : ''} Time: ${curveName}.`, 'fall');
  $('fallhud').hidden = false; $('curve').textContent = curveName;
}
function onRoundEnd(e) {
  const f = e.fall, w = e.winner;
  if (w === 0) score.explorer++; else if (w === 1) score.pusher++; else score.draws++;
  let betLine = '';
  if (bet >= 0) { if (bet === w) { score.streak++; score.best = Math.max(score.best, score.streak); betLine = `Your call was right. Streak ${score.streak}.`; } else { score.streak = 0; betLine = 'Your call was wrong. Streak reset.'; } }
  store.set('score', score);
  results = { w, f, betLine }; nextAt = performance.now() + 9000;
  $('rtitle').textContent = w >= 0 ? `${NAMES[w]} holds the summit` : 'Both fell. Nobody holds the summit.';
  $('rbody').innerHTML = `${NAMES[f.fig]} fell ${f.drop.toFixed(1)} m in ${f.seconds.toFixed(1)} s and came to rest ${f.drop > 135 ? 'at the foot of the pyramid' : `on course ${f.course} of 203`}.<br>${f.hits} hits, hardest ${f.hardest.toFixed(0)} N·s, peak ${f.peak.toFixed(1)} m/s. Time curve: ${curveName}.<br>${betLine}`;
  $('result').hidden = false; scoreboard();
}

// ---------- review, rewind, the Ankh ----------
function enterReview(stepAt, rate = 0) { if (!rec.length) return; mode = 'review'; reviewStep = Math.max(0, Math.min(rec.length - 1, stepAt)); reviewRate = rate; $('live').classList.remove('on'); }
function goLive() { mode = 'live'; reviewRate = 0; $('live').classList.add('on'); }
function ankh() {
  if (mode !== 'review') return;
  const target = Math.floor(reviewStep), cp = [...cps].reverse().find(c => c.step <= target);
  sim.restore(cp.ck);
  const log = inputLog.slice(0, cp.log); let li = 0; const pending = inputLog.filter(x => x.step >= cp.step && x.step < target);
  while (sim.step < target) { while (li < pending.length && pending[li].step === sim.step) { sim.input(pending[li].a, pending[li].v); li++; } sim.tick(); }
  inputLog = log.concat(pending); rec.length = target + 1; cps = cps.filter(c => c.step <= target); markers = markers.filter(m => m.step <= target); hashes = hashes.filter(h => h[0] <= target);
  const salt = (round * 7919 + target) >>> 0; sim.input('branch', salt); inputLog.push({ step: sim.step, a: 'branch', v: salt });
  cur = prev = rec[target] = frame(); results = null; $('result').hidden = true; fallCurve = sim.state.fall ? fallCurve : null; if (!sim.state.fall) $('fallhud').hidden = true;
  view.bindSim(sim); goLive(); mark('ankh', '#ffd700');
  feed(`☥ The Ankh rewinds to ${(target * DT).toFixed(1)} s and rewrites fate (salt ${salt}).`, 'super'); audio.chord('super');
}
// determinism witness inside the page: re-simulate this duel from its seed and director log, compare step hashes
async function verify() {
  const btn = $('verify'); btn.disabled = true;
  const twin = new Duel(R, data, seed, { chaos: +$('chaos').value, families: families() }); twin.restore(cps[0].ck);   // the duel's own starting state
  const log = inputLog.slice(); let li = 0, bad = 0, checked = 0;
  for (const [s, h] of hashes) {
    while (twin.step < s) { while (li < log.length && log[li].step === twin.step) { twin.input(log[li].a, log[li].v); li++; } twin.tick(); }
    if (twin.hash() !== h) bad++; checked++;
    if (checked % 8 === 0) { btn.textContent = `checking ${checked}/${hashes.length}`; await new Promise(r => setTimeout(r, 0)); }
  }
  twin.world.free();
  btn.textContent = bad ? `${bad} of ${checked} hashes differ` : `replayed: ${checked} of ${checked} hashes equal`; btn.disabled = false;
}

// ---------- HUD ----------
let feedItems = [];
function feed(text, kind = '') { feedItems.unshift({ text, kind, at: performance.now() }); feedItems = feedItems.slice(0, 5); $('feed').innerHTML = feedItems.map(f => `<div class="fi ${f.kind}">${f.text}</div>`).join(''); }
function feedClear() { feedItems = []; $('feed').innerHTML = ''; }
let bannerT = 0;
function banner(O) { $('banner').innerHTML = `<span class="glyph">${O.glyph}</span><div><b>${O.name}</b><small>${FAMILIES[O.family]}</small><p>${O.line}</p></div>`; $('banner').className = 'banner show ' + O.family; clearTimeout(bannerT); bannerT = setTimeout(() => { $('banner').className = 'banner'; }, 5200); }
function cards(fr) {
  fr.figs.forEach((f, i) => {
    const el = $('card' + i), st = [];
    if (f.pink) st.push(`<span class="chip pink">pink ×${f.pink}</span>`); if (f.charge) st.push(`<span class="chip electro">${f.charge > 0 ? '+' : '−'} charge</span>`);
    if (f.grav !== 1) st.push(`<span class="chip super">g ×${f.grav}</span>`); if (f.feather) st.push('<span class="chip green">feather</span>'); if (f.slip) st.push('<span class="chip blue">ice soles</span>');
    el.querySelector('.bar i').style.width = (f.b * 100).toFixed(0) + '%'; el.querySelector('.state').textContent = f.mode === 'fallen' ? 'falling' : f.mode === 'limp' ? 'down' : f.mode === 'rise' ? 'getting up' : f.reload ? 'reloading' : `${f.mag} pellets`;
    el.querySelector('.chips').innerHTML = st.join(''); el.classList.toggle('out', f.mode === 'fallen');
  });
  $('kmult').textContent = fr.kmult > 1.001 ? `blows ×${fr.kmult.toFixed(2)}` : '';
}
function fallHud(fr, scale) {
  if (!fr.fall) return; const i = fr.fall.fig, y = fr.poses[i * 77 + 1];
  const a = rec[Math.max(0, fr.step - 12)] || fr, ya = a.poses[i * 77 + 1], dt = (fr.t - a.t) || 1;
  const sp = Math.hypot(fr.poses[i * 77] - a.poses[i * 77], y - ya, fr.poses[i * 77 + 2] - a.poses[i * 77 + 2]) / dt;
  $('fh').textContent = y.toFixed(1) + ' m'; $('fs').textContent = sp.toFixed(1) + ' m/s'; $('fc').textContent = fr.fall.hits; $('fj').textContent = fr.fall.hardest.toFixed(0) + ' N·s'; $('fx').textContent = '×' + scale.toFixed(2);
}
function scoreboard() { $('score').textContent = `Explorer ${score.explorer} · Pusher ${score.pusher} · draws ${score.draws}` + (score.best ? ` · best streak ${score.best}` : ''); }
function updateBet() { $('bet0').classList.toggle('on', bet === 0); $('bet1').classList.toggle('on', bet === 1); $('betnote').textContent = bet < 0 ? 'Who holds the summit? Call it in the first 10 s.' : `You called the ${NAMES[bet]}.`; }
function timeline() {
  const c = $('tl'), x = c.getContext('2d'), w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio, n = Math.max(rec.length, 120 * 30);
  x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, h * 0.45, w * (rec.length / n), h * 0.1);
  for (const m of markers) { x.fillStyle = m.color; x.fillRect(w * m.step / n - 1, h * 0.15, 3 * devicePixelRatio, h * 0.7); }
  for (const cp of cps) { x.fillStyle = 'rgba(255,215,0,0.5)'; x.fillRect(w * cp.step / n, h * 0.82, 2, h * 0.18); }
  const ph = mode === 'live' ? rec.length - 1 : reviewStep; x.fillStyle = mode === 'live' ? '#7dffb2' : '#ffd700'; x.fillRect(w * ph / n - 1, 0, 3 * devicePixelRatio, h);
  $('tlabel').textContent = `${(ph * DT).toFixed(1)} s${mode === 'review' ? ' · review' : ''}`;
}

// ---------- the loop ----------
function loop(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000 || 0); last = now;
  if (!sim) { requestAnimationFrame(loop); return; }
  let scale = speed, alpha = 0, a = prev, b = cur;
  if (mode === 'live') {
    if (sim.state.fall && fallCurve) scale *= fallCurve(sim.state.t - sim.state.fall.t);
    if (freeze > 0) { freeze -= dtReal; scale = 0; }
    if (!sim.state.done) {
      acc += dtReal * scale; let n = 0;
      while (acc >= DT && n < 10) {
        acc -= DT; step(); n++;
        if (curveName === 'Freeze frames' && sim.events.some(e => e.type === 'impact' && sim.state.fall && e.fig === sim.state.fall.fig && e.J > 260)) { freeze = 0.28; view.shake = 0.5; acc = 0; break; }
      }
      if (n === 10) acc = 0;
    }
    alpha = Math.min(1, acc / DT); a = prev; b = cur;
    if (results && attract && performance.now() > nextAt) newRound((seed + 1) >>> 0);
  } else {
    reviewStep = Math.max(0, Math.min(rec.length - 1, reviewStep + reviewRate * dtReal / DT));
    const i = Math.floor(reviewStep); a = rec[i]; b = rec[Math.min(rec.length - 1, i + 1)]; alpha = reviewStep - i;
    if (reviewStep <= 0 && reviewRate < 0) reviewRate = 0;
  }
  view.fallCutHud = view.fallCut;
  view.draw(a, b, alpha, dtReal, { fall: b.fall && { fig: b.fall.fig, cut: view.fallCut } });
  cards(b); if (b.fall) fallHud(b, mode === 'live' ? scale : reviewRate); timeline();
  $('ts').textContent = mode === 'live' ? (scale === 1 ? '' : `time ×${scale.toFixed(2)}${curveName && sim.state.fall ? ' · ' + curveName : ''}`) : `review ×${reviewRate.toFixed(2)}`;
  requestAnimationFrame(loop);
}

// ---------- wiring ----------
function deck() {
  const box = $('omens'); box.innerHTML = '';
  for (const fam of Object.keys(FAMILIES)) {
    const row = document.createElement('div'); row.className = 'fam';
    row.innerHTML = `<label class="famhead" style="--c:${FAM_COLOR[fam]}"><input type="checkbox" id="fam-${fam}" checked> ${FAMILIES[fam]}</label>`;
    for (const id of OMEN_IDS.filter(k => OMENS[k].family === fam)) { const b = document.createElement('button'); b.className = 'om'; b.style.setProperty('--c', FAM_COLOR[fam]); b.title = OMENS[id].line; b.innerHTML = `${OMENS[id].glyph} ${OMENS[id].name}`; b.onclick = () => input('omen', id); row.appendChild(b); }
    box.appendChild(row);
    row.querySelector('input').onchange = (e) => input('family', [fam, e.target.checked]);
  }
}
function wire() {
  deck();
  $('chaos').oninput = (e) => { $('chaosv').textContent = (+e.target.value).toFixed(2) + '×'; input('chaos', +e.target.value); };
  $('sound').onclick = () => { audio.enable(!audio.on); $('sound').textContent = audio.on ? 'Sound: on' : 'Sound: off'; $('sound').classList.toggle('on', audio.on); };
  for (const s of [0.25, 0.5, 1, 2]) $('sp' + String(s).replace('.', '')).onclick = () => { speed = s; for (const t of [0.25, 0.5, 1, 2]) $('sp' + String(t).replace('.', '')).classList.toggle('on', t === s); };
  $('cam').onchange = (e) => { view.cam.mode = e.target.value; };
  view.onCam = (m) => { $('cam').value = m; };
  $('bet0').onclick = () => { if (sim.state.t < 10 && !sim.state.fall) { bet = 0; updateBet(); } };
  $('bet1').onclick = () => { if (sim.state.t < 10 && !sim.state.fall) { bet = 1; updateBet(); } };
  $('next').onclick = () => newRound((seed + 1) >>> 0); $('again').onclick = () => enterReview(0, 1);
  $('newduel').onclick = () => newRound((Math.random() * 4294967296) >>> 0);
  $('attract').onchange = (e) => { attract = e.target.checked; };
  $('pause').onclick = () => { if (mode === 'live') enterReview(rec.length - 1, 0); else reviewRate = reviewRate ? 0 : 1; };
  $('rew').onclick = () => { enterReview(mode === 'live' ? rec.length - 1 : reviewStep, -1); };
  $('slow').onclick = () => { enterReview(mode === 'live' ? rec.length - 1 : reviewStep, 0.15); };
  $('live').onclick = () => { if (mode === 'review') { reviewStep = rec.length - 1; goLive(); } };
  $('ankh').onclick = ankh; $('verify').onclick = verify;
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(location.href.split('#')[0] + '#seed=' + seed); $('copy').textContent = 'Copied'; } catch { $('copy').textContent = '#seed=' + seed; } };
  const tl = $('tl'); let dragging = false;
  const seek = (e) => { const r = tl.getBoundingClientRect(), n = Math.max(rec.length, 120 * 30); enterReview(Math.round((e.clientX - r.left) / r.width * n), 0); };
  tl.addEventListener('pointerdown', (e) => { dragging = true; tl.setPointerCapture(e.pointerId); seek(e); });
  tl.addEventListener('pointermove', (e) => { if (dragging) seek(e); }); tl.addEventListener('pointerup', () => { dragging = false; });
  $('about').onclick = () => { $('aboutp').hidden = !$('aboutp').hidden; }; $('aboutx').onclick = () => { $('aboutp').hidden = true; };
  $('drawer').onclick = () => document.body.classList.toggle('nodeck');
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); $('pause').click(); } else if (e.key === 'ArrowLeft') { enterReview((mode === 'live' ? rec.length - 1 : reviewStep) - 120, 0); } else if (e.key === 'ArrowRight' && mode === 'review') { reviewStep = Math.min(rec.length - 1, reviewStep + 120); }
    else if (e.key === 'a') ankh(); else if (e.key === 'l') $('live').click(); else if (e.key === 'n') $('next').click();
  });
}

async function boot() {
  $('status').textContent = 'loading physics (Rapier, deterministic build)…';
  await RAPIER.init(); R = RAPIER;
  data = await (await fetch('data/giza.json')).json();
  view = new View($('cv'), data);
  $('status').textContent = "loading v3's baked pyramid (fall.x3d + 11 textures)…";
  // v3's X3D sits next door in the repository; a standalone copy of this page carries it in ./v3/
  let x3d = '../v3/assets/fall.x3d'; try { if (!(await fetch(x3d, { method: 'HEAD' })).ok) x3d = 'v3/assets/fall.x3d'; } catch { x3d = 'v3/assets/fall.x3d'; }
  const rep = await view.loadPyramid(x3d);
  $('status').textContent = ''; $('loader').hidden = true;
  $('x3dinfo').textContent = `${rep.shapes} shapes, ${Math.round(rep.triangles).toLocaleString()} triangles, ${rep.textures} textures read from v3's X3D; skipped: ${Object.entries(rep.skipped).map(([k, v]) => `${k} ${v}`).join(', ')}`;
  wire(); scoreboard();
  const m = location.hash.match(/seed=(\d+)/), s = m ? +m[1] : seedOf(new Date().toISOString().slice(0, 10));
  newRound(s);
  window.__duel = { get sim() { return sim; }, get rec() { return rec; }, get mode() { return mode; }, view, enterReview, ankh, goLive, newRound, verify, input, setSpeed: (s) => { speed = s; }, fast: (n) => { for (let i = 0; i < n && !sim.state.done; i++) step(); } };
  requestAnimationFrame(loop);
}
boot().catch((e) => { $('status').textContent = 'Could not start: ' + e.message; console.error(e); });
