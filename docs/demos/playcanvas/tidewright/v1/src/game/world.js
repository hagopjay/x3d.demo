// TIDEWRIGHT world in PlayCanvas: the valley (the level's ElevationGrid, the solver's bed, one vertex per cell,
// coloured by material and by the player's cut and fill), the water surface (one vertex per cell, at bed + depth,
// coloured by depth and speed, hidden where dry), the town and gauge from the same X3D file, the brush ring,
// the sky and the light.
import * as pc from '../../vendor/playcanvas.min.mjs';
import { MATERIALS } from '../sim/level.js';
import { loadX3D } from './x3d-pc.js';

function gridIndices(nx, nz) {
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  return idx;
}
function normalsFor(nx, nz, dx, y, out) {
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const n = i + j * nx;
    const gx = (y[i < nx - 1 ? n + 1 : n] - y[i > 0 ? n - 1 : n]) / ((i > 0 && i < nx - 1 ? 2 : 1) * dx);
    const gz = (y[j < nz - 1 ? n + nx : n] - y[j > 0 ? n - nx : n]) / ((j > 0 && j < nz - 1 ? 2 : 1) * dx);
    const l = Math.hypot(gx, 1, gz);
    out[3 * n] = -gx / l; out[3 * n + 1] = 1 / l; out[3 * n + 2] = -gz / l;
  }
}

export function buildWorld(app, level, x3dText) {
  const device = app.graphicsDevice, { nx, nz, dx } = level, N = nx * nz;
  const root = new pc.Entity('world'); app.root.addChild(root);
  const idx = gridIndices(nx, nz);

  // ---- terrain ----
  const tPos = new Float32Array(N * 3), tNor = new Float32Array(N * 3), tCol = new Uint8Array(N * 4), ty = new Float32Array(N);
  const tMesh = new pc.Mesh(device);
  const tMat = new pc.StandardMaterial();
  tMat.diffuseVertexColor = true; tMat.useMetalness = true; tMat.metalness = 0; tMat.gloss = 0.12; tMat.update();
  function setBed(bed, b0, bags) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      tPos[3 * k] = i * dx; tPos[3 * k + 1] = bed[k]; tPos[3 * k + 2] = j * dx; ty[k] = bed[k];
    }
    normalsFor(nx, nz, dx, ty, tNor);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx, m = MATERIALS[level.mat[k]];
      const grain = 0.9 + 0.2 * ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000) / 1000;
      const shade = 0.35 + 0.65 * tNor[3 * k + 1] ** 4;
      let c = m.color.slice();
      const d = bed[k] - b0[k];
      if (bags && bags[k]) c = [0.82, 0.74, 0.5];
      else if (d < -0.02) { const w = Math.min(1, -d / 1.2); c = c.map((v, q) => v * (1 - w) + [0.42, 0.3, 0.2][q] * w); }
      else if (d > 0.02) { const w = Math.min(1, d / 0.8); c = c.map((v, q) => v * (1 - w) + [0.72, 0.58, 0.38][q] * w); }
      for (let q = 0; q < 3; q++) tCol[4 * k + q] = Math.max(0, Math.min(255, Math.round(255 * c[q] * grain * shade)));
      tCol[4 * k + 3] = 255;
    }
    tMesh.setPositions(tPos); tMesh.setNormals(tNor); tMesh.setColors32(tCol); tMesh.setIndices(idx); tMesh.update(pc.PRIMITIVE_TRIANGLES);
  }
  setBed(level.bed, level.bed, null);
  // the mesh is filled before its instance exists, so PlayCanvas picks the vertex-colour shader variant
  const terrain = new pc.Entity('terrain');
  terrain.addComponent('render', { meshInstances: [new pc.MeshInstance(tMesh, tMat)] });
  terrain.render.castShadows = true; terrain.render.receiveShadows = true;
  root.addChild(terrain);

  // ---- water ----
  const wPos = new Float32Array(N * 3), wNor = new Float32Array(N * 3), wCol = new Uint8Array(N * 4), wy = new Float32Array(N);
  const wMesh = new pc.Mesh(device);
  const wMat = new pc.StandardMaterial();
  wMat.diffuseVertexColor = true; wMat.opacityVertexColor = true; wMat.opacityVertexColorChannel = 'a';
  wMat.blendType = pc.BLEND_NORMAL; wMat.depthWrite = false; wMat.cull = pc.CULLFACE_NONE;
  wMat.useMetalness = true; wMat.metalness = 0.1; wMat.gloss = 0.82; wMat.specular = new pc.Color(0.6, 0.65, 0.7);
  wMat.update();
  /** st: { h, hu, hv } on the fine grid; bed: the current bed; mode 'depth' | 'speed' | 'bad' (tint). */
  function setWater(st, bed, tint = null) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx, h = st.h[k];
      const wet = h > 0.01;
      wy[k] = wet ? bed[k] + h : bed[k] - 0.35;
      wPos[3 * k] = i * dx; wPos[3 * k + 1] = wy[k]; wPos[3 * k + 2] = j * dx;
    }
    normalsFor(nx, nz, dx, wy, wNor);
    for (let k = 0; k < N; k++) {
      const h = st.h[k];
      if (!(h > 0.01)) { wCol[4 * k + 3] = 0; continue; }
      const u = st.hu[k] / h, v = st.hv[k] / h, sp = Math.min(1, Math.sqrt(u * u + v * v) / 2.5);
      const deep = Math.min(1, h / 3);
      let r = 0.22 - 0.16 * deep, g = 0.5 - 0.26 * deep, b = 0.6 - 0.12 * deep;
      r += (0.86 - r) * sp * 0.6; g += (0.9 - g) * sp * 0.6; b += (0.92 - b) * sp * 0.6;     // fast water whitens
      if (tint) { r = r * 0.5 + tint[0] * 0.5; g = g * 0.5 + tint[1] * 0.5; b = b * 0.5 + tint[2] * 0.5; }
      wCol[4 * k] = Math.round(255 * r); wCol[4 * k + 1] = Math.round(255 * g); wCol[4 * k + 2] = Math.round(255 * b);
      wCol[4 * k + 3] = Math.round(255 * Math.min(0.88, 0.45 + 0.6 * Math.min(1, h / 0.6)));
    }
    wMesh.setPositions(wPos); wMesh.setNormals(wNor); wMesh.setColors32(wCol); wMesh.setIndices(idx); wMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  { const z = new Float32Array(N); setWater({ h: z, hu: z, hv: z }, level.bed); }
  const water = new pc.Entity('water');
  water.addComponent('render', { meshInstances: [new pc.MeshInstance(wMesh, wMat)] });
  water.render.castShadows = false;
  root.addChild(water);

  // ---- the town, the gauge: from the same X3D file ----
  const x = loadX3D(app, x3dText);
  root.addChild(x.root);
  const houseMats = level.houses.map((_, k) => x.materials['HouseMat' + k]);
  function setHouses(flooded) {
    houseMats.forEach((m, k) => { if (!m) return; const f = flooded && flooded[k]; m.diffuse = f ? new pc.Color(0.35, 0.42, 0.62) : new pc.Color(0.9, 0.86, 0.78); m.emissive = f ? new pc.Color(0.05, 0.08, 0.2) : new pc.Color(0, 0, 0); m.update(); });
  }

  // ---- the brush ring ----
  const ringMat = new pc.StandardMaterial();
  ringMat.diffuse = new pc.Color(0, 0, 0); ringMat.emissive = new pc.Color(1, 0.24, 0.5); ringMat.emissiveIntensity = 1;
  ringMat.opacity = 0.55; ringMat.blendType = pc.BLEND_NORMAL; ringMat.depthWrite = false; ringMat.update();
  const ring = new pc.Entity('brush');
  ring.addComponent('render', { type: 'torus', material: ringMat });
  ring.render.castShadows = false;
  root.addChild(ring);
  function setBrush(p, radius, color) {
    ring.enabled = !!p;
    if (!p) return;
    ring.setPosition(p.x, p.y + 0.6, p.z);
    ring.setLocalScale(radius * 2, 3, radius * 2);
    ringMat.emissive = new pc.Color(...color); ringMat.update();
  }

  // ---- light and sky ----
  const sun = new pc.Entity('sun');
  sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.95, 0.86), intensity: 1.0, castShadows: true, shadowDistance: 1400, shadowResolution: 2048, shadowBias: 0.3, normalOffsetBias: 0.6 });
  sun.setEulerAngles(52, -35, 0);
  root.addChild(sun);
  app.scene.ambientLight = new pc.Color(0.26, 0.28, 0.32);
  app.scene.fog.type = pc.FOG_LINEAR; app.scene.fog.color = new pc.Color(0.62, 0.68, 0.74); app.scene.fog.start = 900; app.scene.fog.end = 2600;

  /** Height of the (current) bed at world (x, z), bilinear. */
  function bedAt(bed, px, pz) {
    const fi = Math.max(0, Math.min(nx - 1.001, px / dx)), fj = Math.max(0, Math.min(nz - 1.001, pz / dx));
    const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, k = j * nx + i;
    return bed[k] * (1 - a) * (1 - b) + bed[k + 1] * a * (1 - b) + bed[k + nx] * (1 - a) * b + bed[k + nx + 1] * a * b;
  }
  return { root, setBed, setWater, setHouses, setBrush, bedAt, defs: x.defs };
}
