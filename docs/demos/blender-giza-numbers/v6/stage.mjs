// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The v6 stage: one X_ITE browser with two layers. Layer 0 holds the star field (light-years) and its camera;
 * layer 1 holds the baked plateau (metres). Each frame the sky camera copies the stage camera's orientation,
 * so the stars stand at infinity behind the pyramids.
 *
 * The bakes and the stars are v4's own files, read from ../v4/assets/ and never copied. v5 added the
 * instrument overlays (assets/instruments.x3d). v6 adds the sky machine (assets/celestial.x3d: horizon,
 * meridian, equator, ecliptic, the path of the pole, an angular ruler) and a long exposure that draws
 * star trails on a canvas of its own.
 */
import {
  GIZA_LAT,
  qmul,
  qconj,
  qrot,
  qslerp,
  qToAxisAngle,
  axisAngleToQ,
  lookAt,
  skyRotation,
  raDecOfDate,
  altAz,
  moved,
  project,
  ease,
  yearLabel,
} from "./sky-math.mjs";
import {
  separation,
  obliquity,
  equatorTilt,
  eclipticRotation,
  greatArc,
  arcRibbon,
} from "./machine-math.mjs";

import {
  withTimeout,
  readJSON,
  createTransitionSlot,
  mapHaloCopies,
  advanceCatalogue,
  constellationPoints,
  labelFits,
  reserveLabel,
} from "./stage-lifecycle.mjs";

const KEY_STARS = new Set([
  "Alnitak",
  "Alnilam",
  "Mintaka",
  "Thuban",
  "Kochab",
  "Mizar",
  "Sirius",
  "Polaris",
  "Betelgeuse",
  "Rigel",
  "Vega",
  "Regulus",
  "Denebola",
]);

export async function createStage({
  canvas,
  overlay,
  trails = null,
  base = "assets/",
  bake = "../v4/assets/",
  onStatus = () => {},
  onFrame = () => {},
}) {
  const X3D = window.X3D;
  if (!X3D || typeof X3D.getBrowser !== "function")
    throw new Error("The local X_ITE runtime did not load.");
  await withTimeout(
    (async () => {
      await customElements.whenDefined("x3d-canvas");
      if (typeof X3D === "function") await X3D();
    })(),
    20000,
    "The X3D renderer did not initialize within 20 seconds.",
  );
  const B = X3D.getBrowser(canvas);
  if (!B || typeof B.loadURL !== "function")
    throw new Error("X_ITE could not create a WebGL browser.");
  onStatus("Loading the plateau…");
  const [stageData, celData] = await Promise.all([
    readJSON(bake + "stage-data.json"),
    readJSON(base + "celestial-data.json").catch(() => null),
    withTimeout(
      B.loadURL(new X3D.MFString(bake + "giza.x3d")),
      45000,
      "Loading the plateau timed out.",
    ),
  ]);
  if (celData?.stops) Object.assign(stageData.stops, celData.stops);
  const scene = B.currentScene;
  const N = (name) => scene.getNamedNode(name);
  const where = N("Where"),
    skyEye = N("SkyEye"),
    eyes = [N("Eye_A"), N("Eye_B")];
  let eyeIndex = 0;
  const S = {
    data: stageData,
    sky: null,
    skyData: null,
    light: "day",
    world: "plateau",
    rig: null,
    xray: false,
    year: -2559,
    lst: 0,
    labels: 60,
    faint: true,
    figures: true,
    showLabels: true,
    cosmos: [0, 0, 0],
    camPos: [0, 0, 0],
    camQ: [0, 0, 0, 1],
    R: [0, 0, 0, 1],
    tween: null,
    dirty: true,
    fov: Math.PI / 4,
    machine: { local: false, equator: false, ecliptic: false, trail: false },
    ruler: null,
    exposing: false,
    trailsDrawn: false,
    celData,
  };
  const vec = (p) => new X3D.SFVec3f(p[0], p[1], p[2]);
  const rot = (q) => {
    const r = qToAxisAngle(q);
    return new X3D.SFRotation(r[0], r[1], r[2], r[3]);
  };

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let frameId = 0,
    disposed = false,
    paused = false,
    pausedAt = 0,
    pendingPose = null,
    settleUntil = 0,
    exposureToken = 0,
    lastFrame = -Infinity,
    maxFrameRate = 45;
  let sensorCallbacks = false,
    intersectionObserver = null,
    resizeObserver = null,
    intersecting = true;
  const transitions = createTransitionSlot((value) => {
    S.tween = value;
  });
  function requestFrame() {
    if (!frameId && !disposed && !paused)
      frameId = requestAnimationFrame(frame);
  }
  function invalidate() {
    S.dirty = true;
    requestFrame();
  }
  function cancelTransition(reason = "cancelled") {
    exposureToken++;
    const result = transitions.cancel(reason);
    invalidate();
    return result;
  }
  function pause() {
    if (paused || disposed) return;
    paused = true;
    pausedAt = performance.now();
    cancelAnimationFrame(frameId);
    frameId = 0;
    canvas.setAttribute("update", "false");
  }
  function resume() {
    if (disposed) return;
    if (paused && S.tween) {
      // A control below the stage can create a new tween while offscreen.
      // Freeze only the part of this tween's lifetime overlapping the pause.
      S.tween.t0 += Math.max(
        0,
        performance.now() - Math.max(pausedAt, S.tween.t0),
      );
    }
    paused = false;
    canvas.setAttribute("update", "true");
    // "true", not "auto": in X_ITE 16.7.1 a canvas set from "false" back to "auto" draws again, but its
    // ProximitySensor keeps reporting the pose it had before the pause, so sky and ground fall out of step.
    // A pose bound while the browser was not updating is bound once more now.
    if (pendingPose && !S.tween) {
      const p = pendingPose;
      pendingPose = null;
      jump(p.pos, p.q, p.fov);
    }
    pendingPose = null;
    settleUntil = performance.now() + 700;
    invalidate();
  }
  function setQuality({
    faint,
    labels,
    maxFrameRate: rate,
    multisampling,
  } = {}) {
    if (rate != null) {
      maxFrameRate = Math.max(10, Math.min(120, Number(rate) || 45));
      canvas.setAttribute("maximumFrameRate", String(maxFrameRate));
    }
    if (multisampling != null)
      canvas.setAttribute(
        "multisampling",
        String(Math.max(0, Math.min(8, Number(multisampling) || 0))),
      );
    setSky({ faint, labels });
  }

  /* ---------------- camera ---------------- */
  function readCamera() {
    const p = where.position_changed,
      o = where.orientation_changed;
    S.camPos = [p.x, p.y, p.z];
    S.camQ = axisAngleToQ([o.x, o.y, o.z, o.angle]);
  }
  function jump(pos, q, fov = S.fov) {
    if (S.tween) cancelTransition("jump");
    clearTrails();
    // bind the spare viewpoint at the wanted pose: binding clears the user's own orbit offsets
    eyeIndex = 1 - eyeIndex;
    const eye = eyes[eyeIndex];
    eye.position = vec(pos);
    eye.orientation = rot(q);
    S.fov = fov;
    eye.fieldOfView = fov;
    skyEye.fieldOfView = fov;
    eye.set_bind = true;
    S.camPos = pos.slice();
    S.camQ = q.slice();
    // a pose bound while the stage is off screen is bound once more when it returns (see resume)
    pendingPose = paused ? { pos: pos.slice(), q: q.slice(), fov } : null;
    settleUntil = performance.now() + 700;
    invalidate();
  }
  function goto(target, { seconds = 2.4 } = {}) {
    const stop = typeof target === "string" ? S.data.stops[target] : target;
    if (!stop) return Promise.resolve();
    cancelTransition("superseded");
    if (reducedMotion?.matches) seconds = 0;
    const q1 = stop.q || lookAt(stop.pos, stop.at);
    // while paused the sensor is stale: the last pose this module set is the camera
    if (!pendingPose) readCamera();
    const p0 = S.camPos.slice(),
      q0 = S.camQ.slice();
    const f1 = stop.fov || Math.PI / 4,
      f0 = S.fov;
    if (seconds <= 0) {
      jump(stop.pos, q1, f1);
      return Promise.resolve({ cancelled: false });
    }
    jump(p0, q0, f0);
    const result = transitions.start({
      p0,
      q0,
      p1: stop.pos,
      q1,
      f0,
      f1,
      t0: performance.now(),
      ms: seconds * 1000,
    });
    invalidate();
    return result;
  }
  function stepTween(now) {
    const T = S.tween;
    if (!T) return;
    if (T.kind === "spin") {
      // the long exposure: the camera stands still, the hour runs, the trails canvas keeps every step
      const t = Math.max(0, Math.min(1, (now - T.t0) / T.ms));
      S.lst = T.lst0 + (T.lst1 - T.lst0) * t;
      applySky();
      readCamera();
      trailStep();
      if (t >= 1) transitions.complete();
      return;
    }
    const t = Math.max(0, Math.min(1, (now - T.t0) / T.ms)),
      k = ease(t),
      eye = eyes[eyeIndex];
    eye.position = vec(T.p0.map((c, i) => c + (T.p1[i] - c) * k));
    eye.orientation = rot(qslerp(T.q0, T.q1, k));
    if (T.f1 != null && T.f1 !== T.f0) {
      S.fov = T.f0 + (T.f1 - T.f0) * k;
      eye.fieldOfView = S.fov;
      skyEye.fieldOfView = S.fov;
    }
    if (T.cos) S.cosmos = T.cos.a.map((c, i) => c + (T.cos.b[i] - c) * k);
    invalidate();
    if (t >= 1) transitions.complete();
  }
  const onPointer = () => cancelTransition("pointer interaction");
  canvas.addEventListener("pointerdown", onPointer);

  /* ---------------- light, rigs ---------------- */
  function setLight(light) {
    S.light = light;
    const night = light === "night";
    N("Light").whichChoice = night ? 1 : 0;
    N(night ? "SkyNight" : "SkyDay").set_bind = true;
    N(night ? "HazeNight" : "HazeDay").set_bind = true;
    clearTrails();
    applySkyVisibility();
    invalidate();
  }
  function setRig(name) {
    S.rig = name && S.data.rigs.includes(name) ? name : null;
    N("Proof").whichChoice = S.rig ? S.data.rigs.indexOf(S.rig) : -1;
    invalidate();
  }
  function setXray(on) {
    S.xray = !!on;
    for (const k of ["Day", "Night"])
      N("Mat_Khufu_" + k).transparency = on ? 0.8 : 0;
    invalidate();
  }
  function setWorld(world) {
    S.world = world;
    N("World").whichChoice = world === "cosmos" ? -1 : 0;
    if (world === "cosmos") {
      N("SkyNight").set_bind = true;
    } else {
      S.cosmos = [0, 0, 0];
      setLight(S.light);
    }
    clearTrails();
    applyMachine();
    applySkyVisibility();
    invalidate();
  }

  /* ---------------- sky ---------------- */
  let pos = null,
    baseline = null,
    haloCopies = [],
    figureCoordinate = null;
  const moverIndex = new Map(),
    nameIndex = new Map();
  async function loadSky() {
    onStatus("Loading 52,602 stars…");
    const [skyData, sky] = await Promise.all([
      readJSON(bake + "sky-data.json"),
      withTimeout(
        B.createX3DFromURL(new X3D.MFString(bake + "sky.x3d")),
        60000,
        "Loading the star field timed out.",
      ),
    ]);
    if (disposed) return skyData;
    S.skyData = skyData;
    S.sky = sky;
    const bright = sky.getNamedNode("StarsBright"),
      faint = sky.getNamedNode("StarsFaint");
    pos = new Float64Array(skyData.stars * 3);
    const fill = (node, count, offset) => {
      const P = node.positions;
      for (let i = 0; i < count; i++) {
        const p = P[i];
        pos[3 * (offset + i)] = p.x;
        pos[3 * (offset + i) + 1] = p.y;
        pos[3 * (offset + i) + 2] = p.z;
      }
    };
    fill(bright, skyData.bright, 0);
    fill(faint, skyData.faint, skyData.bright);
    baseline = new Float64Array(pos);
    const core = Array.from({ length: skyData.bright }, (_, i) =>
      Array.from(baseline.slice(3 * i, 3 * i + 3)),
    );
    const halo = Array.from({ length: skyData.halos }, (_, i) => {
      const p = bright.positions[skyData.bright + i];
      return [p.x, p.y, p.z];
    });
    haloCopies = mapHaloCopies(core, halo);
    figureCoordinate = sky.getNamedNode("Figures").geometry.coord;
    for (const m of skyData.movers) moverIndex.set(m.i, m);
    for (const l of skyData.labels)
      if (!nameIndex.has(l.n)) nameIndex.set(l.n, l.i);
    for (const [name, i] of Object.entries(skyData.key)) nameIndex.set(name, i);
    // the X3D file is the source of the labels too: its MetadataSet must agree with the JSON
    const meta = sky.getNamedNode("StarLabels");
    S.labelCheck = meta ? meta.value[0].value.length : 0;
    for (const m of skyData.movers)
      m.p0 = [pos[3 * m.i], pos[3 * m.i + 1], pos[3 * m.i + 2]];
    N("SkyRoot").children = sky.rootNodes;
    S.lst = raDecOfDate(skyData.precession, S.year, starNow("Alnitak")).ra; // Orion's belt on the meridian
    updateMovers();
    applySky();
    applySkyVisibility();
    if (S.pendingSky) {
      const p = S.pendingSky;
      S.pendingSky = null;
      setSky(p);
    } // a proof asked for a sky before the stars arrived
    onStatus("");
    return skyData;
  }
  const starPos = (i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  function starVector(name, year = S.year) {
    if (!S.skyData || !baseline || !Number.isFinite(year)) return null;
    const i = nameIndex.get(name);
    if (i == null) return null;
    const p0 = Array.from(baseline.slice(3 * i, 3 * i + 3)),
      m = moverIndex.get(i);
    return m ? moved(p0, m.v, year) : p0;
  }
  const starNow = (name) => starVector(name);
  function applySky() {
    if (!S.skyData) return;
    S.R = skyRotation(S.skyData.precession, S.year, S.lst, GIZA_LAT);
    S.sky.getNamedNode("SkyRot").rotation = rot(S.R);
    if (cel) {
      // the star frame turns with the stars; the ecliptic of date turns with the hour and tips with the year
      S.Qecl = eclipticRotation(S.lst, obliquity(celData.obliquity, S.year));
      cel.getNamedNode("CelJ2000").rotation = rot(S.R);
      cel.getNamedNode("CelEclipticTurn").rotation = rot(S.Qecl);
      updateRuler();
    }
    invalidate();
  }
  function applySkyVisibility() {
    if (!S.sky) return;
    const stars = S.world === "cosmos" || S.light === "night";
    S.sky.getNamedNode("StarsBright").visible = stars;
    S.sky.getNamedNode("StarsFaint").visible = stars && S.faint;
    S.sky.getNamedNode("Figures").visible = stars && S.figures;
    S.sky.getNamedNode("SunGlow").visible =
      S.world === "plateau" && S.light === "day";
    S.sky.getNamedNode("MoonGlow").visible =
      S.world === "plateau" && S.light === "night";
  }
  function updateMovers() {
    if (!S.skyData || !baseline || S.renderedYear === S.year) return;
    pos = advanceCatalogue(baseline, S.skyData.movers, S.year);
    const bright = S.sky.getNamedNode("StarsBright"),
      faint = S.sky.getNamedNode("StarsFaint"),
      nb = S.skyData.bright;
    for (const m of S.skyData.movers) {
      const p = starPos(m.i);
      if (m.i < nb) bright.positions[m.i] = vec(p);
      else faint.positions[m.i - nb] = vec(p);
    }
    haloCopies.forEach((index, j) => {
      bright.positions[nb + j] = vec(starPos(index));
    });
    figureCoordinate.point = new X3D.MFVec3f(
      ...constellationPoints(pos, S.skyData.lines).map(vec),
    );
    S.renderedYear = S.year;
    invalidate();
  }
  function setSky(o = {}) {
    if (o.year != null) S.year = Math.max(-13000, Math.min(3000, o.year));
    if (o.faint != null) S.faint = o.faint;
    if (o.figures != null) S.figures = o.figures;
    if (o.labels != null) S.labels = o.labels;
    if (o.showLabels != null) S.showLabels = o.showLabels;
    if (o.lst != null) S.lst = o.lst;
    if (o.year != null || o.lst != null || o.culminate) clearTrails();
    if (!S.skyData && (o.culminate || o.lst != null))
      S.pendingSky = { culminate: o.culminate, lower: o.lower, lst: o.lst };
    if (o.culminate && S.skyData) {
      const p = starNow(o.culminate);
      if (p)
        S.lst =
          raDecOfDate(S.skyData.precession, S.year, p).ra +
          (o.lower ? Math.PI : 0); // lower: its lowest pass, under the pole
    }
    updateMovers();
    applySky();
    applySkyVisibility();
  }
  /** Where a named star stands now: altitude, azimuth, declination of date. */
  function starInfo(name) {
    if (!S.skyData) return null;
    const p = starNow(name);
    if (!p) return null;
    const rd = raDecOfDate(S.skyData.precession, S.year, p);
    return {
      ...altAz(qrot(S.R, p)),
      dec: rd.dec,
      ra: rd.ra,
      distance: Math.hypot(...p),
    };
  }
  /** Fly the sky camera out from Earth toward a star, to a fraction of the way. */
  function flyTo(name, { fraction = 0.72, seconds = 14 } = {}) {
    const p = starNow(name);
    if (!p)
      return Promise.resolve({ cancelled: true, reason: "star unavailable" });
    cancelTransition("superseded");
    if (reducedMotion?.matches) seconds = 0;
    setWorld("cosmos");
    const target = qrot(S.R, p).map((c) => c * fraction);
    readCamera();
    const q1 = lookAt([0, 0, 0], qrot(S.R, p));
    const p0 = S.camPos.slice(),
      q0 = S.camQ.slice();
    jump(p0, q0);
    if (seconds <= 0) {
      jump(p0, q1);
      S.cosmos = target;
      invalidate();
      return Promise.resolve({ cancelled: false });
    }
    const result = transitions.start({
      p0,
      q0,
      p1: p0,
      q1,
      t0: performance.now(),
      ms: seconds * 1000,
      cos: { a: S.cosmos.slice(), b: target },
    });
    invalidate();
    return result;
  }
  function home() {
    cancelTransition("home");
    S.cosmos = [0, 0, 0];
    setWorld("plateau");
  }

  /* ---------------- the sky machine: frames of the sky, the ruler ---------------- */
  let cel = null;
  const MACHINE = {
    local: "CelLocal",
    equator: "CelEquator",
    ecliptic: "CelEcliptic",
    trail: "CelPoleTrail",
  };
  function applyMachine() {
    if (!cel) return;
    const on = S.world === "plateau";
    for (const [key, name] of Object.entries(MACHINE))
      cel.getNamedNode(name).whichChoice = on && S.machine[key] ? 0 : -1;
    cel.getNamedNode("CelRuler").whichChoice = on && S.ruler ? 0 : -1;
    invalidate();
  }
  function setMachine(o = {}) {
    for (const key of Object.keys(MACHINE))
      if (o[key] != null) S.machine[key] = Boolean(o[key]);
    applyMachine();
  }
  /** Stretch the angular ruler between two named stars, or take it away with no names. */
  function setRuler(a, b) {
    S.ruler = a && b && a !== b ? { a, b, sep: null } : null;
    updateRuler();
    applyMachine();
    return S.ruler;
  }
  function updateRuler() {
    const r = S.ruler;
    if (!r || !S.skyData) return;
    const pa = starVector(r.a),
      pb = starVector(r.b);
    if (!pa || !pb) {
      r.sep = null;
      return;
    }
    r.sep = separation(pa, pb);
    r.sep2000 = separation(starVector(r.a, 2000), starVector(r.b, 2000));
    r.mid = greatArc(pa, pb, 2)[1];
    if (r.drawn === S.year + r.a + r.b || !cel) return;
    const R0 = celData.radius_ly,
      field = (flat) => {
        const out = [];
        for (let i = 0; i < flat.length; i += 3)
          out.push(new X3D.SFVec3f(flat[i], flat[i + 1], flat[i + 2]));
        return new X3D.MFVec3f(...out);
      };
    cel.getNamedNode("RulerCore").point = field(
      arcRibbon(pa, pb, { halfDeg: 0.05, radius: R0 }),
    );
    cel.getNamedNode("RulerGlow").point = field(
      arcRibbon(pa, pb, { halfDeg: 0.32, radius: R0 * 1.01 }),
    );
    r.drawn = S.year + r.a + r.b;
  }

  /* ---------------- the long exposure: star trails on their own canvas ---------------- */
  const tctx = trails ? trails.getContext("2d") : null;
  const trailPrev = new Map();
  let trailStars = null,
    trailSig = "";
  const SPECTRAL = {
    O: "170,200,255",
    B: "178,206,255",
    A: "218,230,255",
    F: "250,246,236",
    G: "255,236,190",
    K: "255,205,150",
    M: "255,170,120",
  };
  function clearTrails() {
    trailPrev.clear();
    if (!tctx || !S.trailsDrawn) return;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, trails.width, trails.height);
    S.trailsDrawn = false;
    invalidate();
  }
  function trailStep() {
    if (!tctx || !S.skyData) return;
    if (!trailStars)
      trailStars = S.skyData.labels
        .filter((l) => l.m <= 4.9)
        .map((l) => ({
          i: l.i,
          c: `rgba(${SPECTRAL[(l.s || "")[0]] || "230,235,255"},${Math.max(0.16, Math.min(0.95, 0.95 - 0.14 * (l.m + 1))).toFixed(2)})`,
          w: Math.max(0.7, Math.min(2.4, 2.4 - 0.33 * (l.m + 1))),
        }));
    const [w, h, dpr] = resize();
    if (trails.width !== overlay.width || trails.height !== overlay.height) {
      trails.width = overlay.width;
      trails.height = overlay.height;
      trailPrev.clear();
    }
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.globalCompositeOperation = "lighter";
    const inv = qconj(S.camQ);
    for (const s of trailStars) {
      const d = qrot(S.R, starPos(s.i));
      let p = hidden(d) ? null : project(qrot(inv, d), w, h, S.fov);
      if (p && (p[0] < -30 || p[0] > w + 30 || p[1] < -30 || p[1] > h + 30))
        p = null;
      const q = trailPrev.get(s.i);
      if (p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 90) {
        tctx.strokeStyle = s.c;
        tctx.lineWidth = s.w;
        tctx.beginPath();
        tctx.moveTo(q[0], q[1]);
        tctx.lineTo(p[0], p[1]);
        tctx.stroke();
      }
      if (p) trailPrev.set(s.i, p);
      else trailPrev.delete(s.i);
    }
    S.trailsDrawn = true;
  }
  const camSig = () =>
    S.camPos.map((c) => c.toFixed(2)).join() +
    S.camQ.map((c) => c.toFixed(4)).join() +
    S.cosmos.map((c) => c.toFixed(2)).join();
  /**
   * Hold the camera still and let the sky turn: `hours` of sidereal time in `seconds` of yours.
   * The Sun is not simulated, so this is one unbroken night however long you make it.
   */
  async function exposure({ hours = 10, seconds = 30 } = {}) {
    if (!S.skyData) return { cancelled: true, reason: "sky unavailable" };
    cancelTransition("superseded");
    // a pose bound a moment ago reaches the sensor a frame or two late: expose only once it has
    const wait = settleUntil - performance.now();
    if (wait > 0) {
      const mine = ++exposureToken;
      await new Promise((r) => setTimeout(r, wait + 40));
      if (mine !== exposureToken || disposed) return { cancelled: true };
    } else ++exposureToken;
    clearTrails();
    const lst0 = S.lst,
      lst1 = S.lst + (hours * 15.0410686 * Math.PI) / 180;
    readCamera();
    trailSig = camSig();
    S.exposing = true;
    S.exposure = { hours, lst0, lst1 };
    if (reducedMotion?.matches) seconds = 0;
    if (seconds <= 0) {
      // no motion wanted: draw the whole exposure at once
      const steps = Math.max(60, Math.round(hours * 40));
      for (let k = 0; k <= steps; k++) {
        S.lst = lst0 + ((lst1 - lst0) * k) / steps;
        S.R = skyRotation(S.skyData.precession, S.year, S.lst, GIZA_LAT);
        trailStep();
      }
      applySky();
      S.exposing = false;
      return { cancelled: false };
    }
    const result = transitions.start({
      kind: "spin",
      lst0,
      lst1,
      t0: performance.now(),
      ms: seconds * 1000,
    });
    result.then(() => {
      S.exposing = false;
      readCamera();
      trailSig = camSig();
      invalidate();
    });
    invalidate();
    return result;
  }
  const MACHINE_STYLE = {
    local: "#8feaff",
    equator: "#ffd27a",
    ecliptic: "#d3bcff",
    j2000: "#f4f1ea",
  };

  /* ---------------- overlay: star labels and rig labels ---------------- */
  const ctx = overlay.getContext("2d");
  function resize() {
    const r = canvas.getBoundingClientRect(),
      dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      overlay.width !== Math.round(r.width * dpr) ||
      overlay.height !== Math.round(r.height * dpr)
    ) {
      overlay.width = Math.round(r.width * dpr);
      overlay.height = Math.round(r.height * dpr);
      invalidate();
    }
    return [r.width, r.height, dpr];
  }
  function draw() {
    const [w, h, dpr] = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const inv = qconj(S.camQ),
      small = w < 560;
    const taken = new Set();
    const claim = (x, y, tw) =>
      labelFits(x, y, tw, 14, w, h, 3) && reserveLabel(taken, x, y, tw, 14, 3);
    const claimBox = (x, y, tw) => reserveLabel(taken, x, y, tw, 20, 5);
    ctx.textBaseline = "middle";
    // rig labels (stage space, metres)
    if (S.rig && S.world === "plateau") {
      ctx.font = `600 ${small ? 11 : 13}px ui-sans-serif, system-ui, sans-serif`;
      for (const a of S.data.anchors) {
        if (a.rig !== S.rig) continue;
        const s = project(
          qrot(inv, [
            a.p[0] - S.camPos[0],
            a.p[1] - S.camPos[1],
            a.p[2] - S.camPos[2],
          ]),
          w,
          h,
          S.fov,
        );
        if (!s || s[0] < 0 || s[0] > w || s[1] < 0 || s[1] > h) continue;
        let label = a.t;
        while (label.length > 1 && ctx.measureText(label).width > w - 28)
          label = label.slice(0, -2) + "…";
        const tw = ctx.measureText(label).width;
        const x = Math.min(w - tw - 8, Math.max(6, s[0] + 8));
        const positions = Array.from({ length: 8 }, (_, k) =>
          Math.min(h - 16, Math.max(16, s[1] + k * 22)),
        );
        const y = positions.find(
          (y) => labelFits(x, y, tw, 20, w, h, 5) && claimBox(x, y, tw),
        );
        if (y == null) continue;
        if (y !== s[1]) {
          ctx.strokeStyle = "rgba(255,230,168,.6)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s[0], s[1]);
          ctx.lineTo(x - 5, y);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(8,10,18,.72)";
        ctx.fillRect(x - 5, y - 10, tw + 10, 20);
        ctx.fillStyle = "#ffe6a8";
        ctx.fillText(label, x, y);
        ctx.beginPath();
        ctx.arc(s[0], s[1], 2.5, 0, 7);
        ctx.fill();
      }
    }
    // the sky machine's own labels: each frame of the sky turns its labels with it
    const machineLabels = () => {
      if (!(cel && celData && S.world === "plateau")) return;
      const frames = [
        ["local", S.machine.local, [0, 0, 0, 1]],
        ["equator", S.machine.equator, equatorTilt()],
        ["ecliptic", S.machine.ecliptic, S.Qecl],
        ["j2000", S.machine.trail, S.R],
      ];
      ctx.textAlign = "center";
      for (const [frame, on, q] of frames) {
        if (!on || !q) continue;
        for (const L of celData.labels[frame]) {
          if (small && L.k === "tick") continue;
          const d = qrot(q, L.d);
          if (hidden(d)) continue;
          const s = project(qrot(inv, d), w, h, S.fov);
          if (!s || s[0] < 8 || s[0] > w - 8 || s[1] < 60 || s[1] > h - 60)
            continue;
          let text = L.t;
          if (L.t === "Celestial pole") text += " of " + yearLabel(S.year);
          ctx.font =
            L.k === "cardinal"
              ? "700 17px ui-sans-serif, system-ui, sans-serif"
              : L.k === "tick" || L.k === "year"
                ? "500 10.5px ui-monospace, SFMono-Regular, Menlo, monospace"
                : "600 12px ui-sans-serif, system-ui, sans-serif";
          const tw = ctx.measureText(text).width;
          if (!claim(s[0] - tw / 2, s[1], tw)) continue;
          ctx.shadowColor = "rgba(0,0,0,.95)";
          ctx.shadowBlur = 5;
          ctx.fillStyle = MACHINE_STYLE[frame];
          ctx.globalAlpha = L.k === "tick" ? 0.8 : 1;
          ctx.fillText(text, s[0], s[1]);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
      }
      if (S.ruler?.sep != null && S.ruler.mid) {
        const d = qrot(S.R, S.ruler.mid),
          s = hidden(d) ? null : project(qrot(inv, d), w, h, S.fov);
        if (s && s[0] > 30 && s[0] < w - 30 && s[1] > 40 && s[1] < h - 40) {
          const text = S.ruler.sep.toFixed(2) + "°";
          ctx.font = "700 14px ui-monospace, SFMono-Regular, Menlo, monospace";
          const tw = ctx.measureText(text).width;
          reserveLabel(taken, s[0] - tw / 2, s[1] - 16, tw, 18, 4);
          ctx.fillStyle = "rgba(8,10,18,.78)";
          ctx.fillRect(s[0] - tw / 2 - 6, s[1] - 27, tw + 12, 22);
          ctx.fillStyle = "#ff9d8c";
          ctx.fillText(text, s[0], s[1] - 16);
        }
      }
      ctx.textAlign = "start";
    };
    // star labels: the key stars first, then the sky machine's labels, then every other star
    const stars =
      S.skyData &&
      S.showLabels &&
      (S.world === "cosmos" || S.light === "night");
    S.placed = 0;
    if (stars) {
      const cosmos = S.world === "cosmos",
        c = S.cosmos,
        want = small ? Math.min(S.labels, 28) : S.labels;
      for (const pass of [0, 1]) {
       if (pass === 1) machineLabels();
       for (const l of S.skyData.labels) {
        if (S.placed >= want) break;
        const key = KEY_STARS.has(l.n);
        if ((pass === 0) !== key) continue;
        let d = qrot(S.R, starPos(l.i));
        if (cosmos) d = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        else if (hidden(d)) continue; // under the horizon or behind a pyramid
        const s = project(qrot(inv, d), w, h, S.fov);
        if (!s || s[0] < 4 || s[0] > w - 4 || s[1] < 4 || s[1] > h - 4)
          continue;
        ctx.font = key
          ? "600 13px ui-sans-serif, system-ui, sans-serif"
          : l.t === 1
            ? "500 12px ui-sans-serif, system-ui, sans-serif"
            : "400 10.5px ui-sans-serif, system-ui, sans-serif";
        const tw = ctx.measureText(l.n).width;
        let lx = s[0] + 7,
          ly = s[1];
        if (!claim(lx, ly, tw)) {
          if (!key) continue;
          // a key star is never dropped: try the left side, then above and below (Orion's belt is three key stars in 3 degrees)
          const spots = [
            [s[0] - tw - 9, s[1]],
            [s[0] + 7, s[1] - 18],
            [s[0] - tw - 9, s[1] - 18],
            [s[0] + 7, s[1] + 18],
            [s[0] - tw - 9, s[1] + 18],
            [s[0] + 7, s[1] - 36],
            [s[0] + 7, s[1] + 36],
          ];
          const spot = spots.find(([x, y]) => claim(x, y, tw));
          if (!spot) continue;
          [lx, ly] = spot;
        }
        ctx.fillStyle = key
          ? "#ffd27a"
          : l.t === 1
            ? "rgba(236,240,255,.92)"
            : l.t === 2
              ? "rgba(150,185,255,.78)"
              : "rgba(140,160,205,.6)";
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 4;
        ctx.fillText(l.n, lx, ly);
        ctx.shadowBlur = 0;
        if (key) {
          ctx.strokeStyle = "rgba(255,210,122,.8)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(s[0], s[1], 5.5, 0, 7);
          ctx.stroke();
        }
        S.placed++;
       }
      }
      if (cosmos) {
        const s = project(qrot(inv, [-c[0], -c[1], -c[2]]), w, h, S.fov);
        if (s && Math.hypot(...c) > 1) {
          ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#ffe08a";
          ctx.fillText("☉ Sun · Earth · Giza", s[0] + 8, s[1]);
          ctx.beginPath();
          ctx.arc(s[0], s[1], 3, 0, 7);
          ctx.fill();
        }
      }
    } else machineLabels();
  }
  /** In the plateau world: is a sky direction under the horizon, or behind one of the three (cased) pyramids? */
  // (draw() calls machineLabels itself when no stars are shown)
  function hidden(d) {
    const n = Math.hypot(d[0], d[1], d[2]);
    if (d[1] / n < 0.004) return true;
    const o = S.camPos;
    for (const p of Object.values(S.data.pyramids)) {
      // convex solid: y >= y0 and (±(x-cx) or ±(z-cz)) * h + (y-y0) * a <= a * h
      let t0 = 0,
        t1 = Infinity;
      const planes = [[0, -1, 0, -p.c[1]]];
      for (const sgn of [1, -1]) {
        planes.push([
          sgn * p.h,
          p.a,
          0,
          p.a * p.h + sgn * p.h * p.c[0] + p.a * p.c[1],
        ]);
        planes.push([
          0,
          p.a,
          sgn * p.h,
          p.a * p.h + sgn * p.h * p.c[2] + p.a * p.c[1],
        ]);
      }
      let hit = true;
      for (const [a, b, c, k] of planes) {
        const den = a * d[0] + b * d[1] + c * d[2],
          num = k - (a * o[0] + b * o[1] + c * o[2]);
        if (Math.abs(den) < 1e-12) {
          if (num < 0) {
            hit = false;
            break;
          }
          continue;
        }
        const t = num / den;
        if (den > 0) t1 = Math.min(t1, t);
        else t0 = Math.max(t0, t);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }
  // labels are ordered once: key stars, then names by brightness, then the rest by tier and brightness
  function orderLabels() {
    S.skyData.labels.sort(
      (a, b) =>
        KEY_STARS.has(b.n) - KEY_STARS.has(a.n) ||
        (a.t === 1 ? a.m - 3 : a.m + a.t) - (b.t === 1 ? b.m - 3 : b.m + b.t),
    );
  }

  /* ---------------- independent analytical overlay scene ---------------- */
  let instruments = null;
  const instrumentState = {
      section: false,
      geometry: false,
      harmonics: false,
      survey: false,
    },
    instrumentNames = {
      section: "InstrumentSection",
      geometry: "InstrumentGeometry",
      harmonics: "InstrumentHarmonics",
      survey: "InstrumentSurvey",
    };
  let sliceFraction = 0.2928932188134524,
    instrumentOpacity = 0.16,
    modelBase = stageData.pyramids.Khufu.base,
    modelSlope = 51 + 52 / 60;
  function setInstrument(name, on) {
    const key = Object.keys(instrumentNames).find(
      (k) => k === name || instrumentNames[k] === name,
    );
    if (!key) throw new RangeError("Unknown instrument layer: " + name);
    instrumentState[key] = Boolean(on);
    if (instruments)
      instruments.getNamedNode(instrumentNames[key]).whichChoice = on ? 0 : -1;
    invalidate();
  }
  function setSlice(fraction) {
    if (!Number.isFinite(fraction))
      throw new RangeError("Slice fraction must be finite.");
    sliceFraction = Math.max(0, Math.min(1, fraction));
    if (instruments) {
      const p = stageData.pyramids.Khufu,
        r = Math.max(1e-5, p.a * (1 - sliceFraction)),
        h = p.h * sliceFraction;
      const n = instruments.getNamedNode("SliceTransform");
      n.translation = vec([0, h, 0]);
      n.scale = vec([r, 1, r]);
      try {
        instruments.getNamedNode("SliceLabelTransform").translation = vec([
          p.a + 48,
          h,
          0,
        ]);
        instruments.getNamedNode("SliceText").string = new X3D.MFString(
          `SLICE ${(100 * sliceFraction).toFixed(1)}% / ${h.toFixed(2)} m`,
        );
      } catch {}
    }
    invalidate();
  }
  function setInstrumentOpacity(opacity) {
    if (!Number.isFinite(opacity))
      throw new RangeError("Opacity must be finite.");
    instrumentOpacity = Math.max(0, Math.min(1, opacity));
    if (instruments)
      instruments.getNamedNode("SliceFillMaterial").transparency =
        1 - instrumentOpacity;
    invalidate();
  }
  function setModel(base, slopeDeg) {
    if (
      !Number.isFinite(base) ||
      base <= 0 ||
      !Number.isFinite(slopeDeg) ||
      slopeDeg <= 0 ||
      slopeDeg >= 90
    )
      throw new RangeError(
        "Model needs a positive base and a slope between 0 and 90 degrees.",
      );
    modelBase = base;
    modelSlope = slopeDeg;
    if (instruments) {
      const p = stageData.pyramids.Khufu;
      instruments.getNamedNode("ExperimentEnvelope").scale = vec([
        base / p.base,
        ((base / 2) * Math.tan((slopeDeg * Math.PI) / 180)) / p.h,
        base / p.base,
      ]);
    }
    invalidate();
  }
  const instrumentReady = withTimeout(
    B.createX3DFromURL(new X3D.MFString(base + "instruments.x3d")),
    30000,
    "Loading the analytical overlays timed out.",
  ).then((loaded) => {
    if (disposed) return loaded;
    instruments = loaded;
    S.instruments = loaded;
    const plateau = N("Plateau");
    plateau.children = new X3D.MFNode(
      ...Array.from(plateau.children),
      ...Array.from(loaded.rootNodes),
    );
    for (const [key, on] of Object.entries(instrumentState))
      setInstrument(key, on);
    setSlice(sliceFraction);
    setInstrumentOpacity(instrumentOpacity);
    setModel(modelBase, modelSlope);
    return loaded;
  });
  // Attach a rejection handler immediately; callers can still await the original rejecting promise.
  instrumentReady.catch((error) => {
    S.instrumentError = error.message;
    invalidate();
  });

  /* ---------------- frame loop: idle on camera callbacks, suspended offscreen ---------------- */
  function attachCelestial(loaded) {
    cel = loaded;
    S.celestial = loaded;
    const root = N("SkyRoot");
    root.children = new X3D.MFNode(
      ...Array.from(root.children),
      ...Array.from(loaded.rootNodes),
    );
    applyMachine();
    applySky();
    return loaded;
  }
  let last = "";
  function frame(now) {
    frameId = 0;
    if (disposed || paused) return;
    if (now - lastFrame < 1000 / maxFrameRate) {
      requestFrame();
      return;
    }
    lastFrame = now;
    stepTween(now);
    readCamera();
    const sig = camSig();
    if (sig !== last) {
      last = sig;
      S.dirty = true;
    }
    // a long exposure belongs to the camera that took it: move, and the trails go
    if (S.trailsDrawn && !S.exposing && sig !== trailSig) clearTrails();
    const o = where.orientation_changed;
    skyEye.orientation = new X3D.SFRotation(o.x, o.y, o.z, o.angle);
    skyEye.position = vec(S.cosmos);
    if (S.dirty) {
      S.dirty = false;
      draw();
      onFrame(S);
    }
    // after a bind or a resume the sensor reports the new pose a frame or two late: keep reading until it has
    if (S.tween || !sensorCallbacks || now < settleUntil) requestFrame();
  }
  // X_ITE swallows what a field callback throws, so each one guards itself
  if (typeof where.addFieldCallback === "function") {
    where.addFieldCallback("v5-stage-position", "position_changed", () => {
      try {
        invalidate();
      } catch (e) {
        console.warn(e);
      }
    });
    where.addFieldCallback("v5-stage-orientation", "orientation_changed", () => {
      try {
        invalidate();
      } catch (e) {
        console.warn(e);
      }
    });
    sensorCallbacks = true;
  }
  const onVisibility = () =>
    document.hidden || !intersecting ? pause() : resume();
  document.addEventListener("visibilitychange", onVisibility);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(invalidate);
    resizeObserver.observe(canvas);
  }
  if (typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        intersecting = Boolean(entries[0]?.isIntersecting);
        if (intersecting && !document.hidden) resume();
        else pause();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);
  }
  function dispose() {
    if (disposed) return;
    cancelTransition("disposed");
    disposed = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    canvas.removeEventListener("pointerdown", onPointer);
    document.removeEventListener("visibilitychange", onVisibility);
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    if (sensorCallbacks && typeof where.removeFieldCallback === "function") {
      where.removeFieldCallback("v5-stage-position", "position_changed");
      where.removeFieldCallback("v5-stage-orientation", "orientation_changed");
    }
    canvas.setAttribute("update", "false");
  }
  jump(
    S.data.stops.hero.pos,
    lookAt(S.data.stops.hero.pos, S.data.stops.hero.at),
  );
  setLight("day");
  if (document.hidden) pause();
  else requestFrame();
  onStatus("");
  const skyReady = loadSky().then((d) => {
    if (!disposed) {
      orderLabels();
      invalidate();
    }
    return d;
  });
  skyReady.catch((error) => {
    S.skyError = error.message;
    onStatus(
      "The plateau is available; the sky could not load: " + error.message,
    );
    invalidate();
  });
  // the sky machine loads after the stars, so that both sit in the star layer's root together
  const celestialReady = skyReady.then(async () => {
    if (!celData) throw new Error("The sky machine's data did not load.");
    const loaded = await withTimeout(
      B.createX3DFromURL(new X3D.MFString(base + "celestial.x3d")),
      30000,
      "Loading the sky machine timed out.",
    );
    return disposed ? loaded : attachCelestial(loaded);
  });
  celestialReady.catch((error) => {
    S.machineError = error.message;
    invalidate();
  });
  return {
    browser: B,
    scene,
    state: S,
    skyReady,
    instrumentReady,
    celestialReady,
    setMachine,
    setRuler,
    exposure,
    clearTrails,
    goto,
    jump,
    cancelTransition,
    pause,
    resume,
    dispose,
    setQuality,
    setLight,
    setRig,
    setXray,
    setWorld,
    setSky,
    starInfo,
    starVector,
    flyTo,
    home,
    lookAt,
    setInstrument,
    instrumentState,
    setSlice,
    setInstrumentOpacity,
    setModel,
    invalidate,
  };
}
