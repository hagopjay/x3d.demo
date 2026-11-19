// SPDX-License-Identifier: GPL-3.0-or-later
// v3 theatre: The Reveal (five acts, Wonder and Test lenses), the Coincidence Engine, the eclipse sky and
// the Blender round-trip witness. It drives the Observatory only through its own buttons, so the
// instrument code (observatory.mjs) stays as the review delivered it apart from the scene path.
import {
  TARGETS, MONUMENTS, literalDigits, roundingDigits, coincidenceRun, eclipseSky, lastTotalEclipseYears, SKY,
} from "./wonder-math.mjs";

const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DEG = Math.PI / 180;
const THETA = (51 + 52 / 60) * DEG;
const PHI = (1 + Math.sqrt(5)) / 2;
const fmt = (v, n) => v.toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n });

let D = null; // v1 claims receipt
let act = 0, lens = "wonder", playing = !reduced.matches, timer = 0, rollTimers = [];

function click(selector) {
  const el = document.querySelector(selector);
  if (el && !el.disabled) el.click();
}
function openWorkbench(modeName, extra) {
  click(`[data-mode="${modeName}"]`);
  if (extra) extra();
  $("workbench").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" });
}

function acts() {
  const L = D?.latitude ?? { wgs84_centre: 29.979175, claim_point_north_of_centre_m: 7.85, south_edge_lat: 29.9781359, north_edge_lat: 29.9802141 };
  const piM = 4 / Math.tan(THETA), phiM = 1 / Math.cos(THETA);
  const louvre = coincidenceRun(MONUMENTS.louvre, 4).hits.find((h) => h.target.key === "c");
  const runs = Object.fromEntries(Object.entries(MONUMENTS).map(([k, m]) => [k, coincidenceRun(m, 4)]));
  const sunMi = 2 * SKY.sunRadiusKm / SKY.mileKm, moonMi = SKY.moonRadiusKm / SKY.mileKm;
  return [
    {
      key: "c", kicker: "THE GREAT PYRAMID STANDS AT LATITUDE", claim: "29.9792458", claimUnit: "° N", aside: "…and light travels <b>299 792 458</b> metres per second.",
      measLabel: "THE BASE CENTRE (WGS84, about ±5 m)", meas: L.wgs84_centre.toFixed(6), measUnit: "° N",
      wonderHead: "The same nine digits. Laid in stone 4,500 years before anyone timed light.",
      wonderBody: "The latitude of the Great Pyramid IS the speed of light. To eight digits of significance. The odds are astronomical. Or are they?",
      testHead: "Five digits of luck. The last four come free.",
      testBody: `The centre reads ${L.wgs84_centre.toFixed(6)}°, so <b>${literalDigits(29.9792458, L.wgs84_centre)} literal digits</b> agree. The claimed line runs ${L.claim_point_north_of_centre_m} m north of centre, through the Grand Gallery. But the base itself spans ${L.south_edge_lat.toFixed(5)}° to ${L.north_edge_lat.toFixed(5)}°: <b>every</b> latitude that starts 29.979 lands on stone, whatever its last four digits say. 230 metres of limestone buy those digits. And 299 792 458 is a modern SI number: the metre (1791) and the second fix it. In feet per second it reads 983 571 056.`,
      stamp: ["False", "as an encoding · 5 literal digits · the base pays for the rest"],
      open: () => openWorkbench("latitude"),
    },
    {
      key: "pi", kicker: "WALK THE BASE, DIVIDE BY TWICE THE HEIGHT", claim: "3.14159265", claimUnit: "π",
      aside: "Double it and you get τ = 6.2832, the full turn.",
      measLabel: "THE SURVEYED PYRAMID (base 230.363 m, slope 51°52′)", meas: piM.toFixed(6), measUnit: "4b ÷ 2h",
      wonderHead: "The builders squared the circle.",
      wonderBody: "Draw a circle with the height as its radius: its circumference equals the perimeter of the base. π, built in stone, two thousand years before Archimedes.",
      testHead: "Three digits, and the reason is a slope.",
      testBody: `The stone gives ${piM.toFixed(4)}: <b>${literalDigits(piM, Math.PI)} literal digits</b>. The perimeter misses the circle by 0.42 m in 921 m. A slope of 5½ palms per cubit (14 : 11, the Egyptian seked) gives exactly 22/7 = 3.1429 by arithmetic alone. τ is the same measurement doubled, not a second hit. Numerical agreement says nothing about intent.`,
      stamp: ["Confirmed", "as geometry · 3 literal digits · intent not shown"],
      open: () => openWorkbench("geometry", () => { click('[data-preset="survey"]'); click('[data-camera="CA_Pi"]'); }),
    },
    {
      key: "phi", kicker: "THE SLANT HEIGHT OVER THE HALF-BASE", claim: "1.61803399", claimUnit: "φ",
      aside: "The golden ratio, the proportion of sunflowers and the Parthenon.",
      measLabel: "THE SAME SURVEYED PYRAMID", meas: phiM.toFixed(6), measUnit: "s ÷ ½b",
      wonderHead: "The golden ratio, too. In the same monument.",
      wonderBody: "π AND φ, locked together in one shape. What are the chances of both?",
      testHead: "One slope, one freedom: π and φ are the same measurement.",
      testBody: `The stone gives ${phiM.toFixed(4)}: <b>${literalDigits(phiM, PHI)} literal digits</b>. An exact-π pyramid slopes at 51.854°, an exact-φ pyramid at 51.827°. They differ by 0.027°, less than the ±0.033° spread in the historical slope reading, so the stone cannot tell them apart. Choose the slope and π and φ both follow. Chance of both = chance of one.`,
      stamp: ["Likely", "as geometry · 3 literal digits · not independent of π"],
      open: () => openWorkbench("geometry", () => { click('[data-preset="survey"]'); click('[data-camera="CA_Phi"]'); }),
    },
    {
      key: "sky", kicker: "THE SUN IS, IN MILES, ACROSS", claim: "864000", claimUnit: "mi", group: true,
      aside: "The Moon's radius: 1,080 miles. A day: 86,400 seconds. The Sun: 108 Earths across. 864, 108, 432. The sacred numbers.",
      measLabel: "IAU NOMINAL SOLAR RADIUS × 2, IN STATUTE MILES", meas: Math.round(sunMi).toString(), measUnit: "mi",
      wonderHead: "The heavens speak in the same numbers as the temples.",
      wonderBody: "864,000. 1,080. 86,400. 432,000. Over and over, the same family of digits, from the Sun to the second.",
      testHead: "In miles. Change the unit and the magic leaves.",
      testBody: `The Sun is ${fmt(sunMi, 0)} mi across: <b>${literalDigits(sunMi, 864000)} literal digits</b>. The Moon's radius is ${fmt(moonMi, 1)} mi: it <i>rounds</i> to 1,080 at ${roundingDigits(moonMi, 1080)} digits, yet only <b>${literalDigits(moonMi, 1080)}</b> literal digits match. In kilometres they are 1,391,400 and 1,737.4, and the pattern is gone. The statute mile is an English unit of 1593; 86,400 is 24 × 60 × 60, a choice of base 60. 864, 1080 and 432 are all 2ᵃ·3³·5ᵇ: the very divisible numbers people pick when they round.`,
      stamp: ["Confirmed", "as numbers in miles · a property of the unit, not the sky"],
      open: () => $("sky").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" }),
    },
    {
      key: "louvre", kicker: "PARIS, 1989. THE LOUVRE PYRAMID'S EIGHT EDGES, IN YARDS", claim: "299.792458", claimUnit: "c",
      aside: "Glass and steel, by I. M. Pei. Measured in yards. The speed of light?",
      measLabel: "8 EDGES OF A 35.42 m × 21.64 m PYRAMID, IN YARDS", meas: (louvre ? louvre.value : 299.73541).toFixed(5), measUnit: "yd",
      wonderHead: "The Louvre Pyramid encodes the speed of light!",
      wonderBody: "Four digits. In a museum entrance. Did Pei know?",
      testHead: "Every pyramid encodes something when you choose the question afterwards.",
      testBody: `The Coincidence Engine tries ${runs.great.tries} numbers per monument (lengths in ten units, inverses, ratios, the site) against ${TARGETS.length} famous constants. Chance alone should give about <b>${runs.great.expected.toFixed(1)}</b> four-digit "discoveries" per monument. Found: Great Pyramid ${runs.great.found}, Khafre ${runs.khafre.found}, Menkaure ${runs.menkaure.found}, Red Pyramid ${runs.red.found}, Louvre ${runs.louvre.found}. Menkaure's slant height in feet, inverted, reads the length of the year. Try it yourself below.`,
      stamp: ["Authored", "a coincidence we went looking for, on purpose"],
      open: () => $("engine").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" }),
    },
  ];
}

let ACTS = [];

function digitSpans(str, shared, mode) {
  let i = 0;
  return [...str].map((ch) => {
    if (!/[0-9]/.test(ch)) return `<span class="sep">${esc(ch)}</span>`;
    const lead = i === 0 && ch === "0";
    const idx = lead ? -1 : i++;
    const cls = mode === "wonder" ? "gold" : idx >= 0 && idx < shared ? "shared" : "off";
    return `<span class="d ${cls}" data-final="${ch}">${ch}</span>`;
  }).join("");
}

function significant(s) {
  return s.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

function roll(el) {
  rollTimers.forEach(clearInterval);
  rollTimers = [];
  if (reduced.matches) return;
  el.querySelectorAll(".d").forEach((span, k) => {
    const final = span.dataset.final;
    let n = 0;
    const stop = 6 + k * 2;
    const t = setInterval(() => {
      n++;
      span.textContent = n >= stop ? final : String((Math.random() * 10) | 0);
      if (n >= stop) clearInterval(t);
    }, 45);
    rollTimers.push(t);
  });
}

function showAct(i, { animate = true } = {}) {
  act = (i + ACTS.length) % ACTS.length;
  const a = ACTS[act];
  const shared = literalDigits(Number(significant(a.claim)) || 0, Number(significant(a.meas)) || 0, 12);
  const k = Math.min(shared, significant(a.claim).length);
  $("rvAct").textContent = act + 1;
  $("rvKicker").textContent = a.kicker;
  $("rvClaim").innerHTML = digitSpans(a.claim, k, lens) + `<span class="u">${esc(a.claimUnit)}</span>`;
  $("rvAside").innerHTML = a.aside;
  $("rvMeasLabel").textContent = a.measLabel;
  $("rvMeas").innerHTML = digitSpans(a.meas, k, "test") + `<span class="u">${esc(a.measUnit)}</span>`;
  $("rvVs").hidden = lens === "wonder";
  $("rvHead").textContent = lens === "wonder" ? a.wonderHead : a.testHead;
  $("rvBody").innerHTML = lens === "wonder" ? a.wonderBody : a.testBody;
  const [grade, note] = a.stamp;
  $("rvStamp").hidden = lens === "wonder";
  $("rvStamp").innerHTML = `<span class="chip ${grade}">${grade}</span><span>${esc(note)}</span><b>${k} literal digit${k === 1 ? "" : "s"}</b>`;
  $("reveal").dataset.lens = lens;
  $("reveal").dataset.act = a.key;
  document.querySelectorAll("#rvDots button").forEach((b, j) => b.setAttribute("aria-current", j === act ? "true" : "false"));
  $("rvWonder").setAttribute("aria-pressed", lens === "wonder");
  $("rvTest").setAttribute("aria-pressed", lens === "test");
  if (animate) roll(lens === "wonder" ? $("rvClaim") : $("rvMeas"));
}

function schedule() {
  clearTimeout(timer);
  if (!playing) return;
  timer = setTimeout(() => {
    if (lens === "wonder") lens = "test";
    else { lens = "wonder"; act = (act + 1) % ACTS.length; }
    showAct(act);
    schedule();
  }, lens === "wonder" ? 5200 : 9500);
}
function setPlaying(p) {
  playing = p;
  $("rvPlay").setAttribute("aria-pressed", String(p));
  $("rvPlay").textContent = p ? "❚❚ Pause" : "▶ Play";
  schedule();
}

function initReveal() {
  ACTS = acts();
  $("rvDots").innerHTML = ACTS.map((a, j) => `<button aria-label="Act ${j + 1}: ${esc(a.key)}" data-i="${j}"></button>`).join("");
  $("rvDots").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { lens = "wonder"; showAct(+b.dataset.i); setPlaying(false); } });
  $("rvPrev").onclick = () => { lens = "wonder"; showAct(act - 1); setPlaying(false); };
  $("rvNext").onclick = () => { lens = "wonder"; showAct(act + 1); setPlaying(false); };
  $("rvWonder").onclick = () => { lens = "wonder"; showAct(act); setPlaying(false); };
  $("rvTest").onclick = () => { lens = "test"; showAct(act); setPlaying(false); };
  $("rvPlay").onclick = () => setPlaying(!playing);
  $("rvOpen").onclick = () => { setPlaying(false); ACTS[act].open(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else schedule(); });
  showAct(0);
  setPlaying(playing);
}

/* ---------------- the Coincidence Engine ---------------- */
function engineMonument() {
  const key = $("engMon").value;
  if (key !== "yours") return MONUMENTS[key];
  const b = Math.max(1, +$("engBase").value || 100), h = Math.max(1, +$("engHeight").value || 60);
  return { label: "Your pyramid", base: b, height: h, lat: +$("engLat").value || 0, lon: +$("engLon").value || 0, note: "your numbers" };
}
function engineOpts() {
  return { units: $("engUnits").checked, inverses: $("engInv").checked, ratios: $("engRatios").checked, site: $("engSite").checked };
}
function drawEngine() {
  const d = +$("engDigits").value;
  $("engDigitsOut").textContent = d + " digits";
  $("engYours").hidden = $("engMon").value !== "yours";
  const m = engineMonument(), o = engineOpts();
  const r = coincidenceRun(m, d, o);
  $("engTries").textContent = r.tries.toLocaleString("en-US");
  $("engComparisons").textContent = r.comparisons.toLocaleString("en-US");
  $("engFound").textContent = r.found;
  $("engExpected").textContent = r.expected < 0.1 ? r.expected.toFixed(3) : r.expected.toFixed(2);
  $("engNote").textContent = m.note;
  const list = r.hits.slice(0, 8);
  $("engHits").innerHTML = list.length
    ? list.map((h) => `<li><span class="hit-k">${h.digits >= 12 ? "∞" : h.digits}</span><div><b>${esc(m.label)}: ${esc(h.text)} = ${esc(h.value.toPrecision(Math.min(10, h.digits + 3)))}</b><span>that's <em>${esc(h.target.label)}</em> (${esc(h.target.note)}) to ${h.digits} literal digits${Math.abs(h.rel) < 1e-12 ? "" : `, off by ${(h.rel * 100).toPrecision(2)} %`}</span></div></li>`).join("")
    : `<li class="none">No ${d}-digit "discoveries" this time. Chance alone expected ${r.expected.toFixed(2)}.</li>`;
  // all monuments, same rules
  const rows = Object.entries(MONUMENTS).map(([k, mm]) => ({ k, label: mm.label, ...coincidenceRun(mm, d, o) }));
  if ($("engMon").value === "yours") rows.push({ k: "yours", label: "Your pyramid", ...r });
  const max = Math.max(1, ...rows.map((x) => Math.max(x.found, x.expected)));
  const W = 560, rowH = 30, H = rows.length * rowH + 34, x0 = 190, sx = (W - x0 - 40) / max;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Discoveries found versus expected by chance for each monument">`;
  rows.forEach((x, i) => {
    const y = 10 + i * rowH;
    svg += `<text x="${x0 - 10}" y="${y + 15}" text-anchor="end" class="lab${x.k === $("engMon").value ? " on" : ""}">${esc(x.label)}</text>`;
    svg += `<rect x="${x0}" y="${y + 4}" width="${Math.max(2, x.found * sx)}" height="14" rx="2" class="bar-found"/>`;
    svg += `<line x1="${x0 + x.expected * sx}" x2="${x0 + x.expected * sx}" y1="${y}" y2="${y + 22}" class="bar-exp"/>`;
    svg += `<text x="${x0 + Math.max(2, x.found * sx) + 6}" y="${y + 15}" class="num">${x.found}</text>`;
  });
  svg += `<text x="${x0}" y="${H - 6}" class="cap">gold: found · white tick: chance alone (${rows[0].expected.toFixed(2)})</text></svg>`;
  $("engChart").innerHTML = svg;
}
function initEngine() {
  ["engMon", "engDigits", "engUnits", "engInv", "engRatios", "engSite", "engBase", "engHeight", "engLat", "engLon"].forEach((id) =>
    $(id).addEventListener("input", drawEngine));
  $("engTargets").textContent = TARGETS.map((t) => t.label).join(" · ");
  drawEngine();
}

/* ---------------- the sky ---------------- */
function drawSky() {
  const myr = +$("skyTime").value;
  const s = eclipseSky(myr * 1e6);
  $("skyTimeOut").textContent = myr === 0 ? "today" : (myr > 0 ? "+" : "−") + Math.abs(myr) + " million years";
  const lo = 26, hi = 38, W = 560, H = 150, x = (v) => 30 + (v - lo) / (hi - lo) * (W - 60);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Angular diameter ranges of the Sun and the Moon">`;
  for (let v = lo; v <= hi; v += 2) svg += `<line x1="${x(v)}" x2="${x(v)}" y1="18" y2="${H - 30}" class="grid"/><text x="${x(v)}" y="${H - 14}" text-anchor="middle" class="tick">${v}′</text>`;
  const ov = [Math.max(s.sun[0], s.moon[0]), Math.min(s.sun[1], s.moon[1])];
  if (ov[1] > ov[0]) svg += `<rect x="${x(ov[0])}" y="18" width="${x(ov[1]) - x(ov[0])}" height="${H - 48}" class="overlap"/>`;
  svg += `<rect x="${x(s.sun[0])}" y="34" width="${x(s.sun[1]) - x(s.sun[0])}" height="18" rx="9" class="sun"/><text x="${x(s.sun[1]) + 8}" y="48" class="lab">Sun ${s.sun[0].toFixed(1)}′–${s.sun[1].toFixed(1)}′</text>`;
  svg += `<rect x="${x(s.moon[0])}" y="70" width="${x(s.moon[1]) - x(s.moon[0])}" height="18" rx="9" class="moon"/><text x="${Math.min(x(s.moon[1]) + 8, W - 150)}" y="${x(s.moon[1]) + 8 > W - 150 ? 104 : 84}" class="lab">Moon ${s.moon[0].toFixed(1)}′–${s.moon[1].toFixed(1)}′</text>`;
  svg += `</svg>`;
  $("skyChart").innerHTML = svg;
  $("skyVerdict").innerHTML = s.totalPossible
    ? `<b class="ok">Total eclipses possible</b> ${s.annularPossible ? "and annular ones too" : "(no annular ones)"}${myr ? `: the Moon is ${fmt(Math.abs(s.shiftKm), 0)} km ${s.shiftKm > 0 ? "further" : "closer"}` : ""}.`
    : `<b class="no">No more total eclipses.</b> The Moon is ${fmt(s.shiftKm, 0)} km further out and never covers the whole Sun.`;
}
function initSky() {
  $("skyTime").addEventListener("input", drawSky);
  $("skyLast").textContent = Math.round(lastTotalEclipseYears() / 1e6);
  const sunMi = 2 * SKY.sunRadiusKm / SKY.mileKm, moonMi = SKY.moonRadiusKm / SKY.mileKm;
  const rows = [
    ["Sun diameter", fmt(sunMi, 0) + " mi", fmt(2 * SKY.sunRadiusKm, 0) + " km", "864,000", literalDigits(sunMi, 864000)],
    ["Sun radius", fmt(sunMi / 2, 0) + " mi", fmt(SKY.sunRadiusKm, 0) + " km", "432,000", literalDigits(sunMi / 2, 432000)],
    ["Moon radius", fmt(moonMi, 1) + " mi", fmt(SKY.moonRadiusKm, 1) + " km", "1,080", literalDigits(moonMi, 1080)],
    ["Sun ÷ Moon diameter", fmt(SKY.sunRadiusKm / SKY.moonRadiusKm, 1) + "×", "same", "400", literalDigits(SKY.sunRadiusKm / SKY.moonRadiusKm, 400)],
    ["Sun ÷ Moon distance (mean)", fmt(SKY.auKm / SKY.moonMeanKm, 1) + "×", "same", "400", literalDigits(SKY.auKm / SKY.moonMeanKm, 400)],
  ];
  $("skyTable").innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td class="m">${r[1]}</td><td class="m">${r[2]}</td><td class="m">${r[3]}</td><td class="m">${r[4]}</td></tr>`).join("");
  drawSky();
}

/* ---------------- Blender round-trip witness ---------------- */
async function initPipeline() {
  try {
    const r = await fetch("receipts/blender-roundtrip.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const R = await r.json();
    $("rtRows").innerHTML = R.rows.map((x) => `<tr class="${x.status}"><td>${esc(x.node)}</td><td class="m">${x.source}</td><td class="m">${esc(x.blender)}</td><td class="m">${x.returned}</td><td><span class="rt ${x.status}">${esc(x.status)}</span> ${esc(x.note || "")}</td></tr>`).join("");
    $("rtSummary").textContent = R.summary;
  } catch (e) {
    $("rtSummary").textContent = "Could not load the round-trip receipt (" + e.message + ").";
  }
}

async function init() {
  try {
    const r = await fetch("../v1/receipts/claims.json");
    if (r.ok) D = await r.json();
  } catch { /* acts fall back to the published constants */ }
  initReveal();
  initEngine();
  initSky();
  initPipeline();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
