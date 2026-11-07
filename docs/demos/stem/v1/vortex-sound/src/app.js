/* Vortex Reconnection & Sound. Shows computed states only: every density field is checked against its case
   manifest (sha256 of the compressed and the decoded bytes) before use. The page meshes the vortex cores
   itself (where the density falls to 0.25) and compares every mesh with the builder's; the slice through
   the fluid is coloured by density, so sound shows as ripples. The loop count shown with each frame is the
   builder's, from the phase's winding (the page has only the density). Playback is the scene's own
   TimeSensor -> IntegerSequencer -> Switch route. */
"use strict";
const $ = (id) => document.getElementById(id);
const SCALE = 1 / 16, RHO_MAX = 1.25, CORE_RHO = 0.25;
const state = { index: [], id: null, case: null, frames: [], frame: 0, lens: "explorer", playing: false, epoch: 0, check: null, meshes: [] };
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
  return new Uint8Array(raw);
}

/* The builder's field exactly: pad(1 - (q / 255) * 1.25, 0) on the (non-cubic) cropped grid, meshed at 0.75. */
function coreField(q, [nx, ny, nz]) {
  const sx = nx + 2, sy = ny + 2, sz = nz + 2, f = new Float64Array(sx * sy * sz);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++)
    f[((x + 1) * sy + (y + 1)) * sz + z + 1] = 1 - (q[(x * ny + y) * nz + z] / 255) * RHO_MAX;
  return { f, shape: [sx, sy, sz] };
}

const lin = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
const LOW = lin("#2f6fe0"), MID = lin("#0d1726"), HIGH = lin("#f0a24a"), CORE = lin("#000000");
function sliceColour(rho, out, o) {
  if (rho < 0.5) { out.set(CORE, o); return; }
  const u = Math.max(-1, Math.min(1, (rho - 1) / 0.06)), w = Math.abs(u), to = u >= 0 ? HIGH : LOW;
  for (let c = 0; c < 3; c++) out[o + c] = MID[c] * (1 - w) + to[c] * w;
}

function frameGroup(k) {
  const f = state.case.frames[k], q = state.frames[k], [nx, ny, nz] = f.shape, h = f.h, o = f.origin;
  // vortex cores
  const m = Nets.surfaceNets(coreField(q, f.shape), 1 - CORE_RHO);
  state.meshes[k] = { vertices: m.vertices, triangles: m.triangles, volume: Nets.volume(m) };
  const V = m.vertices, P = m.positions, pos = new Float32Array(3 * V), nrm = new Float32Array(3 * V);
  for (let v = 0; v < V; v++) {   // padded index p -> physical o + (p - 1) h; physics z is X3D up
    const x = o[0] + (P[3 * v] - 1) * h, y = o[1] + (P[3 * v + 1] - 1) * h, z = o[2] + (P[3 * v + 2] - 1) * h;
    pos[3 * v] = x * SCALE; pos[3 * v + 1] = z * SCALE; pos[3 * v + 2] = -y * SCALE;
    nrm[3 * v] = m.normals[3 * v]; nrm[3 * v + 1] = m.normals[3 * v + 2]; nrm[3 * v + 2] = -m.normals[3 * v + 1];   // outward from the core
  }
  const g = scene.createNode("Group");
  if (V) {
    const its = scene.createNode("IndexedTriangleSet"), coord = scene.createNode("Coordinate"), normal = scene.createNode("Normal"), s = scene.createNode("Shape");
    coord.point.setValue(pos); normal.vector.setValue(nrm); its.index.setValue(m.index);
    its.solid = false; its.normalPerVertex = true; its.coord = coord; its.normal = normal;
    s.appearance = nodes.core; s.geometry = its; g.children.push(s);
  }
  // the slice through the mid-plane (z index f.slice_k), coloured by density
  const kz = f.slice_k, spos = new Float32Array(nx * ny * 3), rgb = new Float32Array(nx * ny * 3);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
    const n = x * ny + y, rho = (q[(x * ny + y) * nz + kz] / 255) * RHO_MAX;
    spos[3 * n] = (o[0] + x * h) * SCALE; spos[3 * n + 1] = (o[2] + kz * h) * SCALE; spos[3 * n + 2] = -(o[1] + y * h) * SCALE;
    sliceColour(rho, rgb, 3 * n);
  }
  const sits = scene.createNode("IndexedTriangleSet"), scoord = scene.createNode("Coordinate"), scol = scene.createNode("Color"), ss = scene.createNode("Shape");
  scoord.point.setValue(spos); scol.color.setValue(rgb); sits.index.setValue(state.sheetIndex);
  sits.solid = false; sits.colorPerVertex = true; sits.coord = scoord; sits.color = scol;
  ss.appearance = nodes.sheet; ss.geometry = sits; g.children.push(ss);
  return g;
}

function browserCheck() {
  let match = 0, worst = 0;
  state.case.frames.forEach((f, k) => {
    const m = state.meshes[k], r = f.mesh, dv = r.volume === 0 ? Math.abs(m.volume) : Math.abs(m.volume / r.volume - 1);
    worst = Math.max(worst, dv);
    if (m.vertices === r.vertices && m.triangles === r.triangles && dv <= 1e-6) match++;
  });
  state.check = { status: match === state.case.frames.length ? "pass" : "fail", match, total: state.case.frames.length, worst };
}

// ---------- playback ----------
function showFrame(i) {
  state.frame = i; $("frame").value = i;
  const f = state.case.frames[i];
  $("tval").textContent = `t = ${f.time.toFixed(1)}`;
  $("fval").textContent = `${f.loops} vortex loop${f.loops === 1 ? "" : "s"} · frame ${i + 1} of ${state.case.frames.length}`;
}
function play() {
  const clock = nodes.clock, n = state.case.frames.length;
  const start = B.getCurrentTime() - ((state.frame + 1) % n) / n * clock.cycleInterval;   // Loom failure mode 72
  if (!Number.isFinite(start)) throw Error("browser clock unavailable");
  clock.enabled = false; clock.startTime = start; clock.stopTime = 0; clock.enabled = true;
  state.playing = true; $("play").textContent = "❚❚ Pause";
}
function pause() { if (nodes.clock) nodes.clock.enabled = false; state.playing = false; $("play").textContent = "▶ Play"; }

function ledger() {
  const c = state.case, tb = $("witnesses").querySelector("tbody");
  tb.replaceChildren();
  const row = (ok, id, obs, lim) => { const tr = el("tr"); tr.append(el("td", ok ? "✓" : "✗", ok ? "ok" : "bad"), el("td", id), el("td", obs, "num"), el("td", lim, "num")); tb.append(tr); };
  for (const w of c.witnesses) row(w.pass, w.id + (w.grade === "L" ? " (grade L)" : ""), fmt(w.observed), `${w.rule === "at least" ? "≥" : "≤"} ${fmt(w.limit)}`);
  const ch = state.check;
  row(ch.status === "pass", "browser: frames whose cores, meshed here, match the builder (vertices, triangles, volume)", `${ch.match}`, `≥ ${ch.total}`);
  row(ch.worst <= 1e-6, "browser: worst core-volume difference from the builder", fmt(ch.worst), "≤ 1e-6");
  const red = c.witnesses.filter((w) => !w.pass).length + (ch.status === "fail" ? 1 : 0);
  $("banner").hidden = !red; $("banner").textContent = red ? `${red} witness${red > 1 ? "es are" : " is"} red. Read the ledger.` : "";
  $("limits").textContent = "Limits: " + c.limits.join(" ");
  $("provenance").textContent = `Builder tools/vortex.py ${c.builder_sha256.slice(0, 12)} · solver tools/gp.py ${c.dependencies["tools/gp.py"].slice(0, 12)} · Python ${c.runtime.python}, NumPy ${c.runtime.numpy}`;
}

function lensText() {
  const c = state.case, P = c.parameters, box = $("lensText");
  box.replaceChildren();
  const lines = state.lens === "explorer" ? [c.line, ...P.explorer] : [c.equation, ...P.lab];
  lines.forEach((t) => box.append(el("p", t)));
}

async function load(id) {
  const epoch = ++state.epoch;
  pause();
  $("loading").hidden = false; $("loading").textContent = "Verifying computed states…";
  const c = await (await fetch(`cases/${id}/case.json`, { cache: "no-store" })).json();
  let done = 0;
  const frames = await Promise.all(c.frames.map((f) => verified(f).then((a) => { if (epoch === state.epoch) $("loading").textContent = `Verifying computed states… ${++done} / ${c.frames.length}`; return a; })));
  if (epoch !== state.epoch) return;
  Object.assign(state, { id, case: c, frames, meshes: [], frame: Math.min(state.frame, frames.length - 1) });
  const [nx, ny] = c.frames[0].shape;
  const idx = new Int32Array((nx - 1) * (ny - 1) * 6); let k = 0;
  for (let x = 0; x < nx - 1; x++) for (let y = 0; y < ny - 1; y++) { const a = x * ny + y, b = a + 1, cc = a + ny, d = cc + 1; idx.set([a, cc, b, b, cc, d], k); k += 6; }
  state.sheetIndex = idx;
  $("loading").textContent = "Meshing the vortex cores…";
  await new Promise((r) => setTimeout(r, 0));
  const groups = [];
  for (let i = 0; i < frames.length; i++) groups.push(frameGroup(i));
  nodes.frames.children = new X3D.MFNode(...groups);
  nodes.frames.whichChoice = state.frame;
  browserCheck();
  [...$("cases").children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("title").textContent = c.title; $("subtitle").textContent = c.line;
  showFrame(state.frame); ledger(); lensText();
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
  if (v.view === "Oblique" || v.view === "Top") { const vp = scene.getNamedNode(v.view); if (vp) vp.set_bind = true; }
  if ("f" in v && Number.isFinite(+v.f)) state.frame = Math.max(0, Math.round(+v.f));
  if (id ? id !== state.id : !state.id) await load(id || state.index[0].id);
  if (!state.case) return;
  state.frame = Math.min(state.frame, state.frames.length - 1);
  nodes.frames.whichChoice = state.frame; showFrame(state.frame);
  if (v.play === "1") play();
}
function setLens(l) { state.lens = l; [...$("lenses").children].forEach((b) => b.classList.toggle("on", b.dataset.l === l)); if (state.case) lensText(); }

window.vortexView = () => ({ case: state.id, frame: state.frame, frames: state.frames.length, playing: state.playing, check: state.check, loading: !$("loading").hidden });

function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "This case could not be shown: " + e.message; }

function wire() {
  for (const c of state.index) { const b = el("button", c.title); b.dataset.id = c.id; b.onclick = () => { location.hash = c.id; }; $("cases").append(b); }
  $("play").onclick = () => (state.playing ? pause() : play());
  $("frame").oninput = (e) => { pause(); showFrame(+e.target.value); nodes.frames.whichChoice = state.frame; };
  for (const b of $("lenses").children) b.onclick = () => setLens(b.dataset.l);
  for (const b of $("views").children) b.onclick = () => { scene.getNamedNode(b.dataset.v).set_bind = true; [...$("views").children].forEach((x) => x.classList.toggle("on", x === b)); };
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
  await loadWorld("scenes/vortex.x3d");
  scene = B.currentScene;
  nodes = { frames: scene.getNamedNode("Frames"), clock: scene.getNamedNode("Clock"), sequencer: scene.getNamedNode("Sequencer"),
    core: scene.getNamedNode("Core"), sheet: scene.getNamedNode("Sheet") };
  // Never let an exception escape an X_ITE field callback: one escaping exception leaves the routing guard
  // set and freezes every route in the scene (X_ITE teardown finding F02, reproduced in 16.5.1 on 5 Nov).
  nodes.sequencer.addFieldCallback("ui", "value_changed", (v) => { try { if (state.playing && state.case) showFrame(v); } catch (e) { console.error(e); } });
  addEventListener("hashchange", () => route().catch(fail));   // only once the scene is ready (Loom failure mode 78)
  await route();
  if (parseHash().id && parseHash().id !== state.id) await route();
}
main().catch(fail);
