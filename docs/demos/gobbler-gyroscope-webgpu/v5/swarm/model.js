/* Gobbler Swarm model: N replicas of the Gobbler.flyte LangGraph cycle, each riding one flywheel hoop.

   One agent = one replica of the compiled graph in x3d.gobbler flyte/gobbler_flyte/gobbler.py:
     open -> scout -(signal)-> weaver -> witness -(refused, attempts left)-> weaver ... -> council -(ask)-> ask/wait -> keeper -> assayer -> close
                   \-(no signal)----------------------------------------------------------------------------------> assayer
   Its angle on the hoop is its stage, so crowds on a hoop are queues and red backflow is a witness refusal.

   Every branch probability below is a count from the recorded sim tapes (x3d.gobbler flyte/runs/sim-2026-11-18*, five runs,
   240 cycles, 3,137 tape rows, mode "sim", zero model calls); source/calibrate.py rebuilds swarm/calibration.json from them.
   HOLD is never recorded (0 of 175 councils); it only appears when the Chaos slider injects it, and the panel says so.

   The state machine is integer-only (u32 state, PCG32 draws, u32 thresholds) so the JavaScript reference below and the
   WGSL compute twin in gpu.js produce bit-identical states; tests/parity.html checks that. */
(() => {
  'use strict';
  const S = { IDLE: 0, SCOUT: 1, WEAVE: 2, WITNESS: 3, REWIND: 4, COUNCIL: 5, ASK: 6, KEEPER: 7, ASSAY: 8, SKIP: 9, HOLD: 10 };
  const STAGE_NAMES = ['open', 'scout', 'weaver', 'witness', 'refused', 'council', 'ask human', 'keeper', 'assayer', 'no signal', 'hold'];
  // sector of the hoop each stage occupies, as a fraction of a turn: [from, to]
  const SECTOR = [[0, .06], [.06, .20], [.20, .40], [.40, .54], [.54, .20], [.54, .62], [.62, .62], [.62, .80], [.80, 1.0], [.20, .80], [.62, .62]];
  const COLOR = [
    [0.62, 0.50, 0.28], [0.30, 0.86, 1.00], [1.00, 0.76, 0.30], [0.70, 0.52, 1.00], [1.00, 0.22, 0.16], [1.00, 0.96, 0.88],
    [1.00, 0.40, 0.70], [0.55, 1.00, 0.45], [1.00, 0.58, 0.22], [0.30, 0.36, 0.50], [0.85, 0.08, 0.32]];
  // recorded counts (calibration.json "counts", "weave_attempts_hist", facets); thresholds are p * 2^32
  const REC = {
    cycles: 240, signal: 175, attempts: [90, 40, 45], ask: 40, proceed: 135, hold: 0,
    asked_answered: 12, asked_timeout: 20, refusal: [45, 45, 40], haikuWeaves: 260, proceduralWeaves: 45,
    spendUSD: 0.141490, // sum of per-cycle spend over the 175 admitted cycles (mean 0.0008085 x 175), simulated Haiku prices
    tapeRows: 3137, runs: 5,
  };
  const T = (p) => Math.min(4294967295, Math.floor(p * 4294967296)) >>> 0;
  const P = {
    signal: REC.signal / REC.cycles,                                   // 0.729
    pass1: REC.attempts[0] / REC.signal,                               // 0.514 first attempt passes
    pass2: REC.attempts[1] / (REC.signal - REC.attempts[0]),           // 0.471 second attempt passes
    ask: REC.ask / REC.signal,                                         // 0.229
    answered: REC.asked_answered / (REC.asked_answered + REC.asked_timeout), // 0.375 (rest time out to the preferred pick)
    ref0: REC.refusal[0] / 130, ref01: (REC.refusal[0] + REC.refusal[1]) / 130,
    usdPerHaikuWeave: REC.spendUSD / REC.haikuWeaves,                  // $0.000544
  };
  const REFUSAL_CODES = ['GATE_CONTAINMENT', 'MCP_SEMANTIC_PROFILE_COMPONENT', 'GATE_NODE_FORBIDDEN'];
  // durations in sim ticks (30 ticks = 1 s at speed 1x): base + draw % span. One cycle is about 10 s on screen for a 30 min cron, x180.
  const DUR = {
    IDLE: [24, 96], SCOUT: [36, 24], WEAVE: [48, 36], WEAVE_PROC: [20, 10], WITNESS: [30, 20], REWIND: [16, 8], COUNCIL: [16, 10],
    ASK_ANSWERED: [60, 60], ASK_TIMEOUT: [200, 40], KEEPER: [36, 24], ASSAY: [40, 20], SKIP: [60, 30], HOLD: [50, 20],
  };
  const TICK_HZ = 30, CRON_MIN = 30;

  /* Counter layout (u32): events are cumulative, occupancy and histogram are rebuilt every frame. */
  const C = {
    CYCLES: 0, SIGNAL: 1, NOSIGNAL: 2, HAIKU: 3, PROC: 4, PASS: 5, REFUSED: 6, REF0: 7, REF1: 8, REF2: 9, PROCEED: 10, ASK: 11,
    ANSWERED: 12, TIMEOUT: 13, COMMIT: 14, HOLD: 15, FIRSTPASS: 16,
    LOOP_COMMIT: 32, LOOP_REFUSED: 48, LOOP_ASK: 64, LOOP_CYCLES: 80,
    OCC: 128, // + loop * 16 + stage
    HIST: 384, // + loop * 64 + bin
    SIZE: 1024,
  };
  const LOOPS = 10, BINS = 64;

  /* PCG32 (RXS-M-XS output), u32 throughout. Returns the new state; the draw is left in OUT[0]. */
  const OUT = new Uint32Array(1);
  function pcg(s) {
    s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
    let w = Math.imul(((s >>> (((s >>> 28) + 4) >>> 0)) ^ s) >>> 0, 277803737) >>> 0;
    OUT[0] = ((w >>> 22) ^ w) >>> 0;
    return s;
  }
  function hash32(x) { x = (x ^ 61 ^ (x >>> 16)) >>> 0; x = Math.imul(x, 9) >>> 0; x = (x ^ (x >>> 4)) >>> 0; x = Math.imul(x, 0x27d4eb2d) >>> 0; return (x ^ (x >>> 15)) >>> 0; }

  /* Params the step reads (u32): thresholds, chaos-scaled each frame. Index names shared with WGSL. */
  const PI = { STEPS: 0, N: 1, T_SIGNAL: 2, T_PASS1: 3, T_PASS2: 4, T_ASK: 5, T_HOLD: 6, T_ANSWERED: 7, T_REF0: 8, T_REF01: 9, SIZE: 16 };
  function params(n, steps, chaos = 0) {
    const p = new Uint32Array(PI.SIZE);
    const k = 1 - 0.6 * chaos;                         // chaos lowers witness pass rates and injects holds at council
    p[PI.STEPS] = steps; p[PI.N] = n;
    p[PI.T_SIGNAL] = T(P.signal); p[PI.T_PASS1] = T(P.pass1 * k); p[PI.T_PASS2] = T(P.pass2 * k);
    p[PI.T_ASK] = T(P.ask); p[PI.T_HOLD] = T(0.25 * chaos); p[PI.T_ANSWERED] = T(P.answered);
    p[PI.T_REF0] = T(P.ref0); p[PI.T_REF01] = T(P.ref01);
    return p;
  }

  /* Agent state, 4 x u32: x = meta (loop 0-3, stage 4-7, attempt 8-9, refusal code 10-11, answered 12, committed 13, fresh 14),
     y = tick in stage, z = stage duration, w = PCG state. */
  const LOOP_WEIGHTS_DEFAULT = [1.4, 2.367, 4.3, 3.978, 3.656, 2.044, 1.722, 3.333, 2.689, 3.011]; // ring radii from graph-v3.json loops[].ring
  function init(n, seed = 0x9e3779b9, weights = LOOP_WEIGHTS_DEFAULT) {
    const a = new Uint32Array(n * 4), cum = []; let tot = 0;
    for (const w of weights) { tot += w; cum.push(tot); }
    for (let i = 0; i < n; i++) {
      let s = hash32((i * 0x9e3779b9 ^ seed) >>> 0) || 1;
      s = pcg(s); const u = OUT[0] / 4294967296 * tot; let l = 0; while (l < LOOPS - 1 && u >= cum[l]) l++;
      s = pcg(s); const d = 1 + (OUT[0] % 420); // spread over one mean cycle (~403 ticks) so the swarm does not start in waves
      a[i * 4] = l | (S.IDLE << 4); a[i * 4 + 1] = 0; a[i * 4 + 2] = d; a[i * 4 + 3] = s;
    }
    return a;
  }

  /* One tick for one agent. cnt may be null (parity runs skip counters). Mirrors swarmStep() in gpu.js line for line. */
  function stepAgent(a, o, p, cnt) {
    let m = a[o], t = a[o + 1] + 1, d = a[o + 2], s = a[o + 3];
    m &= ~(1 << 14);                                   // "fresh" lasts one tick
    if (t < d) { a[o] = m; a[o + 1] = t; return; }
    const l = m & 15, st = (m >>> 4) & 15;
    let att = (m >>> 8) & 3, code = (m >>> 10) & 3, ans = (m >>> 12) & 1, com = (m >>> 13) & 1, ns = st, dur = DUR.IDLE;
    const inc = (k) => { if (cnt) cnt[k]++; };
    s = pcg(s); const r = OUT[0];
    if (st === S.IDLE) { ns = S.SCOUT; dur = DUR.SCOUT; com = 0; att = 0; inc(C.CYCLES); inc(C.LOOP_CYCLES + l); }
    else if (st === S.SCOUT) {
      if (r < p[PI.T_SIGNAL]) { ns = S.WEAVE; att = 1; dur = DUR.WEAVE; inc(C.SIGNAL); inc(C.HAIKU); }
      else { ns = S.SKIP; dur = DUR.SKIP; inc(C.NOSIGNAL); }
    } else if (st === S.WEAVE) { ns = S.WITNESS; dur = DUR.WITNESS; }
    else if (st === S.WITNESS) {
      const pass = att >= 3 || (att === 1 ? r < p[PI.T_PASS1] : r < p[PI.T_PASS2]);
      if (pass) { ns = S.COUNCIL; dur = DUR.COUNCIL; inc(C.PASS); if (att === 1) inc(C.FIRSTPASS); }
      else {
        s = pcg(s); const q = OUT[0];
        code = q < p[PI.T_REF0] ? 0 : (q < p[PI.T_REF01] ? 1 : 2);
        ns = S.REWIND; dur = DUR.REWIND; inc(C.REFUSED); inc(C.REF0 + code); inc(C.LOOP_REFUSED + l);
      }
    } else if (st === S.REWIND) {
      att = Math.min(3, att + 1); ns = S.WEAVE;
      if (att >= 3) { dur = DUR.WEAVE_PROC; inc(C.PROC); } else { dur = DUR.WEAVE; inc(C.HAIKU); }
    } else if (st === S.COUNCIL) {
      if (r < p[PI.T_HOLD]) { ns = S.HOLD; dur = DUR.HOLD; inc(C.HOLD); }
      else {
        s = pcg(s); const q = OUT[0];
        if (q < p[PI.T_ASK]) {
          s = pcg(s); ans = OUT[0] < p[PI.T_ANSWERED] ? 1 : 0;
          ns = S.ASK; dur = ans ? DUR.ASK_ANSWERED : DUR.ASK_TIMEOUT; inc(C.ASK); inc(C.LOOP_ASK + l);
        } else { ns = S.KEEPER; dur = DUR.KEEPER; inc(C.PROCEED); }
      }
    } else if (st === S.ASK) { ns = S.KEEPER; dur = DUR.KEEPER; inc(ans ? C.ANSWERED : C.TIMEOUT); }
    else if (st === S.KEEPER) { ns = S.ASSAY; dur = DUR.ASSAY; com = 1; inc(C.COMMIT); inc(C.LOOP_COMMIT + l); }
    else if (st === S.ASSAY) { ns = S.IDLE; dur = DUR.IDLE; }
    else if (st === S.SKIP) { ns = S.ASSAY; dur = DUR.ASSAY; com = 0; }
    else { ns = S.ASSAY; dur = DUR.ASSAY; com = 0; } // HOLD
    s = pcg(s); const nd = dur[0] + (OUT[0] % dur[1]);
    a[o] = l | (ns << 4) | (att << 8) | (code << 10) | (ans << 12) | (com << 13) | (1 << 14);
    a[o + 1] = 0; a[o + 2] = nd; a[o + 3] = s;
  }

  function frac(stage, f) { const sec = SECTOR[stage]; return sec[0] + (sec[1] - sec[0]) * f; }

  /* CPU step for the WebGL2 path and for tests: steps ticks, then rebuilds occupancy and the angle histogram. */
  function cpuStep(a, n, p, cnt, steps) {
    for (let k = 0; k < steps; k++) for (let i = 0; i < n; i++) stepAgent(a, i * 4, p, cnt);
    if (!cnt) return;
    cnt.fill(0, C.OCC, C.SIZE);
    for (let i = 0; i < n; i++) {
      const m = a[i * 4], l = m & 15, st = (m >>> 4) & 15;
      cnt[C.OCC + l * 16 + st]++;
      const fr = frac(st, Math.min(1, a[i * 4 + 1] / Math.max(1, a[i * 4 + 2])));
      cnt[C.HIST + l * BINS + (Math.floor(((fr % 1) + 1) % 1 * BINS) & 63)]++;
    }
  }

  function fnv(a) { let h = 2166136261 >>> 0; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }

  window.GobblerSwarmModel = { S, STAGE_NAMES, SECTOR, COLOR, REC, P, PI, C, DUR, TICK_HZ, CRON_MIN, LOOPS, BINS, REFUSAL_CODES,
    LOOP_WEIGHTS_DEFAULT, pcg, hash32, params, init, stepAgent, cpuStep, frac, fnv };
})();
