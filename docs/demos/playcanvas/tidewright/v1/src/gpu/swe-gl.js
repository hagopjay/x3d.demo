// TIDEWRIGHT's GPU solver: the CPU reference (src/sim/swe.js) ported to WebGL2 fragment passes on RGBA32F
// textures (EXT_color_buffer_float). Per step: x-flux -> y-flux -> update (+ sources, culverts, friction, max depth)
// -> boundary outflow (one texel per step, summed in float64 on read-back). A reduction pass sums the stored volume
// and finds the largest wave speed. The scheme, the twins and the order of operations match the CPU solver; the
// arithmetic is float32. It owns its own WebGL2 context (an offscreen canvas), so it never disturbs a renderer's.
//
// Textures: S (h, hu, hv, hmax) ping-pong; B (b, manning, 0, 0); FX (nx+1) x ny and FY nx x (ny+1) (mass, normal
// momentum, tangential momentum, 0); OUT 256 x 1 (outflow of each step since the last read-back); R reduction chain.

const TW = { davisDry: 1, pressureTypo: 2, zeroFilms: 4, frictionH: 8, culvertNo2: 16, hllNoBranches: 32 };

const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
const float DRY = 1e-4;
uniform int uTw;
bool tw(int bit) { return (uTw & bit) != 0; }
float velo(float h, float q) {
  if (!(h > 0.0)) return 0.0;
  if (h >= DRY) return q / h;
  float h4 = h * h * h * h; const float D4 = DRY * DRY * DRY * DRY;
  return 1.4142135623730951 * h * q / sqrt(h4 + D4);
}
float rec(float h, float b, float bn) { float bm = max(b, bn); return max(h + b - bm, 0.0); }
`;

const FLUX = COMMON + `
uniform sampler2D uS; uniform sampler2D uB;
uniform ivec2 uN; uniform int uAxis; uniform ivec4 uBC; uniform float uG; uniform int uNaive;
out vec4 o;
vec3 hll(float hL, float unL, float utL, float hR, float unR, float utR) {
  if (hL <= 0.0 && hR <= 0.0) return vec3(0.0);
  float half_ = tw(2) ? 1.0 : 0.5;
  float cL = sqrt(uG * hL), cR = sqrt(uG * hR);
  float sL, sR;
  if (hL <= 0.0 && !tw(1)) { sL = unR - 2.0 * cR; sR = unR + cR; }
  else if (hR <= 0.0 && !tw(1)) { sL = unL - cL; sR = unL + 2.0 * cL; }
  else { sL = min(unL - cL, unR - cR); sR = max(unL + cL, unR + cR); }
  float qL = hL * unL, qR = hR * unR;
  vec3 FL = vec3(qL, qL * unL + half_ * uG * hL * hL, qL * utL);
  if (sL >= 0.0 && !tw(32)) return FL;
  vec3 FR = vec3(qR, qR * unR + half_ * uG * hR * hR, qR * utR);
  if (sR <= 0.0 && !tw(32)) return FR;
  float k = sL / (sR - sL);
  return vec3(FL.x + k * ((FL.x - FR.x) + sR * (hR - hL)),
              FL.y + k * ((FL.y - FR.y) + sR * (qR - qL)),
              FL.z + k * ((FL.z - FR.z) + sR * (hR * utR - hL * utL)));
}
float bedAt(ivec2 c) { return texelFetch(uB, c, 0).x; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 d = uAxis == 0 ? ivec2(1, 0) : ivec2(0, 1);
  int n = uAxis == 0 ? uN.x : uN.y;
  int i = uAxis == 0 ? p.x : p.y;
  vec4 sl, sr; float bl, br;
  if (i == 0) {
    sr = texelFetch(uS, p, 0); br = bedAt(p);
    bool open = (uAxis == 0 ? uBC.x : uBC.z) == 1;
    sl = sr; bl = (open && n > 1) ? 2.0 * br - bedAt(p + d) : br;
    if (!open) { if (uAxis == 0) sl.y = -sl.y; else sl.z = -sl.z; }
  } else if (i == n) {
    sl = texelFetch(uS, p - d, 0); bl = bedAt(p - d);
    bool open = (uAxis == 0 ? uBC.y : uBC.w) == 1;
    sr = sl; br = (open && n > 1) ? 2.0 * bl - bedAt(p - d - d) : bl;
    if (!open) { if (uAxis == 0) sr.y = -sr.y; else sr.z = -sr.z; }
  } else {
    sl = texelFetch(uS, p - d, 0); bl = bedAt(p - d);
    sr = texelFetch(uS, p, 0); br = bedAt(p);
  }
  float ql = uAxis == 0 ? sl.y : sl.z, tl = uAxis == 0 ? sl.z : sl.y;
  float qr = uAxis == 0 ? sr.y : sr.z, tr = uAxis == 0 ? sr.z : sr.y;
  float unL = velo(sl.x, ql), utL = velo(sl.x, tl), unR = velo(sr.x, qr), utR = velo(sr.x, tr);
  float hL = sl.x, hR = sr.x;
  if (uNaive == 0) { float bm = max(bl, br); hL = max(sl.x + bl - bm, 0.0); hR = max(sr.x + br - bm, 0.0); }
  o = vec4(hll(hL, unL, utL, hR, unR, utR), 0.0);
}`;

const UPDATE = COMMON + `
uniform sampler2D uS; uniform sampler2D uB; uniform sampler2D uFX; uniform sampler2D uFY;
uniform ivec2 uN; uniform ivec4 uBC; uniform float uG; uniform float uR; uniform float uDt; uniform float uDx; uniform int uNaive;
uniform int uNSrc; uniform ivec4 uSrc[4]; uniform float uSrcDh[4];
uniform int uNCv; uniform ivec4 uCvA[4]; uniform ivec4 uCvB[4]; uniform vec2 uCvP[4];
out vec4 o;
bool inRect(ivec2 c, ivec4 r) { return c.x >= r.x && c.y >= r.y && c.x <= r.z && c.y <= r.w; }
float bedAt(ivec2 c) { return texelFetch(uB, c, 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = c.x, j = c.y, nx = uN.x, ny = uN.y;
  vec4 s = texelFetch(uS, c, 0); vec4 bb = texelFetch(uB, c, 0);
  float hk = s.x, bk = bb.x, man = bb.y;
  vec4 fxw = texelFetch(uFX, c, 0), fxe = texelFetch(uFX, c + ivec2(1, 0), 0);
  vec4 fys = texelFetch(uFY, c, 0), fyn = texelFetch(uFY, c + ivec2(0, 1), 0);
  float src = 0.0;
  for (int k = 0; k < 4; k++) { if (k >= uNSrc) break; if (inRect(c, uSrc[k])) src += uSrcDh[k]; }
  for (int k = 0; k < 4; k++) {
    if (k >= uNCv) break;
    bool inA = inRect(c, uCvA[k]), inB = inRect(c, uCvB[k]);
    if (!(inA || inB)) continue;
    ivec4 A = uCvA[k], B = uCvB[k];
    float ea = 0.0, eb = 0.0, ha = 0.0, hb = 0.0;
    for (int y = A.y; y <= A.w; y++) for (int x = A.x; x <= A.z; x++) { ivec2 q = ivec2(x, y); float hq = texelFetch(uS, q, 0).x; ea += hq + bedAt(q); ha += hq; }
    for (int y = B.y; y <= B.w; y++) for (int x = B.x; x <= B.z; x++) { ivec2 q = ivec2(x, y); float hq = texelFetch(uS, q, 0).x; eb += hq + bedAt(q); hb += hq; }
    float na = float((A.z - A.x + 1) * (A.w - A.y + 1)), nb = float((B.z - B.x + 1) * (B.w - B.y + 1));
    ea /= na; eb /= nb;
    float dd = ea - eb;
    float q = uCvP[k].y * uCvP[k].x * sqrt((tw(16) ? 1.0 : 2.0) * uG * abs(dd));
    float cap = 0.25 * (dd > 0.0 ? ha : hb) * uDx * uDx / uDt;
    q = min(q, cap);
    if (dd < 0.0) q = -q;
    if (inA) src -= q * uDt / (na * uDx * uDx);
    if (inB) src += q * uDt / (nb * uDx * uDx);
  }
  float half_ = tw(2) ? 1.0 : 0.5;
  float bw = i > 0 ? bedAt(c - ivec2(1, 0)) : (uBC.x == 1 && nx > 1 ? 2.0 * bk - bedAt(c + ivec2(1, 0)) : bk);
  float be = i < nx - 1 ? bedAt(c + ivec2(1, 0)) : (uBC.y == 1 && nx > 1 ? 2.0 * bk - bedAt(c - ivec2(1, 0)) : bk);
  float bs = j > 0 ? bedAt(c - ivec2(0, 1)) : (uBC.z == 1 && ny > 1 ? 2.0 * bk - bedAt(c + ivec2(0, 1)) : bk);
  float bn = j < ny - 1 ? bedAt(c + ivec2(0, 1)) : (uBC.w == 1 && ny > 1 ? 2.0 * bk - bedAt(c - ivec2(0, 1)) : bk);
  float hn = hk - uR * (fxe.x - fxw.x) - uR * (fyn.x - fys.x) + src;
  float un, vn;
  if (uNaive == 1) {
    un = s.y - uR * (fxe.y - fxw.y) - uR * (fyn.z - fys.z) - uDt * uG * hk * (be - bw) / (2.0 * uDx);
    vn = s.z - uR * (fxe.z - fxw.z) - uR * (fyn.y - fys.y) - uDt * uG * hk * (bn - bs) / (2.0 * uDx);
  } else {
    float he = rec(hk, bk, be), hw = rec(hk, bk, bw), hN = rec(hk, bk, bn), hs = rec(hk, bk, bs);
    float pe = half_ * uG * he * he, pw = half_ * uG * hw * hw, pn = half_ * uG * hN * hN, ps = half_ * uG * hs * hs;
    un = s.y - uR * ((fxe.y - pe) - (fxw.y - pw)) - uR * (fyn.z - fys.z);
    vn = s.z - uR * ((fyn.y - pn) - (fys.y - ps)) - uR * (fxe.z - fxw.z);
  }
  if (hn < 0.0) hn = 0.0;
  if (tw(4) && hn < DRY) hn = 0.0;
  if (hn < DRY) { float u = velo(hn, un), v = velo(hn, vn); un = hn * u; vn = hn * v; }
  else if (man > 0.0) {
    float u = un / hn, v = vn / hn, sp = sqrt(u * u + v * v);
    float h43 = tw(8) ? hn : hn * pow(hn, 1.0 / 3.0);
    float f = 1.0 + uDt * uG * man * man * sp / h43;
    un /= f; vn /= f;
  }
  o = vec4(hn, un, vn, max(s.w, hn));
}`;

// outflow through the open sides this step, written to texel (uK, 0) of OUT
const OUTFLOW = COMMON + `
uniform sampler2D uFX; uniform sampler2D uFY; uniform ivec2 uN; uniform ivec4 uBC; uniform float uScale;
out vec4 o;
void main() {
  float s = 0.0;
  if (uBC.x == 1) for (int j = 0; j < uN.y; j++) s -= texelFetch(uFX, ivec2(0, j), 0).x;
  if (uBC.y == 1) for (int j = 0; j < uN.y; j++) s += texelFetch(uFX, ivec2(uN.x, j), 0).x;
  if (uBC.z == 1) for (int i = 0; i < uN.x; i++) s -= texelFetch(uFY, ivec2(i, 0), 0).x;
  if (uBC.w == 1) for (int i = 0; i < uN.x; i++) s += texelFetch(uFY, ivec2(i, uN.y), 0).x;
  o = vec4(s * uScale, 0.0, 0.0, 0.0);
}`;

// reduction: level 0 reads the state (sum h, max(|u|+c), max |u|, wet count); later levels combine 2 x 2 blocks
const REDUCE = COMMON + `
uniform sampler2D uIn; uniform ivec2 uInN; uniform int uFirst; uniform float uG;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 2;
  vec4 acc = vec4(0.0);
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    ivec2 q = c + ivec2(x, y);
    if (q.x >= uInN.x || q.y >= uInN.y) continue;
    vec4 v = texelFetch(uIn, q, 0);
    if (uFirst == 1) {
      float h = v.x;
      if (h > DRY) { float u = v.y / h, w = v.z / h, cc = sqrt(uG * h); v = vec4(h, max(abs(u), abs(w)) + cc, sqrt(u * u + w * w), 1.0); }
      else v = vec4(h, 0.0, 0.0, 0.0);
    }
    acc.x += v.x; acc.y = max(acc.y, v.y); acc.z = max(acc.z, v.z); acc.w += v.w;
  }
  o = acc;
}`;

export function createGpuSolver(o) {
  const nx = o.nx, ny = o.ny, N = nx * ny, dx = o.dx, g = o.g ?? 9.81;
  const canvas = o.canvas || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available (float render targets)');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, k) => k + 1 + ': ' + l).join('\n')); return s; }
  const vs = shader(gl.VERTEX_SHADER, VS);
  function program(fs) {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const info = gl.getActiveUniform(p, k); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const P = { flux: program(FLUX), update: program(UPDATE), out: program(OUTFLOW), reduce: program(REDUCE) };
  const vao = gl.createVertexArray();

  function tex(w, h, data) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data || null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float framebuffer incomplete: 0x' + st.toString(16));
    return { t, fb, w, h };
  }
  const pack = (a, b, c, d) => { const out = new Float32Array(N * 4); for (let k = 0; k < N; k++) { out[4 * k] = a ? a[k] : 0; out[4 * k + 1] = b ? b[k] : 0; out[4 * k + 2] = c ? c[k] : 0; out[4 * k + 3] = d ? d[k] : 0; } return out; };
  const h0 = o.h || new Float64Array(N);
  const S = [tex(nx, ny, pack(h0, o.hu, o.hv, h0)), tex(nx, ny, null)];
  const man = typeof o.manning === 'number' || o.manning == null ? new Float64Array(N).fill(o.manning || 0) : o.manning;
  const B = tex(nx, ny, pack(o.bed, man, null, null));
  const FX = tex(nx + 1, ny), FY = tex(nx, ny + 1);
  const OUTN = 256, OUT = tex(OUTN, 1);
  const R = []; { let w = nx, h = ny; do { w = Math.ceil(w / 2); h = Math.ceil(h / 2); R.push(tex(w, h)); } while (w > 1 || h > 1); }

  const bcv = (s) => (s === 'open' ? 1 : 0);
  const bc = { w: 'wall', e: 'wall', s: 'wall', n: 'wall', ...(o.bc || {}) };
  const BC = [bcv(bc.w), bcv(bc.e), bcv(bc.s), bcv(bc.n)];
  let twinBits = 0; for (const [k, v] of Object.entries(o.twins || {})) if (v) twinBits |= TW[k];
  const sources = (o.sources || []).map((s) => ({ ...s, rect: s.rect || cellsToRect(s.cells, nx) }));
  const culverts = o.culverts || [];
  const st = {
    nx, ny, dx, g, dt: o.dt, t: 0, n: 0, naive: o.scheme === 'naive', renderer, gl, canvas,
    inflow: 0, outflow: 0, pendingOut: 0, cur: 0, culverts, sources,
  };

  function bindTex(prog, name, unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.t); gl.uniform1i(prog.u[name], unit); }
  function target(t, x = 0, y = 0, w = t.w, h = t.h) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(x, y, w, h); }
  function draw() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  function step() {
    const dt = st.dt, src = S[st.cur], dst = S[1 - st.cur];
    // x and y fluxes
    gl.useProgram(P.flux.p);
    bindTex(P.flux, 'uS', 0, src); bindTex(P.flux, 'uB', 1, B);
    gl.uniform2i(P.flux.u.uN, nx, ny); gl.uniform4i(P.flux.u.uBC, ...BC); gl.uniform1f(P.flux.u.uG, g);
    gl.uniform1i(P.flux.u.uNaive, st.naive ? 1 : 0); gl.uniform1i(P.flux.u.uTw, twinBits);
    gl.uniform1i(P.flux.u.uAxis, 0); target(FX); draw();
    gl.uniform1i(P.flux.u.uAxis, 1); target(FY); draw();
    // update
    const U = P.update; gl.useProgram(U.p);
    bindTex(U, 'uS', 0, src); bindTex(U, 'uB', 1, B); bindTex(U, 'uFX', 2, FX); bindTex(U, 'uFY', 3, FY);
    gl.uniform2i(U.u.uN, nx, ny); gl.uniform4i(U.u.uBC, ...BC); gl.uniform1f(U.u.uG, g);
    gl.uniform1f(U.u.uR, dt / dx); gl.uniform1f(U.u.uDt, dt); gl.uniform1f(U.u.uDx, dx);
    gl.uniform1i(U.u.uNaive, st.naive ? 1 : 0); gl.uniform1i(U.u.uTw, twinBits);
    const rects = new Int32Array(16), dhs = new Float32Array(4);
    sources.forEach((s, k) => {
      const q = s.q(st.t), n = (s.rect[2] - s.rect[0] + 1) * (s.rect[3] - s.rect[1] + 1);
      rects.set(s.rect, 4 * k); dhs[k] = (q * dt) / (n * dx * dx);
      st.inflow += dhs[k] * n * dx * dx;              // what the GPU was told to add (the float32 increment)
    });
    gl.uniform1i(U.u.uNSrc, sources.length); if (sources.length) { gl.uniform4iv(U.u.uSrc, rects); gl.uniform1fv(U.u.uSrcDh, dhs); }
    const ca = new Int32Array(16), cb = new Int32Array(16), cp = new Float32Array(8);
    culverts.forEach((c, k) => { ca.set(c.a, 4 * k); cb.set(c.b, 4 * k); cp[2 * k] = c.area; cp[2 * k + 1] = c.cd; });
    gl.uniform1i(U.u.uNCv, culverts.length);
    if (culverts.length) { gl.uniform4iv(U.u.uCvA, ca); gl.uniform4iv(U.u.uCvB, cb); gl.uniform2fv(U.u.uCvP, cp); }
    target(dst); draw();
    // outflow of this step into its own texel of OUT
    if (BC.some((v) => v)) {
      if (st.pendingOut === OUTN) flushOut();
      gl.useProgram(P.out.p); bindTex(P.out, 'uFX', 0, FX); bindTex(P.out, 'uFY', 1, FY);
      gl.uniform2i(P.out.u.uN, nx, ny); gl.uniform4i(P.out.u.uBC, ...BC); gl.uniform1f(P.out.u.uScale, dt * dx); gl.uniform1i(P.out.u.uTw, 0);
      target(OUT, st.pendingOut, 0, 1, 1); draw();
      st.pendingOut++;
    }
    st.cur = 1 - st.cur; st.t += dt; st.n++;
  }
  const outBuf = new Float32Array(OUTN * 4);
  function flushOut() {
    if (!st.pendingOut) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, OUT.fb);
    gl.readPixels(0, 0, st.pendingOut, 1, gl.RGBA, gl.FLOAT, outBuf);
    for (let k = 0; k < st.pendingOut; k++) st.outflow += outBuf[4 * k];
    st.pendingOut = 0;
  }
  const stateBuf = new Float32Array(N * 4);
  /** Read the state back: { h, hu, hv, hmax } as Float32Array views over one buffer (copied out). */
  function read() {
    flushOut();
    gl.bindFramebuffer(gl.FRAMEBUFFER, S[st.cur].fb);
    gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, stateBuf);
    return stateBuf;
  }
  function readArrays() {
    const s = read(), h = new Float64Array(N), hu = new Float64Array(N), hv = new Float64Array(N), hmax = new Float64Array(N);
    for (let k = 0; k < N; k++) { h[k] = s[4 * k]; hu[k] = s[4 * k + 1]; hv[k] = s[4 * k + 2]; hmax[k] = s[4 * k + 3]; }
    return { h, hu, hv, hmax };
  }
  /** The reduction pass: { volume (float32 tree sum x dx^2), maxWave, maxU, wet, courant }. */
  const redBuf = new Float32Array(4);
  function reduce() {
    gl.useProgram(P.reduce.p); gl.uniform1f(P.reduce.u.uG, g); gl.uniform1i(P.reduce.u.uTw, 0);
    let input = S[st.cur], w = nx, h = ny;
    R.forEach((r, k) => {
      bindTex(P.reduce, 'uIn', 0, input); gl.uniform2i(P.reduce.u.uInN, w, h); gl.uniform1i(P.reduce.u.uFirst, k === 0 ? 1 : 0);
      target(r); draw(); input = r; w = r.w; h = r.h;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, R[R.length - 1].fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, redBuf);
    return { volume: redBuf[0] * dx * dx, maxWave: redBuf[1], maxU: redBuf[2], wet: redBuf[3], courant: (redBuf[1] * st.dt) / dx };
  }
  function setBed(bed, manning) {
    const m = manning || man;
    gl.bindTexture(gl.TEXTURE_2D, B.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.FLOAT, pack(bed, m, null, null));
  }
  function setState(h, hu, hv) {
    gl.bindTexture(gl.TEXTURE_2D, S[st.cur].t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.FLOAT, pack(h, hu, hv, h));
  }
  function finish() { gl.finish(); }
  function destroy() { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
  Object.assign(st, { step, run(n) { for (let k = 0; k < n; k++) step(); }, read, readArrays, reduce, setBed, setState, finish, flushOut, destroy, setNaive(v) { st.naive = !!v; } });
  return st;
}

function cellsToRect(cells, nx) {
  let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
  for (const k of cells) { const i = k % nx, j = (k - i) / nx; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  if ((i1 - i0 + 1) * (j1 - j0 + 1) !== cells.length) throw new Error('GPU sources must be rectangles of cells');
  return [i0, j0, i1, j1];
}
