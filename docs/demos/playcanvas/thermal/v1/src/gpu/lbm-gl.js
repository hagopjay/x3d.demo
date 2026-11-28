// THERMAL's WebGL2 lattice Boltzmann port: the same two passes as src/sim/lbm.js, as fragment shaders over float
// textures (EXT_color_buffer_float), ping-ponged. Per step: one fused pull+collide pass for temperature (D2Q5), one
// for flow (D2Q9 MRT). Textures, nx x ny each:
//   F0 = f0..f3, F1 = f4..f7, F2 = (f8, nu_t, ux, uy)     G0 = g0..g3, G1 = (g4, s = T - T_ref, 0, 0)
//   S  = (solid, sponge sigma, heat K/step, u target)      static, always RGBA32F
// The CPU file is the reference; tools/gpu-gate.cjs runs both in headless Chromium and compares them.

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uS;
uniform int uNx, uNy;
uniform float uRefT0, uRefGam;
// walls: type 0 noslip, 1 freeslip; T mode 0 adiabatic, 1 Dirichlet (absolute value), 2 the reference profile
uniform int uBotType, uTopType, uBotTm, uTopTm, uSolTm;
uniform float uBotU, uTopU, uBotTv, uTopTv, uSolTv;
const int CX[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int CY[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
const int MIRY[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5);
const float W9[9] = float[9](4.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0);
const float W5[5] = float[5](1.0/3.0, 1.0/6.0, 1.0/6.0, 1.0/6.0, 1.0/6.0);
const int MIR5[5] = int[5](0, 1, 4, 3, 2);
bool solidAt(int i, int j) { return texelFetch(uS, ivec2(i, j), 0).x > 0.5; }
// which wall a pull from (si, sj) hits: 0 none, 1 bottom, 2 top, 3 solid
int wallOf(int si, int sj) { if (sj < 0) return 1; if (sj >= uNy) return 2; if (solidAt(si, sj)) return 3; return 0; }
`;

const FS_TEMP = COMMON + `
uniform sampler2D uG0, uG1, uF2;
uniform float uKappa, uPrT, uSun;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
float getG(ivec2 p, int k) { if (k < 4) { vec4 v = texelFetch(uG0, p, 0); return v[k]; } return texelFetch(uG1, p, 0).x; }
float wallS(int mode, float val, float z) { return mode == 2 ? 0.0 : val - (uRefT0 + uRefGam * z); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); int i = p.x, j = p.y;
  vec4 st = texelFetch(uS, p, 0);
  if (st.x > 0.5) { o0 = vec4(0.0); o1 = vec4(0.0); return; }
  float g[5]; float T = 0.0;
  for (int k = 0; k < 5; k++) {
    int si = (i - CX[k] + uNx) % uNx, sj = j - CY[k];
    int w = wallOf(si, sj);
    float v;
    if (w == 0) v = getG(ivec2(si, sj), k);
    else {
      int type = w == 1 ? uBotType : w == 2 ? uTopType : 0;
      int tm = w == 1 ? uBotTm : w == 2 ? uTopTm : uSolTm;
      float tv = w == 1 ? uBotTv : w == 2 ? uTopTv : uSolTv;
      if (tm == 0) v = type == 1 ? getG(ivec2(si, j), MIR5[k]) : getG(p, OPP[k]);
      else v = -getG(p, OPP[k]) + 2.0 * W5[k] * wallS(tm, tv, float(j) - float(CY[k]) * 0.5);
    }
    g[k] = v; T += v;
  }
  vec4 f2 = texelFetch(uF2, p, 0);
  float vx = f2.z, vy = f2.w, nut = f2.y;
  float tauT = 0.5 + 3.0 * (uKappa + nut / uPrT), om = 1.0 / tauT;
  float src = st.z * uSun - uRefGam * vy;
  float sg = st.y;
  float n[5];
  for (int k = 0; k < 5; k++) {
    float eq = W5[k] * T * (1.0 + 3.0 * (float(CX[k]) * vx + float(CY[k]) * vy));
    float v = g[k] - om * (g[k] - eq) + W5[k] * src;
    if (sg > 0.0) v += sg * (0.0 - v);
    n[k] = v;
  }
  o0 = vec4(n[0], n[1], n[2], n[3]); o1 = vec4(n[4], T, 0.0, 0.0);
}`;

const FS_FLOW = COMMON + `
uniform sampler2D uF0, uF1, uF2, uG1;
uniform float uTau0, uC2, uSe, uSqFix, uG, uBT0, uBGam, uFx0, uFy0, uWallFactor;
uniform int uBGK;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
float getF(ivec2 p, int k) { if (k < 4) { vec4 v = texelFetch(uF0, p, 0); return v[k]; } if (k < 8) { vec4 v = texelFetch(uF1, p, 0); return v[k - 4]; } return texelFetch(uF2, p, 0).x; }
float sqRule(float snu) { float t = 1.0 / snu - 0.5; float lam = 0.1875 * min(1.0, (t / 0.05) * (t / 0.05)); return 1.0 / (0.5 + lam / t); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); int i = p.x, j = p.y;
  vec4 st = texelFetch(uS, p, 0);
  if (st.x > 0.5) { o0 = vec4(0.0); o1 = vec4(0.0); o2 = vec4(0.0); return; }
  float f[9];
  for (int k = 0; k < 9; k++) {
    int si = (i - CX[k] + uNx) % uNx, sj = j - CY[k];
    int w = wallOf(si, sj);
    if (w == 0) f[k] = getF(ivec2(si, sj), k);
    else {
      int type = w == 1 ? uBotType : w == 2 ? uTopType : 0;
      float uw = w == 1 ? uBotU : w == 2 ? uTopU : 0.0;
      if (type == 1) f[k] = getF(ivec2(si, j), MIRY[k]);
      else f[k] = getF(p, OPP[k]) + uWallFactor * W9[k] * float(CX[k]) * uw;
    }
  }
  float r = f[0] + f[1] + f[2] + f[3] + f[4] + f[5] + f[6] + f[7] + f[8];
  float e = -4.0 * f[0] - f[1] - f[2] - f[3] - f[4] + 2.0 * (f[5] + f[6] + f[7] + f[8]);
  float ep = 4.0 * f[0] - 2.0 * (f[1] + f[2] + f[3] + f[4]) + f[5] + f[6] + f[7] + f[8];
  float jx = f[1] - f[3] + f[5] - f[6] - f[7] + f[8];
  float qx = -2.0 * f[1] + 2.0 * f[3] + f[5] - f[6] - f[7] + f[8];
  float jy = f[2] - f[4] + f[5] + f[6] - f[7] - f[8];
  float qy = -2.0 * f[2] + 2.0 * f[4] + f[5] + f[6] - f[7] - f[8];
  float pxx = f[1] - f[2] + f[3] - f[4];
  float pxy = f[5] - f[6] + f[7] - f[8];
  float s = texelFetch(uG1, p, 0).y;
  float Fx = uFx0;
  float Fy = uFy0 + (uG != 0.0 ? uG * (s + uRefT0 + uRefGam * float(j) - (uBT0 + uBGam * float(j))) : 0.0);
  float vx = (jx + 0.5 * Fx) / r, vy = (jy + 0.5 * Fy) / r;
  float jxe = r * vx, jye = r * vy;
  float u2 = vx * vx + vy * vy;
  float eEq = -2.0 * r + 3.0 * r * u2, epEq = r - 3.0 * r * u2;
  float pxxEq = r * (vx * vx - vy * vy), pxyEq = r * vx * vy;
  float tau = uTau0;
  if (uC2 > 0.0) {
    float a1 = pxx - pxxEq, a2 = pxy - pxyEq;
    float Q = sqrt(0.5 * a1 * a1 + 2.0 * a2 * a2);
    tau = 0.5 * (uTau0 + sqrt(uTau0 * uTau0 + 18.0 * 1.4142135623730951 * uC2 * Q / r));
  }
  float nut = (tau - uTau0) / 3.0;
  float snu = 1.0 / tau;
  float sE = uBGK == 1 ? snu : uSe;
  float sQ = uBGK == 1 ? snu : (uSqFix > 0.0 ? uSqFix : sqRule(snu));
  float uF = vx * Fx + vy * Fy;
  float e1 = e - sE * (e - eEq) + (1.0 - 0.5 * sE) * 6.0 * uF;
  float ep1 = ep - sE * (ep - epEq) + (1.0 - 0.5 * sE) * (-6.0 * uF);
  float jx1 = jx + Fx, jy1 = jy + Fy;
  float qx1 = qx - sQ * (qx + jxe) + (1.0 - 0.5 * sQ) * (-Fx);
  float qy1 = qy - sQ * (qy + jye) + (1.0 - 0.5 * sQ) * (-Fy);
  float pxx1 = pxx - snu * (pxx - pxxEq) + (1.0 - 0.5 * snu) * 2.0 * (vx * Fx - vy * Fy);
  float pxy1 = pxy - snu * (pxy - pxyEq) + (1.0 - 0.5 * snu) * (vx * Fy + vy * Fx);
  float R = r / 9.0, E1 = e1 / 36.0, E2 = e1 / 18.0, P1 = ep1 / 18.0, P2 = ep1 / 36.0;
  float JX = jx1 / 6.0, JY = jy1 / 6.0, QX = qx1 / 6.0, QY = qy1 / 6.0, QX2 = qx1 / 12.0, QY2 = qy1 / 12.0, PXX = pxx1 / 4.0, PXY = pxy1 / 4.0;
  float n[9];
  n[0] = R - e1 / 9.0 + ep1 / 9.0;
  n[1] = R - E1 - P1 + JX - QX + PXX;
  n[2] = R - E1 - P1 + JY - QY - PXX;
  n[3] = R - E1 - P1 - JX + QX + PXX;
  n[4] = R - E1 - P1 - JY + QY - PXX;
  n[5] = R + E2 + P2 + JX + QX2 + JY + QY2 + PXY;
  n[6] = R + E2 + P2 - JX - QX2 + JY + QY2 - PXY;
  n[7] = R + E2 + P2 - JX - QX2 - JY - QY2 + PXY;
  n[8] = R + E2 + P2 + JX + QX2 - JY - QY2 - PXY;
  float sg = st.y;
  if (sg > 0.0) {
    float ut = st.w, uu = 1.5 * ut * ut;
    for (int k = 0; k < 9; k++) {
      float cu = 3.0 * float(CX[k]) * ut;
      float eq = W9[k] * r * (1.0 + cu + 0.5 * cu * cu - uu);
      n[k] += sg * (eq - n[k]);
    }
  }
  o0 = vec4(n[0], n[1], n[2], n[3]); o1 = vec4(n[4], n[5], n[6], n[7]); o2 = vec4(n[8], nut, vx, vy);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let k = 0; k < n; k++) { const info = gl.getActiveUniform(p, k); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const tMode = (spec) => (spec === 'adiabatic' ? 0 : spec === 'ref' ? 2 : 1);
const tVal = (spec) => (typeof spec === 'number' ? spec : 0);

/**
 * cfg: the CPU config (src/sim/lbm.js); init: a CPU sim built from it (its arrays are the initial state).
 * opts: { canvas, halfFloat }
 */
export function createGPULBM(cfg, init, opts = {}) {
  const canvas = opts.canvas || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const nx = cfg.nx, ny = cfg.ny, n = nx * ny;
  const half = !!opts.halfFloat;
  const IF = half ? gl.RGBA16F : gl.RGBA32F;

  const tex = (internal = IF, data = null) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, nx, ny, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const set = () => ({ F: [tex(), tex(), tex()], G: [tex(), tex()] });
  const bufs = [set(), set()];
  let cur = 0;
  const S = tex(gl.RGBA32F, null);
  const fbo = (list) => {
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    list.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(list.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + st + (half ? ' (half float)' : ''));
    return fb;
  };
  const fbF = bufs.map((b) => fbo(b.F)), fbG = bufs.map((b) => fbo(b.G));
  const readFb = gl.createFramebuffer();
  const vao = gl.createVertexArray();

  const pT = program(gl, FS_TEMP), pF = program(gl, FS_FLOW);
  const solidT = cfg.solidT ?? 'adiabatic';
  const bottom = { type: 'noslip', u: 0, T: 'adiabatic', ...(cfg.bottom || {}) }, top = { type: 'noslip', u: 0, T: 'adiabatic', ...(cfg.top || {}) };
  const ref = cfg.ref || { T0: 0, Gamma: 0 }, buoy = cfg.buoy || { G: 0, mode: 'const', T0c: 0 };
  const common = (P) => {
    const u = P.u;
    gl.uniform1i(u.uNx, nx); gl.uniform1i(u.uNy, ny);
    gl.uniform1f(u.uRefT0, ref.T0); gl.uniform1f(u.uRefGam, ref.Gamma);
    gl.uniform1i(u.uBotType, bottom.type === 'freeslip' ? 1 : 0); gl.uniform1i(u.uTopType, top.type === 'freeslip' ? 1 : 0);
    gl.uniform1i(u.uBotTm, tMode(bottom.T)); gl.uniform1i(u.uTopTm, tMode(top.T)); gl.uniform1i(u.uSolTm, tMode(solidT));
    gl.uniform1f(u.uBotU, bottom.u || 0); gl.uniform1f(u.uTopU, top.u || 0);
    gl.uniform1f(u.uBotTv, tVal(bottom.T)); gl.uniform1f(u.uTopTv, tVal(top.T)); gl.uniform1f(u.uSolTv, tVal(solidT));
  };
  gl.useProgram(pT.p); common(pT);
  gl.uniform1f(pT.u.uKappa, cfg.kappa ?? 0); gl.uniform1f(pT.u.uPrT, cfg.prT ?? 0.7);
  gl.useProgram(pF.p); common(pF);
  const G = buoy.G * (buoy.sign ?? 1);
  gl.uniform1f(pF.u.uTau0, 3 * cfg.nu + 0.5); gl.uniform1f(pF.u.uC2, (cfg.smag || 0) ** 2);
  gl.uniform1f(pF.u.uSe, cfg.se ?? 1.2); gl.uniform1f(pF.u.uSqFix, cfg.sq ?? 0); gl.uniform1i(pF.u.uBGK, cfg.collision === 'bgk' ? 1 : 0);
  gl.uniform1f(pF.u.uG, G);
  gl.uniform1f(pF.u.uBT0, buoy.mode === 'profile' ? ref.T0 : (buoy.T0c ?? 0)); gl.uniform1f(pF.u.uBGam, buoy.mode === 'profile' ? ref.Gamma : 0);
  gl.uniform1f(pF.u.uFx0, cfg.force ? cfg.force[0] : 0); gl.uniform1f(pF.u.uFy0, cfg.force ? cfg.force[1] : 0);
  gl.uniform1f(pF.u.uWallFactor, cfg.wallFactor ?? 6);

  const sdata = new Float32Array(n * 4);
  function uploadStatic() {
    const solid = cfg.solid || new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      sdata[c * 4] = solid[c]; sdata[c * 4 + 1] = cfg.sponge ? cfg.sponge[c] : 0;
      sdata[c * 4 + 2] = cfg.heat ? cfg.heat[c] : 0; sdata[c * 4 + 3] = cfg.uTarget ? cfg.uTarget[(c / nx) | 0] : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, S);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.FLOAT, sdata);
  }
  uploadStatic();

  const put = (t, data) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.FLOAT, data); };
  /** Upload a full state (Float64 or Float32 arrays in the CPU layout) into the current buffers. */
  function setState(f, g, nut, ux, uy, T) {
    const b = bufs[cur], a = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)], q = [new Float32Array(n * 4), new Float32Array(n * 4)];
    for (let c = 0; c < n; c++) {
      for (let k = 0; k < 4; k++) { a[0][c * 4 + k] = f[c * 9 + k]; a[1][c * 4 + k] = f[c * 9 + 4 + k]; q[0][c * 4 + k] = g[c * 5 + k]; }
      a[2][c * 4] = f[c * 9 + 8]; a[2][c * 4 + 1] = nut[c]; a[2][c * 4 + 2] = ux[c]; a[2][c * 4 + 3] = uy[c];
      q[1][c * 4] = g[c * 5 + 4]; q[1][c * 4 + 1] = T[c];
    }
    a.forEach((d, k) => put(b.F[k], d)); q.forEach((d, k) => { put(b.G[k], d); put(bufs[1 - cur].G[k], d); });
  }
  setState(init.f, init.g, init.nut, init.ux, init.uy, init.T);

  const bind = (P, name, unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], unit); };
  const state = { t: 0, sun: cfg.sun ?? 1, frozenT: !!cfg.frozenT, thermal: !!cfg.thermal };
  function step() {
    const a = bufs[cur], b = bufs[1 - cur];
    gl.viewport(0, 0, nx, ny);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    if (state.thermal && !state.frozenT) {
      gl.useProgram(pT.p);
      gl.uniform1f(pT.u.uSun, state.sun);
      bind(pT, 'uS', 0, S); bind(pT, 'uG0', 1, a.G[0]); bind(pT, 'uG1', 2, a.G[1]); bind(pT, 'uF2', 3, a.F[2]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbG[1 - cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(pF.p);
    bind(pF, 'uS', 0, S); bind(pF, 'uF0', 1, a.F[0]); bind(pF, 'uF1', 2, a.F[1]); bind(pF, 'uF2', 3, a.F[2]); bind(pF, 'uG1', 4, (state.thermal && !state.frozenT) ? b.G[1] : a.G[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbF[1 - cur]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
    state.t++;
  }

  function readTex(t, x = 0, y = 0, w = nx, h = ny) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const out = new Float32Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }
  /** Macroscopic fields (lattice units; T is the deviation s) as plain arrays in the CPU layout. */
  function readMacro() {
    const b = bufs[cur], f2 = readTex(b.F[2]), g1 = readTex(b.G[1]);
    const ux = new Float32Array(n), uy = new Float32Array(n), nut = new Float32Array(n), T = new Float32Array(n);
    for (let c = 0; c < n; c++) { nut[c] = f2[c * 4 + 1]; ux[c] = f2[c * 4 + 2]; uy[c] = f2[c * 4 + 3]; T[c] = g1[c * 4 + 1]; }
    return { ux, uy, nut, T, solid: cfg.solid || new Uint8Array(n) };
  }
  /** Read a window of the macroscopic fields (for the glider): { i0, j0, w, h, ux, uy, T } */
  function readWindow(i0, j0, w, h) {
    const b = bufs[cur], f2 = readTex(b.F[2], i0, j0, w, h), g1 = readTex(b.G[1], i0, j0, w, h);
    const ux = new Float32Array(w * h), uy = new Float32Array(w * h), T = new Float32Array(w * h);
    for (let c = 0; c < w * h; c++) { ux[c] = f2[c * 4 + 2]; uy[c] = f2[c * 4 + 3]; T[c] = g1[c * 4 + 1]; }
    return { i0, j0, w, h, ux, uy, T };
  }
  /** The full population state, in the CPU layout (Float32). */
  function readState() {
    const b = bufs[cur];
    const F = b.F.map((t) => readTex(t)), Gt = b.G.map((t) => readTex(t));
    const f = new Float32Array(n * 9), g = new Float32Array(n * 5), nut = new Float32Array(n), ux = new Float32Array(n), uy = new Float32Array(n), T = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      for (let k = 0; k < 4; k++) { f[c * 9 + k] = F[0][c * 4 + k]; f[c * 9 + 4 + k] = F[1][c * 4 + k]; g[c * 5 + k] = Gt[0][c * 4 + k]; }
      f[c * 9 + 8] = F[2][c * 4]; nut[c] = F[2][c * 4 + 1]; ux[c] = F[2][c * 4 + 2]; uy[c] = F[2][c * 4 + 3];
      g[c * 5 + 4] = Gt[1][c * 4]; T[c] = Gt[1][c * 4 + 1];
    }
    return { f, g, nut, ux, uy, T };
  }
  function setHeat(heat) { cfg.heat = heat; uploadStatic(); }
  /** The wrong-twin switch: plain BGK with Smagorinsky off, or back to the configured MRT + Smagorinsky. */
  function setOperator(bgk) {
    gl.useProgram(pF.p);
    gl.uniform1i(pF.u.uBGK, bgk ? 1 : (cfg.collision === 'bgk' ? 1 : 0));
    gl.uniform1f(pF.u.uC2, bgk ? 0 : (cfg.smag || 0) ** 2);
  }
  function finish() { const px = new Float32Array(4); readTex(bufs[cur].F[2], 0, 0, 1, 1); return px; }

  return { gl, renderer, nx, ny, n, state, half, step, steps(k) { for (let s = 0; s < k; s++) step(); }, readMacro, readWindow, readState, setState, setHeat, setOperator, finish, get t() { return state.t; } };
}
