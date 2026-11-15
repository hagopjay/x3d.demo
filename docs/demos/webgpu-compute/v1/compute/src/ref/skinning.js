/* HAnim skinning reference: joint table -> per-vertex 4-influence table, forward kinematics, CPU LBS. Column-major 4x4 like WGSL. */
const f = Math.fround;
export const ident = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
export const trans = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
export function rotAA([x, y, z, a]) { const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; const c = Math.cos(a), s = Math.sin(a), t = 1 - c, m = ident();
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y; m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x; m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c; return m; }
/* X3D Transform order: T(translation) * T(center) * R(rotation) * T(-center) */
export const local = (j, rot) => mul(mul(trans(...j.translation), trans(...j.center)), mul(rotAA(rot || j.rotation), trans(-j.center[0], -j.center[1], -j.center[2])));

/* parse HAnimHumanoid: joints (DEF order = skeleton traversal), parents, skinCoordIndex/Weight, skin mesh (Coordinate point + IndexedFaceSet normals are not read: normals come from the rest mesh) */
export function fromX3D(doc) {
  const nums = (s) => (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const joints = [], def = {};
  const walk = (el, parent) => {
    for (const c of el.children) {
      if (c.tagName === 'HAnimJoint' && !c.hasAttribute('USE') && c.getAttribute('containerField') !== 'joints') {
        for (const bad of ['scale', 'scaleOrientation', 'skinBindingMatrix']) if (c.hasAttribute(bad) && (bad !== 'scale' || c.getAttribute('scale').trim() !== '1 1 1')) throw new Error(`HAnimJoint ${bad} is not supported (gap)`);
        const j = { name: c.getAttribute('name'), DEF: c.getAttribute('DEF'), parent, translation: nums(c.getAttribute('translation') || '0 0 0'), center: nums(c.getAttribute('center') || '0 0 0'), rotation: nums(c.getAttribute('rotation') || '0 0 1 0'), index: nums(c.getAttribute('skinCoordIndex')), weight: nums(c.getAttribute('skinCoordWeight')) };
        if (j.index.length !== j.weight.length) throw new Error('skinCoordIndex/Weight length mismatch on ' + j.name);
        def[j.DEF] = joints.length; joints.push(j); walk(c, joints.length - 1);
      } else if (c.tagName !== 'HAnimJoint') walk(c, parent);
    }
  };
  const hum = doc.getElementsByTagName('HAnimHumanoid')[0]; walk(hum, -1);
  const pts = nums(doc.querySelector('[containerField="skinCoord"]')?.getAttribute('point') || hum.getElementsByTagName('Coordinate')[0].getAttribute('point'));
  const rest = new Float32Array(pts.length / 3 * 4); for (let i = 0; i < pts.length / 3; i++) { rest[i * 4] = pts[i * 3]; rest[i * 4 + 1] = pts[i * 3 + 1]; rest[i * 4 + 2] = pts[i * 3 + 2]; rest[i * 4 + 3] = 1; }
  return { joints, rest, nv: pts.length / 3, jointPose: [...doc.getElementsByTagName('HAnimJoint')].filter((e) => e.hasAttribute('rotation') && e.getAttribute('containerField') !== 'joints').length };
}
/* per-joint lists -> top-4 influences per vertex, renormalised to sum 1 (HAnim: weights of a vertex are expected to sum to 1; we do not trust that) */
export function influences(joints, nv) {
  const per = Array.from({ length: nv }, () => []);
  joints.forEach((j, ji) => j.index.forEach((v, k) => { if (j.weight[k] > 0) per[v].push([ji, j.weight[k]]); }));
  const idx = new Uint32Array(nv * 4), w = new Float32Array(nv * 4); let dropped = 0, unweighted = 0;
  /* a vertex that no joint weights stays at its rest position: it points at the identity matrix that skinMatrices() appends after the last joint */
  per.forEach((l, v) => { l.sort((a, b) => b[1] - a[1]); if (l.length > 4) dropped++; if (!l.length) { unweighted++; idx[v * 4] = joints.length; w[v * 4] = 1; return; } const top = l.slice(0, 4), s = top.reduce((a, x) => a + x[1], 0); top.forEach(([ji, wt], k) => { idx[v * 4 + k] = ji; w[v * 4 + k] = wt / s; }); });
  return { idx, w, dropped, unweighted };
}
/* skin matrices for a pose: M[j] = world(pose) * inverse(world(rest)); rest rotation must be identity so inverse(world(rest)) is a pure translation */
export function skinMatrices(joints, pose = {}) {
  const wp = [], wr = [];
  joints.forEach((j, i) => {
    if (j.rotation[3] !== 0) throw new Error('rest rotation must be zero (gap: no general mat4 inverse here)');
    const lp = local(j, pose[i]), lr = local(j);
    wp[i] = j.parent < 0 ? lp : mul(wp[j.parent], lp); wr[i] = j.parent < 0 ? lr : mul(wr[j.parent], lr);
  });
  const out = new Float32Array((joints.length + 1) * 16); out.set(ident(), joints.length * 16);   // last matrix = identity, used by unweighted vertices
  joints.forEach((j, i) => { const inv = trans(-wr[i][12], -wr[i][13], -wr[i][14]); out.set(mul(wp[i], inv), i * 16); });
  return out;
}
export function skinCPU(rest, restN, idx, w, M, nv) {
  const P = new Float32Array(nv * 4), N = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0; const x = rest[v * 4], y = rest[v * 4 + 1], z = rest[v * 4 + 2], a = restN[v * 4], b = restN[v * 4 + 1], c = restN[v * 4 + 2];
    for (let k = 0; k < 4; k++) { const wt = w[v * 4 + k]; if (!wt) continue; const m = idx[v * 4 + k] * 16;
      px += wt * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]); py += wt * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]); pz += wt * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]);
      nx += wt * (M[m] * a + M[m + 4] * b + M[m + 8] * c); ny += wt * (M[m + 1] * a + M[m + 5] * b + M[m + 9] * c); nz += wt * (M[m + 2] * a + M[m + 6] * b + M[m + 10] * c); }
    const l = Math.hypot(nx, ny, nz); P.set([px, py, pz, 1], v * 4); N.set(l > 1e-20 ? [nx / l, ny / l, nz / l, 0] : [0, 0, 0, 0], v * 4);
  }
  return { P, N };
}
/* a hand-checkable chain for the independent forward-kinematics test: root (no centre), child with translation (0,2,0) and centre (1,0,0), grandchild J2 (child of root, translation (0,-1,0)).
   Pose: J0 and J1 rotate +90 degrees about z (J1 about its centre), J2 rotates 180 degrees. The expected positions below were worked out by hand (see x3d.docs chapter), not by this code. */
export function handChain() {
  const J = (name, parent, t, c, index, weight) => ({ name, parent, translation: t, center: c, rotation: [0, 0, 1, 0], index, weight });
  const joints = [J('J0', -1, [0, 0, 0], [0, 0, 0], [0, 4], [1, 0.5]), J('J1', 0, [0, 2, 0], [1, 0, 0], [1, 2, 4], [1, 1, 1]), J('J2', 0, [0, -1, 0], [0, 0, 0], [4], [0.5])];
  // vertices: 0 (1,0,0)->J0 | 1 (1,2,0)->J1 | 2 (3,2,0)->J1 | 3 (5,5,5) unweighted | 4 (1,2,0)->J0 .5, J1 1, J2 .5 (sum 2, renormalised to .25 .5 .25)
  const rest = new Float32Array([1, 0, 0, 1, 1, 2, 0, 1, 3, 2, 0, 1, 5, 5, 5, 1, 1, 2, 0, 1]);
  const pose = { 0: [0, 0, 1, Math.PI / 2], 1: [0, 0, 1, Math.PI / 2], 2: [0, 0, 1, Math.PI] };
  const expect = [0, 1, 0, -2, 1, 0, -4, 1, 0, 5, 5, 5, -0.5, 0.5, 0];
  return { joints, rest, nv: 5, pose, expect };
}
/* procedural bench mesh: a tube of `nv` vertices along +Y, `nj` joints in a chain, each vertex weighted between the two joints that straddle it */
export function tube(nv, nj) {
  const rings = Math.max(2, Math.ceil(nv / 16)), rest = new Float32Array(rings * 16 * 4), nrm = new Float32Array(rings * 16 * 4), idx = new Uint32Array(rings * 16 * 4), w = new Float32Array(rings * 16 * 4), H = nj; let v = 0;
  for (let r = 0; r < rings; r++) for (let a = 0; a < 16; a++, v++) {
    const t = r / (rings - 1), y = t * H, th = a / 16 * 2 * Math.PI, rad = 0.4; rest.set([rad * Math.cos(th), y, rad * Math.sin(th), 1], v * 4); nrm.set([Math.cos(th), 0, Math.sin(th), 0], v * 4);
    const s = Math.min(nj - 1, Math.floor(y)), fr = y - s; if (s >= nj - 1) { idx.set([s, s, s, s], v * 4); w.set([1, 0, 0, 0], v * 4); } else { idx.set([s, s + 1, 0, 0], v * 4); w.set([1 - fr, fr, 0, 0], v * 4); }
  }
  const joints = Array.from({ length: nj }, (_, i) => ({ name: 'j' + i, parent: i - 1, translation: [0, i ? 1 : 0, 0], center: [0, 0, 0], rotation: [0, 0, 1, 0] }));
  return { nv: v, rest, nrm, idx, w, joints };
}
