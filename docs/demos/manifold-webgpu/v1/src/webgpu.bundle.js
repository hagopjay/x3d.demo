(function () {
"use strict";
/* x3d reader for the Babylon body: parser, field tables, event model (copied from viewer-v3, extended with the nodes the brain scenes use) */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
};
const m4 = { ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; } };
const quat = {
  fromAxisAngle(ax, ang) { const n = v3.norm(ax); if (!n[0] && !n[1] && !n[2]) return [0, 0, 0, 1]; const s = Math.sin(ang / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; },
  mul: (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
                  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
  norm(a) { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; },
  rotate(q, v) {
    const u = [q[0], q[1], q[2]], w = q[3], uv = v3.cross(u, v), uuv = v3.cross(u, uv);
    return [v[0] + 2 * (w * uv[0] + uuv[0]), v[1] + 2 * (w * uv[1] + uuv[1]), v[2] + 2 * (w * uv[2] + uuv[2])];
  },
  slerp(a, b, t) { // shortest path, as 19775-1 asks of OrientationInterpolator
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((x) => -x); d = -d; }
    if (d > 0.9995) return quat.norm(a.map((x, i) => x + (b[i] - x) * t));
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((x, i) => x * wa + b[i] * wb);
  },
  toAxisAngle(q) {
    const w = clamp(q[3], -1, 1), s = Math.sqrt(1 - w * w);
    if (s < 1e-6) return [0, 0, 1, 0];
    return [q[0] / s, q[1] / s, q[2] / s, 2 * Math.acos(w)];
  },
  fromMat(m) { // rotation part of a column-major matrix with uniform scale (the Viewpoint's parent transform)
    const c = (i) => { const l = Math.hypot(m[i], m[i + 1], m[i + 2]) || 1; return [m[i] / l, m[i + 1] / l, m[i + 2] / l]; };
    const a = c(0), b = c(4), d = c(8), tr = a[0] + b[1] + d[2];
    let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(b[2] - d[1]) / s, (d[0] - a[2]) / s, (a[1] - b[0]) / s, s / 4]; }
    else if (a[0] > b[1] && a[0] > d[2]) { const s = Math.sqrt(1 + a[0] - b[1] - d[2]) * 2; q = [s / 4, (b[0] + a[1]) / s, (d[0] + a[2]) / s, (b[2] - d[1]) / s]; }
    else if (b[1] > d[2]) { const s = Math.sqrt(1 + b[1] - a[0] - d[2]) * 2; q = [(b[0] + a[1]) / s, s / 4, (d[1] + b[2]) / s, (d[0] - a[2]) / s]; }
    else { const s = Math.sqrt(1 + d[2] - a[0] - b[1]) * 2; q = [(d[0] + a[2]) / s, (d[1] + b[2]) / s, s / 4, (a[1] - b[0]) / s]; }
    return quat.norm(q);
  },
  toMat(q) {
    const [x, y, z, w] = q, m = m4.ident();
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + w * z); m[2] = 2 * (x * z - w * y);
    m[4] = 2 * (x * y - w * z); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + w * x);
    m[8] = 2 * (x * z + w * y); m[9] = 2 * (y * z - w * x); m[10] = 1 - 2 * (x * x + y * y);
    return m;
  },
};
const R = { hooks: {} };
const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };
const numList = (s) => { const t = String(s).replace(/,/g, ' ').trim(); return t ? t.split(/\s+/).map(num) : []; };
const chunk = (a, n) => { const o = []; for (let i = 0; i + n <= a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const fixed = (n, d) => (s) => { const a = numList(s); while (a.length < n) a.push(d[a.length] ?? 0); return a.slice(0, n); };
function mfString(s) { const out = []; const re = /"((?:[^"\\]|\\.)*)"/g; let m; while ((m = re.exec(s))) out.push(m[1].replace(/\\(.)/g, '$1')); return out.length || !s.trim() ? out : [s.trim()]; }
const PARSE = {
  SFBool: (s) => /^\s*true\s*$/i.test(s), SFString: (s) => s, SFInt32: (s) => parseInt(s, 10) || 0,
  SFFloat: num, SFTime: num, SFDouble: num,
  SFVec2f: fixed(2, [0, 0]), SFVec4f: fixed(4, [0, 0, 0, 0]), SFVec3f: fixed(3, [0, 0, 0]), SFColor: fixed(3, [0, 0, 0]), SFColorRGBA: fixed(4, [0, 0, 0, 1]), SFRotation: fixed(4, [0, 0, 1, 0]),
  MFFloat: numList, MFInt32: (s) => numList(s).map(Math.trunc), MFTime: numList,
  MFVec2f: (s) => chunk(numList(s), 2), MFVec3f: (s) => chunk(numList(s), 3), MFColor: (s) => chunk(numList(s), 3),
  MFColorRGBA: (s) => chunk(numList(s), 4), MFRotation: (s) => chunk(numList(s), 4), MFString: mfString,
};
const IO = 'io', IN = 'in', OUT = 'out', INIT = 'init';
const LIGHT = { on: ['SFBool', IO, true], color: ['SFColor', IO, [1, 1, 1]], intensity: ['SFFloat', IO, 1], ambientIntensity: ['SFFloat', IO, 0],
                global: ['SFBool', IO, false], shadows: ['SFBool', IO, false], shadowIntensity: ['SFFloat', IO, 1] };
const GROUP = { children: ['MFNode', IO, []], visible: ['SFBool', IO, true] };
const interp = (t) => ({ key: ['MFFloat', IO, []], keyValue: ['MF' + t, IO, []], set_fraction: ['SFFloat', IN, 0], value_changed: ['SF' + t, OUT, null] });
const solid = { solid: ['SFBool', INIT, true] };
const geomNodes = { coord: ['SFNode', IO, null], normal: ['SFNode', IO, null], color: ['SFNode', IO, null], texCoord: ['SFNode', IO, null], attrib: ['MFNode', IO, []],
                    ccw: ['SFBool', INIT, true], colorPerVertex: ['SFBool', INIT, true], normalPerVertex: ['SFBool', INIT, true], ...solid };
const emitter = { position: ['SFVec3f', IO, [0, 0, 0]], direction: ['SFVec3f', IO, [0, 1, 0]], speed: ['SFFloat', IO, 0], variation: ['SFFloat', IO, 0.25],
                  mass: ['SFFloat', IO, 0], surfaceArea: ['SFFloat', IO, 0], on: ['SFBool', IO, true] };
const DEFS = {
  GaussianSplats: { positions: ['MFVec3f', IO, []], scales: ['MFVec3f', IO, []], orientations: ['MFRotation', IO, []], opacities: ['MFFloat', IO, []],
                    sphericalHarmonicsDegree0Coef0: ['MFColor', IO, []], visible: ['SFBool', IO, true], bboxCenter: ['SFVec3f', INIT, [0, 0, 0]], bboxSize: ['SFVec3f', INIT, [-1, -1, -1]] },
  WorldInfo: { title: ['SFString', IO, ''], info: ['MFString', IO, []] },
  NavigationInfo: { type: ['MFString', IO, ['EXAMINE', 'ANY']], headlight: ['SFBool', IO, true], speed: ['SFFloat', IO, 1], set_bind: ['SFBool', IN, false],
                    transitionType: ['MFString', IO, ['LINEAR']], transitionTime: ['SFTime', IO, 1], visibilityLimit: ['SFFloat', IO, 0],
                    avatarSize: ['MFFloat', IO, [0.25, 1.6, 0.75]], isBound: ['SFBool', OUT, false], bindTime: ['SFTime', OUT, 0] },
  Viewpoint: { position: ['SFVec3f', IO, [0, 0, 10]], orientation: ['SFRotation', IO, [0, 0, 1, 0]], fieldOfView: ['SFFloat', IO, 0.7854],
               centerOfRotation: ['SFVec3f', IO, [0, 0, 0]], description: ['SFString', IO, ''], set_bind: ['SFBool', IN, false], jump: ['SFBool', IO, true],
               retainUserOffsets: ['SFBool', IO, false], nearDistance: ['SFFloat', IO, -1], farDistance: ['SFFloat', IO, -1],
               isBound: ['SFBool', OUT, false], bindTime: ['SFTime', OUT, 0] },
  Background: { skyColor: ['MFColor', IO, [[0, 0, 0]]], skyAngle: ['MFFloat', IO, []], groundColor: ['MFColor', IO, []], groundAngle: ['MFFloat', IO, []],
                transparency: ['SFFloat', IO, 0], set_bind: ['SFBool', IN, false] },
  Fog: { color: ['SFColor', IO, [1, 1, 1]], fogType: ['SFString', IO, 'LINEAR'], visibilityRange: ['SFFloat', IO, 0], set_bind: ['SFBool', IN, false] },
  DirectionalLight: { ...LIGHT, direction: ['SFVec3f', IO, [0, 0, -1]] },
  PointLight: { ...LIGHT, global: ['SFBool', IO, true], location: ['SFVec3f', IO, [0, 0, 0]], radius: ['SFFloat', IO, 100], attenuation: ['SFVec3f', IO, [1, 0, 0]] },
  SpotLight: { ...LIGHT, global: ['SFBool', IO, true], location: ['SFVec3f', IO, [0, 0, 0]], direction: ['SFVec3f', IO, [0, 0, -1]], radius: ['SFFloat', IO, 100],
               attenuation: ['SFVec3f', IO, [1, 0, 0]], beamWidth: ['SFFloat', IO, 0.589049], cutOffAngle: ['SFFloat', IO, 1.570796] },
  Transform: { ...GROUP, translation: ['SFVec3f', IO, [0, 0, 0]], rotation: ['SFRotation', IO, [0, 0, 1, 0]], scale: ['SFVec3f', IO, [1, 1, 1]],
               scaleOrientation: ['SFRotation', IO, [0, 0, 1, 0]], center: ['SFVec3f', IO, [0, 0, 0]] },
  Group: { ...GROUP },
  Switch: { ...GROUP, whichChoice: ['SFInt32', IO, -1] },
  Billboard: { ...GROUP, axisOfRotation: ['SFVec3f', IO, [0, 1, 0]] },
  Shape: { appearance: ['SFNode', IO, null], geometry: ['SFNode', IO, null], castShadow: ['SFBool', IO, true], visible: ['SFBool', IO, true] },
  Appearance: { material: ['SFNode', IO, null], shaders: ['MFNode', IO, []], blendMode: ['SFNode', IO, null], depthMode: ['SFNode', IO, null] },
  ComposedShader: { language: ['SFString', INIT, ''], parts: ['MFNode', IO, []], activate: ['SFBool', IN, false], isSelected: ['SFBool', OUT, false], isValid: ['SFBool', OUT, false] },
  ShaderPart: { url: ['MFString', IO, []], type: ['SFString', INIT, 'VERTEX'] },
  BlendMode: { blendColor: ['SFColorRGBA', IO, [0, 0, 0, 0]], sourceColorFactor: ['SFString', IO, 'SRC_ALPHA'], sourceAlphaFactor: ['SFString', IO, 'ONE'],
               destinationColorFactor: ['SFString', IO, 'ONE_MINUS_SRC_ALPHA'], destinationAlphaFactor: ['SFString', IO, 'ONE_MINUS_SRC_ALPHA'],
               colorEquation: ['SFString', IO, 'FUNC_ADD'], alphaEquation: ['SFString', IO, 'FUNC_ADD'] },
  DepthMode: { polygonOffset: ['SFVec2f', IO, [0, 0]], depthRange: ['SFVec2f', IO, [0, 1]], depthTest: ['SFBool', IO, true], depthFunction: ['SFString', IO, 'LESS_EQUAL'],
               depthMask: ['SFBool', IO, true] },
  Material: { diffuseColor: ['SFColor', IO, [0.8, 0.8, 0.8]], specularColor: ['SFColor', IO, [0, 0, 0]], emissiveColor: ['SFColor', IO, [0, 0, 0]],
              shininess: ['SFFloat', IO, 0.2], ambientIntensity: ['SFFloat', IO, 0.2], transparency: ['SFFloat', IO, 0] },
  PhysicalMaterial: { baseColor: ['SFColor', IO, [1, 1, 1]], metallic: ['SFFloat', IO, 1], roughness: ['SFFloat', IO, 1], emissiveColor: ['SFColor', IO, [0, 0, 0]],
                      occlusionStrength: ['SFFloat', IO, 1], transparency: ['SFFloat', IO, 0] },
  UnlitMaterial: { emissiveColor: ['SFColor', IO, [1, 1, 1]], transparency: ['SFFloat', IO, 0] },
  Box: { size: ['SFVec3f', INIT, [2, 2, 2]], ...solid },
  Sphere: { radius: ['SFFloat', INIT, 1], ...solid },
  Cylinder: { radius: ['SFFloat', INIT, 1], height: ['SFFloat', INIT, 2], top: ['SFBool', IO, true], bottom: ['SFBool', IO, true], side: ['SFBool', IO, true], ...solid },
  Cone: { bottomRadius: ['SFFloat', INIT, 1], height: ['SFFloat', INIT, 2], side: ['SFBool', IO, true], bottom: ['SFBool', IO, true], ...solid },
  Coordinate: { point: ['MFVec3f', IO, []] },
  Normal: { vector: ['MFVec3f', IO, []] },
  FloatVertexAttribute: { name: ['SFString', INIT, ''], numComponents: ['SFInt32', INIT, 4], value: ['MFFloat', IO, []] },
  IndexedTriangleSet: { ...geomNodes, index: ['MFInt32', INIT, []], set_index: ['MFInt32', IN, []] },
  TriangleStripSet: { ...geomNodes, stripCount: ['MFInt32', IO, []] },
  IndexedFaceSet: { ...geomNodes, coordIndex: ['MFInt32', INIT, []], normalIndex: ['MFInt32', INIT, []], colorIndex: ['MFInt32', INIT, []], texCoordIndex: ['MFInt32', INIT, []],
                    convex: ['SFBool', INIT, true], creaseAngle: ['SFFloat', INIT, 0], set_coordIndex: ['MFInt32', IN, []] },
  TimeSensor: { cycleInterval: ['SFTime', IO, 1], enabled: ['SFBool', IO, true], loop: ['SFBool', IO, false], startTime: ['SFTime', IO, 0], stopTime: ['SFTime', IO, 0],
                pauseTime: ['SFTime', IO, 0], resumeTime: ['SFTime', IO, 0], description: ['SFString', IO, ''],
                fraction_changed: ['SFFloat', OUT, 0], time: ['SFTime', OUT, 0], cycleTime: ['SFTime', OUT, 0], isActive: ['SFBool', OUT, false],
                elapsedTime: ['SFTime', OUT, 0], isPaused: ['SFBool', OUT, false] },
  TouchSensor: { enabled: ['SFBool', IO, true], description: ['SFString', IO, ''], touchTime: ['SFTime', OUT, 0], isActive: ['SFBool', OUT, false],
                 isOver: ['SFBool', OUT, false], hitPoint_changed: ['SFVec3f', OUT, [0, 0, 0]], hitNormal_changed: ['SFVec3f', OUT, [0, 0, 1]] },
  ScalarInterpolator: interp('Float'), PositionInterpolator: interp('Vec3f'), OrientationInterpolator: interp('Rotation'), ColorInterpolator: interp('Color'),
  ParticleSystem: { enabled: ['SFBool', IO, true], createParticles: ['SFBool', IO, true], geometryType: ['SFString', INIT, 'QUAD'], maxParticles: ['SFInt32', IO, 200],
                    particleLifetime: ['SFFloat', IO, 5], lifetimeVariation: ['SFFloat', IO, 0.25], particleSize: ['SFVec2f', IO, [0.02, 0.02]],
                    colorKey: ['MFFloat', INIT, []], color: ['SFNode', INIT, null], emitter: ['SFNode', INIT, null], physics: ['MFNode', INIT, []],
                    appearance: ['SFNode', IO, null], geometry: ['SFNode', IO, null], castShadow: ['SFBool', IO, true], visible: ['SFBool', IO, true],
                    isActive: ['SFBool', OUT, false] },
  PointEmitter: { ...emitter },
  ConeEmitter: { ...emitter, angle: ['SFFloat', IO, 0.7854] },
  ForcePhysicsModel: { force: ['SFVec3f', IO, [0, -9.8, 0]], enabled: ['SFBool', IO, true] },
  WindPhysicsModel: { direction: ['SFVec3f', IO, [1, 0, 0]], speed: ['SFFloat', IO, 0.1], gustiness: ['SFFloat', IO, 0.1], turbulence: ['SFFloat', IO, 0], enabled: ['SFBool', IO, true] },
  Color: { color: ['MFColor', IO, []] },
  ColorRGBA: { color: ['MFColorRGBA', IO, []] },
};
const CONTAINER = { Appearance: 'appearance', Material: 'material', PhysicalMaterial: 'material', UnlitMaterial: 'material',
  Box: 'geometry', Sphere: 'geometry', Cylinder: 'geometry', Cone: 'geometry', IndexedTriangleSet: 'geometry', TriangleStripSet: 'geometry', IndexedFaceSet: 'geometry',
  Color: 'color', ColorRGBA: 'color', Coordinate: 'coord', Normal: 'normal', FloatVertexAttribute: 'attrib',
  ComposedShader: 'shaders', ShaderPart: 'parts', BlendMode: 'blendMode', DepthMode: 'depthMode',
  PointEmitter: 'emitter', ConeEmitter: 'emitter', ForcePhysicsModel: 'physics', WindPhysicsModel: 'physics', BoundedPhysicsModel: 'physics' };
// big arrays stay flat typed arrays (a 9,000-track event has about 400,000 vertices)
const FLAT = { 'GaussianSplats.positions': Float32Array, 'GaussianSplats.scales': Float32Array, 'GaussianSplats.orientations': Float32Array, 'GaussianSplats.opacities': Float32Array, 'GaussianSplats.sphericalHarmonicsDegree0Coef0': Float32Array,
  'Coordinate.point': Float32Array, 'TextureCoordinate.point': Float32Array, 'Color.color': Float32Array, 'IndexedLineSet.coordIndex': Int32Array, 'Normal.vector': Float32Array, 'FloatVertexAttribute.value': Float32Array, 'IndexedTriangleSet.index': Int32Array,
  'IndexedFaceSet.coordIndex': Int32Array, 'IndexedFaceSet.normalIndex': Int32Array, 'TriangleStripSet.stripCount': Int32Array };
function flatNums(s, T) { const t = String(s).trim(); if (!t) return new T(0); const parts = t.split(/[\s,]+/), a = new T(parts.length); for (let i = 0; i < parts.length; i++) a[i] = +parts[i] || 0; return a; }
const ACCESS = { initializeOnly: INIT, inputOnly: IN, outputOnly: OUT, inputOutput: IO };
const fdefsOf = (n) => n.fdefs || DEFS[n.type];
const fieldType = (n, f) => (fdefsOf(n)[f] || ['SFString'])[0];
const INTERPOLATORS = new Set(['ScalarInterpolator', 'PositionInterpolator', 'OrientationInterpolator', 'ColorInterpolator']);
const SKIP_ATTR = new Set(['DEF', 'USE', 'containerField', 'class', 'id', 'style']);
const clone = (v) => (Array.isArray(v) ? v.map(clone) : v);

function parseX3D(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('The XML does not parse: ' + perr.textContent.replace(/\s+/g, ' ').trim().slice(0, 220));
  const root = doc.documentElement;
  if (root.nodeName !== 'X3D') throw new Error('The root element is <' + root.nodeName + '>, not <X3D>.');
  const sceneEl = [...root.children].find((e) => e.nodeName === 'Scene');
  if (!sceneEl) throw new Error('There is no <Scene> element.');
  const ctx = { defs: new Map(), nodes: [], routeEls: [], warnings: [], skipped: new Map() };
  const children = [];
  for (const el of sceneEl.children) { const r = parseNode(el, ctx); if (r) children.push(r.node); }
  const routes = [];
  for (const el of ctx.routeEls) {
    const fn = el.getAttribute('fromNode'), ff = el.getAttribute('fromField'), tn = el.getAttribute('toNode'), tf = el.getAttribute('toField');
    const label = `${fn}.${ff} → ${tn}.${tf}`;
    const a = ctx.defs.get(fn), b = ctx.defs.get(tn);
    if (!a || !b) { ctx.warnings.push(`ROUTE ${label}: no node named ${!a ? fn : tn}.`); continue; }
    const from = resolveField(a, ff, 'out'), to = resolveField(b, tf, 'in');
    if (!from || !to) { ctx.warnings.push(`ROUTE ${label}: ${!from ? a.type + ' has no output ' + ff : b.type + ' has no input ' + tf}.`); continue; }
    const ta = fieldType(a, from), tb = fieldType(b, to);
    if (ta !== tb) { ctx.warnings.push(`ROUTE ${label}: ${ta} cannot feed ${tb}.`); continue; }
    const r = { from: a, fromField: from, to: b, toField: to, label, discrete: /^(SFBool|SFTime|SFInt32|SFString)$/.test(ta) };
    (a.out ||= {})[from] ||= [];
    a.out[from].push(r);
    routes.push(r);
  }
  for (const [k, n] of ctx.skipped) ctx.warnings.push(`${n} × <${k}> is not supported by this small runtime and was skipped.`);
  return { children, nodes: ctx.nodes, defs: ctx.defs, routes, warnings: ctx.warnings };
}
function resolveField(node, name, dir) {
  const fields = fdefsOf(node);
  const f = fields[name];
  if (f && (f[1] === IO || f[1] === (dir === 'out' ? OUT : IN))) return name;
  if (dir === 'out' && name.endsWith('_changed')) { const b = name.slice(0, -8); if (fields[b] && fields[b][1] === IO) return b; }
  if (dir === 'in' && name.startsWith('set_')) { const b = name.slice(4); if (fields[b] && fields[b][1] === IO) return b; }
  return null;
}
function parseNode(el, ctx) {
  const tag = el.nodeName;
  if (tag === 'ROUTE') { ctx.routeEls.push(el); return null; }
  const use = el.getAttribute('USE');
  if (use) {
    const n = ctx.defs.get(use);
    if (!n) { ctx.warnings.push(`USE='${use}' comes before any DEF='${use}'.`); return null; }
    return { node: n, field: el.getAttribute('containerField') || CONTAINER[n.type] || 'children' };
  }
  const def = DEFS[tag];
  if (!def) { if (!/^(IS|connect|field|fieldValue|meta|head|component|unit)$/.test(tag)) ctx.skipped.set(tag, (ctx.skipped.get(tag) || 0) + 1); return null; }
  const node = { type: tag, def: el.getAttribute('DEF') || null, f: {}, id: ctx.nodes.length, out: null };
  for (const [name, [type, , dflt]] of Object.entries(def)) node.f[name] = type === 'MFNode' ? [] : clone(dflt);
  for (const a of el.attributes) {
    if (SKIP_ATTR.has(a.name) || a.name.includes(':')) continue;
    const fd = def[a.name];
    if (!fd || fd[1] === OUT || fd[1] === IN) { ctx.warnings.push(`<${tag}> has no field ${a.name}; ignored.`); continue; }
    const flat = FLAT[tag + '.' + a.name];
    node.f[a.name] = flat ? flatNums(a.value, flat) : PARSE[fd[0]] ? PARSE[fd[0]](a.value) : a.value;
  }
  if (tag === 'ComposedShader') { // author-defined fields (u_phase and friends) join this node's own field table
    node.fdefs = { ...def };
    for (const c of el.children) {
      if (c.nodeName !== 'field') continue;
      const name = c.getAttribute('name'), type = c.getAttribute('type'), acc = ACCESS[c.getAttribute('accessType')];
      if (!name || !type || !acc || /Node$/.test(type) || !PARSE[type]) { ctx.warnings.push(`ComposedShader ${node.def || ''}: field ${name || '?'} (${type}) is not supported here; ignored.`); continue; }
      node.fdefs[name] = [type, acc, null];
      const v = c.getAttribute('value');
      node.f[name] = v != null ? PARSE[type](v) : PARSE[type](type.startsWith('MF') ? '' : type === 'SFBool' ? 'false' : '0');
    }
  }
  if (tag === 'ShaderPart' && !node.f.url.length && el.textContent.trim()) node.f.url = [el.textContent];
  if (node.def) ctx.defs.set(node.def, node);
  ctx.nodes.push(node);
  for (const c of el.children) {
    const r = parseNode(c, ctx);
    if (!r) continue;
    let fld = r.field;
    if (tag === 'ParticleSystem' && fld === 'colorRamp') fld = 'color'; // the X3D 3 name for the same field
    if (tag === 'Switch' && fld === 'choice') fld = 'children';        // the X3D 3 name for Switch children
    const fd = def[fld];
    if (!fd || (fd[0] !== 'MFNode' && fd[0] !== 'SFNode')) { ctx.warnings.push(`<${c.nodeName}> cannot go in ${tag}.${fld}; ignored.`); continue; }
    if (fd[0] === 'MFNode') node.f[fld].push(r.node); else node.f[fld] = r.node;
  }
  return { node, field: el.getAttribute('containerField') || CONTAINER[tag] || 'children' };
}

/* ------------------------------------------------------------ the event model
   One timestamp per frame. Each output field fires at most once per timestamp and each
   ROUTE carries at most one event per timestamp, which also breaks loops (19775-1 4.4.8.3). */
const events = {
  queue: [], firedRoutes: new Set(), firedOut: new Set(), traced: new Set(), ts: 0, count: 0, onLog: null,
  begin(ts) { this.ts = ts; this.firedRoutes.clear(); this.firedOut.clear(); this.traced.clear(); this.count = 0; },
  emit(node, field, value) {
    const key = node.id + '.' + field;
    if (this.firedOut.has(key)) return;
    this.firedOut.add(key);
    const rs = node.out && node.out[field];
    if (!rs) return;
    for (const r of rs) { if (this.firedRoutes.has(r)) continue; this.firedRoutes.add(r); this.queue.push(r, value); }
  },
  drain() {
    let guard = 0;
    while (this.queue.length && guard++ < 100000) {
      const r = this.queue.shift(), v = this.queue.shift();
      this.count++;
      // the log follows a cascade that a discrete event (a touch, a start time) set off in this timestamp
      if ((r.discrete || this.traced.has(r.from.id)) && this.onLog) { this.traced.add(r.to.id); this.onLog(r.label, v, fieldType(r.from, r.fromField)); }
      receive(r.to, r.toField, v);
    }
  },
};
function receive(node, field, value) {
  if (field === 'set_bind') { if (node.type === 'Viewpoint' && R.hooks.bind) R.hooks.bind(node, !!value); return; } // other bindables keep the first one
  if (field === 'set_fraction' && INTERPOLATORS.has(node.type)) {
    const out = interpolate(node, value);
    if (out != null) { node.f.value_changed = out; events.emit(node, 'value_changed', out); }
    return;
  }
  if (node.type === 'TimeSensor' && node.state && node.state.active) {
    if (field === 'startTime' || field === 'cycleInterval') return;               // ignored while active
    if (field === 'stopTime' && value <= node.f.startTime) return;
  }
  node.f[field] = clone(value);
  node.version = (node.version || 0) + 1;
  if (R.hooks.changed) R.hooks.changed(node, field);
  events.emit(node, field, value);
}
function rgb2hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsv2rgb([h, s, v]) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
function hsvLerp(a, b, s) { // ColorInterpolator interpolates in HSV space (19775-1 19.4.2)
  const A = rgb2hsv(a), B = rgb2hsv(b);
  if (A[1] === 0) A[0] = B[0];
  if (B[1] === 0) B[0] = A[0];
  let dh = B[0] - A[0]; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
  let h = A[0] + dh * s; h -= Math.floor(h);
  return hsv2rgb([h, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s]);
}
function interpolate(n, frac) {
  const k = n.f.key, kv = n.f.keyValue, N = Math.min(k.length, kv.length);
  if (!N) return null;
  let i = 0, j = 0, s = 0;
  if (frac <= k[0]) i = j = 0;
  else if (frac >= k[N - 1]) i = j = N - 1;
  else { while (i < N - 1 && frac >= k[i + 1]) i++; j = Math.min(i + 1, N - 1); const span = k[j] - k[i]; s = span > 0 ? (frac - k[i]) / span : 0; }
  const a = kv[i], b = kv[j];
  switch (n.type) {
    case 'ScalarInterpolator': return a + (b - a) * s;
    case 'PositionInterpolator': return [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * s);
    case 'ColorInterpolator': return hsvLerp(a, b, s);
    case 'OrientationInterpolator': return quat.toAxisAngle(quat.slerp(quat.fromAxisAngle(a, a[3]), quat.fromAxisAngle(b, b[3]), s));
  }
  return null;
}
function tickTimeSensor(n, now) {
  const f = n.f, st = n.state || (n.state = { active: false, cycle: -1 });
  const ci = f.cycleInterval > 0 ? f.cycleInterval : 1;
  const stopValid = f.stopTime > f.startTime;
  if (!f.enabled) { if (st.active) { st.active = false; f.isActive = false; events.emit(n, 'isActive', false); } return; }
  if (!st.active) {
    if (now >= f.startTime && !(stopValid && now >= f.stopTime) && (f.loop || now < f.startTime + ci)) {
      st.active = true; f.isActive = true; events.emit(n, 'isActive', true);
      st.cycle = Math.floor((now - f.startTime) / ci);
      f.cycleTime = now; events.emit(n, 'cycleTime', now);
    } else return;
  }
  const elapsed = now - f.startTime;
  let frac, ending = false;
  if (stopValid && now >= f.stopTime) { ending = true; const e = f.stopTime - f.startTime, k = e / ci; frac = k - Math.floor(k); if (frac === 0 && e > 0) frac = 1; }
  else if (!f.loop && elapsed >= ci) { ending = true; frac = 1; }
  else {
    const k = elapsed / ci; frac = k - Math.floor(k); if (frac === 0 && elapsed > 0) frac = 1;
    const c = Math.floor(k); if (c !== st.cycle) { st.cycle = c; f.cycleTime = now; events.emit(n, 'cycleTime', now); }
  }
  f.fraction_changed = frac; events.emit(n, 'fraction_changed', frac);
  f.time = now; events.emit(n, 'time', now);
  f.elapsedTime = elapsed; events.emit(n, 'elapsedTime', elapsed);
  if (ending) { st.active = false; f.isActive = false; events.emit(n, 'isActive', false); }
}

/* --------------------------------------------------------------- geometry */

/* ---- nodes added for the brain and torso scenes ---- */
const TEXNODE = { url: ['MFString', IO, []], repeatS: ['SFBool', INIT, true], repeatT: ['SFBool', INIT, true] };
Object.assign(DEFS, {
  ImageTexture: { ...TEXNODE },
  TextureCoordinate: { point: ['MFVec2f', IO, []] },
  IndexedLineSet: { coord: ['SFNode', IO, null], color: ['SFNode', IO, null], coordIndex: ['MFInt32', INIT, []], colorPerVertex: ['SFBool', INIT, true] },
  LineProperties: { applied: ['SFBool', IO, true], linetype: ['SFInt32', IO, 1], linewidthScaleFactor: ['SFFloat', IO, 0] },
  ClipPlane: { enabled: ['SFBool', IO, true], plane: ['SFVec4f', IO, [0, 1, 0, 0]] },
  ComposedCubeMapTexture: { frontTexture: ['SFNode', IO, null], backTexture: ['SFNode', IO, null], leftTexture: ['SFNode', IO, null], rightTexture: ['SFNode', IO, null],
                            topTexture: ['SFNode', IO, null], bottomTexture: ['SFNode', IO, null] },
  EnvironmentLight: { intensity: ['SFFloat', IO, 1], color: ['SFColor', IO, [1, 1, 1]], on: ['SFBool', IO, true], diffuseTexture: ['SFNode', IO, null],
                      specularTexture: ['SFNode', IO, null], diffuseCoefficients: ['MFFloat', IO, []], rotation: ['SFRotation', IO, [0, 0, 1, 0]], global: ['SFBool', IO, false] },
  Text: { string: ['MFString', IO, []], fontStyle: ['SFNode', IO, null], maxExtent: ['SFFloat', IO, 0], length: ['MFFloat', IO, []], solid: ['SFBool', INIT, false] },
  FontStyle: { family: ['MFString', IO, ['SERIF']], size: ['SFFloat', IO, 1], spacing: ['SFFloat', IO, 1], style: ['SFString', IO, 'PLAIN'], justify: ['MFString', IO, ['BEGIN']],
               horizontal: ['SFBool', INIT, true] },
  Sound: { intensity: ['SFFloat', IO, 1], source: ['SFNode', IO, null], location: ['SFVec3f', IO, [0, 0, 0]], spatialize: ['SFBool', INIT, true], priority: ['SFFloat', IO, 0],
           minFront: ['SFFloat', IO, 1], minBack: ['SFFloat', IO, 1], maxFront: ['SFFloat', IO, 10], maxBack: ['SFFloat', IO, 10], direction: ['SFVec3f', IO, [0, 0, 1]] },
  AudioClip: { url: ['MFString', IO, []], loop: ['SFBool', IO, false], startTime: ['SFTime', IO, 0], stopTime: ['SFTime', IO, 0], pitch: ['SFFloat', IO, 1],
               description: ['SFString', IO, ''], isActive: ['SFBool', OUT, false] },
  MetadataString: { name: ['SFString', IO, ''], value: ['MFString', IO, []] },
});
Object.assign(DEFS.PhysicalMaterial, { baseTexture: ['SFNode', IO, null], emissiveTexture: ['SFNode', IO, null], normalTexture: ['SFNode', IO, null],
  metallicRoughnessTexture: ['SFNode', IO, null], occlusionTexture: ['SFNode', IO, null] });
Object.assign(DEFS.Appearance, { texture: ['SFNode', IO, null], lineProperties: ['SFNode', IO, null], textureTransform: ['SFNode', IO, null] });
Object.assign(DEFS.IndexedTriangleSet, { texCoord: ['SFNode', IO, null] });
Object.assign(DEFS.IndexedFaceSet, { texCoord: ['SFNode', IO, null] });
Object.assign(CONTAINER, { ImageTexture: 'texture', TextureCoordinate: 'texCoord', IndexedLineSet: 'geometry', Text: 'geometry', LineProperties: 'lineProperties', FontStyle: 'fontStyle',
  AudioClip: 'source', ComposedCubeMapTexture: 'specularTexture', MetadataString: 'metadata' });
for (const t of ['Appearance','Shape','Group','Switch','Transform','Billboard','Viewpoint','NavigationInfo','Material','PhysicalMaterial']) DEFS[t].metadata = ['SFNode', IO, null];
Object.assign(DEFS.Shape, {});
const R_NOTE = new Set(['MetadataString']);

R.DEFS = DEFS; R.parseX3D = parseX3D; R.events = events; R.receive = receive; R.tickTimeSensor = tickTimeSensor; R.fieldType = fieldType; R.fdefsOf = fdefsOf; R.clone = clone;
R.v3 = v3; R.quat = quat; R.clamp = clamp; R.INTERPOLATORS = INTERPOLATORS; R.mfString = mfString; R.PARSE = PARSE; R.CONTAINER = CONTAINER;
R.resolveField = resolveField; R.FLAT = FLAT;

/* Additive reader nodes for the Manifold scene. Concatenated after reader.js inside the same bundle scope, so DEFS, PARSE, FLAT, CONTAINER, geomNodes, INIT and IO are visible.
   Nothing here changes how the brain scenes parse: only new entries are added. */

PARSE.MFVec4f = (s) => Float32Array.from(numList(s));        // uSources, uShape, uPulse, uAnchors: flat, four floats a vector
FLAT['ElevationGrid.height'] = Float32Array;                  // 513 x 513 = 263,169 numbers stay a typed array

Object.assign(DEFS, {
  ElevationGrid: { ...geomNodes, height: ['MFFloat', INIT, []], xDimension: ['SFInt32', INIT, 0], zDimension: ['SFInt32', INIT, 0],
                   xSpacing: ['SFFloat', INIT, 1], zSpacing: ['SFFloat', INIT, 1], creaseAngle: ['SFFloat', INIT, 0] },
  TriangleSet: { ...geomNodes },                              // every three coordinates are a triangle
  PointSet: { coord: ['SFNode', IO, null], color: ['SFNode', IO, null], attrib: ['MFNode', IO, []] },
});
Object.assign(CONTAINER, { ElevationGrid: 'geometry', TriangleSet: 'geometry', PointSet: 'geometry' });
// vertex data the page rewrites every few hundred ms: the SAI hands out a view that does not copy
R.saiLazy = new Set(['FloatVertexAttribute.value', 'IndexedTriangleSet.index', 'Coordinate.point', 'Color.color']);

// X3D addFieldCallback on a reader-raised output event (the page listens to Clock.elapsedTime): emit() only queued ROUTEs, so it now also runs the node's callbacks, once per timestamp.
{
  const emit0 = events.emit;
  events.emit = function (node, field, value) {
    if (node.cbs && node.cbs[field] && !this.firedOut.has(node.id + '.' + field) && R.hooks.cb) R.hooks.cb(node, field, value);
    return emit0.call(this, node, field, value);
  };
}

/* WGSL ports of the six distinct GLSL parts in the brain and torso scenes (4 ComposedShaders in the brain hero, 16 in the torso).
   A port is chosen by the FNV-1a hash of the whitespace-collapsed GLSL, as in the Collider page, so edited GLSL falls back to the plain material.
   Babylon's WGSL ShaderMaterial wants `attribute`, `uniform name: type;` and `varying` declarations and the VertexInputs / FragmentInputs entry points.
   Each port is a term-for-term translation of the GLSL (same constants, same order of operations); the GLSL itself stays in the X3D file. */

const VERT_BRAIN = `
attribute position: vec3f;
attribute normal: vec3f;
attribute color: vec4f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vN: vec3f;
varying vP: vec3f;
varying vAO: f32;
varying vRel: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let p = uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vP = p.xyz;
  vertexOutputs.vN = (uniforms.worldView * vec4f(vertexInputs.normal, 0.0)).xyz;
  vertexOutputs.vAO = clamp((vertexInputs.color.g - 0.17) / 0.83, 0.0, 1.0);
  vertexOutputs.vRel = p.z - (uniforms.worldView * vec4f(0.0, 0.0, 0.0, 1.0)).z;
  vertexOutputs.position = uniforms.projection * p;
}`;

const FRAG_CORTEX = `
uniform rimColor: vec3f; uniform rimColor2: vec3f; uniform bodyColor: vec3f;
uniform rimPower: f32; uniform baseAlpha: f32; uniform rimAlpha: f32; uniform aoGamma: f32; uniform specular: f32; uniform backDim: f32; uniform sulcAlpha: f32;
uniform sulcColor: vec3f; uniform sulcLo: f32; uniform sulcHi: f32;
uniform edgeColor: vec3f; uniform edgeAlpha: f32; uniform edgeLo: f32; uniform edgeW: f32; uniform farDim: f32; uniform farR: f32;
uniform passMode: f32;
varying vN: vec3f; varying vP: vec3f; varying vAO: f32; varying vRel: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let N = normalize(fragmentInputs.vN);
  let V = normalize(-fragmentInputs.vP);
  let d = dot(N, V);
  let fr = step(0.0, d);
  let ndv = abs(d);
  let Nf = select(N, -N, d < 0.0);
  let ao = pow(clamp(fragmentInputs.vAO, 0.0, 1.0), uniforms.aoGamma);
  let cr = smoothstep(uniforms.sulcLo, uniforms.sulcHi, ao);
  let f = pow(1.0 - ndv, uniforms.rimPower);
  let hue = smoothstep(-0.15, 0.95, N.x * 0.85 - N.y * 0.55 + 0.25 * sin(fragmentInputs.vP.y * 0.045 + fragmentInputs.vP.x * 0.03));
  var rimc = mix(uniforms.rimColor, uniforms.rimColor2, hue);
  let film = 0.5 + 0.5 * cos(6.2831853 * (ndv * 1.7 + 0.35 * ao));
  rimc = mix(rimc, rimc.zxy * vec3f(0.9, 1.0, 1.0) + vec3f(0.1), 0.28 * film * f);
  let L1 = normalize(vec3f(-0.5, 0.7, 0.55));
  let H1 = normalize(L1 + V);
  let L2 = normalize(vec3f(0.85, -0.15, 0.45));
  let H2 = normalize(L2 + V);
  let s1 = pow(max(dot(Nf, H1), 0.0), 90.0) * (0.2 + 0.8 * cr);
  let s2 = pow(max(dot(Nf, H2), 0.0), 30.0) * 0.30 * cr;
  let dif = 0.6 + 0.4 * dot(Nf, L1);
  let body = mix(uniforms.sulcColor, uniforms.bodyColor * dif, cr);
  let aBody = mix(uniforms.sulcAlpha, uniforms.baseAlpha, cr);
  let aRim = uniforms.rimAlpha * f * (0.35 + 0.65 * cr);
  let k = mix(uniforms.backDim, 1.0, fr);
  let spec = (vec3f(1.0, 0.97, 0.92) * s1 + vec3f(0.45, 0.75, 1.0) * s2) * uniforms.specular * fr;
  var aSp = clamp((s1 + s2) * uniforms.specular, 0.0, 1.0) * fr;
  var aTot = clamp((aBody + aRim) * k, 0.0, 1.0);
  var col = (body * aBody + rimc * aRim) / max(aBody + aRim, 0.001);
  let ridge = smoothstep(uniforms.edgeLo, uniforms.edgeLo + uniforms.edgeW, ao) * (1.0 - smoothstep(uniforms.edgeLo + uniforms.edgeW, uniforms.edgeLo + 2.2 * uniforms.edgeW, ao));
  let aEdge = clamp(uniforms.edgeAlpha * ridge * (0.5 + 0.5 * pow(max(dot(Nf, H1), 0.0), 2.0)), 0.0, 1.0) * mix(0.35, 1.0, fr);
  col = mix(col, uniforms.edgeColor, aEdge / max(aTot + aEdge, 0.001));
  aTot = aTot + aEdge * (1.0 - aTot);
  let depthK = mix(uniforms.farDim, 1.0, smoothstep(-uniforms.farR, 0.35 * uniforms.farR, fragmentInputs.vRel));
  aTot = aTot * depthK;
  aSp = aSp * depthK;
  let a = clamp(aTot + aSp * (1.0 - aTot), 0.0, 1.0);
  col = mix(col, spec / max(aSp, 0.001) + col * 0.0, clamp(aSp / max(a, 0.001), 0.0, 1.0));
  fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), a);
}`;

const FRAG_AURA = `
uniform auraColor: vec3f; uniform auraColor2: vec3f; uniform auraPower: f32; uniform auraAlpha: f32;
uniform passMode: f32;
varying vN: vec3f; varying vP: vec3f; varying vAO: f32; varying vRel: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let N = normalize(fragmentInputs.vN);
  let V = normalize(-fragmentInputs.vP);
  let d = dot(N, V);
  let f = pow(1.0 - clamp(d, 0.0, 1.0), uniforms.auraPower) * step(0.0, d);
  let hue = smoothstep(-0.55, 0.65, N.x * 0.85 - N.y * 0.55);
  fragmentOutputs.color = vec4f(mix(uniforms.auraColor, uniforms.auraColor2, hue),
    clamp(f * uniforms.auraAlpha * (0.4 + 0.6 * smoothstep(0.0, 0.8, fragmentInputs.vAO)) * mix(0.35, 1.0, smoothstep(-70.0, 25.0, fragmentInputs.vRel)), 0.0, 1.0));
}`;

const VERT_TORSO = `
attribute position: vec3f;
attribute normal: vec3f;
attribute color: vec4f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform useColor: f32;
varying vN: vec3f;
varying vP: vec3f;
varying vO: vec3f;
varying vC: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let p = uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vP = p.xyz;
  vertexOutputs.vO = vertexInputs.position;
  vertexOutputs.vN = normalize((uniforms.worldView * vec4f(vertexInputs.normal, 0.0)).xyz);
  vertexOutputs.vC = select(vec2f(1.0), vertexInputs.color.rg, uniforms.useColor > 0.5);
  vertexOutputs.position = uniforms.projection * p;
}`;

const FRAG_TORSO_GLASS = `
uniform rimColor: vec3f; uniform bodyColor: vec3f; uniform rimPower: f32; uniform baseAlpha: f32; uniform rimAlpha: f32;
uniform smoke: f32; uniform time: f32;
varying vN: vec3f; varying vP: vec3f; varying vO: vec3f; varying vC: vec2f;
fn hash(p0: vec3f) -> f32 {
  var p = fract(p0 * 0.3183099 + vec3f(0.1));
  p = p * 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x);
  var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3f(0.0, 1.0, 0.0)), hash(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3f(0.0, 0.0, 1.0)), hash(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3f(0.0, 1.0, 1.0)), hash(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let N = normalize(fragmentInputs.vN);
  let V = normalize(-fragmentInputs.vP);
  let ndv = abs(dot(N, V));
  let f = pow(1.0 - ndv, uniforms.rimPower);
  let ao = fragmentInputs.vC.x;
  let fade = fragmentInputs.vC.y;
  var col = mix(uniforms.bodyColor * ao, uniforms.rimColor, f);
  var a = mix(uniforms.baseAlpha, uniforms.rimAlpha, f) * mix(1.4, 0.8, ao);
  if (uniforms.smoke > 0.0) {
    let q = fragmentInputs.vO * 0.016 + vec3f(0.0, uniforms.time * 0.035, uniforms.time * 0.02);
    let n = 0.55 * vnoise(q) + 0.30 * vnoise(q * 2.3 + vec3f(7.1)) + 0.15 * vnoise(q * 5.1 + vec3f(3.3));
    let s = smoothstep(0.30, 0.70, n);
    a = a * mix(1.0, 0.2 + 1.25 * s, uniforms.smoke);
    col = mix(col, col * (0.6 + 0.8 * s), uniforms.smoke);
  }
  fragmentOutputs.color = vec4f(col, clamp(a * fade, 0.0, 1.0));
}`;

const FRAG_TORSO_HALO = `
uniform rimColor: vec3f; uniform rimPower: f32; uniform intensity: f32;
varying vN: vec3f; varying vP: vec3f; varying vO: vec3f; varying vC: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let N = normalize(fragmentInputs.vN);
  let V = normalize(-fragmentInputs.vP);
  let f = pow(1.0 - abs(dot(N, V)), uniforms.rimPower);
  let a = clamp(f * uniforms.intensity * fragmentInputs.vC.y, 0.0, 1.0);
  fragmentOutputs.color = vec4f(uniforms.rimColor, a);
}`;

/* wide lines (LineProperties.linewidthScaleFactor): one quad per segment, expanded in the vertex shader to a pixel width.
   Attributes per corner: position (this end), other (the far end), side (-1 or +1, and 0 / 1 for which end in uv.x). */
const VERT_RIBBON = `
attribute position: vec3f;
attribute other: vec3f;
attribute color: vec4f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
uniform viewport: vec2f;
uniform widthPx: f32;
uniform tint: vec3f;
varying vC: vec4f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let a = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
  let b = uniforms.worldViewProjection * vec4f(vertexInputs.other, 1.0);
  let sa = a.xy / a.w * uniforms.viewport * 0.5;
  let sb = b.xy / max(b.w, 1e-5) * uniforms.viewport * 0.5;
  var dir = sb - sa;
  let l = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / l, l > 1e-6);
  let nrm = vec2f(-dir.y, dir.x);
  let off = nrm * vertexInputs.uv.y * uniforms.widthPx * 0.5 * 2.0 / uniforms.viewport;
  vertexOutputs.position = vec4f(a.xy + off * a.w, a.z, a.w);
  vertexOutputs.vC = vec4f(vertexInputs.color.rgb * uniforms.tint, vertexInputs.color.a);
}`;
const FRAG_RIBBON = `
uniform alpha: f32;
varying vC: vec4f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = vec4f(fragmentInputs.vC.rgb, uniforms.alpha);
}`;

/* textured Shapes with no Material are unlit in X3D: colour = texel, alpha = texel alpha (straight, source-over). Texel values are written as stored, as X_ITE does. */
const VERT_UNLIT = `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vUV = vertexInputs.uv;
}`;
const FRAG_UNLIT = `
var tex0Sampler: sampler;
var tex0: texture_2d<f32>;
uniform opacity: f32;
varying vUV: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSample(tex0, tex0Sampler, fragmentInputs.vUV);
  fragmentOutputs.color = vec4f(c.rgb, c.a * uniforms.opacity);
}`;

const normSrc = (s) => s.replace(/\s+/g, ' ').trim();
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

/* key = fnv1a(vertex) + '-' + fnv1a(fragment) over the GLSL as the scene carries it; filled in by tools (build-brain.py prints and checks them) */
const WGSL_PORTS = {
  cortex: { vs: VERT_BRAIN, fs: FRAG_CORTEX, attrs: ['position', 'normal', 'color'], uniforms: ['rimColor', 'rimColor2', 'bodyColor', 'rimPower', 'baseAlpha', 'rimAlpha', 'aoGamma', 'specular', 'backDim', 'sulcAlpha', 'sulcColor', 'sulcLo', 'sulcHi', 'edgeColor', 'edgeAlpha', 'edgeLo', 'edgeW', 'farDim', 'farR', 'passMode'] },
  aura: { vs: VERT_BRAIN, fs: FRAG_AURA, attrs: ['position', 'normal', 'color'], uniforms: ['auraColor', 'auraColor2', 'auraPower', 'auraAlpha', 'passMode'] },
  torsoGlass: { vs: VERT_TORSO, fs: FRAG_TORSO_GLASS, attrs: ['position', 'normal', 'color'], uniforms: ['useColor', 'rimColor', 'bodyColor', 'rimPower', 'baseAlpha', 'rimAlpha', 'smoke', 'time'] },
  torsoHalo: { vs: VERT_TORSO, fs: FRAG_TORSO_HALO, attrs: ['position', 'normal', 'color'], uniforms: ['useColor', 'rimColor', 'rimPower', 'intensity'] },
};
/* vertex-hash + '-' + fragment-hash of the whitespace-collapsed GLSL (computed from the lite scenes; build-brain.py re-checks them against the page's own scene files) */
const WGSL_BY_HASH = {
  'c89ae27e-c9456c60': 'cortex', 'c89ae27e-0afe3b95': 'aura',
  '4e142744-2250c51b': 'torsoGlass', '4e142744-f37b0ce5': 'torsoHalo',
};

function shaderSource(part) {
  for (const u of part.f.url) {
    if (/^\s*data:/i.test(u)) {
      const c = u.indexOf(','), head = u.slice(0, c);
      let body = u.slice(c + 1);
      if (/;base64/i.test(head)) { try { body = atob(body); } catch { body = ''; } }
      else if (/%[0-9a-f]{2}/i.test(body)) { try { body = decodeURIComponent(body); } catch { /* keep the raw text */ } }
      return body;
    }
    if (/void\s+main/.test(u)) return u;
  }
  return '';
}

/* WGSL ports of the Manifold of Emotion shaders. Source of truth stays the GLSL inside scenes/manifold.x3d (x3d.STEM studies/manifold, shaders/*.glsl).
   Each port is chosen by the FNV-1a hash of the whitespace-collapsed GLSL (wgsl.js), so edited GLSL falls back and says so on screen (law 40).
   Babylon WGSL ShaderMaterial conventions are those of brain/wgsl.js: `attribute`, `uniform name: type;`, `varying`, VertexInputs / FragmentInputs, vertexOutputs.position.
   Term-for-term translation: same constants, same order of operations. Differences, all forced by WGSL:
     uniform vec4 u[N]    -> N separate vec4f uniforms (u0..uN-1) copied into a var<private> array at the top of each entry point (loadArrays)
     pow(x, y)            -> x guarded with max(x, 0.0) where rounding can push it just below zero (GLSL leaves that undefined, WGSL gives NaN)
     gl_FrontFacing       -> fragmentInputs.frontFacing
     gl_PointSize         -> the point is a 4-vertex quad (attribute `corner` = -1/1); the vertex shader moves each corner by size/2 pixels
     fwidth               -> fwidth (same in WGSL)
   The scene's shaders output display-referred colour (ACES of 1.32 x radiance, then gamma 2.2): Babylon must not tone map or gamma-convert on top. */

const MF_UNIFORMS = `
const PI: f32 = 3.141592653589793;
uniform uTime: f32; uniform uEnergy: f32; uniform uBreath: f32; uniform uFold: f32; uniform uGlow: f32; uniform uMetal: f32;
uniform uContours: f32; uniform uMicro: f32; uniform uCurrents: f32;
uniform uSources0: vec4f; uniform uSources1: vec4f; uniform uSources2: vec4f; uniform uSources3: vec4f; uniform uSources4: vec4f; uniform uSources5: vec4f; uniform uSources6: vec4f;
uniform uShape0: vec4f; uniform uShape1: vec4f; uniform uShape2: vec4f; uniform uShape3: vec4f; uniform uShape4: vec4f; uniform uShape5: vec4f; uniform uShape6: vec4f;
uniform uPulse0: vec4f; uniform uPulse1: vec4f; uniform uPulse2: vec4f; uniform uPulse3: vec4f; uniform uPulse4: vec4f; uniform uPulse5: vec4f; uniform uPulse6: vec4f; uniform uPulse7: vec4f;
uniform uA: vec3f; uniform uB: vec3f; uniform uC: vec3f;
`;

/* shaders/common.glsl, term for term */
const MF_COMMON = `
var<private> gSrc: array<vec4f, 7>;
var<private> gShp: array<vec4f, 7>;
var<private> gPul: array<vec4f, 8>;
fn loadArrays() {
  gSrc = array<vec4f, 7>(uniforms.uSources0, uniforms.uSources1, uniforms.uSources2, uniforms.uSources3, uniforms.uSources4, uniforms.uSources5, uniforms.uSources6);
  gShp = array<vec4f, 7>(uniforms.uShape0, uniforms.uShape1, uniforms.uShape2, uniforms.uShape3, uniforms.uShape4, uniforms.uShape5, uniforms.uShape6);
  gPul = array<vec4f, 8>(uniforms.uPulse0, uniforms.uPulse1, uniforms.uPulse2, uniforms.uPulse3, uniforms.uPulse4, uniforms.uPulse5, uniforms.uPulse6, uniforms.uPulse7);
}
// (lambda, d lambda/dx, d lambda/dz, Laplacian of lambda), lambda = 1 + seven anisotropic Gaussians
fn metric(p: vec2f) -> vec4f {
  var r = vec4f(1.0, 0.0, 0.0, 0.0);
  for (var i = 0; i < 7; i++) {
    let S = gSrc[i]; let H = gShp[i];
    let d = p - S.xy;
    let q = vec2f(H.x * d.x + H.y * d.y, -H.y * d.x + H.x * d.y);
    let a = 1.0 / (S.w * S.w * vec2f(1.0, H.z * H.z));
    let v = S.z * exp(-0.5 * dot(q * q, a));
    let l = -q * a;
    let grad = vec2f(H.x * l.x - H.y * l.y, H.y * l.x + H.x * l.y);
    r += vec4f(v, v * grad, v * (dot(l, l) - a.x - a.y));
  }
  return r;
}
// a rotating R4 coordinate, projected into the display height only (it does not enter the metric)
fn foldSurface(p: vec2f) -> vec3f {
  let a = uniforms.uTime * 0.12; let c = cos(a); let s = sin(a); let c2 = cos(a * 0.73); let s2 = sin(a * 0.73);
  let ax = p.x * 0.19 + uniforms.uTime * 0.13; let bz = p.y * 0.21 - uniforms.uTime * 0.11;
  let q = vec4f(p * 0.25, sin(ax), cos(bz));
  let Q = vec4f(c * q.x - s * q.w, c2 * q.y - s2 * q.z, s2 * q.y + c2 * q.z, s * q.x + c * q.w);
  let dx = vec4f(c * 0.25, -s2 * 0.19 * cos(ax), c2 * 0.19 * cos(ax), s * 0.25);
  let dz = vec4f(s * 0.21 * sin(bz), c2 * 0.25, s2 * 0.25, -c * 0.21 * sin(bz));
  let d = 1.8 - 0.23 * Q.w; let v = Q.xyz / d;
  let vx = (dx.xyz * d + 0.23 * Q.xyz * dx.w) / (d * d);
  let vz = (dz.xyz * d + 0.23 * Q.xyz * dz.w) / (d * d);
  let A = v.x * 2.6 + v.z; let B = v.y * 2.2; let C = v.z * 3.7 + v.y;
  let gradient = vec3f(0.65 * cos(A) * cos(B) * 2.6, -0.65 * sin(A) * sin(B) * 2.2 + 0.24 * cos(C), 0.65 * cos(A) * cos(B) + 0.24 * cos(C) * 3.7);
  return uniforms.uFold * vec3f(0.65 * sin(A) * cos(B) + 0.24 * sin(C), dot(gradient, vx), dot(gradient, vz));
}
// height and its gradient: -1.72 ln(lambda) + fold + ripples
fn surfaceAt(p: vec2f, m: vec4f) -> vec3f {
  var h = -1.72 * log(m.x);
  var g = -1.72 * m.yz / m.x;
  let folded = foldSurface(p);
  h += folded.x; g += folded.yz;
  for (var i = 0; i < 8; i++) {
    let P = gPul[i];
    if (P.w < 0.001) { continue; }
    let age = uniforms.uTime - P.z;
    if (age > 18.0 || age < 0.0) { continue; }
    let len = length(p - P.xy);
    let r = len - age * 2.15;
    let envelope = exp(-r * r * 0.75 - age * 0.53) * P.w * step(0.0, age);
    let wave = sin(r * 4.2) * envelope;
    h += wave;
    let slope = (4.2 * cos(r * 4.2) - 1.5 * r * sin(r * 4.2)) * envelope;
    g += slope * (p - P.xy) / max(0.01, len);
  }
  return vec3f(h, g);
}
fn heightAt(p: vec2f) -> f32 { return surfaceAt(p, metric(p)).x; }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
// the original's display transform, applied per fragment: ACES (Narkowicz) of 1.32 x radiance, then gamma 2.2
fn display(c0: vec3f) -> vec3f {
  var c = max(c0 * 1.32, vec3f(0.0));
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(c, vec3f(1.0 / 2.2));
}
fn overlay(F0: vec3f) -> vec3f {
  let F = max(F0, vec3f(0.0));
  return clamp(6.1615 * F / pow(vec3f(1.0) + 4.9597 * F, vec3f(1.0704)), vec3f(0.0), vec3f(1.0));
}
// light layers as RGBA for standard alpha blending: (g / max g, max g), pulled toward white by 0.3
fn lightOut(F: vec3f) -> vec4f {
  let g = overlay(F);
  let a = max(max(g.r, g.g), g.b);
  if (a > 1e-5) { return vec4f(mix(g / a, vec3f(1.0), 0.3), a); }
  return vec4f(0.0);
}
`;
const MF_PRELUDE = MF_UNIFORMS + MF_COMMON;

/* ----------------------------------------------------------------------------------------------- sky (shaders/background.glsl) */
const MF_SKY_VS = `
attribute position: vec3f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.position.xy * 0.5 + 0.5;
  vertexOutputs.position = vec4f(vertexInputs.position.xy, 0.999999, 1.0);
}`;
const MF_SKY_FS = `
uniform uResolution: vec2f;
varying vUV: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  loadArrays();
  let vUV = fragmentInputs.vUV;
  var p = vUV - 0.5; p.x *= uniforms.uResolution.x / uniforms.uResolution.y;
  let t = uniforms.uTime;
  let haze = exp(-dot(p * vec2f(0.9, 1.5), p * vec2f(0.9, 1.5)) * 2.8);
  var color = vec3f(0.008, 0.013, 0.025) + mix(uniforms.uA, uniforms.uB, vUV.x) * haze * 0.028;
  let cloud = sin(p.x * 2.0 + p.y * 4.0 + t * 0.018) * sin(p.x * 3.0 - p.y * 2.1);
  let cy = p.y + 0.1 + cloud * 0.04;
  color += uniforms.uB * exp(-cy * cy * 45.0) * 0.014;
  let curtain = sin(p.x * 4.1 + t * 0.025) + 0.3 * sin(p.x * 10.7 - t * 0.02);
  let ay = p.y - 0.11 - curtain * 0.045;
  let aurora = exp(-ay * ay * 95.0) * exp(-p.x * p.x * 0.6);
  color += mix(uniforms.uA, uniforms.uB, 0.5 + 0.5 * sin(p.x * 2.0 + t * 0.04)) * aurora * 0.023;
  let gp = (p - vec2f(-0.18, 0.08)) * vec2f(1.0, 2.0);
  color += uniforms.uA * exp(-dot(gp, gp) * 7.0) * 0.012;
  let grid = floor(vUV * uniforms.uResolution / 4.0);
  let star = step(0.99965, hash21(grid));
  color += vec3f(0.2, 0.3, 0.4) * star * pow(hash21(grid + 1.0), 3.0) * 0.25;
  fragmentOutputs.color = vec4f(display(color), 1.0);
}`;

/* ----------------------------------------------------------------------------------------------- surface (shaders/surface.glsl) */
const MF_SURFACE_VS = `
attribute position: vec3f;
uniform worldView: mat4x4f; uniform projection: mat4x4f;
uniform uAOStrength: f32;
varying vPos: vec3f; varying vNormal: vec3f; varying vXZ: vec2f; varying vLambda: f32; varying vK: f32; varying vFold: f32; varying vAO: f32;
// ambient occlusion from the true height function: horizon slopes in eight directions at three radii, per vertex
fn occlusion(p: vec2f, h0: f32) -> f32 {
  var occ = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785398 + 0.3927;
    let d = vec2f(cos(a), sin(a));
    var best = 0.0;
    for (var j = 0; j < 3; j++) {
      let r = 0.45 * pow(2.1, f32(j));
      let dh = heightAt(p + d * r) - h0;
      best = max(best, dh / sqrt(r * r + dh * dh) * (1.0 - 0.18 * f32(j)));
    }
    occ += max(0.0, best - 0.06);
  }
  return 1.0 - clamp(occ / 8.0 * uniforms.uAOStrength, 0.0, 0.42);
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  loadArrays();
  let aXZ = vertexInputs.position.xz - 11.2;
  let m = metric(aXZ);
  let s = surfaceAt(aXZ, m);
  vertexOutputs.vPos = vec3f(aXZ.x, s.x, aXZ.y);
  vertexOutputs.vNormal = normalize(vec3f(-s.y, 1.0, -s.z));
  vertexOutputs.vXZ = aXZ;
  vertexOutputs.vLambda = m.x;
  vertexOutputs.vFold = s.x + 1.72 * log(m.x);
  vertexOutputs.vK = -(m.w / m.x - dot(m.yz, m.yz) / (m.x * m.x)) / (m.x * m.x);
  var ao = 1.0;
  if (uniforms.uAOStrength > 0.0) { ao = occlusion(aXZ, s.x); }
  vertexOutputs.vAO = ao;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position.x, s.x, vertexInputs.position.z, 1.0);
}`;
const MF_SURFACE_FS = `
uniform uEye: vec3f; uniform uLineScale: f32;
varying vPos: vec3f; varying vNormal: vec3f; varying vXZ: vec2f; varying vLambda: f32; varying vK: f32; varying vFold: f32; varying vAO: f32;
// line widths are in device pixels (fwidth); uLineScale = supersampling factor keeps them the original's width on screen
fn line(f: f32, w0: f32) -> f32 {
  let w = w0 * uniforms.uLineScale;
  let a = max(fwidth(f), 1e-5);
  return 1.0 - smoothstep(a * w, a * (w + 1.0), abs(fract(f - 0.5) - 0.5));
}
fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(l + v);
  let nh = max(dot(n, h), 0.0); let nv = max(dot(n, v), 0.01); let nl = max(dot(n, l), 0.01);
  let a = rough * rough; let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let d = a2 / (PI * dd * dd);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let g = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  return d * g / (4.0 * nv * nl + 0.0001);
}
fn environment(r: vec3f) -> vec3f {
  let c = mix(vec3f(0.025, 0.034, 0.065), vec3f(0.085, 0.13, 0.20), smoothstep(-0.2, 0.9, r.y));
  let strip = pow(max(0.0, dot(r, normalize(vec3f(-0.5, 0.85, -0.4)))), 60.0);
  let strip2 = pow(max(0.0, dot(r, normalize(vec3f(0.7, 0.4, 0.2)))), 22.0);
  let strip3 = pow(max(0.0, dot(r, normalize(vec3f(-0.2, 0.3, 1.0)))), 36.0);
  let softbox = pow(max(0.0, dot(r, normalize(vec3f(0.1, 0.9, -0.3)))), 16.0);
  let blade = pow(max(0.0, dot(r, normalize(vec3f(-0.8, 0.25, 0.1)))), 110.0);
  return c + vec3f(1.5, 1.7, 1.9) * strip + uniforms.uC * strip2 * 1.25 + uniforms.uA * strip3 * 1.1 + mix(uniforms.uA, uniforms.uB, 0.4) * softbox * 0.45 + uniforms.uC * blade * 0.9;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  loadArrays();
  let vPos = fragmentInputs.vPos; let vXZ = fragmentInputs.vXZ; let vLambda = fragmentInputs.vLambda; let vK = fragmentInputs.vK; let vFold = fragmentInputs.vFold;
  let uA = uniforms.uA; let uB = uniforms.uB; let uC = uniforms.uC; let t = uniforms.uTime; let uMetal = uniforms.uMetal; let uMicro = uniforms.uMicro; let uGlow = uniforms.uGlow;
  let edge = max(abs(vXZ.x), abs(vXZ.y));
  let fade = 1.0 - smoothstep(9.7, 11.2, edge);
  if (fade < 0.015) { discard; }
  var n = normalize(fragmentInputs.vNormal);
  if (!fragmentInputs.frontFacing) { n = -n; }
  let micro = vec2f(cos(vXZ.x * 19.0 + vXZ.y * 11.0 + t * 0.18), sin(vXZ.y * 23.0 - vXZ.x * 9.0 - t * 0.14));
  n = normalize(n + vec3f(micro.x, 0.0, micro.y) * 0.006 * uMicro * (0.3 + uMetal));
  let v = normalize(uniforms.uEye - vPos);
  let nv = max(dot(n, v), 0.001);
  let K = tanh(vK * 11.0);
  let ll = log(vLambda);
  let swirl = 0.5 + 0.5 * sin(ll * 2.9 + vXZ.x * 0.17 - vXZ.y * 0.11 + t * 0.085);
  var base = mix(uB, uA, smoothstep(-0.5, 0.7, K * 0.7 + swirl * 0.5));
  let heart = smoothstep(0.3, 0.95, K);
  base = mix(base, uC, heart * 0.7);
  base *= 0.16 + 0.12 * swirl;
  let f0 = mix(vec3f(0.055), base, 0.55 * uMetal);
  let fres = f0 + (vec3f(1.0) - f0) * pow(max(1.0 - nv, 0.0), 5.0);
  let r = reflect(-v, n);
  let rough = mix(0.36, 0.20, uMetal);
  var light = vec3f(0.020, 0.032, 0.05) * base;
  let l1 = normalize(vec3f(-0.45, 0.84, 0.35)); let l2 = normalize(vec3f(0.7, 0.32, -0.6));
  let nl = max(dot(n, l1), 0.0);
  light += base * (0.18 + nl * 0.55);
  light += ggx(n, v, l1, rough) * nl * vec3f(3.0, 3.1, 3.4) * fres;
  light += ggx(n, v, l2, rough + 0.1) * max(dot(n, l2), 0.0) * uC * 2.0 * fres;
  light += environment(r) * fres * (0.65 + uMetal * 0.8);
  let film = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + (1.0 - nv) * 6.5 + ll * 1.4);
  let spectral = 0.5 + 0.5 * cos(vec3f(5.2, 3.1, 1.0) + (1.0 - nv) * 10.0 + ll * 2.8 + vFold * 0.18);
  let rim2 = pow(max(1.0 - nv, 0.0), 2.0);
  light += mix(uA, uB, film.r) * rim2 * 0.22;
  light += spectral * environment(r) * (0.025 + 0.12 * rim2) * uMicro;
  var tangent = vec3f(n.z, 0.0, -n.x) + vec3f(0.0001, 0.0, 0.0001);
  tangent = normalize(tangent - n * dot(tangent, n));
  let bitangent = cross(n, tangent);
  let halfway = normalize(v + l1);
  let ax = 0.38; let ay = 0.11;
  let ht = dot(halfway, tangent); let hb = dot(halfway, bitangent); let hn = max(0.001, dot(halfway, n));
  let den = ht * ht / (ax * ax) + hb * hb / (ay * ay) + hn * hn;
  let aniso = 1.0 / (PI * ax * ay * den * den);
  light += mix(vec3f(0.85, 0.94, 1.0), uC, 0.3) * min(aniso * nl * 0.018, 0.48) * fres * (0.25 + uMetal);
  let coat = ggx(n, v, l1, 0.13) * nl * 0.025;
  light += vec3f(0.9, 1.0, 1.08) * min(coat, 1.3) * (0.25 + uMetal * 0.75);
  let contour = line(ll * 4.2 + vFold * 0.22, 0.5);
  let secondary = line(ll * 15.0, 0.20) * 0.15;
  let grid = max(line(vXZ.x * 1.1, 0.3), line(vXZ.y * 1.1, 0.3));
  let pulse = 0.65 + 0.35 * sin(ll * 9.0 - t * 0.8);
  let lineColor = mix(uA, uC, smoothstep(-0.04, 0.07, vK));
  let frontWave = pow(0.5 + 0.5 * sin(ll * 11.0 - t * 0.9 + vXZ.x * 0.07), 18.0);
  light += (contour * (0.26 + frontWave * 0.38) + secondary) * lineColor * (0.4 + uGlow * 1.7) * uniforms.uContours;
  let interference = pow(0.5 + 0.5 * cos(ll * 33.0 + vFold * 0.8 - t * 0.11), 28.0);
  light += mix(uA, uC, swirl) * interference * 0.026 * uMicro * (0.25 + heart);
  let water = vXZ * 0.76 + vec2f(sin(ll * 1.3 + t * 0.07), cos(ll * 1.1 - t * 0.06)) * 0.45;
  let network = sin(water.x * 2.6 + sin(water.y * 1.3) + t * 0.16) + cos(water.y * 3.2 - sin(water.x * 1.6) - t * 0.12);
  let caustic = 1.0 - smoothstep(0.025, max(0.075, fwidth(network) * 1.6), abs(network));
  let beneath = smoothstep(1.15, 3.0, vLambda);
  light += mix(uA, uC, 0.55) * caustic * beneath * (0.045 + uGlow * 0.085) * uniforms.uCurrents;
  light += grid * mix(uA, vec3f(0.4, 0.55, 0.8), 0.4) * 0.038 * uniforms.uContours;
  light += base * pow(max(1.0 - nv, 0.0), 3.0) * 0.5;
  light += lineColor * pow(heart, 3.0) * 0.12 * pulse * uGlow;
  let cavity = clamp(0.7 + vPos.y * 0.035, 0.45, 1.0);
  light *= cavity;
  let fog = vec3f(0.008, 0.015, 0.028);
  let dist = length(uniforms.uEye - vPos);
  light = mix(light, fog, 1.0 - exp(-dist * 0.006));
  light = mix(fog, light, fade);
  fragmentOutputs.color = vec4f(display(light * fragmentInputs.vAO), 1.0);
}`;

/* ----------------------------------------------------------------------------------------------- veil (shaders/veil.glsl) */
const MF_VEIL_VS = `
attribute position: vec3f;
uniform worldView: mat4x4f; uniform projection: mat4x4f;
varying vPos: vec3f; varying vNormal: vec3f; varying vXZ: vec2f; varying vLambda: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  loadArrays();
  let aXZ = vertexInputs.position.xz - 11.2;
  let m = metric(aXZ);
  let s = surfaceAt(aXZ, m);
  let phase = log(m.x) * 0.7 - uniforms.uTime * 0.14;
  let lift = 0.36 + 0.19 * sin(phase);
  let slope = s.yz + 0.133 * cos(phase) * m.yz / m.x;
  let pos = vec3f(aXZ.x, s.x + lift, aXZ.y);
  vertexOutputs.vPos = pos;
  vertexOutputs.vNormal = normalize(vec3f(-slope.x, 1.0, -slope.y));
  vertexOutputs.vXZ = aXZ;
  vertexOutputs.vLambda = m.x;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position.x, pos.y, vertexInputs.position.z, 1.0);
}`;
const MF_VEIL_FS = `
uniform uEye: vec3f; uniform uVeil: f32;
varying vPos: vec3f; varying vNormal: vec3f; varying vXZ: vec2f; varying vLambda: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  loadArrays();
  let vPos = fragmentInputs.vPos; let vXZ = fragmentInputs.vXZ; let vLambda = fragmentInputs.vLambda; let t = uniforms.uTime;
  let mask = smoothstep(1.18, 2.6, vLambda) * (1.0 - smoothstep(9.0, 10.7, max(abs(vXZ.x), abs(vXZ.y)))) * uniforms.uVeil;
  if (mask < 0.002) { discard; }
  var n = normalize(fragmentInputs.vNormal);
  let v = normalize(uniforms.uEye - vPos);
  if (dot(n, v) < 0.0) { n = -n; }
  let ll = log(vLambda);
  let rim = pow(1.0 - max(0.0, dot(n, v)), 3.0);
  let spectrum = 0.5 + 0.5 * cos(vec3f(0.3, 2.4, 4.6) + rim * 7.0 + ll * 1.8 - t * 0.045);
  let crest = abs(fract(ll * 6.5 - t * 0.024) - 0.5);
  let fringe = 1.0 - smoothstep(0.012, 0.04, crest);
  let softbox = pow(max(0.0, dot(reflect(-v, n), normalize(vec3f(-0.4, 0.85, 0.3)))), 45.0);
  let tint = mix(uniforms.uA, uniforms.uB, 0.5 + 0.5 * sin(ll * 1.7));
  let extra = tint * rim * 0.16 + spectrum * rim * 0.06 + mix(uniforms.uC, vec3f(1.0), 0.6) * softbox * 0.24 + tint * fringe * 0.06;
  fragmentOutputs.color = lightOut(extra * mask * (0.22 + rim * 0.25));
}`;

/* ----------------------------------------------------------------------------------------------- flow ribbons (shaders/flow.glsl) */
const MF_FLOW_VS = `
attribute position: vec3f;
attribute aPath: vec4f;    // x, z, cumulative planar arc length, trace id
attribute aRibbon: vec3f;  // planar tangent x/z, side (-1 or +1)
uniform worldView: mat4x4f; uniform projection: mat4x4f;
uniform uEye: vec3f; uniform uResolution: vec2f; uniform uPixelRatio: f32; uniform uRibbonWidth: f32;
varying vAlong: f32; varying vId: f32; varying vSide: f32; varying vFade: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  loadArrays();
  let p = vertexInputs.aPath.xy;
  let m = metric(p);
  let s = surfaceAt(p, m);
  let pos = vec3f(p.x, s.x + 0.095, p.y);
  let flatTangent = normalize(vertexInputs.aRibbon.xy);
  let tangent = normalize(vec3f(flatTangent.x, dot(s.yz, flatTangent), flatTangent.y));
  let view = normalize(uniforms.uEye - pos);
  var side = cross(tangent, view);
  if (dot(side, side) < 1e-8) { side = vec3f(-flatTangent.y, 0.0, flatTangent.x); }
  side = normalize(side);
  let VP = uniforms.projection * uniforms.worldView;
  var clip = VP * vec4f(pos, 1.0);
  let projectedSide = VP * vec4f(side, 0.0);
  var screenSide = (projectedSide.xy * clip.w - clip.xy * projectedSide.w) * uniforms.uResolution;
  if (dot(screenSide, screenSide) < 1e-8) { screenSide = vec2f(1.0, 0.0); }
  screenSide = normalize(screenSide);
  let halfWidthCSS = uniforms.uRibbonWidth;
  let off = screenSide * vertexInputs.aRibbon.z * (2.0 * halfWidthCSS * uniforms.uPixelRatio / uniforms.uResolution) * clip.w;
  clip = vec4f(clip.xy + off, clip.zw);
  vertexOutputs.position = clip;
  vertexOutputs.vAlong = vertexInputs.aPath.z; vertexOutputs.vId = vertexInputs.aPath.w; vertexOutputs.vSide = vertexInputs.aRibbon.z;
  vertexOutputs.vFade = (1.0 - smoothstep(9.4, 10.9, max(abs(p.x), abs(p.y)))) * exp(-max(0.0, length(uniforms.uEye - pos) - 20.0) * 0.01);
}`;
const MF_FLOW_FS = `
uniform uRibbonGain: f32;
varying vAlong: f32; varying vId: f32; varying vSide: f32; varying vFade: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  loadArrays();
  let vSide = fragmentInputs.vSide; let vId = fragmentInputs.vId; let vAlong = fragmentInputs.vAlong;
  let r = abs(vSide);
  let aa = max(fwidth(vSide), 0.06);
  let edge = 1.0 - smoothstep(1.0 - aa * 0.5, 1.0 + aa * 0.5, r);
  let core = 1.0 - smoothstep(0.10, 0.43, r);
  let skirt = exp(-r * r * 2.2);
  let phase = fract(vAlong * 0.055 - uniforms.uTime * 0.10 - vId * 0.137);
  let packet = pow(max(0.0, 1.0 - abs(phase - 0.5) * 2.0), 18.0);
  let color = mix(uniforms.uA, uniforms.uC, 0.55 + 0.4 * sin(vId * 1.4));
  let alpha = edge * skirt * fragmentInputs.vFade * (0.16 + 0.28 * core + packet * 0.8) * (0.55 + uniforms.uGlow * 0.45);
  let radiance = color * (0.70 + 0.80 * core + packet * (1.8 + core * 2.5));
  fragmentOutputs.color = lightOut(radiance * alpha * uniforms.uRibbonGain);
}`;

/* ----------------------------------------------------------------------------------------------- filaments (shaders/fibers.glsl) */
const MF_FIBER_VS = `
attribute position: vec3f;
attribute aFiber: vec4f;
uniform worldView: mat4x4f; uniform projection: mat4x4f; uniform uEye: vec3f;
uniform uAnchors0: vec4f; uniform uAnchors1: vec4f; uniform uAnchors2: vec4f; uniform uAnchors3: vec4f; uniform uAnchors4: vec4f; uniform uAnchors5: vec4f; uniform uAnchors6: vec4f;
varying vSide: f32; varying vT: f32; varying vId: f32; varying vFade: f32;
fn curve(a: vec3f, b: vec3f, t: f32, id: f32) -> vec3f {
  var p = mix(a, b, t);
  let arch = sin(PI * t);
  p.y += arch * (5.8 + uniforms.uEnergy * 1.1 + 0.35 * sin(id * 1.7 + uniforms.uTime * 0.12));
  let side = normalize(vec3f(-(b.z - a.z), 0.0, b.x - a.x));
  p += side * sin(t * PI * 2.0 + id) * arch * 0.18;
  return p;
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let anchors = array<vec4f, 7>(uniforms.uAnchors0, uniforms.uAnchors1, uniforms.uAnchors2, uniforms.uAnchors3, uniforms.uAnchors4, uniforms.uAnchors5, uniforms.uAnchors6);
  let F = vertexInputs.aFiber;
  let ia = i32(F.x); let ib = i32(F.y); let t = F.z;
  let id = f32(ia) + f32(ib) * 0.37;
  let a = anchors[ia].xyz; let b = anchors[ib].xyz;
  var p = curve(a, b, t, id);
  let tangent = normalize(curve(a, b, min(0.9999, t + 0.004), id) - curve(a, b, max(0.0001, t - 0.004), id));
  var side = normalize(cross(tangent, normalize(uniforms.uEye - p)));
  let up = normalize(cross(tangent, side));
  let twist = t * 9.0 + uniforms.uTime * 0.22 + id * 0.8;
  side = side * cos(twist) + up * sin(twist);
  let width = 0.052 + 0.11 * pow(sin(PI * t), 2.0);
  p += side * F.w * width;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(p, 1.0);
  vertexOutputs.vSide = F.w; vertexOutputs.vT = t; vertexOutputs.vId = id;
  vertexOutputs.vFade = pow(max(0.0, sin(PI * t)), 0.35);
}`;
const MF_FIBER_FS = `
varying vSide: f32; varying vT: f32; varying vId: f32; varying vFade: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vSide = fragmentInputs.vSide; let vT = fragmentInputs.vT; let vId = fragmentInputs.vId; let t = uniforms.uTime;
  let edge = 1.0 - smoothstep(0.12, 1.0, abs(vSide));
  let packet = pow(max(0.0, 1.0 - abs(fract(vT - t * 0.095 + vId * 0.17) - 0.5) * 2.0), 26.0);
  var c = mix(uniforms.uA, uniforms.uC, 0.5 + 0.4 * sin(vId));
  let iridescence = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + vT * 5.0 - t * 0.08 + vId);
  c = mix(c, iridescence, 0.12);
  let core = exp(-vSide * vSide * 90.0);
  let alpha = edge * fragmentInputs.vFade * (0.075 + core * 0.14 + packet * 0.5);
  fragmentOutputs.color = lightOut(c * (0.9 + packet * 3.5 + core * 0.25) * alpha * (0.6 + uniforms.uGlow * 0.4));
}`;

/* ----------------------------------------------------------------------------------------------- source nodes (shaders/nodes.glsl), sprite quads */
const MF_NODE_VS = `
attribute position: vec3f;
attribute corner: vec2f;
uniform worldView: mat4x4f; uniform projection: mat4x4f; uniform uViewport: vec2f;
uniform uAnchors0: vec4f; uniform uAnchors1: vec4f; uniform uAnchors2: vec4f; uniform uAnchors3: vec4f; uniform uAnchors4: vec4f; uniform uAnchors5: vec4f; uniform uAnchors6: vec4f;
uniform uPixelRatio: f32; uniform uSpriteScale: f32;
varying vId: f32; varying vCorner: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let anchors = array<vec4f, 7>(uniforms.uAnchors0, uniforms.uAnchors1, uniforms.uAnchors2, uniforms.uAnchors3, uniforms.uAnchors4, uniforms.uAnchors5, uniforms.uAnchors6);
  let aId = vertexInputs.position.x;
  let pos = anchors[i32(aId + 0.5)].xyz;
  var clip = uniforms.projection * uniforms.worldView * vec4f(pos, 1.0);
  let size = clamp(600.0 * uniforms.uPixelRatio / max(5.0, clip.w), 10.0, 50.0) * uniforms.uSpriteScale;
  clip = vec4f(clip.xy + vertexInputs.corner * size / uniforms.uViewport * clip.w, clip.zw);
  vertexOutputs.position = clip;
  vertexOutputs.vId = aId; vertexOutputs.vCorner = vertexInputs.corner;
}`;
const MF_NODE_FS = `
varying vId: f32; varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let q = fragmentInputs.vCorner;
  let r = dot(q, q);
  let halo = exp(-r * 6.0); let core = exp(-r * 130.0);
  let star = exp(-abs(q.x) * 75.0 - abs(q.y) * 6.0) + exp(-abs(q.y) * 75.0 - abs(q.x) * 6.0);
  let c = mix(uniforms.uA, uniforms.uC, 0.5 + 0.35 * sin(fragmentInputs.vId * 1.7));
  fragmentOutputs.color = lightOut(c * (0.7 + core * 7.0) * (halo * 0.25 + core * 0.65 + star * 0.08));
}`;

/* ----------------------------------------------------------------------------------------------- motes (shaders/particles.glsl), sprite quads */
const MF_MOTE_VS = `
attribute position: vec3f;
attribute color: vec4f;
attribute corner: vec2f;
uniform worldView: mat4x4f; uniform projection: mat4x4f; uniform uViewport: vec2f;
uniform uPixelRatio: f32; uniform uSpriteScale: f32;
varying vAlpha: f32; varying vCol: vec3f; varying vCorner: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  loadArrays();
  let aSeed = vec4f(vertexInputs.position.x, vertexInputs.position.z, vertexInputs.position.y, vertexInputs.color.r);
  let t = uniforms.uTime;
  let p = aSeed.xy + vec2f(sin(t * 0.035 + aSeed.z * 4.0), cos(t * 0.04 + aSeed.z * 3.0)) * 0.45;
  let m = metric(p);
  let s = surfaceAt(p, m);
  let lift = 0.18 + pow(aSeed.z, 3.0) * 3.8;
  let pos = vec3f(p.x, s.x + lift + 0.15 * sin(t * 0.4 + aSeed.w * 10.0), p.y);
  var clip = uniforms.projection * uniforms.worldView * vec4f(pos, 1.0);
  let size = clamp((1.0 + pow(aSeed.w, 8.0) * 3.0) * uniforms.uPixelRatio * 22.0 / max(4.0, clip.w), 1.0, 9.0) * uniforms.uSpriteScale;
  clip = vec4f(clip.xy + vertexInputs.corner * size / uniforms.uViewport * clip.w, clip.zw);
  vertexOutputs.position = clip;
  var alpha = (0.1 + 0.7 * pow(aSeed.w, 5.0)) * (0.65 + 0.35 * sin(t * 0.7 + aSeed.z * 23.0));
  alpha *= 1.0 - smoothstep(9.0, 11.0, max(abs(p.x), abs(p.y)));
  vertexOutputs.vAlpha = alpha;
  vertexOutputs.vCol = mix(uniforms.uA, uniforms.uC, aSeed.w);
  vertexOutputs.vCorner = vertexInputs.corner;
}`;
const MF_MOTE_FS = `
varying vAlpha: f32; varying vCol: vec3f; varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let r = length(fragmentInputs.vCorner);
  let a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.65, 1.0, r));
  fragmentOutputs.color = lightOut(fragmentInputs.vCol * 1.7 * a * fragmentInputs.vAlpha);
}`;

/* One entry per ComposedShader. Both stages carry the shared uniform declarations and common functions. `order` is the draw order (alphaIndex). */
const MF_PORTS = {
  sky:     { vs: MF_SKY_VS,     fs: MF_SKY_FS,     attrs: ['position'],                     order: 0, blend: false, usesArrays: true },
  surface: { vs: MF_SURFACE_VS, fs: MF_SURFACE_FS, attrs: ['position'],                     order: 1, blend: false },
  veil:    { vs: MF_VEIL_VS,    fs: MF_VEIL_FS,    attrs: ['position'],                     order: 2, blend: true },
  flow:    { vs: MF_FLOW_VS,    fs: MF_FLOW_FS,    attrs: ['position', 'aPath', 'aRibbon'],  order: 3, blend: true },
  fiber:   { vs: MF_FIBER_VS,   fs: MF_FIBER_FS,   attrs: ['position', 'aFiber'],            order: 4, blend: true },
  node:    { vs: MF_NODE_VS,    fs: MF_NODE_FS,    attrs: ['position', 'corner'],            order: 5, blend: true, sprite: true },
  mote:    { vs: MF_MOTE_VS,    fs: MF_MOTE_FS,    attrs: ['position', 'color', 'corner'],   order: 6, blend: true, sprite: true },
};
/* vertex-hash + '-' + fragment-hash of the whitespace-collapsed GLSL in scenes/manifold.x3d (manifold/census.py prints them; build-manifold.py re-checks) */
const MF_BY_HASH = {
  'fae893dd-6e5177d1': 'sky', '4ab8e2fd-7527f1ed': 'surface', '1aabd540-95625852': 'veil', '4e3e809c-b8a2a89f': 'flow',
  '208a5a28-9fef8453': 'fiber', 'aa40821b-2e6d7745': 'node', '3cb55e19-49662f42': 'mote',
};

/* Babylon WebGPU body for the X3D reader: draws what the reader holds, runs the event loop, owns the camera and the pointer sensors.
   Pinned Babylon build is loaded by the page (see build-brain.py); this file only needs the global BABYLON. */

const B_UNIFORM_SCALE_NOTE = 'shaders read x3d_NormalMatrix as the upper 3x3 of the model-view matrix: exact for uniform scale (every Transform in these scenes is).';

class Body {
  constructor(canvas, opts) {
    this.canvas = canvas; this.opts = opts || {};
    this.rec = new Map();            // raw node id -> { tn, kids, meshes, ... }
    this.meshesOf = new Map();       // raw node id (material, shader, texture, geometry...) -> [mesh]
    this.texCache = new Map(); this.geoCache = new Map();
    this.sensors = new Map();        // raw TouchSensor id -> { node, group }
    this.notes = new Set(); this.frameTimes = [];
    this.pose = { pos: [0, 0, 10], q: [0, 0, 0, 1], center: [0, 0, 0], fov: 0.7854 };
    this.tr = null; this.bound = null; this.vpStack = [];
    this.look = { wired: false };
    this.stats = { frames: 0 };
  }

  async init() {
    const gpu = navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null));
    if (!gpu) throw new Error('WebGPU is not available in this browser, or the adapter was refused.');
    const e = this.engine = new BABYLON.WebGPUEngine(this.canvas, { antialias: true, adaptToDeviceRatio: true, powerPreference: 'high-performance', stencil: false });
    await e.initAsync();
    this.adapterInfo = gpu.info ? { vendor: gpu.info.vendor, architecture: gpu.info.architecture, description: gpu.info.description } : {};
    const s = this.scene = new BABYLON.Scene(e);
    s.useRightHandedSystem = true;
    s.clearColor = new BABYLON.Color4(0.003, 0.005, 0.012, 1);
    s.skipPointerMovePicking = true; s.autoClear = true;
    const ic = s.imageProcessingConfiguration;
    this.setTone(this.opts.tone === undefined ? 'neutral' : this.opts.tone);
    ic.exposure = this.opts.exposure || 1; ic.contrast = 1;
    const c = this.cam = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, 10), s);
    c.minZ = 0.5; c.maxZ = 4000; c.inputs.clear();
    this.lights = [];
    this.setupInput();
    new ResizeObserver(() => { e.resize(); this.applyCamera(); }).observe(this.canvas);
    e.runRenderLoop(() => this.frame());
    return this;
  }

  /* tone mapping reaches the PBR and Standard materials only (their shaders apply it); the ported ComposedShaders write their values as authored, as X_ITE's do */
  setTone(kind) {
    const ic = this.scene.imageProcessingConfiguration, C = BABYLON.ImageProcessingConfiguration;
    ic.toneMappingEnabled = kind && kind !== 'none';
    if (kind === 'neutral') ic.toneMappingType = C.TONEMAPPING_KHR_PBR_NEUTRAL; else if (kind === 'aces') ic.toneMappingType = C.TONEMAPPING_ACES; else if (kind === 'standard') ic.toneMappingType = C.TONEMAPPING_STANDARD;
    this.tone = kind;
  }

  /* ----------------------------------------------------------------- world */
  setWorld(world, baseUrl, resolve) {
    this.clearWorld();
    this.world = world; this.baseUrl = baseUrl; this.resolve = resolve || ((u) => u);
    this.root = new BABYLON.TransformNode('x3d-root', this.scene);
    for (const n of world.children) this.build(n, this.root, []);
    for (const n of world.nodes) if (n.type === 'Viewpoint' && !n._seen) { /* vp nodes are built through build() */ }
    this.buildLights();
    this.applyBackground();
    this.applyClip();
  }
  clearWorld() {
    if (!this.root) return;
    this.scene.meshes.slice().forEach((m) => m.dispose(false, false));
    this.scene.transformNodes.slice().forEach((t) => t.dispose());
    this.scene.materials.slice().forEach((m) => m.dispose(true, true));
    this.scene.lights.slice().forEach((l) => l.dispose());
    this.scene.geometries.slice().forEach((g) => g.dispose());
    this.rec.clear(); this.meshesOf.clear(); this.geoCache.clear(); this.sensors.clear(); this.lights = []; this.vpStack = []; this.bound = null;
    if (this.env) { this.env.dispose(); this.env = null; }
    this.root = null;
  }
  note(msg) { if (!this.notes.has(msg)) { this.notes.add(msg); if (this.opts.onNote) this.opts.onNote(msg); } }

  /* dispatcher: Group-like nodes make a TransformNode, Shapes make meshes, the rest set scene state */
  build(n, parent, chain) {
    if (!n) return null;
    switch (n.type) {
      case 'Group': case 'Switch': case 'Transform': case 'Billboard': return this.buildGroup(n, parent, chain);
      case 'Shape': return this.buildShape(n, parent, chain);
      case 'Viewpoint': { const r = { node: n, parent, tn: parent }; this.rec.set(n.id, r); (this.viewpoints ||= []).includes(n) || this.viewpoints.push(n); this.vpParent ||= new Map(); this.vpParent.set(n, parent); return r; }
      case 'TouchSensor': this.sensors.set(n.id, { node: n, group: chain[0] || null, parentTN: parent }); return null;
      case 'ClipPlane': this.clipNodes = (this.clipNodes || []).filter((x) => x !== n).concat(n); this.clipParent = parent; return null;
      case 'DirectionalLight': case 'EnvironmentLight': this.lightNodes = (this.lightNodes || []).filter((x) => x !== n).concat(n); return null;
      case 'Sound': this.soundNode = n; return null;
      case 'NavigationInfo': case 'Background': case 'Fog': case 'WorldInfo': case 'TimeSensor': case 'ScalarInterpolator': case 'PositionInterpolator': case 'OrientationInterpolator': case 'ColorInterpolator': return null; // scene state or event nodes: the reader runs them
      default: this.note('skipped <' + n.type + '>'); return null;
    }
  }
  buildGroup(n, parent, chain) {
    const tn = new BABYLON.TransformNode(n.def || n.type, this.scene);
    tn.parent = parent;
    const r = { node: n, tn, kids: [], chain: [n, ...chain] };
    this.rec.set(n.id, r);
    if (n.type === 'Transform') this.applyTransform(n, tn);
    if (n.type === 'Billboard') (this.billboards ||= []).push(r); // turned toward the eye every frame by updateBillboards (Babylon's own billboard mode points +Z the wrong way in a right-handed scene)
    const host = tn;
    for (const c of n.f.children) { const cr = this.build(c, host, r.chain); r.kids.push(cr); }
    if (n.type === 'Switch') this.applySwitch(n);
    if (n.f.visible === false) tn.setEnabled(false);
    return r;
  }
  applyTransform(n, tn) {
    const f = n.f, T = f.translation, S = f.scale, c = f.center, sr = f.scaleOrientation, rot = f.rotation;
    const simple = !c[0] && !c[1] && !c[2] && !sr[3];
    if (simple) {
      tn.position.set(T[0], T[1], T[2]);
      tn.rotationQuaternion = new BABYLON.Quaternion(...R.quat.fromAxisAngle(rot, rot[3]));
      tn.scaling.set(S[0], S[1], S[2]);
      return;
    }
    // general case: T * C * R * SR * S * -SR * -C as one matrix; a non-uniform scale under SR becomes a shear, which a TransformNode keeps as a matrix
    const M = BABYLON.Matrix;
    const tr = (v) => M.Translation(v[0], v[1], v[2]);
    const rq = (q) => { const m = new M(); new BABYLON.Quaternion(...R.quat.fromAxisAngle(q, q[3])).toRotationMatrix(m); return m; };
    // BABYLON multiplies row-vector style (v * M), so compose in the opposite order
    const parts = [tr([-c[0], -c[1], -c[2]]), rq([sr[0], sr[1], sr[2], -sr[3]]), M.Scaling(S[0], S[1], S[2]), rq(sr), rq(rot), tr(c), tr(T)];
    let out = M.Identity(); for (const p of parts) out = out.multiply(p);
    out.decompose(tn.scaling, tn.rotationQuaternion = new BABYLON.Quaternion(), tn.position);
    this.note('Transform with center or scaleOrientation decomposed to TRS (shear dropped)');
  }
  applySwitch(n) {
    const r = this.rec.get(n.id); if (!r) return;
    r.kids.forEach((k, i) => { const on = i === n.f.whichChoice; if (k && k.tn) k.tn.setEnabled(on); });
  }

  /* ---------------------------------------------------------------- shapes */
  buildShape(n, parent, chain) {
    const f = n.f, g = f.geometry, app = f.appearance;
    const r = { node: n, meshes: [], chain: [n, ...chain] };
    this.rec.set(n.id, r);
    if (!g) return r;
    const tn = new BABYLON.TransformNode('shape-' + (n.def || n.id), this.scene); tn.parent = parent; r.tn = tn;
    const mats = this.materialsFor(n, g, app);
    if (!mats) return r;
    for (const [i, spec] of mats.entries()) {
      const mesh = this.makeMesh(n, g, spec, i);
      if (!mesh) continue;
      mesh.parent = tn; mesh.metadata = { shape: n, chain: r.chain, pick: f.pointerEvents !== false && !spec.noPick };
      mesh.isPickable = mesh.metadata.pick;
      r.meshes.push(mesh);
      const cg = r.chain.find((gr) => gr.f.children && gr.f.children.some((c) => c.type === 'ClipPlane'));
      if (cg) (this.clipMeshes ||= []).push({ mesh, clip: cg.f.children.find((c) => c.type === 'ClipPlane'), group: cg });
      for (const dep of spec.deps || []) { const l = this.meshesOf.get(dep.id) || []; l.push(mesh); this.meshesOf.set(dep.id, l); }
    }
    if (f.visible === false) tn.setEnabled(false);
    return r;
  }

  /* what material (or two, for glass: back faces then front faces) a Shape gets */
  materialsFor(shape, g, app) {
    const mat = app && app.f.material;
    const cs = app && app.f.shaders.find((s) => s.type === 'ComposedShader');
    if (g.type === 'Text') return [{ kind: 'text', mat, deps: [g, mat].filter(Boolean) }];
    if (g.type === 'IndexedLineSet') {
      const lp = app && app.f.lineProperties;
      return [{ kind: 'ribbon', mat, lp, deps: [mat, lp, g].filter(Boolean) }];
    }
    if (cs) {
      const key = this.shaderKey(cs);
      const port = WGSL_BY_HASH[key];
      if (port) return [{ kind: 'glass', port, cs, back: true, deps: [cs] }, { kind: 'glass', port, cs, back: false, deps: [cs] }];
      this.note('ComposedShader ' + (cs.def || '') + ' has no WGSL port (hash ' + key + '): drawn with its Material');
    }
    if (mat && mat.type === 'PhysicalMaterial') return [{ kind: 'pbr', mat, tex: mat.f.baseTexture, deps: [mat, mat.f.baseTexture].filter(Boolean) }];
    if (mat && mat.type === 'Material') return [{ kind: 'phong', mat, deps: [mat] }];
    const tex = app && app.f.texture;
    return [{ kind: 'unlit', tex, deps: [tex].filter(Boolean) }];
  }
  shaderKey(cs) {
    if (cs._key) return cs._key;
    const src = { VERTEX: '', FRAGMENT: '' };
    for (const part of cs.f.parts) if (part.type === 'ShaderPart') src[String(part.f.type || 'VERTEX').toUpperCase()] = shaderSource(part);
    return (cs._key = fnv1a(normSrc(src.VERTEX)) + '-' + fnv1a(normSrc(src.FRAGMENT)));
  }

  /* ------------------------------------------------------------- geometry */
  geometryData(g) {
    const f = g.f, ver = [g, f.coord, f.normal, f.color, f.texCoord].map((x) => (x ? x.version || 0 : -1)).join('.');
    const hit = this.geoCache.get(g.id);
    if (hit && hit.ver === ver) return hit;
    const out = { ver, pos: null, nrm: null, col: null, uv: null, idx: null };
    const P = f.coord && f.coord.f.point;
    if (g.type === 'IndexedTriangleSet') {
      out.pos = P; out.idx = Uint32Array.from(f.index);
      out.nrm = f.normal && f.normal.f.vector.length === P.length ? f.normal.f.vector : null;
      out.col = f.color ? f.color.f.color : null; out.uv = f.texCoord ? f.texCoord.f.point : null;
      if (f.ccw === false) for (let i = 0; i < out.idx.length; i += 3) { const t = out.idx[i + 1]; out.idx[i + 1] = out.idx[i + 2]; out.idx[i + 2] = t; }
    } else if (g.type === 'IndexedFaceSet') {
      // expand per corner (texture coordinates and flat normals differ across a face); fan-triangulate
      const ci = f.coordIndex, pos = [], uv = [], nrm = [], col = [], idx = [];
      const TC = f.texCoord && f.texCoord.f.point, TI = f.texCoordIndex && f.texCoordIndex.length ? f.texCoordIndex : ci;
      const C = f.color && f.color.f.color, CI = f.colorIndex && f.colorIndex.length ? f.colorIndex : ci;
      let face = [];
      const flush = () => {
        if (face.length >= 3) {
          const a = face[0][0], b = face[1][0], c = face[2][0];
          const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
          const nn = R.v3.norm(R.v3.cross(R.v3.sub(pb, pa), R.v3.sub(pc, pa)));
          const base = pos.length / 3;
          for (const k of face.map((_, i) => i)) {
            const vi = face[k][0]; pos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]); nrm.push(...(f.ccw === false ? nn.map((x) => -x) : nn));
            const ti = face[k][1]; if (TC) uv.push(TC[ti * 2], TC[ti * 2 + 1]);
            const cci = face[k][2]; if (C) col.push(C[cci * 3], C[cci * 3 + 1], C[cci * 3 + 2]);
          }
          for (let i = 1; i + 1 < face.length; i++) { if (f.ccw === false) idx.push(base, base + i + 1, base + i); else idx.push(base, base + i, base + i + 1); }
        }
        face = [];
      };
      for (let i = 0; i < ci.length; i++) { if (ci[i] < 0) flush(); else face.push([ci[i], TI[i], CI[i]]); }
      flush();
      out.pos = Float32Array.from(pos); out.nrm = Float32Array.from(nrm); out.idx = Uint32Array.from(idx);
      out.uv = TC ? Float32Array.from(uv) : null; out.col = C ? Float32Array.from(col) : null;
    }
    this.geoCache.set(g.id, out);
    return out;
  }
  /* geometry nodes of the same raw node share one Babylon.Geometry */
  babylonGeometry(g, wantColor) {
    const d = this.geometryData(g);
    const key = g.id + (wantColor ? 'c' : '');
    const c = this.geoCache.get(key);
    if (c && c.ver === d.ver) return c.geo;
    if (c) c.geo.dispose();
    const vd = new BABYLON.VertexData();
    vd.positions = d.pos; vd.indices = d.idx;
    vd.normals = d.nrm || (() => { const n = new Float32Array(d.pos.length); BABYLON.VertexData.ComputeNormals(d.pos, d.idx, n); return n; })();
    if (d.uv) vd.uvs = d.uv;
    if (d.col || wantColor) {
      const nv = d.pos.length / 3, rgba = new Float32Array(nv * 4);
      for (let i = 0; i < nv; i++) { rgba[i * 4] = d.col ? d.col[i * 3] : 1; rgba[i * 4 + 1] = d.col ? d.col[i * 3 + 1] : 1; rgba[i * 4 + 2] = d.col ? d.col[i * 3 + 2] : 1; rgba[i * 4 + 3] = 1; }
      vd.colors = rgba;
    }
    const geo = new BABYLON.Geometry('geo-' + key, this.scene, undefined, true);
    vd.applyToGeometry(geo, false);
    this.geoCache.set(key, { ver: d.ver, geo });
    return geo;
  }

  makeMesh(shape, g, spec, passIndex) {
    const s = this.scene;
    const name = (shape.def || 'shape') + '-' + spec.kind + passIndex;
    let mesh;
    if (g.type === 'Box') { const z = g.f.size; mesh = BABYLON.MeshBuilder.CreateBox(name, { width: z[0], height: z[1], depth: z[2] }, s); }
    else if (g.type === 'Cylinder') { mesh = BABYLON.MeshBuilder.CreateCylinder(name, { diameter: g.f.radius * 2, height: g.f.height, tessellation: 48 }, s); }
    else if (g.type === 'Sphere') { mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: g.f.radius * 2, segments: 32 }, s); }
    else if (g.type === 'Text') { return this.makeText(shape, g, spec, name); }
    else if (g.type === 'IndexedLineSet') { return this.makeRibbon(shape, g, spec, name); }
    else if (g.type === 'IndexedTriangleSet' || g.type === 'IndexedFaceSet') {
      mesh = new BABYLON.Mesh(name, s);
      this.babylonGeometry(g, spec.kind === 'glass').applyToMesh(mesh);
    } else { this.note('skipped geometry <' + g.type + '>'); return null; }
    mesh.material = this.makeMaterial(shape, g, spec, mesh);
    const m = mesh.material;
    // Babylon's alphaIndex defaults to the largest number, which would draw every sprite after the glass; X_ITE sorts blended shapes by distance, so sprites join the glass passes at 0
    if (spec.kind === 'glass') { mesh.alphaIndex = (spec.back ? 0 : 1) + (spec.port === 'aura' ? 2 : 0); mesh.renderingGroupId = 0; } else mesh.alphaIndex = 0;
    return mesh;
  }

  /* ------------------------------------------------------------- materials */
  tex(texNode) {
    if (!texNode || !texNode.f.url || !texNode.f.url.length) return null;
    const u = texNode.f.url[0];
    const hit = this.texCache.get(texNode.id); if (hit) return hit;
    const url = this.resolve(u, this.baseUrl);
    const t = new BABYLON.Texture(url, this.scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    t.hasAlpha = true;
    if (texNode.f.repeatS === false) t.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    if (texNode.f.repeatT === false) t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.texCache.set(texNode.id, t);
    return t;
  }
  makeMaterial(shape, g, spec, mesh) {
    const s = this.scene;
    if (spec.kind === 'glass') return this.glassMaterial(spec);
    if (spec.kind === 'pbr') {
      const m = new BABYLON.PBRMaterial('pbr-' + spec.mat.def, s);
      m.backFaceCulling = g.f.solid === true; m.twoSidedLighting = this.opts.twoSided !== false;
      if (this.opts.ccw !== false) m.sideOrientation = BABYLON.Material.CounterClockWiseSideOrientation; // X3D wraps counter-clockwise faces front; this scene is right-handed
      m.albedoTexture = this.tex(spec.tex);
      m.useAlphaFromAlbedoTexture = false;
      m.reflectionTexture = this.env || null;
      m.environmentIntensity = 1;
      this.refreshPBR(m, spec.mat);
      return m;
    }
    if (spec.kind === 'phong') {
      const m = new BABYLON.StandardMaterial('std-' + (spec.mat.def || shape.id), s);
      m.backFaceCulling = false; m.specularColor.set(0, 0, 0);
      this.refreshPhong(m, spec.mat);
      return m;
    }
    const t = this.tex(spec.tex);
    if (!t) { const m0 = new BABYLON.StandardMaterial('plain-' + shape.id, s); m0.disableLighting = true; m0.emissiveColor.set(1, 1, 1); m0.backFaceCulling = false; return m0; }
    BABYLON.ShaderStore.ShadersStoreWGSL['unlitVertexShader'] = VERT_UNLIT; BABYLON.ShaderStore.ShadersStoreWGSL['unlitFragmentShader'] = FRAG_UNLIT;
    const m = new BABYLON.ShaderMaterial('unlit-' + shape.id, s, { vertex: 'unlit', fragment: 'unlit' },
      { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'opacity'], samplers: ['tex0'], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
    m.setTexture('tex0', t); m.setFloat('opacity', 1);
    m.alphaMode = BABYLON.Engine.ALPHA_COMBINE; m.backFaceCulling = false; m.disableDepthWrite = true;
    return m;
  }
  refreshPBR(m, mat) {
    const f = mat.f;
    m.albedoColor = new BABYLON.Color3(f.baseColor[0], f.baseColor[1], f.baseColor[2]); // PhysicalMaterial colours are linear (glTF model)
    m.metallic = f.metallic; m.roughness = f.roughness;
    m.emissiveColor = new BABYLON.Color3(f.emissiveColor[0], f.emissiveColor[1], f.emissiveColor[2]);
    m.alpha = 1 - f.transparency;
    if (m.alpha < 0.999) { m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true; }
    else { m.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE; m.disableDepthWrite = false; }
  }
  refreshPhong(m, mat) {
    const f = mat.f;
    m.diffuseColor.set(f.diffuseColor[0], f.diffuseColor[1], f.diffuseColor[2]);
    m.emissiveColor.set(f.emissiveColor[0], f.emissiveColor[1], f.emissiveColor[2]);
    m.alpha = 1 - f.transparency;
    if (m.alpha < 0.999) { m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true; }
  }
  glassMaterial(spec) {
    const P = WGSL_PORTS[spec.port], tag = 'port-' + spec.port;
    const sv = tag + 'VertexShader', sf = tag + 'FragmentShader';
    BABYLON.ShaderStore.ShadersStoreWGSL[sv] = P.vs; BABYLON.ShaderStore.ShadersStoreWGSL[sf] = P.fs;
    const m = new BABYLON.ShaderMaterial('glass-' + spec.cs.def + (spec.back ? '-back' : '-front'), this.scene, { vertex: tag, fragment: tag },
      { attributes: P.attrs, uniforms: ['worldView', 'projection', ...P.uniforms], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
    m.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
    m.backFaceCulling = true; m.cullBackFaces = !spec.back;     // pass one draws the back faces (front faces culled), pass two the front faces
    m.disableDepthWrite = true; m.needDepthPrePass = false;
    m.setFloat('passMode', spec.back ? 0 : 1);
    this.refreshShader(m, spec.cs);
    spec.mat = m;
    return m;
  }
  refreshShader(m, cs) {
    for (const [name, def] of Object.entries(cs.fdefs)) {
      if (['language', 'parts', 'activate', 'isSelected', 'isValid'].includes(name)) continue;
      const v = cs.f[name], t = def[0];
      try {
        if (t === 'SFFloat' || t === 'SFTime' || t === 'SFDouble') m.setFloat(name, +v);
        else if (t === 'SFInt32') m.setFloat(name, +v);
        else if (t === 'SFBool') m.setFloat(name, v ? 1 : 0);
        else if (t === 'SFColor' || t === 'SFVec3f') m.setVector3(name, new BABYLON.Vector3(v[0], v[1], v[2]));
      } catch (e) { /* uniform not in this port */ }
    }
  }

  /* ------------------------------------------------------------- wide lines */
  makeRibbon(shape, g, spec, name) {
    const f = g.f, P = f.coord && f.coord.f.point, C = f.color && f.color.f.color, ci = f.coordIndex;
    if (!P) return null;
    // one quad per segment: 4 corners (end 0 / end 1 x side -1 / +1), attribute "other" = the far end
    const pos = [], oth = [], col = [], uv = [], idx = [];
    let line = [];
    const flush = () => {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1], base = pos.length / 3;
        const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
        const ca = C ? [C[a * 3], C[a * 3 + 1], C[a * 3 + 2]] : [1, 1, 1], cb = C ? [C[b * 3], C[b * 3 + 1], C[b * 3 + 2]] : [1, 1, 1];
        for (const [p, o, c, side] of [[pa, pb, ca, -1], [pa, pb, ca, 1], [pb, pa, cb, -1], [pb, pa, cb, 1]]) { pos.push(...p); oth.push(...o); col.push(...c, 1); uv.push(0, side); }
        idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
      line = [];
    };
    for (let i = 0; i < ci.length; i++) { if (ci[i] < 0) flush(); else line.push(ci[i]); }
    flush();
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.colors = col; vd.uvs = uv;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('other', oth, false, 3);
    const tag = 'ribbon';
    BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'VertexShader'] = VERT_RIBBON; BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'FragmentShader'] = FRAG_RIBBON;
    const m = new BABYLON.ShaderMaterial('ribbon-' + shape.id, this.scene, { vertex: tag, fragment: tag },
      { attributes: ['position', 'other', 'color', 'uv'], uniforms: ['worldViewProjection', 'viewport', 'widthPx', 'tint', 'alpha'], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
    m.alphaMode = BABYLON.Engine.ALPHA_COMBINE; m.backFaceCulling = false; m.disableDepthWrite = true;
    mesh.material = m; spec.mat2 = m; mesh.metadata = { ribbon: true };
    mesh.alphaIndex = 5;
    m._hasColor = !!C;
    this.refreshRibbon(m, spec);
    (this.ribbons ||= []).push(m);
    return mesh;
  }
  refreshRibbon(m, spec) {
    const tp = spec.mat ? spec.mat.f.transparency : 0, lw = spec.lp && spec.lp.f.applied ? (spec.lp.f.linewidthScaleFactor || 1) : 1;
    m.setFloat('alpha', 1 - tp); m.setFloat('widthPx', lw); m._lw = lw;
    this.setRibbonTint(m, spec.mat);
  }
  // a line set with no Color node is drawn in the Material's emissiveColor (19775-1 lighting of lines); with a Color node the per-vertex colours are used as they are
  setRibbonTint(m, mat) { const e = !m._hasColor && mat ? mat.f.emissiveColor : [1, 1, 1]; m.setVector3('tint', new BABYLON.Vector3(e[0], e[1], e[2])); }

  /* ------------------------------------------------------------------ text */
  makeText(shape, g, spec, name) {
    const f = g.f, lines = f.string.length ? f.string : [''];
    const fs = f.fontStyle ? f.fontStyle.f : { size: 1, justify: ['BEGIN'], family: ['SERIF'], spacing: 1, style: 'PLAIN' };
    const em = 56, fam = /SANS/i.test(String(fs.family[0])) ? 'Inter, Helvetica, Arial, sans-serif' : /TYPEWRITER/i.test(String(fs.family[0])) ? 'monospace' : 'Georgia, serif';
    const style = /BOLD/.test(fs.style) ? 'bold ' : '';
    const cv = document.createElement('canvas'), cx = cv.getContext('2d');
    cx.font = style + em + 'px ' + fam;
    const widths = lines.map((l) => cx.measureText(l).width), W = Math.max(8, Math.ceil(Math.max(...widths)) + 16), lh = Math.ceil(em * 1.25 * fs.spacing), H = lh * lines.length + 8;
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d'); c2.font = style + em + 'px ' + fam; c2.fillStyle = '#fff'; c2.strokeStyle = '#fff'; c2.lineWidth = em * 0.035; c2.lineJoin = 'round'; c2.textBaseline = 'middle'; // a light stroke keeps small labels from fading when the texture is minified
    lines.forEach((l, i) => { const x = (W - widths[i]) / 2, y = 4 + lh * i + lh / 2; c2.strokeText(l, x, y); c2.fillText(l, x, y); });
    const dt = new BABYLON.DynamicTexture('txt-' + name, cv, this.scene, true); dt.hasAlpha = true; dt.anisotropicFilteringLevel = 8; dt.update(true);
    const sc = fs.size / em, w = W * sc, h = H * sc;
    const jm = String(fs.justify[0] || 'BEGIN').toUpperCase(), jm2 = String((fs.justify[1] || 'FIRST')).toUpperCase();
    const x0 = jm === 'MIDDLE' ? -w / 2 : jm === 'END' ? -w : 0, y0 = jm2 === 'MIDDLE' ? -h / 2 : jm2 === 'END' ? 0 : -h;
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = [x0, y0, 0, x0 + w, y0, 0, x0 + w, y0 + h, 0, x0, y0 + h, 0]; vd.indices = [0, 1, 2, 0, 2, 3]; vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vd.applyToMesh(mesh, false);
    const m = new BABYLON.StandardMaterial('text-' + name, this.scene);
    m.disableLighting = true; m.backFaceCulling = false; m.diffuseTexture = dt; m.useAlphaFromDiffuseTexture = true; m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    m.diffuseColor.set(0, 0, 0); m.specularColor.set(0, 0, 0); m.disableDepthWrite = true; // unlit: the X3D emissiveColor is the colour, the glyph texture only shapes it
    const mat = spec.mat; if (mat) { const e = mat.f.emissiveColor; m.emissiveColor.set(e[0], e[1], e[2]); }
    mesh.material = m; mesh.alphaIndex = 6; mesh.metadata = { text: true };
    return mesh;
  }

  /* ------------------------------------------------------------ lights and look */
  buildLights() {
    this.lights.forEach((l) => l.dispose()); this.lights = [];
    for (const n of this.lightNodes || []) {
      if (n.type === 'DirectionalLight') {
        const l = new BABYLON.DirectionalLight(n.def || 'dir', new BABYLON.Vector3(0, -1, 0), this.scene);
        l.node = n; this.lights.push(l); this.refreshLight(l);
      } else if (n.type === 'EnvironmentLight') this.buildEnvironment(n);
    }
  }
  refreshLight(l) {
    const n = l.node, c = n.f.color;
    l.diffuse = new BABYLON.Color3(c[0], c[1], c[2]); l.specular = l.diffuse.clone();
    const d = n.f.direction, fl = this.opts.lightFlip || 'none';
    l.direction = fl === 'neg' ? new BABYLON.Vector3(-d[0], -d[1], -d[2]) : fl === 'z' ? new BABYLON.Vector3(d[0], d[1], -d[2]) : fl === 'x' ? new BABYLON.Vector3(-d[0], d[1], d[2]) : new BABYLON.Vector3(d[0], d[1], d[2]);
    l.intensity = n.f.intensity * (this.opts.lightScale ?? 1); l.setEnabled(n.f.on !== false);
  }
  buildEnvironment(n) {
    const t = n.f.specularTexture; if (!t) return;
    const faces = (this.opts.envOrder || 'right,top,front,left,bottom,back').split(',').map((s) => s + 'Texture'); // +x +y +z -x -y -z as Babylon orders them
    const urls = faces.map((k) => (t.f[k] ? this.resolve(t.f[k].f.url[0], this.baseUrl) : null));
    if (urls.some((u) => !u)) { this.note('EnvironmentLight needs all six faces'); return; }
    const cube = new BABYLON.CubeTexture('', this.scene, null, false, urls, null, (e) => this.note('cube map: ' + e), BABYLON.Constants.TEXTUREFORMAT_RGBA, false, '.png');
    cube.gammaSpace = true;
    const noDiffuse = () => { if (this.opts.envDiffuse === false) { try { cube.sphericalPolynomial = null; cube.irradianceTexture = null; } catch (e) { /* not set */ } } };
    cube.onLoadObservable.addOnce(() => { noDiffuse(); try { const hf = new BABYLON.HDRFiltering(this.engine); hf.prefilter(cube).then(noDiffuse).catch((e) => this.note('prefilter: ' + e)); } catch (e) { this.note('prefilter: ' + e); } });
    this.env = cube; this.envNode = n;
    this.scene.environmentTexture = cube; this.scene.environmentIntensity = n.f.intensity * (this.opts.envScale ?? 1);
  }
  applyBackground() {
    const bg = this.world.nodes.find((x) => x.type === 'Background'); if (!bg) return;
    const c = bg.f.skyColor[0] || [0, 0, 0];
    const last = bg.f.skyColor[bg.f.skyColor.length - 1] || c;
    // the sky is a three-stop vertical gradient the page keeps dark; its horizon colour fills the frame, which is the visible part at EXAMINE framing
    const g = bg.f.groundColor && bg.f.groundColor.length ? bg.f.groundColor[bg.f.groundColor.length - 1] : last;
    this.scene.clearColor = new BABYLON.Color4((last[0] + g[0]) / 2 * 0.6 + c[0] * 0.4, (last[1] + g[1]) / 2 * 0.6 + c[1] * 0.4, (last[2] + g[2]) / 2 * 0.6 + c[2] * 0.4, 1);
  }
  applyClip() {
    const n = (this.clipNodes || [])[0];
    this.clipActive = !!(n && n.f.enabled);
  }

  /* --------------------------------------------------------------- changes */
  changed(node, field) {
    const t = node.type;
    if (t === 'Switch' && field === 'whichChoice') this.applySwitch(node);
    else if (t === 'Transform') { const r = this.rec.get(node.id); if (r && r.tn) this.applyTransform(node, r.tn); }
    else if ((t === 'Group' || t === 'Switch' || t === 'Billboard' || t === 'Transform') && field === 'children') this.rebuildGroup(node);
    else if (t === 'Billboard' && field === 'axisOfRotation') { /* rare */ }
    else if (t === 'ComposedShader') { for (const m of this.meshesOf.get(node.id) || []) if (m.material && m.material.setFloat) this.refreshShader(m.material, node); }
    else if (t === 'PhysicalMaterial') { for (const m of this.meshesOf.get(node.id) || []) if (m.material instanceof BABYLON.PBRMaterial) this.refreshPBR(m.material, node); }
    else if (t === 'Material') { for (const m of this.meshesOf.get(node.id) || []) { if (m.material instanceof BABYLON.StandardMaterial) { if (m.metadata && m.metadata.text) { const e = node.f.emissiveColor; m.material.emissiveColor.set(e[0], e[1], e[2]); } else this.refreshPhong(m.material, node); } else if (m.metadata && m.metadata.ribbon) this.refreshRibbonFromMat(m, node); } }
    else if (t === 'LineProperties') { for (const m of this.meshesOf.get(node.id) || []) this.refreshRibbonFromLp(m, node); }
    else if (t === 'Color' || t === 'Coordinate' || t === 'Normal') this.geometryChanged(node);
    else if (t === 'DirectionalLight') { const l = this.lights.find((x) => x.node === node); if (l) this.refreshLight(l); }
    else if (t === 'EnvironmentLight') { if (field === 'intensity') this.scene.environmentIntensity = node.f.intensity * (this.opts.envScale ?? 1); }
    else if (t === 'Background') this.applyBackground();
    else if (t === 'ClipPlane') this.applyClip();
    else if (t === 'Viewpoint') this.viewpointChanged(node, field);
  }
  refreshRibbonFromMat(mesh, matNode) { mesh.material.setFloat('alpha', 1 - matNode.f.transparency); this.setRibbonTint(mesh.material, matNode); }
  refreshRibbonFromLp(mesh, lp) { const lw = lp.f.applied ? (lp.f.linewidthScaleFactor || 1) : 1; mesh.material.setFloat('widthPx', lw); mesh.material._lw = lw; }
  geometryChanged(n) {
    // Color or Coordinate inside a geometry: refresh every geometry that holds it
    for (const x of this.world.nodes) {
      if ((x.type === 'IndexedTriangleSet' || x.type === 'IndexedFaceSet' || x.type === 'IndexedLineSet') && (x.f.color === n || x.f.coord === n || x.f.normal === n)) {
        this.geoCache.delete(x.id);
        for (const key of [x.id, x.id + 'c']) { const c = this.geoCache.get(key); if (c) { c.geo.dispose(); this.geoCache.delete(key); } }
        for (const r of this.rec.values()) if (r.node && r.node.type === 'Shape' && r.node.f.geometry === x) { if (r.tn) { this.rebuildShapeIn(r); } }
      }
    }
  }
  rebuildShapeIn(r) {
    const shape = r.node, parent = r.tn.parent, enabled = r.tn.isEnabled(false);
    r.meshes.forEach((m) => m.dispose(false, true)); r.tn.dispose();
    const nr = this.buildShape(shape, parent, r.chain.slice(1));
    // keep the parent's record pointing at the new shape record
    for (const pr of this.rec.values()) if (pr.kids) { const i = pr.kids.indexOf(r); if (i >= 0) pr.kids[i] = nr; }
    if (nr.tn) nr.tn.setEnabled(enabled);
  }
  rebuildGroup(node) {
    const r = this.rec.get(node.id); if (!r) return;
    for (const k of r.kids) this.disposeRec(k);
    r.kids = [];
    for (const c of node.f.children) r.kids.push(this.build(c, r.tn, r.chain));
    if (node.type === 'Switch') this.applySwitch(node);
  }
  disposeRec(k) {
    if (!k) return;
    if (k.kids) k.kids.forEach((x) => this.disposeRec(x));
    if (k.meshes) k.meshes.forEach((m) => m.dispose(false, true));
    if (k.tn && k.node && k.node.type !== 'Viewpoint') k.tn.dispose();
    if (k.node) this.rec.delete(k.node.id);
  }
  /* page-created nodes (cameras, sensors) enter through MFNode.push: sensors and viewpoints are scene state, groups are drawn */
  adopt(node, parentNode) {
    const pr = parentNode ? this.rec.get(parentNode.id) : null;
    const parentTN = pr ? pr.tn : this.root, chain = pr ? pr.chain : [];
    const cr = this.build(node, parentTN, chain);
    if (pr && pr.kids && cr) pr.kids.push(cr);
    return cr;
  }
}

/* camera (X3D Viewpoint, EXAMINE navigation), pointer sensors, frame loop: the second half of Body */
Object.assign(Body.prototype, {
  /* ----------------------------------------------------------- camera pose */
  vpPose(vp) {
    const f = vp.f, par = (this.vpParent && this.vpParent.get(vp)) || null;
    let pos = f.position.slice(), q = R.quat.fromAxisAngle(f.orientation, f.orientation[3]), center = f.centerOfRotation.slice();
    if (par && par.computeWorldMatrix) {
      const M = par.computeWorldMatrix(true);
      const P = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(...pos), M), C = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(...center), M);
      const sc = new BABYLON.Vector3(), rq = new BABYLON.Quaternion(), tr = new BABYLON.Vector3(); M.decompose(sc, rq, tr);
      pos = [P.x, P.y, P.z]; center = [C.x, C.y, C.z]; q = R.quat.mul([rq.x, rq.y, rq.z, rq.w], q);
    }
    return { pos, q: R.quat.norm(q), center, fov: f.fieldOfView };
  },
  applyCamera() {
    const c = this.cam, p = this.pose;
    const fwd = R.quat.rotate(p.q, [0, 0, -1]), up = R.quat.rotate(p.q, [0, 1, 0]);
    c.position.set(p.pos[0], p.pos[1], p.pos[2]);
    c.upVector = new BABYLON.Vector3(up[0], up[1], up[2]);
    c.setTarget(new BABYLON.Vector3(p.pos[0] + fwd[0], p.pos[1] + fwd[1], p.pos[2] + fwd[2]));
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1, aspect = w / h;
    // X3D fieldOfView is the angle across the SMALLER side of the view
    c.fov = aspect >= 1 ? p.fov : 2 * Math.atan(Math.tan(p.fov / 2) / aspect);
    c.fovMode = BABYLON.Camera.FOVMODE_VERTICAL_FIXED;
    const d = Math.hypot(p.pos[0] - p.center[0], p.pos[1] - p.center[1], p.pos[2] - p.center[2]);
    c.minZ = Math.max(0.3, Math.min(2, d * 0.004)); c.maxZ = Math.max(2000, d * 12);
  },
  bindViewpoint(vp, on) {
    if (!on) { vp.f.isBound = false; return; }
    const prev = this.bound; if (prev && prev !== vp) { prev.f.isBound = false; R.events.emit(prev, 'isBound', false); }
    this.bound = vp; vp.f.isBound = true; R.events.emit(vp, 'isBound', true);
    vp.f.bindTime = (performance.timeOrigin + performance.now()) / 1000;
    const nav = this.world && this.world.nodes.find((n) => n.type === 'NavigationInfo');
    const tt = nav ? String(nav.f.transitionType[0] || 'LINEAR').toUpperCase() : 'LINEAR', dur = nav ? Math.max(nav.f.transitionTime || 1, 0.05) : 1;
    const to = this.vpPose(vp);
    if (!prev || tt === 'TELEPORT' || !this.started) { this.pose = to; this.tr = null; this.started = true; this.applyCamera(); return; }
    this.tr = { from: { pos: this.pose.pos.slice(), q: this.pose.q.slice(), center: this.pose.center.slice(), fov: this.pose.fov }, to, t0: performance.now(), dur: dur * 1000 };
  },
  viewpointChanged(vp, field) {
    if (vp !== this.bound) return;
    const to = this.vpPose(vp);
    if (field === 'fieldOfView') { if (this.tr) this.tr.to.fov = to.fov; else { this.pose.fov = to.fov; this.applyCamera(); } }
    else if (['position', 'orientation', 'centerOfRotation'].includes(field)) { this.pose = to; this.tr = null; this.applyCamera(); }
  },
  stepTransition() {
    const t = this.tr; if (!t) return;
    let s = (performance.now() - t.t0) / t.dur;
    if (s >= 1) { this.pose = { pos: t.to.pos.slice(), q: t.to.q.slice(), center: t.to.center.slice(), fov: t.to.fov }; this.tr = null; this.applyCamera(); return; }
    const e = s * s * (3 - 2 * s), L = (a, b) => a + (b - a) * e;
    this.pose = {
      pos: [0, 1, 2].map((i) => L(t.from.pos[i], t.to.pos[i])), center: [0, 1, 2].map((i) => L(t.from.center[i], t.to.center[i])),
      q: R.quat.slerp(t.from.q, t.to.q, e), fov: L(t.from.fov, t.to.fov),
    };
    this.applyCamera();
  },
  userMoved() { if (this.tr) { this.pose.fov = this.tr.to.fov; this.tr = null; } },
  userPosition() { const p = this.pose.pos; return { x: p[0], y: p[1], z: p[2] }; },

  /* --------------------------------------------------------------- input */
  setupInput() {
    const cv = this.canvas, st = this.ptr = { down: false, x: 0, y: 0, sx: 0, sy: 0, t0: 0, moved: 0, button: 0, pts: new Map(), pinch: 0, shift: false, over: null };
    cv.style.touchAction = 'none';
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); st.pts.set(e.pointerId, [e.clientX, e.clientY]);
      st.down = true; st.x = st.sx = e.clientX; st.y = st.sy = e.clientY; st.t0 = performance.now(); st.moved = 0; st.button = e.button; st.shift = e.shiftKey;
      if (st.pts.size === 2) { const [a, b] = [...st.pts.values()]; st.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      this.userMoved();
    });
    cv.addEventListener('pointermove', (e) => {
      st.cx = e.clientX; st.cy = e.clientY;
      if (st.pts.has(e.pointerId)) st.pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (st.down && st.pts.size === 2) {
        const [a, b] = [...st.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (st.pinch > 0) this.zoom(st.pinch / d); st.pinch = d; st.moved += 10; return;
      }
      if (st.down) {
        const dx = e.clientX - st.x, dy = e.clientY - st.y; st.x = e.clientX; st.y = e.clientY; st.moved += Math.abs(dx) + Math.abs(dy);
        if (st.button === 2 || st.shift || st.button === 1) this.pan(dx, dy); else this.orbit(dx, dy);
        this.userMoved();
      }
      this.queuePick(e.clientX, e.clientY);
    });
    const up = (e) => {
      st.pts.delete(e.pointerId);
      if (!st.down) return;
      if (st.pts.size === 0) {
        st.down = false;
        if (st.moved < 6 && performance.now() - st.t0 < 600 && e.type === 'pointerup') this.click(e.clientX, e.clientY);
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.setOver([], null); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.userMoved(); this.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 240) * 0.0012)); }, { passive: false });
  },
  orbit(dx, dy) {
    const p = this.pose, k = 0.0065;
    const up = R.quat.rotate(p.q, [0, 1, 0]), right = R.quat.rotate(p.q, [1, 0, 0]);
    const dq = R.quat.norm(R.quat.mul(R.quat.fromAxisAngle(right, -dy * k), R.quat.fromAxisAngle(up, -dx * k)));
    const rel = R.v3.sub(p.pos, p.center), r2 = R.quat.rotate(dq, rel);
    p.pos = R.v3.add(p.center, r2); p.q = R.quat.norm(R.quat.mul(dq, p.q));
    this.applyCamera();
  },
  pan(dx, dy) {
    const p = this.pose, d = Math.max(R.v3.len(R.v3.sub(p.pos, p.center)), 1), s = d * 0.0016 * Math.tan(p.fov / 2) * 2 / 0.9;
    const up = R.quat.rotate(p.q, [0, 1, 0]), right = R.quat.rotate(p.q, [1, 0, 0]);
    const t = R.v3.add(R.v3.scale(right, -dx * s), R.v3.scale(up, dy * s));
    p.pos = R.v3.add(p.pos, t); p.center = R.v3.add(p.center, t); this.applyCamera();
  },
  zoom(f) {
    const p = this.pose, rel = R.v3.sub(p.pos, p.center), d = R.v3.len(rel);
    if (d < 1e-3) { p.fov = R.clamp(p.fov * f, 0.1, 2.4); this.applyCamera(); return; }
    const nd = R.clamp(d * f, 3, 2500); p.pos = R.v3.add(p.center, R.v3.scale(rel, nd / d)); this.applyCamera();
  },

  /* --------------------------------------------------------- pointer sensors */
  queuePick(x, y) {
    this.pickAt = [x, y];
    if (this.pickQueued) return; this.pickQueued = true;
    requestAnimationFrame(() => { this.pickQueued = false; if (this.pickAt) this.doPick(...this.pickAt); });
  },
  pickMesh(x, y) {
    const r = this.canvas.getBoundingClientRect(), sx = this.engine.getRenderWidth() / r.width, sy = this.engine.getRenderHeight() / r.height;
    return this.scene.pick((x - r.left) * sx, (y - r.top) * sy, (m) => m.isPickable && m.isEnabled() && m.isVisible && m.metadata && m.metadata.pick);
  },
  sensorsFor(mesh) {
    const chain = (mesh.metadata && mesh.metadata.chain) || [];
    for (const g of chain) {
      const ts = (g.f.children || []).filter((c) => c.type === 'TouchSensor' && c.f.enabled);
      if (ts.length) return ts.map((t) => ({ node: t, group: g }));
    }
    return [];
  },
  doPick(x, y) {
    if (this.ptr.down) return;
    const hit = this.pickMesh(x, y);
    if (!hit || !hit.hit) { this.setOver([], null); return; }
    const sens = this.sensorsFor(hit.pickedMesh);
    this.lastHit = hit;
    this.setOver(sens, hit);
  },
  localPoint(group, world) {
    const r = this.rec.get(group.id), M = r && r.tn ? r.tn.computeWorldMatrix(true) : BABYLON.Matrix.Identity();
    const inv = M.clone().invert();
    const p = BABYLON.Vector3.TransformCoordinates(world, inv);
    return [p.x, p.y, p.z];
  },
  setOver(sens, hit) {
    const old = this.ptr.over || [], now = sens.map((s) => s.node);
    for (const n of old) if (!now.includes(n)) { R.hooks.fire(n, 'isOver', false); }
    for (const s of sens) {
      if (!old.includes(s.node)) R.hooks.fire(s.node, 'isOver', true);
      if (hit) R.hooks.fire(s.node, 'hitPoint_changed', this.localPoint(s.group, hit.pickedPoint));
    }
    this.ptr.over = now;
    this.canvas.classList.toggle('is-over-sensor', now.length > 0);
  },
  click(x, y) {
    const hit = this.pickMesh(x, y); if (!hit || !hit.hit) return;
    const sens = this.sensorsFor(hit.pickedMesh), now = (performance.timeOrigin + performance.now()) / 1000;
    for (const s of sens) {
      R.hooks.fire(s.node, 'hitPoint_changed', this.localPoint(s.group, hit.pickedPoint));
      R.hooks.fire(s.node, 'isActive', true); R.hooks.fire(s.node, 'isActive', false); R.hooks.fire(s.node, 'touchTime', now);
    }
  },

  /* ---------------------------------------------------------------- frame */
  frame() {
    const now = (performance.timeOrigin + performance.now()) / 1000;
    if (this.world) {
      R.events.begin(now);
      for (const n of this.timeSensors || []) R.tickTimeSensor(n, now);
      R.events.drain();
      this.stepTransition();
      const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
      for (const m of this.ribbons || []) { if (m.isDisposed && m.isDisposed()) continue; try { m.setVector2('viewport', new BABYLON.Vector2(w, h)); m.setFloat('widthPx', (m._lw || 1) * (w / (this.canvas.clientWidth || w))); } catch (e) { /* not ready */ } }
      this.updateClip();
      this.updateBillboards();
    }
    this.scene.render();
    this.stats.frames++;
    this.frameTimes.push(performance.now()); if (this.frameTimes.length > 30) this.frameTimes.shift();
    if (this.frameWaiters && this.frameWaiters.length) { const w = this.frameWaiters; this.frameWaiters = []; w.forEach((f) => f()); }
    if (this.opts.onFrame) this.opts.onFrame(this);
  },
  fps() { const t = this.frameTimes; return t.length > 2 ? 1000 * (t.length - 1) / (t[t.length - 1] - t[0]) : 0; },
  updateBillboards() {
    // 19775-1 Billboard: with axisOfRotation 0 0 0 the node's +Z points at the eye and its +Y follows the viewer's up; with an axis it turns about that axis only
    const list = this.billboards; if (!list || !list.length) return;
    const cam = this.scene.activeCamera; if (!cam) return;
    const V = BABYLON.Vector3, T = this._bb || (this._bb = { inv: new BABYLON.Matrix(), m: new BABYLON.Matrix() });
    const eye = cam.globalPosition, up = cam.getDirection(V.Up());
    for (let i = list.length - 1; i >= 0; i--) {
      const tn = list[i].tn;
      if (tn.isDisposed()) { list.splice(i, 1); continue; }
      if (!tn.isEnabled(true)) continue;
      const pw = tn.parent ? tn.parent.computeWorldMatrix(true) : BABYLON.Matrix.IdentityReadOnly;
      pw.invertToRef(T.inv);
      const d = V.TransformCoordinates(eye, T.inv);
      if (d.lengthSquared() < 1e-12) continue;
      d.normalize();
      const ax = list[i].node.f.axisOfRotation;
      if (!ax[0] && !ax[1] && !ax[2]) {
        const u = V.TransformNormal(up, T.inv).normalize();
        let x = V.Cross(u, d);
        if (x.lengthSquared() < 1e-10) x = V.Cross(V.Right(), d);
        x.normalize();
        const y = V.Cross(d, x);
        BABYLON.Matrix.FromValuesToRef(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, d.x, d.y, d.z, 0, 0, 0, 0, 1, T.m);
        tn.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(T.m);
      } else {
        const a = new V(ax[0], ax[1], ax[2]).normalize();
        const p = d.subtract(a.scale(V.Dot(a, d)));
        if (p.lengthSquared() < 1e-10) { tn.rotationQuaternion = BABYLON.Quaternion.Identity(); continue; }
        p.normalize();
        const ang = Math.atan2(V.Dot(V.Cross(new V(0, 0, 1), p), a), p.z);
        tn.rotationQuaternion = new BABYLON.Quaternion(...R.quat.fromAxisAngle([a.x, a.y, a.z], ang));
      }
    }
  },
  updateClip() {
    // 19775-1 ClipPlane: it clips the shapes in its own Group. The half space where a x + b y + c z + d is below zero is clipped; Babylon clips where the plane value is above zero.
    const list = this.clipMeshes || [];
    for (const it of list) {
      const m = it.mesh, mat = m.material; if (!mat || m.isDisposed()) continue;
      const n = it.clip, on = !!n.f.enabled;
      if (!on) { if (mat.clipPlane) mat.clipPlane = null; continue; }
      const p = n.f.plane, gr = this.rec.get(it.group.id), pr = gr && gr.tn ? gr.tn.computeWorldMatrix(true) : BABYLON.Matrix.Identity();
      const pl = BABYLON.Plane.FromPositionAndNormal(BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-p[3] * p[0], -p[3] * p[1], -p[3] * p[2]), pr),
        BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(-p[0], -p[1], -p[2]), pr));
      mat.clipPlane = pl;
    }
  },
});

/* ManifoldBody: Babylon WebGPU body for the Manifold of Emotion. Extends the brain body (Body, body-cam.js): camera, event loop and Viewpoint binding are reused.
   The scene's seven ComposedShaders are drawn by their WGSL ports (manifold-wgsl.js); everything around them is Babylon's own machinery:
   DefaultRenderingPipeline (4x MSAA, HDR, bloom, vignette, grain, chromatic aberration), hardware scaling for the quality tiers, onBeforeRender for uniform and
   vertex-buffer updates, EngineInstrumentation for the opt-in timing panel. The page's own app.js runs unchanged through the SAI shim. */

class ManifoldBody extends Body {
  constructor(canvas, opts) {
    super(canvas, opts);
    this.mf = { mats: new Map(), dirtyShaders: new Set(), dirtyGeo: new Set(), geoOf: new Map(), gridIdx: new Map(), pipeline: null, look: { on: true, glow: 0.65, grain: true }, notes: [] };
  }

  /* adapters are tried as in PR #14: plain first (it is the one that works on a machine whose hints are blocklisted), then the hints */
  async pickAdapter() {
    const tries = [{}, { powerPreference: 'high-performance' }, { powerPreference: 'low-power' }, { forceFallbackAdapter: true }];
    for (const o of tries) {
      const a = await navigator.gpu.requestAdapter(o).catch(() => null);
      if (a) return { adapter: a, hint: o };
    }
    return null;
  }

  async init() {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const got = await this.pickAdapter();
    if (!got) throw new Error('WebGPU is available but the browser returned no adapter (requestAdapter: plain, high-performance, low-power and software all null).');
    this.adapter = got.adapter;
    const info = got.adapter.info || {};
    this.adapterInfo = { vendor: info.vendor, architecture: info.architecture, description: info.description, device: info.device, hint: JSON.stringify(got.hint), features: [...(got.adapter.features || [])].includes('timestamp-query') ? 'timestamp-query' : '' };
    const e = this.engine = new BABYLON.WebGPUEngine(this.canvas, { antialias: false, adaptToDeviceRatio: true, powerPreference: got.hint.powerPreference, forceFallbackAdapter: !!got.hint.forceFallbackAdapter, stencil: false });
    await e.initAsync();
    const s = this.scene = new BABYLON.Scene(e);
    s.useRightHandedSystem = true;
    s.clearColor = new BABYLON.Color4(0.008, 0.013, 0.025, 1);
    s.skipPointerMovePicking = true; s.autoClear = true; s.autoClearDepthAndStencil = true;
    this.setTone('none');                                       // the shaders output display-referred colour: Babylon must not tone map on top
    const c = this.cam = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, 10), s);
    c.minZ = 0.5; c.maxZ = 4000; c.inputs.clear();
    this.lights = [];
    this.buildPipeline();
    s.onBeforeRenderObservable.add(() => this.flush());
    new ResizeObserver(() => { e.resize(); this.applyCamera(); }).observe(this.canvas);
    e.runRenderLoop(() => this.frame());
    return this;
  }
  setupInput() { /* the page (app.js) owns orbit, pan, zoom and click-to-perturb */ }

  /* ---------------------------------------------------------------- Babylon's own post chain, replacing the old 2D-canvas lens (law 39: switchable, "As authored" = off) */
  buildPipeline() {
    const p = new BABYLON.DefaultRenderingPipeline('mf-look', true, this.scene, [this.cam]);
    p.samples = 4; p.fxaaEnabled = false;
    p.bloomEnabled = true; p.bloomThreshold = 0.55; p.bloomWeight = 0.45; p.bloomKernel = 72; p.bloomScale = 0.6;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = false; ip.exposure = 1; ip.contrast = 1;
    p.imageProcessing.vignetteEnabled = true; p.imageProcessing.vignetteWeight = 1.6; p.imageProcessing.vignetteStretch = 0.1; p.imageProcessing.vignetteCameraFov = 0.8;
    p.imageProcessing.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
    p.grainEnabled = true; p.grain.intensity = 6; p.grain.animated = true;
    p.chromaticAberrationEnabled = true; p.chromaticAberration.aberrationAmount = 14; p.chromaticAberration.radialIntensity = 0.8;
    this.mf.pipeline = p;
    this.fixOutputSpace();
  }
  /* the pipeline's last pass converts linear to gamma by default; the shaders already output gamma-encoded, display-referred colour, so that conversion is switched off */
  fixOutputSpace() {
    const pp = (this.cam._postProcesses || []).find((x) => x && x.name === 'imageProcessing');
    if (pp && pp.fromLinearSpace) pp.fromLinearSpace = false;
  }
  /* the page's lens switch, glow slider and film switch drive the pipeline each frame */
  applyLook() {
    const p = this.mf.pipeline, L = this.mf.look; if (!p) return;
    const on = L.on;
    p.bloomEnabled = on; p.bloomWeight = 0.28 + 0.55 * L.glow;
    p.grainEnabled = on && L.grain; p.chromaticAberrationEnabled = on;
    p.imageProcessing.vignetteEnabled = on;
  }
  browserOption(k, v) { if (k === 'Multisampling' && this.mf.pipeline) this.mf.pipeline.samples = Math.max(1, Math.min(4, v | 0)); }

  /* ---------------------------------------------------------------- scene */
  setWorld(world, baseUrl, resolve) {
    super.setWorld(world, baseUrl, resolve);
    const vp = world.nodes.find((n) => n.type === 'Viewpoint');
    if (vp) R.receive(vp, 'set_bind', true);                    // X_ITE binds the first Viewpoint by itself
  }

  materialsFor(shape, g, app) {
    const cs = app && app.f.shaders.find((s) => s.type === 'ComposedShader');
    const port = cs && MF_BY_HASH[this.shaderKey(cs)];
    if (port) return [{ kind: 'mf', port, cs, deps: [cs, g, g.f.coord, g.f.color, ...(g.f.attrib || [])].filter(Boolean) }];
    if (cs) this.note('ComposedShader ' + (cs.def || '') + ' has no WGSL port (hash ' + this.shaderKey(cs) + '): this layer is not drawn');
    return null;                                                // law 40: say so, never substitute silently
  }

  makeMesh(shape, g, spec, i) {
    if (spec.kind !== 'mf') return super.makeMesh(shape, g, spec, i);
    const P = MF_PORTS[spec.port];
    const mesh = new BABYLON.Mesh((shape.def || 'shape') + '-' + spec.port, this.scene);
    this.mf.geoOf.set(mesh, { g, P });
    if (!this.fillMesh(mesh, g, P)) { mesh.dispose(); return null; }
    mesh.alwaysSelectAsActiveMesh = true;                       // the shaders move vertices far outside the rest bounding box
    mesh.isPickable = false;
    mesh.material = this.mfMaterial(spec, P);
    mesh.alphaIndex = P.order;
    return mesh;
  }

  /* ---------------------------------------------------------------- geometry: ElevationGrid, (Indexed)TriangleSet with vertex attributes, PointSet as sprite quads */
  fillMesh(mesh, g, P) {
    const VB = BABYLON.VertexBuffer, f = g.f;
    let pos, idx, nv, extra = [];   // custom kinds go on AFTER the position: a geometry born from an unknown kind drops its data
    if (g.type === 'ElevationGrid') {
      const nx = f.xDimension, nz = f.zDimension; nv = nx * nz;
      if (nx < 2 || nz < 2) return false;
      pos = new Float32Array(nv * 3);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = (j * nx + i) * 3; pos[k] = i * f.xSpacing; pos[k + 1] = f.height && f.height.length ? f.height[j * nx + i] : 0; pos[k + 2] = j * f.zSpacing; }
      const key = nx + 'x' + nz; idx = this.mf.gridIdx.get(key);
      if (!idx) {
        idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let o = 0;
        for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
        this.mf.gridIdx.set(key, idx);
      }
    } else if (g.type === 'TriangleSet' || g.type === 'IndexedTriangleSet') {
      pos = f.coord && f.coord.f.point; if (!pos || pos.length < 9) return false;
      nv = pos.length / 3;
      if (g.type === 'IndexedTriangleSet' && f.index && f.index.length >= 3) idx = Uint32Array.from(f.index);
      else { idx = new Uint32Array(nv - (nv % 3)); for (let i = 0; i < idx.length; i++) idx[i] = i; }
      extra = (f.attrib || []).map((a) => [a.f.name, a.f.value, a.f.numComponents]);
    } else if (g.type === 'PointSet') {
      const Pt = f.coord && f.coord.f.point; if (!Pt || !Pt.length) return false;
      const n = Pt.length / 3, C = f.color && f.color.f.color; nv = n * 4;
      pos = new Float32Array(nv * 3); idx = new Uint32Array(n * 6);
      const corner = new Float32Array(nv * 2), col = new Float32Array(nv * 4), cs = [-1, -1, 1, -1, -1, 1, 1, 1];
      for (let p = 0; p < n; p++) {
        for (let v = 0; v < 4; v++) {
          const o = p * 4 + v;
          pos[o * 3] = Pt[p * 3]; pos[o * 3 + 1] = Pt[p * 3 + 1]; pos[o * 3 + 2] = Pt[p * 3 + 2];
          corner[o * 2] = cs[v * 2]; corner[o * 2 + 1] = cs[v * 2 + 1];
          col[o * 4] = C ? C[p * 3] : 1; col[o * 4 + 1] = C ? C[p * 3 + 1] : 1; col[o * 4 + 2] = C ? C[p * 3 + 2] : 1; col[o * 4 + 3] = 1;
        }
        idx.set([p * 4, p * 4 + 1, p * 4 + 2, p * 4 + 2, p * 4 + 1, p * 4 + 3], p * 6);
      }
      extra = [['corner', corner, 2], [VB.ColorKind, col, 4]];
    } else { this.note('manifold: geometry <' + g.type + '> is not handled'); return false; }
    mesh.setVerticesData(VB.PositionKind, pos, true, 3);
    for (const [k, d, n] of extra) mesh.setVerticesData(k, d, true, n);
    mesh.setIndices(idx, nv);
    return true;
  }

  /* ---------------------------------------------------------------- materials */
  mfMaterial(spec, P) {
    const hit = this.mf.mats.get(spec.cs.id); if (hit) return hit;
    const tag = 'mf' + spec.port, vs = MF_PRELUDE + P.vs, fs = MF_PRELUDE + P.fs;
    BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'VertexShader'] = vs; BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'FragmentShader'] = fs;
    const names = new Set(); for (const src of [vs, fs]) for (const m of src.matchAll(/\buniform\s+(\w+)\s*:/g)) names.add(m[1]);
    const m = new BABYLON.ShaderMaterial('mf-' + (spec.cs.def || spec.port), this.scene, { vertex: tag, fragment: tag },
      { attributes: P.attrs, uniforms: [...names], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: P.blend });
    m.backFaceCulling = false;                                  // ElevationGrid solid=false, ribbons and sprites are two-sided
    if (P.blend || spec.port === 'sky') m.disableDepthWrite = true;
    m._mf = { cs: spec.cs, names: [...names], port: spec.port };
    this.mf.mats.set(spec.cs.id, m);
    this.pushUniforms(m);
    return m;
  }
  pushUniforms(m) {
    const { cs, names } = m._mf, V4 = BABYLON.Vector4;
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    for (const name of names) {
      if (name === 'worldView' || name === 'projection') continue;
      if (name === 'uViewport') { m.setVector2(name, new BABYLON.Vector2(w, h)); continue; }
      const a = /^(uSources|uShape|uPulse|uAnchors)(\d)$/.exec(name);
      if (a) { const arr = cs.f[a[1]], i = +a[2] * 4; if (arr && arr.length > i + 3) m.setVector4(name, new V4(arr[i], arr[i + 1], arr[i + 2], arr[i + 3])); continue; }
      const def = cs.fdefs[name]; if (!def) continue;
      const v = cs.f[name];
      try {
        if (def[0] === 'SFFloat' || def[0] === 'SFTime' || def[0] === 'SFDouble' || def[0] === 'SFInt32') m.setFloat(name, +v);
        else if (def[0] === 'SFVec3f' || def[0] === 'SFColor') m.setVector3(name, new BABYLON.Vector3(v[0], v[1], v[2]));
        else if (def[0] === 'SFVec2f') m.setVector2(name, new BABYLON.Vector2(v[0], v[1]));
      } catch (e) { /* uniform not in this port */ }
    }
  }

  /* ---------------------------------------------------------------- changes: batched, applied once per frame before the render */
  changed(node, field) {
    const t = node.type;
    if (t === 'ComposedShader') { this.mf.dirtyShaders.add(node); return; }
    if (t === 'Coordinate' || t === 'FloatVertexAttribute' || t === 'IndexedTriangleSet' || t === 'TriangleSet' || t === 'Color' || t === 'PointSet' || t === 'ElevationGrid') {
      for (const m of this.meshesOf.get(node.id) || []) this.mf.dirtyGeo.add(m);
      return;
    }
    super.changed(node, field);
  }
  flush() {
    const L = this.mf.look, lens = document.getElementById('lensToggle'), grain = document.getElementById('grain');
    if (lens) L.on = !!lens.checked; if (grain) L.grain = !!grain.checked;
    this.applyLook(); this.fixOutputSpace();
    for (const cs of this.mf.dirtyShaders) { const m = this.mf.mats.get(cs.id); if (m) this.pushUniforms(m); }
    this.mf.dirtyShaders.clear();
    for (const mesh of this.mf.dirtyGeo) { const rec = this.mf.geoOf.get(mesh); if (rec && !mesh.isDisposed()) this.fillMesh(mesh, rec.g, rec.P); }
    this.mf.dirtyGeo.clear();
    // render size can change with the quality tier or a resize: the sprite and ribbon shaders need it
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    if (w !== this.mf.w || h !== this.mf.h) { this.mf.w = w; this.mf.h = h; for (const m of this.mf.mats.values()) this.pushUniforms(m); }
  }
}

/* A small Scene Access Interface over the reader's nodes and the Babylon body.
   It speaks the subset of X_ITE's browser API that the Neural Canvas page uses (getNamedNode, rootNodes, createNode, addRoute, createX3DFromString,
   field get/set with SFColor / SFVec3f / SFRotation / MFString values, addFieldCallback, set_bind, whichChoice, children), so the page's own code runs unchanged.
   Nothing here draws; every change goes to the body through R.hooks.changed. */

(function () {
  class SFColor { constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; } getTypeName() { return 'SFColor'; } toString() { return `${this.r} ${this.g} ${this.b}`; } }
  class SFColorRGBA { constructor(r = 0, g = 0, b = 0, a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; } getTypeName() { return 'SFColorRGBA'; } }
  class SFVec2f { constructor(x = 0, y = 0) { this.x = x; this.y = y; } getTypeName() { return 'SFVec2f'; } toString() { return `${this.x} ${this.y}`; } }
  class SFVec3f { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } getTypeName() { return 'SFVec3f'; } toString() { return `${this.x} ${this.y} ${this.z}`; } }
  class SFVec4f { constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; } getTypeName() { return 'SFVec4f'; } }
  class SFRotation { constructor(x = 0, y = 0, z = 1, angle = 0) { this.x = x; this.y = y; this.z = z; this.angle = angle; } getTypeName() { return 'SFRotation'; } toString() { return `${this.x} ${this.y} ${this.z} ${this.angle}`; } }
  class MFList extends Array { getTypeName() { return this._t; } }
  const mf = (t, a) => { const l = new MFList(); l._t = t; for (const x of a) l.push(x); return l; };
  function MFColor(...a) { return mf('MFColor', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFColorRGBA(...a) { return mf('MFColorRGBA', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFVec3f(...a) { return mf('MFVec3f', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFVec2f(...a) { return mf('MFVec2f', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFFloat(...a) { return mf('MFFloat', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFInt32(...a) { return mf('MFInt32', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFString(...a) { return mf('MFString', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }
  function MFNode(...a) { return mf('MFNode', a.length === 1 && Array.isArray(a[0]) ? a[0] : a); }

  const wrappers = new WeakMap(), rawOf = new WeakMap();
  let BODY = null, WORLD = null, MAINSCENE = null;

  const isTyped = (v) => ArrayBuffer.isView(v);
  function toSAI(type, v) {
    switch (type) {
      case 'SFColor': return new SFColor(v[0], v[1], v[2]);
      case 'SFVec2f': return new SFVec2f(v[0], v[1]);
      case 'MFVec2f': return mf('MFVec2f', Array.from(v, (c) => new SFVec2f(c[0], c[1])));
      case 'SFVec3f': return new SFVec3f(v[0], v[1], v[2]);
      case 'SFVec4f': return new SFVec4f(v[0], v[1], v[2], v[3]);
      case 'SFRotation': return new SFRotation(v[0], v[1], v[2], v[3]);
      case 'MFColor': { const o = []; if (isTyped(v)) for (let i = 0; i + 2 < v.length; i += 3) o.push(new SFColor(v[i], v[i + 1], v[i + 2])); else for (const c of v) o.push(new SFColor(c[0], c[1], c[2])); return mf('MFColor', o); }
      case 'MFVec3f': { const o = []; if (isTyped(v)) for (let i = 0; i + 2 < v.length; i += 3) o.push(new SFVec3f(v[i], v[i + 1], v[i + 2])); else for (const c of v) o.push(new SFVec3f(c[0], c[1], c[2])); return mf('MFVec3f', o); }
      case 'SFColorRGBA': return new SFColorRGBA(v[0], v[1], v[2], v[3]);
      case 'MFColorRGBA': { const o = []; for (const c of v) o.push(new SFColorRGBA(c[0], c[1], c[2], c[3])); return mf('MFColorRGBA', o); }
      case 'MFString': return mf('MFString', v);
      case 'MFFloat': case 'MFInt32': case 'MFTime': return Array.from(v);
      case 'SFNode': return v ? wrap(v) : null;
      case 'MFNode': return mfNode(v);
      default: return v;
    }
  }
  const flat3 = (a) => { const o = []; for (const c of a) o.push(c.r ?? c.x ?? c[0], c.g ?? c.y ?? c[1], c.b ?? c.z ?? c[2]); return o; };
  function fromSAI(type, v, cur) {
    switch (type) {
      case 'SFColor': return Array.isArray(v) ? v : [v.r, v.g, v.b];
      case 'SFVec2f': return [v.x, v.y];
      case 'SFVec3f': return Array.isArray(v) ? v : [v.x, v.y, v.z];
      case 'SFVec4f': return [v.x, v.y, v.z, v.w];
      case 'SFColorRGBA': return Array.isArray(v) ? v : [v.r, v.g, v.b, v.a];
      case 'MFColorRGBA': return Array.from(v, (c) => [c.r, c.g, c.b, c.a]);
      case 'MFVec2f': return Array.from(v, (c) => [c.x, c.y]);
      case 'SFRotation': return Array.isArray(v) ? v : [v.x, v.y, v.z, v.angle];
      case 'MFColor': case 'MFVec3f': { const f = flat3(v); if (isTyped(cur)) return Float32Array.from(f); const o = []; for (let i = 0; i + 2 < f.length; i += 3) o.push([f[i], f[i + 1], f[i + 2]]); return o; }
      case 'MFString': return Array.from(v, String);
      case 'MFFloat': case 'MFInt32': case 'MFTime': return isTyped(cur) ? (cur instanceof Int32Array ? Int32Array.from(v) : Float32Array.from(v)) : Array.from(v);
      case 'SFNode': return v ? unwrap(v) : null;
      case 'MFNode': return Array.from(v, unwrap);
      case 'SFBool': return !!v;
      case 'SFFloat': case 'SFTime': case 'SFDouble': case 'SFInt32': return Number(v);
      case 'SFString': return String(v);
      default: return v;
    }
  }
  function unwrap(p) { return (p && rawOf.get(p)) || p; }

  /* a field whose value can be large (vertex attributes, index lists, uniform arrays): reading does not copy, setValue takes a typed array as is */
  function fieldView(raw, prop, type) {
    return {
      getTypeName() { return type; },
      get length() { return raw.f[prop].length; },
      getValue() { return raw.f[prop]; },
      setValue(v) {
        const out = isTyped(v) ? (type === 'MFInt32' ? Int32Array.from(v) : Float32Array.from(v)) : (type === 'MFInt32' ? Int32Array.from(Array.from(v, Number)) : Float32Array.from(Array.from(v, Number)));
        R.receive(raw, prop, out);
      },
    };
  }

  const METHODS = new Set(['getNodeName', 'getNodeTypeName', 'addFieldCallback', 'removeFieldCallback', 'getTypeName', 'getType', 'getName', 'dispose', 'valueOf', 'toString']);
  function wrap(raw) {
    let p = wrappers.get(raw); if (p) return p;
    const target = {};
    p = new Proxy(target, {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        switch (prop) {
          case 'getNodeName': return () => raw.def || '';
          case 'getNodeTypeName': return () => raw.type;
          case 'getTypeName': return () => 'SFNode';
          case 'getFieldDefinitions': return () => Object.entries(R.fdefsOf(raw)).map(([name, d]) => ({ name, dataType: d[0], accessType: d[1], getName() { return name; } }));
          case 'addFieldCallback': return (key, field, fn) => { ((raw.cbs ||= {})[field] ||= new Map()).set(key, fn); };
          case 'removeFieldCallback': return (field, key) => { raw.cbs && raw.cbs[field] && raw.cbs[field].delete(key); };
          case 'valueOf': case 'toString': return () => `[${raw.type}${raw.def ? ' ' + raw.def : ''}]`;
        }
        const fd = R.fdefsOf(raw)[prop];
        if (!fd) return undefined;
        if (fd[0] === 'MFVec4f' || (R.saiLazy && R.saiLazy.has(raw.type + '.' + prop))) return fieldView(raw, prop, fd[0]);
        const v = raw.f[prop];
        if (fd[0] === 'MFNode') return mfNode(v, raw);
        return toSAI(fd[0], v);
      },
      set(_t, prop, value) {
        const fd = R.fdefsOf(raw)[prop];
        if (!fd) throw new Error(`${raw.type} has no field ${prop}`);
        if (prop === 'children' && fd[0] === 'MFNode') { raw.f.children = Array.from(value, unwrap); raw.version = (raw.version || 0) + 1; R.hooks.changed(raw, 'children'); return true; }
        const v = fromSAI(fd[0], value, raw.f[prop]);
        R.receive(raw, prop, v);
        return true;
      },
      has(_t, prop) { return !!R.fdefsOf(raw)[prop] || METHODS.has(prop); },
    });
    wrappers.set(raw, p); rawOf.set(p, raw);
    return p;
  }
  /* live MFNode over a raw array (a node's children, or the scene's roots): push enters the body */
  function mfNode(arr, owner) {
    return new Proxy(arr, {
      get(t, prop) {
        if (prop === 'getTypeName') return () => 'MFNode';
        if (prop === 'length') return t.length;
        if (typeof prop === 'string' && /^\d+$/.test(prop)) return t[+prop] ? wrap(t[+prop]) : undefined;
        if (prop === 'push') return (...ns) => { for (const n of ns) { const r = unwrap(n); t.push(r); if (BODY) BODY.adopt(r, owner || null); } return t.length; };
        if (prop === Symbol.iterator) return function* () { for (const x of t) yield wrap(x); };
        if (typeof prop === 'string' && typeof Array.prototype[prop] === 'function') return (...a) => Array.prototype[prop].apply(t.map(wrap), a);
        return t[prop];
      },
    });
  }
  const mfNodeFor = (raw, field) => mfNode(raw.f[field], raw);
  // node.children must hand out a live list owned by the node
  const origToSAI = toSAI;

  /* an output event that the page listens to: set the field, call the callbacks, send it down the ROUTEs */
  function fire(node, field, value) {
    node.f[field] = value;
    const cb = node.cbs && node.cbs[field];
    if (cb) { const fd = R.fdefsOf(node)[field], sv = toSAI(fd ? fd[0] : '', value); for (const fn of cb.values()) { try { fn(sv); } catch (e) { console.error(e); } } }
    const rs = node.out && node.out[field];
    if (rs) for (const r of rs) { R.events.queue.push(r, value); }
    R.events.drain();
  }
  /* callbacks only (an output event raised inside the reader, such as a TimeSensor's elapsedTime): no route work, the reader's own emit does that */
  R.hooks.cb = (node, field, value) => {
    const cb = node.cbs && node.cbs[field];
    if (cb) { const fd = R.fdefsOf(node)[field], sv = toSAI(fd ? fd[0] : '', value); for (const fn of cb.values()) { try { fn(sv); } catch (e) { console.error(e); } } }
  };
  R.hooks.fire = fire;
  R.hooks.changed = (node, field) => { if (BODY) BODY.changed(node, field); const cb = node.cbs && node.cbs[field]; if (cb) { const fd = R.fdefsOf(node)[field], sv = toSAI(fd ? fd[0] : '', node.f[field]); for (const fn of cb.values()) { try { fn(sv); } catch (e) { console.error(e); } } } };
  R.hooks.bind = (node, on) => { if (BODY) BODY.bindViewpoint(node, on); };

  /* ------------------------------------------------------------------ scenes */
  function makeScene(world, isMain) {
    const sc = {
      _world: world,
      get rootNodes() { return mfNode(world.children, null); },
      addRootNode(n) { const r = unwrap(n); world.children.push(r); if (BODY && sc === MAINSCENE) BODY.adopt(r, null); },
      addComponent() {},
      getNamedNode(name) { const n = world.defs.get(name) || (MAINSCENE && MAINSCENE._world.defs.get(name)); if (!n) throw new Error(`Node named '${name}' not found.`); return wrap(n); },
      createNode(type) {
        const def = R.DEFS[type]; if (!def) throw new Error(`Unknown node type ${type}`);
        const n = { type, def: null, f: {}, id: 1e6 + (makeScene.k = (makeScene.k || 0) + 1), out: null };
        for (const [name, [t, , d]] of Object.entries(def)) n.f[name] = t === 'MFNode' ? [] : R.clone(d);
        world.nodes.push(n);
        return wrap(n);
      },
      addRoute(a, fa, b, fb) {
        const A = unwrap(a), Bn = unwrap(b), from = R.resolveField(A, fa, 'out'), to = R.resolveField(Bn, fb, 'in');
        if (!from || !to) throw new Error(`Bad route ${A.type}.${fa} to ${Bn.type}.${fb}`);
        const have = (A.out && A.out[from]) || [];
        if (have.some((r) => r.to === Bn && r.toField === to)) return;
        const r = { from: A, fromField: from, to: Bn, toField: to, label: `${A.def || A.type}.${from} → ${Bn.def || Bn.type}.${to}`, discrete: /^(SFBool|SFTime|SFInt32|SFString)$/.test(R.fieldType(A, from)) };
        ((A.out ||= {})[from] ||= []).push(r); (world.routes ||= []).push(r);
      },
    };
    return sc;
  }

  const gz = async (buf) => { const ds = new DecompressionStream('gzip'); const st = new Blob([buf]).stream().pipeThrough(ds); return new Response(st).text(); };
  /* the single-file build carries its scenes, data and textures as base64 in window.__VFS (keys are paths relative to the page); no request is made for them */
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const relOf = (url) => String(url).replace(location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, ''), '');
  const vfsBytes = (url) => { const v = window.__VFS; const k = v && relOf(url); return k && v[k] ? b64(v[k]) : null; };
  async function fetchWorldText(url) {
    let u = vfsBytes(url);
    if (!u) { const res = await fetch(url); if (!res.ok) throw new Error(`${res.status} for ${url}`); u = new Uint8Array(await res.arrayBuffer()); }
    if (u[0] === 0x1f && u[1] === 0x8b) return gz(u);
    return new TextDecoder().decode(u);
  }
  const B = {
    version: 'Babylon ' + (typeof BABYLON !== 'undefined' ? BABYLON.Engine.Version : '?') + ' WebGPU',
    currentScene: null,
    setBrowserOption(k, v) { if (k === 'ContentScale' && BODY) { BODY.engine.setHardwareScalingLevel(1 / Math.max(0.25, v)); } if (BODY && BODY.browserOption) BODY.browserOption(k, v); B._opts = B._opts || {}; B._opts[k] = v; },
    getBrowserOption(k) { return (B._opts || {})[k]; },
    getContext() { return { canvas: BODY.canvas }; },
    addBrowserCallback() {},
    baseURL: '',
    getComponent() { return {}; },
    async loadComponents() {},
    async createX3DFromURL(mfs) {
      const url = new URL(String(mfs[0]), location.href).href;
      const text = await fetchWorldText(url);
      return B.createX3DFromString(text, url);
    },
    async replaceWorld(sc) {
      const world = sc._world;
      MAINSCENE = sc; B.currentScene = sc; WORLD = world;
      BODY.timeSensors = world.nodes.filter((n) => n.type === 'TimeSensor');
      BODY.setWorld(world, sc._base || location.href, (u, base) => vfsResolve(new URL(u, base).href));
    },
    getCurrentFrameRate() { return BODY ? BODY.fps() : 0; },
    nextFrame() { return new Promise((res) => { (BODY.frameWaiters ||= []).push(res); }); },
    getActiveLayer() { return { getViewpoint: () => ({ get description() { return BODY.bound ? BODY.bound.f.description : ''; }, getUserPosition: () => BODY.userPosition() }) }; },
    async loadURL(mfs) {
      const url = new URL(String(mfs[0]), location.href).href;
      const text = await fetchWorldText(url);
      const world = R.parseX3D(text);
      const sc = makeScene(world, true); sc._base = url; for (const n of world.nodes) n.base = url;
      MAINSCENE = sc; B.currentScene = sc; WORLD = world;
      BODY.timeSensors = world.nodes.filter((n) => n.type === 'TimeSensor');
      BODY.setWorld(world, url, (u, base) => vfsResolve(new URL(u, base).href));
      if (world.warnings.length) console.info('[x3d reader]', world.warnings.slice(0, 8).join(' | '));
      return sc;
    },
    async createX3DFromString(xml, baseUrl) {
      const world = R.parseX3D(xml);
      const sc = makeScene(world, false);
      sc._base = baseUrl || B.baseURL || location.href;
      for (const n of world.nodes) n.base = sc._base;
      // nodes the imported scene owns: its timers run with the body's, and its roots join the main scene when pushed
      if (BODY) { BODY.timeSensors = (BODY.timeSensors || []).concat(world.nodes.filter((n) => n.type === 'TimeSensor')); }
      if (MAINSCENE) for (const [k, v] of world.defs) if (!MAINSCENE._world.defs.has(k)) MAINSCENE._world.defs.set(k, v);
      return sc;
    },
  };
  // nodes with MFNode children: wrap must return a live list owned by the node
  const baseToSAI = toSAI;
  function vfsResolve(url) { const v = window.__VFS, k = v && relOf(url); return k && v[k] && /\.png$/i.test(k) ? 'data:image/png;base64,' + v[k] : url; }

  const X3D = {
    SFColor, SFVec2f, SFVec3f, SFVec4f, SFRotation, SFColorRGBA, MFColor, MFColorRGBA, MFVec3f, MFVec2f, MFFloat, MFInt32, MFString, MFNode, X3DConstants: {},
    getBrowser(sel) { const c = typeof sel === 'string' ? document.querySelector(sel) : sel; return c && c.__browser ? c.__browser : null; },
  };
  window.X3DSAI = { X3D, B, wrap, unwrap, setBody(b) { BODY = b; const c = b.canvas; c.__browser = B; c.browser = B; }, vfsResolve, vfsBytes };
  window.X3D = X3D;
})();

/* Start the Babylon WebGPU body, give the page its lens, then load the page's own app.js (which asks X3D.getBrowser(canvas) at load time).
   Also: the on-screen notices (law 40) and the opt-in timing panel lives in manifold-timing.js (gate G0). */

/* the page's lens switch now drives Babylon's DefaultRenderingPipeline (bloom, vignette, grain, chromatic aberration); the old lens read X_ITE's WebGL frame and cannot read a WebGPU swap chain */
window.ManifoldLens = Object.freeze({
  create() { return { hdr: true, render(src, o) { const b = window.__mfBody; if (b) { b.mf.look.glow = o.glow; b.mf.look.grain = !!o.grain; } } }; },
});

(async () => {
  const canvas = document.getElementById('scene');
  const fail = (msg) => {
    const d = document.createElement('div');
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#02040a;color:#cfe;font:16px/1.5 system-ui,sans-serif;z-index:99';
    d.innerHTML = '<div style="max-width:36em"><h2 style="margin:0 0 .5em">This page needs WebGPU</h2><p></p>' +
      '<p style="opacity:.85">On Windows, Chrome may block an integrated GPU: open <b>chrome://flags/#enable-unsafe-webgpu</b>, set it to Enabled and relaunch. Edge, a Mac, or another machine also work.</p>' +
      '<p style="opacity:.75">Chrome or Edge 113 and later, Safari 26, and Firefox 141 and later on Windows run it. The WebGL version of this demo is the page it was ported from.</p></div>';
    d.querySelector('p').textContent = msg;
    document.body.appendChild(d);
  };
  const notices = [];
  const showNotices = () => {
    let el = document.getElementById('mfNotice');
    if (!el) {
      el = document.createElement('div'); el.id = 'mfNotice';
      el.style.cssText = 'position:fixed;right:36px;top:84px;text-align:right;max-width:min(30em,60vw);padding:6px 10px;border-radius:8px;background:rgba(4,8,16,.62);color:#9fb7c9;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;z-index:5;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = notices.join(' · ');
  };
  try {
    const body = new ManifoldBody(canvas, { onNote: (m) => { notices.push(m); showNotices(); console.info('[manifold]', m); } });
    await body.init();
    X3DSAI.setBody(body);
    window.__mfBody = body;
    const a = body.adapterInfo;
    window.__manifoldWebGPU = { body, babylon: BABYLON.Engine.Version, adapter: a };
    notices.push('Babylon ' + BABYLON.Engine.Version + ' on WebGPU', 'adapter: ' + ([a.vendor, a.architecture, a.description].filter(Boolean).join(' ') || 'name hidden by the browser'),
      'look: Babylon bloom, grain, vignette (the original canvas lens is not ported; the lens switch toggles these)');
    showNotices();
    window.__manifoldBuild = 'd58babb2793b';                                       // the builder writes the bundle hash here
    window.__adapter = body.adapter; window.__adapterVia = body.adapterInfo.hint;   // read by manifold-timing.js
    const s = document.createElement('script'); s.src = 'src/app.js'; s.onerror = () => fail('src/app.js did not load.');
    document.head.appendChild(s);
  } catch (e) {
    console.error(e); window.__manifoldWebGPUError = String(e && e.message || e);
    fail(String(e && e.message || e));
  }
})();

/* Opt-in timing for the Manifold Babylon page (gate G0: the owner opened it for this demo on 7 Nov 2026, in his own words; it stays off until the "Timing" button is pressed).
   Same method and the same result block as the KANSEI page (drift-timing.js), so numbers from the two demos can be put side by side: it measures the interval between
   requestAnimationFrame callbacks for about 20 s of whatever the page is doing, throws away a short warm-up, and shows p50, p95 and p99 on screen. When the adapter offers
   timestamp-query it also records Babylon's GPU frame time (the headroom a vsync-capped interval hides). The numbers stay on this page: nothing is sent anywhere (no fetch, no beacon).
   The GPU adapter and the browser are written beside the numbers so a figure is never separated from the machine it came from. A software adapter (SwiftShader, WARP, llvmpipe)
   is labelled on screen and its numbers must not be quoted (law 40). URL knobs: ?timing=0 hides the button, ?tsec=N sets the window (default 20 s), ?twarm=N the discarded warm-up (default 2 s). */
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('timing') === '0') return;
  const SEC = Math.max(1, +(q.get('tsec') || 20)), WARM = Math.max(0, +(q.get('twarm') || 2));
  const SOFT = /swiftshader|llvmpipe|lavapipe|software|basic render|warp/i;
  const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))] : NaN; // nearest rank
  const r1 = (v) => Math.round(v * 10) / 10;
  const mk = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  let btn, panel, body, running = false, cancel = null;

  const $ = (id) => document.getElementById(id);
  function context() {
    const w = window.__manifoldWebGPU, eng = w && w.body && w.body.engine, cv = eng && eng.getRenderingCanvas && eng.getRenderingCanvas();
    const mood = document.querySelector('.mood[aria-pressed="true"]'), look = w && w.body && w.body.mf && w.body.mf.look;
    const on = (id) => { const e = $(id); return e ? !!e.checked : null; };
    return {
      mood: mood ? mood.getAttribute('data-mood') + ' ' + mood.textContent.trim() : null,
      quality_setting: $('quality') ? $('quality').value : null, quality_label: $('qualityLabel') ? $('qualityLabel').textContent : null,
      look: { lens: on('lensToggle'), grain: on('grain'), glow: look ? look.glow : null },
      layers: { traces: on('traces'), filaments: on('filaments'), veil: on('veil') },
      canvas_px: cv ? [cv.width, cv.height] : null, device_pixel_ratio: window.devicePixelRatio || 1,
      hardware_scaling: eng && eng.getHardwareScalingLevel ? eng.getHardwareScalingLevel() : null,
    };
  }
  function machine(battery) {
    const w = window.__manifoldWebGPU || {}, a = window.__adapter || null, info = (a && a.info) || {};
    const gpu = { vendor: info.vendor || (w.adapter && w.adapter.vendor) || '', architecture: info.architecture || (w.adapter && w.adapter.architecture) || '',
      device: info.device || '', description: info.description || (w.adapter && w.adapter.description) || '',
      is_fallback: !!(info.isFallbackAdapter || (a && a.isFallbackAdapter)), timestamp_query: !!(a && a.features && a.features.has && a.features.has('timestamp-query')) };
    const software = gpu.is_fallback || SOFT.test([gpu.vendor, gpu.architecture, gpu.device, gpu.description].join(' '));
    return { user_agent: navigator.userAgent, platform: navigator.platform || '', cores: navigator.hardwareConcurrency || null, memory_gb: navigator.deviceMemory || null,
      battery, webgpu_adapter_request: window.__adapterVia || null, gpu, gpu_is_software: software, babylon: w.babylon || null };
  }

  function show(lines, tone) {
    body.replaceChildren();
    for (const [text, css] of lines) body.appendChild(mk('div', css || '', text));
    panel.style.display = 'block'; panel.style.borderColor = tone === 'warn' ? '#e0a030' : 'rgba(255,255,255,.28)';
  }
  const row = (text, css) => [text, 'margin:3px 0;' + (css || '')];

  function finish(dts, gpuMs, meta) {
    const s = dts.slice().sort((x, y) => x - y), n = s.length, mean = n ? s.reduce((x, y) => x + y, 0) / n : NaN;
    const worst = s.slice(Math.max(0, n - Math.max(1, Math.ceil(n * 0.01)))), lowMean = worst.length ? worst.reduce((x, y) => x + y, 0) / worst.length : NaN;
    const ctx1 = context(), changed = JSON.stringify([meta.ctx0.mood, meta.ctx0.quality_setting, meta.ctx0.look, meta.ctx0.layers]) !== JSON.stringify([ctx1.mood, ctx1.quality_setting, ctx1.look, ctx1.layers]);
    const m = machine(meta.battery), g = gpuMs.slice().sort((x, y) => x - y);
    const res = {
      schema: 'x3d.manifold.timing/1', utc: new Date().toISOString(), window_s: SEC, warmup_s: WARM, build: window.__manifoldBuild || 'dev',
      page: Object.assign({}, ctx1, { hardware_scaling_at_start: meta.ctx0.hardware_scaling, settings_changed_during_run: changed }), machine: m,
      frames: n, fps_mean: r1(1000 / mean), ms: { p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)), mean: r1(mean), max: r1(s[n - 1]) },
      one_percent_low_fps: r1(1000 / lowMean), frames_over_33ms: s.filter((x) => x > 33.4).length, frames_over_50ms: s.filter((x) => x > 50).length,
      gpu_frame_ms: g.length ? { samples: g.length, p50: r1(pct(g, 50)), p95: r1(pct(g, 95)), p99: r1(pct(g, 99)) } : null,
      tab_hidden_during_run: meta.hidden,
      what_this_is: 'requestAnimationFrame interval (vsync-paced), including the Babylon draw and the page\'s own update; gpu_frame_ms is Babylon\'s GPU timestamp (null where the adapter has none); nothing was uploaded',
    };
    const bad = meta.hidden || n < 30, soft = m.gpu_is_software;
    const lines = [];
    if (soft) lines.push(row('Software rasteriser: these numbers do not count. Open the page in a browser with a real GPU adapter.', 'color:#ffcf70;font-weight:600'));
    if (meta.hidden) lines.push(row('The tab was hidden during the run, so the numbers are not valid. Run again and keep this tab in front.', 'color:#ffcf70;font-weight:600'));
    else if (n < 30) lines.push(row('Only ' + n + ' frames in ' + SEC + ' s: too few to quote (the page is not running at a usable rate here).', 'color:#ffcf70;font-weight:600'));
    lines.push(row('p50 ' + res.ms.p50 + ' ms    p95 ' + res.ms.p95 + ' ms    p99 ' + res.ms.p99 + ' ms    max ' + res.ms.max + ' ms', 'font-size:13px'));
    lines.push(row(n + ' frames in ' + SEC + ' s after ' + WARM + ' s warm-up, mean ' + res.fps_mean + ' fps, 1% low ' + res.one_percent_low_fps + ' fps, over 33 ms: ' + res.frames_over_33ms + ', over 50 ms: ' + res.frames_over_50ms));
    lines.push(row(res.gpu_frame_ms ? 'GPU frame time (timestamp query): p50 ' + res.gpu_frame_ms.p50 + ' ms, p95 ' + res.gpu_frame_ms.p95 + ' ms, p99 ' + res.gpu_frame_ms.p99 + ' ms over ' + res.gpu_frame_ms.samples + ' frames' : 'GPU frame time: this adapter offers no timestamp query, so only the frame interval is shown', 'opacity:.9'));
    lines.push(row('GPU: ' + ([m.gpu.vendor, m.gpu.architecture, m.gpu.description || m.gpu.device].filter(Boolean).join(' / ') || 'not reported') + (m.gpu.is_fallback ? ' (fallback adapter)' : '') + '; adapter request: ' + (m.webgpu_adapter_request || '?'), 'opacity:.85'));
    lines.push(row('Browser: ' + navigator.userAgent, 'opacity:.7;word-break:break-all'));
    lines.push(row('Page: mood ' + (ctx1.mood || '?') + '; quality ' + (ctx1.quality_label || '?') + (changed ? ' (settings changed during the run)' : '') + '; canvas ' + (ctx1.canvas_px ? ctx1.canvas_px.join('x') : '?') + ' at ' + ctx1.device_pixel_ratio + 'x, render scale 1/' + (ctx1.hardware_scaling == null ? '?' : r1(ctx1.hardware_scaling)) + ' (Adaptive quality moves it: pick a fixed tier for comparable numbers)', 'opacity:.7'));
    lines.push(row('This is the interval between displayed frames (a 60 Hz screen caps it near 16.7 ms); the GPU frame time shows headroom where it is available. Nothing was uploaded.', 'opacity:.6;font-size:11px'));
    show(lines, soft || bad ? 'warn' : '');
    const ta = mk('textarea', 'width:100%;height:84px;margin-top:6px;background:#02060d;color:#bfe;border:1px solid rgba(255,255,255,.25);font:11px ' + MONO + ';box-sizing:border-box');
    ta.readOnly = true; ta.value = JSON.stringify(res, null, 1);
    const bar = mk('div', 'display:flex;gap:8px;margin-top:6px');
    const b = (t, fn) => { const x = mk('button', 'cursor:pointer;background:#10182a;color:#cfe;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:4px 10px;font:12px ' + MONO, t); x.onclick = fn; x.addEventListener('mousedown', (e) => e.preventDefault()); return x; };
    const cp = b('Copy numbers', async () => { try { await navigator.clipboard.writeText(ta.value); cp.textContent = 'Copied'; } catch { ta.focus(); ta.select(); cp.textContent = 'Select + copy'; } setTimeout(() => { cp.textContent = 'Copy numbers'; }, 1800); });
    bar.append(cp, b('Run again', start), b('Close', () => { panel.style.display = 'none'; }));
    body.append(ta, bar);
    window.__manifoldTimingResult = res;
    return res;
  }

  async function start() {
    if (running) { if (cancel) cancel(); return; }
    running = true;
    let battery = null; try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { charging: b.charging, level: r1(b.level) }; } } catch { /* not offered */ }
    const meta = { hidden: document.hidden, battery, ctx0: context() }, dts = [], gpuMs = [];
    // Babylon's GPU frame time, when the adapter has timestamp-query
    const t0w = performance.now(); let inst = null, obs = null; const w = window.__manifoldWebGPU, sc = w && w.body && w.body.scene;
    try { if (sc && window.BABYLON && BABYLON.EngineInstrumentation) { inst = new BABYLON.EngineInstrumentation(w.body.engine); inst.captureGPUFrameTime = true; obs = sc.onAfterRenderObservable.add(() => { const v = inst.gpuFrameTimeCounter && inst.gpuFrameTimeCounter.current; if (v > 0 && performance.now() - t0w > WARM * 1000) gpuMs.push(v / 1e6); }); } } catch { inst = null; }
    let t0 = null, last = null, raf = 0, lastLabel = 0;
    const cleanup = () => { if (obs && sc) sc.onAfterRenderObservable.remove(obs); if (inst) { try { inst.dispose(); } catch { /* already gone */ } } document.removeEventListener('visibilitychange', onVis); };
    const done = (aborted) => { running = false; cancel = null; btn.textContent = 'Timing'; cleanup(); if (aborted) { show([row('Timing cancelled.')]); } else finish(dts, gpuMs, meta); };
    cancel = () => { cancelAnimationFrame(raf); done(true); };
    const onVis = () => { if (document.hidden) meta.hidden = true; };
    document.addEventListener('visibilitychange', onVis);
    show([row('Measuring for ' + (WARM + SEC) + ' s (' + WARM + ' s warm-up is thrown away). Keep this tab in front and leave the mouse alone, or orbit as you normally would. Press the button again to cancel.')]);
    const tick = (now) => {
      if (t0 === null) { t0 = now; }
      const el = (now - t0) / 1000;
      if (last !== null && el > WARM) dts.push(now - last);
      last = now;
      if (now - lastLabel > 250) { lastLabel = now; btn.textContent = 'Timing ' + Math.max(0, Math.ceil(WARM + SEC - el)) + ' s'; }
      if (el >= WARM + SEC) { done(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function install() {
    btn = mk('button', 'position:fixed;left:12px;bottom:12px;z-index:45;cursor:pointer;background:rgba(4,8,16,.7);color:#cfe;border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 12px;font:11px ' + MONO + ';letter-spacing:.08em;opacity:.6', 'Timing');
    btn.title = 'Measure frame times on this machine for about ' + SEC + ' s. Off until pressed; nothing is uploaded.';
    btn.id = 'x3d-timing-btn';
    btn.onmouseenter = () => { btn.style.opacity = '1'; }; btn.onmouseleave = () => { btn.style.opacity = '.6'; };
    btn.onclick = (e) => { e.stopPropagation(); start(); };
    panel = mk('div', 'position:fixed;left:12px;bottom:46px;z-index:45;display:none;width:min(440px,calc(100vw - 24px));max-height:70vh;overflow:auto;box-sizing:border-box;padding:10px 12px;background:rgba(4,8,16,.92);color:#cfe;border:1px solid rgba(255,255,255,.28);border-radius:8px;font:12px/1.45 ' + MONO);
    panel.id = 'x3d-timing-panel';
    body = mk('div'); panel.appendChild(body);
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(btn, panel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();

})();
