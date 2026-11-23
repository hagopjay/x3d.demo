// view: a small X3D 4.0 reader for the static, baked part of v3's fall.x3d, into three.js.
// Reads Transform (translation, rotation, scale), Shape, Appearance with UnlitMaterial + emissiveTexture or
// PhysicalMaterial baseColor, IndexedFaceSet (coordIndex polygons, Coordinate, TextureCoordinate, texCoordIndex
// when given, else coordIndex), DEF/USE on geometry and appearance. Skips HAnimHumanoid (the duel builds its own
// bodies), Viewpoint, lights and interpolators. Reports what it skipped instead of failing (a loss report).
import * as THREE from '../vendor/three.module.js';

export async function loadX3D(url, opts = {}) {
  const text = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const base = url.slice(0, url.lastIndexOf('/') + 1), loader = new THREE.TextureLoader(), defs = new Map();
  const report = { shapes: 0, triangles: 0, textures: 0, skipped: {} };
  const skip = (n) => { report.skipped[n] = (report.skipped[n] || 0) + 1; };
  const floats = (s) => (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const root = new THREE.Group();
  const SKIP = new Set(['HAnimHumanoid', 'Viewpoint', 'DirectionalLight', 'PointLight', 'SpotLight', 'TimeSensor', 'PositionInterpolator', 'OrientationInterpolator', 'ROUTE', 'NavigationInfo', 'Background', 'MetadataSet', 'MetadataString', 'WorldInfo']);
  const drop = new Set(opts.dropDEF || []);

  function material(app) {
    if (!app) return new THREE.MeshStandardMaterial({ color: 0xcccccc });
    if (app.getAttribute('USE')) return defs.get(app.getAttribute('USE'));
    let m;
    const unlit = app.querySelector('UnlitMaterial'), phys = app.querySelector('PhysicalMaterial, Material');
    if (unlit) {
      const tx = unlit.querySelector('ImageTexture'), col = floats(unlit.getAttribute('emissiveColor') || '1 1 1');
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col[0], col[1], col[2]) });
      if (tx) { const url = tx.getAttribute('url').replace(/^["']|["']$/g, '').split('" "')[0]; const t = loader.load(base + url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; m.map = t; report.textures++; }
    } else if (phys) {
      const col = floats(phys.getAttribute('baseColor') || phys.getAttribute('diffuseColor') || '0.8 0.8 0.8');
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(col[0], col[1], col[2]), roughness: +(phys.getAttribute('roughness') || 0.8), metalness: +(phys.getAttribute('metallic') || 0) });
    } else m = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    if (app.getAttribute('DEF')) defs.set(app.getAttribute('DEF'), m);
    return m;
  }
  function faceSet(ifs) {
    if (ifs.getAttribute('USE')) return defs.get(ifs.getAttribute('USE'));
    const P = floats(ifs.querySelector('Coordinate')?.getAttribute('point')), ci = floats(ifs.getAttribute('coordIndex'));
    const tcN = ifs.querySelector('TextureCoordinate'), T = tcN ? floats(tcN.getAttribute('point')) : null, ti = ifs.getAttribute('texCoordIndex') ? floats(ifs.getAttribute('texCoordIndex')) : ci;
    const pos = [], uv = []; let poly = [], tpoly = [];
    const flush = () => { for (let k = 1; k + 1 < poly.length; k++) for (const j of [0, k, k + 1]) { const a = poly[j]; pos.push(P[3 * a], P[3 * a + 1], P[3 * a + 2]); if (T) { const b = tpoly[j]; uv.push(T[2 * b], T[2 * b + 1]); } } poly = []; tpoly = []; };
    for (let i = 0; i < ci.length; i++) { if (ci[i] < 0) flush(); else { poly.push(ci[i]); tpoly.push(ti[i]); } }
    flush();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (T) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals(); report.triangles += pos.length / 9;
    if (ifs.getAttribute('DEF')) defs.set(ifs.getAttribute('DEF'), g);
    return g;
  }
  function walk(el, parent) {
    for (const c of el.children) {
      const n = c.nodeName;
      if (SKIP.has(n)) { skip(n); continue; }
      if (c.getAttribute('DEF') && drop.has(c.getAttribute('DEF'))) { skip('dropped:' + c.getAttribute('DEF')); continue; }
      if (n === 'Transform' || n === 'Group') {
        const o = new THREE.Group(); o.name = c.getAttribute('DEF') || '';
        if (n === 'Transform') {
          const t = floats(c.getAttribute('translation') || '0 0 0'), r = floats(c.getAttribute('rotation') || '0 0 1 0'), s = floats(c.getAttribute('scale') || '1 1 1');
          o.position.set(t[0], t[1], t[2]); o.quaternion.setFromAxisAngle(new THREE.Vector3(r[0], r[1], r[2]).normalize(), r[3]); o.scale.set(s[0], s[1], s[2]);
        }
        parent.add(o); walk(c, o);
      } else if (n === 'Shape') {
        const geo = c.querySelector('IndexedFaceSet'); if (!geo) { skip('Shape without IndexedFaceSet'); continue; }
        const mesh = new THREE.Mesh(faceSet(geo), material(c.querySelector('Appearance')));
        if (geo.getAttribute('solid') === 'false') mesh.material.side = THREE.DoubleSide;
        mesh.name = parent.name; parent.add(mesh); report.shapes++;
      } else skip(n);
    }
  }
  walk(doc.querySelector('Scene'), root);
  return { root, report };
}
