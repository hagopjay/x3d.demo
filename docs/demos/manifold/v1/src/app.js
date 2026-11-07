/* Manifold of Emotion, in X3D. The page runs the original's logic (its camera, input, moods, journey and
   labels, and its geodesic tracer verbatim in src/math-core.js) and drives one X3D scene (scenes/manifold.x3d)
   through SAI: every frame it hands the seven shaders the live metric and moves the Viewpoint; every 320 ms it
   streams the geodesic ribbons as vertex attributes. X_ITE draws; src/lens.js adds the original's bloom,
   vignette and grain. Page contract (Loom law 32): the world load has a time budget, the one field callback
   opens with try, navigation is wired after the scene loads, and window.manifoldView() reports what is drawn. */
"use strict";
(() => {
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const F = ManifoldField.create(0);
const presets = F.presets;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), mix = (a, b, t) => a + (b - a) * t;
const SCALES = [0.75, 1, 1.5, 2];                          // Ultra supersamples 2x on any display (the original caps at its own 2x level)
const TRACES = 30, STEP = .065, COUNT = 400;            // the original's 'high' bundle at half its step (16x more accurate)
let B, scene, N = {}, shaders = [], lens = null;
let running = !reduced, autoOrbit = !reduced, journey = false, immersive = false, labelsEnabled = false;
let last = 0, frame = 0, fpsAccum = 0, fpsFrames = 0, fpsShown = 0, journeyTime = 0, lastFlowClock = -1e9, lastFlowTime = -999;
let qualityAuto = true, qualityIndex = 2, qualityCooldown = 0, lastTapClock = -1000, autoOrbitBaseEl = .69;
let flowInfo = { traces: 0, vertices: 0, indices: 0 }, flowData = null, capture = null, ready = false;
const cam = { az: .62, el: .69, dist: 27.6, target: [0, -1.5, 0], azGoal: .62, elGoal: .69, distGoal: 27.6, targetGoal: [0, -1.5, 0] };
let eye = [0, 0, 0], vp = new Float32Array(16), invVP = new Float32Array(16);
const anchors = new Float32Array(7 * 4);
const LOOK = { ao: .12, ribbonWidth: 1.4, ribbonGain: .68 };   // fitted to the original's frame (DEBRIEF, calibration); hash keys ao, rw, rg override

function toast(message) { $("toast").textContent = message; $("toast").style.opacity = 1; clearTimeout(toast.timer); toast.timer = setTimeout(() => $("toast").style.opacity = 0, 2300); }
function fail(e) { console.error(e); $("loader").hidden = true; $("failure").hidden = false; $("errorText").textContent = e.message || String(e); }
function setText(el, desc) { el.replaceChildren(); desc.split("<br>").forEach((t, i) => { if (i) el.append(document.createElement("br")); el.append(t); }); }
$("reload").onclick = () => location.reload();

// ---------------------------------------------------------------- camera (the original's, verbatim maths)
function perspective(fov, aspect, near, far) { let f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); }
function lookAt(e, t) { let z = e.map((v, i) => v - t[i]), l = Math.hypot(...z); z = z.map(v => v / l); let x = [z[2], 0, -z[0]]; l = Math.hypot(...x); x = x.map(v => v / l); let y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]; return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -x.reduce((s, v, i) => s + v * e[i], 0), -y.reduce((s, v, i) => s + v * e[i], 0), -z.reduce((s, v, i) => s + v * e[i], 0), 1]); }
function multiply(a, b) { let o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let n = 0; for (let k = 0; k < 4; k++) n += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = n; } return o; }
function inverse(a) { let aug = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? a[c * 4 + r] : +(c - 4 === r))); for (let c = 0; c < 4; c++) { let best = c; for (let r = c + 1; r < 4; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[best][c])) best = r; [aug[c], aug[best]] = [aug[best], aug[c]]; let v = aug[c][c]; if (Math.abs(v) < 1e-10) return new Float32Array(16); for (let j = 0; j < 8; j++) aug[c][j] /= v; for (let r = 0; r < 4; r++) if (r !== c) { let v = aug[r][c]; for (let j = 0; j < 8; j++) aug[r][j] -= v * aug[c][j]; } } return Float32Array.from({ length: 16 }, (_, i) => aug[i % 4][4 + Math.floor(i / 4)]); }
const canvasEl = () => $("scene");
function aspect() { const c = canvasEl(); return Math.max(1, c.clientWidth) / Math.max(1, c.clientHeight); }
function verticalFov() { return (aspect() < .8 ? 53 : 42) * Math.PI / 180; }
function updateCamera(dt) {
  if (autoOrbit && running) { cam.azGoal += dt * .035; cam.elGoal = clamp(autoOrbitBaseEl + Math.sin(F.time * .075) * .035, .15, 1.45); }
  const s = 1 - Math.exp(-dt * 7);
  for (let k of ["az", "el", "dist"]) cam[k] = mix(cam[k], cam[k + "Goal"], s);
  for (let i = 0; i < 3; i++) cam.target[i] = mix(cam.target[i], cam.targetGoal[i], s);
  const d = cam.dist;
  eye = [cam.target[0] + d * Math.cos(cam.el) * Math.sin(cam.az), cam.target[1] + d * Math.sin(cam.el), cam.target[2] + d * Math.cos(cam.el) * Math.cos(cam.az)];
  vp = multiply(perspective(verticalFov(), aspect(), .1, 130), lookAt(eye, cam.target)); invVP = inverse(vp);
}
// The same view as an X3D Viewpoint: the lookAt basis as an axis-angle rotation of the default -Z view.
function viewpointFromCamera() {
  const t = cam.target; let z = eye.map((v, i) => v - t[i]); let l = Math.hypot(...z); z = z.map(v => v / l);
  let x = [z[2], 0, -z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const R = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const tr = R[0][0] + R[1][1] + R[2][2], ang = Math.acos(clamp((tr - 1) / 2, -1, 1));
  let axis = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]], n = Math.hypot(...axis);
  if (n < 1e-9) axis = [0, 1, 0]; else axis = axis.map(v => v / n);
  const a = aspect(), vf = verticalFov();
  const fov = a >= 1 ? vf : 2 * Math.atan(Math.tan(vf / 2) * a);      // X3D's fieldOfView spans the smaller dimension
  return { position: eye, axis, angle: ang, fov };
}

// ---------------------------------------------------------------- the scene's inputs
function vec3(a) { return new X3D.SFVec3f(a[0], a[1], a[2]); }
function pushUniforms() {
  const st = F.state, c = F.colors, el = canvasEl().browser.getContext().canvas;
  const shared = { uTime: F.time, uEnergy: st.energy, uBreath: st.breath, uFold: st.fold, uGlow: st.glow, uMetal: st.metal,
    uContours: $("contours").checked ? 1 : 0, uMicro: $("micro").checked ? 1 : 0, uCurrents: $("currents").checked ? 1 : 0,
    uAOStrength: $("depthEffect").checked ? LOOK.ao : 0, uRibbonWidth: LOOK.ribbonWidth, uRibbonGain: LOOK.ribbonGain, uLineScale: Math.max(1, (el.width / Math.max(1, canvasEl().clientWidth)) / (devicePixelRatio || 1)), uVeil: $("veil").checked ? 1 : 0, uPixelRatio: el.width / Math.max(1, canvasEl().clientWidth), uSpriteScale: 1 };
  const v3 = { uA: vec3(c.a), uB: vec3(c.b), uC: vec3(c.c), uEye: vec3(eye) };
  const res = new X3D.SFVec2f(el.width, el.height);
  for (const s of shaders) {
    for (const k in shared) if (s.has.has(k)) s.node[k] = shared[k];
    for (const k in v3) if (s.has.has(k)) s.node[k] = v3[k];
    if (s.has.has("uResolution")) s.node.uResolution = res;
    if (s.has.has("uSources")) s.node.uSources.setValue(F.srcA);
    if (s.has.has("uShape")) s.node.uShape.setValue(F.srcB);
    if (s.has.has("uPulse")) s.node.uPulse.setValue(F.pulseData);
    if (s.has.has("uAnchors")) s.node.uAnchors.setValue(anchors);
  }
}
function pushCamera() {
  const v = viewpointFromCamera();
  N.cam.position = vec3(v.position);
  N.cam.orientation = new X3D.SFRotation(v.axis[0], v.axis[1], v.axis[2], v.angle);
  if (Math.abs(N.cam.fieldOfView - v.fov) > 1e-6) N.cam.fieldOfView = v.fov;
}
function refreshFlow() {
  if (!$("traces").checked) return;
  const prepared = ManifoldMath.prepare(F.sources), path = [], ribbon = [], coord = [], index = [];
  let traces = 0;
  for (let i = 0; i < TRACES; i++) {
    const z = -8.2 + 16.4 * i / (TRACES - 1), theta = .08 * Math.sin(i * .7 + F.time * .07);
    const p = ManifoldMath.trace(-10.5, z, theta, prepared, { step: STEP, count: COUNT, bound: 10.7 });
    const points = p.length / 2; if (points < 2) continue; traces++;
    const base = path.length / 4; let along = 0;
    for (let j = 0; j < points; j++) {
      const x = p[j * 2], zz = p[j * 2 + 1];
      if (j) along += Math.hypot(x - p[(j - 1) * 2], zz - p[(j - 1) * 2 + 1]);
      const before = Math.max(0, j - 1) * 2, after = Math.min(points - 1, j + 1) * 2;
      let tx = p[after] - p[before], tz = p[after + 1] - p[before + 1]; const length = Math.hypot(tx, tz);
      if (length > 1e-10) { tx /= length; tz /= length; } else { tx = Math.cos(theta); tz = Math.sin(theta); }
      path.push(x, zz, along, i, x, zz, along, i); ribbon.push(tx, tz, -1, tx, tz, 1); coord.push(x, 0, zz, x, 0, zz);
      if (j < points - 1) { const a = base + j * 2, b = a + 1, c = a + 2, d = a + 3; index.push(a, c, b, b, c, d); }
    }
  }
  if (!index.length) return;
  flowData = { coord, path, ribbon, index };
  N.flowCoord.point.setValue(new Float32Array(coord));
  N.flowPath.value.setValue(new Float32Array(path));
  N.flowRibbon.value.setValue(new Float32Array(ribbon));
  N.flowGeometry.index.setValue(new Int32Array(index));
  flowInfo = { traces, vertices: coord.length / 3, indices: index.length };
  lastFlowTime = F.time;
}

// ---------------------------------------------------------------- the frame (one guarded X3D field callback)
function tick(now) {
  const raw = last ? (now - last) / 1000 : 1 / 60; last = now;
  const dt = Math.min(.2, raw), wallDelta = Math.min(1., raw);
  const p = presets[F.mood];
  const settling = Object.keys(F.state).some(k => Math.abs(F.state[k] - F.desired[k]) > .0003) || Math.abs(F.phase - p.phase) > .0003;
  if (running) F.time += wallDelta * F.state.speed;
  F.updateSources(running || settling ? dt : 0); updateCamera(dt);
  if (running && journey) { journeyTime += wallDelta; if (journeyTime >= 32) { journeyTime %= 32; chooseMood((F.mood + 1) % 4, true); } $("journeyProgress").style.transform = "scaleX(" + (journeyTime / 32) + ")"; }
  if ($("traces").checked && (lastFlowTime === -999 || ((running || settling) && now - lastFlowClock > 320))) { refreshFlow(); lastFlowClock = now; }
  for (let i = 0; i < F.sources.length; i++) { const q = F.sources[i]; anchors.set([q.x, F.heightAt(q.x, q.z) + .16, q.z, q.amp], i * 4); }
  pushUniforms(); pushCamera();
  updateLabels(); frame++;
  fpsAccum += raw; fpsFrames++;
  if (fpsAccum > 1) {
    const fps = fpsFrames / fpsAccum; fpsShown = fps; $("fps").textContent = running ? Math.round(fps) + " fps" : "PAUSED";
    if (running && qualityAuto && now > qualityCooldown) { if (fps < 27 && qualityIndex > 0) setQuality(qualityIndex - 1, true); else if (fps > 57 && qualityIndex < 3) setQuality(qualityIndex + 1, true); }
    fpsAccum = 0; fpsFrames = 0;
  }
  if (frame === 3) { $("loader").style.opacity = 0; setTimeout(() => $("loader").hidden = true, 650); }
}
function onFrame() {
  try { if (ready) tick(performance.now()); queueMicrotask(lensFrame); } catch (e) { console.error(e); }
}
// The lens reads X_ITE's frame in a microtask queued from the frame's own event callback: X_ITE processes events
// and draws in one animation-frame callback, so the microtask runs right after the draw and before the browser
// composites. (A separate requestAnimationFrame loop sometimes read the canvas between a clear and a draw: black
// frames, 1 in 8 while running, 6 Nov.)
function lensFrame() {
  try {
    const src = canvasEl().browser.getContext().canvas;
    if (lens && $("lensToggle").checked) { $("lens").hidden = false; lens.render(src, { glow: F.state.glow, time: F.time, grain: $("grain").checked, scale: (src.width / Math.max(1, canvasEl().clientWidth)) / (devicePixelRatio || 1) }); }
    else $("lens").hidden = true;
    if (capture) { const c = capture; capture = null; c(src); }
  } catch (e) { console.error(e); }
}

// ---------------------------------------------------------------- the original's interface
function updateLabels() { window.AffectLabels?.update({ sources: F.sources, heightAt: F.heightAt, vp, eye, enabled: labelsEnabled, immersive, compact: innerWidth < 600, blockedRects: running ? undefined : [] }); }
function chooseMood(i, fromJourney = false) { F.mood = i; const p = presets[i]; for (const k of Object.keys(F.desired)) { F.desired[k] = p[k]; $(k).value = p[k]; $(k + "Out").textContent = p[k].toFixed(2) + (k === "speed" ? "×" : ""); } document.querySelectorAll("[data-mood]").forEach(b => b.setAttribute("aria-pressed", +(b.dataset.mood) === i)); $("moodTitle").textContent = p.name; $("moodNumber").textContent = p.tag; setText($("moodDesc"), p.desc); if (!fromJourney) journeyTime = 0; lastFlowTime = -999; }
function pause() { running = !running; $("play").setAttribute("aria-label", running ? "Pause motion" : "Resume motion"); $("playPath").setAttribute("d", running ? "M7 4v12M13 4v12" : "M6 3l10 7-10 7Z"); $("stateLabel").textContent = running ? "FIELD EVOLVING" : "MOTION SUSPENDED"; }
function orbitToggle(force) { autoOrbit = force ?? !autoOrbit; if (autoOrbit) autoOrbitBaseEl = cam.elGoal; $("orbit").classList.toggle("on", autoOrbit); $("orbit").setAttribute("aria-pressed", autoOrbit); }
function journeyToggle() { journey = !journey; journeyTime = 0; $("journey").classList.toggle("on", journey); $("journey").setAttribute("aria-pressed", journey); $("journeyInfo").hidden = !journey; toast(journey ? "Continuous journey · a new state every 32 seconds" : "Journey paused"); }
function hideToggle() { immersive = !immersive; document.body.classList.toggle("immersive", immersive); document.querySelectorAll(".chrome").forEach(e => e.inert = immersive); if (immersive) canvasEl().focus({ preventScroll: true }); if (immersive) { $("controls").hidden = true; $("about").hidden = true; $("tune").setAttribute("aria-expanded", "false"); $("info").setAttribute("aria-expanded", "false"); } }
function resetCamera() { cam.azGoal = .62; cam.elGoal = .69; cam.distGoal = innerWidth < 560 ? 30 : 27.6; cam.targetGoal = [0, -1.5, 0]; }
function panelToggle(id, button, other, otherButton) { const open = $(id).hidden; $(id).hidden = !open; $(button).setAttribute("aria-expanded", open); $(other).hidden = true; $(otherButton).setAttribute("aria-expanded", "false"); }
function setQuality(i, auto = false) {
  qualityIndex = clamp(i, 0, 3); qualityCooldown = performance.now() + 10000;
  B.setBrowserOption("ContentScale", SCALES[qualityIndex]);
  $("qualityLabel").textContent = (qualityAuto ? "Adaptive · " : "") + ["Light", "Balanced", "High", "Ultra"][qualityIndex] + " · " + SCALES[qualityIndex] + "×";
  if (!auto) lastFlowTime = -999;
}
function unproject(x, y, z) { const a = [x, y, z, 1], o = [0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[r] += invVP[k * 4 + r] * a[k]; return o.slice(0, 3).map(v => v / o[3]); }
function disturb(cx, cy) {
  if (performance.now() - lastTapClock < 180) return;
  const rect = canvasEl().getBoundingClientRect(), x = (cx - rect.left) / rect.width * 2 - 1, y = 1 - (cy - rect.top) / rect.height * 2, n = unproject(x, y, -1), far = unproject(x, y, 1), dir = far.map((v, i) => v - n[i]), norm = Math.hypot(...dir);
  for (let i = 0; i < 3; i++) dir[i] /= norm;
  let prev = null, hit = null;
  for (let d = .2; d < 100; d += .18) { let p = n.map((v, i) => v + dir[i] * d); if (Math.abs(p[0]) > 11 || Math.abs(p[2]) > 11) { prev = null; continue; } let f = p[1] - F.heightAt(p[0], p[2]); if (prev && prev.f > 0 && f <= 0) { let lo = d - .18, hi = d; for (let j = 0; j < 9; j++) { let mid = (lo + hi) / 2, xx = n[0] + dir[0] * mid, yy = n[1] + dir[1] * mid, zz = n[2] + dir[2] * mid; if (yy > F.heightAt(xx, zz)) lo = mid; else hi = mid; } hit = { x: n[0] + dir[0] * hi, z: n[2] + dir[2] * hi }; break; } prev = { f }; }
  if (!hit) return;
  if (!running) { toast("Resume motion to send a wave through the field"); return; }
  F.impulses.push({ ...hit, time: F.time, amp: .5 + F.state.energy * .27 }); if (F.impulses.length > 8) F.impulses.shift();
  lastTapClock = performance.now(); const g = $("gesture"); g.style.left = cx + "px"; g.style.top = cy + "px"; g.style.opacity = .7; setTimeout(() => g.style.opacity = 0, 350);
}

// Save the moment as X3D: the scene file with this instant's heights baked into its ElevationGrid, the shaders'
// inputs set to this instant, and the page camera as its Viewpoint. It opens in any X3D browser.
async function momentX3D() {
  const res = await fetch("scenes/manifold.x3d", { cache: "no-store" }); let x3d = await res.text();
  const n = 513, E = 11.2, h = new Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = F.heightAt((i / (n - 1) * 2 - 1) * E, (j / (n - 1) * 2 - 1) * E).toFixed(4).replace(/\.?0+$/, "");
  x3d = x3d.replace(/(<ElevationGrid DEF='RestHeights'[^>]*height=')[^']*'/, (_, a) => a + h.join(" ") + "'");
  const st = F.state, c = F.colors, f4 = (a) => Array.from(a, v => +v.toFixed(6)).join(" ");
  const values = { uTime: F.time.toFixed(4), uEnergy: st.energy, uBreath: st.breath, uFold: st.fold, uGlow: st.glow, uMetal: st.metal, uA: c.a.join(" "), uB: c.b.join(" "), uC: c.c.join(" "), uEye: eye.map(v => v.toFixed(4)).join(" "), uSources: f4(F.srcA), uShape: f4(F.srcB), uPulse: f4(F.pulseData), uAnchors: f4(anchors) };
  for (const [k, v] of Object.entries(values)) x3d = x3d.replace(new RegExp(`(<field name='${k}' type='[A-Za-z0-9]+' accessType='inputOutput' value=')[^']*'`, "g"), (_, a) => a + v + "'");
  if (flowData && $("traces").checked) {                 // this moment's geodesic ribbons, as the scene's own vertex data
    const j = (a, d) => Array.from(a, x => +x.toFixed(d)).join(" ");
    x3d = x3d.replace(/(<IndexedTriangleSet DEF='FlowGeometry' solid='false' index=')[^']*'/, (_, a) => a + flowData.index.join(" ") + "'")
      .replace(/(<Coordinate DEF='FlowCoord' point=')[^']*'/, (_, a) => a + j(flowData.coord, 5) + "'")
      .replace(/(<FloatVertexAttribute DEF='FlowPath' name='aPath' numComponents='4' value=')[^']*'/, (_, a) => a + j(flowData.path, 5) + "'")
      .replace(/(<FloatVertexAttribute DEF='FlowRibbon' name='aRibbon' numComponents='3' value=')[^']*'/, (_, a) => a + j(flowData.ribbon, 5) + "'");
  }
  const cv = canvasEl().browser.getContext().canvas;
  x3d = x3d.replace(/(<field name='uResolution' type='SFVec2f' accessType='inputOutput' value=')[^']*'/g, (_, a) => a + cv.width + " " + cv.height + "'");
  for (const [k, v] of Object.entries({ uRibbonWidth: LOOK.ribbonWidth, uRibbonGain: LOOK.ribbonGain, uLineScale: Math.max(1, (cv.width / Math.max(1, canvasEl().clientWidth)) / (devicePixelRatio || 1)), uAOStrength: $("depthEffect").checked ? LOOK.ao : 0, uPixelRatio: cv.width / Math.max(1, canvasEl().clientWidth) }))
    x3d = x3d.replace(new RegExp(`(<field name='${k}' type='SFFloat' accessType='inputOutput' value=')[^']*'`, "g"), (_, a) => a + v + "'");
  const v = viewpointFromCamera();
  x3d = x3d.replace(/<Viewpoint DEF='Cam'[^>]*\/>/, `<Viewpoint DEF='Cam' description='this moment' position='${v.position.map(x => x.toFixed(4)).join(" ")}' orientation='${v.axis.map(x => x.toFixed(6)).join(" ")} ${v.angle.toFixed(6)}' fieldOfView='${v.fov.toFixed(6)}'/>`);
  x3d = x3d.replace("<meta name='reference'", `<meta name='moment' content='${presets[F.mood].name} t = ${F.time.toFixed(3)}; saved ${new Date().toISOString()}'/>\n <meta name='reference'`);
  return x3d;
}
async function saveX3D() {
  const x3d = await momentX3D();
  const url = URL.createObjectURL(new Blob([x3d], { type: "model/x3d+xml" })), a = document.createElement("a");
  a.href = url; a.download = "Manifold-" + presets[F.mood].name.replace(".", "") + "-t" + F.time.toFixed(1) + ".x3d"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast("Saved this moment as an X3D scene · " + (x3d.length / 1e6).toFixed(1) + " MB");
  return x3d.length;
}
function snapshot() {
  capture = (src) => {
    const from = $("lensToggle").checked && lens ? $("lens") : src;
    const image = document.createElement("canvas"); image.width = from.width; image.height = from.height;
    const ctx = image.getContext("2d"); ctx.drawImage(from, 0, 0);
    if (labelsEnabled && !immersive) window.AffectLabels?.paint(ctx, image.width / innerWidth, image.height / innerHeight);
    image.toBlob(blob => { if (!blob) { toast("Could not export this image."); return; } const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "Manifold-" + presets[F.mood].name.replace(".", "") + ".png"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast("Image saved" + (labelsEnabled && !immersive ? " · labels included" : "")); }, "image/png");
  };
}

function wireInterface() {
  document.querySelectorAll("[data-mood]").forEach(b => b.onclick = () => chooseMood(+b.dataset.mood));
  $("labelsToggle").onclick = () => { labelsEnabled = !labelsEnabled; $("labelsToggle").setAttribute("aria-pressed", labelsEnabled); $("labelsToggle").classList.toggle("on", labelsEnabled); window.AffectLabels?.setEnabled(labelsEnabled); };
  $("play").onclick = pause; $("orbit").onclick = () => orbitToggle(); $("journey").onclick = journeyToggle; $("hide").onclick = hideToggle; $("reveal").onclick = hideToggle;
  $("tune").onclick = () => panelToggle("controls", "tune", "about", "info"); $("info").onclick = () => panelToggle("about", "info", "controls", "tune"); $("reset").onclick = () => chooseMood(F.mood);
  $("quality").onchange = e => { qualityAuto = e.target.value === "auto"; setQuality(qualityAuto ? 2 : ["low", "balanced", "high", "ultra"].indexOf(e.target.value)); };
  for (let k of Object.keys(F.state)) $(k).oninput = e => { F.desired[k] = +e.target.value; $(k + "Out").textContent = (+e.target.value).toFixed(2) + (k === "speed" ? "×" : ""); };
  $("traces").onchange = () => { N.flows.visible = $("traces").checked; lastFlowTime = -999; };
  $("filaments").onchange = () => { N.filaments.visible = $("filaments").checked; };
  $("fullscreen").onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast("Fullscreen is unavailable in this preview. Open the file in its own browser tab."); } };
  $("snapshot").onclick = snapshot;
  $("saveX3D").onclick = () => saveX3D().catch(e => { console.error(e); toast("Could not save the X3D scene."); });
  document.addEventListener("keydown", e => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if (e.code === "Space") { if (e.target.closest("button,a,[role=\"button\"]")) return; e.preventDefault(); pause(); } else if (k === "l") $("labelsToggle").click(); else if (k === "h") hideToggle(); else if (k === "o") orbitToggle(); else if (k === "j") journeyToggle(); else if (k === "p") $("snapshot").click(); else if (k === "x") $("saveX3D").click(); else if (k === "f") $("fullscreen").click(); else if (e.key === "Escape") { if (immersive) hideToggle(); $("controls").hidden = true; $("about").hidden = true; $("tune").setAttribute("aria-expanded", "false"); $("info").setAttribute("aria-expanded", "false"); } else if (e.key === "ArrowLeft") { e.preventDefault(); orbitToggle(false); cam.azGoal -= .12; } else if (e.key === "ArrowRight") { e.preventDefault(); orbitToggle(false); cam.azGoal += .12; } else if (e.key === "ArrowUp") { e.preventDefault(); cam.elGoal = clamp(cam.elGoal + .08, .13, 1.49); } else if (e.key === "ArrowDown") { e.preventDefault(); cam.elGoal = clamp(cam.elGoal - .08, .13, 1.49); } });
  const canvas = canvasEl(), pointers = new Map(); let down = null, lastPinch = 0;
  canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); down = { x: e.clientX, y: e.clientY, time: performance.now(), moved: false }; if (pointers.size === 2) { const a = [...pointers.values()]; lastPinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); down.moved = true; } });
  canvas.addEventListener("pointermove", e => { if (!pointers.has(e.pointerId)) return; let prev = pointers.get(e.pointerId), dx = e.clientX - prev.x, dy = e.clientY - prev.y; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true; if (pointers.size === 2) { const a = [...pointers.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (lastPinch > 0) cam.distGoal = clamp(cam.distGoal * lastPinch / Math.max(1, d), 10, 50); lastPinch = d; return; } if (down?.moved) orbitToggle(false); if (e.shiftKey || (e.buttons & 2)) { const s = cam.dist * .0015; cam.targetGoal[0] -= (dx * Math.cos(cam.az) + dy * Math.sin(cam.az)) * s; cam.targetGoal[2] += (dx * Math.sin(cam.az) - dy * Math.cos(cam.az)) * s; cam.targetGoal[0] = clamp(cam.targetGoal[0], -7, 7); cam.targetGoal[2] = clamp(cam.targetGoal[2], -7, 7); } else { cam.azGoal -= dx * .005; cam.elGoal = clamp(cam.elGoal + dy * .004, .13, 1.49); } });
  canvas.addEventListener("pointerup", e => { if (down && !down.moved && pointers.size === 1 && performance.now() - down.time < 450) disturb(e.clientX, e.clientY); pointers.delete(e.pointerId); if (!pointers.size) down = null; lastPinch = 0; });
  canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); down = null; lastPinch = 0; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); cam.distGoal = clamp(cam.distGoal * Math.exp(clamp(e.deltaY, -200, 200) * .001), 10, 50); }, { passive: false });
  canvas.addEventListener("dblclick", resetCamera); canvas.addEventListener("contextmenu", e => e.preventDefault());
  if (document.fonts) document.fonts.load('10px "Manifold CJK"', "喜悦宁静好奇渴望敬畏紧张温柔文").then(() => window.AffectLabels.invalidate()).catch(() => {});
}

// ---------------------------------------------------------------- deep links: a whole view in the address
// #mood=2&settle=1&t=41.3&az=.62&el=.69&dist=27.6&target=0,-1.5,0&paused=1&orbit=0&labels=1&lens=0&quality=3
function parseHash() { return Object.fromEntries(new URLSearchParams(location.hash.slice(1)).entries()); }
function route() {
  const h = parseHash();
  if (h.mood !== undefined) chooseMood(clamp(+h.mood | 0, 0, 3));
  if (h.settle === "1") { F.settle(); for (const k of Object.keys(F.state)) { $(k).value = F.state[k]; $(k + "Out").textContent = F.state[k].toFixed(2) + (k === "speed" ? "×" : ""); } }
  if (h.t !== undefined && isFinite(+h.t)) F.time = +h.t;
  for (const k of ["az", "el", "dist"]) if (h[k] !== undefined && isFinite(+h[k])) cam[k] = cam[k + "Goal"] = +h[k];
  if (h.target) { const t = h.target.split(",").map(Number); if (t.length === 3 && t.every(isFinite)) { cam.target = t.slice(); cam.targetGoal = t.slice(); } }
  if (h.orbit === "0") orbitToggle(false);
  if (h.paused === "1" && running) pause();
  if (h.labels === "1" && !labelsEnabled) $("labelsToggle").click();
  for (const [k, key] of [["ao", "ao"], ["rw", "ribbonWidth"], ["rg", "ribbonGain"]]) if (h[k] !== undefined && isFinite(+h[k])) LOOK[key] = +h[k];
  if (h.lens === "0" || h.lens === "1") $("lensToggle").checked = h.lens === "1";
  if (h.quality !== undefined) { qualityAuto = false; $("quality").value = ["low", "balanced", "high", "ultra"][clamp(+h.quality | 0, 0, 3)]; setQuality(+h.quality | 0); }
  for (const k of ["grain", "veil", "traces", "filaments", "depthEffect", "micro", "currents", "contours"]) if (h[k] === "0" || h[k] === "1") { $(k).checked = h[k] === "1"; $(k).dispatchEvent(new Event("change")); }
  F.updateSources(0); updateCamera(0); lastFlowTime = -999;
}

// Read-only report of what is drawn (for evidence; mutates nothing).
window.manifoldView = () => ({
  version: "x3d-1", ready, frame, time: F.time, mood: presets[F.mood].name, running, autoOrbit, journey, labelsEnabled,
  state: { ...F.state }, colors: { a: F.colors.a.slice(), b: F.colors.b.slice(), c: F.colors.c.slice() },
  sources: F.sources.map(s => ({ ...s })), impulses: F.impulses.length,
  camera: { az: cam.az, el: cam.el, dist: cam.dist, target: cam.target.slice() }, eye: eye.slice(), vp: Array.from(vp),
  flows: { ...flowInfo, lastFlowTime, step: STEP, count: COUNT },
  quality: { index: qualityIndex, auto: qualityAuto, contentScale: B ? B.getBrowserOption("ContentScale") : null, fps: fpsShown },
  lens: { on: $("lensToggle").checked, hdr: lens ? lens.hdr : null },
  labels: window.AffectLabels?.getVisible() || [],
  x3d: scene ? { url: scene.worldURL, shaders: shaders.map(s => ({ name: s.name, valid: s.node.isValid })), multisampling: B.getBrowserOption("Multisampling"), blend: "standard alpha (lightOut)" } : null,
  heightAt: (x, z) => F.heightAt(x, z)
});
window.manifoldDiagnostics = window.manifoldView;   // the original's name for the same report
window.manifoldMomentX3D = () => momentX3D();      // the text Save X3D writes (no download, no state change)

function loadWorld(url, ms = 30000) {
  return Promise.race([B.loadURL(new X3D.MFString(url)),
    new Promise((_, reject) => setTimeout(() => reject(Error(`the X3D scene did not load within ${ms / 1000} s: ${url}`)), ms))]);
}

async function main() {
  B = X3D.getBrowser(canvasEl());
  B.setBrowserOption("ContentScale", SCALES[qualityIndex]);
  B.setBrowserOption("Multisampling", 4);
  B.setBrowserOption("ToneMapping", "NONE");
  await loadWorld("scenes/manifold.x3d");
  scene = B.currentScene;
  for (const [k, n] of [["cam", "Cam"], ["clock", "Clock"], ["flows", "Flows"], ["filaments", "Filaments"], ["flowGeometry", "FlowGeometry"], ["flowCoord", "FlowCoord"], ["flowPath", "FlowPath"], ["flowRibbon", "FlowRibbon"]])
    N[k] = scene.getNamedNode(n);
  for (const name of ["SkyShader", "SurfaceShader", "VeilShader", "FlowShader", "FiberShader", "NodeShader", "MoteShader"]) {
    const node = scene.getNamedNode(name), has = new Set();
    const defs = node.getFieldDefinitions();                 // X_ITE 16: user fields are listed with the node's own
    for (let i = 0; i < defs.length; i++) if (/^u[A-Z]/.test(defs[i].name)) has.add(defs[i].name);
    shaders.push({ name, node, has });
  }
  // The light layers blend with standard alpha (shaders/common.glsl lightOut): no BlendMode extension, so the
  // scene file and every saved moment draw the same in any X3D browser that runs its shaders.
  try { lens = ManifoldLens.create($("lens")); } catch (e) { console.warn("lens unavailable", e); $("lensToggle").checked = false; $("lensToggle").disabled = true; }
  wireInterface(); resetCamera(); F.updateSources(0); updateCamera(1); pushUniforms(); pushCamera(); refreshFlow();
  if (reduced) { running = true; pause(); orbitToggle(false); toast("Reduced motion respected · press play to animate"); }
  setQuality(qualityIndex, true);
  ready = true;
  N.clock.addFieldCallback("frame", "elapsedTime", onFrame);
  addEventListener("hashchange", () => { try { route(); } catch (e) { console.error(e); } });
  if (location.hash.length > 1) route();
  fetch("cases/rest/case.json", { cache: "no-store" }).then(r => r.json()).then(c => {
    const pick = (id) => c.witnesses.find(w => w.id === id).observed, m = (id) => c.metrics.find(x => x.id === id).value;
    $("evidence").textContent = `curvature agrees with Brioschi's general formula to ${pick("curvature_general_metric").toExponential(1)}; Gauss–Bonnet holds to ${pick("gauss_bonnet_flux_identity").toExponential(1)}; the paths are geodesics of g (formulation ${pick("geodesic_formulation").toExponential(1)}, RK4 within ${pick("geodesic_rk4_order").toFixed(2)} of order 4, error ${pick("geodesic_rk4_error_page_step").toExponential(1)}); the drawn surface's own geodesics stray ${m("drawn_surface_geodesic_separation")} units from them.`;
  }).catch(() => { $("evidence").textContent = "see cases/rest/case.json"; });
}
main().catch(fail);
})();
