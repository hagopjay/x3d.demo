/* Gobbler Gyroscope v4: the Ouroboros panel and the labels on the serpent.
   Live numbers are the swarm's own counters. Numbers marked ≈ are a live counter times a ratio from the recorded day
   (ouro/data.json: x3d.gobbler flyte/runs/sim-2026-11-18-r5). Loom counts, the frontier list, the render facts and the
   "eating now" lines are records read at build time, each with its source in data.json. */
(() => {
  'use strict';
  const S = window.GobblerSwarm, M = window.GobblerSwarmModel, O = window.GobblerOuroboros, C = M.C;
  const nf = (x) => x >= 1e7 ? (x / 1e6).toFixed(1) + 'M' : Math.round(x).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const I = {   // 24 x 24 stroke icons, drawn here
    raw: 'M4 7c2-2 3 2 5 0s3-2 5 0 3 2 6 0M3 13c3 2 4-3 7-1s4 3 6 0 3-1 5 1M5 18c2-1 4 2 6 0s4-2 8 1',
    struct: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    assay: 'M12 4v16M5 8h14M5 8l-3 6h6zM19 8l-3 6h6zM8 20h8',
    know: 'M6 6a2 2 0 1 0 0-.01M18 7a2 2 0 1 0 0-.01M12 17a2.4 2.4 0 1 0 0-.01M7.5 7.5l3.3 7.6M16.5 8.6l-3.4 6.6M8 6.3l8 .5',
    sciviz: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v18M4 7.5l8 4.5 8-4.5',
    act: 'M5 12h11M12 7l5 5-5 5M20 5v14',
    bite: 'M12 4a8 8 0 1 0 8 8M20 12l-3.5-1.5M20 12l-1.5 3.5M12 4l1 3.5M12 4l-3 2.2',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${I[k]}"/></svg>`;
  const COL = { raw: '#9aa3b8', struct: '#57dbf5', assay: '#fff4dc', know: '#ffc752', sciviz: '#c9a6ff', act: '#fff0c8', bite: '#9ef275' };
  const CHECK_NAME = { 'T1 score_tuple': 'score is a tuple', 'T2 canary': 'canary', 'T3 state_of_record': 'state of record', 'T6 pin_age': 'pin age', 'T7 egress': 'egress',
    'T8 grader_opacity': 'grader opacity', 'T10 provenance': 'provenance', 'T11 context_budget': 'context budget', 'T13 retry_cap': 'retry cap' };

  let el = null, labels = null, lab = {}, D = null, lastUI = 0, pulseI = 0, lastPulse = 0, thumbI = 0;

  let isSolo = false;
  function mount(host, { solo } = {}) {
    isSolo = !!solo;
    if (el || !O.data) return; D = O.data;
    const cy = D.cycle, lc = D.loom.counts, sv = D.sciviz, r2r = D.loom.r2r;
    el = document.createElement('aside'); el.id = 'ouro-lab'; el.className = 'ouro-lab' + (solo ? ' solo' : '');
    el.innerHTML = `
<header><span class="ouro-glyph">${svg('bite')}</span><div><b>Ouroboros</b> <span>the Gobbler eats its own tail</span></div><button id="ou-min" title="Fold (O hides the serpent)">–</button></header>
<div class="ou-body">
<p class="ou-lede">Read the serpent tail to head: raw sweep, typed records, the Assayer's gate, admitted knowledge, the Blender sci-viz lens, actions. The head closes on the tail: what the Gobbler ships is what it reads next.</p>
<div class="ou-turn"><b id="ou-turn">–</b><span>turns of the loop per replica so far · fleet graph time <i id="ou-clock">–</i></span></div>
<div class="ou-ladder" id="ou-ladder"></div>
<p class="ou-proof">Already true in the record: the Scout's largest source is the Loom's own commit log, <b>${nf(cy.raw_by_source['loom-commits'])} of ${nf(cy.raw_items)}</b> raw items in the recorded day, and <b>${cy.foldbacks} of ${cy.commits}</b> admitted entries drafted a fold-back (${Object.entries(cy.foldback_targets).map(([k, v]) => `${v} to ${esc(k)}`).join(', ')}).</p>

<h4><span class="ic" style="color:${COL.assay}">${svg('assay')}</span>Assayer <small>${D.assayer.checks_live} checks live from ${D.assayer.theses_total} theses · ${esc(D.assayer.atlas.split(' (')[0])}</small></h4>
<div class="ou-checks" id="ou-checks"></div>
<p class="ou-note">Not tested yet: ${D.assayer.not_tested.map(esc).join('; ')}. Stop-the-line in the record: ${D.assayer.stops}.</p>

<h4><span class="ic" style="color:${COL.sciviz}">${svg('sciviz')}</span>Blender sci-viz agent <small class="ou-staged">staged, not yet an organ</small></h4>
<div class="ou-sciviz"><div class="ou-thumbs">${['glass-hero', 'glass-heart', 'glass-low', 'glass-wide'].map((n) => `<img src="ouro/thumbs/${n}.webp" alt="Cycles still ${n}" width="64" height="64" loading="lazy">`).join('')}</div>
<p>What the lens has rendered so far, by hand: <b>${sv.stills}</b> Cycles stills (${sv.still_samples} samples) and a <b>${sv.spin_frames}</b>-frame turntable of the glass Gobbler in Blender ${esc(sv.blender)} through ${esc(sv.addon)}; light baked onto <b>${nf(sv.baked_faces)}</b> faces of the X3D. As an organ it would sit after the Keeper: admitted knowledge in, validated pictures out, each with a receipt.</p></div>

<h4><span class="ic" style="color:${COL.know}">${svg('know')}</span>The Loom, its memory <small>counted at x3d.loom ${esc(D.loom.head)}</small></h4>
<div class="ou-loom"><div><b>${lc.laws}</b><span>laws</span></div><div><b>${lc.failure_modes}</b><span>failure modes</span></div><div><b>${lc.theses}</b><span>theses</span></div><div><b>${r2r.candidate_rules}</b><span>rules from receipts</span></div></div>
<p class="ou-note">Receipt-to-rule engine: ${r2r.candidate_rules} candidate rules from failure receipts, ${r2r.confirmed} Confirmed, ${r2r.audit_predictions_right} audit predictions right and ${r2r.audit_wrong} wrong; put back to the Blender add-on, ${r2r.closed_on_addon_2_7_4} closed and ${r2r.still_live} still live on 2.7.4. That is one full turn of the loop, already run.</p>

<h4><span class="ic" style="color:${COL.raw}">${svg('raw')}</span>Eating now <small>newest work on ${Object.keys(D.sources.heads).length} public repos since ${esc(D.pulse_since)}</small></h4>
<div class="ou-pulse" id="ou-pulse"></div>

<h4><span class="ic" style="color:${COL.act}">${svg('act')}</span>Next on the frontier board <small>judged ranks, Suspected: read as a tier</small></h4>
<ol class="ou-front">${D.frontiers.slice(0, 5).map((f) => `<li>${esc(f.title)}</li>`).join('')}</ol>
<p class="ou-foot">Sources: ${esc(D.sources.tape)} (${nf(D.sources.tape_rows)} rows, ${esc(D.sources.note)}). ≈ marks a live counter times a recorded ratio. Particle density on the serpent is a picture; the counts are these numbers.</p>
</div>`;
    host.appendChild(el);
    el.querySelector('#ou-min').onclick = () => el.classList.toggle('folded');
    labels = document.createElement('div'); labels.className = 'ouro-labels'; host.appendChild(labels);
    for (const st of O.STATIONS) {
      const d = document.createElement('div'); d.className = 'ol ol-' + st.k; d.style.setProperty('--c', COL[st.k]);
      d.innerHTML = `<i>${svg(st.k)}</i><div><b>${st.name}</b><span data-v>${st.sub}</span></div>` + (st.k === 'sciviz' ? '<img alt="" width="34" height="34">' : '');
      labels.appendChild(d); lab[st.k] = d;
    }
    window.addEventListener('keydown', (e) => { if ((e.key === 'o' || e.key === 'O') && !/input|textarea|select/i.test(e.target.tagName)) { O.toggle(); labels.style.display = O.isOn() ? '' : 'none'; } });
    requestAnimationFrame(loop);
  }

  function ladderRow(k, name, val, note, approx) {
    return `<div class="lr" style="--c:${COL[k]}"><i>${svg(k)}</i><em>${name}</em><b>${approx ? '≈' : ''}${val}</b><small>${note}</small></div>`;
  }
  function update(now) {
    const h = S.hist && S.hist[S.hist.length - 1]; if (!h) return;
    const c = h.c, cy = D.cycle, cycles = c[C.CYCLES], commits = c[C.COMMIT], rawPer = cy.raw_items / cy.cycles, nsPer = cy.namesakes_set_aside / cy.cycles;
    const raw = cycles * rawPer, weaves = c[C.HAIKU] + c[C.PROC];
    const tg = cy.foldback_targets, tsum = Object.values(tg).reduce((a, b) => a + b, 0);
    el.querySelector('#ou-ladder').innerHTML =
      ladderRow('raw', 'Raw items swept', nf(raw), `${rawPer.toFixed(1)} per cycle in the record`, true) +
      ladderRow('struct', 'Signals kept', nf(c[C.SIGNAL]), `1 per cycle at most; ${(100 * c[C.SIGNAL] / Math.max(1, raw)).toFixed(1)}% of raw`) +
      ladderRow('struct', 'Weaves written', nf(weaves), `typed X3D fragments (${nf(c[C.PROC])} procedural)`) +
      ladderRow('assay', 'Refused at the gate', nf(c[C.REFUSED]), `${(100 * c[C.REFUSED] / Math.max(1, c[C.PASS] + c[C.REFUSED])).toFixed(1)}% of verdicts, back to weave`) +
      ladderRow('know', 'Admitted to the world', nf(commits), 'entries on the hash chain') +
      ladderRow('act', 'Fold-back drafts', nf(commits), `${Object.entries(tg).map(([k, v]) => `${nf(commits * v / tsum)} ${k.replace('x3d.', '')}`).join(' · ')}`, true) +
      ladderRow('bite', 'Fed back as raw', nf(commits), 'each draft is a commit the Scout sweeps next', true);
    el.querySelector('#ou-turn').textContent = (cycles / Math.max(1, S.n)).toFixed(2);
    const sim = (S.ticks || 0) / M.TICK_HZ * ((M.CRON_MIN * 60) / (403 / M.TICK_HZ)), dd = Math.floor(sim / 86400) + 1, hh = Math.floor(sim % 86400 / 3600), mm = Math.floor(sim / 60) % 60;
    el.querySelector('#ou-clock').textContent = `Day ${dd} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    // Assayer: each check runs by the recorded rule (every cycle, every admitted turn, or once a day)
    const rule = (name) => { const n = D.assayer.checks[name].pass; return n === cy.cycles ? cycles : n === cy.commits ? commits : Math.max(1, dd); };
    el.querySelector('#ou-checks').innerHTML = Object.keys(D.assayer.checks).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).map((name) =>
      `<div class="ck"><u></u><b>${name.split(' ')[0]}</b><em>${CHECK_NAME[name] || name}</em><span>≈${nf(rule(name))} pass</span></div>`).join('');
    // labels on the serpent
    const set = (k, v) => { const e = lab[k] && lab[k].querySelector('[data-v]'); if (e) e.textContent = v; };
    set('raw', `≈${nf(raw)} items swept`); set('struct', `${nf(weaves)} weaves`); set('assay', `${nf(c[C.REFUSED])} refused · ${D.assayer.checks_live} checks`);
    set('know', `${nf(commits)} admitted`); set('sciviz', 'staged · knowledge to pictures'); set('act', `≈${nf(commits)} drafts`); set('bite', `turn ${(cycles / Math.max(1, S.n)).toFixed(2)}`);
    if (now - lastPulse > 1500) {
      lastPulse = now; const p = D.pulse[pulseI++ % D.pulse.length], box = el.querySelector('#ou-pulse');
      const row = document.createElement('div'); row.innerHTML = `<u>${esc(p.repo.replace('x3d.', '').replace('x3d-', ''))}</u><time>${esc(p.date.slice(5))}</time><em>${esc(p.subject)}</em>`;
      box.prepend(row); while (box.children.length > 5) box.lastChild.remove();
      const img = lab.sciviz && lab.sciviz.querySelector('img'); if (img) img.src = `ouro/thumbs/${['glass-hero', 'glass-heart', 'glass-low', 'glass-wide'][thumbI++ % 4]}.webp`;
    }
  }
  function place() {
    if (!S.cam || !O.ready) return;
    const W = S.canvas.clientWidth, H = S.canvas.clientHeight;
    for (const st of O.STATIONS) {
      const d = lab[st.k], p = S.project(O.stationPoint(st.s, 0, 0)), q = S.project(O.stationPoint(st.s, 0, 0.16));
      if (!p || !q || q[0] < -60 || q[0] > W + 60 || q[1] < -30 || q[1] > H + 30) { d.style.opacity = 0; continue; }
      // push the label outward from the ring on screen
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, x = p[0] + dx / l * 46; let y = p[1] + dy / l * 30;
      // keep labels clear of the side panels when those are showing
      const lw = d.offsetWidth || 150, lo = (W > 1180 && el.offsetParent ? el.offsetWidth + 34 : 8), hi = W - (W > 900 ? 392 : 8), leftSide = dx < 0;
      let lx = leftSide ? x - lw : x; lx = Math.max(lo, Math.min(hi - lw, lx));
      const yMax = H - (isSolo ? 176 : 292); if (W > 760 && y > yMax) y = yMax;   // stay above the pipeline rail
      d.style.opacity = 1; d.style.transform = `translate(${lx.toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -50%)`;
      d.classList.toggle('left', leftSide);
    }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    if (!el) return;
    place();
    if (now - lastUI > 400) { lastUI = now; update(now); }
  }
  window.GobblerOuroborosHUD = { mount };
})();
