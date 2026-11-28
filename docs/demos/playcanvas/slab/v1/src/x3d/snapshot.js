// A SLAB snowpack as an X3D 4.0 file: the save format. Two views of one state in one file:
//   - kansei:slab-state, a MetadataSet holding everything the solver needs to resume bit-exactly
//     (grid, materials, loads, the caught-skier body, every particle field as MetadataDouble);
//   - a PointSet with per-point Color, so X_ITE, X3DOM or Blender show the snowpack with no game installed.
// Interchange profile: PointSet, Coordinate, Color and the Metadata nodes are all in it.

import { parseXML, metaSet, writeXML, el, fmt, findAll, nums } from './x3dxml.js';
import { Sim, FIELDS, material } from '../sim/mpm.js';

const MAT_KEYS = ['kind', 'E', 'nu', 'rho', 'phi', 'c', 'soften', 'thetaC', 'thetaS', 'xi'];
const COLORS = [[0.55, 0.8, 1.0], [0.96, 0.97, 1.0], [0.62, 0.66, 0.78]]; // elastic, snow, granular (linear RGB)

const dbl = (name, arr, f32) => el('MetadataDouble', { name, containerField: 'value', value: Array.from(arr, (v) => fmt(v, f32)).join(' ') });
const int = (name, arr) => el('MetadataInteger', { name, containerField: 'value', value: Array.from(arr).join(' ') });
const str = (name, s) => el('MetadataString', { name, containerField: 'value', value: `"${String(s).replace(/["\\]/g, '\\$&')}"` });

/**
 * The state of sim as an X3D document. opts.float32 writes doubles at float32 precision (a wrong twin);
 * opts.skip lists particle fields to leave out (the no_affine twin skips c00..c11); opts.title, opts.level.
 */
export function snapshotX3D(sim, opts = {}) {
  const f32 = !!opts.float32, skip = new Set(opts.skip || []);
  const n = sim.n, sl = (a) => a.subarray(0, n);
  const grid = el('MetadataSet', { name: 'grid', containerField: 'value' },
    int('nx', [sim.nx]), int('ny', [sim.ny]), dbl('dx', [sim.dx]), dbl('dt', [sim.dt]), dbl('t', [sim.t]), int('steps', [sim.steps]),
    dbl('gravity', sim.gravity), dbl('ramp', [sim.ramp]), int('periodicX', [sim.periodicX ? 1 : 0]),
    str('walls', [sim.walls.left, sim.walls.right, sim.walls.bottom, sim.walls.top].join(' ')), str('twin', sim.twin || ''));
  const mats = el('MetadataSet', { name: 'materials', containerField: 'value' },
    sim.mats.map((m, i) => el('MetadataSet', { name: 'm' + i, containerField: 'value' }, str('label', m.label || ''),
      MAT_KEYS.map((k) => dbl(k, [m[k] === Infinity ? -1 : m[k]])))));
  const loads = dbl('loads', sim.loads.flatMap((L) => [L.x, L.y, L.fx, L.fy]), f32);
  const body = sim.body ? dbl('body', [sim.body.x, sim.body.y, sim.body.vx, sim.body.vy, sim.body.r, sim.body.M], f32) : null;
  const parts = el('MetadataSet', { name: 'particles', containerField: 'value' }, int('n', [n]), int('mat', sl(sim.mat)),
    FIELDS.filter((f) => !skip.has(f)).map((f) => dbl(f, sl(sim[f]), f32)));
  const state = el('MetadataSet', { name: 'kansei:slab-state', containerField: 'metadata' }, grid, mats, loads, body, parts);
  const pts = [], cols = [];
  for (let p = 0; p < n; p++) {
    pts.push(fmt(+sim.x[p].toFixed(4)), fmt(+sim.y[p].toFixed(4)), '0');
    const c = COLORS[sim.mat[p]] || COLORS[0], d = Math.min(1, sim.dmg[p] * 4);
    cols.push(...[c[0] * (1 - d) + 0.95 * d, c[1] * (1 - d) + 0.35 * d, c[2] * (1 - d) + 0.3 * d].map((v) => v.toFixed(3)));
  }
  const doc = el('X3D', { profile: 'Interchange', version: '4.0', 'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance', 'xsd:noNamespaceSchemaLocation': 'https://www.web3d.org/specifications/x3d-4.0.xsd' },
    el('head', {}, el('meta', { name: 'title', content: opts.title || 'SLAB snapshot' }), el('meta', { name: 'generator', content: 'x3d.slab/src/x3d/snapshot.js' }),
      el('meta', { name: 'description', content: `Snowpack at t = ${sim.t.toFixed(4)} s, ${n} particles. kansei:slab-state resumes it bit-exactly; the PointSet shows it in any X3D browser.` })),
    el('Scene', {},
      el('WorldInfo', { title: opts.title || 'SLAB snapshot' }, state),
      el('Viewpoint', { description: 'side', position: `${fmt((sim.nx * sim.dx) / 2)} ${fmt((sim.ny * sim.dx) / 2)} ${fmt(Math.max(sim.nx, sim.ny) * sim.dx * 1.2)}` }),
      el('Shape', {}, el('PointSet', {}, el('Coordinate', { point: pts.join(' ') }), el('Color', { color: cols.join(' ') }))),
      ...(opts.extra || [])));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n${writeXML(doc)}\n`;
}

/** Rebuild a Sim from a snapshot written by snapshotX3D. */
export function resumeX3D(text) {
  const doc = parseXML(text);
  const S = metaSet(doc, 'kansei:slab-state');
  if (!S) throw new Error("snapshot: no MetadataSet name='kansei:slab-state'");
  const g = S.grid, w = g.walls[0].split(' ');
  const mats = Object.keys(S.materials).sort((a, b) => +a.slice(1) - +b.slice(1)).map((k) => {
    const m = S.materials[k], o = { label: m.label[0] };
    for (const key of MAT_KEYS) o[key] = m[key][0] === -1 && key === 'soften' ? Infinity : m[key][0];
    return material(o);
  });
  const n = S.particles.n[0];
  const sim = new Sim({ nx: g.nx[0], ny: g.ny[0], dx: g.dx[0], dt: g.dt[0], cap: Math.max(n, 1), materials: mats, periodicX: g.periodicX[0] === 1,
    walls: { left: w[0], right: w[1], bottom: w[2], top: w[3] }, gravity: g.gravity, ramp: g.ramp[0], twin: g.twin[0] || null });
  sim.n = n; sim.t = g.t[0]; sim.steps = g.steps[0];
  sim.mat.set(S.particles.mat);
  for (const f of FIELDS) if (S.particles[f]) sim[f].set(S.particles[f]);
  const L = S.loads || [];
  for (let i = 0; i + 3 < L.length; i += 4) sim.loads.push({ x: L[i], y: L[i + 1], fx: L[i + 2], fy: L[i + 3] });
  if (S.body) { const b = S.body; sim.body = { x: b[0], y: b[1], vx: b[2], vy: b[3], r: b[4], M: b[5] }; }
  return sim;
}

/** The PointSet view: positions as [x0, y0, x1, y1, ...] (what an X3D browser draws). */
export function pointsOf(text) {
  const c = findAll(parseXML(text), 'Coordinate')[0];
  const a = nums(c.attrs.point), out = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push(a[i], a[i + 1]);
  return out;
}
