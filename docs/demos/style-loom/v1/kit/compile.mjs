// compile(scene, style) -> X3D 4.0 XML text.
// The scene says WHAT is there (roles and data). The style says HOW it looks.
// The output carries both back: one MetadataSet for the style, one xst:role tag per group,
// so any reader can lift the style out again or bind a different one.
import * as C from './color.mjs';
import { resolve, flatten, NS, VERSION, idOf } from './grammar.mjs';

const f3 = v => (Math.abs(v) < 5e-4 ? '0' : String(+v.toFixed(3)));
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const mfs = t => `"${String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const rgb = hex => C.hexToRgb(hex).map(c => f3(c)).join(' ');

/** Height of a mark in scene units. Square root so small values stay visible. */
export const heightOf = (scene, m) => 0.5 + 9.5 * Math.sqrt(m.value);

/** A triangle and line mesh builder with per-vertex colour. */
class Mesh {
  constructor(linear = false) { this.p = []; this.c = []; this.i = []; this.linear = linear; }
  // X_ITE reads Color under a PhysicalMaterial as linear light (the glTF convention) and under Material or
  // UnlitMaterial as sRGB, so a physical mesh writes linear values to land on the same displayed colour.
  v(x, y, z, hex) { this.p.push(f3(x), f3(y), f3(z)); this.c.push(this.linear ? C.rgbToLinear(C.hexToRgb(hex)).map(f3).join(' ') : rgb(hex)); return this.p.length / 3 - 1; }
  face(...ix) { this.i.push(...ix, -1); }
  get empty() { return this.i.length === 0; }
  ifs(extra = '') { return `<IndexedFaceSet solid='false' colorPerVertex='true' ${extra} coordIndex='${this.i.join(' ')}'><Coordinate point='${this.p.join(' ')}'/><Color color='${this.c.join(' ')}'/></IndexedFaceSet>`; }
  ils() { return `<IndexedLineSet colorPerVertex='true' coordIndex='${this.i.join(' ')}'><Coordinate point='${this.p.join(' ')}'/><Color color='${this.c.join(' ')}'/></IndexedLineSet>`; }
}

function keyDir(light) {
  const a = light.azimuth * Math.PI / 180, e = light.elevation * Math.PI / 180;
  // direction the light travels: from the sun (azimuth clockwise from north = -Z) down to the ground
  return [-Math.sin(a) * Math.cos(e), -Math.sin(e), Math.cos(a) * Math.cos(e)];
}

/**
 * Add a prism (the one form every mass is made of) to a mesh.
 * sides, taper, tiers, inset and cap come from the style's form part.
 * colour(yFrac, normal) returns the hex for a vertex: the style decides shading.
 */
function prism(mesh, edges, m, h, half, form, colour, edgeHex) {
  const n = Math.max(3, Math.round(form.sides));
  const tiers = Math.max(1, Math.round(form.tiers));
  const rot = n === 4 ? Math.PI / 4 : 0;
  const rscale = n === 4 ? Math.SQRT2 : 1 / Math.cos(Math.PI / n);     // keep the footprint width
  const ring = (r, y, yf, shadeN) => {
    const ids = [];
    for (let k = 0; k < n; k++) {
      const a = rot + 2 * Math.PI * k / n;
      ids.push([m.x + Math.cos(a) * r * rscale, y, m.z + Math.sin(a) * r * rscale, a]);
    }
    return ids;
  };
  const smooth = n >= 12;
  let y0 = 0;
  for (let t = 0; t < tiers; t++) {
    const th = h / tiers;
    const rBase = half * (1 - form.inset * t);
    const rTop = rBase * (tiers === 1 ? form.taper : 1 - (1 - form.taper) / tiers);
    const y1 = y0 + th;
    const A = ring(rBase, y0), B = ring(rTop, y1);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const am = smooth ? null : rot + 2 * Math.PI * (k + 0.5) / n;
      const nrm = a => [Math.cos(a), 0.15, Math.sin(a)];
      const q = [[A[k], y0 / h], [A[k2], y0 / h], [B[k2], y1 / h], [B[k], y1 / h]].map(([pt, yf]) => mesh.v(pt[0], pt[1], pt[2], colour(yf, nrm(smooth ? pt[3] : am), false)));
      mesh.face(q[3], q[2], q[1], q[0]);
    }
    // the flat shelf or cap on top of this tier
    const last = t === tiers - 1;
    if (last && form.cap === 'spike') {
      const tip = [m.x, y1 + Math.min(h * 0.35, half * 2.2), m.z];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n, am = rot + 2 * Math.PI * (k + 0.5) / n;
        const nr = [Math.cos(am) * 0.7, 0.7, Math.sin(am) * 0.7];
        const a = mesh.v(B[k][0], y1, B[k][2], colour(1, nr, true)), b = mesh.v(B[k2][0], y1, B[k2][2], colour(1, nr, true)), c = mesh.v(...tip, colour(1, nr, true));
        mesh.face(c, b, a);
      }
    } else {
      const ids = B.map(pt => mesh.v(pt[0], y1, pt[2], colour(1, [0, 1, 0], true)));
      mesh.face(...ids.slice().reverse());
    }
    if (edges) {
      const ring2 = pts => { const ids = pts.map(pt => edges.v(pt[0], pt[1] + 0.01, pt[2], edgeHex)); edges.i.push(...ids, ids[0], -1); return ids; };
      const b = ring2(B);
      if (t === 0) { const a = ring2(A); if (n <= 8) for (let k = 0; k < n; k++) edges.i.push(a[k], b[k], -1); }
      else if (n <= 8) { const a = A.map(pt => edges.v(pt[0], pt[1] + 0.01, pt[2], edgeHex)); for (let k = 0; k < n; k++) edges.i.push(a[k], b[k], -1); }
    }
    y0 = y1;
  }
  return y0;
}

function appearance(s, opts = {}) {
  // ground and plate are always matte; under a physical style they fall back to Material so they stay albedo-true
  const sf = opts.matte ? { ...s.surface, model: s.surface.model === 'physical' ? 'phong' : s.surface.model, roughness: 1, opacity: 1 } : s.surface;
  const tr = sf.opacity < 1 ? ` transparency='${f3(1 - sf.opacity)}'` : '';
  if (opts.emissive) {
    const e = opts.emissive, d = opts.def ? ` DEF='${opts.def}'` : '';
    if (sf.model === 'unlit' || opts.pure) return `<Appearance><UnlitMaterial${d} emissiveColor='${rgb(e)}'/></Appearance>`;
    const g = opts.glow ?? 0;
    return `<Appearance><Material${d} diffuseColor='${rgb(C.shade(e, 1 - g * 0.8))}' emissiveColor='${rgb(C.shade(e, g))}' specularColor='0.1 0.1 0.1'/></Appearance>`;
  }
  if (sf.model === 'unlit') return `<Appearance><UnlitMaterial${tr}/></Appearance>`;
  if (sf.model === 'physical') return `<Appearance><PhysicalMaterial metallic='${f3(sf.metallic)}' roughness='${f3(sf.roughness)}'${tr}/></Appearance>`;
  const spec = (1 - sf.roughness) * 0.6;
  return `<Appearance><Material ambientIntensity='1' specularColor='${f3(spec)} ${f3(spec)} ${f3(spec)}' shininess='${f3(0.05 + (1 - sf.roughness) * 0.5)}'${tr}/></Appearance>`;
}

const role = (name, def, body, extra = '') => `<Group DEF='${def}'><MetadataString containerField='metadata' name='xst:role' reference='${NS}' value='${mfs(name)}'/>${extra}${body}</Group>`;

/** Points along the arc of a link, lifted by the style's form.lift. */
function arc(a, b, lift, n = 24) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), h = Math.max(1.5, d * lift);
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [a.x + (b.x - a.x) * t, 0.4 + 4 * h * t * (1 - t), a.z + (b.z - a.z) * t]; });
}

export function compile(scene, styleIn, opts = {}) {
  const s = resolve(styleIn);
  const p = s.palette, E = scene.extent, sid = idOf(s);
  const unlit = s.surface.model === 'unlit';
  const L = keyDir(s.light);
  // relief: unlit styles get their shading baked into the vertex colours, so it survives any engine.
  const lambert = nr => { const len = Math.hypot(...nr); const d = -(nr[0] * L[0] + nr[1] * L[1] + nr[2] * L[2]) / len; return 0.5 + 0.5 * d; };
  const shadeFor = nr => (unlit ? 1 - s.light.relief * (1 - lambert(nr)) : 1);
  const contactAt = yf => 1 - s.light.contact * 0.55 * Math.pow(1 - Math.min(1, yf * 2.2), 2);
  const dataHex = m => (s.encode.hue === 'category' ? p.categorical[m.family % p.categorical.length] : s.encode.hue === 'value' ? C.ramp(p.sequential, Math.sqrt(m.value)) : p.mass);

  const lin = s.surface.model === 'physical';
  const mass = new Mesh(lin), alert = new Mesh(lin), hero = new Mesh(lin), plate = new Mesh(), ground = new Mesh();
  const edges = s.line.edges === 'none' ? null : new Mesh();
  const half = scene.cell * s.form.fill / 2;
  const tops = {};
  for (const m of scene.marks) {
    const h = heightOf(scene, m);
    const base = m.hero ? p.accent : m.alert ? p.alert : C.mix(p.mass, dataHex(m), s.surface.tint);
    const cap = C.tone(base, s.surface.capTone);
    const glowing = (m.alert && s.encode.alert === 'glow') || (m.hero && s.surface.glow > 0.5);
    const colour = (yf, nr, isCap) => C.shade(isCap ? cap : base, glowing ? 1 : shadeFor(nr) * (isCap ? 1 : contactAt(yf)));
    const eHex = m.alert ? p.alert : m.hero ? p.accent : s.line.edges === 'data' ? dataHex(m) : p.ink;
    const form = m.hero ? { ...s.form, cap: 'spike', tiers: Math.max(2, s.form.tiers) } : s.form;
    tops[m.id] = prism(m.hero ? hero : m.alert ? alert : mass, edges, m, h, half, form, colour, eHex);
  }
  // plates: one low slab per district
  const PH = 0.14;
  for (const d of scene.districts) {
    const x0 = d.x - d.w / 2, x1 = d.x + d.w / 2, z0 = d.z - d.d / 2, z1 = d.z + d.d / 2;
    const top = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]].map(([x, z]) => plate.v(x, 0, z, p.plate));
    plate.face(...top);
    const side = C.shade(p.plate, 0.8);
    for (let k = 0; k < 4; k++) { const [a, b] = [[x0, z0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]].slice(k, k + 2); const q = [[a, 0], [b, 0], [b, -PH], [a, -PH]].map(([pt, y]) => plate.v(pt[0], y, pt[1], side)); plate.face(q[3], q[2], q[1], q[0]); }
    if (edges && s.line.edges === 'ink') { const ids = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]].map(([x, z]) => edges.v(x, 0.012, z, C.mix(p.plate, p.ink, 0.55))); edges.i.push(...ids, ids[0], -1); }
  }
  // ground: a grid whose vertex colours carry the contact shade around every district
  const G = 64, R = E * 6, gy = -PH;
  const occ = (x, z) => { let o = 0; for (const d of scene.districts) { const dx = Math.max(Math.abs(x - d.x) - d.w / 2, 0), dz = Math.max(Math.abs(z - d.z) - d.d / 2, 0); const dist = Math.hypot(dx, dz); o = Math.max(o, Math.exp(-dist / 1.6)); } return o; };
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const u = i / G * 2 - 1, v = j / G * 2 - 1;
    const x = Math.sign(u) * Math.pow(Math.abs(u), 2.6) * R, z = Math.sign(v) * Math.pow(Math.abs(v), 2.6) * R;   // denser near the city
    ground.v(x, gy, z, C.shade(p.ground, 1 - s.light.contact * 0.5 * occ(x, z)));
  }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = j * (G + 1) + i; ground.face(a, a + G + 1, a + G + 2, a + 1); }

  // grid ornament
  const grid = new Mesh();
  const gridHex = C.mix(p.ground, p.ink, 0.22);
  if (s.line.grid === 'lines') {
    const stepG = scene.cell * 4, n = Math.ceil(E * 0.75 / stepG);
    for (let k = -n; k <= n; k++) { const t = k * stepG, e = n * stepG; let a = grid.v(t, gy + 0.02, -e, gridHex), b = grid.v(t, gy + 0.02, e, gridHex); grid.i.push(a, b, -1); a = grid.v(-e, gy + 0.02, t, gridHex); b = grid.v(e, gy + 0.02, t, gridHex); grid.i.push(a, b, -1); }
  } else if (s.line.grid === 'rings') {
    const core = scene.districts.find(d => d.id === 'Core') || { x: 0, z: 0 };
    for (let r = 6; r < E * 0.95; r += 6) { const ids = []; for (let k = 0; k < 96; k++) { const a = 2 * Math.PI * k / 96; ids.push(grid.v(core.x + Math.cos(a) * r, gy + 0.02, core.z + Math.sin(a) * r, gridHex)); } grid.i.push(...ids, ids[0], -1); }
  }

  // links
  const byId = Object.fromEntries(scene.districts.map(d => [d.id, d]));
  const linkHex = s.line.linkInk === 'accent' ? p.accent : C.mix(p.plate, p.ink, 0.8);
  const links = new Mesh(lin && s.line.links === 'tube'), arcs = [];
  for (const l of scene.links) {
    const pts = arc(byId[l.from], byId[l.to], s.form.lift); arcs.push(pts);
    if (s.line.links === 'line') { const ids = pts.map(q => links.v(q[0], q[1], q[2], linkHex)); links.i.push(...ids, -1); } else {
      const rad = 0.07 * s.line.weight, K = 5, rings = pts.map((q, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(...t); const T = t.map(v => v / tl);
        let n1 = [-T[2], 0, T[0]]; const nl = Math.hypot(...n1) || 1; n1 = n1.map(v => v / nl);
        const n2 = [T[1] * n1[2] - T[2] * n1[1], T[2] * n1[0] - T[0] * n1[2], T[0] * n1[1] - T[1] * n1[0]];
        return Array.from({ length: K }, (_, k) => { const ang = 2 * Math.PI * k / K, cs = Math.cos(ang), sn = Math.sin(ang); const nr = [n1[0] * cs + n2[0] * sn, n1[1] * cs + n2[1] * sn, n1[2] * cs + n2[2] * sn]; return links.v(q[0] + nr[0] * rad, q[1] + nr[1] * rad, q[2] + nr[2] * rad, C.shade(linkHex, shadeFor(nr))); });
      });
      for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < K; k++) { const k2 = (k + 1) % K; links.face(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]); }
    }
  }

  // labels: the biggest districts get a name, standing at their front edge
  const nLab = Math.round(s.type.density * scene.districts.length);
  const labelled = scene.districts.slice().sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, nLab);
  const fs = `<FontStyle DEF='XST_Font' family='${mfs(s.type.family)}' size='${f3(1.15 * s.type.size)}' justify='"MIDDLE" "BEGIN"' style='${s.type.family === 'SERIF' ? 'PLAIN' : 'BOLD'}'/>`;
  const txt = t => (s.type.case === 'upper' ? t.toUpperCase() : t);
  const labels = labelled.map((d, i) => `<Transform translation='${f3(d.x)} 0.05 ${f3(d.z + d.d / 2 + 0.25)}' rotation='1 0 0 -1.5708'><Shape><Appearance><UnlitMaterial emissiveColor='${rgb(p.ink)}'/></Appearance><Text string='${mfs(txt(d.label))}' solid='false'>${i === 0 ? fs : "<FontStyle USE='XST_Font'/>"}</Text></Shape></Transform>`).join('');

  // motion
  let motion = '', packets = '';
  if (s.motion.pulse > 0 && !alert.empty) {
    const hi = unlit ? p.alert : C.shade(p.alert, s.surface.glow || 0.6), lo = C.shade(p.alert, unlit ? 0.45 : 0.08);
    motion += `<TimeSensor DEF='XST_Pulse' cycleInterval='${f3(s.motion.pulse)}' loop='true'/><ColorInterpolator DEF='XST_PulseColor' key='0 0.5 1' keyValue='${rgb(hi)} ${rgb(lo)} ${rgb(hi)}'/>`
      + `<ROUTE fromNode='XST_Pulse' fromField='fraction_changed' toNode='XST_PulseColor' toField='set_fraction'/><ROUTE fromNode='XST_PulseColor' fromField='value_changed' toNode='XST_AlertMat' toField='set_emissiveColor'/>`;
  }
  if (s.motion.flow > 0) {
    motion += `<TimeSensor DEF='XST_Flow' cycleInterval='${f3(s.motion.flow)}' loop='true'/>`;
    arcs.forEach((pts, i) => {
      const keys = pts.map((_, k) => f3(k / (pts.length - 1))).join(' ');
      packets += `<Transform DEF='XST_P${i}'><Shape>${i === 0 ? `<Appearance DEF='XST_PacketApp'><UnlitMaterial emissiveColor='${rgb(p.accent)}'/></Appearance><Sphere DEF='XST_PacketGeo' radius='0.22'/>` : "<Appearance USE='XST_PacketApp'/><Sphere USE='XST_PacketGeo'/>"}</Shape></Transform>`;
      motion += `<PositionInterpolator DEF='XST_PI${i}' key='${keys}' keyValue='${pts.map(q => q.map(f3).join(' ')).join(' ')}'/><ROUTE fromNode='XST_Flow' fromField='fraction_changed' toNode='XST_PI${i}' toField='set_fraction'/><ROUTE fromNode='XST_PI${i}' fromField='value_changed' toNode='XST_P${i}' toField='set_translation'/>`;
    });
  }

  // air and light
  const sky = p.sky, horizon = sky[sky.length - 1];
  const skyCols = [sky[0], C.mix(sky[0], horizon, 0.6), horizon].map(rgb).join(' ');
  const bg = `<Background DEF='XST_Sky' skyColor='${skyCols}' skyAngle='1.1 1.5708' groundColor='${rgb(p.ground)} ${rgb(C.mix(p.ground, horizon, 0.7))} ${rgb(horizon)}' groundAngle='1.2 1.5708'/>`;
  const fog = s.air.fog === 'none' ? '' : `<Fog DEF='XST_Fog' fogType='${s.air.fog === 'exp' ? 'EXPONENTIAL' : 'LINEAR'}' color='${rgb(p.haze)}' visibilityRange='${f3(s.air.range * E)}'/>`;
  // Albedo-true exposure: scale key, fill and ambient so an unshadowed, upward-facing surface is drawn at exactly
  // its palette colour. Then the ground meets the Background at the horizon, and what the linter measured on the
  // palette is what the frame shows. light.intensity sets the key-to-ambient ratio (contrast), not the brightness.
  const fillDir = [-L[0], L[1] * 0.6, -L[2]], fl = Math.hypot(...fillDir), nf = -fillDir[1] / fl;
  const wKey = s.light.intensity * -L[1], wAmb = s.light.ambient, wFill = 0.45 * s.light.ambient * s.light.intensity * nf;
  const k = wKey + wAmb + wFill;
  const lights = unlit ? '' : `<DirectionalLight DEF='XST_Key' direction='${L.map(f3).join(' ')}' intensity='${f3(s.light.intensity / k)}' ambientIntensity='${f3(wAmb / k)}' global='true' shadows='${s.light.shadow > 0}' shadowIntensity='${f3(s.light.shadow)}'/>`
    + `<DirectionalLight DEF='XST_Fill' direction='${fillDir.map(f3).join(' ')}' intensity='${f3(0.45 * s.light.ambient * s.light.intensity / k)}' global='true'/>`;

  // views
  const cx = 0, cz = 0, o = s.view.projection === 'ortho';
  const look = (px, py, pz, tx, ty, tz) => { // orientation that looks from p to t with +Y up
    const f = [tx - px, ty - py, tz - pz], fl = Math.hypot(...f); const F = f.map(v => v / fl);
    const right = [F[1] * 0 - F[2] * 1, F[2] * 0 - F[0] * 0, F[0] * 1 - F[1] * 0]; const rn = Math.hypot(...right) || 1; const Rg = rn < 1e-6 ? [1, 0, 0] : right.map(v => v / rn);
    const U = [Rg[1] * F[2] - Rg[2] * F[1], Rg[2] * F[0] - Rg[0] * F[2], Rg[0] * F[1] - Rg[1] * F[0]];
    const B = F.map(v => -v);
    const m = [Rg[0], U[0], B[0], Rg[1], U[1], B[1], Rg[2], U[2], B[2]];
    const tr = m[0] + m[4] + m[8]; const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
    if (ang < 1e-6) return '0 1 0 0';
    let ax = [m[7] - m[5], m[2] - m[6], m[3] - m[1]]; const al = Math.hypot(...ax);
    if (al < 1e-6) return `0 1 0 ${f3(Math.PI)}`;
    ax = ax.map(v => v / al);
    return `${ax.map(f3).join(' ')} ${f3(ang)}`;
  };
  const vp = (def, desc, px, py, pz, tx, ty, tz, fov) => {
    const or = look(px, py, pz, tx, ty, tz);
    if (o) { const hw = fov; return `<OrthoViewpoint DEF='${def}' description='${esc(desc)}' position='${f3(px)} ${f3(py)} ${f3(pz)}' orientation='${or}' centerOfRotation='${cx} 0 ${cz}' fieldOfView='${f3(-hw)} ${f3(-hw * 0.625)} ${f3(hw)} ${f3(hw * 0.625)}'/>`; }
    return `<Viewpoint DEF='${def}' description='${esc(desc)}' position='${f3(px)} ${f3(py)} ${f3(pz)}' orientation='${or}' centerOfRotation='${cx} 0 ${cz}' fieldOfView='0.62'/>`;
  };
  const views = {
    hero: vp('VP_Hero', 'Hero', E * 0.52, E * 0.52, E * 0.98, 0, 3, -E * 0.02, E * 0.56),
    plan: vp('VP_Plan', 'Plan', 0, E * 1.25, E * 0.07, 0, 0, 0, E * 0.74),   // not the exact nadir: X_ITE 16.7.1 turned an exact top view by 180 degrees
    street: vp('VP_Street', 'Street', -E * 0.42, E * 0.1, E * 0.74, E * 0.04, 3.5, -E * 0.05, E * 0.4),
  };
  const order = [s.view.start, ...Object.keys(views).filter(k => k !== s.view.start)];

  const tokens = flatten(s).map(([k, v]) => `<MetadataString containerField='value' name='xst:${k.replace('.', '_')}' value='${mfs(v)}'/>`).join('');   // '.' would clash with ClassicVRML ROUTE syntax
  const lintRes = opts.lint;
  const meta = `<MetadataSet DEF='XST_Style' name='xst:Style' reference='${NS}${esc(sid)}'>`
    + `<MetadataString containerField='value' name='xst:label' value='${mfs(esc(s.label || sid))}'/>`
    + `<MetadataString containerField='value' name='xst:grammar' value='${mfs(VERSION)}'/>`
    + (s.intent ? `<MetadataString containerField='value' name='xst:intent_key' value='${mfs(s.intent.key)}'/>` : '')
    + (lintRes ? `<MetadataString containerField='value' name='xst:lint' value='${mfs(`${lintRes.passed}/${lintRes.applicable}`)}'/>` : '')
    + (s.operator ? `<MetadataString containerField='value' name='xst:operator' value='${mfs(s.operator)}'/>` : '')
    + tokens + `</MetadataSet>`;
  const lineApp = (w, hex) => `<Appearance><LineProperties linewidthScaleFactor='${f3(w)}'/>${hex ? `<UnlitMaterial emissiveColor='${rgb(hex)}'/>` : ''}</Appearance>`;
  const alertGlow = s.encode.alert === 'glow';
  const shapes = [
    role('ground', 'Role_ground', `<Shape>${appearance(s, { matte: true })}${ground.ifs()}</Shape>`),
    role('plate', 'Role_plate', `<Shape>${appearance(s, { matte: true })}${plate.ifs()}</Shape>`),
    grid.empty ? '' : role('grid', 'Role_grid', `<Shape>${lineApp(1)}${grid.ils()}</Shape>`),
    role('mass', 'Role_mass', `<Shape>${appearance(s)}${mass.ifs(s.form.sides >= 12 ? "creaseAngle='1.2'" : '')}</Shape>`),
    alert.empty ? '' : role('alert', 'Role_alert', `<Shape>${alertGlow ? appearance(s, { emissive: p.alert, glow: s.surface.glow, def: 'XST_AlertMat', pure: false }) + alert.ifs().replace(/<Color [^>]*\/>/, '').replace("colorPerVertex='true'", "colorPerVertex='false'") : appearance(s) + alert.ifs()}</Shape>`),
    hero.empty ? '' : role('hero', 'Role_hero', `<Shape>${appearance(s)}${hero.ifs()}</Shape>`),
    edges && !edges.empty ? role('edge', 'Role_edge', `<Shape>${lineApp(s.line.weight)}${edges.ils()}</Shape>`) : '',
    role('link', 'Role_link', `<Shape>${s.line.links === 'line' ? lineApp(s.line.weight) + links.ils() : appearance(s) + links.ifs("creaseAngle='2'")}</Shape>`),
    packets ? role('packet', 'Role_packet', packets) : '',
    labels ? role('label', 'Role_label', labels) : '',
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head>
<component name='Navigation' level='3'/>
<component name='Shape' level='2'/>
<meta name='title' content='${esc(scene.title)} in ${esc(s.label || sid)}'/>
<meta name='description' content='${esc(scene.about)}'/>
<meta name='generator' content='x3d.loom x3d.style compile.mjs (${VERSION})'/>
<meta name='reference' content='${NS}${esc(sid)}'/>
</head>
<Scene>
<WorldInfo title='${esc(scene.title)} in ${esc(s.label || sid)}'/>
<NavigationInfo type='"EXAMINE" "ANY"' headlight='false' transitionType='"TELEPORT"' visibilityLimit='${f3(E * 12)}'/>
${bg}
${fog}
${lights}
${order.map(k => views[k]).join('\n')}
<Group DEF='XST_World'>${meta.replace("<MetadataSet DEF='XST_Style'", "<MetadataSet containerField='metadata' DEF='XST_Style'")}
${shapes}
</Group>
${motion}
</Scene>
</X3D>
`;
}
