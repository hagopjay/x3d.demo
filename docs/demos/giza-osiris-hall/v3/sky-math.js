/* Giza's bounded, precession-only sky model. No date-to-LST or solar ephemeris.
 * Matrices: the supplied ERFA ltpb samples, rounded to six decimal places.
 * Horizon/LHA conventions: https://aa.usno.navy.mil/faq/alt_az
 * Sidereal time: https://aa.usno.navy.mil/faq/GAST
 * Geometric versus apparent rising: https://aa.usno.navy.mil/faq/RST_defs
 * Astronomical year numbering example: https://aa.usno.navy.mil/faq/JD_formula
 * Interpolation removes century snapping; it does not add catalogue accuracy.
 */
(function (G) {
  'use strict';
  const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180, RAD = 180 / PI;
  const DEFAULT_LATITUDE = 29.9753;
  const finite = (n, label) => { if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(label + ' must be a finite number'); return n; };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const mod = (n, base) => ((n % base) + base) % base;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function unit(v, label = 'vector') {
    if (!v || v.length < 3) throw new TypeError(label + ' must have at least three components');
    const a = [finite(v[0], label), finite(v[1], label), finite(v[2], label)];
    const scale = Math.max(...a.map(Math.abs)); if (!(scale > 0)) throw new RangeError(label + ' has zero length');
    const scaled = a.map(x => x / scale), length = Math.hypot(...scaled);
    return scaled.map(x => x / length);
  }
  function latitude(value) { finite(value, 'latitude'); if (Math.abs(value) > 90) throw new RangeError('latitude must be within [-90, 90] degrees'); return value * DEG; }
  function formatYear(value) {
    finite(value, 'astronomical year'); const y = Math.round(value);
    if (!Number.isSafeInteger(y)) throw new RangeError('astronomical year is outside the safe integer range');
    return y >= 1 ? y + ' CE' : (1 - y) + ' BCE';
  }
  // Rounded rotation samples are projected back onto an orthonormal, right-
  // handed row basis before conversion to unit quaternions. Reject inputs that
  // are not already near rotations: this is not a generic matrix repair tool.
  function rotationRows(matrix) {
    if (!matrix || matrix.length !== 9) throw new TypeError('rotation matrix must have nine components');
    const m = Array.from(matrix, x => finite(x, 'matrix component'));
    const x = unit(m.slice(0, 3), 'rotation row');
    const rawY = m.slice(3, 6), projection = dot(rawY, x);
    const y = unit(rawY.map((v, i) => v - projection * x[i]), 'rotation row');
    const z = cross(x, y), corrected = [...x, ...y, ...z];
    if (dot(z, m.slice(6, 9)) <= 0 || corrected.some((v, i) => Math.abs(v - m[i]) > 5e-4)) throw new RangeError('matrix is not a near-proper rotation');
    return corrected;
  }
  function matrixQuaternion(matrix) {
    const m = rotationRows(matrix), trace = m[0] + m[4] + m[8]; let x, y, z, w;
    if (trace > 0) { const s = 2 * Math.sqrt(1 + trace); w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
    else if (m[0] > m[4] && m[0] > m[8]) { const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]); w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
    else if (m[4] > m[8]) { const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]); w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s; }
    else { const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]); w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4; }
    const length = Math.hypot(x, y, z, w); return [x / length, y / length, z / length, w / length];
  }
  function quaternionMatrix(q) {
    const [x, y, z, w] = q;
    return [1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w), 2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w), 2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)];
  }
  function slerp(a, b, t) {
    let target = b, cosine = a.reduce((sum, v, i) => sum + v * b[i], 0);
    if (cosine < 0) { cosine = -cosine; target = b.map(v => -v); }
    let q;
    if (cosine > 0.9995) q = a.map((v, i) => v + t * (target[i] - v));
    else { const theta = Math.acos(clamp(cosine, -1, 1)), d = Math.sin(theta); const p = Math.sin((1 - t) * theta) / d, r = Math.sin(t * theta) / d; q = a.map((v, i) => p * v + r * target[i]); }
    const length = Math.hypot(...q); return q.map(v => v / length);
  }
  function createModel(data) {
    if (!data || !Array.isArray(data.epochs) || !Array.isArray(data.mats) || data.epochs.length < 2 || data.epochs.length !== data.mats.length) throw new TypeError('matching epoch and matrix arrays are required');
    const epochs = data.epochs.map(v => finite(v, 'sample epoch'));
    if (epochs.some((v, i) => i && v <= epochs[i - 1])) throw new RangeError('sample epochs must increase strictly');
    const quaternions = data.mats.map(matrixQuaternion), minEpoch = epochs[0], maxEpoch = epochs[epochs.length - 1];
    return Object.freeze({ minEpoch, maxEpoch, sampleCount: epochs.length, method: 'SO(3) shortest-arc quaternion interpolation of rounded supplied samples',
      matrixAt(requestedEpoch, { outOfRange = 'clamp' } = {}) {
        finite(requestedEpoch, 'epoch'); if (!['clamp', 'error'].includes(outOfRange)) throw new RangeError('outOfRange must be clamp or error');
        const clamped = requestedEpoch < minEpoch || requestedEpoch > maxEpoch;
        if (clamped && outOfRange === 'error') throw new RangeError(`epoch must be within [${minEpoch}, ${maxEpoch}]`);
        const epoch = clamp(requestedEpoch, minEpoch, maxEpoch); let lo = 0, hi = epochs.length - 1;
        while (lo < hi) { const middle = (lo + hi) >>> 1; if (epochs[middle] < epoch) lo = middle + 1; else hi = middle; }
        const upper = lo, lower = epochs[upper] === epoch ? upper : upper - 1;
        const t = lower === upper ? 0 : (epoch - epochs[lower]) / (epochs[upper] - epochs[lower]);
        const q = lower === upper ? quaternions[lower] : slerp(quaternions[lower], quaternions[upper], t);
        return { matrix: quaternionMatrix(q), requestedEpoch, epoch, lowerEpoch: epochs[lower], upperEpoch: epochs[upper], t, clamped, interpolated: lower !== upper,
          nearestEpoch: t <= .5 ? epochs[lower] : epochs[upper], method: 'quaternion-slerp', sourceSampleYears: epochs[upper] - epochs[lower] };
      }
    });
  }
  function dated(vector, matrix) {
    const v = unit(vector); if (!matrix || matrix.length !== 9) throw new TypeError('rotation matrix must have nine components');
    const m = Array.from(matrix, x => finite(x, 'matrix component'));
    return unit([dot(m.slice(0, 3), v), dot(m.slice(3, 6), v), dot(m.slice(6, 9), v)]);
  }
  function equatorial(vector) { const v = unit(vector); return { ra: mod(Math.atan2(v[1], v[0]), TAU), dec: Math.asin(clamp(v[2], -1, 1)) }; }
  function horizontal(vector, lstHours, latitudeDeg = DEFAULT_LATITUDE) {
    finite(lstHours, 'local sidereal time'); const la = latitude(latitudeDeg), { ra, dec } = equatorial(vector), lst = mod(lstHours, 24);
    const hourAngle = mod(lst * PI / 12 - ra + PI, TAU) - PI;
    const east = -Math.cos(dec) * Math.sin(hourAngle), north = Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(hourAngle);
    const up = Math.sin(dec) * Math.sin(la) + Math.cos(dec) * Math.cos(la) * Math.cos(hourAngle);
    const azUndefined = Math.hypot(east, north) < 1e-12;
    return { alt: Math.asin(clamp(up, -1, 1)), az: azUndefined ? 0 : mod(Math.atan2(east, north), TAU), ra, dec, hourAngle, lstHours: lst, latitudeDeg, azUndefined };
  }
  function toXYZ(h, radius = 1) {
    const alt = finite(h?.alt, 'altitude'), az = finite(h?.az, 'azimuth'); finite(radius, 'radius');
    if (Math.abs(alt) > PI / 2 + 1e-12 || radius < 0) throw new RangeError('physical altitude and nonnegative radius required');
    return [Math.cos(alt) * Math.sin(az) * radius, Math.sin(alt) * radius, -Math.cos(alt) * Math.cos(az) * radius];
  }
  // Upper-meridian (upper culmination) altitude, in DEGREES.
  function meridianAltitude(decRadians, latitudeDeg = DEFAULT_LATITUDE) {
    finite(decRadians, 'declination'); latitude(latitudeDeg);
    if (Math.abs(decRadians) > PI / 2 + 1e-12) throw new RangeError('declination must be within [-pi/2, pi/2]');
    return 90 - Math.abs(latitudeDeg - decRadians * RAD);
  }
  // Geometric point-source crossing of a chosen flat horizon. No refraction,
  // disk radius, terrain, or date-to-civil-time conversion is supplied here.
  function rising(vector, latitudeDeg = DEFAULT_LATITUDE, horizonDeg = 0) {
    const la = latitude(latitudeDeg); finite(horizonDeg, 'horizon altitude');
    if (Math.abs(horizonDeg) > 90) throw new RangeError('horizon altitude must be within [-90,90] degrees');
    const { ra, dec } = equatorial(vector), a = Math.sin(la) * Math.sin(dec), b = Math.cos(la) * Math.cos(dec), threshold = Math.sin(horizonDeg * DEG);
    const common = { risingLST: null, settingLST: null, tangentLST: null, ra, dec, latitudeDeg, horizonDeg, transitLST: mod(ra * 12 / PI, 24), minAltitudeDeg: Math.asin(clamp(a - b, -1, 1)) * RAD, maxAltitudeDeg: Math.asin(clamp(a + b, -1, 1)) * RAD, geometric: true };
    const epsilon = 1e-12;
    if (Math.abs(b) < epsilon) return { ...common, status: Math.abs(a - threshold) <= epsilon ? 'grazes' : a > threshold ? 'always-above' : 'always-below', continuous: true };
    const c = (threshold - a) / b;
    if (c > 1 + epsilon) return { ...common, status: 'always-below' };
    if (c < -1 - epsilon) return { ...common, status: 'always-above' };
    if (Math.abs(Math.abs(c) - 1) <= epsilon) return { ...common, status: 'grazes', tangentLST: mod((ra + (c > 0 ? 0 : PI)) * 12 / PI, 24) };
    const hourAngle = Math.acos(clamp(c, -1, 1)), risingLST = mod((ra - hourAngle) * 12 / PI, 24), settingLST = mod((ra + hourAngle) * 12 / PI, 24);
    return { ...common, status: 'rises-and-sets', risingLST, settingLST, risingAzimuthDeg: horizontal(vector, risingLST, latitudeDeg).az * RAD, settingAzimuthDeg: horizontal(vector, settingLST, latitudeDeg).az * RAD };
  }
  function angularSeparation(a, b) { const x = unit(a), y = unit(b); return Math.atan2(Math.hypot(...cross(x, y)), clamp(dot(x, y), -1, 1)); }
  const LIMITATIONS = Object.freeze({
    model: 'precession-only orientation illustration using the supplied rounded catalogue and sampled matrices',
    siderealTime: 'LST is an explicit local sidereal orientation in hours; it is not civil time or a date-derived dawn calculation.',
    epoch: 'Astronomical year numbering: year 0 is 1 BCE; -10499 is 10500 BCE.',
    interpolation: 'SLERP removes nearest-century snapping. Intermediate accuracy against ERFA was not independently measured.',
    omitted: Object.freeze(['proper motion', 'nutation', 'aberration', 'parallax', 'atmospheric refraction', 'terrain horizon', 'solar ephemeris', 'UT1 and civil-time conversion']),
    solarPreset: 'LST 18 h can illustrate a geometric equinox sunrise orientation with solar RA 0 h and a flat horizon; it is not a computed observation time.',
    interpretation: 'This sky model cannot establish ancient construction intent or an archaeological alignment.'
  });
  const api = Object.freeze({ DEFAULT_LATITUDE, DEG, RAD, formatYear, createModel, dated, equatorial, horizontal, toXYZ, meridianAltitude, rising, angularSeparation, LIMITATIONS });
  G.GizaSky = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
