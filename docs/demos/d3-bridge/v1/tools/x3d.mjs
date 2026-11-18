// d3-x3d: a tiny emitter. D3 does the layout maths; these helpers turn its output into X3D 4.0 XML.
// No runtime dependency: every function returns a string.

export const f = (n, d = 3) => {
  const s = (+n).toFixed(d);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s;
};
export const v = (a, d = 3) => a.map(x => f(x, d)).join(' ');
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const mfs = arr => arr.map(s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(' ');

// colour: "#rrggbb" or "rgb(r, g, b)" -> [0..1]^3
export function rgb(c) {
  if (Array.isArray(c)) return c;
  c = String(c).trim();
  if (c[0] === '#') { const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
  const m = c.match(/[\d.]+/g); return m.slice(0, 3).map(x => +x / 255);
}

// --- vectors
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const mul = (a, s) => a.map(x => x * s);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(...a);
export const norm = a => { const l = len(a) || 1; return a.map(x => x / l); };

// rotation (axis-angle) that turns +Y into direction d (for Cylinders/Cones along a vector)
export function rotY(d) {
  const n = norm(d); const c = n[1];
  if (c > 0.99999) return [0, 0, 1, 0];
  if (c < -0.99999) return [1, 0, 0, Math.PI];
  return [...norm(cross([0, 1, 0], n)), Math.acos(c)];
}
// Viewpoint orientation looking from pos to target with +Y up
export function lookAt(pos, target, up = [0, 1, 0]) {
  const fw = norm(sub(target, pos)); const r = norm(cross(fw, up)); const u = cross(r, fw); const b = mul(fw, -1);
  // rotation matrix columns r,u,b -> quaternion
  const m00 = r[0], m01 = u[0], m02 = b[0], m10 = r[1], m11 = u[1], m12 = b[1], m20 = r[2], m21 = u[2], m22 = b[2];
  const tr = m00 + m11 + m22; let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, w))); const sn = Math.sqrt(1 - w * w);
  return sn < 1e-6 ? [0, 0, 1, 0] : [x / sn, y / sn, z / sn, ang];
}

// --- appearance cache (DEF once, USE after) per scene
export class Scene {
  constructor(opts) { this.o = opts; this.apps = new Map(); this.n = 0; this.body = []; this.meta = opts.meta || {}; }
  app(color, { rough = 0.55, metal = 0.0, emissive = null, transp = 0, unlit = false, lineWidth = 0, point = 0 } = {}) {
    const c = rgb(color);
    const key = [c.map(x => x.toFixed(3)), rough, metal, emissive, transp, unlit, lineWidth, point].join('|');
    if (this.apps.has(key)) return `<Appearance USE='${this.apps.get(key)}'/>`;
    const id = 'A' + (this.n++); this.apps.set(key, id);
    let m;
    if (unlit) m = `<UnlitMaterial emissiveColor='${v(c)}'${transp ? ` transparency='${f(transp)}'` : ''}/>`;
    else m = `<PhysicalMaterial baseColor='${v(c)}' roughness='${f(rough)}' metallic='${f(metal)}'${emissive ? ` emissiveColor='${v(rgb(emissive))}'` : ''}${transp ? ` transparency='${f(transp)}'` : ''}/>`;
    const lp = lineWidth ? `<LineProperties linewidthScaleFactor='${f(lineWidth)}'/>` : '';
    const pp = point ? `<PointProperties pointSizeScaleFactor='${f(point)}' pointSizeMinValue='1' pointSizeMaxValue='${f(point * 2)}'/>` : '';
    return `<Appearance DEF='${id}'>${m}${lp}${pp}</Appearance>`;
  }
  add(...s) { this.body.push(...s); return this; }
  toString() {
    const o = this.o;
    const metas = Object.entries({ title: o.title, description: o.desc, generator: 'd3-x3d bridge v1 (tools/build.mjs)', ...this.meta })
      .map(([k, x]) => `<meta name='${esc(k)}' content='${esc(x)}'/>`).join('\n    ');
    const vps = (o.views || []).map((w, i) => {
      const ori = lookAt(w.pos, w.at || [0, 0, 0]);
      return `<Viewpoint DEF='VP${i}' description='${esc(w.name)}' position='${v(w.pos)}' orientation='${v(ori, 5)}' centerOfRotation='${v(w.at || [0, 0, 0])}' fieldOfView='${f(w.fov || 0.7854)}'/>`;
    }).join('\n    ');
    const bg = o.bg || { sky: ['#06070c', '#10131d', '#1b2133'], ground: ['#06070c', '#0b0d14'] };
    const sky = bg.sky.map(rgb), gr = bg.ground.map(rgb);
    const skyAng = sky.length === 3 ? `skyAngle='1.2 1.571'` : sky.length === 2 ? `skyAngle='1.571'` : '';
    const grAng = gr.length === 2 ? `groundAngle='1.571'` : '';
    const lights = o.lights === false ? '' : (o.lights || defaultLights(o.shadows)).join('\n    ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
  <head>
    <component name='Shape' level='5'/>
    <component name='Lighting' level='3'/>
    ${metas}
  </head>
  <Scene>
    <WorldInfo title='${esc(o.title)}' info='${esc(mfs([o.desc]))}'/>
    <NavigationInfo type='"EXAMINE" "ANY"' headlight='false' transitionType='"ANIMATE"' transitionTime='1.2'/>
    <Background skyColor='${sky.map(c => v(c)).join(', ')}' ${skyAng} groundColor='${gr.map(c => v(c)).join(', ')}' ${grAng}/>
    ${vps}
    ${lights}
    ${this.body.join('\n    ')}
  </Scene>
</X3D>
`;
  }
}
export function defaultLights(shadows = false) {
  const sh = shadows ? ` shadows='true' shadowIntensity='0.55'` : '';
  return [
    `<DirectionalLight DEF='Key' direction='-0.45 -0.8 -0.4' intensity='1.25' color='1 0.96 0.9'${sh}/>`,
    `<DirectionalLight DEF='Fill' direction='0.6 -0.35 0.5' intensity='0.45' color='0.75 0.85 1'/>`,
    `<DirectionalLight DEF='Rim' direction='0.1 0.3 1' intensity='0.35' color='0.9 0.9 1'/>`,
  ];
}

export const T = (t, kids, { r = null, s = null, def = null } = {}) =>
  `<Transform${def ? ` DEF='${def}'` : ''} translation='${v(t)}'${r ? ` rotation='${v(r, 5)}'` : ''}${s ? ` scale='${v(s)}'` : ''}>${[].concat(kids).join('')}</Transform>`;
export const shape = (geom, app, def = null) => `<Shape${def ? ` DEF='${def}'` : ''}>${app}${geom}</Shape>`;
export const box = s => `<Box size='${v(s.map(x => Math.max(x, 0.001)))}'/>`;
export const sphere = r => `<Sphere radius='${f(Math.max(r, 0.001))}'/>`;
export const cyl = (r, h) => `<Cylinder radius='${f(Math.max(r, 0.001))}' height='${f(Math.max(h, 0.001))}'/>`;

// Billboarded text label (screen-aligned)
export function label(sc, text, pos, { size = 0.22, color = '#d8deea', justify = 'MIDDLE', yalign = 'MIDDLE' } = {}) {
  return T(pos, `<Billboard axisOfRotation='0 0 0'><Shape>${sc.app(color, { unlit: true })}<Text string='${esc(mfs([].concat(text)))}' solid='false'><FontStyle family='"SANS"' size='${f(size)}' justify='"${justify}" "${yalign}"'/></Text></Shape></Billboard>`);
}
// Flat text lying on/along a plane (not billboarded)
export function flatText(sc, text, pos, { size = 0.22, color = '#aab3c5', rot = null, justify = 'MIDDLE' } = {}) {
  return T(pos, `<Shape>${sc.app(color, { unlit: true })}<Text string='${esc(mfs([].concat(text)))}' solid='false'><FontStyle family='"SANS"' size='${f(size)}' justify='"${justify}" "MIDDLE"'/></Text></Shape>`, { r: rot });
}

// polyline set: lines = [[p,p,...], ...], colors optional per line
export function lines(sc, ls, color, { colors = null, width = 1, def = null, coordDef = null, transp = 0 } = {}) {
  let idx = [], pts = [], k = 0;
  for (const l of ls) { for (const p of l) { pts.push(v(p)); idx.push(k++); } idx.push(-1); }
  const col = colors ? `<Color color='${colors.map(c => v(rgb(c))).join(' ')}'/>` : '';
  return shape(`<IndexedLineSet coordIndex='${idx.join(' ')}'${colors ? ` colorPerVertex='false'` : ''}><Coordinate${coordDef ? ` DEF='${coordDef}'` : ''} point='${pts.join(' ')}'/>${col}</IndexedLineSet>`,
    sc.app(color, { unlit: true, lineWidth: width, transp }), def);
}

// tube along a polyline (Extrusion, circular cross-section)
export function tube(path, r, n = 10) {
  const cs = []; for (let i = 0; i <= n; i++) { const a = -2 * Math.PI * i / n; cs.push(f(Math.cos(a) * r, 4) + ' ' + f(Math.sin(a) * r, 4)); }
  return `<Extrusion spine='${path.map(p => v(p)).join(' ')}' crossSection='${cs.join(' ')}' beginCap='false' endCap='false' creaseAngle='3.14' solid='false'/>`;
}
// solid of revolution: profile radii along a vertical spine
export function revolve(ys, rs, n = 28) {
  const cs = []; for (let i = 0; i <= n; i++) { const a = -2 * Math.PI * i / n; cs.push(f(Math.cos(a), 4) + ' ' + f(Math.sin(a), 4)); }
  return `<Extrusion spine='${ys.map(y => '0 ' + f(y) + ' 0').join(' ')}' crossSection='${cs.join(' ')}' scale='${rs.map(r => f(Math.max(r, 0.004), 4) + ' ' + f(Math.max(r, 0.004), 4)).join(' ')}' creaseAngle='3.14' solid='false' beginCap='true' endCap='true'/>`;
}

export function faces(sc, verts, faceList, color, opts = {}, colors = null) {
  const col = colors ? `<Color color='${colors.map(c => v(rgb(c))).join(' ')}'/>` : '';
  return shape(`<IndexedFaceSet solid='false' creaseAngle='${f(opts.crease ?? 0.6)}' coordIndex='${faceList.map(fc => fc.join(' ') + ' -1').join(' ')}'${colors ? ` colorPerVertex='true'` : ''}><Coordinate point='${verts.map(p => v(p)).join(' ')}'/>${col}</IndexedFaceSet>`, sc.app(color, opts));
}
