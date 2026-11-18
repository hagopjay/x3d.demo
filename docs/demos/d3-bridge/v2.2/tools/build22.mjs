// D3 -> X3D bridge v1: D3 computes every layout, d3-x3d (x3d.mjs) writes the X3D 4.0 scene.
// Usage: node build.mjs <data.json> <relief.json> <outdir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as d3 from 'd3';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceZ } from 'd3-force-3d';
import { sankey as d3sankey } from 'd3-sankey';
import * as topojson from 'topojson-client';
import { createRequire } from 'node:module';
import { esc, Scene, T, shape, box, sphere, cyl, label, flatText, lines, tube, revolve, faces, f, v, rgb, rotY, norm, add, mul, sub, len } from './x3d3.mjs';

const require = createRequire(import.meta.url);
const [, , dataPath, reliefPath, OUT, DATES, SITESP] = process.argv;
const SITE_COMMITS = JSON.parse(fs.readFileSync(SITESP, 'utf8'));
const D = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const RELIEF = JSON.parse(fs.readFileSync(reliefPath, 'utf8'));
fs.mkdirSync(path.join(OUT, 'scenes'), { recursive: true });
const manifest = [];
const pv = p => JSON.parse(fs.readFileSync(new URL(`./node_modules/${p}/package.json`, import.meta.url))).version;
const VERS = { d3: pv('d3'), 'd3-force-3d': pv('d3-force-3d'), 'd3-sankey': pv('d3-sankey'), 'world-atlas': pv('world-atlas'), 'topojson-client': pv('topojson-client') };
const SRC_REPOS = D.repos.map(r => `${r.name}@${r.head}`).join(', ');

function emit(id, sc, info) {
  const xml = sc.toString();
  fs.writeFileSync(path.join(OUT, 'scenes', id + '.x3d'), xml);
  manifest.push({ id, file: `scenes/${id}.x3d`, bytes: Buffer.byteLength(xml), labels: sc.stats, defs: { kept: sc.defStats.kept, stripped: sc.defStats.stripped, exported: sc.defStats.exported.length }, ...info });
  console.log(id.padEnd(14), String(Buffer.byteLength(xml)).padStart(8), 'B', JSON.stringify(info.numbers));
}

// ---------- shared derived data
const usage = D.usage;
const demos = Object.keys(usage).sort((a, b) => d3.sum(Object.values(usage[b])) - d3.sum(Object.values(usage[a])));
const typeTotal = new Map();
for (const u of Object.values(usage)) for (const [t, c] of Object.entries(u)) typeTotal.set(t, (typeTotal.get(t) || 0) + c);
const typesByUse = [...typeTotal.keys()].sort((a, b) => typeTotal.get(b) - typeTotal.get(a));
const COMP = D.uom.components;
const comps = [...new Set(typesByUse.map(t => COMP[t]))].sort();
const compColor = new Map(comps.map((c, i) => [c, d3.interpolateRainbow((i * 0.618034) % 1)]));
const allDemos = [...demos, ...Object.keys(D.demo_tree).filter(d => !usage[d]).sort()];
const demoColor = new Map(allDemos.map((d, i) => [d, d3.interpolateTurbo(0.08 + 0.86 * ((i * 0.618034) % 1))]));
const fileTypes = D.x3d_files.map(fl => new Set(fl.types));
const filesWith = new Map(); for (const s of fileTypes) for (const t of s) filesWith.set(t, (filesWith.get(t) || 0) + 1);
const DAY = 86400, START = Date.UTC(2026, 9, 1) / 1000, NDAYS = 49; // 1 Oct .. 18 Nov 2026 (UTC)
const repos = Object.keys(D.commits).sort((a, b) => D.commits[b].length - D.commits[a].length);
const daily = new Map(repos.map(r => { const a = new Array(NDAYS).fill(0); for (const t of D.commits[r]) { const k = Math.floor((t - START) / DAY); if (k >= 0 && k < NDAYS) a[k]++; } return [r, a]; }));
const repoColor = new Map(repos.map((r, i) => [r, d3.interpolateSinebow((i * 0.618034 + 0.05) % 1)]));
const inWindow = d3.sum(repos, r => d3.sum(daily.get(r)));
const totalCommits = d3.sum(repos, r => D.commits[r].length);
const dayLabel = k => d3.utcFormat('%b %d')(new Date((START + k * DAY) * 1000));
const floor = (sc, w, d, y = -0.02, c = '#0d1018') => T([0, y - 0.02, 0], shape(box([w, 0.04, d]), sc.app(c, { rough: 0.9 })));

// ---------- 1. HEATMAP -> heat terrain
{
  const sc = new Scene({ title: 'Heat terrain: X3D node types x demos', desc: 'D3Blocks Heatmap re-expressed in 3D: each cell is a column whose height and colour both carry log(count).', shadows: true,
    views: [{ name: 'Overview', pos: [7.5, 8, 10.5] }, { name: 'Low across rows', pos: [0, 2.2, 9.5], at: [0, 0.6, 0] }, { name: 'Top down (the 2D heatmap)', pos: [0, 15, 0.01] }],
    meta: { 'd3-modules': 'd3-scale, d3-scale-chromatic (interpolateInferno), d3-array', data: `X3D element counts in ${D.x3d_files.length} .x3d files of x3d.demo docs/demos` } });
  const rows = typesByUse.slice(0, 24), cols = demos; const sp = 0.3, W = cols.length * sp, H = rows.length * sp;
  const max = d3.max(cols, d => d3.max(rows, t => usage[d][t] || 0));
  const hs = d3.scaleLog().domain([1, max]).range([0.06, 3.2]);
  const col = d3.scaleSequential(d3.interpolateInferno).domain([0, Math.log10(max)]);
  sc.add(floor(sc, W + 3.2, H + 3.2));
  let nz = 0;
  cols.forEach((d, i) => rows.forEach((t, j) => {
    const c = usage[d][t] || 0; const x = (i + 0.5) * sp - W / 2, z = (j + 0.5) * sp - H / 2;
    if (!c) { sc.add(T([x, 0.005, z], shape(box([sp * 0.86, 0.01, sp * 0.86]), sc.app('#1a1d27', { rough: 1 })))); return; }
    nz++; const h = hs(c);
    sc.add(T([x, h / 2, z], shape(box([sp * 0.86, h, sp * 0.86]), sc.app(col(Math.log10(c)).toString(), { rough: 0.45, emissive: c === max ? '#331100' : null }))));
  }));
  cols.forEach((d, i) => sc.add(flatText(sc, d, [(i + 0.5) * sp - W / 2, 0.01, H / 2 + 0.25], { size: 0.13, rot: [-0.5774, 0.5774, 0.5774, 2.0944], justify: 'BEGIN' })));
  rows.forEach((t, j) => sc.add(flatText(sc, t, [-W / 2 - 0.15, 0.01, (j + 0.5) * sp - H / 2], { size: 0.14, rot: [1, 0, 0, -1.5708], justify: 'END' })));
  sc.add(label(sc, `max ${max}`, [-W / 2 + 0.2, 3.6, -H / 2], { size: 0.2, color: '#ffcf8a' }));
  emit('heatmap', sc, { tile: 'HEATMAP', title: 'Heat terrain', d3: ['d3-scale (scaleLog)', 'd3-scale-chromatic (interpolateInferno)', 'd3-array'],
    gain: 'Height repeats the colour channel, so magnitude reads twice: colour for class, height for rank. Orbit low across a row and the 24 x 33 matrix becomes a skyline you can compare by silhouette; look straight down and it is the 2D heatmap again (viewpoint 3).',
    numbers: { rows: rows.length, cols: cols.length, nonzero: nz, max } });
}

// ---------- 2. CHORD -> chord dome v2 (interactive)
{
  const top = typesByUse.filter(t => filesWith.get(t) >= 8).slice(0, 14);
  const M = top.map(a => top.map(b => a === b ? 0 : d3.sum(fileTypes, s => s.has(a) && s.has(b) ? 1 : 0)));
  const ch = d3.chord().padAngle(0.05).sortSubgroups(d3.descending)(M);
  const sc = new Scene({ title: 'Chord dome v2: click an arch, watch the flow', desc: 'D3Blocks Chord in 3D: arch height = files the two node types share, tube radius = their Jaccard overlap; click an arch to isolate it; beads ride the 20 strongest arches.',
    views: [{ name: 'Oblique', pos: [0, 7.5, 11.5], at: [0, 1.0, 0] }, { name: 'Top (the 2D chord)', pos: [0, 13, 0.01] }, { name: 'Under the dome', pos: [0.6, 0.35, 2.2], at: [0, 2.2, -1] }, { name: 'Side', pos: [10, 2, 0], at: [0, 1.4, 0] }],
    meta: { 'd3-modules': 'd3-chord, d3-scale-chromatic', data: 'files sharing each pair of the 14 most common X3D node types (x3d.demo)', interaction: 'TouchSensor per arch (CT0..), page isolates via SAI; TimeSensor + PositionInterpolator beads (CB0..)' } });
  const R = 4, P = a => [R * Math.sin(a), 0, -R * Math.cos(a)];
  const gcol = i => d3.interpolateRainbow(i / top.length);
  sc.add(T([0, -0.03, 0], shape(cyl(R + 1.2, 0.04), sc.app('#0c0f17', { rough: 0.95 }))));
  ch.groups.forEach(g => {
    const pts = d3.range(0, 25).map(k => P(g.startAngle + (g.endAngle - g.startAngle) * k / 24));
    sc.add(shape(tube(pts, 0.16, 12), sc.app(gcol(g.index), { rough: 0.35, metal: 0.2 })));
    const m = (g.startAngle + g.endAngle) / 2; sc.add(label(sc, top[g.index], add(mul(P(m), 1.17), [0, 0.25, 0]), { size: 0.24, keep: true }));
  });
  const vmax = d3.max(ch, c => Math.max(c.source.value, c.target.value)); const info = [];
  ch.forEach((c, ci) => {
    const a = (c.source.startAngle + c.source.endAngle) / 2, b = (c.target.startAngle + c.target.endAngle) / 2;
    const p0 = mul(P(a), 0.96), p2 = mul(P(b), 0.96), val = Math.max(c.source.value, c.target.value), k = Math.sqrt(val / vmax);
    const A = top[c.source.index], Bn = top[c.target.index], jac = val / (filesWith.get(A) + filesWith.get(Bn) - val);
    const p1 = [(p0[0] + p2[0]) * 0.18, 0.5 + 3.4 * k, (p0[2] + p2[2]) * 0.18];
    const pts = d3.range(0, 21).map(i => { const t = i / 20, u = 1 - t; return [0, 1, 2].map(q => u * u * p0[q] + 2 * u * t * p1[q] + t * t * p2[q]); });
    const col = rgb(d3.color(gcol(c.source.value >= c.target.value ? c.source.index : c.target.index)).formatHex());
    sc.add(`<Group DEF='CG${ci}'><TouchSensor DEF='CT${ci}' description='${esc(A + ' + ' + Bn + ': ' + val + ' files, Jaccard ' + jac.toFixed(2))}'/>` +
      shape(tube(pts, 0.02 + 0.17 * jac, 8), `<Appearance><PhysicalMaterial DEF='CM${ci}' baseColor='${v(col)}' roughness='0.3' metallic='0' transparency='0.25'/></Appearance>`) + `</Group>`);
    info.push({ i: ci, a: A, b: Bn, shared: val, jaccard: +jac.toFixed(3), pts });
  });
  const beads = info.slice().sort((x, y) => y.shared - x.shared).slice(0, 20);
  beads.forEach((c, k) => {
    const sp = 2.2 + 4 * (1 - Math.sqrt(c.shared / vmax));
    sc.add(`<Transform DEF='CB${k}' translation='${v(c.pts[0])}'>${shape(sphere(0.075), sc.app('#fff3c4', { emissive: '#ffb84a', rough: 0.2 }))}</Transform>`,
      `<TimeSensor DEF='CBT${k}' cycleInterval='${f(sp)}' loop='true'/>`,
      `<PositionInterpolator DEF='CBI${k}' key='${c.pts.map((_, i) => f(i / 20)).join(' ')}' keyValue='${c.pts.map(p => v(p)).join(' ')}'/>`,
      `<ROUTE fromNode='CBT${k}' fromField='fraction_changed' toNode='CBI${k}' toField='set_fraction'/>`, `<ROUTE fromNode='CBI${k}' fromField='value_changed' toNode='CB${k}' toField='set_translation'/>`);
  });
  fs.writeFileSync(path.join(OUT, 'chord.json'), JSON.stringify(info.map(({ pts, ...r }) => r)));
  emit('chord', sc, { tile: 'CHORD', title: 'Chord dome (interactive)', d3: ['d3-chord', 'd3-scale-chromatic'], flagship: true,
    gain: 'Two variables per ribbon instead of one: arch height = files shared (sqrt), tube radius = Jaccard overlap, so a thick low arch is a tight pair of rare types and a thin high arch is two common types that merely co-occur. Click any arch to isolate it (X3D TouchSensor), and the 20 strongest arches carry beads whose speed follows flow. Viewpoint 3 stands you under the dome.',
    numbers: { groups: top.length, arches: ch.length, pickable: ch.length, beadLoops: beads.length, maxSharedFiles: vmax, maxJaccard: d3.max(info, c => c.jaccard) } });
}

// helper: dict tree -> d3.hierarchy
const toNode = (name, v) => (v && typeof v === 'object') ? { name, children: Object.entries(v).map(([k, x]) => toNode(k, x)) } : { name, value: v };

// ---------- 3. TREEMAP -> treemap city
{
  const root = d3.hierarchy(toNode('demos', Object.fromEntries(Object.entries(D.demo_tree).filter(([, x]) => typeof x === 'object')))).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([11, 11]).paddingOuter(0.06).paddingInner(0.025).tile(d3.treemapSquarify.ratio(1.3))(root);
  const sc = new Scene({ title: 'Treemap city: every tracked file in x3d.demo demos', desc: 'D3Blocks Treemap re-expressed in 3D: each level of the hierarchy is a terrace, each file a tower whose footprint is its bytes.', shadows: true,
    views: [{ name: 'Aerial', pos: [8, 9, 10], at: [0, 0, 0] }, { name: 'Street level', pos: [0, 1.2, 8], at: [0, 0.6, 0] }, { name: 'Plan (the 2D treemap)', pos: [0, 16, 0.01] }],
    meta: { 'd3-modules': 'd3-hierarchy (treemap, squarify)', data: 'git ls-files sizes, x3d.demo docs/demos, depth 3' } });
  const maxLeaf = d3.max(root.leaves(), d => d.value);
  const hl = d3.scaleLog().domain([100, maxLeaf]).range([0.05, 1.6]).clamp(true);
  let towers = 0;
  root.descendants().forEach(n => {
    if (!n.depth) return;
    const demo = n.ancestors().find(a => a.depth === 1).data.name; const base = demoColor.get(demo);
    const w = n.x1 - n.x0, d = n.y1 - n.y0, cx = (n.x0 + n.x1) / 2 - 5.5, cz = (n.y0 + n.y1) / 2 - 5.5;
    if (w < 0.004 || d < 0.004) return;
    if (n.children) {
      const y0 = (n.depth - 1) * 0.1;
      sc.add(T([cx, y0 + 0.05, cz], shape(box([w, 0.1, d]), sc.app(d3.color(base).darker(1.6 - n.depth * 0.5).formatHex(), { rough: 0.8 }))));
    } else {
      const y0 = (n.depth - 1) * 0.1, h = hl(n.value); towers++;
      const ext = (n.data.name.match(/\.([a-z0-9]+)$/i) || [, 'dir'])[1];
      sc.add(T([cx, y0 + h / 2, cz], shape(box([w * 0.92, h, d * 0.92]), sc.app(d3.color(base).brighter(ext === 'x3d' ? 0.6 : 0).formatHex(), { rough: ext === 'x3d' ? 0.25 : 0.6, metal: ext === 'x3d' ? 0.35 : 0 }))));
    }
  });
  root.children.slice(0, 16).forEach(n => sc.add(label(sc, `${n.data.name} ${d3.format('.2s')(n.value)}B`, [(n.x0 + n.x1) / 2 - 5.5, 2.0, (n.y0 + n.y1) / 2 - 5.5], { size: 0.2 })));
  emit('treemap', sc, { tile: 'TREEMAP', title: 'Treemap city', d3: ['d3-hierarchy (treemap, treemapSquarify)'],
    gain: 'A flat treemap shows the hierarchy only as nested borders. Here each level is a terrace (demo, then version), so the nesting is literally visible as terrain, and every file is a tower: area = bytes, height = log bytes, and .x3d files are drawn in a brighter, metallic finish so the scenes stand out from their vendor code.',
    numbers: { demos: root.children.length, leaves: root.leaves().length, towersDrawn: towers, totalBytes: root.value } });
}

// ---------- 4. MOVING BUBBLES -> space-time cube v2 (sliced)
{
  const sc = new Scene({ title: 'Space-time cube v2: a time slab slices 16 repositories x 49 days', desc: 'D3Blocks MovingBubbles in 3D: time is the vertical axis; a sweeping slab cuts the cube, the past below it is lit, the future above it is a ghost (two ClipPlanes riding the slab).',
    views: [{ name: 'Oblique', pos: [11, 9.5, 11], at: [0, 3.9, 0] }, { name: 'From above (the 2D animation)', pos: [0, 20, 0.01], at: [0, 3.9, 0] }, { name: 'Side, time up', pos: [0, 3.9, 15], at: [0, 3.9, 0] }],
    meta: { 'd3-modules': 'd3-array, d3-scale-chromatic, d3-time-format', data: `git log author times, ${repos.length} repos, 1 Oct to 18 Nov 2026 UTC`, interaction: 'CLOCK drives SWEEP (slab, clip frames) and UNSWEEP (counter-translation of the clipped content)' } });
  const dy = 0.16, Rmax = 4.6, Rmin = 0.9, H = NDAYS * dy; const dayTot = d3.range(NDAYS).map(k => d3.sum(repos, r => daily.get(r)[k]));
  sc.add(T([0, H / 2, 0], shape(cyl(0.02, H), sc.app('#3a4258', { unlit: true }))));
  for (let k = 0; k < NDAYS; k += 7) sc.add(label(sc, dayLabel(k), [0.35, k * dy, 0], { size: 0.18, color: '#8c94a8', justify: 'BEGIN', keep: true }));
  let bubbles = 0; const lit = [], ghost = [];
  repos.forEach((r, i) => {
    const a0 = i / repos.length * 2 * Math.PI, c = daily.get(r), pts = [];
    for (let k = 0; k < NDAYS; k++) {
      const share = dayTot[k] ? c[k] / dayTot[k] : 0; const rad = c[k] ? Rmin + (Rmax - Rmin) * (1 - share) : Rmax + 0.4;
      const a = a0 + k * 0.012; const p = [rad * Math.cos(a), k * dy, rad * Math.sin(a)]; pts.push(p);
      if (c[k]) { bubbles++; const rr = 0.05 + 0.055 * Math.sqrt(c[k]);
        lit.push(T(p, shape(sphere(rr), sc.app(repoColor.get(r), { rough: 0.3, emissive: d3.color(repoColor.get(r)).darker(1.2).formatHex() }))));
        ghost.push(T(p, shape(sphere(rr), sc.app(repoColor.get(r), { rough: 0.6, transp: 0.82 })))); }
    }
    const first = c.findIndex(x => x > 0);
    if (first >= 0 && NDAYS - first > 1) { lit.push(shape(tube(pts.slice(first), 0.03, 6), sc.app(repoColor.get(r), { rough: 0.4, emissive: d3.color(repoColor.get(r)).darker(1.6).formatHex() })));
      ghost.push(shape(tube(pts.slice(first), 0.012, 6), sc.app(repoColor.get(r), { rough: 0.6, transp: 0.8 })));
      sc.add(label(sc, r, add(pts[NDAYS - 1], [0, 0.45, 0]), { size: 0.2, color: repoColor.get(r), pri: D.commits[r].length })); }
  });
  sc.add(`<Transform DEF='CLIP_LIT'><ClipPlane plane='0 -1 0 0'/><Transform DEF='UN_LIT'>${lit.join('')}</Transform></Transform>`,
    `<Transform DEF='CLIP_GHOST'><ClipPlane plane='0 1 0 0'/><Transform DEF='UN_GHOST'>${ghost.join('')}</Transform></Transform>`,
    `<Transform DEF='NOW'>${shape(cyl(Rmax + 0.7, dy), sc.app('#7fd4ff', { unlit: true, transp: 0.78 }))}${shape(`<Cylinder radius='${f(Rmax + 0.72)}' height='${f(dy)}' top='false' bottom='false' solid='false'/>`, sc.app('#bfeaff', { unlit: true, transp: 0.4 }))}</Transform>`,
    `<TimeSensor DEF='CLOCK' cycleInterval='18' loop='true'/>`,
    `<PositionInterpolator DEF='SWEEP' key='0 1' keyValue='0 0 0 0 ${f(H)} 0'/>`, `<PositionInterpolator DEF='UNSWEEP' key='0 1' keyValue='0 0 0 0 ${f(-H)} 0'/>`,
    `<ROUTE fromNode='CLOCK' fromField='fraction_changed' toNode='SWEEP' toField='set_fraction'/>`, `<ROUTE fromNode='CLOCK' fromField='fraction_changed' toNode='UNSWEEP' toField='set_fraction'/>`,
    ...['NOW', 'CLIP_LIT', 'CLIP_GHOST'].map(n => `<ROUTE fromNode='SWEEP' fromField='value_changed' toNode='${n}' toField='set_translation'/>`),
    ...['UN_LIT', 'UN_GHOST'].map(n => `<ROUTE fromNode='UNSWEEP' fromField='value_changed' toNode='${n}' toField='set_translation'/>`));
  emit('spacetime', sc, { tile: 'MOVINGBUBBLES', title: 'Space-time cube (sliced)', d3: ['d3-array', 'd3-scale-chromatic', 'd3-time-format'], flagship: true,
    gain: 'Time is the vertical axis (Hagerstrand space-time cube), so the whole history is on screen at once; now a one-day slab sweeps up and cuts it: everything already happened is lit and solid, everything still to come is a ghost. Two X3D ClipPlanes ride the slab inside counter-moving Transforms, so the cut is done by the renderer, not by script. A repository that dominates a day pulls in toward the axis.',
    numbers: { repos: repos.length, days: NDAYS, bubbles, commitsInWindow: inWindow, sweepSeconds: 18, clipPlanes: 2 } });
}

// ---------- 5. D3GRAPH -> 3D force graph (static, d3-force-3d)
function typeGraph(minFiles = 3, k = 3) {
  const types = typesByUse.filter(t => (filesWith.get(t) || 0) >= minFiles);
  const idx = new Map(types.map((t, i) => [t, i]));
  const W = new Map();
  for (const s of fileTypes) { const a = [...s].filter(t => idx.has(t)); for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const key = a[i] < a[j] ? a[i] + '|' + a[j] : a[j] + '|' + a[i]; W.set(key, (W.get(key) || 0) + 1); } }
  const jac = new Map(); for (const [key, w] of W) { const [a, b] = key.split('|'); jac.set(key, w / (filesWith.get(a) + filesWith.get(b) - w)); }
  const keep = new Set();
  for (const t of types) { const mine = [...jac].filter(([key]) => key.split('|').includes(t)).sort((x, y) => y[1] - x[1]).slice(0, k); mine.forEach(([key]) => keep.add(key)); }
  const links = [...keep].map(key => { const [a, b] = key.split('|'); return { source: a, target: b, j: jac.get(key), w: W.get(key) }; });
  return { nodes: types.map(t => ({ id: t, comp: COMP[t], use: typeTotal.get(t), files: filesWith.get(t) })), links };
}
{
  const G = typeGraph();
  const sim = forceSimulation(G.nodes, 3).force('link', forceLink(G.links).id(d => d.id).distance(l => 6 + 30 * (1 - l.j)).strength(l => 0.25 + 0.75 * l.j))
    .force('charge', forceManyBody().strength(-60)).force('x', forceX().strength(0.06)).force('y', forceY().strength(0.06)).force('z', forceZ().strength(0.06)).force('center', forceCenter()).stop();
  for (let i = 0; i < 500; i++) sim.tick();
  const ext = d3.quantile(G.nodes.map(n => Math.hypot(n.x, n.y, n.z)).sort(d3.ascending), 0.9); const s = 4.6 / ext;
  const sc = new Scene({ title: '3D force graph: X3D node types that co-occur', desc: 'D3Blocks D3graph re-expressed with d3-force-3d: the same force model, run in three dimensions.',
    views: [{ name: 'Front', pos: [0, 1.5, 13] }, { name: 'Above', pos: [0, 13, 1] }, { name: 'Close', pos: [4, 2, 6] }],
    meta: { 'd3-modules': `d3-force-3d ${VERS['d3-force-3d']} (forceSimulation numDimensions 3, forceLink, forceManyBody, forceCenter)`, data: 'X3D node types in at least 3 x3d.demo files; edges = top 3 Jaccard partners per type' } });
  sc.add(lines(sc, G.links.map(l => [[l.source.x * s, l.source.y * s, l.source.z * s], [l.target.x * s, l.target.y * s, l.target.z * s]]), '#5c6a8a', { colors: G.links.map(l => d3.interpolateCividis(0.25 + 0.75 * l.j)) }));
  G.nodes.forEach((n, i) => {
    const r = 0.06 + 0.055 * Math.log10(n.use);
    sc.add(T([n.x * s, n.y * s, n.z * s], shape(sphere(r), sc.app(compColor.get(n.comp), { rough: 0.3, metal: 0.1 }))));
    if (i < 34) sc.add(label(sc, n.id, [n.x * s, n.y * s + r + 0.14, n.z * s], { size: 0.17 }));
  });
  const comps2 = [...new Set(G.nodes.map(n => n.comp))];
  comps2.forEach((c, i) => sc.add(label(sc, c, [-6.2, 4.2 - i * 0.32, -2], { size: 0.17, color: compColor.get(c), justify: 'BEGIN' })));
  emit('forcegraph', sc, { tile: 'D3GRAPH', title: '3D force graph', d3: ['d3-force-3d (numDimensions 3)'],
    gain: 'A force layout in 2D must flatten clusters onto each other; with a third degree of freedom the same forces settle with fewer crossings and the components (colour) separate into lobes you can orbit around. Same D3 force model, numDimensions = 3.',
    numbers: { nodes: G.nodes.length, links: G.links.length, ticks: 500, components: comps2.length } });
  fs.writeFileSync(path.join(OUT, 'graph.json'), JSON.stringify({ nodes: G.nodes.map(n => ({ id: n.id, comp: n.comp, use: n.use })), links: G.links.map(l => ({ s: l.source.id, t: l.target.id, j: +l.j.toFixed(3) })) }));
}

// ---------- 6. SANKEY -> sankey canyon (depth lanes)
{
  const topDemos = demos.slice(0, 10); const topTypes = new Set(typesByUse.slice(0, 18));
  const links = [], nodeSet = new Set();
  const compIn = new Map(), compOut = new Map();
  for (const d of topDemos) { const byC = d3.rollup(Object.entries(usage[d]), v => d3.sum(v, x => x[1]), x => COMP[x[0]]);
    for (const [c, val] of byC) { links.push({ source: 'demo:' + d, target: 'comp:' + c, value: val }); nodeSet.add('demo:' + d).add('comp:' + c); compIn.set(c, (compIn.get(c) || 0) + val); } }
  for (const c of compIn.keys()) {
    const byT = new Map(); for (const d of topDemos) for (const [t, val] of Object.entries(usage[d])) if (COMP[t] === c) { const k = topTypes.has(t) ? 'type:' + t : 'type:(other ' + c + ')'; byT.set(k, (byT.get(k) || 0) + val); }
    for (const [k, val] of byT) { links.push({ source: 'comp:' + c, target: k, value: val }); nodeSet.add(k); }
  }
  // merge small "(other X)" sinks into a single "(other types)" node
  for (const l of links) if (l.target.startsWith('type:(other')) l.target = 'type:(other types)';
  nodeSet.forEach(n => n.startsWith('type:(other ') && nodeSet.delete(n)); nodeSet.add('type:(other types)');
  const merged = d3.rollups(links, v => d3.sum(v, x => x.value), l => l.source, l => l.target).flatMap(([s, ts]) => ts.map(([t, value]) => ({ source: s, target: t, value })));
  const G = d3sankey().nodeId(d => d.id).nodeWidth(0.18).nodePadding(0.14).extent([[0, 0], [11, 6.5]])({ nodes: [...nodeSet].map(id => ({ id })), links: merged });
  const X = x => x - 5.5, Y = y => 3.25 - y;
  const lanes0 = G.nodes.filter(n => n.depth < 2); const laneZ0 = new Map(lanes0.map((n, i) => [n.id, ((i % 7) - 3) * 0.32]));
  const nd0 = G.nodes.filter(n => n.depth === 0).sort((p, q) => q.value - p.value)[0];
  const l1 = nd0.sourceLinks.slice().sort((p, q) => q.value - p.value)[0], nc = l1.target, l2 = nc.sourceLinks.slice().sort((p, q) => q.value - p.value)[0], nt = l2.target;
  const cy = n => Y((n.y0 + n.y1) / 2), cxm = n => X((n.x0 + n.x1) / 2);
  const TOUR = [{ name: 'Oblique', pos: [2, 5, 11], at: [0, 0, 0] }, { name: 'Front (the 2D sankey)', pos: [0, 0, 12.5] }, { name: 'Down the canyon', pos: [-9, 1.5, 3.5], at: [1, 0, -0.5] },
    { name: 'Tour 1: canyon mouth', pos: [-9.5, cy(nd0) + 0.6, 2.2], at: [cxm(nd0), cy(nd0), 0] },
    { name: `Tour 2: ${nd0.id.slice(5)}`, pos: [cxm(nd0) + 1.2, cy(nd0) + 0.5, 1.8], at: [cxm(nc), cy(nc), laneZ0.get(nd0.id) || 0] },
    { name: `Tour 3: ${nc.id.slice(5)}`, pos: [cxm(nc) - 1.6, cy(nc) + 0.4, 1.6], at: [cxm(nc), cy(nc), 0] },
    { name: `Tour 4: ${nt.id.slice(5)}`, pos: [cxm(nt) - 2.2, cy(nt) + 0.5, 1.8], at: [cxm(nt), cy(nt), 0] },
    { name: 'Tour 5: the exit, looking back', pos: [9.5, 1.2, 3.5], at: [-1, 0, 0] }];
  const sc = new Scene({ title: 'Sankey canyon: demos to X3D components to node types', desc: 'D3Blocks Sankey re-expressed in 3D: flows are solid ribbons in their own depth lanes, coloured from source to target.',
    views: TOUR,
    meta: { 'd3-modules': `d3-sankey ${VERS['d3-sankey']}, d3-array (rollup)`, data: 'X3D element counts: 10 largest demos, their components, 18 most used node types' } });
  const ncol = n => n.id.startsWith('demo:') ? demoColor.get(n.id.slice(5)) : n.id.startsWith('comp:') ? compColor.get(n.id.slice(5)) : (compColor.get(COMP[n.id.slice(5)]) || '#9aa3b5');
  const laneZ = laneZ0;
  G.nodes.forEach(n => {
    const h = n.y1 - n.y0; sc.add(T([X((n.x0 + n.x1) / 2), Y((n.y0 + n.y1) / 2), 0], shape(box([n.x1 - n.x0, Math.max(h, 0.02), 2.4]), sc.app(ncol(n), { rough: 0.35, metal: 0.25 }))));
    const nm = n.id.split(':')[1]; const right = n.depth === 2;
    sc.add(label(sc, `${nm} ${n.value}`, [X(right ? n.x1 + 0.12 : n.x0 - 0.12), Y((n.y0 + n.y1) / 2), 1.3], { size: 0.15, justify: right ? 'BEGIN' : 'END' }));
  });
  const TOTAL = d3.sum(G.nodes.filter(n => n.depth === 0), n => n.value), VMAX = d3.max(G.links, l => l.value); let beads = 0, beadLinks = 0;
  const lerp = (p, q, t) => p.map((x, i) => x + (q[i] - x) * t);
  const at = (cl, t) => { const s = t * (cl.length - 1), i = Math.min(cl.length - 2, Math.floor(s)); return lerp(cl[i], cl[i + 1], s - i); };
  const rot = (cl, o) => { const n = cl.length - 1, keys = [0], vals = [at(cl, o)]; for (let j = 0; j <= n; j++) { const t = j / n; if (t > o) { keys.push(t - o); vals.push(cl[j]); } }
    keys.push(1 - o); vals.push(cl[0]); for (let j = 1; j <= n; j++) { const t = j / n; if (t < o) { keys.push(t - o + 1); vals.push(cl[j]); } } keys.push(1); vals.push(at(cl, o)); return { keys, vals }; };
  G.links.forEach(l => {
    const x0 = l.source.x1, x1 = l.target.x0, xm = (x0 + x1) / 2, w = Math.max(l.width, 0.012), z = laneZ.get(l.source.id) || 0, dz = 0.1 + 0.25 * Math.sqrt(l.width / 6.5);
    const V = [], F = [], C = []; const N = 18; const c0 = rgb(d3.color(ncol(l.source)).formatHex()), c1 = rgb(d3.color(ncol(l.target)).formatHex());
    for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; const x = u * u * u * x0 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x1; const tt = t * t * (3 - 2 * t); const y = l.y0 + (l.y1 - l.y0) * tt;
      const cc = c0.map((q, k) => q + (c1[k] - q) * t);
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { V.push([X(x), Y(y) + a * w / 2, z + b * dz / 2]); C.push(cc); }); }
    for (let i = 0; i < N; i++) for (let s = 0; s < 4; s++) { const a = i * 4 + s, b = i * 4 + (s + 1) % 4; F.push([a, b, b + 4, a + 4]); }
    sc.add(faces(sc, V, F, '#ffffff', { rough: 0.45, transp: 0.18, crease: 0.4 }, C));
    if (l.value > 0.01 * TOTAL) { const cl = d3.range(N + 1).map(i => { const t = i / N, u = 1 - t; const x = u * u * u * x0 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x1; const tt = t * t * (3 - 2 * t); return [X(x), Y(l.y0 + (l.y1 - l.y0) * tt), z + dz / 2 + 0.03]; });
      const nb = 1 + Math.floor(3 * Math.sqrt(l.value / VMAX)); const tid = 'ST' + (beadLinks++);
      sc.add(`<TimeSensor DEF='${tid}' cycleInterval='${f(4 + 3 * (1 - Math.sqrt(l.value / VMAX)))}' loop='true'/>`);
      for (let b = 0; b < nb; b++) { const o = b / nb, id = `${tid}B${b}`; const kv = rot(cl, o);
        sc.add(`<Transform DEF='${id}' translation='${v(kv.vals[0])}'>${shape(sphere(0.045 + 0.05 * Math.sqrt(l.value / VMAX)), sc.app('#fff6d8', { emissive: d3.color(ncol(l.source)).brighter(0.6).formatHex(), rough: 0.2 }))}</Transform>`,
          `<PositionInterpolator DEF='${id}I' key='${kv.keys.map(k => f(k, 4)).join(' ')}' keyValue='${kv.vals.map(p => v(p)).join(' ')}'/>`,
          `<ROUTE fromNode='${tid}' fromField='fraction_changed' toNode='${id}I' toField='set_fraction'/>`, `<ROUTE fromNode='${id}I' fromField='value_changed' toNode='${id}' toField='set_translation'/>`); beads++; } }
  });
  emit('sankey', sc, { tile: 'SANKEY', title: 'Sankey canyon (pulses + tour)', flagship: true, d3: [`d3-sankey ${VERS['d3-sankey']}`, 'd3-array (rollup, rollups)'],
    gain: 'In 2D every ribbon shares one plane, so flows from different sources cross and blend. Here each source owns a depth lane and the ribbon is a solid with width = value, so you can look down the canyon and follow one demo through components to node types; the front view (viewpoint 2) is the exact D3 layout. v2 adds light beads that pulse along every ribbon above 1% of the flow (count and size by value, each an X3D PositionInterpolator) and a five-stop fly-through that follows the largest path, from the canyon mouth through the biggest demo, its biggest component and node type, to the exit.',
    numbers: { nodes: G.nodes.length, links: G.links.length, beads: (()=>beads)(), beadLinks: (()=>beadLinks)(), tourStops: 5, totalFlow: d3.sum(G.nodes.filter(n => n.depth === 0), n => n.value) } });
}

// ---------- 7. SCATTER -> 3D scatter with wall shadows
{
  const F = D.x3d_files.filter(x => x.nodes > 0);
  const sx = d3.scaleLinear().domain(d3.extent(F, x => Math.log10(x.bytes))).nice().range([-4, 4]);
  const sy = d3.scaleLinear().domain([0, d3.max(F, x => Math.log10(x.nodes + 1))]).nice().range([-4, 4]);
  const sz = d3.scaleLinear().domain(d3.extent(F, x => x.depth)).nice().range([-4, 4]);
  const sc = new Scene({ title: '3D scatter: 620 X3D files by size, node count and nesting depth', desc: 'D3Blocks Scatter re-expressed in 3D: a real third variable, with each 2D projection cast on its own wall.',
    views: [{ name: 'Oblique', pos: [9, 6, 10] }, { name: 'Front wall (bytes vs nodes)', pos: [0, 0, 14] }, { name: 'Side wall (depth vs nodes)', pos: [14, 0, 0] }],
    meta: { 'd3-modules': 'd3-scale (scaleLinear, nice, ticks), d3-array (extent)', data: 'every .x3d under x3d.demo docs/demos with at least one X3D node' } });
  const P = x => [sx(Math.log10(x.bytes)), sy(Math.log10(x.nodes + 1)), sz(x.depth)];
  // walls
  sc.add(T([0, -4.02, 0], shape(box([8, 0.02, 8]), sc.app('#10141e', { rough: 0.95 }))), T([0, 0, -4.02], shape(box([8, 8, 0.02]), sc.app('#0e121b', { rough: 0.95 }))), T([-4.02, 0, 0], shape(box([0.02, 8, 8]), sc.app('#0e121b', { rough: 0.95 }))));
  F.forEach(x => sc.add(T(P(x), shape(sphere(0.045 + 0.02 * Math.sqrt(x.kinds)), sc.app(demoColor.get(x.demo), { rough: 0.3, metal: 0.15 })))));
  sc.add(lines(sc, F.map(x => { const p = P(x); return [p, [p[0], -4, p[2]]]; }), '#39425a', { transp: 0.55 }));
  const pts = (fn, c) => shape(`<PointSet><Coordinate point='${F.map(x => v(fn(P(x)))).join(' ')}'/></PointSet>`, sc.app(c, { unlit: true, point: 3 }));
  sc.add(pts(p => [p[0], -3.99, p[2]], '#5a6a90'), pts(p => [p[0], p[1], -3.99], '#5a8a90'), pts(p => [-3.99, p[1], p[2]], '#8a6a90'));
  sx.ticks(6).forEach(t => sc.add(flatText(sc, d3.format('.0s')(10 ** t) + 'B', [sx(t), -4, 4.35], { size: 0.2, rot: [1, 0, 0, -1.5708] })));
  sy.ticks(5).forEach(t => sc.add(label(sc, d3.format('.0s')(Math.round(10 ** t - 1)), [-4.3, sy(t), 4], { size: 0.2, justify: 'END' })));
  sz.ticks(5).forEach(t => sc.add(flatText(sc, String(t), [4.35, -4, sz(t)], { size: 0.2, rot: [1, 0, 0, -1.5708] })));
  sc.add(label(sc, 'file bytes (log)', [0, -4.5, 5], { size: 0.26, color: '#ffcf8a' }), label(sc, 'X3D nodes (log)', [-4.6, 4.5, 4], { size: 0.26, color: '#ffcf8a' }), label(sc, 'nesting depth', [4.7, -4.5, 0], { size: 0.26, color: '#ffcf8a' }));
  emit('scatter', sc, { tile: 'SCATTER', title: '3D scatter', d3: ['d3-scale (scaleLinear, nice, ticks)', 'd3-array (extent)', 'd3-format'],
    gain: 'A third real variable (XML nesting depth) instead of a third encoding squeezed into size or colour, and the three 2D scatters D3 would draw are cast as shadows on the floor and two walls, so you get the 3D cloud and all of its projections in one scene.',
    numbers: { points: F.length, demos: new Set(F.map(x => x.demo)).size, maxBytes: d3.max(F, x => x.bytes), maxNodes: d3.max(F, x => x.nodes), maxDepth: d3.max(F, x => x.depth) } });
}

// ---------- 8. TIMESERIES -> ridgeline wall
{
  const order = repos.filter(r => d3.sum(daily.get(r))).slice().reverse(); // small in front
  const sm = 2, sig = 0.9, NX = (NDAYS - 1) * sm + 1;
  const series = order.map(r => { const c = daily.get(r); return d3.range(NX).map(i => { const t = i / sm; return d3.sum(c, (y, k) => y * Math.exp(-((t - k) ** 2) / (2 * sig * sig))); }); });
  const maxS = d3.max(series, s => d3.max(s)); const xs = 0.2, H = 3;
  const sc = new Scene({ title: 'Ridgeline wall: daily commits per repository', desc: 'D3Blocks Timeseries re-expressed in 3D: each series is a solid ridge in its own row, so none hides another.', shadows: true,
    views: [{ name: 'Oblique', pos: [6, 4.5, 9], at: [0, 0.8, 0] }, { name: 'Front (overlaid lines)', pos: [0, 1.6, 13], at: [0, 1.4, 0] }, { name: 'Along time', pos: [-10, 3, 1], at: [0, 0.8, 0] }],
    meta: { 'd3-modules': 'd3-array, d3-time-format, d3-scale-chromatic', data: `git log author times, ${order.length} repos with commits, 1 Oct to 18 Nov 2026 UTC, Gaussian smoothing sigma ${sig} day` } });
  const W = (NDAYS - 1) * xs, dz = 0.5, Z0 = -(order.length - 1) * dz / 2;
  sc.add(floor(sc, W + 3, order.length * dz + 2));
  order.forEach((r, i) => {
    const s = series[i], z = Z0 + i * dz, th = 0.22; const V = [], Fc = [], C = [];
    s.forEach((y, k) => { const x = k / sm * xs - W / 2, h = 0.02 + H * y / maxS; V.push([x, 0, z + th / 2], [x, h, z + th / 2], [x, h, z - th / 2], [x, 0, z - th / 2]);
      const cc = rgb(d3.color(d3.interpolateRgb(d3.color(repoColor.get(r)).darker(1.4), repoColor.get(r))(Math.min(1, 0.2 + y / maxS * 1.6))).formatHex()); C.push(cc, cc, cc, cc); });
    for (let k = 0; k < s.length - 1; k++) { const a = k * 4, b = a + 4; Fc.push([a, b, b + 1, a + 1], [a + 1, b + 1, b + 2, a + 2], [a + 2, b + 2, b + 3, a + 3]); }
    sc.add(faces(sc, V, Fc, '#ffffff', { rough: 0.5, crease: 0.9 }, C));
    sc.add(label(sc, `${r} (${d3.sum(daily.get(r))})`, [-W / 2 - 0.2, 0.25, z], { size: 0.17, justify: 'END', color: repoColor.get(r) }));
  });
  for (let k = 0; k < NDAYS; k += 7) sc.add(flatText(sc, dayLabel(k), [k * xs - W / 2, 0.01, -Z0 + 0.6], { size: 0.2, rot: [1, 0, 0, -1.5708] }));
  emit('timeseries', sc, { tile: 'TIMESERIES', title: 'Ridgeline wall', d3: ['d3-array', 'd3-time-format (utcFormat)', 'd3-scale-chromatic'],
    gain: 'Sixteen lines on one 2D axis overplot into spaghetti. Giving each series its own depth row turns them into a ridgeline you can orbit: the front view still overlays them like the D3 chart, the side view lines up every burst on the same day.',
    numbers: { series: order.length, days: NDAYS, commitsInWindow: inWindow, peakSmoothed: +maxS.toFixed(2) } });
}

// ---------- 9. ELASTIC GRAPH -> living graph v2
{
  const dates = new Map(fs.readFileSync(DATES, 'utf8').trim().split('\n').map(l => l.split(' ')).filter(x => x[1]).map(([d, t]) => [d, +t]));
  const ds = demos.filter(d => dates.has(d)).sort((a, b) => dates.get(a) - dates.get(b));
  const born = new Map(); ds.forEach((d, i) => Object.keys(usage[d]).forEach(t => { if (!born.has(t)) born.set(t, i); }));
  const nodes = [...ds.map((d, i) => ({ id: 'demo:' + d, kind: 'demo', comp: null, use: d3.sum(Object.values(usage[d])), arr: i, date: dates.get(d) })),
    ...[...born.keys()].map(t => ({ id: t, kind: 'type', comp: COMP[t], use: typeTotal.get(t), arr: born.get(t) }))];
  const links = ds.flatMap((d, i) => Object.keys(usage[d]).map(t => ({ source: 'demo:' + d, target: t, arr: i })));
  const sim = forceSimulation(nodes, 3).force('link', forceLink(links).id(d => d.id).distance(14).strength(0.08))
    .force('charge', forceManyBody().strength(d => d.kind === 'demo' ? -220 : -25)).force('x', forceX().strength(0.03)).force('y', forceY().strength(0.03)).force('z', forceZ().strength(0.03)).force('center', forceCenter()).stop();
  for (let i = 0; i < 500; i++) sim.tick();
  const ext = d3.quantile(nodes.map(n => Math.hypot(n.x, n.y, n.z)).sort(d3.ascending), 0.95); const s = 5 / ext;
  const usedComps = [...new Set(nodes.filter(n => n.kind === 'type').map(n => n.comp))].sort();
  const sc = new Scene({ title: 'Living graph: his demos and the X3D node types they use, growing through time', desc: 'D3Blocks Elasticgraph re-expressed live: d3-force-3d runs in the page and grows the graph demo by demo in the order the demos shipped; component hulls and bundled edges are rewritten through the SAI each frame.',
    views: [{ name: 'Front', pos: [0, 1, 14] }, { name: 'Above', pos: [0, 14, 1] }, { name: 'Close', pos: [4, 2, 7] }],
    meta: { 'd3-modules': `d3-force-3d ${VERS['d3-force-3d']} (live in the page)`, data: `${ds.length} x3d.demo demos in first-commit order (git log), ${born.size} X3D node types they use, ${links.length} demo-type uses`, interaction: 'page SAI: N<i> Transforms, NM<i> materials, NT<i> TouchSensors, H<i> hull Transforms, EC edge Coordinate' } });
  const cen = new Map(usedComps.map(c => { const m = nodes.filter(n => n.comp === c); return [c, [d3.mean(m, n => n.x), d3.mean(m, n => n.y), d3.mean(m, n => n.z)]]; }));
  const bez = (a, b, c) => d3.range(0, 5).map(i => { const t = i / 4, u = 1 - t; return [0, 1, 2].map(q => (u * u * a[q] + 2 * u * t * c[q] + t * t * b[q]) * s); });
  const P = n => [n.x, n.y, n.z];
  sc.add(lines(sc, links.map(l => { const cc = cen.get(l.target.comp); const m = [0, 1, 2].map(q => 0.5 * (P(l.source)[q] + P(l.target)[q]) * 0.55 + cc[q] * 0.45); return bez(P(l.source), P(l.target), m); }), '#7f8fb8', { width: 1, def: 'EDGES', coordDef: 'EC', transp: 0.55 }));
  usedComps.forEach((c, i) => sc.add(`<Transform DEF='H${i}' translation='${v(mul(cen.get(c), s))}' scale='1 1 1'>${shape(sphere(1), `<Appearance><PhysicalMaterial baseColor='${v(rgb(d3.color(compColor.get(c)).formatHex()))}' roughness='0.15' metallic='0' transparency='0.94'/></Appearance>`)}</Transform>`));
  nodes.forEach((n, i) => {
    const isD = n.kind === 'demo'; const r = isD ? 0.16 + 0.05 * Math.log10(n.use + 1) : 0.045 + 0.04 * Math.log10(n.use + 1);
    const col = rgb(d3.color(isD ? demoColor.get(n.id.slice(5)) : compColor.get(n.comp)).formatHex());
    const geom = isD ? `<Transform rotation='0.7071 0 0.7071 0.9553'>${`<Shape><Appearance><PhysicalMaterial DEF='NM${i}' baseColor='${v(col)}' roughness='0.12' metallic='0.65' emissiveColor='${v(col.map(x => x * 0.25))}'/></Appearance>${box([r * 1.5, r * 1.5, r * 1.5])}</Shape>`}</Transform>`
      : `<Shape><Appearance><PhysicalMaterial DEF='NM${i}' baseColor='${v(col)}' roughness='0.35' metallic='0.05'/></Appearance>${sphere(r)}</Shape>`;
    const lab = isD || i < ds.length + 18 ? label(sc, isD ? n.id.slice(5) : n.id, [0, r + 0.18, 0], { size: isD ? 0.2 : 0.14, color: isD ? '#ffe3a8' : '#d8deea', raw: true }) : '';
    sc.add(T([n.x * s, n.y * s, n.z * s], [`<TouchSensor DEF='NT${i}' description='${esc(n.id)}'/>`, geom, lab], { def: 'N' + i }));
  });
  fs.writeFileSync(path.join(OUT, 'living.json'), JSON.stringify({ scale: s, comps: usedComps, demos: ds.map(d => ({ id: d, date: new Date(dates.get(d) * 1000).toISOString().slice(0, 10) })),
    nodes: nodes.map(n => ({ id: n.id, kind: n.kind, comp: n.comp, arr: n.arr, x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2) })), links: links.map(l => ({ s: l.source.id, t: l.target.id, arr: l.arr })) }));
  emit('living', sc, { tile: 'ELASTICGRAPH', title: 'Living graph (live, grows through time)', d3: [`d3-force-3d ${VERS['d3-force-3d']} running in the browser`], flagship: true,
    gain: 'The bridge running live, and in time: press Play and the graph grows demo by demo in the order they shipped (first commit in x3d.demo), each arrival re-heating the 3D forces so its node types pull into place. Demos are metallic crystals, node types are spheres coloured by X3D component, every component is a translucent hull sphere that resizes as its types gather, and edges bend toward their component (bundling) so the structure reads as lobes, not a hairball. Click any node to isolate it with its neighbours. D3 owns the physics; X3D owns light, material, picking and navigation.',
    numbers: { demos: ds.length, types: born.size, uses: links.length, components: usedComps.length, firstDemo: new Date(dates.get(ds[0]) * 1000).toISOString().slice(0, 10), lastDemo: new Date(dates.get(ds[ds.length - 1]) * 1000).toISOString().slice(0, 10) } });
}

// ---------- 10. CIRCLE PACKING -> stacked sphere packing
{
  const grouped = {};
  for (const [demo, vs] of Object.entries(D.demo_tree)) { if (typeof vs !== 'object') continue; grouped[demo] = {};
    for (const [ver, files] of Object.entries(vs)) { const g = grouped[demo][ver] = {}; if (typeof files !== 'object') { g['(file)'] = files; continue; }
      for (const [fn, val] of Object.entries(files)) { const ext = typeof val === 'object' ? 'folder' : ((fn.match(/\.([a-z0-9]+)$/i) || [, 'other'])[1].toLowerCase()); const b = typeof val === 'object' ? d3.sum(Object.values(val).flat(), x => typeof x === 'number' ? x : 0) || 1 : val; g[ext] = (g[ext] || 0) + b; } } }
  const root = d3.hierarchy(toNode('demos', grouped)).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
  d3.pack().size([11, 11]).padding(0.05)(root);
  const exts = [...new Set(root.leaves().map(l => l.data.name))]; const extTop = d3.rollups(root.leaves(), v => d3.sum(v, x => x.value), l => l.data.name).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const extColor = new Map(extTop.map((e, i) => [e, i < 10 ? d3.schemeTableau10[i] : '#8a90a0']));
  const sc = new Scene({ title: 'Sphere packing: demos, versions and file types by bytes', desc: 'D3Blocks CirclePacking re-expressed in 3D: each level of the pack is a tier, and the leaves are spheres resting on their parent.', shadows: true,
    views: [{ name: 'Oblique', pos: [7, 8, 9] }, { name: 'Top (the 2D pack)', pos: [0, 15, 0.01] }, { name: 'Low', pos: [0, 1.4, 9], at: [0, 0.6, 0] }],
    meta: { 'd3-modules': 'd3-hierarchy (pack), d3-scale-chromatic (schemeTableau10)', data: 'git ls-files sizes, x3d.demo docs/demos, grouped demo / version / file extension' } });
  const C = 5.5;
  root.descendants().forEach(n => {
    if (!n.depth) { sc.add(T([0, -0.03, 0], shape(cyl(n.r, 0.04), sc.app('#0d1018', { rough: 0.95 })))); return; }
    if (n.children) { const y = (n.depth - 1) * 0.22; sc.add(T([n.x - C, y + 0.02, n.y - C], shape(cyl(n.r, 0.04), sc.app(n.depth === 1 ? demoColor.get(n.data.name) : '#2a3044', { rough: 0.6, transp: n.depth === 1 ? 0.55 : 0.3 })))); }
    else { const y = (n.depth - 1) * 0.22 + n.r; sc.add(T([n.x - C, y, n.y - C], shape(sphere(n.r * 0.97), sc.app(extColor.get(n.data.name), { rough: 0.25, metal: 0.2 })))); }
  });
  root.children.slice(0, 14).forEach(n => sc.add(label(sc, n.data.name, [n.x - C, 0.3 + Math.min(n.r, 2) * 0.9, n.y - C], { size: 0.2 })));
  extTop.slice(0, 10).forEach((e, i) => sc.add(label(sc, e, [-6.4, 3 - i * 0.3, -5], { size: 0.2, color: extColor.get(e), justify: 'BEGIN' })));
  emit('circlepacking', sc, { tile: 'CIRCLEPACKING', title: 'Sphere packing', d3: ['d3-hierarchy (pack)', 'd3-scale-chromatic (schemeTableau10)'],
    gain: 'Circle packing shows nesting only as circles inside circles; deep levels get tiny and flat. Lifting each level onto its own tier and turning the leaves into spheres lets you read nesting as height and bytes as volume, and low viewpoints show which demo is heavy with images versus scenes at a glance.',
    numbers: { demos: root.children.length, leaves: root.leaves().length, extensions: exts.length, totalBytes: root.value } });
}

// ---------- 11. VIOLIN -> violins of revolution
{
  const rs = repos.filter(r => D.commits[r].length >= 10);
  const grid = d3.range(0, 24.01, 0.5), bw = 1.4;
  const hours = r => D.commits[r].map(t => ((t % DAY) / 3600));
  const kde = hs => grid.map(g => d3.sum(hs, h => { let d = Math.abs(g - h); d = Math.min(d, 24 - d); return Math.exp(-d * d / (2 * bw * bw)); }) / (hs.length * bw * Math.sqrt(2 * Math.PI)));
  const dens = rs.map(r => kde(hours(r))); const maxD = d3.max(dens, d => d3.max(d)); const Hy = 0.27;
  const sc = new Scene({ title: 'Violins of revolution: what hour (UTC) each repository is committed to', desc: 'D3Blocks Violin re-expressed in 3D: each kernel density is spun into a solid, so mass reads as volume.', shadows: true,
    views: [{ name: 'Front', pos: [0, 3.3, 13], at: [0, 3.2, 0] }, { name: 'Oblique', pos: [8, 6, 9], at: [0, 3, 0] }],
    meta: { 'd3-modules': 'd3-array (sum, quantile), d3-scale-chromatic', data: `git log author times by hour of day UTC, ${rs.length} repos with at least 10 commits, circular Gaussian KDE bandwidth ${bw} h` } });
  const sp = 1.05, X0 = -(rs.length - 1) * sp / 2;
  sc.add(floor(sc, rs.length * sp + 2, 3));
  sc.add(lines(sc, d3.range(0, 25, 3).map(h => [[X0 - 0.8, h * Hy, -0.7], [-X0 + 0.8, h * Hy, -0.7]]), '#2c3346'));
  d3.range(0, 25, 3).forEach(h => sc.add(label(sc, `${String(h).padStart(2, '0')}:00`, [X0 - 1.1, h * Hy, -0.7], { size: 0.17, color: '#8c94a8', justify: 'END' })));
  rs.forEach((r, i) => {
    const x = X0 + i * sp; const rad = dens[i].map(d => 0.48 * d / maxD);
    sc.add(T([x, 0, 0], shape(revolve(grid.map(g => g * Hy), rad, 32), sc.app(repoColor.get(r), { rough: 0.35, metal: 0.1 }))));
    const hs = hours(r).sort(d3.ascending); const q = [0.25, 0.5, 0.75].map(p => d3.quantile(hs, p));
    q.forEach((qq, k) => { const di = Math.round(qq * 2); sc.add(T([x, qq * Hy, 0], shape(cyl(rad[di] + 0.035, k === 1 ? 0.035 : 0.018), sc.app(k === 1 ? '#ffd27a' : '#e8eaf0', { rough: 0.2, metal: 0.8 })))); });
    sc.add(label(sc, [r, `${D.commits[r].length}`], [x, -0.35, 0.4], { size: 0.14, color: repoColor.get(r) }));
  });
  emit('violin', sc, { tile: 'VIOLIN', title: 'Violins of revolution', d3: ['d3-array (sum, quantile)', 'd3-scale-chromatic'],
    gain: 'A 2D violin mirrors the density for symmetry only. Spinning it into a solid of revolution makes the mirror meaningful: volume reads as mass, so you see where the work piles up across the day; the gold ring is the median and the silver rings the quartiles.',
    numbers: { repos: rs.length, commits: d3.sum(rs, r => D.commits[r].length), bandwidthHours: bw } });
}

// ---------- 12. IMAGE SLIDER -> relief slider
{
  const { w, h, rgb: px } = RELIEF; const lum = RELIEF.lum;
  const sp = 0.08, Hm = 1.1;
  const sc = new Scene({ title: 'Relief slider: a demo still as flat image and as terrain', desc: 'D3Blocks ImageSlider re-expressed in 3D: the slider morphs between the flat picture and a relief whose height is luminance.',
    views: [{ name: 'Oblique', pos: [0, 4.2, 7.2], at: [0, 0.2, 0.3] }, { name: 'Top (flat image)', pos: [0, 9, 0.01] }, { name: 'Grazing', pos: [-6.5, 1.1, 3], at: [0, 0.3, 0] }],
    lights: [`<DirectionalLight direction='-0.8 -0.45 -0.3' intensity='1.25' color='1 0.95 0.86' shadows='true' shadowIntensity='0.45'/>`, `<DirectionalLight direction='0.4 -0.8 0.5' intensity='0.55' color='1 0.97 0.92'/>`, `<DirectionalLight direction='0 -1 0' intensity='0.3' color='1 1 1'/>`],
    meta: { 'd3-modules': 'PIL luminance (Gaussian blur 0.8 px) at harvest, page slider', data: `${RELIEF.src} (sha256 ${RELIEF.sha256}...), downsampled to ${w} x ${h}` } });
  const eg = `<ElevationGrid xDimension='${w}' zDimension='${h}' xSpacing='${f(sp)}' zSpacing='${f(sp)}' creaseAngle='1.2' solid='false' colorPerVertex='true' height='${lum.map(l => f(l * Hm, 3)).join(' ')}'><Color color='${px.map(c => v(c.map(x => x / 255), 3)).join(' ')}'/></ElevationGrid>`;
  sc.add(`<Transform DEF='RELIEF' translation='${v([-(w - 1) * sp / 2, 0, -(h - 1) * sp / 2])}'><Transform DEF='SQUASH' scale='1 1 1'>${shape(eg, sc.app('#ffffff', { rough: 0.9 }))}</Transform></Transform>`,
    `<TimeSensor DEF='CLOCK' cycleInterval='9' loop='true'/>`,
    `<PositionInterpolator DEF='MORPH' key='0 0.35 0.5 0.85 1' keyValue='1 0.01 1 1 0.01 1 1 1 1 1 1 1 1 0.01 1'/>`,
    `<ROUTE fromNode='CLOCK' fromField='fraction_changed' toNode='MORPH' toField='set_fraction'/>`,
    `<ROUTE fromNode='MORPH' fromField='value_changed' toNode='SQUASH' toField='set_scale'/>`);
  emit('relief', sc, { tile: 'IMAGESLIDER', title: 'Relief slider', d3: ['harvest-time luminance', 'page range input via SAI'],
    gain: 'A 2D before/after slider wipes between two pictures. In 3D the second picture is the same image raised into terrain by luminance, so the slider becomes a morph and grazing light reveals structure that colour alone hides.',
    numbers: { width: w, height: h, vertices: w * h } });
}

// ---------- 13. RADIAL GRAPH -> type sphere (X3D 4.0 inheritance)
{
  const inh = D.uom.inherit; const names = Object.keys(inh); const rootName = 'X3DNode';
  const parentOf = n => (n === rootName ? null : (inh[n] && inh[n] in inh ? inh[n] : rootName));
  const rows = names.filter(n => n !== rootName && (inh[n] !== undefined)).map(n => ({ id: n, parentId: parentOf(n) })); rows.push({ id: rootName, parentId: null });
  const conc = new Set(D.uom.concrete);
  const root = d3.stratify()(rows).sort((a, b) => d3.ascending(COMP[a.id] || '', COMP[b.id] || '') || d3.ascending(a.id, b.id));
  d3.cluster().size([1, 1])(root);
  const leaves = root.leaves(); const R = 4.4, N = leaves.length; const dir = new Map();
  leaves.forEach((l, i) => { const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = i * Math.PI * (3 - Math.sqrt(5)); dir.set(l, [r * Math.cos(th), y, r * Math.sin(th)]); });
  root.eachAfter(n => { if (n.children) dir.set(n, norm(n.children.reduce((s, c) => add(s, dir.get(c)), [0, 0, 0]))); });
  const maxDepth = root.height; const pos = n => mul(dir.get(n), n.children ? R * 0.88 * n.depth / maxDepth : R);
  const sc = new Scene({ title: 'Type sphere: the X3D 4.0 node hierarchy', desc: 'D3Blocks RadialGraph re-expressed in 3D: a radial tree whose leaves lie on a sphere, coloured by component; nodes his demos use glow.',
    views: [{ name: 'Front', pos: [0, 2, 12] }, { name: 'Pole', pos: [0, 12, 0.5] }, { name: 'Inside the abstract core', pos: [1.5, 1, 3.5] }],
    meta: { 'd3-modules': 'd3-hierarchy (stratify, cluster), d3-scale-chromatic', data: `X3D 4.0 X3DUOM (x3d_mcp ${D.repos.find(r => r.name === 'x3d_mcp').head}), primary inheritance; usage from x3d.demo` } });
  const segs = [], segCol = [];
  root.links().forEach(({ source, target }) => {
    const a = pos(source), b = pos(target), pts = d3.range(0, 7).map(k => { const t = k / 6; const dd = norm(add(mul(dir.get(source), 1 - t), mul(dir.get(target), t))); const rr = len(a) * (1 - t) + len(b) * t; return mul(dd, rr); });
    segs.push(source.depth === 0 ? [a, b] : pts); segCol.push(compColor.get(COMP[target.id]) || '#7a8299');
  });
  sc.add(lines(sc, segs, '#7a8299', { colors: segCol, transp: 0.25 }));
  let usedN = 0;
  root.descendants().forEach(n => {
    const used = typeTotal.has(n.id); if (used) usedN++;
    const p = pos(n); const c = compColor.get(COMP[n.id]) || '#9aa3b5';
    if (!conc.has(n.id)) { sc.add(T(p, shape(sphere(0.07 + 0.012 * n.leaves().length ** 0.5), sc.app('#c8cede', { rough: 0.2, metal: 0.7 })))); if (n.leaves().length >= 6 || n.depth <= 1) sc.add(label(sc, n.id, add(p, [0, 0.2, 0]), { size: 0.15, color: '#c8cede' })); }
    else sc.add(T(p, shape(sphere(used ? 0.11 : 0.06), sc.app(c, { rough: 0.35, emissive: used ? d3.color(c).darker(0.8).formatHex() : null, transp: used ? 0 : 0.4 }))));
    if (conc.has(n.id) && used && typeTotal.get(n.id) > 300) sc.add(label(sc, n.id, mul(p, 1.07), { size: 0.15 }));
  });
  emit('radial', sc, { tile: 'RADIALGRAPH', title: 'Type sphere', d3: ['d3-hierarchy (stratify, cluster)', 'd3-scale-chromatic'],
    gain: 'A radial tree spreads its leaves around one circle: 260 X3D node types would be packed at under 1.4 degrees apart. On a sphere the leaves get a whole surface (Fibonacci spiral in D3 cluster order), abstract types sit inside at their depth, and the types his demos actually use glow, so the used part of the spec shows as lit regions.',
    numbers: { types: root.descendants().length, concrete: conc.size, leaves: N, depth: maxDepth, usedByDemos: [...typeTotal.keys()].filter(t => conc.has(t)).length } });
}

// ---------- 14. TREE -> cone tree (Robertson, Mackinlay and Card, 1991)
{
  const dirsOnly = t => Object.fromEntries(Object.entries(t).filter(([, x]) => x && typeof x === 'object').map(([k, x]) => [k, dirsOnly(x)]));
  const countFiles = t => d3.sum(Object.values(t), x => typeof x === 'object' ? countFiles(x) : 1);
  const mk = (name, t) => ({ name, files: countFiles(t), children: Object.entries(t).filter(([, x]) => x && typeof x === 'object').map(([k, x]) => mk(k, x)) });
  const root = d3.hierarchy(mk('x3d.loom', D.loom_tree)).sort((a, b) => b.data.files - a.data.files);
  const LH = 2.1, Rlev = [0, 4.6, 1.25, 0.45];
  root.x = 0; root.y = 0; root.z = 0;
  root.each(n => { if (!n.children) return; const k = n.children.length; const r = Math.min(Rlev[n.depth + 1] || 0.4, Math.max(0.35, k * 0.22)); n.cr = r;
    n.children.forEach((c, i) => { const a = i / k * 2 * Math.PI + n.depth * 0.6; c.x = n.x + r * Math.cos(a); c.z = n.z + r * Math.sin(a); c.y = n.y - LH; }); });
  const sc = new Scene({ title: 'Cone tree: the folders of x3d.loom', desc: 'D3Blocks Tree re-expressed as a cone tree: every parent is the apex of a translucent cone, its children ring the base.', shadows: true,
    views: [{ name: 'Oblique', pos: [7, 3, 9], at: [0, -3, 0] }, { name: 'Below', pos: [0, -12, 0.5], at: [0, -3, 0] }, { name: 'Side (the 2D tree)', pos: [0, -3, 13], at: [0, -3, 0] }],
    meta: { 'd3-modules': 'd3-hierarchy (hierarchy, each, sum)', data: `x3d.loom git ls-files at ${D.repos.find(r => r.name === 'x3d.loom').head}, folders to depth 2` } });
  let cones = 0;
  root.each(n => {
    const c = n.depth === 0 ? '#ffd27a' : d3.interpolateTurbo(0.15 + 0.7 * ((root.children.indexOf(n.ancestors().find(a => a.depth === 1)) + 0.5) / root.children.length));
    if (n.children) { cones++; sc.add(T([n.x, n.y - LH / 2, n.z], shape(`<Cone bottomRadius='${f(n.cr)}' height='${f(LH)}' bottom='false' solid='false'/>`, sc.app(c, { rough: 0.5, transp: 0.78 })))); }
    sc.add(T([n.x, n.y, n.z], shape(sphere(0.06 + 0.05 * Math.log10(n.data.files + 1)), sc.app(c, { rough: 0.3, metal: 0.3, emissive: d3.color(c).darker(2).formatHex() }))));
    if (n.depth <= 1) sc.add(label(sc, `${n.data.name} (${n.data.files})`, [n.x, n.y + 0.32, n.z], { size: n.depth ? 0.17 : 0.26, color: n.depth ? '#d8deea' : '#ffd27a' }));
  });
  sc.add(lines(sc, root.links().map(l => [[l.source.x, l.source.y, l.source.z], [l.target.x, l.target.y, l.target.z]]), '#6f7ea3', { transp: 0.3 }));
  emit('conetree', sc, { tile: 'TREE', title: 'Cone tree', d3: ['d3-hierarchy (hierarchy, each)'],
    gain: 'A tidy tree grows only sideways, so a wide level (x3d.loom has many top folders) runs off the page. The cone tree (Xerox PARC, 1991) spends the third dimension on breadth: children ring their parent, so a level of any width fits in one cone and the translucent cones show each family as a unit.',
    numbers: { folders: root.descendants().length, cones, depth: root.height, files: root.data.files } });
}

// ---------- 15. MAPS -> globe + Equal Earth plate
function png(w, h, rgbFn) {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const c = rgbFn(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
{
  const world = JSON.parse(fs.readFileSync(new URL('./node_modules/world-atlas/countries-110m.json', import.meta.url))); const land = topojson.feature(world, world.objects.land); const countries = topojson.feature(world, world.objects.countries).features;
  const R = 3, LL = ([lon, lat], r = R) => { const a = lon * Math.PI / 180, b = lat * Math.PI / 180; return [r * Math.cos(b) * Math.sin(a), r * Math.sin(b), r * Math.cos(b) * Math.cos(a)]; };
  // texture: equirectangular land mask from d3.geoContains, 512 x 256
  const TW = 512, TH = 256; const mask = new Uint8Array(TW * TH);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) mask[y * TW + x] = d3.geoContains(land, [-180 + (x + 0.5) * 360 / TW, 90 - (y + 0.5) * 180 / TH]) ? 1 : 0;
  const landCol = d3.scaleLinear().domain([0, 45, 90]).range(['#7d9a5a', '#b7a77a', '#e8eef4']); const seaCol = d3.scaleLinear().domain([0, 90]).range(['#0e2a4a', '#1a3f66']);
  fs.writeFileSync(path.join(OUT, 'scenes', 'globe-land.png'), png(TW, TH, (x, y) => { const lat = Math.abs(90 - (y + 0.5) * 180 / TH); const c = d3.color(mask[y * TW + x] ? landCol(lat) : seaCol(lat)); return [c.r, c.g, c.b]; }));
  // sphere mesh with our own texture coordinates (lon 0 faces +Z)
  const NL = 72, NB = 36, V = [], TC = [], Fc = [];
  for (let j = 0; j <= NB; j++) for (let i = 0; i <= NL; i++) { const lon = -180 + 360 * i / NL, lat = -90 + 180 * j / NB; V.push(LL([lon, lat])); TC.push([i / NL, j / NB]); }
  for (let j = 0; j < NB; j++) for (let i = 0; i < NL; i++) { const a = j * (NL + 1) + i; Fc.push([a, a + 1, a + NL + 2, a + NL + 1]); }
  const sc = new Scene({ title: 'Globe: the d3-geo world on a sphere, with the flat Equal Earth map beneath', desc: 'D3Blocks Maps re-expressed in 3D: the same TopoJSON features drawn on a sphere (no projection distortion) above the 2D projection D3 would draw.',
    views: [{ name: 'The project world (arcs)', pos: [-4.9, 4.2, 8.6], at: [0, 0.9, 0] }, { name: 'Globe', pos: [0, 1.5, 10], at: [0, 0.6, 0] }, { name: 'Globe and plate', pos: [8, 3, 9], at: [0, -1.5, 0] }, { name: 'Plate from above', pos: [0, 6, 0.01], at: [0, -4.4, 0] }],
    meta: { 'd3-modules': 'd3-geo (geoContains, geoArea, geoCentroid, geoInterpolate, geoGraticule10, geoEqualEarth, geoPath), topojson-client', data: `world-atlas ${VERS['world-atlas']} countries-110m (Natural Earth, public domain)` } });
  sc.add(T([0, 0.6, 0], [shape(`<IndexedFaceSet solid='true' creaseAngle='3.14' coordIndex='${Fc.map(q => q.join(' ') + ' -1').join(' ')}'><Coordinate point='${V.map(p => v(p, 4)).join(' ')}'/><TextureCoordinate point='${TC.map(t => v(t, 4)).join(' ')}'/></IndexedFaceSet>`,
    `<Appearance><PhysicalMaterial baseColor='1 1 1' roughness='0.55' metallic='0'/><ImageTexture url='"globe-land.png"'/></Appearance>`),
    // atmosphere shell
    shape(sphere(R * 1.035), sc.app('#4aa8ff', { unlit: true, transp: 0.9 })),
    // graticule + outlines
    lines(sc, d3.geoGraticule10().coordinates.map(l => l.map(p => LL(p, R * 1.002))), '#3f6a98', { transp: 0.6 }),
    lines(sc, countries.flatMap(fe => (fe.geometry.type === 'Polygon' ? [fe.geometry.coordinates] : fe.geometry.coordinates).flatMap(poly => poly.map(ring => {
      const out = []; for (let i = 0; i < ring.length; i++) { out.push(LL(ring[i], R * 1.004)); if (i + 1 < ring.length && d3.geoDistance(ring[i], ring[i + 1]) > 0.035) { const ip = d3.geoInterpolate(ring[i], ring[i + 1]); const n = Math.ceil(d3.geoDistance(ring[i], ring[i + 1]) / 0.035); for (let k = 1; k < n; k++) out.push(LL(ip(k / n), R * 1.004)); } } return out; }))), '#e9f1ff', { transp: 0.35 }),
    ...(() => { const areas = countries.map(fe => ({ fe, km2: d3.geoArea(fe) * 6371.0088 ** 2, c: d3.geoCentroid(fe) })).sort((a, b) => b.km2 - a.km2); const mx = areas[0].km2; const sp = [];
      areas.forEach((a, i) => { const h = 0.08 + 1.5 * Math.sqrt(a.km2 / mx); const n = norm(LL(a.c)); const col = d3.interpolateYlOrRd(0.25 + 0.75 * Math.sqrt(a.km2 / mx));
        sp.push(T(mul(n, R + h / 2), shape(cyl(0.028, h), sc.app(col, { rough: 0.3, emissive: d3.color(col).darker(1.5).formatHex() })), { r: rotY(n) }));
        if (i < 12) sp.push(label(sc, `${a.fe.properties.name} ${d3.format('.2s')(a.km2)} km²`, mul(n, R + h + 0.2), { size: 0.15 })); });
      return sp; })()]));
  // v2: the project's own world: great-circle arcs from the home lab to each twin site, beacons by commits
  const HOME = { name: 'Blacksburg (Burruss Hall, geotiling)', ll: [-80.4244, 37.2296], commits: SITE_COMMITS.blacksburg };
  const SITES = [{ name: 'Giza (Osiris Hall, heritage-geo)', ll: [31.1342, 29.9792], commits: SITE_COMMITS.giza }, { name: 'Hawara (labyrinth study, in Giza VI)', ll: [30.8986, 29.2744], commits: SITE_COMMITS.giza },
    { name: 'Rome (Pantheon facade splats)', ll: [12.4769, 41.8986], commits: SITE_COMMITS.rome }, { name: 'Turin (Shroud lane, not in x3d.demo)', ll: [7.6858, 45.0703], commits: 0 },
    { name: 'Yerevan (Mashtots, x3d.mashtots)', ll: [44.5152, 40.1872], commits: SITE_COMMITS.yerevan }];
  const arcs = [];
  const beacon = (st, col) => { const n = norm(LL(st.ll)); const h = 0.2 + 0.32 * Math.log2(1 + st.commits);
    arcs.push(T(mul(n, R + h / 2), shape(cyl(0.05, h), sc.app(col, { emissive: col, rough: 0.2 })), { r: rotY(n) }), T(mul(n, R + h), shape(sphere(0.08), sc.app('#ffffff', { emissive: col }))),
      label(sc, `${st.name}: ${st.commits} commits`, add(mul(n, R + h + 0.25), [0, 0.6, 0]), { size: 0.17, color: col, pri: col === '#7fffd4' ? 200 : 100 + st.commits })); };
  beacon(HOME, '#7fffd4');
  SITES.forEach((st, i) => { const g = d3.geoInterpolate(HOME.ll, st.ll), ang = d3.geoDistance(HOME.ll, st.ll);
    const pts = d3.range(0, 41).map(k => { const t = k / 40; return LL(g(t), R * (1.004 + 0.35 * ang * Math.sin(Math.PI * t))); });
    arcs.push(shape(tube(pts, 0.022, 8), sc.app('#ffd27a', { emissive: '#8a5a10', rough: 0.3, transp: 0.15 })));
    arcs.push(`<Transform DEF='AB${i}' translation='${v(pts[0])}'>${shape(sphere(0.07), sc.app('#fff3c4', { emissive: '#ffb84a' }))}</Transform>`, `<TimeSensor DEF='ABT${i}' cycleInterval='${f(3 + i * 0.6)}' loop='true'/>`,
      `<PositionInterpolator DEF='ABI${i}' key='${pts.map((_, k) => f(k / 40)).join(' ')}' keyValue='${pts.map(p => v(p)).join(' ')}'/>`,
      `<ROUTE fromNode='ABT${i}' fromField='fraction_changed' toNode='ABI${i}' toField='set_fraction'/>`, `<ROUTE fromNode='ABI${i}' fromField='value_changed' toNode='AB${i}' toField='set_translation'/>`);
    beacon(st, '#ffd27a'); });
  sc.add(T([0, 0.6, 0], arcs));
  // Equal Earth plate
  const proj = d3.geoEqualEarth().fitExtent([[-5, -2.6], [5, 2.6]], { type: 'Sphere' });
  const plate = countries.flatMap(fe => (fe.geometry.type === 'Polygon' ? [fe.geometry.coordinates] : fe.geometry.coordinates).flatMap(poly => poly.map(ring => ring.map(p => { const [x, y] = proj(p); return [x, 0, y]; }))));
  const outline = d3.range(0, 361, 4).map(lon => proj([lon - 180, 89.9])).concat(d3.range(0, 361, 4).map(lon => proj([180 - lon, -89.9]))).map(([x, y]) => [x, 0, y]);
  sc.add(T([0, -4.4, 0], [shape(box([10.6, 0.04, 5.8]), sc.app('#0b1424', { rough: 0.9 })), T([0, 0.03, 0], [lines(sc, plate, '#9fc1ea'), lines(sc, [outline.concat([outline[0]])], '#3f6a98')])]));
  emit('globe', sc, { tile: 'MAPS', title: 'Project globe', flagship: true, d3: ['d3-geo (geoContains, geoArea, geoCentroid, geoInterpolate, geoGraticule10, geoEqualEarth)', 'topojson-client'],
    gain: 'Every flat map trades one distortion for another. On a sphere the countries keep true shape and the spikes (height = sqrt of area from d3.geoArea) stand on the real surface; the Equal Earth plate below is the exact 2D projection D3 would draw from the same features, so you can compare the two. v2 adds the project\'s own world: great-circle arcs (d3.geoInterpolate, lifted in proportion to their length) fly from Blacksburg to Giza, Hawara, Rome, Turin and Yerevan, beads ride them, and each site carries a beacon whose height is log2 of the commits behind that site\'s work.',
    numbers: { arcs: 5, sites: 6, countries: countries.length, textureLandPixels: d3.sum(mask), texture: `${TW}x${TH}`, meshVertices: V.length } });
}

// ---------- 16. PARTICLES -> particle type in depth
{
  const FONT = { D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'], '>': ['00000', '00100', '00010', '11111', '00010', '00100', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'] };
  const text = 'D3 > X3D'; const px = 0.165, per = 7; const rnd = d3.randomLcg(20261118); const nrm = d3.randomNormal.source(rnd)(0, 1);
  const target = [];
  [...text].forEach((ch, ci) => FONT[ch].forEach((row, ry) => [...row].forEach((b, rx) => { if (b === '1') for (let k = 0; k < per; k++) target.push([(ci * 6 + rx) * px + nrm() * 0.035, (6 - ry) * px + nrm() * 0.035, nrm() * 0.22]); })));
  const W = (text.length * 6 - 1) * px; target.forEach(p => { p[0] -= W / 2; p[1] -= 3 * px; });
  const cloud = target.map(() => { const u = rnd() * 2 - 1, th = rnd() * 2 * Math.PI, r = 5 * Math.cbrt(rnd()); const s = Math.sqrt(1 - u * u); return [r * s * Math.cos(th), r * u, r * s * Math.sin(th)]; });
  const swirl = target.map((p, i) => { const a = 1.3; return [p[0] * Math.cos(a) - p[2] * 2.5 * Math.sin(a), p[1] * 1.8, p[0] * Math.sin(a) + p[2] * 2.5 * Math.cos(a)]; });
  const sc = new Scene({ title: 'Particle type: D3 > X3D in depth', desc: 'D3Blocks Particles re-expressed in 3D: particles fly from a cloud into letters that have real thickness, then swirl apart.', lights: false,
    bg: { sky: ['#020308', '#060a16'], ground: ['#020308'] },
    views: [{ name: 'Front', pos: [0, 0, 8.5] }, { name: 'Three-quarter (depth)', pos: [5, 1.6, 5.5] }],
    meta: { 'd3-modules': 'd3-random (randomLcg seed 20261118, randomNormal), d3-scale-chromatic (interpolateTurbo)', data: 'a 5 x 7 bitmap font drawn in this file' } });
  const cols = target.map(p => d3.interpolateTurbo(0.1 + 0.8 * (p[0] + W / 2) / W));
  const kv = [target, target, swirl, cloud, target].map(a => a.map(p => v(p, 3)).join(' ')).join(' ');
  sc.add(shape(`<PointSet><Coordinate DEF='PTS' point='${target.map(p => v(p, 3)).join(' ')}'/><Color color='${cols.map(c => v(rgb(c), 3)).join(' ')}'/></PointSet>`, sc.app('#ffffff', { unlit: true, point: 5 })),
    `<TimeSensor DEF='CLOCK' cycleInterval='10' loop='true'/>`,
    `<CoordinateInterpolator DEF='FLY' key='0 0.3 0.5 0.7 1' keyValue='${kv}'/>`,
    `<ROUTE fromNode='CLOCK' fromField='fraction_changed' toNode='FLY' toField='set_fraction'/>`,
    `<ROUTE fromNode='FLY' fromField='value_changed' toNode='PTS' toField='set_point'/>`);
  emit('particles', sc, { tile: 'PARTICLES', title: 'Particle type', d3: ['d3-random (randomLcg, randomNormal)', 'd3-scale-chromatic (interpolateTurbo)'],
    gain: 'Flat particle text has only x and y to scatter into. Here the letters have real thickness (sigma 0.22 in z), the scatter is a 3D cloud, and a swirl phase rotates the word through depth, so orbiting mid-animation shows parallax that a 2D canvas cannot.',
    numbers: { particles: target.length, glyphs: text.replace(/ /g, '').length, keyframes: 5 } });
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ built: new Date().toISOString().slice(0, 16) + 'Z', versions: VERS, sources: SRC_REPOS, harvested: D.source, totals: { commits: totalCommits, commitsInWindow: inWindow, x3dFiles: D.x3d_files.length, typesUsed: typesByUse.length, components: comps.length, concrete: D.uom.concrete.length }, charts: manifest }, null, 1));
console.log('charts', manifest.length);
