/* Gobbler Gyroscope v4: the Ouroboros.
   A serpent of data circles the gyroscope and bites its own tail. Read it tail to head:
     tail  RAW         what the Scout sweeps, unstructured (feeds, releases, the project's own commits)
     belly STRUCTURED  proposals and woven X3D fragments, typed records in a lattice
     gate  ASSAYER     the Witness refuses, the Assayer checks each cycle against the theses it can test
     spine KNOWLEDGE   admitted entries: beads on the hash chain; the Loom's laws and failure modes
     lens  SCI-VIZ     the Blender sci-viz agent turns knowledge into rendered pictures (staged: runs by hand today)
     neck  ACTION      fold-back drafts, PRs, rules
     head  FOLD-BACK   the head closes on the tail: the outputs are the next turn's raw input
   Two smaller serpents are nested at the bite, each inside the last one's mouth: the same loop at the next scale.

   Drawn by one WebGL2 canvas laid over the swarm (additive, alpha 0), using the swarm's own camera, so it works the
   same over the WebGPU swarm and the WebGL2 fallback. Particle density is a picture, not a count: the counts are on the
   labels and in the panel, each with its source (ouro/data.json, built by source/ouro_data.py from recorded files). */
(() => {
  'use strict';
  const S = window.GobblerSwarm, M = window.GobblerSwarmModel, mat = S.mat;
  const N0 = 60000, HOOPS = 1400, LEVELS = [0.72, 0.20, 0.08], RADIUS = 5.0, CHILD = 0.34;
  // phase bounds along the body, s in [0, 1): tail tip, raw, structured, gate, knowledge, lens, action, head
  const PH = { tip: 0.035, raw: 0.26, struct: 0.455, gate: 0.50, know: 0.715, lens: 0.785, act: 0.935 };
  const STATIONS = [
    { k: 'raw', s: 0.15, name: 'RAW', sub: 'unstructured' }, { k: 'struct', s: 0.36, name: 'STRUCTURED', sub: 'typed records' },
    { k: 'assay', s: 0.478, name: 'ASSAYER', sub: 'weighed' }, { k: 'know', s: 0.61, name: 'KNOWLEDGE', sub: 'admitted' },
    { k: 'sciviz', s: 0.75, name: 'BLENDER SCI-VIZ', sub: 'rendered' }, { k: 'act', s: 0.86, name: 'ACTION', sub: 'fold-back drafts' },
    { k: 'bite', s: 0.985, name: 'FOLD-BACK', sub: 'head eats tail' },
  ];

  const VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed;   // x phase, y speed jitter, z disk angle, w disk radius / survival draw
layout(location=1) in vec2 aKind;   // x level (0..2) or 3 = station hoop, y aux
uniform mat4 uVP; uniform mat4 uL[3]; uniform float uT, uPx, uRefuse, uKeep, uPulse, uHold; uniform vec4 uMix; // class proportions (cumulative)
out vec4 vCol;
const float TAU = 6.2831853;
float sst(float a, float b, float x) { return smoothstep(a, b, x); }
float band(float a, float b, float w, float x) { return sst(a - w, a + w, x) * (1.0 - sst(b - w, b + w, x)); }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  int lv = int(aKind.x + 0.5);
  if (lv == 3) {                                   // station hoops: the Assayer's gate and the sci-viz lens
    float th = TAU * aKind.y, a = aSeed.z * TAU, r = aSeed.w;
    vec3 c = vec3(cos(th), sin(th), 0.0), rad = c, up = vec3(0.0, 0.0, 1.0);
    vec3 p = c + (rad * cos(a) + up * sin(a)) * r;
    gl_Position = uVP * uL[0] * vec4(p, 1.0);
    float tw = 0.6 + 0.4 * sin(uT * 3.0 + a * 9.0);
    vCol = vec4(mix(vec3(1.0, 0.86, 0.5), vec3(0.6, 0.85, 1.0), step(0.6, aKind.y)) * tw * (0.35 + uPulse * step(aKind.y, 0.6)), 1.0);
    gl_PointSize = max(1.5, uPx * 0.05 / gl_Position.w);
    return;
  }
  float speed = 0.021 * (0.75 + 0.5 * aSeed.y);
  float s = fract(aSeed.x + uT * speed);
  // the neck runs fast: remap so particles hurry through ACTION and linger in RAW
  float wRaw = band(${PH.tip}, ${PH.raw}, 0.02, s), wStr = band(${PH.raw}, ${PH.struct}, 0.02, s), wGate = band(${PH.struct}, ${PH.gate}, 0.012, s);
  float wKnow = band(${PH.gate}, ${PH.know}, 0.02, s), wLens = band(${PH.know}, ${PH.lens}, 0.015, s), wAct = band(${PH.lens}, ${PH.act}, 0.02, s);
  float wHead = sst(${PH.act} - 0.015, ${PH.act} + 0.02, s), wTip = 1.0 - sst(0.0, ${PH.tip} + 0.02, s);
  float ang = aSeed.z * TAU, rr = sqrt(aSeed.w);
  vec2 disk = vec2(cos(ang), sin(ang)) * rr;
  // RAW: a wide, restless cloud
  float n1 = sin(uT * 1.7 + aSeed.x * 91.0) + sin(uT * 2.9 + aSeed.y * 57.0), n2 = cos(uT * 2.1 + aSeed.z * 73.0) + sin(uT * 1.3 + aSeed.w * 39.0);
  vec2 oRaw = disk * 0.16 + vec2(n1, n2) * 0.028;
  // STRUCTURED: the same particles snapped to a lattice, marching in rows
  vec2 oStr = (floor(disk * 3.0 + 0.5) / 3.0) * 0.105;
  float sq = floor(s * 220.0 + 0.5) / 220.0;
  // KNOWLEDGE: beads (entries on the chain), each a small cluster; a thread between them
  float bead = 0.0215, bc = (floor(s / bead) + 0.5) * bead, bf = (s - bc) / bead;
  float pearl = sqrt(max(0.0, 1.0 - 4.0 * bf * bf));
  vec2 oKnow = disk * 0.085 * pearl * step(0.25, aSeed.y) ;
  float sKnow = mix(bc + bf * bead * 0.55, s, step(aSeed.y, 0.25));
  // LENS: the bead stream fans into a spectrum and gathers again
  float lf = clamp((s - ${PH.know}) / (${PH.lens} - ${PH.know}), 0.0, 1.0), fan = sin(lf * 3.14159);
  vec2 oLens = vec2(cos(ang), sin(ang)) * (0.03 + 0.15 * fan * (0.3 + 0.7 * fract(aSeed.w * 7.0)));
  // ACTION: a tight double helix, fast
  float strand = step(0.5, aSeed.w) * 3.14159, hk = s * 260.0 - uT * 5.0;
  vec2 oAct = vec2(cos(hk + strand), sin(hk + strand)) * 0.035 + disk * 0.008;
  // HEAD: a hollow shell opening around the tail tip (two jaws)
  float hf = clamp((s - ${PH.act}) / (1.0 - ${PH.act}), 0.0, 1.0);
  float jaw = 0.035 + 0.135 * sin(hf * 2.4) + 0.02 * sin(uT * 2.0) * hf;
  vec2 jd = vec2(cos(ang), sin(ang)); jd.y = sign(jd.y) * max(abs(jd.y), 0.28);
  vec2 oHead = normalize(jd) * jaw * (0.85 + 0.15 * rr);
  vec2 oTip = disk * 0.018;
  vec2 oGate = disk * 0.02;
  float wsum = wRaw + wStr + wGate + wKnow + wLens + wAct + wHead + wTip + 1e-4;
  vec2 off = (oRaw * wRaw + oStr * wStr + oGate * wGate + oKnow * wKnow + oLens * wLens + oAct * wAct + oHead * wHead + oTip * wTip) / wsum;
  float sPos = mix(s, sq, wStr * 0.85); sPos = mix(sPos, sKnow, wKnow);
  // survival: most raw items are set aside before they become a signal; refused weaves are thrown off at the gate
  float alive = 1.0, drawA = fract(aSeed.w * 13.37 + aSeed.x * 7.1);
  float drop = step(uKeep, drawA) * sst(${PH.raw} - 0.03, ${PH.raw} + 0.03, s);                    // set aside by the Scout
  float refused = step(drawA, uKeep * uRefuse) * sst(${PH.struct} + 0.01, ${PH.gate}, s);        // refused at the gate
  float held = step(uKeep * uRefuse, drawA) * step(drawA, uKeep * (uRefuse + uHold)) * sst(${PH.gate}, ${PH.gate} + 0.02, s);
  float eject = 0.0;
  if (drop > 0.0) { eject = sst(${PH.raw} - 0.03, ${PH.raw} + 0.09, s); off = oRaw * (1.0 + 2.2 * eject); alive = 1.0 - eject; sPos = s; }
  if (refused > 0.0) { eject = sst(${PH.struct} + 0.01, ${PH.gate} + 0.05, s); off = vec2(cos(ang), sin(ang)) * (0.02 + 0.42 * eject); alive = 1.0 - sst(0.55, 1.0, eject); sPos = ${PH.gate} - 0.012 - 0.07 * eject; }
  if (held > 0.0) { eject = sst(${PH.gate}, ${PH.gate} + 0.08, s); off = vec2(cos(ang), -abs(sin(ang))) * (0.02 + 0.3 * eject); alive = 1.0 - eject; sPos = ${PH.gate}; }
  if (drop > 0.0 && s > ${PH.raw} + 0.09) alive = 0.0;
  if (refused > 0.0 && s > ${PH.gate} + 0.05) alive = 0.0;
  if (held > 0.0 && s > ${PH.gate} + 0.08) alive = 0.0;
  float th = TAU * sPos;
  vec3 c = vec3(cos(th), sin(th), 0.0), up = vec3(0.0, 0.0, 1.0);
  vec3 p = c * (1.0 + off.x) + up * off.y;
  gl_Position = uVP * uL[lv] * vec4(p, 1.0);
  // colour
  float cls = fract(aSeed.y * 31.7);
  vec3 cRaw = cls < uMix.x ? vec3(0.55, 0.95, 0.95) : cls < uMix.y ? vec3(0.95, 0.6, 0.95) : cls < uMix.z ? vec3(0.95, 0.75, 0.4) : cls < uMix.w ? vec3(1.0, 0.45, 0.35) : vec3(0.45, 0.48, 0.58);
  cRaw *= 0.75 + 0.6 * fract(aSeed.z * 17.0);
  vec3 cStr = vec3(0.30, 0.86, 1.0), cGate = vec3(1.0, 0.97, 0.9), cKnow = vec3(1.0, 0.78, 0.32), cAct = vec3(1.0, 0.96, 0.82), cHead = vec3(0.62, 1.0, 0.5);
  vec3 cLens = mix(cKnow, hue(fract(aSeed.w * 7.0) * 0.8), fan);
  vec3 col = (cRaw * (wRaw + wTip) + cStr * wStr + cGate * wGate * 1.6 + cKnow * wKnow + cLens * wLens * 1.2 + cAct * wAct * 1.3 + mix(cAct, cHead, hf) * wHead) / wsum;
  if (refused > 0.0) col = mix(col, vec3(1.0, 0.2, 0.14), sst(0.0, 0.3, eject)) * 1.5;
  if (held > 0.0) col = vec3(0.9, 0.1, 0.35) * 1.5;
  if (drop > 0.0) col *= 0.6;
  float thread = step(aSeed.y, 0.25) * wKnow;                       // the chain between beads is thin and dim
  float bright = (0.62 + 0.55 * wAct + 0.35 * wHead + 0.3 * wGate + 0.22 * wKnow + 0.1 * wStr - 0.2 * thread) * alive;
  float lvDim = lv == 0 ? 1.0 : (lv == 1 ? 1.25 : 1.4);
  vCol = vec4(col * bright * lvDim, 1.0);
  float size = (0.058 + 0.02 * wRaw + 0.03 * wKnow * pearl + 0.012 * wHead - 0.012 * wAct) * (lv == 0 ? 1.0 : (lv == 1 ? ${CHILD} * 1.9 : ${CHILD * CHILD} * 3.4));
  gl_PointSize = clamp(uPx * size / gl_Position.w, 1.2, 26.0) * step(0.001, alive);
}`;
  const FS = `#version 300 es
precision highp float; in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d); if (r > 1.0) discard; float a = exp(-r * 4.5) + 0.35 * exp(-r * 22.0); o = vec4(vCol.rgb * a, 0.0); }`;

  let cv = null, gl = null, prog = null, U = {}, count = 0, t0 = performance.now(), L = [mat.ident(), mat.ident(), mat.ident()], data = null, on = true;
  const O = window.GobblerOuroboros = { ready: false, PH, STATIONS, RADIUS, error: null, frames: 0,
    opts: { intensity: 1, speed: 1, levels: 3 } };

  function scale(s) { const m = mat.ident(); m[0] = m[5] = m[10] = s; return m; }
  function levelMatrices(t) {
    // level 0: a ring about the gyroscope's centre, tilted like a planet's ring, precessing slowly
    const tilt = 0.12 + 0.04 * Math.sin(t * 0.11), prec = 0.0;
    let m = mat.trans(S.CENTER);
    m = mat.mul(m, mat.rot([0, 1, 0], prec));
    m = mat.mul(m, mat.rot([1, 0, 0], -Math.PI / 2 + tilt));
    m = mat.mul(m, mat.rot([0, 0, 1], t * 0.012));
    L[0] = mat.mul(m, scale(RADIUS));
    // each child sits at its parent's bite (local 1, 0, 0), turned out of the parent's plane and spinning the other way
    for (let k = 1; k < 3; k++) {
      let c = mat.mul(L[k - 1], mat.trans([1, 0, 0]));
      c = mat.mul(c, mat.rot([0, 1, 0], 1.15));
      c = mat.mul(c, mat.rot([0, 0, 1], -t * (0.08 + 0.05 * k) + k));
      L[k] = mat.mul(c, scale(CHILD));
    }
    return L;
  }
  O.stationPoint = (s, level = 0, lift = 0) => {
    const th = Math.PI * 2 * s, p = [Math.cos(th) * (1 + lift), Math.sin(th) * (1 + lift), 0];
    const w = mat.apply(L[level], p); return S.worldPoint ? S.worldPoint(w.slice(0, 3)).slice(0, 3) : w.slice(0, 3);
  };

  function build() {
    const n = N0, total = n + HOOPS, seed = new Float32Array(total * 4), kind = new Float32Array(total * 2);
    let r = 0x2545f491; const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
    for (let i = 0; i < n; i++) {
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      const u = i / n; kind[i * 2] = u < LEVELS[0] ? 0 : (u < LEVELS[0] + LEVELS[1] ? 1 : 2);
    }
    for (let j = 0; j < HOOPS; j++) {
      const i = n + j, lens = j >= HOOPS / 2;
      seed.set([rnd(), rnd(), (j % (HOOPS / 2)) / (HOOPS / 2), lens ? 0.2 : 0.085], i * 4);
      kind[i * 2] = 3; kind[i * 2 + 1] = lens ? 0.75 : 0.478;
    }
    count = total;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    for (const [loc, arr, sz] of [[0, seed, 4], [1, kind, 2]]) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0); }
    return vao;
  }
  function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('ouro shader: ' + gl.getShaderInfoLog(s)); return s; }

  O.start = async (host, { before, dataUrl = 'ouro/data.json' } = {}) => {
    try {
      data = O.data = await fetch(dataUrl).then((r) => r.json());
      cv = document.createElement('canvas'); cv.id = 'ouro-canvas';
      if (before) host.insertBefore(cv, before); else host.appendChild(cv);
      gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
      if (!gl) throw Error('no WebGL2 for the Ouroboros layer');
      prog = gl.createProgram(); gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error('ouro link: ' + gl.getProgramInfoLog(prog));
      for (const k of ['uVP', 'uL', 'uT', 'uPx', 'uRefuse', 'uKeep', 'uPulse', 'uHold', 'uMix']) U[k] = gl.getUniformLocation(prog, k);
      O.vao = build(); O.ready = true; requestAnimationFrame(frame);
      window.dispatchEvent(new CustomEvent('gobbler:ouro-ready'));
    } catch (e) { O.error = String(e && e.message || e); console.warn('[ouroboros]', O.error); }
    return O;
  };
  O.toggle = (v) => { on = v === undefined ? !on : !!v; if (cv) cv.style.display = on ? '' : 'none'; document.body.classList.toggle('ouro-off', !on); };
  O.isOn = () => on;

  let pulse = 0, lastCommit = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!on || !S.cam || !S.canvas) return;
    const ref = S.canvas, dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(ref.clientWidth * dpr), h = Math.round(ref.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const t = (now - t0) / 1000 * O.opts.speed;
    levelMatrices(t);
    const world = S.worldMatrix ? S.worldMatrix() : mat.ident(), vp = mat.mul(S.cam.vp, world);
    // live fractions from the swarm's own counters: refused share of verdicts, held share (Chaos only)
    const k = S.kpi, C = M.C, hl = S.hist && S.hist[S.hist.length - 1];
    let refuse = data.cycle.refused / data.cycle.verdicts, hold = 0;
    if (hl) { const c = hl.c, v = c[C.PASS] + c[C.REFUSED]; if (v > 200) refuse = c[C.REFUSED] / v; if (c[C.PASS] > 200) hold = c[C.HOLD] / c[C.PASS]; }
    if (k && k.commits !== lastCommit) { pulse = 1; lastCommit = k.commits; } pulse *= 0.93;
    const rc = data.cycle.raw_by_class, tot = data.cycle.raw_items, cum = []; let a = 0;
    for (const key of ['x3d', 'adjacent', 'x3d-video-net', 'amd-x3d']) { a += (rc[key] || 0) / tot; cum.push(a); }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(prog); gl.bindVertexArray(O.vao);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    const flat = new Float32Array(48); L.forEach((m, i) => flat.set(m, i * 16)); gl.uniformMatrix4fv(U.uL, false, flat);
    gl.uniform1f(U.uT, t); gl.uniform1f(U.uPx, h * O.opts.intensity);
    gl.uniform1f(U.uRefuse, Math.min(0.9, refuse)); gl.uniform1f(U.uHold, Math.min(0.5, hold)); gl.uniform1f(U.uKeep, 0.5); gl.uniform1f(U.uPulse, 0.4 + pulse);
    gl.uniform4f(U.uMix, cum[0], cum[1], cum[2], cum[3]);
    gl.drawArrays(gl.POINTS, 0, count);
    O.frames++; O.live = { refuse, hold };
  }
})();
