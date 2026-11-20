// SPDX-License-Identifier: GPL-3.0-or-later
import {
  geometry,
  modelSweep,
  IDEAL_SLOPES,
  crossSection,
  similarityFit,
  tangentPlane,
} from "./instrument-math.mjs";
import { moved, yearLabel } from "./sky-math.mjs";
import { createCelestialLens } from "./celestial-lens.mjs";

const REF = { base: 230.363, slope: 51 + 52 / 60 };
const C = {
  gold: "#f0c77e",
  cyan: "#76e3dc",
  violet: "#b7a5ff",
  red: "#f39b8c",
  line: "#263e4b",
  muted: "#96b0bd",
  ink: "#eef5ef",
};
const n = (v, d = 3) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const sign = (v, d = 3) => (v < 0 ? "−" : "+") + n(Math.abs(v), d);
const txt = (x, y, t, col = C.muted, attr = "") =>
  `<text x="${x}" y="${y}" fill="${col}" ${attr}>${String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</text>`;
const ln = (x, y, a, b, col = C.line, extra = "") =>
  `<line x1="${x}" y1="${y}" x2="${a}" y2="${b}" stroke="${col}" ${extra}/>`;
const path = (pts, col, w = 2) =>
  `<path d="${pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2)).join(" ")}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
const circle = (x, y, r, col, extra = "") =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" ${extra}/>`;

export async function createInstruments({
  host,
  getStage,
  requestStage,
  onStageChange = () => {},
}) {
  const $ = (id) => host.querySelector("#" + id);
  let data = null,
    disposed = false,
    actionVersion = 0;
  const state = {
    slope: REF.slope,
    slice: 0.293,
    year: -2559,
    reflected: false,
    animate: false,
    frame: 0,
    last: 0,
  };
  const error = (message) => {
    $("instrumentStatus").textContent = message;
  };
  const lens = createCelestialLens({
    host: $("celestialLens"),
    getStage,
    requestStage,
  });
  async function act(fn, { overlay = true, motion = true } = {}) {
    const token = actionVersion;
    try {
      const st = await requestStage();
      if (disposed || (motion && token !== actionVersion)) return false;
      if (overlay) await st.instrumentReady;
      if (disposed || (motion && token !== actionVersion)) return false;
      fn(st);
      onStageChange();
      error("LIVE X3D INSTRUMENTS / reference plateau retained");
      return true;
    } catch (e) {
      error("Analytical mode · 3D unavailable: " + e.message);
      return false;
    }
  }
  function geometryPanel() {
    state.slope = Number($("probeSlope").value);
    const g = geometry(REF.base, state.slope),
      ref = geometry(REF.base, REF.slope);
    $("probeSlopeOut").textContent = n(state.slope, 5) + "°";
    $("probeHeight").textContent = n(g.height) + " m";
    $("probePi").textContent = n(g.pi, 7);
    $("probePhi").textContent = n(g.phi, 7);
    $("probeSeked").textContent = n(g.seked, 5);
    $("probeResidual").textContent =
      sign(4 * g.base - 2 * Math.PI * g.height) + " m";
    host.querySelectorAll("[data-ideal]").forEach((b) => {
      const slope =
          b.dataset.ideal === "measured"
            ? REF.slope
            : IDEAL_SLOPES[b.dataset.ideal],
        on = Math.abs(state.slope - slope) < 1e-9;
      b.setAttribute("aria-pressed", on);
    });
    const x = (v) => 56 + ((v - 50) / 4) * 550,
      y = (v) => 200 - ((v + 8) / 16) * 170;
    let s = "";
    for (let v = -8; v <= 8; v += 4)
      s +=
        ln(56, y(v), 606, y(v)) +
        txt(44, y(v) + 4, sign(v, 0) + "%", C.muted, 'text-anchor="end"');
    s += `<rect x="${x(REF.slope - 2 / 60)}" y="30" width="${x(REF.slope + 2 / 60) - x(REF.slope - 2 / 60)}" height="170" fill="${C.ink}" opacity=".12"/>`;
    const pts = (fn) =>
      Array.from({ length: 161 }, (_, i) => {
        const d = 50 + i / 40;
        return [x(d), y(fn(geometry(REF.base, d)))];
      });
    s +=
      path(
        pts((m) => (m.pi / Math.PI - 1) * 100),
        C.gold,
        2.5,
      ) +
      path(
        pts((m) => (m.phi / ((1 + Math.sqrt(5)) / 2) - 1) * 100),
        C.cyan,
        2.5,
      ) +
      ln(
        x(state.slope),
        26,
        x(state.slope),
        200,
        C.ink,
        'stroke-dasharray="3 4"',
      );
    for (let d = 50; d <= 54; d++)
      s += txt(x(d), 221, d + "°", C.muted, 'text-anchor="middle"');
    s +=
      txt(58, 15, "π deviation", C.gold) +
      txt(205, 15, "φ deviation", C.cyan) +
      txt(602, 15, "0 = exact target", C.muted, 'text-anchor="end"');
    $("ratioMicroscope").innerHTML = s;
    const models = modelSweep(REF.base),
      max = Math.max(0.5, ...models.map((m) => Math.abs(m.height - g.height))),
      rx = (v) => 300 + (v / max) * 65;
    let r = ln(300, 22, 300, 155, C.muted, 'stroke-dasharray="2 4"');
    models.forEach((m, i) => {
      const yy = 34 + 34 * i,
        delta = m.height - g.height;
      r +=
        txt(
          15,
          yy + 4,
          m.label,
          m.key === "pi" ? C.gold : m.key === "phi" ? C.cyan : C.muted,
        ) +
        ln(300, yy, rx(delta), yy, C.gold, 'stroke-width="2"') +
        circle(rx(delta), yy, 3, C.gold) +
        txt(605, yy + 4, sign(delta) + " m", C.ink, 'text-anchor="end"');
    });
    r += txt(
      300,
      177,
      "Height relative to the experimental ghost",
      C.muted,
      'text-anchor="middle"',
    );
    $("heightMicroscope").innerHTML = r;
    const stage = getStage();
    stage?.setModel(REF.base, state.slope);
    $("ghostDelta").textContent =
      sign(g.height - ref.height) + " m apex change";
  }
  function sectionPanel() {
    state.slice = Number($("sectionHeight").value);
    const g = geometry(REF.base, REF.slope),
      c = crossSection(REF.base, REF.slope, state.slice);
    $("sectionOut").textContent = n(state.slice * 100, 2) + "% of h";
    $("sliceHeight").textContent = n(c.height, 2) + " m";
    $("sliceSide").textContent = n(c.side, 2) + " m";
    $("sliceArea").textContent = n((c.area / g.baseArea) * 100, 2) + "%";
    $("sliceVolume").textContent = n(c.fractionBelow * 100, 2) + "%";
    const left = 72,
      right = 538,
      top = 20,
      bottom = 240,
      cy = bottom - state.slice * (bottom - top),
      half = ((right - left) / 2) * (1 - state.slice),
      mid = (left + right) / 2;
    let s = `<defs><linearGradient id="sliceStone" x2="1" y2="1"><stop stop-color="#d9b77e" stop-opacity=".6"/><stop offset="1" stop-color="#385667" stop-opacity=".2"/></linearGradient><clipPath id="slicePyramid"><path d="M${left},${bottom} L${mid},${top} L${right},${bottom}Z"/></clipPath></defs>`;
    s += `<path d="M${left},${bottom} L${mid},${top} L${right},${bottom}Z" fill="url(#sliceStone)" stroke="${C.gold}"/>`;
    for (let i = 1; i < 26; i++) {
      const yy = bottom - (i / 26) * (bottom - top);
      s += ln(
        left,
        yy,
        right,
        yy,
        "#75909a55",
        'clip-path="url(#slicePyramid)"',
      );
    }
    s += `<rect x="${left}" y="${cy}" width="${right - left}" height="${bottom - cy}" fill="${C.cyan}" opacity=".14" clip-path="url(#slicePyramid)"/>`;
    s +=
      ln(mid - half - 18, cy, mid + half + 18, cy, C.cyan, 'stroke-width="3"') +
      circle(mid - half, cy, 4, C.cyan) +
      circle(mid + half, cy, 4, C.cyan);
    s +=
      ln(570, top, 570, bottom, C.line) +
      ln(562, cy, 578, cy, C.cyan, 'stroke-width="2"') +
      txt(585, cy + 4, n(c.height, 1) + " m", C.cyan, 'text-anchor="end"');
    s += txt(
      305,
      270,
      "REFERENCE SECTION / full ideal casing envelope",
      C.muted,
      'text-anchor="middle"',
    );
    $("sectionDiagram").innerHTML = s;
    getStage()?.setSlice(state.slice);
  }
  function fitPanel() {
    if (!data) return;
    state.year = Number($("fitYear").value);
    $("fitYearOut").textContent = yearLabel(state.year);
    const vectors = data.stars.map((s) => moved(s.p, s.v, state.year)),
      mean = [0, 1, 2].map((i) =>
        vectors.reduce((a, v) => a + v[i] / Math.hypot(...v), 0),
      );
    const sky = tangentPlane(vectors, mean).points,
      ground = data.ground.map((p) => p.p),
      proper = similarityFit(sky, ground),
      reflected = similarityFit(sky, ground, { reflect: true });
    const fit = state.reflected ? reflected : proper;
    $("properRms").textContent = n(proper.rms, 2) + " m";
    $("mirrorRms").textContent = n(reflected.rms, 2) + " m";
    $("fitRotation").textContent = sign(fit.rotationDeg, 2) + "°";
    $("fitClass").textContent = state.reflected
      ? "REFLECTED / reflection explicitly allowed"
      : "PROPER / orientation preserved";
    $("fitNote").textContent =
      `Fixed correspondence: Alnitak → Khufu, Alnilam → Khafre, Mintaka → Menkaure. RMS ${n(fit.rms, 2)} m after fitting translation, rotation and one scale. ${state.reflected ? "Reflection adds a discrete choice. " : ""}No covariance or statistical significance is inferred.`;
    host
      .querySelectorAll("[data-fit]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String((b.dataset.fit === "reflected") === state.reflected),
        ),
      );
    const all = [...ground, ...fit.transformed],
      xs = all.map((p) => p[0]),
      ys = all.map((p) => p[1]),
      span =
        Math.max(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ) * 1.37,
      center = [
        (Math.max(...xs) + Math.min(...xs)) / 2,
        (Math.max(...ys) + Math.min(...ys)) / 2,
      ],
      scale = 340 / span,
      screen = ([a, b]) => [
        310 + (a - center[0]) * scale,
        218 - (b - center[1]) * scale,
      ];
    let s = "";
    for (let i = -3; i <= 3; i++) {
      s +=
        ln(60 + i * 90 + 270, 25, 60 + i * 90 + 270, 405, C.line) +
        ln(40, 35 + i * 60 + 180, 605, 35 + i * 60 + 180, C.line);
    }
    s +=
      path(ground.map(screen), C.gold, 1.5) +
      path(fit.transformed.map(screen), C.cyan, 1.5);
    ground.forEach((p, i) => {
      const [x, y] = screen(p),
        [a, b] = screen(fit.transformed[i]),
        w = data.ground[i].base * scale;
      s +=
        `<rect x="${x - w / 2}" y="${y - w / 2}" width="${w}" height="${w}" fill="${C.gold}" fill-opacity=".07" stroke="${C.gold}" stroke-opacity=".5"/>` +
        ln(x, y, a, b, C.red, 'stroke-width="2"') +
        circle(x, y, 3, C.gold) +
        circle(a, b, 5, "#0c1520", `stroke="${C.cyan}" stroke-width="2"`) +
        txt(x + 10, y - 12, data.ground[i].name, C.gold) +
        txt(a + 10, b + 13, data.stars[i].name, C.cyan);
    });
    s +=
      ln(565, 85, 565, 35, C.muted, 'stroke-width="1.5"') +
      txt(565, 24, "N", C.ink, 'text-anchor="middle"');
    const length = 100 * scale;
    s +=
      ln(45, 390, 45 + length, 390, C.ink, 'stroke-width="2"') +
      txt(45, 412, "100 m", C.muted) +
      txt(602, 412, "CORAL / residuals", C.red, 'text-anchor="end"');
    $("orionFit").innerHTML = s;
    $("fitResiduals").innerHTML = fit.residuals
      .map(
        (r, i) =>
          `<tr><td>${data.stars[i].name}</td><td>${data.ground[i].name}</td><td>${n(r.distance, 2)} m</td></tr>`,
      )
      .join("");
  }
  async function fetchData() {
    try {
      const r = await fetch("assets/belt-instrument.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = await r.json();
      fitPanel();
    } catch (e) {
      $("fitNote").textContent =
        "The derived Orion data could not load: " + e.message;
    }
  }
  function animateSlice(now) {
    if (!state.animate || disposed) return;
    if (!document.hidden && now - state.last > 70) {
      state.last = now;
      $("sectionHeight").value =
        0.06 + 0.88 * (0.5 + 0.5 * Math.sin(now / 4200));
      sectionPanel();
    }
    state.frame = requestAnimationFrame(animateSlice);
  }
  host.querySelectorAll("[data-ideal]").forEach((b) =>
    b.addEventListener("click", () => {
      $("probeSlope").value =
        b.dataset.ideal === "measured"
          ? REF.slope
          : IDEAL_SLOPES[b.dataset.ideal];
      geometryPanel();
    }),
  );
  $("probeSlope").addEventListener("input", geometryPanel);
  $("sectionHeight").addEventListener("input", sectionPanel);
  $("fitYear").addEventListener("input", fitPanel);
  host.querySelectorAll("[data-fit]").forEach((b) =>
    b.addEventListener("click", () => {
      state.reflected = b.dataset.fit === "reflected";
      fitPanel();
    }),
  );
  host.querySelectorAll("[data-instrument]").forEach((b) =>
    b.addEventListener("click", async () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on);
      const ok = await act((st) => {
        st.setInstrument(b.dataset.instrument, on);
        if (on) {
          st.home();
          st.setRig(null);
          if (b.dataset.instrument === "section") st.setXray(true);
          st.goto(b.dataset.instrument === "survey" ? "plan" : "khufu", {
            seconds: 1.8,
          });
        }
        geometryPanel();
        sectionPanel();
      });
      if (!ok) b.setAttribute("aria-pressed", "false");
    }),
  );
  $("sliceSweep").addEventListener("click", () => {
    state.animate = !state.animate;
    $("sliceSweep").setAttribute("aria-pressed", state.animate);
    $("sliceSweep").textContent = state.animate
      ? "■ Stop scan"
      : "▷ Sweep section";
    if (state.animate) {
      act((st) => {
        st.setInstrument("section", true);
        st.setXray(true);
      });
      state.frame = requestAnimationFrame(animateSlice);
    } else cancelAnimationFrame(state.frame);
  });
  $("instrumentQuality").addEventListener("change", () => {
    const q = $("instrumentQuality").value,
      presets = {
        study: { ms: 2, fps: 30, faint: false, labels: 30 },
        balanced: { ms: 4, fps: 45, faint: true, labels: 60 },
        exhibit: { ms: 8, fps: 60, faint: true, labels: 180 },
      },
      p = presets[q];
    document.getElementById("scene").setAttribute("multisampling", p.ms);
    document.getElementById("scene").setAttribute("maximumFrameRate", p.fps);
    act(
      (st) =>
        st.setQuality({
          faint: p.faint,
          labels: p.labels,
          maxFrameRate: p.fps,
          multisampling: p.ms,
        }),
      { overlay: false, motion: false },
    );
  });
  $("stageExposure").addEventListener("input", () => {
    const v = Number($("stageExposure").value);
    $("exposureOut").textContent = n(v, 2) + "×";
    document.documentElement.style.setProperty("--stage-exposure", v);
  });
  $("cinemaMode").addEventListener("click", () => {
    const on = document.body.classList.toggle("cinema-mode");
    $("cinemaMode").setAttribute("aria-pressed", on);
    $("cinemaMode").textContent = on ? "Restore instruments" : "Cinema view";
  });
  function unpin() {
    document.body.classList.remove("stage-pinned");
    $("pinStage").setAttribute("aria-pressed", "false");
    $("pinStage").textContent = "Pin live stage";
    getStage()?.invalidate();
  }
  $("pinStage").addEventListener("click", async () => {
    if (document.body.classList.contains("stage-pinned")) {
      unpin();
      return;
    }
    await act(
      (st) => {
        document.body.classList.add("stage-pinned");
        $("pinStage").setAttribute("aria-pressed", "true");
        $("pinStage").textContent = "Return pinned stage";
        st.invalidate();
      },
      { overlay: false, motion: false },
    );
  });
  document.getElementById("unpinStage").addEventListener("click", unpin);
  $("stopMotion").addEventListener("click", () => {
    actionVersion++;
    state.animate = false;
    cancelAnimationFrame(state.frame);
    $("sliceSweep").setAttribute("aria-pressed", "false");
    $("sliceSweep").textContent = "▷ Sweep section";
    getStage()?.cancelTransition("User stopped motion");
    window.gizaAtlas?.stopTour();
  });
  $("exportInstrument").addEventListener("click", () => {
    const result = {
        schema: "giza-instrument-experiment/v1",
        reference: REF,
        geometry: geometry(REF.base, state.slope),
        section: crossSection(REF.base, REF.slope, state.slice),
        orion: {
          year: state.year,
          reflected: state.reflected,
          correspondence: "Alnitak/Alnilam/Mintaka → Khufu/Khafre/Menkaure",
          method: "orthographic directions; equal-weight similarity fit",
        },
        interpretation:
          "Educational mathematical comparisons; no proof or probability of historical intent.",
      },
      u = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = u;
    a.download = "giza-v5-experiment.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  });
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches) $("sliceSweep").textContent = "▷ Start deliberate scan";
  geometryPanel();
  sectionPanel();
  await fetchData();
  return {
    render() {
      if (!disposed) lens.render();
    },
    dispose() {
      actionVersion++;
      disposed = true;
      state.animate = false;
      cancelAnimationFrame(state.frame);
      lens.dispose();
    },
  };
}
