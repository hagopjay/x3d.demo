// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A geometric sky instrument linked to the stage's catalogue and epoch.
 * The upper-hemisphere map uses an azimuthal equidistant projection: altitude
 * 90° is its centre, altitude 0° its rim. A ghost diamond at the rim preserves
 * the azimuth of an invisible star; it does not depict its negative altitude.
 * No independent catalogue, physical ephemeris, or distance accuracy is implied.
 */
import { altAz, qrot, skyRotation, yearLabel, GIZA_LAT } from "./sky-math.mjs";

const TAU = 2 * Math.PI;
const RAD = Math.PI / 180;
const STARS = [
  "Alnitak",
  "Alnilam",
  "Mintaka",
  "Sirius",
  "Thuban",
  "Kochab",
  "Regulus",
  "Polaris",
  "Betelgeuse",
  "Rigel",
  "Vega",
  "Mizar",
];
const BELT = ["Alnitak", "Alnilam", "Mintaka"];
const INK = "#f3efe2",
  GOLD = "#e9bf76",
  CYAN = "#74d3d9",
  MUTED = "#9fb0bd",
  VIOLET = "#b9a3f5";
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const finiteVector = (vector) =>
  Array.isArray(vector) &&
  vector.length === 3 &&
  vector.every(Number.isFinite) &&
  Math.hypot(...vector) > 0;
const fixed = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const local = (value) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
const svgText = (x, y, label, color = MUTED, extra = "") =>
  `<text x="${fixed(x, 2)}" y="${fixed(y, 2)}" fill="${color}" ${extra}>${esc(label)}</text>`;
const line = (x1, y1, x2, y2, color, extra = "") =>
  `<line x1="${fixed(x1, 2)}" y1="${fixed(y1, 2)}" x2="${fixed(x2, 2)}" y2="${fixed(y2, 2)}" stroke="${color}" ${extra}/>`;

/** Pure projection helper: [eastward pixel offset, northward pixel offset]. */
export function skyMapPoint(altitude, azimuth, radius = 148) {
  if (![altitude, azimuth, radius].every(Number.isFinite) || radius <= 0)
    throw new RangeError(
      "Finite altitude, azimuth and a positive radius are required.",
    );
  const r = (radius * (90 - altitude)) / 90;
  return [Math.sin(azimuth * RAD) * r, -Math.cos(azimuth * RAD) * r];
}

/**
 * Mount once; call render after stage epoch or sidereal-time changes.
 * requestStage must resolve to the stage, or make it available through getStage.
 */
export function createCelestialLens({ host, getStage, requestStage }) {
  if (
    !host ||
    typeof getStage !== "function" ||
    typeof requestStage !== "function"
  )
    throw new TypeError("A host, getStage and requestStage are required.");
  let disposed = false,
    loading = false,
    selected = "Alnitak",
    last = "",
    error = "";
  host.classList.add("celestial-lens");
  host.innerHTML = `
    <style>
      .celestial-lens{min-width:0;color:var(--ink,#f3efe2)}
      .celestial-lens .cl-top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
      .celestial-lens .cl-top label{display:flex;gap:10px;align-items:center;font:11px var(--mono,monospace);color:var(--muted,#9fb0bd)}
      .celestial-lens .cl-top select{max-width:180px;font-size:12px}
      .celestial-lens .cl-load{border:1px solid #5e7391;background:#152333;color:#f3efe2;border-radius:5px;padding:7px 10px;font:11px var(--mono,monospace)}
      .celestial-lens .cl-epoch{font:10px var(--mono,monospace);color:#e9bf76;letter-spacing:.06em}
      .celestial-lens .cl-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(170px,.85fr);gap:18px;align-items:center}
      .celestial-lens svg{display:block;width:100%;height:auto;overflow:hidden}
      .celestial-lens svg text{font-family:var(--mono,monospace);font-size:10px}
      .celestial-lens .cl-map{background:radial-gradient(ellipse at 50% 48%,#172c3b,#090f1a 70%);border:1px solid #263b4d;border-radius:8px}
      .celestial-lens .cl-values{display:grid;gap:9px;margin:0 0 17px;font:10px var(--mono,monospace)}
      .celestial-lens .cl-values div{display:flex;justify-content:space-between;gap:12px;padding-bottom:7px;border-bottom:1px solid #263b4d}
      .celestial-lens .cl-values dt{color:#9fb0bd}.celestial-lens .cl-values dd{margin:0;color:#f3efe2;text-align:right}
      .celestial-lens .cl-stars{display:flex;gap:5px;flex-wrap:wrap;margin:12px 0}
      .celestial-lens .cl-star{font:9px var(--mono,monospace);padding:3px 5px;border:1px solid #344c5a;border-radius:3px;color:#74d3d9}
      .celestial-lens .cl-star.cl-below{border-style:dashed;color:#7e8e9d;opacity:.8}
      .celestial-lens .cl-star[aria-pressed=true]{color:#e9bf76;border-color:#e9bf76;background:#2a281e}
      .celestial-lens .cl-note{color:#9fb0bd;font:10px/1.65 var(--mono,monospace);margin:10px 0 0}
      .celestial-lens .cl-status{font:11px/1.65 var(--sans,system-ui);color:#9fb0bd;min-height:1.65em;margin:8px 0}
      .celestial-lens .cl-subhead{font:9px var(--mono,monospace);letter-spacing:.1em;text-transform:uppercase;color:#b9a3f5;border-top:1px solid #263b4d;padding-top:13px}
      @media(max-width:700px){.celestial-lens .cl-layout{grid-template-columns:1fr}.celestial-lens .cl-map{max-width:460px;margin:0 auto}.celestial-lens .cl-values{grid-template-columns:1fr 1fr;gap:9px 20px}.celestial-lens .cl-values div{display:block}.celestial-lens .cl-values dd{text-align:left;margin-top:4px}.celestial-lens .cl-top{gap:9px}}
    </style>
    <div class="cl-top"><label>Track star <select aria-label="Star to track in the celestial lens">${STARS.map((name) => `<option>${name}</option>`).join("")}</select></label><span class="cl-epoch">GEOMETRIC SKY / GIZA</span><button type="button" class="cl-load">Load stellar instrument</button></div>
    <p class="cl-status" role="status">Load the catalogue to link this instrument to the 3D sky.</p>
    <div class="cl-layout"><svg class="cl-map" viewBox="0 0 400 400" role="img" aria-label="Polar map of the sky at Giza, north up and east right"></svg><div><dl class="cl-values"></dl><p class="cl-subhead">Orion’s belt / catalogue depth</p><svg class="cl-depth" viewBox="0 0 320 180" role="img" aria-label="Catalogue estimated distances to the three stars of Orion's belt"></svg></div></div>
    <div class="cl-stars" role="group" aria-label="Key star altitude and visibility"></div>
    <p class="cl-note">Map: zenith at centre; horizon at rim; north up, east right. The selected star’s curve spans one sidereal turn. Faded rim diamonds preserve only the azimuth of stars below the horizon. No refraction or local terrain horizon. Distances are catalogue estimates; the baked Sun and Moon are stage lights, not ephemerides.</p>`;

  const select = host.querySelector("select"),
    load = host.querySelector(".cl-load");
  const status = host.querySelector(".cl-status"),
    map = host.querySelector(".cl-map");
  const values = host.querySelector(".cl-values"),
    depth = host.querySelector(".cl-depth");
  const stars = host.querySelector(".cl-stars"),
    epoch = host.querySelector(".cl-epoch");
  const stageReady = (stage) =>
    !!(stage?.state?.skyData && typeof stage.starVector === "function");
  function vectorOf(stage, name) {
    try {
      const vector = stage.starVector(name, stage.state.year);
      return finiteVector(vector) ? vector : null;
    } catch {
      return null;
    }
  }
  function mapBase() {
    let content = `<circle cx="200" cy="200" r="148" fill="#0d1b28" stroke="#51707e" stroke-width="1.4"/>`;
    for (const altitude of [30, 60])
      content += `<circle cx="200" cy="200" r="${(148 * (90 - altitude)) / 90}" fill="none" stroke="#294553" stroke-dasharray="3 5"/>`;
    for (let az = 0; az < 360; az += 30) {
      const [x, y] = skyMapPoint(0, az),
        [x2, y2] = skyMapPoint(4, az);
      content += line(200 + x, 200 + y, 200 + x2, 200 + y2, "#53717c");
      if (az % 90)
        content += svgText(
          200 + Math.sin(az * RAD) * 168,
          204 - Math.cos(az * RAD) * 168,
          az + "°",
          "#627b89",
          'text-anchor="middle" style="font-size:8px"',
        );
    }
    content +=
      line(52, 200, 348, 200, "#243b48") + line(200, 52, 200, 348, "#243b48");
    for (const [name, x, y] of [
      ["N", 200, 27],
      ["E", 374, 204],
      ["S", 200, 382],
      ["W", 26, 204],
    ])
      content += svgText(
        x,
        y,
        name,
        CYAN,
        'text-anchor="middle" style="font-size:13px"',
      );
    content +=
      svgText(205, 103, "30°", MUTED, 'style="font-size:8px"') +
      svgText(205, 154, "60°", MUTED, 'style="font-size:8px"');
    content +=
      `<circle cx="200" cy="200" r="2" fill="#9fb0bd"/>` +
      svgText(207, 214, "ZENITH", MUTED, 'style="font-size:7px"');
    return content;
  }
  function drawDepth(stage) {
    const distances = BELT.map((name) => [
      name,
      Math.hypot(...(vectorOf(stage, name) || [NaN])),
    ]);
    const maximum = Math.max(
      2000,
      ...distances.map(([, distance]) =>
        Number.isFinite(distance) ? distance : 0,
      ),
    );
    const x = (distance) => 76 + (distance / maximum) * 222;
    let content = "";
    for (let i = 0; i < 4; i++) {
      const distance = (maximum * i) / 3;
      content +=
        line(x(distance), 17, x(distance), 139, "#233b49") +
        svgText(
          x(distance),
          158,
          local(distance),
          MUTED,
          'text-anchor="middle" style="font-size:8px"',
        );
    }
    distances.forEach(([name, distance], index) => {
      const y = 35 + index * 42,
        color = index === 1 ? VIOLET : CYAN;
      content += svgText(1, y + 4, name, INK, 'style="font-size:10px"');
      if (Number.isFinite(distance))
        content +=
          line(
            76,
            y,
            x(distance),
            y,
            color,
            'stroke-width="5" stroke-linecap="round"',
          ) +
          `<circle cx="${fixed(x(distance), 2)}" cy="${y}" r="4" fill="${color}"/>` +
          svgText(
            Math.min(310, x(distance)),
            y - 9,
            local(distance) + " ly",
            color,
            'text-anchor="end" style="font-size:9px"',
          );
    });
    content += svgText(
      298,
      176,
      "LIGHT-YEARS",
      MUTED,
      'text-anchor="end" style="font-size:8px"',
    );
    depth.innerHTML = content;
  }
  function render() {
    if (disposed) return;
    const stage = getStage();
    if (!stageReady(stage)) {
      load.hidden = false;
      load.disabled = loading;
      load.textContent = loading
        ? "Loading catalogue…"
        : "Load stellar instrument";
      status.textContent =
        error ||
        (loading
          ? "Starting the local catalogue and stellar stage…"
          : "Load the catalogue to link this instrument to the 3D sky.");
      if (!last) {
        map.innerHTML =
          mapBase() +
          svgText(
            200,
            247,
            "CATALOGUE NOT LOADED",
            GOLD,
            'text-anchor="middle" style="font-size:8px"',
          );
        depth.innerHTML = svgText(
          160,
          85,
          "Catalogue distances appear here",
          MUTED,
          'text-anchor="middle"',
        );
      }
      last = "";
      return;
    }
    load.hidden = true;
    const S = stage.state,
      signature = [S.year, S.lst, selected].join("|");
    if (signature === last) return;
    last = signature;
    epoch.textContent = yearLabel(S.year) + " / GIZA 29.979° N";
    const selectedVector = vectorOf(stage, selected);
    let content = mapBase(),
      current = null;
    if (selectedVector) {
      let segment = [];
      const finish = () => {
        if (segment.length > 1)
          content += `<path d="${segment.map((p, index) => (index ? "L" : "M") + fixed(p[0], 2) + "," + fixed(p[1], 2)).join(" ")}" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity=".7"/>`;
        segment = [];
      };
      for (let i = 0; i <= 240; i++) {
        const R = skyRotation(
            S.skyData.precession,
            S.year,
            S.lst + (i / 240) * TAU,
            GIZA_LAT,
          ),
          horizontal = altAz(qrot(R, selectedVector));
        if (horizontal.alt >= 0) {
          const [x, y] = skyMapPoint(horizontal.alt, horizontal.az);
          segment.push([200 + x, 200 + y]);
        } else finish();
      }
      finish();
      current = altAz(qrot(S.R, selectedVector));
    }
    const readings = [],
      taken = [];
    for (const name of STARS) {
      const vector = vectorOf(stage, name);
      if (!vector) continue;
      const coordinate = altAz(qrot(S.R, vector)),
        above = coordinate.alt >= 0,
        isSelected = name === selected;
      readings.push({ name, ...coordinate, above });
      const [dx, dy] = skyMapPoint(above ? coordinate.alt : -5, coordinate.az),
        x = 200 + dx,
        y = 200 + dy;
      const color = isSelected ? GOLD : above ? CYAN : "#687c8e";
      if (above) {
        content += `<circle cx="${fixed(x, 2)}" cy="${fixed(y, 2)}" r="${isSelected ? 5 : 2.8}" fill="${color}" opacity="${isSelected ? 1 : 0.9}"><title>${esc(name)}: altitude ${fixed(coordinate.alt)}°, azimuth ${fixed(coordinate.az)}°</title></circle>`;
        if (isSelected)
          content += `<circle cx="${fixed(x, 2)}" cy="${fixed(y, 2)}" r="10" fill="none" stroke="${GOLD}" opacity=".7"/>`;
        // Labels occupy measured rows; displaced labels remain within the viewBox.
        const width = Math.min(84, name.length * 5.6),
          candidateX = x > 255 ? x - width - 8 : x + 8;
        const labelX = Math.max(32, Math.min(368 - width, candidateX));
        const options = [y - 8, y + 14, y - 23, y + 29];
        const labelY = options.find(
          (py) =>
            py > 42 &&
            py < 359 &&
            !taken.some(
              (box) =>
                labelX < box.x + box.w &&
                labelX + width > box.x &&
                py - 9 < box.y + 11 &&
                py + 2 > box.y - 9,
            ),
        );
        if (labelY != null) {
          taken.push({ x: labelX, y: labelY, w: width });
          content += svgText(
            labelX,
            labelY,
            name,
            color,
            'style="font-size:8px"',
          );
        }
      } else
        content += `<path d="M${fixed(x, 2)},${fixed(y - 3, 2)}l3,3 -3,3 -3,-3Z" fill="none" stroke="${color}"><title>${esc(name)} is below horizon: ${fixed(coordinate.alt)}°; diamond shows azimuth only</title></path>`;
    }
    content += svgText(
      200,
      365,
      "FULL SIDEREAL TURN · SELECTED STAR",
      GOLD,
      'text-anchor="middle" style="font-size:7px"',
    );
    map.innerHTML = content;
    if (current) {
      const distance = Math.hypot(...selectedVector),
        rows = [
          ["TRACKING", selected],
          ["ALTITUDE", fixed(current.alt, 2) + "°"],
          ["AZIMUTH", fixed(current.az, 2) + "°"],
          ["CATALOGUE DISTANCE", local(distance) + " ly"],
        ];
      values.innerHTML = rows
        .map(
          ([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`,
        )
        .join("");
      status.textContent =
        error ||
        `${selected} is ${current.alt >= 0 ? "above" : "below"} the geometric horizon. Azimuth runs clockwise from north.`;
    } else {
      values.innerHTML = "";
      status.textContent =
        "The selected name is not present in the loaded catalogue.";
    }
    stars.innerHTML = readings
      .map(
        (reading) =>
          `<button type="button" class="cl-star${reading.above ? "" : " cl-below"}" data-star="${esc(reading.name)}" aria-pressed="${reading.name === selected}" title="${esc(reading.name)}: altitude ${fixed(reading.alt, 2)}°, azimuth ${fixed(reading.az, 2)}°">${esc(reading.name)} ${fixed(reading.alt)}°${reading.above ? "" : " ↓"}</button>`,
      )
      .join("");
    drawDepth(stage);
  }
  async function activate(name, culminate) {
    if (disposed) return;
    selected = name;
    select.value = name;
    last = "";
    error = "";
    const stage = getStage();
    if (culminate && stageReady(stage)) {
      try {
        stage.setSky({ culminate: name });
      } catch (cause) {
        error = "Could not move the sky: " + cause.message;
      }
    }
    render();
  }
  const onSelect = () => activate(select.value, true);
  const onStars = (event) => {
    const button = event.target.closest("button[data-star]");
    if (button && stars.contains(button)) activate(button.dataset.star, true);
  };
  const onLoad = async () => {
    if (loading || disposed) return;
    loading = true;
    error = "";
    render();
    try {
      const stage = await requestStage();
      if (stage?.skyReady) await stage.skyReady;
      if (!stageReady(getStage()))
        throw new Error(
          "The catalogue is unavailable; analytical geometry remains usable.",
        );
    } catch (cause) {
      error = "The stellar instrument could not load: " + cause.message;
    } finally {
      loading = false;
      last = "";
      render();
    }
  };
  select.addEventListener("change", onSelect);
  stars.addEventListener("click", onStars);
  load.addEventListener("click", onLoad);
  render();
  return {
    render,
    dispose() {
      disposed = true;
      select.removeEventListener("change", onSelect);
      stars.removeEventListener("click", onStars);
      load.removeEventListener("click", onLoad);
    },
  };
}
