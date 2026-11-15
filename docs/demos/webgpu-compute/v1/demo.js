/* WebGPU compute for X3D: the page. Vanilla WebGPU, no libraries. The kernels, fixtures, CPU references and the correctness gate are the
   x3d.loom/x3d.compute folder, copied unchanged into ./compute/ (tools/publish-demo.sh in that folder does the copy). */
import * as G from './compute/src/gpu.js';
import * as PR from './compute/src/ref/particles.js';
import * as SK from './compute/src/ref/skinning.js';
import * as VO from './compute/src/ref/volume.js';
import * as NU from './compute/src/ref/nurbs.js';
import * as SP from './compute/src/ref/splats.js';

const DBG = new Set((new URLSearchParams(location.search).get('dbg') || '').split(',')), $ = (s) => document.querySelector(s), U = GPUBufferUsage;
const kern = async (n) => (await fetch(`./compute/src/kernels/${n}.wgsl`)).text();
const xmlDoc = async (n) => new DOMParser().parseFromString(await (await fetch(`./compute/fixtures/${n}`)).text(), 'application/xml');
const fmt = (x, d = 2) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(d));
const si = (x) => (x >= 1e9 ? (x / 1e9).toFixed(2) + ' G' : x >= 1e6 ? (x / 1e6).toFixed(2) + ' M' : x >= 1e3 ? (x / 1e3).toFixed(1) + ' k' : String(Math.round(x)));
const wg = (n, s) => Math.ceil(n / s);

/* ---- tiny mat4 (column-major) ---- */
const M4 = {
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = f / (n - f); m[11] = -1; m[14] = n * f / (n - f); return m; },
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
};
function orbit(st, aspect) {
  const cy = Math.cos(st.pitch), eye = [st.target[0] + st.r * cy * Math.sin(st.yaw), st.target[1] + st.r * Math.sin(st.pitch), st.target[2] + st.r * cy * Math.cos(st.yaw)];
  const view = SP.lookAt(eye, st.target), proj = M4.persp(0.9, aspect, 0.1, 200);
  return { eye, view, vp: M4.mul(proj, view) };
}

/* ---- device, canvas, timer ---- */
let SOFT = false, C, dev, canvas, cctx, fmtC, depthTex = null, Tm = { qs: null, busy: false, pending: false, ms: null };
async function boot() {
  C = await G.init(); dev = C.device; SOFT = /swiftshader|llvmpipe|software|basic render/i.test((C.info.architecture || '') + ' ' + (C.info.description || '') + ' ' + (C.info.device || '')); canvas = $('#cv');
  if (DBG.has('offscreen')) {   // test rig only: a WebGPU canvas never presents on a headless software adapter (the bridge harness stubs its context for the same reason), so render to a texture and blit it to a 2D canvas
    fmtC = 'bgra8unorm'; const g2 = canvas.getContext('2d');
    cctx = { _t: null, configure() {}, getCurrentTexture() { const w = canvas.width, h = canvas.height; if (!this._t || this._t.width !== w || this._t.height !== h) { this._t?.destroy(); this._t = dev.createTexture({ size: [w, h], format: fmtC, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); } return this._t; },
      async blit() { const t = this._t; if (!t) return; const bpr = Math.ceil(t.width * 4 / 256) * 256, b = dev.createBuffer({ size: bpr * t.height, usage: U.COPY_DST | U.MAP_READ }), e = dev.createCommandEncoder(); e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: bpr }, [t.width, t.height]); dev.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const src = new Uint8Array(b.getMappedRange()), im = g2.createImageData(t.width, t.height); for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const i = y * bpr + x * 4, o = (y * t.width + x) * 4; im.data[o] = src[i + 2]; im.data[o + 1] = src[i + 1]; im.data[o + 2] = src[i]; im.data[o + 3] = 255; } g2.putImageData(im, 0, 0); b.unmap(); b.destroy(); } };
    window.__x3d.blit = () => cctx.blit();
  } else { cctx = canvas.getContext('webgpu'); fmtC = navigator.gpu.getPreferredCanvasFormat(); cctx.configure({ device: dev, format: fmtC, alphaMode: 'opaque' }); }
  if (C.hasTS) { Tm.qs = dev.createQuerySet({ type: 'timestamp', count: 2 }); Tm.res = dev.createBuffer({ size: 16, usage: U.QUERY_RESOLVE | U.COPY_SRC }); Tm.rb = dev.createBuffer({ size: 16, usage: U.COPY_DST | U.MAP_READ }); }
}
window.__x3d = { get Tm() { return Tm; }, done: 0, enc: 0, err: null };
const ts = (i, n) => (Tm.qs && !Tm.busy && (i === 0 || i === n - 1) ? { querySet: Tm.qs, ...(i === 0 ? { beginningOfPassWriteIndex: 0 } : {}), ...(i === n - 1 ? { endOfPassWriteIndex: 1 } : {}) } : undefined);
const tsResolve = (e) => { if (Tm.qs && !Tm.busy) { e.resolveQuerySet(Tm.qs, 0, 2, Tm.res, 0); e.copyBufferToBuffer(Tm.res, 0, Tm.rb, 0, 16); Tm.pending = true; } };
const tsAfter = () => { if (Tm.pending) { Tm.pending = false; Tm.busy = true; Tm.rb.mapAsync(GPUMapMode.READ).then(() => { const t = new BigUint64Array(Tm.rb.getMappedRange().slice(0)); Tm.rb.unmap(); Tm.ms = Number(t[1] - t[0]) / 1e6; Tm.busy = false; }); } };
function sizeCanvas() {
  const r = canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2), w = Math.max(2, Math.floor(r.width * d)), h = Math.max(2, Math.floor(r.height * d));
  if (canvas.width !== w || canvas.height !== h || !depthTex) { canvas.width = w; canvas.height = h; depthTex?.destroy(); depthTex = dev.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }); }
}
const UB = (bytes) => dev.createBuffer({ size: bytes, usage: U.UNIFORM | U.COPY_DST });
const rpass = (e, clear, depth = false) => e.beginRenderPass({ colorAttachments: [{ view: cctx.getCurrentTexture().createView(), clearValue: clear, loadOp: 'clear', storeOp: 'store' }], ...(depth ? { depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } } : {}) });
const rpipe = async (code, { vbuf = [], blend, depth = false, topology = 'triangle-list' } = {}) => {
  const m = dev.createShaderModule({ code }), info = await m.getCompilationInfo(); const bad = info.messages.filter((x) => x.type === 'error'); if (bad.length) throw new Error(bad.map((x) => `${x.lineNum}: ${x.message}`).join('\n'));
  return dev.createRenderPipelineAsync({ layout: 'auto', vertex: { module: m, entryPoint: 'vs', buffers: vbuf }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: fmtC, ...(blend ? { blend } : {}) }] }, primitive: { topology, cullMode: 'none' }, ...(depth ? { depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } } : {}) });
};

/* ---- shared render shaders ---- */
const MESH_WGSL = `
struct V { vp: mat4x4<f32>, eye: vec4<f32>, a: vec4<f32>, b: vec4<f32> };
@group(0) @binding(0) var<uniform> U: V;
struct O { @builtin(position) p: vec4<f32>, @location(0) n: vec3<f32>, @location(1) w: vec3<f32>, @location(2) uv: vec2<f32> };
@vertex fn vs(@location(0) pos: vec4<f32>, @location(1) nrm: vec4<f32>, @builtin(vertex_index) vi: u32) -> O {
  var o: O; o.p = U.vp * vec4<f32>(pos.xyz, 1.0); o.n = nrm.xyz; o.w = pos.xyz;
  let gw = u32(U.a.x); o.uv = vec2<f32>(f32(vi % gw) / max(1.0, U.a.x - 1.0), f32(vi / gw) / max(1.0, U.a.y - 1.0)); return o;
}
fn pal(t: f32) -> vec3<f32> { return 0.5 + 0.5 * cos(6.2831853 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.33, 0.67))); }
@fragment fn fs(i: O) -> @location(0) vec4<f32> {
  var n = normalize(i.n); let v = normalize(U.eye.xyz - i.w); if (dot(n, v) < 0.0) { n = -n; }
  let l1 = normalize(vec3<f32>(0.5, 0.9, 0.4)); let l2 = normalize(vec3<f32>(-0.7, 0.2, -0.5));
  var base = vec3<f32>(0.85, 0.62, 0.35);
  if (U.b.x > 0.5) { base = 0.45 + 0.55 * n; }        // colour by normal
  if (U.b.x > 1.5) { base = pal(i.uv.x * 1.0 + i.uv.y * 0.35) * 0.9 + 0.1; }   // colour by (u,v)
  let d = max(dot(n, l1), 0.0) * 0.85 + max(dot(n, l2), 0.0) * 0.30 + 0.16;
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.55;
  let h = normalize(l1 + v); let spec = pow(max(dot(n, h), 0.0), 48.0) * 0.45;
  return vec4<f32>(base * d + vec3<f32>(0.30, 0.55, 0.9) * rim + spec, 1.0);
}`;
const PART_WGSL = `
struct V { vp: mat4x4<f32>, screen: vec4<f32>, a: vec4<f32>, b: vec4<f32> };
@group(0) @binding(0) var<uniform> U: V;
@group(0) @binding(1) var<storage, read> S: array<f32>;
struct O { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) c: vec3<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> O {
  var q = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  let b = ii * 8u; let pos = vec3<f32>(S[b], S[b + 1u], S[b + 2u]); let vel = vec3<f32>(S[b + 4u], S[b + 5u], S[b + 6u]); let age = S[b + 7u];
  var c = U.vp * vec4<f32>(pos, 1.0); let heat = clamp(age / U.a.x, 0.0, 1.0); let sp = length(vel);
  c = vec4<f32>(c.xy + q[vi] * U.a.y * 2.0 / U.screen.xy * c.w, c.zw);
  var o: O; o.p = c; o.uv = q[vi];
  o.c = mix(vec3<f32>(1.0, 0.93, 0.62), vec3<f32>(1.0, 0.22, 0.04), smoothstep(0.0, 0.7, heat)) * (1.0 - 0.85 * heat) + vec3<f32>(0.05, 0.25, 0.7) * clamp(sp * 0.07, 0.0, 1.0) * (1.0 - heat);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4<f32> { let a = exp(-dot(i.uv, i.uv) * 3.2) * U.a.z; return vec4<f32>(i.c * a, a); }`;
const SPLAT_WGSL = `
struct V { vp: mat4x4<f32>, screen: vec4<f32>, a: vec4<f32>, b: vec4<f32> };
@group(0) @binding(0) var<uniform> U: V;
@group(0) @binding(1) var<storage, read> s2d: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> keys: array<u32>;
@group(0) @binding(3) var<storage, read> vals: array<u32>;
@group(0) @binding(4) var<storage, read> pos: array<vec4<f32>>;
struct O { @builtin(position) p: vec4<f32>, @location(0) d: vec2<f32>, @location(1) con: vec3<f32>, @location(2) col: vec4<f32> };
fn pal(t: f32) -> vec3<f32> { return 0.5 + 0.5 * cos(6.2831853 * (t + vec3<f32>(0.0, 0.1, 0.2))); }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> O {
  var q = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  var o: O; let k = u32(U.a.x) - 1u - ii;                       // sorted ascending by depth (near first): draw far to near
  if (keys[k] == 0xFFFFFFFFu) { o.p = vec4<f32>(2.0, 2.0, 2.0, 1.0); return o; }
  let id = vals[k]; let A = s2d[2u * id]; let B = s2d[2u * id + 1u]; let off = q[vi] * B.y;
  let px = A.xy + off; o.p = vec4<f32>(px.x / U.screen.x * 2.0 - 1.0, 1.0 - px.y / U.screen.y * 2.0, 0.5, 1.0);
  o.d = off; o.con = vec3<f32>(A.z, A.w, B.x);
  let P = pos[id]; let r = length(P.xz); let ang = atan2(P.z, P.x);
  let core = exp(-r * 0.35); let t = 0.58 - 0.13 * r / 7.0 + 0.04 * sin(ang * 2.0 + r);
  o.col = vec4<f32>(mix(pal(t), vec3<f32>(1.0, 0.9, 0.7), core * 0.8) * (0.7 + 0.8 * core), B.z);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4<f32> {
  let pw = -0.5 * (i.con.x * i.d.x * i.d.x + 2.0 * i.con.y * i.d.x * i.d.y + i.con.z * i.d.y * i.d.y);
  if (pw > 0.0) { discard; }
  let a = min(0.99, i.col.a * exp(pw) * U.a.y); if (a < 0.004) { discard; }
  return vec4<f32>(i.col.rgb * a, a);
}`;
const VOL_WGSL = `
struct V { w: f32, h: f32, iw: f32, ih: f32 };
@group(0) @binding(0) var<uniform> U: V;
@group(0) @binding(1) var<storage, read> img: array<u32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> { var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)); return vec4<f32>(p[i], 0.0, 1.0); }
@fragment fn fs(@builtin(position) fp: vec4<f32>) -> @location(0) vec4<f32> {
  let s = min(U.w / U.iw, U.h / U.ih); let ox = (U.w - U.iw * s) * 0.5; let oy = (U.h - U.ih * s) * 0.5;
  let x = (fp.x - ox) / s; let y = (fp.y - oy) / s;
  let bg = vec3<f32>(0.016, 0.022, 0.045) + vec3<f32>(0.03, 0.04, 0.08) * (1.0 - fp.y / U.h);
  if (x < 0.0 || y < 0.0 || x >= U.iw || y >= U.ih) { return vec4<f32>(bg, 1.0); }
  let p = img[u32(y) * u32(U.iw) + u32(x)]; let c = vec4<f32>(f32(p & 255u), f32((p >> 8u) & 255u), f32((p >> 16u) & 255u), f32(p >> 24u)) / 255.0;
  return vec4<f32>(c.rgb + bg * (1.0 - c.a), 1.0);
}`;

/* ---- scenes ---- */
const state = { scene: null, scenes: {}, name: '', last: 0, frameMs: 0, lastDone: 0, drag: null };
const cam = { yaw: 0.6, pitch: 0.35, r: 9, target: [0, 0.6, 0], auto: true };
const hud = (rows) => { $('#hud').innerHTML = rows.map(([k, v, cls]) => `<div class="kv"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`).join(''); };
const gms = () => (Tm.ms == null ? null : Tm.ms);

/* 1. particles ---------------------------------------------------------------------------------------------------- */
const particles = {
  title: 'ParticleSystem', blurb: 'One thread per particle: ConeEmitter, ForcePhysicsModel, WindPhysicsModel and a BoundedPhysicsModel floor, read from the fixture and steered with the sliders. The state never leaves the GPU; the same buffer is drawn as 1 to 2 million additive sprites.',
  async setup() {
    const P0 = PR.fromX3D(await xmlDoc('particles-cone-wind.x3d')); this.P = P0; this.code = await kern('particles');
    this.pStep = await G.pipeline(C, this.code, 'step'); this.pSeed = await G.pipeline(C, this.code, 'seed');
    this.rp = await rpipe(PART_WGSL, { blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } });
    this.ub = UB(112); this.pu = UB(80); this.n = 0; this.frame = 0;
    this.ctl = [['n', 'particles', [14, 21, 1, SOFT ? 16 : 18], (v) => 2 ** v, (v) => si(2 ** v)], ['angle', 'cone half-angle (deg)', [2, 80, 1, 24], (v) => v, (v) => v + '°'], ['speed', 'emitter speed', [1, 12, 0.5, 7], (v) => v, (v) => v], ['wind', 'wind speed', [0, 8, 0.5, 1.5], (v) => v, (v) => v], ['grav', 'gravity y', [-20, 0, 0.5, -9.8], (v) => v, (v) => v]];
    this.vals = Object.fromEntries(this.ctl.map(([k, , r]) => [k, r[3]])); this.alloc(2 ** this.vals.n); cam.r = 7.8; cam.target = [0, -0.5, 0]; cam.pitch = 0.2;
    this.pre = Array.from({ length: 90 }, () => UB(80));
  },
  alloc(n) { this.S?.destroy(); this.n = n; this.S = dev.createBuffer({ size: n * 32, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST }); this.reseed = true;
    this.bgS = null; },
  params() { const v = this.vals, P = { ...this.P, n: this.n, cosCone: Math.fround(Math.cos(v.angle * Math.PI / 180)), speed: v.speed, wx: this.P.wx * v.wind / 1.5, wy: 0, wz: this.P.wz * v.wind / 1.5, gy: v.grav, frame: this.frame }; return P; },
  onControl(k, v) { this.vals[k] = v; if (k === 'n' && 2 ** v !== this.n) this.alloc(2 ** v); this.xml(); },
  xml() { const v = this.vals, P = this.P; $('#src').textContent = `<ParticleSystem maxParticles="${this.n}" particleLifetime="${P.lifeMax}" geometryType="POINT">
  <ConeEmitter  position="0 0.2 0" direction="0 1 0" angle="${(v.angle * Math.PI / 180).toFixed(4)}" speed="${v.speed}" variation="0.25"/>
  <ForcePhysicsModel force="0 ${v.grav} 0"/>
  <WindPhysicsModel  direction="1 0 0.3" speed="${v.wind}"/>
  <BoundedPhysicsModel><Box size="40 6 40"/></BoundedPhysicsModel>
</ParticleSystem>
<!-- fixtures/particles-cone-wind.x3d; kernel = particles.wgsl, one thread per particle,
     ${si(this.n)} threads, 8 f32 of state each (${fmt(this.n * 32 / 1048576, 1)} MiB) -->`; },
  frameFn(enc, dt, t) {
    const P = this.params(); P.dt = Math.min(Math.max(dt, 0.004), 0.04); this.frame++; P.frame = this.frame; dev.queue.writeBuffer(this.pu, 0, PR.pack(P));
    this.bgC ??= null; const bg = G.group(C, this.pStep, [this.pu, this.S]);
    if (this.reseed) {   // seed, then pre-roll 90 steps (1.5 s of sim time) so the fountain is already formed
      const sg = G.group(C, this.pSeed, [this.pu, this.S]), p = enc.beginComputePass(); p.setPipeline(this.pSeed); p.setBindGroup(0, sg); p.dispatchWorkgroups(wg(this.n, 64)); p.end();
      for (let i = 0; i < 90; i++) { dev.queue.writeBuffer(this.pre[i], 0, PR.pack({ ...P, dt: 1 / 60, frame: 1000 + i })); const q = enc.beginComputePass(); q.setPipeline(this.pStep); q.setBindGroup(0, G.group(C, this.pStep, [this.pre[i], this.S])); q.dispatchWorkgroups(wg(this.n, 64)); q.end(); }
      this.reseed = false; }
    const p = enc.beginComputePass({ timestampWrites: ts(0, 1) }); p.setPipeline(this.pStep); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(this.n, 64)); p.end(); tsResolve(enc);
    const v = orbit(cam, canvas.width / canvas.height), u = new Float32Array(28); u.set(v.vp, 0); u.set([canvas.width, canvas.height, 0, 0], 16);
    const alpha = 0.55 / Math.sqrt(this.n / 16384); u.set([P.lifeMax, Math.max(1.3, 2.2 - Math.log2(this.n / 16384) * 0.15), alpha, 0], 20); dev.queue.writeBuffer(this.ub, 0, u);
    if (!DBG.has('norender')) { const rg = G.group(C, this.rp, [this.ub, this.S]), r = rpass(enc, { r: 0.012, g: 0.016, b: 0.03, a: 1 }); if (!DBG.has('clearonly')) { r.setPipeline(this.rp); r.setBindGroup(0, rg); r.draw(6, DBG.has('few') ? 1000 : this.n); } r.end(); }
    const gm = gms(); hud([['threads / step', si(this.n)], ['compute (GPU timestamp)', gm == null ? 'n/a' : fmt(gm) + ' ms', 'hot'], ['particles / s', gm == null ? 'n/a' : si(this.n / (gm / 1000))], ['frame (completed)', fmt(state.frameMs || 16.7) + ' ms'], ['state', fmt(this.n * 32 / 1048576, 1) + ' MiB, GPU-resident']]);
  },
  async twin() { const n = 40000, P = { ...this.params(), n, dt: 1 / 60 }, S = new Float32Array(n * 8); PR.seed(P, S); const t0 = performance.now(); for (let i = 0; i < 6; i++) { P.frame = i + 1; PR.step(P, S); } const per = (performance.now() - t0) / 6, full = per * this.n / n; return `JS CPU twin: ${fmt(per)} ms per step for ${si(n)} particles, so ${fmt(full)} ms for ${si(this.n)} on one thread${gms() ? ` (GPU here: ${fmt(gms())} ms, ${fmt(full / gms(), 0)}x)` : ''}. Extrapolated linearly from ${si(n)}.`; },
  dispose() { this.S?.destroy(); this.pre?.forEach((b) => b.destroy()); },
};

/* 2. splats ------------------------------------------------------------------------------------------------------- */
function galaxy(n, seed = 5) {
  let s = seed >>> 0; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }, g = () => (r() + r() + r() + r() - 2) * 0.8165;
  const pos = new Float32Array(n * 4), scl = new Float32Array(n * 4), quat = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const arm = (i % 3) * 2 * Math.PI / 3, rr = Math.pow(r(), 0.8) * 7 + 0.15, th = arm + rr * 0.85 + g() * (0.18 + 0.05 * rr), x = rr * Math.cos(th), z = rr * Math.sin(th), y = g() * 0.12 * (1 + 1.4 / (1 + rr * rr * 0.4));
    pos.set([x, y, z, 0.16 + 0.5 * r()], i * 4); const sz = 0.018 + 0.03 * r() + 0.01 * (rr < 1.2 ? 0.5 : 1); scl.set([sz * 1.9, sz * 0.8, sz, 0], i * 4);
    const yaw = th + Math.PI / 2 + g() * 0.4; quat.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], i * 4);
  }
  return { pos, scl, quat, n };
}
const splats = {
  title: 'GaussianSplats', blurb: 'EWA projection of every splat to a 2D conic, culling, then a bitonic depth sort of (key, index) pairs, all in compute; the draw pass only reads the sorted order. Switch the sort off and the blend order is wrong, which is the whole reason a splat renderer needs a sort.',
  async setup() {
    this.code = await kern('splats'); const mk = (e) => G.pipeline(C, this.code, e);
    [this.pPro, this.pNaive, this.pLS, this.pGl, this.pLM] = await Promise.all([mk('project'), mk('bitonic_naive'), mk('bitonic_local_sort'), mk('bitonic_global'), mk('bitonic_local_merge')]);
    this.rp = await rpipe(SPLAT_WGSL, { blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } });
    this.ub = UB(112); this.cam = UB(96); this.vals = { n: SOFT ? 14 : 17, sort: 1, algo: 'tiled', freeze: 0 };
    this.ctl = [['n', 'splats', [13, 20, 1, SOFT ? 14 : 17], (v) => 2 ** v, (v) => si(2 ** v)]]; this.toggles = [['sort', 'depth sort', ['off', 'on'], 1], ['algo', 'sort kernel', ['naive', 'tiled'], 1], ['freeze', 'freeze sort', ['live', 'frozen'], 0]];
    this.alloc(2 ** this.vals.n);
  },
  alloc(n) { if (this.B) Object.values(this.B).forEach((b) => b.destroy?.()); this.n = n; this.np = SP.nextPow2(n); const cl = galaxy(n);
    this.B = { pos: G.buf(C, cl.pos), scl: G.buf(C, cl.scl), q: G.buf(C, cl.quat), s2d: G.empty(C, n * 32), keys: G.empty(C, this.np * 4), vals: G.empty(C, this.np * 4) };
    this.naive = SP.passes(this.np).map(([j, k]) => this.pg(this.pNaive, j, k)); this.tiled = SP.tiledPlan(this.np).map(([kind, a, b]) => kind === 'local_sort' ? { pipe: this.pLS, bg: this.pg(this.pLS, 0, 0), g: this.np / 512 } : kind === 'global' ? { pipe: this.pGl, bg: this.pg(this.pGl, a, b), g: this.np / 512 } : { pipe: this.pLM, bg: this.pg(this.pLM, 0, a), g: this.np / 512 });
    this.drawn = false; },
  pg(pipe, j, k) { const u = G.buf(C, new Uint32Array([j, k, this.np, 0]), U.UNIFORM); return G.group(C, pipe, [u, this.B?.keys ?? 0, this.B?.vals ?? 0].slice(0, 3), 1); },
  onControl(k, v) { this.vals[k] = v; if (k === 'n' && 2 ** v !== this.n) this.alloc(2 ** v); this.xml(); },
  onToggle(k, i, labels) { this.vals[k] = k === 'algo' ? labels[i] : i; this.xml(); },
  xml() { $('#src').textContent = `<GaussianSplats DEF="Galaxy" positions="x y z ..." scales="sx sy sz ..." orientations="qx qy qz qw ..." opacities="o ..."/>
<!-- ${si(this.n)} splats. positions/scales/orientations/opacities are the field names used by X_ITE's GaussianSplats node
     (read in fixtures/splats-disc.x3d, 2048 splats). kernel = splats.wgsl:
     project   -> 1 thread per splat, EWA conic + radius + cull + key
     sort      -> ${this.vals.algo === 'tiled' ? SP.tiledPlan(this.np).length + ' passes (tiled bitonic: 512-element tiles in workgroup memory)' : SP.passes(this.np).length + ' passes (naive bitonic, one global pass per (k, j))'} for ${si(this.np)} keys
     draw      -> sorted quads, far to near, premultiplied over -->`; },
  frameFn(enc, dt, t) {
    const aspect = canvas.width / canvas.height, v = orbit(cam, aspect), W = canvas.width, H = canvas.height;
    const Cm = { view: v.view, fx: H * 0.9, fy: H * 0.9, w: W, h: H, n: this.n, znear: 0.2 };
    if (!this.vals.freeze || !this.drawn) {
      dev.queue.writeBuffer(this.cam, 0, SP.packCam(Cm));
      const g0 = G.group(C, this.pPro, [this.cam, this.B.pos, this.B.scl, this.B.q, this.B.s2d, this.B.keys, this.B.vals]), plan = this.vals.sort ? (this.vals.algo === 'tiled' ? this.tiled : this.naive) : [], nn = plan.length + 1;
      let p = enc.beginComputePass({ timestampWrites: ts(0, nn) }); p.setPipeline(this.pPro); p.setBindGroup(0, g0); p.dispatchWorkgroups(wg(this.np, 64)); p.end();
      plan.forEach((s, i) => { const pp = this.vals.algo === 'tiled' ? s.pipe : this.pNaive, gx = this.vals.algo === 'tiled' ? s.g : wg(this.np, 256); p = enc.beginComputePass({ timestampWrites: ts(i + 1, nn) }); p.setPipeline(pp); p.setBindGroup(1, this.vals.algo === 'tiled' ? s.bg : s); p.dispatchWorkgroups(this.vals.algo === 'tiled' && pp === this.pGl ? this.np / 2 / 256 : gx); p.end(); });
      tsResolve(enc); this.drawn = true;
    }
    const u = new Float32Array(28); u.set(v.vp, 0); u.set([W, H, 0, 0], 16); u.set([this.np, 1.0, 0, 0], 20); dev.queue.writeBuffer(this.ub, 0, u);
    const rg = G.group(C, this.rp, [this.ub, this.B.s2d, this.B.keys, this.B.vals, this.B.pos]), r = rpass(enc, { r: 0.004, g: 0.005, b: 0.012, a: 1 }); r.setPipeline(this.rp); r.setBindGroup(0, rg); r.draw(6, this.np); r.end();
    const gm = gms(); hud([['splats', si(this.n)], ['project + sort (GPU timestamp)', gm == null ? 'n/a' : fmt(gm) + ' ms', 'hot'], ['sort passes', this.vals.sort ? (this.vals.algo === 'tiled' ? this.tiled.length : this.naive.length) : 0], ['frame (completed)', fmt(state.frameMs || 16.7) + ' ms'], ['view', this.vals.freeze ? 'sort frozen: popping is expected' : 'sort every frame']]);
  },
  async twin() { const n = 20000, cl = SP.cloud(n, 9), Cm = { view: SP.lookAt([0, 3, 9]), fx: 900, fy: 900, w: 1280, h: 720, n, znear: 0.2 }; const t0 = performance.now(); SP.project(Cm, cl.pos, cl.scl, cl.quat, n); const per = performance.now() - t0, full = per * this.n / n;
    const m = 1 << 16, keys = new Uint32Array(m).map((_, i) => (Math.imul(i, 2654435761) >>> 0)), vals = new Uint32Array(m).map((_, i) => i), s0 = performance.now(); SP.sortPairs(keys, vals); const sper = performance.now() - s0;
    return `JS CPU twin: projection ${fmt(per)} ms for ${si(n)} splats (${fmt(full)} ms for ${si(this.n)}); a JS sort of ${si(m)} pairs takes ${fmt(sper)} ms (n log n: about ${fmt(sper * (this.np * Math.log2(this.np)) / (m * 16))} ms for ${si(this.np)}). Extrapolated.`; },
  dispose() { this.B && Object.values(this.B).forEach((b) => b.destroy?.()); },
};

/* 3. NURBS -------------------------------------------------------------------------------------------------------- */
const nurbs = {
  title: 'NurbsPatchSurface', blurb: 'An 8 x 8 rational cubic control net is animated on the CPU (64 points); the GPU re-tessellates the whole surface every frame with analytic normals. The tessellation slider is the X3D uTessellation/vTessellation field: at 1024 x 1024 that is a million lit vertices per frame.',
  async setup() {
    this.code = await kern('nurbs'); this.pT = await G.pipeline(C, this.code, 'tess'); this.rp = await rpipe(MESH_WGSL, { vbuf: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, format: 'float32x4', offset: 0 }] }, { arrayStride: 16, attributes: [{ shaderLocation: 1, format: 'float32x4', offset: 0 }] }], depth: true });
    this.ub = UB(112); this.ctl = [['g', 'grid (n x n)', [4, 10, 1, SOFT ? 7 : 9], (v) => 2 ** v, (v) => `${2 ** v} x ${2 ** v}`], ['amp', 'wave amplitude', [0, 3, 0.1, 1.4], (v) => v, (v) => v]]; this.toggles = [['color', 'colour', ['shaded', 'by normal', 'by (u,v)'], 1]];
    this.vals = { g: SOFT ? 7 : 9, amp: 1.4, color: 1 }; this.dim = 8; this.ku = NU.knotsFor(8, 4); this.ctrlBuf = dev.createBuffer({ size: 64 * 16, usage: U.STORAGE | U.COPY_DST }); this.kbuf = G.buf(C, new Float32Array([...this.ku, ...this.ku])); this.build(2 ** this.vals.g); cam.target = [3.5, 0, 3.5]; cam.r = 11;
  },
  build(g) { this.P?.destroy(); this.N?.destroy(); this.I?.destroy(); this.g = g; this.P = dev.createBuffer({ size: g * g * 16, usage: U.STORAGE | U.VERTEX | U.COPY_SRC }); this.N = dev.createBuffer({ size: g * g * 16, usage: U.STORAGE | U.VERTEX | U.COPY_SRC });
    const idx = new Uint32Array((g - 1) * (g - 1) * 6); let k = 0; for (let j = 0; j < g - 1; j++) for (let i = 0; i < g - 1; i++) { const a = j * g + i; idx.set([a, a + 1, a + g, a + 1, a + g + 1, a + g], k); k += 6; }
    this.I = G.buf(C, idx, U.INDEX); this.ic = idx.length; this.pu = G.buf(C, NU.pack({ nu: g, nv: g, du: 8, dv: 8, pu: 3, pv: 3, ku: this.ku, kv: this.ku, ctrl: [] }).uniform, U.UNIFORM); },
  onControl(k, v) { this.vals[k] = v; if (k === 'g' && 2 ** v !== this.g) this.build(2 ** v); this.xml(); },
  onToggle(k, i) { this.vals[k] = i; },
  xml() { const g = this.g; $('#src').textContent = `<NurbsPatchSurface uDimension="8" vDimension="8" uOrder="4" vOrder="4"
    uTessellation="${g - 1}" vTessellation="${g - 1}" weight="1.0 0.8 ... (64 rational weights)">
  <Coordinate containerField="controlPoint" point="x y z, ... (64 points, animated)"/>
</NurbsPatchSurface>
<!-- fixtures/nurbs-patches.x3d has five such patches. kernel = nurbs.wgsl: one thread per grid vertex,
     A2.1 span search + A2.2 basis + derivative basis + rational quotient rule, ${si(g * g)} vertices per frame -->`; },
  frameFn(enc, dt, t) {
    const d = 8, cp = new Float32Array(64 * 4), a = this.vals.amp; for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) { const o = (j * d + i) * 4; cp[o] = i; cp[o + 2] = j; cp[o + 1] = a * (Math.sin(i * 0.9 + t * 1.3) * Math.cos(j * 0.7 - t * 0.9) + 0.4 * Math.sin((i + j) * 0.5 + t)); cp[o + 3] = 1 + 0.45 * Math.sin(i * 1.7 + j * 0.8 + t * 0.7); }
    dev.queue.writeBuffer(this.ctrlBuf, 0, cp); const bg = G.group(C, this.pT, [this.pu, this.ctrlBuf, this.kbuf, this.P, this.N]);
    const p = enc.beginComputePass({ timestampWrites: ts(0, 1) }); p.setPipeline(this.pT); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg(this.g, 8), wg(this.g, 8)); p.end(); tsResolve(enc);
    const v = orbit(cam, canvas.width / canvas.height), u = new Float32Array(28); u.set(v.vp, 0); u.set([...v.eye, 0], 16); u.set([this.g, this.g, 0, 0], 20); u.set([this.vals.color, 0, 0, 0], 24); dev.queue.writeBuffer(this.ub, 0, u);
    const rg = G.group(C, this.rp, [this.ub]), r = rpass(enc, { r: 0.02, g: 0.025, b: 0.045, a: 1 }, true); r.setPipeline(this.rp); r.setBindGroup(0, rg); r.setVertexBuffer(0, this.P); r.setVertexBuffer(1, this.N); r.setIndexBuffer(this.I, 'uint32'); r.drawIndexed(this.ic); r.end();
    const gm = gms(); hud([['grid vertices / frame', si(this.g * this.g)], ['tessellate (GPU timestamp)', gm == null ? 'n/a' : fmt(gm) + ' ms', 'hot'], ['vertices / s', gm == null ? 'n/a' : si(this.g * this.g / (gm / 1000))], ['frame (completed)', fmt(state.frameMs || 16.7) + ' ms'], ['triangles drawn', si(this.ic / 3)]]);
  },
  async twin() { const g = 48, S = { ...NU.bench(8, g), pu: 3, pv: 3 }, t0 = performance.now(); NU.tessellate(S); const per = performance.now() - t0, full = per * (this.g * this.g) / (g * g); return `JS CPU twin (recursive Cox-de Boor, f64): ${fmt(per)} ms for ${si(g * g)} vertices, so about ${fmt(full)} ms for ${si(this.g * this.g)}${gms() ? ` (GPU here: ${fmt(gms())} ms)` : ''}. The twin is a different algorithm on purpose: it is the check, not a speed contender.`; },
  dispose() { [this.P, this.N, this.I, this.ctrlBuf, this.kbuf].forEach((b) => b?.destroy()); cam.target = [0, 0.6, 0]; cam.r = 9; },
};

/* 4. skinning ----------------------------------------------------------------------------------------------------- */
const skin = {
  title: 'HAnimHumanoid skinning', blurb: 'A 24-joint HAnimJoint chain drives a skinned mesh: joint matrices are built on the CPU each frame (24 of them), the GPU blends every vertex from its four influences and writes positions and normals straight into the buffers the draw call reads.',
  async setup() {
    this.code = await kern('skinning'); this.pK = await G.pipeline(C, this.code, 'skin'); this.rp = await rpipe(MESH_WGSL, { vbuf: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, format: 'float32x4', offset: 0 }] }, { arrayStride: 16, attributes: [{ shaderLocation: 1, format: 'float32x4', offset: 0 }] }], depth: true });
    this.ub = UB(112); this.ctl = [['n', 'skin vertices', [12, 20, 1, SOFT ? 14 : 17], (v) => 2 ** v, (v) => si(2 ** v)], ['wave', 'wave amplitude (rad)', [0, 1, 0.05, 0.2], (v) => v, (v) => v]]; this.toggles = [['color', 'colour', ['shaded', 'by normal', 'by (u,v)'], 2]];
    this.vals = { n: SOFT ? 14 : 17, wave: 0.2, color: 2 }; this.alloc(2 ** this.vals.n); cam.target = [0, 11, 0]; cam.r = 27; cam.pitch = 0.08;
  },
  alloc(nv) { this.bufs?.forEach((b) => b.destroy()); const T = SK.tube(nv, 24), rings = T.nv / 16; this.T = T; this.nv = T.nv;
    for (let v = 0; v < T.nv; v++) { const y = T.rest[v * 4 + 1], u = y / 24, rad = 0.42 + 0.9 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 1.4) * (0.6 + 0.4 * Math.cos(u * 40)) + 0.05; T.rest[v * 4] *= rad / 0.4; T.rest[v * 4 + 2] *= rad / 0.4; }
    this.b = { rest: G.buf(C, T.rest), nrm: G.buf(C, T.nrm), idx: G.buf(C, T.idx), w: G.buf(C, T.w), M: dev.createBuffer({ size: 25 * 64, usage: U.STORAGE | U.COPY_DST }), P: dev.createBuffer({ size: T.nv * 16, usage: U.STORAGE | U.VERTEX | U.COPY_SRC }), N: dev.createBuffer({ size: T.nv * 16, usage: U.STORAGE | U.VERTEX | U.COPY_SRC }), u: G.buf(C, new Uint32Array([T.nv, 0, 0, 0]), U.UNIFORM) };
    const ix = new Uint32Array((rings - 1) * 16 * 6); let k = 0; for (let r = 0; r < rings - 1; r++) for (let a = 0; a < 16; a++) { const v = r * 16 + a, w = r * 16 + (a + 1) % 16; ix.set([v, w, v + 16, w, w + 16, v + 16], k); k += 6; }
    this.I = G.buf(C, ix, U.INDEX); this.ic = ix.length; this.rings = rings; this.bufs = [...Object.values(this.b), this.I]; this.bg = G.group(C, this.pK, [this.b.u, this.b.rest, this.b.nrm, this.b.idx, this.b.w, this.b.M, this.b.P, this.b.N]); },
  onControl(k, v) { this.vals[k] = v; if (k === 'n' && 2 ** v !== this.nv) this.alloc(2 ** v); this.xml(); },
  onToggle(k, i) { this.vals[k] = i; },
  xml() { $('#src').textContent = `<HAnimHumanoid name="chain">
  <HAnimJoint name="humanoid_root" skinCoordIndex="0 1 2 ..." skinCoordWeight="1 1 .5 ...">
    <HAnimJoint name="vl5" translation="0 1 0" rotation="0 0 1 a" skinCoordIndex="..." skinCoordWeight="...">
      ... 24 joints, each translation="0 1 0"
  <Coordinate containerField="skinCoord" point="${si(this.nv)} vertices"/>
</HAnimHumanoid>
<!-- fixtures/hanim-chain.x3d (3 joints, 144 vertices). kernel = skinning.wgsl, one thread per vertex:
     p' = sum_k w_k * M[j_k] * p, with M = world(pose) * inverse(world(rest)), 4 influences -->`; },
  frameFn(enc, dt, t) {
    const pose = {}, a = this.vals.wave; for (let j = 1; j < 24; j++) pose[j] = [Math.sin(j * 0.3) * 0.5 + 0.5, 0.2, Math.cos(j * 0.3) * 0.5 + 0.7, a * Math.sin(t * 2 - j * 0.45)];
    dev.queue.writeBuffer(this.b.M, 0, SK.skinMatrices(this.T.joints, pose));
    const p = enc.beginComputePass({ timestampWrites: ts(0, 1) }); p.setPipeline(this.pK); p.setBindGroup(0, this.bg); p.dispatchWorkgroups(wg(this.nv, 64)); p.end(); tsResolve(enc);
    const v = orbit(cam, canvas.width / canvas.height), u = new Float32Array(28); u.set(v.vp, 0); u.set([...v.eye, 0], 16); u.set([16, this.rings, 0, 0], 20); u.set([this.vals.color, 0, 0, 0], 24); dev.queue.writeBuffer(this.ub, 0, u);
    const rg = G.group(C, this.rp, [this.ub]), r = rpass(enc, { r: 0.02, g: 0.025, b: 0.045, a: 1 }, true); r.setPipeline(this.rp); r.setBindGroup(0, rg); r.setVertexBuffer(0, this.b.P); r.setVertexBuffer(1, this.b.N); r.setIndexBuffer(this.I, 'uint32'); r.drawIndexed(this.ic); r.end();
    const gm = gms(); hud([['skinned vertices / frame', si(this.nv)], ['skin (GPU timestamp)', gm == null ? 'n/a' : fmt(gm) + ' ms', 'hot'], ['vertices / s', gm == null ? 'n/a' : si(this.nv / (gm / 1000))], ['frame (completed)', fmt(state.frameMs || 16.7) + ' ms'], ['joints', '24, 4 influences / vertex']]);
  },
  async twin() { const n = 60000, T = SK.tube(n, 24), pose = {}; for (let j = 1; j < 24; j++) pose[j] = [0, 0, 1, 0.3]; const M = SK.skinMatrices(T.joints, pose), t0 = performance.now(); SK.skinCPU(T.rest, T.nrm, T.idx, T.w, M, T.nv); const per = performance.now() - t0, full = per * this.nv / T.nv; return `JS CPU twin: ${fmt(per)} ms for ${si(T.nv)} vertices, about ${fmt(full)} ms for ${si(this.nv)} on one thread${gms() ? ` (GPU here: ${fmt(gms())} ms)` : ''}. Extrapolated linearly.`; },
  dispose() { this.bufs?.forEach((b) => b.destroy()); cam.target = [0, 0.6, 0]; cam.r = 9; cam.pitch = 0.35; },
};

/* 5. volume ------------------------------------------------------------------------------------------------------- */
function gyroidVolume(d) {
  const v = new Uint8Array(d * d * d), tw = 2 * Math.PI * 2.2;
  for (let z = 0; z < d; z++) for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const X = (x + 0.5) / d - 0.5, Y = (y + 0.5) / d - 0.5, Z = (z + 0.5) / d - 0.5, r = Math.hypot(X, Y, Z);
    const gy = Math.sin(tw * X) * Math.cos(tw * Y) + Math.sin(tw * Y) * Math.cos(tw * Z) + Math.sin(tw * Z) * Math.cos(tw * X);
    const sheet = Math.exp(-Math.pow((gy - 0.0) / 0.42, 2)), env = Math.max(0, Math.min(1, (0.47 - r) / 0.06)), cut = (X > 0.02 && Z > 0.02) ? 0 : 1, core = Math.exp(-Math.pow(r / 0.11, 2));
    v[(z * d + y) * d + x] = Math.min(255, Math.round(255 * Math.max(sheet * env * (0.35 + 0.65 * Math.min(1, r / 0.4)) * cut, core * 0.95)));
  }
  return v;
}
const volume = {
  title: 'VolumeData', blurb: 'One thread per pixel marches a ray through a 128 x 128 x 128 volume (a gyroid shell cut open, with a bright core). Opacity-map compositing or MIP; steps and image size are sliders. Drag to turn it: the kernel is orthographic and yaw-only, which is a logged limit.',
  async setup() {
    this.code = await kern('volume'); this.pM = await G.pipeline(C, this.code, 'march'); this.rp = await rpipe(VOL_WGSL); this.dim = 128; this.vox = gyroidVolume(128);
    this.tex = dev.createTexture({ size: [128, 128, 128], dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); dev.queue.writeTexture({ texture: this.tex }, this.vox, { bytesPerRow: 128, rowsPerImage: 128 }, [128, 128, 128]);
    this.ctl = [['res', 'image (n x n)', [7, 11, 1, SOFT ? 8 : 9], (v) => 2 ** v, (v) => `${2 ** v} x ${2 ** v}`], ['steps', 'steps per ray', [16, 512, 16, SOFT ? 96 : 160], (v) => v, (v) => v]]; this.toggles = [['style', 'style', ['OpacityMap', 'MIP'], 0], ['turn', 'turntable', ['off', 'on'], 1]];
    this.vals = { res: SOFT ? 8 : 9, steps: SOFT ? 96 : 160, style: 0, turn: 1 }; this.ub = UB(64); this.vu = UB(16); this.yaw = 0.6; this.alloc(2 ** this.vals.res); cam.auto = false; this.autoWas = cam.auto;
  },
  alloc(r) { this.img?.destroy(); this.r = r; this.img = dev.createBuffer({ size: r * r * 4, usage: U.STORAGE | U.COPY_SRC }); },
  onControl(k, v) { this.vals[k] = v; if (k === 'res' && 2 ** v !== this.r) this.alloc(2 ** v); this.xml(); },
  onToggle(k, i) { this.vals[k] = i; this.xml(); },
  xml() { $('#src').textContent = `<VolumeData dimensions="1 1 1">
  ${this.vals.style ? '<ProjectionVolumeStyle containerField="renderStyle" type="MAX"/>' : '<OpacityMapVolumeStyle containerField="renderStyle"/>'}
  <PixelTexture3D containerField="voxels" image="128 128 128 1 ..."/>
</VolumeData>
<!-- fixtures/volume-opacity.x3d and volume-mip.x3d (8 x 8 x 8). kernel = volume.wgsl, one thread per pixel:
     ${si(this.r * this.r)} rays x up to ${this.vals.steps} steps = up to ${si(this.r * this.r * this.vals.steps)} voxel reads per frame -->`; },
  frameFn(enc, dt, t) {
    this.yaw += this.vals.turn ? dt * 0.5 : 0; this.yaw += this.drag || 0; this.drag = 0; const yaw = this.yaw % (2 * Math.PI) || 0.6;
    const P = { w: this.r, h: this.r, dim: this.dim, steps: this.vals.steps, style: this.vals.style, yaw: Math.abs(yaw) < 1e-3 ? 1e-3 : yaw, thr: 0.18, gain: 5, stepAlpha: Math.min(1, 24 / this.vals.steps) * 0.5 };
    dev.queue.writeBuffer(this.ub, 0, VO.pack(P)); const g = G.group(C, this.pM, [this.ub, this.tex, this.img]);
    const p = enc.beginComputePass({ timestampWrites: ts(0, 1) }); p.setPipeline(this.pM); p.setBindGroup(0, g); p.dispatchWorkgroups(wg(this.r, 8), wg(this.r, 8)); p.end(); tsResolve(enc);
    dev.queue.writeBuffer(this.vu, 0, new Float32Array([canvas.width, canvas.height, this.r, this.r]));
    const rg = G.group(C, this.rp, [this.vu, this.img]), r = rpass(enc, { r: 0, g: 0, b: 0, a: 1 }); r.setPipeline(this.rp); r.setBindGroup(0, rg); r.draw(3); r.end();
    const gm = gms(); hud([['rays / frame', si(this.r * this.r)], ['march (GPU timestamp)', gm == null ? 'n/a' : fmt(gm) + ' ms', 'hot'], ['rays / s', gm == null ? 'n/a' : si(this.r * this.r / (gm / 1000))], ['frame (completed)', fmt(state.frameMs || 16.7) + ' ms'], ['sampling', 'nearest voxel, ortho, yaw only']]);
  },
  async twin() { const w = 64, P = { w, h: w, dim: 128, steps: this.vals.steps, style: this.vals.style, yaw: 0.6, thr: 0.18, gain: 5, stepAlpha: Math.min(1, 24 / this.vals.steps) * 0.5 }, t0 = performance.now(); VO.cast(P, this.vox); const per = performance.now() - t0, full = per * (this.r * this.r) / (w * w); return `JS CPU twin: ${fmt(per)} ms for ${si(w * w)} rays, so about ${fmt(full)} ms for ${si(this.r * this.r)}${gms() ? ` (GPU here: ${fmt(gms())} ms)` : ''}. Extrapolated by ray count.`; },
  dispose() { this.img?.destroy(); this.tex?.destroy(); },
};

state.scenes = { particles, splats, nurbs, skin, volume };

/* ---- UI ---- */
function buildControls(sc) {
  const box = $('#ctl'); box.innerHTML = '';
  (sc.ctl || []).forEach(([k, label, [lo, hi, step, def], map, show]) => {
    const d = document.createElement('label'); d.innerHTML = `<span>${label}</span><output></output><input type="range" min="${lo}" max="${hi}" step="${step}" value="${sc.vals[k]}">`;
    const inp = d.querySelector('input'), out = d.querySelector('output'); const upd = () => { out.textContent = show(+inp.value); }; inp.oninput = () => { upd(); sc.onControl(k, +inp.value); }; upd(); box.appendChild(d);
  });
  (sc.toggles || []).forEach(([k, label, opts]) => {
    const d = document.createElement('div'); d.className = 'seg'; d.innerHTML = `<span>${label}</span>` + opts.map((o, i) => `<button data-i="${i}" class="${(sc.vals[k] === o || sc.vals[k] === i) ? 'on' : ''}">${o}</button>`).join('');
    d.querySelectorAll('button').forEach((b) => b.onclick = () => { d.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); sc.onToggle(k, +b.dataset.i, opts); }); box.appendChild(d);
  });
}
async function select(name) {
  if (state.scene) { state.scene.dispose?.(); }
  state.name = name; cam.auto = name !== 'volume'; Object.assign(cam, { yaw: 0.6, pitch: 0.35, r: 9, target: [0, 0.6, 0] }); const sc = state.scenes[name]; state.scene = null; $('#title').textContent = sc.title; $('#blurb').textContent = sc.blurb; $('#twin').textContent = ''; $('#src').textContent = 'loading...';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === name)); Tm.ms = null;
  try { await sc.setup(); } catch (e) { $('#src').textContent = 'setup failed: ' + e.message; console.error(e); return; }
  sc.xml(); buildControls(sc); state.scene = sc; history.replaceState(null, '', '#' + name);
}
async function gate(quick) {
  const out = $('#gate'); out.textContent = 'running the repo correctness gate on this adapter...';
  try {
    const mod = await import('./compute/bench/page.js'); const t0 = performance.now(), res = await window.X3DGPU.runAll({ quick: true, noBench: !quick }); const dt = (performance.now() - t0) / 1000;
    window.lastReceipt = res; const rows = Object.entries(res.suites).map(([k, v]) => `<tr><td>${k}</td><td class="${v.error ? 'bad' : v.correctness.pass ? 'ok' : 'bad'}">${v.error ? 'ERROR' : v.correctness.pass ? 'PASS' : 'FAIL'}</td><td>${v.error ? v.error.slice(0, 80) : summary(k, v)}</td></tr>`).join('');
    out.innerHTML = `<table><tr><th>suite</th><th>gate</th><th>what was compared (this GPU vs the CPU twin)</th></tr>${rows}</table><p class="mut">adapter: ${res.rig.adapter.vendor || '?'} ${res.rig.adapter.architecture || ''} ${res.rig.adapter.description || ''}; timestamp-query ${res.rig.has_timestamp_query ? 'yes' : 'no'}; ${fmt(dt, 1)} s. <button id="dl">download receipt JSON</button></p>`;
    $('#dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(res, null, 1)], { type: 'application/json' })); a.download = 'x3d-compute-receipt-this-gpu.json'; a.click(); };
    if (quick) benchTable(res);
  } catch (e) { out.textContent = 'gate failed to run: ' + e.message; console.error(e); }
}
function summary(k, v) {
  const c = v.correctness;
  if (k === 'particles') return c.cases.map((x) => `${x.label}: ${si(x.particles)} particles x ${x.steps} steps, max abs diff ${x.max_abs}, ${x.particles_off_by_more_than_1e_2} off by more than 0.01`).join('; ');
  if (k === 'skinning') return `hand-worked chain: max err ${c.hand_checked_chain.max_abs_err}; ${c.vertices} verts: max ${c.fixture_pos.max_abs}; 65,536-vertex tube, 24 joints: max ${c.tube_65536_24_joints.pos.max_abs}`;
  if (k === 'volume') return `${c.cases.length} cases (fixtures, procedural, 4 yaws on a ramp), worst mean |d| ${Math.max(...c.cases.map((x) => x.mean_abs_diff_of_255))}/255`;
  if (k === 'nurbs') return `${c.cases.length} patches, worst position diff ${Math.max(...c.cases.map((x) => x.pos_max_abs))}, worst normal diff ${Math.max(...c.cases.map((x) => x.nrm_max_abs))}`;
  if (k === 'splats') return `${c.splats} splats: projection max rel diff ${c.projection.max_rel}, edge-case cloud culls ${c.projection_edge_cases.culled_by_reason.behind_near_plane} behind / ${c.projection_edge_cases.culled_by_reason.off_screen} off screen; sort exact (naive ${c.sort[0].positions_wrong_vs_cpu_sort_of_gpu_keys}, tiled ${c.sort[1].positions_wrong_vs_cpu_sort_of_gpu_keys} wrong positions)`;
}
let REF = null;
async function benchTable(res) {
  REF ??= await (await fetch('./compute/receipts/full-swiftshader.json')).json(); const rows = [];
  const m = (b) => (b.gpu_ms ? b.gpu_ms.median : b.wall_ms.median);
  const add = (name, mine, ref, unit) => rows.push(`<tr><td>${name}</td><td>${mine == null ? '-' : fmt(mine)}</td><td>${ref == null ? '-' : fmt(ref)}</td><td>${unit}</td></tr>`);
  const pick = (s, f) => res.suites[s]?.bench?.find(f), rpick = (s, f) => REF.suites[s].bench.find(f);
  add('particles 262,144', pick('particles', (b) => b.particles === 262144) && m(pick('particles', (b) => b.particles === 262144)), m(rpick('particles', (b) => b.particles === 262144)), 'ms / step');
  add('skinning 262,144 vertices', pick('skinning', (b) => b.vertices === 262144) && m(pick('skinning', (b) => b.vertices === 262144)), m(rpick('skinning', (b) => b.vertices === 262144)), 'ms');
  add('volume 64^3, 256 px, opacity', pick('volume', (b) => b.volume === '64^3' && b.style === 'opacity') && m(pick('volume', (b) => b.volume === '64^3' && b.style === 'opacity')), m(rpick('volume', (b) => b.volume === '64^3' && b.style === 'opacity')), 'ms');
  add('nurbs 512 x 512', pick('nurbs', (b) => b.grid === '512x512') && m(pick('nurbs', (b) => b.grid === '512x512')), m(rpick('nurbs', (b) => b.grid === '512x512')), 'ms');
  const sp = pick('splats', (b) => b.splats === 262144), rs = rpick('splats', (b) => b.splats === 262144);
  add('splats 262,144: project', sp && m(sp.project), m(rs.project), 'ms'); add('splats 262,144: sort, naive (derived)', sp && sp.sort_ms_naive_derived, rs.sort_ms_naive_derived, 'ms'); add('splats 262,144: sort, tiled (derived)', sp && sp.sort_ms_tiled_derived, rs.sort_ms_tiled_derived, 'ms');
  $('#bench').innerHTML = `<table><tr><th>workload</th><th>this GPU</th><th>SwiftShader 4 cores</th><th>unit</th></tr>${rows.join('')}</table><p class="mut">Second column: ${REF.rig.chromium} on ${REF.rig.cpus}, adapter ${REF.rig.adapter.architecture}, recorded in receipts/full-swiftshader.json. Both columns are GPU-timestamp medians of the same harness.</p>`;
}

async function main() {
  if (!navigator.gpu) { $('#nogpu').hidden = false; $('#app').hidden = true; return; }
  try { await boot(); } catch (e) { $('#nogpu').hidden = false; $('#nogpu').querySelector('p').textContent = 'WebGPU is present but no adapter was given: ' + e.message; $('#app').hidden = true; return; }
  $('#adapter').textContent = `${C.info.vendor || ''} ${C.info.architecture || ''} ${C.info.description || ''}`.trim() + (C.hasTS ? ', timestamp-query on' : ', no timestamp-query (GPU ms shown as n/a)');
  $('#tabs').innerHTML = Object.entries(state.scenes).map(([k, s]) => `<button data-k="${k}">${s.title}</button>`).join(''); $('#tabs').onclick = (e) => { const k = e.target.dataset?.k; if (k && k !== state.name) select(k); };
  $('#twinbtn').onclick = async () => { $('#twin').textContent = 'running...'; $('#twin').textContent = await state.scene.twin(); };
  $('#gatebtn').onclick = () => gate(false); $('#benchbtn').onclick = () => gate(true);
  canvas.addEventListener('pointerdown', (e) => { state.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); cam.auto = false; });
  canvas.addEventListener('pointermove', (e) => { if (!state.drag) return; const dx = e.clientX - state.drag.x, dy = e.clientY - state.drag.y; state.drag = { x: e.clientX, y: e.clientY }; if (state.name === 'volume') state.scene.drag = (state.scene.drag || 0) + dx * 0.01; else { cam.yaw -= dx * 0.008; cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + dy * 0.008)); } });
  canvas.addEventListener('pointerup', () => { state.drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.r = Math.max(2, Math.min(80, cam.r * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  const h0 = location.hash.slice(1); await select(h0 in state.scenes ? h0 : 'particles');
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h in state.scenes && h !== state.name) select(h); });
  let inflight = false;
  const tick = (now) => {
    requestAnimationFrame(tick); if (inflight) return; const dt = Math.min(0.1, (now - state.last) / 1000 || 0.016); state.last = now; 
    if (!state.scene || !dev) return; sizeCanvas(); if (cam.auto) cam.yaw += dt * 0.15;
    const enc = dev.createCommandEncoder(); try { state.scene.frameFn(enc, dt, now / 1000); window.__x3d.enc++; } catch (e) { window.__x3d.err = String(e.stack); console.error(e); return; } dev.queue.submit([enc.finish()]); tsAfter(); inflight = true;
    dev.queue.onSubmittedWorkDone().then(() => { inflight = false; window.__x3d.done++; const t = performance.now(); if (state.lastDone) { const d = t - state.lastDone; state.frameMs = state.frameMs ? state.frameMs * 0.85 + d * 0.15 : d; } state.lastDone = t; });
  };
  requestAnimationFrame(tick);
}
main();
