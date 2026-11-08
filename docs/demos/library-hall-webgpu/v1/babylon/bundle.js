(function () {
"use strict";
window.__x3dBuild = "73ecee46b4fb";
/* One WebGPU adapter request that does not give up early. Babylon asks navigator.gpu.requestAdapter() with its own options (the high-performance
   hint); on some machines only the plain call, the low-power hint or the software adapter answers (x3d.loom PR 14, playbook 4.1). This wraps the
   call so the plain request goes first, then the caller's options, low-power, then the fallback adapter, and records which one answered
   (window.__adapter, window.__adapterVia) so a page can say so on screen and the Timing panel can name the GPU. Loaded before the body starts. */
(() => {
  const gpu = navigator.gpu;
  if (!gpu || gpu.__plainFirst) return;
  const orig = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (opts) => {
    let a = null;
    for (const o of [undefined, opts, { powerPreference: 'low-power' }, { forceFallbackAdapter: true }]) {
      try { a = await orig(o); } catch (e) { a = null; }
      if (a) { window.__adapter = a; window.__adapterVia = o === undefined ? 'default' : JSON.stringify(o); break; }
    }
    return a;
  };
  gpu.__plainFirst = true;
})();

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
  IntegerSequencer: interp('Int32'),
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
const INTERPOLATORS = new Set(['IntegerSequencer', 'ScalarInterpolator', 'PositionInterpolator', 'OrientationInterpolator', 'ColorInterpolator']);
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
  if (n.type === 'IntegerSequencer') return kv[frac >= k[N - 1] ? N - 1 : Math.max(0, i)];   // a sequencer steps: the value of the last key at or before the fraction
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

R.FLAT = FLAT; R.DEFS = DEFS; R.parseX3D = parseX3D; R.events = events; R.receive = receive; R.tickTimeSensor = tickTimeSensor; R.fieldType = fieldType; R.fdefsOf = fdefsOf; R.clone = clone;
R.v3 = v3; R.quat = quat; R.clamp = clamp; R.INTERPOLATORS = INTERPOLATORS; R.mfString = mfString; R.PARSE = PARSE; R.CONTAINER = CONTAINER;
R.resolveField = resolveField; R.FLAT = FLAT;

/* Additive reader nodes for the Gobbler 3 scene. Concatenated after brain/reader.js in the same bundle scope, so DEFS, PARSE, FLAT, CONTAINER,
   events, receive and R are visible. Nothing here changes how the brain scenes parse: entries are only added, and `receive` is wrapped. */

// ColorRGBA, Normal and the 3D texture coordinates of the ribbon quads stay flat typed arrays: the deep build carries 100,000+ numbers in them
FLAT['TextureCoordinate3D.point'] = Float32Array; FLAT['ColorRGBA.color'] = Float32Array; FLAT['IndexedFaceSet.texCoordIndex'] = Int32Array; FLAT['IndexedFaceSet.colorIndex'] = Int32Array;
FLAT['VolumeEmitter.coordIndex'] = Int32Array;
PARSE.MFBool = (s) => String(s).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean).map((t) => /^true$/i.test(t));
PARSE.MFPixel = (s) => String(s).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean).map((t) => (/^0x/i.test(t) ? parseInt(t, 16) : parseInt(t, 10) || 0));

Object.assign(DEFS, {
  PointSet: { coord: ['SFNode', IO, null], color: ['SFNode', IO, null], attrib: ['MFNode', IO, []] },
  TextureCoordinate3D: { point: ['MFVec3f', IO, []] },
  PixelTexture: { image: ['MFPixel', INIT, [0, 0, 0]], repeatS: ['SFBool', INIT, true], repeatT: ['SFBool', INIT, true] },
  VolumeEmitter: { ...emitter, coordIndex: ['MFInt32', INIT, []], coord: ['SFNode', INIT, null], internal: ['SFBool', INIT, true] },
  BooleanFilter: { set_boolean: ['SFBool', IN, false], inputTrue: ['SFBool', OUT, false], inputFalse: ['SFBool', OUT, false], inputNegate: ['SFBool', OUT, false] },
  BooleanSequencer: { key: ['MFFloat', IO, []], keyValue: ['MFBool', IO, []], set_fraction: ['SFFloat', IN, 0], value_changed: ['SFBool', OUT, false], next: ['SFBool', IN, false], previous: ['SFBool', IN, false] },
});
// a Coordinate inside a VolumeEmitter is the emitter's own, and ColorRGBA inside a ParticleSystem is its colour ramp
Object.assign(CONTAINER, { PointSet: 'geometry', TextureCoordinate3D: 'texCoord', PixelTexture: 'texture', VolumeEmitter: 'emitter' });
DEFS.Appearance.alphaMode = ['SFString', IO, 'AUTO']; DEFS.Appearance.metadata = ['SFNode', IO, null];

/* Boolean event utilities (19775-1 chapter 31). Both are pure event nodes: a ROUTE into them runs here, their outputs leave through events.emit. */
const _receive = receive;
receive = function (node, field, value) {
  if (node.type === 'BooleanFilter' && field === 'set_boolean') {
    const v = !!value;
    if (v) { node.f.inputTrue = true; events.emit(node, 'inputTrue', true); } else { node.f.inputFalse = false; events.emit(node, 'inputFalse', false); }
    node.f.inputNegate = !v; events.emit(node, 'inputNegate', !v);
    return;
  }
  if (node.type === 'BooleanSequencer' && (field === 'set_fraction' || field === 'next' || field === 'previous')) {
    const k = node.f.key, kv = node.f.keyValue, N = Math.min(k.length, kv.length);
    if (!N) return;
    let i;
    if (field === 'set_fraction') { const fr = value; i = 0; if (fr >= k[N - 1]) i = N - 1; else if (fr > k[0]) { while (i < N - 1 && fr >= k[i + 1]) i++; } }
    else { const cur = node.state && node.state.i != null ? node.state.i : -1; i = field === 'next' ? (cur + 1) % N : (cur - 1 + N) % N; }
    node.state = node.state || {}; node.state.i = i;
    node.f.value_changed = kv[i]; events.emit(node, 'value_changed', kv[i]);
    return;
  }
  return _receive(node, field, value);
};
R.receive = receive;

Object.assign(DEFS.Shape, { bboxCenter: ['SFVec3f', INIT, [0, 0, 0]], bboxSize: ['SFVec3f', INIT, [-1, -1, -1]] });   // culling hints: the body does not use them

/* Gobbler demiurge on Babylon WebGPU: reader additions for the nodes the Demiurge scene has on top of Gobbler 3 Deep. Concatenated after gobbler/reader-ext.js in the same
   bundle scope (DEFS, FLAT, CONTAINER, IO, IN, OUT, INIT, GROUP and R are visible). Entries are only added; nothing that parses today parses differently.
     LOD                 children are the levels, range[] the switch distances, measured in the LOD's own frame
     HAnimHumanoid       a Transform whose skeleton (the joint tree) and skin (the bodies) are drawn; joints, segments, sites and viewpoints are lists of USE references, not drawn twice
     HAnimJoint/Segment/Site   a Transform (the joint rotates about its centre)
     ProximitySensor     the box test and the camera pose are the body's (body-dm.js); the page uses a huge one to read the camera
     Inline              url + load; the body fetches, parses and adopts the file when load turns true */

FLAT['HAnimJoint.skinCoordIndex'] = Int32Array; FLAT['HAnimJoint.skinCoordWeight'] = Float32Array;

const _xf = { translation: ['SFVec3f', IO, [0, 0, 0]], rotation: ['SFRotation', IO, [0, 0, 1, 0]], scale: ['SFVec3f', IO, [1, 1, 1]],
              scaleOrientation: ['SFRotation', IO, [0, 0, 1, 0]], center: ['SFVec3f', IO, [0, 0, 0]] };
Object.assign(DEFS, {
  LOD: { ...GROUP, range: ['MFFloat', INIT, []], center: ['SFVec3f', INIT, [0, 0, 0]], forceTransitions: ['SFBool', INIT, false] },
  HAnimJoint: { ...GROUP, ..._xf, name: ['SFString', IO, ''], skinCoordIndex: ['MFInt32', IO, []], skinCoordWeight: ['MFFloat', IO, []], displacements: ['MFNode', IO, []],
                llimit: ['MFFloat', IO, []], ulimit: ['MFFloat', IO, []], limitOrientation: ['SFRotation', IO, [0, 0, 1, 0]] },
  HAnimSegment: { ...GROUP, name: ['SFString', IO, ''], coord: ['SFNode', IO, null], displacers: ['MFNode', IO, []], mass: ['SFFloat', IO, 0], centerOfMass: ['SFVec3f', IO, [0, 0, 0]] },
  HAnimSite: { ...GROUP, ..._xf, name: ['SFString', IO, ''] },
  HAnimHumanoid: { ...GROUP, ..._xf, name: ['SFString', IO, ''], version: ['SFString', INIT, ''], skeletalConfiguration: ['SFString', INIT, ''], info: ['MFString', IO, []],
                   skeleton: ['MFNode', IO, []], skin: ['MFNode', IO, []], skinCoord: ['SFNode', IO, null], skinNormal: ['SFNode', IO, null],
                   joints: ['MFNode', IO, []], segments: ['MFNode', IO, []], sites: ['MFNode', IO, []], viewpoints: ['MFNode', IO, []], skeletonConfig: ['SFString', IO, ''] },
  ProximitySensor: { center: ['SFVec3f', IO, [0, 0, 0]], size: ['SFVec3f', IO, [0, 0, 0]], enabled: ['SFBool', IO, true], isActive: ['SFBool', OUT, false],
                     position_changed: ['SFVec3f', OUT, [0, 0, 0]], orientation_changed: ['SFRotation', OUT, [0, 0, 1, 0]], centerOfRotation_changed: ['SFVec3f', OUT, [0, 0, 0]],
                     enterTime: ['SFTime', OUT, 0], exitTime: ['SFTime', OUT, 0] },
  Inline: { url: ['MFString', IO, []], load: ['SFBool', IO, true], bboxCenter: ['SFVec3f', INIT, [0, 0, 0]], bboxSize: ['SFVec3f', INIT, [-1, -1, -1]] },
});
for (const t of ['HAnimJoint', 'HAnimSegment', 'HAnimSite', 'HAnimHumanoid', 'LOD']) DEFS[t].metadata = ['SFNode', IO, null];
// the humanoid's list fields hold USE references; Coordinate and Normal inside it are the shared skin points
Object.assign(CONTAINER, {});

/* TimeSensor pauseTime and resumeTime (19775-1 8.4.6 rule: paused while pauseTime > resumeTime and pauseTime <= now). The page freezes the bird's Sway for the dive to the village and
   resumes it on the way out; the brain reader has no pause. While paused no event leaves the sensor; on resume the clock carries on from where it stopped (start time shifted by the pause). */
const _tickDM = tickTimeSensor;
tickTimeSensor = function (n, now) {
  const f = n.f, st = n.state || (n.state = { active: false, cycle: -1 });
  // a looping sensor whose startTime was never set starts when the world does (X_ITE counts its elapsedTime from there, not from 1970: a shader that adds time * 0.1 to a noise
  // coordinate would otherwise see 1.8e8 and lose every digit it needs)
  if (!st.active && !st.paused && f.loop && f.enabled && f.startTime === 0 && !st.t0) { st.t0 = now; f.startTime = now; }
  if (st.active || st.paused) {
    if (!st.paused && f.pauseTime > f.resumeTime && now >= f.pauseTime) { st.paused = true; st.pAt = f.pauseTime; f.isPaused = true; events.emit(n, 'isPaused', true); }
    else if (st.paused && f.resumeTime >= f.pauseTime && now >= f.resumeTime) { st.shift = (st.shift || 0) + (f.resumeTime - st.pAt); st.paused = false; f.isPaused = false; events.emit(n, 'isPaused', false); }
    if (st.paused) return;
  }
  return _tickDM(n, now - (st.shift || 0));
};
R.tickTimeSensor = tickTimeSensor;

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
    const key = g.id + (wantColor ? 'c' : 'n');   // 'n', not the bare id: the bare id is where geometryData keeps its data, and a rebuild read the Babylon geometry back as data (0 vertices)
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
        for (const key of [x.id, x.id + 'c', x.id + 'n']) { const c = this.geoCache.get(key); if (c) { c.geo.dispose(); this.geoCache.delete(key); } }
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

/* KANSEI on Babylon WebGPU: what the brain port's reader and body did not have.
   Loaded after body-cam.js and before sai.js. It adds to R.DEFS (reader tables) and patches Body.prototype; the brain page does not load it.
   Added: ElevationGrid (read as an IndexedTriangleSet), TextureProperties / TextureTransform, Background cube skybox, linear Fog, sun shadows,
   SpotLight / PointLight, UnlitMaterial, ColorRGBA vertex colours with alpha, PhysicalMaterial emissive and normal textures, and ParticleSystem
   (sprites and stretched lines through Babylon's own particle system). The page's engine/*.js and main.js are not touched. */

/* ------------------------------------------------------------------ reader tables */
Object.assign(R.DEFS, {
  TextureProperties: { anisotropicDegree: ['SFFloat', IO, 1], generateMipMaps: ['SFBool', IO, true], boundaryModeS: ['SFString', IO, 'REPEAT'], boundaryModeT: ['SFString', IO, 'REPEAT'],
                       minificationFilter: ['SFString', IO, 'FASTEST'], magnificationFilter: ['SFString', IO, 'FASTEST'] },
  TextureTransform: { translation: ['SFVec2f', IO, [0, 0]], rotation: ['SFFloat', IO, 0], scale: ['SFVec2f', IO, [1, 1]], center: ['SFVec2f', IO, [0, 0]] },
  ElevationGrid: { xDimension: ['SFInt32', INIT, 0], zDimension: ['SFInt32', INIT, 0], xSpacing: ['SFFloat', INIT, 1], zSpacing: ['SFFloat', INIT, 1], height: ['MFFloat', INIT, []],
                   creaseAngle: ['SFFloat', INIT, 0], solid: ['SFBool', INIT, true], ccw: ['SFBool', INIT, true], texCoord: ['SFNode', IO, null], color: ['SFNode', IO, null], normal: ['SFNode', IO, null] },
  PolylineEmitter: { ...{ position: ['SFVec3f', IO, [0, 0, 0]], direction: ['SFVec3f', IO, [0, 1, 0]], speed: ['SFFloat', IO, 0], variation: ['SFFloat', IO, 0.25], mass: ['SFFloat', IO, 0],
                        surfaceArea: ['SFFloat', IO, 0], on: ['SFBool', IO, true] }, coord: ['SFNode', IO, null], coordIndex: ['MFInt32', INIT, []] },
  MetadataSet: { name: ['SFString', IO, ''], reference: ['SFString', IO, ''], value: ['MFNode', IO, []] },
  MetadataDouble: { name: ['SFString', IO, ''], value: ['MFFloat', IO, []] },
  MetadataInteger: { name: ['SFString', IO, ''], value: ['MFInt32', IO, []] },
});
Object.assign(R.DEFS.Background, { frontUrl: ['MFString', IO, []], backUrl: ['MFString', IO, []], leftUrl: ['MFString', IO, []], rightUrl: ['MFString', IO, []],
                                    topUrl: ['MFString', IO, []], bottomUrl: ['MFString', IO, []] });
Object.assign(R.DEFS.Appearance, { alphaMode: ['SFString', IO, 'AUTO'], alphaCutoff: ['SFFloat', IO, 0.5] });
Object.assign(R.DEFS.ImageTexture, { textureProperties: ['SFNode', IO, null] });
Object.assign(R.DEFS.WorldInfo, { metadata: ['SFNode', IO, null] });
Object.assign(R.DEFS.PhysicalMaterial, { normalScale: ['SFFloat', IO, 1] });
Object.assign(R.DEFS.UnlitMaterial, { emissiveTexture: ['SFNode', IO, null] });
Object.assign(R.CONTAINER, { ElevationGrid: 'geometry', TextureProperties: 'textureProperties', TextureTransform: 'textureTransform', PolylineEmitter: 'emitter', MetadataSet: 'metadata', MetadataDouble: 'value', MetadataInteger: 'value' });

/* ElevationGrid -> IndexedTriangleSet at parse time (x runs along the first axis, z along the second; counter-clockwise seen from +Y is the front face) */
(function () {
  const parse0 = R.parseX3D;
  let serial = 5e6;
  R.parseX3D = function (text) {
    const w = parse0(text);
    const off = (R.idBase = (R.idBase || 1e4) + 1e4); // ids are unique across every file the page loads (levels, cars, garage)
    for (const n of w.nodes) n.id += off;
    for (const n of w.nodes) {
      if (n.type !== 'ElevationGrid') continue;
      const f = n.f, xd = f.xDimension, zd = f.zDimension, P = new Float32Array(xd * zd * 3), UV = new Float32Array(xd * zd * 2);
      for (let j = 0; j < zd; j++) for (let i = 0; i < xd; i++) {
        const k = j * xd + i;
        P[k * 3] = i * f.xSpacing; P[k * 3 + 1] = f.height[k] || 0; P[k * 3 + 2] = j * f.zSpacing;
        UV[k * 2] = i / Math.max(1, xd - 1); UV[k * 2 + 1] = j / Math.max(1, zd - 1);
      }
      const idx = new Int32Array((xd - 1) * (zd - 1) * 6); let o = 0;
      for (let j = 0; j < zd - 1; j++) for (let i = 0; i < xd - 1; i++) {
        const a = j * xd + i, b = a + 1, c = a + xd, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
      const co = { type: 'Coordinate', def: null, f: { point: P }, id: serial++, out: null };
      const tc = { type: 'TextureCoordinate', def: null, f: { point: UV }, id: serial++, out: null };
      w.nodes.push(co, tc);
      n.type = 'IndexedTriangleSet';
      n.f = { coord: co, normal: null, color: f.color || null, texCoord: tc, attrib: [], ccw: true, colorPerVertex: true, normalPerVertex: true, solid: f.solid, index: idx, set_index: [] };
    }
    return w;
  };
})();

/* ------------------------------------------------------------------ body */
const DX = { shadowGen: null, bgNode: null };
const B_ = Body.prototype;
const toC3 = (c) => new BABYLON.Color3(c[0], c[1], c[2]);

/* textures: per-node base URL (cars and levels live in different folders), TextureProperties, TextureTransform from the Appearance being built */
B_.tex = function (texNode) {
  if (!texNode || !texNode.f.url || !texNode.f.url.length) return null;
  const tt = this._curTT, key = texNode.id + (tt ? 'T' + tt.id : '');
  const hit = this.texCache.get(key); if (hit) return hit;
  const urls = texNode.f.url.map((u) => this.resolve(u, texNode.base || this.baseUrl));
  const tp = texNode.f.textureProperties && texNode.f.textureProperties.f;
  const t = new BABYLON.Texture(urls[0], this.scene, !(tp && tp.generateMipMaps === false), true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null,
    () => { if (urls.length > 1) { t._alt = (t._alt || 0) + 1; if (t._alt < urls.length) t.updateURL(urls[t._alt]); } });
  t.hasAlpha = true;
  const rs = tp ? tp.boundaryModeS !== 'CLAMP_TO_EDGE' && tp.boundaryModeS !== 'CLAMP' : texNode.f.repeatS !== false;
  const rt = tp ? tp.boundaryModeT !== 'CLAMP_TO_EDGE' && tp.boundaryModeT !== 'CLAMP' : texNode.f.repeatT !== false;
  t.wrapU = rs ? BABYLON.Texture.WRAP_ADDRESSMODE : BABYLON.Texture.CLAMP_ADDRESSMODE;
  t.wrapV = rt ? BABYLON.Texture.WRAP_ADDRESSMODE : BABYLON.Texture.CLAMP_ADDRESSMODE;
  if (tp && tp.anisotropicDegree > 1) t.anisotropicFilteringLevel = Math.min(16, tp.anisotropicDegree);
  if (tt) { const f = tt.f; t.uScale = f.scale[0]; t.vScale = f.scale[1]; t.uOffset = f.translation[0]; t.vOffset = f.translation[1]; t.wAng = f.rotation; }
  this.texCache.set(key, t);
  return t;
};

const _materialsFor = B_.materialsFor;
B_.materialsFor = function (shape, g, app) {
  const mat = app && app.f.material;
  if (mat && mat.type === 'UnlitMaterial' && g.type !== 'Text') {
    const tex = app.f.texture || mat.f.emissiveTexture;
    return [{ kind: 'xunlit', mat, tex, deps: [mat, tex].filter(Boolean) }];
  }
  return _materialsFor.call(this, shape, g, app);
};
const _makeMaterial = B_.makeMaterial;
B_.makeMaterial = function (shape, g, spec, mesh) {
  const app = shape.f.appearance; this._curTT = app && app.f.textureTransform;
  try {
    if (spec.kind === 'xunlit') {
      const m = new BABYLON.StandardMaterial('xunlit-' + shape.id, this.scene);
      m.disableLighting = true; m.backFaceCulling = g.f.solid === true; m.specularColor.set(0, 0, 0); m.disableDepthWrite = false;
      const t = this.tex(spec.tex); if (t) { m.emissiveTexture = t; m.opacityTexture = null; m.useAlphaFromDiffuseTexture = false; }
      if (this.opts.ccw !== false) m.sideOrientation = BABYLON.Material.CounterClockWiseSideOrientation;
      this.refreshUnlit(m, spec.mat, g);
      return m;
    }
    const m = _makeMaterial.call(this, shape, g, spec, mesh);
    if (spec.kind === 'pbr') {
      m.maxSimultaneousLights = 8;
      const f = spec.mat.f;
      if (f.emissiveTexture) { const e = this.tex(f.emissiveTexture); if (e) { m.emissiveTexture = e; if (!f.emissiveColor[0] && !f.emissiveColor[1] && !f.emissiveColor[2]) m.emissiveColor = new BABYLON.Color3(1, 1, 1); } }
      if (f.normalTexture) { const nt = this.tex(f.normalTexture); if (nt) { nt.hasAlpha = false; m.bumpTexture = nt; nt.level = f.normalScale * (this.opts.normalGain ?? 0.6); m.invertNormalMapY = !!this.opts.invertNormalY; m.invertNormalMapX = !!this.opts.invertNormalX; } }
      m.environmentIntensity = this.opts.pbrEnv ?? 0;
      if (this.opts.specularOff) m.specularIntensity = 0;
      m.useRadianceOverAlpha = false; m.useSpecularOverAlpha = false;
    }
    if (spec.kind === 'phong') m.maxSimultaneousLights = 8;
    if (app && (spec.kind === 'pbr' || spec.kind === 'xunlit') && (app.f.alphaMode === 'MASK' || app.f.alphaMode === 'BLEND')) {
      m._xalpha = { mode: app.f.alphaMode, cutoff: app.f.alphaCutoff };
      this.applyAlphaMode(m);
    }
    return m;
  } finally { this._curTT = null; }
};
B_.applyAlphaMode = function (m) {
  const x = m._xalpha; if (!x) return;
  if (m instanceof BABYLON.PBRMaterial) m.useAlphaFromAlbedoTexture = true; else m.useAlphaFromDiffuseTexture = true;
  if (x.mode === 'MASK') { m.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST; m.alphaCutOff = x.cutoff; m.disableDepthWrite = false; }
  else { m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true; m.zOffset = -2; }
};
const _refreshPBR = B_.refreshPBR;
B_.refreshPBR = function (m, mat) { _refreshPBR.call(this, m, mat); this.applyAlphaMode(m); };
B_.refreshUnlit = function (m, mat, g) {
  const e = mat.f.emissiveColor; m.emissiveColor.set(e[0], e[1], e[2]); m.diffuseColor.set(0, 0, 0);
  m.alpha = 1 - mat.f.transparency;
  if (g && g.f.color) { m.useVertexColors = false; }
  const trans = m.alpha < 0.999 || (g && g.f.color && g.f.color.type === 'ColorRGBA');
  if (trans) { m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true; } else m.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
};

/* IndexedFaceSet with creaseAngle: per-corner expansion, Newell face normals, normals averaged over the faces at a vertex that lie within creaseAngle of this corner's face (19775-1 13.3.6) */
const _geometryData0 = B_.geometryData;
B_.geometryData = function (g) {
  if (g.type !== 'IndexedFaceSet' || (g.f.normal && g.f.normal.f.vector.length) || !(g.f.coord && g.f.coord.f.point.length)) return _geometryData0.call(this, g);
  const f = g.f, ver = [g, f.coord, f.color, f.texCoord].map((x) => (x ? x.version || 0 : -1)).join('.');
  const hit = this.geoCache.get(g.id);
  if (hit && hit.ver === ver) return hit;
  const P = f.coord.f.point, ci = f.coordIndex, TC = f.texCoord && f.texCoord.f.point, TI = f.texCoordIndex && f.texCoordIndex.length ? f.texCoordIndex : ci;
  const C = f.color && f.color.type === 'Color' ? f.color.f.color : null, CI = f.colorIndex && f.colorIndex.length ? f.colorIndex : ci;
  const faces = []; let cur = [];
  for (let i = 0; i < ci.length; i++) { if (ci[i] < 0) { if (cur.length >= 3) faces.push(cur); cur = []; } else cur.push([ci[i], TI[i], CI[i]]); }
  if (cur.length >= 3) faces.push(cur);
  const ccw = f.ccw !== false, fn = [];
  for (const face of faces) { // Newell
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < face.length; k++) {
      const a = face[k][0] * 3, b = face[(k + 1) % face.length][0] * 3;
      nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1; const s = ccw ? 1 : -1;
    fn.push([nx / l * s, ny / l * s, nz / l * s]);
  }
  const byV = new Map();
  faces.forEach((face, fi) => { for (const c of face) { let l = byV.get(c[0]); if (!l) byV.set(c[0], l = []); l.push(fi); } });
  const cosCrease = Math.cos(f.creaseAngle || 0), pos = [], nrm = [], uv = [], col = [], idx = [];
  faces.forEach((face, fi) => {
    const base = pos.length / 3, n0 = fn[fi];
    for (const c of face) {
      pos.push(P[c[0] * 3], P[c[0] * 3 + 1], P[c[0] * 3 + 2]);
      let sx = n0[0], sy = n0[1], sz = n0[2];
      if (f.creaseAngle > 0) {
        sx = sy = sz = 0;
        for (const fj of byV.get(c[0])) { const n1 = fn[fj]; if (fj === fi || n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] >= cosCrease - 1e-9) { sx += n1[0]; sy += n1[1]; sz += n1[2]; } }
        const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
      }
      nrm.push(sx, sy, sz);
      if (TC) uv.push(TC[c[1] * 2], TC[c[1] * 2 + 1]);
      if (C) col.push(C[c[2] * 3], C[c[2] * 3 + 1], C[c[2] * 3 + 2]);
    }
    for (let i = 1; i + 1 < face.length; i++) { if (ccw) idx.push(base, base + i, base + i + 1); else idx.push(base, base + i + 1, base + i); }
  });
  const out = { ver, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx), uv: TC ? Float32Array.from(uv) : null, col: C ? Float32Array.from(col) : null };
  this.geoCache.set(g.id, out);
  return out;
};

/* geometry: ColorRGBA with per-vertex alpha, vertex colours multiply the unlit emissive */
const _geometryData = B_.geometryData;
B_.geometryData = function (g) {
  const c = g.f.color;
  if (!c || c.type !== 'ColorRGBA') return _geometryData.call(this, g);
  const ver = [g, g.f.coord, g.f.normal, c, g.f.texCoord].map((x) => (x ? x.version || 0 : -1)).join('.');
  const hit = this.geoCache.get(g.id);
  if (hit && hit.ver === ver) return hit;
  const A = c.f.color, rgb = new Float32Array(A.length * 3), alpha = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) { rgb[i * 3] = A[i][0]; rgb[i * 3 + 1] = A[i][1]; rgb[i * 3 + 2] = A[i][2]; alpha[i] = A[i][3]; }
  const shim = { type: 'Color', version: c.version || 0, f: { color: rgb } };
  g.f.color = shim;
  let d; try { d = _geometryData.call(this, g); } finally { g.f.color = c; }
  d.colA = alpha; d.ver = ver; this.geoCache.set(g.id, d);
  return d;
};
B_.babylonGeometry = function (g, wantColor) {
  const d = this.geometryData(g);
  const key = g.id + (wantColor ? 'c' : 'n');
  const c = this.geoCache.get(key);
  if (c && c.ver === d.ver) return c.geo;
  if (c) c.geo.dispose();
  const vd = new BABYLON.VertexData();
  vd.positions = d.pos; vd.indices = d.idx;
  vd.normals = d.nrm || (() => { const n = new Float32Array(d.pos.length); BABYLON.VertexData.ComputeNormals(d.pos, d.idx, n, { useRightHandedSystem: true }); return n; })();
  if (d.uv) vd.uvs = d.uv;
  if (d.col || wantColor) {
    const nv = d.pos.length / 3, rgba = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) { rgba[i * 4] = d.col ? d.col[i * 3] : 1; rgba[i * 4 + 1] = d.col ? d.col[i * 3 + 1] : 1; rgba[i * 4 + 2] = d.col ? d.col[i * 3 + 2] : 1; rgba[i * 4 + 3] = d.colA ? d.colA[i] : 1; }
    vd.colors = rgba;
  }
  const geo = new BABYLON.Geometry('geo-' + key, this.scene, undefined, true);
  vd.applyToGeometry(geo, false);
  this.geoCache.set(key, { ver: d.ver, geo });
  return geo;
};
/* a Shape with vertex colours: mesh.hasVertexAlpha + useVertexColors on the material */
const _makeMesh = B_.makeMesh;
B_.makeMesh = function (shape, g, spec, passIndex) {
  let mesh;
  if (g.type === 'Cone') {
    mesh = BABYLON.MeshBuilder.CreateCylinder((shape.def || 'shape') + '-cone', { diameterTop: 0, diameterBottom: g.f.bottomRadius * 2, height: g.f.height, tessellation: 24, cap: g.f.bottom ? BABYLON.Mesh.CAP_START : BABYLON.Mesh.NO_CAP }, this.scene);
    mesh.material = this.makeMaterial(shape, g, spec, mesh); mesh.alphaIndex = 0;
  } else mesh = _makeMesh.call(this, shape, g, spec, passIndex);
  if (!mesh) return mesh;
  const m = mesh.material;
  if (g.f && g.f.color && (g.type === 'IndexedTriangleSet' || g.type === 'IndexedFaceSet')) {
    if (m instanceof BABYLON.StandardMaterial && spec.kind === 'xunlit') {
      mesh.hasVertexAlpha = g.f.color.type === 'ColorRGBA';
      m.useVertexColors = true; m.emissiveColor.set(0, 0, 0); m.diffuseColor.set(0, 0, 0); m.disableLighting = true;
      // lit by nothing: the vertex colour is the colour. StandardMaterial adds vertex colour to the diffuse term, so give it a white diffuse and no lights
      m.emissiveColor.set(0, 0, 0); m.useVertexColorsAsEmissive = true;
    }
  }
  if (spec.kind === 'xunlit' && mesh.material && mesh.material.alpha < 0.999) mesh.alphaIndex = 3;
  if (g.f.solid === false && m && m.backFaceCulling !== undefined) m.backFaceCulling = false;
  mesh.renderingGroupId = 1;                        // group 0 is the sky box, drawn first
  this.shadowRegister(shape, mesh);
  return mesh;
};
B_.shadowRegister = function (shape, mesh) {
  if (spec_noShadow(mesh)) return;
  const sg = DX.shadowGen;
  mesh.receiveShadows = true;                       // every drawn shape takes shadows; castShadow=false keeps a shape (road, terrain, decals) out of the shadow map
  if (sg && shape.f.castShadow !== false) sg.addShadowCaster(mesh);
};
function spec_noShadow(mesh) { return !mesh || (mesh.metadata && mesh.metadata.text); }

/* geometry changed from the page (skid chunks): rebuild once per frame */
B_.geometryChanged = function (n) { (this._dirtyGeo ||= new Set()).add(n); };
const _frame = B_.frame;
B_.frame = function () {
  if (this._dirtyGeo && this._dirtyGeo.size) {
    const dirty = this._dirtyGeo; this._dirtyGeo = new Set();
    const geos = new Set();
    for (const x of this.world.nodes) {
      if (x.type !== 'IndexedTriangleSet' && x.type !== 'IndexedFaceSet' && x.type !== 'IndexedLineSet') continue;
      if (dirty.has(x) || dirty.has(x.f.color) || dirty.has(x.f.coord) || dirty.has(x.f.normal)) geos.add(x);
    }
    for (const x of geos) {
      this.geoCache.delete(x.id);
      for (const key of [x.id, x.id + 'c', x.id + 'n']) { const c = this.geoCache.get(key); if (c) { c.geo.dispose(); this.geoCache.delete(key); } }
      for (const r of [...this.rec.values()]) if (r.node && r.node.type === 'Shape' && r.node.f.geometry === x && r.tn) this.rebuildShapeIn(r);
    }
  }
  this.followShadow();
  this.followSky();
  return _frame.call(this);
};

/* ------------------------------------------------------------------ build dispatcher: lights and particles inside the scene graph */
const _build = B_.build;
B_.build = function (n, parent, chain) {
  if (n && n.type === 'SpotLight') return this.buildSpot(n, parent, chain);
  if (n && n.type === 'PointLight') return this.buildPoint(n, parent, chain);
  if (n && n.type === 'ParticleSystem') return this.buildParticles(n, parent, chain);
  return _build.call(this, n, parent, chain);
};
const _buildShape = B_.buildShape;
B_.buildShape = function (n, parent, chain) {
  const r = _buildShape.call(this, n, parent, chain);
  return r;
};
B_.buildSpot = function (n, parent, chain) {
  const f = n.f, r = { node: n, chain: [n, ...chain] };
  const l = new BABYLON.SpotLight(n.def || 'spot', new BABYLON.Vector3(f.location[0], f.location[1], f.location[2]), new BABYLON.Vector3(f.direction[0], f.direction[1], f.direction[2]),
    Math.min(3.0, f.cutOffAngle * 2), Math.max(0, Math.min(8, (1 - f.beamWidth / Math.max(f.cutOffAngle, 1e-3)) * 4)), this.scene);
  l.parent = parent; l.node = n; r.light = l; this.rec.set(n.id, r);
  this.refreshPointish(l);
  return r;
};
B_.buildPoint = function (n, parent, chain) {
  const f = n.f, r = { node: n, chain: [n, ...chain] };
  const l = new BABYLON.PointLight(n.def || 'point', new BABYLON.Vector3(f.location[0], f.location[1], f.location[2]), this.scene);
  l.parent = parent; l.node = n; r.light = l; this.rec.set(n.id, r);
  this.refreshPointish(l);
  return r;
};
B_.refreshPointish = function (l) {
  const f = l.node.f, c = f.color;
  l.diffuse = toC3(c); l.specular = toC3(c);
  l.intensity = f.intensity * (this.opts.pointScale ?? this.opts.lightScale ?? 1); l.range = f.radius || 100;
  l.setEnabled(f.on !== false);
  if (l.setDirectionToTarget) { l.position.set(f.location[0], f.location[1], f.location[2]); if (l.direction) l.direction.set(f.direction[0], f.direction[1], f.direction[2]); }
};

/* ------------------------------------------------------------------ sun, shadows, fog, sky */
const _buildLights = B_.buildLights;
B_.buildLights = function () {
  if (DX.shadowGen) { try { DX.shadowGen.dispose(); } catch (e) { /* gone with the scene */ } DX.shadowGen = null; }
  _buildLights.call(this);
  this.applyFog();
  const sun = this.lights.find((l) => l.node && l.node.f.shadows);
  if (sun && this.opts.shadows !== false) {
    const sz = this.opts.shadowMap || 2048;
    const sg = new BABYLON.ShadowGenerator(sz, sun);
    sg.usePoissonSampling = true; sg.bias = 0.0004; sg.normalBias = 0.02;
    // X_ITE darkens the whole shaded point by shadowIntensity; here only the sun is taken away, so the shadow is made fully dark for the sun's share
    sg.setDarkness(Math.max(0, 1 - 1.4 * sun.node.f.shadowIntensity));
    sun.autoUpdateExtends = false; sun.autoCalcShadowZBounds = false;
    const half = this.opts.shadowHalf || 45;
    sun.orthoLeft = -half; sun.orthoRight = half; sun.orthoTop = half; sun.orthoBottom = -half;
    sun.shadowMinZ = 1; sun.shadowMaxZ = 260;
    DX.shadowGen = sg; this.sunLight = sun;
    for (const m of this.scene.meshes) { if (m.metadata && m.metadata.shape && !m.metadata.text) { m.receiveShadows = true; if (m.metadata.shape.f.castShadow !== false) sg.addShadowCaster(m); } }
  } else this.sunLight = null;
};
B_.followShadow = function () {
  const s = this.sunLight; if (!s || !this.scene.activeCamera) return;
  const c = this.scene.activeCamera, fwd = c.getForwardRay(1).direction;
  const fx = fwd.x, fz = fwd.z, fl = Math.hypot(fx, fz) || 1;
  const reach = this.opts.shadowReach ?? 18;
  const tx = Math.round(c.position.x + fx / fl * reach), tz = Math.round(c.position.z + fz / fl * reach), ty = Math.round(c.position.y - 2);
  const d = s.direction.normalizeToNew();
  s.position.set(tx - d.x * 130, ty - d.y * 130, tz - d.z * 130);
};
B_.applyFog = function () {
  const fog = this.world && this.world.nodes.find((x) => x.type === 'Fog');
  const sc = this.scene;
  if (!fog || !(fog.f.visibilityRange > 0)) { sc.fogMode = BABYLON.Scene.FOGMODE_NONE; return; }
  sc.fogMode = fog.f.fogType === 'EXPONENTIAL' ? BABYLON.Scene.FOGMODE_EXP : BABYLON.Scene.FOGMODE_LINEAR;
  // Babylon mixes the fog colour in AFTER tone mapping and the sRGB encode; X_ITE mixes it before (in linear). Give Babylon the colour as it would come out of the tone mapper.
  const c = fog.f.color, tm = this.tone === 'aces' || this.tone === 'standard';
  const nar = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))), enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  sc.fogColor = tm ? new BABYLON.Color3(enc(nar(c[0])), enc(nar(c[1])), enc(nar(c[2]))) : toC3(c); sc.fogStart = 0; sc.fogEnd = fog.f.visibilityRange; sc.fogDensity = 2.5 / fog.f.visibilityRange;
};
const _applyBackground = B_.applyBackground;
B_.applyBackground = function () {
  _applyBackground.call(this);
  const bg = this.world.nodes.find((x) => x.type === 'Background'); if (!bg) return;
  if (this.sky) { this.sky.material.reflectionTexture.dispose(); this.sky.material.dispose(); this.sky.dispose(); this.sky = null; }
  const f = bg.f, base = bg.base || this.baseUrl, S = 256;
  const order = (this.opts.skyOrder || 'right,top,back,left,bottom,front').split(','); // +x +y +z -x -y -z: X3D front looks down -Z, back down +Z
  const url = (k) => (f[k + 'Url'] && f[k + 'Url'].length ? this.resolve(f[k + 'Url'][0], base) : null);
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.4) - 0.055);
  const stops = (cols, ang, from) => { const o = []; cols.forEach((c, i) => o.push([i === 0 ? 0 : ang[i - 1], c])); return o; };
  const sky = stops(f.skyColor.length ? f.skyColor : [[0, 0, 0]], f.skyAngle), gnd = f.groundColor && f.groundColor.length ? stops(f.groundColor, f.groundAngle) : null;
  const at = (st, a) => { if (a <= st[0][0]) return st[0][1]; for (let i = 1; i < st.length; i++) if (a <= st[i][0]) { const t = (a - st[i - 1][0]) / Math.max(1e-6, st[i][0] - st[i - 1][0]), A = st[i - 1][1], B = st[i][1]; return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; } return st[st.length - 1][1]; };
  // direction of a texel on a cube face (face names as X3D sees them from inside)
  const dirOf = (face, u, v) => { const x = 2 * u - 1, y = 1 - 2 * v;
    switch (face) { case 'front': return [x, y, -1]; case 'back': return [-x, y, 1]; case 'left': return [-1, y, -x]; case 'right': return [1, y, x]; case 'top': return [x, 1, y]; default: return [x, -1, -y]; } };
  const pend = order.map((face) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const d = dirOf(face, (i + 0.5) / S, (j + 0.5) / S), l = Math.hypot(d[0], d[1], d[2]), ang = Math.acos(Math.max(-1, Math.min(1, d[1] / l)));
      let col; if (ang <= Math.PI / 2 || !gnd) col = at(sky, ang); else { const ga = Math.PI - ang; col = at(gnd, ga); }
      const o = (j * S + i) * 4; im.data[o] = enc(col[0]) * 255; im.data[o + 1] = enc(col[1]) * 255; im.data[o + 2] = enc(col[2]) * 255; im.data[o + 3] = 255; // X3D colours are linear; the canvas holds sRGB
    }
    g.putImageData(im, 0, 0);
    const u = url(face);
    if (!u) return res(c.toDataURL('image/png'));
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { g.drawImage(img, 0, 0, S, S); res(c.toDataURL('image/png')); };
    img.onerror = () => { this.note('sky face ' + face + ' did not load'); res(c.toDataURL('image/png')); };
    img.src = u;
  }));
  Promise.all(pend).then((urls) => {
    const cube = new BABYLON.CubeTexture('', this.scene, null, true, urls, null, (e) => this.note('sky: ' + e), BABYLON.Constants.TEXTUREFORMAT_RGBA, false, '.png');
    cube.coordinatesMode = BABYLON.Texture.SKYBOX_MODE; cube.gammaSpace = true;
    const box = BABYLON.MeshBuilder.CreateBox('sky', { size: 2000 }, this.scene);
    const m = new BABYLON.StandardMaterial('skym', this.scene);
    m.backFaceCulling = false; m.disableLighting = true; m.reflectionTexture = cube; m.diffuseColor.set(0, 0, 0); m.specularColor.set(0, 0, 0); m.fogEnabled = false;
    box.material = m; box.infiniteDistance = true; box.isPickable = false; box.renderingGroupId = 0; box.alwaysSelectAsActiveMesh = true; m.disableDepthWrite = true; // the sky box is only 1 km out; ridges and ground beyond it must still draw over it
    box.applyFog = false; box.metadata = { text: true, sky: true };
    this.sky = box;
  });
};
B_.followSky = function () { /* infiniteDistance keeps it on the eye */ };

/* ------------------------------------------------------------------ changes from the page */
const _changed = B_.changed;
B_.changed = function (node, field) {
  const t = node.type;
  if (t === 'UnlitMaterial') { for (const m of this.meshesOf.get(node.id) || []) if (m.material instanceof BABYLON.StandardMaterial) this.refreshUnlit(m.material, node, m.metadata && m.metadata.shape && m.metadata.shape.f.geometry); return; }
  if (t === 'Fog') { this.applyFog(); return; }
  if (t === 'ColorRGBA' && node.f && !node.ps) { this.geometryChanged(node); this.psRampChanged(node); return; }
  if (t === 'IndexedTriangleSet' && (field === 'index' || field === 'set_index')) { this.geometryChanged(node); return; }
  if (t === 'SpotLight' || t === 'PointLight') { const r = this.rec.get(node.id); if (r && r.light) this.refreshPointish(r.light); return; }
  if (t === 'ParticleSystem') { this.psChanged(node, field); return; }
  if (t === 'PointEmitter' || t === 'ConeEmitter' || t === 'PolylineEmitter') { this.emitterChanged(node, field); return; }
  if (t === 'DirectionalLight') { _changed.call(this, node, field); return; }
  if (t === 'Coordinate' || t === 'Color' || t === 'Normal') { this.geometryChanged(node); return; }
  if (t === 'Transform' && node.f.children && node.f.children.some((c) => c.type === 'ParticleSystem')) { _changed.call(this, node, field); this.psAnchorMoved(node); return; }
  return _changed.call(this, node, field);
};

/* ------------------------------------------------------------------ particles */
B_.buildParticles = function (n, parent, chain) {
  const f = n.f, em = f.emitter, r = { node: n, chain: [n, ...chain], kids: [] };
  this.rec.set(n.id, r);
  if (!em) return r;
  const cap = Math.max(10, Math.min(5000, f.maxParticles | 0));
  const ps = new BABYLON.ParticleSystem('ps-' + (n.def || n.id), cap, this.scene);
  const anchor = new BABYLON.TransformNode('psa-' + n.id, this.scene); anchor.parent = parent;
  const emesh = new BABYLON.Mesh('pse-' + n.id, this.scene); emesh.parent = anchor; emesh.isVisible = false; emesh.isPickable = false;
  ps.emitter = emesh;
  r.ps = ps; r.emesh = emesh; r.anchor = anchor; n.ps = r; em.psOwner = n;
  const ap = f.appearance, mat = ap && ap.f.material, tex = ap && ap.f.texture;
  let url = tex && tex.f.url && tex.f.url[0];
  const stretched = f.geometryType === 'LINE' || f.geometryType === 'POINT';
  if (url) ps.particleTexture = new BABYLON.Texture(this.resolve(url, tex.base || this.baseUrl), this.scene, true, false);
  else { const dt = new BABYLON.DynamicTexture('psdot', 16, this.scene, false); const cx = dt.getContext(); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 16, 16); dt.update(); ps.particleTexture = dt; }
  ps.blendMode = (mat && mat.f.emissiveColor && f.geometryType === 'LINE' && !url) ? BABYLON.ParticleSystem.BLENDMODE_ONEONE : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  if (stretched) ps.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_STRETCHED;
  const sz = f.particleSize; ps.minSize = ps.maxSize = 1;
  if (stretched) { ps.minScaleX = ps.maxScaleX = sz[0]; ps.minScaleY = ps.maxScaleY = sz[1]; } else { ps.minScaleX = ps.maxScaleX = sz[0]; ps.minScaleY = ps.maxScaleY = sz[1]; }
  const L = f.particleLifetime, v = f.lifetimeVariation;
  ps.minLifeTime = L * (1 - v); ps.maxLifeTime = L * (1 + v);
  ps.minEmitPower = 1; ps.maxEmitPower = 1; ps.updateSpeed = 1 / 60;
  ps.isLocal = false; ps.disposeOnStop = false;
  r.tint = mat ? mat.f.emissiveColor.slice() : [1, 1, 1];
  this.psEmitter(r); this.psPhysics(r); this.psRamp(r);
  ps.emitRate = f.createParticles ? cap / Math.max(0.05, L) : 0;
  ps.renderingGroupId = 1;
  ps.start();
  r.on = !!f.createParticles;
  return r;
};
B_.psEmitter = function (r) {
  const n = r.node, f = n.f, em = f.emitter, ps = r.ps, ef = em.f;
  r.emesh.position.set(ef.position[0], ef.position[1], ef.position[2]);
  const d = ef.direction, dl = Math.hypot(d[0], d[1], d[2]) || 1, u = [d[0] / dl, d[1] / dl, d[2] / dl], sp = ef.speed || 0, va = Math.min(1, ef.variation || 0);
  ps.minEmitPower = sp * (1 - va); ps.maxEmitPower = Math.max(sp * (1 + va), 0.0001);
  const mass = ef.mass || 1;
  if (em.type === 'ConeEmitter') {
    const ce = ps.createConeEmitter(0.02, Math.max(0.01, ef.angle));
    // Babylon's cone opens around +Y; the page uses +Y
    r.dirIsY = true;
  } else if (em.type === 'PolylineEmitter') {
    const pts = em.f.coord ? em.f.coord.f.point : [], idx = em.f.coordIndex || [];
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pts[i + k]); mx[k] = Math.max(mx[k], pts[i + k]); }
    if (pts.length) {
      const dv = new BABYLON.Vector3(u[0], u[1], u[2]);
      ps.createBoxEmitter(dv.clone(), dv.clone(), new BABYLON.Vector3(mn[0], mn[1], mn[2]), new BABYLON.Vector3(mx[0], mx[1], mx[2]));
    }
  } else {
    const dv1 = new BABYLON.Vector3(u[0] - va, u[1] - va, u[2] - va), dv2 = new BABYLON.Vector3(u[0] + va, u[1] + va, u[2] + va);
    ps.createPointEmitter(dv1, dv2);
  }
  r.mass = mass;
};
B_.psPhysics = function (r) {
  const ps = r.ps, ph = r.node.f.physics || [];
  const g = new BABYLON.Vector3(0, 0, 0);
  for (const m of ph) if (m.type === 'ForcePhysicsModel' && m.f.enabled !== false) g.addInPlace(new BABYLON.Vector3(m.f.force[0], m.f.force[1], m.f.force[2]).scale(1 / Math.max(0.01, r.mass || 1)));
  ps.gravity = g;
};
B_.psRamp = function (r) {
  const ps = r.ps, f = r.node.f, ramp = f.color, keys = f.colorKey || [], tn = r.tint || [1, 1, 1];
  ps.removeColorGradient && (ps._colorGradients = null);
  if (!ramp || !ramp.f.color.length) { ps.color1 = new BABYLON.Color4(tn[0], tn[1], tn[2], 1); ps.color2 = ps.color1.clone(); ps.colorDead = new BABYLON.Color4(tn[0], tn[1], tn[2], 0); return; }
  ramp.ps = true;
  const cs = ramp.f.color;
  for (let i = 0; i < cs.length; i++) {
    const k = keys.length === cs.length ? keys[i] : i / Math.max(1, cs.length - 1), c = cs[i];
    ps.addColorGradient(Math.min(1, Math.max(0, k)), new BABYLON.Color4(c[0] * tn[0], c[1] * tn[1], c[2] * tn[2], c[3] ?? 1));
  }
  ramp.owner = r;
};
B_.psRampChanged = function (ramp) {
  const r = ramp.owner; if (!r) { return; }
  r.ps._colorGradients = null;
  this.psRamp(r);
  ramp.ps = false; // ColorRGBA used by a particle system is not a geometry colour
};
B_.psChanged = function (node, field) {
  const r = node.ps; if (!r) return;
  if (field === 'createParticles') { r.on = !!node.f.createParticles; r.ps.emitRate = r.on ? Math.max(10, node.f.maxParticles | 0) / Math.max(0.05, node.f.particleLifetime) : 0; }
};
B_.emitterChanged = function (em, field) {
  const ps = em.psOwner; const r = ps && ps.ps; if (!r) return;
  if (field === 'position') r.emesh.position.set(em.f.position[0], em.f.position[1], em.f.position[2]);
  else if (field === 'speed' || field === 'variation') { const sp = em.f.speed || 0, va = Math.min(1, em.f.variation || 0); r.ps.minEmitPower = sp * (1 - va); r.ps.maxEmitPower = Math.max(sp * (1 + va), 0.0001); }
};
B_.psAnchorMoved = function () {};

/* the game owns the camera: no orbit, pan, zoom or picking from the pointer */
if (!window.__keepNav) for (const k of ['orbit', 'pan', 'zoom', 'userMoved', 'queuePick', 'click']) B_[k] = function () {};   // a page that is not a game (Chirp) keeps the EXAMINE navigation

/* a far ridge sits 3 to 4 km out: the page's NavigationInfo says visibilityLimit 9000 */
const _applyCamera = B_.applyCamera;
B_.applyCamera = function () {
  _applyCamera.call(this);
  const nav = this.world && this.world.nodes.find((n) => n.type === 'NavigationInfo');
  const lim = nav && nav.f.visibilityLimit > 0 ? nav.f.visibilityLimit : 0;
  if (lim) { this.cam.maxZ = lim * 1.05; this.cam.minZ = Math.min(this.cam.minZ, 0.25); }
};

/* A Material Odyssey on Babylon: what the film needs that the earlier ports did not.  Loaded after drift-ext.js and before sai.js.

   The file is a lit set: 35 PBR materials (base colour, metallic-roughness and normal maps), 60 lights, one Viewpoint driven by interpolators.
   Four things were missing from the body and are added here, each one an X3D rule rather than a taste:
     1. Lighting scope.  59 of the 60 lights have global="false": 19775-1 17.2.1 lights a shape only when the light is a sibling of it (or sits above it in the same group).
        Babylon lights every mesh unless told otherwise, and caps a material at 8 lights, so the scope IS the light budget: light.includedOnlyMeshes = the shapes under the light's parent.
        A shape in the hall sees its own group's 3 to 5 lights, not all 60.
     2. Light units.  intensity is candela and radius a hard range, the glTF punctual model that X_ITE's PhysicalMaterial uses: light.falloffType = FALLOFF_GLTF, range = radius,
        spot cone = 2 x cutOffAngle with an inner cone of 2 x beamWidth.
     3. metallicRoughnessTexture (glTF packing: roughness in green, metalness in blue), data textures read as linear, normal maps in the glTF (+Y) convention.
     4. Directional lights that sit in a group take the group's rotation (they are parented to it).
   The look layer (OD.on) only ADDS to the file and can be switched to "As authored": reflections from a generated gold-hall environment, bloom, grain, vignette, a little air.
   Nothing here asserts a light, a colour or a camera the X3D does not carry (Loom law 40). */
(function () {
  const B_ = Body.prototype, Q = new URLSearchParams(location.search);
  const OD = window.__odysseyLook = {
    on: Q.get('look') !== '0', lightScale: Q.has('lightScale') ? +Q.get('lightScale') : 1, envBase: Q.has('env') ? +Q.get('env') : 1, shadowLights: Q.get('shadows') === '0' ? 0 : 3,
    bloom: Q.has('bloom') ? +Q.get('bloom') : 0.32, grain: Q.has('grain') ? +Q.get('grain') : 7, dust: Q.get('dust') !== '0',
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const SCOPED = /^(SpotLight|PointLight|DirectionalLight)$/;

  /* ---------------------------------------------------------------- 1. lighting scope */
  /* A node placed twice with USE is two placements: <SpotLight USE="Rim"/> lights the group it is placed in as well as the group that holds the original. Each placement gets its own
     Babylon light, remembered with the transform node of the group it sits in; the shapes that light reaches are that group's descendants. */
  const _build = B_.build;
  B_.build = function (n, parent, chain) {
    if (n && n.type === 'DirectionalLight') {   // the body keeps one directional light per node; the film places two of them twice
      (this.dirPlacements ||= []).push({ n, tn: parent });
      return null;
    }
    return _build.call(this, n, parent, chain);
  };
  B_.meshesUnder = function (tn) { return tn.getChildMeshes(false).filter((m) => !(m.metadata && m.metadata.text)); };
  B_.applyLightScopes = function () {
    this.scopeStats = { scoped: 0, global: 0, empty: 0, perMeshMax: 0 };
    const count = new Map();
    for (const l of this.scene.lights) {
      if (!l.node) continue;
      if (l.node.f.global !== false || !l._scopeTN) { this.scopeStats.global++; continue; }
      const meshes = this.meshesUnder(l._scopeTN);
      if (!meshes.length) { l._scopeEmpty = true; l.setEnabled(false); this.scopeStats.empty++; continue; }   // an empty includedOnlyMeshes would mean "everything"
      l.includedOnlyMeshes = meshes; this.scopeStats.scoped++;
      for (const m of meshes) count.set(m, (count.get(m) || 0) + 1);
    }
    // the most lights any one mesh answers to (global lights reach every mesh): this has to stay under the material cap of 8
    const globals = this.scene.lights.filter((l) => l.node && !l.includedOnlyMeshes.length && !l._scopeEmpty).length;
    for (const v of count.values()) this.scopeStats.perMeshMax = Math.max(this.scopeStats.perMeshMax, v + globals);
  };
  const _buildLights = B_.buildLights;
  B_.buildLights = function () {
    _buildLights.call(this);
    for (const p of this.dirPlacements || []) {
      const l = new BABYLON.DirectionalLight(p.n.def || 'dir', new BABYLON.Vector3(0, -1, 0), this.scene);
      l.node = p.n; this.lights.push(l); this.refreshLight(l);
      if (p.n.f.global === false) { l._scopeTN = p.tn; l.parent = p.tn; }   // 4. the group's rotation turns the light
    }
    this.dirPlacements = [];
    this.applyLightScopes();
  };

  /* ---------------------------------------------------------------- 2. light units: glTF punctual lights */
  const _buildSpot = B_.buildSpot, _buildPoint = B_.buildPoint;
  const placed = function (body, n, l, parent) { l.falloffType = BABYLON.Light.FALLOFF_GLTF; l._scopeTN = parent; (body.lightsOf ||= new Map()).set(n, (body.lightsOf.get(n) || []).concat(l)); body.refreshPointish(l); };
  B_.buildSpot = function (n, parent, chain) { const r = _buildSpot.call(this, n, parent, chain); placed(this, n, r.light, parent); return r; };
  B_.buildPoint = function (n, parent, chain) { const r = _buildPoint.call(this, n, parent, chain); placed(this, n, r.light, parent); return r; };
  B_.refreshPointish = function (l) {
    const f = l.node.f, c = f.color;
    l.diffuse = new BABYLON.Color3(c[0], c[1], c[2]); l.specular = new BABYLON.Color3(c[0], c[1], c[2]);
    l.intensity = f.intensity * OD.lightScale;
    l.range = f.radius > 0 ? f.radius : Number.MAX_VALUE;
    l.position.set(f.location[0], f.location[1], f.location[2]);
    if (l instanceof BABYLON.SpotLight) {
      l.direction.set(f.direction[0], f.direction[1], f.direction[2]);
      l.angle = Math.min(Math.PI - 0.02, Math.max(0.02, f.cutOffAngle * 2));
      l.innerAngle = Math.min(l.angle, Math.max(0, f.beamWidth * 2));
    }
    l.setEnabled(f.on !== false && !l._scopeEmpty);
  };
  /* the interpolators move 56 intensities a frame: that path must not rebuild colours */
  const _changed = B_.changed;
  B_.changed = function (node, field) {
    if (node.type === 'SpotLight' || node.type === 'PointLight') {
      for (const l of (this.lightsOf && this.lightsOf.get(node)) || []) { if (field === 'intensity') l.intensity = node.f.intensity * OD.lightScale; else this.refreshPointish(l); }
      return;
    }
    if (node.type === 'DirectionalLight') { for (const l of this.lights) if (l.node === node) this.refreshLight(l); return; }
    return _changed.call(this, node, field);
  };

  /* ---------------------------------------------------------------- 3. materials */
  const _makeMaterial = B_.makeMaterial;
  B_.makeMaterial = function (shape, g, spec, mesh) {
    const m = _makeMaterial.call(this, shape, g, spec, mesh);
    if (spec.kind !== 'pbr' || !(m instanceof BABYLON.PBRMaterial)) return m;
    const f = spec.mat.f, app = shape.f.appearance;
    this._curTT = app && app.f.textureTransform;            // the Appearance's TextureTransform moves every map the material carries
    try {
      const mr = f.metallicRoughnessTexture && this.tex(f.metallicRoughnessTexture);
      if (mr) {
        mr.gammaSpace = false;                               // data, not colour
        m.metallicTexture = mr; m.useRoughnessFromMetallicTextureGreen = true; m.useMetallnessFromMetallicTextureBlue = true; m.useRoughnessFromMetallicTextureAlpha = false;
        m.metallic = f.metallic; m.roughness = f.roughness;  // glTF factors multiply the map
      }
      if (m.bumpTexture) m.bumpTexture.gammaSpace = false;
      for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture]) if (t) t.anisotropicFilteringLevel = 8;
    } finally { this._curTT = null; }
    m.enableSpecularAntiAliasing = true;                     // normal maps this fine shimmer without it (seen on the hex carpet at low resolution)
    m.environmentIntensity = 1;                              // the scene's generated environment (look on) or none (As authored: scene.environmentTexture is cleared)
    m.metallicF0Factor = 1;
    return m;
  };
  const _refreshPBR = B_.refreshPBR;
  B_.refreshPBR = function (m, mat) {
    _refreshPBR.call(this, m, mat);
    if (m.metallicTexture) { m.metallic = mat.f.metallic; m.roughness = mat.f.roughness; }
  };

  /* UnlitMaterial with an emissiveTexture: X3D 4.0 (and glTF) multiply the texture by the colour, and the film animates that colour (the corridor's slit-scan walls are black until
     their colour rises). Babylon's StandardMaterial ADDS an emissive texture to its emissive colour, so a texture at colour 0 would still glow and one at pink would flood pink.
     With lighting off StandardMaterial computes (emissiveColor + ambient) x the diffuse texture's colour (diffuseColor drops out with the lights): the texture moves to the diffuse slot, the colour stays in emissiveColor. */
  const _refreshUnlit = B_.refreshUnlit;
  B_.refreshUnlit = function (m, mat, g) {
    if (m.emissiveTexture && !m._odyTex) { m._odyTex = m.emissiveTexture; m.emissiveTexture = null; m.diffuseTexture = m._odyTex; m.useAlphaFromDiffuseTexture = false; m.zOffset = 4; m.zOffsetUnits = 8; }   // the file lays glow panels coplanar with lit floors (white room); X_ITE shows the floor, so the panel sits just behind it
    _refreshUnlit.call(this, m, mat, g);
  };

  /* Box, Sphere, Cylinder and Cone come from MeshBuilder, whose winding already suits Babylon in a right-handed scene; the body's counter-clockwise flag is for imported
     IndexedFaceSets and would turn a primitive inside out (the shelf's spheres drew hollow, dark in the middle and lit at the rim). */
  const _makeMesh = B_.makeMesh;
  B_.makeMesh = function (shape, g, spec, pass) {
    const mesh = _makeMesh.call(this, shape, g, spec, pass);
    if (mesh && mesh.material && /^(Box|Sphere|Cylinder|Cone)$/.test(g.type)) mesh.material.sideOrientation = null;
    return mesh;
  };

  /* ---------------------------------------------------------------- the first Viewpoint is bound at load (19775-1 23.3.4) */
  const _setWorld = B_.setWorld;
  B_.setWorld = function (world, baseUrl, resolve) {
    this.lightsOf = new Map(); this.dirPlacements = [];
    _setWorld.call(this, world, baseUrl, resolve);
    if (!this.bound) { const vp = world.nodes.find((n) => n.type === 'Viewpoint'); if (vp) this.bindViewpoint(vp, true); }
    this.lightRef = filmLightReference(world);
    if (!OD.installed) {
      OD.installed = true;
      try { this.installOdysseyLook(); } catch (e) { console.error(e); this.note('The look layer failed to start (' + (e && e.message) + '): drawing As authored'); OD.on = false; OD.failed = String(e && e.message || e); }
    }
    this.installShadows();
  };

  /* the film's own light level: the sum of intensity x luminance over the lights, sampled once a second along the interpolators; its 85th percentile is the reference
     the reflections follow (the same rule the three.js engine on this page uses, so the two engines agree about how much the room is lit) */
  function filmLightReference(world) {
    const lights = new Map();
    for (const r of world.routes) if (r.toField === 'intensity' && r.from.type === 'ScalarInterpolator' && SCOPED.test(r.to.type)) lights.set(r.to, r.from);
    for (const n of world.nodes) if (SCOPED.test(n.type) && !lights.has(n)) lights.set(n, null);
    const at = (ip, fr) => {
      const k = ip.f.key, v = ip.f.keyValue, N = Math.min(k.length, v.length); if (!N) return 0;
      if (fr <= k[0]) return v[0]; if (fr >= k[N - 1]) return v[N - 1];
      let i = 0; while (i < N - 1 && fr >= k[i + 1]) i++;
      const s = (fr - k[i]) / Math.max(1e-9, k[i + 1] - k[i]); return v[i] + (v[i + 1] - v[i]) * s;
    };
    const L = []; for (let t = 0; t < 138; t++) { let a = 0; for (const [n, ip] of lights) a += (ip ? at(ip, t / 138) : n.f.intensity) * lum(n.f.color); L.push(a); }
    L.sort((a, b) => a - b);
    return Math.max(1e-3, L[Math.floor(L.length * 0.85)] || 1);
  }

  /* ---------------------------------------------------------------- shadows: the key lights that carry the drama cast, the rest do not */
  const SHADOW_PRIORITY = ['Key', 'DaisPool', 'Oculus', 'EdgeL', 'EdgeR', 'Rim'];
  B_.installShadows = function () {
    OD.shadowGens = [];
    if (!OD.shadowLights) return;
    for (const def of SHADOW_PRIORITY) {
      if (OD.shadowGens.length >= OD.shadowLights) break;
      const l = this.scene.lights.find((x) => x.node && x.node.def === def && x instanceof BABYLON.SpotLight);
      if (!l || !l.includedOnlyMeshes || !l.includedOnlyMeshes.length) continue;
      const sg = new BABYLON.ShadowGenerator(1024, l);
      sg.usePercentageCloserFiltering = true; sg.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0006; sg.normalBias = 0.02; sg.setDarkness(0);
      l.shadowMinZ = 0.3; l.shadowMaxZ = Math.min(l.range, 90);
      for (const m of l.includedOnlyMeshes) { if (m.metadata && m.metadata.shape && m.metadata.shape.f.castShadow === false) continue; sg.addShadowCaster(m); m.receiveShadows = true; }
      l._shadowGen = sg; OD.shadowGens.push(sg);
    }
  };

  /* ---------------------------------------------------------------- the look: reflections, bloom, grain, vignette, air */
  /* a gold hall as a cube map: warm floor, amber horizon, black ceiling with long soft boxes; 8-bit sRGB canvases carry linear value / 6, the scene scales it back up */
  const HDR = 6;
  function goldHallCube(scene, engine, done) {
    const S = 128, order = ['right', 'top', 'back', 'left', 'bottom', 'front'];
    const dirOf = (face, u, v) => { const x = 2 * u - 1, y = 1 - 2 * v; switch (face) { case 'front': return [x, y, -1]; case 'back': return [-x, y, 1]; case 'left': return [-1, y, -x]; case 'right': return [1, y, x]; case 'top': return [x, 1, y]; default: return [x, -1, -y]; } };
    const enc = (v) => { v = Math.min(1, Math.max(0, v / HDR)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
    const col = (d) => {
      const l = Math.hypot(d[0], d[1], d[2]), x = d[0] / l, y = d[1] / l, z = d[2] / l;
      let r, g, b;
      if (y >= 0) { const t = Math.pow(y, 0.6); r = 0.34 * (1 - t) + 0.02 * t; g = 0.22 * (1 - t) + 0.016 * t; b = 0.12 * (1 - t) + 0.02 * t; }
      else { const t = Math.pow(-y, 0.5); r = 0.34 * (1 - t) + 0.10 * t; g = 0.22 * (1 - t) + 0.07 * t; b = 0.12 * (1 - t) + 0.045 * t; }
      // two long soft boxes high overhead (cream), one warm window low on one side
      const box = (cx, cz, hw, hl, k, c) => { const ax = Math.abs(x - cx), az = Math.abs(z - cz); if (y > 0.55 && ax < hw && az < hl) { const e = Math.min(1, (hw - ax) / 0.08, (hl - az) / 0.08); r += c[0] * k * e; g += c[1] * k * e; b += c[2] * k * e; } };
      box(-0.38, 0, 0.16, 0.95, 5, [1, 0.92, 0.78]); box(0.38, 0, 0.16, 0.95, 5, [1, 0.92, 0.78]);
      if (x > 0.7 && y > -0.1 && y < 0.5 && Math.abs(z) < 0.55) { r += 3.2; g += 2.3; b += 1.2; }
      return [r, g, b];
    };
    const urls = order.map((face) => {
      const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const v = col(dirOf(face, (i + 0.5) / S, (j + 0.5) / S)), o = (j * S + i) * 4;
        im.data[o] = enc(v[0]) * 255; im.data[o + 1] = enc(v[1]) * 255; im.data[o + 2] = enc(v[2]) * 255; im.data[o + 3] = 255;
      }
      g.putImageData(im, 0, 0); return c.toDataURL('image/png');
    });
    const cube = new BABYLON.CubeTexture('', scene, null, false, urls, null, null, BABYLON.Constants.TEXTUREFORMAT_RGBA, false, '.png');
    cube.gammaSpace = true;
    const noDiffuse = () => { try { cube.sphericalPolynomial = null; cube.irradianceTexture = null; } catch (e) { /* not set */ } };   // reflections only: the room is lit by the file's lights, not by this sky
    cube.onLoadObservable.addOnce(() => { noDiffuse(); try { new BABYLON.HDRFiltering(engine).prefilter(cube).then(() => { noDiffuse(); done && done(cube); }).catch(() => done && done(cube)); } catch (e) { done && done(cube); } });
    return cube;
  }

  B_.installOdysseyLook = function () {
    const scene = this.scene, cam = scene.activeCamera, body = this;
    OD.body = this;
    const env = OD.env = goldHallCube(scene, this.engine);
    const pipe = OD.pipe = new BABYLON.DefaultRenderingPipeline('odysseyHDR', true, scene, [cam]);
    pipe.samples = 4;
    pipe.bloomEnabled = true; pipe.bloomThreshold = 0.9; pipe.bloomWeight = OD.bloom; pipe.bloomKernel = 64; pipe.bloomScale = 0.5;
    pipe.grainEnabled = true; pipe.grain.intensity = OD.grain; pipe.grain.animated = true;
    const ip = pipe.imageProcessing;
    ip.toneMappingEnabled = true; ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; ip.exposure = 1;
    ip.vignetteEnabled = true; ip.vignetteWeight = 1.7; ip.vignetteStretch = 0.25; ip.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
    // air: slow dust turning in the lens' neighbourhood; additive, small, faint
    const tex = new BABYLON.DynamicTexture('dust-dot', 64, scene, true); const g = tex.getContext(); const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,215,1)'); grad.addColorStop(0.35, 'rgba(255,225,185,0.35)'); grad.addColorStop(1, 'rgba(255,220,170,0)'); g.fillStyle = grad; g.fillRect(0, 0, 64, 64); tex.update();
    const em = new BABYLON.Vector3(0, 0, 0), ps = OD.dustPs = new BABYLON.ParticleSystem('dust', 1400, scene);
    ps.particleTexture = tex; ps.emitter = em; ps.createBoxEmitter(new BABYLON.Vector3(0.03, 0.02, 0.03), new BABYLON.Vector3(-0.03, -0.01, -0.03), new BABYLON.Vector3(-9, -5, -9), new BABYLON.Vector3(9, 6, 9));
    ps.minLifeTime = 7; ps.maxLifeTime = 12; ps.emitRate = 150; ps.minSize = 0.012; ps.maxSize = 0.04; ps.color1 = new BABYLON.Color4(1, 0.93, 0.8, 0.45); ps.color2 = new BABYLON.Color4(1, 0.85, 0.6, 0.25); ps.colorDead = new BABYLON.Color4(1, 0.85, 0.6, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD; ps.updateSpeed = 0.012; ps.preWarmCycles = 120; ps.preWarmStepOffset = 4; ps.renderingGroupId = 1; ps.disposeOnStop = false; ps.start();
    OD.dustAnchor = em;
    OD.apply = (on) => {
      OD.on = on;
      scene.environmentTexture = on ? env : null;
      pipe.bloomEnabled = on; pipe.grainEnabled = on; ip.vignetteEnabled = on;
      pipe.imageProcessingEnabled = true;
      if (OD.dust) { if (on) ps.start(); else ps.stop(); }
      ps.isVisible = on;
      for (const sg of OD.shadowGens || []) sg.getShadowMap().refreshRate = on ? 1 : 0;
      for (const sg of OD.shadowGens || []) { sg.setDarkness(on ? 0 : 1); }   // As authored: no shadows (the file asks for none)
      scene.markAllMaterialsAsDirty(BABYLON.Constants.MATERIAL_TextureDirtyFlag);
    };
    OD.apply(OD.on);
  };

  /* per frame: the reflections follow the film's light, the air follows the lens */
  const _frame = B_.frame;
  B_.frame = function () {
    if (OD.installed && OD.on && this.world) {
      let level = 0; for (const l of this.scene.lights) if (l.node && l.node.f.intensity > 0 && !l._scopeEmpty) level += l.node.f.intensity * lum(l.node.f.color);
      const k = Math.min(1.3, Math.max(0.35, Math.sqrt(level / (this.lightRef || 1))));
      this.scene.environmentIntensity = OD.envBase * HDR * 0.3 * k;
      if (OD.dustAnchor && this.scene.activeCamera) OD.dustAnchor.copyFrom(this.scene.activeCamera.position);
    }
    return _frame.call(this);
  };

  /* counts for the page's About panel and the receipt */
  B_.odysseyInfo = function () {
    const s = this.scene;
    return { babylon: BABYLON.Engine.Version, meshes: s.meshes.length, lights: s.lights.length, materials: s.materials.length, textures: s.textures.length, active: s.getActiveMeshes().length,
      scope: this.scopeStats, look: OD.on, lightRef: this.lightRef, shadowLights: (OD.shadowGens || []).length };
  };
})();

/* Additive reader nodes for the Library of PolyXandria hall (port #9). Concatenated after brain/reader.js, drift/drift-ext.js and odyssey/odyssey-ext.js in the same bundle scope, so DEFS,
   CONTAINER, FLAT, IO/IN/OUT/INIT, GROUP, INTERPOLATORS and R are visible, and `interpolate` can be wrapped (it is a function declaration of the reader).
   Eight node types are new here; nothing that parses today is changed.

     Collision                  a Group (19775-1 23.4.1); the hall's "no collision" sun shield is one with enabled FALSE
     CoordinateInterpolator     MFVec3f keyValue, MFVec3f value_changed (19775-1 19.4.3), linear
     CoordinateInterpolator2D   the same for MFVec2f (Interpolation level 3)
     MultiTextureCoordinate     a list of TextureCoordinate nodes; a texture names one with its `mapping` (X3D 4.0, 18.4.1), so the lunette patches carry two channels
     PointProperties            pointSizeScaleFactor, min, max and attenuation of a PointSet (19775-1 12.4.3)
     Disk2D, Rectangle2D        the two flat shapes of Geometry2D, turned into an IndexedFaceSet at parse time (as ElevationGrid is in drift-ext)
     Extrusion                  spine, crossSection, scale, orientation, caps, creaseAngle (19775-1 13.3.5), turned into an IndexedFaceSet at parse time

   The two geometry conversions keep the node's own DEF and place; the body sees an IndexedFaceSet and its crease-angle normals. */
(function () {
  /* ------------------------------------------------------------------ tables */
  const FLATF = Float32Array;
  Object.assign(DEFS, {
    Collision: { ...GROUP, enabled: ['SFBool', IO, true], proxy: ['SFNode', INIT, null] },
    CoordinateInterpolator: { key: ['MFFloat', IO, []], keyValue: ['MFVec3f', IO, []], set_fraction: ['SFFloat', IN, 0], value_changed: ['MFVec3f', OUT, null] },
    CoordinateInterpolator2D: { key: ['MFFloat', IO, []], keyValue: ['MFVec2f', IO, []], set_fraction: ['SFFloat', IN, 0], value_changed: ['MFVec2f', OUT, null] },
    MultiTextureCoordinate: { texCoord: ['MFNode', IO, []] },
    PointProperties: { pointSizeScaleFactor: ['SFFloat', IO, 1], pointSizeMinValue: ['SFFloat', IO, 0], pointSizeMaxValue: ['SFFloat', IO, 1], attenuation: ['SFVec3f', IO, [1, 0, 0]] },
    Disk2D: { innerRadius: ['SFFloat', INIT, 0], outerRadius: ['SFFloat', INIT, 1], ...{ solid: ['SFBool', INIT, false] } },
    Rectangle2D: { size: ['SFVec2f', INIT, [2, 2]], solid: ['SFBool', INIT, false] },
    Extrusion: { beginCap: ['SFBool', INIT, true], endCap: ['SFBool', INIT, true], ccw: ['SFBool', INIT, true], convex: ['SFBool', INIT, true], creaseAngle: ['SFFloat', INIT, 0],
                 crossSection: ['MFVec2f', INIT, [[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]], orientation: ['MFRotation', INIT, [[0, 0, 1, 0]]], scale: ['MFVec2f', INIT, [[1, 1]]],
                 spine: ['MFVec3f', INIT, [[0, 0, 0], [0, 1, 0]]], solid: ['SFBool', INIT, true] },
  });
  DEFS.Collision.metadata = ['SFNode', IO, null];
  Object.assign(DEFS.TextureCoordinate, { mapping: ['SFString', IO, ''] });
  Object.assign(DEFS.PhysicalMaterial, { baseTextureMapping: ['SFString', IO, ''], emissiveTextureMapping: ['SFString', IO, ''], normalTextureMapping: ['SFString', IO, ''],
    metallicRoughnessTextureMapping: ['SFString', IO, ''], occlusionTextureMapping: ['SFString', IO, ''] });
  Object.assign(DEFS.Appearance, { pointProperties: ['SFNode', IO, null] });
  Object.assign(CONTAINER, { PointProperties: 'pointProperties', Disk2D: 'geometry', Rectangle2D: 'geometry', Extrusion: 'geometry', MultiTextureCoordinate: 'texCoord' });
  // a MultiTextureCoordinate's own children are TextureCoordinates: the container is its `texCoord` MFNode, which the generic parser already fills
  FLAT['CoordinateInterpolator.keyValue'] = FLATF; FLAT['CoordinateInterpolator2D.keyValue'] = FLATF;
  INTERPOLATORS.add('CoordinateInterpolator'); INTERPOLATORS.add('CoordinateInterpolator2D');

  /* ------------------------------------------------------------ interpolators */
  const _interpolate = interpolate;
  interpolate = function (n, frac) {
    if (n.type !== 'CoordinateInterpolator' && n.type !== 'CoordinateInterpolator2D') return _interpolate(n, frac);
    const k = n.f.key, kv = n.f.keyValue, dim = n.type === 'CoordinateInterpolator' ? 3 : 2, K = k.length;
    if (!K || kv.length < K * dim) return null;
    const m = Math.floor(kv.length / (K * dim)), stride = m * dim;      // points per key
    let i = 0, j = 0, s = 0;
    if (frac <= k[0]) i = j = 0;
    else if (frac >= k[K - 1]) i = j = K - 1;
    else { while (i < K - 1 && frac >= k[i + 1]) i++; j = Math.min(i + 1, K - 1); const span = k[j] - k[i]; s = span > 0 ? (frac - k[i]) / span : 0; }
    const out = new Float32Array(stride);                                 // a new array per event: the geometry holds the last one
    const a = i * stride, b = j * stride;
    if (i === j || s === 0) { for (let q = 0; q < stride; q++) out[q] = kv[a + q]; } else for (let q = 0; q < stride; q++) out[q] = kv[a + q] + (kv[b + q] - kv[a + q]) * s;
    return out;
  };

  /* ---------------------------------------------------------------- geometry */
  let serial = 9e6;
  const mkNode = (w, type, f) => { const n = { type, def: null, f, id: serial++, out: null }; w.nodes.push(n); return n; };
  const ifs = (w, n, P, UV, ci, ti, crease, ccw, solid) => {
    n.type = 'IndexedFaceSet';
    n.f = { coord: mkNode(w, 'Coordinate', { point: Float32Array.from(P) }), normal: null, color: null, texCoord: mkNode(w, 'TextureCoordinate', { point: Float32Array.from(UV), mapping: '' }), attrib: [],
            ccw, colorPerVertex: true, normalPerVertex: true, solid, coordIndex: Int32Array.from(ci), normalIndex: new Int32Array(0), colorIndex: [], texCoordIndex: Array.from(ti),
            convex: true, creaseAngle: crease, set_coordIndex: [], visible: true };
  };
  function disk(w, n) {
    const f = n.f, R1 = f.outerRadius, R0 = Math.max(0, Math.min(R1, f.innerRadius)), S = 96, P = [], UV = [], ci = [], ti = [];
    const ring = (r) => { for (let i = 0; i < S; i++) { const a = i / S * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r; P.push(x, y, 0); UV.push(0.5 + x / (2 * R1), 0.5 + y / (2 * R1)); } };
    if (R0 <= 0) {
      ring(R1); for (let i = 0; i < S; i++) { ci.push(i); ti.push(i); } ci.push(-1); ti.push(-1);
    } else {
      ring(R1); ring(R0);
      for (let i = 0; i < S; i++) { const j = (i + 1) % S; ci.push(i, S + i, S + j, j, -1); ti.push(i, S + i, S + j, j, -1); }
    }
    ifs(w, n, P, UV, ci, ti, 0, true, f.solid);
  }
  function rect(w, n) {
    const sx = n.f.size[0] / 2, sy = n.f.size[1] / 2;
    ifs(w, n, [-sx, -sy, 0, sx, -sy, 0, sx, sy, 0, -sx, sy, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 3, -1], [0, 1, 2, 3, -1], 0, true, n.f.solid);
  }

  /* Extrusion (19775-1 13.3.5): the spine-aligned cross-section plane at every spine point, scaled by `scale`, turned by `orientation`, placed on the spine */
  function extrusion(w, n) {
    const f = n.f, sp = f.spine, cs = f.crossSection, N = sp.length, M = cs.length;
    if (N < 2 || M < 2) { ifs(w, n, [0, 0, 0], [0, 0], [], [], 0, true, f.solid); return; }
    const v = R.v3, eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && (a.length < 3 || Math.abs(a[2] - b[2]) < 1e-6);
    const closedSpine = N > 2 && eq(sp[0], sp[N - 1]), closedCS = M > 2 && eq(cs[0], cs[M - 1]);
    const P3 = (i) => sp[closedSpine ? ((i % (N - 1)) + (N - 1)) % (N - 1) : i];
    // spine-aligned frames: Y along the spine tangent, Z the local binormal, X = Y x Z
    const Y = [], Z = [];
    for (let i = 0; i < N; i++) {
      let y;
      if (i === 0) y = closedSpine ? v.sub(sp[1], sp[N - 2]) : v.sub(sp[1], sp[0]);
      else if (i === N - 1) y = closedSpine ? v.sub(sp[1], sp[N - 2]) : v.sub(sp[N - 1], sp[N - 2]);
      else y = v.sub(sp[i + 1], sp[i - 1]);
      Y.push(v.norm(y));
      let z;
      if (i === 0 && closedSpine) z = v.cross(v.sub(sp[1], sp[0]), v.sub(sp[N - 2], sp[0]));
      else if (i === N - 1 && closedSpine) z = Z[0] ? Z[0].slice() : null;
      else if (i > 0 && i < N - 1) z = v.cross(v.sub(sp[i + 1], sp[i]), v.sub(sp[i - 1], sp[i]));
      else z = null;
      Z.push(z && v.len(z) > 1e-9 ? v.norm(z) : null);
    }
    if (!closedSpine) { const first = Z.find((z) => z); if (first) { if (!Z[0]) Z[0] = first.slice(); if (!Z[N - 1]) { for (let i = N - 2; i >= 0; i--) if (Z[i]) { Z[N - 1] = Z[i].slice(); break; } } } }
    if (!Z.some((z) => z)) {   // a straight spine: turn +Y onto the spine direction by the shortest rotation (19775-1 13.3.5)
      const t = Y[0], up = [0, 1, 0], ax = v.cross(up, t), l = v.len(ax), ang = Math.atan2(l, v.dot(up, t));
      const q = l < 1e-9 ? (v.dot(up, t) >= 0 ? [0, 0, 0, 1] : R.quat.fromAxisAngle([1, 0, 0], Math.PI)) : R.quat.fromAxisAngle(v.norm(ax), ang);
      const z0 = R.quat.rotate(q, [0, 0, 1]); for (let i = 0; i < N; i++) Z[i] = z0.slice();
    } else {
      let prev = null;                                                   // a point where three spine points are collinear takes the previous frame
      for (let i = 0; i < N; i++) { if (!Z[i]) Z[i] = prev ? prev.slice() : Z.find((z) => z).slice(); prev = Z[i]; }
      for (let i = 1; i < N; i++) if (v.dot(Z[i], Z[i - 1]) < 0) Z[i] = Z[i].map((x) => -x);   // no flips along the spine
    }
    const pts = new Array(N);
    for (let i = 0; i < N; i++) {
      const X = v.norm(v.cross(Y[i], Z[i])), sc = f.scale[Math.min(i, f.scale.length - 1)] || [1, 1], o = f.orientation[Math.min(i, f.orientation.length - 1)] || [0, 0, 1, 0];
      const q = R.quat.fromAxisAngle([o[0], o[1], o[2]], o[3]);
      pts[i] = cs.map((c) => { const r = R.quat.rotate(q, [c[0] * sc[0], 0, c[1] * sc[1]]); return [sp[i][0] + X[0] * r[0] + Y[i][0] * r[1] + Z[i][0] * r[2], sp[i][1] + X[1] * r[0] + Y[i][1] * r[1] + Z[i][1] * r[2], sp[i][2] + X[2] * r[0] + Y[i][2] * r[1] + Z[i][2] * r[2]]; });
    }
    // coordinate list: one point per (spine, cross-section) pair, with the closing duplicates folded onto the first ones so a crease angle smooths across the seam
    const Nu = closedSpine ? N - 1 : N, Mu = closedCS ? M - 1 : M, P = [], idx = (i, j) => (closedSpine ? i % (N - 1) : i) * Mu + (closedCS ? j % (M - 1) : j);
    for (let i = 0; i < Nu; i++) for (let j = 0; j < Mu; j++) P.push(...pts[i][j]);
    const UV = [], ci = [], ti = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) UV.push(j / (M - 1), i / (N - 1));
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
      ci.push(idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j), -1);
      ti.push(i * M + j, i * M + j + 1, (i + 1) * M + j + 1, (i + 1) * M + j, -1);
    }
    // caps: the cross-section polygon, planar texture coordinates
    let minx = 1e30, maxx = -1e30, miny = 1e30, maxy = -1e30;
    for (const c of cs) { minx = Math.min(minx, c[0]); maxx = Math.max(maxx, c[0]); miny = Math.min(miny, c[1]); maxy = Math.max(maxy, c[1]); }
    const capUV0 = UV.length / 2;
    for (const c of cs) UV.push((c[0] - minx) / Math.max(1e-9, maxx - minx), (c[1] - miny) / Math.max(1e-9, maxy - miny));
    const cap = (row, rev) => {
      const ring = [], tr = []; for (let j = 0; j < Mu; j++) { ring.push(idx(row, j)); tr.push(capUV0 + j); }
      if (rev) { ring.reverse(); tr.reverse(); }
      ci.push(...ring, -1); ti.push(...tr, -1);
    };
    if (f.beginCap) cap(0, true);
    if (f.endCap) cap(N - 1, false);
    ifs(w, n, P, UV, ci, ti, f.creaseAngle, f.ccw, f.solid);
  }
  const parse0 = R.parseX3D;
  R.parseX3D = function (text) {
    const w = parse0(text);
    for (const n of w.nodes) { if (n.type === 'Disk2D') disk(w, n); else if (n.type === 'Rectangle2D') rect(w, n); else if (n.type === 'Extrusion') extrusion(w, n); }
    return w;
  };
  /* A disabled TimeSensor forgets its pause (19775-1 8.4.2: disabling stops it and resets its state); the demiurge pause kept st.paused and st.shift across a disable, so a
   seek (disable, set the times, enable) of a paused film stayed frozen at the old time. The page seeks that way in both engines. */
const _tickHL = tickTimeSensor;
tickTimeSensor = function (n, now) {
  const st = n.state;
  if (!n.f.enabled && st && (st.paused || st.shift || st.active)) {              // stop it here: the pause rule would otherwise re-pause an active sensor before the disable is seen
    st.paused = false; st.shift = 0; n.f.isPaused = false;
    if (st.active) { st.active = false; n.f.isActive = false; events.emit(n, 'isActive', false); }
    return;
  }
  return _tickHL(n, now);
};
R.tickTimeSensor = tickTimeSensor;

R.hallInfo = { types: ['Collision', 'CoordinateInterpolator', 'CoordinateInterpolator2D', 'Disk2D', 'Extrusion', 'MultiTextureCoordinate', 'PointProperties', 'Rectangle2D'] };
})();

/* The Library of PolyXandria hall on Babylon: what the hall needs that the earlier ports did not.  Loaded after odyssey-ext.js and hall/reader-ext-hl.js, before sai.js.

   The Hall (library_v1_8_extras.x3d) has no shader at all: 88 PhysicalMaterials, 37 UnlitMaterials, 8 directional, 5 spot and 4 point lights, two real suns that cross it on a 299.52 s clock,
   and 187 ROUTEs. It is the first port that stands wholly on X3D 4.0's standard nodes. Six things were missing from the body, each one an X3D rule rather than a taste:
     1. MultiTextureCoordinate and the `...TextureMapping` fields (X3D 4.0): the lunette patches carry two texture-coordinate channels and a material says which map reads which. Babylon has the
        same idea (a second UV set and a per-texture coordinatesIndex), so the mapping is carried as written instead of merged.
     2. PointSet with PointProperties: WebGPU has no point size, so each point is one camera-facing quad whose size follows the node's own attenuation (scale / (a + b d + c d^2), clamped).
     3. BlendMode (X_ITE's extension, used by the glass and the sun patches): (SRC_ALPHA, ONE) is Babylon's ADD, (ONE, ONE) its ONEONE; anything else draws as the default blend and says so.
     4. Geometry animated by CoordinateInterpolator and CoordinateInterpolator2D: the vertex buffers are updated in place (the shapes are not rebuilt), 27 geometries a frame.
     5. Two suns with shadows: a cascaded shadow generator per DirectionalLight that asks for shadows (shadows="true", shadowIntensity 1), switched off while the sun is dark.
     6. ProximitySensor (the sun's glow follows the eye) and Collision (a Group).
   The look layer (HL.on) only ADDS to the file and can be switched to "As authored": bloom for the suns and lamps, a light vignette and grain.  Nothing here asserts a light, a colour or a camera
   the X3D does not carry (Loom law 40). */
(function () {
  const B_ = Body.prototype, Q = new URLSearchParams(location.search);
  const HL = window.__hallLook = {
    on: Q.get('look') !== '0', shadows: Q.get('shadows') !== '0', shadowSize: +(Q.get('sm') || 2048), cascades: +(Q.get('cascades') || 1), bloom: Q.has('bloom') ? +Q.get('bloom') : 0.28, grain: Q.has('grain') ? +Q.get('grain') : 4,
    lightScale: Q.has('ls') ? +Q.get('ls') : 1, installed: false,
  };
  const OD = window.__odysseyLook;                          // odyssey-ext's switches are read by its own frame hook; keep them quiet for the hall
  if (OD) { OD.on = false; OD.shadowLights = 0; OD.dust = false; }

  /* ---------------------------------------------------------------- Collision, ProximitySensor */
  const _build = B_.build;
  B_.build = function (n, parent, chain) {
    if (n && n.type === 'Collision') return this.buildGroup(n, parent, chain);                       // a Group (the hall asks for no collision; the viewer has none)
    if (n && n.type === 'ProximitySensor') { (this.prox ||= []).push({ node: n, parentTN: parent, inside: false }); return null; }
    if (n && (n.type === 'CoordinateInterpolator' || n.type === 'CoordinateInterpolator2D' || n.type === 'IntegerSequencer')) return null;   // routed by the event engine, nothing to draw
    return _build.call(this, n, parent, chain);
  };
  B_.stepProximity = function (now, eye) {
    if (!this.prox || !this.prox.length) return;
    R.events.begin(now);
    const q = this.pose.q, ang = 2 * Math.acos(Math.max(-1, Math.min(1, q[3]))), sn = Math.sqrt(Math.max(1e-12, 1 - q[3] * q[3]));
    const ori = sn < 1e-6 ? [0, 0, 1, 0] : [q[0] / sn, q[1] / sn, q[2] / sn, ang];
    for (const s of this.prox) {
      const n = s.node; if (n.f.enabled === false) continue;
      const M = s.parentTN && s.parentTN.computeWorldMatrix ? s.parentTN.computeWorldMatrix(true) : BABYLON.Matrix.Identity();
      const pl = BABYLON.Vector3.TransformCoordinates(eye, M.clone().invert()), c = n.f.center, h = n.f.size;
      const inside = h[0] > 0 && h[1] > 0 && h[2] > 0 && Math.abs(pl.x - c[0]) <= h[0] / 2 && Math.abs(pl.y - c[1]) <= h[1] / 2 && Math.abs(pl.z - c[2]) <= h[2] / 2;
      if (inside !== s.inside) {
        s.inside = inside; n.f.isActive = inside; n.f[inside ? 'enterTime' : 'exitTime'] = now;
        R.events.emit(n, 'isActive', inside); R.events.emit(n, inside ? 'enterTime' : 'exitTime', now);
      }
      if (inside) {
        n.f.position_changed = [pl.x, pl.y, pl.z]; n.f.orientation_changed = ori;
        R.events.emit(n, 'position_changed', n.f.position_changed); R.events.emit(n, 'orientation_changed', ori);
      }
    }
    R.events.drain();
  };

  /* ---------------------------------------------------------------- geometry: two channels, in-place updates */
  const _geometryData = B_.geometryData;
  B_.geometryData = function (g) {
    const tc = g.f && g.f.texCoord;
    if (!tc || tc.type !== 'MultiTextureCoordinate') return _geometryData.call(this, g);
    const kids = tc.f.texCoord || [];
    g.f.texCoord = kids[0] || null;                                                                   // channel 0 goes through the existing expansion (crease normals, per-corner uv)
    let d; try { d = _geometryData.call(this, g); } finally { g.f.texCoord = tc; }
    const second = kids[1];
    if (second && d.pos && g.type === 'IndexedFaceSet') {
      const ver = (second.version || 0) + ':' + (d.uvver || '');
      if (d.uv2ver !== ver || !d.uv2) {
        const f = g.f, ci = f.coordIndex, TC = second.f.point, TI = f.texCoordIndex && f.texCoordIndex.length ? f.texCoordIndex : ci, uv2 = [];
        let cur = [];
        const flush = () => { if (cur.length >= 3) for (const k of cur) uv2.push(TC[TI[k] * 2], TC[TI[k] * 2 + 1]); cur = []; };
        for (let i = 0; i < ci.length; i++) { if (ci[i] < 0) flush(); else cur.push(i); }
        flush();
        d.uv2 = Float32Array.from(uv2); d.uv2ver = ver;
      }
    }
    return d;
  };
  /* drift-ext's babylonGeometry with updatable buffers and the second channel */
  B_.babylonGeometry = function (g, wantColor) {
    const d = this.geometryData(g);
    const key = g.id + (wantColor ? 'c' : 'n'), c = this.geoCache.get(key), vkey = d.ver + '|' + (d.uv2ver || '');
    if (c && c.ver === vkey) return c.geo;
    if (c) c.geo.dispose();
    const vd = new BABYLON.VertexData();
    vd.positions = d.pos; vd.indices = d.idx;
    vd.normals = d.nrm || (() => { const n = new Float32Array(d.pos.length); BABYLON.VertexData.ComputeNormals(d.pos, d.idx, n, { useRightHandedSystem: true }); return n; })();
    if (d.uv) vd.uvs = d.uv;
    if (d.uv2) vd.uvs2 = d.uv2;
    if (d.col || wantColor) {
      const nv = d.pos.length / 3, rgba = new Float32Array(nv * 4);
      for (let i = 0; i < nv; i++) { rgba[i * 4] = d.col ? d.col[i * 3] : 1; rgba[i * 4 + 1] = d.col ? d.col[i * 3 + 1] : 1; rgba[i * 4 + 2] = d.col ? d.col[i * 3 + 2] : 1; rgba[i * 4 + 3] = d.colA ? d.colA[i] : 1; }
      vd.colors = rgba;
    }
    const geo = new BABYLON.Geometry('geo-' + key, this.scene, undefined, true);
    vd.applyToGeometry(geo, true);                         // updatable: CoordinateInterpolator writes the vertices every frame
    this.geoCache.set(key, { ver: vkey, geo });
    return geo;
  };
  /* the geometries a Coordinate / TextureCoordinate / Color / Normal node feeds (a Multi's children included) */
  B_.hlGeoUsers = function () {
    if (this._hlUsers && this._hlUsersWorld === this.world) return this._hlUsers;
    const m = new Map(), add = (k, g) => { if (!k) return; let l = m.get(k); if (!l) m.set(k, l = []); l.push(g); };
    for (const x of this.world.nodes) {
      if (x.type !== 'IndexedFaceSet' && x.type !== 'IndexedTriangleSet') continue;
      add(x.f.coord, x); add(x.f.normal, x); add(x.f.color, x); add(x.f.texCoord, x);
      if (x.f.texCoord && x.f.texCoord.type === 'MultiTextureCoordinate') for (const k of x.f.texCoord.f.texCoord) add(k, x);
    }
    this._hlUsersWorld = this.world; return (this._hlUsers = m);
  };
  const _changed = B_.changed;
  B_.changed = function (node, field) {
    const t = node.type;
    if (t === 'Coordinate' || t === 'TextureCoordinate') { const users = this.hlGeoUsers().get(node); if (users) { const s = (this._hlDirty ||= new Set()); users.forEach((g) => s.add(g)); } return; }
    if (t === 'Collision' || t === 'PointProperties') return;
    if (t === 'UnlitMaterial' || t === 'PhysicalMaterial' || t === 'Material') {
      _changed.call(this, node, field);
      for (const m of this.meshesOf.get(node.id) || []) { if (m._hlPoints) this.hlPointUniforms(m.material, m._hlSpec); else if (m.material && m.material._hlBlend) this.hlApplyBlend(m.material); }
      return;
    }
    return _changed.call(this, node, field);
  };
  B_.hlFlushGeometry = function () {
    const dirty = this._hlDirty; if (!dirty || !dirty.size) return;
    this._hlDirty = new Set();
    for (const g of dirty) {
      const d = this.geometryData(g);
      for (const suffix of ['n', 'c']) {
        const c = this.geoCache.get(g.id + suffix); if (!c) continue;
        const geo = c.geo;
        geo.updateVerticesData('position', d.pos, true);
        geo.updateVerticesData('normal', d.nrm || (() => { const n = new Float32Array(d.pos.length); BABYLON.VertexData.ComputeNormals(d.pos, d.idx, n, { useRightHandedSystem: true }); return n; })());
        if (d.uv) geo.updateVerticesData('uv', d.uv);
        if (d.uv2) geo.updateVerticesData('uv2', d.uv2);
        c.ver = d.ver + '|' + (d.uv2ver || '');
      }
    }
  };

  /* ---------------------------------------------------------------- materials: texture mapping, BlendMode */
  const _makeMaterial = B_.makeMaterial;
  B_.makeMaterial = function (shape, g, spec, mesh) {
    if (spec.kind === 'hlpoints') return this.hlPointMaterial(shape, g, spec, mesh);
    const m = _makeMaterial.call(this, shape, g, spec, mesh);
    if (!m) return m;
    const tcNode = g.f && g.f.texCoord, kids = tcNode && tcNode.type === 'MultiTextureCoordinate' ? tcNode.f.texCoord : null;
    if (kids && kids.length > 1 && spec.kind === 'pbr' && m instanceof BABYLON.PBRMaterial) {
      const f = spec.mat.f, idx = (name) => { const i = kids.findIndex((k) => k.f.mapping && k.f.mapping === name); return i < 0 ? 0 : i; };
      if (m.albedoTexture) m.albedoTexture.coordinatesIndex = idx(f.baseTextureMapping);
      if (m.emissiveTexture) m.emissiveTexture.coordinatesIndex = idx(f.emissiveTextureMapping);
      if (m.bumpTexture) m.bumpTexture.coordinatesIndex = idx(f.normalTextureMapping);
      if (m.metallicTexture) m.metallicTexture.coordinatesIndex = idx(f.metallicRoughnessTextureMapping);
      if (m.ambientTexture) m.ambientTexture.coordinatesIndex = idx(f.occlusionTextureMapping);
    }
    const app = shape.f.appearance, bm = app && app.f.blendMode;
    if (bm && m instanceof BABYLON.Material) { m._hlBlend = bm; this.hlApplyBlend(m); (this.meshesOf.get(bm.id) || (this.meshesOf.set(bm.id, []), this.meshesOf.get(bm.id))).push(mesh); }
    return m;
  };
  B_.hlApplyBlend = function (m) {
    const b = m._hlBlend.f, s = b.sourceColorFactor, d = b.destinationColorFactor, E = BABYLON.Engine;
    let mode = E.ALPHA_COMBINE;
    if (s === 'SRC_ALPHA' && d === 'ONE') mode = E.ALPHA_ADD;
    else if (s === 'ONE' && d === 'ONE') mode = E.ALPHA_ONEONE;
    else if (!(s === 'SRC_ALPHA' && d === 'ONE_MINUS_SRC_ALPHA')) this.note('BlendMode (' + s + ', ' + d + ') is drawn as the default blend');
    m.alphaMode = mode; m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true;
  };
  const _refreshPBR = B_.refreshPBR;
  B_.refreshPBR = function (m, mat) { _refreshPBR.call(this, m, mat); if (m._hlBlend) this.hlApplyBlend(m); };
  const _refreshUnlit = B_.refreshUnlit;
  /* An UnlitMaterial's emissiveTexture alpha is the surface's coverage (X_ITE blends by it): the sky's horizon glow, the sun shafts, the halos and the lamp
     sprites are PNGs whose alpha is the whole shape. The odyssey colour-times-texture move reads the texture in the diffuse slot with its alpha off, so a shaft drew as an opaque
     amber slab. A PNG gets hasAlpha and alpha-from-diffuse here, sorted and with depth writes off; a JPEG has none and stays opaque. */
  B_.refreshUnlit = function (m, mat, g) {
    _refreshUnlit.call(this, m, mat, g);
    const t = m.diffuseTexture;
    if (t && /\.png(\?|$)/i.test(t.name || t.url || '')) {
      t.hasAlpha = true; m.useAlphaFromDiffuseTexture = true;
      m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND; m.disableDepthWrite = true;
    }
    if (m._hlBlend) this.hlApplyBlend(m);
  };

  /* ---------------------------------------------------------------- PointSet with PointProperties */
  const PT_VS = `
attribute position: vec3f;
attribute color: vec4f;
attribute corner: vec2f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform viewSize: vec2f;
uniform pp: vec4f;
uniform att: vec3f;
varying vColor: vec4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let mv = uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  let d = length(mv.xyz);
  let size = clamp(uniforms.pp.x / max(1e-6, uniforms.att.x + uniforms.att.y * d + uniforms.att.z * d * d), uniforms.pp.y, uniforms.pp.z);
  var cp = uniforms.projection * mv;
  cp.x = cp.x + vertexInputs.corner.x * (size / uniforms.viewSize.x) * cp.w;
  cp.y = cp.y + vertexInputs.corner.y * (size / uniforms.viewSize.y) * cp.w;
  vertexOutputs.vColor = vertexInputs.color;
  vertexOutputs.vUV = vec2f(vertexInputs.corner.x, -vertexInputs.corner.y) * 0.5 + 0.5;
  vertexOutputs.position = cp;
}`;
  const PT_FS = `
var tex0Sampler: sampler;
var tex0: texture_2d<f32>;
uniform tint: vec4f;
varying vColor: vec4f;
varying vUV: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = textureSample(tex0, tex0Sampler, fragmentInputs.vUV);
  fragmentOutputs.color = vec4f(fragmentInputs.vColor.rgb * uniforms.tint.rgb * t.rgb, fragmentInputs.vColor.a * uniforms.tint.a * t.a);
}`;
  const _materialsFor = B_.materialsFor;
  B_.materialsFor = function (shape, g, app) {
    if (g.type === 'PointSet') {
      const mat = app && app.f.material, tex = app && app.f.texture, pp = app && app.f.pointProperties;
      return [{ kind: 'hlpoints', mat, tex, pp, deps: [mat, tex, pp].filter(Boolean) }];
    }
    return _materialsFor.call(this, shape, g, app);
  };
  const _makeMesh = B_.makeMesh;
  B_.makeMesh = function (shape, g, spec, pass) {
    if (g.type !== 'PointSet') return _makeMesh.call(this, shape, g, spec, pass);
    const f = g.f, P = f.coord && f.coord.f.point; if (!P || !P.length) return null;
    const np = Math.floor(P.length / 3), C = f.color && f.color.f.color, cs = f.color && f.color.type === 'ColorRGBA' ? 4 : 3;
    const pos = new Float32Array(np * 12), col = new Float32Array(np * 16), cor = new Float32Array(np * 8), idx = new Uint32Array(np * 6), K = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < np; i++) {
      for (let c = 0; c < 4; c++) {
        const o = i * 4 + c;
        pos[o * 3] = P[i * 3]; pos[o * 3 + 1] = P[i * 3 + 1]; pos[o * 3 + 2] = P[i * 3 + 2];
        col[o * 4] = C ? C[i * cs] : 1; col[o * 4 + 1] = C ? C[i * cs + 1] : 1; col[o * 4 + 2] = C ? C[i * cs + 2] : 1; col[o * 4 + 3] = C && cs === 4 ? C[i * cs + 3] : 1;
        cor[o * 2] = K[c * 2]; cor[o * 2 + 1] = K[c * 2 + 1];
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const mesh = new BABYLON.Mesh((shape.def || 'points') + '-pts', this.scene);
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(mesh, false);
    mesh.setVerticesData('color', col, false, 4); mesh.setVerticesData('corner', cor, false, 2);
    mesh.material = this.makeMaterial(shape, g, spec, mesh);
    mesh.isPickable = false; mesh.renderingGroupId = 1; mesh.alphaIndex = 1; mesh._hlPoints = true; mesh._hlSpec = spec; mesh.metadata = { points: true };
    (this.hlPointMats ||= []).push(mesh.material);
    return mesh;
  };
  B_.hlPointMaterial = function (shape, g, spec) {
    BABYLON.ShaderStore.ShadersStoreWGSL['hlpointsVertexShader'] = PT_VS; BABYLON.ShaderStore.ShadersStoreWGSL['hlpointsFragmentShader'] = PT_FS;
    const m = new BABYLON.ShaderMaterial('points-' + (shape.def || shape.id), this.scene, { vertex: 'hlpoints', fragment: 'hlpoints' },
      { attributes: ['position', 'color', 'corner'], uniforms: ['worldView', 'projection', 'viewSize', 'pp', 'att', 'tint'], samplers: ['tex0'], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
    m.alphaMode = BABYLON.Engine.ALPHA_COMBINE; m.backFaceCulling = false; m.disableDepthWrite = true;
    const t = this.tex(spec.tex);
    if (t) { t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; m.setTexture('tex0', t); }
    else { if (!this._hlWhite) this._hlWhite = BABYLON.RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, this.scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE); m.setTexture('tex0', this._hlWhite); }
    m._hlSpec = spec; this.hlPointUniforms(m, spec);
    return m;
  };
  B_.hlPointUniforms = function (m, spec) {
    const pp = spec.pp ? spec.pp.f : { pointSizeScaleFactor: 1, pointSizeMinValue: 1, pointSizeMaxValue: 1, attenuation: [1, 0, 0] };
    const em = spec.mat ? spec.mat.f.emissiveColor : [1, 1, 1], tr = spec.mat ? spec.mat.f.transparency : 0;
    m.setVector4('pp', new BABYLON.Vector4(pp.pointSizeScaleFactor, pp.pointSizeMinValue, pp.pointSizeMaxValue, 0));
    m.setVector3('att', new BABYLON.Vector3(pp.attenuation[0], pp.attenuation[1], pp.attenuation[2]));
    m.setVector4('tint', new BABYLON.Vector4(em[0], em[1], em[2], 1 - tr));
  };

  /* ---------------------------------------------------------------- the suns: one cascaded shadow generator each */
  const _buildLights = B_.buildLights;
  B_.buildLights = function () {
    _buildLights.call(this);
    for (const sg of this.hlSun || []) { try { sg.dispose(); } catch (e) { /* gone with the scene */ } }
    this.hlSun = [];
    if (!HL.shadows) return;
    // WebGPU gives a vertex shader 16 varying locations and every shadow map spends two of them (light-space position, depth metric), a cascade each.
    // Five shadow lights (two suns, three lamps) at one map each is ten locations and fits; one cascaded sun (?cascades=2) pushes a mesh lit by all five to 16 and the pipeline is refused, so the default is one map per light.
    const suns = this.scene.lights.filter((l) => l instanceof BABYLON.DirectionalLight && l.node && l.node.f.shadows && !l._scopeEmpty)
      .sort((a, b) => (b.node.f.global ? 1 : 0) - (a.node.f.global ? 1 : 0) || b.node.f.intensity - a.node.f.intensity);
    let cascaded = false;
    for (const l of suns) {
      const csm = !cascaded && l.node.f.global && HL.cascades > 1; cascaded = cascaded || csm;
      const sg = csm ? new BABYLON.CascadedShadowGenerator(HL.shadowSize, l) : new BABYLON.ShadowGenerator(l.node.f.global ? HL.shadowSize : 1024, l);
      if (csm) { sg.numCascades = HL.cascades; sg.lambda = 0.85; sg.stabilizeCascades = true; sg.depthClamp = true; sg.autoCalcDepthBounds = false; sg.cascadeBlendPercentage = 0.08; sg.shadowMaxZ = 220; sg.normalBias = 0.02; }
      else { sg.normalBias = 0.02; }
      sg.usePercentageCloserFiltering = true; sg.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0025; sg.setDarkness(Math.max(0, 1 - l.node.f.shadowIntensity));
      for (const m of this.scene.meshes) {
        if (!m.metadata || !m.metadata.shape || m.metadata.text || m.metadata.points) continue;
        m.receiveShadows = true;
        if (m.metadata.shape.f.castShadow !== false && !(m.material && m.material._hlBlend)) sg.addShadowCaster(m);
      }
      sg._light = l; this.hlSun.push(sg);
    }
  };

  /* ---------------------------------------------------------------- the look: bloom, vignette, grain (all additions, all off in "As authored") */
  B_.installOdysseyLook = function () {
    const scene = this.scene, cam = scene.activeCamera;
    HL.body = this;
    const pipe = HL.pipe = new BABYLON.DefaultRenderingPipeline('hallHDR', true, scene, [cam]);
    pipe.samples = 4;
    pipe.bloomEnabled = true; pipe.bloomThreshold = 0.92; pipe.bloomWeight = HL.bloom; pipe.bloomKernel = 56; pipe.bloomScale = 0.5;
    pipe.grainEnabled = true; pipe.grain.intensity = HL.grain; pipe.grain.animated = true;
    const ip = pipe.imageProcessing;
    ip.toneMappingEnabled = true; ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; ip.exposure = 1;
    ip.vignetteEnabled = true; ip.vignetteWeight = 1.2; ip.vignetteStretch = 0.2; ip.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
    HL.apply = (on) => { HL.on = on; pipe.bloomEnabled = on; pipe.grainEnabled = on; ip.vignetteEnabled = on; pipe.imageProcessingEnabled = true; };
    HL.apply(HL.on); HL.installed = true;
  };

  /* ---------------------------------------------------------------- per frame */
  const _frame = B_.frame;
  B_.frame = function () {
    if (this.canvas.getClientRects().length === 0) return;                  // a hidden canvas draws nothing (X_ITE pauses a hidden browser too)
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    for (const m of this.hlPointMats || []) { if (m.isDisposed && m.isDisposed()) continue; try { m.setVector2('viewSize', new BABYLON.Vector2(w, h)); } catch (e) { /* not ready */ } }
    this.hlFlushGeometry();
    for (const sg of this.hlSun || []) { const l = sg._light, live = l.isEnabled() && l.intensity > 0.002; sg.getShadowMap().refreshRate = live ? 1 : 0; }
    if (this.world && this.scene.activeCamera) this.stepProximity((performance.timeOrigin + performance.now()) / 1000, this.scene.activeCamera.globalPosition);
    return _frame.call(this);
  };

  /* counts for the page's About panel and the receipt */
  B_.hallInfo = function () {
    const s = this.scene;
    return { babylon: BABYLON.Engine.Version, meshes: s.meshes.length, lights: s.lights.length, materials: s.materials.length, textures: s.textures.length, active: s.getActiveMeshes().length,
      scope: this.scopeStats, suns: (this.hlSun || []).length, look: HL.on, notes: [...this.notes] };
  };
})();

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
      case 'MFColor': case 'MFVec3f': { const f = isTyped(v) ? v : flat3(v); if (isTyped(cur)) return Float32Array.from(f); const o = []; for (let i = 0; i + 2 < f.length; i += 3) o.push([f[i], f[i + 1], f[i + 2]]); return o; }
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
  /* an MF field read from a node answers like X_ITE's field object: the list itself plus setValue / getValue (a flat typed array is accepted, as X_ITE does) */
  function mfField(raw, prop, type, list) {
    return new Proxy(list, {
      get(l, k) {
        if (k === 'setValue') return (v) => { R.receive(raw, prop, coerceFlat(raw, prop, fromSAI(type, v, raw.f[prop]))); };
        if (k === 'getValue') return () => toSAI(type, raw.f[prop]);
        const x = l[k]; return typeof x === 'function' ? x.bind(l) : x;
      },
    });
  }
  /* a field the body reads as a flat typed array (R.FLAT) is kept flat whichever way the page set it: an empty Coordinate parsed from the file starts as a plain list */
  function coerceFlat(raw, prop, r) {
    const T = R.FLAT && R.FLAT[raw.type + '.' + prop];
    if (!T || r instanceof T) return r;
    return T.from(Array.isArray(r) && Array.isArray(r[0]) ? r.flat() : r);
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
        if (/^MF/.test(fd[0])) return mfField(raw, prop, fd[0], toSAI(fd[0], v));
        return toSAI(fd[0], v);
      },
      set(_t, prop, value) {
        const fd = R.fdefsOf(raw)[prop];
        if (!fd) throw new Error(`${raw.type} has no field ${prop}`);
        if (prop === 'children' && fd[0] === 'MFNode') { raw.f.children = Array.from(value, unwrap); raw.version = (raw.version || 0) + 1; R.hooks.changed(raw, 'children'); return true; }
        const v = coerceFlat(raw, prop, fromSAI(fd[0], value, raw.f[prop]));
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
  /* an output the body itself produces (a TimeSensor's fraction_changed, time, isActive) also reaches the page's addFieldCallback listeners, once per timestamp */
  const emitBase = R.events.emit;
  R.events.emit = function (node, field, value) {
    const cb = node.cbs && node.cbs[field];
    if (cb && cb.size && !this.firedOut.has(node.id + '.' + field)) { const fd = R.fdefsOf(node)[field], sv = toSAI(fd ? fd[0] : '', value); for (const fn of cb.values()) { try { fn(sv); } catch (e) { console.error(e); } } }
    return emitBase.call(this, node, field, value);
  };
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
        for (const [name, [t, , d]] of Object.entries(def)) { const T = R.FLAT && R.FLAT[type + '.' + name]; n.f[name] = T ? new T(0) : t === 'MFNode' ? [] : R.clone(d); }
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
  /* An ImageTexture may list fallbacks (KANSEI lists "../textures/x.png" then "textures/x.png", so one page works from two folder depths). Babylon would request the first one for
     every node, get a 404 each time and only then try the next: thousands of failed requests on a page served from a sub-folder. Probe each distinct candidate once (HEAD, remembered)
     and put the first one that exists at the front. A candidate whose probe fails for a reason other than "not found" keeps its place. Nothing is probed for embedded (single-file) pages. */
  const probed = new Map();
  const probe = (href) => { if (!probed.has(href)) probed.set(href, fetch(href, { method: 'HEAD' }).then((r) => (r.ok ? 1 : r.status === 404 ? 0 : 1), () => 1)); return probed.get(href); };
  async function preferLiveTextureUrls(world, base) {
    if (window.__VFS) return;
    const todo = world.nodes.filter((n) => n.type === 'ImageTexture' && n.f.url && n.f.url.length > 1);
    if (!todo.length) return;
    const abs = (n, u) => { try { return new URL(u, n.base || base).href; } catch { return null; } };
    const lists = new Map();
    for (const n of todo) { const key = n.f.url.map((u) => abs(n, u)).join('|'); if (!lists.has(key)) lists.set(key, []); lists.get(key).push(n); }
    await Promise.all([...lists].map(async ([key, nodes]) => {
      const hrefs = key.split('|'); let pick = 0;
      for (let i = 0; i < hrefs.length; i++) { if (hrefs[i] && (await probe(hrefs[i]))) { pick = i; break; } }
      if (pick > 0) for (const n of nodes) n.f.url = [n.f.url[pick], ...n.f.url.filter((_, i) => i !== pick)];
    }));
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
    getCurrentTime() { return (performance.timeOrigin + performance.now()) / 1000; },   // the clock the body's TimeSensors run on
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
      await preferLiveTextureUrls(world, sc._base);
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

/* Opt-in timing for the Babylon WebGPU pages (KANSEI, Neural Canvas). Off until the "Timing" button is pressed. It then measures the interval
   between requestAnimationFrame callbacks for about 20 s of whatever the page is doing, shows p50, p95 and p99 on screen and keeps the numbers
   on this page: nothing is sent anywhere (no fetch, no beacon). The GPU adapter and the browser are recorded beside the numbers so a figure is
   never separated from the machine it came from. A software adapter (SwiftShader, WARP, llvmpipe) is labelled on screen and its numbers must
   not be quoted (law 40: a fallback must say so).
   URL knobs: ?timing=0 hides the button, ?tsec=N sets the window (default 20 s), ?twarm=N the discarded warm-up (default 2 s).

   The page's boot file says what it is by setting window.__timingHooks once the body is up:
     { name, schema, engine() -> the Babylon engine, babylon: version string, adapter: body.adapterInfo,
       scene() -> { key: [..] (a change means the scene changed during the run), label: [..] (shown), fields: {..} (copied into the result) },
       inside: 'what the interval contains', adaptive: true when the page moves its own render scale, corner: 'left' | 'right' }
   window.__x3dBuild (set by the page builders) names the bundle that made the numbers. */
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

  function context(h) {
    const eng = h.engine && h.engine(), cv = eng && eng.getRenderingCanvas && eng.getRenderingCanvas();
    const s = (h.scene && h.scene()) || {};
    return { key: s.key || [], label: s.label || [], fields: s.fields || {}, canvas_px: cv ? [cv.width, cv.height] : null, device_pixel_ratio: window.devicePixelRatio || 1,
      hardware_scaling: eng && eng.getHardwareScalingLevel ? eng.getHardwareScalingLevel() : null };
  }
  function machine(h, battery) {
    const a = window.__adapter || null, info = (a && a.info) || {}, ai = h.adapter || {};
    const gpu = { vendor: info.vendor || ai.vendor || '', architecture: info.architecture || ai.architecture || '',
      device: info.device || '', description: info.description || ai.description || '',
      is_fallback: !!(info.isFallbackAdapter || (a && a.isFallbackAdapter)), timestamp_query: !!(a && a.features && a.features.has && a.features.has('timestamp-query')) };
    const software = gpu.is_fallback || SOFT.test([gpu.vendor, gpu.architecture, gpu.device, gpu.description].join(' '));
    return { user_agent: navigator.userAgent, platform: navigator.platform || '', cores: navigator.hardwareConcurrency || null, memory_gb: navigator.deviceMemory || null,
      battery, webgpu_adapter_request: window.__adapterVia || null, gpu, gpu_is_software: software, babylon: h.babylon || null };
  }

  function show(lines, tone) {
    body.replaceChildren();
    for (const [text, css] of lines) body.appendChild(mk('div', css || '', text));
    panel.style.display = 'block'; panel.style.borderColor = tone === 'warn' ? '#e0a030' : 'rgba(239,232,218,.28)';
  }
  const row = (text, css) => [text, 'margin:3px 0;' + (css || '')];

  function finish(h, dts, meta) {
    const s = dts.slice().sort((x, y) => x - y), n = s.length, mean = n ? s.reduce((x, y) => x + y, 0) / n : NaN;
    const worst = s.slice(Math.max(0, n - Math.max(1, Math.ceil(n * 0.01)))), lowMean = worst.length ? worst.reduce((x, y) => x + y, 0) / worst.length : NaN;
    const ctx1 = context(h), sceneChanged = JSON.stringify(meta.ctx0.key) !== JSON.stringify(ctx1.key);
    const m = machine(h, meta.battery);
    const res = {
      schema: h.schema || 'x3d.timing/1', app: h.name || null, utc: new Date().toISOString(), window_s: SEC, warmup_s: WARM, build: window.__x3dBuild || 'dev',
      page: Object.assign({}, ctx1.fields, { canvas_px: ctx1.canvas_px, device_pixel_ratio: ctx1.device_pixel_ratio, hardware_scaling: ctx1.hardware_scaling,
        hardware_scaling_at_start: meta.ctx0.hardware_scaling, scene_changed_during_run: sceneChanged }), machine: m,
      frames: n, fps_mean: r1(1000 / mean), ms: { p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)), mean: r1(mean), max: r1(s[n - 1]) },
      one_percent_low_fps: r1(1000 / lowMean), frames_over_33ms: s.filter((x) => x > 33.4).length, frames_over_50ms: s.filter((x) => x > 50).length,
      tab_hidden_during_run: meta.hidden,
      what_this_is: 'requestAnimationFrame interval (vsync-paced), includes ' + (h.inside || 'the page and the Babylon draw') + '; not GPU-only time; nothing was uploaded',
    };
    const bad = meta.hidden || n < 30, soft = m.gpu_is_software;
    const lines = [];
    if (soft) lines.push(row('Software rasteriser: these numbers do not count. Open the page in a browser with a real GPU adapter.', 'color:#ffcf70;font-weight:600'));
    if (meta.hidden) lines.push(row('The tab was hidden during the run, so the numbers are not valid. Run again and keep this tab in front.', 'color:#ffcf70;font-weight:600'));
    else if (n < 30) lines.push(row('Only ' + n + ' frames in ' + SEC + ' s: too few to quote (the page is not running at a usable rate here).', 'color:#ffcf70;font-weight:600'));
    lines.push(row('p50 ' + res.ms.p50 + ' ms    p95 ' + res.ms.p95 + ' ms    p99 ' + res.ms.p99 + ' ms    max ' + res.ms.max + ' ms', 'font-size:13px'));
    lines.push(row(n + ' frames in ' + SEC + ' s after ' + WARM + ' s warm-up, mean ' + res.fps_mean + ' fps, 1% low ' + res.one_percent_low_fps + ' fps, over 33 ms: ' + res.frames_over_33ms + ', over 50 ms: ' + res.frames_over_50ms));
    lines.push(row('GPU: ' + ([m.gpu.vendor, m.gpu.architecture, m.gpu.description || m.gpu.device].filter(Boolean).join(' / ') || 'not reported') + (m.gpu.is_fallback ? ' (fallback adapter)' : '') + '; adapter request: ' + (m.webgpu_adapter_request || '?'), 'opacity:.85'));
    lines.push(row('Browser: ' + navigator.userAgent, 'opacity:.7;word-break:break-all'));
    lines.push(row('Scene: ' + (ctx1.label.filter(Boolean).join(' / ') || '?') + (sceneChanged ? ' (changed during the run)' : '') + '; canvas ' + (ctx1.canvas_px ? ctx1.canvas_px.join('x') : '?') + ' at ' + ctx1.device_pixel_ratio + 'x, render scale 1/' + (ctx1.hardware_scaling == null ? '?' : r1(ctx1.hardware_scaling)) + (h.adaptive ? ' (the page\'s adaptive quality moves it)' : ''), 'opacity:.7'));
    lines.push(row('This is the interval between displayed frames (a 60 Hz screen caps it near 16.7 ms), including ' + (h.inside || 'the page and the Babylon draw') + '. It is not GPU-only time. Nothing was uploaded.', 'opacity:.6;font-size:11px'));
    show(lines, soft || bad ? 'warn' : '');
    const ta = mk('textarea', 'width:100%;height:84px;margin-top:6px;background:#0b0d14;color:#efe8da;border:1px solid rgba(239,232,218,.25);font:11px ' + MONO + ';box-sizing:border-box');
    ta.readOnly = true; ta.value = JSON.stringify(res, null, 1);
    const bar = mk('div', 'display:flex;gap:8px;margin-top:6px');
    const b = (t, fn) => { const x = mk('button', 'cursor:pointer;background:#1b1f2e;color:#efe8da;border:1px solid rgba(239,232,218,.35);border-radius:6px;padding:4px 10px;font:12px ' + MONO, t); x.onclick = fn; x.tabIndex = -1; x.addEventListener('mousedown', (e) => e.preventDefault()); return x; };
    const cp = b('Copy numbers', async () => { try { await navigator.clipboard.writeText(ta.value); cp.textContent = 'Copied'; } catch { ta.focus(); ta.select(); cp.textContent = 'Select + copy'; } setTimeout(() => { cp.textContent = 'Copy numbers'; }, 1800); });
    bar.append(cp, b('Run again', start), b('Close', () => { panel.style.display = 'none'; }));
    body.append(ta, bar);
    window.__timingResult = res;
    return res;
  }

  // the page's boot file picks the corner (a page with its own controls in the lower left asks for the right)
  function place(h) {
    if (!btn) return;
    const side = h && h.corner === 'right' ? 'right' : 'left', other = side === 'right' ? 'left' : 'right';
    for (const e of [btn, panel]) { e.style[side] = '10px'; e.style[other] = 'auto'; }
  }

  async function start() {
    if (running) { if (cancel) cancel(); return; }
    const h = window.__timingHooks;
    if (!h) { show([row('The page has not finished starting. Try again in a moment.')]); return; }
    place(h);
    running = true;
    let battery = null; try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { charging: b.charging, level: r1(b.level) }; } } catch { /* not offered */ }
    const meta = { hidden: document.hidden, battery, ctx0: context(h) }, dts = [];
    let t0 = null, last = null, raf = 0, lastLabel = 0;
    const done = (aborted) => { running = false; cancel = null; btn.textContent = 'Timing'; if (aborted) { show([row('Timing cancelled.')]); } else finish(h, dts, meta); };
    cancel = () => { cancelAnimationFrame(raf); done(true); };
    const onVis = () => { if (document.hidden) meta.hidden = true; };
    document.addEventListener('visibilitychange', onVis);
    show([row('Measuring for ' + (WARM + SEC) + ' s (' + WARM + ' s warm-up is thrown away). Keep this tab in front and use the page as you normally would. Press the button again to cancel.')]);
    const tick = (now) => {
      if (t0 === null) { t0 = now; }
      const el = (now - t0) / 1000;
      if (last !== null && el > WARM) dts.push(now - last);
      last = now;
      if (now - lastLabel > 250) { lastLabel = now; btn.textContent = 'Timing ' + Math.max(0, Math.ceil(WARM + SEC - el)) + ' s'; }
      if (el >= WARM + SEC) { document.removeEventListener('visibilitychange', onVis); done(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function install() {
    btn = mk('button', 'position:fixed;left:10px;bottom:10px;z-index:45;cursor:pointer;background:rgba(11,13,20,.72);color:#efe8da;border:1px solid rgba(239,232,218,.3);border-radius:999px;padding:4px 12px;font:11px ' + MONO + ';letter-spacing:.08em;opacity:.55', 'Timing');
    btn.title = 'Measure frame times on this machine for about ' + SEC + ' s. Off until pressed; nothing is uploaded.';
    btn.id = 'x3d-timing-btn';
    btn.onmouseenter = () => { btn.style.opacity = '1'; }; btn.onmouseleave = () => { btn.style.opacity = '.55'; };
    btn.onclick = (e) => { e.stopPropagation(); start(); };
    btn.tabIndex = -1; btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the page: Space must not press this button again
    panel = mk('div', 'position:fixed;left:10px;bottom:44px;z-index:45;display:none;width:min(430px,calc(100vw - 20px));max-height:70vh;overflow:auto;box-sizing:border-box;padding:10px 12px;background:rgba(11,13,20,.92);color:#efe8da;border:1px solid rgba(239,232,218,.28);border-radius:8px;font:12px/1.45 ' + MONO);
    panel.id = 'x3d-timing-panel';
    body = mk('div'); panel.appendChild(body);
    for (const ev of ['keydown', 'keyup', 'pointerdown']) panel.addEventListener(ev, (e) => e.stopPropagation());
    document.body.append(btn, panel);
  }
  window.__timingPlace = () => place(window.__timingHooks); // a boot file calls this right after it sets the hooks
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();

/* The Hall on Babylon WebGPU: the page (not this file) decides when to start it. It calls HallBabylon.create(container) and gets back the SAI browser (window.X3DSAI.B) plus the body;
   the page loads hall.x3d through B.loadURL and drives the film through the Film TimeSensor, as it does with X_ITE. Loaded last in babylon/bundle.js. */
window.HallBabylon = (function () {
  let gpuPatched = false;
  const patchAdapter = () => {   // the plain requestAdapter() answers on machines where the high-performance hint does not (x3d.loom PR 14)
    const gpu = navigator.gpu; if (!gpu || gpuPatched) return; gpuPatched = true;
    const orig = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async (opts) => {
      let a = null;
      for (const o of [undefined, opts, { powerPreference: 'low-power' }, { forceFallbackAdapter: true }]) { try { a = await orig(o); } catch (e) { a = null; } if (a) { window.__adapter = a; window.__adapterVia = o === undefined ? 'plain' : JSON.stringify(o); break; } }
      return a;
    };
  };
  const SOFT = /swiftshader|llvmpipe|lavapipe|software|basic render|warp/i;
  return {
    version: BABYLON.Engine.Version,
    ns: window.X3DSAI.X3D,
    async create(container, opts) {
      opts = opts || {};
      patchAdapter();
      const q = new URLSearchParams(location.search);
      if (window.__odysseyLook) { window.__odysseyLook.installed = false; window.__odysseyLook.shadowGens = []; }
      if (window.__hallLook) window.__hallLook.installed = false;
      const canvas = document.createElement('canvas');
      canvas.className = 'bjs'; canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
      canvas.tabIndex = 0; canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'The Hall of the Library of PolyXandria, drawn by Babylon.js on WebGPU. Drag to orbit, scroll to zoom, right-drag to pan.');
      container.appendChild(canvas);
      const notes = window.__hallNotes = [];
      let body;
      try {
        body = new Body(canvas, { onNote: (m) => { if (/decomposed to TRS|transformed/.test(m)) return; notes.push(m); console.info('[x3d to babylon]', m); if (opts.onNote) opts.onNote(m); },
          tone: 'neutral', normalGain: 1, invertNormalY: true, ccw: true, twoSided: true, shadows: false });
        await body.init();
        if (q.get('rz') !== '0') { try { body.engine.useReverseDepthBuffer = true; } catch (e) { notes.push('reversed depth buffer not available: ' + e.message); } }   // the galaxy is 2.4 km out, the lamps 0.3 m across
        if (q.has('scale')) body.engine.setHardwareScalingLevel(1 / Math.max(0.25, +q.get('scale')));
      } catch (e) { canvas.remove(); throw e; }
      X3DSAI.setBody(body);
      window.__hallBody = body;
      const soft = SOFT.test(JSON.stringify(body.adapterInfo || {}) + (window.__adapter && window.__adapter.isFallbackAdapter ? ' software' : ''));
      if (soft) notes.push('software WebGPU adapter: correctness only, speed figures from it mean nothing');
      const info = { babylon: BABYLON.Engine.Version, adapter: body.adapterInfo, via: window.__adapterVia || null, software: soft };
      window.__timingHooks = {
        name: 'Library Hall', schema: 'x3d.hall.timing/1', engine: () => body.engine, babylon: BABYLON.Engine.Version, adapter: body.adapterInfo,
        inside: "the page's own controls and the Babylon draw (two cascaded sun shadows, 88 PBR materials)", adaptive: false, corner: 'right',
        scene() { const vp = body.bound; const d = vp && vp.f ? vp.f.description : null; return { key: [d, !!(window.__hallLook && window.__hallLook.on)], label: [d], fields: { viewpoint: d, look: !!(window.__hallLook && window.__hallLook.on) } }; },
      };
      if (window.__timingPlace) window.__timingPlace();
      return {
        body, B: X3DSAI.B, ns: X3DSAI.X3D, canvas, info, notes,
        async ready() { await body.scene.whenReadyAsync(); },
        dispose() {
          try { body.engine.stopRenderLoop(); } catch (e) { /* already stopped */ }
          const eng = body.engine; eng.resize = () => {};
          try { body.scene.dispose(); } catch (e) { /* gone */ }
          try { eng.dispose(); } catch (e) { /* gone */ }
          canvas.remove();
        },
      };
    },
  };
})();

})();
