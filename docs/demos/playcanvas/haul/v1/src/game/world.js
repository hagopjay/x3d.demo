// HAUL world in PlayCanvas: the level's ground (its ElevationGrid, coloured by surface, darker and glossier as it
// gets wet), puddles that fill with the rain, roadside rocks and pines, grade signs at each pitch, the summit arch,
// the sky, fog, rain, lightning, and the particle effects (exhaust, spray, mud).
import * as pc from '../../vendor/playcanvas.min.mjs';
import { SURFACES } from '../sim/spec.js';
import { rng, roadCentre, sample } from '../sim/level.js';
import { elevationMesh } from './x3d-pc.js';

const SKIES = {
  clear: { sky: [0.56, 0.72, 0.9], fog: [0.72, 0.8, 0.88], sun: 1.6, ambient: 0.42, fogEnd: 620, rain: 0 },
  overcast: { sky: [0.55, 0.6, 0.66], fog: [0.6, 0.64, 0.68], sun: 0.9, ambient: 0.38, fogEnd: 420, rain: 0.3 },
  rain: { sky: [0.4, 0.44, 0.5], fog: [0.45, 0.48, 0.53], sun: 0.6, ambient: 0.32, fogEnd: 300, rain: 0.6 },
  heavy: { sky: [0.3, 0.33, 0.38], fog: [0.33, 0.36, 0.4], sun: 0.45, ambient: 0.27, fogEnd: 220, rain: 0.85 },
  storm: { sky: [0.16, 0.18, 0.23], fog: [0.2, 0.22, 0.27], sun: 0.3, ambient: 0.2, fogEnd: 170, rain: 1.0 },
};

/** A soft round sprite for particles, drawn on a canvas. */
function puffTexture(device, hard = 0.0) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4 + hard * 0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new pc.Texture(device, { width: 64, height: 64, format: pc.PIXELFORMAT_RGBA8, mipmaps: true });
  t.setSource(c);
  return t;
}

function curve(pairs) { return new pc.Curve(pairs.flat()); }
function curveSet(...rows) { return new pc.CurveSet(rows.map((r) => r.flat())); }

function std(color, { metal = 0, gloss = 0.3, emissive = null, opacity = 1 } = {}) {
  const m = new pc.StandardMaterial();
  m.useMetalness = true; m.diffuse = new pc.Color(...color); m.metalness = metal; m.gloss = gloss;
  if (emissive) { m.emissive = new pc.Color(...emissive); m.emissiveIntensity = 1.5; }
  if (opacity < 1) { m.opacity = opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
  m.update();
  return m;
}

export function buildWorld(app, level) {
  const device = app.graphicsDevice;
  const root = new pc.Entity('world');
  app.root.addChild(root);
  const sky = SKIES[level.sky] || SKIES.clear;
  const r = rng(level.design.seed ? level.design.seed * 7 + 1 : 99);

  // ---- ground: vertex colours from the surface ids, with grain ----
  const n = level.nx * level.nz;
  const colors = new Uint8Array(n * 4);            // RGBA bytes per vertex (Mesh.setColors32)
  const base = new Float32Array(n * 3);
  for (let j = 0; j < level.nz; j++) {
    for (let i = 0; i < level.nx; i++) {
      const k = i + j * level.nx;
      const s = SURFACES[level.surface[k]];
      const grain = 0.86 + 0.28 * (((i * 73856093) ^ (j * 19349663)) % 1000) / 1000;
      const x = level.x0 + i * level.dx, z = level.z0 + j * level.dz;
      const edge = Math.abs(z - roadCentre(level, x));
      const lane = edge < 3.5 && Math.abs(edge - 1.02) < 0.35 && s.id <= 2 ? 0.86 : 1;     // worn wheel tracks
      for (let c = 0; c < 3; c++) base[k * 3 + c] = Math.min(1, s.color[c] * grain * lane);
    }
  }
  const groundMesh = elevationMesh(device, level, colors);
  const groundMat = new pc.StandardMaterial();
  groundMat.diffuse = new pc.Color(1, 1, 1);
  groundMat.diffuseVertexColor = true;
  groundMat.useMetalness = true; groundMat.metalness = 0; groundMat.gloss = 0.15;
  groundMat.update();
  const ground = new pc.Entity('ground');
  ground.addComponent('render', { meshInstances: [new pc.MeshInstance(groundMesh, groundMat)] });
  ground.render.receiveShadows = true; ground.render.castShadows = false;
  ground.setLocalPosition(level.x0, 0, level.z0);
  root.addChild(ground);
  function tintGround(wetness) {
    const dark = 1 - 0.42 * wetness;
    for (let k = 0; k < n; k++) {
      colors[k * 4] = Math.min(255, Math.round(255 * base[k * 3] * dark));
      colors[k * 4 + 1] = Math.min(255, Math.round(255 * base[k * 3 + 1] * dark));
      colors[k * 4 + 2] = Math.min(255, Math.round(255 * base[k * 3 + 2] * (dark + 0.04 * wetness)));
      colors[k * 4 + 3] = 255;
    }
    groundMesh.setColors32(colors);
    groundMesh.update();
    groundMat.gloss = 0.15 + 0.6 * wetness;
    groundMat.update();
  }

  // ---- puddles: water sheets where the grid holds standing water ----
  const water = std([0.24, 0.29, 0.32], { metal: 0.0, gloss: 0.95, opacity: 0.0 });
  const puddles = [];
  for (let j = 0; j < level.nz; j += 1) {
    for (let i = 0; i < level.nx; i += 2) {
      const k = i + j * level.nx;
      if (level.puddle[k] > 0.015) {
        const x = level.x0 + i * level.dx, z = level.z0 + j * level.dz;
        const e = new pc.Entity('puddle');
        e.addComponent('render', { type: 'plane', material: water });
        e.render.castShadows = false;
        e.setLocalPosition(x, level.heights[k] + level.puddle[k] * 0.6, z);
        e.setLocalScale(1.3, 1, 0.9);
        root.addChild(e);
        puddles.push(e);
      }
    }
  }

  // ---- roadside: rocks up the face, pines down the drop ----
  const rock = std([0.42, 0.42, 0.44], { gloss: 0.25 });
  const bark = std([0.28, 0.18, 0.1]);
  const needles = std([0.09, 0.22, 0.12], { gloss: 0.1 });
  for (let x = 6; x < level.length - 6; x += 3 + r() * 5) {
    const zc = roadCentre(level, x);
    const side = r() < 0.55 ? 1 : -1;
    const z = zc + side * (6 + r() * 14);
    if (z < level.z0 + 1 || z > level.z0 + (level.nz - 1) * level.dz - 1) continue;
    const y = sample(level, x, z).y;
    if (side > 0) {
      const e = new pc.Entity('rock');
      e.addComponent('render', { type: r() < 0.5 ? 'box' : 'sphere', material: rock });
      const s = 0.6 + r() * 2.4;
      e.setLocalScale(s, s * (0.5 + r() * 0.6), s * (0.7 + r() * 0.6));
      e.setLocalEulerAngles(r() * 40, r() * 360, r() * 30);
      e.setLocalPosition(x, y + s * 0.2, z);
      root.addChild(e);
    } else {
      const h = 5 + r() * 7;
      const tree = new pc.Entity('pine');
      const trunk = new pc.Entity('trunk'); trunk.addComponent('render', { type: 'cylinder', material: bark });
      trunk.setLocalScale(0.35, h * 0.4, 0.35); trunk.setLocalPosition(0, h * 0.2, 0);
      const crown = new pc.Entity('crown'); crown.addComponent('render', { type: 'cone', material: needles });
      crown.setLocalScale(h * 0.42, h * 0.8, h * 0.42); crown.setLocalPosition(0, h * 0.6, 0);
      tree.addChild(trunk); tree.addChild(crown);
      tree.setLocalPosition(x, y, z);
      root.addChild(tree);
    }
  }

  // ---- grade signs at each pitch, the start line and the summit arch ----
  const signMat = std([0.98, 0.78, 0.1], { gloss: 0.4 });
  const postMat = std([0.3, 0.3, 0.32], { metal: 0.6 });
  const signs = [];
  for (const p of level.pitches) {
    const x = p.x0 - 6, zc = roadCentre(level, x), z = zc - 4.6;
    const y = sample(level, x, z).y;
    const sign = new pc.Entity('sign');
    const post = new pc.Entity('post'); post.addComponent('render', { type: 'cylinder', material: postMat });
    post.setLocalScale(0.1, 2.4, 0.1); post.setLocalPosition(0, 1.2, 0);
    const plate = new pc.Entity('plate'); plate.addComponent('render', { type: 'box', material: signMat });
    plate.setLocalScale(0.08, 0.9, 0.9); plate.setLocalPosition(0, 2.6, 0); plate.setLocalEulerAngles(45, 0, 0);
    sign.addChild(post); sign.addChild(plate);
    sign.setLocalPosition(x, y, z);
    root.addChild(sign);
    signs.push({ x, y: y + 3.4, z, grade: p.g, pitch: p });
  }
  const archMat = std([0.07, 0.07, 0.08], { metal: 0.3 });
  const glow = std([1, 0.24, 0.5], { emissive: [1, 0.24, 0.5] });
  function arch(x, label, mat2) {
    const zc = roadCentre(level, x), y = sample(level, x, zc).y;
    const a = new pc.Entity(label);
    for (const side of [1, -1]) {
      const leg = new pc.Entity('leg'); leg.addComponent('render', { type: 'box', material: archMat });
      leg.setLocalScale(0.4, 6, 0.4); leg.setLocalPosition(0, 3, side * 4.6); a.addChild(leg);
    }
    const bar = new pc.Entity('bar'); bar.addComponent('render', { type: 'box', material: mat2 });
    bar.setLocalScale(0.5, 0.6, 9.6); bar.setLocalPosition(0, 6, 0); a.addChild(bar);
    a.setLocalPosition(x, y, zc);
    root.addChild(a);
    return a;
  }
  arch(level.start + 6, 'start', archMat);
  arch(level.summit, 'summit', glow);

  // ---- light, sky, fog ----
  const sun = new pc.Entity('sun');
  sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.9), intensity: sky.sun, castShadows: true, shadowDistance: 70, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.05 });
  sun.setLocalEulerAngles(48, 35, 0);
  root.addChild(sun);
  app.scene.ambientLight = new pc.Color(sky.ambient, sky.ambient * 1.03, sky.ambient * 1.1);
  const fog = app.scene.fog;
  fog.type = pc.FOG_LINEAR; fog.color = new pc.Color(...sky.fog); fog.start = 40; fog.end = sky.fogEnd;

  // ---- particles: rain (follows the camera), exhaust, spray, mud ----
  const puff = puffTexture(device), drop = puffTexture(device, 0.8);
  const rain = new pc.Entity('rain');
  rain.addComponent('particlesystem', {
    numParticles: 2400, lifetime: 0.9, rate: 0.0008, rate2: 0.0008, emitterShape: pc.EMITTERSHAPE_BOX,
    emitterExtents: new pc.Vec3(50, 1, 50), velocityGraph: curveSet([[0, -1.5]], [[0, -19]], [[0, 0.5]]),
    scaleGraph: curve([[0, 0.07]]), alphaGraph: curve([[0, 0.55]]), colorGraph: curveSet([[0, 0.78]], [[0, 0.82]], [[0, 0.9]]),
    colorMap: drop, stretch: 3.5, alignToMotion: true, blendType: pc.BLEND_NORMAL, depthWrite: false, loop: true, autoPlay: true, localSpace: false,
  });
  root.addChild(rain);

  const smokeColor = curveSet([[0, 0.35, 1, 0.55]], [[0, 0.35, 1, 0.55]], [[0, 0.36, 1, 0.57]]);
  function smoke(name) {
    const e = new pc.Entity(name);
    e.addComponent('particlesystem', {
      numParticles: 900, lifetime: 4.5, rate: 0.03, rate2: 0.06, emitterShape: pc.EMITTERSHAPE_SPHERE, emitterRadius: 0.08,
      velocityGraph: curveSet([[0, 0, 1, 1.5]], [[0, 5.5, 1, 1.2]], [[0, 0, 1, -1.2]]), velocityGraph2: curveSet([[0, -0.6, 1, 2.5]], [[0, 3.5, 1, 0.4]], [[0, -0.6, 1, -0.2]]),
      scaleGraph: curve([[0, 0.25], [1, 4.2]]), alphaGraph: curve([[0, 0.0], [0.06, 0.75], [1, 0]]), colorGraph: smokeColor,
      colorMap: puff, blendType: pc.BLEND_NORMAL, depthWrite: false, loop: true, autoPlay: true, localSpace: false, randomizeRotation: true,
      rotationSpeedGraph: curve([[0, -30]]), rotationSpeedGraph2: curve([[0, 30]]),
    });
    return e;
  }
  function spray(name, color, gravity = -9.8, life = 0.8) {
    const e = new pc.Entity(name);
    e.addComponent('particlesystem', {
      numParticles: 500, lifetime: life, rate: 0.02, rate2: 0.04, emitterShape: pc.EMITTERSHAPE_BOX, emitterExtents: new pc.Vec3(0.5, 0.1, 0.4),
      velocityGraph: curveSet([[0, -3, 1, -2]], [[0, 3, 1, gravity * life * 0.6]], [[0, -1.5, 1, -1]]), velocityGraph2: curveSet([[0, -7, 1, -4]], [[0, 6, 1, gravity * life * 0.4]], [[0, 1.5, 1, 1]]),
      scaleGraph: curve([[0, 0.12], [1, 0.45]]), alphaGraph: curve([[0, 0.7], [1, 0]]), colorGraph: curveSet([[0, color[0]]], [[0, color[1]]], [[0, color[2]]]),
      colorMap: puff, blendType: pc.BLEND_NORMAL, depthWrite: false, loop: true, autoPlay: true, localSpace: false,
    });
    return e;
  }
  return { root, sky, sun, rain, tintGround, puddles, water, signs, smoke, spray, level };
}

/** Per-frame weather: wetness tints the ground and fills the puddles; rain density; lightning in a storm. */
export function updateWeather(world, wetness, rainNow, dt, camera, state) {
  if (Math.abs((state.lastWet ?? -1) - wetness) > 0.02) { world.tintGround(wetness); state.lastWet = wetness; }
  world.water.opacity = Math.min(0.85, wetness * 1.1);
  world.water.update();
  const cp = camera.getPosition();
  world.rain.setPosition(cp.x + 8, cp.y + 14, cp.z + 4);
  const ps = world.rain.particlesystem;
  if (rainNow < 0.02) { if (ps.isPlaying()) ps.stop(); }
  else {
    if (!ps.isPlaying()) ps.play();
    const rate = 0.0004 / Math.max(0.05, rainNow);
    if (!state.rainRate || Math.abs(rate / state.rainRate - 1) > 0.25) { ps.rate = rate; ps.rate2 = rate; state.rainRate = rate; }   // a rate set restarts the emitter
  }
  // lightning: a white flash and the ambient lifts for a moment
  if (world.sky === undefined) return;
  state.flash = Math.max(0, (state.flash || 0) - dt * 4);
  if (world.level.sky === 'storm' && Math.random() < dt * 0.09) { state.flash = 1; state.thunder = 0.6 + Math.random() * 2.5; }
  const a = world.sky.ambient + state.flash * 1.6;
  world.sun.light.intensity = world.sky.sun + state.flash * 3;
  return a;
}
