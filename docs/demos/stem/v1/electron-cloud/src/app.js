/* Electron Cloud Observatory. Shows computed states only: every field is checked against its case
   manifest (sha256 of the compressed and the decoded bytes) before it is meshed; the page rebuilds each
   mesh from that field and compares it with the builder's reference; red witnesses stay visible.
   Playback of the superposition is the scene's own TimeSensor -> IntegerSequencer -> Switch route. */
"use strict";
const $ = (id) => document.getElementById(id);
const N = 80, REF_SHARE = 0.9, C = (N - 1) / 2 + 1;
const state = { index: [], id: null, case: null, q: [], frame: 0, share: REF_SHARE, level: null, cut: 1, lens: "explorer",
  playing: false, meshes: [], shapes: [], epoch: 0, meshing: 0, check: null };
let B, scene, nodes = {};

const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
const fmt = (x) => { if (typeof x !== "number") return String(x); const a = Math.abs(x); return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(+x.toPrecision(5)); };

async function fetchVerified(frame) {
  const res = await fetch(frame.file, { cache: "no-store" });
  if (!res.ok) throw Error("missing payload " + frame.file);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== frame.bytes || (await sha(bytes)) !== frame.sha256) throw Error("payload does not match its manifest: " + frame.file);
  const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  if (raw.byteLength !== frame.decoded_bytes || (await sha(raw)) !== frame.decoded_sha256) throw Error("decoded field does not match its manifest: " + frame.file);
  return frame.signed ? new Int16Array(raw) : new Uint16Array(raw);   // little-endian, as published
}

const topOf = (f) => (f.signed ? 32767 : 65535);
const lin = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
const POS = lin("#f08a5d"), NEG = lin("#4f8fe8"), GLOW = lin("#9fe3ff");

/* Level that encloses `share` of the probability, from the verified field(s). For the superposition the
   density is averaged over the period's frames, as the builder does. At 90 % the builder's level is used. */
function levelFor(share) {
  const f0 = state.case.frames[0];
  if (Math.abs(share - REF_SHARE) < 1e-9) return f0.mesh.iso;
  const n3 = N * N * N, rho = new Float64Array(n3), s = f0.scale / topOf(f0);
  for (const q of state.q) for (let i = 0; i < n3; i++) rho[i] += (q[i] * s) ** 2 / state.q.length;
  const sorted = Float64Array.from(rho).sort().reverse();
  let total = 0; for (const v of sorted) total += v;
  let acc = 0;
  for (const v of sorted) { acc += v; if (acc >= share * total) return Math.sqrt(v); }
  return Math.sqrt(sorted[sorted.length - 1]);
}

function colours(i, pos) {
  const f = state.case.frames[i], V = pos.length / 3, out = new Float32Array(3 * V);
  if (!f.signed) { for (let v = 0; v < V; v++) out.set(GLOW, 3 * v); return out; }
  const F = Nets.displayField(state.q[i], N, topOf(f), f.scale, false);   // signed copy: its sign colours the skin
  for (let v = 0; v < V; v++) out.set(Nets.trilinear(F.f, F.shape, pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]) >= 0 ? POS : NEG, 3 * v);
  return out;
}

function meshFrame(i) {
  const f = state.case.frames[i];
  const m = Nets.surfaceNets(Nets.displayField(state.q[i], N, topOf(f), f.scale, true), state.level);
  const its = scene.createNode("IndexedTriangleSet"), coord = scene.createNode("Coordinate"), nrm = scene.createNode("Normal"), col = scene.createNode("Color");
  const pos = Float32Array.from(m.positions);
  coord.point.setValue(pos); nrm.vector.setValue(m.normals); col.color.setValue(colours(i, m.positions));
  its.index.setValue(m.index);
  its.solid = false; its.normalPerVertex = true; its.colorPerVertex = true;
  its.coord = coord; its.normal = nrm; its.color = col;
  state.shapes[i].geometry = its;
  state.meshes[i] = { vertices: m.vertices, triangles: m.triangles, volume: Nets.volume(m) };
}

function remeshAll() {
  const run = ++state.meshing, order = [state.frame, ...state.q.map((_, i) => i).filter((i) => i !== state.frame)];
  state.meshes = new Array(state.q.length); state.check = null;
  state.level = levelFor(state.share);
  let k = 0;
  $("play").disabled = true;
  const next = () => {
    if (run !== state.meshing) return;
    const t0 = performance.now();
    while (k < order.length && performance.now() - t0 < 40) meshFrame(order[k++]);
    if (state.q.length > 1) $("fval").textContent = k < order.length ? `meshing ${k} / ${order.length}` : frameLabel();
    if (k < order.length) setTimeout(next, 0);
    else { $("play").disabled = state.q.length < 2; browserCheck(); }
  };
  next();
}

function browserCheck() {
  const c = state.case;
  if (Math.abs(state.share - REF_SHARE) > 1e-9) { state.check = { status: "not_run", reason: "reference meshes enclose 90 %" }; ledger(); return; }
  let match = 0, worst = 0;
  c.frames.forEach((f, i) => {
    const m = state.meshes[i], r = f.mesh, dv = Math.abs(m.volume / r.volume - 1);
    worst = Math.max(worst, dv);
    if (m.vertices === r.vertices && m.triangles === r.triangles && dv <= 1e-6) match++;
  });
  state.check = { status: match === c.frames.length ? "pass" : "fail", match, total: c.frames.length, worst };
  ledger();
}

// ---------- playback ----------
function frameLabel() { return state.q.length > 1 ? `frame ${state.frame + 1} of ${state.q.length}` : ""; }
function showFrame(i) {
  state.frame = i; $("frame").value = i;
  const c = state.case, f = c.frames[i], P = c.parameters;
  if (state.q.length > 1) {
    $("tval").textContent = `t = ${(f.time * 2.4188843265857e-2).toFixed(3)} fs`;
  nodes.charge.translation = new X3D.SFVec3f(C, C, f.charge_centre_z_bohr / P.cell_bohr + C);
  } else $("tval").textContent = `E = ${P.E_eV.toFixed(4)} eV`;
  $("fval").textContent = frameLabel() || `box ${(2 * P.box_half_width_bohr).toFixed(1)} bohr across`;
}
function play() {
  if (!state.case || $("play").disabled) return;
  const clock = nodes.clock, n = state.q.length;
  // X_ITE's clock is getCurrentTime(); Browser.currentTime is undefined there (Loom failure mode 72).
  const start = B.getCurrentTime() - ((state.frame + 1) % n) / n * clock.cycleInterval;
  if (!Number.isFinite(start)) throw Error("browser clock unavailable: cannot start playback");
  clock.enabled = false; clock.startTime = start; clock.stopTime = 0; clock.enabled = true;
  state.playing = true; $("play").textContent = "❚❚ Pause";
}
function pause() { if (nodes.clock) nodes.clock.enabled = false; state.playing = false; $("play").textContent = "▶ Play"; }
function applyCut() { nodes.cut.enabled = state.cut < 0.999; nodes.cut.plane = new X3D.SFVec4f(-1, 0, 0, 1 + state.cut * N); }

// ---------- panel ----------
function ledger() {
  const c = state.case, tb = $("witnesses").querySelector("tbody");
  tb.replaceChildren();
  const row = (ok, id, obs, lim) => {
    const tr = el("tr");
    tr.append(el("td", ok === null ? "–" : ok ? "✓" : "✗", ok === null ? "" : ok ? "ok" : "bad"), el("td", id), el("td", obs, "num"), el("td", lim, "num"));
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
  $("banner").textContent = red ? `${red} witness${red > 1 ? "es are" : " is"} red for this state. It is shown, but read the ledger.` : "";
  $("limits").textContent = "Limits: " + c.limits.join(" ");
  $("provenance").textContent = `Builder tools/cloud.py ${c.builder_sha256.slice(0, 12)} · solver tools/radial.py ${c.dependencies["tools/radial.py"].slice(0, 12)} · Python ${c.runtime.python}, NumPy ${c.runtime.numpy}`;
}

function lensText() {
  const c = state.case, P = c.parameters, box = $("lensText");
  box.replaceChildren();
  const lines = c.kind === "superposition" ? (state.lens === "explorer" ? [
    c.line,
    "Neither state alone moves: each is a standing wave whose cloud never changes. Mix two and they beat against each other, so the charge swings through the nucleus and back.",
    `One swing takes ${P.period_fs.toFixed(3)} femtoseconds. A charge swinging that fast radiates light of wavelength ${P.wavelength_nm.toFixed(2)} nm: hydrogen's brightest ultraviolet line, Lyman-α.`,
  ] : [
    c.equation,
    `ω = E₂ − E₁ = ${fmt(P.omega_hartree)} hartree (exact 3/8); period ${fmt(P.period_au)} a.u. = ${P.period_fs.toFixed(4)} fs; f = ${fmt(P.frequency_hz)} Hz; λ = ${P.wavelength_nm.toFixed(4)} nm.`,
    `Dipole ⟨1s|z|2p_z⟩ = ${P.dipole_numerical.toFixed(6)} (exact 128√2/243 = ${P.dipole_exact.toFixed(6)}); the charge centre swings ±${P.dipole_exact.toFixed(3)} bohr.`,
  ]) : (state.lens === "explorer" ? [
    c.line,
    "An electron in an atom is not a dot on a track. Quantum mechanics gives a cloud: where it is likely to be found. Orange and blue mark where the underlying wave is positive or negative; where they meet, the wave is zero and the electron is never found.",
    "Cut the cloud open with the slider to see shells hidden inside.",
  ] : [
    "−½∇²ψ − ψ/r = Eψ   (atomic units, nucleus fixed)",
    `n = ${P.n}, l = ${P.l}, m = ${P.m}: E = ${P.E_hartree.toFixed(10)} hartree (exact −1/(2n²) = ${(-0.5 / P.n ** 2).toFixed(10)}), ${P.E_eV.toFixed(4)} eV.`,
    `${P.n - P.l - 1} radial node${P.n - P.l - 1 === 1 ? "" : "s"} and ${P.l} angular node${P.l === 1 ? "" : "s"}; box ${(2 * P.box_half_width_bohr).toFixed(1)} bohr, cell ${P.cell_bohr.toFixed(3)} bohr.`,
  ]);
  lines.forEach((t) => box.append(el("p", t)));
}

// ---------- loading and routing ----------
async function load(id) {
  const epoch = ++state.epoch;
  pause();
  $("loading").hidden = false; $("loading").textContent = "Verifying computed fields…";
  const c = await (await fetch(`cases/${id}/case.json`, { cache: "no-store" })).json();
  let done = 0;
  const q = await Promise.all(c.frames.map((f) => fetchVerified(f).then((a) => { if (epoch === state.epoch) $("loading").textContent = `Verifying computed fields… ${++done} / ${c.frames.length}`; return a; })));
  if (epoch !== state.epoch) return;
  Object.assign(state, { id, case: c, q, check: null });
  state.frame = Math.min(state.frame, q.length - 1);
  const skin = scene.getNamedNode("Skin");
  state.shapes = q.map(() => { const s = scene.createNode("Shape"); s.appearance = skin; return s; });
  nodes.cloud.children = new X3D.MFNode(...state.shapes);
  nodes.cloud.whichChoice = state.frame;
  nodes.chargeShown.whichChoice = q.length > 1 ? 0 : -1;
  $("motion").hidden = q.length < 2; $("legend").hidden = !c.frames[0].signed;
  $("frame").max = q.length - 1;
  [...$("cases").children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  $("title").textContent = c.title; $("subtitle").textContent = c.line;
  showFrame(state.frame); ledger(); lensText();
  $("loading").hidden = true;
  remeshAll();
}

// Deep links: #3s/cut=0.5, #lyman/f=0/play=1, #4fxyz/share=0.99/lens=lab. A key left out keeps its value.
function parseHash() {
  const [id, ...pairs] = decodeURIComponent(location.hash.slice(1)).split("/"), v = {};
  for (const p of pairs) { const [k, x] = p.split("="); v[k] = x; }
  return { id: state.index.some((c) => c.id === id) ? id : null, v };
}
async function route() {
  const { id, v } = parseHash();
  if ("f" in v && Number.isFinite(+v.f)) state.frame = Math.max(0, Math.round(+v.f));
  const shareChanged = ["0.5", "0.9", "0.99"].includes(v.share) && +v.share !== state.share;
  if (shareChanged) setShare(+v.share, false);
  if ("cut" in v && Number.isFinite(+v.cut)) { state.cut = Math.max(0, Math.min(1, +v.cut)); $("cut").value = state.cut; }
  if (v.lens === "explorer" || v.lens === "lab") setLens(v.lens);
  if (id ? id !== state.id : !state.id) { if (id && id !== state.id && !("f" in v)) state.frame = 0; await load(id || state.index[0].id); }
  else if (shareChanged) remeshAll();
  if (!state.case || state.id !== (id || state.id)) return;
  state.frame = Math.min(state.frame, state.q.length - 1);
  nodes.cloud.whichChoice = state.frame; showFrame(state.frame); applyCut();
  if (v.play === "1") play();
}
function setShare(s, apply = true) {
  state.share = s; [...$("shares").children].forEach((b) => b.classList.toggle("on", +b.dataset.s === s));
  if (apply && state.case) { pause(); remeshAll(); ledger(); }
}
function setLens(l) { state.lens = l; [...$("lenses").children].forEach((b) => b.classList.toggle("on", b.dataset.l === l)); if (state.case) lensText(); }

window.cloudView = () => ({ case: state.id, frame: state.frame, share: state.share, level: state.level, cut: state.cut, lens: state.lens,
  playing: state.playing, meshed: state.meshes.filter(Boolean).length, frames: state.q.length, check: state.check, loading: !$("loading").hidden });

function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "This state could not be shown: " + e.message; }

function wire() {
  for (const c of state.index) { const b = el("button", c.title); b.dataset.id = c.id; b.onclick = () => { location.hash = c.id; }; $("cases").append(b); }
  $("play").onclick = () => (state.playing ? pause() : play());
  $("frame").oninput = (e) => { pause(); showFrame(+e.target.value); nodes.cloud.whichChoice = state.frame; };
  $("cut").oninput = (e) => { state.cut = +e.target.value; applyCut(); };
  for (const b of $("shares").children) b.onclick = () => setShare(+b.dataset.s);
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
  await loadWorld("scenes/cloud.x3d");
  scene = B.currentScene;
  nodes = { cloud: scene.getNamedNode("Cloud"), clock: scene.getNamedNode("Clock"), frames: scene.getNamedNode("Frames"), cut: scene.getNamedNode("Cut"),
    charge: scene.getNamedNode("Charge"), chargeShown: scene.getNamedNode("ChargeShown") };
  // Never let an exception escape an X_ITE field callback: one escaping exception freezes every route
  // in the scene (X_ITE teardown F02, reproduced in 16.5.1; Loom failure mode 88).
  nodes.frames.addFieldCallback("ui", "value_changed", (v) => { try { if (state.playing && state.case) showFrame(v); } catch (e) { console.error(e); } });
  // Only now may navigation load cases: a hash change during scene loading once reached load() with no scene.
  addEventListener("hashchange", () => route().catch(fail));
  await route();
  if (parseHash().id && parseHash().id !== state.id) await route();   // a hash that changed while loading
}
main().catch(fail);
