/* Gobbler Swarm panel: live KPIs read from the GPU (or CPU twin) counters, recorded-vs-live check, per-flywheel table,
   controls, and stage labels on a focused hoop. Every live number is computed from the swarm's own counters; every
   recorded number is a count from the Gobbler.flyte sim tapes (see swarm/calibration.json). */
(() => {
  'use strict';
  const M = window.GobblerSwarmModel, S = window.GobblerSwarm;
  const css = (c) => `rgb(${c.map((x) => Math.round(Math.min(1, x) * 255)).join(',')})`;
  const fmt = (x, d = 0) => (x == null || !isFinite(x)) ? '–' : x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e4 ? (x / 1e3).toFixed(1) + 'k' : x.toFixed(d);
  const pct = (x) => (x == null || !isFinite(x)) ? '–' : (x * 100).toFixed(1) + '%';
  const STAGE_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let el = null, spark = null, labels = null, sparkData = [], lastUI = 0;

  function mount(host, { solo, full } = {}) {
    if (el) return;
    el = document.createElement('aside'); el.id = 'swarm-lab'; el.className = 'swarm-lab' + (solo ? ' solo' : '') + (full ? ' full' : '');
    el.innerHTML = `
<header><div><b>Swarm</b> <span id="sw-n">30,000</span> Gobbler.flyte replicas</div><button id="sw-min" title="Fold the panel">–</button></header>
<div class="sw-body">
<p class="sw-lede">Each spark is one replica of the Gobbler.flyte LangGraph cycle riding the flywheel it works on. Its place on the hoop is its stage: crowds are queues, <span style="color:${css(M.COLOR[4])}">red backflow</span> is a witness refusal, <span style="color:${css(M.COLOR[6])}">pink lift-off</span> is a question waiting for a human, white comets are admitted entries falling into the core.</p>
<div class="sw-badges"><span id="sw-backend">starting</span><span id="sw-fps">– fps</span><span id="sw-gpu"></span></div>
<div class="sw-kpis" id="sw-kpis"></div>
<h4>Recorded vs live <small>tapes: 5 sim days, 240 cycles, 3,137 rows, 0 model calls; ✓ = within 3 standard errors</small></h4>
<table class="sw-rec" id="sw-rec"></table>
<h4>Stage occupancy <small>replicas in each LangGraph node now</small></h4>
<div class="sw-funnel" id="sw-funnel"></div>
<h4>Admitted per minute <small>last 60 s, white; refusals, red</small></h4>
<canvas id="sw-spark" width="600" height="90"></canvas>
<h4>Flywheels <small>click a row to isolate its hoop</small></h4>
<table class="sw-loops" id="sw-loops"></table>
<h4>Controls</h4>
<div class="sw-ctl">
 <label>Replicas <select id="sw-count"></select></label>
 <label>Speed <select id="sw-speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label>
 <label class="wide">Chaos <input id="sw-chaos" type="range" min="0" max="1" step="0.05" value="0"><span id="sw-chaos-v">0 (recorded)</span></label>
 <label class="wide">Glow <input id="sw-gain" type="range" min="0.2" max="3" step="0.05" value="1"></label>
 <label class="wide">Bloom <input id="sw-bloom" type="range" min="0" max="1.6" step="0.05" value="0.55"></label>
 <div class="sw-layers" id="sw-layers"></div>
 <button id="sw-follow">Follow one replica</button><button id="sw-clear">Show all hoops</button>
</div>
<div class="sw-follow" id="sw-follow-out"></div>
<p class="sw-foot" id="sw-foot"></p>
</div>`;
    host.appendChild(el);
    labels = document.createElement('div'); labels.className = 'swarm-labels'; host.appendChild(labels);
    const $ = (s) => el.querySelector(s);
    spark = $('#sw-spark');
    $('#sw-min').onclick = () => { el.classList.toggle('folded'); $('#sw-min').textContent = el.classList.contains('folded') ? '+' : '–'; };
    const counts = [3000, 10000, 30000, 100000, 262144];
    $('#sw-count').innerHTML = counts.map((c) => `<option value="${c}">${c.toLocaleString()}</option>`).join('');
    $('#sw-count').value = String(S.opts.n);
    $('#sw-count').onchange = (e) => { S.opts.n = +e.target.value; S.setCount(S.opts.n); sparkData = []; };
    $('#sw-speed').onchange = (e) => { S.opts.speed = +e.target.value; };
    $('#sw-chaos').oninput = (e) => { S.opts.chaos = +e.target.value; $('#sw-chaos-v').textContent = S.opts.chaos ? S.opts.chaos.toFixed(2) + ' injected' : '0 (recorded)'; };
    $('#sw-gain').oninput = (e) => { S.opts.gain = +e.target.value; };
    $('#sw-bloom').oninput = (e) => { S.opts.bloom = +e.target.value; };
    const LAY = [[1, 'Agents'], [2, 'Sparks'], [4, 'Spectrum'], [8, 'Core'], [16, 'Hoops'], [32, 'Stars']];
    $('#sw-layers').innerHTML = LAY.map(([b, n]) => `<label><input type="checkbox" data-b="${b}" ${S.opts.layers & b ? 'checked' : ''}>${n}</label>`).join('');
    $('#sw-layers').onchange = (e) => { const b = +e.target.dataset.b; S.opts.layers = e.target.checked ? S.opts.layers | b : S.opts.layers & ~b; };
    $('#sw-follow').onclick = () => { S.opts.focusAgent = Math.floor(Math.random() * S.n); };
    $('#sw-clear').onclick = () => { S.opts.focusLoop = -1; S.opts.focusAgent = -1; };
    $('#sw-loops').onclick = (e) => { const tr = e.target.closest('tr[data-l]'); if (!tr) return; const l = +tr.dataset.l; S.opts.focusLoop = S.opts.focusLoop === l ? -1 : l; };
    requestAnimationFrame(loop);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!S.ready) return;
    drawLabels();
    if (now - lastUI < 400) return; lastUI = now;
    update();
  }

  function update() {
    const $ = (s) => el.querySelector(s), k = S.kpi, st = S.stats(), R = S.renderer();
    $('#sw-n').textContent = (S.n || 0).toLocaleString();
    const be = st.backend === 'webgpu' ? (st.mode === 'integrated' ? 'WebGPU compute · on Babylon\'s device' + (st.sharedKin ? ' · live hoop buffer' : '') : 'WebGPU compute · solo scene') : 'WebGL2 · CPU twin (' + (R && R.cpuMs ? R.cpuMs.toFixed(1) + ' ms/frame' : '') + ')';
    $('#sw-backend').textContent = be;
    $('#sw-fps').textContent = st.fps + ' fps';
    const info = R && R.adapterInfo || (window.__gobWebGPU && window.__gobWebGPU.adapter) || {};
    $('#sw-gpu').textContent = [info.vendor, info.architecture, info.description, info.renderer].filter(Boolean).join(' · ').slice(0, 90) || 'GPU name hidden by the browser';
    if (!k) return;
    const tiles = [
      ['Cycles / min', fmt(k.cyclesPerMin), 'graph runs started, all hoops'],
      ['Admitted / min', fmt(k.commitsPerMin), 'keeper commits (white comets)'],
      ['First-attempt pass', pct(k.firstPass), 'witness passes on weave 1'],
      ['Signal found', pct(k.signal), 'scout picked a signal'],
      ['Asked a human', pct(k.askRate), 'of councils; ' + fmt(k.occ[6]) + ' waiting now'],
      ['Refusals / min', fmt(k.refusalsPerMin), 'witness verdicts REFUSED'],
      ['Haiku calls / min', fmt(k.haikuPerMin), 'simulated, no model called'],
      ['Live fleet, $/day', '$' + fmt(k.fleetUsdPerDay, 2), fmt(k.fleetCyclesPerDay) + ' cycles/day at the recorded price'],
    ];
    $('#sw-kpis').innerHTML = tiles.map(([a, b, c]) => `<div><b>${b}</b><span>${a}</span><i>${c}</i></div>`).join('');
    const live = { sig: k.signal, fp: k.firstPass, ask: k.askRate, proc: k.procedural / Math.max(1, k.procedural + k.haiku), r: k.refusals.map((x) => x / Math.max(1, k.refusals[0] + k.refusals[1] + k.refusals[2])) };
    const D = k.den;
    const rec = [['Scout finds a signal', M.P.signal, live.sig, '175 / 240', D.signal], ['Witness passes weave 1', M.P.pass1, live.fp, '90 / 175', D.firstPass],
      ['Council asks a human', M.P.ask, live.ask, '40 / 175', D.ask], ['Weaves done procedurally', 45 / 305, live.proc, '45 / 305', D.proc],
      ...M.REFUSAL_CODES.map((c, i) => ['Refusal: ' + c.toLowerCase().replace(/_/g, ' '), M.REC.refusal[i] / 130, live.r[i], M.REC.refusal[i] + ' / 130', D.ref])];
    const chaos = S.opts.chaos > 0;
    // agreement test: within 3 binomial standard errors of the recorded rate, given how many trials the live window holds
    const warming = !(k.window >= 8);   // cumulative ratios carry the warm-up lag between stages, so wait for an 8 s window
    $('#sw-rec').innerHTML = '<tr><th></th><th>recorded</th><th>live</th><th>Δ pp</th><th>n</th></tr>' + rec.map(([n, a, b, c, m]) => {
      if (warming) return `<tr><td>${n}</td><td title="${c}">${pct(a)}</td><td>…</td><td>…</td><td>warming</td></tr>`;
      const d = (b - a) * 100, se = Math.sqrt(a * (1 - a) / Math.max(1, m)) * 100, ok = Math.abs(d) <= Math.max(0.5, 3 * se);
      return `<tr><td>${n}</td><td title="${c}">${pct(a)}</td><td>${pct(b)}</td><td class="${ok ? 'ok' : chaos ? 'chaos' : 'warn'}" title="3 standard errors = ${(3 * se).toFixed(2)} pp">${d >= 0 ? '+' : ''}${d.toFixed(1)}${ok ? ' ✓' : ''}</td><td>${fmt(m)}</td></tr>`;
    }).join('');
    const tot = k.occ.reduce((a, b) => a + b, 0) || 1, mx = Math.max(...k.occ);
    $('#sw-funnel').innerHTML = STAGE_ORDER.filter((s) => s !== 10 || k.occ[10]).map((s) => `<div><span class="sw" style="background:${css(M.COLOR[s])}"></span><em>${M.STAGE_NAMES[s]}</em><i style="width:${(k.occ[s] / mx * 100).toFixed(1)}%;background:${css(M.COLOR[s])}"></i><b>${fmt(k.occ[s])}</b><small>${(k.occ[s] / tot * 100).toFixed(1)}%</small></div>`).join('');
    sparkData.push([k.commitsPerMin, k.refusalsPerMin]); while (sparkData.length > 150) sparkData.shift();
    drawSpark();
    const rows = S.RINGS.map(([name], l) => {
      const c = window.GobblerSwarmGPU.LOOP_COLORS[l], on = S.opts.focusLoop === l;
      return `<tr data-l="${l}" class="${on ? 'on' : ''}"><td><span class="sw" style="background:${css(c)}"></span>${name}</td><td>${fmt(k.loopOcc[l])}</td><td>${fmt(k.loopRate[l])}</td><td>${fmt(k.loopCommits[l])}</td><td>${pct(k.loopRefused[l] / Math.max(1, k.loopCycles[l]))}</td><td>${fmt(k.loopAsk[l])}</td></tr>`;
    });
    $('#sw-loops').innerHTML = '<tr><th>flywheel</th><th>replicas</th><th>adm/min</th><th>admitted</th><th>refused/cycle</th><th>asks</th></tr>' + rows.join('');
    const a = S.agentState(), fo = $('#sw-follow-out');
    if (S.opts.focusAgent >= 0 && a) {
      const m = a[0], l = m & 15, s = (m >>> 4) & 15, att = (m >>> 8) & 3, code = (m >>> 10) & 3, ans = (m >>> 12) & 1, com = (m >>> 13) & 1;
      fo.innerHTML = `<b>Replica #${S.opts.focusAgent.toLocaleString()}</b> on <em>${S.RINGS[l][0]}</em>: <span style="color:${css(M.COLOR[s])}">${M.STAGE_NAMES[s]}</span>` +
        `${att ? ', weave attempt ' + att : ''}${s === 4 ? ', refused ' + M.REFUSAL_CODES[code] : ''}${s === 6 ? (ans ? ', human answers' : ', will time out to the preferred pick') : ''}${com && s === 8 ? ', just committed' : ''} · tick ${a[1]} of ${a[2]}`;
    } else fo.textContent = '';
    $('#sw-foot').innerHTML = `Live counts come from the swarm's own counters (${st.backend === 'webgpu' ? 'WGSL atomics, read back every frame or two' : 'the CPU twin'}); recorded counts from x3d.gobbler <code>flyte/runs/sim-2026-11-18*</code>, rebuilt by <code>source/calibrate.py</code>. One graph cycle takes ${k.cyclesPerMin ? (S.n / k.cyclesPerMin * 60).toFixed(1) : '–'} s here at this speed against the real 30-minute cron (×${k.cyclesPerMin ? Math.round(1800 / (S.n / k.cyclesPerMin * 60)) : '–'}). HOLD was never recorded; it appears only when Chaos injects it. Fleet $/day is a projection at the simulated Haiku prices in the tapes ($${M.P.usdPerHaikuWeave.toFixed(6)} per weave), not a bill.`;
  }

  function drawSpark() {
    const c = spark.getContext('2d'), w = spark.width, h = spark.height;
    c.clearRect(0, 0, w, h);
    if (sparkData.length < 2) return;
    const mx = Math.max(1, ...sparkData.map((d) => Math.max(d[0], d[1])));
    for (const [i, col] of [[1, 'rgba(255,80,60,.9)'], [0, 'rgba(255,240,210,.95)']]) {
      c.beginPath();
      sparkData.forEach((d, k) => { const x = k / 149 * w, y = h - 4 - d[i] / mx * (h - 12); k ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    }
    c.fillStyle = 'rgba(233,207,138,.8)'; c.font = '20px ui-monospace,monospace'; c.fillText(fmt(mx) + '/min', 6, 22);
  }

  /* stage names around the isolated hoop */
  const LABEL_STAGES = [[0.03, 0], [0.13, 1], [0.30, 2], [0.47, 3], [0.58, 5], [0.71, 7], [0.90, 8]];
  function drawLabels() {
    const l = S.opts.focusLoop;
    if (l < 0 || !S.loopPoint) { if (labels.childElementCount) labels.innerHTML = ''; return; }
    if (labels.childElementCount !== LABEL_STAGES.length + 1) labels.innerHTML = LABEL_STAGES.map(([, s]) => `<span style="color:${css(M.COLOR[s])}">${M.STAGE_NAMES[s]}</span>`).join('') + `<span class="ask" style="color:${css(M.COLOR[6])}">ask human ↑</span>`;
    const els = labels.children;
    const box = S.canvas.getBoundingClientRect(), host = labels.parentElement.getBoundingClientRect();
    LABEL_STAGES.concat([[0.62, 6]]).forEach(([fr, s], i) => {
      const p = S.project(S.loopPoint(l, fr, s === 6 ? 0.25 : 0.45, s === 6 ? 0.8 : 0));
      const e = els[i]; if (!p) { e.style.display = 'none'; return; }
      e.style.display = ''; e.style.transform = `translate(${(p[0] + box.left - host.left).toFixed(1)}px, ${(p[1] + box.top - host.top).toFixed(1)}px) translate(-50%, -50%)`;
    });
  }

  window.GobblerSwarmHUD = { mount, update };
})();
