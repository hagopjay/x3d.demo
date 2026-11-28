// The lab: audio in, two HAnim dancers out, ratings and evolution, X3D export.
import { Skeleton } from "./skeleton.js";
import { Library } from "./moves.js";
import { Dancer, genreWeights, ruleMap as makeRuleMap } from "./dancer.js";
import { Evolver } from "./evolve.js";
import { Recorder, performanceScene, chain } from "./export.js";
import { Tape, witness, fitnessFrom } from "./witness.js";
import { quatFromEuler, qAxisAngle } from "./math.js";
import { render as renderGroove, STYLES } from "./synth.js";

const $ = (id) => document.getElementById(id);
const log = (...a) => { const el = $("log"); el.textContent = `${new Date().toLocaleTimeString()} ${a.join(" ")}\n` + el.textContent.slice(0, 4000); console.log(...a); };
const json = (u) => fetch(u).then((r) => r.json());

const opt = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [lib, skA, skR, trained, rulesDoc, limits] = await Promise.all([json("data/moves.json"), json("data/skeleton_ada.json"), json("data/skeleton_rex.json"),
  opt("data/trained.json"), opt("data/rules.json"), opt("data/limits.json")]);
const library = new Library(lib);
const ruleMap = rulesDoc ? makeRuleMap(rulesDoc.rules) : null;
const evo = { ada: new Evolver("ada", { seed: 3, initial: trained?.ada }), rex: new Evolver("rex", { seed: 4, initial: trained?.rex }) };
const dancers = {
  ada: new Dancer({ name: "Ada", skeleton: new Skeleton(skA), library, genome: evo.ada.current, seed: 11, side: -1, rules: ruleMap }),
  rex: new Dancer({ name: "Rex", skeleton: new Skeleton(skR), library, genome: evo.rex.current, seed: 23, side: 1, rules: ruleMap }),
};
const tapes = { ada: new Tape(dancers.ada.skeleton, "Ada"), rex: new Tape(dancers.rex.skeleton, "Rex") };
const rec = { ada: new Recorder(dancers.ada.skeleton), rex: new Recorder(dancers.rex.skeleton) };
let recording = true;
const ratingsLog = [];

// ---------------------------------------------------------------- X_ITE --
const canvas = $("x3d");
await customElements.whenDefined("x3d-canvas");
const browser = await new Promise((res) => { const p = () => (canvas.browser ? res(canvas.browser) : setTimeout(p, 50)); p(); });
await new Promise((res) => {
  if (browser.currentScene?.getNamedNode) try { browser.currentScene.getNamedNode("Ada_humanoid"); return res(); } catch {}
  browser.addBrowserCallback("lab", X3D.X3DConstants.INITIALIZED_EVENT, () => res());
});
const scene = browser.currentScene;
const nodes = {};
for (const [key, d] of Object.entries(dancers)) {
  nodes[key] = {};
  for (const j of d.skeleton.joints) { try { nodes[key][j.name] = scene.getNamedNode(`${d.name}_${j.name}`); } catch {} }
}
let beatLight = null; try { beatLight = scene.getNamedNode("BeatLight"); } catch {}
const posed = { ada: new Set(), rex: new Set() };
const hold = { ada: 0, rex: 0 };

function apply(key, out) {
  const N = nodes[key], seen = new Set();
  for (const [j, e] of Object.entries(out.pose)) {
    const n = N[j]; if (!n) continue;
    let q = quatFromEuler(e[0], e[1], e[2]);
    const [x, y, z, a] = qAxisAngle(q);
    n.rotation = new X3D.SFRotation(x, y, z, a);
    seen.add(j);
  }
  const root = N.humanoid_root;
  if (root) {
    const e = out.pose.humanoid_root ?? [0, 0, 0];
    const [x, y, z, a] = qAxisAngle(quatFromEuler(e[0], e[1] + out.root[3], e[2]));
    root.rotation = new X3D.SFRotation(x, y, z, a);
    root.translation = new X3D.SFVec3f(out.root[0], out.root[1], out.root[2]);
    seen.add("humanoid_root");
  }
  for (const j of posed[key]) if (!seen.has(j) && N[j]) N[j].rotation = new X3D.SFRotation(0, 0, 1, 0);
  posed[key] = seen;
}

// ---------------------------------------------------------------- audio --
let ctx = null, listen = null, src = null, mediaSrc = null, playing = false;
let obs = null, onsets = [], events = [];
async function ensureAudio() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(new URL("./listen-worklet.js", import.meta.url));
  listen = new AudioWorkletNode(ctx, "x3d-dance-listen", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  listen.port.onmessage = (e) => {
    obs = e.data.f;
    onsets.push(...e.data.onsets); if (onsets.length > 300) onsets.splice(0, onsets.length - 300);
    for (const ev of e.data.events) { events.push(ev); log("section change at", ev.t.toFixed(1), "s"); }
  };
  log("audio", ctx.sampleRate, "Hz, base latency", (ctx.baseLatency * 1000).toFixed(1), "ms");
}
function stopSource() { try { src?.stop?.(); } catch {} try { src?.disconnect(); } catch {} src = null; }
async function playBuffer(buf, name) {
  await ensureAudio(); await ctx.resume(); stopSource(); $("player").pause();
  src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.connect(listen); listen.connect(ctx.destination); src.start();
  playing = true; startTake(name);
}
async function playElement(url, name) {
  await ensureAudio(); await ctx.resume(); stopSource();
  const p = $("player"); p.src = url;
  if (!mediaSrc) { mediaSrc = ctx.createMediaElementSource(p); mediaSrc.connect(listen); listen.connect(ctx.destination); }
  await p.play(); playing = true; startTake(name);
}
let take = { name: "", started: 0 };
function startTake(name) {
  take = { name, started: Date.now() };
  for (const d of Object.values(dancers)) d.mind.startle(0.2);
  for (const k of Object.keys(rec)) rec[k] = new Recorder(dancers[k].skeleton);
  log("now playing:", name);
}

document.querySelectorAll("[data-demo]").forEach((b) => b.onclick = async () => {
  await ensureAudio();
  const style = b.dataset.demo, secs = Math.round((60 / STYLES[style].bpm) * 4 * 16 * 100) / 100;
  const mono = renderGroove(style, secs, ctx.sampleRate, 7);
  const buf = ctx.createBuffer(2, mono.length, ctx.sampleRate); buf.copyToChannel(mono, 0); buf.copyToChannel(mono, 1);
  playBuffer(buf, `demo ${style} ${STYLES[style].bpm} bpm`);
});
$("file").onchange = (e) => e.target.files[0] && playElement(URL.createObjectURL(e.target.files[0]), e.target.files[0].name);
const drop = $("drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) playElement(URL.createObjectURL(f), f.name); };
$("urlgo").onclick = () => $("url").value && playElement($("url").value, $("url").value);
$("mic").onclick = async () => {
  await ensureAudio(); await ctx.resume(); stopSource();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  src = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(listen); listen.connect(mute).connect(ctx.destination);
  playing = true; startTake("microphone");
};

// --------------------------------------------------------- ratings, evo --
function rate(key, delta) {
  const keys = key === "both" ? ["ada", "rex"] : [key];
  for (const k of keys) {
    evo[k].rate(delta, dancers[k].cur?.move.id ?? "");
    ratingsLog.push({ dancer: k, genome: evo[k].current.id, delta, move: dancers[k].cur?.move.id, at: new Date().toISOString(), track: take.name });
    const card = $(`d-${k}`); card.animate([{ background: delta > 0 ? "#2a3b2a" : "#3b2a2a" }, { background: "transparent" }], 500);
  }
}
document.querySelectorAll("[data-rate]").forEach((b) => b.onclick = () => { const [k, d] = b.dataset.rate.split(":"); rate(k, +d); });
addEventListener("keydown", (e) => {
  const m = { a: ["ada", 1], z: ["ada", -1], k: ["rex", 1], m: ["rex", -1], b: ["both", 1] }[e.key.toLowerCase()];
  if (m && e.target.tagName !== "INPUT") rate(...m);
});
const stintStart = { ada: 0, rex: 0 };
function nextGenome(k) {
  const d = dancers[k], o = k === "ada" ? "rex" : "ada";
  let s;
  if (limits && tapes[k].f.length > 30) { // the Loom's witnesses grade the stint
    const reps = witness(tapes[k], limits, { dancer: d, partner: tapes[o] });
    s = { total: fitnessFrom(reps), parts: Object.fromEntries(reps.map((r) => [r.witness, r.value])) };
    const fails = reps.filter((r) => r.status === "fail").map((r) => r.witness.split(".")[1]);
    $(`${k}-why`).title = reps.map((r) => `${r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "·"} ${r.witness} ${r.value ?? ""} (limit ${r.cmp ?? ""} ${r.limit})`).join("\n");
    log(`${d.name} stint witnesses: ${reps.filter((r) => r.status === "pass").length}/${reps.length} pass`, fails.length ? `— fail: ${fails.join(", ")}` : "");
  } else s = d.score(dancers[o]);
  const bred = evo[k].endStint(s);
  log(`${d.name} genome ${d.genome.id}: auto ${s.total.toFixed(2)}`, bred ? `→ generation ${evo[k].gen}` : "");
  d.setGenome(evo[k].current); d.resetMetrics(); stintStart[k] = d.mind.phase;
  tapes[k] = new Tape(d.skeleton, d.name);
}
$("breed").onclick = () => { nextGenome("ada"); nextGenome("rex"); };
$("rec").onclick = () => { recording = !recording; $("rec").classList.toggle("on", recording); $("rec").textContent = recording ? "● Recording" : "○ Not recording"; };

// ---------------------------------------------------------------- export --
const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
async function lineage() {
  const records = [];
  for (const [k, e] of Object.entries(evo)) {
    for (const g of e.log) records.push({ dancer: k, ...g });
    records.push({ dancer: k, gen: e.gen, live: true, population: e.pop.map((g) => ({ id: g.id, parents: g.parents, fitness: e.fitness(g), genome: g })) });
  }
  return chain(records);
}
$("exp-lin").onclick = async () => download("x3d-dance-lineage.json", JSON.stringify({ ratings: ratingsLog, lineage: await lineage() }, null, 1), "application/json");
$("exp-ttl").onclick = async () => download("x3d-dance-ontology.ttl", await (await fetch("data/ontology.ttl")).text(), "text/turtle");
$("exp-perf").onclick = async () => {
  const stage = await (await fetch("stage-4.1.x3d")).text();
  const lin = await lineage();
  const meta = {
    track: take.name || "silence", bpm: obs?.bpm ? +obs.bpm.toFixed(2) : 0, recorded: new Date().toISOString(),
    generator: "x3d.dance lab", ratings: JSON.stringify(ratingsLog),
    lineageHead: lin.length ? lin[lin.length - 1].hash : "", lineage: JSON.stringify(lin.map((r) => ({ dancer: r.dancer, gen: r.gen, hash: r.hash }))),
    genomes: JSON.stringify({ ada: dancers.ada.genome, rex: dancers.rex.genome }),
  };
  const x = performanceScene(stage, { Ada: rec.ada.motion("Ada", "take"), Rex: rec.rex.motion("Rex", "take") }, meta);
  download(`x3d-dance-${(take.name || "take").replace(/[^\w.-]+/g, "_")}.x3d`, x, "model/x3d+xml");
  log("exported", rec.ada.frames.length, "frames per dancer");
};

// ---------------------------------------------------------- spec probes --
const poseSel = $("pose");
for (const m of library.moves) for (const who of ["Ada", "Rex"]) {
  try { scene.getNamedNode(`${who}_pose_${m.id}`); const o = document.createElement("option"); o.value = `${who}_pose_${m.id}`; o.textContent = `${who} · ${m.name}`; poseSel.append(o); } catch {}
}
$("posego").onclick = () => {
  const id = poseSel.value; if (!id) return;
  const pose = scene.getNamedNode(id), key = id.startsWith("Ada") ? "ada" : "rex";
  hold[key] = performance.now() + 2500;
  pose.commencePose = true;
  log("HAnimPose", id, "commenced (X_ITE experimental); driver paused 2.5 s");
};
if (!poseSel.options.length) { poseSel.disabled = $("posego").disabled = true; log("stage has no HAnimPose nodes (X3D 4.0 stage)"); }

// ------------------------------------------------------------------ loop --
let last = performance.now() / 1000, clockT = 0, lastBeatShown = -1;
function audioNow() {
  if (!ctx || !playing) return null;
  const ts = ctx.getOutputTimestamp?.();
  return ts && ts.contextTime ? ts.contextTime : ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}
function frame() {
  const now = performance.now() / 1000, wall = Math.min(0.25, now - last); last = now;
  const at = audioNow();
  // step the dancers by the audio clock when music plays (frame rate may be low)
  const dt = at !== null ? Math.max(0, Math.min(0.5, at - clockT)) : wall;
  clockT = at ?? clockT + wall;
  const o = playing ? obs : null, ev = events.splice(0);
  const outs = {};
  for (const [k, d] of Object.entries(dancers)) {
    const partner = dancers[k === "ada" ? "rex" : "ada"];
    outs[k] = d.update(dt, clockT, o, partner, ev, onsets);
  }
  for (const [k, out] of Object.entries(outs)) {
    if (performance.now() > hold[k]) apply(k, out);
    if (recording && playing) rec[k].maybe(clockT, out.pose, out.root, out.info);
    if (playing && (tapes[k].f.length === 0 || clockT - tapes[k].f[tapes[k].f.length - 1].t >= 1 / 30)) tapes[k].push(clockT, out, o, out.info.move);
    const d = dancers[k];
    $(`${k}-move`).textContent = `${library.get(out.info.move).name}${out.info.mirror ? " (mirrored)" : ""}`;
    $(`${k}-why`).textContent = `${out.info.why} · beat ${out.info.bar + 1} · pocket ${(d.genome.laidBack * 1000).toFixed(0)} ms`;
    $(`${k}-conf`).style.width = `${(out.info.confidence * 100).toFixed(0)}%`;
    $(`${k}-gen`).textContent = `gen ${evo[k].gen} · genome ${evo[k].idx + 1}/${evo[k].pop.length} · ${d.genome.id}`;
    const stint = +$("stint").value * 4;
    if (playing && d.mind.phase - stintStart[k] > stint) nextGenome(k);
  }
  if (o && o.bpm) {
    $("bpm").textContent = o.bpm.toFixed(1); $("syncv").textContent = o.syncopation.toFixed(2);
    const gw = genreWeights(o), top = Object.entries(gw).sort((a, b) => b[1] - a[1]);
    $("genre").textContent = top.map(([g, w]) => `${g} ${(w * 100).toFixed(0)}%`).join(" · ");
    $("m-conf").style.width = `${o.confidence * 100}%`; $("m-sync").style.width = `${Math.min(1, o.syncopation) * 100}%`;
    $("m-energy").style.width = `${o.energy * 100}%`; $("m-nov").style.width = `${Math.min(1, o.novelty / 1.2) * 100}%`;
    const bp = (clockT - o.lastBeat) / o.period, frac = ((bp % 1) + 1) % 1;
    const pulse = Math.exp(-frac * 6);
    $("beat").style.opacity = (0.15 + 0.85 * pulse).toFixed(2);
    if (beatLight) beatLight.intensity = 0.9 * pulse * o.energy;
    $("gen").textContent = `${evo.ada.gen} / ${evo.rex.gen}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__lab = { dancers, evo, rec, library, get obs() { return obs; }, rate, nextGenome, playBuffer, ensureAudio, get ctx() { return ctx; } };
log(trained ? `trained genomes from ${trained.from}` : "untrained seeds", ruleMap ? `· ${Object.keys(ruleMap).length} fold-back rules` : "", limits ? "· witnesses on" : "");
log("lab ready:", library.moves.length, "moves,", Object.keys(nodes.ada).length, "+", Object.keys(nodes.rex).length, "joints bound");
