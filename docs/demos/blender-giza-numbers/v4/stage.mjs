// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The v4 stage: one X_ITE browser with two layers. Layer 0 holds the star field (light-years) and its camera;
 * layer 1 holds the baked plateau (metres). Each frame the sky camera copies the stage camera's orientation,
 * so the stars stand at infinity behind the pyramids. Everything the stage shows comes from the two X3D files
 * and the two JSON receipts beside them.
 */
import {
  GIZA_LAT, qmul, qconj, qrot, qslerp, qToAxisAngle, axisAngleToQ, lookAt, skyRotation, raDecOfDate, altAz, moved,
  project, ease,
} from "./sky-math.mjs";

const KEY_STARS = new Set(["Alnitak", "Alnilam", "Mintaka", "Thuban", "Kochab", "Mizar", "Sirius", "Polaris", "Betelgeuse", "Rigel", "Vega", "Regulus", "Denebola"]);

export async function createStage({ canvas, overlay, base = "assets/", onStatus = () => {}, onFrame = () => {} }) {
  await customElements.whenDefined("x3d-canvas");
  const X3D = window.X3D;
  if (typeof X3D === "function") await X3D();
  const B = X3D.getBrowser(canvas);
  if (!B || typeof B.loadURL !== "function") throw new Error("X_ITE could not create a WebGL browser.");
  onStatus("Loading the plateau…");
  const [stageData] = await Promise.all([
    fetch(base + "stage-data.json").then((r) => r.json()),
    B.loadURL(new X3D.MFString(base + "giza.x3d")),
  ]);
  const scene = B.currentScene;
  const N = (name) => scene.getNamedNode(name);
  const where = N("Where"), skyEye = N("SkyEye"), eyes = [N("Eye_A"), N("Eye_B")];
  let eyeIndex = 0;
  const S = {
    data: stageData, sky: null, skyData: null, light: "day", world: "plateau", rig: null, xray: false,
    year: -2559, lst: 0, labels: 60, faint: true, figures: true, showLabels: true, cosmos: [0, 0, 0],
    camPos: [0, 0, 0], camQ: [0, 0, 0, 1], R: [0, 0, 0, 1], tween: null, dirty: true, fov: Math.PI / 4,
  };
  const vec = (p) => new X3D.SFVec3f(p[0], p[1], p[2]);
  const rot = (q) => { const r = qToAxisAngle(q); return new X3D.SFRotation(r[0], r[1], r[2], r[3]); };

  /* ---------------- camera ---------------- */
  function readCamera() {
    const p = where.position_changed, o = where.orientation_changed;
    S.camPos = [p.x, p.y, p.z];
    S.camQ = axisAngleToQ([o.x, o.y, o.z, o.angle]);
  }
  function jump(pos, q, fov = S.fov) {
    // bind the spare viewpoint at the wanted pose: binding clears the user's own orbit offsets
    eyeIndex = 1 - eyeIndex;
    const eye = eyes[eyeIndex];
    eye.position = vec(pos); eye.orientation = rot(q);
    S.fov = fov; eye.fieldOfView = fov; skyEye.fieldOfView = fov;
    eye.set_bind = true;
    S.dirty = true;
  }
  function goto(target, { seconds = 2.4 } = {}) {
    const stop = typeof target === "string" ? S.data.stops[target] : target;
    if (!stop) return Promise.resolve();
    const q1 = stop.q || lookAt(stop.pos, stop.at);
    readCamera();
    const p0 = S.camPos.slice(), q0 = S.camQ.slice();
    const f1 = stop.fov || Math.PI / 4, f0 = S.fov;
    if (seconds <= 0) { jump(stop.pos, q1, f1); return Promise.resolve(); }
    jump(p0, q0, f0);
    return new Promise((resolve) => {
      S.tween = { p0, q0, p1: stop.pos, q1, f0, f1, t0: performance.now(), ms: seconds * 1000, resolve };
    });
  }
  function stepTween(now) {
    const T = S.tween;
    if (!T) return;
    const t = Math.min(1, (now - T.t0) / T.ms), k = ease(t), eye = eyes[eyeIndex];
    eye.position = vec(T.p0.map((c, i) => c + (T.p1[i] - c) * k));
    eye.orientation = rot(qslerp(T.q0, T.q1, k));
    if (T.f1 != null && T.f1 !== T.f0) { S.fov = T.f0 + (T.f1 - T.f0) * k; eye.fieldOfView = S.fov; skyEye.fieldOfView = S.fov; }
    if (T.cos) S.cosmos = T.cos.a.map((c, i) => c + (T.cos.b[i] - c) * k);
    S.dirty = true;
    if (t >= 1) { S.tween = null; T.resolve(); }
  }
  canvas.addEventListener("pointerdown", () => { if (S.tween && !S.tween.cos) { const T = S.tween; S.tween = null; T.resolve(); } });

  /* ---------------- light, rigs ---------------- */
  function setLight(light) {
    S.light = light;
    const night = light === "night";
    N("Light").whichChoice = night ? 1 : 0;
    N(night ? "SkyNight" : "SkyDay").set_bind = true;
    N(night ? "HazeNight" : "HazeDay").set_bind = true;
    applySkyVisibility();
    S.dirty = true;
  }
  function setRig(name) {
    S.rig = name && S.data.rigs.includes(name) ? name : null;
    N("Proof").whichChoice = S.rig ? S.data.rigs.indexOf(S.rig) : -1;
    S.dirty = true;
  }
  function setXray(on) {
    S.xray = !!on;
    for (const k of ["Day", "Night"]) N("Mat_Khufu_" + k).transparency = on ? 0.8 : 0;
    S.dirty = true;
  }
  function setWorld(world) {
    S.world = world;
    N("World").whichChoice = world === "cosmos" ? -1 : 0;
    if (world === "cosmos") { N("SkyNight").set_bind = true; }
    else { S.cosmos = [0, 0, 0]; setLight(S.light); }
    applySkyVisibility();
    S.dirty = true;
  }

  /* ---------------- sky ---------------- */
  let pos = null;            // Float64Array of J2000 positions, 3 per star (bright then faint)
  let moverTimer = 0, moverYear = 2000;
  async function loadSky() {
    onStatus("Loading 52,602 stars…");
    const [skyData, sky] = await Promise.all([
      fetch(base + "sky-data.json").then((r) => r.json()),
      B.createX3DFromURL(new X3D.MFString(base + "sky.x3d")),
    ]);
    S.skyData = skyData; S.sky = sky;
    const bright = sky.getNamedNode("StarsBright"), faint = sky.getNamedNode("StarsFaint");
    pos = new Float64Array(skyData.stars * 3);
    const fill = (node, count, offset) => {
      const P = node.positions;
      for (let i = 0; i < count; i++) { const p = P[i]; pos[3 * (offset + i)] = p.x; pos[3 * (offset + i) + 1] = p.y; pos[3 * (offset + i) + 2] = p.z; }
    };
    fill(bright, skyData.bright, 0); fill(faint, skyData.faint, skyData.bright);
    // the X3D file is the source of the labels too: its MetadataSet must agree with the JSON
    const meta = sky.getNamedNode("StarLabels");
    S.labelCheck = meta ? meta.value[0].value.length : 0;
    for (const m of skyData.movers) m.p0 = [pos[3 * m.i], pos[3 * m.i + 1], pos[3 * m.i + 2]];
    N("SkyRoot").children = sky.rootNodes;
    S.lst = raDecOfDate(skyData.precession, S.year, starPos(skyData.key.Alnitak)).ra;      // Orion's belt on the meridian
    applySky(); applySkyVisibility(); scheduleMovers(true);
    if (S.pendingSky) { const p = S.pendingSky; S.pendingSky = null; setSky(p); }           // a proof asked for a sky before the stars arrived
    onStatus("");
    return skyData;
  }
  const starPos = (i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  function starNow(name) {
    const i = S.skyData.key[name] ?? S.skyData.labels.find((l) => l.n === name)?.i;
    if (i == null) return null;
    const m = S.skyData.movers.find((x) => x.i === i);
    return m ? moved(m.p0, m.v, S.year) : starPos(i);
  }
  function applySky() {
    if (!S.skyData) return;
    S.R = skyRotation(S.skyData.precession, S.year, S.lst, GIZA_LAT);
    S.sky.getNamedNode("SkyRot").rotation = rot(S.R);
    S.dirty = true;
  }
  function applySkyVisibility() {
    if (!S.sky) return;
    const stars = S.world === "cosmos" || S.light === "night";
    S.sky.getNamedNode("StarsBright").visible = stars;
    S.sky.getNamedNode("StarsFaint").visible = stars && S.faint;
    S.sky.getNamedNode("Figures").visible = stars && S.figures;
    S.sky.getNamedNode("SunGlow").visible = S.world === "plateau" && S.light === "day";
    S.sky.getNamedNode("MoonGlow").visible = S.world === "plateau" && S.light === "night";
  }
  function scheduleMovers(now = false) {
    clearTimeout(moverTimer);
    moverTimer = setTimeout(() => {
      if (!S.skyData || Math.abs(moverYear - S.year) < 25) return;
      moverYear = S.year;
      const bright = S.sky.getNamedNode("StarsBright"), faint = S.sky.getNamedNode("StarsFaint");
      const nb = S.skyData.bright;
      for (const m of S.skyData.movers) {
        const p = moved(m.p0, m.v, S.year);
        pos[3 * m.i] = p[0]; pos[3 * m.i + 1] = p[1]; pos[3 * m.i + 2] = p[2];
        if (m.i < nb) bright.positions[m.i] = vec(p); else faint.positions[m.i - nb] = vec(p);
      }
      S.dirty = true;
    }, now ? 0 : 350);
  }
  function setSky(o = {}) {
    if (o.year != null) S.year = Math.max(-13000, Math.min(3000, o.year));
    if (o.faint != null) S.faint = o.faint;
    if (o.figures != null) S.figures = o.figures;
    if (o.labels != null) S.labels = o.labels;
    if (o.showLabels != null) S.showLabels = o.showLabels;
    if (o.lst != null) S.lst = o.lst;
    if (!S.skyData && (o.culminate || o.lst != null)) S.pendingSky = { culminate: o.culminate, lower: o.lower, lst: o.lst };
    if (o.culminate && S.skyData) {
      const p = starNow(o.culminate);
      if (p) S.lst = raDecOfDate(S.skyData.precession, S.year, p).ra + (o.lower ? Math.PI : 0);      // lower: its lowest pass, under the pole
    }
    applySky(); applySkyVisibility(); scheduleMovers();
  }
  /** Where a named star stands now: altitude, azimuth, declination of date. */
  function starInfo(name) {
    if (!S.skyData) return null;
    const p = starNow(name);
    if (!p) return null;
    const rd = raDecOfDate(S.skyData.precession, S.year, p);
    return { ...altAz(qrot(S.R, p)), dec: rd.dec, ra: rd.ra, distance: Math.hypot(...p) };
  }
  /** Fly the sky camera out from Earth toward a star, to a fraction of the way. */
  function flyTo(name, { fraction = 0.72, seconds = 14 } = {}) {
    const p = starNow(name);
    if (!p) return Promise.resolve();
    setWorld("cosmos");
    const target = qrot(S.R, p).map((c) => c * fraction);
    readCamera();
    const q1 = lookAt([0, 0, 0], qrot(S.R, p));
    const p0 = S.camPos.slice(), q0 = S.camQ.slice();
    jump(p0, q0);
    return new Promise((resolve) => {
      S.tween = { p0, q0, p1: p0, q1, t0: performance.now(), ms: seconds * 1000, resolve, cos: { a: S.cosmos.slice(), b: target } };
    });
  }
  function home() { S.cosmos = [0, 0, 0]; setWorld("plateau"); }

  /* ---------------- overlay: star labels and rig labels ---------------- */
  const ctx = overlay.getContext("2d");
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (overlay.width !== Math.round(r.width * dpr) || overlay.height !== Math.round(r.height * dpr)) {
      overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr); S.dirty = true;
    }
    return [r.width, r.height, dpr];
  }
  function draw() {
    const [w, h, dpr] = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const inv = qconj(S.camQ), small = w < 560;
    const taken = new Set();
    const claim = (x, y, tw) => {
      const cy = Math.floor(y / 18), c0 = Math.floor((x - 4) / 46), c1 = Math.floor((x + tw + 4) / 46);
      for (let c = c0; c <= c1; c++) if (taken.has(c + ":" + cy)) return false;
      for (let c = c0; c <= c1; c++) taken.add(c + ":" + cy);
      return true;
    };
    // a rig label is a 20 px box: it takes every grid row it touches, so two of them can never overlap
    const claimBox = (x, y, tw) => {
      const r0 = Math.floor((y - 10) / 18), r1 = Math.floor((y + 10) / 18), c0 = Math.floor((x - 5) / 46), c1 = Math.floor((x + tw + 5) / 46);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (taken.has(c + ":" + r)) return false;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) taken.add(c + ":" + r);
      return true;
    };
    ctx.textBaseline = "middle";
    // rig labels (stage space, metres)
    if (S.rig && S.world === "plateau") {
      ctx.font = `600 ${small ? 11 : 13}px ui-sans-serif, system-ui, sans-serif`;
      for (const a of S.data.anchors) {
        if (a.rig !== S.rig) continue;
        const s = project(qrot(inv, [a.p[0] - S.camPos[0], a.p[1] - S.camPos[1], a.p[2] - S.camPos[2]]), w, h, S.fov);
        if (!s || s[0] < 0 || s[0] > w || s[1] < 0 || s[1] > h) continue;
        const tw = ctx.measureText(a.t).width;
        const x = Math.min(w - tw - 14, Math.max(6, s[0] + 8));
        let y = s[1];
        for (let k = 0; k < 8 && !claimBox(x, y, tw); k++) y += 12;           // two anchors close together: stack the labels
        if (y !== s[1]) { ctx.strokeStyle = "rgba(255,230,168,.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(x - 5, y); ctx.stroke(); }
        ctx.fillStyle = "rgba(8,10,18,.72)"; ctx.fillRect(x - 5, y - 10, tw + 10, 20);
        ctx.fillStyle = "#ffe6a8"; ctx.fillText(a.t, x, y);
        ctx.beginPath(); ctx.arc(s[0], s[1], 2.5, 0, 7); ctx.fill();
      }
    }
    // star labels
    const stars = S.skyData && S.showLabels && (S.world === "cosmos" || S.light === "night");
    S.placed = 0;
    if (stars) {
      const cosmos = S.world === "cosmos", c = S.cosmos, want = small ? Math.min(S.labels, 28) : S.labels;
      for (const l of S.skyData.labels) {
        if (S.placed >= want) break;
        let d = qrot(S.R, starPos(l.i));
        if (cosmos) d = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        else if (hidden(d)) continue;                                        // under the horizon or behind a pyramid
        const s = project(qrot(inv, d), w, h, S.fov);
        if (!s || s[0] < 4 || s[0] > w - 4 || s[1] < 4 || s[1] > h - 4) continue;
        const key = KEY_STARS.has(l.n);
        ctx.font = key ? "600 13px ui-sans-serif, system-ui, sans-serif" : l.t === 1 ? "500 12px ui-sans-serif, system-ui, sans-serif" : "400 10.5px ui-sans-serif, system-ui, sans-serif";
        const tw = ctx.measureText(l.n).width;
        let lx = s[0] + 7, ly = s[1];
        if (!claim(lx, ly, tw)) {
          if (!key) continue;
          // a key star is never dropped: try the left side, then above and below (Orion's belt is three key stars in 3 degrees)
          const spots = [[s[0] - tw - 9, s[1]], [s[0] + 7, s[1] - 18], [s[0] - tw - 9, s[1] - 18], [s[0] + 7, s[1] + 18], [s[0] - tw - 9, s[1] + 18], [s[0] + 7, s[1] - 36], [s[0] + 7, s[1] + 36]];
          const spot = spots.find(([x, y]) => claim(x, y, tw));
          if (!spot) continue;
          [lx, ly] = spot;
        }
        ctx.fillStyle = key ? "#ffd27a" : l.t === 1 ? "rgba(236,240,255,.92)" : l.t === 2 ? "rgba(150,185,255,.78)" : "rgba(140,160,205,.6)";
        ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 4;
        ctx.fillText(l.n, lx, ly);
        ctx.shadowBlur = 0;
        if (key) { ctx.strokeStyle = "rgba(255,210,122,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s[0], s[1], 5.5, 0, 7); ctx.stroke(); }
        S.placed++;
      }
      if (cosmos) {
        const s = project(qrot(inv, [-c[0], -c[1], -c[2]]), w, h, S.fov);
        if (s && Math.hypot(...c) > 1) {
          ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif"; ctx.fillStyle = "#ffe08a";
          ctx.fillText("☉ Sun · Earth · Giza", s[0] + 8, s[1]);
          ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, 7); ctx.fill();
        }
      }
    }
  }
  /** In the plateau world: is a sky direction under the horizon, or behind one of the three (cased) pyramids? */
  function hidden(d) {
    const n = Math.hypot(d[0], d[1], d[2]);
    if (d[1] / n < 0.004) return true;
    const o = S.camPos;
    for (const p of Object.values(S.data.pyramids)) {
      // convex solid: y >= y0 and (±(x-cx) or ±(z-cz)) * h + (y-y0) * a <= a * h
      let t0 = 0, t1 = Infinity;
      const planes = [[0, -1, 0, -p.c[1]]];
      for (const sgn of [1, -1]) { planes.push([sgn * p.h, p.a, 0, p.a * p.h + sgn * p.h * p.c[0] + p.a * p.c[1]]); planes.push([0, p.a, sgn * p.h, p.a * p.h + sgn * p.h * p.c[2] + p.a * p.c[1]]); }
      let hit = true;
      for (const [a, b, c, k] of planes) {
        const den = a * d[0] + b * d[1] + c * d[2], num = k - (a * o[0] + b * o[1] + c * o[2]);
        if (Math.abs(den) < 1e-12) { if (num < 0) { hit = false; break; } continue; }
        const t = num / den;
        if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  }
  // labels are ordered once: key stars, then names by brightness, then the rest by tier and brightness
  function orderLabels() {
    S.skyData.labels.sort((a, b) => (KEY_STARS.has(b.n) - KEY_STARS.has(a.n)) || (a.t === 1 ? a.m - 3 : a.m + a.t) - (b.t === 1 ? b.m - 3 : b.m + b.t));
  }

  /* ---------------- frame loop ---------------- */
  let last = "";
  function frame(now) {
    stepTween(now);
    readCamera();
    const sig = S.camPos.map((c) => c.toFixed(2)).join() + S.camQ.map((c) => c.toFixed(4)).join() + S.cosmos.map((c) => c.toFixed(2)).join();
    if (sig !== last) { last = sig; S.dirty = true; }
    const o = where.orientation_changed;
    skyEye.orientation = new X3D.SFRotation(o.x, o.y, o.z, o.angle);
    skyEye.position = vec(S.cosmos);
    if (S.dirty) { S.dirty = false; draw(); onFrame(S); }
    requestAnimationFrame(frame);
  }
  jump(S.data.stops.hero.pos, lookAt(S.data.stops.hero.pos, S.data.stops.hero.at));
  setLight("day");
  requestAnimationFrame(frame);
  onStatus("");
  const skyReady = loadSky().then((d) => { orderLabels(); S.dirty = true; return d; });
  return { browser: B, scene, state: S, skyReady, goto, jump, setLight, setRig, setXray, setWorld, setSky, starInfo, flyTo, home, lookAt };
}
