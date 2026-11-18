// Giza VI: The Five Witnesses. Babylon.js renderer for the world.mjs descriptors.
// Reuses, unchanged: v3 GizaSky (sky-math.js, ERFA precession samples), v5 tesla.mjs (energy ledger),
// v5 resonance.mjs (Giza IV oscillator), v4 hawara.mjs (Hawara chapters).
import * as W from './world.mjs';
import { ACTS, LEDGER, GRADES, TOTAL, flatShots } from './story.mjs';
import { TESLA_DEFAULTS, teslaResponse, createReservoir, stepReservoir } from '../v5/tesla.mjs';
import { sweep, DEFAULTS as RES_DEFAULTS } from '../v5/resonance.mjs';
import { chapters as HAWARA_CHAPTERS } from '../v4/hawara.mjs';

const B = window.BABYLON, Sky = window.GizaSky, $ = id => document.getElementById(id);
const V3 = (a) => new B.Vector3(a[0], a[1], a[2]);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * t * (t * (t * 6 - 15) + 10), sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const Q = new URLSearchParams(location.search);
const SHOTS = flatShots();
const log = (...a) => { console.log('[giza6]', ...a); const el = $('log'); if (el) { el.textContent = (a.join(' ') + '\n' + el.textContent).slice(0, 4000); } };

// ---------------- engine and scene ----------------
const canvas = $('scene');
const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, powerPreference: 'high-performance' }, true);
const scene = new B.Scene(engine);
scene.useRightHandedSystem = true;              // X3D frame: x east, y up, z south
scene.clearColor = new B.Color4(0.02, 0.025, 0.04, 1);
scene.fogMode = B.Scene.FOGMODE_EXP2; scene.fogDensity = 0.00016;
scene.skipPointerMovePicking = true;

const cam = new B.ArcRotateCamera('cam', 0, 1, 500, B.Vector3.Zero(), scene);
cam.minZ = 1; cam.maxZ = 90000; cam.wheelDeltaPercentage = 0.02; cam.panningSensibility = 40; cam.inertia = 0.85; cam.lowerRadiusLimit = 0.3;
cam.attachControl(canvas, true);

// ---------------- procedural textures (canvas → albedo + normal) ----------------
function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v); }
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
function bake(name, size, fn, { normalStrength = 2.5, wrap = true } = {}) {
  const h = new Float32Array(size * size), rgb = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = y * size + x, [r, g, b, ht] = fn(x / size, y / size, x, y); h[i] = ht; rgb[i * 4] = r; rgb[i * 4 + 1] = g; rgb[i * 4 + 2] = b; rgb[i * 4 + 3] = 255; }
  const nrm = new Uint8ClampedArray(size * size * 4), at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength, dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    nrm[i] = (-dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255; }
  const mk = (data, n) => { const t = new B.RawTexture(data, size, size, B.Engine.TEXTUREFORMAT_RGBA, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE); t.name = n; t.wrapU = t.wrapV = wrap ? 1 : 0; t.anisotropicFilteringLevel = 8; return t; };
  return { albedo: mk(rgb, name + '_alb'), normal: mk(nrm, name + '_nrm') };
}
function blocks(base, { courses = 12, joint = 0.035, rough = 1, seed = 1, pits = 0.3 } = {}) {
  // one tile = 8.4 m: 12 courses about 0.7 m high, blocks 1.0 to 2.2 m long, each block its own tone.
  const rowOff = [], rowCuts = [];
  for (let r = 0; r < courses; r++) { const cuts = [0]; let x = hash(r, seed) * 0.2; while (x < 1) { cuts.push(x); x += (1.0 + hash(r, cuts.length + seed) * 1.2) / 8.4; } cuts.push(1); rowCuts.push(cuts); rowOff.push(hash(seed, r)); }
  return (u, v) => {
    const rv = v * courses, r = Math.floor(rv), fy = rv - r, cuts = rowCuts[r % courses];
    let k = 0; while (k < cuts.length - 1 && u > cuts[k + 1]) k++;
    const fx = (u - cuts[k]) / Math.max(1e-4, cuts[k + 1] - cuts[k]), w = (cuts[k + 1] - cuts[k]) * 8.4;
    const ex = Math.min(fx * w, (1 - fx) * w) / 0.7, ey = Math.min(fy, 1 - fy), edge = Math.min(ex, ey);
    const n = fbm(u * 40, v * 40), n2 = fbm(u * 160 + 3, v * 160, 3), tone = 0.86 + hash(r * 31 + k, seed) * 0.24;
    let ht = sstep(0, joint * 2.4, edge) * (0.75 + 0.25 * n) - n2 * 0.18 * rough;
    if (hash(Math.floor(u * 300), Math.floor(v * 300) + seed) < pits * 0.02) ht -= 0.35;
    const grime = 0.82 + 0.18 * sstep(0.0, 0.08, edge), c = tone * grime * (0.92 + 0.12 * n);
    return [base[0] * c, base[1] * c, base[2] * c, ht];
  };
}
const TEX = {};
function textures() {
  const t0 = performance.now();
  TEX.lime = bake('lime', 1024, blocks([205, 176, 132], { seed: 3 }));
  TEX.limeOld = bake('limeold', 512, blocks([190, 160, 120], { seed: 7, rough: 1.6, pits: 1 }));
  TEX.casing = bake('casing', 512, blocks([226, 210, 178], { seed: 5, joint: 0.01, rough: 0.35, courses: 12 }), { normalStrength: 1.2 });
  TEX.sand = bake('sand', 512, (u, v) => { const n = fbm(u * 18, v * 18), rip = Math.sin((u * 60 + Math.sin(v * 9) * 2.2 + n * 3) * Math.PI * 2) * 0.5 + 0.5; const c = 0.9 + 0.12 * n; return [218 * c, 182 * c, 128 * c, rip * 0.35 + n * 0.6]; }, { normalStrength: 1.6 });
  TEX.granite = bake('granite', 512, (u, v) => { const n = fbm(u * 30, v * 30), s = hash(Math.floor(u * 700), Math.floor(v * 700)); let c = [150, 64, 52]; if (s > 0.86) c = [40, 34, 34]; else if (s > 0.74) c = [205, 150, 140]; else if (s < 0.08) c = [90, 90, 92]; const k = 0.75 + 0.35 * n; return [c[0] * k, c[1] * k, c[2] * k, n * 0.25]; }, { normalStrength: 0.8 });
  TEX.mud = bake('mud', 512, blocks([118, 92, 66], { seed: 11, courses: 24, rough: 2.2, pits: 2 }));
  log('textures', (performance.now() - t0).toFixed(0), 'ms (CPU, 6 procedural sets)');
}

// ---------------- materials ----------------
const MATS = {};
function pbr(name, { set, scale = 1, color = [1, 1, 1], rough = 0.85, metal = 0, emissive, alpha = 1, bumpLevel = 1, env = 1 }) {
  const m = new B.PBRMaterial(name, scene);
  if (set) { m.albedoTexture = set.albedo.clone(); m.bumpTexture = set.normal.clone(); for (const t of [m.albedoTexture, m.bumpTexture]) { t.uScale = t.vScale = scale; } m.bumpTexture.level = bumpLevel; }
  m.albedoColor = new B.Color3(...color); m.roughness = rough; m.metallic = metal; m.environmentIntensity = env;
  if (emissive) m.emissiveColor = new B.Color3(...emissive);
  if (alpha < 1) { m.alpha = alpha; m.transparencyMode = B.PBRMaterial.PBRMATERIAL_ALPHABLEND; }
  m.useHorizonOcclusion = true; m.useRadianceOcclusion = true;
  return (MATS[name] = m);
}
function materials() {
  pbr('limestone', { set: TEX.lime, scale: 1, rough: 0.9 });
  pbr('casing', { set: TEX.casing, scale: 1, rough: 0.55 });
  pbr('limestone_old', { set: TEX.limeOld, scale: 2.4 / 8.4, rough: 0.92 });
  pbr('limestone_fine', { set: TEX.casing, scale: 1 / 4.2, rough: 0.5, color: [1, 0.96, 0.9] });
  pbr('sphinx', { set: TEX.limeOld, scale: 2.4 / 8.4 * 1.2, rough: 0.95, color: [1.02, 0.92, 0.8], bumpLevel: 1.6 });
  pbr('sand', { set: TEX.sand, scale: 1, rough: 0.97, bumpLevel: 0.7 });
  pbr('rock_cut', { set: TEX.limeOld, scale: 1 / 4.2, rough: 0.95, color: [0.85, 0.78, 0.68], emissive: [0.03, 0.05, 0.06] });
  pbr('basalt', { color: [0.07, 0.07, 0.08], rough: 0.35, emissive: [0.0, 0.015, 0.02] });
  pbr('water_deep', { color: [0.02, 0.07, 0.12], rough: 0.05, alpha: 0.82, emissive: [0.02, 0.09, 0.2] });
  pbr('granite', { set: TEX.granite, scale: 1 / 2.2, rough: 0.32, bumpLevel: 0.5 });
  pbr('king_linen', { color: [0.93, 0.88, 0.78], rough: 0.7, emissive: [0.05, 0.04, 0.03] });
  pbr('king_skin', { color: [0.55, 0.3, 0.18], rough: 0.55, emissive: [0.03, 0.012, 0.006] });
  pbr('gold', { color: [1.0, 0.76, 0.33], metal: 1, rough: 0.28, emissive: [0.16, 0.09, 0.02] });
  pbr('ankh', { color: [1.0, 0.8, 0.4], metal: 1, rough: 0.18, emissive: [0.35, 0.9, 1.0] });
  pbr('was', { color: [0.85, 0.82, 0.7], metal: 1, rough: 0.25, emissive: [0.2, 0.45, 1.0] });
  pbr('water', { set: TEX.sand, scale: 3, color: [0.03, 0.11, 0.13], rough: 0.04, bumpLevel: 0.25, alpha: 0.94 });
  pbr('beacon', { color: [0.1, 0.1, 0.12], rough: 0.4, emissive: [0.3, 0.85, 1.0] });
  pbr('conjecture', { color: [0.6, 0.1, 0.55], rough: 0.6, alpha: 0.55, emissive: [0.55, 0.08, 0.5] });
  pbr('mudbrick', { set: TEX.mud, scale: 1, rough: 0.98 });
  // x-ray shell for ghosted pyramids (Act III): fresnel rim, no lighting, so the interior reads at night
  const xr = new B.StandardMaterial('xray', scene); xr.disableLighting = true; xr.backFaceCulling = false; xr.alpha = 0.35;
  xr.emissiveColor = new B.Color3(0.06, 0.18, 0.26); xr.diffuseColor = B.Color3.Black(); xr.specularColor = B.Color3.Black();
  xr.emissiveFresnelParameters = new B.FresnelParameters({ leftColor: new B.Color3(0.3, 0.62, 0.8), rightColor: new B.Color3(0.0, 0.03, 0.06), power: 2.2, bias: 0.02 });
  xr.opacityFresnelParameters = new B.FresnelParameters({ leftColor: B.Color3.White(), rightColor: new B.Color3(0.08, 0.08, 0.08), power: 1.4 });
  xr.disableDepthWrite = true; MATS.xray = xr;
  // aurora sheet for the sky plate (authored), additive
  B.Effect.ShadersStore.canopyVertexShader = `precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV; void main(){ vUV=uv; gl_Position=worldViewProjection*vec4(position,1.0);}`;
  B.Effect.ShadersStore.canopyFragmentShader = `precision highp float; varying vec2 vUV; uniform float time; uniform float power;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    void main(){ float r=vUV.x, a=vUV.y*6.2831; vec2 p=vec2(cos(a),sin(a))*r*6.;
      float f=n(p*1.3+vec2(time*.05,0.))*.6+n(p*3.1-vec2(0.,time*.08))*.4; float rings=.5+.5*sin(r*48.-time*1.6+f*5.);
      float core=exp(-r*r*7.); vec3 c=mix(vec3(.18,.7,1.),vec3(.62,.36,1.),f)*(core*1.6+rings*.35*f)+vec3(.9,.97,1.)*exp(-r*r*120.)*1.5;
      float edge=smoothstep(1.,.55,r); gl_FragColor=vec4(c*edge*power, 1.);} `;
  const cm = new B.ShaderMaterial('canopy', scene, { vertex: 'canopy', fragment: 'canopy' }, { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'power'] });
  cm.backFaceCulling = false; cm.alphaMode = B.Engine.ALPHA_ADD; cm.needAlphaBlending = () => true; cm.disableDepthWrite = true; MATS.canopy = cm;
}

// ---------------- world meshes ----------------
const MESH = {}, LAYER = {}, SHADOW_CASTERS = [];
function lineMesh(d) {
  const color = { arc: [0.6, 0.85, 1.0], field: [0.35, 0.8, 1.0], link: [1.0, 0.75, 0.35] }[d.mat] || [1, 1, 1];
  const width = { arc: 1.2, field: 0.6, link: 1.0 }[d.mat] || 1;   // world metres
  let m;
  try {
    m = B.CreateGreasedLine(d.id, { points: d.lines.map(l => l.flat()) }, { color: new B.Color3(...color), width, materialType: B.GreasedLineMeshMaterialType.MATERIAL_TYPE_STANDARD }, scene);
    const mat = m.material; mat.emissiveColor = new B.Color3(...color); mat.disableLighting = true; mat.alpha = 1;
  } catch (e) {
    log('GreasedLine unavailable, LineSystem fallback:', e.message);
    m = B.MeshBuilder.CreateLineSystem(d.id, { lines: d.lines.map(l => l.map(V3)) }, scene); m.color = new B.Color3(...color);
  }
  m.isPickable = false; return m;
}
function buildWorld() {
  const t0 = performance.now(), descs = W.world();
  for (const d of descs) {
    let m;
    if (d.lines) m = lineMesh(d);
    else {
      m = new B.Mesh(d.id, scene); const vd = new B.VertexData(), n = [];
      vd.positions = d.positions; vd.indices = d.indices; vd.uvs = d.uvs;
      B.VertexData.ComputeNormals(d.positions, d.indices, n); vd.normals = n; vd.applyToMesh(m);   // no RH flag: with these windings the flag turns normals inward (measured: ground mean n.y -0.999)
      m.material = MATS[d.mat] || MATS.limestone; m.receiveShadows = true;
      if (['stone', 'hawara'].includes(d.layer) && d.id !== 'ground' && d.id !== 'hawara_ground' && d.mat !== 'water') SHADOW_CASTERS.push(m);
      if (d.layer === 'horizon') SHADOW_CASTERS.push(m);
      m.isPickable = false; m.freezeWorldMatrix();
    }
    m.metadata = { grade: d.grade, label: d.label, layer: d.layer, note: d.note };
    MESH[d.id] = m; (LAYER[d.layer] ||= []).push(m);
  }
  const c = W.census(descs);
  log('world', descs.length, 'meshes,', c.vertices, 'vertices,', c.triangles, 'triangles,', c.linePoints, 'line points in', (performance.now() - t0).toFixed(0), 'ms');
  return c;
}

// ---------------- sky: Preetham day sky, night dome, real stars, sun disc ----------------
let beltLine, skybox, skyMat, night, nightMat, stars, starMat, sunDisc, probe, starData, skyModel, milky;
function buildSky() {
  skyMat = new B.SkyMaterial('sky', scene); skyMat.backFaceCulling = false; skyMat.useSunPosition = true;
  skyMat.turbidity = 9; skyMat.rayleigh = 2.2; skyMat.mieCoefficient = 0.006; skyMat.mieDirectionalG = 0.86; skyMat.luminance = 1.0;
  skybox = B.MeshBuilder.CreateBox('skybox', { size: 60000, sideOrientation: B.Mesh.BACKSIDE }, scene); skybox.material = skyMat; skybox.infiniteDistance = true; skybox.applyFog = false; skybox.isPickable = false;
  B.Effect.ShadersStore.nightVertexShader = `precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vP; void main(){ vP=position; gl_Position=worldViewProjection*vec4(position,1.0);}`;
  B.Effect.ShadersStore.nightFragmentShader = `precision highp float; varying vec3 vP; uniform float night; uniform float storm; uniform vec3 sunDir;
    void main(){ vec3 d=normalize(vP); float up=max(d.y,0.); vec3 zen=vec3(.004,.007,.02), hor=vec3(.03,.045,.08); vec3 c=mix(hor,zen,pow(up,.45));
      float glow=pow(max(dot(d,normalize(vec3(sunDir.x,0.,sunDir.z))),0.),6.)*exp(-up*6.)*.12; c+=vec3(.25,.14,.1)*glow;
      c+=vec3(.08,.12,.3)*storm*exp(-up*3.); c+=vec3(.06,.02,.12)*storm*pow(up,2.);
      gl_FragColor=vec4(c, night);} `;
  nightMat = new B.ShaderMaterial('nightMat', scene, { vertex: 'night', fragment: 'night' }, { attributes: ['position'], uniforms: ['worldViewProjection', 'night', 'storm', 'sunDir'], needAlphaBlending: true });
  nightMat.backFaceCulling = false; nightMat.disableDepthWrite = true;
  night = B.MeshBuilder.CreateSphere('nightDome', { diameter: 50000, segments: 24, sideOrientation: B.Mesh.BACKSIDE }, scene); night.material = nightMat; night.infiniteDistance = true; night.applyFog = false; night.isPickable = false; night.alphaIndex = 0;
  sunDisc = B.MeshBuilder.CreateSphere('sunDisc', { diameter: 260, segments: 16 }, scene);
  const sm = new B.StandardMaterial('sunMat', scene); sm.emissiveColor = new B.Color3(1, 0.86, 0.6); sm.disableLighting = true; sunDisc.material = sm; sunDisc.applyFog = false; sunDisc.isPickable = false;
  probe = new B.ReflectionProbe('env', 256, scene, true, true); probe.renderList.push(skybox, night); probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = probe.cubeTexture;
}
// galactic (l,b) to ICRS: transpose of the IAU ICRS->galactic rotation
const GAL = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
function galToIcrs(l, b) { const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]; return [0, 1, 2].map(i => GAL[0][i] * g[0] + GAL[1][i] * g[1] + GAL[2][i] * g[2]); }
async function buildStars() {
  starData = await (await fetch('../v3/stars_v2.json')).json(); skyModel = Sky.createModel(starData);
  const R = W.rng(77); milky = [];
  for (let i = 0; i < 7000; i++) { const l = R() * Math.PI * 2, gb = (R() + R() + R() - 1.5) * 0.11 * (1.3 - 0.6 * Math.cos(l)), core = Math.exp(-((((l + Math.PI) % (2 * Math.PI)) - Math.PI) ** 2) * 1.4); milky.push({ v: galToIcrs(l, gb), s: 0.9 + R() * 1.3, a: 0.08 + 0.22 * core * R() + 0.06 * R() }); }
  const n = starData.field.length + starData.named.length + milky.length;
  B.Effect.ShadersStore.starsVertexShader = `precision highp float; attribute vec3 position; attribute vec4 color; uniform mat4 worldViewProjection; uniform float pointScale; uniform float time; varying vec4 vC;
    void main(){ gl_Position=worldViewProjection*vec4(position,1.0); float tw=.85+.15*sin(time*3.+position.x*.013+position.z*.007); gl_PointSize=max(1.,color.a*pointScale*tw); vC=color; }`;
  B.Effect.ShadersStore.starsFragmentShader = `precision highp float; varying vec4 vC; uniform float night;
    void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.0,d); a=a*a; gl_FragColor=vec4(vC.rgb*a*night*1.6, 1.);} `;
  starMat = new B.ShaderMaterial('starsMat', scene, { vertex: 'stars', fragment: 'stars' }, { attributes: ['position', 'color'], uniforms: ['worldViewProjection', 'pointScale', 'night', 'time'] });
  starMat.pointsCloud = true; starMat.alphaMode = B.Engine.ALPHA_ADD; starMat.needAlphaBlending = () => true; starMat.disableDepthWrite = true; starMat.backFaceCulling = false;
  stars = new B.Mesh('stars', scene); const vd = new B.VertexData(); vd.positions = new Float32Array(n * 3); vd.indices = Array.from({ length: n }, (_, i) => i); vd.applyToMesh(stars, true);
  const col = new Float32Array(n * 4); let k = 0;
  for (const f of starData.field) { col.set([f[3] / 255, f[4] / 255, f[5] / 255, f[6] * 1.6], k); k += 4; }
  for (const s of starData.named) { col.set([1, 0.97, 0.92, clamp(5.2 - s.mag * 1.25, 1.4, 6.5)], k); k += 4; }
  for (const m of milky) { col.set([0.62 * m.a * 3, 0.68 * m.a * 3, 0.85 * m.a * 3, m.s], k); k += 4; }
  stars.setVerticesData(B.VertexBuffer.ColorKind, col, false, 4);
  stars.material = starMat; stars.infiniteDistance = true; stars.isPickable = false; stars.alphaIndex = 1; stars.applyFog = false;
  stars.alwaysSelectAsActiveMesh = true;
  log('sky', starData.field.length, 'HYG field stars +', starData.named.length, 'named (v3 stars_v2.json) +', milky.length, 'decorative Milky Way points on the real galactic plane');
}
const SKYSTATE = { epoch: 2000, lst: 5.6, matrix: null };
function placeStars(epoch, lst) {
  if (!skyModel) return; const s = skyModel.matrixAt(epoch), M = s.matrix, R = 25000, pos = new Float32Array(stars.getTotalVertices() * 3); let k = 0;
  const put = v => { const h = Sky.horizontal(Sky.dated(v, M), lst), p = Sky.toXYZ(h, R); pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2]; };
  for (const f of starData.field) put(f); for (const s2 of starData.named) put(s2.v); for (const m of milky) put(m.v);
  stars.updateVerticesData(B.VertexBuffer.PositionKind, pos, false, false);
  // Orion's belt guide (drawn slightly inside the star shell so it never covers the stars)
  const belt = ['Mintaka', 'Alnilam', 'Alnitak'].map(n => { const h = Sky.horizontal(Sky.dated(starData.named.find(x => x.n === n).v, M), lst), p = Sky.toXYZ(h, R * 0.98); return new B.Vector3(p[0], p[1], p[2]); });
  beltLine = B.MeshBuilder.CreateLines('beltLine', { points: belt, updatable: true, instance: beltLine }, scene);
  beltLine.color = new B.Color3(1, 0.78, 0.42); beltLine.infiniteDistance = true; beltLine.applyFog = false; beltLine.isPickable = false;
  stars.refreshBoundingInfo();
  Object.assign(SKYSTATE, { epoch, lst, sample: s });
}
function beltInfo(epoch) {
  if (!skyModel) return null; const M = skyModel.matrixAt(epoch).matrix, named = n => starData.named.find(x => x.n === n);
  const al = Sky.dated(named('Alnilam').v, M), lst = Sky.equatorial(al).ra * 12 / Math.PI;
  const alt = n => Sky.horizontal(Sky.dated(named(n).v, M), lst).alt * Sky.RAD;
  return { lst, alnitak: alt('Alnitak'), alnilam: alt('Alnilam'), mintaka: alt('Mintaka'), sirius: alt('Sirius'), year: Sky.formatYear(Math.round(epoch)) };
}

// ---------------- lights, shadows, post ----------------
let sun, hemi, csg, pipe, ssao, vls, glow, visor, depth, chamberLight, ankhLight, dust, sparks;
function sunVector(az, alt) { const a = az * Math.PI / 180, e = alt * Math.PI / 180; return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]; }
function buildLights() {
  sun = new B.DirectionalLight('sun', new B.Vector3(0.5, -0.3, 0.2), scene); sun.intensity = 4; sun.position = new B.Vector3(0, 800, 0);
  hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene); hemi.intensity = 0.25; hemi.groundColor = new B.Color3(0.32, 0.22, 0.14);
  // CascadedShadowGenerator drew no shadows in this right-handed scene (Babylon 8.56.2, SwiftShader; measured 18 Nov,
  // logged in VALIDATION.md). A single PCF map fitted to the enabled casters each frame does.
  csg = new B.ShadowGenerator(Q.get('q') === 'cinematic' ? 4096 : 2048, sun); csg.usePercentageCloserFiltering = true; csg.filteringQuality = B.ShadowGenerator.QUALITY_HIGH;
  csg.bias = 0.0009; csg.normalBias = 0.45; csg.darkness = 0.0; sun.autoUpdateExtends = true; sun.shadowMinZ = 1; sun.shadowMaxZ = 6000;
  for (const m of SHADOW_CASTERS) csg.addShadowCaster(m, false);
  const K = W.KING.c;
  chamberLight = new B.PointLight('chamberLight', new B.Vector3(K[0] - 0.5, W.KING_FLOOR + 3.4, K[2] + 1.2), scene); chamberLight.diffuse = new B.Color3(1, 0.7, 0.42); chamberLight.intensity = 0; chamberLight.range = 16;
  ankhLight = new B.PointLight('ankhLight', new B.Vector3(K[0] + 0.9, W.KING_FLOOR + 1.35, K[2] + 0.2), scene); ankhLight.diffuse = new B.Color3(0.35, 0.85, 1); ankhLight.intensity = 0; ankhLight.range = 7;
  // excluding the outside world from interior lights keeps the light count per material low
  for (const l of [chamberLight, ankhLight]) l.includedOnlyMeshes = [...(LAYER.inside || []), ...(LAYER.horizon || [])];
}
function particleTexture() { const t = new B.DynamicTexture('dot', 64, scene, false), c = t.getContext(), g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true; return t; }
function buildParticles() {
  const tex = particleTexture(), K = W.KING.c;
  dust = new B.ParticleSystem('dust', 900, scene); dust.particleTexture = tex; dust.emitter = new B.Vector3(K[0], W.KING_FLOOR + 2.4, K[2]);
  dust.minEmitBox = new B.Vector3(-5, -2.2, -2.5); dust.maxEmitBox = new B.Vector3(5, 2.8, 2.5); dust.color1 = new B.Color4(1, 0.82, 0.55, 0.5); dust.color2 = new B.Color4(0.6, 0.9, 1, 0.35); dust.colorDead = new B.Color4(0, 0, 0, 0);
  dust.minSize = 0.006; dust.maxSize = 0.022; dust.minLifeTime = 6; dust.maxLifeTime = 12; dust.emitRate = 70; dust.direction1 = new B.Vector3(-0.03, 0.02, -0.03); dust.direction2 = new B.Vector3(0.03, 0.05, 0.03); dust.minEmitPower = 0.1; dust.maxEmitPower = 0.25; dust.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  sparks = new B.ParticleSystem('sparks', 1500, scene); sparks.particleTexture = tex; sparks.emitter = new B.Vector3(W.KHUFU[0], W.PYRAMIDS.khufu.today + 2, W.KHUFU[2]);
  sparks.createSphereEmitter(4, 1); sparks.color1 = new B.Color4(0.6, 0.9, 1, 1); sparks.color2 = new B.Color4(0.75, 0.6, 1, 1); sparks.colorDead = new B.Color4(0, 0, 0.2, 0);
  sparks.minSize = 0.6; sparks.maxSize = 2.4; sparks.minLifeTime = 0.4; sparks.maxLifeTime = 1.6; sparks.emitRate = 0; sparks.minEmitPower = 12; sparks.maxEmitPower = 40; sparks.gravity = new B.Vector3(0, -18, 0); sparks.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  dust.start(); sparks.start();
}
function buildPost() {
  pipe = new B.DefaultRenderingPipeline('dp', true, scene, [cam]);
  pipe.samples = 4; pipe.fxaaEnabled = true;
  pipe.imageProcessingEnabled = true; const ip = pipe.imageProcessing; ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES; ip.exposure = 1.0; ip.contrast = 1.18;
  ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteColor = new B.Color4(0.02, 0.01, 0.03, 0); ip.vignetteStretch = 0.4;
  pipe.bloomEnabled = true; pipe.bloomThreshold = 0.82; pipe.bloomWeight = 0.42; pipe.bloomKernel = 64; pipe.bloomScale = 0.5;
  pipe.chromaticAberrationEnabled = true; pipe.chromaticAberration.aberrationAmount = 6; pipe.chromaticAberration.radialIntensity = 0.6;
  pipe.grainEnabled = true; pipe.grain.intensity = 5; pipe.grain.animated = true;
  pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.22;
  pipe.depthOfFieldEnabled = false; pipe.depthOfFieldBlurLevel = B.DepthOfFieldEffectBlurLevel.Medium;
  try {
    ssao = new B.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [cam], false);
    ssao.radius = 2.6; ssao.totalStrength = 1.15; ssao.samples = 16; ssao.maxZ = 600; ssao.expensiveBlur = true;
  } catch (e) { log('SSAO2 unavailable:', e.message); }
  vls = new B.VolumetricLightScatteringPostProcess('godrays', 1.0, cam, sunDisc, 90, B.Texture.BILINEAR_SAMPLINGMODE, engine, false, scene);
  vls.exposure = 0.22; vls.decay = 0.968; vls.weight = 0.55; vls.density = 0.96;
  glow = new B.GlowLayer('glow', scene, { mainTextureSamples: 4, blurKernelSize: 48 }); glow.intensity = 0.95;
  glow.addExcludedMesh(sunDisc);
  depth = scene.enableDepthRenderer(cam, false);
  B.Effect.ShadersStore.visorFragmentShader = `precision highp float; varying vec2 vUV; uniform sampler2D textureSampler; uniform sampler2D depthSampler; uniform vec2 texel; uniform float time; uniform float strength;
    vec3 pal(float t){ t=clamp(t,0.,1.); return clamp(vec3(-.2+2.2*t, .15+1.25*sin(t*3.1416*.95), .95-1.5*t+0.6*t*t),0.,1.);}
    float L(vec2 u){ return dot(texture2D(textureSampler,u).rgb,vec3(.299,.587,.114)); } float D(vec2 u){ return texture2D(depthSampler,u).r; }
    void main(){ vec3 c=texture2D(textureSampler,vUV).rgb; if(strength<.001){gl_FragColor=vec4(c,1.);return;}
      float dx=D(vUV+vec2(texel.x,0.))-D(vUV-vec2(texel.x,0.)), dy=D(vUV+vec2(0.,texel.y))-D(vUV-vec2(0.,texel.y)); float de=clamp(length(vec2(dx,dy))*160.,0.,1.);
      float lx=L(vUV+vec2(texel.x,0.))-L(vUV-vec2(texel.x,0.)), ly=L(vUV+vec2(0.,texel.y))-L(vUV-vec2(0.,texel.y)); float le=clamp(length(vec2(lx,ly))*3.,0.,1.);
      float l=L(vUV); vec3 v=pal(pow(l,.8))*.75 + vec3(.35,1.,.9)*max(de,le*.7);
      float scan=.82+.18*sin(vUV.y*1100.+time*7.); float sweep=smoothstep(.0,.02,abs(fract(vUV.y*.5-time*.07)-.5)); v*=scan*(.8+.2*sweep);
      vec2 q=(vUV-.5)*vec2(1.75,1.); float r=length(q); v*=smoothstep(.98,.6,r); v+=vec3(.2,.9,.8)*smoothstep(.006,.0,abs(r-.62))*.5;
      gl_FragColor=vec4(mix(c,v,strength),1.);} `;
  visor = new B.PostProcess('visor', 'visor', ['texel', 'time', 'strength'], ['depthSampler'], 1.0, cam);
  visor.onApply = e => { e.setTexture('depthSampler', depth.getDepthMap()); e.setFloat2('texel', 1 / visor.width, 1 / visor.height); e.setFloat('time', performance.now() / 1000); e.setFloat('strength', STATE.visor); };
}

// ---------------- quality tiers ----------------
const TIERS = {
  cinematic: { scale: 1 / Math.min(2, devicePixelRatio || 1), shadow: true, ssao: true, vls: true, bloomKernel: 96, glowSamples: 4 },
  balanced: { scale: 1, shadow: true, ssao: false, vls: true, bloomKernel: 64 },
  lite: { scale: 1.5, shadow: false, ssao: false, vls: false, bloomKernel: 32 },
};
let tier = 'balanced';
function applyTier(name) {
  tier = TIERS[name] ? name : 'balanced'; const T = TIERS[tier];
  engine.setHardwareScalingLevel(T.scale); sun.shadowEnabled = T.shadow; pipe.bloomKernel = T.bloomKernel;
  if (ssao) { const mgr = scene.postProcessRenderPipelineManager; T.ssao ? mgr.attachCamerasToRenderPipeline('ssao', cam) : mgr.detachCamerasFromRenderPipeline('ssao', cam); }
  vls.exposure = T.vls ? 0.22 : 0; $('tier').value = tier; log('quality tier', tier, JSON.stringify(T));
}

// ---------------- state and the director ----------------
const STATE = { t: 0, playing: true, visor: 0, xray: 0, ghost: 0, coil: 0, interior: 0, stars: 0, dawn: 0, epoch: 2000, sky: { az: 253, alt: 5.5 }, shot: null, free: false, lower: 0, lowerDepth: -10, visorForce: null };
let blendFrom = null, lastSkyKey = '', lastProbe = 0;
const TESLA = { s: { ...TESLA_DEFAULTS }, st: null, running: true, supply: true, hist: [] };
TESLA.st = createReservoir(TESLA.s, 1);

function shotAt(t) { t = clamp(t, 0, TOTAL - 1e-6); for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].start) return [SHOTS[i], i]; return [SHOTS[0], 0]; }
function pose(s, u) { const e = ease(clamp(u, 0, 1)); return { p: s.p0.map((v, i) => lerp(v, s.p1[i], e)), t: s.t0.map((v, i) => lerp(v, s.t1[i], e)), fov: s.fov }; }
function setLayer(name, on) { for (const m of LAYER[name] || []) m.setEnabled(on); }
function setAlpha(mat, a) { if (!mat) return; mat.alpha = a; mat.transparencyMode = a < 0.999 ? B.PBRMaterial.PBRMATERIAL_ALPHABLEND : B.PBRMaterial.PBRMATERIAL_OPAQUE; }

function direct(dt) {
  const [s, i] = shotAt(STATE.t), u = (STATE.t - s.start) / s.dur, prev = SHOTS[i - 1];
  if (STATE.shot !== s) onShot(s, prev);
  // target values from the shot
  const want = { visor: STATE.visorForce ?? (s.visor || 0), xray: s.xray || 0, ghost: s.ghost || 0, coil: s.coil || 0, interior: s.interior || 0, stars: s.stars || 0, dawn: s.dawn || 0 };
  const k = 1 - Math.exp(-dt * 2.2); for (const key in want) STATE[key] = lerp(STATE[key], want[key], k);
  if (!STATE.free) {
    let P = pose(s, u);
    const bw = s.cut ? 1 : sstep(0, 3.2, STATE.t - s.start);
    const from = blendFrom || (prev && !s.cut ? { ...pose(prev, 1) } : null);
    if (from && bw < 1) { const e = ease(bw); P = { p: P.p.map((v, j) => lerp(from.p[j], v, e)), t: P.t.map((v, j) => lerp(from.t[j], v, e)), fov: lerp(from.fov, P.fov, e) }; }
    if (bw >= 1) blendFrom = null;
    cam.setTarget(V3(P.t)); cam.setPosition(V3(P.p)); cam.fov = P.fov;
  }
  // sky: blend from the previous shot's sun
  const ps = prev && !s.cut ? prev.sky : s.sky, sw = s.cut ? 1 : sstep(0, 4, STATE.t - s.start);
  STATE.sky = { az: lerp(ps.az, s.sky.az, sw), alt: lerp(ps.alt, s.sky.alt, sw) };
  if (STATE.skyOverride) STATE.sky = { ...STATE.skyOverride };
  let ep = Array.isArray(s.epoch) ? lerp(s.epoch[0], s.epoch[1], sstep(0.12, 0.9, u)) : (s.epoch ?? STATE.epoch);
  if (STATE.epochOverride != null) ep = STATE.epochOverride;
  if (Math.abs(ep - STATE.epoch) > 0.5 || !SKYSTATE.sample) { STATE.epoch = ep; const b = beltInfo(ep); placeStars(ep, b ? b.lst : 5.6); }
}
function onShot(s, prev) {
  STATE.shot = s; const a = s.act;
  const inHawara = a.id === 'II' && (s.id === 'II.3' || s.id === 'II.4');
  setLayer('hawara', inHawara); setLayer('coil', !!s.coil); setLayer('horizon', a.id === 'III'); setLayer('inside', a.id === 'III');
  setLayer('below', a.id === 'II' && !inHawara);
  if (MESH.hawara_lower) MESH.hawara_lower.setEnabled(inHawara && !!(s.lower || STATE.lower));
  const interior = !!s.interior; cam.minZ = interior ? 0.03 : inHawara ? 1 : 0.5; cam.maxZ = interior ? 400 : 90000;
  pipe.depthOfFieldEnabled = interior && tier !== 'lite';
  if (pipe.depthOfFieldEnabled) { pipe.depthOfField.focalLength = 60; pipe.depthOfField.fStop = 2.0; pipe.depthOfField.focusDistance = 3800; }
  if (s.cut) { const f = $('fade'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 650); }
  if (!blendFrom && prev && !s.cut && STATE.free === false) blendFrom = null;
  renderCaption(s); renderRail(); renderInstrument(s);
  log('shot', s.id, s.title, '| grade', a.grade, '| sky az', s.sky.az, 'alt', s.sky.alt);
}

function updateLook(dt, time) {
  const { az, alt } = STATE.sky, sv = sunVector(az, alt);
  const nightF = sstep(-3, -13, alt);
  skyMat.sunPosition = new B.Vector3(sv[0] * 100, sv[1] * 100, sv[2] * 100); skyMat.luminance = lerp(1.0, 0.25, nightF);
  sun.direction = new B.Vector3(-sv[0], -Math.max(sv[1], 0.06), -sv[2]);
  const warm = sstep(25, 2, alt), dayI = sstep(-2, 6, alt);
  sun.diffuse = new B.Color3(1, lerp(0.95, 0.62, warm), lerp(0.9, 0.36, warm)); sun.intensity = 2.4 * dayI;
  hemi.intensity = lerp(0.35, 0.05, nightF) + STATE.coil * 0.12; hemi.diffuse = B.Color3.Lerp(new B.Color3(0.75, 0.82, 1), new B.Color3(0.25, 0.35, 0.8), nightF);
  sunDisc.position = new B.Vector3(sv[0] * 14000, sv[1] * 14000, sv[2] * 14000); sunDisc.setEnabled(alt > -1.5);
  if (vls) vls.exposure = TIERS[tier].vls && alt > -1 ? 0.22 * (1 - sstep(10, 30, alt) * 0.7) : 0;
  nightMat.setFloat('night', nightF); nightMat.setFloat('storm', STATE.coil); nightMat.setVector3('sunDir', new B.Vector3(...sv));
  // fog colour follows the horizon
  const fogDay = new B.Color3(0.86, 0.64, 0.45), fogNight = new B.Color3(0.03, 0.04, 0.07), fogBlue = new B.Color3(0.25, 0.3, 0.42);
  scene.fogColor = B.Color3.Lerp(B.Color3.Lerp(fogDay, fogBlue, sstep(3, -4, alt)), fogNight, nightF); scene.fogDensity = STATE.interior > 0.5 ? 0 : lerp(0.00016, 0.00009, nightF);
  scene.environmentIntensity = lerp(1.0, 0.18, nightF) + STATE.coil * 0.2;
  if (beltLine) beltLine.alpha = STATE.stars * sstep(-6, -16, alt) * 0.75;
  if (starMat) { starMat.setFloat('night', sstep(-6, -16, alt) * (1 - STATE.coil * 0.55) * (1 - STATE.interior)); starMat.setFloat('pointScale', engine.getRenderHeight() / 900 * 2.2); starMat.setFloat('time', time); }
  const key = az.toFixed(1) + '/' + alt.toFixed(1) + '/' + STATE.coil.toFixed(2);
  if (key !== lastSkyKey && time - lastProbe > 0.4) { lastSkyKey = key; lastProbe = time; probe.cubeTexture.resetRefreshCounter(); }
  // exposure: brighter at night so the stars and arcs read
  pipe.imageProcessing.exposure = lerp(1.0, 1.35, nightF) * (STATE.interior > 0.5 ? 1.25 : 1);
  // x-ray of the ground (Act II), ghost of Khufu (Act III)
  setAlpha(MATS.sand, lerp(1, 0.12, STATE.xray)); setAlpha(MATS.limestone_old, lerp(1, 0.3, STATE.xray));
  for (const id of ['khufu', 'queen_G1a', 'queen_G1b', 'queen_G1c']) { const m = MESH[id]; if (!m) continue; const want = STATE.ghost > 0.5 ? MATS.xray : MATS.limestone; if (m.material !== want) { m.material = want; m.receiveShadows = want !== MATS.xray; } }
  MATS.xray.alpha = 0.06 + 0.09 * STATE.ghost;
  // interior lights and the authored glow
  const inside = STATE.interior, pulse = 0.8 + 0.2 * Math.sin(time * 1.7);
  chamberLight.intensity = 22 * Math.max(inside, STATE.ghost * 0.6); ankhLight.intensity = 9 * inside * pulse;
  MATS.ankh.emissiveColor = new B.Color3(0.35, 0.9, 1.0).scale(0.4 + 0.9 * inside * pulse); MATS.was.emissiveColor = new B.Color3(0.2, 0.45, 1.0).scale(0.3 + 0.8 * inside * (1.1 - pulse * 0.4));
  dust.emitRate = 70 * inside;
  // the coil: brightness is paid for by the ledger
  const avail = TESLA.st.arcAvailability ?? 0, flick = 0.65 + 0.35 * Math.abs(Math.sin(time * 23.0) * Math.sin(time * 7.3 + 1.2));
  const arcPower = STATE.coil * avail * flick;
  if (MESH.arcs) { MESH.arcs.visibility = clamp(arcPower * 1.15, 0, 1); if (MESH.arcs.material) MESH.arcs.material.emissiveColor = new B.Color3(0.55, 0.85, 1.0).scale(0.6 + 1.6 * arcPower); }
  if (MESH.field_lines) MESH.field_lines.visibility = STATE.coil * (0.35 + 0.35 * avail);
  if (MESH.beacon_links) MESH.beacon_links.visibility = STATE.coil * avail * 0.9;
  MATS.canopy.setFloat('time', time); MATS.canopy.setFloat('power', STATE.coil * (0.35 + 0.65 * (TESLA.st.chargeFraction ?? 0)));
  MATS.beacon.emissiveColor = new B.Color3(0.3, 0.85, 1.0).scale(0.2 + 1.5 * STATE.coil * avail);
  sparks.emitRate = 900 * arcPower;
  MATS.water.emissiveColor = new B.Color3(0.08, 0.42, 0.62).scale(STATE.coil * (0.15 + 0.85 * avail) * (0.85 + 0.15 * flick));
  glow.intensity = 0.7 + 0.6 * STATE.coil;
  if (MATS.water.bumpTexture) { MATS.water.bumpTexture.uOffset += dt * 0.01; MATS.water.bumpTexture.vOffset += dt * 0.004; }
}

// ---------------- the energy ledger (v5 tesla.mjs, unchanged) ----------------
function stepTesla(dt) {
  if (!TESLA.running) return;
  const s = { ...TESLA.s, supplyMW: TESLA.supply ? TESLA.s.supplyMW : 0 };
  let left = dt; while (left > 0) { const h = Math.min(left, 0.05); TESLA.st = stepReservoir(TESLA.st, s, h); left -= h; }
  const now = TESLA.st.time; if (!TESLA.hist.length || now - TESLA.hist[TESLA.hist.length - 1][0] > 0.2) { TESLA.hist.push([now, TESLA.st.energyJ]); if (TESLA.hist.length > 300) TESLA.hist.shift(); }
}
function ledgerResidual(st) { return st.initialEnergyJ + st.suppliedJ - (st.energyJ + st.dissipatedJ + st.arcJ + st.spilledJ); }

// ---------------- UI ----------------
const gchip = g => `<span class="g g-${g}" title="${GRADES[g].hint}">${GRADES[g].name}</span>`;
function renderRail() {
  $('rail').innerHTML = ACTS.map(a => `<button class="act ${STATE.shot?.act === a ? 'on' : ''}" data-act="${a.id}"><span class="num">${a.id}</span><span class="tt"><b>${a.title}</b><small>${a.sub}</small><em>${a.from}</em></span>${gchip(a.grade)}</button>
    <div class="shots ${STATE.shot?.act === a ? 'open' : ''}">${a.shots.map(s => `<button class="shot ${STATE.shot?.id === s.id ? 'on' : ''}" data-shot="${s.id}">${s.id} ${s.title}</button>`).join('')}</div>`).join('');
}
function renderCaption(s) {
  $('cap-title').innerHTML = `<span class="sid">${s.id}</span> ${s.title}`;
  $('cap-lines').innerHTML = s.cap.map(([g, txt]) => `<p>${gchip(g)}<span>${txt}</span></p>`).join('');
}
function renderInstrument(s) {
  const el = $('instrument'), a = s.act, kind = s.instrument || { I: 'numbers', II: s.id.startsWith('II.3') || s.id.startsWith('II.4') ? 'hawara' : 'depth', III: 'resonance', IV: 'ledger', V: 'sky' }[a.id];
  el.dataset.kind = kind;
  if (kind === 'numbers') el.innerHTML = `<h3>Measured stone <small>v3 geo.py · Wikipedia</small></h3><table><tr><th></th><th>base m</th><th>today m</th><th>orig. m</th></tr>${Object.entries(W.PYRAMIDS).map(([k, p]) => `<tr><td>${k}</td><td>${p.base}</td><td>${p.today}</td><td>${p.apex}</td></tr>`).join('')}<tr><td>Sphinx</td><td colspan=3>73 long · 20 high · faces 90°</td></tr><tr><td>causeway</td><td colspan=3>494.6 m</td></tr></table><p class="fine">${gchip('C')} dimensions; ${gchip('L')} positions (rounded centre coordinates, not a survey).</p>`;
  if (kind === 'depth') el.innerHTML = `<h3>Depth theatre <small>Osiris Shaft</small></h3>${[[30.37, 'C', 'sum of the three drops'], [35.45, 'C', 'deepest section label (other datum)'], [41.48, 'S', 'in no opened source']].map(([d, g, w]) => `<div class="bar"><i style="width:${d / 42 * 100}%" class="b-${g}"></i><b>${d} m</b> ${gchip(g)}<small>${w}</small></div>`).join('')}<p class="fine">Hawass 2007 (CASAE 36) via v2/v3 corrections. A number carries its datum before it is compared (Loom GZ-2).</p>`;
  if (kind === 'hawara') { const i = STATE.chapter ?? 1, c = HAWARA_CHAPTERS[i]; el.innerHTML = `<h3>Hawara chapters <small>v4.1 hawara.mjs · ${i + 1}/${HAWARA_CHAPTERS.length}</small></h3><div class="chap"><em>${c.year}</em><b>${c.title}</b><span class="tier">${c.tier}</span><p>${c.body}</p></div><div class="row"><button data-ch="-1">◀</button><button data-ch="1">▶</button><label>Lower walls <input id="lowerD" type="range" min="-70" max="-8" step="1" value="${STATE.lowerDepth}"> <b>${STATE.lowerDepth} m</b></label></div><p class="fine">${gchip('S')} lower-wall depth is an illustration (v4.1 range −8 to −70 m), not a radar depth.</p>`; }
  if (kind === 'resonance') {
    el.innerHTML = `<h3>Giza IV oscillator <small>resonance.mjs sweep, Q ${RES_DEFAULTS.q}</small></h3><canvas id="res" width="560" height="220"></canvas><p class="fine">${gchip('L')} Balezin 2018 band 0.5–1.5 MHz (200–600 m). ${gchip('A')} the curve is a dimensionless driven oscillator, x″+x′/Q+x = drive·cos(rt). Not a field solution.</p>`;
    const c = $('res').getContext('2d'), d = sweep(RES_DEFAULTS), mx = Math.max(...d.map(p => p.gain)); c.fillStyle = '#081018'; c.fillRect(0, 0, 560, 220); c.strokeStyle = '#1c3040'; for (let i = 0; i <= 10; i++) { c.beginPath(); c.moveTo(i * 56, 0); c.lineTo(i * 56, 220); c.stroke(); }
    c.strokeStyle = '#7fd8ff'; c.lineWidth = 2; c.beginPath(); d.forEach((p, i) => { const x = (p.frequency - 0.5) * 560, y = 210 - p.gain / mx * 190; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    c.fillStyle = '#9fb3c4'; c.font = '12px ui-monospace,monospace'; c.fillText('0.5 MHz', 4, 214); c.fillText('1.5 MHz', 500, 214); c.fillText('peak gain ' + mx.toFixed(2) + ' (dimensionless)', 300, 18);
  }
  if (kind === 'ledger') el.innerHTML = `<h3>Energy ledger <small>v5 tesla.mjs, live</small></h3><div class="big"><div><b id="lgE">–</b><small>stored GJ</small></div><div><b id="lgA">–</b><small>arc GW delivered</small></div><div><b id="lgV">–</b><small>bank MV</small></div></div><canvas id="lgH" width="560" height="90"></canvas>
    <div class="row"><button id="lgSup">Supply ${TESLA.supply ? 'on' : 'off'}</button><button id="lgPre">Precharge</button><button id="lgDrain">Drain</button><button id="lgRun">${TESLA.running ? 'Hold' : 'Run'}</button></div>
    <table class="tight"><tr><td>initial + supplied</td><td id="lgIn"></td></tr><tr><td>stored + arcs + losses + spilled</td><td id="lgOut"></td></tr><tr><td>residual</td><td id="lgR"></td></tr><tr><td>LC f0 / gain</td><td>${teslaResponse(TESLA.s).f0KHz.toFixed(1)} kHz / ${teslaResponse(TESLA.s).gain.toFixed(2)}</td></tr></table>
    <p class="fine">${gchip('L')} E = ½CV²: 10 µF × (50 MV)² / 2 = 12.5 GJ. Supply off: 12.5 GJ / 605 MW = 20.66 s. ${gchip('A')} the machine itself.</p>`;
  if (kind === 'sky') el.innerHTML = `<h3>Precession sky <small>v3 GizaSky · ERFA ltpb samples</small></h3><div class="big"><div><b id="skY">–</b><small>epoch</small></div><div><b id="skA">–</b><small>Alnilam at transit</small></div><div><b id="skS">–</b><small>Sirius then</small></div></div>
    <input id="epoch" type="range" min="-13000" max="2000" step="10" value="${Math.round(STATE.epoch)}"><div class="row"><button data-ep="-10499">10,500 BCE</button><button data-ep="-2559">2560 BCE</button><button data-ep="2000">2000 CE</button><button data-ep="auto">follow tour</button></div>
    <p class="fine">${gchip('L')} LST is chosen so the belt is on the meridian (a geometric illustration, not a civil time). ${gchip('S')} Orion correlation. ${Sky.LIMITATIONS.omitted.length} effects omitted: ${Sky.LIMITATIONS.omitted.join(', ')}.</p>`;
}
function tickInstrument() {
  const k = $('instrument').dataset.kind;
  if (k === 'ledger' && $('lgE')) {
    const st = TESLA.st; $('lgE').textContent = (st.energyJ / 1e9).toFixed(3); $('lgA').textContent = (st.deliveredArcW / 1e9).toFixed(3); $('lgV').textContent = (st.voltageV / 1e6).toFixed(2);
    $('lgIn').textContent = ((st.initialEnergyJ + st.suppliedJ) / 1e9).toFixed(4) + ' GJ'; $('lgOut').textContent = ((st.energyJ + st.dissipatedJ + st.arcJ + st.spilledJ) / 1e9).toFixed(4) + ' GJ'; $('lgR').textContent = ledgerResidual(st).toExponential(2) + ' J';
    const c = $('lgH').getContext('2d'); c.fillStyle = '#081018'; c.fillRect(0, 0, 560, 90); c.strokeStyle = '#7fd8ff'; c.lineWidth = 2; c.beginPath(); const H = TESLA.hist, t0 = H.length ? H[0][0] : 0, t1 = H.length ? H[H.length - 1][0] : 1;
    H.forEach(([t, e], i) => { const x = (t - t0) / Math.max(1e-6, t1 - t0) * 556 + 2, y = 86 - e / st.capacityJ * 80; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.fillStyle = '#9fb3c4'; c.font = '11px ui-monospace,monospace'; c.fillText('stored energy, last ' + (t1 - t0).toFixed(0) + ' s', 6, 12);
  }
  if (k === 'sky' && $('skY')) { const b = beltInfo(STATE.epoch); if (b) { $('skY').textContent = b.year; $('skA').textContent = b.alnilam.toFixed(1) + '°'; $('skS').textContent = b.sirius.toFixed(1) + '°'; const e = $('epoch'); if (document.activeElement !== e) e.value = Math.round(STATE.epoch); } }
}
function renderLedger() {
  const f = STATE.filter || 'all';
  $('ledger-list').innerHTML = LEDGER.filter(r => f === 'all' || r.g === f).map(r => `<li>${gchip(r.g)}<div><b>${r.claim}</b><small>${r.id} · ${r.from} · ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${r.src}</a>` : r.src}</small></div></li>`).join('');
  $('ledger-count').textContent = Object.keys(GRADES).map(g => `${GRADES[g].name} ${LEDGER.filter(r => r.g === g).length}`).join(' · ');
}
function bindUI() {
  $('rail').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const s = b.dataset.shot ? SHOTS.find(x => x.id === b.dataset.shot) : SHOTS.find(x => x.act.id === b.dataset.act); if (s) seek(s.start + 0.01, true); });
  $('play').onclick = () => setPlaying(!STATE.playing);
  $('scrub').max = TOTAL; $('scrub').oninput = e => seek(+e.target.value, true);
  $('marks').innerHTML = ACTS.map(a => { const s = SHOTS.find(x => x.act === a); return `<span style="left:${s.start / TOTAL * 100}%">${a.id}</span>`; }).join('');
  $('tier').onchange = e => applyTier(e.target.value);
  $('btn-visor').onclick = () => { STATE.visorForce = STATE.visorForce == null ? 1 : STATE.visorForce === 1 ? 0 : null; $('btn-visor').dataset.state = STATE.visorForce == null ? 'auto' : STATE.visorForce ? 'on' : 'off'; $('btn-visor').textContent = 'VISOR · ' + $('btn-visor').dataset.state; };
  $('btn-ledger').onclick = () => document.body.classList.toggle('ledger-open');
  $('ledger-filter').onclick = e => { const b = e.target.closest('button'); if (!b) return; STATE.filter = b.dataset.g; renderLedger(); };
  $('instrument').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ch) { STATE.chapter = clamp((STATE.chapter ?? 1) + +b.dataset.ch, 0, HAWARA_CHAPTERS.length - 1); renderInstrument(STATE.shot); }
    if (b.dataset.ep) { STATE.epochOverride = b.dataset.ep === 'auto' ? null : +b.dataset.ep; }
    if (b.id === 'lgSup') { TESLA.supply = !TESLA.supply; b.textContent = 'Supply ' + (TESLA.supply ? 'on' : 'off'); log('ledger: supply', TESLA.supply ? 'on (600 MW)' : 'off'); }
    if (b.id === 'lgPre') { TESLA.st = createReservoir(TESLA.s, 1); TESLA.hist = []; log('ledger: precharge 12.5 GJ, new ledger with explicit initial energy'); }
    if (b.id === 'lgDrain') { TESLA.st = createReservoir(TESLA.s, 0); TESLA.hist = []; log('ledger: drained, new empty ledger'); }
    if (b.id === 'lgRun') { TESLA.running = !TESLA.running; b.textContent = TESLA.running ? 'Hold' : 'Run'; } });
  $('instrument').addEventListener('input', e => { if (e.target.id === 'epoch') STATE.epochOverride = +e.target.value;
    if (e.target.id === 'lowerD') { STATE.lowerDepth = +e.target.value; STATE.lower = 1; if (MESH.hawara_lower) { MESH.hawara_lower.unfreezeWorldMatrix(); MESH.hawara_lower.position.y = STATE.lowerDepth + 10; MESH.hawara_lower.setEnabled(true); } e.target.nextElementSibling.textContent = STATE.lowerDepth + ' m'; } });
  canvas.addEventListener('pointerdown', () => { if (STATE.playing) setPlaying(false); STATE.free = true; });
  addEventListener('keydown', e => { if (e.target.closest('input,select,textarea')) return; if (e.code === 'Space') { e.preventDefault(); setPlaying(!STATE.playing); } if (e.key === 'v' || e.key === 'V') $('btn-visor').click(); if (e.key === 'l' || e.key === 'L') $('btn-ledger').click();
    if (e.key === 'ArrowRight') { const [, i] = shotAt(STATE.t); if (SHOTS[i + 1]) seek(SHOTS[i + 1].start + 0.01, true); } if (e.key === 'ArrowLeft') { const [s, i] = shotAt(STATE.t); const j = STATE.t - s.start > 2 ? i : i - 1; if (SHOTS[j]) seek(SHOTS[j].start + 0.01, true); } });
  renderLedger();
}
function setPlaying(p) { STATE.playing = p; $('play').textContent = p ? '❚❚' : '▶'; $('play').setAttribute('aria-label', p ? 'Pause' : 'Play'); if (p && STATE.free) { blendFrom = { p: [cam.position.x, cam.position.y, cam.position.z], t: [cam.target.x, cam.target.y, cam.target.z], fov: cam.fov }; STATE.free = false; } }
function seek(t, jump) { STATE.t = clamp(t, 0, TOTAL - 0.01); if (jump) { STATE.free = false; blendFrom = { p: [cam.position.x, cam.position.y, cam.position.z], t: [cam.target.x, cam.target.y, cam.target.z], fov: cam.fov }; const [s] = shotAt(STATE.t); if (s.cut || s.act !== STATE.shot?.act) blendFrom = null; } }

// ---------------- HUD ----------------
let fpsAvg = 0, frames = 0, lowFor = 0;
function hud(dt) {
  frames++; const f = dt > 0 ? 1 / dt : 0; fpsAvg = fpsAvg ? fpsAvg * 0.95 + f * 0.05 : f;   // measured from frame deltas (engine.getFps() reads Infinity headless)
  const nowS = performance.now(); if (nowS - (hud.last || 0) > 400) { hud.last = nowS;
    $('hud').innerHTML = `<b>${fpsAvg.toFixed(0)}</b> fps · ${tier} · ${engine.getRenderWidth()}×${engine.getRenderHeight()} · ${scene.getActiveMeshes().length} active meshes · Babylon ${B.Engine.Version} · ${GL.renderer}`;
    $('scrub').value = STATE.t; $('clock').textContent = fmt(STATE.t) + ' / ' + fmt(TOTAL);
    tickInstrument();
  }
  if (Q.get('q') == null && tier !== 'lite' && frames > 120) { lowFor = fpsAvg < 14 ? lowFor + dt : 0; if (lowFor > 4) { log('auto quality: average', fpsAvg.toFixed(1), 'fps for 4 s on', GL.renderer, '→ stepping down'); applyTier(tier === 'cinematic' ? 'balanced' : 'lite'); lowFor = 0; } }
}
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const GL = { renderer: '?', vendor: '?' };

// ---------------- boot ----------------
async function boot() {
  const t0 = performance.now();
  const info = engine.getGlInfo(); Object.assign(GL, { renderer: info.renderer, vendor: info.vendor, version: info.version });
  log('engine', 'Babylon', B.Engine.Version, '| WebGL', engine.webGLVersion, '|', info.vendor, '|', info.renderer);
  textures(); materials(); const census = buildWorld();
  MESH.canopy && (MESH.canopy.material = MATS.canopy, MESH.canopy.alphaIndex = 5, MESH.canopy.applyFog = false);
  buildSky(); buildLights(); buildParticles(); buildPost(); await buildStars();
  applyTier(Q.get('q') || 'balanced');
  bindUI();
  const startShot = Q.get('shot') && SHOTS.find(s => s.id === Q.get('shot'));
  if (startShot) STATE.t = startShot.start + (+Q.get('u') || 0.5) * startShot.dur;
  if (Q.get('t')) STATE.t = +Q.get('t');
  if (Q.get('pause') != null || startShot) setPlaying(false); else setPlaying(true);
  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (STATE.playing) { STATE.t += dt; if (STATE.t >= TOTAL) STATE.t = 0; }
    direct(dt); stepTesla(dt); updateLook(dt, now / 1000); scene.render(); hud(dt);
  });
  addEventListener('resize', () => engine.resize());
  document.addEventListener('visibilitychange', () => { if (document.hidden) engine.stopRenderLoop(); else { last = performance.now(); engine.runRenderLoop(() => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; if (STATE.playing) { STATE.t += dt; if (STATE.t >= TOTAL) STATE.t = 0; } direct(dt); stepTesla(dt); updateLook(dt, now / 1000); scene.render(); hud(dt); }); } });
  $('boot').classList.add('done');
  log('ready in', (performance.now() - t0).toFixed(0), 'ms;', TOTAL, 's tour,', SHOTS.length, 'shots,', LEDGER.length, 'ledger claims');
  if (Q.get('sky')) { const [az, alt] = Q.get('sky').split(',').map(Number); STATE.skyOverride = { az, alt }; }
  window.__giza6 = { ready: true, scene, MESH, MATS, cam, census, STATE, TESLA, seek, shots: SHOTS.map(s => s.id), gl: GL, setShot: (id, u = 0.5) => { const s = SHOTS.find(x => x.id === id); STATE.t = s.start + u * s.dur; setPlaying(false); blendFrom = null; },
    report: () => ({ schema: 'giza-vi-report/v1', babylon: B.Engine.Version, gl: GL, tier, fps: +fpsAvg.toFixed(1), t: STATE.t, shot: STATE.shot?.id, census, ledger: { ...TESLA.st, residualJ: ledgerResidual(TESLA.st) }, sky: { epoch: STATE.epoch, belt: beltInfo(STATE.epoch) } }) };
}
boot().catch(e => { console.error(e); $('boot').innerHTML = `<p>Giza VI could not start: ${e.message}</p><p>WebGL 2 is required. The X3D twin and earlier versions are linked above.</p>`; });
