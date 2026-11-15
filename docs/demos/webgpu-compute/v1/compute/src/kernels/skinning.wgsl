// skinning.wgsl: HAnim linear blend skinning (LBS), 4 influences per vertex. One thread = one vertex.
// HAnimJoint.skinCoordIndex / skinCoordWeight are per JOINT lists; the CPU turns them into this per-VERTEX table once (ref/skinning.js: influences()).
// M[j] = jointWorld(pose) * inverse(jointWorld(rest)). Normals use mat3(M): exact for rotation + translation, wrong for non-uniform joint scale (gap).
struct Params { n: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> rest: array<vec4<f32>>;     // xyz, 1
@group(0) @binding(2) var<storage, read> restN: array<vec4<f32>>;    // xyz, 0
@group(0) @binding(3) var<storage, read> jidx: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> jw: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> M: array<mat4x4<f32>>;
@group(0) @binding(6) var<storage, read_write> outP: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> outN: array<vec4<f32>>;

@compute @workgroup_size(64)
fn skin(@builtin(global_invocation_id) gid: vec3<u32>) {
  let v = gid.x;
  if (v >= P.n) { return; }
  let p = rest[v]; let nn = restN[v].xyz; let ix = jidx[v]; let w = jw[v];
  let m0 = M[ix.x]; let m1 = M[ix.y]; let m2 = M[ix.z]; let m3 = M[ix.w];
  let q = m0 * p * w.x + m1 * p * w.y + m2 * p * w.z + m3 * p * w.w;
  let n3 = mat3x3<f32>(m0[0].xyz, m0[1].xyz, m0[2].xyz) * nn * w.x + mat3x3<f32>(m1[0].xyz, m1[1].xyz, m1[2].xyz) * nn * w.y
         + mat3x3<f32>(m2[0].xyz, m2[1].xyz, m2[2].xyz) * nn * w.z + mat3x3<f32>(m3[0].xyz, m3[1].xyz, m3[2].xyz) * nn * w.w;
  let l = length(n3);
  outP[v] = vec4<f32>(q.xyz, 1.0);
  outN[v] = vec4<f32>(select(vec3<f32>(0.0), n3 / l, l > 1e-20), 0.0);
}
