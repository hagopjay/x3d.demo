// splats.wgsl: Gaussian splat preprocessing + depth sort, the two GPU stages a splat renderer needs before it draws.
//   project: one thread = one splat. 3D covariance from scale + quaternion, EWA projection to a 2D conic (Zwicker et al. 2002; Kerbl et al. 2023 section 6),
//            screen radius = 3 sigma of the larger eigenvalue, culling, and a sort key (view depth as raw f32 bits: positive floats order like u32).
//   sort:    bitonic network over (key, value) pairs, two variants measured against each other:
//            bitonic_naive  one global compare-exchange pass per (k, j); 210 passes at n = 2^20 (the first version written)
//            tiled          bitonic_local_sort (k <= 512 entirely in workgroup memory, one pass), then for each k >= 1024 the cross-tile steps j >= 512
//                           as bitonic_global (n/2 threads) and the j <= 256 tail as bitonic_local_merge (one pass): 78 passes at n = 2^20. n must be a power of two >= 512.
// Culled splats get key 0xFFFFFFFF and sink to the end; the draw would stop at `visible`. Ties break on the value (splat index) so the order is total and checkable.
struct Cam { view: mat4x4<f32>, fx: f32, fy: f32, w: f32, h: f32, n: u32, znear: f32, _a: f32, _b: f32 };
@group(0) @binding(0) var<uniform> C: Cam;
@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;      // xyz, opacity
@group(0) @binding(2) var<storage, read> scl: array<vec4<f32>>;      // xyz scale (std dev, world units)
@group(0) @binding(3) var<storage, read> quat: array<vec4<f32>>;     // x y z w, unit
@group(0) @binding(4) var<storage, read_write> s2d: array<vec4<f32>>; // 2 vec4 per splat: [cx, cy, conic a, conic b], [conic c, radius px, opacity, depth]
@group(0) @binding(5) var<storage, read_write> keys: array<u32>;
@group(0) @binding(6) var<storage, read_write> vals: array<u32>;

@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&keys)) { return; }
  if (i >= C.n) { keys[i] = 0xFFFFFFFFu; vals[i] = i; return; }   // power-of-two padding
  vals[i] = i;
  let pw = pos[i];
  let t = (C.view * vec4<f32>(pw.xyz, 1.0)).xyz;       // camera space, looking down -Z, depth = -t.z
  let z = -t.z;
  var ok = z > C.znear;
  var a = 0.0; var b = 0.0; var c = 0.0; var rad = 0.0; var cx = 0.0; var cy = 0.0;
  if (ok) {
    let q = quat[i]; let s = scl[i].xyz;
    let x = q.x; let y = q.y; let zq = q.z; let w = q.w;
    let R = mat3x3<f32>(
      vec3<f32>(1.0 - 2.0 * (y * y + zq * zq), 2.0 * (x * y + w * zq), 2.0 * (x * zq - w * y)),
      vec3<f32>(2.0 * (x * y - w * zq), 1.0 - 2.0 * (x * x + zq * zq), 2.0 * (y * zq + w * x)),
      vec3<f32>(2.0 * (x * zq + w * y), 2.0 * (y * zq - w * x), 1.0 - 2.0 * (x * x + y * y)));
    let M = mat3x3<f32>(R[0] * s.x, R[1] * s.y, R[2] * s.z);          // R * diag(s)
    let Wm = mat3x3<f32>(C.view[0].xyz, C.view[1].xyz, C.view[2].xyz);
    let T = Wm * M;                                                    // cov_cam = T * T^T
    // Jacobian of the perspective projection (screen y down): rows (fx/z, 0, fx*tx/z^2) and (0, -fy/z, -fy*ty/z^2) for camera looking down -Z
    let j0 = vec3<f32>(C.fx / z, 0.0, C.fx * t.x / (z * z));
    let j1 = vec3<f32>(0.0, -C.fy / z, -C.fy * t.y / (z * z));
    // J * T as a row vector: element k = dot(J row, column k of T)
    let u0 = vec3<f32>(dot(j0, T[0]), dot(j0, T[1]), dot(j0, T[2]));
    let u1 = vec3<f32>(dot(j1, T[0]), dot(j1, T[1]), dot(j1, T[2]));
    let cxx = dot(u0, u0) + 0.3; let cxy = dot(u0, u1); let cyy = dot(u1, u1) + 0.3;
    let det = cxx * cyy - cxy * cxy;
    ok = det > 1e-12;
    if (ok) {
      a = cyy / det; b = -cxy / det; c = cxx / det;                    // conic = inverse of the 2x2 covariance
      let mid = 0.5 * (cxx + cyy); let lam = mid + sqrt(max(0.1, mid * mid - det));
      rad = ceil(3.0 * sqrt(lam));
      cx = C.fx * t.x / z + 0.5 * C.w; cy = -C.fy * t.y / z + 0.5 * C.h;
      if (cx + rad < 0.0 || cx - rad > C.w || cy + rad < 0.0 || cy - rad > C.h) { ok = false; }
    }
  }
  s2d[2u * i] = vec4<f32>(cx, cy, a, b);
  s2d[2u * i + 1u] = vec4<f32>(c, rad, pw.w, z);
  keys[i] = select(0xFFFFFFFFu, bitcast<u32>(z), ok);
}

struct Pass { j: u32, k: u32, n: u32, _p: u32 };
@group(1) @binding(0) var<uniform> B: Pass;
@group(1) @binding(1) var<storage, read_write> bk: array<u32>;
@group(1) @binding(2) var<storage, read_write> bv: array<u32>;
fn lt(ka: u32, va: u32, kb: u32, vb: u32) -> bool { return ka < kb || (ka == kb && va < vb); }

// ---- baseline: one global pass per (k, j), n threads of which half idle
@compute @workgroup_size(256)
fn bitonic_naive(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= B.n) { return; }
  let l = i ^ B.j;
  if (l > i) {
    let up = (i & B.k) == 0u;
    let a_gt_b = lt(bk[l], bv[l], bk[i], bv[i]);   // element at i is greater than element at l
    if ((up && a_gt_b) || (!up && !a_gt_b)) {
      let tk = bk[i]; let tv = bv[i]; bk[i] = bk[l]; bv[i] = bv[l]; bk[l] = tk; bv[l] = tv;
    }
  }
}

// ---- tiled variant
var<workgroup> tk: array<u32, 512>;
var<workgroup> tv: array<u32, 512>;
fn cx_local(lo: u32, j: u32, base: u32, k: u32) {
  let hi = lo | j;
  let up = ((base + lo) & k) == 0u;
  let gt = lt(tk[hi], tv[hi], tk[lo], tv[lo]);      // element lo is greater than element hi
  if ((up && gt) || (!up && !gt)) {
    let a = tk[lo]; let b = tv[lo]; tk[lo] = tk[hi]; tv[lo] = tv[hi]; tk[hi] = a; tv[hi] = b;
  }
}
fn load_tile(base: u32, t: u32) {
  tk[t] = bk[base + t]; tv[t] = bv[base + t]; tk[t + 256u] = bk[base + t + 256u]; tv[t + 256u] = bv[base + t + 256u];
}
fn store_tile(base: u32, t: u32) {
  bk[base + t] = tk[t]; bv[base + t] = tv[t]; bk[base + t + 256u] = tk[t + 256u]; bv[base + t + 256u] = tv[t + 256u];
}
@compute @workgroup_size(256)
fn bitonic_local_sort(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let base = wid.x * 512u; let t = lid.x;
  _ = B.n;   // keeps binding 0 in the auto layout so all three sort passes share one bind group shape
  load_tile(base, t);
  workgroupBarrier();
  for (var k = 2u; k <= 512u; k = k << 1u) {
    for (var j = k >> 1u; j > 0u; j = j >> 1u) {
      let lo = ((t & ~(j - 1u)) << 1u) | (t & (j - 1u));
      cx_local(lo, j, base, k);
      workgroupBarrier();
    }
  }
  store_tile(base, t);
}
@compute @workgroup_size(256)
fn bitonic_global(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= B.n / 2u) { return; }
  let lo = ((t & ~(B.j - 1u)) << 1u) | (t & (B.j - 1u)); let hi = lo | B.j;
  let up = (lo & B.k) == 0u;
  let gt = lt(bk[hi], bv[hi], bk[lo], bv[lo]);
  if ((up && gt) || (!up && !gt)) {
    let a = bk[lo]; let b = bv[lo]; bk[lo] = bk[hi]; bv[lo] = bv[hi]; bk[hi] = a; bv[hi] = b;
  }
}
@compute @workgroup_size(256)
fn bitonic_local_merge(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let base = wid.x * 512u; let t = lid.x;
  load_tile(base, t);
  workgroupBarrier();
  for (var j = 256u; j > 0u; j = j >> 1u) {
    let lo = ((t & ~(j - 1u)) << 1u) | (t & (j - 1u));
    cx_local(lo, j, base, B.k);
    workgroupBarrier();
  }
  store_tile(base, t);
}
