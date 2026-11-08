(function () {
"use strict";
window.__x3dBuild = "e79641f10c45";
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

/* Registry and material factory for the WGSL ports of the Gobbler 3 GLSL programs (x3d.webgpu/demo/src/gobbler/).
   Concatenated after brain/wgsl.js in one bundle scope; the per-shader files (wgsl-sky.js, wgsl-eye.js, ...) call gobRegister().
   One code path makes every material, for the page and for port-test.html, so what the test compiles is what the page runs.

   A port is { key, kind, attrs, uniforms, vs, fs, notes }.
     key       'VVVVVVVV-FFFFFFFF', the FNV-1a hashes of the whitespace-collapsed vertex and fragment GLSL (build-gobbler.py prints them).
     kind      'mesh' (triangles from IndexedFaceSet), 'points' (one quad per PointSet point, see below) or 'hidden' (draws nothing).
     attrs     Babylon vertex attribute names, position first: any of 'position' vec3f, 'normal' vec3f, 'color' vec4f, 'tc0' vec3f, 'corner' vec2f.
     uniforms  { name: 'f32' | 'vec3f' }: the ComposedShader fields the GLSL declares (phase, time, glow, bloom, scan, light0..light3).
     vs, fs    WGSL in Babylon's dialect (see brain/wgsl.js for the pattern: attribute/uniform/varying declarations, @vertex fn main(input: VertexInputs)).
   Uniforms the body always supplies, declare only the ones you use: worldView mat4x4f (model-view), projection mat4x4f, viewport vec4f (0, 0, width px, height px). */
const GOB_PORTS = {}, GOB_BY_HASH = {};
function gobRegister(name, port) { GOB_PORTS[name] = port; GOB_BY_HASH[port.key] = name; }

function gobMakeMaterial(scene, name, port, label) {
  const tag = 'gob-' + name;
  BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'VertexShader'] = port.vs;
  BABYLON.ShaderStore.ShadersStoreWGSL[tag + 'FragmentShader'] = port.fs;
  const m = new BABYLON.ShaderMaterial((label || tag), scene, { vertex: tag, fragment: tag },
    { attributes: port.attrs, uniforms: ['worldView', 'projection', 'viewport', ...Object.keys(port.uniforms || {})], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
  m.alphaMode = BABYLON.Engine.ALPHA_COMBINE;          // SRC_ALPHA, ONE_MINUS_SRC_ALPHA on colour: what X_ITE does for alphaMode BLEND
  m.backFaceCulling = false; m.disableDepthWrite = true;
  m.setVector4('viewport', new BABYLON.Vector4(0, 0, 640, 360));
  for (const [u, t] of Object.entries(port.uniforms || {})) gobSetUniform(m, u, t, t === 'f32' ? 0 : [0, 0, 0]);
  return m;
}
function gobSetUniform(m, name, type, v) {
  if (type === 'f32') m.setFloat(name, +v);
  else if (type === 'vec3f') m.setVector3(name, new BABYLON.Vector3(v[0], v[1], v[2]));
}

/* Sky and Hide: the backdrop dome and the "draw nothing" program. Term-for-term from the GLSL in gobbler3.x3d (SkyShader, Hide). */
gobRegister('sky', {
  key: '57378568-b3067a52', kind: 'mesh', attrs: ['position'], uniforms: {},
  notes: 'fragment dither uses the fragment position (WebGPU origin is top-left, GL bottom-left): the noise pattern is mirrored, its amplitude is the same',
  vs: `
attribute position: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
}`,
  fs: `
varying vDir: vec3f;
fn h1(p0: vec3f) -> f32 { var p = fract(p0 * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x);
  var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3f(1, 0, 0)), f.x), mix(h1(i + vec3f(0, 1, 0)), h1(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3f(0, 0, 1)), h1(i + vec3f(1, 0, 1)), f.x), mix(h1(i + vec3f(0, 1, 1)), h1(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
fn h2(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(fragmentInputs.vDir);
  let f = smoothstep(0.0, 0.4, -d.z);
  let q = d.xy / max(-d.z, 0.1);
  let a = (q - vec2f(-0.075, 0.03)) * vec2f(1.0, 1.3);
  let b = q - vec2f(0.2, -0.05);
  let n = vnoise(d * 9.0) * 0.6 + vnoise(d * 21.0) * 0.4;
  var col = vec3f(0.057, 0.050, 0.047)
          + f * vec3f(0.15, 0.095, 0.045) * exp(-dot(a, a) / 0.03) * (0.8 + 0.4 * n)
          + f * vec3f(0.085, 0.022, 0.032) * exp(-dot(b, b) / 0.05) * (0.7 + 0.6 * n)
          + f * vec3f(0.03, 0.02, 0.012) * smoothstep(0.55, 0.9, n) * exp(-dot(q, q) / 0.12);
  let fc = fragmentInputs.position.xy;
  col = col + (h2(fc) + h2(fc.yx + 17.0) - 1.0) / 255.0;
  fragmentOutputs.color = vec4f(col, 1.0);
}`,
});
// Hide has no pixels: every vertex is moved outside the clip volume and the fragment shader only discards.
gobRegister('hide', { key: '1a42dc70-060b0505', kind: 'hidden', attrs: ['position'], uniforms: {}, notes: 'the body builds no mesh for it', vs: '', fs: '' });

/* EyeShader: the iris, rings and the star the eye becomes while the head is apart. Term-for-term from the GLSL in gobbler3.x3d. */
gobRegister('eye', {
  key: '50c500f7-7a46fca5', kind: 'mesh', attrs: ['position'], uniforms: { time: 'f32', phase: 'f32' },
  notes: 'clip z bias: GLSL z -= 0.004 w on a [-1,1] depth range is 0.002 w on WebGPU [0,1]',
  vs: `
attribute position: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vP: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vP = vertexInputs.position.xy;
  var gp = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  gp.z = gp.z - 0.002 * gp.w;
  vertexOutputs.position = gp;
}`,
  fs: `
uniform time: f32;
uniform phase: f32;
varying vP: vec2f;
fn ring(r: f32, R: f32, w: f32, aa: f32) -> f32 { return 1.0 - smoothstep(w * 0.5, w * 0.5 + aa, abs(r - R)); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vP = fragmentInputs.vP;
  let r = length(vP);
  let aa = (abs(dpdx(r)) + abs(dpdy(r))) * 1.2 + 1e-4;
  let ang = atan2(vP.y, vP.x);
  let iris = 1.0 - smoothstep(0.2 - aa, 0.2 + aa, r);
  let fib = 0.5 + 0.5 * sin(ang * 27.0 + sin(ang * 5.0) * 2.5);
  var ic = mix(vec3f(1.0, 0.6, 0.14), vec3f(0.6, 0.24, 0.04), smoothstep(0.1, 0.2, r)) * (0.7 + 0.3 * fib);
  ic = mix(ic, vec3f(0.16, 0.05, 0.015), smoothstep(0.165, 0.2, r));
  ic = mix(ic, vec3f(0.018, 0.011, 0.008), 1.0 - smoothstep(0.105 - aa, 0.105 + aa, r));
  let c1 = vP - vec2f(-0.055, 0.065);
  let c2 = vP - vec2f(0.06, -0.045);
  ic = ic + vec3f(1.0, 0.97, 0.9) * (exp(-dot(c1, c1) * 1100.0) + 0.45 * exp(-dot(c2, c2) * 3000.0));
  let rg = ring(r, 0.26, 0.012, aa) + 0.8 * ring(length(vP * vec2f(1.0, 1.111)), 0.36, 0.01, aa)
         + 0.6 * ring(length(vP * vec2f(1.0, 1.25)), 0.46, 0.008, aa);
  let gw = exp(-pow((r - 0.2) * 14.0, 2.0)) * 0.4 * (1.0 - iris);
  var em = ic * iris + vec3f(0.95, 0.85, 0.6) * rg * (1.0 - iris) + vec3f(1.0, 0.58, 0.18) * gw;
  var a = clamp(iris + rg + gw, 0.0, 1.0);
  let st = smoothstep(0.17, 0.24, uniforms.phase) * (1.0 - smoothstep(0.84, 0.93, uniforms.phase));
  let tw = 0.8 + 0.2 * sin(uniforms.time * 2.3);
  let core = exp(-r * r * 260.0);
  let spk = (exp(-abs(vP.y) * 90.0) * exp(-abs(vP.x) * 6.0) + exp(-abs(vP.x) * 90.0) * exp(-abs(vP.y) * 6.0)) * 1.1;
  let star = clamp((core * 1.2 + spk + exp(-r * r * 28.0) * 0.35) * tw, 0.0, 1.0);
  let sc = mix(vec3f(1.0, 0.62, 0.22), vec3f(1.0, 0.95, 0.82), clamp(core * 1.5 + spk * 0.6, 0.0, 1.0));
  em = mix(em, sc * star, st);
  a = mix(a, star, st);
  if (a < 0.004) { discard; }
  fragmentOutputs.color = vec4f(min(em / max(a, 1e-3), vec3f(1.0)), a);
}`,
});

/* FacetShader: the gold facets of the head, their fire, and the scatter of the facets while the head is apart. Term-for-term from the GLSL in gobbler3.x3d (FacetShader). */
gobRegister('facet', {
  key: 'a2e1db0e-7e920071', kind: 'mesh', attrs: ['position', 'color', 'tc0'],
  uniforms: { phase: 'f32', time: 'f32', scan: 'f32', glow: 'f32', light0: 'vec3f', light1: 'vec3f', light2: 'vec3f', light3: 'vec3f' },
  notes: 'no clip z bias in this program. flat vFacet takes the FIRST vertex of the triangle on WebGPU (GL: the last), it is one corner of the facet either way. '
       + 'dpdx/dpdy give the same magnitudes as dFdx/dFdy, dpdy has the opposite sign (window y is down), which flips the cross product, and the GLSL already flips N toward the viewer. '
       + 'fwidth(bmin) is computed at the top of main (WGSL wants derivatives in uniform control flow), the GLSL calls it under branches and before a discard. '
       + 'smoothstep(0.0, -0.2, x) and smoothstep(0.13, 0.05, x) have edge0 > edge1, which WGSL rejects for constant edges: smoothstepR is the same Hermite formula with the edges as arguments. '
       + 'pow(x, 2.0) with a negative x (strip, hor, sc) is undefined in WGSL (exp2(log2(x) * y) is NaN on most backends): written as the square x * x, which is what the GLSL means.',
  vs: `
attribute position: vec3f;
attribute color: vec4f;
attribute tc0: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform phase: f32;
uniform time: f32;
uniform light0: vec3f;
uniform light1: vec3f;
uniform light2: vec3f;
uniform light3: vec3f;
varying vView: vec3f;
varying vObj: vec3f;
flat varying vL0: vec3f;
flat varying vL1: vec3f;
flat varying vL2: vec3f;
flat varying vL3: vec3f;
flat varying vFacet: vec3f;
varying vColor: vec4f;
varying vBary: vec3f;
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rnd3i(q: vec3i) -> vec3f { return vec3f(pcg3(vec3u(q + vec3i(4096)))) * (1.0 / 4294967296.0); }
fn qpos(p: vec3f) -> vec3i { return vec3i(floor(p * 100.0 + 0.5)); }
fn scatter(p: vec3f) -> vec4f {
  let q = qpos(p);
  let r = rnd3i(q);
  let g = (rnd3i(q + vec3i(37, 71, 13)) - 0.5) * 3.4;
  let u = clamp((p.x - -2.75) / (4.79 - -2.75), 0.0, 1.0);
  let jit = (r.x - 0.5) * 0.04;
  let l0 = 0.14 + 0.16 * (1.0 - u) + jit;
  let l1 = l0 + 0.2;
  let b0 = 0.6 + 0.12 * u + jit;
  let b1 = min(0.95, b0 + 0.2);
  if (uniforms.phase <= l0 || uniforms.phase >= b1) { return vec4f(p, 0.0); }
  var e: f32;
  var hold: f32;
  if (uniforms.phase < l1) { e = smoothstep(l0, l1, uniforms.phase); hold = 0.0; }
  else if (uniforms.phase <= b0) { e = 1.0; hold = (uniforms.phase - l1) / max(1e-4, b0 - l1); }
  else { e = 1.0 - smoothstep(b0, b1, uniforms.phase); hold = 1.0; }
  let s = select(0.0, sin(3.14159265 * e), e < 1.0);
  const c: f32 = 0.97030;
  const sn: f32 = -0.24188;
  let d = vec2f((p.x - 0.45) * 1.6, (p.y + 0.75) * 1.5);
  let tgt = vec3f(2.5 + d.x * c - d.y * sn + g.x * 0.36, -0.9 + d.x * sn + d.y * c + g.y * 0.36, 1.2 * p.z + g.z * 0.9);
  let curl = vec3f(0.0, 0.6 * sin(2.1 * p.x + 0.5), 0.6 * cos(1.7 * p.y));
  let drift = vec3f(0.3 + 0.1 * sin(3.0 * p.y), 0.12 * sin(2.0 * p.x), 0.15 * cos(2.0 * p.y));
  let live = 0.07 * e * vec3f(sin(uniforms.time * 0.9 + r.y * 6.283), cos(uniforms.time * 0.7 + r.z * 6.283), sin(uniforms.time * 0.5 + r.x * 6.283));
  return vec4f(p + (tgt - p) * e + curl * s + drift * hold * e + live, e);
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let s = scatter(vertexInputs.position);
  let mv = uniforms.worldView * vec4f(s.xyz, 1.0);
  vertexOutputs.vView = mv.xyz;
  vertexOutputs.vL0 = (uniforms.worldView * vec4f(uniforms.light0, 1.0)).xyz;
  vertexOutputs.vL1 = (uniforms.worldView * vec4f(uniforms.light1, 1.0)).xyz;
  vertexOutputs.vL2 = (uniforms.worldView * vec4f(uniforms.light2, 1.0)).xyz;
  vertexOutputs.vL3 = (uniforms.worldView * vec4f(uniforms.light3, 1.0)).xyz;
  vertexOutputs.vObj = vertexInputs.position;
  vertexOutputs.vFacet = vertexInputs.position;
  vertexOutputs.vColor = vertexInputs.color;
  vertexOutputs.vBary = vec3f(1.0 - vertexInputs.tc0.x - vertexInputs.tc0.y, vertexInputs.tc0.xy);
  vertexOutputs.position = uniforms.projection * mv;
}`,
  fs: `
uniform phase: f32;
uniform time: f32;
uniform scan: f32;
uniform glow: f32;
varying vView: vec3f;
varying vObj: vec3f;
flat varying vL0: vec3f;
flat varying vL1: vec3f;
flat varying vL2: vec3f;
flat varying vL3: vec3f;
flat varying vFacet: vec3f;
varying vColor: vec4f;
varying vBary: vec3f;
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rnd3i(q: vec3i) -> vec3f { return vec3f(pcg3(vec3u(q + vec3i(4096)))) * (1.0 / 4294967296.0); }
fn qpos(p: vec3f) -> vec3i { return vec3i(floor(p * 100.0 + 0.5)); }
fn h1(p0: vec3f) -> f32 { var p = fract(p0 * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x);
  var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(h1(i + vec3f(0.0, 1.0, 0.0)), h1(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(h1(i + vec3f(0.0, 0.0, 1.0)), h1(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(h1(i + vec3f(0.0, 1.0, 1.0)), h1(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
fn smoothstepR(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn burnD() -> f32 { return select(1.0 - clamp((uniforms.phase - 0.77) / 0.2, 0.0, 1.0), clamp((uniforms.phase - 0.07) / 0.2, 0.0, 1.0), uniforms.phase < 0.6); }
fn burnEdge(p: vec3f, d: f32) -> f32 {
  let u = clamp((p.x - -2.75) / (4.79 - -2.75), 0.0, 1.0);
  let n = vnoise(p * 1.1 + 1.7) * 0.32 + vnoise(p * 3.0 + vec3f(3.1, 3.1 - uniforms.time * 0.6, 3.1)) * 0.1;
  return select(u, 1.0 - u, uniforms.phase < 0.6) * 0.75 + n - d * 1.55 + 0.1;
}
fn mx3(c: vec3f) -> f32 { return max(max(c.r, c.g), c.b); }
fn mn3(c: vec3f) -> f32 { return min(min(c.r, c.g), c.b); }
// One coloured point light on a gold facet: a soft diffuse wash in the facet's own hue, and a highlight that keeps the light's colour.
fn pointLit(Lp: vec3f, LC: vec3f, N: vec3f, R: vec3f, tint: vec3f) -> vec3f {
  let Lv = Lp - fragmentInputs.vView;
  let dl = length(Lv);
  let Ld = Lv / dl;
  let att = 1.2 / (1.0 + 0.0075 * dl * dl);
  let dif = max(dot(N, Ld), 0.0);
  let rd = max(dot(R, Ld), 0.0);
  let sp = pow(rd, 30.0) * 1.7 + pow(rd, 7.0) * 0.28;
  return LC * att * (tint * dif * 0.55 + mix(tint, vec3f(1.0), 0.5) * sp);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vView = fragmentInputs.vView;
  let vObj = fragmentInputs.vObj;
  let vL0 = fragmentInputs.vL0;
  let vL1 = fragmentInputs.vL1;
  let vL2 = fragmentInputs.vL2;
  let vL3 = fragmentInputs.vL3;
  let vFacet = fragmentInputs.vFacet;
  let vColor = fragmentInputs.vColor;
  let vBary = fragmentInputs.vBary;
  // derivatives first, in uniform control flow, before any branch or discard
  let dVdx = dpdx(vView);
  let dVdy = dpdy(vView);
  let bmin = min(min(vBary.x, vBary.y), vBary.z);
  let fwbmin = abs(dpdx(bmin)) + abs(dpdy(bmin));
  var N = normalize(cross(dVdx, dVdy));      // flat, per facet
  let V = normalize(-vView);
  var NdV = dot(N, V);
  if (NdV < 0.0) { N = -N; NdV = -NdV; }
  // One set of random numbers per facet, keyed on the facet's own colour (constant across the facet).
  let cq = vec4i(floor(vColor * 1000.0 + 0.5));
  let fr = rnd3i(cq.xyz + vec3i(cq.w, 2 * cq.w, 3 * cq.w));
  let fr2 = rnd3i(cq.zxy + vec3i(91, 17, 53));
  let fid = fr.x;
  // The click: a fire front crosses the head in a few broad arcs, nape first. It reaches each facet as ONE value
  // (keyed on the facet's corner vFacet plus a per-facet jitter, not on the pixel), so facets go one by one with
  // straight edges: gold, then charred dark, then ignited (deep red to ember, flickering), then the facet burns
  // down to its centre. The cut is an inset copy of the facet (barycentrics), so it stays a straight-edged triangle,
  // with a white-hot rim 1.6 pixels wide and a ramp from white-hot at the cut through ember to deep red inside.
  let d = burnD();
  var edge = 1.0;
  var cut = 1.0;
  var rimHot = 0.0;
  var inner = 1.0;
  if (d > 0.0) {
    edge = burnEdge(vFacet, d) + (fr2.y - 0.5) * 0.07;
    let inset = smoothstepR(0.0, -0.2, edge) * 0.3334;
    if (inset > 0.0) {
      let px = (bmin - inset) / max(fwbmin, 1e-5);     // pixels inside the cut
      if (px < 0.0 || inset > 0.333) { discard; }
      cut = clamp(px, 0.0, 1.0);
      rimHot = 1.0 - smoothstep(1.6 * 0.6, 1.6, px);
      inner = clamp((bmin - inset) / max(0.3334 - inset, 1e-3), 0.0, 1.0);   // 0 at the cut, 1 at the centre
    }
  }
  let charW = smoothstepR(0.13, 0.05, edge);
  let heat = clamp(1.0 - edge / 0.05, 0.0, 1.0);
  let coreW = smoothstep(0.0, 0.25, heat);
  // Gold: Fresnel over a procedural studio (key softbox, strip light, horizon line, top fill).
  let base = vColor.rgb;
  let tint = base / max(mx3(base), 1e-3);                      // the facet's own hue at full value
  let hiHue = mix(tint, vec3f(1.0, 0.86, 0.58), 0.5);          // highlights stay in hue, never white or grey
  let flesh = clamp((base.r - base.g - 0.22) * 3.0, 0.0, 1.0);
  let Ne = normalize(N + (fr - 0.5) * 0.22);                   // a mosaic of facets
  let R = reflect(-V, Ne);
  let key = smoothstep(0.62, 0.96, dot(R, normalize(vec3f(-0.45, 0.6, 0.66))));
  let key2 = smoothstep(0.82, 0.98, dot(R, normalize(vec3f(0.55, 0.5, 0.67))));
  let stx = (R.x - 0.72) * 5.0;
  let strip = exp(-(stx * stx)) * smoothstep(-0.4, 0.4, R.y);
  let fill = smoothstep(0.55, 1.0, dot(R, normalize(vec3f(0.25, -0.25, 0.93))));
  let hrx = R.y * 5.5 + 0.35;
  let hor = exp(-(hrx * hrx));
  let top = smoothstep(0.3, 1.0, R.y);
  let env = vec3f(1.0, 0.88, 0.66) * (key * 2.1 + key2 * 1.3) + vec3f(1.0, 0.7, 0.4) * (strip * 0.9 + fill * 0.28)
          + vec3f(0.95, 0.6, 0.3) * hor * 0.5 + vec3f(0.5, 0.4, 0.3) * top * 0.25 + vec3f(0.035, 0.026, 0.02);
  let F0 = clamp(base * vec3f(1.2, 1.0, 0.72) * (0.75 + 0.5 * fid), vec3f(0.0), vec3f(1.0));
  let F = F0 + (hiHue - F0) * pow(1.0 - NdV, 5.0);            // grazing light goes to the facet's hue, not to white
  let metal = F * env;
  let L = normalize(vec3f(-0.5, 0.6, 0.62));
  let dif = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, normalize(L + V)), 0.0), 70.0);
  let skin = base * (0.3 + 0.7 * dif) + mix(base, vec3f(1.0, 0.86, 0.58), 0.5) * spec * 0.7 + base * strip * 0.45
           + vec3f(0.9, 0.3, 0.15) * pow(1.0 - NdV, 2.5) * 0.9;  // snood and wattle: lit from within, an ember rim
  var col = mix(metal, skin, flesh);
  let lit = pointLit(vL0, vec3f(1.0, 0.8, 0.42), N, R, hiHue) + pointLit(vL1, vec3f(1.0, 0.36, 0.09), N, R, hiHue) + pointLit(vL2, vec3f(0.12, 0.78, 1.0), N, R, hiHue) + pointLit(vL3, vec3f(0.66, 0.28, 1.0), N, R, hiHue);
  col += lit * 0.5 * (1.0 - 0.35 * flesh);
  let rim = pow(1.0 - NdV, 3.0);                             // Hokie maroon to ember at the edges
  col += mix(vec3f(0.55, 0.08, 0.17), vec3f(1.0, 0.46, 0.12), clamp(0.55 + vObj.y * 0.28, 0.0, 1.0)) * rim * 0.85;
  let Np = normalize(N + (fr2 - 0.5) * 0.3);
  let glint = pow(max(dot(reflect(-V, Np), normalize(vec3f(-0.45, 0.65, 0.6))), 0.0), 160.0);
  let flash = step(0.9, fid) * pow(0.5 + 0.5 * sin(uniforms.time * (1.1 + 2.0 * fid) + fid * 40.0), 40.0);
  col += mix(hiHue, vec3f(1.0, 0.95, 0.85), 0.35) * (glint * 1.5 + flash * 1.3) * (1.0 - 0.6 * flesh) * uniforms.glow;
  let scx = (vObj.x * 0.85 + vObj.y * 0.3 - uniforms.scan) * 2.4;
  let sc = exp(-(scx * scx));   // the energy scan
  col += (vec3f(1.0, 0.66, 0.26) * 0.45 + vec3f(1.0, 0.86, 0.6) * rim * 0.9) * sc * uniforms.glow;
  // No facet goes dead: saturation stays at 0.42 or more, along the facet's own hue, at the same value.
  let vmax = mx3(col);
  let sat = (vmax - mn3(col)) / max(vmax, 1e-4);
  let st = 1.0 - mn3(tint);
  let floorCol = vmax * (1.0 - min(1.0, 0.42 / max(st, 0.42)) * (1.0 - tint));
  col = mix(col, floorCol, clamp((0.42 - sat) / 0.42, 0.0, 1.0));
  // The fire, per facet: charred near-black ahead of the front, then the facet ignites. Its colour runs char, deep
  // red, ember, white-hot toward the cut, with a fine fast flicker inside, and a white-hot rim at the cut itself.
  col = mix(col, vec3f(0.07, 0.012, 0.012) + col * 0.08, charW * 0.92);
  if (heat > 0.0) {
    let fl = 0.7 + 0.7 * vnoise(vObj * 31.0 + vec3f(fid * 40.0, -uniforms.time * 7.0, uniforms.time * 3.0));   // fine, fast flicker
    let hot = heat * heat * (1.0 - 0.75 * smoothstep(0.0, 0.85, inner));   // hotter toward the cut, cooler at the centre
    var fire = mix(vec3f(0.42, 0.03, 0.025), vec3f(1.0, 0.34, 0.06) * 1.6, smoothstep(0.0, 0.55, hot));
    fire = mix(fire, vec3f(1.0, 0.8, 0.45) * 1.9, smoothstep(0.55, 1.0, hot));
    col = mix(col, fire * fl, coreW);
  }
  col = mix(col, vec3f(1.0, 0.94, 0.8) * 2.2, rimHot);
  // Highlights roll off without a hue shift: clipping each channel on its own turned bright gold lime.
  var m = mx3(col);
  col /= 1.0 + m * 0.12;
  m = mx3(col);
  if (m > 1.0) { col = mix(col / m, vec3f(1.0, 0.86, 0.58), clamp((m - 1.0) * 0.45, 0.0, 0.55)); }
  col *= 1.0;
  var a = clamp(vColor.a + rim * 0.2 + sc * 0.15, 0.0, 1.0);
  a = max(a, coreW);
  fragmentOutputs.color = vec4f(col, a * cut);
}`,
});

/* LineShader: the network ribbons (and the flywheel loops) as IndexedFaceSet quads. Term-for-term from the GLSL in gobbler3.x3d.
   Each ribbon quad is two triangles with four vertices: x3d_Vertex is one endpoint 'a' of the edge, x3d_TexCoord0.xyz the other endpoint 'b',
   x3d_Normal.xy a corner code through atan (code = (round(atan2(n.y, n.x) / (pi/8)) + 16) % 16: bit 0 = side, bit 1 = end, bit 2 / 3 = a / b not scattered), x3d_Color RGBA. */
gobRegister('line', {
  key: '623a753e-ff5d9002', kind: 'mesh', attrs: ['position', 'normal', 'tc0', 'color'],
  uniforms: { phase: 'f32', time: 'f32', scan: 'f32', bloom: 'f32', glow: 'f32', light0: 'vec3f', light1: 'vec3f', light2: 'vec3f', light3: 'vec3f' },
  notes: 'clip z bias: GLSL z -= 0.002 w on a [-1,1] depth range is 0.001 w on WebGPU [0,1]. '
       + 'x3d_Viewport.zw / .w are viewport.zw / viewport.w (f32); atan -> atan2; the corner code is an i32 (the % 16 operand is always >= 8, never negative); '
       + 'pcg3 uses vec3u, shifts need a vec3u right-hand side. '
       + 'smoothstep(0.09, 0.02, e) has edge0 > edge1: smoothstepR is the same Hermite formula with the edges as arguments. '
       + 'pow(x, 2.0) with a negative x (vHot, vScan) is undefined in WGSL (exp2(log2(x) * y) is NaN on most backends): written as the square x * x, which is what the GLSL means. '
       + 'the cull position (2,2,2,1) is outside the WebGPU clip volume as well. ca.xy += ... is written per component.',
  vs: `
attribute position: vec3f;
attribute normal: vec3f;
attribute tc0: vec3f;
attribute color: vec4f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform viewport: vec4f;
uniform phase: f32;
uniform time: f32;
uniform scan: f32;
uniform bloom: f32;
uniform light0: vec3f;
uniform light1: vec3f;
uniform light2: vec3f;
uniform light3: vec3f;
varying vColor: vec4f;
varying vX: f32;
varying vS: f32;
varying vPulse: f32;
varying vSeed: f32;
varying vFade: f32;
varying vScan: f32;
varying vBloom: f32;
varying vHeat: f32;
varying vHot: f32;
varying vPool: vec3f;
varying vLoop: f32;
varying vPh: f32;
varying vDel: f32;
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rnd3i(q: vec3i) -> vec3f { return vec3f(pcg3(vec3u(q + vec3i(4096)))) * (1.0 / 4294967296.0); }
fn qpos(p: vec3f) -> vec3i { return vec3i(floor(p * 100.0 + 0.5)); }
fn smoothstepR(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn scatter(p: vec3f) -> vec4f {
  let q = qpos(p);
  let r = rnd3i(q);
  let g = (rnd3i(q + vec3i(37, 71, 13)) - 0.5) * 3.4;
  let u = clamp((p.x - (-2.75)) / (4.79 - (-2.75)), 0.0, 1.0);
  let jit = (r.x - 0.5) * 0.04;
  let l0 = 0.14 + 0.16 * (1.0 - u) + jit;
  let l1 = l0 + 0.2;
  let b0 = 0.6 + 0.12 * u + jit;
  let b1 = min(0.95, b0 + 0.2);
  if (uniforms.phase <= l0 || uniforms.phase >= b1) { return vec4f(p, 0.0); }
  var e: f32;
  var hold: f32;
  if (uniforms.phase < l1) { e = smoothstep(l0, l1, uniforms.phase); hold = 0.0; }
  else if (uniforms.phase <= b0) { e = 1.0; hold = (uniforms.phase - l1) / max(1e-4, b0 - l1); }
  else { e = 1.0 - smoothstep(b0, b1, uniforms.phase); hold = 1.0; }
  let s = select(0.0, sin(3.14159265 * e), e < 1.0);
  const c: f32 = 0.97030;
  const sn: f32 = -0.24188;
  let d = vec2f((p.x - 0.45) * 1.6, (p.y + 0.75) * 1.5);
  let tgt = vec3f(2.5 + d.x * c - d.y * sn + g.x * 0.36, -0.9 + d.x * sn + d.y * c + g.y * 0.36, 1.2 * p.z + g.z * 0.9);
  let curl = vec3f(0.0, 0.6 * sin(2.1 * p.x + 0.5), 0.6 * cos(1.7 * p.y));
  let drift = vec3f(0.3 + 0.1 * sin(3.0 * p.y), 0.12 * sin(2.0 * p.x), 0.15 * cos(2.0 * p.y));
  let live = 0.07 * e * vec3f(sin(uniforms.time * 0.9 + r.y * 6.283), cos(uniforms.time * 0.7 + r.z * 6.283), sin(uniforms.time * 0.5 + r.x * 6.283));
  return vec4f(p + (tgt - p) * e + curl * s + drift * hold * e + live, e);
}
fn h1(p0: vec3f) -> f32 { var p = fract(p0 * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x);
  var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3f(1, 0, 0)), f.x), mix(h1(i + vec3f(0, 1, 0)), h1(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3f(0, 0, 1)), h1(i + vec3f(1, 0, 1)), f.x), mix(h1(i + vec3f(0, 1, 1)), h1(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
fn burnD() -> f32 { return select(1.0 - clamp((uniforms.phase - 0.77) / 0.2, 0.0, 1.0), clamp((uniforms.phase - 0.07) / 0.2, 0.0, 1.0), uniforms.phase < 0.6); }
fn burnEdge(p: vec3f, d: f32) -> f32 {
  let u = clamp((p.x - (-2.75)) / (4.79 - (-2.75)), 0.0, 1.0);
  let n = vnoise(p * 1.1 + 1.7) * 0.32 + vnoise(p * 3.0 + vec3f(3.1, 3.1 - uniforms.time * 0.6, 3.1)) * 0.1;
  return select(u, 1.0 - u, uniforms.phase < 0.6) * 0.75 + n - d * 1.55 + 0.1;
}
fn poolAt(p: vec3f) -> vec3f {
  let d0 = p - uniforms.light0;
  let d1 = p - uniforms.light1;
  let d2 = p - uniforms.light2;
  let d3 = p - uniforms.light3;
  return (vec3f(1.0, 0.8, 0.42) * exp(-dot(d0, d0) * 0.05) + vec3f(1.0, 0.36, 0.09) * exp(-dot(d1, d1) * 0.05) + vec3f(0.12, 0.78, 1.0) * exp(-dot(d2, d2) * 0.05) + vec3f(0.66, 0.28, 1.0) * exp(-dot(d3, d3) * 0.05)) * 0.9;
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let x3d_Normal = vertexInputs.normal;
  let x3d_Color = vertexInputs.color;
  let code = (i32(floor(atan2(x3d_Normal.y, x3d_Normal.x) / 0.39269908 + 0.5)) + 16) % 16;
  let side = select(-1.0, 1.0, (code & 1) == 1);
  let a = vertexInputs.position;
  let b = vertexInputs.tc0;
  let sa = select(scatter(a), vec4f(a, 0.0), (code & 4) != 0);
  let sb = select(scatter(b), vec4f(b, 0.0), (code & 8) != 0);
  let PM = uniforms.projection * uniforms.worldView;
  var ca = PM * vec4f(sa.xyz, 1.0);
  let cb = PM * vec4f(sb.xyz, 1.0);
  let vp = uniforms.viewport.zw;
  var dir = cb.xy / cb.w * vp - ca.xy / ca.w * vp;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / len, len > 1e-5);
  let bl = uniforms.bloom * select(0.45, 1.0, (code & 12) != 0);           // less bloom on the head's dense lattice
  // v3: a colour alpha of 0.7 or more marks a flywheel ribbon: alpha = 0.7 + 0.3 * (phase_q + 100 * span_q) / 400, where phase_q (0 to 99)
  // is where this edge starts round its loop (hundredths) and span_q (0 to 3) is how much of the loop it covers (0.06 + 0.04 * span_q).
  let cal = x3d_Color.a;
  let vLoop = step(0.699, cal);
  let idx = select(0.0, floor((cal - 0.7) / 0.3 * 400.0 + 0.5), vLoop > 0.5);
  let dq = floor(idx / 100.0);
  let vPh = (idx - 100.0 * dq) / 100.0;
  let vDel = 0.06 + 0.04 * dq;
  let aw = select(cal, 0.3, vLoop > 0.5);
  let w = (0.6 + 2.8 * aw) * (1.0 + 1.6 * bl) * vp.y / 640.0;   // half width in pixels, scaled with the canvas
  let off = vec2f(-dir.y, dir.x) * side * w * 2.0 / vp * ca.w;
  ca.x = ca.x + off.x;
  ca.y = ca.y + off.y;
  ca.z = ca.z - 0.001 * ca.w;                                   // sit just in front of the facets
  vertexOutputs.position = ca;
  vertexOutputs.vLoop = vLoop;
  vertexOutputs.vPh = vPh;
  vertexOutputs.vDel = vDel;
  vertexOutputs.vBloom = bl;
  vertexOutputs.vX = select(side, -side, (code & 2) != 0);       // across the ribbon, the same sign at both ends
  vertexOutputs.vColor = x3d_Color;
  vertexOutputs.vS = select(select(1.0, 0.0, a.x >= b.x), select(0.0, 1.0, (code & 2) != 0), vLoop > 0.5);   // pulses run from the far end toward the head; round a wheel, from edge start to end
  vertexOutputs.vPool = poolAt((a + b) * 0.5);
  vertexOutputs.vPulse = select(0.0, 1.0, (code & 12) != 0);
  let vSeed = rnd3i(qpos(a) + qpos(b)).x;
  vertexOutputs.vSeed = vSeed;
  var vFade = 1.0 - 0.55 * max(sa.w, sb.w);
  // The lattice burns on the facets' fire: an edge glows ember as the front crosses its middle, holds a moment
  // (its own random delay), then goes out. Only the head's points stay, a constellation. Network edges never burn.
  var vHeat = 0.0;
  var vHot = 0.0;
  let d = burnD();
  if (d > 0.0 && (code & 12) != 12) {
    let e = burnEdge((a + b) * 0.5, d);
    let delay = 0.03 + 0.2 * vSeed;
    vHeat = smoothstepR(0.09, 0.02, e) * smoothstep(-delay - 0.06, -delay * 0.4, e);
    let eh = e / 0.035;
    vHot = exp(-(eh * eh));                                      // white-hot as the cut crosses the edge
    vFade = vFade * smoothstep(-delay - 0.06, -delay, e);
  }
  vertexOutputs.vHeat = vHeat;
  vertexOutputs.vHot = vHot;
  vertexOutputs.vFade = vFade;
  if (vFade < 0.001) { vertexOutputs.position = vec4f(2.0, 2.0, 2.0, 1.0); }    // a burnt-out edge costs no fill
  let sc = ((a.x + b.x) * 0.425 + (a.y + b.y) * 0.15 - uniforms.scan) * 2.4;
  vertexOutputs.vScan = select(exp(-(sc * sc)), 0.0, (code & 12) != 0);
}`,
  fs: `
uniform time: f32;
uniform glow: f32;
varying vBloom: f32;
varying vColor: vec4f;
varying vX: f32;
varying vS: f32;
varying vPulse: f32;
varying vSeed: f32;
varying vFade: f32;
varying vScan: f32;
varying vHeat: f32;
varying vHot: f32;
varying vPool: vec3f;
varying vLoop: f32;
varying vPh: f32;
varying vDel: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vBloom = fragmentInputs.vBloom;
  let vColor = fragmentInputs.vColor;
  let vX = fragmentInputs.vX;
  let vS = fragmentInputs.vS;
  let vPulse = fragmentInputs.vPulse;
  let vSeed = fragmentInputs.vSeed;
  let vFade = fragmentInputs.vFade;
  let vScan = fragmentInputs.vScan;
  let vHeat = fragmentInputs.vHeat;
  let vHot = fragmentInputs.vHot;
  let vPool = fragmentInputs.vPool;
  let vLoop = fragmentInputs.vLoop;
  let vPh = fragmentInputs.vPh;
  let vDel = fragmentInputs.vDel;
  if (vFade < 0.003) { discard; }
  let b = 1.0 + 1.6 * vBloom;                                   // bloom widens the ribbon, the core keeps its width
  let core = exp(-vX * vX * 9.0 * b * b);
  let halo = (exp(-vX * vX * 2.2 * b) * (0.3 - 0.12 * vBloom) + exp(-vX * vX * 3.0) * 0.1 * vBloom) * 1.0;
  var pk = 0.0;
  if (vPulse > 0.5) {
    let t = fract(uniforms.time * (0.09 + 0.13 * vSeed) + vSeed * 17.0) * 1.8 - 0.4;
    let dd = vS - t;
    pk = exp(-dd * dd * 60.0) * uniforms.glow;
  }
  var lk = 0.0;
  if (vLoop > 0.5) {                                            // a wheel: two comets circle it, each trailing behind its head
    let u = fract(uniforms.time / 14.0);
    let pos = vPh + vS * vDel;
    let d1 = fract(u - pos);
    let d2 = fract(u + 0.5 - pos);
    lk = (exp(-d1 * 11.0) + exp(-d2 * 11.0)) * uniforms.glow;
    pk = max(pk * 0.2, (exp(-d1 * 70.0) + exp(-d2 * 70.0)) * uniforms.glow);
  }
  let hc = pow(vColor.rgb, vec3f(1.0 + 0.0 * vBloom)) * (1.0 + 0.6 * vBloom);   // bloom: a deeper gold halo round a pale core
  let pulseC = select(vec3f(1.0, 0.85, 0.55), mix(vColor.rgb, vec3f(1.0, 0.96, 0.86), 0.5), vLoop > 0.5);
  var em = vColor.rgb * core * 1.1 * (1.0 + 0.7 * vLoop + 1.6 * lk) + hc * halo * (1.0 + 1.2 * lk) + pulseC * pk * (core * 1.7 + halo * 2.2)
         + vec3f(1.0, 0.74, 0.38) * vScan * (core + halo) * 1.3 * uniforms.glow
         + vPool * (core * 0.9 + halo * 1.1) * 0.8;             // v3: the moving lights tint the ribbons they pass
  em = mix(em, vec3f(1.0, 0.45, 0.12) * (core * 1.6 + halo * 2.2) + vec3f(1.0, 0.9, 0.7) * core * 0.4, vHeat);
  em = em + vec3f(1.0, 0.9, 0.74) * core * vHot * 0.9;
  em = em * (vFade * select(1.0, 1.0, vPulse > 0.5));          // 1.0: the head's dense lattice, dimmer when additive
  let a = clamp(max(max(em.r, em.g), em.b), 0.0, 1.0);
  if (a < 0.004) { discard; }
  fragmentOutputs.color = vec4f(min(em / max(a, 1e-3), vec3f(1.0)), a);
}`,
});

/* PointShader: the stars, hubs, motes and the scatter that gathers the cloud into the eye. Term-for-term from the GLSL in gobbler3.x3d.
   Points are drawn as one quad per point (WebGPU has no point sprites): 'corner' in {(-1,-1),(1,-1),(1,1),(-1,1)} expands the clip position by the
   GLSL gl_PointSize s, and the fragment shader rebuilds gl_PointCoord from the corner. */
gobRegister('point', {
  key: '8da5fec9-17c8a8f8', kind: 'points', attrs: ['position', 'color', 'corner'],
  uniforms: { phase: 'f32', time: 'f32', glow: 'f32', bloom: 'f32', light0: 'vec3f', light1: 'vec3f', light2: 'vec3f', light3: 'vec3f' },
  notes: 'clip z bias: GLSL z -= 0.003 w on a [-1,1] depth range is 0.0015 w on WebGPU [0,1]. '
       + 'gl_PointSize s (px, full sprite width): cp.xy += corner * (s / viewport.zw) * cp.w. A hidden point (size <= 0.01, clip (2,2,2,1)) keeps all four corners outside the clip volume (z > w). '
       + 'gl_PointCoord = vec2(corner.x, -corner.y) * 0.5 + 0.5 (y down), from the vCorner varying. '
       + 'x3d_Viewport.w is viewport.w (f32); pcg3 uses vec3u, shifts need a vec3u right-hand side',
  vs: `
attribute position: vec3f;
attribute color: vec4f;
attribute corner: vec2f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform viewport: vec4f;
uniform phase: f32;
uniform time: f32;
uniform glow: f32;
uniform bloom: f32;
uniform light0: vec3f;
uniform light1: vec3f;
uniform light2: vec3f;
uniform light3: vec3f;
varying vColor: vec4f;
varying vB: f32;
varying vBloom: f32;
varying vSpike: f32;
varying vCorner: vec2f;
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rnd3i(q: vec3i) -> vec3f { return vec3f(pcg3(vec3u(q + vec3i(4096)))) * (1.0 / 4294967296.0); }
fn qpos(p: vec3f) -> vec3i { return vec3i(floor(p * 100.0 + 0.5)); }
fn scatter(p: vec3f) -> vec4f {
  let q = qpos(p);
  let r = rnd3i(q);
  let g = (rnd3i(q + vec3i(37, 71, 13)) - 0.5) * 3.4;
  let u = clamp((p.x - (-2.75)) / (4.79 - (-2.75)), 0.0, 1.0);
  let jit = (r.x - 0.5) * 0.04;
  let l0 = 0.14 + 0.16 * (1.0 - u) + jit;
  let l1 = l0 + 0.2;
  let b0 = 0.6 + 0.12 * u + jit;
  let b1 = min(0.95, b0 + 0.2);
  if (uniforms.phase <= l0 || uniforms.phase >= b1) { return vec4f(p, 0.0); }
  var e: f32;
  var hold: f32;
  if (uniforms.phase < l1) { e = smoothstep(l0, l1, uniforms.phase); hold = 0.0; }
  else if (uniforms.phase <= b0) { e = 1.0; hold = (uniforms.phase - l1) / max(1e-4, b0 - l1); }
  else { e = 1.0 - smoothstep(b0, b1, uniforms.phase); hold = 1.0; }
  let s = select(0.0, sin(3.14159265 * e), e < 1.0);
  const c: f32 = 0.97030;
  const sn: f32 = -0.24188;
  let d = vec2f((p.x - 0.45) * 1.6, (p.y + 0.75) * 1.5);
  let tgt = vec3f(2.5 + d.x * c - d.y * sn + g.x * 0.36, -0.9 + d.x * sn + d.y * c + g.y * 0.36, 1.2 * p.z + g.z * 0.9);
  let curl = vec3f(0.0, 0.6 * sin(2.1 * p.x + 0.5), 0.6 * cos(1.7 * p.y));
  let drift = vec3f(0.3 + 0.1 * sin(3.0 * p.y), 0.12 * sin(2.0 * p.x), 0.15 * cos(2.0 * p.y));
  let live = 0.07 * e * vec3f(sin(uniforms.time * 0.9 + r.y * 6.283), cos(uniforms.time * 0.7 + r.z * 6.283), sin(uniforms.time * 0.5 + r.x * 6.283));
  return vec4f(p + (tgt - p) * e + curl * s + drift * hold * e + live, e);
}
fn poolAt(p: vec3f) -> vec3f {
  let d0 = p - uniforms.light0;
  let d1 = p - uniforms.light1;
  let d2 = p - uniforms.light2;
  let d3 = p - uniforms.light3;
  return (vec3f(1.0, 0.8, 0.42) * exp(-dot(d0, d0) * 0.05) + vec3f(1.0, 0.36, 0.09) * exp(-dot(d1, d1) * 0.05) + vec3f(0.12, 0.78, 1.0) * exp(-dot(d2, d2) * 0.05) + vec3f(0.66, 0.28, 1.0) * exp(-dot(d3, d3) * 0.05)) * 0.9;
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var p = vertexInputs.position;
  let x3d_Color = vertexInputs.color;
  let r = rnd3i(qpos(p) + vec3i(11, 5, 3));
  let kind = floor(x3d_Color.a * 4.0 + 0.001);
  var size = (x3d_Color.a - kind * 0.25) * 16.0;
  var e = 0.0;
  if (kind < 0.5) { let sc = scatter(p); p = sc.xyz; e = sc.w; }
  else if (kind < 2.5 && kind > 1.5) {
    p += vec3f(sin(uniforms.time * (0.05 + 0.06 * r.x) + r.y * 6.283) * 0.7, sin(uniforms.time * (0.04 + 0.05 * r.y) + r.z * 6.283) * 0.5,
               sin(uniforms.time * (0.03 + 0.04 * r.z) + r.x * 6.283) * 0.6);
  }
  let mv = uniforms.worldView * vec4f(p, 1.0);
  let k = uniforms.viewport.w / 640.0;
  let dist = max(0.2, -mv.z);
  if (kind > 2.5) { size *= 1.0 - 0.45 * uniforms.bloom; }                  // motes: bloom draws them wider, so it draws them smaller
  let px = size * length(uniforms.worldView[0].xyz) * 0.16 * uniforms.projection[1][1] * uniforms.viewport.w * 0.5 / dist;
  var tw = 0.62 + 0.38 * sin(uniforms.time * (0.7 + 1.9 * r.y) + r.x * 6.283);
  if (kind < 0.5) { tw = 0.88 + 0.12 * tw; }
  let coc = abs(dist - 14.0) * select(0.25, 0.9, kind > 0.5) * k;
  let s = clamp(px * (0.85 + 0.3 * tw) * (1.0 + 0.9 * uniforms.bloom) + coc, 1.0, 110.0 * k);
  // gl_PointSize = s: applied to the clip position below
  var vB = tw * (1.0 + 0.9 * e) * clamp(px * (1.0 + 0.9 * uniforms.bloom) / s, 0.2, 1.0) * mix(1.0, uniforms.glow, 0.5);
  vertexOutputs.vBloom = uniforms.bloom;
  vertexOutputs.vSpike = select(0.0, 1.0, size > 2.75 && kind > 0.5 && kind < 1.5);   // only the few brightest hubs
  let pool = select(vec3f(0.0), poolAt(p), kind > 0.5 && kind < 2.5);
  vertexOutputs.vColor = vec4f(clamp(x3d_Color.rgb + pool * 0.8, vec3f(0.0), vec3f(1.0)), 1.0);
  vB *= 1.0 + 0.9 * min(1.0, length(pool));
  vertexOutputs.vB = vB;
  var cp = select(uniforms.projection * mv, vec4f(2.0, 2.0, 2.0, 1.0), size <= 0.01);
  cp.z = cp.z - 0.0015 * cp.w;
  cp.x = cp.x + vertexInputs.corner.x * (s / uniforms.viewport.z) * cp.w;
  cp.y = cp.y + vertexInputs.corner.y * (s / uniforms.viewport.w) * cp.w;
  vertexOutputs.vCorner = vertexInputs.corner;
  vertexOutputs.position = cp;
}`,
  fs: `
varying vColor: vec4f;
varying vB: f32;
varying vBloom: f32;
varying vSpike: f32;
varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vColor = fragmentInputs.vColor;
  let vB = fragmentInputs.vB;
  let vBloom = fragmentInputs.vBloom;
  let vSpike = fragmentInputs.vSpike;
  let gl_PointCoord = vec2f(fragmentInputs.vCorner.x, -fragmentInputs.vCorner.y) * 0.5 + 0.5;
  let d = gl_PointCoord * 2.0 - 1.0;
  let r2 = dot(d, d);
  if (r2 > 1.0) { discard; }
  let bb = 1.0 + 0.9 * vBloom;
  let core = exp(-r2 * 16.0 * bb * bb);
  let halo = (exp(-r2 * 3.5 * bb) * (0.62 - 0.2 * vBloom) * (1.0 - r2) + exp(-r2 * 2.5) * 0.16 * vBloom * (1.0 - r2)) * 1.0;
  let sp = vSpike * (exp(-abs(d.x) * 28.0) + exp(-abs(d.y) * 28.0)) * max(0.0, 1.0 - sqrt(r2) / 0.7) * 0.7;
  let hc = pow(vColor.rgb, vec3f(1.0 + 0.0 * vBloom)) * (1.0 + 0.6 * vBloom);   // bloom: a deeper halo round a pale core
  let em = (hc * (halo + sp) + mix(vColor.rgb, vec3f(1.0), 0.6) * core * 1.3) * vB;
  let a = clamp(max(max(em.r, em.g), em.b), 0.0, 1.0);
  if (a < 0.004) { discard; }
  fragmentOutputs.color = vec4f(min(em / max(a, 1e-3), vec3f(1.0)), a);
}`,
});

/* Gobbler demiurge on Babylon WebGPU: the four GLSL programs the Demiurge scene adds to Gobbler 3 Deep (the other six, sky, eye, facet, line, point and hide, are the ones in
   src/gobbler/ and hash-match). Term for term from the GLSL in data/bird/gobbler4-bird.x3d: Sun (granulated Sun in the chest), Glow (billboard halo), Air (single-scattering
   atmosphere shell) and Weave (the Armenian knot's thread, drawn by a vertex shader from a strip of x = 0..600).
   Differences from the GLSL, all logged in the demiurge run folder GAPS.md:
     - the normal matrix is the upper 3x3 of the model-view matrix (exact for the uniform scales the scene uses)
     - Weave's face normal comes from cross(dpdy, dpdx): WebGPU's window y runs down where GL's runs up, so the GL order cross(dFdx, dFdy) turns into this
     - Weave's pixel dither uses the fragment position (WebGPU origin top-left), the pattern is mirrored, its density is the same
     - Air writes ordinary depth: X_ITE's logarithmic depth output has no counterpart here (the page asks for it with a browser option; Babylon uses a reversed float depth buffer instead)
     - Weave's MFFloat uniforms X[32] and H[32] arrive as eight vec4f each (X0..X7, H0..H7), because uniform arrays are not part of the port format
   Concatenated after gobbler/wgsl-core.js in the bundle scope. */

gobRegister('sun', {
  key: '333ca04b-c4a4d041', kind: 'mesh', attrs: ['position', 'normal'], uniforms: { time: 'f32' },
  notes: 'normal matrix taken from the model-view matrix',
  vs: `
attribute position: vec3f;
attribute normal: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vN: vec3f;
varying vP: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let nm = mat3x3f(uniforms.worldView[0].xyz, uniforms.worldView[1].xyz, uniforms.worldView[2].xyz);
  vertexOutputs.vN = normalize(nm * vertexInputs.normal);
  vertexOutputs.vP = vertexInputs.position;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
}`,
  fs: `
uniform time: f32;
varying vN: vec3f;
varying vP: vec3f;
fn h1(p0: vec3f) -> f32 { var p = fract(p0 * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x);
  var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3f(1, 0, 0)), f.x), mix(h1(i + vec3f(0, 1, 0)), h1(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3f(0, 0, 1)), h1(i + vec3f(1, 0, 1)), f.x), mix(h1(i + vec3f(0, 1, 1)), h1(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let mu = clamp(normalize(fragmentInputs.vN).z, 0.0, 1.0);
  let g = vnoise(fragmentInputs.vP * 26.0 + vec3f(0.0, uniforms.time * 0.10, 0.0)) * 0.6 + vnoise(fragmentInputs.vP * 64.0 - vec3f(uniforms.time * 0.17, 0.0, 0.0)) * 0.4;
  var c = mix(vec3f(1.0, 0.55, 0.12), vec3f(1.0, 0.97, 0.82), pow(mu, 0.5)) * (0.8 + 0.5 * g);
  c = c + vec3f(1.0, 0.45, 0.08) * pow(1.0 - mu, 3.0) * 0.6;
  fragmentOutputs.color = vec4f(c, 1.0);
}`,
});

gobRegister('glow', {
  key: '5752e7b2-febb26b2', kind: 'mesh', attrs: ['position', 'color'], uniforms: {},
  notes: 'none: the halo is a pure function of the quad coordinate',
  vs: `
attribute position: vec3f;
attribute color: vec4f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vUV: vec2f;
varying vCol: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.position.xy;
  vertexOutputs.vCol = vertexInputs.color.rgb;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
}`,
  fs: `
varying vUV: vec2f;
varying vCol: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let r = length(fragmentInputs.vUV);
  if (r >= 1.0) { discard; }
  let a = pow(1.0 - r, 2.6) * 0.85 + exp(-r * r * 22.0) * 0.5;
  fragmentOutputs.color = vec4f(fragmentInputs.vCol * (0.9 + 0.8 * exp(-r * r * 14.0)), clamp(a, 0.0, 1.0));
}`,
});

gobRegister('air', {
  key: '2cb8e4a1-598ae28b', kind: 'mesh', attrs: ['position'], uniforms: { sunDir: 'vec3f' },
  notes: 'ordinary depth in place of the logarithmic output; front-facing taken from the pipeline',
  vs: `
attribute position: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vP: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let p = uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vP = p.xyz;
  vertexOutputs.position = uniforms.projection * p;
}`,
  fs: `
uniform worldView: mat4x4f;
uniform sunDir: vec3f;
varying vP: vec3f;
const TOP: f32 = 1.07;
const MARGIN: f32 = 1.02;
const K: f32 = 4.5;
const DECAY: f32 = 6.0;
const GAIN: f32 = 1.0;
const MIE: f32 = 0.05;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(fragmentInputs.vP);
  let rs = length(uniforms.worldView[0].xyz) / MARGIN;
  let rp = rs / TOP;
  let C = uniforms.worldView[3].xyz;
  let nm = mat3x3f(uniforms.worldView[0].xyz, uniforms.worldView[1].xyz, uniforms.worldView[2].xyz);
  let S = normalize(nm * uniforms.sunDir);
  let cc = dot(C, C);
  let b = dot(d, C);
  let inside = cc < rs * rs;
  if (fragmentInputs.frontFacing == inside) { discard; }
  let disc = b * b - (cc - rs * rs);
  if (disc <= 0.0) { discard; }
  let sq = sqrt(disc);
  let t0 = max(b - sq, 0.0);
  var t1 = b + sq;
  let dp = b * b - (cc - rp * rp);
  if (dp > 0.0) { let tp = b - sqrt(dp); if (tp > 0.0) { t1 = min(t1, tp); } }
  if (t1 <= t0) { discard; }
  let dt = (t1 - t0) / 10.0;
  let cs = dot(d, S);
  let phase = 0.45 * (1.0 + cs * cs) + MIE * 0.64 / pow(1.36 - 1.2 * cs, 1.5);
  var acc = vec3f(0.0);
  var od = 0.0;
  for (var i = 0; i < 10; i = i + 1) {
    let p = d * (t0 + (f32(i) + 0.5) * dt) - C;
    let r = length(p);
    let rho = exp(-DECAY * clamp((r - rp) / (rs - rp), 0.0, 1.0));
    let up = dot(p / r, S);
    let src = mix(vec3f(1.0, 0.40, 0.12), vec3f(0.40, 0.66, 1.0), smoothstep(-0.05, 0.55, up));
    let w = rho * dt / rp;
    acc = acc + src * (smoothstep(-0.18, 0.22, up) * w * phase);
    od = od + w;
  }
  let alpha = 1.0 - exp(-K * od);
  fragmentOutputs.color = vec4f(min(acc * (K * GAIN) / max(alpha, 0.02), vec3f(1.5)), alpha);
}`,
});

const _wvU = {}; for (let i = 0; i < 8; i++) { _wvU['X' + i] = 'vec4f'; _wvU['H' + i] = 'vec4f'; }
gobRegister('weave', {
  key: '7420b4e5-0617b5ce', kind: 'mesh', attrs: ['position'], uniforms: { w: 'vec3f', P: 'vec4f', Q: 'vec4f', S: 'vec3f', col: 'vec3f', ..._wvU },
  notes: 'X[32] and H[32] as eight vec4f each; face normal from cross(dpdy, dpdx); dither pattern mirrored',
  vs: `
attribute position: vec3f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform w: vec3f;
uniform P: vec4f;
uniform Q: vec4f;
uniform S: vec3f;
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `uniform X${i}: vec4f;\nuniform H${i}: vec4f;`).join('\n')}
varying vu: f32;
varying vs: f32;
varying vl: f32;
varying vP: vec3f;
fn Xs(j: i32) -> f32 { let k = j / 4; let c = j % 4; var v = vec4f(0.0);
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `if (k == ${i}) { v = uniforms.X${i}; }`).join(' ')}
  return v[c]; }
fn Hs(j: i32) -> f32 { let k = j / 4; let c = j % 4; var v = vec4f(0.0);
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `if (k == ${i}) { v = uniforms.H${i}; }`).join(' ')}
  return v[c]; }
fn crv(t: f32) -> vec2f {
  let th = 6.2831853 * t;
  let r = uniforms.P.x + uniforms.P.y * cos(uniforms.Q.x * th);
  let ph = th + uniforms.P.z * sin(uniforms.Q.x * th) + uniforms.P.w * (r - uniforms.P.x) / uniforms.P.y + uniforms.Q.y * 6.2831853 / (4.0 * uniforms.Q.x);
  return r * vec2f(cos(ph), sin(ph));
}
fn tp(u: f32) -> f32 { return u - uniforms.S.z * sin(6.2831853 * uniforms.Q.x * u) / (6.2831853 * uniforms.Q.x); }
fn lift(t: f32) -> f32 {
  let n = i32(uniforms.S.x);
  var t0 = Xs(n - 1) - 1.0;
  var h0 = Hs(n - 1);
  var t1 = Xs(0);
  var h1 = Hs(0);
  var s = uniforms.S.y * select(1.0, -1.0, n % 2 == 0);
  for (var j = 0; j < 32; j = j + 1) {
    if (j >= n || Xs(j) > t) { break; }
    t0 = Xs(j); h0 = Hs(j);
    t1 = select(Xs(0) + 1.0, Xs(j + 1), j + 1 < n);
    h1 = select(Hs(0), Hs(j + 1), j + 1 < n);
    s = uniforms.S.y * select(-1.0, 1.0, j % 2 == 0);
  }
  return s * (1.0 - 2.0 * smoothstep(t0 + h0, t1 - h1, t));
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let u = vertexInputs.position.x / 600.0;
  let t = tp(u);
  vertexOutputs.vu = u;
  vertexOutputs.vs = vertexInputs.position.y;
  let vl = lift(t) * uniforms.Q.z;
  vertexOutputs.vl = vl;
  let c = crv(t);
  let d = normalize(crv(t + 0.0004) - crv(t - 0.0004));
  var p = uniforms.worldView * vec4f(c + vec2f(-d.y, d.x) * 0.06 * vertexInputs.position.y, 0.0, 1.0);
  vertexOutputs.vP = p.xyz;
  p = vec4f(p.xyz + normalize(-p.xyz) * vl * 0.05, p.w);
  var clip = vec4f(2.0, 2.0, 2.0, 1.0);
  if (abs(uniforms.w.x - uniforms.Q.w) < 0.5) { clip = uniforms.projection * p; }
  vertexOutputs.position = clip;
}`,
  fs: `
uniform w: vec3f;
uniform col: vec3f;
varying vu: f32;
varying vs: f32;
varying vl: f32;
varying vP: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(cross(dpdy(fragmentInputs.vP), dpdx(fragmentInputs.vP)));   // derivatives first: they need uniform control flow
  if (fragmentInputs.vu > uniforms.w.y) { discard; }
  let fc = floor(fragmentInputs.position.xy);
  if (fract(sin(dot(fc, vec2f(12.9898, 78.233))) * 43758.5453) > uniforms.w.z) { discard; }
  var k = 0.62 + 0.5 * max(0.0, dot(n, normalize(vec3f(-0.4, 0.7, 0.6))));
  k = k * select(0.74, 1.08, fragmentInputs.vs < 0.0);
  k = k * (0.82 + 0.22 * fragmentInputs.vl);
  var c = mix(uniforms.col * k, vec3f(0.06, 0.03, 0.01), smoothstep(0.62, 0.92, abs(fragmentInputs.vs)));
  let hot = exp(-(uniforms.w.y - fragmentInputs.vu) * 55.0) * step(uniforms.w.y, 0.9999);
  c = mix(c, vec3f(1.0, 0.86, 0.62) * 1.25, 0.85 * hot);
  fragmentOutputs.color = vec4f(min(c, vec3f(1.0)), 1.0);
}`,
});

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

/* Gobbler 3 additions to the Babylon body (concatenated after brain/body.js and brain/body-cam.js, same bundle scope).
   Nothing in brain/ is edited: methods are wrapped or added here.
     - ComposedShaders found in GOB_BY_HASH draw through their WGSL port; a miss falls back to the Material and says so (loom law 40)
     - PointSet becomes one camera-facing quad per point (WebGPU has no point sprites); IndexedFaceSet ribbons and facets keep per-corner attributes,
       including 3D texture coordinates and RGBA colours
     - ParticleSystem (SPRITE) with a VolumeEmitter: a CPU simulation drawn as one dynamic quad mesh
     - the first Viewpoint is bound at load (as X_ITE does) and a bind fires bindTime so the ROUTEs from it run */

const GOB_PICKABLE = new Set(['facet']);        // the TouchSensor sits on the head: facets pick, ribbons (zero-area quads), points and the sky do not

/* a PointSet whose shader has no port is drawn as small plain dots, and the page says so */
gobRegister('plainpoint', {
  key: 'none', kind: 'points', attrs: ['position', 'color', 'corner'], uniforms: {},
  notes: 'fallback for a PointSet whose ComposedShader has no WGSL port: 3 px dots in the point colour',
  vs: `
attribute position: vec3f;
attribute color: vec4f;
attribute corner: vec2f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
uniform viewport: vec4f;
varying vColor: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var cp = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
  let s = 3.0 * uniforms.viewport.w / 640.0;
  cp = vec4f(cp.xy + vertexInputs.corner * (s / uniforms.viewport.zw) * cp.w, cp.z, cp.w);
  vertexOutputs.vColor = vertexInputs.color.rgb;
  vertexOutputs.position = cp;
}`,
  fs: `
varying vColor: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs { fragmentOutputs.color = vec4f(fragmentInputs.vColor, 1.0); }`,
});

/* an unlit Shape whose faces carry RGBA colours (the flywheel discs): colour * the UnlitMaterial emissive, alpha from the colour and the material transparency */
gobRegister('vcolor', {
  key: 'none', kind: 'mesh', attrs: ['position', 'color'], uniforms: { tint: 'vec3f', opacity: 'f32' },
  notes: 'fallback and built-in for an IndexedFaceSet with ColorRGBA and no ComposedShader',
  vs: `
attribute position: vec3f;
attribute color: vec4f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vColor: vec4f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vColor = vertexInputs.color;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
}`,
  fs: `
uniform tint: vec3f;
uniform opacity: f32;
varying vColor: vec4f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs { fragmentOutputs.color = vec4f(fragmentInputs.vColor.rgb * uniforms.tint, fragmentInputs.vColor.a * uniforms.opacity); }`,
});

const EMBER_VS = `
attribute position: vec3f;
attribute color: vec4f;
attribute uv: vec2f;
uniform worldView: mat4x4f;
uniform projection: mat4x4f;
varying vColor: vec4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vColor = vertexInputs.color;
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.position = uniforms.projection * uniforms.worldView * vec4f(vertexInputs.position, 1.0);
}`;
const EMBER_FS = `
var tex0Sampler: sampler;
var tex0: texture_2d<f32>;
varying vColor: vec4f;
varying vUV: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = textureSample(tex0, tex0Sampler, fragmentInputs.vUV);
  fragmentOutputs.color = vec4f(fragmentInputs.vColor.rgb * t.rgb, fragmentInputs.vColor.a * t.a);
}`;

function gobRand(seedRef) { // small deterministic generator: the embers look the same every run
  let s = seedRef.s = (Math.imul(seedRef.s, 1664525) + 1013904223) >>> 0; return s / 4294967296;
}

const _gobBuild = Body.prototype.build, _gobMaterialsFor = Body.prototype.materialsFor, _gobMakeMesh = Body.prototype.makeMesh,
  _gobClear = Body.prototype.clearWorld, _gobSetWorld = Body.prototype.setWorld, _gobFrame = Body.prototype.frame, _gobBind = Body.prototype.bindViewpoint, _gobChanged = Body.prototype.changed;

Object.assign(Body.prototype, {
  build(n, parent, chain) {
    if (n && n.type === 'ParticleSystem') return this.buildEmbers(n, parent, chain);
    // event nodes live in the reader; PointLights only reach the fallback Materials (the ported programs carry their own studio), so they are not a gap
    if (n && (n.type === 'BooleanFilter' || n.type === 'BooleanSequencer' || n.type === 'PointLight')) return null;
    return _gobBuild.call(this, n, parent, chain);
  },
  clearWorld() { this.gobMats = new Set(); for (const e of this.embers || []) { try { e.mesh.dispose(false, true); } catch (x) { /* gone */ } } this.embers = []; return _gobClear.call(this); },
  setWorld(world, baseUrl, resolve) {
    this.gobMats = new Set(); this.embers = [];
    _gobSetWorld.call(this, world, baseUrl, resolve);
    // X_ITE binds the first Viewpoint when a world loads; the bind fires bindTime, which starts the assembly through its ROUTEs
    if (!this.bound && this.viewpoints && this.viewpoints.length) this.bindViewpoint(this.viewpoints[0], true);
  },
  bindViewpoint(vp, on) {
    _gobBind.call(this, vp, on);
    if (on) R.events.emit(vp, 'bindTime', vp.f.bindTime);
  },
  changed(node, field) {
    if (node.type === 'ParticleSystem') return;           // fields are read each frame
    return _gobChanged.call(this, node, field);
  },

  /* ---------------------------------------------------------- shader programs */
  materialsFor(shape, g, app) {
    const cs = app && app.f.shaders.find((s) => s.type === 'ComposedShader');
    if (cs) {
      const key = this.shaderKey(cs), name = GOB_BY_HASH[key];
      if (name) {
        const port = GOB_PORTS[name];
        if (port.kind === 'hidden') return null;
        if (port.kind === 'points' ? g.type === 'PointSet' : (g.type === 'IndexedFaceSet' || g.type === 'Sphere')) {
          return [{ kind: 'gob', name, port, cs, noPick: !GOB_PICKABLE.has(name), deps: [cs, app.f.material].filter(Boolean) }];
        }
        this.note('ComposedShader ' + (cs.def || '') + ' (' + name + ') on <' + g.type + '> is not a combination the port was written for: drawn with its Material');
      }
    }
    if (g.type === 'IndexedFaceSet' && !cs && g.f.color && g.f.color.type === 'ColorRGBA') {
      const mat = app && app.f.material, e = mat && mat.f.emissiveColor ? mat.f.emissiveColor : [1, 1, 1];
      return [{ kind: 'gob', name: 'vcolor', port: GOB_PORTS.vcolor, cs: null, noPick: true, tint: e, opacity: 1 - (mat && mat.f.transparency || 0), deps: [mat].filter(Boolean) }];
    }
    if (g.type === 'PointSet') {
      this.note('PointSet' + (cs ? ' with ComposedShader ' + (cs.def || '') + ' (no WGSL port, hash ' + this.shaderKey(cs) + ')' : '') + ': drawn as plain dots');
      return [{ kind: 'gob', name: 'plainpoint', port: GOB_PORTS.plainpoint, cs: null, noPick: true, deps: [] }];
    }
    return _gobMaterialsFor.call(this, shape, g, app);
  },
  makeMesh(shape, g, spec, passIndex) {
    if (spec.kind === 'gob') return this.makeGobMesh(shape, g, spec, passIndex);
    return _gobMakeMesh.call(this, shape, g, spec, passIndex);
  },
  makeGobMesh(shape, g, spec, passIndex) {
    const port = spec.port, s = this.scene, name = (shape.def || 'gob' + shape.id) + '-' + spec.name + passIndex;
    let mesh;
    if (g.type === 'Sphere') mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: g.f.radius * 2, segments: 48 }, s);
    else {
      const d = port.kind === 'points' ? this.gobPoints(g) : this.gobFaces(g);
      if (!d) return null;
      mesh = new BABYLON.Mesh(name, s);
      const vd = new BABYLON.VertexData(); vd.positions = d.position; vd.indices = d.indices; vd.applyToMesh(mesh, false);   // position first: Babylon drops a custom attribute that comes first
      const SIZE = { normal: 3, color: 4, tc0: 3, corner: 2 };
      for (const a of port.attrs) { if (a === 'position') continue; if (!d[a]) { this.note('port ' + spec.name + ' needs attribute ' + a + ' that <' + g.type + '> does not carry'); continue; } mesh.setVerticesData(a, d[a], false, SIZE[a]); }
    }
    mesh.alwaysSelectAsActiveMesh = true;                  // the vertex shaders move points and ribbon ends far outside the static bounds
    const m = mesh.material = gobMakeMaterial(s, spec.name, port, name + '-mat');
    if (spec.name === 'sky') { m.alphaMode = BABYLON.Engine.ALPHA_DISABLE; m.needAlphaBlending = () => false; m.disableDepthWrite = true; mesh.renderingGroupId = 0; mesh.alphaIndex = 0; }
    else { mesh.renderingGroupId = 1; mesh.alphaIndex = 0; }
    (this.gobMats ||= new Set()).add(m); this._gobVpW = -1;
    if (spec.cs) this.refreshShader(m, spec.cs);
    if (spec.tint) { m.setVector3('tint', new BABYLON.Vector3(spec.tint[0], spec.tint[1], spec.tint[2])); m.setFloat('opacity', spec.opacity); }
    // the scene gives some Shapes a bboxCenter on purpose: X_ITE sorts blended shapes by it, so Babylon's distance sort should see the same centre
    const bc = shape.f.bboxCenter, bs = shape.f.bboxSize;
    if (bs && bs[0] >= 0) { const h = [bs[0] / 2, bs[1] / 2, bs[2] / 2]; mesh.setBoundingInfo(new BABYLON.BoundingInfo(new BABYLON.Vector3(bc[0] - h[0], bc[1] - h[1], bc[2] - h[2]), new BABYLON.Vector3(bc[0] + h[0], bc[1] + h[1], bc[2] + h[2]))); }
    return mesh;
  },

  /* IndexedFaceSet to per-corner attributes (positions, normals, RGBA colours, 3D texture coordinates), fan-triangulated */
  gobFaces(g) {
    const f = g.f, ci = f.coordIndex, P = f.coord && f.coord.f.point;
    if (!P || !ci.length) return null;
    const NV = f.normal && f.normal.f.vector, NI = f.normalIndex && f.normalIndex.length ? f.normalIndex : ci, npv = f.normalPerVertex !== false;
    const C = f.color && f.color.f.color, cstride = f.color && f.color.type === 'ColorRGBA' ? 4 : 3, CI = f.colorIndex && f.colorIndex.length ? f.colorIndex : ci, cpv = f.colorPerVertex !== false;
    const TCn = f.texCoord, TC = TCn && TCn.f.point, tstride = TCn && TCn.type === 'TextureCoordinate3D' ? 3 : 2, TI = f.texCoordIndex && f.texCoordIndex.length ? f.texCoordIndex : ci;
    const n = ci.length, pos = [], nrm = [], col = [], tc = [], idx = [];
    const get = (A, i, k) => A[i * k], at = (A, i, k, j) => (A[i * k + j] === undefined ? 0 : A[i * k + j]);
    let face = [], fi = 0;
    const flush = () => {
      if (face.length >= 3) {
        const a = face[0].v, b = face[1].v, c = face[2].v;
        const ux = at(P, b, 3, 0) - at(P, a, 3, 0), uy = at(P, b, 3, 1) - at(P, a, 3, 1), uz = at(P, b, 3, 2) - at(P, a, 3, 2);
        const vx = at(P, c, 3, 0) - at(P, a, 3, 0), vy = at(P, c, 3, 1) - at(P, a, 3, 1), vz = at(P, c, 3, 2) - at(P, a, 3, 2);
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        const base = pos.length / 3;
        for (const c0 of face) {
          pos.push(at(P, c0.v, 3, 0), at(P, c0.v, 3, 1), at(P, c0.v, 3, 2));
          if (NV) { const ni = npv ? NI[c0.k] : (f.normalIndex && f.normalIndex.length ? f.normalIndex[fi] : fi); nrm.push(at(NV, ni, 3, 0), at(NV, ni, 3, 1), at(NV, ni, 3, 2)); }
          else nrm.push(fx, fy, fz);
          if (C) { const cI = cpv ? CI[c0.k] : (f.colorIndex && f.colorIndex.length ? f.colorIndex[fi] : fi); col.push(at(C, cI, cstride, 0), at(C, cI, cstride, 1), at(C, cI, cstride, 2), cstride === 4 ? at(C, cI, cstride, 3) : 1); }
          else col.push(1, 1, 1, 1);
          if (TC) { const t = TI[c0.k]; tc.push(at(TC, t, tstride, 0), at(TC, t, tstride, 1), tstride === 3 ? at(TC, t, tstride, 2) : 0); }
          else tc.push(0, 0, 0);
        }
        for (let i = 1; i + 1 < face.length; i++) idx.push(base + i + 1, base, base + i);   // same winding; WebGPU's flat provoking vertex is the first, GL's the last, so the last corner leads
      }
      face = []; fi++;
    };
    for (let k = 0; k < n; k++) { if (ci[k] < 0) flush(); else face.push({ v: ci[k], k }); }
    if (face.length) flush();
    return { position: Float32Array.from(pos), normal: Float32Array.from(nrm), color: Float32Array.from(col), tc0: Float32Array.from(tc), indices: Uint32Array.from(idx) };
  },
  /* PointSet to four vertices per point, each with the point position and RGBA colour and a corner in {-1,1}^2 */
  gobPoints(g) {
    const f = g.f, P = f.coord && f.coord.f.point; if (!P || !P.length) return null;
    const np = Math.floor(P.length / 3), C = f.color && f.color.f.color, cs = f.color && f.color.type === 'ColorRGBA' ? 4 : 3;
    const pos = new Float32Array(np * 12), col = new Float32Array(np * 16), cor = new Float32Array(np * 8), idx = new Uint32Array(np * 6);
    const K = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < np; i++) {
      for (let c = 0; c < 4; c++) {
        const o = i * 4 + c;
        pos[o * 3] = P[i * 3]; pos[o * 3 + 1] = P[i * 3 + 1]; pos[o * 3 + 2] = P[i * 3 + 2];
        col[o * 4] = C ? C[i * cs] : 1; col[o * 4 + 1] = C ? C[i * cs + 1] : 1; col[o * 4 + 2] = C ? C[i * cs + 2] : 1; col[o * 4 + 3] = C && cs === 4 ? C[i * cs + 3] : 1;
        cor[o * 2] = K[c * 2]; cor[o * 2 + 1] = K[c * 2 + 1];
      }
      const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    return { position: pos, color: col, corner: cor, indices: idx };
  },

  /* ---------------------------------------------------------------- embers */
  buildEmbers(n, parent, chain) {
    const f = n.f, s = this.scene, r = { node: n, tn: null, kids: [], chain: [n, ...chain] };
    this.rec.set(n.id, r);
    const max = Math.max(1, Math.min(20000, f.maxParticles | 0));
    const px = f.appearance && f.appearance.f.texture;           // PixelTexture: width height components then one 0xIIAA... value per pixel
    let tex = null;
    if (px && px.type === 'PixelTexture' && px.f.image.length > 3) {
      const [w, h, comp] = px.f.image, data = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = px.f.image[3 + i] >>> 0; let I = 255, A = 255;
        if (comp === 1) I = v & 255; else if (comp === 2) { I = (v >> 8) & 255; A = v & 255; }
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = I; data[i * 4 + 3] = comp === 2 || comp === 4 ? A : 255;
      }
      tex = BABYLON.RawTexture.CreateRGBATexture(data, w, h, s, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; tex.hasAlpha = true;
    }
    const mesh = new BABYLON.Mesh('embers-' + (n.def || n.id), s);
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(max * 12); vd.indices = (() => { const a = new Uint32Array(max * 6); for (let i = 0; i < max; i++) a.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6); return a; })();
    vd.applyToMesh(mesh, true);
    mesh.setVerticesData('color', new Float32Array(max * 16), true, 4);
    const uv = new Float32Array(max * 8); for (let i = 0; i < max; i++) uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    mesh.setVerticesData('uv', uv, false, 2);
    mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false; mesh.renderingGroupId = 1; mesh.alphaIndex = 0;
    BABYLON.ShaderStore.ShadersStoreWGSL['gob-embersVertexShader'] = EMBER_VS; BABYLON.ShaderStore.ShadersStoreWGSL['gob-embersFragmentShader'] = EMBER_FS;
    const m = new BABYLON.ShaderMaterial('embers-mat', s, { vertex: 'gob-embers', fragment: 'gob-embers' },
      { attributes: ['position', 'color', 'uv'], uniforms: ['worldView', 'projection'], samplers: ['tex0'], shaderLanguage: BABYLON.ShaderLanguage.WGSL, needAlphaBlending: true });
    m.alphaMode = BABYLON.Engine.ALPHA_COMBINE; m.backFaceCulling = false; m.disableDepthWrite = true;
    if (tex) m.setTexture('tex0', tex);
    mesh.material = m; mesh.parent = parent;
    r.tn = parent;
    // the emitter: random points on the triangles of the VolumeEmitter's own coordinates
    const em = f.emitter, tris = []; let area = 0;
    if (em && em.type === 'VolumeEmitter' && em.f.coord && em.f.coordIndex.length) {
      const P = em.f.coord.f.point, ci = em.f.coordIndex; let face = [];
      const flush = () => { for (let i = 1; i + 1 < face.length; i++) { const a = face[0], b = face[i], c = face[i + 1];
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); area += ar; tris.push({ a, b, c, cum: area }); } face = []; };
      for (const k of ci) { if (k < 0) flush(); else face.push(k); } if (face.length) flush();
    } else this.note('ParticleSystem ' + (n.def || '') + ': only VolumeEmitter is built; no particles drawn');
    const st = { node: n, mesh, max, tris, area, P: em && em.f.coord ? em.f.coord.f.point : null, seed: { s: 12345 }, alive: new Array(max).fill(null).map(() => ({ age: 1, life: 0, p: [0, 0, 0], v: [0, 0, 0], a: 0 })), acc: 0, last: 0 };
    (this.embers ||= []).push(st);
    return r;
  },
  stepEmbers(now) {
    for (const e of this.embers || []) {
      const f = e.node.f, mesh = e.mesh; if (mesh.isDisposed()) continue;
      const dt = e.last ? Math.min(this.opts.maxDt || 0.25, Math.max(0, now - e.last)) : 0; e.last = now;
      const on = f.enabled !== false, emitter = f.emitter, life = Math.max(0.05, f.particleLifetime), lv = f.lifetimeVariation;
      if (on && f.createParticles && e.tris.length && emitter) {
        e.acc += dt * e.max / life;
        const dir = emitter.f.direction, dl = Math.hypot(dir[0], dir[1], dir[2]) || 1, sp = emitter.f.speed, vr = emitter.f.variation;
        while (e.acc >= 1) {
          e.acc -= 1;
          const q = e.alive.find((x) => x.age >= x.life); if (!q) break;
          const pick = gobRand(e.seed) * e.area; let t = e.tris.find((x) => x.cum >= pick) || e.tris[e.tris.length - 1];
          let u = gobRand(e.seed), v = gobRand(e.seed); if (u + v > 1) { u = 1 - u; v = 1 - v; }
          const P = e.P, A = t.a * 3, B = t.b * 3, Cc = t.c * 3;
          q.p = [0, 1, 2].map((k) => P[A + k] + u * (P[B + k] - P[A + k]) + v * (P[Cc + k] - P[A + k]));
          const k2 = sp * (1 + vr * (gobRand(e.seed) * 2 - 1));
          q.v = [dir[0] / dl * k2, dir[1] / dl * k2, dir[2] / dl * k2];
          q.age = 0; q.life = life * (1 + lv * (gobRand(e.seed) * 2 - 1));
        }
      }
      const cam = this.scene.activeCamera; if (!cam) continue;
      const W = mesh.parent ? mesh.parent.computeWorldMatrix(true) : BABYLON.Matrix.Identity(), inv = W.clone().invert();
      const right = BABYLON.Vector3.TransformNormal(cam.getDirection(BABYLON.Vector3.Right()), inv).normalize(), up = BABYLON.Vector3.TransformNormal(cam.getDirection(BABYLON.Vector3.Up()), inv).normalize();
      const sz = f.particleSize, hw = sz[0] / 2, hh = sz[1] / 2;
      const key = f.colorKey, ramp = f.color && f.color.f.color, rs = f.color && f.color.type === 'ColorRGBA' ? 4 : 3;
      const pos = new Float32Array(e.max * 12), col = new Float32Array(e.max * 16);
      for (let i = 0; i < e.max; i++) {
        const q = e.alive[i]; if (q.age >= q.life) continue;
        q.age += dt; if (q.age >= q.life || !on) { q.age = q.life; continue; }
        for (let k = 0; k < 3; k++) q.p[k] += q.v[k] * dt;
        const a = q.age / q.life; let c = [1, 1, 1, 1];
        if (ramp && key.length) {
          let j = 0; while (j < key.length - 1 && a > key[j + 1]) j++; const j2 = Math.min(j + 1, key.length - 1), span = key[j2] - key[j], s = span > 0 ? Math.min(1, Math.max(0, (a - key[j]) / span)) : 0;
          c = [0, 1, 2, 3].map((k) => { const x0 = ramp[j * rs + k] ?? 1, x1 = ramp[j2 * rs + k] ?? 1; return k === 3 && rs === 3 ? 1 : x0 + (x1 - x0) * s; });
        }
        const o = i * 12, oc = i * 16, p = q.p;
        const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let k = 0; k < 4; k++) {
          pos[o + k * 3] = p[0] + (right.x * cs[k][0] * hw + up.x * cs[k][1] * hh); pos[o + k * 3 + 1] = p[1] + (right.y * cs[k][0] * hw + up.y * cs[k][1] * hh); pos[o + k * 3 + 2] = p[2] + (right.z * cs[k][0] * hw + up.z * cs[k][1] * hh);
          col[oc + k * 4] = c[0]; col[oc + k * 4 + 1] = c[1]; col[oc + k * 4 + 2] = c[2]; col[oc + k * 4 + 3] = c[3];
        }
      }
      mesh.updateVerticesData('position', pos); mesh.updateVerticesData('color', col);
    }
  },

  frame() {
    const now = (performance.timeOrigin + performance.now()) / 1000;
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    if (this._gobVpW !== w || this._gobVpH !== h) { this._gobVpW = w; this._gobVpH = h; for (const m of this.gobMats || []) { try { m.setVector4('viewport', new BABYLON.Vector4(0, 0, w, h)); } catch (e) { /* disposed */ } } }
    this.stepEmbers(now);
    return _gobFrame.call(this);
  },
});

/* Gobbler demiurge additions to the Babylon body (concatenated after gobbler/body-gob.js, same bundle scope). Nothing in brain/ or gobbler/ is edited: methods are wrapped or added.
     - LOD (distance switch in the LOD's own frame), HAnimHumanoid / Joint / Segment / Site (transforms; the skin stays in its rest pose, see GAPS), Group `visible` changes
     - ProximitySensor: box test of the camera in the sensor's frame; isActive / enterTime / exitTime, and position_changed / orientation_changed while inside
     - Inline: fetched when load turns true, parsed by the SAI shim's createX3DFromString and adopted under the Inline's group
     - TriangleStripSet drawn through the gob programs (a strip becomes an indexed face set)
     - uniforms of the new programs: SFVec4f, and MFFloat as vec4f chunks named <field>0..7
     - a bound Viewpoint's nearDistance / farDistance set the camera planes, and the depth buffer is reversed float (the scene spans 1 m at 0.0004 units to the whole bird) */

const _dmBuild = Body.prototype.build, _dmChanged = Body.prototype.changed, _dmFrame = Body.prototype.frame, _dmClear = Body.prototype.clearWorld,
  _dmMaterialsFor = Body.prototype.materialsFor, _dmMakeMesh = Body.prototype.makeMesh, _dmRefresh = Body.prototype.refreshShader, _dmApplyCamera = Body.prototype.applyCamera,
  _dmSetWorld = Body.prototype.setWorld;
const DM_GROUPS = new Set(['LOD', 'HAnimJoint', 'HAnimSegment', 'HAnimSite', 'HAnimHumanoid']);
const dmAbs = (n, u) => new URL(u, n.base || location.href).href;

function dmStripToFaces(g) {
  if (g._ifs) return g._ifs;
  const f = g.f, ci = []; let s = 0;
  for (const c of f.stripCount) {
    for (let k = 0; k + 2 < c; k++) { if (k % 2 === 0) ci.push(s + k, s + k + 1, s + k + 2, -1); else ci.push(s + k + 1, s + k, s + k + 2, -1); }
    s += c;
  }
  return (g._ifs = { type: 'IndexedFaceSet', id: g.id, def: g.def, f: { coord: f.coord, normal: f.normal, color: f.color, texCoord: f.texCoord, coordIndex: Int32Array.from(ci), normalIndex: [], colorIndex: [], texCoordIndex: [],
    normalPerVertex: true, colorPerVertex: true, ccw: true, solid: false } });
}

Object.assign(Body.prototype, {
  build(n, parent, chain) {
    if (n && DM_GROUPS.has(n.type)) return this.buildDmGroup(n, parent, chain);
    if (n && n.type === 'ProximitySensor') { (this.prox ||= []).push({ node: n, parentTN: parent, inside: false }); return null; }
    if (n && n.type === 'Inline') return this.buildInline(n, parent, chain);
    return _dmBuild.call(this, n, parent, chain);
  },
  buildDmGroup(n, parent, chain) {
    const tn = new BABYLON.TransformNode(n.def || n.type, this.scene); tn.parent = parent;
    const r = { node: n, tn, kids: [], chain: [n, ...chain] };
    this.rec.set(n.id, r);
    if (n.type !== 'LOD' && n.type !== 'HAnimSegment') this.applyTransform(n, tn);
    const kids = n.type === 'HAnimHumanoid' ? [...n.f.skeleton, ...n.f.skin] : n.f.children;
    for (const c of kids) r.kids.push(this.build(c, tn, r.chain));
    if (n.type === 'LOD') { (this.lods ||= []).push(r); r.level = -1; }
    if (n.f.visible === false) tn.setEnabled(false);
    return r;
  },
  buildInline(n, parent, chain) {
    const tn = new BABYLON.TransformNode(n.def || 'Inline', this.scene); tn.parent = parent;
    const r = { node: n, tn, kids: [], chain: [n, ...chain], loaded: false };
    this.rec.set(n.id, r);
    if (n.f.load) this.loadInline(n, r);
    return r;
  },
  async loadInline(n, r) {
    if (r.loaded || r.loading || !n.f.url.length) return;
    r.loading = true;
    try {
      const url = dmAbs(n, n.f.url[0]);
      const res = await fetch(url); if (!res.ok) throw new Error(res.status + ' for ' + url);
      let u = new Uint8Array(await res.arrayBuffer());
      const text = u[0] === 0x1f && u[1] === 0x8b ? await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(u);
      const sc = await X3DSAI.B.createX3DFromString(text, url);
      if (!r.tn || r.tn.isDisposed()) return;
      const w = sc._world;
      for (const root of w.children) r.kids.push(this.build(root, r.tn, r.chain));
      r.loaded = true;
      (this.inlineLog ||= []).push({ url: n.f.url[0], nodes: w.nodes.length });
    } catch (e) { this.note('Inline ' + (n.def || '') + ' did not load: ' + e.message); }
    r.loading = false;
  },
  clearWorld() { this.lods = []; this.prox = []; return _dmClear.call(this); },
  setWorld(world, baseUrl, resolve) { this.lods = []; this.prox = []; return _dmSetWorld.call(this, world, baseUrl, resolve); },

  changed(node, field) {
    const t = node.type;
    if (t === 'HAnimJoint' || t === 'HAnimHumanoid' || t === 'HAnimSite') { const r = this.rec.get(node.id); if (r && r.tn && ['translation', 'rotation', 'scale', 'center', 'scaleOrientation'].includes(field)) this.applyTransform(node, r.tn); return; }
    if (t === 'Inline') { const r = this.rec.get(node.id); if (r && field === 'load' && node.f.load) this.loadInline(node, r); if (r && field === 'load' && !node.f.load && r.tn) r.tn.setEnabled(false); if (r && field === 'load' && node.f.load && r.tn) r.tn.setEnabled(true); return; }
    if (field === 'visible' && (t === 'Group' || t === 'Switch' || t === 'Transform' || t === 'Billboard' || DM_GROUPS.has(t))) { const r = this.rec.get(node.id); if (r && r.tn) r.tn.setEnabled(node.f.visible !== false); return; }
    if (t === 'ProximitySensor') return;
    if (t === 'Viewpoint' && (field === 'nearDistance' || field === 'farDistance')) { if (node === this.bound && this.pose) this.applyCamera(); return; }
    return _dmChanged.call(this, node, field);
  },

  /* ---------------------------------------------------- strips and the new programs' uniforms */
  materialsFor(shape, g, app) {
    if (g.type === 'TriangleStripSet') g = dmStripToFaces(g);
    // no Material and a Color (per face or per vertex): 19775-1 draws it unlit in that colour. The brain body would read no per-face colours, and the 36 letters of the ring came out black.
    const mat = app && app.f.material, cs = app && app.f.shaders.find((s) => s.type === 'ComposedShader');
    if (g.type === 'IndexedFaceSet' && !mat && !cs && g.f.color && g.f.color.type === 'Color')
      return [{ kind: 'gob', name: 'vcolor', port: GOB_PORTS.vcolor, cs: null, noPick: true, tint: [1, 1, 1], opacity: 1, opaque: true, deps: [] }];
    return _dmMaterialsFor.call(this, shape, g, app);
  },
  makeMesh(shape, g, spec, passIndex) {
    const m = _dmMakeMesh.call(this, shape, g.type === 'TriangleStripSet' ? dmStripToFaces(g) : g, spec, passIndex);
    if (m && spec.kind === 'gob' && spec.opaque) { m.material.alphaMode = BABYLON.Engine.ALPHA_DISABLE; m.material.disableDepthWrite = false; m.material.needAlphaBlending = () => false; }
    if (m && spec.kind === 'gob' && spec.name === 'sun') { m.material.alphaMode = BABYLON.Engine.ALPHA_DISABLE; m.material.disableDepthWrite = false; m.material.needAlphaBlending = () => false; }
    return m;
  },
  refreshShader(m, cs) {
    _dmRefresh.call(this, m, cs);
    for (const [name, def] of Object.entries(cs.fdefs)) {
      const v = cs.f[name], t = def[0];
      try {
        if (t === 'SFVec4f') m.setVector4(name, new BABYLON.Vector4(v[0], v[1], v[2], v[3]));
        else if (t === 'MFFloat') { for (let k = 0; k < 8; k++) m.setVector4(name + k, new BABYLON.Vector4(v[k * 4] || 0, v[k * 4 + 1] || 0, v[k * 4 + 2] || 0, v[k * 4 + 3] || 0)); }
      } catch (e) { /* not a uniform of this port */ }
    }
  },

  /* --------------------------------------------------------------- camera planes and depth */
  applyCamera() {
    _dmApplyCamera.call(this);
    const vp = this.bound, c = this.cam;
    if (vp && vp.f.nearDistance > 0) c.minZ = vp.f.nearDistance;
    if (vp && vp.f.farDistance > 0) c.maxZ = vp.f.farDistance;
  },

  /* --------------------------------------------------------------- per frame */
  frame() {
    const now = (performance.timeOrigin + performance.now()) / 1000, cam = this.scene.activeCamera;
    if (this.world && cam) {
      const eye = cam.globalPosition;
      for (const r of this.lods || []) {
        if (r.tn.isDisposed()) continue;
        const inv = r.tn.computeWorldMatrix(true).clone().invert(), p = BABYLON.Vector3.TransformCoordinates(eye, inv), c = r.node.f.center;
        const d = Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]), rg = r.node.f.range;
        let lv = 0; while (lv < rg.length && d >= rg[lv]) lv++;
        lv = Math.min(lv, r.kids.length - 1);
        if (lv !== r.level) { r.level = lv; r.kids.forEach((k, i) => { if (k && k.tn) k.tn.setEnabled(i === lv); }); }
      }
      if (this.prox && this.prox.length) {
        R.events.begin(now);
        const pose = this.pose, q = pose.q, ang = 2 * Math.acos(Math.max(-1, Math.min(1, q[3]))), sn = Math.sqrt(Math.max(1e-12, 1 - q[3] * q[3]));
        const ori = sn < 1e-6 ? [0, 0, 1, 0] : [q[0] / sn, q[1] / sn, q[2] / sn, ang];
        for (const s of this.prox) {
          const n = s.node; if (n.f.enabled === false) continue;
          const M = s.parentTN && s.parentTN.computeWorldMatrix ? s.parentTN.computeWorldMatrix(true) : BABYLON.Matrix.Identity();
          const pl = BABYLON.Vector3.TransformCoordinates(eye, M.clone().invert());
          const c = n.f.center, h = n.f.size, inside = h[0] > 0 && h[1] > 0 && h[2] > 0 && Math.abs(pl.x - c[0]) <= h[0] / 2 && Math.abs(pl.y - c[1]) <= h[1] / 2 && Math.abs(pl.z - c[2]) <= h[2] / 2;
          if (inside !== s.inside) {
            s.inside = inside; n.f.isActive = inside; n.f[inside ? 'enterTime' : 'exitTime'] = now;
            R.events.emit(n, 'isActive', inside); R.events.emit(n, inside ? 'enterTime' : 'exitTime', now);
          }
          if (inside) {
            n.f.position_changed = [pl.x, pl.y, pl.z]; n.f.orientation_changed = ori;
            R.events.emit(n, 'position_changed', n.f.position_changed); R.events.emit(n, 'orientation_changed', ori);
          }
        }
      }
    }
    return _dmFrame.call(this);
  },
});

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

/* Gobbler demiurge on Babylon WebGPU: define <x3d-canvas> before the page's own code asks for it, start the body when the element is attached, and let
   the page's unmodified boot.js, common.js and the v4 hover layer drive it through the SAI shim. Loaded last in the bundle. Every fallback the body takes is listed on screen (law 40). */
(() => {
  const B = X3DSAI.B, gaps = window.__gobGaps = [];
  let resolveReady, rejectReady; const ready = new Promise((a, b) => { resolveReady = a; rejectReady = b; });
  ready.catch(() => {});
  // the page calls loadURL straight away; the body needs a moment for the adapter, so the browser object waits for it
  for (const k of ['loadURL', 'replaceWorld', 'createX3DFromString']) { const o = B[k]; B[k] = async function (...a) { await ready; return o.apply(B, a); }; }
  Object.defineProperty(B, 'activeViewpoint', { get() { const w = window.__dmBody; return w && w.bound ? X3DSAI.wrap(w.bound) : null; } });
  B.getCurrentTime = () => (performance.timeOrigin + performance.now()) / 1000;   // common.js reads it for its frame readout

  const say = (msg) => {
    const d = document.createElement('div');
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#07060a;color:#efe8da;font:16px/1.5 system-ui,sans-serif;z-index:99';
    d.innerHTML = '<div style="max-width:36em"><h2 style="margin:0 0 .5em">The Gobbler demiurge on WebGPU needs a WebGPU browser</h2><p>' + msg + '</p><p style="opacity:.75">Chrome or Edge 113 and later, Safari 26, and Firefox 141 and later on Windows run it. On Windows with an Intel UHD 620 or similar, Chrome may need chrome://flags/#enable-unsafe-webgpu switched on. The WebGL version of this page is the one it was ported from.</p></div>';
    document.body.appendChild(d);
  };
  const chip = () => {
    let c = document.getElementById('gob-gaps');
    if (!c) {
      c = document.createElement('div'); c.id = 'gob-gaps';
      c.style.cssText = 'position:absolute;left:26px;top:56px;z-index:20;max-width:min(36em,80%);font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#f2dca8;background:rgba(8,6,10,.78);border:1px solid rgba(250,204,115,.35);border-radius:8px;padding:6px 10px;cursor:pointer';
      c.addEventListener('click', () => { c.dataset.open = c.dataset.open === '1' ? '0' : '1'; render(); });
      const st = document.getElementById('stage'); (st || document.body).appendChild(c);
    }
    return c;
  };
  const render = () => { const c = chip(), open = c.dataset.open === '1'; c.textContent = open ? 'Fallbacks (click to close):\n' + gaps.map((g) => '· ' + g).join('\n') : gaps.length + ' fallback' + (gaps.length > 1 ? 's' : '') + ' in this drawing (click)'; c.style.whiteSpace = 'pre-wrap'; };
  const onNote = (m) => { console.info('[x3d to babylon]', m); if (/transformed|decomposed to TRS/.test(m)) return; gaps.push(m); render(); };

  async function start(cv, host) {
    try {
      const q = new URLSearchParams(location.search);
      const body = new Body(cv, { onNote, tone: q.get('tone') || 'none' });
      window.__dmBody = body;   // the ported programs write their own values; Material fallbacks are not tone mapped
      await body.init();
      if (q.get('rz') !== '0') { try { body.engine.useReverseDepthBuffer = true; } catch (e) { onNote('reversed depth buffer not available: ' + e.message); } }   // one metre in the village is 0.0004 units
      X3DSAI.setBody(body);
      window.__gobWebGPU = { body, babylon: BABYLON.Engine.Version, adapter: body.adapterInfo, via: window.__adapterVia };
      if (/swiftshader|llvmpipe|software|basic render|warp/i.test(JSON.stringify(body.adapterInfo || {}) + (window.__adapter && window.__adapter.isFallbackAdapter ? ' software' : ''))) onNote('software WebGPU adapter: correctness only, speed figures from it mean nothing');
      window.__timingHooks = {
        name: 'Gobbler demiurge', schema: 'x3d.gobbler.timing/1', engine: () => body.engine, babylon: BABYLON.Engine.Version, adapter: body.adapterInfo,
        inside: "the page's own interface work (explorer, tour, picking) and the Babylon draw", adaptive: false, corner: 'right',
        scene() { const vp = body.bound; const d = vp && vp.f ? vp.f.description : null; return { key: [d], label: [d], fields: { viewpoint: d, tour: !!(window.PX && PX.tourOn), points: 'see scene' } }; },
      };
      if (window.__timingPlace) window.__timingPlace();
      resolveReady();
    } catch (e) {
      console.error(e); window.__gobWebGPUError = String(e && e.message || e); rejectReady(e);
      say(String(e && e.message || e));
    }
  }
  customElements.define('x3d-canvas', class extends HTMLElement {
    connectedCallback() {
      if (this._started) return; this._started = true;
      const cv = document.createElement('canvas');
      cv.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'; cv.tabIndex = 0; cv.setAttribute('role', 'application');
      cv.setAttribute('aria-label', 'The Gobbler bird and its knowledge graph, drawn by Babylon.js on WebGPU. Drag to orbit, scroll to zoom, keys 1 to 8 fly the zoom ladder.');
      this.appendChild(cv); start(cv, this);
    }
    get browser() { return B; }
  });
})();

})();
