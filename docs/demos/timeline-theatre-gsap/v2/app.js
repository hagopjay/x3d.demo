import { bake } from './src/bake.js';
import { embed } from './src/x3d-write.js';
import { toChannelValue, sampleChannel, distValue, COMPONENTS } from './src/model.js';
import { eulerToQuat, quatToAxisAngle } from './src/math.js';
import * as O from './src/orrery.js';
import { clone, authoredTimes } from './src/gsap-core.js';

const $ = (id) => document.getElementById(id), fmt = (x, d = 3) => (x === 0 ? '0' : Math.abs(x) < 1e-3 ? Number(x).toExponential(d - 1) : Number(x).toPrecision(d)), kb = (n) => (n / 1024).toFixed(n > 1e6 ? 0 : 1) + ' KB';
const RECEIPTS = {}, FILES = { orrery: 'data/receipt-gsap-orrery.json', orbit: 'data/receipt-gsap-orbit.json', theatre: 'data/receipt-theatre-box.json' };
for (const k in FILES) RECEIPTS[k] = await (await fetch(FILES[k])).json();
const TH = await (await fetch('data/theatre-box.oracle.json')).json(), STAGE = await (await fetch('scenes/stage.x3d')).text();
const env = RECEIPTS.orrery.env;

/* ------------------------------------------------------------------ cases */
const GHOST_ORRERY = `<Switch DEF='GhostSw' whichChoice='-1'><Transform DEF='Ghost'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.12 0.3' transparency='0.45'/></Appearance><Sphere radius='0.64'/></Shape></Transform></Switch>`;
const GHOST_BOX = `<Switch DEF='GhostSw' whichChoice='-1'><Transform DEF='Ghost'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.12 0.3' transparency='0.5'/></Appearance><Box size='1.62 1.62 1.62'/></Shape></Transform></Switch>`;
const num = (a) => a.map((x) => +x.toFixed(5));

function orreryCase() {
  const targets = clone(O.rest()), g = O.build(gsap, targets); g.pause(0); gsap.ticker.lagSmoothing(0);
  const authored = authoredTimes(g, targets);
  const evalAt = (t) => { g.time(t, false); return clone(targets); };
  const ghostAt = (t) => { const s = evalAt(t).S10; return { t: num([s.translation.x, s.translation.y, s.translation.z]), s: num([s.scale.x, s.scale.y, s.scale.z]) }; };
  return { id: 'orrery', tool: 'GSAP', title: 'Orrery', duration: g.duration(), rest: O.rest(), evalAt, authored,
    ghostLabel: 'ghost on satellite 10: GSAP\'s own eases vs the exported file', ghostChannel: 'S10.translation',
    ghostXml: GHOST_ORRERY, base: (ghostOn) => O.sceneX3d().replace('<!--GHOST-->', ghostXml(GHOST_ORRERY)), ghostAt, linesOfJs: O.build.toString().split('\n').length,
    group: (k) => k.replace(/^(S|SM)\d+/, '$1*'), defaults: { fps: 30, tol: 2 }, name: 'orrery' };
}
let ghostXml = (x) => x;   // the ghost node is always in the file (Switch hides it): toggling it is a message, not a reload

function theatreCase() {
  const n = TH.samples[0].length, rest = TH.rest;
  const at = (t) => { const x = Math.min(n - 1.000001, Math.max(0, t * TH.hz)), i = Math.floor(x), u = x - i; return (arr) => arr[i] * (1 - u) + arr[i + 1] * u; };
  const evalAt = (t) => { const L = at(t), s = JSON.parse(JSON.stringify(rest)); TH.paths.forEach(([d, f, c], k) => { if (c) s[d][f][c] = L(TH.samples[k]); else s[d][f] = L(TH.samples[k]); }); return s; };
  const authored = new Map(); for (const [k, ks] of Object.entries(TH.authored)) { const [d, f] = k.split('.'); const key = d + '.' + f; (authored.get(key) || authored.set(key, new Set()).get(key)); for (const x of ks) authored.get(key).add(x.t); }
  const ghostAt = (t) => { const s = evalAt(t).Box, q = quatToAxisAngle(eulerToQuat(s.rotation.x, s.rotation.y, s.rotation.z)); return { t: num([s.translation.x, s.translation.y, s.translation.z]), s: num([s.scale.x, s.scale.y, s.scale.z]), r: num(q) }; };
  return { id: 'theatre', tool: 'Theatre.js', title: 'Box', duration: TH.duration, rest, evalAt, authored, ghostLabel: 'ghost on the box: @theatre/core\'s own curves vs the exported file', ghostChannel: 'Box.translation',
    base: () => STAGE.replace('<!--GHOST-->', GHOST_BOX), ghostAt, linesOfJs: null, group: (k) => k, defaults: { fps: 60, tol: 1 }, name: 'theatre_box', handles: TH.authored, resampleErr: TH.resampleMaxErr };
}

/* ------------------------------------------------------------------ state */
const S = { caseId: 'orrery', C: null, res: null, xml: '', fps: 30, tol: 2, playing: true, pos: 0, speed: 1, mode: 'cond', ghost: false, ready: { xite: false, bridge: false }, loaded: { xite: false, bridge: false }, spark: [], ghostErr: 0 };
const frames = { xite: $('p-xite'), bridge: $('p-bridge') };
const send = (m) => { for (const k in frames) if (S.ready[k]) frames[k].contentWindow.postMessage(m, '*'); };
const status = (t) => { $('status').textContent = t || ''; };

window.addEventListener('message', (e) => { const m = e.data; if (!m || !m.pane) return;
  if (m.ready) { S.ready[m.pane] = true; $('v-' + m.pane).textContent = m.version; if (S.xml) loadPane(m.pane); }
  if (m.loaded) { S.loaded[m.pane] = true; if (S.loaded.xite && S.loaded.bridge) status(''); }
  if (m.fps !== undefined) $('f-' + m.pane).textContent = m.fps + ' fps (this machine)';
  if (m.error) status(m.pane + ': ' + m.error); });
const loadPane = (k) => frames[k].contentWindow.postMessage({ cmd: 'load', xml: S.xml, mode: S.mode === 'cond' ? 'conductor' : 'auto' }, '*');

/* ------------------------------------------------------------------ compile */
function compile() {
  const C = S.C, t0 = performance.now();
  const res = bake(C.name, C.evalAt, C.rest, { duration: C.duration, fps: S.fps, must: C.authored, tol: S.tol });
  const ms = performance.now() - t0, xml = embed(C.base(), res.timeline, { loop: true });
  S.res = res; S.xml = xml; S.compileMs = ms; S.worst = res.report.reduce((a, r) => (r.maxErr > a.maxErr ? r : a), res.report[0]);
  const keys = res.timeline.channels.reduce((n, c) => n + c.keys.length, 0), samples = res.report.reduce((n, r) => n + r.samples, 0);
  $('stat').innerHTML = [[res.timeline.channels.length, 'interpolators (channels)'], [keys.toLocaleString(), 'keys written'], [kb(xml.length), 'the .x3d file'], [C.linesOfJs ? C.linesOfJs + ' lines' : 'a saved state', C.linesOfJs ? 'of JavaScript it replaces' : 'of Theatre JSON it replaces'],
    [fmt(S.worst.maxErr, 2), `worst error (${S.worst.def}.${S.worst.field}${S.worst.type === 'SFRotation' ? ', rad' : ''})`], [Math.round(ms) + ' ms', `compile in this browser (${samples.toLocaleString()} samples)`]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  const chs = res.timeline.channels; $('chsel').innerHTML = chs.map((c, i) => `<option value="${i}">${c.def}.${c.field}</option>`).join('');
  const want = chs.findIndex((c) => c.def + '.' + c.field === C.ghostChannel); if (want >= 0) $('chsel').value = want; fillComps(); drawSheet(); drawPlot();
  $('sheetnote').textContent = `Rows group channels of one kind. Amber ticks are keys the compiler wrote (a dense row means the ease needs many straight pieces); teal diamonds are keys or tween boundaries you authored and which the compiler always keeps. ${C.id === 'theatre' ? 'The Theatre curves are @theatre/core samples at ' + TH.hz + ' Hz, resampled linearly in this page (largest resampling error ' + C.resampleErr + ').' : ''}`;
}
function reload() { S.loaded = { xite: false, bridge: false }; status('compiling, then reloading both engines'); for (const k in frames) if (S.ready[k]) loadPane(k); }

/* ------------------------------------------------------------------ dopesheet */
function sizeCanvas(cv, h) { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(300, r.width); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, w, h]; }
let sheetGeom = null;
function drawSheet() {
  const C = S.C, tl = S.res.timeline, rows = new Map();
  for (const ch of tl.channels) { const k = C.group(ch.def + '.' + ch.field); (rows.get(k) || rows.set(k, { k, ch: [], authored: new Set(), n: 0 }).get(k)).ch.push(ch); }
  for (const [k, set] of C.authored) { const rk = C.group(k); if (rows.has(rk)) for (const t of set) rows.get(rk).authored.add(+t.toFixed(4)); }
  const list = [...rows.values()], rowH = 26, top = 22, h = top + list.length * rowH + 22, cv = $('sheet'), ph = $('sheetph');
  const [g, w] = sizeCanvas(cv, h); sizeCanvas(ph, h); const L = 150, R = w - 14, X = (t) => L + (t / C.duration) * (R - L);
  g.fillStyle = '#080c18'; g.fillRect(0, 0, w, h); g.font = '10.5px ui-monospace,monospace'; g.textBaseline = 'middle';
  for (let s = 0; s <= C.duration; s += 1) { g.strokeStyle = '#18213a'; g.beginPath(); g.moveTo(X(s), top - 4); g.lineTo(X(s), h - 16); g.stroke(); g.fillStyle = '#69759a'; g.fillText(s + ' s', X(s) + 3, 10); }
  list.forEach((r, i) => { const y = top + i * rowH + rowH / 2, nk = r.ch.reduce((a, c) => a + c.keys.length, 0);
    g.fillStyle = i % 2 ? '#0a0f1d' : '#0c1222'; g.fillRect(0, y - rowH / 2, w, rowH); g.fillStyle = '#c4cde6'; g.fillText(r.k + (r.ch.length > 1 ? ' ×' + r.ch.length : ''), 8, y - 5); g.fillStyle = '#69759a'; g.fillText(nk.toLocaleString() + ' keys', 8, y + 7);
    g.strokeStyle = 'rgba(255,180,84,.20)'; g.lineWidth = 1; g.beginPath(); for (const c of r.ch) for (const k of c.keys) { const x = Math.round(X(k.t)) + .5; g.moveTo(x, y - rowH / 2 + 3); g.lineTo(x, y + rowH / 2 - 3); } g.stroke();
    g.fillStyle = '#37d5c2'; for (const t of r.authored) { const x = X(t); g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.closePath(); g.fill(); } });
  sheetGeom = { L, R, w, h, top }; $('sheet').onclick = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left; if (x > L) { S.playing = false; $('play').textContent = 'play'; S.pos = Math.max(0, Math.min(1, (x - L) / (R - L))) * C.duration; syncUi(); sendFrame(); } };
}
function drawPlayhead() { if (!sheetGeom) return; const ph = $('sheetph'), g = ph.getContext('2d'), { L, R, w, h } = sheetGeom; g.clearRect(0, 0, w, h); const x = L + (S.pos / S.C.duration) * (R - L); g.strokeStyle = '#ff5d6c'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 14); g.lineTo(x, h - 12); g.stroke(); g.fillStyle = '#ff5d6c'; g.beginPath(); g.moveTo(x - 5, 12); g.lineTo(x + 5, 12); g.lineTo(x, 20); g.fill(); }

/* ------------------------------------------------------------------ inspector */
function fillComps() { const ch = S.res.timeline.channels[+$('chsel').value], comps = ch.type === 'SFRotation' ? ['axis x', 'axis y', 'axis z', 'angle'] : (COMPONENTS[ch.type] || ['value']); $('compsel').innerHTML = comps.map((c, i) => `<option value="${i}">${c}</option>`).join(''); if (comps.length > 1) { let best = 0, bv = -1; comps.forEach((_, i) => { const r = Math.max(...ch.keys.map((k) => k.v[i])) - Math.min(...ch.keys.map((k) => k.v[i])); if (r > bv) { bv = r; best = i; } }); $('compsel').value = best; } }
function drawPlot() {
  const C = S.C, ch = S.res.timeline.channels[+$('chsel').value], ci = +$('compsel').value, cv = $('plot'), [g, w, h] = sizeCanvas(cv, 340), L = 52, R = w - 14, T = 18, B = h - 80, EB = h - 12;
  const N = 480, ts = Array.from({ length: N + 1 }, (_, i) => (C.duration * i) / N), tru = ts.map((t) => toChannelValue(ch.type, C.evalAt(t)[ch.def][ch.field])[ci]), bak = ts.map((t) => sampleChannel(ch, t)[ci]);
  let lo = Math.min(...tru, ...bak), hi = Math.max(...tru, ...bak); if (hi - lo < 1e-9) { hi = lo + 1; } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = (t) => L + (t / C.duration) * (R - L), Y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
  g.fillStyle = '#080c18'; g.fillRect(0, 0, w, h); g.font = '10.5px ui-monospace,monospace'; g.fillStyle = '#69759a'; g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, y = Y(v); g.strokeStyle = '#18213a'; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.fillText(v.toFixed(2), 6, y); }
  for (let s = 0; s <= C.duration; s += 1) { g.fillText(s + ' s', X(s) - 8, B + 14); }
  // Theatre Bezier handles, drawn from the saved state
  const hk = C.handles && C.handles[ch.def + '.' + ch.field + '.' + ['x', 'y', 'z'][ci]];
  if (hk) for (let i = 0; i + 1 < hk.length; i++) { const A = hk[i], Bk = hk[i + 1], dt = Bk.t - A.t, dv = Bk.v - A.v; const c1 = [A.t + A.handles[2] * dt, A.v + A.handles[3] * dv], c2 = [A.t + Bk.handles[0] * dt, A.v + Bk.handles[1] * dv];
    g.strokeStyle = 'rgba(156,139,255,.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(A.t), Y(A.v)); g.lineTo(X(c1[0]), Y(c1[1])); g.moveTo(X(Bk.t), Y(Bk.v)); g.lineTo(X(c2[0]), Y(c2[1])); g.stroke(); g.fillStyle = '#9c8bff'; for (const c of [c1, c2]) { g.beginPath(); g.arc(X(c[0]), Y(c[1]), 3, 0, 7); g.fill(); } }
  g.lineWidth = 2.6; g.strokeStyle = 'rgba(93,180,255,.9)'; g.beginPath(); ts.forEach((t, i) => (i ? g.lineTo(X(t), Y(tru[i])) : g.moveTo(X(t), Y(tru[i])))); g.stroke();
  g.lineWidth = 1.4; g.strokeStyle = '#ffb454'; g.beginPath(); ch.keys.forEach((k, i) => (i ? g.lineTo(X(k.t), Y(k.v[ci])) : g.moveTo(X(k.t), Y(k.v[ci])))); g.stroke(); g.fillStyle = '#ffb454'; if (ch.keys.length < 400) for (const k of ch.keys) { g.beginPath(); g.arc(X(k.t), Y(k.v[ci]), 2.2, 0, 7); g.fill(); }
  const au = C.authored.get(ch.def + '.' + ch.field); if (au) { g.fillStyle = '#37d5c2'; for (const t of au) { const v = toChannelValue(ch.type, C.evalAt(t)[ch.def][ch.field])[ci], x = X(t), y = Y(v); g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill(); } }
  const err = ts.map((t, i) => Math.abs(tru[i] - bak[i])), em = Math.max(...err, 1e-12);
  g.fillStyle = '#0a0f1d'; g.fillRect(L, B + 22, R - L, EB - B - 22); g.fillStyle = 'rgba(255,93,108,.75)'; g.beginPath(); g.moveTo(L, EB); ts.forEach((t, i) => g.lineTo(X(t), EB - (err[i] / em) * (EB - B - 26))); g.lineTo(R, EB); g.fill();
  g.fillStyle = '#9aa6c4'; g.fillText('error, tallest = ' + fmt(em, 2), L + 6, B + 31);
  $('chread').textContent = `${ch.keys.length} keys written, ${C.authored.get(ch.def + '.' + ch.field) ? C.authored.get(ch.def + '.' + ch.field).size + ' authored' : 'tween bounds are the authored keys'}; max error on this component ${fmt(em, 2)}`;
  $('plotnote').textContent = 'Blue: the tool\'s own curve, sampled in this page. Amber: what the X3D interpolator plays (straight pieces). ' + (hk ? 'Violet: the Bezier handles saved in the Theatre state. ' : '') + 'Teal diamonds: keys you authored. Rotations are plotted as axis-angle, which is what OrientationInterpolator stores.';
}
$('chsel').onchange = () => { fillComps(); drawPlot(); }; $('compsel').onchange = drawPlot;

/* ------------------------------------------------------------------ transport and ghost */
function ghostPayload() { if (!S.ghost) return { on: false }; const g = S.C.ghostAt(S.pos); return { on: true, ...g }; }
function sendFrame() { if (S.mode !== 'cond') return; send({ cmd: 'frac', f: S.pos / S.C.duration, ghost: ghostPayload() }); }
function syncUi() { $('scrub').value = S.pos / S.C.duration; $('tread').textContent = S.pos.toFixed(2) + ' s of ' + S.C.duration.toFixed(2) + ' s'; drawPlayhead();
  if (S.ghost) { const ch = S.res.timeline.channels.find((c) => c.def + '.' + c.field === S.C.ghostChannel); if (ch) { const [d, f] = S.C.ghostChannel.split('.'), o = toChannelValue(ch.type, S.C.evalAt(S.pos)[d][f]), e = distValue(ch.type, sampleChannel(ch, S.pos), o); S.ghostErr = e; S.spark.push(e); if (S.spark.length > 210) S.spark.shift(); $('gerr').textContent = 'Δ ' + fmt(e, 2) + ' units'; drawSpark(); } } }
function drawSpark() { const cv = $('gspark'), g = cv.getContext('2d'), w = cv.width, h = cv.height, m = Math.max(...S.spark, 1e-9); g.clearRect(0, 0, w, h); g.strokeStyle = '#ff5d6c'; g.lineWidth = 1.5; g.beginPath(); S.spark.forEach((v, i) => { const x = (i / 209) * w, y = h - 3 - (v / m) * (h - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
let last = performance.now();
function loop(now) { const dt = (now - last) / 1000; last = now; if (S.playing && S.mode === 'cond') { S.pos = (S.pos + dt * S.speed) % S.C.duration; syncUi(); sendFrame(); } requestAnimationFrame(loop); }
$('scrub').oninput = (e) => { S.playing = false; $('play').textContent = 'play'; if (S.mode === 'auto') setMode('cond'); S.pos = +e.target.value * S.C.duration; syncUi(); sendFrame(); };
$('play').onclick = () => { if (S.mode === 'auto') { setMode('cond'); } S.playing = !S.playing; $('play').textContent = S.playing ? 'pause' : 'play'; };
document.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => { S.speed = +b.dataset.sp; document.querySelectorAll('[data-sp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
function setMode(m) { S.mode = m; $('m-cond').setAttribute('aria-pressed', String(m === 'cond')); $('m-auto').setAttribute('aria-pressed', String(m === 'auto')); send({ cmd: 'mode', mode: m === 'cond' ? 'conductor' : 'auto' }); if (m === 'auto') { S.ghost = false; applyGhostUi(); } else sendFrame(); }
$('m-cond').onclick = () => setMode('cond'); $('m-auto').onclick = () => setMode('auto');
function applyGhostUi() { $('ghost').setAttribute('aria-pressed', String(S.ghost)); $('ghostbox').style.display = S.ghost ? '' : 'none'; $('ghostlabel').textContent = S.C.ghostLabel; if (!S.ghost) send({ cmd: 'frac', f: S.pos / S.C.duration, ghost: { on: false } }); else { S.spark = []; sendFrame(); syncUi(); } }
$('ghost').onclick = () => { if (S.mode === 'auto') setMode('cond'); S.ghost = !S.ghost; applyGhostUi(); };
$('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([S.xml], { type: 'model/x3d+xml' })); a.download = `${S.C.name}-fps${S.fps}-tol${S.tol}.x3d`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
$('tol').oninput = (e) => { $('tolv').textContent = (+e.target.value).toFixed(1); };
$('tol').onchange = (e) => { S.tol = +e.target.value; rebuild(); };
document.querySelectorAll('[data-fps]').forEach((b) => (b.onclick = () => { S.fps = +b.dataset.fps; fpsUi(); rebuild(); }));
const fpsUi = () => document.querySelectorAll('[data-fps]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.fps === S.fps)));
$('rebuild').onclick = () => rebuild();
function rebuild() { status('compiling'); setTimeout(() => { compile(); reload(); }, 20); }
function setCase(id) {
  S.caseId = id; S.C = id === 'orrery' ? orreryCase() : theatreCase(); S.fps = S.C.defaults.fps; S.tol = S.C.defaults.tol; S.pos = 0; S.ghost = false; S.spark = [];
  $('tol').value = S.tol; $('tolv').textContent = S.tol.toFixed(1); fpsUi(); $('c-orrery').setAttribute('aria-pressed', String(id === 'orrery')); $('c-theatre').setAttribute('aria-pressed', String(id === 'theatre'));
  applyGhostUi(); compile(); reload();
}
$('c-orrery').onclick = () => setCase('orrery'); $('c-theatre').onclick = () => setCase('theatre');

/* ------------------------------------------------------------------ tiles, cards, receipts */
const R = RECEIPTS, all = [R.orrery, R.orbit, R.theatre], mx = (f) => Math.max(...all.map(f)), mn = (f) => Math.min(...all.map(f));
const tile = (c, b, s, sm) => `<div class="tile" style="--c:var(${c})"><b>${b}</b><span>${s}</span><small>${sm}</small></div>`;
$('tiles').innerHTML = tile('--amber', fmt(mx((r) => r.worstBridgeVsXite), 2), 'bridge vs X_ITE, worst interpolator output', `${all.reduce((n, r) => n + r.channels, 0)} channels in 3 timelines, ${all[0].fractions} fractions each; three.js r${env.bridge.three} against X_ITE ${env.x_ite}`)
 + tile('--teal', fmt(mx((r) => r.worstXiteVsOurs), 2), 'this page\'s interpolator model vs X_ITE', 'HSV colour, slerp, the achromatic-hue rule: the ghost number is computed with it')
 + tile('--violet', fmt(R.theatre.worstXiteVsOracle, 2) + ' / ' + fmt(R.orbit.worstXiteVsOracle, 2) + ' / ' + fmt(R.orrery.worstXiteVsOracle, 2), 'X_ITE vs the tool itself: Theatre / GSAP orbit / orrery', 'the price of straight lines in place of curves')
 + tile('--sage', mn((r) => Math.min(r.minPsnrInterp, r.minPsnrLive)).toFixed(1) + ' dB', 'worst picture pair, bridge vs X_ITE', `${all.length * 6} pairs, 320x240, ${env.chromium} SwiftShader, foreground IoU at least ${mn((r) => r.minIou)}`)
 + tile('--coral', R.orrery.keys.toLocaleString(), 'keys in the orrery X3D', `${R.orrery.channels} channels from about 20 lines of GSAP, no script in the file`);
$('cards').innerHTML = [
 ['--amber', 'HSV', 'ColorInterpolator does not blend in RGB', `X3D blends colours in HSV space, and X_ITE does exactly that. GSAP and Theatre tween RGB. A compiler that ignores this left a colour channel 0.059 away from X_ITE on the first run; modelling it brought that to 7.6e-8. One more rule found in X_ITE's source: if one end is grey, it borrows the other end's hue. (Measured: X_ITE 16.6.0.)`],
 ['--teal', fmt(R.orrery.worstBridgeVsXite, 2), 'two engines, one file, same numbers', `Both engines read the orrery's ${R.orrery.channels} interpolators and ROUTEs and land within ${fmt(R.orrery.worstBridgeVsXite, 2)} of each other at 41 points of the cycle. The pictures differ only where lighting does: PSNR ${R.orrery.minPsnrInterp.toFixed(1)} dB at worst, foreground IoU ${R.orrery.minIou}. (X_ITE 16.6.0 vs three.js r187 bridge, Chromium 153 SwiftShader.)`],
 ['--violet', 'floor', 'the sample rate sets an error floor', 'A sharp ease (bounce, elastic, steps) has kinks between samples that tolerance cannot fix. bounce.out stays at 0.0145 whether it takes 120, 47 or 24 keys at 60 fps; steps(6) cannot be straight pieces at all (0.139). Raise the sample rate, not the tolerance. Try it: set 15 fps and 120 fps in the compiler above.'],
 ['--coral', 'camera', 'a camera under an animated Transform was not followed (found here, fixed upstream)', 'In X_ITE a bound Viewpoint follows its parent Transform when you animate it. In the three.js body it does not (object area 2912 px in X_ITE, 13456 px in the bridge after the same move; static placement agrees). Reported to the bridge owner and fixed on x3d.loom PR #75 (third reading 2912 px). This demo still moves the world, not the camera, so it runs on either build. (Measured: one probe scene, Chromium 153 SwiftShader.)'],
 ['--sky', 'live', 'you can leave the file out of it', 'The ghost is GSAP\'s real eases, evaluated live and written into the scene through the SAI. The same one-line push works for X_ITE and the bridge, so a page can keep GSAP\'s clock and its curves with no baking at all. The exported file is the portable version of the same animation.'],
 ['--sage', 'AGPL', 'the editor is not in the file', 'Theatre\'s core (Apache-2.0) evaluates the saved state; its studio (AGPL-3.0-only) is only the editor an author runs. The X3D carries no Theatre code and this page has none either: the Theatre curves are samples core made earlier.'],
].map(([c, n, h, p]) => `<div class="card" style="--c:var(${c})"><div class="n">${n}</div><h3>${h}</h3><p>${p}</p></div>`).join('');
$('rt').innerHTML = `<tr><th>timeline</th><th>tool</th><th>channels</th><th>keys</th><th>X_ITE vs tool (worst)</th><th>model vs X_ITE</th><th>bridge vs X_ITE</th><th>live read-back</th><th>min PSNR</th><th>min IoU</th></tr>`
 + [['Orrery', R.orrery], ['Orbit', R.orbit], ['Box', R.theatre]].map(([n, r]) => `<tr><td>${n}</td><td>${r.tool}</td><td>${r.channels}</td><td>${r.keys.toLocaleString()}</td><td>${fmt(r.worstXiteVsOracle, 2)}</td><td>${fmt(r.worstXiteVsOurs, 2)}</td><td>${fmt(r.worstBridgeVsXite, 2)}</td><td>${fmt(r.liveReadbackErr, 2)}</td><td>${Math.min(r.minPsnrInterp, r.minPsnrLive).toFixed(2)} dB</td><td>${r.minIou}</td></tr>`).join('');
$('rnote').textContent = `Rig: ${env.chromium} headless on SwiftShader, X_ITE ${env.x_ite}, three.js r${env.bridge.three} with the x3d.threejs body, GSAP 3.15.1, @theatre/core 0.7.2, Node 22. Values in scene units, rotations in radians. Pictures: 320x240, 3 fractions x 2 paths (interpolators, live SAI) per timeline. The orrery was baked at 30 fps, tolerance x1. No frame rates are quoted: software GL is about 0.6 s a frame.`;

/* ------------------------------------------------------------------ go */
setCase('orrery'); for (const k in frames) frames[k].contentWindow.postMessage({ cmd: 'hello' }, '*'); requestAnimationFrame(loop); addEventListener('resize', () => { drawSheet(); drawPlot(); });
