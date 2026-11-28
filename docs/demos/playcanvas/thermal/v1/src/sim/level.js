// Ridge Day: the level generator, its X3D 4.0 writer and the reader the simulation and the renderer share.
// The terrain is a two-dimensional ridge: one height profile across the wind (x), the same in every row along the
// ridge (X3D z, the game's y). The ElevationGrid's heights, the per-column surfaces, the wind, the stratification,
// the sun and the task are all in the file; tools/build.mjs writes levels/ridge-day.x3d and a test keeps them equal.
import { parseXML, findAll, metaSet, nums } from './x3dxml.js';

export const SURFACES = ['rock', 'grass', 'forest', 'snow', 'lake'];
// albedo and the sensible-heat fraction of the absorbed sunlight (Bowen-ratio stand-in); colours linear RGB
export const SURFACE_DATA = {
  rock: { albedo: 0.2, sensible: 0.55, color: [0.30, 0.27, 0.25] },
  grass: { albedo: 0.22, sensible: 0.35, color: [0.16, 0.30, 0.08] },
  forest: { albedo: 0.12, sensible: 0.3, color: [0.04, 0.12, 0.05] },
  snow: { albedo: 0.8, sensible: 0.05, color: [0.80, 0.84, 0.90] },
  lake: { albedo: 0.07, sensible: 0.05, color: [0.04, 0.11, 0.20] },
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const r3 = (v) => Math.round(v * 1000) / 1000;

export function generateRidgeDay() {
  const dx = 40, nx = 384, ny = 96, zBottom = 200, rows = 41, rowSpacing = 500;
  const heights = [], surface = [];
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx;
    let h = 300;
    h += 20 * smooth(2950, 3150, x) * (1 - smooth(4400, 4900, x));                 // the airfield's terrace
    h += 160 * Math.exp(-(((x - 5300) / 380) ** 2));                               // a wooded foothill
    // the main ridge: steep windward (west) face, crest at 7.6 km, a long lee slope
    const up = smooth(5900, 7600, x), down = 1 - smooth(7600, 9800, x);
    h += 700 * Math.min(up, down);
    h += 200 * Math.exp(-(((x - 11600) / 500) ** 2));                              // the downwind hill
    if (x > 1900 && x < 2900) h = 300 - 4;                                         // the lake
    heights.push(r3(h));
    let s = 'grass';
    if (x > 1900 && x < 2900) s = 'lake';
    else if (Math.abs(x - 5300) < 420) s = 'forest';
    else if (x > 6000 && x < 6900) s = 'forest';
    else if (x >= 6900 && x < 7400) s = 'rock';
    else if (x >= 7400 && x < 7800) s = 'snow';
    else if (x >= 7800 && x < 8500) s = 'rock';
    else if (x >= 8500 && x < 9700) s = 'forest';
    else if (Math.abs(x - 11600) < 450) s = 'forest';
    surface.push(SURFACES.indexOf(s));
  }
  return {
    name: 'Ridge Day', tagline: 'A west wind against a long ridge. Run it, turn twice, and get home before the sun goes down.',
    grid: { dx, nx, ny, zBottom, rows, rowSpacing },
    heights, surface,
    wind: { U: 8, from: 'west', profileDepth: 400, profileExponent: 0.15 },
    air: { N: 0.01, theta0: 290, spread: 7.5, uLattice: 0.06, nuLattice: 1e-4, kappaLattice: 2e-3, smagorinsky: 0.17 },
    sun: { S0: 800, azimuth: 'west', startElevation: 6, start: '17:30', sunset: '18:00' },
    task: {
      start: { x: 6500, y: 0, z: 1150, speed: 110 },
      turnpoints: [
        { name: 'North Cairn', x: 7000, y: 6000, r: 500 },
        { name: 'South Saddle', x: 7000, y: -5000, r: 500 },
        { name: 'Airfield', x: 3500, y: 0, r: 400, finish: true },
      ],
    },
  };
}

const fmt = (a) => a.map((v) => String(v)).join(' ');

/** The X3D 4.0 file: ElevationGrid with per-vertex colours, and a MetadataSet the simulation reads. */
export function toX3D(L) {
  const g = L.grid, nzRows = g.rows;
  const hs = [], cols = [];
  for (let r = 0; r < nzRows; r++) for (let i = 0; i < g.nx; i++) {
    hs.push(L.heights[i]);
    const base = SURFACE_DATA[SURFACES[L.surface[i]]].color;
    // a deterministic brightness jitter so rows do not look printed; heights are untouched
    const k = (Math.imul(i * 73856093 ^ r * 19349663, 0x9e3779b1) >>> 0) / 4294967296;
    const m = 0.88 + 0.24 * k;
    cols.push(...base.map((c) => r3(Math.min(1, c * m))));
  }
  const tp = L.task.turnpoints;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Interchange' version='4.0'>
<head>
<meta name='title' content='${L.name}'/>
<meta name='description' content='THERMAL level: ${L.tagline}'/>
<meta name='generator' content='x3d.thermal tools/build.mjs (src/sim/level.js)'/>
<meta name='license' content='MIT'/>
</head>
<Scene>
<WorldInfo title='${L.name}'>
<MetadataSet name='kansei:thermal-level' containerField='metadata'>
<MetadataString name='name' value='"${L.name}"'/>
<MetadataString name='tagline' value='"${L.tagline}"'/>
<MetadataInteger name='grid' value='${g.nx} ${g.ny} ${g.rows}'/>
<MetadataDouble name='spacing' value='${g.dx} ${g.rowSpacing}'/>
<MetadataDouble name='zBottom' value='${g.zBottom}'/>
<MetadataString name='surfaceNames' value='${SURFACES.map((s) => `"${s}"`).join(' ')}'/>
<MetadataDouble name='albedo' value='${fmt(SURFACES.map((s) => SURFACE_DATA[s].albedo))}'/>
<MetadataDouble name='sensibleFraction' value='${fmt(SURFACES.map((s) => SURFACE_DATA[s].sensible))}'/>
<MetadataInteger name='surface' value='${fmt(L.surface)}'/>
<MetadataDouble name='wind' value='${L.wind.U} ${L.wind.profileDepth} ${L.wind.profileExponent}'/>
<MetadataString name='windFrom' value='"${L.wind.from}"'/>
<MetadataDouble name='stratification' value='${L.air.N} ${L.air.theta0}'/>
<MetadataDouble name='dewpointSpread' value='${L.air.spread}'/>
<MetadataDouble name='lattice' value='${L.air.uLattice} ${L.air.nuLattice} ${L.air.kappaLattice} ${L.air.smagorinsky}'/>
<MetadataDouble name='sun' value='${L.sun.S0} ${L.sun.startElevation}'/>
<MetadataString name='sunTimes' value='"${L.sun.azimuth}" "${L.sun.start}" "${L.sun.sunset}"'/>
<MetadataDouble name='start' value='${L.task.start.x} ${L.task.start.y} ${L.task.start.z} ${L.task.start.speed}'/>
<MetadataString name='turnpointNames' value='${tp.map((t) => `"${t.name}"`).join(' ')}'/>
<MetadataDouble name='turnpoints' value='${tp.map((t) => `${t.x} ${t.y} ${t.r} ${t.finish ? 1 : 0}`).join(' ')}'/>
</MetadataSet>
</WorldInfo>
<NavigationInfo type='"EXAMINE" "ANY"'/>
<Viewpoint DEF='Overview' description='Ridge Day from the south' position='7000 2600 14000' orientation='1 0 0 -0.18'/>
<Transform DEF='Terrain' translation='${g.dx / 2} 0 ${-((g.rows - 1) * g.rowSpacing) / 2}'>
<Shape>
<Appearance><Material diffuseColor='1 1 1'/></Appearance>
<ElevationGrid DEF='Ground' xDimension='${g.nx}' zDimension='${g.rows}' xSpacing='${g.dx}' zSpacing='${g.rowSpacing}' solid='false' colorPerVertex='true' height='${fmt(hs)}'>
<Color color='${fmt(cols)}'/>
</ElevationGrid>
</Shape>
</Transform>
</Scene>
</X3D>
`;
}

/** Read a level back from X3D text: the simulation and the renderer both call this on the same bytes. */
export function fromX3D(text) {
  const doc = parseXML(text);
  const m = metaSet(doc, 'kansei:thermal-level');
  if (!m) throw new Error('not a THERMAL level: no kansei:thermal-level MetadataSet');
  const eg = findAll(doc, 'ElevationGrid')[0];
  const nxv = Number(eg.attrs.xDimension), nzv = Number(eg.attrs.zDimension);
  const H = nums(eg.attrs.height);
  const colorNode = eg.children.find((c) => c.name === 'Color');
  const [nx, ny, rows] = m.grid, [dx, rowSpacing] = m.spacing;
  if (nxv !== nx || nzv !== rows || H.length !== nx * rows) throw new Error('ElevationGrid does not match the level grid');
  const heights = H.slice(0, nx);
  let uniform = true;
  for (let r = 1; r < rows; r++) for (let i = 0; i < nx; i++) if (H[r * nx + i] !== heights[i]) uniform = false;
  const names = m.surfaceNames;
  const tpn = m.turnpointNames, tpv = m.turnpoints, tps = [];
  for (let k = 0; k < tpn.length; k++) tps.push({ name: tpn[k], x: tpv[4 * k], y: tpv[4 * k + 1], r: tpv[4 * k + 2], ...(tpv[4 * k + 3] ? { finish: true } : {}) });
  const [azimuth, start, sunset] = m.sunTimes;
  return {
    name: m.name[0], tagline: m.tagline[0],
    grid: { dx, nx, ny, zBottom: m.zBottom[0], rows, rowSpacing },
    heights, surface: m.surface, rowsUniform: uniform,
    surfaceNames: names, albedo: m.albedo, sensibleFraction: m.sensibleFraction,
    wind: { U: m.wind[0], from: m.windFrom[0], profileDepth: m.wind[1], profileExponent: m.wind[2] },
    air: { N: m.stratification[0], theta0: m.stratification[1], spread: m.dewpointSpread[0], uLattice: m.lattice[0], nuLattice: m.lattice[1], kappaLattice: m.lattice[2], smagorinsky: m.lattice[3] },
    sun: { S0: m.sun[0], startElevation: m.sun[1], azimuth, start, sunset },
    task: { start: { x: m.start[0], y: m.start[1], z: m.start[2], speed: m.start[3] }, turnpoints: tps },
    colors: colorNode ? nums(colorNode.attrs.color) : null,
    elevationGrid: { nx: nxv, nz: nzv, dx, dz: rowSpacing, heights: H },
  };
}

/** Terrain height (m ASL) at x (m), linear between column centres, clamped at the ends. */
export function terrainAt(level, x) {
  const g = level.grid, f = x / g.dx - 0.5;
  const i = Math.max(0, Math.min(g.nx - 2, Math.floor(f))), t = Math.min(1, Math.max(0, f - i));
  return level.heights[i] * (1 - t) + level.heights[i + 1] * t;
}
