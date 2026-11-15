// Everything that is computed from forge-receipts.json alone: the header tiles, the shootout table, its callouts and the limits list.
// No number in here is typed in; each callout names the receipt rows it was read from.
import { $, esc, fmt, kib, mib, heat } from './util.js';

export const ORDER = ['lossless', 'meshopt-lossless', 'quantized', 'web', 'web-filter', 'instanced', 'static-joined', 'stock-instance', 'draco', 'web-ktx2-etc1s'];
export const SHORT = { cathedral: 'PRISMATICA cathedral', asterion: 'Asterion', lumen: 'LUMEN', stilllife: 'Still life' };
const METRICS = [['raw', 'raw bytes'], ['gzip', 'gzip -9 (Node zlib)'], ['brotli', 'brotli q11 (Node zlib)']];
const TRAPS = new Set(['static-joined', 'stock-instance']);

const cell = (R, s, p) => (R.scenes[s] && R.scenes[s].profiles[p]) || null;
const val = (R, s, p, m) => { const c = cell(R, s, p); return c ? (m === 'raw' ? c.transfer.raw : c.transfer[m]) : null; };
const base = (R, s, m) => R.scenes[s].transfer[m];
const P = (v, b, d = 1) => (v / b * 100).toFixed(d) + '%';
const row = (s, p, f) => `scenes.${s}.profiles.${p}.${f}`;
const clean = (c) => c && c.ok && c.identity.lost === 0;   // passes every gate and loses no identity token

export function headerTiles(R, tools) {
  const t = [], sc = R.scenes, cath = sc.cathedral, ins = cath && cell(R, 'cathedral', 'instanced'), stk = cath && cell(R, 'cathedral', 'stock-instance');
  const toolLine = tools ? `Node CLI ${tools.node || ''}, glTF-Transform ${tools['@gltf-transform/core'] || '?'}, meshoptimizer ${tools.meshoptimizer || '?'}` : 'tool versions not listed in this receipts file';
  if (ins) t.push(`<div class="tile" style="--c:var(--sage)"><b>${fmt(ins.drawCalls[0])} → ${fmt(ins.drawCalls[1])} <small>draw calls</small></b><span>PRISMATICA cathedral, profile <code>instanced</code>: ${fmt(ins.identity.lost)} of ${fmt(ins.identity.sourceTokens)} identity tokens lost</span><small>${kib(cath.bytes)} → ${kib(ins.bytes)} raw. <span class="src rcpt">receipt</span> ${esc(toolLine)}</small></div>`);
  if (stk) t.push(`<div class="tile" style="--c:var(--red)"><b>${fmt(stk.identity.lost)} of ${fmt(stk.identity.sourceTokens)} <small>tokens gone</small></b><span>same cathedral, profile <code>stock-instance</code> (glTF-Transform's own <code>instance()</code>): the same ${fmt(stk.drawCalls[0])} → ${fmt(stk.drawCalls[1])} draw calls</span><small><span class="src rcpt">receipt</span> ${esc(toolLine)}</small></div>`);
  let n = 0, ok = 0; const bad = [];
  for (const [s, v] of Object.entries(sc)) for (const [p, c] of Object.entries(v.profiles)) if (c.portable) { n++; if (c.ok) ok++; else bad.push(`${s} ${p}`); }
  if (n) t.push(`<div class="tile" style="--c:var(--amber)"><b>${ok} of ${n} <small>portable cells pass every gate</small></b><span>${bad.length ? 'Fails: ' + esc(bad.join('; ')) + ' (' + esc((cell(R, bad[0].split(' ')[0], bad[0].split(' ')[1]).failures[0] || '').replace(/^geometry: /, '')) + ')' : 'none fail'}</span><small><span class="src rcpt">receipt</span> ${fmt(Object.keys(sc).length)} scenes × the 8 portable profiles, one Node run each; ${fmt(Object.values(sc).reduce((a, v) => a + Object.values(v.profiles).filter((c) => c.identity.lost > 0).length, 0))} cells lost identity tokens (counted, listed in section 6)</small></div>`);
  const k = cell(R, 'stilllife', 'web-ktx2-etc1s');
  if (k) t.push(`<div class="tile" style="--c:var(--violet)"><b>${mib(k.gpuTextureBytes[0])} → ${mib(k.gpuTextureBytes[1])} <small>texture memory</small></b><span>Still life with KTX2 ETC1S (precomputed): estimated GPU texture bytes, ${P(k.gpuTextureBytes[1], k.gpuTextureBytes[0])} of the PNG's</span><small><span class="src rcpt">receipt</span> glTF-Transform's size formula, not a GPU measurement. ktx2-encoder ${esc((tools && tools['ktx2-encoder']) || '?')}</small></div>`);
  return t.join('');
}

// ---------- the table ----------
export function renderShootout(R, st) {
  const scenes = Object.keys(R.scenes), m = st.metric;
  const rows = ORDER.filter((p) => scenes.some((s) => cell(R, s, p)));
  const pctOf = (s, p) => { const v = val(R, s, p, m); return v == null ? null : v / base(R, s, m) * 100; };
  let list = rows.slice();
  if (st.sort) list.sort((a, b) => { const x = pctOf(st.sort, a), y = pctOf(st.sort, b); if (x == null) return 1; if (y == null) return -1; return st.dir === 'asc' ? x - y : y - x; });
  const arrow = (s) => (st.sort === s ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '');
  let h = `<thead><tr><th aria-sort="${st.sort ? 'none' : 'other'}"><button type="button" data-sort="">profile${st.sort ? '' : ' ·'}</button></th>`;
  for (const s of scenes) h += `<th class="n" aria-sort="${st.sort === s ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${s}">${esc(SHORT[s] || s)}${arrow(s)}<br><span style="text-transform:none;letter-spacing:0">${kib(base(R, s, m))}</span></button></th>`;
  h += '</tr></thead><tbody>';
  for (const p of list) {
    const anyc = scenes.map((s) => cell(R, s, p)).find(Boolean);
    h += `<tr><td class="mono"><b>${esc(p)}</b>${TRAPS.has(p) ? ' <span class="trap">TRAP</span>' : ''}${anyc && !anyc.portable ? '<br><span class="note">Node-only, precomputed</span>' : ''}</td>`;
    for (const s of scenes) {
      const c = cell(R, s, p);
      if (!c) { h += '<td class="cell na">—</td>'; continue; }
      const v = val(R, s, p, m), pc = v / base(R, s, m) * 100, hl = st.hl && st.hl.has(s + '|' + p);
      const flags = (c.ok ? '' : '<span class="flag">gate FAIL</span> ') + (c.identity.lost ? `<span class="flag">${fmt(c.identity.lost)} ids lost</span>` : '');
      h += `<td class="cell n ${hl ? 'hl' : ''}" data-cell="${s}|${p}" style="background:${heat(pc)}"><b>${pc.toFixed(1)}%</b><small>${kib(v)}</small>${flags ? `<small>${flags}</small>` : ''}</td>`;
    }
    h += '</tr>';
  }
  $('shootTable').innerHTML = h + '</tbody>';
}

// ---------- callouts ----------
export function callouts(R, st, laneMeta) {
  const scenes = Object.keys(R.scenes), m = st.metric, out = [];
  const all = []; for (const s of scenes) for (const p of ORDER) { const c = cell(R, s, p); if (c) all.push({ s, p, c }); }
  const add = (html, src, cells) => out.push({ html, src, cells: cells || [] });

  // 1 smallest per scene
  {
    const parts = [], cells = [], srcs = [], notes = [];
    for (const s of scenes) {
      const cands = all.filter((x) => x.s === s && clean(x.c)).sort((a, b) => val(R, s, a.p, m) - val(R, s, b.p, m));
      const any = all.filter((x) => x.s === s && x.c.ok).sort((a, b) => val(R, s, a.p, m) - val(R, s, b.p, m));
      if (!cands.length) continue;
      const w = cands[0]; parts.push(`${esc(SHORT[s])}: <b>${esc(w.p)}</b> ${kib(val(R, s, w.p, m))} (${P(val(R, s, w.p, m), base(R, s, m))})`);
      cells.push(s + '|' + w.p); srcs.push(row(s, w.p, m === 'raw' ? 'bytes' : 'transfer.' + m));
      if (any[0].p !== w.p) { notes.push(`${esc(SHORT[s])}: ${esc(any[0].p)} is smaller still (${kib(val(R, s, any[0].p, m))}) but loses ${fmt(any[0].c.identity.lost)} identity tokens`); cells.push(s + '|' + any[0].p); }
    }
    add(`<b>Smallest per scene, ${m === 'raw' ? 'raw' : m}, among cells that pass every gate and lose no identity token.</b> ${parts.join(' · ')}.${notes.length ? ' The smallest cell overall is a different one where ' + notes.join('; ') + '.' : ''}`, srcs.join(', '), cells);
  }
  // 2 lossless larger than the original
  {
    const big = scenes.filter((s) => cell(R, s, 'lossless') && cell(R, s, 'lossless').bytes > R.scenes[s].bytes);
    if (big.length) {
      const gz = big.filter((s) => cell(R, s, 'lossless').transfer.gzip > R.scenes[s].transfer.gzip), br = big.filter((s) => cell(R, s, 'lossless').transfer.brotli > R.scenes[s].transfer.brotli);
      add(`<b>The "lossless" profile makes ${fmt(big.length)} of ${fmt(scenes.length)} files bigger.</b> ${big.map((s) => `${esc(SHORT[s])}: ${fmt(cell(R, s, 'lossless').bytes)} against ${fmt(R.scenes[s].bytes)} bytes (+${((cell(R, s, 'lossless').bytes / R.scenes[s].bytes - 1) * 100).toFixed(1)}%)`).join('; ')}. After gzip it is bigger on ${fmt(gz.length)} (${gz.map((s) => esc(SHORT[s])).join(', ') || 'none'}), after brotli on ${fmt(br.length)}. The receipts do not say why; the profile's steps are dedup, prune and weld.`,
        big.map((s) => `${row(s, 'lossless', 'bytes')} vs scenes.${s}.bytes`).join(', '), big.map((s) => s + '|lossless'));
    }
  }
  // 3 ranking differs between raw and the transfer encodings
  {
    const flips = [];
    for (const s of scenes) {
      const c = all.filter((x) => x.s === s && clean(x.c)), rk = (mm) => { const o = c.slice().sort((a, b) => val(R, s, a.p, mm) - val(R, s, b.p, mm)); return new Map(o.map((x, i) => [x.p, i + 1])); };
      const r0 = rk('raw'), r2 = rk('brotli');
      for (const x of c) flips.push({ s, p: x.p, a: r0.get(x.p), b: r2.get(x.p), n: c.length });
    }
    flips.sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
    const changed = new Set(flips.filter((f) => f.a !== f.b).map((f) => f.s));
    const top = flips.slice(0, 2).filter((f) => f.a !== f.b);
    // web-filter against web
    const wf = scenes.filter((s) => cell(R, s, 'web') && cell(R, s, 'web-filter')).map((s) => ({ s, r: cell(R, s, 'web-filter').bytes / cell(R, s, 'web').bytes, g: cell(R, s, 'web-filter').transfer.gzip / cell(R, s, 'web').transfer.gzip, b: cell(R, s, 'web-filter').transfer.brotli / cell(R, s, 'web').transfer.brotli }));
    const rng = (k) => { const v = wf.map((x) => (x[k] - 1) * 100); return `${Math.min(...v).toFixed(1)}% to ${Math.max(...v).toFixed(1)}%`; };
    const larger = (laneMeta && laneMeta['web-filter'] && /larger before/.test(laneMeta['web-filter'].summary || '')) && wf.every((x) => x.r < 1);
    add(`<b>Ranking by raw size is not the ranking after transfer compression.</b> Among cells that pass every gate and lose nothing, the order by raw bytes differs from the order by brotli on ${fmt(changed.size)} of ${fmt(scenes.length)} scenes. Largest rank changes: ${top.map((f) => `on ${esc(SHORT[f.s])}, <b>${esc(f.p)}</b> is ${f.a}${ord(f.a)} of ${f.n} by raw size and ${f.b}${ord(f.b)} by brotli`).join('; ')}. <b>web-filter</b> against <b>web</b>: raw ${rng('r')}, gzip ${rng('g')}, brotli ${rng('b')} across the scenes.${larger ? ' The lane\'s own profile summary says web-filter is "larger before" compression; in these receipts it is smaller before too, on every scene.' : ''}`,
      `${top.map((f) => row(f.s, f.p, 'bytes') + ' and .transfer.brotli').join(', ')}; web-filter vs web: scenes.*.profiles.{web,web-filter}.transfer`, [...top.map((f) => f.s + '|' + f.p), ...wf.map((x) => x.s + '|web-filter')]);
  }
  // 4 KTX2
  {
    const k = cell(R, 'stilllife', 'web-ktx2-etc1s'), w = cell(R, 'stilllife', 'web');
    if (k && w) add(`<b>KTX2 ETC1S on Still life: texture memory and transfer.</b> Estimated GPU texture bytes ${fmt(k.gpuTextureBytes[0])} → ${fmt(k.gpuTextureBytes[1])} (${P(k.gpuTextureBytes[1], k.gpuTextureBytes[0])}; glTF-Transform's formula for the decoded size, not a GPU measurement). Against the same pipeline without KTX2 (<b>web</b>): raw ${fmt(w.bytes)} → ${fmt(k.bytes)} (${P(k.bytes, w.bytes)}), gzip ${fmt(w.transfer.gzip)} → ${fmt(k.transfer.gzip)}, brotli ${fmt(w.transfer.brotli)} → ${fmt(k.transfer.brotli)}. The texture is lossy: switch the viewer to Difference with this chip selected to see where.`,
      `${row('stilllife', 'web-ktx2-etc1s', 'gpuTextureBytes')}, ${row('stilllife', 'web-ktx2-etc1s', 'transfer')} vs ${row('stilllife', 'web', 'transfer')}`, ['stilllife|web-ktx2-etc1s', 'stilllife|web']);
  }
  // 5 Draco
  {
    const parts = [], cells = [];
    for (const mm of ['raw', 'gzip', 'brotli']) {
      const wins = scenes.filter((s) => { const d = cell(R, s, 'draco'); if (!d || !clean(d)) return false; return all.filter((x) => x.s === s && clean(x.c)).every((x) => val(R, s, x.p, mm) >= val(R, s, 'draco', mm)); });
      parts.push(`${mm === 'raw' ? 'raw' : mm}: ${wins.length ? wins.map((s) => esc(SHORT[s])).join(', ') : 'none'}`); if (mm === 'brotli') wins.forEach((s) => cells.push(s + '|draco'));
    }
    const odd = scenes.filter((s) => { const d = cell(R, s, 'draco'), wf = cell(R, s, 'web-filter'); return d && wf && d.bytes < wf.bytes && d.transfer.brotli > wf.transfer.brotli; });
    add(`<b>Where Draco wins.</b> Draco is the smallest clean cell on these scenes, by measure: ${parts.join('; ')}. ${odd.length ? 'Draco output does not compress further the way meshopt output does: ' + odd.map((s) => `on ${esc(SHORT[s])} it is smaller than web-filter raw (${fmt(cell(R, s, 'draco').bytes)} against ${fmt(cell(R, s, 'web-filter').bytes)}) and larger after brotli (${fmt(cell(R, s, 'draco').transfer.brotli)} against ${fmt(cell(R, s, 'web-filter').transfer.brotli)})`).join('; ') + '.' : ''} Draco ran in Node (draco3dgltf ${esc((R.tools && R.tools.draco3dgltf) || '?')}); this page only decodes it.`,
      scenes.map((s) => row(s, 'draco', 'transfer')).join(', '), scenes.map((s) => s + '|draco'));
  }
  // 6 byte-identical outputs where nothing repeats
  {
    const e1 = scenes.filter((s) => cell(R, s, 'instanced') && cell(R, s, 'web') && cell(R, s, 'instanced').sha256 === cell(R, s, 'web').sha256);
    const e2 = scenes.filter((s) => cell(R, s, 'stock-instance') && cell(R, s, 'lossless') && cell(R, s, 'stock-instance').sha256 === cell(R, s, 'lossless').sha256);
    if (e1.length || e2.length) add(`<b>Where nothing repeats, instancing does nothing.</b> <b>instanced</b> made the same file as <b>web</b> (same SHA-256) on ${e1.length ? e1.map((s) => esc(SHORT[s])).join(', ') : 'no scene'}; <b>stock-instance</b> made the same file as <b>lossless</b> on ${e2.length ? e2.map((s) => esc(SHORT[s])).join(', ') : 'no scene'}. The trap only fires on a scene with repeated meshes: on the others it costs nothing, which is why a one-scene test would not catch it.`,
      [...e1.map((s) => `${row(s, 'instanced', 'sha256')} = ${row(s, 'web', 'sha256')}`), ...e2.map((s) => `${row(s, 'stock-instance', 'sha256')} = ${row(s, 'lossless', 'sha256')}`)].join(', '), [...e1.map((s) => s + '|instanced'), ...e2.map((s) => s + '|stock-instance')]);
  }
  // 7 what the cheap wins cost
  {
    const lossy = all.filter((x) => x.c.identity.lost > 0), fl = all.filter((x) => !x.c.ok);
    if (lossy.length || fl.length) add(`<b>What the cheap cells cost.</b> ${fmt(lossy.length)} of ${fmt(all.length)} cells lose identity tokens: ${lossy.map((x) => `${esc(SHORT[x.s])} ${esc(x.p)} (${fmt(x.c.identity.lost)} of ${fmt(x.c.identity.sourceTokens)})`).join('; ')}. ${fl.length ? `${fmt(fl.length)} fail${fl.length === 1 ? 's' : ''} a gate: ${fl.map((x) => `${esc(SHORT[x.s])} ${esc(x.p)}: ${esc(x.c.failures.join(' and '))}`).join('; ')}.` : ''}`,
      [...lossy, ...fl].map((x) => row(x.s, x.p, 'identity.lost')).join(', '), [...lossy, ...fl].map((x) => x.s + '|' + x.p));
  }
  return out;
}
const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

export function metricTabs(onPick, cur) {
  const box = $('shootTabs'); box.innerHTML = '';
  for (const [id, label] of METRICS) {
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(id === cur)); b.onclick = () => onPick(id); box.appendChild(b);
  }
}

// ---------- the limits list ----------
export function limitItems(R, adapter, viewerRev) {
  const all = []; for (const s of Object.values(R.scenes)) for (const c of Object.values(s.profiles)) all.push(c);
  const zero = all.filter((c) => (c.notes || []).some((n) => /zero-area/.test(n)));
  const dr = Object.entries(R.scenes).map(([s, v]) => v.profiles.draco && `${SHORT[s] || s} ${fmt(v.profiles.draco.triangles[0])} → ${fmt(v.profiles.draco.triangles[1])}`).filter(Boolean);
  const dnote = Object.entries(R.scenes).flatMap(([s, v]) => (v.profiles.draco ? v.profiles.draco.notes || [] : []).map((n) => `${SHORT[s] || s}: ${n}`));
  const t = R.tools || {};
  return [
    `<b>No real-GPU timings.</b> The only times on this page are CPU wall-clock milliseconds of the forge steps in a worker on your machine, and the load times three.js reports. Nothing is a GPU timing. WebGL here runs on: <span class="mono">${esc(adapter || 'no WebGL adapter')}</span>. The page was built and checked in headless Chromium on a software rasteriser (SwiftShader); no real GPU was involved in building it.`,
    `<b>Node-only instruments.</b> The Khronos glTF-Validator (${esc(t['gltf-validator'] || '2.0.0-dev.3.10')}), the Draco encoder (draco3dgltf ${esc(t.draco3dgltf || '?')}) and the KTX2 / ETC1S encoder (ktx2-encoder ${esc(t['ktx2-encoder'] || '?')}) run in Node, not in this page. Their rows come from the receipts, and the two precomputed variants are files the CLI wrote earlier. The validator does not understand the compression extensions, which is why the lane also validates the decoded canonical file.`,
    `<b>One run per cell.</b> Every receipt cell is a single Node run (${esc(t.node || 'Node')}); the sizes and hashes are deterministic and the page rechecks the portable ones, but the <code>nodeMs</code> timings in the receipts are not repeated measurements and are not shown as results.`,
    `<b>Other engines.</b> This page renders in three.js ${esc(viewerRev ? 'r' + viewerRev : '')} only. The lane's own render oracle draws every variant in X_ITE, Babylon.js and three.js and compares the pictures; that matrix is not on this page.`,
    `<b>Draco and zero-area triangles.</b> The lane notes triangles an encoder drops as "zero-area triangles were dropped by the encoder". ${zero.length ? `${fmt(zero.length)} receipt cells carry that note.` : `None of the ${fmt(all.length)} receipt cells carries it, so this page has no number to give for it.`} Draco triangle counts, source → output: ${esc(dr.join('; '))}.${dnote.length ? ' Draco notes in the receipts: ' + esc(dnote.join('; ')) + '.' : ''}`,
    `<b>Gates the scenes cannot exercise.</b> The animation gate has nothing to compare on these four scenes (none is animated), and only Still life has a texture, so the material gate's texture handling is exercised on one scene. The lane's tests run animated fixtures that this page does not.`,
    `<b>The identity audit in section 3</b> is this page's own code, reading the glb JSON chunk. It is independent of the lane's identity module but encodes the same definition of an identity token (kind, name and extras; plus camera and light parameters), and says so in "How this was decided".`,
  ];
}
