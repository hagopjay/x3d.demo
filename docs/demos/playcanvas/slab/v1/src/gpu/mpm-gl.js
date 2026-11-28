// SLAB's WebGL2 port of src/sim/mpm.js: the same MLS-MPM step in float32 shaders, judged against the CPU file by
// tools/gpu-gate.cjs. Per step:
//   P2G    particles drawn as points, 9 instances (one per B-spline node), additively blended into an RGBA32F
//          grid (mass, momentum x, momentum y): the portable scatter. Needs EXT_color_buffer_float + EXT_float_blend.
//   GRID   full-screen pass: loads, momentum to velocity, gravity, walls.
//   BODY   (when a skier is caught) a 1x1 reduction of the nodes under the disc, a grid overwrite, a body update.
//   G2P    full-screen pass over the particle textures with 4 render targets: APIC gather, advection, F update,
//          and the same return maps as the CPU (snow clamp and hardening; plane Mohr-Coulomb with cohesion).
// Particle textures (PW x PH, one texel per particle): T0 (x, y, vx, vy), T1 C, T2 F, T3 (jp, dmg, coh, mat).

const PW = 256;
const VS_QUAD = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform int uNx, uNy, uPer, uTwin;
uniform float uDx, uInv, uDt, uV0;
uniform int uKind[4];
uniform float uMu[4], uLa[4], uRho[4], uThC[4], uThS[4], uXi[4], uSinP[4], uCosP[4], uCoh[4], uSoft[4];
// F = U diag(s) V^T: polar decomposition then a symmetric eigensolve, as svd2() in mpm.js
void svd2(float a, float b, float c, float d, out vec2 s, out mat2 U, out mat2 V) {
  float x = a + d, y = c - b, r = length(vec2(x, y));
  float co = 1.0, si = 0.0;
  if (r > 0.0) { co = x / r; si = y / r; }
  float s00 = co * a + si * c, s01 = co * b + si * d, s11 = -si * b + co * d;
  float cs = 1.0, sn = 0.0;
  if (abs(s01) > 1e-30) {
    float tau = 0.5 * (s00 - s11), w = length(vec2(tau, s01));
    float t = tau > 0.0 ? s01 / (tau + w) : s01 / (tau - w);
    cs = 1.0 / sqrt(t * t + 1.0); sn = -t * cs;
  }
  s = vec2(cs * cs * s00 - 2.0 * cs * sn * s01 + sn * sn * s11, sn * sn * s00 + 2.0 * cs * sn * s01 + cs * cs * s11);
  // GLSL mat2 is column-major: mat2(m00, m10, m01, m11)
  U = mat2(co * cs + si * sn, si * cs - co * sn, co * sn - si * cs, si * sn + co * cs);
  V = mat2(cs, -sn, sn, cs);
}
// Kirchhoff stress of a particle (no return map), as Sim.stress(p, false)
mat2 kirchhoff(mat2 F, float jp, float dmg, float coh, int k) {
  vec2 s; mat2 U, V; svd2(F[0][0], F[1][0], F[0][1], F[1][1], s, U, V);
  float mu = uMu[k], la = uLa[k];
  if (uKind[k] == 2) {
    float e1 = log(max(s.x, 1e-8)), e2 = log(max(s.y, 1e-8)), e = e1 + e2, d = 0.5 * (e1 - e2);
    float t1 = 2.0 * mu * (0.5 * e + d) + la * e, t2 = 2.0 * mu * (0.5 * e - d) + la * e;
    return U * mat2(t1, 0.0, 0.0, t2) * transpose(U);
  }
  if (uKind[k] == 1) { float h = exp(uXi[k] * (1.0 - jp)); mu *= h; la *= h; }
  mat2 R = U * transpose(V);
  float J = determinant(F);
  return 2.0 * mu * (F - R) * transpose(F) + la * J * (J - 1.0) * mat2(1.0);
}
ivec2 ptexel(int p) { return ivec2(p % ${PW}, p / ${PW}); }
`;

// ---------------------------------------------------------------- P2G
const VS_P2G = COMMON + `
uniform sampler2D uT0, uT1, uT2, uT3;
flat out vec3 vC;
void main() {
  int p = gl_VertexID, o = gl_InstanceID;
  ivec2 tx = ptexel(p);
  vec4 t3 = texelFetch(uT3, tx, 0);
  int k = int(t3.w + 0.5);
  gl_PointSize = 1.0;
  if (t3.w < -0.5) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vC = vec3(0.0); return; }
  vec4 t0 = texelFetch(uT0, tx, 0), t1 = texelFetch(uT1, tx, 0), t2 = texelFetch(uT2, tx, 0);
  vec2 xp = t0.xy * uInv;
  vec2 base = floor(xp - 0.5), f = xp - base;
  vec2 w0 = 0.5 * (1.5 - f) * (1.5 - f), w1 = 0.75 - (f - 1.0) * (f - 1.0), w2 = 0.5 * (f - 0.5) * (f - 0.5);
  int i = o / 3, j = o - 3 * i;
  float wx = i == 0 ? w0.x : i == 1 ? w1.x : w2.x, wy = j == 0 ? w0.y : j == 1 ? w1.y : w2.y, w = wx * wy;
  mat2 F = mat2(t2.x, t2.z, t2.y, t2.w);            // t2 = (f00, f01, f10, f11)
  mat2 tau = kirchhoff(F, t3.x, t3.y, t3.z, k);
  float m = uRho[k] * uV0;
  float sf = (uTwin == 3 ? 2.0 : 4.0) * uInv * uInv;
  mat2 A = -uDt * uV0 * sf * tau;
  if (uTwin != 1) A += m * mat2(t1.x, t1.z, t1.y, t1.w); // t1 = (c00, c01, c10, c11)
  vec2 dpos = (vec2(float(i), float(j)) - f) * uDx;
  vec2 mom = w * (m * t0.zw + A * dpos);
  int gi = int(base.x) + i, gj = int(base.y) + j;
  if (uPer == 1) gi = (gi % uNx + uNx) % uNx;
  if (gi < 0 || gi >= uNx || gj < 0 || gj >= uNy) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vC = vec3(0.0); return; }
  gl_Position = vec4((float(gi) + 0.5) / float(uNx) * 2.0 - 1.0, (float(gj) + 0.5) / float(uNy) * 2.0 - 1.0, 0.0, 1.0);
  vC = vec3(w * m, mom);
}`;
const FS_P2G = `#version 300 es
precision highp float;
flat in vec3 vC; out vec4 o;
void main() { o = vec4(vC, 0.0); }`;

// ---------------------------------------------------------------- GRID
const FS_GRID = COMMON + `
uniform sampler2D uG;
uniform vec2 uGrav;
uniform int uWall[4]; // left, right, bottom, top: 0 free, 1 sticky, 2 slip, 3 separate
uniform int uNL; uniform vec4 uLoad[4]; // x, y, fx, fy (N/m)
uniform int uHasGround; uniform sampler2D uGround; // nx x 1, terrain height per node column
out vec4 o;
vec2 wall(int kind, vec2 v, vec2 n) {
  if (kind == 0) return v;
  if (kind == 1) return vec2(0.0);
  float vn = dot(v, n);
  if (kind == 2 || vn < 0.0) return v - vn * n;
  return v;
}
float bw(float f, int i) { return i == 0 ? 0.5 * (1.5 - f) * (1.5 - f) : i == 1 ? 0.75 - (f - 1.0) * (f - 1.0) : 0.5 * (f - 0.5) * (f - 0.5); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 g = texelFetch(uG, c, 0);
  if (g.x <= 0.0) { o = vec4(0.0); return; }
  vec2 mom = g.yz;
  for (int l = 0; l < 4; l++) {
    if (l >= uNL) break;
    vec2 px = uLoad[l].xy * uInv, base = floor(px - 0.5), f = px - base;
    int di = c.x - int(base.x), dj = c.y - int(base.y);
    if (uPer == 1) di = ((di % uNx) + uNx) % uNx;
    if (di >= 0 && di < 3 && dj >= 0 && dj < 3) mom += uDt * bw(f.x, di) * bw(f.y, dj) * uLoad[l].zw;
  }
  vec2 v = mom / g.x + uGrav * uDt;
  if (c.y < 2) v = wall(uWall[2], v, vec2(0.0, 1.0));
  if (c.y >= uNy - 2) v = wall(uWall[3], v, vec2(0.0, -1.0));
  if (uHasGround == 1 && float(c.y) * uDx < texelFetch(uGround, ivec2(c.x, 0), 0).x) v = vec2(0.0);
  if (uPer == 0) { if (c.x < 2) v = wall(uWall[0], v, vec2(1.0, 0.0)); if (c.x >= uNx - 2) v = wall(uWall[1], v, vec2(-1.0, 0.0)); }
  o = vec4(v, g.x, 0.0);
}`;

// ---------------------------------------------------------------- BODY (caught skier)
const VS_BSUM = COMMON + `
uniform sampler2D uGV, uB; uniform float uR;
flat out vec3 vC;
void main() {
  int id = gl_VertexID; ivec2 c = ivec2(id % uNx, id / uNx);
  vec4 g = texelFetch(uGV, c, 0); vec4 b = texelFetch(uB, ivec2(0), 0);
  vec2 d = vec2(c) * uDx - b.xy;
  gl_PointSize = 1.0;
  if (g.z <= 0.0 || dot(d, d) > uR * uR) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vC = vec3(0.0); return; }
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0); vC = vec3(g.z, g.z * g.xy);
}`;
const FS_BAPPLY = COMMON + `
uniform sampler2D uGV, uB, uSum; uniform float uR, uM; uniform vec2 uGrav;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec4 g = texelFetch(uGV, c, 0); vec4 b = texelFetch(uB, ivec2(0), 0); vec3 s = texelFetch(uSum, ivec2(0), 0).xyz;
  vec2 d = vec2(c) * uDx - b.xy;
  if (g.z <= 0.0 || dot(d, d) > uR * uR) { o = g; return; }
  vec2 vb = b.zw + uGrav * uDt;
  o = vec4((uM * vb + s.yz) / (uM + s.x), g.z, 0.0);
}`;
const FS_BUPDATE = COMMON + `
uniform sampler2D uB, uSum; uniform float uR, uM; uniform vec2 uGrav;
uniform int uHasGround; uniform sampler2D uGround;
out vec4 o;
void main() {
  vec4 b = texelFetch(uB, ivec2(0), 0); vec3 s = texelFetch(uSum, ivec2(0), 0).xyz;
  vec2 vb = b.zw + uGrav * uDt;
  vec2 v = (uM * vb + s.yz) / (uM + s.x);
  vec2 x = b.xy + uDt * v;
  float fl = 2.5 * uDx + uR;
  if (uHasGround == 1) { int gi = clamp(int(floor(b.x / uDx + 0.5)), 0, uNx - 1); fl = max(fl, texelFetch(uGround, ivec2(gi, 0), 0).x + uR); }
  if (x.y < fl) { x.y = fl; if (v.y < 0.0) v.y = 0.0; }
  o = vec4(x, v);
}`;

// ---------------------------------------------------------------- G2P
const FS_G2P = COMMON + `
uniform sampler2D uT0, uT1, uT2, uT3, uGV;
uniform int uNoRet;
uniform vec4 uBlast; // cx, cy, R, dv (R = 0: none)
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
void main() {
  ivec2 tx = ivec2(gl_FragCoord.xy);
  vec4 t0 = texelFetch(uT0, tx, 0), t1 = texelFetch(uT1, tx, 0), t2 = texelFetch(uT2, tx, 0), t3 = texelFetch(uT3, tx, 0);
  if (t3.w < -0.5) { o0 = t0; o1 = t1; o2 = t2; o3 = t3; return; }
  int k = int(t3.w + 0.5);
  vec2 xp = t0.xy * uInv, base = floor(xp - 0.5), f = xp - base;
  vec2 w[3]; w[0] = 0.5 * (1.5 - f) * (1.5 - f); w[1] = 0.75 - (f - 1.0) * (f - 1.0); w[2] = 0.5 * (f - 0.5) * (f - 0.5);
  vec2 v = vec2(0.0); mat2 C = mat2(0.0);
  for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
    int gi = int(base.x) + i, gj = int(base.y) + j;
    if (uPer == 1) gi = (gi % uNx + uNx) % uNx;
    vec2 gv = texelFetch(uGV, ivec2(gi, gj), 0).xy;
    float ww = w[i].x * w[j].y;
    vec2 dpos = (vec2(float(i), float(j)) - f) * uDx;
    v += ww * gv;
    C += ww * outerProduct(gv, dpos);
  }
  C *= 4.0 * uInv * uInv;
  vec2 x = t0.xy + uDt * v;
  if (uPer == 1) { float L = float(uNx) * uDx; if (x.x < 0.0) x.x += L; else if (x.x >= L) x.x -= L; }
  mat2 F = mat2(t2.x, t2.z, t2.y, t2.w);
  F = F + uDt * (C * F);
  float jp = t3.x, dmg = t3.y, coh = t3.z;
  if (uNoRet == 0 && uKind[k] != 0) {
    vec2 s; mat2 U, V; svd2(F[0][0], F[1][0], F[0][1], F[1][1], s, U, V);
    if (uKind[k] == 2) {
      float mu = uMu[k], la = uLa[k], K = mu + la;
      float e1 = log(max(s.x, 1e-8)), e2 = log(max(s.y, 1e-8)), e = e1 + e2, d = 0.5 * (e1 - e2);
      float cc = uCoh[k] * coh;
      if (uSoft[k] > 0.0) cc *= max(0.0, 1.0 - dmg / uSoft[k]);
      float cap = cc * uCosP[k] - K * e * uSinP[k];
      if (cap <= 0.0) { float ea = uSinP[k] > 0.0 ? cc * uCosP[k] / (K * uSinP[k]) : 0.0; dmg += 2.0 * abs(d); e = ea; d = 0.0; }
      else if (2.0 * mu * abs(d) > cap) { float dn = sign(d) * cap / (2.0 * mu); dmg += 2.0 * abs(d - dn); d = dn; }
      F = U * mat2(exp(0.5 * e + d), 0.0, 0.0, exp(0.5 * e - d)) * transpose(V);
    } else {
      float J0 = s.x * s.y;
      vec2 sc = clamp(s, vec2(1.0 - uThC[k]), vec2(1.0 + uThS[k]));
      jp *= J0 / (sc.x * sc.y);
      dmg = abs(log(jp));
      F = U * mat2(sc.x, 0.0, 0.0, sc.y) * transpose(V);
    }
  }
  if (uBlast.z > 0.0) {
    vec2 dd = x - uBlast.xy; float dl = length(dd);
    if (dl < uBlast.z && dl > 0.0) { v += uBlast.w * (1.0 - dl / uBlast.z) * dd / dl; if (uKind[k] == 2) coh = 0.0; dmg += 1.0 - dl / uBlast.z; }
  }
  o0 = vec4(x, v); o1 = vec4(C[0][0], C[1][0], C[0][1], C[1][1]); o2 = vec4(F[0][0], F[1][0], F[0][1], F[1][1]); o3 = vec4(jp, dmg, coh, t3.w);
}`;

function compile(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) + '\n' + s.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n').slice(0, 4000)); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const WALL = { free: 0, sticky: 1, slip: 2, separate: 3 };
const TWIN = { pic: 1, stress2: 3 };

export class GpuMpm {
  /** gl: a WebGL2 context; sim: a CPU Sim whose grid, materials and particles are copied. */
  constructor(gl, sim) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU: EXT_color_buffer_float missing');
    this.floatBlend = !!gl.getExtension('EXT_float_blend');
    if (!this.floatBlend) throw new Error('GPU: EXT_float_blend missing (P2G needs additive float32 blending)');
    Object.assign(this, { nx: sim.nx, ny: sim.ny, dx: sim.dx, dt: sim.dt, per: sim.periodicX ? 1 : 0, walls: sim.walls, mats: sim.mats, twin: sim.twin });
    this.gravity = sim.gravity.slice(); this.ramp = sim.ramp; this.t = sim.t; this.steps = sim.steps;
    this.v0 = sim.v0[0];
    this.n = sim.n; this.PH = Math.max(1, Math.ceil(this.n / PW));
    this.prog = { p2g: compile(gl, VS_P2G, FS_P2G), grid: compile(gl, VS_QUAD, FS_GRID), bsum: compile(gl, VS_BSUM, FS_P2G),
      bapply: compile(gl, VS_QUAD, FS_BAPPLY), bupd: compile(gl, VS_QUAD, FS_BUPDATE), g2p: compile(gl, VS_QUAD, FS_G2P) };
    this.vao = gl.createVertexArray();
    const tex = (w, h, data = null) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    const fbo = (texs) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)); return f; };
    this._tex = tex; this._fbo = fbo;
    // particles: two sets of 4 textures, ping-ponged
    const pack = this.pack(sim);
    this.P = [0, 1].map(() => { const t = pack.map((d) => tex(PW, this.PH, d)); return { t, f: fbo(t) }; });
    this.cur = 0;
    this.G = tex(this.nx, this.ny); this.Gf = fbo([this.G]);
    this.GV = [tex(this.nx, this.ny), tex(this.nx, this.ny)]; this.GVf = this.GV.map((t) => fbo([t]));
    this.S = tex(1, 1); this.Sf = fbo([this.S]);
    this.B = [tex(1, 1), tex(1, 1)]; this.Bf = this.B.map((t) => fbo([t])); this.bcur = 0;
    this.body = null; this.loads = []; this.pendingBlast = null;
    this.Gr = null;
    if (sim.ground) { this.Gr = tex(this.nx, 1, Float32Array.from({ length: this.nx * 4 }, (_, i) => (i % 4 === 0 ? sim.ground[i / 4] : 0))); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  pack(sim) {
    const N = PW * this.PH, T = [0, 1, 2, 3].map(() => new Float32Array(N * 4));
    for (let p = 0; p < N; p++) {
      if (p >= sim.n) { T[3][p * 4 + 3] = -1; continue; }
      T[0].set([sim.x[p], sim.y[p], sim.vx[p], sim.vy[p]], p * 4);
      T[1].set([sim.c00[p], sim.c01[p], sim.c10[p], sim.c11[p]], p * 4);
      T[2].set([sim.f00[p], sim.f01[p], sim.f10[p], sim.f11[p]], p * 4);
      T[3].set([sim.jp[p], sim.dmg[p], sim.coh[p], sim.mat[p]], p * 4);
    }
    return T;
  }

  setBody(b) {
    this.body = b ? { r: b.r, M: b.M } : null;
    if (b) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.B[this.bcur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([b.x, b.y, b.vx, b.vy])); }
  }
  blast(cx, cy, R, dv) { this.pendingBlast = [cx, cy, R, dv]; }

  uniforms(P) {
    const gl = this.gl, u = P.u, M = this.mats, pad = (f, d = 0) => [0, 1, 2, 3].map((i) => (M[i] ? f(M[i]) : d));
    gl.uniform1i(u.uNx, this.nx); gl.uniform1i(u.uNy, this.ny); gl.uniform1i(u.uPer, this.per); gl.uniform1i(u.uTwin, TWIN[this.twin] || 0);
    gl.uniform1f(u.uDx, this.dx); gl.uniform1f(u.uInv, 1 / this.dx); gl.uniform1f(u.uDt, this.dt); gl.uniform1f(u.uV0, this.v0);
    if (u.uKind) gl.uniform1iv(u.uKind, pad((m) => m.kind));
    const f = (name, fn) => u[name] && gl.uniform1fv(u[name], pad(fn));
    f('uMu', (m) => m.mu); f('uLa', (m) => m.la); f('uRho', (m) => m.rho); f('uThC', (m) => m.thetaC); f('uThS', (m) => m.thetaS); f('uXi', (m) => m.xi);
    f('uSinP', (m) => m.sinPhi); f('uCosP', (m) => m.cosPhi); f('uCoh', (m) => m.c); f('uSoft', (m) => (m.soften === Infinity ? -1 : m.soften));
  }

  bind(P, name, unit, t) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], unit); }

  gscale() { if (!this.ramp) return 1; const s = Math.min(1, this.t / this.ramp); return s * s * (3 - 2 * s); }

  step(count = 1) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    for (let s = 0; s < count; s++) {
      const src = this.P[this.cur], dst = this.P[1 - this.cur];
      const gs = this.gscale(), grav = [this.gravity[0] * gs, this.gravity[1] * gs];
      // P2G
      let P = this.prog.p2g; gl.useProgram(P.p); this.uniforms(P);
      ['uT0', 'uT1', 'uT2', 'uT3'].forEach((n, i) => this.bind(P, n, i, src.t[i]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.Gf); gl.viewport(0, 0, this.nx, this.ny);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
      gl.drawArraysInstanced(gl.POINTS, 0, this.n, 9);
      gl.disable(gl.BLEND);
      // GRID
      P = this.prog.grid; gl.useProgram(P.p); this.uniforms(P); this.bind(P, 'uG', 0, this.G);
      gl.uniform2f(P.u.uGrav, grav[0], grav[1]);
      gl.uniform1iv(P.u.uWall, ['left', 'right', 'bottom', 'top'].map((k) => WALL[this.walls[k]]));
      gl.uniform1i(P.u.uNL, Math.min(4, this.loads.length));
      gl.uniform1i(P.u.uHasGround, this.Gr ? 1 : 0); if (this.Gr) this.bind(P, 'uGround', 1, this.Gr);
      const L = new Float32Array(16); this.loads.slice(0, 4).forEach((l, i) => L.set([l.x, l.y, l.fx, l.fy], i * 4)); gl.uniform4fv(P.u.uLoad, L);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.GVf[0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      let gv = 0;
      if (this.body) {
        const b = this.body;
        P = this.prog.bsum; gl.useProgram(P.p); this.uniforms(P); this.bind(P, 'uGV', 0, this.GV[0]); this.bind(P, 'uB', 1, this.B[this.bcur]); gl.uniform1f(P.u.uR, b.r);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.Sf); gl.viewport(0, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.drawArrays(gl.POINTS, 0, this.nx * this.ny); gl.disable(gl.BLEND);
        P = this.prog.bapply; gl.useProgram(P.p); this.uniforms(P);
        this.bind(P, 'uGV', 0, this.GV[0]); this.bind(P, 'uB', 1, this.B[this.bcur]); this.bind(P, 'uSum', 2, this.S);
        gl.uniform1f(P.u.uR, b.r); gl.uniform1f(P.u.uM, b.M); gl.uniform2f(P.u.uGrav, grav[0], grav[1]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.GVf[1]); gl.viewport(0, 0, this.nx, this.ny); gl.drawArrays(gl.TRIANGLES, 0, 3);
        P = this.prog.bupd; gl.useProgram(P.p); this.uniforms(P);
        this.bind(P, 'uB', 0, this.B[this.bcur]); this.bind(P, 'uSum', 1, this.S);
        gl.uniform1f(P.u.uR, b.r); gl.uniform1f(P.u.uM, b.M); gl.uniform2f(P.u.uGrav, grav[0], grav[1]);
        gl.uniform1i(P.u.uHasGround, this.Gr ? 1 : 0); if (this.Gr) this.bind(P, 'uGround', 2, this.Gr);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.Bf[1 - this.bcur]); gl.viewport(0, 0, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.bcur = 1 - this.bcur; gv = 1;
      }
      // G2P
      P = this.prog.g2p; gl.useProgram(P.p); this.uniforms(P);
      ['uT0', 'uT1', 'uT2', 'uT3'].forEach((n, i) => this.bind(P, n, i, src.t[i]));
      this.bind(P, 'uGV', 4, this.GV[gv]);
      gl.uniform1i(P.u.uNoRet, this.twin === 'no_return' ? 1 : 0);
      const bl = this.pendingBlast || [0, 0, 0, 0]; this.pendingBlast = null; gl.uniform4f(P.u.uBlast, bl[0], bl[1], bl[2], bl[3]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, PW, this.PH);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur;
      this.t += this.dt; this.steps++;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Read particle texture k (0: x y vx vy, 1: C, 2: F, 3: jp dmg coh mat) as a Float32Array of 4 * PW * PH. */
  read(k = 0, out = null) {
    const gl = this.gl, a = out || new Float32Array(PW * this.PH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.P[this.cur].f); gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
    gl.readPixels(0, 0, PW, this.PH, gl.RGBA, gl.FLOAT, a);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return a;
  }
  readBody() {
    const gl = this.gl, a = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.Bf[this.bcur]); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, a); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { x: a[0], y: a[1], vx: a[2], vy: a[3] };
  }
}
export { PW };
