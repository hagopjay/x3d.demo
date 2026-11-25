/* Gobbler Gyroscope v5: the Gobbler returns, and the picture carries more.
   Three additions on top of the v4 serpent, all drawn on the serpent's own WebGL2 canvas (GobblerOuroboros.extra):
     1. THE GOBBLER. The serpent's head is the bird itself: the glass mascot's own X3D faces drawn as additive glass
        (brighter at grazing angles), with point shells for its gems, heart and eyes (ouro/gobbler.bin, built by
        source/gobbler_points.py). Its head sits on the ring where the head bites the tail;
        its fan is the frontier board, one feather and one gem per frontier.
     2. THE LANES. Every organ, eye and bridge the owner named on 25 Nov 2026, plus the ones already in the repos, is a
        small moon outside the serpent at the place where it feeds in, with a stream of particles running inward.
        Colour and stream density are the lane's GRADE: live, built, touched, planned, envisioned. A grade is a claim
        about the repos, and each one names its evidence in ouro/data.json (the build fails if a path is missing).
     3. THE BOARD. A panel that lists every lane with its grade, its frontier-board rank and one fact, a fact strip
        with the Loom's counts, and per-repo commit sparklines.
   Stream density is a picture of the grade, not a measured flow: no lane has a live counter except the three marked
   live, whose numbers are on the Ouroboros panel. */
(() => {
  'use strict';
  const S = window.GobblerSwarm, O = window.GobblerOuroboros, mat = S.mat;
  const GRADES = ['live', 'built', 'touched', 'planned', 'envisioned'];
  const GCOL = { live: '#9ef275', built: '#57dbf5', touched: '#ffc24d', planned: '#c9a6ff', envisioned: '#8a93a8' };
  const GRGB = { live: [0.62, 0.95, 0.46], built: [0.34, 0.86, 0.96], touched: [1.0, 0.76, 0.3], planned: [0.79, 0.65, 1.0], envisioned: [0.5, 0.55, 0.68] };
  const GTEXT = { live: 'runs inside the recorded Gobbler graph', built: 'code and receipts in a public repo', touched: 'first evidence only',
    planned: 'on the frontier board, first step written, not started', envisioned: 'the owner\'s vision of 25 Nov 2026, not started' };
  const STREAM_N = { live: 520, built: 340, touched: 190, planned: 100, envisioned: 54 }, MOON_N = 90;
  const GROUPS = [['bridge', 'Bridges and data', 'feed the raw tail'], ['structure', 'Structure', 'make it typed'], ['gate', 'The gate', 'weigh it'],
    ['memory', 'Memory', 'keep it'], ['eyes', 'Eyes', 'see it'], ['hands', 'Hands', 'act on it']];
  const RM = 1.23, BIRD_SCALE = 0.042, HEAD = [0, 7.15, 3.0], BIRD_S = 0.992;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (x) => Math.round(x).toLocaleString('en-US');

  O.opts.turn = 0;         // v6: v4's own arrangement (thin knowledge beads in front of the wheels, the raw cloud behind); the bird stands at the bite on the far right, seen from behind its fan
  const V5 = window.GobblerV5 = { ready: false, error: null, GRADES, GCOL, opts: { bird: true, lanes: true }, birdMatrix: null };
  let D = null, birdBuf = null, birdN = 0, birdTri = 0, progT = null, UT = {}, progB = null, progL = null, vaoB = null, vaoL = null, laneCount = 0, UB = {}, UL = {}, Mb = [mat.ident(), mat.ident()];

  const VSB = `#version 300 es
precision highp float;
layout(location=0) in vec4 aPos;    // bird units * 2000, w = part
layout(location=1) in vec4 aCol;    // rgb, a = seed
layout(location=2) in vec4 aNrm;    // face normal (triangles), 0 for points
uniform mat4 uVP, uM; uniform float uT, uPx, uPulse, uSize, uTri; uniform vec3 uEye;
out vec4 vCol;
void main() {
  vec3 p = aPos.xyz / 2000.0; int part = int(aPos.w + 0.5); float sd = aCol.a;
  // the fan breathes: feathers lean a little about the fan's root
  if (part >= 2 && part <= 4) { vec3 c = vec3(0.0, 3.5, -1.5); vec3 d = p - c; float a = 0.035 * sin(uT * 0.7 + d.x * 0.25); p = c + vec3(d.x, d.y * cos(a) - d.z * sin(a), d.y * sin(a) + d.z * cos(a)); }
  if (part == 5) p = vec3(0.0, 3.3, 0.1) + (p - vec3(0.0, 3.3, 0.1)) * (1.0 + 0.25 * uPulse);     // the heart beats on each admission
  gl_Position = uVP * uM * vec4(p, 1.0);
  float tw = 0.75 + 0.25 * sin(uT * (1.5 + 3.0 * sd) + sd * 40.0);
  vec3 col = aCol.rgb; col = mix(col, vec3(dot(col, vec3(0.33))), -0.3);        // a touch more saturation for additive light
  float b;
  if (uTri > 0.5) {           // glass: dim face-on, bright at grazing angles, so the form reads through the additive light
    vec3 wp = (uM * vec4(p, 1.0)).xyz, wn = normalize(mat3(uM) * aNrm.xyz), v = normalize(uEye - wp);
    float rim = pow(1.0 - abs(dot(wn, v)), 2.0);
    b = (part == 0 ? 0.12 : part == 1 ? 0.6 : part == 2 ? 0.3 : part == 3 ? 0.3 : 0.12) * (0.45 + 1.6 * rim);
    vCol = vec4(col * b, 2.0);
  } else {
    b = part == 4 ? 1.1 * tw : part == 5 ? 0.8 + uPulse : part == 1 ? 1.2 : 0.5 * tw;
    vCol = vec4(col * b, 0.0);
  }
  float size = (part == 4 ? 0.095 : part == 3 ? 0.06 : part == 1 ? 0.07 : part == 5 ? 0.08 : 0.048) * uSize;
  gl_PointSize = clamp(uPx * size / gl_Position.w, 1.0, 22.0);
}`;
  const VSL = `#version 300 es
precision highp float;
layout(location=0) in vec4 aLane;   // s, grade index, lift sign, kind (0 moon, 1 stream, 2 halo)
layout(location=1) in vec4 aSeed;
uniform mat4 uVP, uL0; uniform float uT, uPx; uniform vec3 uG[5];
out vec4 vCol;
void main() {
  float th = 6.2831853 * aLane.x; int g = int(aLane.y + 0.5); int kind = int(aLane.w + 0.5);
  vec3 rad = vec3(cos(th), sin(th), 0.0), tan = vec3(-sin(th), cos(th), 0.0), up = vec3(0.0, 0.0, 1.0);
  vec3 moon = rad * ${RM.toFixed(2)} + up * 0.085 * aLane.z;
  vec3 p; float bright = 1.0, size = 0.05;
  float gs = g == 0 ? 1.0 : g == 1 ? 0.62 : g == 2 ? 0.4 : g == 3 ? 0.26 : 0.16;       // stream speed and strength by grade
  if (kind == 0) {            // the moon: a small shell
    float z = aSeed.x * 2.0 - 1.0, a = aSeed.y * 6.2831853 + uT * 0.4, r = sqrt(max(0.0, 1.0 - z * z));
    p = moon + (rad * (r * cos(a)) + tan * (r * sin(a)) + up * z) * 0.034;
    bright = g == 4 ? 0.45 : 1.0; size = 0.04;
  } else if (kind == 2) {     // its halo
    p = moon; bright = g == 4 ? 0.3 : 0.7 + 0.2 * sin(uT * 2.0 + aLane.x * 60.0); size = 0.3;
  } else {                    // the stream: moon to the serpent's body
    float u = fract(aSeed.x + uT * (0.05 + 0.22 * gs) * (0.7 + 0.6 * aSeed.y));
    float e = u * u * (3.0 - 2.0 * u);
    vec3 end = rad * 1.05;
    p = mix(moon, end, e);
    float w = sin(u * 3.14159) * 0.03; float a = aSeed.z * 6.2831853 + u * 9.0;
    p += (tan * cos(a) + up * sin(a)) * w;
    bright = (0.45 + 0.9 * gs) * smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.85, u);
    if (g >= 3) bright *= step(0.5, fract(u * (g == 4 ? 7.0 : 11.0)));                  // not started: a dashed line
    size = 0.038 + 0.022 * gs;
  }
  gl_Position = uVP * uL0 * vec4(p, 1.0);
  vCol = vec4(uG[g] * bright, kind == 2 ? 1.0 : 0.0);
  gl_PointSize = clamp(uPx * size / gl_Position.w, 1.0, 64.0);
}`;
  const FS = `#version 300 es
precision highp float; in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d); if (r > 1.0) discard;
  float a = vCol.a > 0.5 ? 0.22 * exp(-r * 3.0) + 0.5 * exp(-r * 60.0) : exp(-r * 4.5) + 0.35 * exp(-r * 22.0); o = vec4(vCol.rgb * a, 0.0); }`;
  const FST = `#version 300 es
precision highp float; in vec4 vCol; out vec4 o; void main() { o = vec4(vCol.rgb, 0.0); }`;

  function program(gl, vs, fs, names) {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error('v5 shader: ' + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('v5 link: ' + gl.getProgramInfoLog(p));
    const U = {}; for (const n of names) U[n] = gl.getUniformLocation(p, n); return [p, U];
  }
  function initGL(gl) {
    const BU = ['uVP', 'uM', 'uT', 'uPx', 'uPulse', 'uSize', 'uTri', 'uEye'];
    [progB, UB] = program(gl, VSB, FS, BU); [progT, UT] = program(gl, VSB, FST, BU);
    [progL, UL] = program(gl, VSL, FS, ['uVP', 'uL0', 'uT', 'uPx', 'uG']);
    vaoB = gl.createVertexArray(); gl.bindVertexArray(vaoB);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, birdBuf, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 16, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.BYTE, true, 16, 12);
    // lanes: per lane one halo, a moon shell and a stream
    const lane = [], seed = []; let r = 0x9e3779b9; const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
    D.lanes.forEach((l, i) => {
      const g = GRADES.indexOf(l.grade), sign = i % 2 ? 1 : -1;
      const push = (kind) => { lane.push(l.s, g, sign, kind); seed.push(rnd(), rnd(), rnd(), rnd()); };
      push(2); for (let k = 0; k < MOON_N; k++) push(0); for (let k = 0; k < STREAM_N[l.grade]; k++) push(1);
    });
    laneCount = lane.length / 4;
    vaoL = gl.createVertexArray(); gl.bindVertexArray(vaoL);
    for (const [loc, arr] of [[0, lane], [1, seed]]) { const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null);
  }
  // the bird's matrix on a serpent level: head on the ring at BIRD_S, beak along the direction of travel, up out of the ring's plane
  function birdOn(Lk, scale) {
    const th = Math.PI * 2 * BIRD_S, c = Math.cos(th), s = Math.sin(th);
    const F = new Float32Array([-c, -s, 0, 0, 0, 0, 1, 0, -s, c, 0, 0, c, s, 0, 1]);      // columns: x = inward, y = up, z = tangent, origin on the ring
    let m = mat.mul(Lk, F); const sc = mat.ident(); sc[0] = sc[5] = sc[10] = scale; m = mat.mul(m, sc);
    return mat.mul(m, mat.trans([-HEAD[0], -HEAD[1], -HEAD[2]]));
  }
  let glReady = false;
  O.extra = (gl, f) => {
    if (!D || !birdBuf) return;
    try { if (!glReady) { initGL(gl); glReady = true; V5.ready = true; } } catch (e) { V5.error = String(e.message || e); console.warn('[v5]', V5.error); D = null; return; }
    Mb[0] = birdOn(f.L[0], BIRD_SCALE); Mb[1] = birdOn(f.L[1], BIRD_SCALE); V5.birdMatrix = Mb[0];
    if (V5.opts.lanes) {
      gl.useProgram(progL); gl.bindVertexArray(vaoL);
      gl.uniformMatrix4fv(UL.uVP, false, f.vp); gl.uniformMatrix4fv(UL.uL0, false, f.L[0]); gl.uniform1f(UL.uT, f.t); gl.uniform1f(UL.uPx, f.h);
      gl.uniform3fv(UL.uG, new Float32Array(GRADES.flatMap((g) => GRGB[g])));
      gl.drawArrays(gl.POINTS, 0, laneCount);
    }
    if (V5.opts.bird) {
      gl.bindVertexArray(vaoB); const eye = S.cam.eye || [0, 0, 20];
      for (const [prog, U, tri] of [[progT, UT, 1], [progB, UB, 0]]) {
        gl.useProgram(prog); gl.uniformMatrix4fv(U.uVP, false, f.vp); gl.uniform1f(U.uT, f.t); gl.uniform1f(U.uPx, f.h); gl.uniform1f(U.uPulse, Math.min(1, f.pulse)); gl.uniform1f(U.uTri, tri); gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]);
        for (let k = 0; k < 2; k++) {       // the nested serpent has its own, smaller bird
          gl.uniformMatrix4fv(U.uM, false, Mb[k]); gl.uniform1f(U.uSize, k ? 0.55 : 1);
          if (tri) gl.drawArrays(gl.TRIANGLES, 0, birdTri); else gl.drawArrays(gl.POINTS, birdTri, birdN - birdTri);
        }
      }
    }
    gl.bindVertexArray(null);
  };

  // ---------- the board, the strip and the labels ----------
  let spotEl = null, board = null, strip = null, labels = null, lab = {}, birdLab = null, isSolo = false;
  function spark(days, all) {
    const max = Math.max(1, ...all.map((d) => days[d] || 0)), w = 3, h = 14;
    return `<svg viewBox="0 0 ${all.length * (w + 1)} ${h}" width="${all.length * (w + 1)}" height="${h}">${all.map((d, i) => { const v = (days[d] || 0) / max * (h - 1); return `<rect x="${i * (w + 1)}" y="${(h - v - 1).toFixed(1)}" width="${w}" height="${(v + 1).toFixed(1)}" fill="currentColor" opacity="${days[d] ? 0.9 : 0.18}"/>`; }).join('')}</svg>`;
  }
  function mount(host, { solo } = {}) {
    isSolo = !!solo; document.body.classList.add('v5');
    const L = D.lanes, by = {}; for (const g of GRADES) by[g] = L.filter((l) => l.grade === g).length;
    const lc = D.loom.counts, bc = D.board_counts, act = D.activity;
    const dayset = new Set(); for (const r in act.commits_by_day) for (const d in act.commits_by_day[r]) dayset.add(d);
    const days = [...dayset].sort(), commits = Object.values(act.commits).reduce((a, b) => a + b, 0);
    board = document.createElement('aside'); board.id = 'lanes-lab'; board.className = 'lanes-lab' + (solo ? ' solo' : '');
    board.innerHTML = `<header><div><b>Flywheel board</b> <span>what feeds the Gobbler, and how real each part is</span></div><button id="ln-min" title="Fold">–</button></header>
<div class="ln-body">
<div class="ln-legend">${GRADES.map((g) => `<div style="--c:${GCOL[g]}" title="${esc(GTEXT[g])}"><b>${by[g]}</b><u></u><span>${g}</span></div>`).join('')}</div>
${GROUPS.map(([k, title, verb]) => `<h4>${title} <small>${verb}</small></h4>` + L.filter((l) => l.group === k).map((l) =>
    `<div class="lrow" data-k="${esc(l.k)}" style="--c:${GCOL[l.grade]}" title="${esc(l.name + ': ' + l.fact + (l.evidence.length ? ' [' + l.evidence.join(', ') + ']' : ''))}"><u></u><b>${esc(l.k)}</b><em>${esc(l.name)}</em><i>${l.grade}</i><s>${l.rank ? '#' + l.rank : ''}</s></div>`).join('')).join('')}
<h4>Work since ${esc(act.since.slice(5))} <small>${nf(commits)} commits on ${Object.keys(act.commits).length} public repos, by day</small></h4>
<div class="ln-act">${Object.keys(act.commits).sort((a, b) => act.commits[b] - act.commits[a]).map((r) => `<div><em>${esc(r.replace('x3d.', '').replace('x3d-', '').replace('x3d_', ''))}</em>${spark(act.commits_by_day[r], days)}<b>${act.commits[r]}</b></div>`).join('')}</div>
<p class="ln-note">A grade is a claim about the public repos, checked at build time. # is the lane's rank among the ${bc.frontiers} frontiers on the 23 Nov board (a judged score: read it as a tier). Stream density on the scene shows the grade, not a measured flow; dashed streams have not started. Keys: G bird, L lanes, O serpent, P pipeline, H hide panels.</p>
</div>`;
    host.appendChild(board);
    board.querySelector('#ln-min').onclick = () => board.classList.toggle('folded');
    board.querySelectorAll('.lrow').forEach((r) => { r.onmouseenter = () => { hold = performance.now() + 6000; spot(D.lanes.findIndex((l) => l.k === r.dataset.k)); }; });
    strip = document.createElement('div'); strip.className = 'v5-strip' + (solo ? ' solo' : '');
    const fam = D.families, bf = bc.by_family, bs = bc.by_status;
    strip.innerHTML = `<span><b>THE LOOM</b> ${esc(D.loom.head)}</span><span><b>${lc.laws}</b> laws</span><span><b>${lc.failure_modes}</b> failure modes</span><span><b>${lc.theses}</b> theses</span><span><b>${D.loom.r2r.candidate_rules}</b> rules from receipts</span>
<span class="sep"></span><span><b>${bc.frontiers}</b> frontiers on the fan</span><span><b>${bs.deep}</b> deep</span><span><b>${bs.explored}</b> explored</span><span><b>${bs.touched}</b> touched</span><span><b>${bs.unexplored}</b> unexplored</span>
<span class="sep"></span>${Object.keys(fam).map((k) => `<span class="fam f${k}"><b>${bf[k]}</b> ${esc(fam[k].split(' ')[0].toLowerCase())}</span>`).join('')}`;
    host.appendChild(strip);
    spotEl = document.createElement('div'); spotEl.className = 'ln-spot' + (solo ? ' solo' : ''); spotEl.id = 'ln-spot'; host.appendChild(spotEl); 
    labels = document.createElement('div'); labels.className = 'lane-labels'; host.appendChild(labels);
    for (const l of L) { const d = document.createElement('div'); d.className = 'ln g-' + l.grade; d.style.setProperty('--c', GCOL[l.grade]); d.innerHTML = `<u></u>${esc(l.k)}`; d.title = l.name + ': ' + l.fact; labels.appendChild(d); lab[l.k] = d; }
    birdLab = document.createElement('div'); birdLab.className = 'ln-bird'; birdLab.innerHTML = `<b>THE GOBBLER</b><span>meta-agent · ${bc.frontiers} feathers, one per frontier</span>`; labels.appendChild(birdLab);
    window.addEventListener('keydown', (e) => {
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'l' || e.key === 'L') { V5.opts.lanes = !V5.opts.lanes; document.body.classList.toggle('lanes-off', !V5.opts.lanes); }
      if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');      // v6: hide every panel, keep the scene and its labels
      if (e.key === 'g' || e.key === 'G') { V5.opts.bird = !V5.opts.bird; birdLab.style.display = V5.opts.bird ? '' : 'none'; }
    });
    spot(0);
    requestAnimationFrame(loop);
  }
  // the spotlight walks the lanes one by one (hover a row to hold one): the fact and the evidence behind its grade
  let spotI = 0, lastSpot = 0, hold = 0;
  function spot(i) {
    spotI = i; const l = D.lanes[i], box = spotEl; box.style.setProperty('--c', GCOL[l.grade]);
    box.innerHTML = `<div><b>${esc(l.k)}</b><em>${esc(l.name)}</em><i>${l.grade}</i></div><p>${esc(l.fact)}.</p><small>${esc(GTEXT[l.grade])}${l.rank ? ' · board rank ' + l.rank + ' of ' + D.board_counts.frontiers + ' (' + esc(l.board_status) + ')' : ''}</small><code>${l.evidence.length ? l.evidence.map(esc).join('<br>') : 'no evidence path: nothing to point at yet'}</code>`;
    board.querySelectorAll('.lrow').forEach((r) => r.classList.toggle('on', r.dataset.k === l.k));
    for (const k in lab) lab[k].classList.toggle('on', k === l.k);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    if (board && now - lastSpot > 2600 && now > hold) { lastSpot = now; spot((spotI + 1) % D.lanes.length); }
    if (!S.cam || !O.ready || !labels) return;
    const W = S.canvas.clientWidth, H = S.canvas.clientHeight, wide = W > 1180, lo = wide ? 392 : 4, hi = W - (W > 900 ? 392 : 4), top = isSolo ? 44 : 120, bot = H - (W > 760 ? (isSolo ? 170 : 286) : 8);
    const show = O.isOn() && V5.opts.lanes;
    const host = labels.getBoundingClientRect(), boxes = [...document.querySelectorAll('.ouro-labels .ol')].filter((e) => +e.style.opacity).map((e) => { const r = e.getBoundingClientRect(); return [r.left - host.left, r.top - host.top, r.right - host.left, r.bottom - host.top]; });
    for (const l of D.lanes) {
      const d = lab[l.k]; if (!show) { d.style.opacity = 0; continue; }
      const p = S.project(O.stationPoint(l.s, 0, RM - 1 + 0.07));
      if (!p || p[0] < lo || p[0] > hi || p[1] < top || p[1] > bot) { d.style.opacity = 0; continue; }
      const left = p[0] < W / 2; d.style.opacity = 1;
      // step clear of the serpent's own station labels
      const lw = l.k.length * 6.2 + 16, x0 = left ? p[0] - lw : p[0], x1 = x0 + lw; let y = p[1];
      for (const b of boxes) if (x1 > b[0] - 2 && x0 < b[2] + 2 && y + 7 > b[1] && y - 7 < b[3]) y = (y < (b[1] + b[3]) / 2) ? b[1] - 8 : b[3] + 8;
      d.style.transform = `translate(${p[0].toFixed(1)}px, ${y.toFixed(1)}px) translate(${left ? '-100%' : '0'}, -50%)`; d.classList.toggle('left', left);
    }
    if (V5.birdMatrix && O.isOn() && V5.opts.bird) {
      const w = mat.apply(V5.birdMatrix, [0, -1.6, 1.0]), p = S.project(S.worldPoint ? S.worldPoint(Array.from(w).slice(0, 3)).slice(0, 3) : Array.from(w).slice(0, 3));
      if (p && p[0] > lo && p[0] < hi && p[1] > top - 30 && p[1] < bot) { birdLab.style.opacity = 1; birdLab.style.transform = `translate(${p[0].toFixed(1)}px, ${Math.max(top, p[1]).toFixed(1)}px) translate(-50%, 0)`; } else birdLab.style.opacity = 0;
    } else birdLab.style.opacity = 0;
  }

  V5.start = async (host, { solo } = {}) => {
    try {
      const buf = await fetch('ouro/gobbler.bin').then((r) => { if (!r.ok) throw Error('gobbler.bin ' + r.status); return r.arrayBuffer(); });
      const wait = () => new Promise((res) => { const t = () => (O.data || O.error) ? res() : setTimeout(t, 50); t(); });
      await wait(); if (!O.data) throw Error('no Ouroboros data');
      const meta = await fetch('ouro/gobbler.json').then((r) => r.json());
      birdN = buf.byteLength / 16; birdTri = meta.triangle_vertices; birdBuf = buf; V5.bird = meta; D = V5.data = O.data;
      mount(host, { solo });
    } catch (e) { V5.error = String(e && e.message || e); console.warn('[v5]', V5.error); }
    return V5;
  };
})();
