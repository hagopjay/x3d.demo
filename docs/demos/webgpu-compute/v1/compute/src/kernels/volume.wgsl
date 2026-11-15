// volume.wgsl: X3D VolumeData ray casting on the GPU, orthographic camera orbiting the unit cube (yaw only, so rays stay in an XZ plane). One thread = one pixel.
// style 0 = OpacityMapVolumeStyle (front-to-back "over" compositing with a ramp transfer function), style 1 = ProjectionVolumeStyle MAX (MIP).
// Sampling is nearest voxel (textureLoad), so the CPU reference reproduces it; trilinear is a one-line change (gap, logged).
struct Params { w: u32, h: u32, dim: u32, steps: u32, style: u32, _p0: u32, _p1: u32, _p2: u32, c: f32, s: f32, thr: f32, gain: f32, stepAlpha: f32, _q0: f32, _q1: f32, _q2: f32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> img: array<u32>;

fn pack(c: vec4<f32>) -> u32 {
  let q = vec4<u32>(clamp(c, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0 + 0.5);
  return q.x | (q.y << 8u) | (q.z << 16u) | (q.w << 24u);
}
fn sampleV(p: vec3<f32>) -> f32 {
  let d = f32(P.dim);
  let i = vec3<i32>(clamp(floor(p * d), vec3<f32>(0.0), vec3<f32>(d - 1.0)));
  return textureLoad(vol, i, 0).r;
}
@compute @workgroup_size(8, 8)
fn march(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.w || gid.y >= P.h) { return; }
  let u = (f32(gid.x) + 0.5) / f32(P.w) * 2.0 - 1.0;
  let v = (f32(gid.y) + 0.5) / f32(P.h) * 2.0 - 1.0;
  let ox = 0.5 + P.c * u * 0.9 - P.s * 2.0;
  let oy = 0.5 - v * 0.9;
  let oz = 0.5 - P.s * u * 0.9 - P.c * 2.0;
  let o = vec3<f32>(ox, oy, oz);
  let fwd = vec3<f32>(P.s, 0.0, P.c);
  // slab test: x and z by division (an axis with a zero component gives +-inf, which min/max absorb), y is constant along the ray
  let inv = vec3<f32>(1.0 / fwd.x, 1.0, 1.0 / fwd.z);
  let t0 = (vec3<f32>(0.0) - o) * inv; let t1 = (vec3<f32>(1.0) - o) * inv;
  let tmin = max(min(t0.x, t1.x), min(t0.z, t1.z));
  let tmax = min(max(t0.x, t1.x), max(t0.z, t1.z));
  var out = vec4<f32>(0.0);
  if (oy >= 0.0 && oy <= 1.0 && tmax > max(tmin, 0.0)) {
    let dt = (tmax - tmin) / f32(P.steps);
    if (P.style == 1u) {
      var m = 0.0;
      for (var k = 0u; k < P.steps; k = k + 1u) { m = max(m, sampleV(o + fwd * (tmin + (f32(k) + 0.5) * dt))); }
      out = vec4<f32>(m, m, m, 1.0);
    } else {
      var acc = vec3<f32>(0.0); var a = 0.0;
      for (var k = 0u; k < P.steps; k = k + 1u) {
        let s = sampleV(o + fwd * (tmin + (f32(k) + 0.5) * dt));
        let al = clamp((s - P.thr) * P.gain, 0.0, 1.0) * P.stepAlpha;
        let col = vec3<f32>(s, s * 0.6, 1.0 - s);
        acc = acc + (1.0 - a) * al * col; a = a + (1.0 - a) * al;
        if (a > 0.99) { break; }
      }
      out = vec4<f32>(acc, a);
    }
  }
  img[gid.y * P.w + gid.x] = pack(out);
}
