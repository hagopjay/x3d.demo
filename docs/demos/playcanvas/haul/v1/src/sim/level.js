// HAUL levels: five generated mountain climbs, each written as an X3D 4.0 file (an ElevationGrid with a
// MetadataSet name='kansei:haul-level' carrying the surface, puddle and pitch data). The simulation reads the
// level from the same bytes the renderer draws, as KANSEI reads its tracks.
//
// A level is a road along +x up a mountainside: a rock face rising on the left (+z), a drop on the right (-z).
// It is a run of hills, each steeper than the last. The steepest pitch of each level is set by the traction budget
// (feasible.js): within reach of the best setup at the wetness the rain will have reached, out of reach of the
// naive one from level 3 on, so the player has to tinker (lockers, 6x6, low range, air pressure, ballast, speed).
import { parseXML, findAll, metaSet, nums } from './x3dxml.js';
import { margin, BEST, NAIVE } from './feasible.js';

export const DX = 0.5, DZ = 1.0, WIDTH = 48;     // grid spacing (m) along and across; terrain width
export const ROAD = 7.0;                         // road width, m
export const RAIN_RISE = 300;                    // s for wetness to rise by 1 at rain 1

// Surface ids (spec.js SURFACES): 0 asphalt, 1 gravel, 2 dirt, 3 mud, 4 slab, 5 grass
export const DESIGNS = [
  { name: 'Valley Run', tagline: 'Pipe to the pumping station. Dry, warm, smooth.', seed: 11, payload: 4000, cargo: 'pipe',
    wet0: 0.0, rain: 0.0, sky: 'clear', base: 0,
    hills: [{ g: 0.05, l: 50 }, { g: 0.08, l: 55 }, { g: 0.11, l: 60 }, { g: 0.16, l: 70 }] },
  { name: 'Quarry Road', tagline: 'An excavator up to the quarry. Gravel, and a drizzle starting.', seed: 23, payload: 10000, cargo: 'excavator',
    wet0: 0.25, rain: 0.30, sky: 'overcast', base: 1,
    hills: [{ g: 0.08, l: 50 }, { g: 0.12, l: 55 }, { g: 0.15, l: 55 }, { g: 0.19, l: 60 }, { g: 0.22, l: 70 }] },
  { name: 'Logging Cut', tagline: 'Logs off the cut. Rain, ruts, and mud down one side.', seed: 37, payload: 12000, cargo: 'logs',
    wet0: 0.45, rain: 0.50, sky: 'rain', base: 2,
    hills: [{ g: 0.10, l: 50 }, { g: 0.12, l: 55, split: [2, 3] }, { g: 0.17, l: 55 }, { g: 0.21, l: 60, ruts: 1 }, { g: 0.26, l: 70 }] },
  { name: 'Clay Switch', tagline: 'A generator to the relay mast. Heavy rain on clay and bare rock.', seed: 41, payload: 3000, cargo: 'generator',
    wet0: 0.55, rain: 0.6, sky: 'heavy', base: 2,
    hills: [{ g: 0.12, l: 50, s: 3 }, { g: 0.14, l: 50, s: 3, ruts: 1 }, { g: 0.22, l: 55, s: 4 }, { g: 0.28, l: 55, s: 4, ledges: 0.1 }, { g: 0.33, l: 70, s: 4, ledges: 0.12 }] },
  { name: 'The Wall', tagline: 'No trailer. Just the truck, a storm, and a slab of wet granite.', seed: 59, payload: null, cargo: null,
    wet0: 0.6, rain: 0.8, sky: 'storm', base: 4,
    hills: [{ g: 0.18, l: 50 }, { g: 0.24, l: 50, s: 3, ruts: 1 }, { g: 0.32, l: 55, ledges: 0.12 }, { g: 0.39, l: 55, ledges: 0.15 }, { g: 0.45, l: 60, ledges: 0.18 }] },
];

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 1D (for road-side texture and bank shapes). */
function noise1(r, n) {
  const k = Array.from({ length: n + 2 }, () => r() * 2 - 1);
  return (t) => {
    const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
    const a = k[((i % n) + n) % n], b = k[(((i + 1) % n) + n) % n];
    return a + (b - a) * u;
  };
}

/** The road centre line z(x): a gentle meander, so the climb reads in 3D. */
export function roadCentre(level, x) {
  return level.meander[0] * Math.sin(x / level.meander[1]) + level.meander[2] * Math.sin(x / level.meander[3] + 1.3);
}

/**
 * Generate level number k (1..5): the grade schedule along x (smoothly blended), the height grid, surfaces,
 * ruts, ledges and puddles, and each pitch's traction margins for the naive and the best setups.
 */
export function generate(k) {
  const d = DESIGNS[k - 1];
  const r = rng(d.seed);
  const lead = 40, tail = 45, blend = 14;            // flat run-up, summit plateau, grade blend length (m)
  // grade schedule: run-up 0, each hill at its grade, a short easing between hills (half the grade, 12 m)
  const knots = [{ x: 0, g: 0 }, { x: lead, g: 0 }];
  let x = lead;
  const pitches = [];
  d.hills.forEach((h, i) => {
    pitches.push({ x0: x + blend / 2, x1: x + h.l - blend / 2, ...h, index: i });
    knots.push({ x: x + blend, g: h.g }, { x: x + h.l, g: h.g });
    x += h.l;
    if (i < d.hills.length - 1) { knots.push({ x: x + blend, g: h.g * 0.35 }, { x: x + 12, g: h.g * 0.35 }); x += 12; }
  });
  knots.push({ x: x + blend, g: 0 });
  const summit = x + blend + 8;
  const length = Math.ceil((summit + tail) / DX) * DX;
  knots.push({ x: length, g: 0 });
  const gradeAt = (t) => {
    for (let i = 1; i < knots.length; i++) {
      if (t <= knots[i].x) {
        const a = knots[i - 1], b = knots[i];
        const f = b.x > a.x ? (t - a.x) / (b.x - a.x) : 1;
        return a.g + (b.g - a.g) * (0.5 - 0.5 * Math.cos(Math.PI * f));     // cosine blend: no kinks
      }
    }
    return 0;
  };
  const nx = Math.round(length / DX) + 1, nz = Math.round(WIDTH / DZ) + 1;
  const profile = new Float64Array(nx);
  for (let i = 1; i < nx; i++) profile[i] = profile[i - 1] + DX * (gradeAt((i - 0.5) * DX));
  const level = {
    k, name: d.name, tagline: d.tagline, design: d, nx, nz, dx: DX, dz: DZ, x0: 0, z0: -WIDTH / 2,
    heights: new Float32Array(nx * nz), surface: new Uint8Array(nx * nz), puddle: new Float32Array(nx * nz),
    start: 18, summit, length, wet0: d.wet0, rain: d.rain, sky: d.sky, payload: d.payload, cargo: d.cargo,
    meander: [2.5 + k * 0.4, 38 + r() * 10, 1.2, 15 + r() * 5], pitches, profile,
  };
  const bank = noise1(r, 64), face = noise1(r, 97), tex = noise1(r, 131);
  for (let j = 0; j < nz; j++) {
    const z = level.z0 + j * DZ;
    for (let i = 0; i < nx; i++) {
      const xx = i * DX, n = i + j * nx;
      const zc = roadCentre(level, xx), off = z - zc, a = Math.abs(off);
      let h = profile[i];
      let s = d.base;
      const pitch = pitches.find((p) => xx >= p.x0 - 6 && xx <= p.x1 + 6);
      if (pitch && pitch.s !== undefined) s = pitch.s;
      if (pitch && pitch.split) s = off > 0 ? pitch.split[0] : pitch.split[1];      // left / right halves
      if (a < ROAD / 2) {
        // ruts in the wheel tracks
        if (pitch && pitch.ruts) {
          const tracks = [Math.abs(off - 1.02), Math.abs(off + 1.02)];
          const depth = 0.12 * pitch.ruts * Math.max(0, 1 - Math.min(...tracks) / 0.45);
          h -= depth;
          if (depth > 0.02) level.puddle[n] = Math.min(0.08, depth * 0.6);
        }
        // rock ledges across the road: steps that the tyres have to climb
        if (pitch && pitch.ledges) {
          const spacing = 7.5, phase = ((xx - pitch.x0) % spacing + spacing) % spacing;
          // weathered steps: up over 1.6 m (a tyre flattens over that), back down over 2 m
          const up = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, phase / 1.6));
          if (xx > pitch.x0 && xx < pitch.x1) h += pitch.ledges * up * (1 - Math.min(1, Math.max(0, phase - 5.5) / 2.0)) * (0.8 + 0.4 * r());
        }
        h += 0.015 * tex(xx * 0.9 + j * 3.1);                 // surface texture, ~1.5 cm
      } else {
        const out = a - ROAD / 2;
        const shoulder = Math.min(1, out / 3);
        s = d.base === 4 || k >= 4 ? (off > 0 ? 4 : 5) : 5;     // grass verges; bare rock up the face on the late levels
        if (off > 0) h += shoulder * (out * (0.55 + 0.25 * face(xx / 9 + j * 0.13)) + 1.5 * bank(xx / 17) * shoulder);   // rock face
        else h -= shoulder * out * (0.75 + 0.2 * bank(xx / 13 + 5));                                                       // the drop
      }
      level.heights[n] = Math.round(h * 1000) / 1000;
      level.surface[n] = s;
    }
  }
  // the traction budget of each pitch at the wetness it will have when a steady climb reaches it (~2.5 m/s)
  for (const p of pitches) {
    const wet = wetnessAt(level, (p.x0 - level.start) / 2.5);
    const surf = p.split || (p.s !== undefined ? p.s : d.base);
    p.wet = Math.round(wet * 1000) / 1000;
    p.naive = Math.round(margin(p.g, surf, wet, NAIVE, d.payload) * 1000) / 1000;
    p.best = Math.round(margin(p.g, surf, wet, BEST, d.payload) * 1000) / 1000;
  }
  return level;
}

/** Wetness at time t (s) after the start: rain soaks the ground. */
export function wetnessAt(level, t) {
  return Math.min(1, level.wet0 + level.rain * Math.max(0, t) / RAIN_RISE);
}

/** Ground height and the surface id at (x, z): bilinear on the grid (the wheels' terrain). */
export function sample(level, x, z, out = {}) {
  const fx = (x - level.x0) / level.dx, fz = (z - level.z0) / level.dz;
  const i = Math.max(0, Math.min(level.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(level.nz - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
  const H = level.heights, n = i + j * level.nx;
  const h00 = H[n], h10 = H[n + 1], h01 = H[n + level.nx], h11 = H[n + level.nx + 1];
  out.y = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  const dhdx = ((h10 - h00) * (1 - v) + (h11 - h01) * v) / level.dx;
  const dhdz = ((h01 - h00) * (1 - u) + (h11 - h10) * u) / level.dz;
  const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
  out.nx = -dhdx * inv; out.ny = inv; out.nz = -dhdz * inv;
  const pick = n + (u > 0.5 ? 1 : 0) + (v > 0.5 ? level.nx : 0);
  out.surface = level.surface[pick];
  out.puddle = level.puddle[pick];
  return out;
}

const f3 = (v) => (Math.round(v * 1000) / 1000).toString();

/** The level as an X3D 4.0 file. */
export function toX3D(level) {
  const d = level.design;
  const pitchRows = level.pitches.map((p) => [p.x0, p.x1, p.g, p.wet, p.naive, p.best].map(f3).join(' ')).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Interchange' version='4.0'>
<head>
<meta name='title' content='HAUL level ${level.k}: ${level.name}'/>
<meta name='description' content='${level.tagline.replace(/'/g, '&apos;')} Generated by tools/build.mjs (src/sim/level.js, seed ${d.seed}). The road runs along +X; the rock face rises on +Z.'/>
<meta name='generator' content='x3d.kansei-haul/src/sim/level.js'/>
<meta name='license' content='MIT'/>
</head>
<Scene>
<WorldInfo title='HAUL ${level.k} ${level.name}'>
<MetadataSet name='kansei:haul-level' containerField='metadata'>
<MetadataInteger name='level' value='${level.k}'/>
<MetadataString name='name' value='"${level.name}"'/>
<MetadataString name='tagline' value='"${level.tagline.replace(/"/g, '\\"').replace(/'/g, '&apos;')}"'/>
<MetadataString name='sky' value='"${level.sky}"'/>
<MetadataString name='cargo' value='"${level.cargo || ''}"'/>
<MetadataDouble name='payload' value='${level.payload == null ? -1 : level.payload}'/>
<MetadataDouble name='wetness' value='${level.wet0} ${level.rain}'/>
<MetadataDouble name='startSummit' value='${f3(level.start)} ${f3(level.summit)}'/>
<MetadataDouble name='meander' value='${level.meander.map(f3).join(' ')}'/>
<MetadataDouble name='pitches' value='${pitchRows}'/>
<MetadataInteger name='surface' value='${Array.from(level.surface).join(' ')}'/>
<MetadataDouble name='puddle' value='${Array.from(level.puddle).map(f3).join(' ')}'/>
</MetadataSet>
</WorldInfo>
<Background skyColor='0.55 0.62 0.70'/>
<Viewpoint description='start' position='${f3(level.start - 18)} ${f3(level.profile[Math.round(level.start / DX)] + 6)} -22' orientation='0 1 0 3.6'/>
<DirectionalLight direction='-0.4 -0.8 -0.3' intensity='1'/>
<Transform DEF='Terrain' translation='${f3(level.x0)} 0 ${f3(level.z0)}'>
<Shape>
<Appearance><Material diffuseColor='0.42 0.38 0.32'/></Appearance>
<ElevationGrid DEF='Ground' xDimension='${level.nx}' zDimension='${level.nz}' xSpacing='${level.dx}' zSpacing='${level.dz}' creaseAngle='1.2' solid='false'
 height='${Array.from(level.heights).map(f3).join(' ')}'/>
</Shape>
</Transform>
</Scene>
</X3D>
`;
}

/** Read a level back from its X3D file: what the game loads. */
export function fromX3D(text) {
  const doc = parseXML(text);
  const meta = metaSet(doc, 'kansei:haul-level');
  if (!meta) throw new Error("level: no MetadataSet name='kansei:haul-level'");
  const grid = findAll(doc, 'ElevationGrid')[0];
  const terrain = findAll(doc, 'Transform', (t) => t.attrs.DEF === 'Terrain')[0];
  const [x0, , z0] = nums(terrain.attrs.translation);
  const k = meta.level[0];
  const nx = Number(grid.attrs.xDimension), nz = Number(grid.attrs.zDimension);
  const design = DESIGNS[k - 1];
  const rows = meta.pitches;
  const pitches = [];
  for (let i = 0; i + 5 < rows.length; i += 6) {
    pitches.push({ ...design.hills[i / 6], index: i / 6, x0: rows[i], x1: rows[i + 1], g: rows[i + 2], wet: rows[i + 3], naive: rows[i + 4], best: rows[i + 5] });
  }
  const heights = Float32Array.from(nums(grid.attrs.height));
  if (heights.length !== nx * nz) throw new Error('level: height has ' + heights.length + ' values, not ' + nx * nz);
  const dx = Number(grid.attrs.xSpacing), dz = Number(grid.attrs.zSpacing);
  const profile = new Float64Array(nx);
  const level = {
    k, name: meta.name[0], tagline: meta.tagline[0], design, nx, nz, dx, dz, x0, z0, heights,
    surface: Uint8Array.from(meta.surface), puddle: Float32Array.from(meta.puddle),
    start: meta.startSummit[0], summit: meta.startSummit[1], length: (nx - 1) * dx,
    wet0: meta.wetness[0], rain: meta.wetness[1], sky: meta.sky[0], cargo: meta.cargo[0] || null,
    payload: meta.payload[0] < 0 ? null : meta.payload[0], meander: meta.meander, pitches, profile,
  };
  for (let i = 0; i < nx; i++) profile[i] = sample(level, x0 + i * dx, roadCentre(level, x0 + i * dx)).y;
  return level;
}

/**
 * A uniform test hill: a flat run-up, then one grade (tan theta) on one surface (or [left, right] for split mu),
 * at a fixed wetness. The physics tests use it, and so does the game's sandbox.
 */
export function uniform({ grade = 0, surface = 0, wetness = 0, runup = 30, length = 260, startOnSlope = false } = {}) {
  const nx = Math.round(length / DX) + 1, nz = 25;
  const level = {
    k: 0, name: 'Test Hill', tagline: 'One grade, one surface: tinker here.', design: { hills: [] }, nx, nz, dx: DX, dz: DZ, x0: 0, z0: -12,
    heights: new Float32Array(nx * nz), surface: new Uint8Array(nx * nz), puddle: new Float32Array(nx * nz),
    start: startOnSlope ? runup + 20 : 15, summit: length - 10, length: (nx - 1) * DX, wet0: wetness, rain: 0, sky: 'clear',
    payload: null, cargo: null, meander: [0, 1, 0, 1], pitches: [], profile: new Float64Array(nx),
  };
  for (let i = 0; i < nx; i++) {
    const x = i * DX;
    const blend = Math.min(1, Math.max(0, (x - runup) / 8));
    const run = Math.max(0, x - runup);
    level.profile[i] = run <= 8 ? grade * run * run / 16 : grade * (run - 4);
    for (let j = 0; j < nz; j++) {
      const n = i + j * nx, z = level.z0 + j * DZ;
      level.heights[n] = level.profile[i];
      level.surface[n] = Array.isArray(surface) ? (z > 0 ? surface[0] : surface[1]) : surface;
    }
    void blend;
  }
  return level;
}
