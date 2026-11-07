/* Living Heart. Shows computed states only: every frame (and the ventricle's geometry) is checked against
   its case manifest (sha256 of the compressed and the decoded bytes) before use. The page counts the
   excited cells of every frame and meshes the wall itself, and compares both with the builder before a
   green row appears. Playback is the scene's own TimeSensor -> IntegerSequencer -> Switch route. */
"use strict";
const $ = (id) => document.getElementById(id);
const state = { index: [], id: null, case: null, frames: [], wall: null, frame: 0, cut: 1, lens: "explorer", playing: false, epoch: 0, check: null };
let B, scene, nodes = {};

const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
const fmt = (x) => { if (typeof x !== "number") return String(x); const a = Math.abs(x); return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(+x.toPrecision(5)); };

async function verified(frame) {
  const res = await fetch(frame.file, { cache: "no-store" });
  if (!res.ok) throw Error("missing payload " + frame.file);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== frame.bytes || (await sha(bytes)) !== frame.sha256) throw Error("payload does not match its manifest: " + frame.file);
  const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  if (raw.byteLength !== frame.decoded_bytes || (await sha(raw)) !== frame.decoded_sha256) throw Error("decoded payload does not match its manifest: " + frame.file);
  return raw;
}

// voltage colour map, sRGB stops -> linear
const STOPS = ["#0b1736", "#3a2a7a", "#b33b4e", "#ef8a3a", "#fff1bf"].map((h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2)));
function volt(u, out, o) {
  const x = Math.min(Math.max(u, 0), 1) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), t = x - i;
  for (let c = 0; c < 3; c++) out[o + c] = STOPS[i][c] * (1 - t) + STOPS[i + 1][c] * t;
}

// ---------- 2D sheets ----------
function sheetShapes(c) {
  const [nx, ny] = c.frames[0].shape, s = 2 / Math.max(nx, ny), lift = 0.12;
  const idx = new Int32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) {
    const a = i * ny + j, b = a + 1, cc = a + ny, d = cc + 1;
    idx.set([a, cc, b, b, cc, d], k); k += 6;
  }
  const skin = scene.getNamedNode("Skin");
  return state.frames.map((q) => {
    const pos = new Float32Array(nx * ny * 3), rgb = new Float32Array(nx * ny * 3);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const n = i * ny + j, u = q[n] / 255;
      pos[3 * n] = (i - (nx - 1) / 2) * s; pos[3 * n + 1] = u * lift; pos[3 * n + 2] = -(j - (ny - 1) / 2) * s;
      volt(u, rgb, 3 * n);
    }
    const shape = scene.createNode("Shape"), its = scene.createNode("IndexedTriangleSet"), coord = scene.createNode("Coordinate"), col = scene.createNode("Color");
    coord.point.setValue(pos); col.color.setValue(rgb); its.index.setValue(idx);
    its.solid = false; its.colorPerVertex = true; its.normalPerVertex = true; its.coord = coord; its.color = col;
    shape.appearance = skin; shape.geometry = its;
    return shape;
  });
}

// ---------- the ventricle ----------
function heartShapes(c) {
  const g = c.frames[0], [nx, ny, nz] = g.shape;
  // the builder's field exactly: pad((q / 65535) * 2 - 1, -1) on the non-cubic display grid
  const sx = nx + 2, sy = ny + 2, sz = nz + 2, f = new Float64Array(sx * sy * sz).fill(-1);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++)
    f[((x + 1) * sy + (y + 1)) * sz + z + 1] = (state.wall[(x * ny + y) * nz + z] / 65535) * 2 - 1;
  const field = { f, shape: [sx, sy, sz] };
  const m = Nets.surfaceNets(field, 0.0);
  state.wallMesh = { vertices: m.vertices, triangles: m.triangles, volume: Nets.volume(m) };
  // physical coordinates: display index i -> x = -28.75 + i; padded vertex p -> index p - 1. Long axis z -> X3D up.
  const V = m.vertices, P = m.positions, pos = new Float32Array(3 * V), s = 1 / 30;
  for (let v = 0; v < V; v++) {
    const x = -28.75 + (P[3 * v] - 1), y = -28.75 + (P[3 * v + 1] - 1), z = -48.75 + (P[3 * v + 2] - 1);
    pos[3 * v] = x * s; pos[3 * v + 1] = (z + 16) * s; pos[3 * v + 2] = -y * s;
  }
  const nrm = new Float32Array(3 * V);
  for (let v = 0; v < V; v++) { nrm[3 * v] = m.normals[3 * v]; nrm[3 * v + 1] = m.normals[3 * v + 2]; nrm[3 * v + 2] = -m.normals[3 * v + 1]; }
  const coord = scene.createNode("Coordinate"), normal = scene.createNode("Normal");
  coord.point.setValue(pos); normal.vector.setValue(nrm);
  const tissue = (i) => state.wall[i] > 32767.5;
  const skin = scene.getNamedNode("Skin");
  return state.frames.map((q) => {
    // masked trilinear: average the voltage over the tissue corners of each vertex's cell (the wall surface
    // lies between tissue and outside, where plain trilinear would mix in zeros)
    const rgb = new Float32Array(3 * V);
    for (let v = 0; v < V; v++) {
      const px = P[3 * v] - 1, py = P[3 * v + 1] - 1, pz = P[3 * v + 2] - 1;
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), tx = px - bx, ty = py - by, tz = pz - bz;
      let sw = 0, su = 0;
      for (const [cx, cy, cz] of Nets.CORNERS) {
        const x = bx + cx, y = by + cy, z = bz + cz;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        const i = (x * ny + y) * nz + z;
        if (!tissue(i)) continue;
        const w = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz) + 1e-6;
        sw += w; su += w * q[i] / 255;
      }
      volt(sw ? su / sw : 0, rgb, 3 * v);
    }
    const shape = scene.createNode("Shape"), its = scene.createNode("IndexedTriangleSet"), col = scene.createNode("Color");
    col.color.setValue(rgb); its.index.setValue(m.index);
    its.solid = false; its.colorPerVertex = true; its.normalPerVertex = true; its.coord = coord; its.normal = normal; its.color = col;
    shape.appearance = skin; shape.geometry = its;
    return shape;
  });
}

// ---------- the browser's own witness ----------
function browserCheck() {
  const c = state.case, uf = c.frames.filter((f) => f.active_cells !== undefined), heart = c.frames[0].mesh !== undefined;
  let match = 0;
  const tissue = heart ? (i) => state.wall[i] > 32767.5 : () => true;
  uf.forEach((f, k) => { const q = state.frames[k]; let n = 0; for (let i = 0; i < q.length; i++) if (q[i] > 127 && tissue(i)) n++; if (n === f.active_cells) match++; });
  const ch = { frames: match, total: uf.length };
  if (heart) {
    const r = c.frames[0].mesh, m = state.wallMesh;
    ch.mesh = m.vertices === r.vertices && m.triangles === r.triangles; ch.volume = Math.abs(m.volume / r.volume - 1);
  }
  ch.status = match === uf.length && (!heart || (ch.mesh && ch.volume <= 1e-6)) ? "pass" : "fail";
  state.check = ch;
}

// ---------- playback ----------
function showFrame(i) {
  state.frame = i; $("frame").value = i;
  const f = state.uframes[i], P = state.case.parameters, t0 = state.uframes[0].time;
  $("tval").textContent = `${((f.time - t0) * P.ms_per_unit).toFixed(0)} ms`;
  $("fval").textContent = `frame ${i + 1} of ${state.uframes.length} · period ${(P.period ? P.period * P.ms_per_unit : P.pacing_period * P.ms_per_unit).toFixed(0)} ms`;
}
function play() {
  const clock = nodes.clock, n = state.uframes.length;
  const start = B.getCurrentTime() - ((state.frame + 1) % n) / n * clock.cycleInterval;   // Loom failure mode 72
  if (!Number.isFinite(start)) throw Error("browser clock unavailable");
  clock.enabled = false; clock.startTime = start; clock.stopTime = 0; clock.enabled = true;
  state.playing = true; $("play").textContent = "❚❚ Pause";
}
function pause() { if (nodes.clock) nodes.clock.enabled = false; state.playing = false; $("play").textContent = "▶ Play"; }
function applyCut() { nodes.cut.enabled = state.cut < 0.999; nodes.cut.plane = new X3D.SFVec4f(-1, 0, 0, -1 + state.cut * 2.05); }

function ledger() {
  const c = state.case, tb = $("witnesses").querySelector("tbody");
  tb.replaceChildren();
  const row = (ok, id, obs, lim) => { const tr = el("tr"); tr.append(el("td", ok ? "✓" : "✗", ok ? "ok" : "bad"), el("td", id), el("td", obs, "num"), el("td", lim, "num")); tb.append(tr); };
  for (const w of c.witnesses) row(w.pass, w.id, fmt(w.observed), `${w.rule === "at least" ? "≥" : "≤"} ${fmt(w.limit)}`);
  const ch = state.check;
  row(ch.frames === ch.total, "browser: frames whose excited-cell count matches the builder", `${ch.frames}`, `≥ ${ch.total}`);
  if (ch.mesh !== undefined) row(ch.mesh && ch.volume <= 1e-6, "browser: wall meshed here vs the builder (counts exact, volume)", fmt(ch.volume), "≤ 1e-6");
  const red = c.witnesses.filter((w) => !w.pass).length + (ch.status === "fail" ? 1 : 0);
  $("banner").hidden = !red; $("banner").textContent = red ? `${red} witness${red > 1 ? "es are" : " is"} red. Read the ledger.` : "";
  $("limits").textContent = "Limits: " + c.limits.join(" ");
  $("provenance").textContent = `Builder tools/heart.py ${c.builder_sha256.slice(0, 12)} · solver tools/ap.py ${c.dependencies["tools/ap.py"].slice(0, 12)} · Python ${c.runtime.python}, NumPy ${c.runtime.numpy}`;
}

function lensText() {
  const c = state.case, P = c.parameters, box = $("lensText");
  box.replaceChildren();
  const rate = P.rate_bpm ? `${P.rate_bpm.toFixed(0)} beats a minute` : "";
  const lines = state.lens === "explorer" ? ({
    paced: () => [c.line, "Each cell fires when its neighbour does, then needs time to recover: so a wave can only travel forward, into rested tissue. That is how every heartbeat spreads."],
    spiral: () => [c.line, `A spiral needs no pacemaker: its tip chases its own tail of recovering tissue and turns about every ${(P.period_ms).toFixed(0)} ms, ${rate}. Defibrillators exist to stop waves like this.`],
    heart: () => [c.line, `On the ventricle the spiral's centre runs through the whole wall as a line, and the wave sweeps round the heart about every ${(P.period_ms).toFixed(0)} ms (${rate}). Cut the wall to see the wave run through its thickness.`],
  }[state.id])() : [
    c.equation,
    `k = ${P.k}, a = ${P.a}, eps0 = ${P.eps0}, mu1 = ${P.mu1}, mu2 = ${P.mu2}, D = ${P.D}; h = ${P.h}, dt = ${P.dt}; shown on every other cell.`,
    state.id === "paced" ? `Conduction ${P.conduction_speed.toFixed(4)} units per unit time (1D cable ${P.cable_speed.toFixed(4)}); paced every ${P.pacing_period} units.` :
      state.id === "spiral" ? `Period ${P.period.toFixed(3)} (h = 0.5) vs ${P.period_h2.toFixed(3)} (h = 0.25).` : `Period ${P.period.toFixed(3)} at four probes (${P.probe_periods.map((x) => x.toFixed(2)).join(", ")}); ${P.tissue_cells.toLocaleString()} tissue cells.`,
  ];
  lines.forEach((t) => box.append(el("p", t)));
}

async function load(id) {
  const epoch = ++state.epoch;
  pause();
  $("loading").hidden = false; $("loading").textContent = "Verifying computed states…";
  const c = await (await fetch(`cases/${id}/case.json`, { cache: "no-store" })).json();
  const raws = await Promise.all(c.frames.map(verified));
  if (epoch !== state.epoch) return;
  const heart = c.frames[0].mesh !== undefined;
  state.wall = heart ? new Uint16Array(raws[0]) : null;
  state.frames = (heart ? raws.slice(1) : raws).map((r) => new Uint8Array(r));
  state.uframes = heart ? c.frames.slice(1) : c.frames;
  Object.assign(state, { id, case: c, frame: Math.min(state.frame, state.frames.length - 1) });
  $("loading").textContent = heart ? "Meshing the ventricle wall…" : "Building the tissue…";
  await new Promise((r) => setTimeout(r, 0));
  const shapes = heart ? heartShapes(c) : sheetShapes(c);
  nodes.frames.children = new X3D.MFNode(...shapes);
  nodes.frames.whichChoice = state.frame;
  scene.getNamedNode(heart ? "HeartView" : "SheetView").set_bind = true;
  $("cutBox").hidden = !heart;
  browserCheck();
  [...$("cases").children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("title").textContent = c.title; $("subtitle").textContent = c.line;
  showFrame(state.frame); ledger(); lensText(); applyCut();
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
  if ("cut" in v && Number.isFinite(+v.cut)) { state.cut = Math.max(0, Math.min(1, +v.cut)); $("cut").value = state.cut; }
  if ("f" in v && Number.isFinite(+v.f)) state.frame = Math.max(0, Math.round(+v.f));
  if (id ? id !== state.id : !state.id) await load(id || state.index[0].id);
  if (!state.case) return;
  state.frame = Math.min(state.frame, state.frames.length - 1);
  nodes.frames.whichChoice = state.frame; showFrame(state.frame); applyCut();
  if (v.play === "1") play();
}
function setLens(l) { state.lens = l; [...$("lenses").children].forEach((b) => b.classList.toggle("on", b.dataset.l === l)); if (state.case) lensText(); }

window.heartView = () => ({ case: state.id, frame: state.frame, frames: state.frames.length, playing: state.playing, cut: state.cut,
  check: state.check, loading: !$("loading").hidden });

function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "This case could not be shown: " + e.message; }

function wire() {
  for (const c of state.index) { const b = el("button", c.title); b.dataset.id = c.id; b.onclick = () => { location.hash = c.id; }; $("cases").append(b); }
  $("play").onclick = () => (state.playing ? pause() : play());
  $("frame").oninput = (e) => { pause(); showFrame(+e.target.value); nodes.frames.whichChoice = state.frame; };
  $("cut").oninput = (e) => { state.cut = +e.target.value; applyCut(); };
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
  await loadWorld("scenes/heart.x3d");
  scene = B.currentScene;
  nodes = { frames: scene.getNamedNode("Frames"), clock: scene.getNamedNode("Clock"), sequencer: scene.getNamedNode("Sequencer"), cut: scene.getNamedNode("Cut") };
  // Never let an exception escape an X_ITE field callback: one escaping exception freezes every route
  // in the scene (X_ITE teardown F02, reproduced in 16.5.1; Loom failure mode 88).
  nodes.sequencer.addFieldCallback("ui", "value_changed", (v) => { try { if (state.playing && state.case) showFrame(v); } catch (e) { console.error(e); } });
  addEventListener("hashchange", () => route().catch(fail));   // only once the scene is ready (Loom failure mode 78)
  await route();
}
main().catch(fail);
