// SPDX-License-Identifier: GPL-3.0-or-later
// Giza Crawl v2 page: loads the receipts, builds the chapter list, the v1/v2 pairs and the zone table with DOM calls,
// drives the X3D scene through SAI (TimeSensor, Viewpoint binds, Fog per chapter). Every number shown is read from a receipt.
const PAIRS = [0, 3, 6, 7, 13, 17, 21, 23, 25, 26, 27];
// per chapter: [fog visibility range in m (0 = off), fog colour]; the Osiris descent closes in, the Hall opens out
const WARM = "0.025 0.016 0.008", COLD = "0.006 0.012 0.016", HALL = "0.03 0.018 0.008";
const FOG = [[0, WARM], [22, WARM], [22, WARM], [38, WARM], [30, WARM], [16, WARM], [26, WARM], [26, WARM], [16, WARM], [12, WARM], [12, WARM], [14, WARM],
  [12, WARM], [22, WARM], [22, WARM], [0, WARM], [0, WARM], [16, COLD], [16, COLD], [15, COLD], [15, COLD], [14, COLD], [24, COLD], [24, COLD], [0, WARM],
  [24, HALL], [70, HALL], [70, HALL]];
const VPFOG = { CA_Night_sky: [0, WARM], CA_Pyramid_cutaway: [0, WARM], CA_Grand_Gallery: [40, WARM], CA_King_s_Chamber: [30, WARM],
  CA_Osiris_descent: [18, COLD], CA_Osiris_section: [0, COLD], CA_Imagined_hall: [75, HALL], CA_Hall_dais: [60, HALL] };
const ZONES = {
  plateau: ["Moonlit night under the 2560 BC sky", "procedural sand ripples and coursed core stone; one sun lamp as the moon; an opaque Khufu baked only for its shadow"],
  passages: ["Visitor lamps along the passages", "limestone courses tilted to the passage slope; rock-cut bedrock below the base with chisel tracks"],
  gallery: ["Corbels raked from below", "the real seven-course corbelled section swept along the slope; 22 spot uplights on the ramps"],
  chambers: ["Warm work light", "granite antechamber, gabled Queen's Chamber"],
  kings: ["Polished granite, one cold beam", "granite crystals (voronoi) under ashlar joints; a narrow spot down the southern shaft"],
  subterranean: ["Raw bedrock", "an unfinished, stepped floor built as real geometry, not a texture"],
  osiris: ["A descent into the dark", "sparse work lamps, glow from under the water, a spot on the sarcophagus; the chase camera hangs above the climber and looks down"],
  hall: ["Torch-lit hypostyle (Authored)", "16 lathed papyrus-bundle columns, painted invented script, star ceiling, gilt shrines (full COMBINED bake for the sheen), braziers with sprite flames"],
};
const now = () => Date.now() / 1000;
const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const gradeChip = (g) => g.startsWith("Authored") ? ["auth", "Authored"] : g.startsWith("Cut") ? ["cut", "Cut"] : ["doc", g];
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) (k === "class" ? (e.className = v) : e.setAttribute(k, v));
  for (const k of kids) e.append(k);
  return e;
}
let R = null, B = null, S = null, TS = null, cur = -1, paused = false, vpMode = "CA_Chase";
function setFog(range, col) {
  if (!S) return;
  try { const f = S.getNamedNode("Fog"); f.visibilityRange = range; if (col) f.color = new X3D.SFColor(...col.split(" ").map(Number)); } catch (e) { /* no fog node */ }
}
function setChapter(i) {
  if (i === cur) return;
  cur = i;
  const c = R.chapters[i], [k, l] = gradeChip(c.grade);
  $("chip").className = "chip " + k; $("chip").textContent = l; $("cap").textContent = c.caption;
  document.querySelectorAll(".ch").forEach((e, j) => e.classList.toggle("on", j === i));
  const e = document.querySelectorAll(".ch")[i];
  if (e) { const box = $("chs"); box.scrollTop = e.offsetTop - box.offsetTop - box.clientHeight / 3; }
  if (vpMode === "CA_Chase" && FOG[i]) setFog(FOG[i][0], FOG[i][1]);
}
function onTime(t) {
  $("clock").textContent = fmt(t) + " / " + fmt(R.seconds);
  $("prog").style.width = (100 * t / R.seconds) + "%";
  let i = 0;
  for (let j = 0; j < R.chapters.length; j++) if (R.chapters[j].t <= t + 0.01) i = j;
  setChapter(i);
}
function jump(t) {
  if (!TS) return;
  TS.enabled = false;
  setTimeout(() => { TS.enabled = true; TS.startTime = now() - t; if (paused) { paused = false; $("bPlay").textContent = "Pause"; } }, 120);
}
function selectVp(vp) {
  vpMode = vp;
  if (!S) return;
  S.getNamedNode(vp).set_bind = true;
  document.querySelectorAll(".vp").forEach((x) => x.classList.toggle("on", x.dataset.vp === vp));
  const f = vp === "CA_Chase" ? (FOG[cur] || FOG[0]) : (VPFOG[vp] || [0, WARM]);
  setFog(f[0], f[1]);
}
(async () => {
  const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [route, bake, grades, sky, val] = await Promise.all(["receipts/route.json", "receipts/bake.json", "receipts/grades-applied.json",
    "receipts/sky-receipt.json", "receipts/validation.json"].map(get));
  R = route;
  $("nCh").textContent = R.chapters.length;
  R.chapters.forEach((c, i) => {
    const [k, l] = gradeChip(c.grade);
    const b = el("button", { class: "ch" }, el("span", { class: "tm" }, fmt(c.t)), el("span", {}, c.caption, el("br"), el("i", { class: "chip g " + k }, l)));
    b.onclick = () => { selectVp("CA_Chase"); jump(c.t + 0.05); };
    $("chs").append(b);
  });
  for (const i of PAIRS) {
    const c = R.chapters[i], n = String(i).padStart(2, "0");
    $("pairs").append(
      el("figure", {}, el("img", { loading: "lazy", alt: "v1, chapter " + i, src: "shots/before-ch" + n + ".webp" }), el("figcaption", {}, el("b", {}, "v1"), fmt(c.t) + " · " + c.caption)),
      el("figure", { class: "after" }, el("img", { loading: "lazy", alt: "v2, chapter " + i, src: "shots/after-ch" + n + ".webp" }), el("figcaption", {}, el("b", {}, "v2"), c.caption)));
  }
  if (bake) {
    let nT = 0;
    for (const [z, [look, tech]] of Object.entries(ZONES)) {
      const o = bake.objects.filter((r) => r.zone === z);
      if (!o.length) continue;
      nT += o.length;
      const bytes = o.reduce((a, r) => a + r.jpeg_bytes, 0), secs = o.reduce((a, r) => a + r.seconds, 0), tpm = o.map((r) => r.texels_per_m);
      const g = grades && grades[z];
      const td = (t, cls) => el("td", cls ? { class: cls } : {}, t);
      $("zones").querySelector("tbody").append(el("tr", {}, td(z), td(look), td(tech), td(String(o.length), "r"),
        td(Math.min(...tpm).toFixed(0) + "–" + Math.max(...tpm).toFixed(0), "r"), td((bytes / 1e6).toFixed(2) + " MB", "r"), td(secs.toFixed(0), "r"),
        td(g ? (g.exposure_stops > 0 ? "+" : "") + g.exposure_stops.toFixed(2) + " EV" : "", "r")));
    }
    $("nTex").textContent = nT;
    $("foot").textContent = "Blender " + bake.blender + ", " + (bake.build_seconds / 60).toFixed(0) + " min build" + (val ? ", " + val.exporter + "; " + val.validator : "");
  }
  if (sky) $("alnAlt").textContent = sky.alnitak_altitude_deg.toFixed(2);
  setChapter(0);
  const cv = el("x3d-canvas", { splashScreen: "false", notifications: "false", contextMenu: "false" });
  $("host").append(cv);
  B = X3D.getBrowser(cv);
  try { await B.loadURL(new X3D.MFString("assets/crawl.x3d")); } catch (e) { $("tag").textContent = "load failed: " + e; return; }
  S = B.currentScene;
  TS = S.getNamedNode("SceneTimer");
  $("nVp").textContent = document.querySelectorAll(".vp").length;
  S.getNamedNode("CA_Chase").set_bind = true;
  $("tag").textContent = "X_ITE " + B.version + " · live X3D";
  TS.addFieldCallback("page", "fraction_changed", (v) => {
    try { const f = Number(v); if (!paused && isFinite(f)) onTime(f * TS.cycleInterval); } catch (e) { /* keep the scene running */ }
  });
  cur = -1;
  jump(0);
  $("bPlay").onclick = () => {
    if (!paused) { paused = true; TS.pauseTime = now(); $("bPlay").textContent = "Play"; }
    else { paused = false; TS.resumeTime = now(); $("bPlay").textContent = "Pause"; }
  };
  document.querySelectorAll(".vp").forEach((b) => (b.onclick = () => selectVp(b.dataset.vp)));
  window.crawl = { S, B, TS, R, setFog, FOG, VPFOG, selectVp, ready: true };
})();
