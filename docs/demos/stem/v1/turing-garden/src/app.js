/* Turing Garden. Shows computed states only: every field is checked against its case manifest (sha256 of
   the compressed and the decoded bytes) before it is meshed, the mesh is rebuilt here from that field and
   compared with the builder's reference, and red witnesses stay visible. Playback is the scene's own
   TimeSensor -> IntegerSequencer -> Switch route; this file only fills the Switch and listens to it. */
"use strict";
const $ = (id) => document.getElementById(id);
const N = 64, VMAX = 0.6, REF_ISO = 0.2;
const state = { id: null, index: [], case: null, q: [], top: 255, frame: 40, iso: REF_ISO, cut: 1, colour: "age",
  lens: "explorer", playing: false, meshes: [], shapes: [], age: null, epoch: 0, meshing: 0, check: null };
let B, scene, nodes = {};

const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
const fmt = (x) => { if (typeof x !== "number") return String(x); const a = Math.abs(x); return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(+x.toPrecision(4)); };

async function fetchVerified(frame) {
  const res = await fetch(frame.file, { cache: "no-store" });
  if (!res.ok) throw Error("missing payload " + frame.file);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== frame.bytes || (await sha(bytes)) !== frame.sha256) throw Error("payload does not match its manifest: " + frame.file);
  const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  if (raw.byteLength !== frame.decoded_bytes || (await sha(raw)) !== frame.decoded_sha256) throw Error("decoded field does not match its manifest: " + frame.file);
  return frame.bits === 16 ? new Uint16Array(raw) : new Uint8Array(raw);   // little-endian, as published
}

// ---------- colour ----------
const STOPS = ["#3b2a8c", "#2f7fb0", "#3fb59a", "#e7c35a", "#f08a5d"].map((h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2)));
const FLAT = [0.86, 0.34, 0.22];
function palette(a) {
  const x = Math.min(Math.max(a, 0), 1) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), t = x - i;
  return [0, 1, 2].map((c) => STOPS[i][c] * (1 - t) + STOPS[i + 1][c] * t);
}

/* First frame in which each cell rose above the level: "when it grew". The colour scale ends at the 98th
   percentile of that frame over the final pattern, so a garden that is grown by frame 15 still uses the
   whole palette; the legend says where the scale ends. */
function computeAge() {
  const n3 = N * N * N, age = new Uint8Array(n3).fill(255), thr = state.iso / VMAX * state.top;
  state.q.forEach((q, f) => { for (let i = 0; i < n3; i++) if (age[i] === 255 && q[i] > thr) age[i] = f; });
  const last = state.q[state.q.length - 1], hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n3; i++) if (last[i] > thr) { hist[age[i]]++; count++; }
  let acc = 0, p98 = state.q.length - 1;
  for (let a = 0; a < 255; a++) { acc += hist[a]; if (acc >= 0.98 * count) { p98 = a; break; } }
  state.age = age; state.ageEnd = Math.max(p98, 1);
  const f = state.case && state.case.frames[state.ageEnd];
  $("legend").querySelector("span:last-child").textContent = f ? `t = ${Math.round(f.time)} and later` : "last frame";
}

function colours(i, pos) {
  const V = pos.length / 3, out = new Float32Array(3 * V);
  if (state.colour === "flat") { for (let v = 0; v < V; v++) out.set(FLAT, 3 * v); return out; }
  const q = state.q[i], thr = state.iso / VMAX * state.top, age = state.age, end = state.ageEnd;
  for (let v = 0; v < V; v++) {
    // padded coordinates: grid point (x, y, z) sits at x + 1. Average the ages of the vertex cell's corners
    // that are above the level now, with trilinear weights (a minimum over corners speckled the skin).
    const px = pos[3 * v] - 1, py = pos[3 * v + 1] - 1, pz = pos[3 * v + 2] - 1;
    const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), tx = px - bx, ty = py - by, tz = pz - bz;
    let sw = 0, sa = 0;
    for (const [cx, cy, cz] of Nets.CORNERS) {
      const x = bx + cx, y = by + cy, z = bz + cz;
      if (x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= N) continue;
      const c = (x * N + y) * N + z;
      if (!(q[c] > thr)) continue;
      const w = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz) + 1e-6;
      sw += w; sa += w * Math.min(age[c], i);
    }
    out.set(palette((sw ? sa / sw : i) / end), 3 * v);
  }
  return out;
}

// ---------- meshing ----------
function upload(i, m) {
  const its = scene.createNode("IndexedTriangleSet"), coord = scene.createNode("Coordinate"), nrm = scene.createNode("Normal"), col = scene.createNode("Color");
  const pos = Float32Array.from(m.positions);
  coord.point.setValue(pos); nrm.vector.setValue(m.normals); col.color.setValue(colours(i, pos));
  its.index.setValue(m.index);
  its.solid = false; its.normalPerVertex = true; its.colorPerVertex = true;
  its.coord = coord; its.normal = nrm; its.color = col;
  state.shapes[i].geometry = its;
  state.meshes[i] = { pos, color: col, vertices: m.vertices, triangles: m.triangles, volume: Nets.volume(m), iso: state.iso };
}

function meshFrame(i) {
  const m = Nets.surfaceNets(Nets.displayField(state.q[i], N, state.top, VMAX), state.iso);
  upload(i, m);
}

/* Mesh the shown frame now and the rest in the background; then check against the builder's reference. */
function remeshAll() {
  const run = ++state.meshing, order = [state.frame, ...state.q.map((_, i) => i).filter((i) => i !== state.frame)];
  state.meshes = new Array(state.q.length);
  computeAge();
  let k = 0;
  $("play").disabled = true;
  const next = () => {
    if (run !== state.meshing) return;
    const t0 = performance.now();
    while (k < order.length && performance.now() - t0 < 40) meshFrame(order[k++]);
    $("fval").textContent = k < order.length ? `meshing ${k} / ${order.length}` : frameLabel();
    if (k < order.length) setTimeout(next, 0);
    else { $("play").disabled = false; browserCheck(); }
  };
  next();
}

function recolour() {
  computeAge();
  state.meshes.forEach((m, i) => { if (m) m.color.color.setValue(colours(i, m.pos)); });
}

// ---------- the browser's own witness ----------
function browserCheck() {
  const c = state.case;
  if (Math.abs(state.iso - REF_ISO) > 1e-9) { state.check = { status: "not_run", reason: `reference meshes are at level ${REF_ISO}` }; ledger(); return; }
  let match = 0, worst = 0;
  c.frames.forEach((f, i) => {
    const m = state.meshes[i], r = f.mesh;
    const dv = r.volume === 0 ? Math.abs(m.volume) : Math.abs(m.volume / r.volume - 1);
    worst = Math.max(worst, dv);
    if (m.vertices === r.vertices && m.triangles === r.triangles && dv <= 1e-6) match++;
  });
  state.check = { status: match === c.frames.length ? "pass" : "fail", match, total: c.frames.length, worst };
  ledger();
}

// ---------- playback through the scene's own route ----------
function frameLabel() {
  const f = state.case && state.case.frames[state.frame];
  return f ? `frame ${state.frame + 1} of ${state.case.frames.length}` : "";
}
function showFrame(i) {
  state.frame = i; $("frame").value = i;
  const f = state.case.frames[i];
  $("tval").textContent = `t = ${Math.round(f.time)}`; $("fval").textContent = frameLabel();
}
function play() {
  if (!state.case || $("play").disabled) return;
  const clock = nodes.clock, n = state.case.frames.length;
  // X_ITE's clock is getCurrentTime() (its frame time); `currentTime` is undefined there, and a NaN
  // startTime leaves the TimeSensor "active" with no fraction events: playback silently frozen.
  const now = B.getCurrentTime(), start = now - ((state.frame + 1) % n) / n * clock.cycleInterval;
  if (!Number.isFinite(start)) throw Error("browser clock unavailable: cannot start playback");
  clock.enabled = false;
  clock.startTime = start;
  clock.stopTime = 0;
  clock.enabled = true;
  state.playing = true; $("play").textContent = "❚❚ Pause";
}
function pause() { if (nodes.clock) nodes.clock.enabled = false; state.playing = false; $("play").textContent = "▶ Play"; }

function applyCut() {
  nodes.cut.enabled = state.cut < 0.999;
  nodes.cut.plane = new X3D.SFVec4f(-1, 0, 0, 1 + state.cut * 64);
}

// ---------- panel ----------
function ledger() {
  const c = state.case, tb = $("witnesses").querySelector("tbody");
  tb.replaceChildren();
  const row = (ok, id, obs, lim, cls) => {
    const tr = el("tr");
    tr.append(el("td", ok === null ? "–" : ok ? "✓" : "✗", ok === null ? "" : ok ? "ok" : "bad"), el("td", id, cls), el("td", obs, "num"), el("td", lim, "num"));
    tb.append(tr);
  };
  for (const w of c.witnesses) row(w.pass, w.id, fmt(w.observed), `${w.rule === "at least" ? "≥" : "≤"} ${fmt(w.limit)}`);
  const ch = state.check;
  if (!ch) row(null, "browser: meshes rebuilt here match the builder's reference", "running", "all frames");
  else if (ch.status === "not_run") row(null, "browser: meshes rebuilt here match the builder's reference", "not run", ch.reason);
  else {
    row(ch.status === "pass", "browser: frames whose rebuilt mesh matches the reference (vertices, triangles, volume)", `${ch.match}`, `≥ ${ch.total}`);
    row(ch.worst <= 1e-6, "browser: worst enclosed-volume difference from the reference", fmt(ch.worst), "≤ 1e-6");
  }
  const red = c.witnesses.filter((w) => !w.pass).length + (ch && ch.status === "fail" ? 1 : 0);
  $("banner").hidden = !red;
  $("banner").textContent = red ? `${red} witness${red > 1 ? "es are" : " is"} red for this case. The garden is shown, but read the ledger.` : "";
  $("limits").textContent = "Limits: " + c.limits.join(" ");
  $("provenance").textContent = `Builder tools/garden.py ${c.builder_sha256.slice(0, 12)} · solver tools/gs.py ${c.dependencies["tools/gs.py"].slice(0, 12)} · Python ${c.runtime.python}, NumPy ${c.runtime.numpy} · ${c.parameters.display_bits}-bit fields`;
}

function lensText() {
  const c = state.case, box = $("lensText");
  box.replaceChildren();
  if (!c) return;
  const morph = c.metrics.find((m) => m.id === "morphology"), P = c.parameters;
  const lines = state.lens === "explorer" ? [
    c.line,
    "Two chemicals share the box. One (v) makes more of itself by consuming the other (u), which is fed in everywhere. Both spread out, and the food spreads twice as fast as the one consuming it. That mismatch alone can draw a pattern, as Alan Turing proposed in 1952.",
    "Colour shows when each part of the surface first grew. Play the growth to watch three seeds take over.",
  ] : [
    "u_t = Du ∇²u − u v² + F (1 − u)",
    "v_t = Dv ∇²v + u v² − (F + k) v",
    `F = ${P.F}, k = ${P.k}, Du = ${P.Du}, Dv = ${P.Dv}; dt = ${P.dt}, ${P.steps.toLocaleString()} forward-Euler steps on a periodic 64³ grid.`,
    `Measured on the last frame: ${morph["components of v > iso"]} pieces, largest ${(100 * morph["largest component share"]).toFixed(0)} %; ${morph["holes (components of v < iso)"]} holes; Euler characteristic ${morph["Euler characteristic"]}; |median mean curvature| ${fmt(morph["|median mean curvature|"])}; late activity ${fmt(morph["late activity"])}.`,
  ];
  lines.forEach((t, i) => box.append(el("p", t, state.lens === "lab" && i < 2 ? "eq" : "")));
}

// ---------- case loading ----------
async function load(id) {
  const epoch = ++state.epoch;
  pause();
  $("loading").hidden = false; $("loading").textContent = "Verifying computed fields…";
  const c = await (await fetch(`cases/${id}/case.json`, { cache: "no-store" })).json();
  let done = 0;
  const q = await Promise.all(c.frames.map((f) => fetchVerified(f).then((a) => { if (epoch === state.epoch) $("loading").textContent = `Verifying computed fields… ${++done} / ${c.frames.length}`; return a; })));
  if (epoch !== state.epoch) return;
  Object.assign(state, { id, case: c, q, top: c.frames[0].bits === 16 ? 65535 : 255, check: null });
  state.frame = Math.min(state.frame, q.length - 1);
  const skin = scene.getNamedNode("Skin");
  state.shapes = q.map(() => { const s = scene.createNode("Shape"); s.appearance = skin; return s; });
  nodes.garden.children = new X3D.MFNode(...state.shapes);
  nodes.garden.whichChoice = state.frame;
  [...$("cases").children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("title").textContent = c.title; $("subtitle").textContent = c.line;
  $("frame").max = q.length - 1;
  showFrame(state.frame); ledger(); lensText();
  $("loading").hidden = true;
  remeshAll();
}

// Deep links: #coral/f=40/iso=0.2/cut=1/c=age/lens=lab/play=1. kerr-style: a key left out keeps its value.
function parseHash() {
  const [id, ...pairs] = decodeURIComponent(location.hash.slice(1)).split("/"), v = {};
  for (const p of pairs) { const [k, x] = p.split("="); v[k] = x; }
  return { id: state.index.some((c) => c.id === id) ? id : null, v };
}
async function route() {
  const { id, v } = parseHash();
  if ("f" in v && Number.isFinite(+v.f)) state.frame = Math.max(0, Math.min(40, Math.round(+v.f)));
  const isoChanged = "iso" in v && Number.isFinite(+v.iso) && Math.abs(+v.iso - state.iso) > 1e-9;
  if (isoChanged) { state.iso = Math.max(0.1, Math.min(0.34, +v.iso)); $("iso").value = state.iso; $("isoVal").textContent = state.iso.toFixed(2); }
  if ("cut" in v && Number.isFinite(+v.cut)) { state.cut = Math.max(0, Math.min(1, +v.cut)); $("cut").value = state.cut; }
  if (v.c === "age" || v.c === "flat") setColour(v.c, false);
  if (v.lens === "explorer" || v.lens === "lab") setLens(v.lens);
  if (id ? id !== state.id : !state.id) await load(id || state.index[0].id);
  else if (isoChanged) remeshAll();
  else if (v.c) recolour();
  if (!state.case || state.id !== (id || state.id)) return;   // a newer navigation took over this one
  nodes.garden.whichChoice = state.frame; showFrame(state.frame); applyCut();
  if (v.play === "1") play();
}
function setColour(c, apply = true) {
  state.colour = c; [...$("colours").children].forEach((b) => b.classList.toggle("on", b.dataset.c === c));
  $("legend").hidden = c !== "age";
  if (apply && state.case) recolour();
}
function setLens(l) { state.lens = l; [...$("lenses").children].forEach((b) => b.classList.toggle("on", b.dataset.l === l)); lensText(); }

window.gardenView = () => ({ case: state.id, frame: state.frame, time: state.case ? state.case.frames[state.frame].time : null,
  iso: state.iso, cut: state.cut, colour: state.colour, lens: state.lens, playing: state.playing,
  meshed: state.meshes.filter(Boolean).length, check: state.check, loading: !$("loading").hidden });

function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "This garden could not be shown: " + e.message; }

function wire() {
  for (const c of state.index) { const b = el("button", c.title); b.dataset.id = c.id; b.onclick = () => { location.hash = c.id; }; $("cases").append(b); }
  $("play").onclick = () => (state.playing ? pause() : play());
  $("frame").oninput = (e) => { pause(); showFrame(+e.target.value); nodes.garden.whichChoice = state.frame; };
  let isoTimer = 0;
  $("iso").oninput = (e) => { state.iso = +e.target.value; $("isoVal").textContent = state.iso.toFixed(2); clearTimeout(isoTimer); isoTimer = setTimeout(() => { pause(); state.check = null; ledger(); remeshAll(); }, 180); };
  $("cut").oninput = (e) => { state.cut = +e.target.value; applyCut(); };
  for (const b of $("colours").children) b.onclick = () => setColour(b.dataset.c);
  for (const b of $("lenses").children) b.onclick = () => setLens(b.dataset.l);
  addEventListener("keydown", (e) => { if (e.key === "u" || e.key === "U") document.body.classList.toggle("hide"); if (e.key === " ") { e.preventDefault(); $("play").onclick(); } });
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
  await loadWorld("scenes/garden.x3d");
  scene = B.currentScene;
  nodes = { garden: scene.getNamedNode("Garden"), clock: scene.getNamedNode("Clock"), frames: scene.getNamedNode("Frames"), cut: scene.getNamedNode("Cut") };
  // Never let an exception escape an X_ITE field callback: one escaping exception freezes every route
  // in the scene (X_ITE teardown F02, reproduced in 16.5.1; Loom failure mode 88).
  nodes.frames.addFieldCallback("ui", "value_changed", (v) => { try { if (state.playing && state.case) showFrame(v); } catch (e) { console.error(e); } });
  // Only now may navigation load cases: a hash change during scene loading reached load() with no scene
  // (Loom failure mode 78, found on the Electron Cloud page; fixed here 5 Nov).
  addEventListener("hashchange", () => route().catch(fail));
  await route();
  if (parseHash().id && parseHash().id !== state.id) await route();   // a hash that changed while loading
}
main().catch(fail);
