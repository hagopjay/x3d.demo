/* Gobbler Swarm controller: picks a backend, owns the clock, the camera (solo) or Babylon's camera (on the gyroscope),
   and the hoop matrices, and keeps the KPI history the panel reads.
   Modes:
     integrated  the v2 page's Babylon WebGPU engine is up: we draw on its GPUDevice into a transparent canvas laid over it,
                 read its camera and the live kinetics buffer, and the hoops you see are Babylon's own (v1 shaders).
     solo        no Babylon scene (WebGPU refused, e.g. Chrome's blocklist on Intel UHD 620, or ?swarm=solo): we draw our own
                 hoops, spikes, star field and core, on WebGPU if an adapter answers, otherwise WebGL2 with the CPU twin. */
(() => {
  'use strict';
  const M = window.GobblerSwarmModel;
  // graph-v3.json loops[].ring, the ten flywheels of the Gyroscope edition (same centre, different radius and normal)
  const RINGS = [
    ['AI Code Generation & Validation', [0.2079, 0.0, 0.9781], 1.4], ['Blender to Web Pipeline', [0.4748, 0.6193, 0.6254], 2.367],
    ['Standards Interoperability', [-0.5674, 0.2342, 0.7894], 4.3], ['Ontology and Semantic Web', [0.7735, 0.2825, 0.5673], 3.978],
    ['Gaussian Splatting Integration', [-0.2093, -0.403, 0.891], 3.656], ['Automated Benchmarking & Testing', [0.034, -0.387, 0.9215], 2.044],
    ['Archive Mirroring and Distribution', [-0.4782, 0.4381, 0.7612], 1.722], ['Ecosystem Tooling and Linting', [-0.1822, 0.6778, 0.7123], 3.333],
    ['Community Loop', [-0.5466, -0.0967, 0.8318], 2.689], ['DSPy Loop', [0.2347, -0.1493, 0.9605], 3.011]];
  const CENTER = [9.2, -1.2, -0.6];

  /* ---- small column-major mat4 kit */
  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  };
  const mat = {
    ident: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    trans(t) { const m = mat.ident(); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; },
    rot(ax, ang) {
      const [x, y, z] = V.norm(ax), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, m = mat.ident();
      m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
      m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
      m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c; return m;
    },
    look(eye, at, up) {
      const f = V.norm(V.sub(at, eye)), s = V.norm(V.cross(f, up)), u = V.cross(s, f), m = mat.ident();
      m[0] = s[0]; m[4] = s[1]; m[8] = s[2]; m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
      m[12] = -V.dot(s, eye); m[13] = -V.dot(u, eye); m[14] = V.dot(f, eye); return m;
    },
    persp(fov, asp, n, f, zeroOne) {
      const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
      m[0] = t / asp; m[5] = t; m[11] = -1;
      if (zeroOne) { m[10] = f / (n - f); m[14] = n * f / (n - f); } else { m[10] = (f + n) / (n - f); m[14] = 2 * f * n / (n - f); }
      return m;
    },
    apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]]; },
  };

  function ringData() {
    const r = new Float32Array(10 * 16);
    RINGS.forEach(([, n0, R], k) => {
      const n = V.norm(n0), ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = V.norm(V.cross(n, ref)), v = V.cross(n, u);
      r.set([...CENTER, R, ...n, 0, ...u, 0, ...v, 0], k * 16);
    });
    return r;
  }
  /* solo kinetics: each hoop spins about its own normal, precesses about the vertical through the centre and nods a little,
     a visual stand-in for v1's heavy-top integrator (which only runs inside the Babylon scene) */
  function soloKin(t, out) {
    RINGS.forEach(([, n0, R], k) => {
      const n = V.norm(n0), sgn = k % 2 ? 1 : -1, ws = sgn * 0.34 / Math.sqrt(R), wp = (0.045 + 0.011 * k) * -sgn;
      const tilt = V.norm(V.cross([0, 1, 0], n)), nut = 0.07 * Math.sin(1.1 * t + k * 1.7);
      let m = mat.trans(CENTER);
      m = mat.mul(m, mat.rot([0, 1, 0], wp * t + k));
      m = mat.mul(m, mat.rot(tilt, nut));
      m = mat.mul(m, mat.rot(n, ws * t));
      m = mat.mul(m, mat.trans([-CENTER[0], -CENTER[1], -CENTER[2]]));
      out.set(m, k * 20); out.set([1, ...CENTER], k * 20 + 16);
    });
    return out;
  }

  const qs = new URLSearchParams(location.search);
  const S = window.GobblerSwarm = {
    RINGS, CENTER, mat, ready: false, backend: null, mode: null, error: null,
    opts: { n: +(qs.get('agents') || 30000), speed: 1, chaos: 0, layers: 1 | 2 | 4 | 8 | 16 | 32, focusLoop: -1, focusAgent: -1, spectrum: 1, exposure: 1.0, bloom: 0.55, size: 1, gain: 1 },
    hist: [], kpi: null, fps: 0, frameMs: 0, ticks: 0,
  };
  let R = null, acc = 0, last = 0, t0 = performance.now(), kinBuf = new Float32Array(200), cam = { yaw: -0.35, pitch: 0.42, dist: +(qs.get('dist') || 17), auto: true };   // v6: v4's framing again; the lane ring was pulled in instead
  let lastHist = 0, frameTimes = [], babylon = null, world = mat.ident();

  // open on a swarm already in steady state (about 30 s of graph cycles), not on 30,000 replicas waiting at the start line
  function warmTicks() { const q = qs.get('warm'); return q === null ? 900 : +q; }
  function sizeFor(n) { return 0.026 * Math.min(2.6, Math.sqrt(30000 / n)) * S.opts.size; }
  function stepsFor(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    acc += dt * M.TICK_HZ * S.opts.speed;
    let steps = Math.floor(acc); if (steps > 8) { steps = 8; acc = 0.999; }
    acc -= steps; return { steps, alpha: acc, dt };
  }
  function kpiSample(now, counters) {
    if (now - lastHist < 500 || !counters) return;
    if (R && R.backend === 'webgpu' && !R.reads) return;   // the first GPU readback has not landed yet: zeros would make the window cumulative
    lastHist = now;
    S.hist.push({ t: now / 1000, c: counters.slice(0, 128), occ: counters.slice(M.C.OCC, M.C.OCC + 160) });
    while (S.hist.length > 130) S.hist.shift();
    S.kpi = kpis();
  }
  function kpis() {
    const h = S.hist, a = h[0], b = h[h.length - 1]; if (!b) return null;
    const C = M.C, w = h.length > 1 ? b.t - a.t : 1, d = (k) => (b.c[k] - a.c[k]), rate = (k) => d(k) / Math.max(0.5, w) * 60;
    const occ = (st) => { let s = 0; for (let l = 0; l < 10; l++) s += b.occ[l * 16 + st]; return s; };
    const cyc = b.c[C.CYCLES], sig = b.c[C.SIGNAL], commits = b.c[C.COMMIT];
    const usd = b.c[C.HAIKU] * M.P.usdPerHaikuWeave;
    // ratios over the window once it is long enough (steady state, no warm-up lag), else cumulative
    const win = w >= 8, r = (num, den) => { const n = win ? d(num) : b.c[num], q = win ? d(den) : b.c[den]; return q ? n / q : 0; };
    const ref = [C.REF0, C.REF1, C.REF2].map((k) => (win ? d(k) : b.c[k]));
    const ph = win ? d(C.PROC) : b.c[C.PROC], hh = win ? d(C.HAIKU) : b.c[C.HAIKU];
    return {
      window: w, cyclesPerMin: rate(C.CYCLES), commitsPerMin: rate(C.COMMIT), haikuPerMin: rate(C.HAIKU), refusalsPerMin: rate(C.REFUSED),
      firstPass: r(C.FIRSTPASS, C.SIGNAL), signal: r(C.SIGNAL, C.CYCLES), askRate: r(C.ASK, C.PASS),
      answered: b.c[C.ANSWERED], timeout: b.c[C.TIMEOUT], holds: b.c[C.HOLD], commits, cycles: cyc, procedural: ph, haiku: hh,
      refusals: ref, usd, usdPerCycle: cyc ? usd / cyc : 0,
      den: { signal: win ? d(C.CYCLES) : cyc, firstPass: win ? d(C.SIGNAL) : sig, ask: win ? d(C.PASS) : b.c[C.PASS], proc: ph + hh, ref: ref[0] + ref[1] + ref[2] },
      // a live fleet of this many replicas on the recorded 30-minute cron: cycles/day and Haiku dollars/day at the recorded price
      fleetCyclesPerDay: S.n * (24 * 60 / M.CRON_MIN), fleetUsdPerDay: S.n * (24 * 60 / M.CRON_MIN) * (cyc ? usd / cyc : 0),
      occ: Array.from({ length: 11 }, (_, st) => occ(st)), loopOcc: Array.from({ length: 10 }, (_, l) => { let s = 0; for (let st = 0; st < 11; st++) s += b.occ[l * 16 + st]; return s; }),
      loopCommits: Array.from({ length: 10 }, (_, l) => b.c[C.LOOP_COMMIT + l]), loopRefused: Array.from({ length: 10 }, (_, l) => b.c[C.LOOP_REFUSED + l]),
      loopAsk: Array.from({ length: 10 }, (_, l) => b.c[C.LOOP_ASK + l]), loopCycles: Array.from({ length: 10 }, (_, l) => b.c[C.LOOP_CYCLES + l]),
      loopRate: Array.from({ length: 10 }, (_, l) => d(C.LOOP_COMMIT + l) / Math.max(0.5, w) * 60),
    };
  }

  function soloCamera(w, h, zeroOne) {
    if (cam.auto) cam.yaw += 0.0009;
    const cp = Math.cos(cam.pitch), eye = [CENTER[0] + cam.dist * cp * Math.sin(cam.yaw), CENTER[1] + cam.dist * Math.sin(cam.pitch), CENTER[2] + cam.dist * cp * Math.cos(cam.yaw)];
    const view = mat.look(eye, CENTER, [0, 1, 0]), proj = mat.persp(0.85, w / h, 0.1, 500, zeroOne);
    return { vp: mat.mul(proj, view), eye };
  }
  function bindSoloInput(canvas) {
    let drag = null;
    canvas.style.pointerEvents = 'auto'; canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; cam.auto = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; cam.yaw -= (e.clientX - drag[0]) * 0.005; cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', () => { drag = null; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(3, Math.min(60, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    canvas.addEventListener('dblclick', () => { cam.auto = true; });
  }
  function fit(canvas, ref) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = ref ? ref.width : Math.round(canvas.clientWidth * dpr), h = ref ? ref.height : Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function frameArgs(now, vp, eye, st) {
    const o = S.opts, k = S.kpi, glow = k ? Math.min(2.2, k.commitsPerMin / Math.max(1, S.n) * 2.2) : 0.3;
    return { steps: st.steps, alpha: st.alpha, chaos: o.chaos, counters: true, vp, world, eye, time: (now - t0) / 1000, size: sizeFor(S.n), gain: 0.10 * Math.min(4, Math.sqrt(30000 / S.n)) * o.gain,
      focusLoop: o.focusLoop, focusAgent: o.focusAgent, spectrum: o.spectrum, glow, layers: o.layers & (S.mode === 'solo' ? 63 : 15), exposure: o.exposure, bloom: o.bloom };
  }
  function tickStats(now) {
    frameTimes.push(now); while (frameTimes.length && now - frameTimes[0] > 1000) frameTimes.shift();
    S.fps = frameTimes.length;
  }

  /* ---- solo loop */
  function soloLoop(now) {
    if (!S.running) return;
    const t1 = performance.now();
    const canvas = S.canvas; fit(canvas);
    const st = stepsFor(now), zeroOne = R.backend === 'webgpu';
    R.setKin(soloKin((now - t0) / 1000, kinBuf));
    const c = soloCamera(canvas.width, canvas.height, zeroOne);
    if (R.frame(frameArgs(now, c.vp, c.eye, st)) === false) acc += st.steps; else S.ticks += st.steps;   // v3: ticks actually stepped drive the pipeline clock
    kpiSample(now, R.counters); tickStats(now);
    S.frameMs = S.frameMs * 0.9 + (performance.now() - t1) * 0.1;
    S.cam = c;
    requestAnimationFrame(soloLoop);
  }

  /* ---- integrated: draw after every Babylon frame */
  function integratedFrame() {
    const now = performance.now(), t1 = now, b = babylon, scene = b.scene, canvas = S.canvas;
    fit(canvas, b.engine.getRenderingCanvas());
    const st = stepsFor(now);
    const wm = scene.getTransformNodeByName && scene.getTransformNodeByName('shape-MeridianRing0Shape');
    if (wm) world = new Float32Array(wm.computeWorldMatrix(false).m);
    const G = window.GobblerKinetics && window.GobblerKinetics.__G;
    if (G && G.mirror) { kinBuf.set(G.mirror.subarray(0, 200)); if (!S.sharedKin) R.setKin(kinBuf); }
    const camB = scene.activeCamera, vp = new Float32Array(scene.getTransformationMatrix().m), e = camB.globalPosition || camB.position;
    R.frame(frameArgs(now, vp, [e.x, e.y, e.z], st)); S.ticks += st.steps;
    kpiSample(now, R.counters); tickStats(now);
    S.frameMs = S.frameMs * 0.9 + (performance.now() - t1) * 0.1;
    S.cam = { vp, eye: [e.x, e.y, e.z] };
  }

  async function makeSolo(canvas, prefer) {
    S.mode = 'solo';
    const rings = ringData();
    let r = null, why = [];
    if (prefer !== 'webgl' && navigator.gpu) {
      try { r = await window.GobblerSwarmGPU.create({ canvas, solo: true, n: S.opts.n }); } catch (e) { why.push('WebGPU: ' + e.message); r = null; }
    }
    if (!r) {
      if (why.length) { const c2 = canvas.cloneNode(); canvas.replaceWith(c2); canvas = S.canvas = c2; }
      r = new window.GobblerSwarmGL(canvas, { solo: true, n: Math.min(S.opts.n, 100000) });
    }
    S.fallbackReasons = why;
    r.setRings(rings); R = r; S.backend = r.backend; S.n = r.n;
    bindSoloInput(canvas);
    const warm = warmTicks(); if (warm && r.warm) await r.warm(warm);
    S.running = true; requestAnimationFrame(soloLoop);
  }

  async function attachIntegrated(body, canvas) {
    const G = window.GobblerKinetics && window.GobblerKinetics.__G;
    const device = body.engine._device;
    let kinBuffer = null;
    try { kinBuffer = G && G.kinLoops && G.kinLoops.getBuffer().underlyingResource; } catch (e) { kinBuffer = null; }
    S.mode = 'integrated'; babylon = { scene: body.scene, engine: body.engine };
    R = await window.GobblerSwarmGPU.create({ canvas, device, kinBuffer, solo: false, n: S.opts.n });
    S.sharedKin = !!kinBuffer && R.kin === kinBuffer;
    if (!S.sharedKin) R.setKin(soloKin(0, kinBuf));
    R.setRings(ringData()); S.backend = 'webgpu'; S.n = R.n; S.sharedDevice = true;
    const warm = warmTicks(); if (warm) await R.warm(warm);
    body.scene.onAfterRenderObservable.add(() => { if (S.running) try { integratedFrame(); } catch (e) { S.error = String(e); console.error('[swarm]', e); S.running = false; } });
    S.running = true;
  }

  S.setCount = (n) => { if (!R) return; R.setCount(n); S.n = R.n; S.hist = []; S.kpi = null; };
  S.stats = () => ({ ready: S.ready, mode: S.mode, backend: S.backend, n: S.n, fps: S.fps, frameMs: +S.frameMs.toFixed(2), sharedDevice: !!S.sharedDevice, sharedKin: !!S.sharedKin,
    reads: R && R.reads, error: S.error || (R && (R.readError || R.lost)) || null, fallback: S.fallbackReasons || [], kpi: S.kpi && { cycles: S.kpi.cycles, commits: S.kpi.commits, firstPass: +S.kpi.firstPass.toFixed(4), signal: +S.kpi.signal.toFixed(4) } });
  S.renderer = () => R;
  S.project = (p) => { if (!S.cam || !S.canvas) return null; const c = mat.apply(S.cam.vp, p); if (c[3] <= 0) return null; return [(c[0] / c[3] * 0.5 + 0.5) * S.canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * S.canvas.clientHeight]; };
  S.worldPoint = (p) => mat.apply(world, p);
  S.worldMatrix = () => world;   // v4: the Ouroboros layer draws with the same camera and world
  /* where a stage sits on a hoop right now (CPU copy of the loop matrix; labels only) */
  S.loopPoint = (l, fr, dr = 0, dn = 0) => {
    const [, n0, Rr] = RINGS[l], n = V.norm(n0), ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = V.norm(V.cross(n, ref)), v = V.cross(n, u), th = fr * Math.PI * 2, r = Rr + dr;
    const p = [0, 1, 2].map((k) => CENTER[k] + r * (Math.cos(th) * u[k] + Math.sin(th) * v[k]) + dn * n[k]);
    const m = kinBuf.subarray(l * 20, l * 20 + 16), q = mat.apply(m, p);
    return mat.apply(world, q).slice(0, 3);
  };
  S.agentState = () => {
    const f = S.opts.focusAgent; if (f < 0 || !R) return null;
    if (R.state) return R.state.slice(f * 4, f * 4 + 4);
    return R.focusState && R.focusState.id === f ? R.focusState.s : null;
  };

  /* start({ canvas, solo, prefer }) : solo = true forces the standalone scene; otherwise wait for the Babylon body */
  S.start = async ({ canvas, solo, prefer, waitMs = 30000 } = {}) => {
    S.canvas = canvas;
    if (qs.get('capture') === '1' && window.GobblerSwarmGPU) window.GobblerSwarmGPU.capture = true;
    const force = solo || qs.get('swarm') === 'solo';
    const pref = prefer || qs.get('swarmgl') === '1' && 'webgl';
    try {
      if (!force) {
        const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
        if (adapter) {
          const t = performance.now();
          while (performance.now() - t < waitMs) {
            const b = window.__gobWebGPU && window.__gobWebGPU.body;
            if (b && b.scene && b.engine && b.engine._device && window.GobblerKinetics && window.GobblerKinetics.__G) { await attachIntegrated(b, canvas); break; }
            await new Promise((r) => setTimeout(r, 250));
          }
        } else S.fallbackReasons = ['navigator.gpu.requestAdapter() returned no adapter'];
      }
      if (!S.mode) await makeSolo(canvas, pref);
      S.ready = true;
      window.dispatchEvent(new CustomEvent('gobbler:swarm-ready', { detail: S.stats() }));
    } catch (e) {
      S.error = String(e && e.message || e); console.error('[swarm]', e);
      if (S.mode === 'integrated') { S.mode = null; await makeSolo(canvas, 'webgl'); S.ready = true; }
    }
    return S.stats();
  };
})();
