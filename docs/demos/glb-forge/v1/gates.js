// The gates table. The verdicts are the lane's (report.failures for a live run, the receipt's failures for a precomputed file); this module prints the
// numbers and bounds next to them so a reader can check the verdict by eye. Bounds are copied from the lane's profile-contract.mjs and gates.mjs.
import { esc, fmt, sci } from './util.js';

export function bounds(spec) { const m = /^bits:(\d+)$/.exec(spec || ''); return m ? { bits: +m[1], relMax: 2 ** -(+m[1] - 1) } : { bits: null, relMax: 1e-7 }; }

const FAIL_RE = {
  identity: /^identity:/, triangles: /changed triangles|more non-degenerate|triangles collapsed/, centroid: /centroid deviation|no output triangle nearby/,
  area: /bounds moved|surface area/, normals: /normals p99|lost their normals/, materials: /^materials:/, animation: /^animation:/,
};
const failed = (failures, k) => failures.filter((f) => FAIL_RE[k].test(f));
const V = (kind, text) => ({ kind, text });
const verdict = (f) => (f.length ? V('fail', 'FAIL') : V('pass', 'PASS'));

export function gateRows(c) {
  const { contract, meta } = c, rows = [], isLive = c.kind === 'live';
  const failures = c.failures || [], b = bounds(contract.geometry);
  const id = c.identity, pg = c.pageAudit;
  const geo = c.geometry || {};

  // identity
  {
    const f = failed(failures, 'identity');
    let bound, v;
    if (contract.identity === 'exact') { bound = 'exact: lost 0 and added 0'; v = verdict(f); }
    else if (contract.identity === 'mapped') { bound = 'mapped: lost 0 (the batch nodes are new, their records carry the names)'; v = verdict(f); }
    else { bound = 'lossy: no bound, but the loss is counted and shown here'; v = id.lost > 0 ? V('warn', 'LOSS COUNTED') : V('pass', 'PASS'); }
    rows.push({ gate: 'Identity <span class="src ' + (isLive ? 'live' : 'rcpt') + '">' + (isLive ? 'live' : 'receipt') + '</span>', measured: `lane: <b>${fmt(id.preserved)}</b> of ${fmt(id.sourceTokens)} tokens preserved, <b class="${id.lost ? 'fail' : ''}">${fmt(id.lost)} lost</b>, ${fmt(id.added)} added${id.lostByKind && Object.keys(id.lostByKind).length ? ' (' + Object.entries(id.lostByKind).map(([k, n]) => `${k} ${fmt(n)}`).join(', ') + ')' : ''}<br>this page: kept ${fmt(pg.kept)}, moved ${fmt(pg.moved)}, lost ${fmt(pg.lost)}, added ${fmt(pg.added)}`, bound, verdict: v, note: contract.identity === 'lossy' ? 'A lossy contract is allowed to lose identity. It is never allowed to hide the loss: the number is above.' : '' });
  }
  // x3d_def_path chain
  {
    const dp = c.defPath, ts = c.srcTags;
    if (dp) {
      const none = dp.sourceClaims === 0;
      rows.push({ gate: 'x3d_def_path chain <span class="src live">live</span>', measured: `${fmt(dp.sourceHolds)} of ${fmt(dp.sourceClaims)} source claims hold; ${fmt(dp.outputHolds)} of ${fmt(dp.outputClaims)} in the output`, bound: 'every claim in the source still matches the hierarchy',
        verdict: none ? V('na', 'NOT RUN') : (dp.outputHolds >= dp.sourceHolds ? V('pass', 'PASS') : V('warn', 'CHECK')),
        note: none && ts && ts.defPath ? `The lane checked 0 claims although this file has ${fmt(ts.defPath)} nodes with x3d_def_path: its check reads the path as a list, and the add-on writes it as text (for example "OB_RimSun/OB_FillSun"). The identity gate above still compares the extras whole.` : (none ? 'This scene has no x3d_def_path.' : '') });
    }
  }
  // triangles
  {
    const f = failed(failures, 'triangles');
    if (geo.sourceTriangles != null) {
      const collapsed = -geo.solidDelta;
      rows.push({ gate: 'Triangles <span class="src ' + (isLive ? 'live' : 'rcpt') + '">' + (isLive ? 'live' : 'receipt') + '</span>', measured: `${fmt(geo.sourceTriangles)} → ${fmt(geo.outputTriangles)}; non-degenerate ${fmt(geo.sourceSolid)} → ${fmt(geo.outputSolid)}${collapsed > 0 ? `; <b class="${f.length ? 'fail' : ''}">${fmt(collapsed)} collapsed</b>` : ''}`,
        bound: b.bits == null ? 'exact profile: no triangle may change' : `collapsed ≤ max(16, 0.1% of ${fmt(geo.sourceSolid)}) = ${fmt(Math.max(16, 0.001 * geo.sourceSolid))}`, verdict: verdict(f), note: f.length ? esc(f[0]) : '' });
    } else if (c.tri) {
      rows.push({ gate: 'Triangles <span class="src rcpt">receipt</span>', measured: `${fmt(c.tri[0])} → ${fmt(c.tri[1])} (inventory, instances counted)`, bound: b.bits == null ? 'exact profile: no triangle may change' : 'collapsed ≤ max(16, 0.1%)', verdict: verdict(f), note: f.length ? esc(f[0]) : '' });
    }
  }
  // centroid
  {
    const f = failed(failures, 'centroid');
    const mx = geo.centroid ? geo.centroid.maxRel : c.recGeo ? c.recGeo.centroidMaxRel : null, p99 = geo.centroid ? geo.centroid.p99Rel : c.recGeo ? c.recGeo.centroidP99Rel : null;
    if (mx != null) rows.push({ gate: 'Geometry deviation <span class="src ' + (isLive ? 'live' : 'rcpt') + '">' + (isLive ? 'live' : 'receipt') + '</span>', measured: `triangle-centroid max <b>${sci(mx)}</b> of the scene diagonal (p99 ${sci(p99)})${geo.centroid ? `; ${fmt(geo.centroid.matched)} matched, ${fmt(geo.centroid.unmatched)} unmatched` : ''}${geo.diagonal ? `; diagonal ${geo.diagonal.toFixed(2)}` : ''}`,
      bound: `${sci(b.relMax)} (${b.bits == null ? 'exact: 1e-7, about one float32 step' : `2^-${b.bits - 1}, ${contract.geometry}`})`, verdict: verdict(f), note: '' });
  }
  // bounds + area
  {
    const f = failed(failures, 'area');
    const ar = geo.areaRelDelta != null ? geo.areaRelDelta : c.recGeo ? c.recGeo.areaRelDelta : null;
    if (ar != null) rows.push({ gate: 'Surface area and bounds <span class="src ' + (isLive ? 'live' : 'rcpt') + '">' + (isLive ? 'live' : 'receipt') + '</span>', measured: `area ${ar >= 0 ? '+' : '−'}${(Math.abs(ar) * 100).toExponential(2)}%${geo.boundsMaxCornerDeltaRel != null ? `; box corner moved ${sci(geo.boundsMaxCornerDeltaRel)} of the diagonal` : ''}`,
      bound: `area ≤ ${(Math.max(b.relMax * 20, 1e-9) * 100).toExponential(1)}%${geo.boundsMaxCornerDeltaRel != null ? `; corners ≤ ${sci(b.relMax * 2)}` : ''}`, verdict: verdict(f), note: '' });
  }
  // normals
  {
    const f = failed(failures, 'normals'), nd = geo.normalDegrees, p99 = nd ? nd.p99 : c.recGeo ? c.recGeo.normalP99Deg : null, nb = b.bits ? 1.0 : 1e-3;
    if (p99 != null) rows.push({ gate: 'Normals <span class="src ' + (isLive ? 'live' : 'rcpt') + '">' + (isLive ? 'live' : 'receipt') + '</span>', measured: `p99 angle <b>${p99 < 0.01 ? p99.toExponential(2) : p99.toFixed(3)}°</b>${nd ? `; compared on ${fmt(nd.compared)} triangles${nd.dropped ? `, <b class="fail">${fmt(nd.dropped)} lost their normals</b>` : ''}` : ''}`,
      bound: `p99 ≤ ${nb}° (${b.bits ? 'quantised normals' : 'exact profile'})`, verdict: verdict(f), note: nd && nd.dropped ? `The output has no NORMAL on ${fmt(nd.dropped)} triangles (prune removes it from unlit materials), so the angle is measured on the ${fmt(nd.compared)} that remain. The source triangles' normals are not compared for the rest.` : '' });
  }
  // materials
  if (c.materials) {
    const m = c.materials, f = failed(failures, 'materials');
    rows.push({ gate: 'Materials <span class="src live">live</span>', measured: `${fmt(m.source)} → ${fmt(m.output)}; ${fmt(m.identical)} identical, ${fmt(m.differing.length)} differ`, bound: 'same count, every look-defining number identical', verdict: verdict(f), note: m.differing.length ? esc(m.differing.slice(0, 4).join(', ')) : '' });
  }
  // animation
  if (c.animation) {
    const a = c.animation, f = failed(failures, 'animation'), none = a.channelsSource === 0 && a.channelsOutput === 0;
    rows.push({ gate: 'Animation <span class="src live">live</span>', measured: none ? '0 channels in the source and the output' : `${fmt(a.channelsSource)} → ${fmt(a.channelsOutput)} channels; ${fmt(a.unmatched)} unmatched, ${fmt(a.resampled)} resampled; max value change ${sci(a.maxValueDelta)}`, bound: 'every source channel found on the same node, same times and values',
      verdict: none ? V('na', 'NOT EXERCISED') : verdict(f), note: none ? 'This scene has no animation, so the gate has nothing to compare. Passing here says nothing about animation.' : '' });
  }
  // validator
  {
    const v = c.validator;
    if (v) {
      const d = v.delivered, k = v.canonical;
      const par = c.parity;
      const applies = par === true ? 'The receipt row is for exactly these bytes (SHA-256 matches).' : par === false ? '<b class="fail">The SHA-256 differs, so the receipt row describes different bytes from yours.</b>' : c.kind === 'pre' ? 'The receipt row is for this precomputed file.' : 'Byte parity not checked yet.';
      const bad = d[0] > 0 || (k && k[0] > 0);
      rows.push({ gate: 'Khronos glTF-Validator <span class="src rcpt">receipt</span>', measured: `delivered file: ${d[0]} errors, ${d[1]} warnings${k ? `; decoded canonical file: ${k[0]} errors, ${k[1]} warnings` : '; no compression extension, so the delivered file is its own canonical form'}${v.notValidated && v.notValidated.length ? `<br>not understood by the validator: ${esc(v.notValidated.join(', '))}` : ''}`,
        bound: '0 errors', verdict: bad ? V('fail', 'FAIL') : V('pass', 'PASS'),
        note: `Khronos glTF-Validator ${esc(c.validatorVersion || '2.0.0-dev.3.10')} in Node, not run in this page; compression extensions are not understood by it, so the lane also validates the decoded canonical file. ${applies}` });
    } else rows.push({ gate: 'Khronos glTF-Validator <span class="src rcpt">receipt</span>', measured: 'no receipt row for this cell', bound: '0 errors', verdict: V('na', 'N/A'), note: '' });
  }
  return rows;
}

export function renderGates(tbody, readEl, c) {
  const rows = gateRows(c);
  tbody.innerHTML = rows.map((r) => `<tr><td>${r.gate}</td><td>${r.measured}${r.note ? `<div class="note" style="margin-top:4px">${r.note}</div>` : ''}</td><td class="note" style="color:var(--mute)">${r.bound}</td><td><span class="badge ${r.verdict.kind}">${r.verdict.text}</span></td></tr>`).join('');
  const ok = c.ok, fl = c.failures || [];
  const lead = ok ? `<b class="pass">The lane's overall verdict: PASS.</b>` : `<b class="fail">The lane's overall verdict: FAIL</b> (${fl.length} failure${fl.length === 1 ? '' : 's'}: ${fl.map(esc).join('; ')}).`;
  const kindText = c.contract.identity === 'lossy'
    ? ` This profile's contract is <b>lossy</b>: it is allowed to lose identity, but the loss is counted and shown, never hidden. ${fmt(c.identity.lost)} of ${fmt(c.identity.sourceTokens)} identity tokens are gone in this result.${c.profile === 'stock-instance' || c.profile === 'static-joined' ? ' This is a trap profile: it is here to show what the same draw-call saving costs when nothing guards the names.' : ''}`
    : ` This profile's contract is <b>${esc(c.contract.identity)}</b>: ${c.contract.identity === 'exact' ? 'any lost or added identity token fails the run' : 'tokens may move into batch nodes, but any lost token fails the run'}.`;
  readEl.innerHTML = lead + kindText + (c.kind === 'pre' ? ' Numbers marked receipt were measured by the Node CLI on this precomputed file; the page re-counted the identity itself.' : '');
  return rows;
}
