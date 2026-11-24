/* Gobbler Swarm, WebGL2 backend: the fallback for browsers that refuse WebGPU (Chrome blocklists Intel UHD 620 on D3D11).
   The state machine runs on the CPU with model.js (the same integer code the WGSL compute twin mirrors), the counters are
   rebuilt on the CPU, and the vertex shaders below are line-for-line GLSL ES 3.00 ports of gpu.js DRAW_WGSL. Same bloom chain. */
(() => {
  'use strict';
  const M = window.GobblerSwarmModel;
  const HEAD = `#version 300 es
precision highp float; precision highp int;
uniform mat4 uVP, uWorld; uniform vec4 uEye, uA, uB, uC, uD;
uniform mat4 uKin[10]; uniform vec4 uRing[40]; uniform vec4 uLut[32]; uniform float uLoopTot[10];
uniform highp sampler2D uHist; uniform float uSpark;
out vec2 vUV; out vec3 vCol; out vec2 vKind;
const float TAU = 6.2831853; const float PI = 3.14159265;
float hashf(uint x) { uint h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return float(h) / 4294967296.0; }
vec2 corner(int vi) { vec2 c[6] = vec2[6](vec2(-1., -1.), vec2(1., -1.), vec2(1., 1.), vec2(-1., -1.), vec2(1., 1.), vec2(-1., 1.)); return c[vi]; }
vec3 ringLocal(int l, float fr, float dr, float dn) {
  vec4 c = uRing[l * 4], n = uRing[l * 4 + 1], u = uRing[l * 4 + 2], v = uRing[l * 4 + 3]; float th = fr * TAU;
  return c.xyz + (c.w + dr) * (cos(th) * u.xyz + sin(th) * v.xyz) + dn * n.xyz;
}
vec3 toWorld(int l, vec3 p) { return (uWorld * (uKin[l] * vec4(p, 1.0))).xyz; }
vec3 coreWorld() { return (uWorld * vec4(uRing[0].xyz, 1.0)).xyz; }
void culled() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); vCol = vec3(0.0); vKind = vec2(0.0); }
void bill(vec3 p, vec3 dir, float size, vec2 q, vec3 col, float kind) {
  vec3 vd = normalize(p - uEye.xyz);
  vec3 tl = dir - vd * dot(dir, vd); float L = length(tl);
  vec3 along = normalize(cross(vd, vec3(0.0, 1.0, 0.0001)));
  if (L > size * 0.05) along = tl / L;
  vec3 side = normalize(cross(along, vd));
  float tail = min(L, 0.9);
  float y = (q.y * 0.5 + 0.5) * (tail + 2.0 * size) - tail - size;
  gl_Position = uVP * vec4(p + side * q.x * size + along * y, 1.0);
  vUV = q; vCol = col; vKind = vec2(kind, tail / (tail + 2.0 * size));
}
int stageOf(float fr) { if (fr < .06) return 0; if (fr < .20) return 1; if (fr < .40) return 2; if (fr < .54) return 3; if (fr < .62) return 5; if (fr < .80) return 7; return 8; }
vec3 lane(uint i) { return vec3(hashf(i * 4u + 1u) + hashf(i * 4u + 2u) - 1.0, hashf(i * 4u + 3u) - 0.5, hashf(i * 4u + 4u) - 0.5); }
`;
  const VS = {
    agent: `layout(location = 0) in uvec4 aState;
void main() {
  uint i = uint(gl_InstanceID); uvec4 a = aState; uint m = a.x; int l = int(m & 15u); int st = int((m >> 4u) & 15u);
  float f = clamp((float(a.y) + uA.y) / max(1.0, float(a.z)), 0.0, 1.0);
  vec2 sec = uLut[11 + st].xy; vec3 ln = lane(i); float R = uRing[l * 4].w;
  float dr = ln.x * 0.10, dn = ln.y * 0.08, jit = ln.z * 0.010;
  float dim = (uB.x >= 0.0 && float(l) != uB.x) ? 0.10 : 1.0;
  vec2 q = corner(gl_VertexID % 6);
  if (uSpark > 0.5) {
    if ((int(uC.x) & 2) == 0) { culled(); return; }
    bool committed = ((m >> 13u) & 1u) == 1u;
    if (st != 8 || !committed || f > 0.62) { culled(); return; }
    float e = smoothstep(0.0, 1.0, f / 0.62);
    vec3 start = toWorld(l, ringLocal(l, 0.80 + jit, dr, dn)), core = coreWorld();
    vec3 nw = normalize((uWorld * (uKin[l] * vec4(uRing[l * 4 + 1].xyz, 0.0))).xyz);
    vec3 p = mix(start, core, e * e) + nw * (0.9 + ln.z) * sin(PI * e) * 0.6;
    float e2 = min(1.0, e + 0.08);
    vec3 p2 = mix(start, core, e2 * e2) + nw * (0.9 + ln.z) * sin(PI * e2) * 0.6;
    bill(p, p - p2, uA.z * 1.6, q, vec3(1.0, 0.86, 0.58) * (0.9 * (1.0 - e * e * e * e)) * dim, 0.0); return;
  }
  if ((int(uC.x) & 1) == 0) { culled(); return; }
  float fr = sec.x + (sec.y - sec.x) * f + jit;
  if (st == 6) { float e = smoothstep(0.0, 0.25, f) * (1.0 - smoothstep(0.85, 1.0, f)); dn += (0.55 + 0.35 * ln.x) * e + 0.04 * sin(uA.x * 3.0 + ln.y * 40.0) * e; }
  if (st == 10) dr -= R * 0.72 * sin(PI * f);
  vec3 p = toWorld(l, ringLocal(l, fr, dr, dn));
  float speed = (sec.y - sec.x) / max(1.0, float(a.z));
  vec3 p2 = toWorld(l, ringLocal(l, fr - speed * 7.0, dr, dn));
  vec4 s = uLut[st]; float inten = s.w;
  if (st == 8 && ((m >> 13u) & 1u) == 1u && f < 0.12) inten *= 1.0 + 5.0 * (1.0 - f / 0.12);
  if (st == 4) inten *= 1.3 + 0.7 * sin(uA.x * 18.0 + ln.x * 9.0);
  float size = uA.z; vec3 col = s.rgb * inten * dim * uD.w;
  if (float(i) == uB.y) { size *= 7.0; col = vec3(4.0, 3.6, 3.0); }
  bill(p, p - p2, size, q, col, 0.0);
}`,
    spec: `void main() {
  if ((int(uC.x) & 4) == 0) { culled(); return; }
  int ii = gl_InstanceID, l = ii / 64, b = ii % 64;
  float c = texelFetch(uHist, ivec2(b, l), 0).r, tot = uLoopTot[l], R = uRing[l * 4].w, fr = (float(b) + 0.5) / 64.0;
  float v = clamp(log2(1.0 + c) / log2(2.0 + tot * 0.06), 0.0, 1.35);
  float h = (0.02 + 0.20 * v) * uB.z;
  vec3 p0 = toWorld(l, ringLocal(l, fr, 0.15, 0.0)), p1 = toWorld(l, ringLocal(l, fr, 0.15 + h, 0.0));
  float w = TAU * R / 64.0 * 0.16; vec2 q = corner(gl_VertexID % 6);
  vec3 vd = normalize(p0 - uEye.xyz), side = normalize(cross(p1 - p0, vd));
  float dim = (uB.x >= 0.0 && float(l) != uB.x) ? 0.12 : 1.0;
  gl_Position = uVP * vec4(mix(p0, p1, q.y * 0.5 + 0.5) + side * q.x * w, 1.0);
  vUV = q; vCol = uLut[stageOf(fr)].rgb * (0.05 + 0.30 * v * v) * dim; vKind = vec2(1.0, 0.0);
}`,
    core: `void main() {
  if ((int(uC.x) & 8) == 0) { culled(); return; }
  int ii = gl_InstanceID; float g = uB.w, t = uA.x; vec3 p = coreWorld(); vec2 q = corner(gl_VertexID % 6);
  float size; vec3 col; float kind = 0.0;
  if (ii == 0) { size = 1.6 + 0.8 * g; col = vec3(1.0, 0.62, 0.25) * (0.05 + 0.10 * g); }
  else if (ii == 1) { size = 0.55 + 0.25 * g; col = vec3(1.0, 0.80, 0.45) * (0.25 + 0.5 * g); }
  else if (ii == 2) { size = 0.20 + 0.10 * g; col = vec3(1.0, 0.95, 0.85) * (2.0 + 3.0 * g); }
  else { float ph = fract(t * 0.35 + float(ii) * 0.5); size = 0.5 + 3.0 * ph; col = vec3(1.0, 0.78, 0.45) * (1.0 - ph) * (1.0 - ph) * (0.06 + 0.16 * g); kind = 2.0; }
  vec3 vd = normalize(p - uEye.xyz), side = normalize(cross(vec3(0.0, 1.0, 0.0001), vd)), up = cross(vd, side);
  gl_Position = uVP * vec4(p + (side * q.x + up * q.y) * size, 1.0); vUV = q; vCol = col; vKind = vec2(kind, 0.0);
}`,
    hoop: `void main() {
  if ((int(uC.x) & 16) == 0) { culled(); return; }
  int ii = gl_InstanceID, l = ii / 257, s = ii % 257; vec2 q = corner(gl_VertexID % 6);
  vec3 p0, p1; float w = 0.012; vec3 col = uLut[22 + l].rgb * 0.30;
  if (s == 256) { vec4 c = uRing[l * 4], u = uRing[l * 4 + 2]; p0 = toWorld(l, c.xyz - c.w * u.xyz); p1 = toWorld(l, c.xyz + c.w * u.xyz); w = 0.010; col *= 0.55; }
  else {
    float f0 = float(s) / 256.0, f1 = float(s + 1) / 256.0;
    p0 = toWorld(l, ringLocal(l, f0, 0.0, 0.0)); p1 = toWorld(l, ringLocal(l, f1, 0.0, 0.0));
    float pulse = 0.5 + 0.5 * sin(f0 * TAU * 3.0 - uA.x * 1.3 + float(l)); col *= 0.55 + 0.6 * pulse * pulse;
  }
  if (uB.x >= 0.0 && float(l) != uB.x) col *= 0.25;
  vec3 vd = normalize(p0 - uEye.xyz), side = normalize(cross(p1 - p0, vd));
  gl_Position = uVP * vec4(p0 + (p1 - p0) * (q.y * 0.5 + 0.5) + side * q.x * w, 1.0); vUV = q; vCol = col; vKind = vec2(3.0, 0.0);
}`,
    star: `void main() {
  if ((int(uC.x) & 32) == 0) { culled(); return; }
  uint ii = uint(gl_InstanceID);
  float h1 = hashf(ii * 5u + 11u), h2 = hashf(ii * 5u + 12u), h3 = hashf(ii * 5u + 13u), h4 = hashf(ii * 5u + 14u);
  float z = h1 * 2.0 - 1.0, ph = h2 * TAU, r = sqrt(1.0 - z * z);
  vec3 p = coreWorld() + vec3(r * cos(ph), z, r * sin(ph)) * (45.0 + 40.0 * h3);
  float tw = 0.65 + 0.35 * sin(uA.x * (0.5 + h4 * 2.0) + h4 * 50.0);
  vec3 col = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.8, 0.55), h4) * (0.25 + 1.4 * h3 * h3) * tw;
  vec3 vd = normalize(p - uEye.xyz), side = normalize(cross(vec3(0.0, 1.0, 0.0001), vd)), up = cross(vd, side);
  vec2 q = corner(gl_VertexID % 6); float size = 0.09 + 0.16 * h3 * h3;
  gl_Position = uVP * vec4(p + (side * q.x + up * q.y) * size, 1.0); vUV = q; vCol = col; vKind = vec2(0.0, 0.0);
}`,
  };
  const FS_GLOW = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vCol; in vec2 vKind; out vec4 o;
void main() {
  vec2 uv = vUV; float a = 0.0;
  if (vKind.x < 0.5) {
    float tau = vKind.y;
    if (tau < 0.05) a = exp(-4.5 * dot(uv, uv));
    else { float hy = (uv.y - tau) / max(0.05, 1.0 - tau); float head = exp(-4.5 * (uv.x * uv.x + hy * hy));
      float tail = exp(-5.0 * uv.x * uv.x) * smoothstep(-1.0, tau, uv.y) * 0.5 * step(uv.y, tau); a = max(head, tail); }
  } else if (vKind.x < 1.5) a = exp(-3.0 * uv.x * uv.x) * (0.35 + 0.65 * (uv.y * 0.5 + 0.5)) * smoothstep(1.0, 0.8, uv.y);
  else if (vKind.x < 2.5) { float r = length(uv); a = exp(-90.0 * (r - 0.82) * (r - 0.82)) * step(r, 1.0); }
  else a = exp(-2.5 * uv.x * uv.x);
  o = vec4(vCol * a, 0.0);
}`;
  const VS_FULL = `#version 300 es
out vec2 vUV; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const POST = {
    down: `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D t0; uniform vec4 texel, k;
#define S(x, y) texture(t0, vUV + d * vec2(x, y))
void main() { vec2 d = texel.xy; vec4 c = texture(t0, vUV) * 0.125;
  c += (S(-1.0, -1.0) + S(1.0, -1.0) + S(-1.0, 1.0) + S(1.0, 1.0)) * 0.125;
  c += (S(-2.0, 0.0) + S(2.0, 0.0) + S(0.0, -2.0) + S(0.0, 2.0)) * 0.0625;
  c += (S(-2.0, -2.0) + S(2.0, -2.0) + S(-2.0, 2.0) + S(2.0, 2.0)) * 0.03125;
  if (k.x > 0.5) { float l = max(c.r, max(c.g, c.b)); c = c * max(0.0, l - 0.35) / max(l, 1e-4); }
  o = vec4(c.rgb, 1.0); }`,
    up: `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D t0, t1; uniform vec4 texel;
void main() { vec2 d = texel.xy; vec4 c = texture(t1, vUV) * 4.0;
  c += (texture(t1, vUV + vec2(d.x, 0.0)) + texture(t1, vUV - vec2(d.x, 0.0)) + texture(t1, vUV + vec2(0.0, d.y)) + texture(t1, vUV - vec2(0.0, d.y))) * 2.0;
  c += texture(t1, vUV + d) + texture(t1, vUV - d) + texture(t1, vUV + vec2(d.x, -d.y)) + texture(t1, vUV + vec2(-d.x, d.y));
  o = vec4(texture(t0, vUV).rgb + c.rgb / 16.0, 1.0); }`,
    comp: `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D t0, t1; uniform vec4 k;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() { vec2 ca = (vUV - 0.5) * 0.0025;
  vec3 hdr = vec3(texture(t0, vUV + ca).r, texture(t0, vUV).g, texture(t0, vUV - ca).b);
  vec3 c = aces((hdr + texture(t1, vUV).rgb * k.y) * k.z);
  vec2 q = vUV - 0.5; c *= 1.0 - smoothstep(0.25, 0.95, dot(q, q) * 1.6) * 0.55; c += vec3(0.004, 0.006, 0.014);
  o = vec4(c, 1.0); }`,
  };

  class GlSwarm {
    constructor(canvas, { solo = true, n = 30000 } = {}) {
      const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw Error('WebGL2 is not available');
      this.canvas = canvas; this.solo = solo; this.backend = 'webgl2';
      this.float = !!gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.adapterInfo = { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) };
      this.prog = {}; for (const k in VS) this.prog[k] = this.link(HEAD + VS[k], FS_GLOW);
      this.post = {}; for (const k in POST) this.post[k] = this.link(VS_FULL, POST[k]);
      this.vao = gl.createVertexArray(); this.vaoEmpty = gl.createVertexArray();
      this.sbuf = gl.createBuffer();
      this.hist = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.hist);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 64, 10, 0, gl.RED, gl.FLOAT, null);
      this.lut = new Float32Array(32 * 4);
      M.COLOR.forEach((c, k) => this.lut.set([c[0], c[1], c[2], [0.30, 1.1, 1.0, 1.0, 1.2, 1.4, 1.5, 1.1, 1.0, 0.22, 1.6][k]], k * 4));
      M.SECTOR.forEach((s, k) => this.lut.set([s[0], s[1], 0, 0], (11 + k) * 4));
      window.GobblerSwarmGPU.LOOP_COLORS.forEach((c, k) => this.lut.set([c[0], c[1], c[2], 1], (22 + k) * 4));
      this.kin = new Float32Array(160); this.ring = new Float32Array(160); this.counters = new Uint32Array(M.C.SIZE);
      this.setCount(n);
    }
    link(vs, fs) {
      const gl = this.gl, mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('GLSL: ' + gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('GLSL link: ' + gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), name = a.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    }
    setCount(n) {
      const gl = this.gl; n = Math.max(1, Math.min(200000, n | 0)); this.n = n;
      this.state = M.init(n); this.counters = new Uint32Array(M.C.SIZE);
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf); gl.bufferData(gl.ARRAY_BUFFER, this.state, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);
    }
    setRings(r) { for (let k = 0; k < 10; k++) for (let j = 0; j < 16; j++) this.ring[k * 16 + j] = r[k * 16 + j]; }
    setKin(k) { for (let l = 0; l < 10; l++) this.kin.set(k.subarray(l * 20, l * 20 + 16), l * 16); }
    warm(ticks) { const p = M.params(this.n, 1, 0); M.cpuStep(this.state, this.n, p, this.counters, ticks); }
    targets(w, h) {
      if (this.tw === w && this.th === h) return; this.tw = w; this.th = h;
      const gl = this.gl, mk = (W, H) => {
        W = Math.max(1, W); H = Math.max(1, H);
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, this.float ? gl.RGBA16F : gl.RGBA8, W, H, 0, gl.RGBA, this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { t, fb, w: W, h: H };
      };
      (this.rts || []).forEach((r) => { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); });
      this.hdr = mk(w, h); this.down = [2, 4, 8, 16, 32].map((k) => mk(Math.ceil(w / k), Math.ceil(h / k))); this.up = [2, 4, 8, 16].map((k) => mk(Math.ceil(w / k), Math.ceil(h / k)));
      this.rts = [this.hdr, ...this.down, ...this.up];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    frame(f) {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height; if (!w || !h) return;
      const t1 = performance.now();
      const p = M.params(this.n, f.steps, f.chaos);
      M.cpuStep(this.state, this.n, p, this.counters, f.steps);
      this.cpuMs = (this.cpuMs || 0) * 0.9 + (performance.now() - t1) * 0.1;
      this.targets(w, h);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.state);
      const hist = new Float32Array(640), tot = new Float32Array(10), C = this.counters;
      for (let i = 0; i < 640; i++) hist[i] = C[M.C.HIST + i];
      for (let l = 0; l < 10; l++) for (let s = 0; s < 11; s++) tot[l] += C[M.C.OCC + l * 16 + s];
      gl.bindTexture(gl.TEXTURE_2D, this.hist); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 10, gl.RED, gl.FLOAT, hist);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fb); gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST);
      const uni = (P) => {
        const u = P.u; gl.useProgram(P.p);
        gl.uniformMatrix4fv(u.uVP, false, f.vp); gl.uniformMatrix4fv(u.uWorld, false, f.world);
        gl.uniform4f(u.uEye, f.eye[0], f.eye[1], f.eye[2], 1); gl.uniform4f(u.uA, f.time, f.alpha, f.size, this.n);
        gl.uniform4f(u.uB, f.focusLoop, f.focusAgent, f.spectrum, f.glow); gl.uniform4f(u.uC, f.layers, 1, f.exposure, 1); gl.uniform4f(u.uD, w, h, f.bloom, f.gain);
        if (u.uKin) gl.uniformMatrix4fv(u.uKin, false, this.kin); if (u.uRing) gl.uniform4fv(u.uRing, this.ring); if (u.uLut) gl.uniform4fv(u.uLut, this.lut);
        if (u.uLoopTot) gl.uniform1fv(u.uLoopTot, tot); if (u.uHist) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.hist); gl.uniform1i(u.uHist, 0); }
        return u;
      };
      gl.bindVertexArray(this.vaoEmpty);
      if (this.solo) { uni(this.prog.star); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 2600); uni(this.prog.hoop); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 2570); }
      uni(this.prog.spec); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 640);
      gl.bindVertexArray(this.vao);
      let u = uni(this.prog.agent); gl.uniform1f(u.uSpark, 0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n);
      gl.uniform1f(u.uSpark, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n);
      gl.bindVertexArray(this.vaoEmpty);
      uni(this.prog.core); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 5);
      gl.disable(gl.BLEND);
      const pass = (P, dst, a, b, texel, k) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null); gl.viewport(0, 0, dst ? dst.w : w, dst ? dst.h : h); gl.useProgram(P.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.t); gl.uniform1i(P.u.t0, 0);
        if (b) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.t); gl.uniform1i(P.u.t1, 1); }
        if (P.u.texel) gl.uniform4f(P.u.texel, texel[0], texel[1], 0, 0); if (P.u.k) gl.uniform4fv(P.u.k, k);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const src = [this.hdr, ...this.down];
      for (let k = 0; k < 5; k++) pass(this.post.down, this.down[k], src[k], null, [1 / src[k].w, 1 / src[k].h], [k === 0 ? 1 : 0, 0, 0, 0]);
      let low = this.down[4];
      for (let k = 3; k >= 0; k--) { pass(this.post.up, this.up[k], this.down[k], low, [1 / low.w, 1 / low.h], [0, 0, 0, 0]); low = this.up[k]; }
      pass(this.post.comp, null, this.hdr, this.up[0], [0, 0], [0, f.bloom, f.exposure, 1]);
      gl.bindVertexArray(null);
      this.frames = (this.frames || 0) + 1;
    }
  }
  window.GobblerSwarmGL = GlSwarm;
})();
