// glb Forge: orchestration. Receipts, scenes, the worker that runs the lane's optimiser, the three.js viewer (loaded lazily), and the sections
// that read a result: headline, steps, bytes, tether audit, gates, byte parity. Everything shootout-shaped is in shootout.js.
import { $, esc, fmt, kib, sign, delta, short, wait, el, sha256hex, gzipLength, adapterName, fetchBytes } from './util.js';
import { splitGlb, auditPair, tagStats, byteCategories } from './glbjson.js';
import { createAudit } from './audit.js';
import { renderGates } from './gates.js';
import { headerTiles, renderShootout, callouts, metricTabs, limitItems, SHORT } from './shootout.js';

const SCENES = [
  { id: 'cathedral', name: 'PRISMATICA cathedral', url: '../../bridge-blenderizer/v1/scenes/prismatica-aurora-cathedral.glb' },
  { id: 'asterion', name: 'Asterion', url: '../../bridge-blenderizer/v1/scenes/asterion.glb' },
  { id: 'lumen', name: 'LUMEN', url: 'scenes/lumen.glb' },
  { id: 'stilllife', name: 'Still life', url: '../../bridge-blenderizer/v1/scenes/stilllife-addon.glb' },
];
const PORTABLE = ['lossless', 'meshopt-lossless', 'quantized', 'web', 'web-filter', 'instanced', 'static-joined', 'stock-instance'];
const SUB = { lossless: 'dedup, prune, weld', 'meshopt-lossless': '+ reorder, meshopt', quantized: '+ 14-bit quantization', web: 'quantize + meshopt', 'web-filter': 'web + vertex filters', instanced: 'web + GPU instancing, names kept', 'static-joined': 'flatten + join', 'stock-instance': 'glTF-Transform instance()' };
const PRE = [
  { id: 'draco', label: 'draco', summary: 'lossless + KHR_draco_mesh_compression (edgebreaker, 14/10/12-bit)', identity: 'exact', geometry: 'bits:14', writes: ['KHR_draco_mesh_compression'] },
  { id: 'web-ktx2-etc1s', label: 'ktx2-etc1s', summary: 'web + KTX2 textures (ETC1S, mips): smallest textures, visible block artefacts on gradients', identity: 'exact', geometry: 'bits:14', writes: ['KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_texture_basisu'] },
];
const CATS = [['position', '#5db4ff'], ['normal', '#37d5c2'], ['uv', '#9c8bff'], ['colour', '#ffb454'], ['tangent', '#ff7a5c'], ['indices', '#7ddc6a'], ['image', '#ff5d6c'], ['animation', '#c792ea'], ['skin', '#ffd166'], ['morph', '#06d6a0'],
  ['instancing', '#ef476f'], ['draco', '#f78c6b'], ['sparse', '#8ecae6'], ['attrOther', '#adb5bd'], ['unreferenced', '#6b7694'], ['json', '#f2e8cf'], ['padding', '#46526f'], ['header', '#2f3e63']];
const CATINFO = {
  position: 'Vertex positions, 3 numbers per vertex. Quantisation stores them as 16-bit integers; meshopt packs them further.', normal: 'Vertex normals, the lighting direction at each vertex.', uv: 'Texture coordinates, 2 numbers per vertex.',
  colour: 'Per-vertex colours.', tangent: 'Tangent vectors for normal mapping.', indices: 'Triangle index lists: which three vertices make each triangle.', image: 'Texture images embedded in the glb (PNG or JPEG, or KTX2 after the KTX2 profile).',
  animation: 'Animation sampler times and values.', skin: 'Skin joints, weights and inverse bind matrices.', morph: 'Morph target deltas.', instancing: 'Per-instance translation, rotation and scale of EXT_mesh_gpu_instancing batches.',
  draco: 'Draco-compressed mesh streams: positions, normals, uvs and indices together, in compressed form.', sparse: 'Sparse accessor data.', attrOther: 'Other vertex attributes.', unreferenced: 'Buffer views that nothing refers to.',
  json: 'The JSON chunk: node tree, names, extras (the X3D identity), accessors, materials. The identity lives here, not in the binary.', padding: 'Chunk padding and bytes that no buffer view claims.', header: 'The 12-byte glb header and the two 8-byte chunk headers.',
};

const S = { R: null, scene: 'cathedral', chip: 'instanced', cur: null, seq: 0, meta: null, src: new Map(), viewerP: null, viewer: null, worker: null, workerP: null, parity: new Map(), mode: 'wipe', matrix: { running: false, stop: false }, steps: [], metric: 'raw', sort: null, dir: 'asc', hl: new Set(), hlCat: null, adapter: null };
const audit = createAudit();

// ====================================================== worker
let msgId = 1, chain = Promise.resolve(); const waiting = new Map();
function startWorker() {
  if (S.workerP) return S.workerP;
  S.workerP = new Promise((ok, no) => {
    const w = S.worker = new Worker('./forge-worker.js', { type: 'module' });
    w.onerror = (e) => { const err = new Error('The optimiser worker failed: ' + (e.message || 'could not load forge.bundle.js as a module worker')); no(err); for (const x of waiting.values()) x.no(err); waiting.clear(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { S.meta = m.profiles; ok(m); return; }
      const x = waiting.get(m.id); if (!x) return;
      if (m.type === 'step') { x.onStep && x.onStep(m.rec); return; }
      waiting.delete(m.id);
      if (m.type === 'error') x.no(new Error(m.message)); else x.ok(m);
    };
  });
  return S.workerP;
}
function callWorker(msg, transfer, onStep) {
  const run = () => new Promise((ok, no) => { const id = msgId++; waiting.set(id, { ok, no, onStep }); S.worker.postMessage({ ...msg, id }, transfer || []); });
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}

// ====================================================== sources
function getSource(id) {
  if (S.src.has(id)) return S.src.get(id);
  const sc = SCENES.find((s) => s.id === id), rec = S.R.scenes[id];
  const p = (async () => {
    stageBusy(`Loading ${sc.url.split('/').pop()}`, 0);
    const bytes = await fetchBytes(sc.url, (got, tot) => stageBusy(`Loading ${sc.url.split('/').pop()}: ${(got / 1048576).toFixed(1)} of ${((tot || rec.bytes) / 1048576).toFixed(1)} MB`, tot ? got / tot : 0), rec.bytes);
    const sha = await sha256hex(bytes);
    const sp = splitGlb(bytes);
    const o = { id, name: sc.name, bytes, sha, shaOk: sha == null ? null : sha === rec.sha256, json: sp.json, gzip: await gzipLength(bytes), breakdown: null };
    return o;
  })();
  p.catch(() => S.src.delete(id));
  S.src.set(id, p); return p;
}
async function breakdownOf(bytes, viaLane) {
  if (viaLane) { try { await startWorker(); const copy = bytes.slice(0); const m = await callWorker({ type: 'inspect', bytes: copy }, [copy]); return { ...m.result.bytes, via: 'inspectBytes' }; } catch { /* fall through */ } }
  return { ...byteCategories(bytes), via: 'this page, from the JSON chunk' };
}

// ====================================================== stage messages
function stageBusy(text, frac) { const m = $('stageMsg'); m.className = 'stagemsg on'; m.innerHTML = `<div>${esc(text)}<progress max="100" value="${Math.round((frac || 0) * 100)}" aria-label="Loading progress"></progress></div>`; }
function stageDone() { $('stageMsg').className = 'stagemsg'; }
function stageError(text) { const m = $('stageMsg'); m.className = 'stagemsg on err'; m.innerHTML = `<div>${esc(text)}</div>`; }

// ====================================================== viewer (lazy)
function ensureViewer() {
  if (S.viewerP) return S.viewerP;
  S.viewerP = import('./viewer.js').then((mod) => {
    const v = mod.createViewer($('stage'), {
      onFrame: (c) => drawLine(c), onDiff: (d) => diffLine(d), onError: (k, msg) => { if (k === 'gl') stageError(msg); else $('diffOut').textContent = 'Difference failed: ' + msg; },
    });
    S.viewer = v; v.rev = mod.REVISION;
    $('touchBtn').hidden = !(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    if (!$('touchBtn').hidden) v.setTouchOrbit(false);
    v.setMode(S.mode); v.setGain(+$('gainSel').value); v.setFill($('fillChk').checked);
    refreshAdapter(v.adapter);
    return v;
  }).catch((e) => { stageError('The 3D view could not start: ' + (e.message || e) + '. The forge, the audit, the gates and the shootout still work.'); S.viewerFail = true; throw e; });
  S.viewerP.catch(() => {});
  return S.viewerP;
}
function refreshAdapter(name) {
  const sw = /swiftshader|llvmpipe|software|basic render|softpipe/i.test(name || '');
  S.adapter = name;
  $('adapterChip').className = 'chip ' + (sw ? 'warn' : '');
  $('adapterChip').textContent = `WebGL adapter: ${name || 'none available'}${sw ? ' (a software rasteriser)' : ''}. Nothing on this page was timed on a real GPU.`;
}
function drawLine(c) {
  if (!c.A || !c.B) return;
  $('drawOut').innerHTML = `three.js r${S.viewer.rev} drew <b>${fmt(c.A.calls)}</b> draw calls for the original and <b>${fmt(c.B.calls)}</b> for the forged file this frame, ${fmt(c.A.triangles)} and ${fmt(c.B.triangles)} triangles (renderer.info; frustum culling applies) <span class="src brw">browser</span>`;
}
function diffLine(d) {
  const o = $('diffOut'); if (!d) { o.textContent = 'Difference needs both models loaded.'; return; }
  const p = (v) => (Number.isFinite(v) ? v.toFixed(1) + ' dB' : 'infinite (identical)');
  o.innerHTML = `|A − B| per channel after sRGB encoding, <b>× ${d.gain}</b> for the heat map. Over all ${fmt(d.pixels)} pixels (${d.width}×${d.height}): mean abs error <b>${d.meanAbs.toFixed(3)}</b> of 255, max <b>${d.maxAbs}</b>, PSNR <b>${p(d.psnr)}</b>; ${fmt(d.diffPixels)} pixels differ. Over the ${fmt(d.covered)} pixels either model covers: mean abs error ${d.covMeanAbs.toFixed(3)}, PSNR ${p(d.covPsnr)}. <span class="src brw">browser</span> three.js r${S.viewer.rev} on ${esc(S.adapter || 'unknown adapter')}, ${d.halfFloat ? 'half-float' : '8-bit'} render targets.`;
}

// ====================================================== scene / chip selection
function buildTabs() {
  const tabs = $('sceneTabs');
  for (const s of SCENES) {
    const b = el('button', 'btn', esc(s.name), { type: 'button', 'aria-pressed': String(s.id === S.scene) }); b.dataset.id = s.id;
    b.onclick = () => setScene(s.id, true); tabs.appendChild(b);
  }
}
function buildChips() {
  const box = $('profileChips');
  const mk = (id, label, sub, pre) => {
    const b = el('button', 'pchip' + (pre ? ' pre' : ''), `<span>${esc(label)}${id === 'static-joined' || id === 'stock-instance' ? ' <span class="trap">TRAP</span>' : ''}</span><small>${esc(sub)}</small>`, { type: 'button', 'aria-pressed': String(id === S.chip) });
    b.dataset.id = id; b.onclick = () => setChip(id); box.appendChild(b); return b;
  };
  PORTABLE.forEach((id) => mk(id, id, SUB[id], false));
  PRE.forEach((p) => mk(p.id, p.label, 'Node-only, precomputed', true));
}
function chipAvailable(id) { const r = S.R.scenes[S.scene]; return !!(r && r.profiles[id]); }
function syncChips() {
  for (const b of $('profileChips').children) {
    const id = b.dataset.id, isPre = PRE.some((p) => p.id === id);
    b.setAttribute('aria-pressed', String(id === S.chip));
    b.disabled = isPre && !chipAvailable(id);
    b.title = b.disabled ? 'No precomputed file for this scene in the receipts' : '';
  }
}
function isPre(id) { return PRE.some((p) => p.id === id); }
function setChip(id) {
  S.chip = id; syncChips(); renderProfileCard(); syncForgeBtn();
}
function syncForgeBtn() {
  const b = $('forgeBtn'), pre = isPre(S.chip), cur = S.cur;
  b.textContent = pre ? `Load ${S.chip === 'draco' ? 'Draco' : 'ETC1S'} file` : `Forge ${S.chip}`;
  const stale = !cur || cur.profile !== S.chip || cur.scene !== S.scene;
  b.classList.toggle('stale', stale && !!cur);
  b.disabled = !(S.workerReady || pre) || S.busy;
  $('forgeNote').textContent = S.busy ? $('forgeNote').textContent : !S.workerReady && !pre ? 'Loading the optimiser…' : stale && cur ? `Showing ${cur.profile} on ${SHORT[cur.scene] || cur.scene}. Press the button to run ${S.chip}.` : cur ? `Done: ${cur.profile} on ${SHORT[cur.scene] || cur.scene}. Run it again to watch the steps.` : 'Ready.';
}
async function setScene(id, andRun) {
  S.scene = id; const seq = ++S.seq;
  for (const b of $('sceneTabs').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  if (isPre(S.chip) && !chipAvailable(S.chip)) S.chip = 'web';
  syncChips(); renderProfileCard();
  S.cur = null; clearResult();
  try {
    const src = await getSource(id); if (seq !== S.seq) return;
    $('tagL').textContent = `original · ${SHORT[id]}`; $('tagR').textContent = 'forged · …';
    const v = await ensureViewer().catch(() => null);
    if (v && seq === S.seq) {
      stageBusy('Decoding the original in three.js…', 1);
      v.clear('B');
      const info = await v.load('A', src.bytes, { frame: true }); S.infoA = info;
      $('stageSt').textContent = `original: ${fmt(info.meshes)} meshes, ${fmt(info.instancedMeshes)} instanced, ${fmt(info.lights)} lights · ${info.light}`;
    }
    if (seq !== S.seq) return;
    stageDone();
    renderSourceNote(src);
    if (andRun) await run();
  } catch (e) { if (seq === S.seq) stageError(`Could not load ${id}: ${e.message || e}`); }
}
function renderSourceNote(src) {
  const r = S.R.scenes[src.id];
  $('cmpRead').innerHTML = `<b>${esc(SHORT[src.id])}</b>: ${kib(src.bytes.byteLength)} original, read from this site. ${src.shaOk === true ? `Its SHA-256 (<span class="hash" title="${src.sha}">${short(src.sha)}</span>) equals the receipts' value, so this is the file the Node CLI started from.` : src.shaOk === false ? `<b class="fail">Its SHA-256 differs from the receipts' (${short(src.sha)} against ${short(r.sha256)}): the receipts describe a different file, and the parity checks below are not meaningful.</b>` : 'SHA-256 needs a secure context (https or localhost), so the file could not be checked against the receipts.'}`;
}
function clearResult() {
  $('resBody').innerHTML = '<span class="note">Pick a profile and press the button.</span>'; $('stepsBody').innerHTML = '<span class="note">The step list streams here while a profile runs.</span>';
  $('tagR').textContent = 'forged · …';
}

// ====================================================== profile card
function renderProfileCard() {
  const id = S.chip, pre = PRE.find((p) => p.id === id), m = pre || (S.meta && S.meta[id]);
  const box = $('profCard');
  if (!m) { box.innerHTML = '<span class="note">The profile description arrives with the optimiser.</span>'; return; }
  const idText = { exact: 'every name and extras token survives (lost 0, added 0)', mapped: 'tokens survive inside extras.x3d_instances of a batch node (lost 0); the batch nodes are new', lossy: 'tokens may be lost; the loss is counted and shown, never hidden' }[m.identity];
  const g = m.geometry === 'exact' ? 'centroids identical within 1e-7 of the scene diagonal' : `centroids within 2^-${+m.geometry.split(':')[1] - 1} = ${(2 ** -(+m.geometry.split(':')[1] - 1)).toExponential(2)} of the diagonal (${m.geometry})`;
  // what the receipts say, across the scenes
  const cells = Object.values(S.R.scenes).map((s) => s.profiles[id]).filter(Boolean);
  let obs = '';
  if (cells.length) {
    const scs = Object.entries(S.R.scenes).filter(([, s]) => s.profiles[id]);
    obs = scs.map(([k, s]) => `${SHORT[k]} ${(s.profiles[id].bytes / s.bytes * 100).toFixed(0)}%`).join(', ');
  }
  let contra = '';
  if (id === 'web-filter' && /larger before/.test(m.summary || '')) {
    const sc = Object.entries(S.R.scenes).filter(([, s]) => s.profiles.web && s.profiles['web-filter']);
    const smaller = sc.filter(([, s]) => s.profiles['web-filter'].bytes < s.profiles.web.bytes).length;
    if (smaller) contra = `<dt>receipts</dt><dd><b style="color:var(--amber)">Disagree with the summary's "larger before":</b> web-filter's raw size is smaller than web's on ${smaller} of ${sc.length} scenes.</dd>`;
  }
  box.innerHTML = `<div class="profcard"><dl><dt>${pre ? 'file' : 'profile'}</dt><dd><b>${esc(id)}</b>${pre ? ' · Node-only, precomputed' : ''}</dd><dt>what it does</dt><dd>${esc(m.summary)}</dd><dt>identity contract</dt><dd><b>${esc(m.identity)}</b>: ${idText}</dd><dt>geometry bound</dt><dd>${esc(g)}</dd><dt>writes</dt><dd>${m.writes && m.writes.length ? esc(m.writes.join(', ')) : 'plain glTF, no new extension'}</dd>${obs ? `<dt>raw size, % of source <span class="src rcpt">receipt</span></dt><dd>${esc(obs)}</dd>` : ''}${contra}</dl></div>`;
}

// ====================================================== running
async function run() {
  if (S.busy) return;
  const id = S.chip, scene = S.scene, seq = S.seq;
  S.busy = true; $('forgeBtn').disabled = true;
  try {
    if (isPre(id)) await loadPre(scene, id, seq); else await forgeLive(scene, id, seq, true);
  } catch (e) {
    $('forgeNote').textContent = 'Failed: ' + (e.message || e); stageDone();
    $('resBody').innerHTML = `<span class="fail">${esc(e.message || e)}</span>`;
  } finally { S.busy = false; syncForgeBtn(); }
}
function stepsReset() { S.steps = []; $('stepsBody').innerHTML = '<span class="note">reading the glb…</span>'; }
function stepsRender(extra) {
  const max = Math.max(1, ...S.steps.map((s) => s.ms)), rows = S.steps.map((s) => `<div class="step"><span class="nm">${esc(s.step)}</span><span class="bar"><i style="width:${Math.max(2, s.ms / max * 100).toFixed(0)}%"></i></span><span class="ms">${fmt(s.ms)} ms</span><span class="cnt">${s.before ? `nodes ${fmt(s.before.nodes)}→${fmt(s.after.nodes)} · meshes ${fmt(s.before.meshes)}→${fmt(s.after.meshes)} · accessors ${fmt(s.before.accessors)}→${fmt(s.after.accessors)}` : ''}</span></div>`);
  $('stepsBody').innerHTML = rows.join('') + (extra ? `<p class="note" style="margin-top:6px">${extra}</p>` : '');
}
async function forgeLive(scene, profile, seq, fg) {
  const src = await getSource(scene);
  const rec = S.R.scenes[scene].profiles[profile] || null;
  stepsReset(); $('forgeNote').textContent = `Forging ${SHORT[scene]} with ${profile} in a worker…`;
  stageBusy(`Forging ${profile}…`, 0.15);
  const t0 = performance.now();
  const copy = src.bytes.slice(0);
  const m = await callWorker({ type: 'forge', profile, bytes: copy }, [copy], (r) => { if (seq === S.seq) { S.steps.push(r); stepsRender(); $('forgeNote').textContent = `${profile}: step ${S.steps.length}, ${r.step}`; } });
  const wall = performance.now() - t0;
  const cur = await finishLive(scene, profile, m, rec, src);
  cur.wall = wall;
  if (seq !== S.seq) return cur;
  stageDone();
  S.cur = cur; await showResult(cur, seq);
  return cur;
}
async function finishLive(scene, profile, m, rec, src) {
  const sha = await sha256hex(m.bytes);
  const sp = splitGlb(m.bytes);
  const cur = { kind: 'live', scene, profile, bytes: m.bytes, report: m.report, ms: m.ms, steps: m.report.steps, sha, json: sp.json, rec, gzip: await gzipLength(m.bytes), parity: null };
  if (rec && sha) cur.parity = sha === rec.sha256;
  recordParity(cur, src);
  return cur;
}
async function loadPre(scene, id, seq) {
  const rec = S.R.scenes[scene].profiles[id], src = await getSource(scene);
  if (!rec) throw new Error('no receipt row for ' + id);
  $('forgeNote').textContent = `Loading ${rec.file}…`; stepsReset(); $('stepsBody').innerHTML = '<span class="note">Made by the Node CLI earlier; its steps are in the receipt.</span>';
  stageBusy(`Loading ${rec.file}`, 0);
  const bytes = await fetchBytes('scenes/' + rec.file, (g, t) => stageBusy(`Loading ${rec.file}: ${kib(g)}`, t ? g / t : g / rec.bytes), rec.bytes);
  const sha = await sha256hex(bytes);
  const cur = { kind: 'pre', scene, profile: id, bytes, report: null, ms: null, steps: (rec.steps || []).map((s) => ({ step: s.step, ms: s.ms })), sha, json: splitGlb(bytes).json, rec, gzip: await gzipLength(bytes), parity: sha ? sha === rec.sha256 : null };
  if (seq !== S.seq) return;
  stageDone(); S.cur = cur; await showResult(cur, seq);
}

// ====================================================== showing a result
async function showResult(cur, seq) {
  const src = await getSource(cur.scene);
  S.steps = cur.steps.slice();
  if (cur.kind === 'live') { const sum = cur.steps.reduce((a, s) => a + s.ms, 0); stepsRender(`Steps ${fmt(sum)} ms; the call took ${fmt(cur.ms)} ms in the worker (it also reads the glb, writes it and runs the gates). CPU wall-clock on your machine <span class="src live">live</span>. Node CLI, same profile: ${rec(cur) ? fmt(rec(cur).nodeMs) + ' ms for the optimise step <span class="src rcpt">receipt</span>' : 'no receipt'}.`); }
  else stepsRender(`Node CLI, precomputed (ms per step) <span class="src rcpt">receipt</span>.`);
  $('tagR').textContent = `forged · ${cur.profile}`;
  syncForgeBtn(); renderProfileCard();
  $('forgeNote').textContent = `Done: ${cur.profile} on ${SHORT[cur.scene]}${cur.kind === 'live' ? ` in ${fmt(cur.ms)} ms (worker, CPU)` : ' (precomputed file)'}.`;
  const au = auditFor(cur, src);
  renderResult(cur, src);
  renderParityBanner(cur);
  renderGatesFor(cur, src);
  // heavier parts, in order, so the page paints between them
  await wait(0);
  pushViewer(cur, seq);
  renderBytes(cur, src, seq);
  return au;
}
const rec = (cur) => cur.rec;

function auditFor(cur, src) {
  const au = auditPair(src.json, cur.json); cur.audit = au;
  const r = cur.report, rc = cur.rec;
  const lane = r ? { from: "lane's report (this browser, live)", sourceTokens: r.identity.sourceTokens, outputTokens: r.identity.outputTokens, preserved: r.identity.preserved, lost: r.identity.lost, added: r.identity.added }
    : rc ? { from: 'receipt (Node CLI)', sourceTokens: rc.identity.sourceTokens, preserved: rc.identity.preserved, lost: rc.identity.lost, added: rc.identity.added }
      : { from: 'no lane figure', sourceTokens: NaN, preserved: NaN, lost: NaN, added: NaN };
  const bad = audit.set(src, cur, au, lane, `${cur.profile} on ${SHORT[cur.scene]}${cur.kind === 'live' ? ' (forged in this browser)' : ' (precomputed file)'}`, true);
  cur.agree = bad === 0;
  if (bad) { $('adapterChip').insertAdjacentHTML('afterend', `<div class="chip bad" role="alert">Identity counters disagree for ${esc(cur.profile)} on ${esc(cur.scene)}: see the tether audit</div>`); }
  renderResult(cur, src);
  return au;
}

function kv(k, v, badge) { return `<div class="kv"><span class="k">${k}</span><span class="v">${v}${badge ? ` <span class="src ${badge[0]}">${badge[1]}</span>` : ''}</span></div>`; }
function chg(a, b) { const d = delta(a, b); return `<i class="${d < 0 ? 'good' : d > 0 ? 'badc' : ''}">${sign(d)}</i>`; }
function renderResult(cur, src) {
  const r = cur.report, rc = cur.rec, sc = S.R.scenes[cur.scene];
  const inv = r ? r.inventory : null, dc = inv ? [inv.source.drawCalls, inv.output.drawCalls] : rc && rc.drawCalls, tri = inv ? [inv.source.triangles, inv.output.triangles] : rc && rc.triangles, nd = inv ? [inv.source.nodes, inv.output.nodes] : rc && rc.nodes;
  const sB = src.bytes.byteLength, oB = cur.bytes.byteLength, valid = cur.kind === 'live' ? cur.parity === true : cur.parity === true;
  const rows = [];
  rows.push(kv('file size', `<b>${kib(sB)}</b> → <b>${kib(oB)}</b> ${chg(sB, oB)}<br><i>${fmt(sB)} → ${fmt(oB)} bytes</i>`, ['live', 'live']));
  rows.push(kv('gzip', cur.gzip != null && src.gzip != null ? `<b>${kib(src.gzip)}</b> → <b>${kib(cur.gzip)}</b> ${chg(src.gzip, cur.gzip)}<br><i>CompressionStream, default level</i>` : 'CompressionStream is not available in this browser', ['live', 'live']));
  rows.push(kv('brotli', rc ? `<b>${kib(sc.transfer.brotli)}</b> → ${valid ? `<b>${kib(rc.transfer.brotli)}</b> ${chg(sc.transfer.brotli, rc.transfer.brotli)}` : '<i>n/a, the receipt describes other bytes</i>'}<br><i>q11, Node zlib; a browser cannot make brotli</i>` : 'no receipt row', ['rcpt', 'receipt']));
  if (dc) rows.push(kv('draw calls', `<b>${fmt(dc[0])}</b> → <b>${fmt(dc[1])}</b> ${chg(dc[0], dc[1])}`, inv ? ['live', 'live'] : ['rcpt', 'receipt']));
  if (tri) rows.push(kv('triangles', `<b>${fmt(tri[0])}</b> → <b>${fmt(tri[1])}</b>`, inv ? ['live', 'live'] : ['rcpt', 'receipt']));
  if (nd) rows.push(kv('nodes', `${fmt(nd[0])} → ${fmt(nd[1])}`, inv ? ['live', 'live'] : ['rcpt', 'receipt']));
  const a = cur.audit;
  rows.push(kv('identity kept', a ? `<b class="${a.lost ? 'badc' : 'good'}">${fmt(a.preserved)} of ${fmt(a.sourceTokens)}</b> tokens${a.lost ? `, <b class="badc">${fmt(a.lost)} lost</b>` : ''}${a.moved ? `<br><i>${fmt(a.moved)} of them moved into instance batches</i>` : ''}` : 'counting…', ['live', 'live']));
  const ok = r ? r.ok : rc && rc.ok;
  rows.push(kv('gates', ok == null ? 'n/a' : ok ? '<span class="badge pass">PASS</span>' : `<span class="badge fail">FAIL</span> <i>${esc(((r ? r.failures : rc.failures) || [])[0] || '')}</i>`, r ? ['live', 'live'] : ['rcpt', 'receipt']));
  $('resBody').innerHTML = rows.join('');
  syncForgeBtn();
}

function clearViewerB() { if (S.viewer) S.viewer.clear('B'); }
async function pushViewer(cur, seq) {
  const v = await ensureViewer().catch(() => null); if (!v || seq !== S.seq) return;
  try {
    const info = await v.load('B', cur.bytes); if (seq !== S.seq) return;
    const A = S.infoA;
    $('stageSt').textContent = `original: ${fmt(A.meshes)} meshes, ${fmt(A.instancedMeshes)} instanced · forged: ${fmt(info.meshes)} meshes, ${fmt(info.instancedMeshes)} instanced (${fmt(info.instances)} instances) · ${info.light} · decoded with ${info.extensions.filter((e) => /meshopt|draco|basisu|quantization|instancing/i.test(e)).join(', ') || 'no extension'}`;
    if (info.triangles !== A.triangles) $('stageSt').textContent += ` · three.js counts ${fmt(info.triangles)} triangles against ${fmt(A.triangles)}`;
  } catch (e) { stageError(`three.js could not load the forged file: ${e.message || e}`); }
}

// ====================================================== bytes section
async function renderBytes(cur, src, seq) {
  if (!src.breakdown) src.breakdown = await breakdownOf(src.bytes, true);
  const out = cur.kind === 'live' ? await breakdownOf(cur.bytes, true) : await breakdownOf(cur.bytes, false);
  if (seq !== S.seq) return;
  cur.breakdown = out;
  const norm = (b) => { const o = { header: b.header, json: b.jsonBytes, padding: b.paddingAndOther, ...b.byCategory }; return o; };
  const A = norm(src.breakdown), B = norm(out), max = Math.max(src.breakdown.totalBytes, out.totalBytes);
  const used = CATS.filter(([k]) => A[k] || B[k]);
  const bar = (b, total, label, via) => `<div><div class="slab"><span><b>${label}</b> · ${kib(total)}</span><span>${esc(via)}</span></div><div class="sbar" style="width:${(total / max * 100).toFixed(2)}%;min-width:40px">${used.filter(([k]) => b[k]).map(([k, c]) => `<button type="button" data-cat="${k}" style="--cc:${c};width:${(b[k] / total * 100).toFixed(3)}%" aria-label="${k}: ${kib(b[k])}, ${(b[k] / total * 100).toFixed(1)}% of this file" title="${k}: ${kib(b[k])}"></button>`).join('')}</div></div>`;
  $('bytesBars').innerHTML = bar(A, src.breakdown.totalBytes, `source · ${SHORT[cur.scene]}`, src.breakdown.via) + bar(B, out.totalBytes, `output · ${cur.profile}`, out.via);
  const lg = $('bytesLegend'); lg.innerHTML = '';
  for (const [k, c] of used) {
    const b = el('button', null, `<i style="--cc:${c};background:${c}"></i>${k} <span class="note">${kib(A[k] || 0)} → ${kib(B[k] || 0)}</span>`, { type: 'button', 'aria-pressed': String(S.hlCat === k) }); b.style.setProperty('--cc', c); b.dataset.cat = k; lg.appendChild(b);
  }
  const showCat = (k) => {
    S.hlCat = k; for (const x of lg.children) x.setAttribute('aria-pressed', String(x.dataset.cat === k));
    for (const x of $('bytesBars').querySelectorAll('.sbar button')) x.classList.toggle('dim', !!k && x.dataset.cat !== k);
    $('catInfo').innerHTML = k ? `<b>${k}</b>: ${esc(CATINFO[k] || '')} Source ${kib(A[k] || 0)} (${((A[k] || 0) / src.breakdown.totalBytes * 100).toFixed(1)}%), output ${kib(B[k] || 0)} (${((B[k] || 0) / out.totalBytes * 100).toFixed(1)}%).` : 'Pick a segment or a category.';
  };
  for (const x of [...$('bytesBars').querySelectorAll('.sbar button'), ...lg.children]) { x.onclick = () => showCat(S.hlCat === x.dataset.cat ? null : x.dataset.cat); x.onmouseenter = x.onfocus = () => { if (!S.hlCat) $('catInfo').innerHTML = `<b>${x.dataset.cat}</b>: ${esc(CATINFO[x.dataset.cat] || '')} Source ${kib(A[x.dataset.cat] || 0)}, output ${kib(B[x.dataset.cat] || 0)}.`; }; }
  showCat(S.hlCat);
  // transfer table
  const rc = cur.rec, sc = S.R.scenes[cur.scene], valid = cur.parity === true;
  const row = (name, a, b, badge, note) => `<tr><td>${name}</td><td class="n">${a == null ? 'n/a' : fmt(a)}</td><td class="n">${b == null ? 'n/a' : fmt(b)}</td><td class="n">${a != null && b != null ? sign(delta(a, b)) : ''}</td><td><span class="src ${badge[0]}">${badge[1]}</span> <span class="note">${note}</span></td></tr>`;
  $('xferTable').querySelector('tbody').innerHTML =
    row('raw bytes', src.bytes.byteLength, cur.bytes.byteLength, ['live', 'live'], 'the file as loaded here') +
    row('gzip, live', src.gzip, cur.gzip, ['live', 'live'], 'CompressionStream, default level') +
    (rc ? row('gzip -9', sc.transfer.gzip, valid ? rc.transfer.gzip : null, ['rcpt', 'receipt'], valid ? 'Node zlib level 9' : 'output n/a: receipt is for other bytes') + row('brotli q11', sc.transfer.brotli, valid ? rc.transfer.brotli : null, ['rcpt', 'receipt'], valid ? 'Node zlib quality 11' : 'output n/a: receipt is for other bytes') : '');
}

// ====================================================== gates
function renderGatesFor(cur, src) {
  const r = cur.report, rc = cur.rec, pre = PRE.find((p) => p.id === cur.profile);
  const contract = r ? r.contract : { identity: pre.identity, geometry: pre.geometry };
  const idn = r ? r.identity : rc ? rc.identity : null;
  if (!idn) { $('gatesTable').querySelector('tbody').innerHTML = '<tr><td colspan="4" class="na">no gate data for this cell</td></tr>'; return; }
  const a = cur.audit || auditPair(src.json, cur.json);
  renderGates($('gatesTable').querySelector('tbody'), $('gatesRead'), {
    kind: cur.kind, profile: cur.profile, contract, identity: idn, pageAudit: a, failures: r ? r.failures : rc ? rc.failures : [], ok: r ? r.ok : rc ? rc.ok : null,
    geometry: r ? r.geometry : null, recGeo: rc ? rc.geometry : null, tri: rc ? rc.triangles : null, materials: r ? r.materials : null, animation: r ? r.animation : null,
    defPath: r ? r.identity.defPath : null, srcTags: tagStats(src.json), validator: rc ? rc.validator : null, validatorVersion: S.R.tools && S.R.tools['gltf-validator'], parity: cur.parity,
  });
}

// ====================================================== parity
function recordParity(cur, src) {
  const rc = cur.rec; if (!rc) return;
  S.parity.set(cur.scene + '|' + cur.profile, { scene: cur.scene, profile: cur.profile, browserBytes: cur.bytes.byteLength, nodeBytes: rc.bytes, browserSha: cur.sha, nodeSha: rc.sha256, same: cur.sha ? cur.sha === rc.sha256 : null, srcOk: src.shaOk });
  renderParityTable();
}
function renderParityTable() {
  const tb = $('parityTable').querySelector('tbody');
  tb.innerHTML = [...S.parity.values()].map((e) => `<tr><td class="mono">${esc(e.scene)} · ${esc(e.profile)}</td><td class="n">${fmt(e.browserBytes)}</td><td class="n">${fmt(e.nodeBytes)}</td><td><span class="hash" title="browser ${e.browserSha || 'n/a'}">${short(e.browserSha)}</span> / <span class="hash" title="Node CLI ${e.nodeSha}">${short(e.nodeSha)}</span></td><td class="${e.same ? 'pass' : 'fail'}">${e.same == null ? 'not hashed' : e.same ? '✓ identical' : '✗ DIFFERENT'}</td></tr>`).join('') || '<tr><td colspan="5" class="na">nothing yet</td></tr>';
}
function renderParityBanner(cur) {
  const b = $('parityBanner'), rc = cur.rec;
  if (cur.kind === 'pre') { b.className = 'pbanner ' + (cur.parity ? 'ok' : cur.parity === false ? 'bad' : ''); b.innerHTML = `<b>${esc(cur.profile)}</b> is precomputed: a browser cannot run its encoder, so there is no parity claim. This page hashed the file it loaded: ${cur.parity ? `it is <b>the file the receipts describe</b> (SHA-256 <span class="hash" title="${cur.sha}">${short(cur.sha)}</span>, ${fmt(cur.bytes.byteLength)} bytes).` : cur.parity === false ? `<b>it is not</b>: ${short(cur.sha)} against ${short(rc && rc.sha256)}.` : 'SHA-256 needs a secure context (https or localhost).'}`; return; }
  if (!rc) { b.className = 'pbanner'; b.textContent = 'No receipt row for this cell, so there is nothing to compare against.'; return; }
  if (cur.parity == null) { b.className = 'pbanner'; b.textContent = 'SHA-256 needs a secure context (https or localhost); this page cannot hash here.'; return; }
  if (cur.parity) { b.className = 'pbanner ok'; b.innerHTML = `<b>Identical.</b> Your browser produced the same <b>${fmt(cur.bytes.byteLength)}</b> bytes the Node CLI produced for ${esc(SHORT[cur.scene])} with <b>${esc(cur.profile)}</b>. SHA-256 <span class="hash" title="browser ${cur.sha}">${short(cur.sha)}</span> = <span class="hash" title="Node CLI ${rc.sha256}">${short(rc.sha256)}</span> (hover for the full hashes).`; }
  else { b.className = 'pbanner bad'; b.innerHTML = `<b>MISMATCH.</b> Your browser produced ${fmt(cur.bytes.byteLength)} bytes (SHA-256 <span class="hash" title="${cur.sha}">${short(cur.sha)}</span>); the Node CLI produced ${fmt(rc.bytes)} bytes (<span class="hash" title="${rc.sha256}">${short(rc.sha256)}</span>). The two environments disagree. Rows in the gates and byte sections that rely on the receipt are marked as describing other bytes.`; }
}
function buildMatrixGrid() {
  const g = $('matrixGrid'); g.innerHTML = '<span></span>' + PORTABLE.map((p) => `<span class="h" role="columnheader">${esc(p.replace('meshopt-', 'mo-').replace('static-', 's-').replace('stock-', 'st-'))}</span>`).join('');
  for (const s of SCENES) { g.insertAdjacentHTML('beforeend', `<span class="rl" role="rowheader">${esc(s.id)}</span>`); for (const p of PORTABLE) g.insertAdjacentHTML('beforeend', `<span class="c" role="cell" id="mx-${s.id}-${p}">·</span>`); }
}
async function runMatrix() {
  const btn = $('matrixBtn');
  if (S.matrix.running) { S.matrix.stop = true; btn.textContent = 'Stopping…'; return; }
  S.matrix = { running: true, stop: false }; btn.textContent = 'Stop'; buildMatrixGrid();
  let same = 0, n = 0, okEq = 0, idEq = 0, tot = 0;
  try {
    await startWorker();
    for (const s of SCENES) {
      for (const p of PORTABLE) {
        if (S.matrix.stop) throw new Error('stopped');
        const c = $(`mx-${s.id}-${p}`); c.className = 'c run'; c.textContent = '…'; $('matrixNote').textContent = `Running ${s.id} · ${p} (${tot + 1} of ${SCENES.length * PORTABLE.length})`;
        const src = await getSource(s.id), rc = S.R.scenes[s.id].profiles[p]; tot++;
        const copy = src.bytes.slice(0), m = await callWorker({ type: 'forge', profile: p, bytes: copy }, [copy]);
        const sha = await sha256hex(m.bytes), sp = splitGlb(m.bytes), au = auditPair(src.json, sp.json);
        const isSame = rc && sha ? sha === rc.sha256 : null;
        n++; if (isSame) same++;
        if (rc && m.report.ok === rc.ok) okEq++;
        const L = m.report.identity; if (au.sourceTokens === L.sourceTokens && au.outputTokens === L.outputTokens && au.preserved === L.preserved && au.lost === L.lost && au.added === L.added) idEq++;
        c.className = 'c ' + (isSame ? 'ok' : 'bad'); c.textContent = isSame ? '✓' : '✗'; c.title = `${s.id} ${p}: ${fmt(m.bytes.byteLength)} bytes, ${isSame ? 'identical to' : 'DIFFERENT from'} the receipt`;
        S.parity.set(s.id + '|' + p, { scene: s.id, profile: p, browserBytes: m.bytes.byteLength, nodeBytes: rc && rc.bytes, browserSha: sha, nodeSha: rc && rc.sha256, same: isSame, srcOk: src.shaOk });
        renderParityTable();
      }
    }
    $('matrixNote').innerHTML = `<b>${same} of ${n}</b> outputs are byte-identical to the Node CLI's. The lane's pass/fail verdict equals the receipt's on ${okEq} of ${n}; this page's independent identity count equals the lane's on ${idEq} of ${n}.`;
  } catch (e) { $('matrixNote').textContent = e.message === 'stopped' ? `Stopped after ${n} cells: ${same} identical.` : 'Matrix failed: ' + (e.message || e); }
  finally { S.matrix.running = false; btn.textContent = 'Run all 32 cells here'; }
}

// ====================================================== shootout and static sections
function drawShootout() {
  renderShootout(S.R, { metric: S.metric, sort: S.sort, dir: S.dir, hl: S.hl });
  metricTabs((m) => { S.metric = m; drawShootout(); }, S.metric);
  const box = $('shootCallouts'); box.innerHTML = '';
  callouts(S.R, { metric: S.metric }, S.meta).forEach((c, i) => {
    const d = el('div', 'callout', c.html + `<span class="srcrow">source rows: ${esc(c.src)} ${c.cells.length ? `<button type="button" data-i="${i}">highlight in the table</button>` : ''}</span>`); box.appendChild(d);
    const b = d.querySelector('button'); if (b) b.onclick = () => { S.hl = new Set(c.cells); renderShootout(S.R, { metric: S.metric, sort: S.sort, dir: S.dir, hl: S.hl }); $('shootTable').scrollIntoView({ block: 'nearest' }); };
  });
}
$('shootTable').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sort]'); if (!b) return;
  const k = b.dataset.sort || null;
  if (!k) { S.sort = null; } else if (S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = k; S.dir = 'asc'; }
  S.hl = new Set(); drawShootout();
});

function trapNotes() {
  const c = (p) => S.R.scenes.cathedral && S.R.scenes.cathedral.profiles[p];
  const t = c('stock-instance'), i = c('instanced'), j = c('static-joined');
  if (t) $('trapNote').innerHTML = `stock-instance: ${fmt(t.drawCalls[0])} → ${fmt(t.drawCalls[1])} draw calls, and <b>${fmt(t.identity.lost)} of ${fmt(t.identity.sourceTokens)}</b> identity tokens gone <span class="src rcpt">receipt</span>. Runs here, on the cathedral.`;
  if (i) $('safeNote').innerHTML = `instanced: the same ${fmt(i.drawCalls[0])} → ${fmt(i.drawCalls[1])} draw calls, <b>${fmt(i.identity.lost)}</b> of ${fmt(i.identity.sourceTokens)} lost <span class="src rcpt">receipt</span>.`;
  if (j) $('joinNote').innerHTML = `static-joined: ${fmt(j.identity.lost)} of ${fmt(j.identity.sourceTokens)} lost, and the geometry gate ${j.ok ? 'passes' : '<b>fails</b> (' + esc((j.failures[0] || '').replace('geometry: ', '')) + ')'} <span class="src rcpt">receipt</span>.`;
}
async function go(scene, profile) {
  if (S.busy) return;
  S.chip = profile;
  if (S.scene !== scene) await setScene(scene, true); else { syncChips(); renderProfileCard(); await run(); }
}
$('trapBtn').onclick = () => go('cathedral', 'stock-instance'); $('safeBtn').onclick = () => go('cathedral', 'instanced'); $('joinBtn').onclick = () => go('cathedral', 'static-joined');

// ====================================================== controls
$('forgeBtn').onclick = () => run();
$('modeWipe').onclick = () => setMode('wipe'); $('modeDiff').onclick = () => setMode('diff');
function setMode(m) {
  S.mode = m; $('modeWipe').setAttribute('aria-pressed', String(m === 'wipe')); $('modeDiff').setAttribute('aria-pressed', String(m === 'diff'));
  $('scalebar').classList.toggle('on', m === 'diff');
  if (S.viewer) S.viewer.setMode(m);
  if (m === 'wipe') $('diffOut').textContent = 'Wipe: drag the handle (or focus it and use the arrow keys); orbit with the mouse, scroll to zoom. Same camera on both sides.';
  else $('diffOut').textContent = 'Measuring…';
}
$('gainSel').onchange = () => { if (S.viewer) S.viewer.setGain(+$('gainSel').value); };
$('fillChk').onchange = () => { if (S.viewer) S.viewer.setFill($('fillChk').checked); };
$('resetBtn').onclick = () => S.viewer && S.viewer.resetView();
$('touchBtn').onclick = function () { const on = this.getAttribute('aria-pressed') !== 'true'; this.setAttribute('aria-pressed', String(on)); this.textContent = 'Touch orbit: ' + (on ? 'on' : 'off'); if (S.viewer) S.viewer.setTouchOrbit(on); };
$('matrixBtn').onclick = () => runMatrix();

// ====================================================== start
async function init() {
  $('scalebar').title = 'heat map: black is no difference; white is the gain times the difference reaching 1.0';
  buildTabs(); buildChips(); buildMatrixGrid(); renderParityTable();
  const ad = adapterName(); refreshAdapter(ad.name);
  try {
    const r = await fetch('forge-receipts.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
    S.R = await r.json();
  } catch (e) { $('toolsChip').className = 'chip bad'; $('toolsChip').textContent = 'Could not read forge-receipts.json: ' + e.message; return; }
  const t = S.R.tools || {};
  $('toolsChip').textContent = Object.keys(t).length ? `receipts: Node ${(t.node || '').replace(/^v/, '')} · glTF-Transform ${t['@gltf-transform/core']} · meshoptimizer ${t.meshoptimizer} · draco3dgltf ${t.draco3dgltf} · ktx2-encoder ${t['ktx2-encoder']} · gltf-validator ${t['gltf-validator']}` : 'receipts list no tool versions';
  $('tiles').innerHTML = headerTiles(S.R, Object.keys(t).length ? t : null);
  syncChips(); renderProfileCard(); trapNotes(); drawShootout();
  $('limitList').innerHTML = limitItems(S.R, S.adapter, null).map((x) => `<li>${x}</li>`).join('');
  $('auditHow').innerHTML = '<p>The source and the output are read here with <code>JSON.parse</code> on the glb JSON chunk: no glTF-Transform and none of the lane\'s identity code.</p><p>An <b>identity token</b> is <code>kind | name | extras</code>, one for every node, mesh, material, scene, camera and light that has a name or extras, plus the file-level extras; camera and light tokens also carry their parameters. A node whose extras say <code>x3d_wrapper_of</code> is a helper an optimiser inserted and is not counted. Each record in a batch node\'s <code>extras.x3d_instances</code> counts as a node token located inside that batch.</p><p>Tokens are matched one to one, so two identical tokens need two on the other side. A source token is <b>kept</b> if an output node has it, <b>moved</b> if only a batch record has it, <b>lost</b> if neither does. <b>added</b> is every output token no source token claims. The lane\'s identity module uses the same definition; this page wrote it again from the text, so a bug in either shows up as a disagreement in the table above.</p>';
  $('trapBtn').disabled = $('safeBtn').disabled = $('joinBtn').disabled = true;
  // after first paint: worker, viewer, first scene
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  startWorker().then(async () => {
    S.workerReady = true; $('trapBtn').disabled = $('safeBtn').disabled = $('joinBtn').disabled = false; renderProfileCard(); syncForgeBtn(); drawShootout();
    try { const h = await sha256hex(await (await fetch('forge.bundle.js')).arrayBuffer()); if (h) { $('bundleSha').textContent = short(h); $('bundleSha').title = h; } } catch { /* leave the placeholder */ }
  }).catch((e) => { $('forgeNote').textContent = e.message; });
  ensureViewer().then(() => { $('limitList').innerHTML = limitItems(S.R, S.adapter, S.viewer.rev).map((x) => `<li>${x}</li>`).join(''); }).catch(() => {});
  await setScene(S.scene, false);
  try { await S.workerP; S.workerReady = true; await run(); } catch { /* the note shows the failure */ }
}
init();
window.__forge = S;   // read-only handle for debugging in the console
