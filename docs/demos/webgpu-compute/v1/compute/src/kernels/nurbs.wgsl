// nurbs.wgsl: NurbsPatchSurface tessellation on the GPU, rational tensor-product B-spline with analytic first derivatives
// (Piegl & Tiller A2.1 span search, A2.2 basis functions, eq. 2.7 derivative from the degree p-1 basis, eq. 4.20 rational quotient rule).
// One thread = one grid vertex. Order is limited to MAXO (6, degree 5); the CPU side checks that.
const MAXO: u32 = 6u;
struct Params { nu: u32, nv: u32, du: u32, dv: u32, pu: u32, pv: u32, ku: u32, kv: u32, uk0: u32, vk0: u32, _a: u32, _b: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> ctrl: array<vec4<f32>>;     // x y z w (w = weight), row-major: index = j * du + i
@group(0) @binding(2) var<storage, read> knots: array<f32>;           // u knots at uk0.., v knots at vk0..
@group(0) @binding(3) var<storage, read_write> outP: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> outN: array<vec4<f32>>;

fn span(dim: u32, p: u32, k0: u32, u: f32) -> u32 {
  // A2.1, binary search over the knot vector, clamped so u = last knot lands in the last non-empty span
  if (u >= knots[k0 + dim]) { return dim - 1u; }
  var lo = p; var hi = dim; var mid = (lo + hi) / 2u;
  while (u < knots[k0 + mid] || u >= knots[k0 + mid + 1u]) {
    if (u < knots[k0 + mid]) { hi = mid; } else { lo = mid; }
    mid = (lo + hi) / 2u;
  }
  return mid;
}
// A2.2: N[0..=p] = the p+1 non-zero basis functions of degree p at u (indices s-p..s)
fn basis(s: u32, p: u32, k0: u32, u: f32, N: ptr<function, array<f32, 6>>) {
  var left: array<f32, 6>; var right: array<f32, 6>;
  (*N)[0] = 1.0;
  for (var j = 1u; j <= p; j = j + 1u) {
    left[j] = u - knots[k0 + s + 1u - j]; right[j] = knots[k0 + s + j] - u;
    var saved = 0.0;
    for (var r = 0u; r < j; r = r + 1u) {
      let tmp = (*N)[r] / (right[r + 1u] + left[j - r]);
      (*N)[r] = saved + right[r + 1u] * tmp; saved = left[j - r] * tmp;
    }
    (*N)[j] = saved;
  }
}
// derivatives of the p+1 basis functions: d[r] = N'_{s-p+r,p}(u) = p * ( N_{s-p+r,p-1}/(k[i+p]-k[i]) - N_{s-p+r+1,p-1}/(k[i+p+1]-k[i+1]) )
fn dbasis(s: u32, p: u32, k0: u32, u: f32, d: ptr<function, array<f32, 6>>) {
  var lo: array<f32, 6>;
  basis(s, p - 1u, k0, u, &lo);   // lo[t] = N_{s-(p-1)+t, p-1}, t = 0..p-1
  for (var r = 0u; r <= p; r = r + 1u) {
    let i = s - p + r;
    var a = 0.0; var b = 0.0;
    if (r >= 1u) { let den = knots[k0 + i + p] - knots[k0 + i]; if (den > 0.0) { a = lo[r - 1u] / den; } }
    if (r < p) { let den = knots[k0 + i + p + 1u] - knots[k0 + i + 1u]; if (den > 0.0) { b = lo[r] / den; } }
    (*d)[r] = f32(p) * (a - b);
  }
}
@compute @workgroup_size(8, 8)
fn tess(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.nu || gid.y >= P.nv) { return; }
  let u0 = knots[P.uk0 + P.pu]; let u1 = knots[P.uk0 + P.du];
  let v0 = knots[P.vk0 + P.pv]; let v1 = knots[P.vk0 + P.dv];
  let u = mix(u0, u1, f32(gid.x) / f32(P.nu - 1u));
  let v = mix(v0, v1, f32(gid.y) / f32(P.nv - 1u));
  let su = span(P.du, P.pu, P.uk0, u); let sv = span(P.dv, P.pv, P.vk0, v);
  var Nu: array<f32, 6>; var Nv: array<f32, 6>; var dNu: array<f32, 6>; var dNv: array<f32, 6>;
  basis(su, P.pu, P.uk0, u, &Nu); basis(sv, P.pv, P.vk0, v, &Nv);
  dbasis(su, P.pu, P.uk0, u, &dNu); dbasis(sv, P.pv, P.vk0, v, &dNv);
  // homogeneous sums A = sum N w P, W = sum N w, and their u / v derivatives
  var A = vec3<f32>(0.0); var Au = vec3<f32>(0.0); var Av = vec3<f32>(0.0);
  var W = 0.0; var Wu = 0.0; var Wv = 0.0;
  for (var b = 0u; b <= P.pv; b = b + 1u) {
    let j = sv - P.pv + b;
    for (var a = 0u; a <= P.pu; a = a + 1u) {
      let i = su - P.pu + a;
      let c = ctrl[j * P.du + i];
      let w = c.w; let pw = c.xyz * w;
      A += pw * (Nu[a] * Nv[b]); Au += pw * (dNu[a] * Nv[b]); Av += pw * (Nu[a] * dNv[b]);
      W += w * Nu[a] * Nv[b]; Wu += w * dNu[a] * Nv[b]; Wv += w * Nu[a] * dNv[b];
    }
  }
  let S = A / W;
  let Su = (Au - S * Wu) / W; let Sv = (Av - S * Wv) / W;
  let n = cross(Su, Sv); let l = length(n);
  let o = gid.y * P.nu + gid.x;
  outP[o] = vec4<f32>(S, 1.0);
  outN[o] = vec4<f32>(select(vec3<f32>(0.0), n / l, l > 1e-12), 0.0);
}
