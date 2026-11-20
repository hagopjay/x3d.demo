// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Optional DOM integration checks: real instruments, real data, mocked stage.
 * No browser layout, native input sanitization, X_ITE or WebGL is exercised.
 * npm install --prefix /tmp/giza-ui-test linkedom@0.18.12
 * LINKEDOM_PATH=/tmp/giza-ui-test/node_modules/linkedom/esm/index.js \
 *   node --test tests/instruments-ui.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInstruments } from "../instruments.mjs";
import { skyMapPoint } from "../celestial-lens.mjs";
import { geometry, IDEAL_SLOPES, tangentPlane, similarityFit } from "../instrument-math.mjs";
import { moved, skyRotation, raDecOfDate } from "../sky-math.mjs";

let parseHTML;
try {
  ({ parseHTML } = await import(process.env.LINKEDOM_PATH ? pathToFileURL(resolve(process.env.LINKEDOM_PATH)).href : "linkedom"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
const domTest = parseHTML ? test : (name, fn) => test(name, { skip: "Install optional linkedom@0.18.12 and set LINKEDOM_PATH; see file header." }, fn);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const belt = JSON.parse(await readFile(resolve(root, "assets/belt-instrument.json"), "utf8"));
const skyData = JSON.parse(await readFile(resolve(root, "assets/sky-data.json"), "utf8"));
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≉ ${b}`);
const number = text => Number(text.replace(/,/g, "").replace("−", "-").match(/[+-]?[0-9]+(?:\.[0-9]+)?/)[0]);
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

async function fixture({ failStage = false, failData = false, deferStage = false, deferInstrument = false } = {}) {
  const { window, document } = parseHTML(html);
  // Linkedom deliberately omits the browser's standard select.value setter.
  // Supply only that DOM IDL behavior; do not simulate range quantization.
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() { const option = this.querySelector("option[selected]") ?? this.querySelector("option"); return option ? option.getAttribute("value") ?? option.textContent : ""; },
    set(value) { for (const option of this.querySelectorAll("option")) { if ((option.getAttribute("value") ?? option.textContent) === String(value)) option.setAttribute("selected", ""); else option.removeAttribute("selected"); } },
  });
  const calls = [], frames = new Map(); let nextFrame = 1;
  let releaseStage, releaseInstrument;
  const stageBarrier = new Promise(resolve => { releaseStage = resolve; });
  const instrumentBarrier = new Promise(resolve => { releaseInstrument = resolve; });
  const S = { year: -2559, lst: 0, skyData, R: skyRotation(skyData.precession, -2559, 0) };
  const stage = {
    state: S,
    instrumentReady: deferInstrument ? instrumentBarrier : Promise.resolve(), skyReady: Promise.resolve(),
    setModel: (...args) => calls.push(["setModel", ...args]),
    setSlice: (...args) => calls.push(["setSlice", ...args]),
    setInstrument: (...args) => calls.push(["setInstrument", ...args]),
    home: () => calls.push(["home"]), setRig: (...args) => calls.push(["setRig", ...args]),
    setXray: (...args) => calls.push(["setXray", ...args]),
    setQuality: (...args) => calls.push(["setQuality", ...args]),
    invalidate:()=>calls.push(["invalidate"]),
    goto: (...args) => { calls.push(["goto", ...args]); return Promise.resolve({ cancelled: false }); },
    cancelTransition: (...args) => calls.push(["cancelTransition", ...args]),
    starVector(name, year = S.year) {
      const star = belt.stars.find(star => star.name === name);
      return star ? moved(star.p, star.v, year) : null;
    },
    setSky(options) {
      calls.push(["setSky", options]);
      if (options.year != null) S.year = options.year;
      if (options.culminate) {
        const vector = stage.starVector(options.culminate);
        if (vector) S.lst = raDecOfDate(S.skyData.precession, S.year, vector).ra;
      }
      S.R = skyRotation(S.skyData.precession, S.year, S.lst);
    },
  };
  const host = document.getElementById("instruments");
  Object.assign(globalThis, {
    window, document,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    fetch: async url => {
      assert.equal(url, "assets/belt-instrument.json");
      return { ok: !failData, status: failData ? 503 : 200, json: async () => structuredClone(belt) };
    },
  });
  window.gizaAtlas = { stopTour: () => calls.push(["stopTour"]) };
  const instruments = await createInstruments({
    host,
    getStage: () => failStage ? null : stage,
    requestStage: async () => { calls.push(["requestStage"]); if (failStage) throw new Error("Simulated stage unavailable"); if (deferStage) await stageBarrier; return stage; },
  });
  await settle();
  return {
    $, host, stage, calls, frames, document, window, instruments, releaseStage, releaseInstrument,
    input(id, value, event = "input") { $(id).value = String(value); $(id).dispatchEvent(new window.Event(event, { bubbles: true })); },
    async click(selector) { const button = host.querySelector(selector); assert.ok(button, selector); button.click(); await settle(); },
  };
  function $(id) { return host.querySelector("#" + id); }
}

domTest("real instrument markup mounts finite linked charts from retained catalogue data", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  near(number(f.$("probeHeight").textContent), geometry(230.363, 51 + 52 / 60).height, .00051);
  near(number(f.$("probePi").textContent), 3.14016018848, .0000001);
  assert.equal(f.$("fitResiduals").querySelectorAll("tr").length, 3);
  for (const id of ["ratioMicroscope", "heightMicroscope", "sectionDiagram", "orionFit"]) {
    assert.ok(f.$(id).querySelector("path, line, rect"), id);
    assert.doesNotMatch(f.$(id).innerHTML, /NaN|Infinity/);
  }
  assert.match(f.host.querySelector(".cl-status").textContent, /Alnitak is (above|below)/);
  assert.ok(f.host.querySelector(".cl-depth line"));
});

domTest("reference, pi, phi and seked buttons drive precise models and stage writes", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  await f.click('[data-ideal="pi"]'); near(number(f.$("probePi").textContent), Math.PI, .0000001);
  near(f.calls.filter(call => call[0] === "setModel").at(-1)[2], IDEAL_SLOPES.pi, 1e-12);
  await f.click('[data-ideal="phi"]'); near(number(f.$("probePhi").textContent), (1 + Math.sqrt(5)) / 2, .0000001);
  await f.click('[data-ideal="seked"]'); near(number(f.$("probeSeked").textContent), 5.5, 1e-5);
  await f.click('[data-ideal="measured"]'); near(number(f.$("probePi").textContent), 3.14016018848, .0000001);
  assert.equal(f.host.querySelector('[data-ideal="measured"]').getAttribute("aria-pressed"), "true");
});

domTest("slope extremes remain finite and exact presets retain native any-step declaration", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  assert.equal(f.$("probeSlope").getAttribute("step"), "any");
  for (const slope of [50, 54]) {
    f.input("probeSlope", slope);
    near(number(f.$("probeHeight").textContent), geometry(230.363, slope).height, .00051);
    for (const id of ["ratioMicroscope", "heightMicroscope"]) assert.doesNotMatch(f.$(id).innerHTML, /NaN|Infinity/);
    for (const label of f.$("heightMicroscope").querySelectorAll("text")) {
      const x = Number(label.getAttribute("x")), y = Number(label.getAttribute("y"));
      assert.ok(x >= 0 && x <= 640 && y >= 0 && y <= 190, label.outerHTML);
    }
  }
});

domTest("half-height section reports seven eighths of reference volume and updates the stage", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  f.input("sectionHeight", .5);
  assert.equal(f.$("sliceVolume").textContent, "87.50%");
  assert.equal(f.$("sliceArea").textContent, "25.00%");
  near(number(f.$("sliceSide").textContent), 230.363 / 2, .0051);
  assert.deepEqual(f.calls.filter(call => call[0] === "setSlice").at(-1), ["setSlice", .5]);
  await f.click('[data-ideal="phi"]');
  assert.equal(f.$("sliceVolume").textContent, "87.50%", "section stays tied to the reference envelope");
});

domTest("Orion proper and reflected labels are computed from the real paired data", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  for (const year of [-2559, -10499, 2000]) {
    f.input("fitYear", year);
    const vectors = belt.stars.map(star => moved(star.p, star.v, year));
    const centre = [0, 1, 2].map(i => vectors.reduce((sum, vector) => sum + vector[i] / Math.hypot(...vector), 0));
    const apparent = tangentPlane(vectors, centre).points, ground = belt.ground.map(point => point.p);
    const proper = similarityFit(apparent, ground), reflected = similarityFit(apparent, ground, { reflect: true });
    near(number(f.$("properRms").textContent), proper.rms, .0051);
    near(number(f.$("mirrorRms").textContent), reflected.rms, .0051);
    await f.click('[data-fit="reflected"]');
    near(number(f.$("fitRotation").textContent), reflected.rotationDeg, .0051);
    assert.match(f.$("fitClass").textContent, /^REFLECTED/);
    const distances = [...f.$("fitResiduals").querySelectorAll("tr")].map(row => number(row.lastElementChild.textContent));
    distances.forEach((distance, index) => near(distance, reflected.residuals[index].distance, .0051));
    await f.click('[data-fit="proper"]'); assert.match(f.$("fitClass").textContent, /^PROPER/);
  }
});

domTest("overlay buttons request native stage controls and rendering settings affect the canvas", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  await f.click('[data-instrument="section"]');
  assert.ok(f.calls.some(call => call[0] === "setInstrument" && call[1] === "section" && call[2] === true));
  assert.ok(f.calls.some(call => call[0] === "setXray" && call[1] === true));
  assert.ok(f.calls.some(call => call[0] === "setRig" && call[1] === null));
  await f.click('[data-instrument="survey"]');
  assert.ok(f.calls.some(call => call[0] === "goto" && call[1] === "plan"));
  f.input("instrumentQuality", "exhibit", "change"); await settle();
  assert.equal(f.document.getElementById("scene").getAttribute("multisampling"), "8");
  assert.equal(f.document.getElementById("scene").getAttribute("maximumFrameRate"), "60");
  assert.ok(f.calls.some(call => call[0] === "setQuality" && call[1].labels === 180 && call[1].multisampling === 8 && call[1].maxFrameRate === 60));
  f.input("stageExposure", 1.25);
  near(Number(f.document.documentElement.style.getPropertyValue("--stage-exposure")), 1.25);
  await f.click("#stopMotion"); assert.ok(f.calls.some(call => call[0] === "cancelTransition")); assert.ok(f.calls.some(call => call[0] === "stopTour"));
});

domTest("stage failure leaves analytical geometry and correspondence functional", async t => {
  const f = await fixture({ failStage: true }); t.after(() => f.instruments.dispose());
  await f.click('[data-instrument="geometry"]');
  assert.match(f.$("instrumentStatus").textContent, /3D unavailable: Simulated stage unavailable/);
  assert.equal(f.host.querySelector('[data-instrument="geometry"]').getAttribute("aria-pressed"), "false");
  await f.click('[data-ideal="pi"]'); near(number(f.$("probePi").textContent), Math.PI, .0000001);
  f.input("sectionHeight", .5); assert.equal(f.$("sliceVolume").textContent, "87.50%");
  assert.match(f.$("fitNote").textContent, /No covariance or statistical significance/);
});

domTest("Stop motion prevents a pending stage or instrument load from starting a later camera move", async t => {
  for (const pending of ["stage", "instrument"]) {
    const f = await fixture({ deferStage: pending === "stage", deferInstrument: pending === "instrument" });
    t.after(() => f.instruments.dispose());
    await f.click('[data-instrument="geometry"]');
    assert.equal(f.host.querySelector('[data-instrument="geometry"]').getAttribute("aria-pressed"), "true", pending);
    assert.equal(f.calls.some(call => call[0] === "goto"), false, pending);
    await f.click("#stopMotion");
    f.releaseStage(); f.releaseInstrument(); await settle();
    assert.equal(f.calls.some(call => call[0] === "goto"), false, `${pending} resolution must not restart motion`);
    assert.equal(f.calls.some(call => call[0] === "setInstrument"), false, `${pending} resolution must not enable a canceled overlay`);
    assert.equal(f.host.querySelector('[data-instrument="geometry"]').getAttribute("aria-pressed"), "false", pending);
    f.instruments.dispose();
  }
});

domTest("comparison data failure is independent of geometry, slicing and celestial view", async t => {
  const f = await fixture({ failData: true }); t.after(() => f.instruments.dispose());
  assert.match(f.$("fitNote").textContent, /could not load: HTTP 503/);
  f.input("probeSlope", 54); assert.ok(number(f.$("probeHeight").textContent) > 150);
  f.input("sectionHeight", .5); assert.equal(f.$("sliceVolume").textContent, "87.50%");
  assert.match(f.host.querySelector(".cl-status").textContent, /Alnitak is/);
  assert.doesNotMatch(f.$("ratioMicroscope").innerHTML, /NaN|Infinity/);
});

domTest("celestial selection asks the stage for the selected meridian and redraws readings", async t => {
  const f = await fixture(); t.after(() => f.instruments.dispose());
  const select = f.host.querySelector(".celestial-lens select");
  select.value = "Mintaka"; select.dispatchEvent(new f.window.Event("change", { bubbles: true })); await settle();
  assert.ok(f.calls.some(call => call[0] === "setSky" && call[1].culminate === "Mintaka"));
  assert.match(f.host.querySelector(".cl-values").textContent, /Mintaka/);
  assert.doesNotMatch(f.host.querySelector(".cl-map").innerHTML, /NaN|Infinity/);
});

test("sky map projection places compass directions and zenith at independently known positions", () => {
  near(skyMapPoint(90, 123, 100)[0], 0); near(skyMapPoint(90, 123, 100)[1], 0);
  const north = skyMapPoint(0, 0, 100), east = skyMapPoint(0, 90, 100), south = skyMapPoint(0, 180, 100), west = skyMapPoint(0, 270, 100);
  near(north[0], 0); near(north[1], -100); near(east[0], 100); near(east[1], 0);
  near(south[0], 0); near(south[1], 100); near(west[0], -100); near(west[1], 0);
  near(Math.hypot(...skyMapPoint(45, 32, 100)), 50);
  assert.throws(() => skyMapPoint(NaN, 0)); assert.throws(() => skyMapPoint(0, 0, 0));
});


domTest("the live stage can be pinned for linked tinkering and returned from its close control", async t => {
  const f=await fixture();t.after(()=>f.instruments.dispose());
  await f.click("#pinStage");
  assert.equal(f.document.body.classList.contains("stage-pinned"),true);
  assert.equal(f.$("pinStage").getAttribute("aria-pressed"),"true");
  assert.ok(f.calls.some(call=>call[0]==="invalidate"));
  f.document.getElementById("unpinStage").click();await settle();
  assert.equal(f.document.body.classList.contains("stage-pinned"),false);
  assert.equal(f.$("pinStage").getAttribute("aria-pressed"),"false");
});
