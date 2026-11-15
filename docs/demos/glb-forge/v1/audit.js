// The tether audit UI: counters, agreement with the lane, the tether map (one square per source node), the searchable virtual list, the detail panel
// and the batch-node table. The matching itself is in glbjson.js (auditPair), which reads the glb JSON with nothing but JSON.parse.
import { $, esc, fmt, el, reduceMotion } from './util.js';
import { batchNodes, tagStats } from './glbjson.js';

const ROW = 30;
const COL = { kept: '#7ddc6a', moved: '#ffb454', lost: '#ff5d6c', none: '#2a3556' };
const GLYPH = { kept: '✓ kept', moved: '→ moved', lost: '✗ lost' };

export function createAudit() {
  const S = { rows: [], view: [], filter: 'all', q: '', sel: -1, srcJson: null, outJson: null, audit: null, prevStatus: null, anim: 0, layout: null };
  const list = $('auditList'), tmap = $('tmap'), tip = $('tmapTip'), detail = $('auditDetail');

  // ---- filter buttons ----
  const filt = $('auditFilter');
  for (const [id, label] of [['all', 'all'], ['kept', 'kept'], ['moved', 'moved'], ['lost', 'lost']]) {
    const b = el('button', 'btn', label, { type: 'button', 'aria-pressed': String(id === 'all') }); b.dataset.f = id;
    b.onclick = () => { S.filter = id; [...filt.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); rebuildView(); };
    filt.appendChild(b);
  }
  $('auditSearch').addEventListener('input', (e) => { S.q = e.target.value.trim().toLowerCase(); rebuildView(); });

  // ---- virtual list ----
  const head = el('div', 'rw hd', '<span>#</span><span>name</span><span class="c-def">x3d_def</span><span class="c-use">x3d_def_path · x3d_use</span><span>status</span>');
  const spacer = el('div', 'sp');
  list.append(head, spacer);
  list.addEventListener('scroll', paint, { passive: true });
  function rebuildView() {
    const q = S.q;
    S.view = S.rows.filter((r) => (S.filter === 'all' || r.status === S.filter) && (!q || (r.name + ' ' + r.def + ' ' + r.defPath + ' ' + r.use + ' ' + r.vp).toLowerCase().includes(q)));
    spacer.style.height = S.view.length * ROW + 'px';
    list.scrollTop = 0;
    $('auditCount').textContent = S.view.length === S.rows.length ? `${fmt(S.rows.length)} source nodes` : `${fmt(S.view.length)} of ${fmt(S.rows.length)} source nodes match`;
    paint();
  }
  function rowHtml(r, vi) {
    const c4 = esc(r.defPath) + (r.use ? ` ← USE ${esc(r.use)}` : '') + (r.vp ? ` · view: ${esc(r.vp)}` : '');
    return `<div class="rw ${r.status}" role="option" id="ar-${r.i}" aria-selected="${r.i === S.sel}" data-i="${r.i}" style="top:${vi * ROW}px"><span>${r.i + 1}</span><span title="${esc(r.name)}">${esc(r.name || '(unnamed)')}</span><span class="c-def" title="${esc(r.def)}">${esc(r.def)}</span><span class="c-use" title="${c4}">${c4}</span><span class="st-${r.status}">${GLYPH[r.status]}</span></div>`;
  }
  function paint() {
    const h = list.clientHeight || 420, top = Math.max(0, list.scrollTop - ROW);
    const a = Math.max(0, Math.floor(top / ROW) - 4), b = Math.min(S.view.length, Math.ceil((top + h) / ROW) + 5);
    let out = ''; for (let v = a; v < b; v++) out += rowHtml(S.view[v], v);
    spacer.innerHTML = out;
  }
  list.addEventListener('click', (e) => { const r = e.target.closest('.rw[data-i]'); if (r) select(+r.dataset.i, false); });
  list.addEventListener('keydown', (e) => {
    if (!S.view.length) return;
    let vi = S.view.findIndex((r) => r.i === S.sel); const pg = Math.max(1, Math.floor((list.clientHeight || 420) / ROW) - 1);
    if (e.key === 'ArrowDown') vi = Math.min(S.view.length - 1, vi + 1); else if (e.key === 'ArrowUp') vi = Math.max(0, vi < 0 ? 0 : vi - 1);
    else if (e.key === 'PageDown') vi = Math.min(S.view.length - 1, vi + pg); else if (e.key === 'PageUp') vi = Math.max(0, vi - pg);
    else if (e.key === 'Home') vi = 0; else if (e.key === 'End') vi = S.view.length - 1; else return;
    e.preventDefault(); if (vi < 0) vi = 0;
    select(S.view[vi].i, true);
  });
  function scrollToView(vi) { const y = vi * ROW, t = list.scrollTop, h = list.clientHeight; if (y < t) list.scrollTop = y; else if (y + 2 * ROW > t + h) list.scrollTop = y + 2 * ROW - h; }
  function select(i, fromKeys) {
    S.sel = i; const vi = S.view.findIndex((r) => r.i === i);
    if (vi < 0) { S.filter = 'all'; S.q = ''; $('auditSearch').value = ''; [...filt.children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === 'all'))); rebuildView(); }
    const v2 = S.view.findIndex((r) => r.i === i); if (v2 >= 0 && (fromKeys || vi < 0)) scrollToView(v2);
    paint(); list.setAttribute('aria-activedescendant', 'ar-' + i);
    showDetail(S.rows[i]); drawMap(false);
  }

  // ---- detail ----
  function showDetail(r) {
    if (!r) { detail.innerHTML = '<span class="note">Click a square or a row.</span>'; return; }
    const o = S.outJson, why = { kept: '', moved: '', lost: '' };
    let where = '';
    if (r.status === 'kept' && r.loc && r.loc.node != null) {
      const on = o.nodes[r.loc.node];
      where = `<p class="why">Output node <b>#${r.loc.node}</b> has the same name and the same extras.</p><pre>${esc(JSON.stringify({ name: on.name, extras: on.extras || {} }, null, 1))}</pre>`;
    } else if (r.status === 'kept') where = '<p class="why">Matched to a node-level identity in the output (the file-level token).</p>';
    else if (r.status === 'moved') {
      const bn = o.nodes[r.loc.batch], rec = bn.extras.x3d_instances[r.loc.rec], cnt = (bn.extras.x3d_instances || []).length;
      where = `<p class="why">No output node carries this name. It was folded into <b>batch node #${r.loc.batch}</b> (mesh ${esc((o.meshes[bn.mesh] || {}).name || bn.mesh)}) as <b>instance record ${r.loc.rec + 1} of ${cnt}</b>. The record sits in that node's <code>extras.x3d_instances</code>:</p><pre>${esc(JSON.stringify({ [`nodes[${r.loc.batch}].extras.x3d_instances[${r.loc.rec}]`]: rec }, null, 1))}</pre>`;
    } else {
      const nb = (S.audit && S.audit.batches ? S.audit.batches : []).length;
      where = `<p class="why">No output node has this name and these extras, and none of the ${nb} batch node${nb === 1 ? '' : 's'} carries a record for it. In the output file this node's identity is <b class="st-lost">gone</b>.</p>`;
    }
    detail.innerHTML = `<h4>${esc(r.name || '(unnamed)')} <span class="st-${r.status}">${GLYPH[r.status]}</span></h4><p class="why">source node #${r.node}</p><pre>${esc(JSON.stringify(r.extras, null, 1))}</pre>${where}`;
  }

  // ---- tether map ----
  function layout() {
    const W = tmap.clientWidth || 600, dpr = Math.min(2, window.devicePixelRatio || 1), pitch = W < 500 ? 6 : 8;
    const cols = Math.max(1, Math.floor(W / pitch)), n = S.rows.length, rows = Math.max(1, Math.ceil(n / cols));
    tmap.width = Math.round(W * dpr); tmap.height = Math.round(rows * pitch * dpr); tmap.style.height = rows * pitch + 'px';
    S.layout = { W, dpr, pitch, cols, rows };
  }
  function drawMap(animate) {
    if (!S.layout || S.layout.W !== (tmap.clientWidth || 600)) layout();
    const { dpr, pitch, cols } = S.layout, ctx = tmap.getContext('2d'), n = S.rows.length;
    cancelAnimationFrame(S.anim);
    const prev = S.prevStatus;
    const draw = (frac) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, tmap.width, tmap.height);
      const upto = Math.floor(frac * n);
      for (let i = 0; i < n; i++) {
        const st = i < upto || !prev ? S.rows[i].status : prev[i] || 'none';
        ctx.fillStyle = COL[st] || COL.none;
        ctx.fillRect((i % cols) * pitch, Math.floor(i / cols) * pitch, pitch - 1, pitch - 1);
      }
      if (S.sel >= 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect((S.sel % cols) * pitch - 0.5, Math.floor(S.sel / cols) * pitch - 0.5, pitch + 0.5, pitch + 0.5); }
    };
    if (animate && prev && !reduceMotion()) {
      const t0 = performance.now(), dur = 650;
      const tick = (t) => { const f = Math.min(1, (t - t0) / dur); draw(f); if (f < 1) S.anim = requestAnimationFrame(tick); else S.prevStatus = null; };
      S.anim = requestAnimationFrame(tick);
    } else draw(1);
  }
  const cellAt = (e) => { const r = tmap.getBoundingClientRect(), L = S.layout; if (!L) return -1; const x = e.clientX - r.left, y = e.clientY - r.top; const i = Math.floor(y / L.pitch) * L.cols + Math.floor(x / L.pitch); return i >= 0 && i < S.rows.length ? i : -1; };
  tmap.addEventListener('pointermove', (e) => {
    const i = cellAt(e); if (i < 0) { tip.style.display = 'none'; return; }
    const r = S.rows[i], b = tmap.parentElement.getBoundingClientRect();
    tip.textContent = `${r.name || '(unnamed)'} · ${GLYPH[r.status]}`; tip.style.display = 'block';
    tip.style.left = Math.min(b.width - tip.offsetWidth - 4, Math.max(4, e.clientX - b.left + 12)) + 'px'; tip.style.top = Math.max(2, e.clientY - b.top - 28) + 'px';
  });
  tmap.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  tmap.addEventListener('click', (e) => { const i = cellAt(e); if (i >= 0) { select(i, true); list.focus({ preventScroll: true }); } });
  window.addEventListener('resize', () => { if (S.rows.length) { layout(); drawMap(false); paint(); } });

  // ---- public ----
  function counters(a, lane) {
    const tile = (c, n, l, sub) => `<div class="cnt1" style="--c:${c}"><b>${fmt(n)}</b><span>${l}</span>${sub ? `<span class="note">${sub}</span>` : ''}</div>`;
    const kinds = (k) => Object.entries(a.byKind).filter(([, v]) => v[k]).map(([n, v]) => `${n} ${fmt(v[k])}`).join(', ');
    $('auditCounters').innerHTML =
      tile('#7ddc6a', a.kept, 'kept in place', kinds('kept')) + tile('#ffb454', a.moved, 'moved into an instance batch', kinds('moved')) +
      tile('#ff5d6c', a.lost, 'lost', kinds('lost')) + tile('#5db4ff', a.added, 'added', a.added ? esc(a.addedSample.join('; ').slice(0, 120)) : 'tokens in the output that the source does not have') +
      tile('#9c8bff', a.sourceTokens, 'identity tokens in the source', `output has ${fmt(a.outputTokens)}; ${fmt(a.preserved)} of ${fmt(a.sourceTokens)} survive`);
    // agreement with the lane
    const pairs = [['source tokens', a.sourceTokens, lane.sourceTokens], ['preserved', a.preserved, lane.preserved], ['lost', a.lost, lane.lost], ['added', a.added, lane.added]];
    if (lane.outputTokens != null) pairs.splice(1, 0, ['output tokens', a.outputTokens, lane.outputTokens]);
    const bad = pairs.filter(([, p, l]) => p !== l);
    const box = $('auditAgree');
    box.className = 'agree ' + (bad.length ? 'dis' : 'ok');
    box.innerHTML = (bad.length
      ? `<b>DISAGREEMENT.</b> This page's own count and the ${esc(lane.from)} differ on ${bad.length} of ${pairs.length} numbers. That is a finding, not a rounding error: one of the two counters is wrong, and the table says which numbers differ.`
      : `The ${esc(lane.from)} agrees with this page's own count on all ${pairs.length} numbers.`) +
      `<table><thead><tr><th></th>${pairs.map((p) => `<th class="n">${p[0]}</th>`).join('')}</tr></thead><tbody><tr><td>this page (JSON parse)</td>${pairs.map((p) => `<td class="n">${fmt(p[1])}</td>`).join('')}</tr><tr><td>${esc(lane.from)}</td>${pairs.map((p) => `<td class="n ${p[1] !== p[2] ? 'fail' : ''}">${fmt(p[2])}</td>`).join('')}</tr></tbody></table>`;
    return bad.length;
  }

  function batches(outJson, kindNote) {
    const b = batchNodes(outJson), tb = $('batchTable').querySelector('tbody');
    if (!b.length) { tb.innerHTML = '<tr><td colspan="4" class="na">no EXT_mesh_gpu_instancing node in this output</td></tr>'; $('batchNote').textContent = ''; return b; }
    tb.innerHTML = b.slice(0, 40).map((n) => {
      const ok = n.records === n.count && n.count != null;
      return `<tr><td class="mono">#${n.node} ${esc(n.name || '(unnamed)')}</td><td class="mono">${esc(n.meshName || n.mesh)}</td><td class="n">${fmt(n.count)}</td><td class="n ${n.records === 0 ? 'fail' : ok ? 'pass' : 'fail'}">${fmt(n.records)}</td></tr>`;
    }).join('');
    const inst = b.reduce((a, n) => a + (n.count || 0), 0), rec = b.reduce((a, n) => a + n.records, 0);
    $('batchNote').textContent = `${b.length} batch node${b.length === 1 ? '' : 's'} hold ${fmt(inst)} instances (counted from the instancing accessors in the JSON) and ${fmt(rec)} identity records (counted from extras.x3d_instances).${rec === 0 ? ' No identity records: whatever name each instance had is not in the file.' : rec === inst ? ' One record per instance.' : ' The two counts differ.'}`;
    return b;
  }

  return {
    // src: {json}; out: {json, bytes?}; audit: result of auditPair; lane: {sourceTokens, preserved, lost, added, outputTokens?, from}
    set(src, out, audit, lane, caption, animate) {
      S.prevStatus = animate ? S.rows.map((r) => r.status) : null;
      S.srcJson = src.json; S.outJson = out.json; S.audit = audit; 
      const sameSet = S.rows.length === audit.rows.length;
      if (!sameSet) S.prevStatus = null;
      S.rows = audit.rows; S.sel = -1;
      audit.batches = batches(out.json);
      const bad = counters(audit, lane);
      const ts = tagStats(src.json);
      $('auditScope').innerHTML = `Source: ${fmt(ts.nodes)} nodes · ${fmt(ts.def)} with x3d_def (${fmt(ts.distinctDef)} distinct values) · ${fmt(ts.defPath)} with x3d_def_path · ${fmt(ts.use)} with x3d_use · ${fmt(ts.vp)} with a viewpoint description. Showing the result of: <b>${esc(caption)}</b>`;
      const nk = audit.rows.filter((r) => r.status === 'kept').length, nm = audit.rows.filter((r) => r.status === 'moved').length, nl = audit.rows.length - nk - nm;
      $('tmap').setAttribute('aria-label', `One square per source node, ${audit.rows.length} in all: ${nk} kept, ${nm} moved into an instance batch, ${nl} lost`);
      layout(); rebuildView(); drawMap(!!S.prevStatus); showDetail(null);
      return bad;
    },
    select, rowsCount: () => S.rows.length,
    clearTo(msg) { S.rows = []; S.view = []; spacer.innerHTML = ''; $('auditCounters').innerHTML = ''; $('auditAgree').className = 'agree'; $('auditAgree').textContent = msg; },
  };
}
