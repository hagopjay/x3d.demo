// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The v6 sky machine: the page side. Toggles for the frames of the sky in the 3D stage, the long exposure,
 * the angular ruler, and four linked charts that need no WebGL at all: the pole's path, the shaft consensus,
 * the survey microscope and the witness count.
 *
 * Everything drawn here comes from assets/celestial-data.json, assets/survey.json and receipts/atlas.json.
 */
import { yearLabel, moved } from "./sky-math.mjs";
import {
  separation,
  trailAt,
  poleDistance,
  shaftResiduals,
  shaftConsensus,
  walkSquare,
  witnessGroups,
} from "./machine-math.mjs";

const C = {
  gold: "#f0c77e",
  cyan: "#76e3dc",
  violet: "#b7a5ff",
  red: "#f39b8c",
  line: "#263e4b",
  muted: "#96b0bd",
  ink: "#eef5ef",
};
const GRADE = {
  Confirmed: "#9fd49a",
  Likely: "#e9bf76",
  Suspected: "#f0a35e",
  False: "#ea8f86",
  Untested: "#5d6d7c",
};
const STAR_COL = {
  Thuban: "#4dffd9",
  Kochab: "#ffe666",
  Polaris: "#bfd9ff",
  Vega: "#b7a5ff",
  Deneb: "#f39b8c",
  Errai: "#9fd49a",
  Alderamin: "#e9bf76",
};
const SHAFT_COL = { KS: "#ff9a3f", KN: "#4dffd9", QS: "#bfd9ff", QN: "#ffe666" };
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const norm = (v) => {
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Seconds of arc as minutes and seconds: 223 -> 3′43″. */
export const arcmin = (arcsec) => {
  const a = Math.round(Math.abs(arcsec));
  return `${Math.floor(a / 60)}′${String(a % 60).padStart(2, "0")}″`;
};
const mix = (a, b, k) => a.map((c, i) => Math.round(c + (b[i] - c) * k));
/** The trail's colour for a year: warm past, white present, cool future (as build_celestial.py). */
export function trailColour(year) {
  const k = Math.min(1, Math.abs((year - 2000) / 13000)) ** 0.7,
    white = [242, 247, 255],
    c = year < 2000 ? mix(white, [255, 128, 107], k) : mix(white, [199, 158, 255], k);
  return `rgb(${c.join(",")})`;
}
/** Round calendar years as [astronomical year, label]: 3000 BC is astronomical year -2999. */
export function calendarTicks(fromBC, toAD, step) {
  const out = [];
  for (let n = fromBC; n >= step; n -= step)
    out.push([1 - n, (n >= 10000 ? n.toLocaleString("en-US") : n) + " BC"]);
  out.push([1, "AD 1"]);
  for (let n = step; n <= toAD; n += step)
    out.push([n, "AD " + (n >= 10000 ? n.toLocaleString("en-US") : n)]);
  return out;
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export async function createMachine({
  host,
  atlas,
  getStage,
  requestStage,
  present,
  say = () => {},
  getShafts = () => null,
  onYear = () => {},
  onRoot = () => {},
  onClaim = () => {},
}) {
  const $ = (id) => host.querySelector("#" + id);
  const $$ = (sel) => [...host.querySelectorAll(sel)];
  const status = (t) => {
    $("machineStatus").textContent = t;
  };
  let data = null,
    survey = null,
    disposed = false,
    token = 0,
    view = null;
  const state = {
    year: -2559,
    zoom: 1500,
    squares: new Set(["casing", "core"]),
    root: null,
  };
  const reduced = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------ the stage side */
  async function act(fn) {
    const my = ++token;
    try {
      const st = await requestStage();
      if (disposed || my !== token) return null;
      await st.celestialReady;
      if (disposed || my !== token) return null;
      let said = false;
      const out = await fn(st, () => my === token && !disposed, (t) => {
        said = true;
        status(t);
      });
      if (!said && my === token)
        status("LIVE SKY MACHINE / frames drawn in the star layer of the X3D stage");
      return out ?? true;
    } catch (e) {
      status("Charts only · the 3D sky machine is unavailable: " + e.message);
      return null;
    }
  }
  const VIEWS = {
    machine: (year) => ({
      stop: "machine",
      light: "night",
      sky: { year, culminate: "Alnitak" },
    }),
    polepath: (year) => ({
      stop: "polepath",
      light: "night",
      sky: { year, lst: 4.7124 }, // 18 h: the middle of the pole's loop stands straight above the pole
    }),
  };
  async function look(name, st, force = false) {
    const S = st.state;
    if (!force && view === name && S.light === "night" && S.world === "plateau")
      return;
    view = name;
    await present(VIEWS[name](S.year));
  }
  const CAPTION = {
    local:
      "<b>The observer's frame.</b> The horizon with a tick every 5°, and the meridian: the line from north through the zenith to south. A star is highest when it crosses the meridian. Every shaft and every “culmination” on this page is measured on that line.",
    equator:
      "<b>The frame of the turning sky.</b> The celestial equator and the pole it turns about, 29.98° up in the north: the latitude of Giza. Rings stand 1°, 2° and 5° from the pole. Stars inside the white circle never set.",
    ecliptic:
      "<b>The Sun's yearly path</b> for the year on the clock, tipped by that year's obliquity. Its four marked points are the equinoxes and solstices. Change the year and the spring point slides along the stars: that slide is the “age” in every Age-of-Leo claim. The Sun itself is not placed.",
    trail:
      "<b>The path of the pole.</b> The Earth's axis draws this loop among the stars once in about 25,800 years. Thuban sits beside the 3000 BC tick, Polaris beside AD 2000, Vega near AD 14,000. Drag the year: the pole walks its path.",
  };
  const TITLE = {
    local: "Horizon and meridian",
    equator: "Equator and pole",
    ecliptic: "Ecliptic and equinox points",
    trail: "The pole's path through 25,800 years",
  };
  function syncToggles() {
    const m = getStage()?.state.machine;
    $$("[data-machine]").forEach((b) =>
      b.setAttribute("aria-pressed", String(Boolean(m?.[b.dataset.machine]))),
    );
  }
  async function toggle(key, on) {
    const ok = await act(async (st, alive) => {
      st.setMachine(key === "trail" && on ? { trail: true, equator: true } : { [key]: on });
      syncToggles();
      if (on) {
        say("The sky machine", TITLE[key], CAPTION[key]);
        await look(key === "trail" ? "polepath" : "machine", st);
        if (!alive()) return;
      }
    });
    if (!ok) syncToggles();
  }
  async function allFrames() {
    await act(async (st) => {
      st.setMachine({ local: true, equator: true, ecliptic: true, trail: false });
      syncToggles();
      say(
        "The sky machine",
        "Three frames over one plateau",
        "Cyan: where you stand (horizon, meridian). Gold: how the sky turns (equator, pole). Violet: where the Sun travels (ecliptic). Three frames, three different planes: most sky claims about Giza quietly swap one for another.",
      );
      await look("machine", st, true);
    });
  }
  async function clearFrames() {
    await act((st) => {
      st.setMachine({ local: false, equator: false, ecliptic: false, trail: false });
      st.setRuler(null);
      syncToggles();
      rulerReadout();
    });
  }
  const EXPOSE = {
    north: { stop: "trails", year: -2559, culminate: "Kochab", back: 5 },
    today: { stop: "trails", year: 2026, culminate: "Kochab", back: 5 },
    south: { stop: "trailsouth", year: -2559, culminate: "Alnitak", back: 5 },
  };
  async function expose(kind) {
    const e = EXPOSE[kind];
    $$("[data-expose]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.expose === kind)),
    );
    await act(async (st, alive, status) => {
      view = null;
      const near = poleStar(e.year);
      say(
        "Long exposure",
        kind === "south"
          ? "Ten hours of the southern sky, 2560 BC"
          : `Ten hours round the pole, ${yearLabel(e.year)}`,
        kind === "south"
          ? "The camera holds still for ten sidereal hours. Orion's belt climbs out of the east, crosses the meridian 44.7° up and sinks west. Each streak is one star, coloured by its spectral class."
          : `The camera holds still for ten sidereal hours. Every star draws an arc round the pole. The tightest arc is <b>${esc(near.name)}</b>, ${near.d.toFixed(2)}° from the pole in ${yearLabel(e.year)}: ${kind === "north" ? "Khufu's pole star hardly moves" : "today the still point belongs to Polaris, and Thuban swings wide"}.`,
      );
      await present({
        stop: e.stop,
        light: "night",
        sky: { year: e.year, culminate: e.culminate },
      });
      if (!alive()) return;
      // start five hours before the culmination, so the star crosses the meridian mid-exposure
      st.setSky({ lst: st.state.lst - (e.back * 15.0410686 * Math.PI) / 180 });
      st.setMachine(kind === "south" ? { local: true } : { equator: true });
      syncToggles();
      status("EXPOSING / ten sidereal hours · press Stop motion to end it");
      const done = await st.exposure({ hours: 10, seconds: reduced() ? 0 : 26 });
      if (!alive()) return;
      status(
        done?.cancelled
          ? "EXPOSURE STOPPED / the trails stay until the camera moves"
          : "EXPOSURE DONE / the trails stay until the camera moves",
      );
    });
    $$("[data-expose]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }

  /* ------------------------------------------------ ruler */
  const starAt = (name, year) => {
    const s = data.stars[name];
    return moved(s.p, s.v, year);
  };
  function rulerReadout() {
    if (!data) return;
    const a = $("rulerA").value,
      b = $("rulerB").value;
    if (a === b) {
      $("rulerOut").textContent = "Pick two different stars.";
      return;
    }
    const now = separation(starAt(a, state.year), starAt(b, state.year)),
      j = separation(starAt(a, 2000), starAt(b, 2000)),
      d = now - j;
    $("rulerOut").innerHTML =
      `<b>${now.toFixed(3)}°</b> in ${yearLabel(state.year)} · ${j.toFixed(3)}° in AD 2000 · ` +
      (Math.abs(d) < 0.0005
        ? "no change you could measure"
        : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(3)}° from the stars' own motion`);
  }
  async function showRuler() {
    const a = $("rulerA").value,
      b = $("rulerB").value;
    rulerReadout();
    if (a === b) return;
    await act(async (st, alive) => {
      st.setRuler(a, b);
      const north = data.pole_stars.includes(a) && data.pole_stars.includes(b);
      say(
        "Angular ruler",
        `${a} to ${b}`,
        "A separation on the sky is an angle, not a length. Flying closer or changing the field of view changes its size on your screen and leaves the angle alone. The arc is a great circle between the two catalogue directions for the year on the clock.",
      );
      view = null;
      await present({
        stop: north ? "trails" : "machine",
        light: "night",
        sky: { year: st.state.year, culminate: a },
      });
      if (!alive()) return;
      st.setRuler(a, b);
    });
  }

  /* ------------------------------------------------ the pole's path */
  const POLE = { cx: 250, cy: 232, k: 430 };
  let poleBasis = null;
  function poleXY(d) {
    const { c, e1, e2 } = poleBasis,
      z = dot(d, c);
    return [POLE.cx + (dot(d, e1) / z) * POLE.k, POLE.cy - (dot(d, e2) / z) * POLE.k];
  }
  function poleStar(year) {
    const p = trailAt(data.trail, year);
    let best = null;
    for (const name of data.pole_stars) {
      const s = data.stars[name],
        d = poleDistance(p, s.p, s.v, year);
      if (!best || d < best.d) best = { name, d };
    }
    return best;
  }
  function drawPole() {
    const T = data.trail;
    if (!poleBasis) {
      let sum = [0, 0, 0];
      for (let i = 0; i < T.n; i++)
        sum = sum.map((c, k) => c + T.dirs[3 * i + k]);
      const c = norm(sum),
        up = [0, 1, 0],
        e2 = norm(up.map((u, k) => u - dot(up, c) * c[k])),
        e1 = cross(c, e2); // right hand of an observer looking up at the sky
      poleBasis = { c, e1, e2 };
    }
    let s = `<rect x="0" y="0" width="500" height="470" fill="#070d15" rx="6"/>`;
    for (let i = 0; i < T.n - 1; i++) {
      const y = T.y0 + i * T.step,
        a = poleXY(T.dirs.slice(3 * i, 3 * i + 3)),
        b = poleXY(T.dirs.slice(3 * i + 3, 3 * i + 6));
      s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${trailColour(y)}" stroke-width="${y <= 2100 ? 3 : 1.6}" stroke-linecap="round" opacity="${y <= 2100 ? 1 : 0.55}"/>`;
    }
    // labels are placed in order of importance; each tries a few spots and takes the first free one
    const boxes = [];
    const place = (x, y, text, { fill, bold = false, tiny = false, spots }) => {
      const w = text.length * (tiny ? 6.4 : 7.4) + 6,
        hgt = 14;
      for (const [dx, dy, anchor] of spots) {
        const tx = x + dx,
          ty = y + dy,
          x0 = anchor === "start" ? tx : anchor === "end" ? tx - w : tx - w / 2,
          box = [x0, ty - hgt + 3, x0 + w, ty + 4];
        if (box[0] < 2 || box[2] > 498 || box[1] < 22 || box[3] > 468) continue;
        if (boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]))
          continue;
        boxes.push(box);
        return `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" fill="${fill}"${bold ? ' font-weight="700"' : ""}${tiny ? ' class="tiny"' : ""}>${text}</text>`;
      }
      return "";
    };
    const around = (k) => [
      [k, -k + 2, "start"],
      [-k, -k + 2, "end"],
      [k, k + 8, "start"],
      [-k, k + 8, "end"],
      [0, -k - 6, "middle"],
      [0, k + 16, "middle"],
    ];
    const now = poleXY(trailAt(T, state.year));
    s += `<circle cx="${now[0].toFixed(1)}" cy="${now[1].toFixed(1)}" r="9" fill="none" stroke="${C.ink}" stroke-width="2"/><circle cx="${now[0].toFixed(1)}" cy="${now[1].toFixed(1)}" r="2.5" fill="${C.ink}"/>`;
    boxes.push([now[0] - 10, now[1] - 10, now[0] + 10, now[1] + 10]);
    // the pole's own label goes inside the loop, toward its middle
    const inward = norm([POLE.cx - now[0], POLE.cy - now[1], 0]);
    s += place(now[0] + inward[0] * 34, now[1] + inward[1] * 34 + 4, `pole of ${yearLabel(state.year)}`, {
      fill: C.ink,
      bold: true,
      spots: [
        [0, 0, inward[0] > 0.3 ? "start" : inward[0] < -0.3 ? "end" : "middle"],
        [0, 18, "middle"],
        [0, -18, "middle"],
      ],
    });
    for (const name of data.pole_stars) {
      const p = poleXY(norm(starAt(name, state.year)));
      s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${STAR_COL[name]}"/>`;
      boxes.push([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5]);
      s += place(p[0], p[1], name, { fill: STAR_COL[name], bold: true, spots: around(8) });
    }
    for (const [y, text] of calendarTicks(12000, 12000, 1000)) {
      const p = poleXY(trailAt(T, y)),
        out = norm([p[0] - POLE.cx, p[1] - POLE.cy, 0]);
      s += `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${(p[0] + out[0] * 7).toFixed(1)}" y2="${(p[1] + out[1] * 7).toFixed(1)}" stroke="${C.muted}"/>`;
      const n = parseInt(text.replace(/\D/g, ""), 10);
      if (n % 2000 === 0 || n === 1)
        s += place(p[0] + out[0] * 13, p[1] + out[1] * 13 + 4, text, {
          fill: C.muted,
          tiny: true,
          spots: [[0, 0, out[0] > 0.3 ? "start" : out[0] < -0.3 ? "end" : "middle"]],
        });
    }
    const ec = poleXY(poleBasis.c);
    s += `<path d="M${ec[0] - 5},${ec[1]}h10M${ec[0]},${ec[1] - 5}v10" stroke="${C.violet}"/><text x="${ec[0]}" y="${ec[1] + 18}" text-anchor="middle" fill="${C.violet}" class="tiny">middle of the loop</text>`;
    s += `<text x="12" y="16" fill="${C.muted}" class="tiny">The sky as you look up at it</text><text x="488" y="16" text-anchor="end" fill="${C.muted}" class="tiny">thick line: years the clock can reach</text>`;
    $("poleChart").innerHTML = s;
    // distance from the pole, year by year
    const X = (y) => 46 + ((y + 13000) / 25800) * 570,
      Y = (d) => 196 - (Math.min(d, 50) / 50) * 176;
    let g = "";
    for (let d = 0; d <= 50; d += 10)
      g += `<line x1="46" x2="616" y1="${Y(d)}" y2="${Y(d)}" stroke="${C.line}"/><text x="40" y="${Y(d) + 4}" text-anchor="end" fill="${C.muted}" class="tiny">${d}°</text>`;
    for (const [y, text] of calendarTicks(12000, 12000, 4000))
      if (text !== "AD 1")
        g += `<text x="${X(y)}" y="214" text-anchor="middle" fill="${C.muted}" class="tiny">${text}</text>`;
    g += `<rect x="${X(2100)}" y="20" width="${616 - X(2100)}" height="176" fill="#0a1119" opacity=".55"/>`;
    const marks = [];
    for (const name of data.pole_stars) {
      const st = data.stars[name];
      let pts = "",
        min = null;
      for (let i = 0; i < T.n; i++) {
        const y = T.y0 + i * T.step,
          d = poleDistance(T.dirs.slice(3 * i, 3 * i + 3), st.p, st.v, y);
        if (d <= 50) pts += `${X(y).toFixed(1)},${Y(d).toFixed(1)} `;
        else pts += "M ";
        if (!min || d < min.d) min = { y, d };
      }
      const d = pts
        .trim()
        .split(" M")
        .map((seg) => seg.trim())
        .filter((seg) => seg && seg !== "M")
        .map((seg) => "M" + seg.replace(/^M\s*/, "").replace(/ /g, " L"))
        .join(" ");
      g += `<path d="${d}" fill="none" stroke="${STAR_COL[name]}" stroke-width="2"/>`;
      // refine the minimum to the year
      let best = min;
      for (let y = min.y - 50; y <= min.y + 50; y++) {
        if (y < T.y0 || y > T.y0 + (T.n - 1) * T.step) continue;
        const dd = poleDistance(trailAt(T, y), st.p, st.v, y);
        if (dd < best.d) best = { y, d: dd };
      }
      poleMinima[name] = best;
      if (best.d < 9) marks.push({ name, ...best });
    }
    // name each closest pass; neighbours step up so that they do not sit on one another
    marks.sort((a, b) => a.y - b.y);
    let lastX = -1e9,
      level = 0;
    for (const m of marks) {
      const x = X(m.y);
      level = x - lastX < 96 ? (level + 1) % 3 : 0;
      lastX = x;
      const ty = Y(m.d) - 10 - level * 13;
      g += `<line x1="${x}" x2="${x}" y1="${Y(m.d) - 4}" y2="${ty + 3}" stroke="${STAR_COL[m.name]}" opacity=".5"/><circle cx="${x}" cy="${Y(m.d)}" r="3.5" fill="#070d15" stroke="${STAR_COL[m.name]}" stroke-width="2"/><text x="${x}" y="${ty}" text-anchor="middle" fill="${STAR_COL[m.name]}" class="tiny">${m.name} ${m.d.toFixed(2)}°</text>`;
    }
    g += `<line x1="${X(state.year)}" x2="${X(state.year)}" y1="20" y2="196" stroke="${C.ink}" stroke-width="1.5"/>`;
    $("poleCurves").innerHTML = g;
    const near = poleStar(state.year),
      th = data.stars.Thuban,
      po = data.stars.Polaris,
      p = trailAt(T, state.year);
    $("poleNear").textContent = near.name;
    $("poleThuban").textContent =
      poleDistance(p, th.p, th.v, state.year).toFixed(2) + "°";
    $("polePolaris").textContent =
      poleDistance(p, po.p, po.v, state.year).toFixed(2) + "°";
    const m = poleMinima;
    $("poleNote").textContent =
      `Closest passes in this model: Thuban ${m.Thuban.d.toFixed(2)}° in ${yearLabel(m.Thuban.y)}, Polaris ${m.Polaris.d.toFixed(2)}° in ${yearLabel(m.Polaris.y)}, Vega ${m.Vega.d.toFixed(1)}° in ${yearLabel(m.Vega.y)}. Vega is the brightest of them and the worst marker: seven Moon-widths off the still point at its best.`;
  }
  const poleMinima = {};
  function polePointer(e) {
    const svg = $("poleChart"),
      r = svg.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * 500,
      y = ((e.clientY - r.top) / r.height) * 470,
      T = data.trail;
    let best = null;
    for (let yr = -13000; yr <= 2100; yr += 10) {
      const p = poleXY(trailAt(T, yr)),
        d = Math.hypot(p[0] - x, p[1] - y);
      if (!best || d < best.d) best = { yr, d };
    }
    if (best.d < 60) setYear(best.yr);
  }

  /* ------------------------------------------------ shaft consensus */
  let consensus = null;
  const shaftList = () =>
    getShafts()?.map((s) => ({
      key: s.key,
      star: s.star,
      angle: s.gantenbrink_deg,
    }));
  const shaftRows = (year) =>
    shaftResiduals(data.trail, shaftList(), data.stars, year, data.latitude);
  function drawConsensus() {
    const shafts = getShafts();
    if (!shafts) return;
    if (!consensus)
      consensus = {
        ...shaftConsensus(data.trail, shaftList(), data.stars, {
          lat: data.latitude,
        }),
        khufu: shaftRows(-2559),
      };
    const X = (y) => 50 + ((y + 3600) / 2000) * 566,
      Y = (v) => 200 - (Math.min(v, 5) / 5) * 176;
    let s = "";
    for (let v = 0; v <= 5; v++)
      s += `<line x1="50" x2="616" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.line}"/><text x="44" y="${Y(v) + 4}" text-anchor="end" fill="${C.muted}" class="tiny">${v}°</text>`;
    for (let y = -3499; y <= -1699; y += 300)
      s += `<text x="${X(y)}" y="218" text-anchor="middle" fill="${C.muted}" class="tiny">${yearLabel(y)}</text>`;
    s += `<rect x="${X(-2588)}" y="24" width="${X(-2565) - X(-2588)}" height="176" fill="#e9bf7630"/><text x="${X(-2577)}" y="18" text-anchor="middle" fill="${C.gold}" class="tiny">Khufu's reign</text>`;
    s += `<path d="${consensus.curve.map(([y, v], i) => (i ? "L" : "M") + X(y).toFixed(1) + "," + Y(v).toFixed(1)).join(" ")}" fill="none" stroke="${C.cyan}" stroke-width="2.6"/>`;
    const b = consensus.best;
    s += `<circle cx="${X(b.year)}" cy="${Y(b.rms)}" r="5" fill="#070d15" stroke="${C.cyan}" stroke-width="2"/><text x="612" y="40" text-anchor="end" fill="${C.cyan}" font-weight="700">○ best single year: ${yearLabel(b.year)} · ${b.rms.toFixed(2)}° RMS</text>`;
    if (state.year >= -3600 && state.year <= -1600)
      s += `<line x1="${X(state.year)}" x2="${X(state.year)}" y1="24" y2="200" stroke="${C.ink}" stroke-width="1.5"/><text x="${X(state.year) - 5}" y="196" text-anchor="end" fill="${C.ink}" class="tiny">${yearLabel(state.year)}</text>`;
    $("consensusChart").innerHTML = s;
    const now = shaftRows(Math.max(-13000, Math.min(12800, state.year)));
    const bx = (d) => 330 + (Math.max(-4, Math.min(4, d)) / 4) * 250;
    let g = `<line x1="330" x2="330" y1="6" y2="${14 + now.rows.length * 30}" stroke="${C.muted}" stroke-dasharray="2 4"/>`;
    now.rows.forEach((r, i) => {
      const y = 24 + i * 30,
        col = SHAFT_COL[r.key];
      g +=
        `<text x="10" y="${y + 4}" fill="${col}" font-weight="700">${r.key} · ${r.star}</text>` +
        `<line x1="330" x2="${bx(r.d)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="5" stroke-linecap="round"/>` +
        `<text x="${r.d >= 0 ? bx(r.d) + 9 : bx(r.d) - 9}" y="${y + 4}" text-anchor="${r.d >= 0 ? "start" : "end"}" fill="${C.ink}">${r.d >= 0 ? "+" : "−"}${Math.abs(r.d).toFixed(2)}°</text>`;
    });
    g += `<text x="330" y="${26 + now.rows.length * 30}" text-anchor="middle" fill="${C.muted}" class="tiny">star too low ← shaft angle → star too high · ${yearLabel(state.year)} · ${now.rms.toFixed(2)}° RMS</text>`;
    $("consensusBars").innerHTML = g;
    $("consensusRms").textContent = b.rms.toFixed(2) + "°";
    $("consensusBest").textContent = yearLabel(b.year);
    $("consensusKhufu").textContent = consensus.khufu.rms.toFixed(2) + "°";
    $("consensusNote").textContent =
      `Asked for one year, the four shafts choose ${yearLabel(b.year)} and still miss by ${b.rms.toFixed(2)}° RMS (${b.rows.map((r) => `${r.star} ${r.d >= 0 ? "+" : "−"}${Math.abs(r.d).toFixed(2)}°`).join(", ")}). In 2560 BC the miss is ${consensus.khufu.rms.toFixed(2)}°. Half a degree is a full Moon's width: good enough to say the shafts point at those parts of the sky, not good enough to date the building.`;
  }

  /* ------------------------------------------------ survey microscope */
  const SQ_COL = { casing: C.gold, core: C.cyan, sockets: C.red };
  function drawSurvey() {
    if (!survey) return;
    const Z = state.zoom,
      side = 300,
      cx = 320,
      cy = 236,
      h = side / 2,
      ideal = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ]; // NW, NE, SE, SW on screen (north up)
    let s = `<rect x="${cx - h}" y="${cy - h}" width="${side}" height="${side}" fill="none" stroke="${C.muted}" stroke-dasharray="5 6"/>`;
    s += `<text x="${cx}" y="${cy - h - 34}" text-anchor="middle" fill="${C.muted}">N</text><line x1="${cx}" x2="${cx}" y1="${cy - h - 28}" y2="${cy - h - 8}" stroke="${C.muted}"/>`;
    let rows = "";
    for (const [key, sq] of Object.entries(survey.squares)) {
      const w = walkSquare(sq.lengths, sq.azimuths),
        px = side / w.mean; // screen pixels per inch at 1x
      rows += `<tr class="${state.squares.has(key) ? "" : "off"}"><td><i style="background:${SQ_COL[key]}"></i>${esc(sq.title)}</td><td>${sq.spread_in.toFixed(1)} in</td><td>${(w.worst * 25.4).toFixed(0)} mm</td><td>${arcmin(w.meanAzimuthArcsec)} W</td><td>${(w.closure * 25.4).toFixed(0)} mm</td></tr>`;
      if (!state.squares.has(key)) continue;
      const pts = w.offsets.map((o, i) => [
        cx + ideal[i][0] + o[0] * px * Z,
        cy + ideal[i][1] - o[1] * px * Z,
      ]);
      s += `<polygon points="${pts.map((p) => p.map((c) => c.toFixed(1)).join(",")).join(" ")}" fill="${SQ_COL[key]}" fill-opacity=".05" stroke="${SQ_COL[key]}" stroke-width="2.2" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => {
        s += `<line x1="${cx + ideal[i][0]}" y1="${cy + ideal[i][1]}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="${SQ_COL[key]}" opacity=".6"/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${SQ_COL[key]}"/>`;
      });
    }
    ["NW", "NE", "SE", "SW"].forEach((n, i) => {
      s += `<text x="${cx + ideal[i][0] * 1.0 + (ideal[i][0] < 0 ? -14 : 14)}" y="${cy + ideal[i][1] + (ideal[i][1] < 0 ? -10 : 18)}" text-anchor="middle" fill="${C.muted}" class="tiny">${n}</text>`;
    });
    // scale: how long 10 mm of error is at this magnification
    const bar = (10 / 25.4) * (side / 9068.8) * Z;
    s += `<line x1="24" x2="${24 + bar}" y1="448" y2="448" stroke="${C.ink}" stroke-width="2"/><text x="24" y="466" fill="${C.muted}" class="tiny">10 mm of error at ${Math.round(Z).toLocaleString("en-US")}×</text>`;
    s += `<text x="616" y="466" text-anchor="end" fill="${C.muted}" class="tiny">dashed: a perfect square · each survey against its own best fit</text>`;
    $("surveyScope").innerHTML = s;
    $("surveyRows").innerHTML = rows;
    $("surveyZoomOut").textContent = Math.round(Z).toLocaleString("en-US") + "×";
    const c = survey.squares.casing;
    $("surveyNote").textContent =
      `Walk Petrie's casing table round the base (four lengths, four bearings) and you come back ${c.closure_mm.toFixed(0)} mm from where you started, after ${(4 * c.mean_length * survey.inch_m).toFixed(0)} m: his table is consistent with itself. The worst corner stands ${c.worst_corner_mm.toFixed(0)} mm from a perfect square. The sockets miss by ${survey.squares.sockets.worst_corner_mm.toFixed(0)} mm, because they were cut at four different depths.`;
  }

  /* ------------------------------------------------ witnesses */
  function drawWitness() {
    const ind = atlas.independence;
    if (!ind) return;
    const byId = new Map(atlas.claims.map((c) => [c.id, c])),
      labels = new Map(ind.roots.map((r) => [r.key, r.label])),
      groups = witnessGroups(atlas.claims);
    const order = (g) => (g.key === "none" ? 2 : g.key === "sky_only" ? 1 : 0);
    groups.sort((a, b) => order(a) - order(b) || b.claims.length - a.claims.length);
    $("witnessGraph").innerHTML = groups
      .map(
        (g) =>
          `<div class="w-row${g.key === "none" || g.key === "sky_only" ? " w-off" : ""}${state.root === g.key ? " on" : ""}" data-root="${g.key}">
            <button class="w-label" data-root="${g.key}" aria-pressed="${state.root === g.key}"><b>${g.claims.length}</b> ${esc(labels.get(g.key) || g.key)}</button>
            <div class="w-dots">${g.claims
              .map((id) => {
                const c = byId.get(id);
                return `<button class="w-dot${c.modern_unit ? " unit" : ""}" data-claim="${id}" style="--g:${GRADE[c.number]}" title="${esc(c.title)} · ${c.number}${c.modern_unit ? " · needs the " + esc(c.modern_unit) : ""}" aria-label="${esc(c.title)}"></button>`;
              })
              .join("")}</div>
          </div>`,
      )
      .join("");
    $("wFacts").textContent = ind.facts_about_the_monuments;
    $("wClaims").textContent = ind.claims;
    $("wNone").textContent = ind.claims_on_no_measurement;
    $("wUnit").textContent = ind.claims_needing_a_modern_unit;
    $("wSlope").textContent = ind.largest_root_claims;
    $("witnessNote").textContent =
      `${ind.claims} claims rest on ${ind.facts_about_the_monuments} separate facts about the monuments. ${ind.largest_root_claims} of them are one fact, the Great Pyramid's slope, told ${ind.largest_root_claims} ways. ${ind.claims_on_no_measurement} use no measurement of Giza at all, and ${ind.claims_needing_a_modern_unit} need a unit the builders did not have. Of the ${ind.confirmed_claims} claims graded Confirmed, ${ind.confirmed_claims_on_no_measurement} are in that no-measurement group, and the rest stand on ${ind.facts_behind_confirmed_claims} facts.`;
  }

  /* ------------------------------------------------ wiring */
  function setYear(year) {
    state.year = year;
    renderCharts();
    onYear(year);
  }
  function renderCharts() {
    if (!data || disposed) return;
    drawPole();
    drawConsensus();
    rulerReadout();
  }
  $$("[data-machine]").forEach((b) =>
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      toggle(b.dataset.machine, on);
    }),
  );
  $("machineAll").addEventListener("click", allFrames);
  $("machineNone").addEventListener("click", clearFrames);
  $$("[data-expose]").forEach((b) =>
    b.addEventListener("click", () => expose(b.dataset.expose)),
  );
  $("machineStop").addEventListener("click", () => {
    token++;
    getStage()?.cancelTransition("User stopped motion");
    status("STOPPED / the trails stay until the camera moves");
  });
  $("rulerA").addEventListener("change", rulerReadout);
  $("rulerB").addEventListener("change", rulerReadout);
  $("rulerShow").addEventListener("click", showRuler);
  $$("[data-ruler]").forEach((b) =>
    b.addEventListener("click", () => {
      const [a, c] = b.dataset.ruler.split(",");
      $("rulerA").value = a;
      $("rulerB").value = c;
      showRuler();
    }),
  );
  let poleDown = false;
  $("poleChart").addEventListener("pointerdown", (e) => {
    poleDown = true;
    $("poleChart").setPointerCapture?.(e.pointerId);
    polePointer(e);
  });
  $("poleChart").addEventListener("pointermove", (e) => poleDown && polePointer(e));
  for (const ev of ["pointerup", "pointercancel"])
    $("poleChart").addEventListener(ev, () => {
      poleDown = false;
    });
  $("consensusChart").addEventListener("pointerdown", (e) => {
    const r = $("consensusChart").getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * 640,
      y = Math.round((-3600 + ((x - 50) / 566) * 2000) / 5) * 5;
    if (y >= -3600 && y <= -1600) setYear(y);
  });
  $("surveyZoom").addEventListener("input", () => {
    state.zoom = 10 ** Number($("surveyZoom").value);
    drawSurvey();
  });
  $$("[data-square]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.square,
        on = !state.squares.has(k);
      on ? state.squares.add(k) : state.squares.delete(k);
      b.setAttribute("aria-pressed", String(on));
      drawSurvey();
    }),
  );
  $("witnessGraph").addEventListener("click", (e) => {
    const dot = e.target.closest("[data-claim]");
    if (dot) return onClaim(dot.dataset.claim);
    const lab = e.target.closest("button[data-root]");
    if (!lab) return;
    state.root = state.root === lab.dataset.root ? null : lab.dataset.root;
    drawWitness();
    onRoot(state.root);
  });

  drawWitness();
  try {
    [data, survey] = await Promise.all([
      getJSON("assets/celestial-data.json"),
      getJSON("assets/survey.json"),
    ]);
    const names = Object.keys(data.stars).sort();
    for (const [id, pick] of [
      ["rulerA", "Alnitak"],
      ["rulerB", "Mintaka"],
    ])
      $(id).innerHTML = names
        .map((n) => `<option${n === pick ? " selected" : ""}>${n}</option>`)
        .join("");
    renderCharts();
    drawSurvey();
  } catch (e) {
    status("The sky machine's data could not load: " + e.message);
  }
  return {
    toggle,
    allFrames,
    clearFrames,
    expose,
    showRuler,
    /** Called by the page when the stage's year may have changed. */
    render() {
      const st = getStage();
      if (!st || disposed) return;
      syncToggles();
      if (st.state.year !== state.year) {
        state.year = st.state.year;
        renderCharts();
      }
    },
    setRoot(root) {
      state.root = root;
      drawWitness();
    },
    get data() {
      return data;
    },
    get survey() {
      return survey;
    },
    state,
    dispose() {
      token++;
      disposed = true;
    },
  };
}
