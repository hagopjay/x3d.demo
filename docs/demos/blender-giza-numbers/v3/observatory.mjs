// SPDX-License-Identifier: GPL-3.0-or-later
import {
  geometry,
  targets,
  solarPosition,
  latitudeDelta,
  sensitivity,
  seededSamples,
} from "./lab-math.mjs";
import { connectRenderer, withTimeout } from "./renderer.mjs";

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180,
  PHI = (1 + Math.sqrt(5)) / 2;
const REF = { base: 230.363, slope: 51 + 52 / 60, lat: 29.979175 };
REF.height = (REF.base / 2) * Math.tan(REF.slope * DEG);
const C = {
  gold: "#e7bd74",
  cyan: "#74d3d9",
  muted: "#9eadb3",
  line: "#30434d",
  ink: "#f2efe3",
  red: "#e78f86",
  green: "#a8ce99",
};
const state = {
  mode: "geometry",
  ratio: "pi",
  base: REF.base,
  slope: REF.slope,
  time: 15,
  decl: 0,
  probe: 7.85,
  source: false,
  browser: null,
  scene: null,
  camera: "CA_Overview",
  tour: false,
  orbit: false,
  data: null,
  loading: false,
};
let tourTimer = 0,
  orbitFrame = 0,
  orbitStart = 0,
  currentModel;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const f = (v, n = 3) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: n,
    maximumFractionDigits: n,
  });
const signed = (v, n = 3) => `${v >= 0 ? "+" : "−"}${f(Math.abs(v), n)}`;
const line = (x1, y1, x2, y2, stroke = C.line, extra = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" ${extra}/>`;
const text = (x, y, s, color = C.muted, extra = "") =>
  `<text x="${x}" y="${y}" fill="${color}" ${extra}>${esc(s)}</text>`;
const path = (points, color, width = 2, extra = "") =>
  `<path d="${points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const dot = (x, y, r, color) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
function named(name) {
  try {
    return state.scene?.getNamedNode(name);
  } catch {
    return null;
  }
}
function setField(name, field, value) {
  const n = named(name);
  if (n) n[field] = value;
}
function setSwitch(name, on) {
  setField(name, "whichChoice", on ? 0 : -1);
}
function vec3(x, y, z) {
  return new X3D.SFVec3f(x, y, z);
}
function multiVec(points) {
  return new X3D.MFVec3f(...points.map((p) => vec3(...p)));
}
function model() {
  return geometry(state.base, (state.base / 2) * Math.tan(state.slope * DEG));
}
function selectedButtons(selector, selected, attribute) {
  document.querySelectorAll(selector).forEach((b) => {
    const on = b.dataset[attribute] === selected;
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", on);
  });
}

const modes = {
  geometry: {
    kicker: "GEOMETRY / LIVE",
    title: "How close is close?",
    text: "The perimeter nearly matches a circle whose radius is the reconstructed height. Magnify the difference: resemblance becomes measurable.",
    eyebrow: "THE MEASURED MONUMENT",
    view: "A square. A slope. A circle.",
    callout:
      "<b>One degree of freedom.</b> Once the slope is chosen, π-like and φ-like ratios move together. τ is exactly twice the π test.",
    camera: "CA_Overview",
  },
  survey: {
    kicker: "SURVEY / RECONSTRUCTION",
    title: "An almost-square.",
    text: "The mean square is a useful teaching model. Published side estimates differ, and the original corners must be reconstructed from surviving evidence.",
    eyebrow: "THE SURVEYOR’S VIEW",
    view: "Every corner is a reconstruction.",
    callout:
      "<b>Display precision ≠ measurement accuracy.</b> The three decimal places show the model inputs. They do not certify millimetre accuracy for the original monument.",
    camera: "CA_Survey",
  },
  latitude: {
    kicker: "LATITUDE / DATUM & POINT",
    title: "Which point? Which datum?",
    text: "A coordinate is attached to a chosen point in a reference system. The numerical target falls inside this model footprint; the building does not identify a unique seven-decimal latitude.",
    eyebrow: "GEODESY / LOCAL TANGENT MODEL",
    view: "A latitude line is not a unique address.",
    callout:
      "<b>The digits depend on conventions.</b> Metres, seconds and decimal degrees supply the famous resemblance. It does not independently establish ancient knowledge of c.",
    camera: "CA_Latitude",
  },
  solar: {
    kicker: "SUNLIGHT / GEOMETRIC MODEL",
    title: "A changing light instrument.",
    text: "Solar declination and local solar time change the light direction. Watch the apex project onto level ground while the seasonal paths show the larger pattern.",
    eyebrow: "LIGHT / SHADOW / SEASON",
    view: "The Sun draws another measurement.",
    callout:
      "<b>A projection, not an ephemeris.</b> No refraction, terrain horizon, modern clock correction or ancient stellar reconstruction is included.",
    camera: "CA_Overview",
  },
};
function mode(name, { camera = true } = {}) {
  if (!modes[name]) return;
  state.mode = name;
  state.ratio = name === "geometry" ? "pi" : null;
  selectedButtons("[data-ratio]", state.ratio, "ratio");
  const m = modes[name];
  for (const b of document.querySelectorAll("[data-mode]")) {
    const on = b.dataset.mode === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on);
  }
  for (const [id, key] of Object.entries({
    insightKicker: "kicker",
    insightTitle: "title",
    insightText: "text",
    viewEyebrow: "eyebrow",
    viewTitle: "view",
  }))
    $(id).textContent = m[key];
  $("modeCallout").innerHTML = m.callout;
  const layers = {
    geometry: ["Pi", "Survey"],
    survey: ["Survey"],
    latitude: ["Latitude", "Interior"],
    solar: ["Solar", "Survey"],
  }[name];
  for (const key of ["Pi", "Phi", "Survey", "Interior", "Latitude", "Solar"])
    $(`layer${key}`).checked = layers.includes(key);
  $("opacity").value = name === "latitude" ? 18 : 100;
  updateLayers();
  if (camera) bindCamera(m.camera);
}
function bindCamera(name, { manual = false } = {}) {
  if (manual) stopTour();
  stopOrbit();
  if (name === "CA_Overview" && state.scene && !state.source) restoreOverview();
  state.camera = name;
  if (state.scene) {
    const aliases = {
      CA_Overview: "CA_Overview",
      CA_Plan: "CA_Pi",
      CA_Phi: "CA_Phi",
      CA_Ground: "CA_Overview",
      CA_Interior: "CA_Latitude",
      CA_Survey: "CA_Overview",
      CA_Latitude: "CA_Latitude",
    };
    const n = named(state.source ? aliases[name] || name : name);
    if (n) n.set_bind = true;
  }
  const labels = {
    CA_Pi: "CIRCLE / PERIMETER",
    CA_Overview: "OBLIQUE / RECONSTRUCTED CASING",
    CA_Plan: "PLAN / NORTH AT TOP",
    CA_Phi: "EAST ELEVATION / FACE SECTION",
    CA_Ground: "HUMAN SCALE / 1.8 M REFERENCE",
    CA_Interior: "SCHEMATIC / INTERIOR",
    CA_Survey: "SURVEY / RECONSTRUCTED ENVELOPE",
    CA_Latitude: "LATITUDE / SELECTED TRANSECT",
  };
  $("cameraLabel").textContent = state.source
    ? "ORIGINAL BLENDER EXPORT / REFERENCE"
    : labels[name] || name;
  document
    .querySelectorAll("[data-camera]")
    .forEach((b) => b.classList.toggle("active", b.dataset.camera === name));
}
function updateLayers() {
  $("opacityOut").textContent = $("opacity").value + "%";
  if (!state.scene) return;
  if (state.source) {
    const groups = {
      Pi: ["pi_circle", "pi_square", "pi_radius"],
      Phi: ["phi_section", "phi_right_angle", "seked_section"],
      Latitude: ["lat_plane", "lat_span", "lat_point", "lat_gallery_centre"],
      Interior: ["lat_gallery", "lat_passages"],
    };
    for (const [key, names] of Object.entries(groups))
      for (const name of names)
        setField("OB_Overlay_" + name, "visible", $(`layer${key}`).checked);
    setField(
      "MA_Casing_limestone",
      "transparency",
      1 - Number($("opacity").value) / 100,
    );
  } else {
    for (const key of [
      "Pi",
      "Phi",
      "Survey",
      "Courses",
      "Interior",
      "Latitude",
      "Solar",
    ])
      setSwitch("Overlay" + key, $(`layer${key}`).checked);
    setField("Casing", "transparency", 1 - Number($("opacity").value) / 100);
    solarScene(currentModel ?? model());
  }
}
function updateScene(g) {
  if (!state.scene || state.source) return;
  const br = g.base / REF.base,
    hr = g.height / 146.721;
  setField("Monument", "scale", vec3(br, hr, br));
  setField("PiCircle", "scale", vec3(hr, 1, hr));
  setField("PiSquare", "scale", vec3(br, 1, br));
  setField("PhiSection", "scale", vec3(br, hr, br));
  setField("SurveyMeasures", "scale", vec3(br, hr, br));
  // Interior and coordinate overlays remain fixed reference schematics.
  setField(
    "SurveyBaseText",
    "string",
    new X3D.MFString(`b = ${g.base.toFixed(3)} m`),
  );
  setField(
    "SurveyHeightText",
    "string",
    new X3D.MFString(`h = ${g.height.toFixed(3)} m`),
  );
  solarScene(g);
}
function solarScene(g) {
  if (!state.scene || state.source) return;
  const sun = solarPosition(REF.lat, state.decl, (state.time - 12) * 15),
    alt = sun.altitudeDeg * DEG,
    az = (sun.azimuthDeg ?? 180) * DEG;
  const v = [
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    -Math.cos(az) * Math.cos(alt),
  ];
  setField("Sun", "direction", vec3(-v[0], -v[1], -v[2]));
  setField("Sun", "intensity", sun.altitudeDeg > 0 ? 0.95 : 0);
  setField("SunMarker", "translation", vec3(...v.map((x) => x * 215)));
  setSwitch("OverlayShadow", $("layerSolar").checked && sun.altitudeDeg > 2);
  if (sun.altitudeDeg > 2) {
    const a = g.half,
      d = Math.min(4500, g.height * sun.shadowLengthFactor);
    setField(
      "ShadowCoordinate",
      "point",
      multiVec([
        [-a, 0.09, -a],
        [a, 0.09, -a],
        [a, 0.09, a],
        [-a, 0.09, a],
        [-Math.sin(az) * d, 0.09, Math.cos(az) * d],
      ]),
    );
  }
  const points = [];
  for (let i = 0; i <= 90; i++) {
    const p = solarPosition(REF.lat, state.decl, (-6 + (i / 90) * 12) * 15),
      a = p.altitudeDeg * DEG,
      z = (p.azimuthDeg ?? 180) * DEG;
    points.push([
      215 * Math.sin(z) * Math.cos(a),
      215 * Math.sin(a),
      -215 * Math.cos(z) * Math.cos(a),
    ]);
  }
  setField("SolarPathCoordinates", "point", multiVec(points));
}
function updateGeometry() {
  state.base = Number($("base").value);
  state.slope = Number($("slope").value);
  currentModel = model();
  const g = currentModel;
  $("baseOut").textContent = f(g.base) + " m";
  $("slopeOut").textContent = f(state.slope, 4) + "°";
  $("metricBase").innerHTML = `${f(g.base)} <small>m</small>`;
  $("metricHeight").innerHTML = `${f(g.height)} <small>m</small>`;
  $("metricSlope").innerHTML = `${f(g.slopeDeg, 4)}<small>°</small>`;
  $("metricSeked").textContent = f(g.seked, 3) + " palms / cubit";
  $("metricVolume").innerHTML = `${f(g.volume / 1e6)} <small>×10⁶ m³</small>`;
  $("metricResidual").innerHTML =
    `${signed(4 * g.base - 2 * Math.PI * g.height)} <small>m</small>`;
  $("ratioPi").textContent = f(g.pi, 6);
  $("ratioPhi").textContent = f(g.phi, 6);
  $("ratioTau").textContent = f(g.tau, 6);
  $("errorPi").textContent = signed((g.pi / Math.PI - 1) * 100) + "%";
  $("errorPhi").textContent = signed((g.phi / PHI - 1) * 100) + "%";
  $("errorTau").textContent = signed((g.tau / (2 * Math.PI) - 1) * 100) + "%";
  $("slantReadout").textContent = f(g.slant, 2) + " m";
  $("areaReadout").textContent = f(g.area, 0) + " m²";
  const reference =
    Math.abs(g.base - REF.base) < 0.0001 &&
    Math.abs(g.slopeDeg - REF.slope) < 0.00006;
  $("modelStatus").textContent = reference
    ? "REFERENCE · base + historical casing slope"
    : "EXPERIMENT · altered ideal envelope";
  $("sceneState").textContent = state.source
    ? "FIXED BLENDER REFERENCE"
    : reference
      ? "REFERENCE GEOMETRY"
      : "EXPERIMENTAL GEOMETRY";
  document.querySelectorAll("[data-preset]").forEach((b) => {
    const key = b.dataset.preset,
      on =
        key === "survey"
          ? reference
          : Math.abs(g.slopeDeg - targets[key].slopeDeg) < 0.00006;
    b.classList.toggle("selected", on);
  });
  drawResidual(g);
  drawSlope(g);
  drawUncertainty(g);
  drawConstruction(g);
  drawUnits(g);
  updateSolar();
  updateScene(g);
}
function drawResidual(g) {
  const labels = [
    ["exact π", targets.pi.heightForBase(g.base), C.gold],
    ["seked 5½", targets.seked.heightForBase(g.base), C.muted],
    ["exact φ", targets.phi.heightForBase(g.base), C.cyan],
  ];
  const max =
      Math.max(0.45, ...labels.map((x) => Math.abs(x[1] - g.height))) * 1.1,
    x = (v) => 165 + (v / max) * 55;
  let s =
    line(20, 125, 310, 125) +
    line(165, 15, 165, 123, C.muted, 'stroke-dasharray="3 4"') +
    text(165, 144, "current h", C.ink, 'text-anchor="middle"');
  labels.forEach(([label, h, col], i) => {
    const y = 28 + i * 36,
      delta = h - g.height;
    s +=
      text(3, y + 4, label, col) +
      line(165, y, x(delta), y, col, 'stroke-width="2"') +
      dot(x(delta), y, 3, col) +
      text(317, y + 4, signed(delta) + " m", col, 'text-anchor="end"');
  });
  $("residualChart").innerHTML = s;
}
function drawSlope(g) {
  const W = 640,
    left = 54,
    right = 620,
    top = 20,
    bottom = 192,
    x = (d) => left + ((d - 50) / 4) * (right - left),
    y = (v) => bottom - ((v + 8) / 16) * (bottom - top);
  let s = "";
  for (let v = -8; v <= 8; v += 4)
    s +=
      line(left, y(v), right, y(v)) +
      text(43, y(v) + 4, signed(v, 0) + "%", C.muted, 'text-anchor="end"');
  s += `<rect x="${x(REF.slope - 2 / 60)}" y="${top}" width="${x(REF.slope + 2 / 60) - x(REF.slope - 2 / 60)}" height="${bottom - top}" fill="#c8d2d1" opacity=".13"/>`;
  for (let d = 50; d <= 54; d++)
    s += text(x(d), 215, d + "°", C.muted, 'text-anchor="middle"');
  const points = (fn) =>
    Array.from({ length: 121 }, (_, i) => {
      const d = 50 + (4 * i) / 120;
      return [x(d), y(fn(d))];
    });
  s +=
    path(
      points((d) => (4 / Math.tan(d * DEG) / Math.PI - 1) * 100),
      C.gold,
      2.3,
    ) +
    path(
      points((d) => (1 / Math.cos(d * DEG) / PHI - 1) * 100),
      C.cyan,
      2.3,
    );
  s += line(left, y(0), right, y(0), C.muted, 'stroke-dasharray="3 4"');
  for (const [key, col] of [
    ["pi", C.gold],
    ["phi", C.cyan],
    ["seked", C.muted],
  ])
    s += dot(x(targets[key].slopeDeg), y(0), key === "seked" ? 2.5 : 4, col);
  s +=
    line(
      x(g.slopeDeg),
      top,
      x(g.slopeDeg),
      bottom,
      C.ink,
      'stroke-dasharray="2 3"',
    ) +
    text(
      x(g.slopeDeg),
      12,
      f(g.slopeDeg, 4) + "°",
      C.ink,
      'text-anchor="middle"',
    );
  s +=
    text(80, 239, "π residual", C.gold) +
    text(205, 239, "φ residual", C.cyan) +
    text(340, 239, "π ↔ φ slope gap: 0.02668°", C.muted);
  $("slopeChart").innerHTML = s;
}
function drawSurvey() {
  const rows = [
    ["NORTH", 230.256, 230.329, 230.402],
    ["EAST", 230.295, 230.334, 230.373],
    ["SOUTH", 230.329, 230.384, 230.439],
    ["WEST", 230.378, 230.407, 230.436],
  ];
  const x = (v) => 100 + ((v - 230.24) / 0.22) * 490;
  let s = "";
  for (let v = 230.25; v <= 230.46; v += 0.05)
    s +=
      line(x(v), 20, x(v), 194) +
      text(x(v), 220, v.toFixed(2), C.muted, 'text-anchor="middle"');
  s += line(
    x(REF.base),
    15,
    x(REF.base),
    195,
    C.gold,
    'stroke-dasharray="4 4"',
  );
  rows.forEach(([label, lo, m, hi], i) => {
    const y = 40 + i * 43;
    s +=
      text(0, y + 4, label, C.ink) +
      line(x(lo), y, x(hi), y, C.cyan, 'stroke-width="3"') +
      line(x(lo), y - 5, x(lo), y + 5, C.cyan) +
      line(x(hi), y - 5, x(hi), y + 5, C.cyan) +
      dot(x(m), y, 4, C.gold) +
      text(x(m), y - 10, m.toFixed(3) + " m", C.gold, 'text-anchor="middle"');
  });
  s +=
    text(100, 242, "95% published intervals", C.cyan) +
    text(390, 242, "dashed: reference square", C.gold);
  $("surveyChart").innerHTML = s;
}
function updateLatitude() {
  state.probe = Number($("probe").value);
  $("probeOut").textContent = signed(state.probe, 2) + " m";
  const mPerDegree = latitudeDelta(REF.lat, REF.lat + 0.001) / 0.001,
    lat = REF.lat + state.probe / mPerDegree,
    target = 29.9792458;
  $("probeLatitude").textContent = lat.toFixed(7) + "° N";
  $("probeDelta").textContent =
    signed(latitudeDelta(target, lat), 2) + " m from the target line";
  const x = (v) => 55 + ((v + REF.base / 2) / REF.base) * 530,
    claim = latitudeDelta(REF.lat, target);
  let s = "";
  s +=
    `<rect x="55" y="30" width="530" height="90" fill="#233843"/>` +
    text(55, 20, "SOUTH EDGE", C.muted) +
    text(585, 20, "NORTH EDGE", C.muted, 'text-anchor="end"');
  s +=
    `<rect x="${x(-0.6)}" y="56" width="${x(41.3) - x(-0.6)}" height="38" fill="${C.gold}" opacity=".23"/>` +
    text(x(20.35), 145, "GALLERY N–S SPAN", C.gold, 'text-anchor="middle"');
  s +=
    line(x(0), 25, x(0), 125, C.muted, 'stroke-dasharray="3 3"') +
    line(x(claim), 25, x(claim), 125, C.red, 'stroke-width="2"') +
    line(x(state.probe), 20, x(state.probe), 127, C.cyan, 'stroke-width="2"') +
    dot(x(state.probe), 28, 5, C.cyan);
  for (const n of [-100, -50, 0, 50, 100])
    s +=
      line(x(n), 121, x(n), 127, C.muted) +
      text(x(n), 170, signed(n, 0) + " m", C.muted, 'text-anchor="middle"');
  s +=
    text(55, 197, "CYAN: probe", C.cyan) +
    text(230, 197, "CORAL: numerical target", C.red) +
    text(510, 197, "NORTH →", C.muted);
  $("latitudeChart").innerHTML = s;
}
function updateSolar() {
  state.time = Number($("solarTime").value);
  state.decl = Number($("declination").value);
  const minutes = Math.round(state.time * 60);
  $("timeOut").textContent =
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  $("declOut").textContent = signed(state.decl, 2) + "°";
  document
    .querySelectorAll("[data-season]")
    .forEach((b) =>
      b.classList.toggle("selected", Number(b.dataset.season) === state.decl),
    );
  const g = currentModel ?? model(),
    p = solarPosition(REF.lat, state.decl, (state.time - 12) * 15),
    shadow =
      p.shadowLengthFactor === null
        ? "below horizon"
        : f(g.height * p.shadowLengthFactor, 0) + " m";
  const az = p.azimuthDeg === null ? "zenith" : f(p.azimuthDeg, 1) + "°",
    alt = f(p.altitudeDeg, 1) + "°";
  $("sunAlt").textContent = alt;
  $("shadowReadout").textContent = shadow;
  $("solarAz").textContent = az;
  $("solarAltitude").textContent = alt;
  $("solarShadow").textContent = shadow;
  $("sunTelemetry").textContent = `SUN ALT ${alt} · AZ ${az}`;
  const x = (h) => 50 + ((h - 6) / 12) * 555,
    y = (a) => 195 - (a / 90) * 170;
  let s = "";
  for (let a = 0; a <= 90; a += 30)
    s +=
      line(50, y(a), 605, y(a)) +
      text(39, y(a) + 4, a + "°", C.muted, 'text-anchor="end"');
  for (let h = 6; h <= 18; h += 3)
    s += text(
      x(h),
      215,
      String(h).padStart(2, "0") + ":00",
      C.muted,
      'text-anchor="middle"',
    );
  for (const [dec, col] of [
    [23.44, C.cyan],
    [0, C.muted],
    [-23.44, C.red],
  ]) {
    const points = Array.from({ length: 121 }, (_, i) => {
      const h = 6 + i / 10;
      return [
        x(h),
        y(Math.max(0, solarPosition(REF.lat, dec, (h - 12) * 15).altitudeDeg)),
      ];
    });
    s += path(points, col, 1.4, 'opacity=".7"');
  }
  const points = Array.from({ length: 121 }, (_, i) => {
    const h = 6 + i / 10;
    return [
      x(h),
      y(
        Math.max(
          0,
          solarPosition(REF.lat, state.decl, (h - 12) * 15).altitudeDeg,
        ),
      ),
    ];
  });
  s +=
    path(points, C.gold, 2.6) +
    line(
      x(state.time),
      20,
      x(state.time),
      195,
      C.gold,
      'stroke-dasharray="3 3"',
    ) +
    dot(x(state.time), y(Math.max(0, p.altitudeDeg)), 5, C.gold);
  s +=
    text(52, 240, "JUNE", C.cyan) +
    text(172, 240, "EQUINOX", C.muted) +
    text(320, 240, "DECEMBER", C.red) +
    text(488, 240, "SELECTED", C.gold);
  $("solarChart").innerHTML = s;
  solarScene(g);
}
function drawUncertainty(g) {
  const bs = Number($("baseSigma").value),
    hs = Number($("heightSigma").value),
    rho = Number($("rho").value);
  $("baseSigmaOut").textContent = f(bs) + " m";
  $("heightSigmaOut").textContent = f(hs) + " m";
  $("rhoOut").textContent = signed(rho, 2);
  const u = sensitivity(g.base, g.height, bs, hs, rho),
    samples = seededSamples(2400, 20261119, {
      base: g.base,
      height: g.height,
      baseSigma: bs,
      heightSigma: hs,
      rho,
    });
  const spread = Math.max(
      u.piSigma * 4,
      Math.abs(g.pi - Math.PI) * 1.25,
      0.0001,
    ),
    lo = g.pi - spread,
    hi = g.pi + spread,
    x = (v) => 50 + ((v - lo) / (hi - lo)) * 620;
  const bins = new Array(55).fill(0);
  for (const v of samples) {
    const i = Math.floor(((v.pi - lo) / (hi - lo)) * bins.length);
    if (i >= 0 && i < bins.length) bins[i]++;
  }
  const max = Math.max(...bins);
  let s = "";
  for (let i = 0; i < bins.length; i++) {
    const h = (bins[i] / max) * 145;
    s += `<rect x="${50 + (i * 620) / bins.length}" y="${180 - h}" width="${620 / bins.length - 1}" height="${h}" fill="${C.cyan}" opacity=".65"/>`;
  }
  s +=
    line(50, 181, 670, 181) +
    line(x(Math.PI), 20, x(Math.PI), 185, C.gold, 'stroke-width="2"') +
    text(x(Math.PI), 13, "π", C.gold, 'text-anchor="middle"');
  s +=
    line(x(g.pi), 24, x(g.pi), 185, C.ink, 'stroke-dasharray="3 4"') +
    text(
      x(g.pi),
      225,
      "model mean " + g.pi.toFixed(6),
      C.ink,
      'text-anchor="middle"',
    );
  for (let i = 0; i < 5; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    s += text(x(v), 202, v.toFixed(4), C.muted, 'text-anchor="middle"');
  }
  $("uncertaintyChart").innerHTML = s;
  $("uncertaintySummary").textContent =
    `2,400 deterministic samples · propagated σπ = ${u.piSigma.toPrecision(3)} · σφ = ${u.phiSigma.toPrecision(3)} · assumed ρ = ${rho.toFixed(2)}`;
}

function drawConstruction(g) {
  const density = Number($("bulkDensity").value),
    block = Number($("blockMass").value),
    mass = density * g.volume,
    energy = (mass * 9.80665 * g.height) / 4;
  $("densityOut").textContent = f(density, 0) + " kg/m³";
  $("blockOut").textContent = f(block, 2) + " t";
  $("massReadout").textContent = f(mass / 1e9, 2) + " Mt";
  $("blocksReadout").textContent = f(mass / (block * 1000) / 1e6, 2) + " M";
  $("energyReadout").textContent = f(energy / 1e12, 2) + " TJ";
  const top = 15,
    bottom = 177,
    x0 = 55,
    maxWidth = 235;
  let s = "";
  for (let i = 0; i < 20; i++) {
    const low = i / 20,
      hi = (i + 1) / 20,
      v = (1 - low) ** 3 - (1 - hi) ** 3,
      y = bottom - hi * (bottom - top),
      h = (bottom - top) / 20 - 1;
    s += `<rect x="${x0}" y="${y}" width="${(v / (1 - 0.95 ** 3)) * maxWidth}" height="${h}" fill="${i < 10 ? C.gold : C.cyan}" opacity=".8"/>`;
  }
  for (const [fraction, label] of [
    [0, "0"],
    [0.25, "h/4"],
    [0.5, "h/2"],
    [1, "h"],
  ])
    s +=
      line(
        45,
        bottom - fraction * (bottom - top),
        300,
        bottom - fraction * (bottom - top),
        C.line,
      ) +
      text(
        35,
        bottom - fraction * (bottom - top) + 4,
        label,
        C.muted,
        'text-anchor="end"',
      );
  s +=
    text(335, 45, "87.5%", C.gold, 'style="font-size:32px"') +
    text(335, 68, "volume below h/2", C.muted) +
    text(335, 111, "12.5%", C.cyan, 'style="font-size:26px"') +
    text(335, 134, "volume above h/2", C.muted);
  s +=
    text(55, 204, "EACH BAR = 5% OF HEIGHT", C.muted) +
    text(335, 183, "CENTRE OF MASS: " + f(g.height / 4, 2) + " m", C.ink);
  $("constructionChart").innerHTML = s;
}
function drawUnits(g) {
  $("unitsTable").innerHTML = [
    ["Base side", g.base],
    ["Height", g.height],
    ["Perimeter", 4 * g.base],
  ]
    .map(
      ([label, v]) =>
        `<tr><td>${label}</td><td>${f(v, 3)}</td><td>${f(v / 0.3048, 3)}</td><td>${f(v / 0.5236, 3)}</td></tr>`,
    )
    .join("");
  $("invariantRatio").textContent = g.pi.toFixed(6);
}

const convention = new Set([
  "latitude",
  "day",
  "sun",
  "sun_r",
  "moon_r",
  "sun_earth",
  "sun_dist",
  "meridian",
  "canon_size",
  "canon_dist",
]);
const history = new Set([
  "greaves",
  "greaves_foot",
  "shafts_king",
  "shafts_queen",
  "orion",
]);
const geometric = new Set(["pi", "tau", "phi", "ratio711"]);
const classification = (c) =>
  c.key === "canon_spin"
    ? "contradicted"
    : geometric.has(c.key)
      ? "geometry"
      : convention.has(c.key)
        ? "convention"
        : history.has(c.key)
          ? "history"
          : "measurement";
const classes = {
  geometry: "Geometric comparison",
  convention: "Unit / definition dependent",
  history: "Historical interpretation",
  measurement: "Measurement / estimate",
  contradicted: "Contradicted comparison",
};
const corrections = {
  pi: "The reference square-pyramid model gives 2b/h ≈ 3.140160. This is numerically near π. A 5½-palm seked yields 22/7 exactly for this ratio; resemblance does not establish intentional encoding of π.",
  tau: "The ratio 4b/h is exactly twice 2b/h. It repeats the same slope information as the π comparison and supplies no independent evidence.",
  phi: "The slant/half-base ratio is about 1.619450, near φ ≈ 1.618034. Exact π and exact φ need slopes separated by about 0.02668°. Their closeness is a geometric consequence, not independent historical proof.",
  latitude:
    "The target latitude crosses the illustrative footprint but is about 12.5 m south of the modeled Gallery midpoint. Seven displayed decimals do not imply centimetre accuracy. The chosen point, datum, decimal degrees and SI units control the resemblance.",
  joints:
    "Petrie’s reported mean joint width, 0.02 in = 0.508 mm, is close to 0.5 mm. A mean slightly above a threshold does not prove all joints are below it.",
  level:
    "The approximately 21 mm platform figure is a secondary report here. It does not establish a universal 15 mm bound, and a level stretch of one course measures a different quantity.",
  height:
    "Original apex height is reconstructed. The unknown pyramidion dimensions prevent a defensible exact “without the capstone” height. The displayed model height comes from base and historical casing slope.",
  ratio711:
    "A 5½-palm seked gives height/base = 7/11. The reference casing slope gives a nearby value. Height and base are correlated when height is calculated from base and slope.",
  sun: "The IAU nominal solar radius is an exact conversion factor, not an exact physical measurement of the Sun. Its derived diameter in miles happens to be near 864,000.",
  sun_r:
    "The IAU nominal solar radius converts to about 432,288 miles. The near-round value depends on choosing miles, and the nominal radius is a standardized conversion factor.",
  meridian:
    "Earth’s meridian circumference is close to 40,000 km. The historical metre was based on a meridian quadrant; that convention does not supply independent evidence about Giza.",
  shafts_king:
    "A historical stellar-alignment interpretation requiring a dated sky model and shaft azimuth, elevation, bends and uncertainties. This observatory does not perform that reconstruction.",
  shafts_queen:
    "A historical interpretation. Bends and closures mean these shafts do not provide a simple straight sightline. No ancient stellar alignment is validated by this demo.",
  orion:
    "A contested historical interpretation. A rigorous comparison must predefine allowed rotation, scaling, handedness, error metric and competing site patterns.",
};
function renderLedger() {
  if (!state.data) return;
  const q = $("search").value.trim().toLocaleLowerCase(),
    section = $("sectionFilter").value,
    kind = $("classFilter").value;
  const rows = state.data.claims.filter(
    (c) =>
      (section === "all" || c.section === section) &&
      (kind === "all" || classification(c) === kind) &&
      `${c.title} ${c.verdict} ${corrections[c.key] ?? ""} ${c.key}`
        .toLocaleLowerCase()
        .includes(q),
  );
  const skip = new Set([
    "shafts_king",
    "shafts_queen",
    "orion",
    "greaves_foot",
    "blocks",
  ]);
  $("ledger").innerHTML = rows
    .map((c) => {
      const k = classification(c),
        numeric = !skip.has(c.key),
        claimed = numeric
          ? `${f(c.claimed, Math.abs(c.claimed) > 1e4 ? 0 : c.key === "latitude" ? 7 : 4)} ${c.unit}`
          : "—";
      const value = numeric
        ? `${f(c.measured, Math.abs(c.measured) > 1e4 ? 0 : c.key === "latitude" ? 7 : 4)} ${c.unit}`
        : "not quantified";
      const delta =
        numeric && c.rel_error_pct != null
          ? Math.abs(c.rel_error_pct) < 0.0005 && c.rel_error_pct !== 0
            ? "less than 0.0005%"
            : signed(c.rel_error_pct, 3) + "%"
          : "—";
      const description = corrections[c.key] ?? c.verdict;
      return `<tr><td><span class="micro">${esc(c.section.toUpperCase())}</span><br><strong>${esc(c.title)}</strong><p>${esc(description)}</p><details><summary>Sources & original assessment</summary><p>v1 editorial grade: ${esc(c.grade)}. This is not a probability or proof of intent.</p><ul>${c.sources.map((key) => `<li>${esc(state.data.sources[key])}</li>`).join("")}</ul></details></td><td class="numeral">${esc(claimed)}</td><td class="numeral">${esc(value)}</td><td class="numeral">${esc(delta)}</td><td><span class="class-chip ${k}">${classes[k]}</span></td></tr>`;
    })
    .join("");
  $("ledgerCount").textContent = `${rows.length} / 27 claims`;
  $("noResults").hidden = rows.length > 0;
}
async function loadEvidence() {
  try {
    const response = await fetch("../v1/receipts/claims.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    for (const section of new Set(state.data.claims.map((c) => c.section))) {
      const option = document.createElement("option");
      option.value = section;
      option.textContent = section;
      $("sectionFilter").append(option);
    }
    renderLedger();
  } catch (error) {
    $("ledgerCount").textContent = "Data unavailable";
    $("noResults").hidden = false;
    $("noResults").textContent =
      "Could not load the original claim receipt. Serve the repository over HTTP and try again. " +
      error.message;
  }
}
async function loadScene() {
  if (state.loading) return;
  state.loading = true;
  $("sourceScene").disabled = true;
  $("renderStatus").classList.remove("error");
  $("renderStatus").textContent = "LOADING X3D";
  try {
    if (!state.browser)
      state.browser = await connectRenderer({ canvas: $("scene") });
    const B = state.browser;
    await withTimeout(
      B.loadURL(
        new X3D.MFString(
          state.source ? "../v1/assets/numbers.x3d" : "../v2/assets/observatory.x3d",
        ),
      ),
      30000,
      "Loading the local X3D scene timed out.",
    );
    state.scene = B.currentScene;
    if (!state.scene) throw new Error("X3D returned no scene.");
    $("fallback").hidden = true;
    $("scene").hidden = false;
    $("renderStatus").textContent = "LIVE X3D / " + B.version;
    $("sourceScene").textContent = state.source
      ? "Return to enhanced Observatory"
      : "Load original Blender export";
    $("sourceScene").setAttribute("aria-pressed", state.source);
    $("sourceStatus").textContent = state.source
      ? "Original Blender export selected. Geometry stays fixed; analytical charts continue to show the experimental model."
      : "Enhanced procedural X3D scene selected.";
    $("viewCaption").textContent = state.source
      ? "Original Blender → x3d-blender-io export · fixed reference dimensions · use “Return” for live deformation"
      : "Reconstructed full casing · courses, terrain & interior illustrative · drag to orbit, scroll to zoom";
    updateLayers();
    updateScene(currentModel ?? model());
    bindCamera("CA_Overview");
    document
      .querySelectorAll("[data-camera]")
      .forEach(
        (b) =>
          (b.disabled =
            state.source &&
            !["CA_Overview", "CA_Pi", "CA_Phi", "CA_Interior"].includes(
              b.dataset.camera,
            )),
      );
    $("orbit").disabled = state.source;
    $("sceneState").textContent = state.source
      ? "FIXED BLENDER REFERENCE"
      : $("modelStatus").textContent.startsWith("REFERENCE")
        ? "REFERENCE GEOMETRY"
        : "EXPERIMENTAL GEOMETRY";
  } catch (error) {
    state.scene = null;
    $("renderStatus").classList.add("error");
    $("renderStatus").textContent = "ANALYTICAL MODE / 3D UNAVAILABLE";
    $("fallback").hidden = false;
    $("scene").hidden = true;
    $("fallbackMessage").textContent =
      error.message + " All analytical instruments remain usable.";
  } finally {
    state.loading = false;
    $("sourceScene").disabled = false;
  }
}
function restoreOverview() {
  const cam = named("CA_Overview");
  if (!cam) return;
  const r = Math.hypot(395, 455),
    yaw = Math.atan2(395, 455),
    pitch = -Math.atan2(256, r),
    sy = Math.sin(yaw / 2),
    cy = Math.cos(yaw / 2),
    sx = Math.sin(pitch / 2),
    cx = Math.cos(pitch / 2),
    q = [cy * sx, sy * cx, -sy * sx, cy * cx],
    theta = 2 * Math.acos(q[3]),
    den = Math.sqrt(1 - q[3] * q[3]);
  cam.position = vec3(395, 296, 455);
  cam.orientation = new X3D.SFRotation(
    ...q.slice(0, 3).map((v) => v / den),
    theta,
  );
}
function stopOrbit() {
  state.orbit = false;
  cancelAnimationFrame(orbitFrame);
  $("orbit").setAttribute("aria-pressed", "false");
  $("orbit").textContent = "↻ Orbit";
}
function orbitTick(now) {
  if (!state.orbit || !state.scene || document.hidden) return;
  const a = ((now - orbitStart) / 1000) * 0.055,
    cam = named("CA_Overview");
  if (cam) {
    const r = 603,
      y = 290,
      t = 40,
      x = Math.sin(a) * r,
      z = Math.cos(a) * r,
      pitch = -Math.atan2(y - t, r);
    const yaw = a,
      sy = Math.sin(yaw / 2),
      cy = Math.cos(yaw / 2),
      sx = Math.sin(pitch / 2),
      cx = Math.cos(pitch / 2),
      q = [cy * sx, sy * cx, -sy * sx, cy * cx],
      theta = 2 * Math.acos(Math.min(1, Math.max(-1, q[3]))),
      den = Math.sqrt(1 - q[3] * q[3]);
    cam.position = vec3(x, y, z);
    cam.orientation = new X3D.SFRotation(
      ...q.slice(0, 3).map((v) => v / den),
      theta,
    );
  }
  orbitFrame = requestAnimationFrame(orbitTick);
}
function stopTour() {
  clearInterval(tourTimer);
  state.tour = false;
  $("tour").setAttribute("aria-pressed", "false");
  $("tour").textContent = "▷ Guided tour";
}
function startTour() {
  if (state.tour) {
    stopTour();
    return;
  }
  stopOrbit();
  state.tour = true;
  $("tour").setAttribute("aria-pressed", "true");
  $("tour").textContent = "Ⅱ Stop tour";
  const steps = [
    () => mode("geometry"),
    () => {
      mode("geometry");
      $("layerPhi").checked = true;
      updateLayers();
      bindCamera("CA_Phi");
    },
    () => mode("survey"),
    () => mode("latitude"),
    () => mode("solar"),
  ];
  let index = 0;
  steps[index]();
  // User-initiated; no unsolicited camera motion. Reduced-motion uses slower cuts.
  tourTimer = setInterval(
    () => {
      if (document.hidden) return;
      index = (index + 1) % steps.length;
      steps[index]();
    },
    reduced.matches ? 18000 : 12000,
  );
}
function exportExperiment() {
  const g = currentModel ?? model(),
    payload = {
      schema: "pyramid-observatory-experiment/v2",
      model: { ...g, inputSlopeDeg: state.slope },
      reference: REF,
      construction: {
        bulkDensityKgM3: Number($("bulkDensity").value),
        equivalentBlockMassTonnes: Number($("blockMass").value),
      },
      solar: {
        localSolarHour: state.time,
        declinationDeg: state.decl,
        ...solarPosition(REF.lat, state.decl, (state.time - 12) * 15),
      },
      probe: { northOffsetM: state.probe, centreLatitudeDeg: REF.lat },
      assumedUncertainty: {
        baseSigmaM: Number($("baseSigma").value),
        heightSigmaM: Number($("heightSigma").value),
        correlation: Number($("rho").value),
      },
      interpretation:
        "Idealized educational model. No inference of historical intent or calibrated survey confidence.",
      scene: state.source
        ? "original fixed Blender reference"
        : "enhanced procedural X3D",
    };
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "pyramid-observatory-experiment.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Wire controls before the renderer: a WebGL failure must not disable the lab.
for (const b of document.querySelectorAll("[data-mode]"))
  b.onclick = () => {
    stopTour();
    mode(b.dataset.mode);
  };
for (const b of document.querySelectorAll("[data-camera]"))
  b.onclick = () => {
    if (b.dataset.camera === "CA_Interior") {
      $("layerInterior").checked = true;
      $("opacity").value = 10;
      updateLayers();
    }
    if (b.dataset.camera === "CA_Phi") {
      $("layerPhi").checked = true;
      updateLayers();
    }
    bindCamera(b.dataset.camera, { manual: true });
  };
for (const b of document.querySelectorAll("[data-preset]"))
  b.onclick = () => {
    $("base").value = REF.base;
    $("slope").value =
      b.dataset.preset === "survey"
        ? REF.slope
        : targets[b.dataset.preset].slopeDeg;
    updateGeometry();
  };
for (const b of document.querySelectorAll("[data-season]"))
  b.onclick = () => {
    $("declination").value = b.dataset.season;
    updateSolar();
  };
for (const b of document.querySelectorAll("[data-ratio]"))
  b.onclick = () => {
    stopTour();
    mode("geometry", { camera: false });
    state.ratio = b.dataset.ratio;
    selectedButtons("[data-ratio]", state.ratio, "ratio");
    $("layerPi").checked = state.ratio !== "phi";
    $("layerPhi").checked = state.ratio === "phi";
    updateLayers();
    bindCamera(state.ratio === "phi" ? "CA_Phi" : "CA_Pi");
  };
for (const id of ["base", "slope"])
  $(id).addEventListener("input", updateGeometry);
for (const id of ["baseSigma", "heightSigma", "rho"])
  $(id).addEventListener("input", () =>
    drawUncertainty(currentModel ?? model()),
  );
for (const id of ["solarTime", "declination"])
  $(id).addEventListener("input", updateSolar);
for (const id of [
  "layerPi",
  "layerPhi",
  "layerSurvey",
  "layerCourses",
  "layerInterior",
  "layerLatitude",
  "layerSolar",
  "opacity",
])
  $(id).addEventListener("input", updateLayers);
$("probe").addEventListener("input", updateLatitude);
for (const id of ["bulkDensity", "blockMass"])
  $(id).addEventListener("input", () =>
    drawConstruction(currentModel ?? model()),
  );
for (const id of ["search", "sectionFilter", "classFilter"])
  $(id).addEventListener("input", renderLedger);
$("density").onclick = () => {
  const rich = document.documentElement.dataset.density !== "rich";
  document.documentElement.dataset.density = rich ? "rich" : "calm";
  $("density").textContent = "Density: " + (rich ? "rich" : "calm");
  $("density").setAttribute("aria-pressed", rich);
};
$("focus").onclick = () => {
  const expanded = $("workbench").classList.toggle("expanded");
  $("focus").textContent = expanded ? "Restore panels" : "Expand view";
  $("focus").setAttribute("aria-pressed", expanded);
};
$("reset").onclick = () => {
  stopTour();
  stopOrbit();
  $("base").value = REF.base;
  $("slope").value = REF.slope;
  $("solarTime").value = 15;
  $("declination").value = 0;
  $("probe").value = 7.85;
  $("baseSigma").value = 0.07;
  $("heightSigma").value = 0.18;
  $("rho").value = 0;
  $("bulkDensity").value = 2600;
  $("blockMass").value = 2.5;
  mode("geometry");
  updateGeometry();
  updateLatitude();
};
$("tour").onclick = startTour;
$("export").onclick = exportExperiment;
$("quality").onchange = () => {
  const quality = $("quality").value,
    canvas = $("scene");
  canvas.setAttribute(
    "multisampling",
    { balanced: "2", high: "4", ultra: "8" }[quality],
  );
  canvas.setAttribute("contentScale", quality === "ultra" ? "auto" : "1");
  canvas.setAttribute("maximumFrameRate", quality === "ultra" ? "60" : "45");
};
$("sourceScene").onclick = async () => {
  stopOrbit();
  stopTour();
  state.source = !state.source;
  await loadScene();
};
$("orbit").onclick = () => {
  if (state.orbit) {
    stopOrbit();
    return;
  }
  if (!state.scene || state.source) return;
  stopTour();
  bindCamera("CA_Overview");
  state.orbit = true;
  orbitStart = performance.now() - (Math.atan2(395, 455) / 0.055) * 1000;
  $("orbit").textContent = "Ⅱ Stop orbit";
  $("orbit").setAttribute("aria-pressed", "true");
  orbitFrame = requestAnimationFrame(orbitTick);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopOrbit();
});
reduced.addEventListener("change", () => {
  if (reduced.matches) stopOrbit();
});
// No dependencies between the data ledger, charts, and renderer initialization.
drawSurvey();
updateGeometry();
updateLatitude();
loadEvidence();
loadScene();
