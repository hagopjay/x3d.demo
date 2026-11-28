// TIDEWRIGHT levels. Spring Melt: a valley along +X with a meandering river, a town on the north floodplain behind
// an old levee with a low spot, the south farmland behind a natural bank ridge (a washland, if someone opens it),
// a clay sill in the narrows downstream, and a still tarn up in the north hills. Written as an X3D 4.0 file: an
// ElevationGrid whose heights ARE the solver's bed (cell centres at the grid's vertices), and a MetadataSet
// name='kansei:tidewright-level' with the hydrograph, materials, houses, levee, gauge, tarn, budget and inflow.
// The game and the tests read the shipped file back (fromX3D); tests/level.test.mjs checks it is this output.
import { parseXML, nums, strs, metaSet, findAll } from './x3dxml.js';

export const MATERIALS = [
  { id: 0, name: 'grass', manning: 0.035, dig: true, raise: true, color: [0.36, 0.52, 0.27] },
  { id: 1, name: 'sand', manning: 0.03, dig: true, raise: true, color: [0.72, 0.64, 0.45] },
  { id: 2, name: 'clay', manning: 0.03, dig: true, raise: true, color: [0.58, 0.45, 0.3] },
  { id: 3, name: 'rock', manning: 0.04, dig: false, raise: true, color: [0.47, 0.46, 0.44] },
  { id: 4, name: 'willow', manning: 0.08, dig: true, raise: true, color: [0.3, 0.42, 0.24] },
  { id: 5, name: 'town', manning: 0.06, dig: false, raise: false, color: [0.55, 0.52, 0.48] },
  { id: 6, name: 'farmland', manning: 0.04, dig: true, raise: true, color: [0.55, 0.5, 0.3] },
];

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const SPRING_MELT = {
  id: 'spring-melt', name: 'Spring Melt', tagline: 'The snow is going off the fells all at once. The river will rise toward the town by noon.',
  nx: 128, nz: 80, dx: 10,
  // hydrograph (s, m^3/s): base flow, the melt pulse, recession
  hydrograph: [[0, 30], [1200, 45], [3600, 190], [4800, 290], [6000, 270], [7800, 150], [9600, 80], [10800, 55]],
  duration: 10800,
  budget: 140000, costPerM3: 9, sandbagCost: 1600, sandbags: 30, sandbagHeight: 0.6,
  houseFloor: 0.3,
  hCap: 6, uCap: 4,
  seed: 7,
};

/** River centreline z (m) at x (m). */
export function riverZ(x) { return 360 + 55 * Math.sin((2 * Math.PI * x) / 760 + 0.5); }
/** The old levee's line on the north bank. */
export const leveeZ = (x) => riverZ(x) + 52;
export const BASE = (x) => 26 - 0.0022 * x;                  // floodplain level falls 2.8 m over 1.27 km

export const TERRAIN = {
  chanDepth: 3.0, chanHalf: 17, northFP: 0.45, southFP: -0.55, ridge: 1.7, leveeCrest: 1.15, lowSpot: 0.5,
  sill: 1.9, terrace: 1.9, leveeX: [560, 1070], ridgeX: [0, 1000], sillX: 1145,
};

export function generate(design = SPRING_MELT, P = TERRAIN) {
  const { nx, nz, dx } = design, N = nx * nz;
  const bed = new Float64Array(N), mat = new Uint8Array(N);
  const lowSpot = (x) => Math.exp(-(((x - 900) / 30) ** 2));
  const pinch = (x) => smooth(980, 1080, x) * (1 - smooth(1200, 1260, x));
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * dx, z = j * dx, k = j * nx + i;
      const zc = riverZ(x), dz = z - zc, ad = Math.abs(dz);
      let b = BASE(x), m = 0;
      // floodplains: the town's side (north) above the farmland (south); upstream of the levee the north side is
      // a terrace, so the town's floodplain is closed upstream
      if (dz > 0) b += P.northFP + 0.0006 * dz + P.terrace * (1 - smooth(P.leveeX[0] + 20, P.leveeX[0] + 90, x));
      else { b += P.southFP + 0.0005 * -dz; m = 6; }
      // valley sides (rock); in the narrows both sides close in on the river
      const p = pinch(x);
      const northEdge = (1 - p) * 640 + p * (zc + 48), southEdge = (1 - p) * 120 + p * (zc - 70);
      if (z > northEdge) { b += 0.09 * (z - northEdge) + 0.0011 * (z - northEdge) ** 2; m = 3; }
      if (z < southEdge) { b += 0.09 * (southEdge - z) + 0.0011 * (southEdge - z) ** 2; m = 3; }
      // the river channel (sand) with willows on its banks
      if (ad < P.chanHalf) { b = BASE(x) - P.chanDepth * (1 - (ad / P.chanHalf) ** 2); m = 1; }
      else if (ad < 28 && m !== 3) m = 4;
      // the south bank ridge (a natural levee) keeps the river out of the farmland, which fills from downstream
      if (dz < -P.chanHalf && dz > -50 && x >= P.ridgeX[0] && x <= P.ridgeX[1]) {
        const r = P.ridge * Math.exp(-(((dz + 31) / 9) ** 2)) * (1 - smooth(P.ridgeX[1] - 60, P.ridgeX[1], x));
        if (BASE(x) + r > b) b = BASE(x) + r;
      }
      // the old levee (clay) on the north bank, crest BASE + leveeCrest, the low spot at x 900 lower by lowSpot
      if (x >= P.leveeX[0] && x <= P.leveeX[1]) {
        const e = Math.abs(z - leveeZ(x));
        if (e < 16) { const top = BASE(x) + (P.leveeCrest - P.lowSpot * lowSpot(x)) * (1 - (e / 16) ** 2) + P.northFP * (e / 16) ** 2; if (top > b) b = top; if (e < 11) m = 2; }
      }
      // the clay sill in the narrows: a bar across the channel
      const sx = (x - P.sillX) / 35;
      if (Math.abs(sx) < 1 && ad < 20) { const top = BASE(x) - P.chanDepth + P.sill * (1 - sx * sx); if (top > b) { b = top; m = 2; } }
      bed[k] = b; mat[k] = m;
    }
  }
  // the tarn: a hollow on a shelf in the north hills, filled to 0.4 m below its lowest rim
  const tarn = {};
  const tc = [240, 720], hillAt = (k) => bed[k];
  const shelf = hillAt(Math.round(tc[1] / dx) * nx + Math.round(tc[0] / dx));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = i * dx, z = j * dx, k = j * nx + i;
    const r2 = ((x - tc[0]) / 90) ** 2 + ((z - tc[1]) / 55) ** 2;
    if (r2 < 3.2) {
      const w = 1 - smooth(1.7, 3.2, r2);
      bed[k] = bed[k] * (1 - w) + shelf * w;
      if (r2 < 1) bed[k] -= 3.6 * (1 - r2) + 0.5 * Math.sin(x / 13) * Math.cos(z / 11) * (1 - r2);
    }
  }
  let rim = Infinity;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = i * dx, z = j * dx; const r2 = ((x - tc[0]) / 90) ** 2 + ((z - tc[1]) / 55) ** 2; if (r2 >= 0.95 && r2 < 1.7) rim = Math.min(rim, bed[j * nx + i]); }
  tarn.eta = Math.round((rim - 0.4) * 1000) / 1000;
  // the tarn's rectangle bounds the cells inside its rim that lie below its level (initialWater fills just those)
  Object.assign(tarn, { i0: nx, j0: nz, i1: -1, j1: -1 });
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = i * dx, z = j * dx, r2 = ((x - tc[0]) / 90) ** 2 + ((z - tc[1]) / 55) ** 2;
    if (r2 < 0.95 && bed[j * nx + i] < tarn.eta) { tarn.i0 = Math.min(tarn.i0, i); tarn.i1 = Math.max(tarn.i1, i); tarn.j0 = Math.min(tarn.j0, j); tarn.j1 = Math.max(tarn.j1, j); }
  }
  // the town: 14 houses on the north floodplain behind the levee
  const houses = [];
  const spots = [[790, 500], [820, 530], [850, 505], [880, 540], [910, 510], [940, 545], [970, 505], [1000, 525], [830, 575], [890, 590], [950, 580], [760, 555], [860, 620], [920, 625]];
  for (const [x, z] of spots) {
    const i = Math.round(x / dx), j = Math.round(z / dx), k = j * nx + i;
    houses.push({ i, j, x: i * dx, z: j * dx, ground: bed[k] });
    mat[k] = 5;
  }
  // the levee: crest cell and the river cell it faces, every column from x 560 to 1060
  const levee = [];
  for (let i = 56; i <= 106; i++) {
    const x = i * dx; let best = -1, top = -Infinity;
    for (let j = 0; j < nz; j++) { const z = j * dx; if (Math.abs(z - leveeZ(x)) < 12 && bed[j * nx + i] > top) { top = bed[j * nx + i]; best = j; } }
    const jr = Math.round(riverZ(x) / dx);
    levee.push([best * nx + i, jr * nx + i]);
  }
  // the gauge: the river at the town (x 900)
  const gi = 90, gauge = { i: gi, j: Math.round(riverZ(gi * dx) / dx) };
  // inflow: the channel cells across the west edge (two columns)
  const jc = Math.round(riverZ(0) / dx);
  const inflow = [0, jc - 1, 1, jc + 1];
  // base stage: the river's starting water level along x (1.1 m over the channel's deepest bed)
  const baseStage = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { const x = i * dx; baseStage[i] = BASE(x) - 2.0 + 1.1; }
  return { ...design, design, nx, nz, dx, x0: 0, z0: 0, bed, mat, houses, levee, gauge, tarn, inflow, baseStage };
}

/** Initial water: river cells (sand) up to the base stage, the tarn to its level, against the given bed. */
export function initialWater(level, bed = level.bed) {
  const { nx, nz } = level, h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (level.mat[k] === 1) h[k] = Math.max(0, level.baseStage[i] - bed[k]);
  }
  const t = level.tarn;
  for (let j = t.j0; j <= t.j1; j++) for (let i = t.i0; i <= t.i1; i++) { const k = j * nx + i; h[k] = Math.max(h[k], t.eta - bed[k]); }
  return h;
}

export function hydrographQ(level, t) {
  const H = level.hydrograph;
  if (t <= H[0][0]) return H[0][1];
  for (let k = 1; k < H.length; k++) if (t <= H[k][0]) { const [t0, q0] = H[k - 1], [t1, q1] = H[k]; return q0 + ((q1 - q0) * (t - t0)) / (t1 - t0); }
  return H[H.length - 1][1];
}

const f3 = (v) => { const r = Math.round(v * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toString(); };

/** The level as an X3D 4.0 file. */
export function toX3D(L) {
  const housesX3D = L.houses.map((hs, k) => `<Transform DEF='House${k}' translation='${f3(hs.x)} ${f3(hs.ground + 2.2)} ${f3(hs.z)}'>
<Shape><Appearance><Material DEF='HouseMat${k}' diffuseColor='0.86 0.82 0.74'/></Appearance><Box size='7 4.4 7'/></Shape>
<Transform translation='0 3.2 0' rotation='0 0 1 0.785398'><Shape><Appearance><Material DEF='RoofMat${k}' diffuseColor='0.62 0.2 0.16'/></Appearance><Box size='4.4 4.4 7.6'/></Shape></Transform>
</Transform>`).join('\n');
  const gx = L.gauge.i * L.dx, gz = L.gauge.j * L.dx, gb = L.bed[L.gauge.j * L.nx + L.gauge.i];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Interchange' version='4.0'>
<head>
<meta name='title' content='TIDEWRIGHT: ${L.name}'/>
<meta name='description' content='${L.tagline.replace(/'/g, '&apos;')} Generated by tools/build.mjs (src/sim/level.js). The river runs along +X; north is +Z. The ElevationGrid heights are the shallow-water solver&apos;s bed, one cell per vertex.'/>
<meta name='generator' content='x3d.tidewright/src/sim/level.js'/>
<meta name='license' content='MIT'/>
</head>
<Scene>
<WorldInfo title='TIDEWRIGHT ${L.name}'>
<MetadataSet name='kansei:tidewright-level' containerField='metadata'>
<MetadataString name='id' value='"${L.id}"'/>
<MetadataString name='name' value='"${L.name}"'/>
<MetadataString name='tagline' value='"${L.tagline.replace(/"/g, '\\"').replace(/'/g, '&apos;')}"'/>
<MetadataDouble name='hydrograph' value='${L.hydrograph.flat().join(' ')}'/>
<MetadataDouble name='duration' value='${L.duration}'/>
<MetadataDouble name='budget' value='${L.budget} ${L.costPerM3} ${L.sandbagCost} ${L.sandbags} ${L.sandbagHeight}'/>
<MetadataDouble name='houseFloor' value='${L.houseFloor}'/>
<MetadataDouble name='caps' value='${L.hCap} ${L.uCap}'/>
<MetadataInteger name='inflow' value='${L.inflow.join(' ')}'/>
<MetadataInteger name='gauge' value='${L.gauge.i} ${L.gauge.j}'/>
<MetadataDouble name='tarn' value='${L.tarn.i0} ${L.tarn.j0} ${L.tarn.i1} ${L.tarn.j1} ${L.tarn.eta}'/>
<MetadataInteger name='houses' value='${L.houses.map((h) => `${h.i} ${h.j}`).join(' ')}'/>
<MetadataInteger name='levee' value='${L.levee.flat().join(' ')}'/>
<MetadataDouble name='baseStage' value='${Array.from(L.baseStage).map(f3).join(' ')}'/>
<MetadataString name='materials' value='${MATERIALS.map((m) => `"${m.name}"`).join(' ')}'/>
<MetadataDouble name='manning' value='${MATERIALS.map((m) => m.manning).join(' ')}'/>
<MetadataInteger name='material' value='${Array.from(L.mat).join(' ')}'/>
</MetadataSet>
</WorldInfo>
<Background skyColor='0.62 0.7 0.78'/>
<Viewpoint DEF='Overview' description='over the town' position='${f3(gx + 60)} ${f3(gb + 330)} ${f3(gz - 520)}' orientation='0 1 0 3.1416'/>
<DirectionalLight direction='-0.35 -0.85 0.4' intensity='1'/>
<Transform DEF='Terrain'>
<Shape>
<Appearance><Material diffuseColor='0.4 0.48 0.3'/></Appearance>
<ElevationGrid DEF='Bed' xDimension='${L.nx}' zDimension='${L.nz}' xSpacing='${L.dx}' zSpacing='${L.dx}' creaseAngle='1.2' solid='false'
 height='${Array.from(L.bed).map(f3).join(' ')}'/>
</Shape>
</Transform>
<Group DEF='Town'>
${housesX3D}
</Group>
<Transform DEF='Gauge' translation='${f3(gx)} ${f3(gb + 3)} ${f3(gz + 20)}'>
<Shape><Appearance><Material diffuseColor='0.95 0.95 0.92' emissiveColor='0.1 0.1 0.1'/></Appearance><Cylinder radius='0.5' height='8'/></Shape>
</Transform>
</Scene>
</X3D>
`;
}

/** Read a level back from its X3D file: what the game and the tests load. The bed is the ElevationGrid. */
export function fromX3D(text) {
  const doc = parseXML(text);
  const m = metaSet(doc, 'kansei:tidewright-level');
  if (!m) throw new Error("level: no MetadataSet name='kansei:tidewright-level'");
  const grid = findAll(doc, 'ElevationGrid')[0];
  const nx = Number(grid.attrs.xDimension), nz = Number(grid.attrs.zDimension), dx = Number(grid.attrs.xSpacing);
  const bed = Float64Array.from(nums(grid.attrs.height));
  if (bed.length !== nx * nz) throw new Error(`level: ${bed.length} heights, not ${nx * nz}`);
  const pairs = (a, w) => { const o = []; for (let k = 0; k + w - 1 < a.length; k += w) o.push(a.slice(k, k + w)); return o; };
  const names = strs(findAll(doc, 'MetadataString', (c) => c.attrs.name === 'materials')[0].attrs.value);
  const [budget, costPerM3, sandbagCost, sandbags, sandbagHeight] = m.budget;
  const t = m.tarn;
  const L = {
    id: m.id[0], name: m.name[0], tagline: m.tagline[0], nx, nz, dx, x0: 0, z0: 0, bed,
    mat: Uint8Array.from(m.material), hydrograph: pairs(m.hydrograph, 2), duration: m.duration[0],
    budget, costPerM3, sandbagCost, sandbags, sandbagHeight, houseFloor: m.houseFloor[0], hCap: m.caps[0], uCap: m.caps[1],
    inflow: m.inflow, gauge: { i: m.gauge[0], j: m.gauge[1] }, tarn: { i0: t[0], j0: t[1], i1: t[2], j1: t[3], eta: t[4] },
    houses: pairs(m.houses, 2).map(([i, j]) => ({ i, j, x: i * dx, z: j * dx, ground: bed[j * nx + i] })),
    levee: pairs(m.levee, 2), baseStage: Float64Array.from(m.baseStage),
    materialNames: names, materialManning: m.manning,
  };
  return L;
}
