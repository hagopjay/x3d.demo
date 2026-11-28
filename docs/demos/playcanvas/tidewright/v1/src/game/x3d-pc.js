// X3D (XML encoding) to PlayCanvas, copied from HAUL (hagopjay/x3d.kansei-haul, MIT): the nodes TIDEWRIGHT's levels use, read
// with the same parser the simulation uses. Transform, Group, Switch, Shape, Appearance with PhysicalMaterial or Material (DEF/USE),
// Box, Cylinder, Sphere, Cone, and ElevationGrid meshes. Every DEF'd Transform becomes a named entity (defs[name]).
import * as pc from '../../vendor/playcanvas.min.mjs';
import { parseXML, nums } from '../sim/x3dxml.js';

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }

/**
 * Build a PlayCanvas material from an X3D PhysicalMaterial or Material. X3D colour numbers are read as linear
 * values (the reading x3d-blender-io and X3DOM use for PhysicalMaterial), and PlayCanvas's colours are sRGB, so
 * they are encoded on the way in.
 */
function material(node) {
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const col = (s, d) => { const a = s ? nums(s) : d; return new pc.Color(enc(a[0]), enc(a[1]), enc(a[2])); };
  if (node.name === 'PhysicalMaterial') {
    m.diffuse = col(node.attrs.baseColor, [1, 1, 1]);
    m.metalness = Number(node.attrs.metallic ?? 1);
    m.gloss = 1 - Number(node.attrs.roughness ?? 1);
  } else {
    m.diffuse = col(node.attrs.diffuseColor, [0.8, 0.8, 0.8]);
    m.metalness = 0;
    m.gloss = Number(node.attrs.shininess ?? 0.2);
  }
  const em = node.attrs.emissiveColor ? nums(node.attrs.emissiveColor) : [0, 0, 0];
  if (em[0] + em[1] + em[2] > 0) { m.emissive = col(node.attrs.emissiveColor, [0, 0, 0]); m.emissiveIntensity = 2.2; }
  const t = Number(node.attrs.transparency || 0);
  if (t > 0) { m.opacity = 1 - t; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
  m.update();
  return m;
}

function applyTransform(entity, el) {
  if (el.attrs.translation) { const t = nums(el.attrs.translation); entity.setLocalPosition(t[0], t[1], t[2]); }
  if (el.attrs.rotation) {
    const r = nums(el.attrs.rotation);
    const q = new pc.Quat().setFromAxisAngle(new pc.Vec3(r[0], r[1], r[2]).normalize(), r[3] * pc.math.RAD_TO_DEG);
    entity.setLocalRotation(q);
  }
  if (el.attrs.scale) { const s = nums(el.attrs.scale); entity.setLocalScale(s[0], s[1], s[2]); }
}

/** An ElevationGrid as a PlayCanvas mesh (positions, smooth normals, optional per-vertex colours). */
export function elevationMesh(device, grid, colors) {
  const nx = grid.nx, nz = grid.nz, dx = grid.dx, dz = grid.dz, H = grid.heights;
  const positions = new Float32Array(nx * nz * 3), normals = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const n = i + j * nx;
      positions[n * 3] = i * dx; positions[n * 3 + 1] = H[n]; positions[n * 3 + 2] = j * dz;
      const hl = H[i > 0 ? n - 1 : n], hr = H[i < nx - 1 ? n + 1 : n], hd = H[j > 0 ? n - nx : n], hu = H[j < nz - 1 ? n + nx : n];
      const gx = (hr - hl) / ((i > 0 && i < nx - 1 ? 2 : 1) * dx), gz = (hu - hd) / ((j > 0 && j < nz - 1 ? 2 : 1) * dz);
      const l = Math.hypot(gx, 1, gz);
      normals[n * 3] = -gx / l; normals[n * 3 + 1] = 1 / l; normals[n * 3 + 2] = -gz / l;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  if (colors) mesh.setColors32(colors);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Read an X3D file's Scene into a PlayCanvas entity tree. Returns { root, defs, materials, meta }.
 * options.choice: { [SwitchDEF]: index } overrides a Switch's whichChoice.
 */
export function loadX3D(app, text, options = {}) {
  const doc = parseXML(text);
  const scene = findFirst(doc, 'Scene');
  const defs = {}, materials = {};
  const root = new pc.Entity('x3d');
  const shapeMaterial = (app) => {
    const mnode = app && app.children.find((c) => c.name === 'PhysicalMaterial' || c.name === 'Material');
    if (!mnode) return materials.__default || (materials.__default = material({ name: 'Material', attrs: {} }));
    if (mnode.attrs.USE) return materials[mnode.attrs.USE];
    const m = material(mnode);
    if (mnode.attrs.DEF) materials[mnode.attrs.DEF] = m;
    return m;
  };
  function walk(el, parent) {
    switch (el.name) {
      case 'Transform': case 'Group': {
        const e = new pc.Entity(el.attrs.DEF || el.name);
        if (el.name === 'Transform') applyTransform(e, el);
        parent.addChild(e);
        if (el.attrs.DEF) defs[el.attrs.DEF] = e;
        for (const c of el.children) walk(c, e);
        return;
      }
      case 'Switch': {
        const e = new pc.Entity(el.attrs.DEF || 'Switch');
        parent.addChild(e);
        if (el.attrs.DEF) defs[el.attrs.DEF] = e;
        const choice = options.choice && el.attrs.DEF in options.choice ? options.choice[el.attrs.DEF] : Number(el.attrs.whichChoice ?? -1);
        const kids = el.children.filter((c) => !c.name.startsWith('Metadata'));
        kids.forEach((c, k) => { const holder = new pc.Entity('choice' + k); holder.enabled = k === choice; e.addChild(holder); walk(c, holder); });
        return;
      }
      case 'Shape': {
        const appearance = el.children.find((c) => c.name === 'Appearance');
        const geom = el.children.find((c) => ['Box', 'Cylinder', 'Sphere', 'Cone'].includes(c.name));
        if (!geom) return;
        const e = new pc.Entity(geom.name);
        const m = shapeMaterial(appearance);
        if (geom.name === 'Box') { const s = geom.attrs.size ? nums(geom.attrs.size) : [2, 2, 2]; e.setLocalScale(s[0], s[1], s[2]); e.addComponent('render', { type: 'box', material: m }); }
        if (geom.name === 'Sphere') { const r = Number(geom.attrs.radius ?? 1); e.setLocalScale(2 * r, 2 * r, 2 * r); e.addComponent('render', { type: 'sphere', material: m }); }
        if (geom.name === 'Cylinder' || geom.name === 'Cone') {
          const r = Number(geom.attrs.radius ?? geom.attrs.bottomRadius ?? 1), h = Number(geom.attrs.height ?? 2);
          e.setLocalScale(2 * r, h, 2 * r);
          e.addComponent('render', { type: geom.name === 'Cone' ? 'cone' : 'cylinder', material: m });
        }
        e.render.castShadows = true;
        e.render.receiveShadows = true;
        parent.addChild(e);
        return;
      }
      default:
        for (const c of el.children) if (!c.name.startsWith('Metadata') && c.name !== 'WorldInfo') walk(c, parent);
    }
  }
  for (const c of scene.children) walk(c, root);
  return { root, defs, materials, doc };
}

function findFirst(node, name) {
  for (const c of node.children) {
    if (c.name === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return null;
}

export { srgbToLinear };
