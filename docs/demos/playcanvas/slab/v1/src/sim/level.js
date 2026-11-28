// SLAB levels: each is an X3D 4.0 file, generated here and read back by the game and the tests.
//   - an ElevationGrid mountain (the solver's terrain is sampled from it along each line: the X3D is the truth);
//   - kansei:slab-level: the snowpack layers, the two lines (safe and deadly) and their pitch angles;
//   - kansei:referee: the claims the test suite re-proves on every run (Fohn-style index per line);
//   - kansei:tunable: the knobs the tinker panel shows, with ranges and units.
// Levels are designed by the referee: the weak layer's cohesion is solved so a skier on the deadly pitch meets a
// Fohn-style index of 0.9, while the thin slab keeps the natural index well above 1 (it holds by itself); the safe
// line is kept under the cohesionless Davis angle atan(sin phi), so it cannot slide even if every bond breaks.

import { skierIndex, releaseAngle } from './referee.js';
import { parseXML, findAll, metaSet, nums, writeXML, el, fmt } from '../x3d/x3dxml.js';
import { Sim, material, SNOW, GRANULAR } from './mpm.js';

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
export const PHI = 30, SKIER_TARGET = 0.9, SKIER_R = 780;

export const DESIGNS = [
  { name: 'Practice Bowl', tagline: 'Dig a pit. Read the layers. The ridge is kind; the bowl is not.', sky: 'clear',
    deadly: 36, safe: 16, weak: { rho: 200, h: 0.2 }, slab: { rho: 250, h: 0.4 } },
  { name: 'Wind Lip', tagline: 'Last night the wind moved the snow onto the lee slope and pressed it into a slab.', sky: 'wind',
    deadly: 39, safe: 16, weak: { rho: 180, h: 0.2 }, slab: { rho: 300, h: 0.3 } },
  { name: 'The Couloir', tagline: 'A 45 degree chute at dawn. Patrol it, then ski it.', sky: 'dawn',
    deadly: 45, safe: 16, weak: { rho: 200, h: 0.2 }, slab: { rho: 260, h: 0.35 } },
];

export const SPAN = 34, TOP = 6, PITCH = 16, BLEND = 3, ZW = 12;

/** Slope angle (deg) of a line along x: a flat top, a pitch at theta, a 5 degree runout, smooth between. */
function angleAt(x, theta) {
  const S = (t) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
  return 3 + (theta - 3) * S((x - TOP + BLEND / 2) / BLEND) - (theta - 5) * S((x - TOP - PITCH + BLEND / 2) / BLEND);
}
/** Ground height along a line, y(0) = 0, falling. */
export function profile(theta, dx = 0.1) {
  const n = Math.round(SPAN / dx) + 1, y = new Float64Array(n);
  for (let i = 1; i < n; i++) y[i] = y[i - 1] - dx * Math.tan(rad(angleAt((i - 0.5) * dx, theta)));
  return y;
}

/** Solve the weak layer's cohesion so a skier on the deadly pitch meets index SKIER_TARGET (it fails under a skier). */
export function design(k) {
  const d = DESIGNS[k - 1];
  const layers = [d.weak, d.slab], D = d.weak.h + d.slab.h;
  let lo = 0, hi = 5000;
  for (let it = 0; it < 60; it++) { const c = 0.5 * (lo + hi); if (skierIndex({ layersAbove: layers, D, theta: d.deadly, c, phi: PHI, R: SKIER_R }).index < SKIER_TARGET) lo = c; else hi = c; }
  const c = Math.round(hi);
  const at = (th) => skierIndex({ layersAbove: layers, D, theta: th, c, phi: PHI, R: SKIER_R });
  return { ...d, k, c, phi: PHI, D, deadlyIndex: at(d.deadly), safeIndex: at(d.safe), releaseDeg: releaseAngle({ layers, c, phi: PHI }),
    residualDeg: deg(Math.atan(Math.sin(rad(PHI)))) };
}

/** The level as an X3D 4.0 file. */
export function toX3D(k) {
  const L = design(k), dx3 = 0.5, nxg = Math.round(SPAN / dx3) + 1, nzg = Math.round(ZW / dx3) + 1;
  const ps = profile(L.safe, dx3), pd = profile(L.deadly, dx3);
  const h = [], col = [];
  for (let j = 0; j < nzg; j++) {
    const z = -ZW / 2 + j * dx3, u = Math.min(1, Math.max(0, (z + 3) / 6)), s = u * u * (3 - 2 * u);
    for (let i = 0; i < nxg; i++) { h.push(fmt(+(ps[i] * (1 - s) + pd[i] * s).toFixed(4))); col.push('0.92 0.94 0.98'); }
  }
  const md = (name, v) => el('MetadataDouble', { name, containerField: 'value', value: v.map((x) => fmt(x)).join(' ') });
  const ms = (name, v) => el('MetadataString', { name, containerField: 'value', value: v.map((x) => `"${x}"`).join(' ') });
  const claims = [
    `safe line (z -3, ${L.safe} deg): index ${L.safeIndex.index.toFixed(2)} >= 1.5, a skier crossing it does not release the slab`,
    `deadly line (z +3, ${L.deadly} deg): natural index ${L.deadlyIndex.natural.toFixed(2)} > 1 holds alone; skier index ${L.deadlyIndex.index.toFixed(2)} < 1, a skier crossing it releases the slab`,
    'after the patrol bot charges the deadly line it has released, and a skier then crosses it without being caught',
  ];
  const tun = (field, min, max, step, unit, label) => el('MetadataSet', { name: 'kansei:tunable', containerField: 'value' },
    ms('field', [field]), md('range', [min, max, step]), ms('unit', [unit]), ms('label', [label]));
  const doc = el('X3D', { profile: 'Interchange', version: '4.0' },
    el('head', {}, el('meta', { name: 'title', content: `SLAB ${k}: ${L.name}` }), el('meta', { name: 'description', content: L.tagline }),
      el('meta', { name: 'generator', content: 'x3d.slab/src/sim/level.js' }), el('meta', { name: 'license', content: 'MIT' })),
    el('Scene', {},
      el('WorldInfo', { title: `SLAB ${k}: ${L.name}` },
        el('MetadataSet', { name: 'kansei:slab-level', containerField: 'metadata' },
          md('level', [k]), ms('name', [L.name]), ms('tagline', [L.tagline]), ms('sky', [L.sky]),
          md('lines', [-3, L.safe, 3, L.deadly]), ms('lineNames', ['Ridge', 'Bowl']),
          md('weak', [L.weak.rho, L.weak.h, L.c, L.phi]), md('slab', [L.slab.rho, L.slab.h]),
          md('index', [L.safeIndex.index, L.deadlyIndex.natural, L.deadlyIndex.index]), md('span', [SPAN, TOP, PITCH, ZW]),
          el('MetadataSet', { name: 'kansei:referee', containerField: 'value' }, ms('claims', claims)),
          el('MetadataSet', { name: 'kansei:tunables', containerField: 'value' },
            tun('slab.h', 0.3, 1.2, 0.05, 'm', 'slab thickness'), tun('weak.c', 100, 2000, 10, 'Pa', 'weak-layer cohesion (bonds)'),
            tun('charge.dv', 0, 6, 0.5, 'm/s', 'charge strength'), tun('skier.speed', 2, 12, 1, 'm/s', 'skier speed'),
            tun('airbag.r', 0.3, 0.7, 0.05, 'm', 'airbag radius when pulled')))),
      el('Viewpoint', { description: 'from the ridge', position: '-8 6 14', orientation: '0 1 0 -0.6' }),
      el('DirectionalLight', { direction: '-0.4 -0.8 -0.45', intensity: '1' }),
      el('Transform', { DEF: 'Mountain' },
        el('Shape', {}, el('Appearance', {}, el('PhysicalMaterial', { baseColor: '0.92 0.94 0.98', roughness: '0.85', metallic: '0' })),
          el('ElevationGrid', { DEF: 'Terrain', xDimension: nxg, zDimension: nzg, xSpacing: dx3, zSpacing: dx3, creaseAngle: '1.2', solid: 'false', height: h.join(' ') },
            el('Color', { color: col.join(' ') }))))));
  return { L, text: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n${writeXML(doc)}\n` };
}

/** Read a level back from its X3D file: the terrain grid and the kansei sets. */
export function fromX3D(text) {
  const doc = parseXML(text);
  const m = metaSet(doc, 'kansei:slab-level');
  if (!m) throw new Error("level: no MetadataSet name='kansei:slab-level'");
  const g = findAll(doc, 'ElevationGrid')[0];
  const nxg = +g.attrs.xDimension, nzg = +g.attrs.zDimension, sx = +g.attrs.xSpacing, sz = +g.attrs.zSpacing;
  const heights = nums(g.attrs.height);
  const tunables = findAll(doc, 'MetadataSet', (s) => s.attrs.name === 'kansei:tunable').map((s) => {
    const o = {}; for (const c of s.children) o[c.attrs.name] = c.name === 'MetadataString' ? c.attrs.value.replace(/^"|"$/g, '') : nums(c.attrs.value); return o; });
  const [rw, hw, c, phi] = m.weak, [rs, hs] = m.slab;
  return {
    k: m.level[0], name: m.name[0], tagline: m.tagline[0], sky: m.sky[0], claims: m['kansei:referee'].claims, tunables,
    lines: [{ name: m.lineNames[0], z: m.lines[0], theta: m.lines[1] }, { name: m.lineNames[1], z: m.lines[2], theta: m.lines[3] }],
    weak: { rho: rw, h: hw, c, phi }, slab: { rho: rs, h: hs }, index: { safe: m.index[0], natural: m.index[1], deadly: m.index[2] },
    span: m.span[0], top: m.span[1], pitch: m.span[2], zw: m.span[3],
    grid: { nxg, nzg, sx, sz, heights },
    /** terrain height at (x, z), bilinear in the ElevationGrid */
    height(x, z) {
      const fx = Math.min(nxg - 1.001, Math.max(0, x / sx)), fz = Math.min(nzg - 1.001, Math.max(0, (z + m.span[3] / 2) / sz));
      const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, H = (ii, jj) => heights[ii + jj * nxg];
      return (1 - a) * (1 - b) * H(i, j) + a * (1 - b) * H(i + 1, j) + (1 - a) * b * H(i, j + 1) + a * b * H(i + 1, j + 1);
    },
  };
}

/**
 * The 2D slice under a line, as a Sim: terrain sampled from the X3D, a one-cell bed inside the ground, the weak
 * layer and the slab draped over it (slope-normal thickness), from the top flat to the foot of the pitch.
 * opts: line (0 safe, 1 deadly), dx, tune {slab.h, weak.c}, soften (plastic shear at which bonds are gone).
 */
export function sliceSim(level, opts = {}) {
  const line = level.lines[opts.line ?? 1], dx = opts.dx ?? 0.1, tune = opts.tune || {};
  const hs = tune['slab.h'] ?? level.slab.h, c = tune['weak.c'] ?? level.weak.c;
  const marginX = 1.0, nx = Math.ceil((level.span + 2 * marginX) / dx);
  const gx = (i) => i * dx - marginX; // node column -> level x
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < nx; i++) { const y = level.height(gx(i), line.z); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const y0 = -ymin + 3 * dx; // shift so the lowest ground sits 3 cells up
  const ny = Math.ceil((ymax - ymin + level.weak.h + hs + 4) / dx) + 6;
  const ground = new Float64Array(nx);
  for (let i = 0; i < nx; i++) ground[i] = level.height(gx(i), line.z) + y0;
  // the weak layer's nu = 0.45 stands in for the creep that relaxes a real snowpack toward isotropic lateral stress
  // (K0 = nu / (1 - nu) = 0.82): with nu = 0.2 (K0 = 0.25) the settled layer sits at yield and every slope steeper
  // than the residual angle creeps off by itself once its bonds can break
  const mats = [material({ kind: SNOW, E: 1e5, nu: 0.2, rho: level.slab.rho, label: 'slab' }),
    material({ kind: GRANULAR, E: 5e4, nu: 0.45, rho: level.weak.rho, phi: level.weak.phi, c, soften: Infinity, label: 'weak layer' })];
  const S = new Sim({ nx, ny, dx, dt: opts.dt ?? 1.0e-3, materials: mats, ramp: 0.6, cap: 60000,
    walls: { left: 'sticky', right: 'sticky', bottom: 'sticky', top: 'free' } });
  S.ground = ground;
  const groundAt = (x) => { const f = Math.min(nx - 1.001, Math.max(0, x / dx)), i = Math.floor(f); return ground[i] + (f - i) * (ground[i + 1] - ground[i]); };
  // the snowpack runs from the top flat well into the runout and thins to nothing over its last 4 m: a toe that
  // ends in a cliff gives the slab no support from below and the slope releases by itself
  const toe = opts.toe ?? 'runout';
  const h = dx / 2, x0 = marginX + 1.5, x1 = marginX + level.top + level.pitch + ({ runout: 8, foot: 2.5, cliff: -1 })[toe], taper = ({ runout: 4, foot: 3, cliff: 0.6 })[toe];
  for (let x = x0 + h / 2; x < x1; x += h) {
    const g = groundAt(x), cosA = Math.cos(Math.atan(Math.abs(groundAt(x + 0.2) - groundAt(x - 0.2)) / 0.4));
    const f = Math.min(1, (x1 - x) / taper);
    const tw = (level.weak.h / cosA) * f, ts = (hs / cosA) * f;
    for (let y = g - dx + h / 2; y < g + tw + ts; y += h) {
      const p = S.n++;
      const mi = y < g + tw ? 1 : 0;
      S.x[p] = x; S.y[p] = y; S.f00[p] = 1; S.f11[p] = 1; S.jp[p] = 1; S.coh[p] = 1; S.mat[p] = mi; S.v0[p] = h * h; S.m[p] = mats[mi].rho * h * h;
    }
  }
  S.meta = { line, y0, marginX, groundAt, surfaceAt: (x) => { const g = groundAt(x), cosA = Math.cos(Math.atan(Math.abs(groundAt(x + 0.2) - groundAt(x - 0.2)) / 0.4)); return g + (level.weak.h + hs) / cosA; },
    pitchX: [marginX + level.top, marginX + level.top + level.pitch], snowX: [x0, x1] };
  return S;
}
