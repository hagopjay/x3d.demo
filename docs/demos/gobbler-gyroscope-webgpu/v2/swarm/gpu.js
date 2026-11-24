/* Gobbler Swarm, WebGPU backend: a compute pass steps every replica's LangGraph state machine (the WGSL twin of
   model.js stepAgent), a second pass rebuilds per-hoop stage occupancy and a 64-bin angle histogram with atomics, and the
   render passes draw agents, admitted-entry sparks, the ring spectrum and the core into an HDR target with a five-level bloom.
   When the page's Babylon engine is on WebGPU we draw on Babylon's own GPUDevice and bind its kinetics buffer (kinLoops) directly,
   so agents ride the hoops' live matrices with zero readback lag. */
(() => {
  'use strict';
  const M = window.GobblerSwarmModel;

  const STEP_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read> P: array<u32, 16>;
@group(0) @binding(1) var<storage, read_write> A: array<vec4u>;
@group(0) @binding(2) var<storage, read_write> K: array<atomic<u32>>;
var<private> rs: u32;
fn pcg() -> u32 { rs = rs * 747796405u + 2891336453u; let w = ((rs >> ((rs >> 28u) + 4u)) ^ rs) * 277803737u; return (w >> 22u) ^ w; }
fn inc(k: u32) { if (P[10] == 1u) { atomicAdd(&K[k], 1u); } }
fn tick(a0: vec4u) -> vec4u {
  let m = a0.x & ~(1u << 14u);
  let t = a0.y + 1u;
  if (t < a0.z) { return vec4u(m, t, a0.z, a0.w); }
  rs = a0.w;
  let l = m & 15u; let st = (m >> 4u) & 15u;
  var att = (m >> 8u) & 3u; var code = (m >> 10u) & 3u; var ans = (m >> 12u) & 1u; var com = (m >> 13u) & 1u;
  var ns = st; var db = 24u; var ds = 96u;
  let r = pcg();
  if (st == 0u) { ns = 1u; db = 36u; ds = 24u; com = 0u; att = 0u; inc(0u); inc(80u + l); }
  else if (st == 1u) {
    if (r < P[2]) { ns = 2u; att = 1u; db = 48u; ds = 36u; inc(1u); inc(3u); }
    else { ns = 9u; db = 60u; ds = 30u; inc(2u); }
  } else if (st == 2u) { ns = 3u; db = 30u; ds = 20u; }
  else if (st == 3u) {
    var ok = att >= 3u;
    if (!ok) { if (att == 1u) { ok = r < P[3]; } else { ok = r < P[4]; } }
    if (ok) { ns = 5u; db = 16u; ds = 10u; inc(5u); if (att == 1u) { inc(16u); } }
    else { let q = pcg(); code = select(select(2u, 1u, q < P[9]), 0u, q < P[8]); ns = 4u; db = 16u; ds = 8u; inc(6u); inc(7u + code); inc(48u + l); }
  } else if (st == 4u) {
    att = min(3u, att + 1u); ns = 2u;
    if (att >= 3u) { db = 20u; ds = 10u; inc(4u); } else { db = 48u; ds = 36u; inc(3u); }
  } else if (st == 5u) {
    if (r < P[6]) { ns = 10u; db = 50u; ds = 20u; inc(15u); }
    else {
      let q = pcg();
      if (q < P[5]) {
        ans = select(0u, 1u, pcg() < P[7]); ns = 6u;
        if (ans == 1u) { db = 60u; ds = 60u; } else { db = 200u; ds = 40u; }
        inc(11u); inc(64u + l);
      } else { ns = 7u; db = 36u; ds = 24u; inc(10u); }
    }
  } else if (st == 6u) { ns = 7u; db = 36u; ds = 24u; inc(select(13u, 12u, ans == 1u)); }
  else if (st == 7u) { ns = 8u; db = 40u; ds = 20u; com = 1u; inc(14u); inc(32u + l); }
  else if (st == 8u) { ns = 0u; db = 24u; ds = 96u; }
  else { ns = 8u; db = 40u; ds = 20u; com = 0u; }
  let nd = db + pcg() % ds;
  return vec4u(l | (ns << 4u) | (att << 8u) | (code << 10u) | (ans << 12u) | (com << 13u) | (1u << 14u), 0u, nd, rs);
}
var<private> SEC: array<vec2f, 11> = array<vec2f, 11>(vec2f(0.0, .06), vec2f(.06, .20), vec2f(.20, .40), vec2f(.40, .54), vec2f(.54, .20), vec2f(.54, .62),
  vec2f(.62, .62), vec2f(.62, .80), vec2f(.80, 1.0), vec2f(.20, .80), vec2f(.62, .62));
@compute @workgroup_size(256) fn clear(@builtin(global_invocation_id) g: vec3u) {
  let k = 128u + g.x; if (k < 1024u) { atomicStore(&K[k], 0u); }
}
@compute @workgroup_size(256) fn step(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= P[1]) { return; }
  var a = A[i];
  for (var k = 0u; k < P[0]; k++) { a = tick(a); }
  A[i] = a;
  if (P[10] == 1u) {
    let l = a.x & 15u; let st = (a.x >> 4u) & 15u;
    atomicAdd(&K[128u + l * 16u + st], 1u);
    let f = min(1.0, f32(a.y) / max(1.0, f32(a.z)));
    let fr = SEC[st].x + (SEC[st].y - SEC[st].x) * f;
    atomicAdd(&K[384u + l * 64u + (u32(floor(fract(fr) * 64.0)) & 63u)], 1u);
  }
}`;

  // Shared draw code. U: vp, world, eye, a(time, alpha, size, n), b(focusLoop, focusAgent, spectrumGain, coreGlow),
  // c(layers, solo, exposure, dpr), d(viewport w, h, bloom, 0)
  const DRAW_WGSL = /* wgsl */`
struct U { vp: mat4x4f, world: mat4x4f, eye: vec4f, a: vec4f, b: vec4f, c: vec4f, d: vec4f };
struct KinLoop { m: mat4x4f, info: vec4f };
struct Ring { c: vec4f, n: vec4f, u: vec4f, v: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> kin: array<KinLoop>;
@group(0) @binding(2) var<storage, read> rings: array<Ring>;
@group(0) @binding(3) var<storage, read> agents: array<vec4u>;
@group(0) @binding(4) var<storage, read> cnt: array<u32>;
@group(0) @binding(5) var<storage, read> lut: array<vec4f>;
const TAU = 6.2831853; const PI = 3.14159265;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) kind: vec2f };
fn hashf(x: u32) -> f32 { var h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return f32(h) / 4294967296.0; }
fn corner(vi: u32) -> vec2f { var c = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(-1., -1.), vec2f(1., 1.), vec2f(-1., 1.)); return c[vi]; }
fn ringLocal(l: u32, fr: f32, dr: f32, dn: f32) -> vec3f {
  let R = rings[l]; let th = fr * TAU;
  return R.c.xyz + (R.c.w + dr) * (cos(th) * R.u.xyz + sin(th) * R.v.xyz) + dn * R.n.xyz;
}
fn toWorld(l: u32, p: vec3f) -> vec3f { return (u.world * (kin[l].m * vec4f(p, 1.0))).xyz; }
fn coreWorld() -> vec3f { return (u.world * vec4f(rings[0].c.xyz, 1.0)).xyz; }
fn culled() -> VO { var o: VO; o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.uv = vec2f(0.0); o.col = vec3f(0.0); o.kind = vec2f(0.0); return o; }
// a camera-facing quad stretched along dir (a comet whose head is at p)
fn bill(p: vec3f, dir: vec3f, size: f32, q: vec2f, col: vec3f, kind: f32) -> VO {
  let vd = normalize(p - u.eye.xyz);
  let tl = dir - vd * dot(dir, vd); let L = length(tl);
  var along = normalize(cross(vd, vec3f(0.0, 1.0, 0.0001)));
  if (L > size * 0.05) { along = tl / L; }
  let side = normalize(cross(along, vd));
  let tail = min(L, 0.9);
  let y = (q.y * 0.5 + 0.5) * (tail + 2.0 * size) - tail - size;
  var o: VO;
  o.pos = u.vp * vec4f(p + side * q.x * size + along * y, 1.0);
  o.uv = q; o.col = col; o.kind = vec2f(kind, tail / (tail + 2.0 * size));
  return o;
}
fn stageOf(fr: f32) -> u32 {
  if (fr < .06) { return 0u; } if (fr < .20) { return 1u; } if (fr < .40) { return 2u; } if (fr < .54) { return 3u; }
  if (fr < .62) { return 5u; } if (fr < .80) { return 7u; } return 8u;
}
fn lane(i: u32) -> vec3f { return vec3f(hashf(i * 4u + 1u) + hashf(i * 4u + 2u) - 1.0, hashf(i * 4u + 3u) - 0.5, hashf(i * 4u + 4u) - 0.5); }

@vertex fn vs_agent(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let n = u32(u.a.w);
  let spark = ii >= n;
  let i = select(ii, ii - n, spark);
  let a = agents[i]; let m = a.x; let l = m & 15u; let st = (m >> 4u) & 15u;
  let f = clamp((f32(a.y) + u.a.y) / max(1.0, f32(a.z)), 0.0, 1.0);
  let sec = lut[11u + st].xy;
  let ln = lane(i);
  let R = rings[l].c.w;
  var dr = ln.x * 0.10; var dn = ln.y * 0.08;
  let jit = ln.z * 0.010;
  let focusL = u.b.x; let focusA = u.b.y;
  var dim = 1.0;
  if (focusL >= 0.0 && f32(l) != focusL) { dim = 0.10; }
  let q = corner(vi);
  if (spark) {
    if ((u32(u.c.x) & 2u) == 0u) { return culled(); }
    let committed = ((m >> 13u) & 1u) == 1u;
    if (st != 8u || !committed || f > 0.62) { return culled(); }
    let e = smoothstep(0.0, 1.0, f / 0.62);
    let start = toWorld(l, ringLocal(l, 0.80 + jit, dr, dn));
    let core = coreWorld();
    let nw = normalize((u.world * (kin[l].m * vec4f(rings[l].n.xyz, 0.0))).xyz);
    let lift = nw * (0.9 + ln.z) * sin(PI * e) * 0.6;
    let p = mix(start, core, e * e) + lift;
    let e2 = min(1.0, e + 0.08);
    let p2 = mix(start, core, e2 * e2) + nw * (0.9 + ln.z) * sin(PI * e2) * 0.6;
    let col = vec3f(1.0, 0.86, 0.58) * (0.9 * (1.0 - e * e * e * e)) * dim;
    return bill(p, p - p2, u.a.z * 1.6, q, col, 0.0);
  }
  if ((u32(u.c.x) & 1u) == 0u) { return culled(); }
  var fr = sec.x + (sec.y - sec.x) * f + jit;
  if (st == 6u) { // ask a human: lift off the hoop toward the viewer side of its plane and hover until answered or timed out
    let e = smoothstep(0.0, 0.25, f) * (1.0 - smoothstep(0.85, 1.0, f));
    dn += (0.55 + 0.35 * ln.x) * e + 0.04 * sin(u.a.x * 3.0 + ln.y * 40.0) * e;
  }
  if (st == 10u) { dr -= R * 0.72 * sin(PI * f); } // injected hold: dives toward the core and back
  let p = toWorld(l, ringLocal(l, fr, dr, dn));
  let speed = (sec.y - sec.x) / max(1.0, f32(a.z));
  let p2 = toWorld(l, ringLocal(l, fr - speed * 7.0, dr, dn));
  let s = lut[st];
  var inten = s.w;
  if (st == 8u && ((m >> 13u) & 1u) == 1u && f < 0.12) { inten *= 1.0 + 5.0 * (1.0 - f / 0.12); }
  if (st == 4u) { inten *= 1.3 + 0.7 * sin(u.a.x * 18.0 + ln.x * 9.0); }
  var size = u.a.z;
  var col = s.rgb * inten * dim * u.d.w;
  if (f32(i) == focusA) { size *= 7.0; col = vec3f(4.0, 3.6, 3.0); }
  return bill(p, p - p2, size, q, col, 0.0);
}

@vertex fn vs_spec(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  if ((u32(u.c.x) & 4u) == 0u) { return culled(); }
  let l = ii / 64u; let b = ii % 64u;
  var tot = 0u; for (var s = 0u; s < 11u; s++) { tot += cnt[128u + l * 16u + s]; }
  let c = f32(cnt[384u + ii]);
  let R = rings[l].c.w;
  let fr = (f32(b) + 0.5) / 64.0;
  let v = clamp(log2(1.0 + c) / log2(2.0 + f32(tot) * 0.06), 0.0, 1.35);
  let h = (0.02 + 0.20 * v) * u.b.z;
  let r0 = 0.15;
  let p0 = toWorld(l, ringLocal(l, fr, r0, 0.0));
  let p1 = toWorld(l, ringLocal(l, fr, r0 + h, 0.0));
  let w = TAU * R / 64.0 * 0.16;
  let q = corner(vi);
  let vd = normalize(p0 - u.eye.xyz);
  let side = normalize(cross(p1 - p0, vd));
  let p = mix(p0, p1, q.y * 0.5 + 0.5) + side * q.x * w;
  var dim = 1.0;
  if (u.b.x >= 0.0 && f32(l) != u.b.x) { dim = 0.12; }
  var o: VO;
  o.pos = u.vp * vec4f(p, 1.0); o.uv = q; o.col = lut[stageOf(fr)].rgb * (0.05 + 0.30 * v * v) * dim; o.kind = vec2f(1.0, 0.0);
  return o;
}

@vertex fn vs_core(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  if ((u32(u.c.x) & 8u) == 0u) { return culled(); }
  let g = u.b.w; let t = u.a.x;
  let p = coreWorld(); let q = corner(vi);
  var size = 0.0; var col = vec3f(0.0); var kind = 0.0;
  if (ii == 0u) { size = 1.6 + 0.8 * g; col = vec3f(1.0, 0.62, 0.25) * (0.05 + 0.10 * g); }
  else if (ii == 1u) { size = 0.55 + 0.25 * g; col = vec3f(1.0, 0.80, 0.45) * (0.25 + 0.5 * g); }
  else if (ii == 2u) { size = 0.20 + 0.10 * g; col = vec3f(1.0, 0.95, 0.85) * (2.0 + 3.0 * g); }
  else { let ph = fract(t * 0.35 + f32(ii) * 0.5); size = 0.5 + 3.0 * ph; col = vec3f(1.0, 0.78, 0.45) * (1.0 - ph) * (1.0 - ph) * (0.06 + 0.16 * g); kind = 2.0; }
  let vd = normalize(p - u.eye.xyz);
  let side = normalize(cross(vec3f(0.0, 1.0, 0.0001), vd)); let up = cross(vd, side);
  var o: VO; o.pos = u.vp * vec4f(p + (side * q.x + up * q.y) * size, 1.0); o.uv = q; o.col = col; o.kind = vec2f(kind, 0.0);
  return o;
}

// solo backdrop: the ten hoops, each loop's diameter spike through the core, and a star field
@vertex fn vs_hoop(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  if ((u32(u.c.x) & 16u) == 0u) { return culled(); }
  let l = ii / 257u; let s = ii % 257u; let q = corner(vi);
  var p0: vec3f; var p1: vec3f; var w = 0.012; var col = lut[22u + l].rgb * 0.30;
  if (s == 256u) { let R = rings[l]; p0 = toWorld(l, R.c.xyz - R.c.w * R.u.xyz); p1 = toWorld(l, R.c.xyz + R.c.w * R.u.xyz); w = 0.010; col *= 0.55; }
  else {
    let f0 = f32(s) / 256.0; let f1 = f32(s + 1u) / 256.0;
    p0 = toWorld(l, ringLocal(l, f0, 0.0, 0.0)); p1 = toWorld(l, ringLocal(l, f1, 0.0, 0.0));
    let pulse = 0.5 + 0.5 * sin(f0 * TAU * 3.0 - u.a.x * 1.3 + f32(l));
    col *= 0.55 + 0.6 * pulse * pulse;
  }
  if (u.b.x >= 0.0 && f32(l) != u.b.x) { col *= 0.25; }
  let vd = normalize(p0 - u.eye.xyz);
  let side = normalize(cross(p1 - p0, vd));
  let along = p1 - p0;
  let p = p0 + along * (q.y * 0.5 + 0.5) + side * q.x * w;
  var o: VO; o.pos = u.vp * vec4f(p, 1.0); o.uv = q; o.col = col; o.kind = vec2f(3.0, 0.0);
  return o;
}
@vertex fn vs_star(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  if ((u32(u.c.x) & 32u) == 0u) { return culled(); }
  let h1 = hashf(ii * 5u + 11u); let h2 = hashf(ii * 5u + 12u); let h3 = hashf(ii * 5u + 13u); let h4 = hashf(ii * 5u + 14u);
  let z = h1 * 2.0 - 1.0; let ph = h2 * TAU; let r = sqrt(1.0 - z * z);
  let p = coreWorld() + vec3f(r * cos(ph), z, r * sin(ph)) * (45.0 + 40.0 * h3);
  let tw = 0.65 + 0.35 * sin(u.a.x * (0.5 + h4 * 2.0) + h4 * 50.0);
  let col = mix(vec3f(0.55, 0.7, 1.0), vec3f(1.0, 0.8, 0.55), h4) * (0.25 + 1.4 * h3 * h3) * tw;
  let vd = normalize(p - u.eye.xyz);
  let side = normalize(cross(vec3f(0.0, 1.0, 0.0001), vd)); let up = cross(vd, side);
  let q = corner(vi); let size = 0.09 + 0.16 * h3 * h3;
  var o: VO; o.pos = u.vp * vec4f(p + (side * q.x + up * q.y) * size, 1.0); o.uv = q; o.col = col; o.kind = vec2f(0.0, 0.0);
  return o;
}

@fragment fn fs_glow(i: VO) -> @location(0) vec4f {
  let uv = i.uv; var a = 0.0;
  if (i.kind.x < 0.5) {               // comet: a round head at uv.y = tau that fades into its tail
    let tau = i.kind.y;
    if (tau < 0.05) { a = exp(-4.5 * dot(uv, uv)); }
    else {
      let hy = (uv.y - tau) / max(0.05, 1.0 - tau);
      let head = exp(-4.5 * (uv.x * uv.x + hy * hy));
      let tail = exp(-5.0 * uv.x * uv.x) * smoothstep(-1.0, tau, uv.y) * 0.5 * step(uv.y, tau);
      a = max(head, tail);
    }
  } else if (i.kind.x < 1.5) { a = exp(-3.0 * uv.x * uv.x) * (0.35 + 0.65 * (uv.y * 0.5 + 0.5)) * smoothstep(1.0, 0.8, uv.y); }
  else if (i.kind.x < 2.5) { let r = length(uv); a = exp(-90.0 * (r - 0.82) * (r - 0.82)) * step(r, 1.0); }
  else { a = exp(-2.5 * uv.x * uv.x); }
  return vec4f(i.col * a, 0.0);
}`;

  const POST_WGSL = /* wgsl */`
struct PU { texel: vec4f, k: vec4f };
@group(0) @binding(0) var<uniform> pu: PU;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var t0: texture_2d<f32>;
@group(0) @binding(3) var t1: texture_2d<f32>;
struct FO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FO; o.pos = vec4f(p[vi], 0.0, 1.0); o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5); return o;
}
@fragment fn fs_down(i: FO) -> @location(0) vec4f {   // 13-tap downsample (the "dual filter" pattern), a soft knee on the first level
  let d = pu.texel.xy; let uv = i.uv;
  var c = textureSample(t0, smp, uv) * 0.125;
  c += (textureSample(t0, smp, uv + d * vec2f(-1.0, -1.0)) + textureSample(t0, smp, uv + d * vec2f(1.0, -1.0)) + textureSample(t0, smp, uv + d * vec2f(-1.0, 1.0)) + textureSample(t0, smp, uv + d * vec2f(1.0, 1.0))) * 0.125;
  c += (textureSample(t0, smp, uv + d * vec2f(-2.0, 0.0)) + textureSample(t0, smp, uv + d * vec2f(2.0, 0.0)) + textureSample(t0, smp, uv + d * vec2f(0.0, -2.0)) + textureSample(t0, smp, uv + d * vec2f(0.0, 2.0))) * 0.0625;
  c += (textureSample(t0, smp, uv + d * vec2f(-2.0, -2.0)) + textureSample(t0, smp, uv + d * vec2f(2.0, -2.0)) + textureSample(t0, smp, uv + d * vec2f(-2.0, 2.0)) + textureSample(t0, smp, uv + d * vec2f(2.0, 2.0))) * 0.03125;
  if (pu.k.x > 0.5) { let l = max(c.r, max(c.g, c.b)); c = c * max(0.0, l - 0.35) / max(l, 1e-4); }
  return vec4f(c.rgb, 1.0);
}
@fragment fn fs_up(i: FO) -> @location(0) vec4f {     // 9-tap tent upsample of the lower level, added to this level
  let d = pu.texel.xy; let uv = i.uv;
  var c = textureSample(t1, smp, uv) * 4.0;
  c += (textureSample(t1, smp, uv + vec2f(d.x, 0.0)) + textureSample(t1, smp, uv - vec2f(d.x, 0.0)) + textureSample(t1, smp, uv + vec2f(0.0, d.y)) + textureSample(t1, smp, uv - vec2f(0.0, d.y))) * 2.0;
  c += textureSample(t1, smp, uv + d) + textureSample(t1, smp, uv - d) + textureSample(t1, smp, uv + vec2f(d.x, -d.y)) + textureSample(t1, smp, uv + vec2f(-d.x, d.y));
  return vec4f(textureSample(t0, smp, uv).rgb + c.rgb / 16.0, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs_comp(i: FO) -> @location(0) vec4f {
  let uv = i.uv;
  let ca = (uv - 0.5) * 0.0025;
  let hdr = vec3f(textureSample(t0, smp, uv + ca).r, textureSample(t0, smp, uv).g, textureSample(t0, smp, uv - ca).b);
  let bloom = textureSample(t1, smp, uv).rgb;
  var c = (hdr + bloom * pu.k.y) * pu.k.z;
  c = aces(c);
  if (pu.k.w > 1.5) { return vec4f(c, 1.0); }   // overlay captured for a test: opaque so the pixels can be read
  if (pu.k.w > 0.5) {               // solo: a quiet vignette and the v1 night-blue floor of the frame
    let q = uv - 0.5; c *= 1.0 - smoothstep(0.25, 0.95, dot(q, q) * 1.6) * 0.55;
    c += vec3f(0.004, 0.006, 0.014);
    return vec4f(c, 1.0);
  }
  return vec4f(c, 0.0);              // overlay: alpha 0 makes the compositor add our light onto the Babylon canvas
}`;

  function f32(n) { return new Float32Array(n); }

  class GpuSwarm {
    static async create(opts) {
      const s = new GpuSwarm(); await s.init(opts); return s;
    }
    async init({ canvas, device, kinBuffer, solo, n, maxN }) {
      this.canvas = canvas; this.solo = !!solo; this.backend = 'webgpu';
      this.shared = !!device;
      if (!device) {
        const ad = await navigator.gpu.requestAdapter();
        if (!ad) throw Error('no adapter');
        this.adapterInfo = ad.info ? { vendor: ad.info.vendor, architecture: ad.info.architecture, description: ad.info.description } : {};
        device = await ad.requestDevice(); // default limits: 128 MiB storage bindings hold 8M agents, and raised limits break the swap chain on SwiftShader
      }
      this.device = device;
      device.lost && device.lost.then((info) => { this.lost = info && info.message; });
      this.errors = [];
      device.pushErrorScope && device.pushErrorScope('validation');
      this.maxN = maxN || 262144;
      // capture: render offscreen and copy pixels into a 2D canvas. Only for rigs that cannot present a WebGPU swap chain
      // (headless Chromium on SwiftShader loses the device on the first present); slow, correctness only.
      this.capture = !!GpuSwarm.capture;
      if (this.capture) { this.ctx2d = canvas.getContext('2d'); this.format = 'rgba8unorm'; }
      else {
        this.ctx = canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.ctx.configure({ device, format: this.format, alphaMode: this.solo ? 'opaque' : 'premultiplied' });
      }
      const B = GPUBufferUsage;
      this.U = device.createBuffer({ size: 256, usage: B.UNIFORM | B.COPY_DST });
      this.Uf = f32(64);
      this.rings = device.createBuffer({ size: 10 * 64, usage: B.STORAGE | B.COPY_DST });
      this.kinOwn = device.createBuffer({ size: 10 * 80, usage: B.STORAGE | B.COPY_DST });
      this.kin = kinBuffer || this.kinOwn;
      this.lut = device.createBuffer({ size: 32 * 16, usage: B.STORAGE | B.COPY_DST });
      this.P = device.createBuffer({ size: 64, usage: B.STORAGE | B.COPY_DST });
      this.cnt = device.createBuffer({ size: M.C.SIZE * 4, usage: B.STORAGE | B.COPY_DST | B.COPY_SRC });
      this.agents = device.createBuffer({ size: this.maxN * 16, usage: B.STORAGE | B.COPY_DST | B.COPY_SRC });
      this.readBuf = device.createBuffer({ size: M.C.SIZE * 4 + 16, usage: B.MAP_READ | B.COPY_DST });
      const lut = f32(32 * 4);
      M.COLOR.forEach((c, k) => lut.set([c[0], c[1], c[2], [0.30, 1.1, 1.0, 1.0, 1.2, 1.4, 1.5, 1.1, 1.0, 0.22, 1.6][k]], k * 4));
      M.SECTOR.forEach((s, k) => lut.set([s[0], s[1], 0, 0], (11 + k) * 4));
      GpuSwarm.LOOP_COLORS.forEach((c, k) => lut.set([c[0], c[1], c[2], 1], (22 + k) * 4));
      device.queue.writeBuffer(this.lut, 0, lut);
      const step = device.createShaderModule({ code: STEP_WGSL, label: 'swarm-step' });
      const draw = device.createShaderModule({ code: DRAW_WGSL, label: 'swarm-draw' });
      const post = device.createShaderModule({ code: POST_WGSL, label: 'swarm-post' });
      this.modules = { step, draw, post };
      this.pStep = device.createComputePipeline({ layout: 'auto', compute: { module: step, entryPoint: 'step' } });
      this.pClear = device.createComputePipeline({ layout: 'auto', compute: { module: step, entryPoint: 'clear' } });
      const bgl = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4, 5].map((b) => ({ binding: b, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }))] });
      this.drawLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      this.bgl = bgl;
      this.hdrFormat = 'rgba16float';
      const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
      const mk = (vs) => device.createRenderPipeline({ layout: this.drawLayout, vertex: { module: draw, entryPoint: vs },
        fragment: { module: draw, entryPoint: 'fs_glow', targets: [{ format: this.hdrFormat, blend: add }] }, primitive: { topology: 'triangle-list' } });
      this.pAgent = mk('vs_agent'); this.pSpec = mk('vs_spec'); this.pCore = mk('vs_core'); this.pHoop = mk('vs_hoop'); this.pStar = mk('vs_star');
      const pfull = (fs, fmt) => device.createRenderPipeline({ layout: 'auto', vertex: { module: post, entryPoint: 'vs_full' },
        fragment: { module: post, entryPoint: fs, targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } });
      this.pDown = pfull('fs_down', this.hdrFormat); this.pUp = pfull('fs_up', this.hdrFormat); this.pComp = pfull('fs_comp', this.format);
      this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      this.postU = Array.from({ length: 9 }, () => device.createBuffer({ size: 32, usage: B.UNIFORM | B.COPY_DST }));
      this.dummy = device.createTexture({ size: [1, 1], format: this.hdrFormat, usage: GPUTextureUsage.TEXTURE_BINDING });
      this.setCount(n || 30000);
      this.pending = false; this.counters = new Uint32Array(M.C.SIZE); this.focusState = null; this.frames = 0;
      if (device.popErrorScope) { const e = await device.popErrorScope(); if (e) throw Error('WebGPU validation: ' + e.message); }
      const infos = await Promise.all([step, draw, post].map((m) => m.getCompilationInfo ? m.getCompilationInfo() : { messages: [] }));
      const errs = infos.flatMap((i) => i.messages.filter((m) => m.type === 'error').map((m) => m.lineNum + ': ' + m.message));
      if (errs.length) throw Error('WGSL: ' + errs.join('; '));
    }
    setCount(n) {
      n = Math.max(1, Math.min(this.maxN, n | 0));
      this.n = n;
      const a = M.init(n);
      this.device.queue.writeBuffer(this.agents, 0, a);
      this.device.queue.writeBuffer(this.cnt, 0, new Uint32Array(M.C.SIZE));
      this.bindings();
    }
    bindings() {
      const d = this.device;
      this.bgDraw = d.createBindGroup({ layout: this.bgl, entries: [this.U, this.kin, this.rings, this.agents, this.cnt, this.lut].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
      this.bgStep = d.createBindGroup({ layout: this.pStep.getBindGroupLayout(0), entries: [this.P, this.agents, this.cnt].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
      this.bgClear = d.createBindGroup({ layout: this.pClear.getBindGroupLayout(0), entries: [{ binding: 2, resource: { buffer: this.cnt } }] });
    }
    setRings(r) { this.device.queue.writeBuffer(this.rings, 0, r); }
    setKin(k) { if (this.kin === this.kinOwn) this.device.queue.writeBuffer(this.kinOwn, 0, k); }
    targets(w, h) {
      if (this.tw === w && this.th === h) return;
      this.tw = w; this.th = h;
      const T = GPUTextureUsage, mk = (W, H) => this.device.createTexture({ size: [Math.max(1, W), Math.max(1, H)], format: this.hdrFormat, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
      (this.tex || []).forEach((t) => t.destroy());
      this.hdr = mk(w, h);
      this.down = [2, 4, 8, 16, 32].map((k) => mk(Math.ceil(w / k), Math.ceil(h / k)));
      this.up = [2, 4, 8, 16].map((k) => mk(Math.ceil(w / k), Math.ceil(h / k)));
      this.tex = [this.hdr, ...this.down, ...this.up];
      if (this.capture) {
        this.capTex = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: T.RENDER_ATTACHMENT | T.COPY_SRC });
        this.capBpr = Math.ceil(w * 4 / 256) * 256; this.capBuf && this.capBuf.destroy();
        this.capBuf = this.device.createBuffer({ size: this.capBpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); this.tex.push(this.capTex);
      }
      const d = this.device, ug = (p, i, a, b) => d.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.postU[i] } }, { binding: 1, resource: this.sampler },
        { binding: 2, resource: a.createView() }, ...(b ? [{ binding: 3, resource: b.createView() }] : [])] });
      // down: hdr->d0->d1->d2->d3->d4 ; up: u3 = d3 + up(d4), u2 = d2 + up(u3), u1 = d1 + up(u2), u0 = d0 + up(u1)
      this.passes = [];
      const src = [this.hdr, ...this.down];
      for (let k = 0; k < 5; k++) this.passes.push({ p: this.pDown, bg: ug(this.pDown, k, src[k], null), dst: this.down[k], texel: [1 / src[k].width, 1 / src[k].height], k: [k === 0 ? 1 : 0, 0, 0, 0] });
      let low = this.down[4];
      for (let k = 3; k >= 0; k--) { this.passes.push({ p: this.pUp, bg: ug(this.pUp, 5 + (3 - k), this.down[k], low), dst: this.up[k], texel: [1 / low.width, 1 / low.height], k: [0, 0, 0, 0] }); low = this.up[k]; }
      this.compBG = d.createBindGroup({ layout: this.pComp.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.postU[8] } }, { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hdr.createView() }, { binding: 3, resource: this.up[0].createView() }] });
    }
    /* f: { steps, chaos, counters(bool), vp, world, eye, time, alpha, size, focusLoop, focusAgent, spectrum, glow, layers, exposure, bloom } */
    frame(f) {
      const d = this.device, w = this.canvas.width, h = this.canvas.height;
      if (!w || !h) return;
      if (this.capture && this.capPending) return false; // capture rigs have no swap chain to pace the queue, so we pace on the readback
      this.targets(w, h);
      const Uf = this.Uf;
      Uf.set(f.vp, 0); Uf.set(f.world, 16); Uf.set([f.eye[0], f.eye[1], f.eye[2], 1], 32);
      Uf.set([f.time, f.alpha, f.size, this.n], 36); Uf.set([f.focusLoop, f.focusAgent, f.spectrum, f.glow], 40);
      Uf.set([f.layers, this.solo ? 1 : 0, f.exposure, 1], 44); Uf.set([w, h, f.bloom, f.gain], 48);
      d.queue.writeBuffer(this.U, 0, Uf);
      const p = M.params(this.n, f.steps, f.chaos); p[10] = 1;
      d.queue.writeBuffer(this.P, 0, p);
      for (const ps of this.passes) d.queue.writeBuffer(this.postU[this.passes.indexOf(ps)], 0, new Float32Array([...ps.texel, 0, 0, ...ps.k]));
      d.queue.writeBuffer(this.postU[8], 0, new Float32Array([1 / w, 1 / h, 0, 0, 0, f.bloom, f.exposure, this.solo ? 1 : (this.capture ? 2 : 0)]));
      const enc = d.createCommandEncoder({ label: 'swarm' });
      const X = GpuSwarm.debug || {};
      if (!X.noCompute) {
      const c = enc.beginComputePass();
      c.setPipeline(this.pClear); c.setBindGroup(0, this.bgClear); c.dispatchWorkgroups(4);
      c.setPipeline(this.pStep); c.setBindGroup(0, this.bgStep); c.dispatchWorkgroups(Math.ceil(this.n / 256));
      c.end();
      }
      const r = enc.beginRenderPass({ colorAttachments: [{ view: this.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      r.setBindGroup(0, this.bgDraw);
      if (this.solo && !X.noBack) { r.setPipeline(this.pStar); r.draw(6, 2600); r.setPipeline(this.pHoop); r.draw(6, 10 * 257); }
      if (!X.noSpec) { r.setPipeline(this.pSpec); r.draw(6, 640); }
      if (!X.noAgent) { r.setPipeline(this.pAgent); r.draw(6, this.n * 2); }
      if (!X.noCore) { r.setPipeline(this.pCore); r.draw(6, 5); }
      r.end();
      for (const ps of (X.noBloom ? [] : this.passes)) {
        const q = enc.beginRenderPass({ colorAttachments: [{ view: ps.dst.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        q.setPipeline(ps.p); q.setBindGroup(0, ps.bg); q.draw(3); q.end();
      }
      const capNow = this.capture && !this.capPending;
      if (!this.capture || capNow) {
        const o = enc.beginRenderPass({ colorAttachments: [{ view: (this.capture ? this.capTex : this.ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: this.solo ? 1 : 0 } }] });
        if (!X.noComp) { o.setPipeline(this.pComp); o.setBindGroup(0, this.compBG); o.draw(3); } o.end();
      }
      const read = f.counters && !this.pending && !X.noRead;
      if (read) {
        enc.copyBufferToBuffer(this.cnt, 0, this.readBuf, 0, M.C.SIZE * 4);
        if (f.focusAgent >= 0 && f.focusAgent < this.n) enc.copyBufferToBuffer(this.agents, f.focusAgent * 16, this.readBuf, M.C.SIZE * 4, 16);
      }
      if (capNow) enc.copyTextureToBuffer({ texture: this.capTex }, { buffer: this.capBuf, bytesPerRow: this.capBpr }, [w, h]);
      d.queue.submit([enc.finish()]);
      this.frames++;
      if (capNow) {
        this.capPending = true; const buf = this.capBuf, bpr = this.capBpr;
        buf.mapAsync(GPUMapMode.READ).then(() => {
          const src = new Uint8Array(buf.getMappedRange()), img = new ImageData(w, h);
          for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
          buf.unmap(); this.ctx2d.putImageData(img, 0, 0); this.captures = (this.captures || 0) + 1;
        }).catch((e) => { this.readError = String(e); }).finally(() => { this.capPending = false; });
      }
      if (read) {
        this.pending = true;
        const fa = f.focusAgent;
        this.readBuf.mapAsync(GPUMapMode.READ).then(() => {
          const u = new Uint32Array(this.readBuf.getMappedRange());
          this.counters = u.slice(0, M.C.SIZE); this.focusState = fa >= 0 ? { id: fa, s: u.slice(M.C.SIZE, M.C.SIZE + 4) } : null;
          this.readBuf.unmap(); this.reads = (this.reads || 0) + 1;
        }).catch((e) => { this.readError = String(e); }).finally(() => { this.pending = false; });
      }
    }
    /* Warm start: run `ticks` of the state machine before the first frame (compute only, counters on). */
    async warm(ticks, chaos = 0) {
      const d = this.device, p = M.params(this.n, 8, chaos); p[10] = 1;
      d.queue.writeBuffer(this.P, 0, p);
      for (let k = 0; k < Math.ceil(ticks / 8); k++) {
        const enc = d.createCommandEncoder(); const c = enc.beginComputePass();
        c.setPipeline(this.pStep); c.setBindGroup(0, this.bgStep); c.dispatchWorkgroups(Math.ceil(this.n / 256)); c.end();
        d.queue.submit([enc.finish()]);
        if (k % 16 === 15) await d.queue.onSubmittedWorkDone();
      }
      await d.queue.onSubmittedWorkDone();
    }
    /* Parity: step `ticks` times on the GPU without counters-as-display and return states + event counters. */
    async runTicks(n, ticks, chaos = 0) {
      const d = this.device;
      this.setCount(n);
      const p = M.params(n, 1, chaos); p[10] = 1;
      for (let k = 0; k < ticks; k++) {
        d.queue.writeBuffer(this.P, 0, p);
        const enc = d.createCommandEncoder(); const c = enc.beginComputePass();
        c.setPipeline(this.pStep); c.setBindGroup(0, this.bgStep); c.dispatchWorkgroups(Math.ceil(n / 256)); c.end();
        d.queue.submit([enc.finish()]);
      }
      const rb = d.createBuffer({ size: n * 16 + M.C.SIZE * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(this.agents, 0, rb, 0, n * 16); enc.copyBufferToBuffer(this.cnt, 0, rb, n * 16, M.C.SIZE * 4);
      d.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const all = new Uint32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy();
      return { agents: all.slice(0, n * 4), counters: all.slice(n * 4) };
    }
  }
  // ten hoop hues for the solo backdrop (Babylon draws v1's own hoops when the full scene is up)
  GpuSwarm.LOOP_COLORS = [[1.0, 0.78, 0.42], [0.42, 0.86, 1.0], [0.96, 0.46, 0.66], [0.62, 1.0, 0.5], [0.72, 0.56, 1.0],
    [1.0, 0.6, 0.28], [0.5, 1.0, 0.86], [1.0, 0.9, 0.62], [0.9, 0.5, 1.0], [0.56, 0.72, 1.0]];
  window.GobblerSwarmGPU = GpuSwarm;
  window.GobblerSwarmWGSL = { STEP_WGSL, DRAW_WGSL, POST_WGSL };
})();
