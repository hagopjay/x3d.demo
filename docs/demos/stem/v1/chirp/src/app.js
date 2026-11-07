/* Chirp. Shows computed states only: the orbit samples and both audio tracks are checked against their
   case manifest (sha256) before use. Positions and the wave pattern come from the verified samples (192 per
   orbit, linear between them; the builder bounds that error), the pattern by the far-field quadrupole
   formula at the retarded time t - R. The page reproduces the builder's reference heights before it shows a
   green row. Playback is driven by the scene's TimeSensor. */
"use strict";
const $ = (id) => document.getElementById(id);
const SCALE = 1 / 50, R_IN = 12, R_OUT = 150, NR = 110, NA = 192, WATCH_SECONDS = 45;
const state = { index: [], id: null, case: null, rows: null, audio: {}, track: "real", lens: "explorer", mode: null,
  t: 0, hmax: 1, epoch: 0, check: null, view: "Close" };
let B, scene, nodes = {}, ripple = null, player = null;

const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
const fmt = (x) => { if (typeof x !== "number") return String(x); const a = Math.abs(x); return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(+x.toPrecision(5)); };

async function verifiedBytes(frame) {
  const res = await fetch(frame.file, { cache: "no-store" });
  if (!res.ok) throw Error("missing payload " + frame.file);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== frame.bytes || (await sha(bytes)) !== frame.sha256) throw Error("payload does not match its manifest: " + frame.file);
  if (!frame.decoded_sha256) return bytes;
  const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  if (raw.byteLength !== frame.decoded_bytes || (await sha(raw)) !== frame.decoded_sha256) throw Error("decoded payload does not match its manifest: " + frame.file);
  return raw;
}

// ---------- sampling the verified orbit ----------
const COLS = 6;   // t, x, y, Qdd_xx, Qdd_xy, Qdd_yy
function find(t) {   // last row with time <= t
  const R = state.rows, n = R.length / COLS;
  let lo = 0, hi = n - 1;
  if (t <= R[0]) return 0;
  if (t >= R[(n - 1) * COLS]) return n - 2;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R[mid * COLS] <= t) lo = mid; else hi = mid; }
  return lo;
}
function at(t, col) {   // linear between samples, as numpy.interp in the builder (clamped at the ends)
  const R = state.rows, n = R.length / COLS;
  if (t <= R[0]) return R[col];
  if (t >= R[(n - 1) * COLS]) return R[(n - 1) * COLS + col];
  const i = find(t), t0 = R[i * COLS], t1 = R[(i + 1) * COLS], f = (t - t0) / (t1 - t0);
  return R[i * COLS + col] * (1 - f) + R[(i + 1) * COLS + col] * f;
}
/* In-plane observer at (R, phi): h+ = -Qdd_phiphi(t - R) / R; zero before the run began (no wave yet). */
function height(t, R, phi) {
  const tr = t - R;
  if (tr < 0) return 0;
  const qxx = at(tr, 3), qxy = at(tr, 4), qyy = at(tr, 5), s = Math.sin(phi), c = Math.cos(phi);
  return -(qxx * s * s - 2 * qxy * s * c + qyy * c * c) / R;
}

// ---------- the scene ----------
function buildRipple() {
  const its = scene.createNode("IndexedTriangleSet"), coord = scene.createNode("Coordinate"), col = scene.createNode("Color");
  const idx = new Int32Array((NR - 1) * NA * 6);
  let k = 0;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + (j + 1) % NA, c = (i + 1) * NA + j, d = (i + 1) * NA + (j + 1) % NA;
    idx.set([a, c, b, b, c, d], k); k += 6;
  }
  its.index.setValue(idx); its.solid = false; its.colorPerVertex = true; its.normalPerVertex = true;
  its.coord = coord; its.color = col;
  scene.getNamedNode("Ripple").geometry = its;
  const radii = Float64Array.from({ length: NR }, (_, i) => R_IN + (R_OUT - R_IN) * (i / (NR - 1)) ** 1.3);
  const sin = Float64Array.from({ length: NA }, (_, j) => Math.sin(2 * Math.PI * j / NA)), cos = Float64Array.from({ length: NA }, (_, j) => Math.cos(2 * Math.PI * j / NA));
  ripple = { coord, col, radii, sin, cos, pos: new Float32Array(NR * NA * 3), rgb: new Float32Array(NR * NA * 3) };
}

const lin = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
const CREST = lin("#f2a65a"), MID = lin("#c9d3e6"), TROUGH = lin("#3d6fd6");
function drawAt(t) {
  state.t = t;
  const P = state.case.parameters, m1 = P.m1_msun / (P.m1_msun + P.m2_msun), m2 = 1 - m1;
  const x = at(t, 1), y = at(t, 2);
  nodes.hole1.translation = new X3D.SFVec3f(m2 * x * SCALE, 0, -m2 * y * SCALE);
  nodes.hole2.translation = new X3D.SFVec3f(-m1 * x * SCALE, 0, m1 * y * SCALE);
  // trails: the last orbit of computed samples (192 rows)
  const i = find(t), from = Math.max(0, i - 192), n = i - from + 1, p1 = new Float32Array(3 * n), p2 = new Float32Array(3 * n), R = state.rows;
  for (let k = 0; k < n; k++) {
    const r = (from + k) * COLS;
    p1.set([m2 * R[r + 1] * SCALE, 0, -m2 * R[r + 2] * SCALE], 3 * k); p2.set([-m1 * R[r + 1] * SCALE, 0, m1 * R[r + 2] * SCALE], 3 * k);
  }
  const poly = Int32Array.from({ length: n + 1 }, (_, k) => (k < n ? k : -1));
  nodes.trail1.point.setValue(p1); nodes.trail2.point.setValue(p2);
  nodes.lines1.coordIndex.setValue(poly); nodes.lines2.coordIndex.setValue(poly);
  // the wave surface: one interpolation of Qdd per ring, then every angle
  const { radii, sin, cos, pos, rgb } = ripple, k = 0.22 / state.hmax;
  for (let a = 0; a < NR; a++) {
    // display taper: the near zone (R < 12 M) is not drawn and heights fade in up to 24 M, where the far-field formula starts to hold
    const Rr = radii[a], tr = t - Rr, live = tr >= 0, u0 = Math.min(1, (Rr - R_IN) / R_IN), taper = u0 * u0 * (3 - 2 * u0);
    const qxx = live ? at(tr, 3) : 0, qxy = live ? at(tr, 4) : 0, qyy = live ? at(tr, 5) : 0;
    for (let b = 0; b < NA; b++) {
      const s = sin[b], c = cos[b], h = live ? -(qxx * s * s - 2 * qxy * s * c + qyy * c * c) / Rr : 0, o = 3 * (a * NA + b);
      pos[o] = Rr * c * SCALE; pos[o + 1] = taper * h * k * Math.sqrt(Rr / R_IN); pos[o + 2] = -Rr * s * SCALE;
      const u = Math.max(-1, Math.min(1, h / state.hmax * Math.sqrt(Rr / R_IN) * 1.6)), w = Math.abs(u), to = u >= 0 ? CREST : TROUGH;
      for (let ch = 0; ch < 3; ch++) rgb[o + ch] = MID[ch] * (1 - w) + to[ch] * w;
    }
  }
  ripple.coord.point.setValue(pos); ripple.col.color.setValue(rgb);
  // clock and waveform playhead
  const sec = t * P.M_seconds, f = orbitalHz(t);
  $("tval").textContent = `${sec.toFixed(3)} s`;
  $("fval").textContent = `wave ${f.toFixed(1)} Hz · separation ${Math.hypot(x, y).toFixed(1)} M`;
  drawWave(t);
}
function orbitalHz(t) {   // wave frequency = 2 x orbital, from the phase advance across neighbouring samples
  const i = find(t), R = state.rows, a0 = Math.atan2(R[i * COLS + 2], R[i * COLS + 1]), a1 = Math.atan2(R[(i + 1) * COLS + 2], R[(i + 1) * COLS + 1]);
  let d = a1 - a0; if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI;
  return 2 * Math.abs(d) / (R[(i + 1) * COLS] - R[i * COLS]) / (2 * Math.PI) / state.case.parameters.M_seconds;
}

let waveImg = null;
function drawWave(t) {
  const cv = $("wave"), g = cv.getContext("2d"), W = cv.width, H = cv.height, R = state.rows, n = R.length / COLS, tend = R[(n - 1) * COLS];
  if (!waveImg) {
    g.clearRect(0, 0, W, H);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(R[i * COLS + 3] - R[i * COLS + 5]));
    g.strokeStyle = "#9fc4ff"; g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < n; i++) { const X = R[i * COLS] / tend * W, Y = H / 2 - (R[i * COLS + 3] - R[i * COLS + 5]) / mx * (H / 2 - 6); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke(); waveImg = g.getImageData(0, 0, W, H);
  }
  g.putImageData(waveImg, 0, 0);
  g.fillStyle = "#f2a65a"; g.fillRect(t / tend * W - 1, 0, 2, H);
}

// ---------- playback (TimeSensor-driven) ----------
function tEnd() { const R = state.rows; return R[R.length - COLS]; }
function start(mode) {
  stop();
  const P = state.case.parameters;
  state.mode = mode;
  if (mode === "hear") {
    // The sound is the clock: audio starts after decoding and X_ITE's frame clock can lag wall time, so a
    // TimeSensor started alongside ran up to 1.5 s ahead of the audio (first browser run). Each frame draws
    // the picture at the audio element's own time.
    player = new Audio(state.audio[state.track]);
    const tick = () => {
      if (state.mode !== "hear" || !player) return;
      drawAt(Math.min(player.currentTime / P.M_seconds, tEnd()));
      if (player.ended) { stop(); return; }
      requestAnimationFrame(tick);
    };
    player.play().then(() => requestAnimationFrame(tick)).catch((e) => { console.warn("audio blocked", e); stop(); });
  } else {
    const clock = nodes.clock;
    clock.cycleInterval = WATCH_SECONDS; clock.loop = true;
    const now = B.getCurrentTime();   // X_ITE's clock (Loom failure mode 72)
    if (!Number.isFinite(now)) throw Error("browser clock unavailable");
    clock.enabled = false; clock.startTime = now; clock.stopTime = 0; clock.enabled = true;
  }
  $("watch").textContent = mode === "watch" ? "❚❚ Pause" : "▶ Watch (slow motion)";
}
function stop() {
  if (nodes.clock) nodes.clock.enabled = false;
  if (player) { player.pause(); player = null; }
  state.mode = null; $("watch").textContent = "▶ Watch (slow motion)";
}

// ---------- the browser's own witness ----------
function browserCheck() {
  let worst = 0, n = 0;
  for (const r of state.case.ripple_reference) {
    const h = height(r.t, r.R, r.phi), d = Math.abs(h - r.h) / Math.max(Math.abs(r.h), 1e-12);
    worst = Math.max(worst, r.h === 0 && h === 0 ? 0 : d); n++;
  }
  state.check = { status: worst <= 1e-6 ? "pass" : "fail", worst, points: n };
}

function ledger() {
  const c = state.case, tb = $("witnesses").querySelector("tbody");
  tb.replaceChildren();
  const row = (ok, id, obs, lim) => { const tr = el("tr"); tr.append(el("td", ok ? "✓" : "✗", ok ? "ok" : "bad"), el("td", id), el("td", obs, "num"), el("td", lim, "num")); tb.append(tr); };
  for (const w of c.witnesses) row(w.pass, w.id, fmt(w.observed), `${w.rule === "at least" ? "≥" : "≤"} ${fmt(w.limit)}`);
  const ch = state.check;
  row(ch.status === "pass", `browser: wave heights at ${ch.points} reference points vs the builder, worst relative difference`, fmt(ch.worst), "≤ 1e-6");
  const red = c.witnesses.filter((w) => !w.pass).length + (ch.status === "fail" ? 1 : 0);
  $("banner").hidden = !red; $("banner").textContent = red ? `${red} witness${red > 1 ? "es are" : " is"} red. Read the ledger.` : "";
  $("limits").textContent = "Limits: " + c.limits.join(" ");
  $("provenance").textContent = `Builder tools/chirp.py ${c.builder_sha256.slice(0, 12)} · integrator tools/inspiral.py ${c.dependencies["tools/inspiral.py"].slice(0, 12)} · Python ${c.runtime.python}, NumPy ${c.runtime.numpy}`;
}

function lensText() {
  const c = state.case, P = c.parameters, box = $("lensText");
  box.replaceChildren();
  const lines = state.lens === "explorer" ? [
    c.line,
    "Orbiting masses shake space itself. The shaking spreads outward at the speed of light as a spiral of stretches and squeezes (the surface), and it carries energy away, so the holes fall closer and orbit faster: the rising chirp.",
    `At ${P.distance_mpc} Mpc, as far as LIGO's first detection, the stretch peaks near ${P.peak_strain_at_distance.toExponential(1)}: a thousandth of a proton's width over 4 km.`,
  ] : [
    c.equation,
    `η = ${P.eta.toFixed(4)}, chirp mass ${P.chirp_mass_msun.toFixed(2)} M☉; start a = ${P.a0_M} M, e = ${P.e0}; ${P.orbits.toFixed(1)} orbits in ${P.t_end_s.toFixed(3)} s to r = 6 M; wave ${P.f_gw_start_hz.toFixed(1)} → ${P.f_gw_end_hz.toFixed(1)} Hz.`,
    "References: Peters (1964) a(t) and a(e); the Newtonian chirp law Ω ∝ τ^(−3/8); the quadrupole luminosity against the work done by radiation reaction.",
  ];
  lines.forEach((t) => box.append(el("p", t)));
}

// ---------- loading and routing ----------
async function load(id) {
  const epoch = ++state.epoch;
  stop();
  $("loading").hidden = false;
  const c = await (await fetch(`cases/${id}/case.json`, { cache: "no-store" })).json();
  const [orbit, real, up] = await Promise.all(c.frames.map(verifiedBytes));
  if (epoch !== state.epoch) return;
  for (const u of Object.values(state.audio)) URL.revokeObjectURL(u);
  state.audio = { real: URL.createObjectURL(new Blob([real], { type: "audio/wav" })), up: URL.createObjectURL(new Blob([up], { type: "audio/wav" })) };
  Object.assign(state, { id, case: c, rows: new Float32Array(orbit) });
  const P = c.parameters, m1 = P.m1_msun / (P.m1_msun + P.m2_msun);
  nodes.s1.radius = 2 * m1 * SCALE; nodes.s2.radius = 2 * (1 - m1) * SCALE;
  let hm = 0; const R = state.rows; for (let i = 0; i < R.length; i += COLS) hm = Math.max(hm, Math.hypot(R[i + 3] - R[i + 5], 2 * R[i + 4]));
  state.hmax = hm / R_IN; waveImg = null;
  browserCheck();
  [...$("cases").children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("title").textContent = c.title; $("subtitle").textContent = c.line;
  $("slowHint").textContent = `${P.orbits.toFixed(0)} orbits in ${P.t_end_s.toFixed(2)} s, shown over ${WATCH_SECONDS} s (×${(WATCH_SECONDS / P.t_end_s).toFixed(1)} slower). Positions and waves are linear between computed samples 1/192 orbit apart. Wave heights are exaggerated, their 1/R fall-off is softened to 1/√R so the far arms stay visible, and inside 12 M (the near zone, where the far-field formula does not hold) nothing is drawn.`;
  ledger(); lensText(); drawAt(0);
  $("loading").hidden = true;
}
function parseHash() {
  const [id, ...pairs] = decodeURIComponent(location.hash.slice(1)).split("/"), v = {};
  for (const p of pairs) { const [k, x] = p.split("="); v[k] = x; }
  return { id: state.index.some((c) => c.id === id) ? id : null, v };
}
async function route() {
  const { id, v } = parseHash();
  if (v.lens === "explorer" || v.lens === "lab") setLens(v.lens);
  if (v.view === "Close" || v.view === "Wide") setView(v.view);
  if (id ? id !== state.id : !state.id) await load(id || state.index[0].id);
  if (!state.case) return;
  if ("t" in v && Number.isFinite(+v.t)) { stop(); drawAt(Math.max(0, Math.min(1, +v.t)) * tEnd()); }
  if (v.play === "watch") start("watch");
}
function setLens(l) { state.lens = l; [...$("lenses").children].forEach((b) => b.classList.toggle("on", b.dataset.l === l)); if (state.case) lensText(); }
function setView(v) { state.view = v; [...$("views").children].forEach((b) => b.classList.toggle("on", b.dataset.v === v)); const vp = scene && scene.getNamedNode(v); if (vp) vp.set_bind = true; }

window.chirpView = () => ({ case: state.id, t: state.t, t_fraction: state.case ? state.t / tEnd() : null, mode: state.mode, track: state.track,
  picture_s: state.case ? state.t * state.case.parameters.M_seconds : null,
  audio: player ? { time: player.currentTime, paused: player.paused, duration: player.duration } : null,
  check: state.check, loading: !$("loading").hidden });

function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "This inspiral could not be shown: " + e.message; }

function wire() {
  for (const c of state.index) { const b = el("button", c.title); b.dataset.id = c.id; b.onclick = () => { location.hash = c.id; }; $("cases").append(b); }
  $("watch").onclick = () => (state.mode === "watch" ? stop() : start("watch"));
  $("hear").onclick = () => start("hear");
  $("reset").onclick = () => { stop(); drawAt(0); };
  for (const b of $("tracks").children) b.onclick = () => { state.track = b.dataset.t; [...$("tracks").children].forEach((x) => x.classList.toggle("on", x === b)); };
  for (const b of $("lenses").children) b.onclick = () => setLens(b.dataset.l);
  for (const b of $("views").children) b.onclick = () => setView(b.dataset.v);
  addEventListener("keydown", (e) => { if (e.key === "u" || e.key === "U") document.body.classList.toggle("hide"); });
}

// A world load gets a time budget: X_ITE's replaceWorld can leave its promise pending if an internal wait
// rejects (X_ITE teardown F01; Loom failure mode 89), and a page must say so rather than hang.
function loadWorld(url, ms = 30000) {
  return Promise.race([B.loadURL(new X3D.MFString(url)),
    new Promise((_, reject) => setTimeout(() => reject(Error(`the X3D scene did not load within ${ms / 1000} s: ${url}`)), ms))]);
}

async function main() {
  state.index = (await (await fetch("cases/index.json", { cache: "no-store" })).json()).cases;
  wire();
  B = X3D.getBrowser("#canvas");
  await loadWorld("scenes/chirp.x3d");
  scene = B.currentScene;
  nodes = { clock: scene.getNamedNode("Clock"), hole1: scene.getNamedNode("Hole1"), hole2: scene.getNamedNode("Hole2"),
    s1: scene.getNamedNode("Hole1Sphere"), s2: scene.getNamedNode("Hole2Sphere"),
    trail1: scene.getNamedNode("Trail1Coord"), trail2: scene.getNamedNode("Trail2Coord") };
  buildRipple();
  nodes.lines1 = scene.getNamedNode("Trail1Lines"); nodes.lines2 = scene.getNamedNode("Trail2Lines");
  // Never let an exception escape an X_ITE field callback: one escaping exception freezes every route
  // in the scene (X_ITE teardown F02, reproduced in 16.5.1; Loom failure mode 88).
  nodes.clock.addFieldCallback("ui", "fraction_changed", (f) => { try { if (state.case && state.mode) drawAt(f * tEnd()); } catch (e) { console.error(e); } });
  // Navigation only once the scene is ready (Loom failure mode 78).
  addEventListener("hashchange", () => route().catch(fail));
  await route();
}
main().catch(fail);
