/* Gobbler Swarm v3: the pipeline layer. A light overlay that shows the Gobbler.flyte graph running at fleet speed:
   - a rail of the graph's stages (icons), with packets flowing along each edge at the live rate from the swarm's counters;
   - a fleet clock: graph time runs x134 faster than the 30-minute cron (one on-screen cycle = one cron period);
   - rolling odometers for cycles, admitted entries and simulated Haiku calls;
   - an event stream of REAL transitions: replicas #0 to #1,023 are read back from the GPU (or the CPU twin) each frame, and
     every line is one of them changing stage between two readbacks. Nothing in the stream is invented.
   Nothing here calls a model or spends anything. */
(() => {
  'use strict';
  const M = window.GobblerSwarmModel, S = window.GobblerSwarm, St = M.S, C = M.C;
  const css = (c, a = 1) => `rgba(${c.map((x) => Math.round(Math.min(1, x) * 255)).join(',')},${a})`;
  const LOOP_TAG = ['CodeGen', 'Blender→Web', 'Standards', 'Ontology', 'Splats', 'Bench', 'Archive', 'Tooling', 'Community', 'DSPy'];
  const REF_SHORT = ['GATE_CONTAINMENT', 'MCP_SEMANTIC_PROFILE', 'GATE_NODE_FORBIDDEN'];
  const nf = (x) => Math.round(x).toLocaleString('en-US');

  /* ---- icons: 24 x 24 stroke paths (drawn here, no icon font, no network) */
  const ICON = {
    open: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',                                         // clock: the cron tick
    scout: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M12 12L18 6', // radar sweep
    weaver: 'M3 8c3-3 6 3 9 0s6-3 9 0M3 16c3-3 6 3 9 0s6-3 9 0M7 4v16M17 4v16',                     // warp and weft
    witness: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0', // eye
    council: 'M6 9a2 2 0 1 0 0-.01M12 7a2 2 0 1 0 0-.01M18 9a2 2 0 1 0 0-.01M3 18c0-3 6-3 6 0M9 16c0-3 6-3 6 0M15 18c0-3 6-3 6 0', // three heads
    ask: 'M4 5h16v10H9l-5 4zM10 8.5a2 2 0 1 1 2.5 2c-.5.2-.5.6-.5 1M12 13.2v.1',                  // speech bubble with ?
    keeper: 'M5 10h14v10H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v2',                                       // lock: commit to the world
    assayer: 'M12 4v16M5 8h14M5 8l-3 6h6zM19 8l-3 6h6zM8 20h8',                                     // scales
    close: 'M4 12l5 5L20 6',                                                                         // check
    refused: 'M18 6L6 18M6 6l12 12',
    hold: 'M8 5v14M16 5v14',
    skip: 'M4 12h12M12 7l5 5-5 5M20 5v14',
    commit: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7z',
  };
  const svg = (k, c) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c || 'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[k]}"/></svg>`;

  /* ---- rail layout: main line left to right; ask above; refusal backflow, no-signal bypass and hold below */
  const NODES = [
    { k: 'open', st: St.IDLE, x: 0.04, y: 0.50, label: 'open' },
    { k: 'scout', st: St.SCOUT, x: 0.17, y: 0.50, label: 'scout' },
    { k: 'weaver', st: St.WEAVE, x: 0.31, y: 0.50, label: 'weaver' },
    { k: 'witness', st: St.WITNESS, x: 0.45, y: 0.50, label: 'witness' },
    { k: 'council', st: St.COUNCIL, x: 0.59, y: 0.50, label: 'council' },
    { k: 'ask', st: St.ASK, x: 0.665, y: 0.17, label: 'ask human' },
    { k: 'keeper', st: St.KEEPER, x: 0.74, y: 0.50, label: 'keeper' },
    { k: 'assayer', st: St.ASSAY, x: 0.87, y: 0.50, label: 'assayer' },
    { k: 'close', st: -1, x: 0.97, y: 0.50, label: 'close' },
  ];
  const N = Object.fromEntries(NODES.map((n) => [n.k, n]));
  // edges: from, to, counter keys whose rate drives the flow, colour stage, curve (0 straight, +down / -up), dashed
  const EDGES = [
    { a: 'open', b: 'scout', k: [C.CYCLES], st: St.SCOUT },
    { a: 'scout', b: 'weaver', k: [C.SIGNAL], st: St.WEAVE },
    { a: 'weaver', b: 'witness', k: [C.HAIKU, C.PROC], st: St.WITNESS },
    { a: 'witness', b: 'council', k: [C.PASS], st: St.COUNCIL },
    { a: 'witness', b: 'weaver', k: [C.REFUSED], st: St.REWIND, bend: 0.36, back: true, label: 'refused' },
    { a: 'council', b: 'keeper', k: [C.PROCEED], st: St.KEEPER },
    { a: 'council', b: 'ask', k: [C.ASK], st: St.ASK, quiet: true },
    { a: 'ask', b: 'keeper', k: [C.ANSWERED, C.TIMEOUT], st: St.ASK, quiet: true },
    { a: 'council', b: 'assayer', k: [C.HOLD], st: St.HOLD, bend: 0.30, label: 'hold' },
    { a: 'keeper', b: 'assayer', k: [C.COMMIT], st: St.KEEPER, commit: true },
    { a: 'scout', b: 'assayer', k: [C.NOSIGNAL], st: St.SKIP, bend: 0.62, label: 'no signal' },
    { a: 'assayer', b: 'close', k: [C.CYCLES], st: St.ASSAY },
  ];

  let host = null, root = null, rail = null, cv = null, ctx = null, feed = null, list = null, odo = {}, nodeEl = {}, clockEl = null, subEl = null;
  let packets = [], warp = [], rates = {}, edgeRate = new Float32Array(EDGES.length), lastT = 0, simSec = 0, prevSent = null, prevRef = null;
  let sparkHist = [], tickWin = [], lastStamp = 0, queue = [], shown = 0, seen = 0, seenWin = [], shownWin = [], lastLine = 0, lastRates = 0, totalRate = 0, mounted = false, hidden = false;

  function mount(parent, { solo } = {}) {
    if (mounted) return; mounted = true; host = parent;
    root = document.createElement('div'); root.className = 'pipe-layer' + (solo ? ' solo' : '');
    root.innerHTML = `
<section class="pipe-feed" aria-label="Pipeline, live">
  <header><span class="pipe-wheel">${svg('scout')}</span><b>Pipeline</b><span class="pipe-live"><i></i>live</span><button class="pipe-fold" title="Fold (P)">–</button></header>
  <div class="pipe-body">
    <div class="pipe-clock"><small>fleet graph time</small><output id="pipe-clock">Day 1 · 00:00:00</output><span id="pipe-sub">x134 · 1 s here = 2 min 14 s of cron time</span></div>
    <div class="pipe-odo">
      <div><span class="odo" id="odo-cyc"></span><em>graph cycles run</em></div>
      <div><span class="odo" id="odo-com"></span><em>entries admitted</em></div>
      <div><span class="odo" id="odo-hai"></span><em>Haiku weaves (simulated)</em></div>
    </div>
    <div class="pipe-rates">
      <div><b id="pr-ev">–</b><span>transitions / s</span></div><div><b id="pr-com">–</b><span>admitted / s</span></div>
      <div><b id="pr-ref">–</b><span>refusals / s</span></div><div><b id="pr-ad">–</b><span>agent-days / s</span></div>
    </div>
    <canvas class="pipe-spark" height="34"></canvas>
    <h5>Event stream <small id="pipe-rate">sentinels #0 to #1,023</small></h5>
    <div class="pipe-list" id="pipe-list"></div>
    <p class="pipe-foot">Every line is a real stage change of one of replicas #0 to #1,023, read back from the ${'<span id="pipe-be">GPU</span>'} with the counters each frame. Times are fleet graph time. Rates above come from the swarm's own counters over the last 2 s.</p>
  </div>
</section>
<section class="pipe-rail" aria-label="Gobbler.flyte graph, flowing">
  <canvas></canvas>
  ${NODES.map((n) => `<div class="pn" data-k="${n.k}" style="left:${n.x * 100}%;top:${n.y * 100}%;--c:${css(n.st >= 0 ? M.COLOR[n.st] : [0.95, 0.9, 0.75])}"><i>${svg(n.k)}</i><span>${n.label}</span><b>–</b></div>`).join('')}
  <div class="pr-legend"><span style="--c:${css(M.COLOR[St.REWIND])}">refused, back to weave</span><span style="--c:${css(M.COLOR[St.SKIP])}">no signal, straight to assayer</span><span style="--c:${css(M.COLOR[St.HOLD])}">hold (Chaos only)</span><span class="solid" style="--c:#fff">admitted (white packets)</span></div>
</section>`;
    parent.appendChild(root);
    rail = root.querySelector('.pipe-rail'); cv = rail.querySelector('canvas'); ctx = cv.getContext('2d');
    feed = root.querySelector('.pipe-feed'); list = root.querySelector('#pipe-list'); clockEl = root.querySelector('#pipe-clock'); subEl = root.querySelector('#pipe-sub');
    for (const n of NODES) nodeEl[n.k] = rail.querySelector(`.pn[data-k="${n.k}"]`);
    odo.cyc = makeOdo(root.querySelector('#odo-cyc'), 9); odo.com = makeOdo(root.querySelector('#odo-com'), 9); odo.hai = makeOdo(root.querySelector('#odo-hai'), 9);
    root.querySelector('.pipe-fold').onclick = () => feed.classList.toggle('folded');
    window.addEventListener('keydown', (e) => { if ((e.key === 'p' || e.key === 'P') && !/input|textarea|select/i.test(e.target.tagName)) toggle(); });
    for (let i = 0; i < 70; i++) warp.push({ x: Math.random(), y: Math.random(), l: 0.02 + Math.random() * 0.08, v: 0.5 + Math.random() });
    requestAnimationFrame(loop);
  }
  function toggle(on) { hidden = on === undefined ? !hidden : !on; root.classList.toggle('hidden', hidden); }

  /* ---- odometer: one wheel per digit, CSS transform rolls it */
  function makeOdo(el, digits) {
    el.innerHTML = Array.from({ length: digits }, (_, i) => `${i && (digits - i) % 3 === 0 ? `<s data-i="${i}">,</s>` : ''}<span class="dg"><span>${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span></span>`).join('');
    const wheels = [...el.querySelectorAll('.dg > span')], commas = [...el.querySelectorAll('s')];
    return { el, wheels, set(v) {
      const s = String(Math.max(0, Math.floor(v))).padStart(digits, '0').slice(-digits), lead = s.search(/[1-9]/);
      const L = lead < 0 ? digits - 1 : lead;
      wheels.forEach((w, i) => { w.style.transform = `translateY(${-s.charCodeAt(i) + 48}em)`; w.parentNode.classList.toggle('lead', i < L); });
      commas.forEach((c) => c.classList.toggle('lead', +c.dataset.i <= L));
    } };
  }

  /* ---- rates from the swarm's counter history (samples every 0.5 s); window about 2 s */
  function updateRates() {
    const h = S.hist; if (!h || h.length < 2) return;
    const b = h[h.length - 1]; let a = h[0];
    // at least 2 s back, and past the last sample that holds the same readback (slow rigs read back a few times a second)
    for (let i = h.length - 2; i >= 0; i--) { a = h[i]; if (b.t - a.t >= 2 && a.c[C.CYCLES] !== b.c[C.CYCLES]) break; }
    if (a.c[C.CYCLES] === b.c[C.CYCLES]) return;
    const w = Math.max(0.25, b.t - a.t), d = (k) => (b.c[k] - a.c[k]) / w;
    EDGES.forEach((e, i) => { edgeRate[i] = e.k.reduce((s, k) => s + d(k), 0); });
    rates = { cyc: d(C.CYCLES), com: d(C.COMMIT), ref: d(C.REFUSED), hai: d(C.HAIKU) };
    // every transition the graph makes, fleet wide: the sum of the edge flows (each counted edge is one stage change)
    totalRate = edgeRate.reduce((s, x) => s + x, 0) + d(C.REFUSED) + d(C.NOSIGNAL) + d(C.HOLD); // + the exits the rail folds away: rewind->weave, skip->assayer, hold->assayer
    const set = (id, v, dd = 0) => { const e = root.querySelector(id); if (e) e.textContent = v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(dd); };
    set('#pr-ev', totalRate); set('#pr-com', rates.com, 0); set('#pr-ref', rates.ref, 0);
    set('#pr-ad', S.n * compression() / 86400, 1);
    sparkHist.push([totalRate, rates.com, rates.ref]); if (sparkHist.length > 90) sparkHist.shift(); drawSpark();
    odo.cyc.set(b.c[C.CYCLES]); odo.com.set(b.c[C.COMMIT]); odo.hai.set(b.c[C.HAIKU]);
    const occ = S.kpi && S.kpi.occ;
    if (occ) for (const n of NODES) if (n.st >= 0) {
      let v = occ[n.st]; if (n.st === St.WEAVE) v += occ[St.REWIND];
      nodeEl[n.k].querySelector('b').textContent = v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : nf(v);
    }
    nodeEl.close.querySelector('b').textContent = (rates.cyc >= 1e3 ? (rates.cyc / 1e3).toFixed(1) + 'k' : rates.cyc.toFixed(0)) + '/s';
  }
  /* throughput sparkline: transitions (gold), admitted (white), refused (red) per second, last ~22 s */
  function drawSpark() {
    const c = root.querySelector('.pipe-spark'); if (!c) return; const W = c.clientWidth, H = 34, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = H * dpr; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    [['rgba(233,207,138,.9)', 0], ['rgba(255,255,255,.85)', 1], ['rgba(255,110,90,.85)', 2]].forEach(([col, k]) => {
      const mx = Math.max(1, ...sparkHist.map((v) => v[k])); g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath();
      sparkHist.forEach((v, i) => { const x = W - (sparkHist.length - 1 - i) * (W / 89), y = H - 3 - (v[k] / mx) * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    });
  }
  // one on-screen graph cycle stands for one 30-minute cron period: mean cycle is about 403 ticks at 30 Hz
  const CYCLE_TO_CRON = (M.CRON_MIN * 60) / (403 / M.TICK_HZ);   // x134: graph seconds per on-screen second at 30 ticks / s
  function compression() {   // measured: ticks stepped per wall second over the last 2 s, times x134 / 30
    if (tickWin.length < 2) return CYCLE_TO_CRON * (S.opts.speed || 1);
    const [a, b] = [tickWin[0], tickWin[tickWin.length - 1]]; const w = (b[0] - a[0]) / 1000;
    return w > 0.3 ? (b[1] - a[1]) / w / M.TICK_HZ * CYCLE_TO_CRON : CYCLE_TO_CRON * (S.opts.speed || 1);
  }
  function clockText(sec) {
    const d = Math.floor(sec / 86400) + 1, r = sec % 86400, hh = Math.floor(r / 3600), mm = Math.floor(r / 60) % 60, ss = Math.floor(r % 60);
    return `Day ${d} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  /* ---- sentinel diff: real transitions of replicas 0..1023 */
  function readSentinels() {
    const R = S.renderer && S.renderer(); if (!R) return;
    const s = R.sentinels; if (!s || !s.length) return;
    if (s === prevRef && R.backend === 'webgpu') return;   // no new readback yet
    prevRef = s;
    if (!prevSent || prevSent.length !== s.length) { prevSent = Uint32Array.from(s); return; }
    const stamp = simSec, from = Math.min(lastStamp || stamp, stamp); lastStamp = stamp; const batch = [];
    for (let i = 0, n = s.length / 4; i < n; i++) {
      const F = ~(1 << 14), m0 = prevSent[i * 4] & F, m1 = s[i * 4] & F;   // the fresh bit lasts one tick: not a transition
      if (m0 === m1 && s[i * 4 + 1] >= prevSent[i * 4 + 1]) continue;
      const ev = describe(i, m0, m1); if (!ev) continue;
      seen++; seenWin.push(performance.now());
      ev.t = from + (stamp - from) * Math.random(); batch.push(ev);   // the change happened somewhere between the two readbacks
      pulse(ev.node, ev.pri);
    }
    prevSent.set(s);
    if (batch.length) queue = batch.sort((x, y) => x.t - y.t);   // each readback replaces the backlog: the stream stays live
  }
  function describe(id, m0, m1) {
    const l = m1 & 15, ps = (m0 >>> 4) & 15, cs = (m1 >>> 4) & 15, att = (m1 >>> 8) & 3, code = (m1 >>> 10) & 3, ans = (m1 >>> 12) & 1, com = (m1 >>> 13) & 1;
    const e = { id, l, pri: 0, node: 'open', icon: 'open', st: cs, text: '' };
    switch (cs) {
      case St.SCOUT: Object.assign(e, { node: 'scout', icon: 'scout', text: 'cron tick, scout sweeps sources' }); break;
      case St.WEAVE:
        if (ps === St.SCOUT) Object.assign(e, { node: 'weaver', icon: 'weaver', text: 'signal found, Haiku weave 1' });
        else if (att >= 3) Object.assign(e, { node: 'weaver', icon: 'weaver', pri: 1, text: 'procedural weave, 3rd try (no model)' });
        else Object.assign(e, { node: 'weaver', icon: 'weaver', text: `re-weave ${att} after a refusal` });
        break;
      case St.WITNESS: Object.assign(e, { node: 'witness', icon: 'witness', text: `witness checks weave ${att}` }); break;
      case St.REWIND: Object.assign(e, { node: 'witness', icon: 'refused', pri: 2, cls: 'ref', text: `REFUSED ${REF_SHORT[code]} · w${att}` }); break;
      case St.COUNCIL: Object.assign(e, { node: 'council', icon: 'council', pri: 1, text: `witness PASS on weave ${att}${att === 1 ? ', first try' : ''}` }); break;
      case St.ASK: Object.assign(e, { node: 'ask', icon: 'ask', pri: 2, cls: 'ask', text: 'council asks HagopJay a question' }); break;
      case St.KEEPER:
        if (ps === St.ASK) Object.assign(e, { node: 'keeper', icon: 'keeper', pri: 1, text: ans ? 'question answered, keeper commits' : 'no answer, timed out to the preferred pick' });
        else Object.assign(e, { node: 'keeper', icon: 'keeper', text: 'council: proceed to keeper' });
        break;
      case St.ASSAY:
        if (ps === St.KEEPER || com) Object.assign(e, { node: 'assayer', icon: 'commit', pri: 2, cls: 'com', text: 'ADMITTED · committed to the world' });
        else if (ps === St.SKIP) Object.assign(e, { node: 'assayer', icon: 'assayer', text: 'assayer grades a quiet cycle' });
        else Object.assign(e, { node: 'assayer', icon: 'assayer', text: 'assayer runs thesis checks' });
        break;
      case St.SKIP: Object.assign(e, { node: 'scout', icon: 'skip', cls: 'dim', text: 'no signal this tick, skip to assayer' }); break;
      case St.HOLD: Object.assign(e, { node: 'council', icon: 'hold', pri: 2, cls: 'hold', text: 'HOLD · council stops the line (Chaos)' }); break;
      case St.IDLE: Object.assign(e, { node: 'close', icon: 'close', text: 'cycle closed, waits for the next cron tick' }); break;
      default: return null;
    }
    return e;
  }
  function pulse(k, pri) { const el = nodeEl[k]; if (!el || pri < 1) return; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }

  /* ---- the stream shows about 12 lines a second: the important ones first, a sample of the rest */
  function drainQueue(now) {
    const per = 1000 / 12; if (now - lastLine < per || !queue.length) return;
    lastLine = now;
    // a weighted pick among the next few in time order: headline events (refusals, asks, admissions, holds) surface more often
    const win = Math.min(queue.length, 8), wt = (q) => [1, 3, 6][q.pri]; let tot = 0; for (let j = 0; j < win; j++) tot += wt(queue[j]);
    let r = Math.random() * tot, i = 0; for (; i < win - 1; i++) { r -= wt(queue[i]); if (r <= 0) break; }
    const e = queue.splice(i, 1)[0]; queue.splice(0, i);   // skipped earlier ones are passed over, so times only move forward
    shown++; shownWin.push(now);
    const c = css(M.COLOR[e.st] || [1, 1, 1]), lc = window.GobblerSwarmGPU ? css(window.GobblerSwarmGPU.LOOP_COLORS[e.l]) : '#ccc';
    const row = document.createElement('div'); row.className = 'pl ' + (e.cls || '');
    row.style.setProperty('--c', c);
    row.innerHTML = `<i>${svg(e.icon, c)}</i><time>${clockText(e.t).slice(-8)}</time><b>#${nf(e.id)}</b><u style="--l:${lc}">${LOOP_TAG[e.l]}</u><em>${e.text}</em>`;
    list.prepend(row);
    while (list.children.length > 15) list.lastChild.remove();
  }

  /* ---- rail canvas: warp streaks, edges, packets */
  function nodeXY(k, W, H) { const n = N[k]; return [n.x * W, n.y * H]; }
  function edgePath(e, W, H) {
    const [x0, y0] = nodeXY(e.a, W, H), [x1, y1] = nodeXY(e.b, W, H), bend = e.bend || 0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + bend * H * 1.2;
    return { x0, y0, x1, y1, cx: mx, cy: bend ? my : (y0 + y1) / 2 };
  }
  function bez(p, t) { const u = 1 - t; return [u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1]; }
  function draw(now, dt) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    // warp streaks: speed follows the log of the fleet-wide transition rate
    const sp = Math.log10(1 + totalRate) * 0.22;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of warp) {
      s.x += sp * s.v * dt; if (s.x > 1.1) { s.x = -0.1; s.y = Math.random(); }
      const x = s.x * W, y = s.y * H, len = s.l * W * (0.6 + sp);
      const g = ctx.createLinearGradient(x - len, y, x, y); g.addColorStop(0, 'rgba(233,207,138,0)'); g.addColorStop(1, 'rgba(233,207,138,0.16)');
      ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - len, y); ctx.lineTo(x, y); ctx.stroke();
    }
    // edges
    EDGES.forEach((e, i) => {
      const p = edgePath(e, W, H), r = edgeRate[i], c = M.COLOR[e.st];
      ctx.strokeStyle = css(c, r > 0 ? 0.28 : 0.08); ctx.lineWidth = 0.8 + Math.log10(1 + r) * 1.1;
      ctx.setLineDash(e.bend ? [3, 4] : []); ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.quadraticCurveTo(p.cx, p.cy, p.x1, p.y1); ctx.stroke(); ctx.setLineDash([]);
      if (r > 0 && W > 520 && !e.quiet) {
        const [lx, ly] = bez(p, 0.5); ctx.fillStyle = css(c, 0.85); ctx.font = '600 9.5px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText((r >= 1e3 ? (r / 1e3).toFixed(1) + 'k' : r.toFixed(0)) + '/s' + (e.label ? ' ' + e.label : ''), lx, ly + (e.bend ? 11 : -7));
      }
      // packets: visual spawn = log of the rate, so 30 / s and 3,000 / s both read; the label carries the real number
      e.acc = (e.acc || 0) + dt * Math.min(46, 4 * Math.log2(1 + r));
      while (e.acc >= 1) { e.acc -= 1; packets.push({ e: i, t: 0, v: 1.8 + Math.random() * 1.6 + sp * 2 }); }
    });
    packets = packets.filter((q) => (q.t += q.v * dt) < 1);
    for (const q of packets) {
      const e = EDGES[q.e], p = edgePath(e, W, H), c = M.COLOR[e.st];
      const [x, y] = bez(p, q.t), [xb, yb] = bez(p, Math.max(0, q.t - 0.09));
      const g = ctx.createLinearGradient(xb, yb, x, y); g.addColorStop(0, css(c, 0)); g.addColorStop(1, css(c, 0.95));
      ctx.strokeStyle = g; ctx.lineWidth = e.commit ? 2.6 : 1.8; ctx.beginPath(); ctx.moveTo(xb, yb); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = e.commit ? 'rgba(255,255,255,0.95)' : css(c, 1); ctx.beginPath(); ctx.arc(x, y, e.commit ? 2.4 : 1.6, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0; lastT = now;
    if (!S.ready || hidden) return;
    simSec = (S.ticks || 0) / M.TICK_HZ * CYCLE_TO_CRON;   // graph time from the ticks the swarm really stepped
    tickWin.push([now, S.ticks || 0]); while (tickWin.length > 2 && now - tickWin[0][0] > 2000) tickWin.shift();
    clockEl.textContent = clockText(simSec);
    readSentinels(); drainQueue(now);
    if (now - lastRates > 250) {
      lastRates = now; updateRates();
      const cut = now - 2000; seenWin = seenWin.filter((t) => t > cut); shownWin = shownWin.filter((t) => t > cut);
      const k = compression(), sec = k * 1;   // a stalled rig honestly reads x0
      subEl.textContent = `x${k.toFixed(0)} measured (x${CYCLE_TO_CRON.toFixed(0)} at full speed) · 1 s here = ${sec >= 60 ? Math.floor(sec / 60) + ' min ' + String(Math.round(sec % 60)).padStart(2, '0') + ' s' : Math.round(sec) + ' s'} of cron time`;
      const R = S.renderer && S.renderer(), be = root.querySelector('#pipe-be'); if (be && R) be.textContent = R.backend === 'webgpu' ? 'GPU' : 'CPU twin';
      root.querySelector('#pipe-rate').textContent = `${nf(seenWin.length / 2)} seen / s on 1,024 sentinels · showing ${nf(shownWin.length / 2)} / s`;
    }
    draw(now, dt);
  }

  window.GobblerSwarmPipe = { mount, toggle, stats: () => ({ seen, shown, queue: queue.length, simSec, totalRate, rates, edgeRate: Array.from(edgeRate) }) };
})();
