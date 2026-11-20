// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure mathematical instruments for the Sacred Geometry Atlas.
 *
 * These functions model an ideal right square pyramid and geometric pattern
 * comparisons. A small residual is not a probability of historical intention.
 * Distances from similarityFit are in the TARGET coordinate system's units.
 * No survey covariance, horizon refraction or historical chronology is inferred.
 */

const RAD = Math.PI / 180;
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

function vector(value, dimension, name) {
  if (
    (!Array.isArray(value) && !ArrayBuffer.isView(value)) ||
    value.length !== dimension
  ) {
    throw new TypeError(`${name} must contain ${dimension} finite coordinates`);
  }
  return Array.from(value, (component, index) =>
    finite(component, `${name}[${index}]`),
  );
}

function unit(value, name) {
  const v = vector(value, 3, name);
  const length = Math.hypot(...v);
  if (!(length > 0) || !Number.isFinite(length))
    throw new RangeError(`${name} must have finite nonzero length`);
  return v.map((component) => component / length);
}

const dot = (a, b) =>
  a.reduce((sum, component, index) => sum + component * b[index], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Lengths use the base unit; areas and volume use its square and cube. */
export function geometry(base, slopeDeg) {
  positive(base, "base");
  finite(slopeDeg, "slopeDeg");
  if (slopeDeg <= 0 || slopeDeg >= 90)
    throw new RangeError("slopeDeg must be strictly between 0 and 90 degrees");
  const half = base / 2;
  const slope = slopeDeg * RAD;
  const height = half * Math.tan(slope);
  const slant = Math.hypot(half, height);
  const result = {
    base,
    slopeDeg,
    height,
    half,
    slant,
    pi: (2 * base) / height,
    tau: (4 * base) / height,
    phi: slant / half,
    seked: (7 * half) / height,
    volume: (base * base * height) / 3,
    baseArea: base * base,
    lateralArea: 2 * base * slant,
  };
  if (!Object.values(result).every(Number.isFinite))
    throw new RangeError("Geometry exceeds finite numerical range");
  return result;
}

/** Ideal comparison hypotheses; they are not evidence of a builder's intent. */
export const IDEAL_SLOPES = Object.freeze({
  seked: Math.atan(14 / 11) / RAD,
  pi: Math.atan(4 / Math.PI) / RAD,
  phi: Math.acos(1 / PHI) / RAD,
});

/** Four models at one base, with a caller-selected reference slope. */
export function modelSweep(base, measuredSlopeDeg = 51 + 52 / 60) {
  const reference = geometry(base, measuredSlopeDeg);
  return [
    { key: "measured", label: "Reference slope", slope: measuredSlopeDeg },
    { key: "seked", label: "Seked 5½ palms", slope: IDEAL_SLOPES.seked },
    { key: "pi", label: "Exact π ratio", slope: IDEAL_SLOPES.pi },
    { key: "phi", label: "Exact φ ratio", slope: IDEAL_SLOPES.phi },
  ].map(({ key, label, slope }) => {
    const model = geometry(base, slope);
    return {
      key,
      label,
      ...model,
      heightDelta: model.height - reference.height,
    };
  });
}

/**
 * Horizontal section at fraction of apex height, 0 at base and 1 at apex.
 * Volume is an ideal full solid: no bedrock core, chambers or missing casing.
 */
export function crossSection(base, slopeDeg, fraction) {
  const model = geometry(base, slopeDeg);
  finite(fraction, "fraction");
  if (fraction < 0 || fraction > 1)
    throw new RangeError("fraction must be between 0 and 1");
  const remaining = 1 - fraction;
  const side = base * remaining;
  // The expanded expression retains small base-adjacent slices accurately.
  const fractionBelow = fraction * (3 - 3 * fraction + fraction * fraction);
  return {
    fraction,
    height: fraction * model.height,
    side,
    area: side * side,
    volumeBelow: fractionBelow * model.volume,
    volumeAbove: remaining ** 3 * model.volume,
    fractionBelow,
  };
}

/**
 * Least-squares 2D similarity fit for paired points, with correspondence fixed.
 *
 * Default: an orientation-preserving transform (proper rotation, scale > 0).
 * With {reflect:true}, negate source X BEFORE fitting rotation, scale and
 * translation. This explicitly fits the determinant-negative family; it never
 * silently chooses the more flattering handedness. Compare both fits yourself.
 *
 * rotationDeg is CCW in ordinary x-right/y-up coordinates. In screen y-down
 * coordinates its visual sense reverses. Residuals are target - transformed.
 * The RMS is sqrt(mean squared Euclidean residual), not a confidence measure.
 * Translation is applied after the optional reflection and scaled rotation.
 */
export function similarityFit(source, target, { reflect = false } = {}) {
  if (
    !Array.isArray(source) ||
    !Array.isArray(target) ||
    source.length !== target.length ||
    source.length < 2
  ) {
    throw new RangeError(
      "source and target need the same number of at least two paired points",
    );
  }
  if (typeof reflect !== "boolean")
    throw new TypeError("reflect must be a boolean");
  const src = source.map((point, index) =>
    vector(point, 2, `source[${index}]`),
  );
  const dst = target.map((point, index) =>
    vector(point, 2, `target[${index}]`),
  );
  const reflected = src.map(([x, y]) => [reflect ? -x : x, y]);
  const count = src.length;
  const mean = (points) =>
    points.reduce(
      (sum, point) => [sum[0] + point[0] / count, sum[1] + point[1] / count],
      [0, 0],
    );
  const sourceMean = mean(reflected),
    targetMean = mean(dst);
  const centeredSource = reflected.map(([x, y]) => [
    x - sourceMean[0],
    y - sourceMean[1],
  ]);
  const centeredTarget = dst.map(([x, y]) => [
    x - targetMean[0],
    y - targetMean[1],
  ]);
  let sourceScatter = 0,
    targetScatter = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < count; i++) {
    const [x, y] = centeredSource[i],
      [u, v] = centeredTarget[i];
    sourceScatter += x * x + y * y;
    targetScatter += u * u + v * v;
    a += x * u + y * v;
    b += x * v - y * u;
  }
  if (![sourceScatter, targetScatter, a, b].every(Number.isFinite))
    throw new RangeError("Point coordinates exceed finite fitting range");
  if (sourceScatter <= 0 || targetScatter <= 0)
    throw new RangeError("Coincident points do not determine a similarity fit");
  const covariance = Math.hypot(a, b);
  if (
    covariance <=
    Number.EPSILON * Math.sqrt(sourceScatter) * Math.sqrt(targetScatter)
  ) {
    throw new RangeError(
      "Zero cross-covariance does not determine a positive-scale similarity fit",
    );
  }
  const scale = covariance / sourceScatter;
  const angle = Math.atan2(b, a),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const rotationDeg = angle / RAD;
  const translation = [
    targetMean[0] - scale * (c * sourceMean[0] - s * sourceMean[1]),
    targetMean[1] - scale * (s * sourceMean[0] + c * sourceMean[1]),
  ];
  const transformed = reflected.map(([x, y]) => [
    scale * (c * x - s * y) + translation[0],
    scale * (s * x + c * y) + translation[1],
  ]);
  const residuals = transformed.map(([x, y], index) => {
    const dx = dst[index][0] - x,
      dy = dst[index][1] - y;
    return { index, dx, dy, distance: Math.hypot(dx, dy) };
  });
  const rms = Math.sqrt(
    residuals.reduce((sum, residual) => sum + residual.distance ** 2, 0) /
      count,
  );
  return {
    rotationDeg,
    scale,
    translation,
    rms,
    residuals,
    transformed,
    reflected: reflect,
  };
}

/** Separation in degrees; stable for nearly identical and antipodal directions. */
export function angularSeparation(a, b) {
  const u = unit(a, "a"),
    v = unit(b, "b");
  return Math.atan2(Math.hypot(...cross(u, v)), dot(u, v)) / RAD;
}

/**
 * Orthographic projection of unit sky directions onto a centre's tangent plane.
 * Points may contain catalogue distances: every input is normalized first.
 * Coordinates are dimensionless sines of angular offsets, not physical lengths.
 * Axes match the atlas sky frame: +Y celestial north; +X at RA 6h, +Z at RA 0h.
 * At a celestial pole RA is undefined; the deterministic fallback sets east +X.
 * A direction behind the tangent hemisphere is returned with visible=false.
 */
export function tangentPlane(points, centre) {
  if (!Array.isArray(points))
    throw new TypeError("points must be an array of directions");
  const normal = unit(centre, "centre");
  const rawEast = cross([0, 1, 0], normal);
  const east =
    Math.hypot(...rawEast) < 1e-12 ? [1, 0, 0] : unit(rawEast, "east");
  const north = unit(cross(normal, east), "north");
  const directions = points.map((point, index) =>
    unit(point, `points[${index}]`),
  );
  const depths = directions.map((direction) => dot(direction, normal));
  return {
    points: directions.map((direction) => [
      dot(direction, east),
      dot(direction, north),
    ]),
    depths,
    visible: depths.map((depth) => depth >= 0),
    basis: { east, north, centre: normal },
  };
}
