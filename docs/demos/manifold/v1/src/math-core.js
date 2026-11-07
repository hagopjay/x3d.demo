/* Analytic conformal metric and frozen-field RK4 geodesics. No dependencies.
 * prepare(sources) captures a source snapshot and compiles each rotated inverse
 * covariance once. Prepared snapshots are opaque and cannot be mutated.
 * Source angle rotates its local x axis counterclockwise in the x/z plane.
 * Metric: g = lambda^2 I. K is this metric's Gaussian curvature.
 */
(function (global) {
  'use strict';

  const snapshots = new WeakMap();
  const STRIDE = 7;

  function prepare(sources) {
    if (snapshots.has(sources)) return sources;
    let count = 0;
    for (let i = 0; i < sources.length; i++) if (sources[i].amp !== 0) count++;
    const data = new Float64Array(count * STRIDE);
    for (let i = 0, offset = 0; i < sources.length; i++) {
      const source = sources[i];
      if (source.amp === 0) continue;
      const c = Math.cos(source.angle || 0), s = Math.sin(source.angle || 0);
      const ix = 1 / (source.sx * source.sx), iz = 1 / (source.sz * source.sz);
      data[offset] = source.x;
      data[offset + 1] = source.z;
      data[offset + 2] = source.amp;
      data[offset + 3] = c * c * ix + s * s * iz;
      data[offset + 4] = c * s * (ix - iz);
      data[offset + 5] = s * s * ix + c * c * iz;
      data[offset + 6] = ix + iz;
      offset += STRIDE;
    }
    const snapshot = Object.freeze({ count });
    snapshots.set(snapshot, data);
    return snapshot;
  }

  function sample(x, z, sources) {
    const data = snapshots.get(prepare(sources));
    let lambda = 1, gx = 0, gz = 0, lap = 0;
    for (let i = 0; i < data.length; i += STRIDE) {
      const dx = x - data[i], dz = z - data[i + 1];
      const qx = data[i + 3] * dx + data[i + 4] * dz;
      const qz = data[i + 4] * dx + data[i + 5] * dz;
      const value = data[i + 2] * Math.exp(-0.5 * (dx * qx + dz * qz));
      lambda += value;
      gx -= value * qx;
      gz -= value * qz;
      lap += value * (qx * qx + qz * qz - data[i + 6]);
    }
    const l2 = lambda * lambda;
    const K = -(lap / lambda - (gx * gx + gz * gz) / l2) / l2;
    return { lambda, gx, gz, lap, K };
  }

  function trace(x, z, theta, sources, options = {}) {
    const step = options.step === undefined ? 0.11 : options.step;
    const count = options.count === undefined ? 200 : options.count;
    const bound = options.bound === undefined ? 11 : options.bound;
    if (!(step > 0 && Number.isFinite(step)) ||
        !(count >= 0 && Number.isFinite(count)) ||
        !(bound > 0 && Number.isFinite(bound))) {
      throw new RangeError('trace requires a positive finite step/bound and nonnegative finite count');
    }
    if (![x, z, theta].every(Number.isFinite) || Math.abs(x) > bound || Math.abs(z) > bound) return [];
    const data = snapshots.get(prepare(sources));
    const stages = new Float64Array(16);
    const points = [x, z];
    let tx = Math.cos(theta), tz = Math.sin(theta);

    // The integrator needs only lambda and its gradient: no Laplacian or K,
    // no source trigonometry, and no per-evaluation objects/arrays.
    function derivative(px, pz, ux, uz, offset) {
      let lambda = 1, gx = 0, gz = 0;
      for (let i = 0; i < data.length; i += STRIDE) {
        const dx = px - data[i], dz = pz - data[i + 1];
        const qx = data[i + 3] * dx + data[i + 4] * dz;
        const qz = data[i + 4] * dx + data[i + 5] * dz;
        const value = data[i + 2] * Math.exp(-0.5 * (dx * qx + dz * qz));
        lambda += value;
        gx -= value * qx;
        gz -= value * qz;
      }
      const ax = gx / lambda, az = gz / lambda;
      const dot = ax * ux + az * uz;
      stages[offset] = ux;
      stages[offset + 1] = uz;
      stages[offset + 2] = ax - dot * ux;
      stages[offset + 3] = az - dot * uz;
    }
    const half = step * 0.5, sixth = step / 6, iterations = Math.floor(count);
    for (let i = 0; i < iterations; i++) {
      derivative(x, z, tx, tz, 0);
      derivative(x + half * stages[0], z + half * stages[1], tx + half * stages[2], tz + half * stages[3], 4);
      derivative(x + half * stages[4], z + half * stages[5], tx + half * stages[6], tz + half * stages[7], 8);
      derivative(x + step * stages[8], z + step * stages[9], tx + step * stages[10], tz + step * stages[11], 12);
      const nx = x + sixth * (stages[0] + 2 * stages[4] + 2 * stages[8] + stages[12]);
      const nz = z + sixth * (stages[1] + 2 * stages[5] + 2 * stages[9] + stages[13]);
      if (!Number.isFinite(nx + nz) || Math.abs(nx) > bound || Math.abs(nz) > bound) break;
      tx += sixth * (stages[2] + 2 * stages[6] + 2 * stages[10] + stages[14]);
      tz += sixth * (stages[3] + 2 * stages[7] + 2 * stages[11] + stages[15]);
      const norm = Math.hypot(tx, tz);
      if (!(norm > 0 && Number.isFinite(norm))) break;
      tx /= norm;
      tz /= norm;
      x = nx;
      z = nz;
      points.push(x, z);
    }
    return points;
  }

  global.ManifoldMath = Object.freeze({ sample, trace, prepare });
})(typeof window !== 'undefined' ? window : globalThis);

