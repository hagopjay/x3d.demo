// Giza VI: one geometry source for two renderers.
// Pure functions, no DOM, no Babylon. app.mjs turns these descriptors into Babylon meshes;
// build/export_x3d.mjs turns the same descriptors into giza-vi.x3d (IndexedTriangleSet), so the
// picture and the accountable X3D file share every vertex.
//
// Frame (inherited from v3): x east, y up, z south, metres, Great Sphinx at the origin.
// Monument centres: v3 build/geo.py (rounded published centre coordinates, not a survey).
// Grades: C Confirmed, L Likely, S Suspected, A Authored (invention, not a truth grade).

export const KHUFU = [-329, 0, -435], KHAFRE = [-651, 0, -95], MENKAURE = [-892, 0, 307];
export const OSIRIS = [-223, 0, -28], VALLEY = [35, 0, 35], CAUSEWAY_END = [-446, 0, -82];
export const HAWARA_ORIGIN = [0, 0, 40000];   // separate site; staged far from Giza, reached by a cut
export const PYRAMIDS = {
  khufu:    { c: KHUFU,    base: 230.33, apex: 146.6, today: 138.5, src: 'v3 geo.py; Wikipedia centre coordinates' },
  khafre:   { c: KHAFRE,   base: 215.25, apex: 143.5, today: 136.4, casing: 43, src: 'v3 geo.py / v3 labels' },
  menkaure: { c: MENKAURE, base: 103.4,  apex: 65.5,  today: 61.0, src: 'v3 geo.py' },
};
// King's Chamber (Petrie 10.47 x 5.23 m; long axis east-west), as placed in v3 build_scene2.py.
export const KING = { c: [KHUFU[0], 46.0, KHUFU[2] + 27], size: [10.47, 5.85, 5.23] };
export const KING_FLOOR = KING.c[1] - KING.size[1] / 2;

// ---------- deterministic RNG ----------
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- mesh builder ----------
class B {
  constructor(id, o) { Object.assign(this, { id, mat: 'stone', grade: 'C', label: id, layer: 'stone' }, o); this.positions = []; this.indices = []; this.uvs = []; }
  v(p, uv = [0, 0]) { this.positions.push(p[0], p[1], p[2]); this.uvs.push(uv[0], uv[1]); return this.positions.length / 3 - 1; }
  // Winding, measured (18 Nov 2026, Babylon 8.56.2 with useRightHandedSystem): the faces Babylon keeps are the
  // ones that are CLOCKWISE seen from outside, so the arrays here are clockwise-front. build/export_x3d.mjs
  // reverses every triangle so giza-vi.x3d is the X3D default ccw='true' (counter-clockwise front).
  tri(a, b, c) { this.indices.push(a, c, b); }
  quad(a, b, c, d) { this.indices.push(a, c, b, a, d, c); }
  out() { const r = { id: this.id, mat: this.mat, grade: this.grade, label: this.label, layer: this.layer, note: this.note || '', positions: this.positions.map(r4), indices: this.indices, uvs: this.uvs.map(r4) }; if (this.lines) r.lines = this.lines; return r; }
}
const r4 = x => Math.round(x * 1e4) / 1e4;

// Axis-aligned box. inward=true flips faces so the inside is visible (rooms).
function box(b, c, s, { inward = false, uvScale = 1 } = {}) {
  const [cx, cy, cz] = c, [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const F = [ // normal, then 4 corners counter-clockwise seen from outside
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  for (const [n, q] of F) {
    const ids = q.map(p => { const w = [cx + p[0], cy + p[1], cz + p[2]]; const u = n[0] ? w[2] : w[0], vv = n[1] ? w[2] : w[1]; return b.v(w, [u / uvScale, vv / uvScale]); });
    inward ? b.quad(ids[0], ids[3], ids[2], ids[1]) : b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
// Oriented box: centre, size, yaw (radians about +y).
function obox(b, c, s, yaw, o) { const st = b.positions.length; box(b, [0, 0, 0], s, o); xform(b, st, { ry: yaw, t: c }); }
function xform(b, start, { t = [0, 0, 0], ry = 0, rx = 0, rz = 0, s = 1 }) {
  const P = b.positions;
  for (let i = start; i < P.length; i += 3) {
    let x = P[i] * s, y = P[i + 1] * s, z = P[i + 2] * s;
    if (rx) { const c = Math.cos(rx), n = Math.sin(rx); [y, z] = [y * c - z * n, y * n + z * c]; }
    if (rz) { const c = Math.cos(rz), n = Math.sin(rz); [x, y] = [x * c - y * n, x * n + y * c]; }
    if (ry) { const c = Math.cos(ry), n = Math.sin(ry); [x, z] = [x * c + z * n, -x * n + z * c]; }
    P[i] = x + t[0]; P[i + 1] = y + t[1]; P[i + 2] = z + t[2];
  }
}
// Lathe about +y: profile [[r,y],...], seg around.
function lathe(b, c, prof, seg = 24, { cap = true } = {}) {
  const base = b.positions.length / 3, n = prof.length;
  for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; for (let j = 0; j < n; j++) { const [r, y] = prof[j]; b.v([c[0] + r * Math.sin(a), c[1] + y, c[2] + r * Math.cos(a)], [i / seg * 4, y]); } }
  for (let i = 0; i < seg; i++) for (let j = 0; j < n - 1; j++) { const a = base + i * n + j, d = a + n; b.quad(a, d, d + 1, a + 1); }
  if (cap) { const top = b.v([c[0], c[1] + prof[n - 1][1], c[2]]); for (let i = 0; i < seg; i++) b.tri(base + i * n + n - 1, base + (i + 1) * n + n - 1, top); }
}
function cyl(b, c, r, h, seg = 16) { lathe(b, [c[0], c[1] - h / 2, c[2]], [[r, 0], [r, h]], seg); }
function sphere(b, c, r, seg = 18, sy = 1) { const p = []; for (let k = 0; k <= seg / 2; k++) { const t = -Math.PI / 2 + k / (seg / 2) * Math.PI; p.push([Math.cos(t) * r + 1e-4, Math.sin(t) * r * sy + r * sy]); } lathe(b, [c[0], c[1] - r * sy, c[2]], p, seg, { cap: false }); }
function torus(b, c, R, r, seg = 32, sides = 10, { plane = 'xy' } = {}) {
  const base = b.positions.length / 3;
  for (let i = 0; i <= seg; i++) { const u = i / seg * Math.PI * 2; for (let j = 0; j <= sides; j++) { const w = j / sides * Math.PI * 2; const rr = R + r * Math.cos(w); let p = [rr * Math.cos(u), rr * Math.sin(u), r * Math.sin(w)]; if (plane === 'xz') p = [p[0], p[2], p[1]]; b.v([c[0] + p[0], c[1] + p[1], c[2] + p[2]], [i / seg, j / sides]); } }
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) { const a = base + i * (sides + 1) + j, d = a + sides + 1; b.quad(a, d, d + 1, a + 1); }
}

// ---------- terrain ----------
export function terrainHeight(x, z) {
  // Plateau flat where the monuments stand; dunes to the west and south; the valley falls east toward the Nile.
  const inPlateau = 1 - smooth(0, 380, Math.max(0, Math.max(-1250 - x, x - 220, -800 - z, z - 600)));
  const dunes = (Math.sin(x * 0.0061 + Math.sin(z * 0.0023) * 2.1) * 0.5 + 0.5) ** 2 * 14 + Math.sin(z * 0.011 + x * 0.004) * 3 + Math.sin(x * 0.027 - z * 0.019) * 1.2;
  const valley = -22 * smooth(260, 900, x);
  return (1 - inPlateau) * dunes * (1 - smooth(200, 700, x)) + valley + inPlateau * 0.15 * Math.sin(x * 0.05) * Math.sin(z * 0.043);
}
export function terrain({ nx = 220, nz = 200, x0 = -3600, x1 = 4400, z0 = -3200, z1 = 3200 } = {}) {
  const b = new B('ground', { mat: 'sand', grade: 'L', label: 'Desert and valley surface (schematic relief)', layer: 'stone', note: 'Relief is invented for depth; the plateau under the monuments is flat.' });
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    // denser near the monuments: warp the grid toward x=-400
    const u = i / nx, w = j / nz, xu = u * 2 - 1, wz = w * 2 - 1;
    const x = -420 + Math.sign(xu) * Math.abs(xu) ** 1.6 * (xu < 0 ? -420 - x0 : x1 + 420);
    const z = -40 + Math.sign(wz) * Math.abs(wz) ** 1.6 * (wz < 0 ? -40 - z0 : z1 + 40);
    b.v([x, terrainHeight(x, z), z], [x / 6, z / 6]);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, c = a + nx + 1; b.quad(a, c, c + 1, a + 1); }
  return b.out();
}

// ---------- pyramids ----------
// Four sloped faces up to the surviving height, a flat summit platform, optional surviving casing band.
// uv: u = metres along the course, v = metres of height (courses are horizontal in the texture).
export function pyramid(id, P, { rows = 28, label } = {}) {
  const core = new B(id, { mat: 'limestone', grade: 'C', label: label || id, layer: 'stone', note: `base ${P.base} m, ${P.today} m today of ${P.apex} m original; ${P.src}` });
  const casing = P.casing ? new B(id + '_casing', { mat: 'casing', grade: 'C', label: label + ' surviving casing', layer: 'stone' }) : null;
  const [cx, , cz] = P.c, hb = P.base / 2, H = P.apex, top = P.today;
  const corners = [[-hb, -hb], [hb, -hb], [hb, hb], [-hb, hb]];   // NW, NE, SE, SW (north is -z)
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
    for (let r = 0; r < rows; r++) {
      const y0 = top * r / rows, y1 = top * (r + 1) / rows, k0 = 1 - y0 / H, k1 = 1 - y1 / H;
      const tgt = casing && y0 >= top - P.casing ? casing : core;
      const L0 = P.base * k0, L1 = P.base * k1;
      const a = tgt.v([cx + ax * k0, y0, cz + az * k0], [(-L0 / 2) / 8.4 + 50, y0 / 8.4]);
      const bb = tgt.v([cx + bx * k0, y0, cz + bz * k0], [(L0 / 2) / 8.4 + 50, y0 / 8.4]);
      const c = tgt.v([cx + bx * k1, y1, cz + bz * k1], [(L1 / 2) / 8.4 + 50, y1 / 8.4]);
      const d = tgt.v([cx + ax * k1, y1, cz + az * k1], [(-L1 / 2) / 8.4 + 50, y1 / 8.4]);
      tgt.quad(a, bb, c, d);
    }
  }
  const k = 1 - top / H, tgt = casing || core;
  const q = corners.map(([x, z]) => tgt.v([cx + x * k, top, cz + z * k], [x * k / 8.4, z * k / 8.4]));
  tgt.quad(q[0], q[3], q[2], q[1]);
  return casing ? [core.out(), casing.out()] : [core.out()];
}

// Queens' pyramids and mastaba fields: schematic massing for scale and silhouette (Likely, placement schematic).
export function satellites() {
  const out = [];
  const q = (id, c, base, h) => pyramid(id, { c, base, apex: h, today: h * 0.86, src: 'schematic satellite' }, { rows: 8, label: id })[0];
  for (const [i, dz] of [[0, -120], [1, -62], [2, -6]].map(([i, d]) => [i, d])) { const m = q('queen_G1' + 'abc'[i], [KHUFU[0] + 170, 0, KHUFU[2] + dz + 40], 46, 30); m.grade = 'L'; m.note = 'G1a-c east of Khufu; placement schematic'; out.push(m); }
  for (const [i, dx] of [[0, -60], [1, 0], [2, 60]]) { const m = q('queen_G3' + 'abc'[i], [MENKAURE[0] + dx, 0, MENKAURE[2] + 120], i ? 28 : 44, i ? 18 : 28); m.grade = 'L'; m.note = 'G3a-c south of Menkaure; placement schematic'; out.push(m); }
  const b = new B('mastabas', { mat: 'limestone_old', grade: 'L', label: 'Mastaba fields west and east of Khufu', layer: 'stone', note: 'Rows of tombs for courtiers; count and spacing schematic' });
  const R = rng(1701);
  for (const [x0, x1, z0, z1] of [[-640, -470, -600, -300], [-180, -70, -560, -330]])
    for (let x = x0; x < x1; x += 26) for (let z = z0; z < z1; z += 16) { if (R() < 0.18) continue; const h = 3.5 + R() * 3; obox(b, [x + R() * 4, h / 2, z + R() * 3], [18 + R() * 6, h, 8 + R() * 3], 0, { uvScale: 2.4 }); }
  out.push(b.out());
  return out;
}

// ---------- Sphinx, causeway, temples (ported from v3 geo.py) ----------
function loft(b, xs, hfn, wfn, y0 = 0, z0 = 0) {
  const prof = [[-1, 0], [-1, .55], [-.82, .9], [-.4, 1], [.4, 1], [.82, .9], [1, .55], [1, 0]], m = prof.length, base = b.positions.length / 3;
  for (const x of xs) { const h = hfn(x), w = wfn(x); prof.forEach(([u, v], j) => b.v([x, y0 + v * h, z0 + u * w], [x / 2.4, j / 2])); }
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < m - 1; j++) { const a = base + i * m + j, c = a + m; b.quad(a, a + 1, c + 1, c); }
  // end caps and underside (both windings: caps are seen from either end)
  for (const i of [0, xs.length - 1]) { const r = base + i * m; for (let j = 1; j < m - 1; j++) { b.tri(r, r + j, r + j + 1); b.tri(r, r + j + 1, r + j); } }
}
const lerpPts = (x, pts) => { for (let i = 0; i < pts.length - 1; i++) { const [xa, ya] = pts[i], [xb, yb] = pts[i + 1]; if (x >= xa && x <= xb) return ya + (yb - ya) * (x - xa) / (xb - xa); } return x < pts[0][0] ? pts[0][1] : pts[pts.length - 1][1]; };
export function sphinx() {
  const b = new B('sphinx', { mat: 'sphinx', grade: 'C', label: 'Great Sphinx: 73 m long, 20 m high, faces due east', layer: 'stone', note: 'v3 loft massing; orientation due east is documented' });
  const H = [[-37, 1.5], [-30, 7], [-22, 11], [-8, 12.5], [6, 12.5], [12, 11], [18, 6]], W = [[-37, 4], [-30, 7.5], [-20, 9.9], [10, 9.9], [14, 7], [18, 5]];
  loft(b, Array.from({ length: 56 }, (_, i) => -37 + i), x => lerpPts(x, H), x => lerpPts(x, W));
  loft(b, Array.from({ length: 11 }, (_, i) => 10 + i * 0.8), () => 7.6, x => x < 17 ? 4.4 : 3.4, 12.7);
  // paws
  loft(b, Array.from({ length: 17 }, (_, i) => 14 + i * 1.5), () => 3.8, () => 2.1, 0, 5.6);
  loft(b, Array.from({ length: 17 }, (_, i) => 14 + i * 1.5), () => 3.8, () => 2.1, 0, -5.6);
  // enclosure wall: the Sphinx sits in a quarried hollow
  const e = new B('sphinx_enclosure', { mat: 'limestone_old', grade: 'L', label: 'Sphinx enclosure (schematic rim)', layer: 'stone' });
  for (const [c, s] of [[[-12, 3, -26], [80, 6, 4]], [[-12, 3, 26], [80, 6, 4]], [[-52, 3, 0], [4, 6, 56]]]) box(e, c, s, { uvScale: 2.4 });
  return [b.out(), e.out()];
}
export function causewayAndTemples() {
  const b = new B('causeway', { mat: 'limestone_old', grade: 'C', label: "Khafre causeway 494.6 m", layer: 'stone' });
  let dx = CAUSEWAY_END[0] - VALLEY[0], dz = CAUSEWAY_END[2] - VALLEY[2]; const L = Math.hypot(dx, dz); dx /= L; dz /= L; const nx = -dz, nz = dx, Wd = 15, N = 50;
  for (let i = 0; i <= N; i++) { const t = i / N, cx = VALLEY[0] + (CAUSEWAY_END[0] - VALLEY[0]) * t, cz = VALLEY[2] + (CAUSEWAY_END[2] - VALLEY[2]) * t; for (const s of [-1, -1, 1, 1]) b.v([cx + nx * s * Wd / 2, 0, cz + nz * s * Wd / 2], [t * L / 2.4, s]); }
  // top at 0.35..1.6 m: build as low walls by lifting inner rows
  for (let i = 0; i <= N; i++) { const k = i * 4; b.positions[(k + 1) * 3 + 1] = 1.6; b.positions[(k + 2) * 3 + 1] = 1.6; }
  for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) { const a = i * 4 + j; b.quad(a, a + 1, a + 5, a + 4); }
  const t = new B('temples', { mat: 'limestone_old', grade: 'C', label: 'Valley Temple and Khafre mortuary temple (massing)', layer: 'stone' });
  box(t, [VALLEY[0] + 7, 6, VALLEY[2] + 5], [45, 12, 45], { uvScale: 2.4 });
  box(t, [KHAFRE[0] + 150, 5, KHAFRE[2]], [56, 10, 110], { uvScale: 2.4 });
  return [b.out(), t.out()];
}

// ---------- underground: Osiris Shaft (Hawass 2007 dims via v3), interior of Khufu ----------
export function osirisShaft() {
  const b = new B('osiris_shaft', { mat: 'rock_cut', grade: 'C', label: 'Osiris Shaft: 9.62 + 13.25 + 7.50 m = 30.37 m', layer: 'below', note: 'Dimensions Hawass 2007 (CASAE 36) as carried in v3; plan schematic' });
  const O = OSIRIS, at = (x, y, z) => [O[0] + x, y, O[2] + z];
  box(b, at(0, -4.81, 0), [2, 9.62, 2], { inward: true });
  box(b, at(1.8, -8.27, 0), [8.6, 2.7, 3.85], { inward: true });
  box(b, at(4, -16.245, 0), [2, 13.25, 2], { inward: true });
  const yB = -(9.62 + 13.25); box(b, at(4, yB + 1.3, 0), [6.8, 2.6, 3.65], { inward: true });
  for (const dx of [-2.2, 0, 2.2]) for (const s of [1, -1]) box(b, at(4 + dx, yB + 1.1, s * 2.725), [1.6, 1.5, 1.8], { inward: true });
  box(b, at(6, yB - 3.75, 0), [1.65, 7.5, 1.9], { inward: true });
  const yC = yB - 7.5; box(b, at(6, yC + 2.25, 0), [9, 4.5, 9], { inward: true });
  const p = new B('osiris_level3', { mat: 'basalt', grade: 'C', label: 'Level 3: pillar stumps and basalt sarcophagus 228 x 108 cm', layer: 'below' });
  box(p, at(6, yC + 1.15, 0), [5.8, 2.3, 5.8]);
  for (const px of [-2.3, 2.3]) for (const pz of [-2.3, 2.3]) box(p, at(6 + px, yC + 1.8, pz), [1.5, 3.6, 1.5]);
  box(p, at(6, yC + 2.7, 0), [2.28, 0.8, 1.08]);
  const w = new B('osiris_water', { mat: 'water_deep', grade: 'C', label: 'Water in the level-3 trench', layer: 'below' });
  box(w, at(6, yC + 0.9, 0), [8.9, 1.8, 8.9]);
  return [b.out(), p.out(), w.out()];
}
export function khufuInterior() {
  const out = [], K = KING.c;
  const room = new B('kings_chamber', { mat: 'granite', grade: 'C', label: "King's Chamber 10.47 x 5.23 m, red granite", layer: 'inside', note: 'Petrie dimensions; height 5.85 m as in v3' });
  box(room, K, KING.size, { inward: true, uvScale: 1 });
  out.push(room.out());
  const beams = new B('chamber_beams', { mat: 'granite', grade: 'C', label: 'Nine granite ceiling beams', layer: 'inside' });
  for (let i = 0; i < 9; i++) box(beams, [K[0] - 5.235 + 0.58 + i * 1.155, K[1] + KING.size[1] / 2 - 0.12, K[2]], [1.08, 0.24, 5.23]);
  out.push(beams.out());
  const coffer = new B('coffer', { mat: 'granite', grade: 'C', label: 'Granite coffer, about 2.28 x 0.98 x 1.05 m (Petrie)', layer: 'inside' });
  const fy = KING_FLOOR, cx = K[0] - 3.4, cz = K[2] + 0.2;
  box(coffer, [cx, fy + 0.07, cz], [2.28, 0.14, 0.98]);
  for (const s of [-1, 1]) box(coffer, [cx, fy + 0.52, cz + s * 0.42], [2.28, 0.9, 0.14]);
  for (const s of [-1, 1]) box(coffer, [cx + s * 1.07, fy + 0.52, cz], [0.14, 0.9, 0.7]);
  out.push(coffer.out());
  // Grand Gallery: corbelled section rising south at 26 deg (v3: 46.7 m slope), shown as a hollow ramped hall.
  const g = new B('grand_gallery', { mat: 'limestone_fine', grade: 'C', label: 'Grand Gallery, 46.7 m at about 26 deg, corbelled', layer: 'inside' });
  const g0 = [K[0], 21.6, K[2] - 25], g1 = [K[0], 42.1, K[2] + 16.9], steps = 7;
  for (let s = 0; s < steps; s++) {
    const w = 2.06 - s * 0.14, y0 = s * 1.2, base = g.positions.length / 3;
    for (const [p, side] of [[g0, -1], [g1, -1], [g1, 1], [g0, 1]]) g.v([p[0] + side * w / 2, p[1] + y0, p[2]], [p[2] / 2, y0]);
    for (const [p, side] of [[g0, -1], [g1, -1], [g1, 1], [g0, 1]]) g.v([p[0] + side * w / 2, p[1] + y0 + 1.2, p[2]], [p[2] / 2, y0 + 1.2]);
    g.quad(base + 4, base + 5, base + 1, base); g.quad(base + 3, base + 2, base + 6, base + 7);   // inward walls
  }
  out.push(g.out());
  return out;
}

// ---------- Horizon (Giza IV) and Coil (Giza V): authored fiction ----------
export function kingAndInstruments() {
  const K = KING.c, fy = KING_FLOOR, at = [K[0] + 1.2, fy, K[2]];
  const body = new B('king', { mat: 'king_skin', grade: 'A', label: 'The king (authored figure)', layer: 'horizon', note: 'Giza IV fiction: figure, pose and placement are invented' });
  const kilt = new B('king_kilt', { mat: 'king_linen', grade: 'A', label: 'Shendyt kilt (authored)', layer: 'horizon' });
  for (const s of [-1, 1]) lathe(body, [at[0], fy, at[2] + s * 0.09], [[0.001, 0], [0.06, 0.02], [0.055, 0.3], [0.07, 0.52], [0.001, 0.53]], 12);  // legs
  lathe(kilt, [at[0], fy + 0.48, at[2]], [[0.001, 0], [0.27, 0.0], [0.24, 0.2], [0.2, 0.47], [0.001, 0.47]], 20);      // shendyt kilt, flared
  lathe(body, [at[0], fy + 0.95, at[2]], [[0.001, 0], [0.16, 0], [0.19, 0.3], [0.23, 0.48], [0.12, 0.55], [0.05, 0.6], [0.001, 0.6]], 18);  // torso and shoulders
  lathe(body, [at[0], fy + 1.52, at[2]], [[0.001, 0], [0.045, 0.0], [0.045, 0.06], [0.001, 0.06]], 10);   // neck
  sphere(body, [at[0], fy + 1.56, at[2]], 0.11, 18, 1.15);                                          // head
  out_arm(body, at, fy, 1); out_arm(body, at, fy, -1);
  const gold = new B('regalia', { mat: 'gold', grade: 'A', label: 'Nemes, collar and belt (authored)', layer: 'horizon' });
  lathe(gold, [at[0], fy + 1.42, at[2]], [[0.001, 0.32], [0.14, 0.3], [0.17, 0.12], [0.26, -0.02], [0.24, -0.2], [0.001, -0.2]], 22, { cap: false });
  torus(gold, [at[0], fy + 1.47, at[2]], 0.17, 0.035, 28, 8, { plane: 'xz' });
  torus(gold, [at[0], fy + 0.95, at[2]], 0.18, 0.025, 28, 8, { plane: 'xz' });
  const ankh = new B('ankh', { mat: 'ankh', grade: 'A', label: 'Ankh at the heart (symbol documented; glow invented)', layer: 'horizon' });
  const ah = [at[0] - 0.24, fy + 1.22, at[2] + 0.12];
  torus(ankh, [ah[0], ah[1] + 0.13, ah[2]], 0.07, 0.016, 28, 8); box(ankh, [ah[0], ah[1] + 0.04, ah[2]], [0.22, 0.03, 0.03]); box(ankh, [ah[0], ah[1] - 0.1, ah[2]], [0.03, 0.25, 0.03]);
  const was = new B('was', { mat: 'was', grade: 'A', label: 'Was-sceptre at the brow (symbol documented; coupling invented)', layer: 'horizon' });
  const wx = at[0] - 0.05, wz = at[2] - 0.34;
  cyl(was, [wx, fy + 0.85, wz], 0.017, 1.7, 10);
  const st = was.positions.length; box(was, [0, 0, 0], [0.16, 0.05, 0.05]); xform(was, st, { rz: 0.5, t: [wx + 0.05, fy + 1.72, wz] });
  for (const s of [-1, 1]) { const s0 = was.positions.length; box(was, [0, 0, 0], [0.025, 0.12, 0.025]); xform(was, s0, { rz: s * 0.35, t: [wx + s * 0.025, fy + 0.04, wz] }); }
  return [body.out(), kilt.out(), gold.out(), ankh.out(), was.out()];
}
function out_arm(b, at, fy, s) { const st = b.positions.length; lathe(b, [0, 0, 0], [[0.05, 0], [0.045, 0.55], [0.001, 0.56]], 10); xform(b, st, { rx: s * -0.25, t: [at[0], fy + 0.93, at[2] + s * 0.26] }); }

// Branching arc paths from Khufu's summit to the compressed sky sheet. Lines, not tubes: X3D LineSet,
// Babylon GreasedLine. Seeded so every reload draws the same arcs (choreography is time, not new geometry).
export function arcs({ height = 571, count = 9, seed = 1901 } = {}) {
  const R = rng(seed), top = [KHUFU[0], PYRAMIDS.khufu.today, KHUFU[2]], lines = [];
  for (let k = 0; k < count; k++) {
    const az = k / count * Math.PI * 2 + R() * 0.5, spread = 160 + R() * 280, end = [top[0] + Math.cos(az) * spread, height, top[2] + Math.sin(az) * spread];
    const main = bolt(top, end, 26, 22, R); lines.push(main);
    for (let j = 0; j < 3; j++) { const i = 4 + Math.floor(R() * 18), p = main[i], e = [p[0] + (R() - 0.5) * 180, p[1] + 40 + R() * 90, p[2] + (R() - 0.5) * 180]; lines.push(bolt(p, e, 9, 10, R)); }
  }
  return { id: 'arcs', mat: 'arc', grade: 'A', label: 'Standing arc channels (Giza V fiction)', layer: 'coil', note: 'Authored luminous paths; not a plasma or breakdown solution', lines };
}
function bolt(a, b, n, jitter, R) { const p = []; for (let i = 0; i <= n; i++) { const t = i / n, w = Math.sin(t * Math.PI); p.push([a[0] + (b[0] - a[0]) * t + (R() - 0.5) * jitter * w * 2, a[1] + (b[1] - a[1]) * t + (R() - 0.5) * jitter * w, a[2] + (b[2] - a[2]) * t + (R() - 0.5) * jitter * w * 2].map(r4)); } return p; }
export function fieldLines({ loops = 28, R0 = 150, r0 = 120 } = {}) {
  const c = [KHUFU[0], 70, KHUFU[2]], lines = [];
  for (let k = 0; k < loops; k++) { const a = k / loops * Math.PI * 2, l = []; for (let i = 0; i <= 64; i++) { const w = i / 64 * Math.PI * 2, rr = R0 + r0 * Math.cos(w); l.push([c[0] + rr * Math.cos(a), c[1] + r0 * Math.sin(w) * 0.9, c[2] + rr * Math.sin(a)].map(r4)); } lines.push(l); }
  return { id: 'field_lines', mat: 'field', grade: 'A', label: 'Toroidal field figure (authored)', layer: 'coil', lines };
}
export function canopy(height = 571) {
  const b = new B('canopy', { mat: 'canopy', grade: 'A', label: 'Sky sheet at 80 km, drawn at 571 m (log-compressed)', layer: 'coil', note: 'teslaResponse displayHeight = 320 + 180 log10(h / 3.218688 km)' });
  const c = [KHUFU[0], height, KHUFU[2]], seg = 64, rings = 10, Rm = 1500;
  const base = b.positions.length / 3;
  for (let r = 0; r <= rings; r++) for (let i = 0; i <= seg; i++) { const rr = Rm * (r / rings) ** 1.3, a = i / seg * Math.PI * 2; b.v([c[0] + rr * Math.cos(a), c[1] - 30 * (r / rings) ** 2, c[2] + rr * Math.sin(a)], [r / rings, i / seg]); }
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) { const a = base + r * (seg + 1) + i, d = a + seg + 1; b.quad(a, a + 1, d + 1, d); }
  return b.out();
}
export function nile() {
  const b = new B('nile', { mat: 'water', grade: 'L', label: 'Nile (schematic, drawn 1.6 km east; the river is about 8 km away)', layer: 'stone', note: 'Placement compressed for the frame' });
  const N = 80;
  for (let i = 0; i <= N; i++) { const z = -3200 + i / N * 6400, x = 1650 + Math.sin(z / 700) * 140 + Math.sin(z / 230) * 25, w = 170 + Math.sin(z / 400) * 30; b.v([x - w / 2, -21, z], [0, z / 40]); b.v([x + w / 2, -21, z], [w / 40, z / 40]); }
  for (let i = 0; i < N; i++) { const a = i * 2; b.quad(a, a + 2, a + 3, a + 1); }
  return b.out();
}
export function beacons() {
  const b = new B('beacons', { mat: 'beacon', grade: 'A', label: 'Valley beacons (Giza V fiction, schematic regional network)', layer: 'coil' });
  const pts = [];
  for (let i = 0; i < 7; i++) { const z = -2100 + i * 700, x = 1650 + Math.sin(z / 700) * 140 + (i % 2 ? 140 : -140); pts.push([x, -21, z]); obox(b, [x, -21 + 14, z], [4, 28, 4], 0.3 * i, {}); }
  return [b.out(), { id: 'beacon_links', mat: 'link', grade: 'A', label: 'Light links (authored)', layer: 'coil', lines: pts.map(p => [[KHUFU[0], 60, KHUFU[2]], [(p[0] + KHUFU[0]) / 2, 260, (p[2] + KHUFU[2]) / 2], p].map(q => q.map(r4))) }];
}

// ---------- Hawara (v4.1 recipe, staged at HAWARA_ORIGIN) ----------
// From v4 hawara.mjs: 12 courts in 2 x 6, 120 columns, optional lower walls at an illustrative depth.
export function hawara({ lowerDepth = -10 } = {}) {
  const H = HAWARA_ORIGIN, at = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];
  const g = new B('hawara_ground', { mat: 'sand', grade: 'L', label: 'Hawara ground (schematic)', layer: 'hawara' });
  const n = 60; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = -900 + i * 30, z = -900 + j * 30, d = Math.max(Math.abs(x) / 900, Math.abs(z) / 900); g.v(at(x, smooth(0.35, 1, d) * (8 + 6 * Math.sin(x * 0.01 + z * 0.006)) - 0.2, z), [x / 6, z / 6]); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, c = a + n + 1; g.quad(a, c, c + 1, a + 1); }
  const walls = new B('hawara_courts', { mat: 'limestone_old', grade: 'S', label: 'Twelve courts (Herodotus 2.148); arrangement invented', layer: 'hawara', note: 'Courts and 120 columns are an artistic arrangement prompted by the account (v4.1 README)' });
  const cols = new B('hawara_columns', { mat: 'limestone_fine', grade: 'S', label: '120 columns (invented arrangement)', layer: 'hawara' });
  const lower = new B('hawara_lower', { mat: 'conjecture', grade: 'S', label: 'Lower walls: a conjecture, not a radar depth', layer: 'hawara', note: `Illustrative depth ${lowerDepth} m (v4 range -8 to -70)` });
  for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
    const x = -125 + col * 50, z = -60 + row * 120;
    box(walls, at(x, 0.5, z), [46, 1, 108], { uvScale: 2.4 });
    for (const dz of [-52, 52]) box(walls, at(x, 9, z + dz), [46, 16, 2], { uvScale: 2.4 });
    for (const dx of [-22, 22]) box(walls, at(x + dx, 9, z), [2, 16, 104], { uvScale: 2.4 });
    for (let k = 0; k < 5; k++) for (const dx of [-17, 17]) { cyl(cols, at(x + dx, 7, z - 40 + k * 20), 1.5, 12, 12); box(cols, at(x + dx, 13.3, z - 40 + k * 20), [3.6, 0.6, 3.6]); }
    for (let k = 0; k < 4; k++) box(lower, at(x, lowerDepth + 2, z - 40 + k * 26), [40, 7, 2]);
  }
  const pyr = pyramid('hawara_pyramid', { c: at(0, 0, -215), base: 104, apex: 58, today: 20, src: 'v4.1: illustrative silhouette' }, { rows: 10, label: 'Amenemhat III pyramid (mudbrick core, ruined)' })[0];
  pyr.mat = 'mudbrick'; pyr.grade = 'L'; pyr.layer = 'hawara'; pyr.note = 'Ruined mudbrick core; silhouette illustrative';
  const water = new B('hawara_water', { mat: 'water', grade: 'S', label: 'Water plane: preservation-risk cue, not a measured table', layer: 'hawara' });
  const w = [at(-155, -5, -125), at(155, -5, -125), at(155, -5, 125), at(-155, -5, 125)].map((p, i) => water.v(p, [i & 1, i >> 1])); water.quad(w[0], w[3], w[2], w[1]);
  return [g.out(), walls.out(), cols.out(), lower.out(), pyr, water.out()];
}

// ---------- the whole world ----------
export function world() {
  const out = [terrain(), ...pyramid('khufu', PYRAMIDS.khufu, { label: 'Great Pyramid (Khufu)' }), ...pyramid('khafre', PYRAMIDS.khafre, { label: 'Khafre' }), ...pyramid('menkaure', PYRAMIDS.menkaure, { label: 'Menkaure' }),
    ...satellites(), ...sphinx(), ...causewayAndTemples(), nile(), ...osirisShaft(), ...khufuInterior(), ...kingAndInstruments(), canopy(), arcs(), fieldLines(), ...beacons(), ...hawara()];
  return out;
}
export function census(meshes = world()) {
  const by = {}; let v = 0, t = 0, l = 0;
  for (const m of meshes) { const nv = m.positions ? m.positions.length / 3 : 0, nt = m.indices ? m.indices.length / 3 : 0, nl = m.lines ? m.lines.reduce((s, x) => s + x.length, 0) : 0; v += nv; t += nt; l += nl; by[m.grade] = (by[m.grade] || 0) + 1; }
  return { meshes: meshes.length, vertices: v, triangles: t, linePoints: l, byGrade: by };
}
