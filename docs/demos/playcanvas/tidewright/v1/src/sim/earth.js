// Earthworks under an EARTH BUDGET: earth is moved, never created. Digging puts the spoil in the barrow; raising
// takes it from the barrow (a stroke raises less, or nothing, when the barrow runs short); the storm starts only
// when cut balances fill (the barrow is empty to within a cubic metre). Sandbags are bought, not dug: they raise one
// cell by a fixed height and are counted apart. Rock cannot be dug; the town cannot be touched.
import { MATERIALS } from './level.js';

export function createEarthworks(level) {
  const { nx, nz, dx } = level, A = dx * dx;
  const E = {
    bed: Float64Array.from(level.bed), b0: Float64Array.from(level.bed), bags: new Uint8Array(nx * nz),
    barrow: 0, cut: 0, fill: 0, bagsUsed: 0, strokes: [],
    get money() { return E.cut * level.costPerM3 + E.bagsUsed * level.sandbagCost; },
  };
  function footprint(x, z, R) {
    const out = [];
    const i0 = Math.max(0, Math.floor((x - R) / dx)), i1 = Math.min(nx - 1, Math.ceil((x + R) / dx));
    const j0 = Math.max(0, Math.floor((z - R) / dx)), j1 = Math.min(nz - 1, Math.ceil((z + R) / dx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(i * dx - x, j * dx - z);
      if (r <= R) out.push([j * nx + i, r <= 0.5 * dx ? 1 : 0.5 * (1 + Math.cos((Math.PI * r) / R))]);
    }
    return out;
  }
  /** One stroke: { tool: 'dig' | 'raise' | 'sandbag', x, z, radius (m), amount (m at the centre) }. Returns m^3 moved. */
  E.stroke = function (s) {
    E.strokes.push({ ...s });
    if (s.tool === 'sandbag') {
      const i = Math.round(s.x / dx), j = Math.round(s.z / dx), k = j * nx + i;
      if (i < 0 || j < 0 || i >= nx || j >= nz || !MATERIALS[level.mat[k]].raise || E.bags[k] || E.bagsUsed >= level.sandbags) return 0;
      E.bags[k] = 1; E.bagsUsed++; E.bed[k] += level.sandbagHeight;
      return level.sandbagHeight * A;
    }
    const fp = footprint(s.x, s.z, s.radius);
    if (s.tool === 'dig') {
      let v = 0;
      for (const [k, w] of fp) {
        if (!MATERIALS[level.mat[k]].dig || E.bags[k]) continue;
        const d = Math.min(s.amount * w, E.bed[k] - (E.b0[k] - 4));    // no deeper than 4 m below the original ground
        if (d <= 0) continue;
        E.bed[k] -= d; v += d * A;
      }
      E.barrow += v; E.cut += v;
      return v;
    }
    if (s.tool === 'raise') {
      let want = 0;
      for (const [k, w] of fp) if (MATERIALS[level.mat[k]].raise) want += s.amount * w * A;
      if (want <= 0 || E.barrow <= 0) return 0;
      const f = Math.min(1, E.barrow / want);
      let v = 0;
      for (const [k, w] of fp) { if (!MATERIALS[level.mat[k]].raise) continue; const d = s.amount * w * f; E.bed[k] += d; v += d * A; }
      E.barrow -= v; if (E.barrow < 0 && E.barrow > -1e-9) E.barrow = 0;
      E.fill += v;
      return v;
    }
    throw new Error('unknown tool ' + s.tool);
  };
  /** sum(b - b0) dx^2 + barrow - sandbags: zero when earth was only moved. */
  E.imbalance = function () { let s = 0; for (let k = 0; k < nx * nz; k++) s += E.bed[k] - E.b0[k]; return s * A + E.barrow - E.bagsUsed * level.sandbagHeight * A; };
  E.balanced = () => E.barrow <= 1.0;
  E.reset = function () { E.bed.set(E.b0); E.bags.fill(0); E.barrow = 0; E.cut = 0; E.fill = 0; E.bagsUsed = 0; E.strokes = []; };
  return E;
}

/** Apply a tape of strokes to a fresh earthworks: the deterministic plan the bot and the tests replay. */
export function applyPlan(level, strokes) { const E = createEarthworks(level); for (const s of strokes) E.stroke(s); return E; }
