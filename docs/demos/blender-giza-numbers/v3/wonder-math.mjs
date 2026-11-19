// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure models for the v3 theatre: literal digit agreement, the Coincidence Engine and the eclipse sky.
 *
 * Literal agreement (review finding P1): two numbers agree to k digits when the first k significant
 * digits of their decimal mantissas are the same characters. 1079.57 and 1080 agree to 2 literal digits,
 * although they agree to 4 after rounding. Rounding agreement is reported separately and never coloured
 * as shared digits.
 *
 * Chance model: a quantity built from arbitrary units is close to log-uniform in its mantissa (Benford).
 * The chance that such a mantissa starts with the first d digits of a target t is
 * log10(1 + 10^(1-d) / T_d), where T_d is t cut to d significant digits. Multiplied by the number of tries,
 * this is the count of "discoveries" expected from nothing at all. It is a teaching model, not a p-value:
 * the tries are correlated (one slope drives many ratios) and the list of freedoms is ours.
 */

export const TARGETS = [
  { key: "pi", label: "π", value: Math.PI, note: "circle constant" },
  { key: "tau", label: "τ = 2π", value: 2 * Math.PI, note: "full turn" },
  { key: "phi", label: "φ", value: (1 + Math.sqrt(5)) / 2, note: "golden ratio" },
  { key: "e", label: "e", value: Math.E, note: "Euler's number" },
  { key: "sqrt2", label: "√2", value: Math.SQRT2, note: "diagonal of a square" },
  { key: "sqrt3", label: "√3", value: Math.sqrt(3), note: "height of a hexagon" },
  { key: "c", label: "c", value: 299792458, note: "light, m/s (exact SI)" },
  { key: "g", label: "g", value: 9.80665, note: "standard gravity, m/s²" },
  { key: "au", label: "1 AU", value: 149597870.7, note: "Earth–Sun, km (exact IAU)" },
  { key: "earth", label: "Earth radius", value: 6371.0088, note: "mean, km (IUGG)" },
  { key: "moon", label: "Moon distance", value: 384399, note: "mean, km" },
  { key: "year", label: "Year", value: 365.2422, note: "tropical, days" },
  { key: "alpha", label: "1/α", value: 137.035999, note: "fine-structure inverse (CODATA)" },
  { key: "avogadro", label: "Avogadro", value: 6.02214076e23, note: "exact SI" },
  { key: "planck", label: "Planck h", value: 6.62607015e-34, note: "exact SI" },
  { key: "golden_angle", label: "Golden angle", value: 137.50776, note: "degrees" },
];

const LENGTH_UNITS = [
  ["metres", 1], ["feet", 0.3048], ["yards", 0.9144], ["inches", 0.0254], ["royal cubits", 0.5236],
  ["miles", 1609.344], ["nautical miles", 1852], ["furlongs", 201.168], ["megalithic yards", 0.829],
];
// kilometres and hectares are left out: they only move the decimal point of metres and m², so they would
// count the same mantissa twice
const AREA_UNITS = [["m²", 1], ["ft²", 0.09290304], ["acre", 4046.8564224]];
const VOLUME_UNITS = [["m³", 1], ["ft³", 0.028316846592], ["cubic cubit", 0.5236 ** 3]];

/** Commonly cited, rounded dimensions: illustrative controls, not surveys. */
export const MONUMENTS = {
  great: { label: "Great Pyramid (Khufu)", base: 230.363, height: 230.363 / 2 * Math.tan((51 + 52 / 60) * Math.PI / 180), lat: 29.979175, lon: 31.134358, note: "Dash 2015 base, Petrie slope; WGS84 centre from v1" },
  khafre: { label: "Khafre's pyramid", base: 215.25, height: 143.5, lat: 29.9761, lon: 31.1308, note: "commonly cited original size" },
  menkaure: { label: "Menkaure's pyramid", base: 103.4, height: 65.5, lat: 29.9725, lon: 31.1283, note: "mean of 102.2 × 104.6 m; commonly cited" },
  red: { label: "Red Pyramid, Dahshur", base: 220, height: 105, lat: 29.8083, lon: 31.2061, note: "commonly cited, rounded" },
  louvre: { label: "Louvre Pyramid, Paris (1989)", base: 35.42, height: 21.64, lat: 48.861, lon: 2.3358, note: "commonly cited, rounded" },
};

/** First n significant digits of |x| as a string of digit characters. */
export function mantissaDigits(x, n = 12) {
  if (!Number.isFinite(x) || x === 0) return "";
  return Math.abs(x).toExponential(n - 1).split("e")[0].replace(".", "").replace("-", "");
}

/** Count of leading significant digits shared character for character. */
export function literalDigits(a, b, n = 12) {
  const x = mantissaDigits(a, n), y = mantissaDigits(b, n);
  let k = 0;
  while (k < x.length && x[k] === y[k]) k++;
  return k;
}

/** Largest k such that a and b round to the same k significant digits (the v1 measure). */
export function roundingDigits(a, b, max = 12) {
  let k = 0;
  for (let d = 1; d <= max; d++) {
    if (Number(Math.abs(a).toPrecision(d)) === Number(Math.abs(b).toPrecision(d))) k = d;
  }
  return k;
}

/** Chance that a log-uniform mantissa starts with the first d digits of t. */
export function chanceOfPrefix(t, d) {
  const m = Math.abs(t) / 10 ** Math.floor(Math.log10(Math.abs(t)));
  const cut = Math.floor(m * 10 ** (d - 1) + 1e-9) / 10 ** (d - 1);
  return Math.log10(1 + 10 ** (1 - d) / cut);
}

function pyramidQuantities(base, height) {
  const a = base / 2, slant = Math.hypot(height, a), edge = Math.hypot(height, base / Math.SQRT2);
  const lengths = [
    ["base side", base], ["height", height], ["twice the height", 2 * height], ["perimeter", 4 * base], ["half-base", a],
    ["slant height", slant], ["corner edge", edge], ["base diagonal", base * Math.SQRT2], ["all eight edges", 4 * base + 4 * edge],
  ];
  const areas = [["base area", base * base], ["face area (all four)", 2 * base * slant]];
  const volumes = [["volume", base * base * height / 3]];
  const faceSlope = Math.atan2(height, a), edgeSlope = Math.atan2(height, base / Math.SQRT2), apex = 2 * Math.atan2(a, slant);
  const angles = [["face slope", faceSlope], ["corner-edge slope", edgeSlope], ["apex angle of a face", apex]];
  return { lengths, areas, volumes, angles };
}

/**
 * Every number the engine tries for one monument, with a plain-English description.
 * opts: {units, inverses, ratios, site}
 */
export function candidates(m, opts = {}) {
  const o = { units: true, inverses: true, ratios: true, site: true, ...opts };
  const q = pyramidQuantities(m.base, m.height);
  const out = [];
  const push = (value, text, family) => {
    out.push({ value, text, family });
    if (o.inverses) out.push({ value: 1 / value, text: "1 ÷ (" + text + ")", family });
  };
  const lu = o.units ? LENGTH_UNITS : LENGTH_UNITS.slice(0, 1);
  const au = o.units ? AREA_UNITS : AREA_UNITS.slice(0, 1);
  const vu = o.units ? VOLUME_UNITS : VOLUME_UNITS.slice(0, 1);
  for (const [n, v] of q.lengths) for (const [u, s] of lu) push(v / s, `${n} in ${u}`, "length");
  for (const [n, v] of q.areas) for (const [u, s] of au) push(v / s, `${n} in ${u}`, "area");
  for (const [n, v] of q.volumes) for (const [u, s] of vu) push(v / s, `${n} in ${u}`, "volume");
  for (const [n, r] of q.angles) {
    push(r * 180 / Math.PI, `${n} in degrees`, "angle");
    if (o.units) push(r, `${n} in radians`, "angle");
  }
  if (o.ratios) {
    // ratios among base-only lengths (side, perimeter, half-base, diagonal) are fixed by the square itself
    // (√2, 4, 8 ...) and say nothing about the monument, so they are left out; so is height ÷ twice the height
    const baseOnly = new Set(["base side", "perimeter", "half-base", "base diagonal"]);
    const heightOnly = new Set(["height", "twice the height"]);
    for (let i = 0; i < q.lengths.length; i++)
      for (let j = 0; j < q.lengths.length; j++) {
        const [ni, nj] = [q.lengths[i][0], q.lengths[j][0]];
        if (i === j || (baseOnly.has(ni) && baseOnly.has(nj)) || (heightOnly.has(ni) && heightOnly.has(nj))) continue;
        out.push({ value: q.lengths[i][1] / q.lengths[j][1], text: `${q.lengths[i][0]} ÷ ${q.lengths[j][0]}`, family: "ratio" });
      }
  }
  if (o.site) {
    push(m.lat, "latitude in degrees", "site");
    push(m.lon, "longitude in degrees", "site");
  }
  return out;
}

/** Run the engine: every candidate against every target; matches need d literal digits. */
export function coincidenceRun(m, d = 4, opts = {}, targets = TARGETS) {
  const tries = candidates(m, opts);
  const hits = [];
  let expected = 0;
  for (const t of targets) {
    const p = chanceOfPrefix(t.value, d);
    expected += p * tries.length;
    for (const c of tries) {
      const k = literalDigits(c.value, t.value);
      if (k >= d) {
        const mc = Math.abs(c.value) / 10 ** Math.floor(Math.log10(Math.abs(c.value)));
        const mt = Math.abs(t.value) / 10 ** Math.floor(Math.log10(Math.abs(t.value)));
        hits.push({ ...c, target: t, digits: k, rel: (mc - mt) / mt });
      }
    }
  }
  hits.sort((a, b) => b.digits - a.digits || Math.abs(a.rel) - Math.abs(b.rel));
  return { tries: tries.length, comparisons: tries.length * targets.length, found: hits.length, expected, hits };
}

/* ---- the sky: Sun and Moon angular sizes (geocentric; topocentric adds up to about 1.7 % for the Moon) ---- */
export const SKY = {
  sunRadiusKm: 695700, // IAU 2015 nominal solar radius (a conversion constant)
  moonRadiusKm: 1737.4,
  sunPeriKm: 147.1e6, sunAphKm: 152.1e6, auKm: 149597870.7,
  moonPerigeeKm: 356400, moonApogeeKm: 406700, moonMeanKm: 384399,
  recessionCmPerYear: 3.8, // lunar laser ranging, present rate; extrapolated linearly here
  mileKm: 1.609344,
};

const arcmin = (radiusKm, distKm) => 2 * Math.atan(radiusKm / distKm) * 180 / Math.PI * 60;

/** Angular diameter ranges in arcminutes, with the Moon moved by `years` of linear recession. */
export function eclipseSky(years = 0) {
  const shift = SKY.recessionCmPerYear * years / 1e5; // km
  const sun = [arcmin(SKY.sunRadiusKm, SKY.sunAphKm), arcmin(SKY.sunRadiusKm, SKY.sunPeriKm)];
  const moon = [arcmin(SKY.moonRadiusKm, SKY.moonApogeeKm + shift), arcmin(SKY.moonRadiusKm, SKY.moonPerigeeKm + shift)];
  return { sun, moon, totalPossible: moon[1] > sun[0], annularPossible: moon[0] < sun[1], shiftKm: shift };
}

/** Years of linear recession until the Moon at perigee looks smaller than the Sun at aphelion. */
export function lastTotalEclipseYears() {
  const need = SKY.moonRadiusKm / Math.tan(arcmin(SKY.sunRadiusKm, SKY.sunAphKm) / 60 / 2 * Math.PI / 180);
  return (need - SKY.moonPerigeeKm) * 1e5 / SKY.recessionCmPerYear;
}
