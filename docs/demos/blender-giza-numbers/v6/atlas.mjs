// SPDX-License-Identifier: GPL-3.0-or-later
/** Demo 65 v6 page controller: stage, sky clock, sky machine, grand tour, atlas cards, shaft clock. */
import { createStage } from "./stage.mjs";
import { createInstruments } from "./instruments.mjs";
import { createMachine } from "./machine.mjs";
import { yearLabel, culminationAltitude } from "./sky-math.mjs";
import {
  fmt,
  markDigits,
  filterClaims,
  NUMBER_GRADES,
  DESIGN_GRADES,
} from "./atlas-math.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const section = $("#stage");
let stage = null,
  stagePromise = null,
  atlas = null,
  v4claims = null,
  tourToken = 0,
  actionToken = 0,
  instruments = null,
  machine = null,
  touring = false;
/** Frames of the sky that belong to a claim's proof: the line the claim is about, drawn. */
const FRAMES = {
  shaft_stars: { local: true },
  thuban_pole: { equator: true },
  passage_thuban: { local: true, equator: true },
  spence_alignment: { local: true, equator: true },
  leo_10500: { ecliptic: true, equator: true },
  orion_lowest: { local: true },
  diagonals_precession: null,
};
const KEY = [
  "Alnitak",
  "Sirius",
  "Thuban",
  "Kochab",
  "Betelgeuse",
  "Polaris",
  "Regulus",
  "Vega",
];

const receipts = Promise.all([
  fetch("receipts/atlas.json").then((r) => r.json()),
  fetch("../v4/receipts/claims-v4.json").then((r) => r.json()),
  fetch("receipts/witness.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
]);

/* ------------------------------------------------------------------ stage */
function status(t) {
  $("#status").textContent = t;
  const notice = $("#stageNotice");
  notice.textContent = t;
  notice.hidden = !t || !section.classList.contains("used");
}
const run = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch((err) =>
      status("The requested 3D action could not complete: " + err.message),
    );
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function ensureStage() {
  if (stagePromise) return stagePromise;
  status("Starting the renderer…");
  stagePromise = createStage({
    canvas: $("#scene"),
    overlay: $("#labels"),
    trails: $("#trails"),
    onStatus: status,
    onFrame: onFrame,
  })
    .then((st) => {
      stage = st;
      window.gizaStage = st;
      section.dataset.state = "live";
      $("#hud").hidden = false;
      $("#chips").hidden = false;
      st.skyReady
        .then(() => {
          syncSkyUI();
          renderStars();
          instruments?.render();
          status("");
        })
        .catch((err) =>
          status(
            "The plateau is available, but the stellar model could not load: " +
              err.message,
          ),
        );
      st.celestialReady.catch((err) => {
        $("#machineStatus").textContent =
          "Charts remain available; the 3D sky machine could not load: " +
          err.message;
      });
      st.instrumentReady.catch((err) => {
        $("#instrumentStatus").textContent =
          "Analytical charts remain available; X3D overlays could not load: " +
          err.message;
      });
      return st;
    })
    .catch((err) => {
      stagePromise = null;
      status(
        "The live 3D stage could not start here (" +
          err.message +
          "). The atlas and analytical instruments remain available.",
      );
      throw err;
    });
  return stagePromise;
}
let lastYear = null,
  lastBusy = null;
function onFrame(S) {
  const busy = [S.exposing, S.trailsDrawn, !!S.ruler, ...Object.values(S.machine || {})].join();
  if (S.year !== lastYear || busy !== lastBusy) {
    lastYear = S.year;
    lastBusy = busy;
    renderStars();
    drawShaftChart();
  }
  instruments?.render();
  machine?.render();
}
async function fadeThrough(fn, token = actionToken) {
  const f = $("#fade");
  f.classList.add("on");
  try {
    if (!reducedMotion()) await sleep(390);
    if (token !== actionToken) return { cancelled: true };
    const result = await fn();
    if (!reducedMotion()) await sleep(160);
    return token !== actionToken ? { cancelled: true } : result;
  } finally {
    if (token === actionToken) f.classList.remove("on");
  }
}
function setNow(kicker, title, chipsHtml = "", caption = "") {
  $("#nowkicker").textContent = kicker;
  $("#nowtitle").textContent = title;
  $("#nowchips").innerHTML = chipsHtml;
  $("#caption").innerHTML = caption;
}
/** Apply a proof stop: light, rig, x-ray, sky, camera. */
async function applyProof(
  p,
  { seconds = 2.6, token = ++actionToken, frames = null } = {},
) {
  const st = await ensureStage();
  if (token !== actionToken) return { cancelled: true };
  if (reducedMotion()) seconds = 0;
  section.classList.add("used");
  const S = st.state;
  const change = () => {
    if (S.world !== "plateau") st.home();
    st.setLight(p.light || "day");
    st.setRig(p.rig || null);
    st.setXray(!!p.xray);
    // frames of the sky: "keep" leaves them as the sky machine set them; otherwise a proof shows only its own
    if (frames !== "keep") {
      st.setMachine({
        local: false,
        equator: false,
        ecliptic: false,
        trail: false,
        ...(frames || {}),
      });
      st.setRuler(null);
    }
    // the v5 overlays are their own experiment: a proof or a sky view starts without them
    for (const k of INSTRUMENT_KEYS) st.setInstrument(k, false);
    if (p.sky)
      st.setSky({
        year: p.sky.year,
        culminate: p.sky.culminate,
        lower: p.sky.lower,
        lst: p.sky.lst,
      });
    if (
      p.sky?.culminate &&
      [...$("#culminate").options].some((o) => o.value === p.sky.culminate)
    )
      $("#culminate").value = p.sky.culminate;
    section.dataset.light = S.light;
    section.dataset.world = S.world;
    syncSkyUI();
  };
  let result;
  if ((p.light || "day") !== S.light || S.world !== "plateau") {
    result = await fadeThrough(async () => {
      change();
      return st.goto(p.stop, { seconds: 0 });
    }, token);
  } else {
    change();
    result = await st.goto(p.stop, { seconds });
  }
  if (token !== actionToken || result?.cancelled) return { cancelled: true };
  $("#homebtn").hidden = true;
  return { cancelled: false };
}
const INSTRUMENT_KEYS = ["section", "geometry", "harmonics", "survey"];
const chipHtml = (c) =>
  `<span class="chip n-${c.number}">${c.number}</span><span class="chip d-${c.design}">${c.design}</span>`;
async function showClaim(id, { scroll = true, seconds } = {}) {
  const c = atlas.claims.find((x) => x.id === id);
  if (!c) return;
  stopTour();
  if (scroll)
    section.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  $$(".card.active").forEach((n) => n.classList.remove("active"));
  $(`.card[data-id="${id}"]`)?.classList.add("active");
  setNow(
    c.family,
    c.title,
    chipHtml(c),
    `<b>The claim.</b> ${esc(c.wonder)}<br><b>The test.</b> ${esc(c.test)}`,
  );
  await applyProof(c.proof, { seconds, frames: await framesFor(id) });
}
/** A claim's frames, once the sky machine has loaded; none if it cannot. */
async function framesFor(id) {
  if (!FRAMES[id]) return null;
  try {
    await (await ensureStage()).celestialReady;
    return FRAMES[id];
  } catch {
    return null;
  }
}
const GO = {
  hero: () => {
    setNow(
      "Golden hour",
      "The plateau from the south-east",
      "",
      "Light path-traced once in Blender Cycles and baked into the X3D: your browser draws it without computing a single lamp.",
    );
    return applyProof({ stop: "hero", light: "day" });
  },
  night: () => {
    setNow(
      "Night, 2560 BC",
      "The sky Khufu's builders saw",
      "",
      "52,602 catalogue stars in an ancient-epoch geometric model. Distances are estimates and space motion is extrapolated; the Moon is a baked stage light, not a dated ephemeris.",
    );
    return applyProof({
      stop: "moon",
      light: "night",
      sky: { year: -2559, culminate: "Alnitak" },
    });
  },
  shafts: () => showClaim("shaft_stars", { scroll: false }),
  thuban: () => showClaim("thuban_pole", { scroll: false }),
  belt: () => {
    setNow(
      "Night, 2560 BC",
      "Orion's belt over the three pyramids",
      "",
      "Alnitak, Alnilam, Mintaka: crossing the meridian 44.7° up. Now press “Belt on the ground”.",
    );
    return applyProof({
      stop: "belt",
      light: "night",
      sky: { year: -2559, culminate: "Alnitak" },
    });
  },
  plan: () => showClaim("orion_belt", { scroll: false }),
  xray: () => showClaim("kings_chamber", { scroll: false }),
  machine: () => machine?.allFrames(),
  polepath: () => machine?.toggle("trail", true),
  exposure: () => machine?.expose("north"),
  fly: () => flyOut(),
  home: async () => {
    const token = ++actionToken,
      st = await ensureStage();
    if (token !== actionToken) return;
    const result = await fadeThrough(async () => {
      st.home();
      return st.goto("belt", { seconds: 0 });
    }, token);
    if (token !== actionToken || result?.cancelled) return;
    $("#homebtn").hidden = true;
    section.dataset.world = "plateau";
    setNow(
      "Night sky",
      "Orion from Giza",
      "",
      "An apparent pattern in a catalogue-derived sky. The Moon’s illumination is a presentation bake.",
    );
    return applyProof(
      {
        stop: "belt",
        light: "night",
        sky: { year: st.state.year, culminate: "Alnitak" },
      },
      { token },
    );
  },
};
async function flyOut() {
  const token = ++actionToken,
    st = await ensureStage();
  if (token !== actionToken) return;
  await st.skyReady;
  if (token !== actionToken) return;
  section.classList.add("used");
  if (st.state.light !== "night" || st.state.world !== "plateau")
    await applyProof(
      {
        stop: "belt",
        light: "night",
        sky: { year: st.state.year, culminate: "Alnitak" },
      },
      { token },
    );
  if (token !== actionToken) return;
  st.setRig(null);
  st.setSky({ labels: Math.max(st.state.labels, 120) });
  syncSkyUI();
  setNow(
    "Leaving Earth",
    "Flying to Orion's belt",
    "",
    `<b>${Math.round(st.starInfo("Alnitak").distance).toLocaleString("en-US")} light-years</b> to Alnitak in this catalogue model; Alnilam is ${Math.round(st.starInfo("Alnilam").distance).toLocaleString("en-US")} light-years away. The row is an apparent pattern from Earth.`,
  );
  $("#homebtn").hidden = false;
  section.dataset.world = "cosmos";
  const flight = await st.flyTo("Alnitak", { fraction: 0.8, seconds: 16 });
  if (token !== actionToken || flight?.cancelled) return;
  setNow(
    `${Math.round(Math.hypot(...(st.state.cosmos || [0, 0, 0]))).toLocaleString("en-US")} light-years out`,
    "The belt, from the side",
    "",
    "Drag to look around: the Sun is one faint star behind you. A constellation is a view, not a thing. Whatever the builders drew, they drew the view from Giza.",
  );
}

/* ------------------------------------------------------------------ grand tour */
function stopTour() {
  tourToken++;
  actionToken++;
  stage?.cancelTransition("Tour or action stopped");
  $("#fade").classList.remove("on");
  section.classList.remove("touring");
  $("#tourbtn").textContent = "▶ Grand tour";
}
async function playTour() {
  const my = ++tourToken;
  section.classList.add("touring");
  try {
    await ensureStage();
    if (my !== tourToken) return;
    await stage.skyReady;
    if (my !== tourToken) return;
    section.classList.add("touring", "used");
    $("#tourbtn").textContent = "■ Stop the tour";
    const alive = () => my === tourToken;
    const hold = async (ms) => {
      const t0 = performance.now();
      while (alive() && performance.now() - t0 < ms) await sleep(100);
    };
    const claimStep = async (id, ms = 6500) => {
      const c = atlas.claims.find((x) => x.id === id);
      setNow(c.family, c.title, "", `<b>The claim.</b> ${esc(c.wonder)}`);
      $$(".card.active").forEach((n) => n.classList.remove("active"));
      await applyProof(c.proof, {
        seconds: 3.2,
        frames: await framesFor(id),
      });
      await hold(ms);
      if (!alive()) return;
      setNow(c.family, c.title, chipHtml(c), `<b>The test.</b> ${esc(c.test)}`);
      await hold(ms + 2500);
    };
    await GO.hero();
    await hold(5000);
    for (const id of [
      "v1_pi",
      "khafre_345",
      "kings_chamber",
      "kc_half_area",
      "shaft_stars",
      "thuban_pole",
      "machine:polepath",
      "machine:exposure",
      "passage_thuban",
      "leo_10500",
      "machine:frames",
      "orion_belt",
    ]) {
      if (!alive()) return;
      if (id.startsWith("machine:")) {
        // the sky machine's three stops; skipped if it could not load
        if (!machine || stage.state.machineError) continue;
        touring = true;
        try {
          if (id === "machine:polepath") {
            await machine.toggle("trail", true);
            await hold(9000);
          } else if (id === "machine:exposure") {
            await machine.expose("north");
            await hold(5000);
          } else {
            await machine.allFrames();
            await hold(9000);
          }
        } finally {
          touring = false;
        }
        continue;
      }
      await claimStep(id);
    }
    if (!alive()) return;
    await GO.belt();
    await hold(4500);
    if (!alive()) return;
    await flyOut();
    await hold(9000);
    if (!alive()) return;
    await GO.home();
    await hold(1500);
    if (!alive()) return;
    setNow(
      "The verdict",
      `${atlas.count} claims`,
      "",
      `<b>${atlas.number_grades.Confirmed}</b> hold as numbers. The atlas marks <b>${atlas.design_grades.Designed}</b> as editorially “Designed”: the cubit plan, the sekeds, the 3-4-5, the square, the level, true north. The rest is what any big, careful, simple shape does when you bring enough units to it. Scroll down: every card has its own 3D proof.`,
    );
    stopTour();
  } catch (err) {
    if (my === tourToken) stopTour();
    throw err;
  }
}

/* ------------------------------------------------------------------ sky panel */
function syncSkyUI() {
  if (!stage) return;
  const S = stage.state;
  $("#year").value = S.year;
  $("#yearout").textContent = yearLabel(S.year);
  $("#labelcount").value = S.labels;
  $("#labelout").textContent = S.labels;
  $("#faint").checked = S.faint;
  $("#figures").checked = S.figures;
  $$("[data-light-set]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.lightSet === S.light)),
  );
  $$("#yearticks button").forEach((b) =>
    b.classList.toggle("on", Math.abs(+b.dataset.year - S.year) < 6),
  );
  section.dataset.light = S.light;
  section.dataset.world = S.world;
  renderStars();
}
function renderStars() {
  if (!stage || !stage.state.skyData) return;
  const S = stage.state,
    body = $("#startable tbody");
  body.innerHTML = KEY.map((n) => {
    const i = stage.starInfo(n);
    return i
      ? `<tr data-star="${n}" class="${i.alt < 0 ? "below" : ""}"><td>${n}</td><td>${i.alt.toFixed(2)}°</td><td>${i.az.toFixed(1)}°</td><td>${Math.round(i.distance).toLocaleString("en-US")}</td></tr>`
      : "";
  }).join("");
  const shafts = v4claims?.claims.find((c) => c.key === "shaft_stars")?.shafts;
  const box = $("#readout");
  const busy =
    S.exposing ||
    S.trailsDrawn ||
    S.ruler ||
    S.machine?.equator ||
    S.machine?.ecliptic ||
    S.machine?.trail;
  if (shafts && S.light === "night" && S.world === "plateau" && !busy) {
    box.hidden = false;
    box.innerHTML =
      `<b>${yearLabel(S.year)}</b> · meridian heights<br>` +
      shafts
        .map((s) => {
          const i = stage.starInfo(s.star),
            alt = culminationAltitude(i.dec),
            d = alt - s.gantenbrink_deg;
          return `${s.key} ${s.star} ${alt.toFixed(2)}° · shaft ${s.gantenbrink_deg.toFixed(2)}° (${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}°)`;
        })
        .join("<br>");
  } else box.hidden = true;
}
function wireSky() {
  const need = async (fn) =>
    run(async () => {
      const st = await ensureStage();
      await st.skyReady;
      fn(st);
      syncSkyUI();
      renderStars();
      instruments?.render();
    });
  // each handler reads its control now: by the time the stage is ready, syncSkyUI may have written the control back
  $("#year").addEventListener("input", (e) => {
    const year = +e.target.value,
      culminate = $("#culminate").value;
    need((st) => st.setSky({ year, culminate }));
  });
  $$("#yearticks button").forEach((b) =>
    b.addEventListener("click", () =>
      need((st) =>
        st.setSky({ year: +b.dataset.year, culminate: $("#culminate").value }),
      ),
    ),
  );
  $("#culminate").addEventListener("change", (e) => {
    const culminate = e.target.value;
    need((st) => st.setSky({ culminate }));
  });
  $("#labelcount").addEventListener("input", (e) => {
    const labels = +e.target.value;
    need((st) => st.setSky({ labels }));
  });
  $("#faint").addEventListener("change", (e) => {
    const faint = e.target.checked;
    need((st) => st.setSky({ faint }));
  });
  $("#figures").addEventListener("change", (e) => {
    const figures = e.target.checked;
    need((st) => st.setSky({ figures }));
  });
  $$("[data-light-set]").forEach((b) =>
    b.addEventListener("click", () =>
      run(async () => {
        stopTour();
        const st = await ensureStage();
        section.classList.add("used");
        if (st.state.world !== "plateau") return GO.home();
        await fadeThrough(async () => {
          st.setLight(b.dataset.lightSet);
          if (b.dataset.lightSet === "night")
            st.setSky({ culminate: $("#culminate").value });
        });
        syncSkyUI();
        renderStars();
      }),
    ),
  );
  $("#startable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-star]");
    if (!tr) return;
    if ([...$("#culminate").options].some((o) => o.value === tr.dataset.star))
      $("#culminate").value = tr.dataset.star;
    need((st) => st.setSky({ culminate: tr.dataset.star }));
  });
}

/* ------------------------------------------------------------------ atlas */
const filters = {
  family: new Set(),
  number: new Set(),
  design: new Set(),
  q: "",
  root: null,
};
const COLORS = {
  Confirmed: "#9fd49a",
  Likely: "#e9bf76",
  Suspected: "#f0a35e",
  False: "#ea8f86",
  Untested: "#5d6d7c",
  Designed: "#74d3d9",
  Possible: "#3f8f96",
  Coincidence: "#b9a3f5",
  Unknown: "#5d6d7c",
};
function digitsHtml(c) {
  if (c.measured == null || c.target == null || c.literal == null) return "";
  const row = (v) =>
    markDigits(fmt(v), c.literal)
      .map(([t, h]) =>
        h == null
          ? esc(t)
          : `<span class="${h ? "hit" : "miss"}">${esc(t)}</span>`,
      )
      .join("");
  const note =
    c.literal === 0
      ? "no leading digit in common" +
        (c.rounding ? ` (they round together to ${c.rounding})` : "")
      : `${c.literal} literal digit${c.literal === 1 ? "" : "s"} shared` +
        (c.rounding > c.literal ? `, ${c.rounding} after rounding` : "");
  return `<div class="digits"><span class="k">measured</span><span>${row(c.measured)} <span class="k">${esc(c.unit)}</span></span><span class="k">claimed</span><span>${row(c.target)}</span><span class="dnote">${note}</span></div>`;
}
function cardHtml(c) {
  return `<article class="card" data-id="${c.id}">
    ${c.invented ? '<span class="inv">MADE UP HERE</span>' : ""}
    <div class="fam"><span>${esc(c.family)}</span><em>${c.origin === "v1" ? "from v1" : "new in v4"}</em></div>
    <h3>${esc(c.title)}</h3>
    <p class="wonder">${esc(c.wonder)}</p>
    ${digitsHtml(c)}
    <p class="test">${esc(c.test)}</p>
    <p class="src">${esc(c.source)}</p>${c.roots ? `<p class="rests">Rests on: <b>${esc(rootLabel(c.roots[0]))}</b>${c.roots[1] ? " and " + esc(rootLabel(c.roots[1]).toLowerCase()) : ""}${c.modern_unit ? ` · needs the <b>${esc(c.modern_unit)}</b>` : ""}</p>` : ""}${c.reviewNote ? `<p class="review-note"><b>v5 review.</b> ${esc(c.reviewNote)}</p>` : ""}
    <div class="foot">${chipHtml(c)}<button class="show" data-show="${c.id}" aria-label="Show ${esc(c.title)} in 3D">Show in 3D ▶</button></div>
  </article>`;
}
function renderCards() {
  const list = filterClaims(atlas.claims, filters).filter(
    (c) => !filters.root || c.roots?.[0] === filters.root,
  );
  $("#cards").innerHTML = list.map(cardHtml).join("");
  $("#count").innerHTML =
    `${list.length} of ${atlas.count} claims shown` +
    (filters.root
      ? ` · resting on: <b>${esc(rootLabel(filters.root))}</b> <button class="clear-root" id="clearRoot">show all</button>`
      : "");
}
const rootLabel = (key) =>
  atlas.independence?.roots.find((r) => r.key === key)?.label || key;
function chipset(node, values, key, counts) {
  node.innerHTML = values
    .map(
      (v) =>
        `<button aria-pressed="false" data-v="${esc(v)}">${esc(v)}${counts ? ` <b>${counts[v] || 0}</b>` : ""}</button>`,
    )
    .join("");
  node.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    on ? filters[key].add(b.dataset.v) : filters[key].delete(b.dataset.v);
    renderCards();
  });
}
function renderTally() {
  const bar = (
    title,
    grades,
    counts,
    say,
  ) => `<div class="bar"><h3>${title}</h3><div class="track">${grades.map((g) => `<i style="flex:${counts[g] || 0};background:${COLORS[g]}" title="${g}: ${counts[g] || 0}"></i>`).join("")}</div>
    <div class="keys">${grades.map((g) => `<span><b>${counts[g] || 0}</b> ${g}</span>`).join("")}</div><p class="fine" style="margin:8px 0 0">${say}</p></div>`;
  const n = atlas.number_grades,
    d = atlas.design_grades;
  $("#tally").innerHTML =
    bar(
      "Does the number hold?",
      NUMBER_GRADES,
      n,
      `${n.Confirmed + n.Likely} of ${atlas.count} claims are true or nearly true as arithmetic.`,
    ) +
    bar(
      "Was it designed?",
      DESIGN_GRADES,
      d,
      `${d.Designed} carry the editorial “Designed” label; ${d.Coincidence} are classed as coincidence. These are interpretations, not probabilities or documentary proof.`,
    );
  $("#k-claims").textContent = atlas.count;
  $("#search").placeholder = `Search ${atlas.count} claims…`;
}

/* ------------------------------------------------------------------ shaft clock */
const SC = {
  x0: 56,
  x1: 744,
  y0: 20,
  y1: 380,
  yr0: -3600,
  yr1: -1600,
  a0: 27,
  a1: 48,
};
const COL = { KS: "#ff9a3f", KN: "#4dffd9", QS: "#bfd9ff", QN: "#ffe666" };
const sx = (y) => SC.x0 + ((y - SC.yr0) / (SC.yr1 - SC.yr0)) * (SC.x1 - SC.x0);
const sy = (a) => SC.y1 - ((a - SC.a0) / (SC.a1 - SC.a0)) * (SC.y1 - SC.y0);
function drawShaftChart() {
  const svg = $("#shaftchart");
  const sh = v4claims?.claims.find((c) => c.key === "shaft_stars");
  if (!svg || !sh) return;
  let h = `<rect x="${SC.x0}" y="${SC.y0}" width="${SC.x1 - SC.x0}" height="${SC.y1 - SC.y0}" fill="#0a1119" stroke="#25364a"/>`;
  for (let a = 28; a <= 48; a += 4)
    h += `<line x1="${SC.x0}" x2="${SC.x1}" y1="${sy(a)}" y2="${sy(a)}" stroke="#16222f"/><text x="${SC.x0 - 6}" y="${sy(a) + 4}" text-anchor="end">${a}°</text>`;
  for (let y = -3499; y <= -1699; y += 300)
    h += `<line y1="${SC.y0}" y2="${SC.y1}" x1="${sx(y)}" x2="${sx(y)}" stroke="#16222f"/><text x="${sx(y)}" y="${SC.y1 + 16}" text-anchor="middle">${yearLabel(y)}</text>`;
  // Khufu's reign as commonly cited (about 2589 to 2566 BC)
  h += `<rect x="${sx(-2588)}" y="${SC.y0}" width="${sx(-2565) - sx(-2588)}" height="${SC.y1 - SC.y0}" fill="#e9bf7630"/><text x="${sx(-2577)}" y="${SC.y0 + 12}" text-anchor="middle" style="fill:#e9bf76">Khufu's reign</text>`;
  for (const s of sh.shafts) {
    const c = COL[s.key];
    h += `<line x1="${SC.x0}" x2="${SC.x1}" y1="${sy(s.gantenbrink_deg)}" y2="${sy(s.gantenbrink_deg)}" stroke="${c}" stroke-width="1.4"/>`;
    if (s.petrie_deg >= SC.a0 && s.petrie_deg <= SC.a1)
      h += `<line x1="${SC.x0}" x2="${SC.x1}" y1="${sy(s.petrie_deg)}" y2="${sy(s.petrie_deg)}" stroke="${c}" stroke-width="1" stroke-dasharray="4 5" opacity=".6"/>`;
    const pts = s.track
      .filter(([, a]) => a >= SC.a0 - 1 && a <= SC.a1 + 1)
      .map(([y, a]) => `${sx(y).toFixed(1)},${sy(a).toFixed(1)}`)
      .join(" ");
    h += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    for (const y of s.match_years)
      h += `<circle cx="${sx(y)}" cy="${sy(s.gantenbrink_deg)}" r="5" fill="#060a11" stroke="${c}" stroke-width="2"/><text x="${sx(y) + 8}" y="${sy(s.gantenbrink_deg) - 7}" style="fill:${c}">${yearLabel(y)}</text>`;
    const last = s.track[s.track.length - 1];
    h += `<text x="${SC.x1 - 4}" y="${Math.max(SC.y0 + 10, Math.min(SC.y1 - 4, sy(last[1]) - 6))}" text-anchor="end" style="fill:${c};font-weight:700">${s.star} · ${s.key}</text>`;
  }
  const yr = stage ? stage.state.year : -2559;
  if (yr >= SC.yr0 && yr <= SC.yr1)
    h += `<line x1="${sx(yr)}" x2="${sx(yr)}" y1="${SC.y0}" y2="${SC.y1}" stroke="#f3efe2" stroke-width="1.5"/><text x="${sx(yr) + 5}" y="${SC.y1 - 6}" style="fill:#f3efe2">${yearLabel(yr)}</text>`;
  svg.innerHTML = h;
}
function wireShaftChart() {
  const svg = $("#shaftchart");
  let down = false;
  const at = async (e) => {
    const r = svg.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * 760;
    const year =
      Math.round(
        (SC.yr0 + ((x - SC.x0) / (SC.x1 - SC.x0)) * (SC.yr1 - SC.yr0)) / 5,
      ) * 5;
    if (year < SC.yr0 || year > SC.yr1) return;
    const st = await ensureStage();
    await st.skyReady;
    st.setSky({ year, culminate: $("#culminate").value });
    syncSkyUI();
    renderStars();
    drawShaftChart();
  };
  svg.addEventListener("pointerdown", (e) => {
    down = true;
    svg.setPointerCapture(e.pointerId);
    run(() => at(e));
  });
  svg.addEventListener("pointermove", (e) => down && run(() => at(e)));
  svg.addEventListener("pointerup", () => {
    down = false;
  });
  svg.addEventListener("pointercancel", () => {
    down = false;
  });
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  let witness;
  [atlas, v4claims, witness] = await receipts;
  renderTally();
  chipset($("#f-family"), atlas.families, "family");
  chipset($("#f-number"), NUMBER_GRADES, "number", atlas.number_grades);
  chipset($("#f-design"), DESIGN_GRADES, "design", atlas.design_grades);
  renderCards();
  $("#search").addEventListener("input", (e) => {
    filters.q = e.target.value;
    renderCards();
  });
  $("#cards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-show]");
    if (b) run(() => showClaim(b.dataset.show));
  });
  $("#count").addEventListener("click", (e) => {
    if (!e.target.closest("#clearRoot")) return;
    filters.root = null;
    machine?.setRoot(null);
    renderCards();
  });
  if (atlas.independence)
    $("#k-facts").textContent = atlas.independence.facts_about_the_monuments;
  $$(".lens button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".lens button").forEach((x) =>
        x.setAttribute("aria-pressed", String(x === b)),
      );
      $("#atlas").dataset.lens = b.dataset.lens;
    }),
  );
  const sp = atlas.claims.find((c) => c.id === "spence_alignment");
  const tick = $('#yearticks [data-year="-2465"]');
  if (sp?.year && tick) {
    tick.dataset.year = sp.year;
    tick.textContent = yearLabel(sp.year);
    tick.title = "Kochab over Mizar: Spence's alignment year in this model";
  }
  const sh = v4claims.claims.find((c) => c.key === "shaft_stars");
  $("#sc-verdict").textContent =
    `Nearest fits: ${sh.shafts.map((s) => `${s.star} ${s.nearest_label}`).join(", ")}. A spread of ${sh.spread_years} years, all after Khufu's reign. In 2560 BC the four stars stood ${sh.shafts.map((s) => Math.abs(s.miss_2560BC_deg).toFixed(2) + "°").join(", ")} from the chosen shaft inclinations. These are meridian-altitude comparisons, not complete sightline validations.`;
  drawShaftChart();
  wireShaftChart();
  wireSky();
  instruments = await createInstruments({
    host: $("#instruments"),
    getStage: () => stage,
    onStageChange: syncSkyUI,
    say: (kicker, title, caption) => setNow(kicker, title, "", caption),
    requestStage: async () => {
      stopTour();
      const st = await ensureStage();
      section.classList.add("used");
      return st;
    },
  });
  machine = await createMachine({
    host: $("#machine"),
    atlas,
    getStage: () => stage,
    getShafts: () =>
      v4claims.claims.find((c) => c.key === "shaft_stars")?.shafts,
    say: (kicker, title, caption) => setNow(kicker, title, "", caption),
    present: (proof) => applyProof(proof, { frames: "keep" }),
    requestStage: async () => {
      if (!touring) stopTour();
      const st = await ensureStage();
      section.classList.add("used");
      if (!touring) {
        section.scrollIntoView({
          behavior: reducedMotion() ? "auto" : "smooth",
          block: "start",
        });
        // the stage draws only while it is on screen: let the scroll bring it there before the camera moves
        for (let i = 0; i < 30; i++) {
          const r = section.getBoundingClientRect();
          if (r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.3) break;
          await sleep(50);
        }
      }
      return st;
    },
    onYear: (year) =>
      run(async () => {
        if (!stage) return;
        await stage.skyReady;
        stage.setSky({ year });
        syncSkyUI();
        drawShaftChart();
      }),
    onRoot: (root) => {
      filters.root = root;
      renderCards();
      if (root)
        $("#atlas").scrollIntoView({
          behavior: reducedMotion() ? "auto" : "smooth",
          block: "start",
        });
    },
    onClaim: (id) => run(() => showClaim(id)),
  });
  if (witness)
    $("#witness tbody").innerHTML = witness.rows
      .map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`)
      .join("");
  $$("[data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      stopTour();
      run(() => GO[b.dataset.go]());
    }),
  );
  $("#enter").addEventListener("click", () => {
    section.classList.add("used");
    run(() => GO.hero());
  });
  $("#playtour").addEventListener("click", () =>
    section.classList.contains("touring") ? stopTour() : run(playTour),
  );
  $("#tourbtn").addEventListener("click", () =>
    section.classList.contains("touring") ? stopTour() : run(playTour),
  );
  // start the renderer by itself on wide screens; phones wait for a tap (two WebGL megabytes are a choice there)
  if (
    params.get("poster") !== "1" &&
    (window.innerWidth >= 700 || params.has("claim") || params.has("go"))
  ) {
    ensureStage()
      .then(() => {
        if (params.get("claim"))
          return showClaim(params.get("claim"), { scroll: false, seconds: 0 });
        else if (params.get("go") && GO[params.get("go")]) {
          section.classList.add("used");
          return GO[params.get("go")]();
        }
      })
      .catch(() => {});
  }
  window.gizaAtlas = {
    showClaim,
    playTour,
    stopTour,
    GO,
    atlas,
    ensureStage,
    machine,
  };
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) {
      stage?.pause();
      return;
    }
    stopTour();
    instruments?.dispose();
    machine?.dispose();
    stage?.dispose();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) stage?.resume();
  });
}
boot().catch((err) => {
  status("The atlas data did not load: " + err.message);
  console.error(err);
});
