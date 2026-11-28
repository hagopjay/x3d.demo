// The analytic ladder as data: each gate runs its case (and its wrong twins) and judges every metric against
// tests/limits.json. A twin is caught when at least one of the gate's metrics fails for it (or is not finite).
// Used by tests/ladder.test.mjs and tools/ladder-receipt.mjs.
import { CASES } from './ladder.js';
import { runCase } from './ladder-run.js';

export function judge(rule, limit, observed) {
  if (typeof observed !== 'number' || !Number.isFinite(observed)) return false;
  return rule === 'at most' ? observed <= limit : observed >= limit;
}

const TWIN_OPTS = {
  naive: { scheme: 'naive' },
  hllNoBranches: { twins: { hllNoBranches: true } }, pressureTypo: { twins: { pressureTypo: true } },
  zeroFilms: { twins: { zeroFilms: true } }, frictionH: { twins: { frictionH: true } }, culvertNo2: { twins: { culvertNo2: true } },
  davisDry: { twins: { davisDry: true } },
};

/** metric readers per gate: name -> (metrics) -> number */
const READ = {
  ritter: { l1_rel: (m) => m.l1_rel, front_rel: (m) => m.front_rel },
  stoker: { l1_rel: (m) => m.l1_rel, shock_rel: (m) => m.shock_rel },
  lake_at_rest: { umax_cpu: (m) => m.umax },
  thacker: { l1_rel: (m) => m.l1_rel, shoreline_rel: (m) => m.shoreline_rel },
  volume: { rel_cpu: (m) => m.rel },
  manning: { rel: (m) => m.rel },
  culvert: { worst_rel: (m) => m.worst_rel },
};
const CASE_OF = { ritter: 'ritter', stoker: 'stoker', lake_at_rest: 'lake', thacker: 'thacker', volume: 'conservation', manning: 'manning', culvert: 'culvert' };

function evaluate(gate, L, metrics) {
  const out = {};
  for (const [name, read] of Object.entries(READ[gate])) {
    const lim = L[name], v = read(metrics);
    out[name] = { observed: Number.isFinite(v) ? v : null, rule: lim.rule, limit: lim.limit, pass: judge(lim.rule, lim.limit, v) };
  }
  return out;
}

export function runGate(gate, limits, { twins = true } = {}) {
  const L = limits.gates[gate], mk = CASES[CASE_OF[gate]];
  const t0 = Date.now();
  const { metrics } = runCase(mk(L.scale));
  const res = { gate, scale: L.scale, metrics: strip(metrics), checks: evaluate(gate, L, metrics), seconds: (Date.now() - t0) / 1000 };
  if (L.order) {
    const [a, b] = L.order_scales;
    const ea = a === L.scale ? metrics.l1_rel : runCase(mk(a)).metrics.l1_rel, eb = runCase(mk(b)).metrics.l1_rel;
    const p = Math.log2(ea / eb) / Math.log2(b / a);
    res.checks.order = { observed: p, rule: L.order.rule, limit: L.order.limit, pass: judge(L.order.rule, L.order.limit, p), l1: [ea, eb] };
  }
  res.pass = Object.values(res.checks).every((c) => c.pass);
  if (twins) {
    res.twins = (L.twins || []).map((tw) => {
      const { metrics: m } = runCase(mk(L.scale), TWIN_OPTS[tw]);
      const checks = evaluate(gate, L, m);
      return { twin: tw, checks, caught: Object.values(checks).some((c) => !c.pass) };
    });
  }
  return res;
}

function strip(m) { const o = {}; for (const [k, v] of Object.entries(m)) if (k !== 'rows' || true) o[k] = v; return o; }

export const LADDER = ['ritter', 'stoker', 'lake_at_rest', 'thacker', 'volume', 'manning', 'culvert'];
