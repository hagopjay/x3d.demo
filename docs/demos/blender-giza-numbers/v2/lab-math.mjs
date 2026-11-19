// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure, unit-consistent models for the Pyramid Observatory.
 *
 * Geometry: an ideal right square pyramid, not a survey reconstruction.
 * Uncertainty: first-order covariance propagation for the INPUT B and H;
 * sigmas are user/model assumptions, not certified archaeological confidence.
 * In v1 H was derived from B and slope, so treating B and H as independent
 * would double-count part of the base uncertainty. Supply their covariance,
 * or work directly in base/slope coordinates, when reproducing that model.
 *
 * Solar position: spherical local horizontal coordinates from latitude,
 * declination and solar hour angle. No refraction, terrain horizon, calendar,
 * precession or equation-of-time conversion. Azimuth is clockwise from north;
 * hour angle is negative before local solar noon and positive afterwards.
 * NOAA conventions: https://gml.noaa.gov/grad/solcalc/azel.html
 *
 * WGS84 a and 1/f: https://earth-info.nga.mil/?action=wgs84&dir=wgs84
 * Latitude distance is along the ellipsoid meridian, not a datum transform.
 */

const DEG = Math.PI / 180;
const PHI = (1 + Math.sqrt(5)) / 2;

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function sigma(value, name) {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
  return value;
}

function correlation(rho) {
  finite(rho, "rho");
  if (Math.abs(rho) > 1) throw new RangeError("rho must be between -1 and 1");
  return rho;
}

function latitude(value, name) {
  finite(value, name);
  if (Math.abs(value) > 90)
    throw new RangeError(`${name} must be between -90 and 90 degrees`);
  return value;
}

/** All lengths use the input unit; area is the square base area. */
export function geometry(base, height) {
  positive(base, "base");
  positive(height, "height");
  const half = base / 2;
  const slant = Math.hypot(half, height);
  return {
    base,
    height,
    half,
    slant,
    volume: (base * base * height) / 3,
    area: base * base,
    lateralArea: 2 * base * slant,
    slopeDeg: Math.atan2(height, half) / DEG,
    seked: (7 * half) / height,
    pi: (2 * base) / height,
    tau: (4 * base) / height,
    phi: slant / half,
  };
}

function target(slopeDeg) {
  return Object.freeze({
    slopeDeg,
    heightForBase(base) {
      positive(base, "base");
      return (base / 2) * Math.tan(slopeDeg * DEG);
    },
  });
}

/** Alternative ideal geometries; numerical fits do not establish intent. */
export const targets = Object.freeze({
  seked: target(Math.atan(14 / 11) / DEG),
  pi: target(Math.atan(4 / Math.PI) / DEG),
  phi: target(Math.acos(1 / PHI) / DEG),
});

/** First-order standard deviations under an explicitly chosen B/H covariance. */
export function sensitivity(base, height, baseSigma, heightSigma, rho = 0) {
  const g = geometry(base, height);
  sigma(baseSigma, "baseSigma");
  sigma(heightSigma, "heightSigma");
  correlation(rho);
  // Cholesky form avoids a small negative variance from cancellation at rho=±1.
  const propagate = (dB, dH) =>
    Math.hypot(
      dB * baseSigma + dH * heightSigma * rho,
      dH * heightSigma * Math.sqrt(Math.max(0, 1 - rho * rho)),
    );
  const piSigma = propagate(2 / height, (-2 * base) / (height * height));
  return {
    piSigma,
    tauSigma: 2 * piSigma,
    phiSigma: propagate(
      (-4 * height * height) / (g.phi * base ** 3),
      (4 * height) / (g.phi * base * base),
    ),
  };
}

/** Geometric Sun; shadow is for a vertical unit-height gnomon on level ground. */
export function solarPosition(latitudeDeg, declinationDeg, hourAngleDeg) {
  const lat = latitude(latitudeDeg, "latitudeDeg") * DEG;
  const dec = latitude(declinationDeg, "declinationDeg") * DEG;
  const hour = finite(hourAngleDeg, "hourAngleDeg") * DEG;
  const east = -Math.cos(dec) * Math.sin(hour);
  const north =
    Math.cos(lat) * Math.sin(dec) -
    Math.sin(lat) * Math.cos(dec) * Math.cos(hour);
  const up =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(hour);
  const horizontal = Math.hypot(east, north);
  const altitudeDeg = Math.atan2(up, horizontal) / DEG;
  return {
    altitudeDeg,
    azimuthDeg:
      horizontal < 1e-14 ? null : (Math.atan2(east, north) / DEG + 360) % 360,
    shadowLengthFactor: up <= 1e-14 ? null : horizontal / up,
  };
}

/** Signed northward meridian distance in metres on the WGS84 ellipsoid. */
export function latitudeDelta(lat1, lat2) {
  latitude(lat1, "lat1");
  latitude(lat2, "lat2");
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const radius = (lat) =>
    (a * (1 - e2)) / (1 - e2 * Math.sin(lat * DEG) ** 2) ** 1.5;
  // Composite Simpson integration; local distances remain accurate at cm scale.
  // Degree differences are formed before conversion to avoid cancellation.
  const steps = Math.max(2, 2 * Math.ceil(Math.abs(lat2 - lat1)));
  const stepDeg = (lat2 - lat1) / steps;
  let sum = radius(lat1) + radius(lat2);
  for (let i = 1; i < steps; i++)
    sum += (i % 2 ? 4 : 2) * radius(lat1 + i * stepDeg);
  return (sum * stepDeg * DEG) / 3;
}

/**
 * Reproducible illustrative correlated Gaussian draws, returned as geometry().
 * Draws with nonpositive dimensions are rejected (a truncated distribution).
 * This is a sensitivity illustration; the input distribution is not evidence.
 */
export function seededSamples(
  n,
  seed,
  { base, height, baseSigma, heightSigma, rho = 0 },
) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000) {
    throw new RangeError("n must be an integer between 0 and 100000");
  }
  if (!Number.isSafeInteger(seed))
    throw new TypeError("seed must be a safe integer");
  geometry(base, height);
  sigma(baseSigma, "baseSigma");
  sigma(heightSigma, "heightSigma");
  correlation(rho);
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const orthogonal = Math.sqrt(Math.max(0, 1 - rho * rho));
  const result = [];
  for (let attempts = 0; result.length < n; attempts++) {
    if (attempts > 100 * n + 100)
      throw new RangeError(
        "Too many nonphysical samples; reduce assumed uncertainty",
      );
    const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
    const angle = 2 * Math.PI * uniform();
    const z1 = radius * Math.cos(angle);
    const z2 = radius * Math.sin(angle);
    const b = base + baseSigma * z1;
    const h = height + heightSigma * (rho * z1 + orthogonal * z2);
    if (b > 0 && h > 0) result.push(geometry(b, h));
  }
  return result;
}
