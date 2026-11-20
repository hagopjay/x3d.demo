// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure maths for the v6 sky machine. No DOM, no X_ITE: every function here is tested in node.
 * Frames and axes are those of sky-math.mjs: file axes (X, Y, Z) = equatorial (y, z, x), pole +Y;
 * the stage is X east, Y up, Z south; quaternions are [x, y, z, w].
 */
import {
  GIZA_LAT,
  qmul,
  qaxis,
  qconj,
  qrot,
  precessionQ,
  moved,
  culminationAltitude,
} from "./sky-math.mjs";

const RAD = Math.PI / 180;
const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angle between two directions in degrees. atan2 keeps its accuracy near 0 and near 180. */
export function separation(a, b) {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b)) / RAD;
}

/** Obliquity of date in degrees, from the table sampled by the build (linear between samples). */
export function obliquity(table, year) {
  const x = Math.max(
    0,
    Math.min(table.n - 1.000001, (year - table.y0) / table.step),
  );
  const i = Math.floor(x);
  return table.deg[i] + (table.deg[i + 1] - table.deg[i]) * (x - i);
}

/** The tilt that carries a pole-up frame to the stage at a latitude: the pole lands in the north at that altitude. */
export const equatorTilt = (lat = GIZA_LAT) => qaxis(1, 0, 0, (lat - 90) * RAD);

/**
 * Rotation of the ecliptic-of-date frame (ecliptic pole +Y, spring equinox +Z, longitude toward +X)
 * into the stage: tilt by the latitude, turn by the hour, tip by the obliquity about the equinox line.
 */
export function eclipticRotation(lst, oblDeg, lat = GIZA_LAT) {
  return qmul(
    equatorTilt(lat),
    qmul(qaxis(0, 1, 0, -lst), qaxis(0, 0, 1, oblDeg * RAD)),
  );
}

/** Where the celestial pole of a year stands among the J2000 stars (file axes, unit vector). */
export const poleJ2000 = (table, year) =>
  qrot(qconj(precessionQ(table, year)), [0, 1, 0]);

/** Where the spring equinox point of a year stands among the J2000 stars (file axes, unit vector). */
export const equinoxJ2000 = (table, year) =>
  qrot(qconj(precessionQ(table, year)), [0, 0, 1]);

/** n + 1 unit directions along the shorter great-circle arc from a to b. */
export function greatArc(a, b, n = 64) {
  a = norm(a);
  b = norm(b);
  const th = separation(a, b) * RAD,
    out = [];
  if (th < 1e-9) return Array.from({ length: n + 1 }, () => a.slice());
  const s = Math.sin(th);
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      wa = Math.sin((1 - t) * th) / s,
      wb = Math.sin(t * th) / s;
    out.push(norm([0, 1, 2].map((k) => a[k] * wa + b[k] * wb)));
  }
  return out;
}

/**
 * A ribbon along the arc from a to b for a TriangleStripSet: 2 (n + 1) points on a sphere of the
 * given radius, half a width of halfDeg on each side. Returns a flat array [x, y, z, x, y, z, ...].
 */
export function arcRibbon(a, b, { n = 64, halfDeg = 0.06, radius = 9000 } = {}) {
  const arc = greatArc(a, b, n);
  let axis = cross(norm(a), norm(b));
  if (Math.hypot(...axis) < 1e-9)
    axis = cross(norm(a), Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  axis = norm(axis);
  const t = Math.tan(halfDeg * RAD),
    out = [];
  for (const d of arc)
    for (const sgn of [1, -1]) {
      const p = norm([0, 1, 2].map((k) => d[k] + sgn * t * axis[k]));
      out.push(p[0] * radius, p[1] * radius, p[2] * radius);
    }
  return out;
}

/** Declination of date (degrees) of a J2000 position at a year, with its own space motion v. */
export function declinationOfDate(table, year, p, v = [0, 0, 0]) {
  const q = qrot(precessionQ(table, year), moved(p, v, year)),
    n = Math.hypot(q[0], q[1], q[2]);
  return Math.asin(q[1] / n) / RAD;
}

/**
 * Declination of date from the pole's own path: 90° minus the star's distance from the pole of that year.
 * Needs no precession matrix, only the table of pole directions the build wrote.
 */
export const declinationFromTrail = (trail, year, p, v = [0, 0, 0]) =>
  90 - separation(trailAt(trail, year), moved(p, v, year));

/**
 * The four shafts against one year. shafts: [{key, star, angle}], stars: {name: {p, v}}.
 * Each residual is the star's height on the meridian minus the shaft's angle, in degrees.
 */
export function shaftResiduals(trail, shafts, stars, year, lat = GIZA_LAT) {
  const rows = shafts.map((s) => {
    const st = stars[s.star],
      dec = declinationFromTrail(trail, year, st.p, st.v),
      alt = culminationAltitude(dec, lat);
    return { key: s.key, star: s.star, angle: s.angle, alt, d: alt - s.angle };
  });
  const rms = Math.sqrt(rows.reduce((a, r) => a + r.d * r.d, 0) / rows.length);
  return { year, rows, rms };
}

/** Scan a span of years; returns the curve and the single year where the four shafts fit best together. */
export function shaftConsensus(
  trail,
  shafts,
  stars,
  { from = -3600, to = -1600, step = 5, lat = GIZA_LAT } = {},
) {
  const curve = [];
  let best = null;
  for (let y = from; y <= to; y += step) {
    const r = shaftResiduals(trail, shafts, stars, y, lat);
    curve.push([y, r.rms]);
    if (!best || r.rms < best.rms) best = r;
  }
  // refine to the year
  for (let y = best.year - step; y <= best.year + step; y++) {
    const r = shaftResiduals(trail, shafts, stars, y, lat);
    if (r.rms < best.rms) best = r;
  }
  return { curve, best };
}

/** Distance of a star from the pole of a year, degrees. trailDir: the pole's J2000 direction for that year. */
export const poleDistance = (trailDir, p, v, year) =>
  separation(trailDir, moved(p, v, year));

/** Direction of the pole from the flat table the build wrote (linear between 50-year samples). */
export function trailAt(trail, year) {
  const x = Math.max(
      0,
      Math.min(trail.n - 1.000001, (year - trail.y0) / trail.step),
    ),
    i = Math.floor(x),
    t = x - i,
    d = trail.dirs;
  return norm([0, 1, 2].map((k) => d[3 * i + k] * (1 - t) + d[3 * i + 3 + k] * t));
}

/**
 * Walk Petrie's four sides (N, E, S, W: lengths, and azimuth errors in arcseconds, negative = west of
 * north) round from the north-west corner. Returns the corners (x east, y north), how far the walk
 * fails to close, and each corner's offset from the ideal square of the mean side and mean azimuth
 * that shares its centre.
 */
export function walkSquare(lengths, azimuthArcsec) {
  const order = ["N", "E", "S", "W"],
    heading = { N: 90, E: 180, S: 270, W: 0 }; // compass bearing of travel, clockwise from north
  const corners = [[0, 0]];
  let x = 0,
    y = 0;
  for (const k of order) {
    const b = (heading[k] + azimuthArcsec[k] / 3600) * RAD;
    x += lengths[k] * Math.sin(b);
    y += lengths[k] * Math.cos(b);
    corners.push([x, y]);
  }
  const closure = Math.hypot(x, y);
  const pts = corners.slice(0, 4); // NW, NE, SE, SW
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4,
    cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const mean = order.reduce((a, k) => a + lengths[k], 0) / 4,
    az = (order.reduce((a, k) => a + azimuthArcsec[k], 0) / 4 / 3600) * RAD,
    h = mean / 2;
  // ideal corners NW, NE, SE, SW, turned by the mean azimuth (clockwise positive)
  const ideal = [
    [-h, h],
    [h, h],
    [h, -h],
    [-h, -h],
  ].map(([u, v]) => [
    cx + u * Math.cos(az) + v * Math.sin(az),
    cy - u * Math.sin(az) + v * Math.cos(az),
  ]);
  const offsets = pts.map((p, i) => [p[0] - ideal[i][0], p[1] - ideal[i][1]]);
  return {
    corners: pts,
    ideal,
    offsets,
    closure,
    mean,
    meanAzimuthArcsec: order.reduce((a, k) => a + azimuthArcsec[k], 0) / 4,
    worst: Math.max(...offsets.map((o) => Math.hypot(o[0], o[1]))),
  };
}

/** Group claims by the one fact each rests on. Returns [{key, claims: [ids]}], biggest first. */
export function witnessGroups(claims) {
  const map = new Map();
  for (const c of claims) {
    const k = c.roots?.[0] || "unassigned";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c.id);
  }
  return [...map]
    .map(([key, ids]) => ({ key, claims: ids }))
    .sort((a, b) => b.claims.length - a.claims.length || (a.key < b.key ? -1 : 1));
}
