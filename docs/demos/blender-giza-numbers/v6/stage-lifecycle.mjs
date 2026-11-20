// SPDX-License-Identifier: GPL-3.0-or-later
/** Browser-independent lifecycle and catalogue helpers for the v5 stage. */
export async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readJSON(
  url,
  { fetcher = fetch, timeoutMs = 30000 } = {},
) {
  const controller = new AbortController();
  try {
    return await withTimeout(
      (async () => {
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok)
          throw new Error(`Could not load ${url}: HTTP ${response.status}`);
        return response.json();
      })(),
      timeoutMs,
      `Loading ${url} timed out.`,
    );
  } finally {
    controller.abort();
  }
}

/** Replacing or cancelling a transition always settles the displaced caller. */
export function createTransitionSlot(onChange = () => {}) {
  let active = null;
  const settle = (result) => {
    const previous = active;
    active = null;
    onChange(null);
    if (previous) previous.resolve(result);
    return Boolean(previous);
  };
  return {
    get active() {
      return active;
    },
    start(spec) {
      settle({ cancelled: true, reason: "superseded" });
      return new Promise((resolve) => {
        active = { ...spec, resolve };
        onChange(active);
      });
    },
    cancel(reason = "cancelled") {
      return settle({ cancelled: true, reason });
    },
    complete() {
      return settle({ cancelled: false });
    },
  };
}

const pointKey = (p) => `${p[0]},${p[1]},${p[2]}`;
/** Exact duplicate positions are emitted for halos by build_sky.py.
 * Reject missing/ambiguous mappings rather than guessing a nearby star.
 */
export function mapHaloCopies(core, halos) {
  const index = new Map();
  core.forEach((p, i) => {
    const key = pointKey(p);
    index.set(key, index.has(key) ? null : i);
  });
  return halos.map((p) => {
    const match = index.get(pointKey(p));
    if (match == null)
      throw new Error("A halo has no unique exact catalogue position.");
    return match;
  });
}

/** A fresh array is returned; J2000 catalogue baselines never accumulate drift. */
export function advanceCatalogue(baseline, movers, year) {
  if (!Number.isFinite(year)) throw new RangeError("Year must be finite.");
  const result = new Float64Array(baseline);
  for (const m of movers) {
    if (
      !Number.isSafeInteger(m.i) ||
      m.i < 0 ||
      3 * m.i + 2 >= baseline.length ||
      m.v.length !== 3 ||
      !m.v.every(Number.isFinite)
    ) {
      throw new RangeError("Invalid catalogue mover.");
    }
    for (let axis = 0; axis < 3; axis++)
      result[3 * m.i + axis] =
        baseline[3 * m.i + axis] + m.v[axis] * (year - 2000);
  }
  return result;
}

export function constellationPoints(positions, lines) {
  return lines.flatMap((line) =>
    line.slice(0, 2).map((i) => {
      if (!Number.isSafeInteger(i) || i < 0 || 3 * i + 2 >= positions.length)
        throw new RangeError("Invalid constellation index.");
      return Array.from(positions.slice(3 * i, 3 * i + 3));
    }),
  );
}

/** Screen-space label rectangle including its padding must remain in bounds. */
export function labelFits(x, y, width, height, viewWidth, viewHeight, pad = 5) {
  return (
    x - pad >= 0 &&
    y - height / 2 - pad >= 0 &&
    x + width + pad <= viewWidth &&
    y + height / 2 + pad <= viewHeight
  );
}

/** Reserve every grid cell touched by the padded text rectangle, atomically. */
export function reserveLabel(taken, x, y, width, height, pad = 3) {
  const firstCol = Math.floor((x - pad) / 46),
    lastCol = Math.floor((x + width + pad) / 46);
  const firstRow = Math.floor((y - height / 2 - pad) / 18),
    lastRow = Math.floor((y + height / 2 + pad) / 18);
  const cells = [];
  for (let row = firstRow; row <= lastRow; row++)
    for (let col = firstCol; col <= lastCol; col++) {
      const key = `${col}:${row}`;
      if (taken.has(key)) return false;
      cells.push(key);
    }
  cells.forEach((key) => taken.add(key));
  return true;
}
