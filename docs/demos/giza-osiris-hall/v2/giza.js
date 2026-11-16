'use strict';
const $ = id => document.getElementById(id), qsa = s => [...document.querySelectorAll(s)];
const LAT = 29.9753, R_SKY = 4500;
const S = { lightId: 'sunrise', found: new Set(), epoch: -10500, lst: 18, lens: 'technical', filter: 'all', skyOn: true, tourOn: false };
let B, scene; const N = {};
const ZONE_LABEL = { Z_sphinx: 'Great Sphinx', Z_osiris: 'Osiris Shaft', Z_anomaly: 'Seismic anomaly', Z_hall: "Cayce's Hall", Z_khufu: 'Great Pyramid', Z_khafre: 'The "648 m" claim', Z_menkaure: 'Menkaure pyramid' };
const ZONE_SPEED = { Z_osiris: 6, Z_hall: 10, Z_anomaly: 12, Z_sphinx: 25, Z_khufu: 40, Z_khafre: 90, Z_menkaure: 40 };
const TOUCH = { T_osiris: ['technical', 'V_Osiris'], T_khufu: ['technical', 'V_Khufu'], T_anomaly: ['contested', 'V_Anomaly'], T_hall: ['contested', 'V_Hall'], T_khafre: ['contested', 'V_Khafre'], T_orion: ['contested', 'V_Orion'] };
const SKY = { sunrise: { top: [.03, .04, .10], mid: [.30, .20, .28], hor: [.95, .55, .30] }, midday: { top: [.10, .24, .55], mid: [.40, .60, .85], hor: [.80, .88, .95] }, afternoon: { top: [.08, .14, .36], mid: [.55, .38, .38], hor: [1, .65, .35] }, night: { top: [0, 0, .01], mid: [.02, .03, .07], hor: [.05, .07, .14] } };
const VIEW_FX = { V_Sunrise: { light: 'sunrise', gaze: true }, V_Orion: { light: 'night', orion: true, sky: true }, V_Khufu: { xp: .8 }, V_Osiris: { xg: .6, spe: false }, V_Depth: { xg: .6, spe: false }, V_ChamberB: { xg: .75, spe: false }, V_Hall: { spe: true }, V_HallInside: { xg: .75, spe: true }, V_Khafre: { xg: .75, spe: true }, V_Anomaly: { xg: .6, spe: true } };
const CUES = [[0, { light: 'sunrise', gaze: false, orion: false, xp: 0, spe: true }], [7, { gaze: true }], [14, { gaze: false, xg: .6, spe: false }], [38, { spe: true }], [52, { xg: .75 }], [60, { xp: .8 }], [68, { xp: 0, xg: .45, light: 'sunrise' }]];
const fmtYear = e => e > 0 ? e + ' CE' : e === 0 ? '1 BC' : (-e) + ' BC';   // round BC years; astronomical year -10500 is 10501 BC, a difference far below the model's accuracy
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fail(m) { const e = $('err'); e.style.display = 'block'; e.textContent = m; }
function toast(html, ms = 3600) { const t = $('toast'); t.innerHTML = html; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms); }
async function jget(u, bin) { const r = await fetch(u); if (!r.ok) throw Error(u + ' ' + r.status); return bin ? r.arrayBuffer() : r.json(); }
/* ---------- sky maths (mirrors build_scene2.py) ---------- */
function matFor(e) { const i = S.stars.epochs.reduce((b, v, k) => Math.abs(v - e) < Math.abs(S.stars.epochs[b] - e) ? k : b, 0); return S.stars.mats[i]; }
function dated(v, m) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function horiz(d, lst) { const ra = Math.atan2(d[1], d[0]), dec = Math.asin(Math.max(-1, Math.min(1, d[2]))), ha = lst * Math.PI / 12 - ra, la = LAT * Math.PI / 180;
  const alt = Math.asin(Math.sin(dec) * Math.sin(la) + Math.cos(dec) * Math.cos(la) * Math.cos(ha));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha));
  return { alt, az, ra, dec }; }
function toXYZ(h, r) { const n = Math.cos(h.alt) * Math.cos(h.az), e = Math.cos(h.alt) * Math.sin(h.az), u = Math.sin(h.alt); return [e * r, u * r, -n * r]; }
function updateSky() {
  if (!S.stars || !N.STAR_PTS) return; const m = matFor(S.epoch), st = S.stars;
  N.STAR_PTS.point = Float32Array.from(st.field.flatMap(s => toXYZ(horiz(dated(s, m), S.lst), R_SKY)));
  st.named.forEach((s, i) => { const h = horiz(dated(s.v, m), S.lst); N['NS_' + i].translation = new X3D.SFVec3f(...toXYZ(h, R_SKY)); });
  const pts = []; for (const k of Object.keys(S.const.const)) for (const [a, b] of S.const.const[k]) pts.push(a, b);
  N.CONST_PTS.point = Float32Array.from(pts.flatMap(i => toXYZ(horiz(dated(st.named[i].v, m), S.lst), R_SKY)));
  $('epo').textContent = fmtYear(Math.round(S.epoch)); $('lsto').textContent = S.lst.toFixed(2) + ' h';
  const nm = n => st.named.find(s => s.n === n), dd = n => dated(nm(n).v, m);
  const alnil = dd('Alnilam'), decA = Math.asin(alnil[2]) * 180 / Math.PI, cul = 90 - LAT + decA;
  let pole = st.named.map(s => ({ n: s.n, dec: Math.asin(dated(s.v, m)[2]) * 180 / Math.PI })).sort((a, b) => b.dec - a.dec)[0];
  const reg = horiz(dd('Regulus'), S.lst), az = ((reg.az * 180 / Math.PI) + 360) % 360;
  $('skyinfo').innerHTML = `<b>${fmtYear(Math.round(S.epoch))}</b>: Orion's belt (Alnilam) crosses the meridian at altitude <b>${cul.toFixed(1)}°</b> from Giza. The brightest listed star nearest the pole is <b>${esc(pole.n)}</b> (${pole.dec.toFixed(1)}° from the equator, so ${(90 - pole.dec).toFixed(1)}° from the pole). Regulus is now at altitude ${(reg.alt * 180 / Math.PI).toFixed(0)}°, azimuth ${az.toFixed(0)}°.<br>Precession only; proper motion ignored (Orion's belt moves under 0.1° in 12,000 years; Arcturus about 8°).`;
}
function lstPreset(k) {
  const m = matFor(S.epoch), st = S.stars, nm = n => st.named.find(s => s.n === n);
  if (k === 'dawn') return 18;
  if (k === 'orion') return ((horiz(dated(nm('Alnilam').v, m), 0).ra * 12 / Math.PI) + 24) % 24;
  const d = dated(nm('Regulus').v, m), dec = Math.asin(d[2]), ra = Math.atan2(d[1], d[0]), la = LAT * Math.PI / 180;
  const ha = -Math.acos(Math.max(-1, Math.min(1, -Math.tan(la) * Math.tan(dec)))); return (((ra + ha) * 12 / Math.PI) % 24 + 24) % 24;
}
/* ---------- light state, ground/pyramid x-ray, layers ---------- */
function applyLight(id) {
  const j = S.states.states.findIndex(s => s.id === id); if (j < 0) return; S.lightId = id;
  let off = j * S.states.meshes.reduce((a, m) => a + m.n * 3, 0);
  for (const m of S.states.meshes) { const arr = new Float32Array(m.n * 3);
    for (let k = 0; k < m.n * 3; k++) arr[k] = S.bin[off + k] / 255;
    off += m.n * 3; N['K_' + m.name].color = arr; }
  const st = S.states.states[j], sk = SKY[id], c3 = a => [].concat(...a);
  N.BG.skyColor = Float32Array.from([...sk.top, ...sk.mid, ...sk.hor]);
  N.BG.groundColor = Float32Array.from([.02, .02, .025, .05, .042, .038]);
  N.FOG.color = new X3D.SFColor(sk.hor[0] * .8, sk.hor[1] * .8, sk.hor[2] * .8);
  const az = st.az * Math.PI / 180, el = st.el * Math.PI / 180, R = R_SKY * .93;
  N.SUN.translation = new X3D.SFVec3f(R * Math.sin(az) * Math.cos(el), R * Math.sin(el), -R * Math.cos(az) * Math.cos(el));
  N.SUN.scale = id === 'night' ? new X3D.SFVec3f(.01, .01, .01) : new X3D.SFVec3f(1, 1, 1);
  skyVis(); qsa('#light button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
}
function skyVis() { const on = S.skyOn && !S.under && (S.lightId === 'night' || S.lightId === 'sunrise'); N.SW_SKY.whichChoice = on ? 0 : -1; N.SW_CONST.whichChoice = $('cK').checked ? 0 : -1; }
function setX(g, p) { if (g != null) { $('xg').value = g; xray(); } if (p != null) { $('xp').value = p; xray(); } }
function xray() { N.M_ground.transparency = +$('xg').value; $('xgo').textContent = (+$('xg').value).toFixed(2); const p = +$('xp').value; $('xpo').textContent = p.toFixed(2); ['khufu', 'khafre', 'menkaure'].forEach(n => N['M_' + n].transparency = p); }
function layers() { N.SW_DOC.whichChoice = $('cD').checked ? 0 : -1; N.SW_THE.whichChoice = $('cT').checked ? 0 : -1; N.SW_SPE.whichChoice = $('cS').checked ? 0 : -1;
  N.SW_ORION.whichChoice = $('cO').checked ? 0 : -1; N.SW_GAZE.whichChoice = $('cG').checked ? 0 : -1; }
function fx(o) { if (!o) return; if (o.light) applyLight(o.light); if ('gaze' in o) { $('cG').checked = o.gaze; } if ('orion' in o) { $('cO').checked = o.orion; } if ('spe' in o) { $('cS').checked = o.spe; } if (o.sky) { $('cK').checked = true; S.skyOn = true; }
  setX(o.xg, o.xp); layers(); skyVis(); }
const BASE_FX = { xg: 0.45, xp: 0, gaze: false, orion: false };
function go(v) { if (!scene) return; const n = scene.getNamedNode(v); fx({ ...BASE_FX, ...VIEW_FX[v] }); n.set_bind = true; }
/* ---------- modal lenses ---------- */
const LENS = { technical: ['⚙ Technical', 'How it was measured, how sure we are'], wonder: ['✦ Wonder', 'Scale and meaning'], contested: ['⚠ Contested', 'Claim, then what the evidence says'], ledger: ['☰ Claim ledger', 'Every drawn thing, its tier and source'] };
function srcHtml(a) { return (a || []).map(s => `<span>${s.opened ? '<span class="o" title="opened and read">✓</span>' : '<span class="n" title="not opened: search summary or recalled">○</span>'} <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></span>`).join(' · '); }
function numsHtml(a) { return a && a.length ? `<table><tbody>${a.map(n => `<tr><th>${esc(n.label)}</th><td>${esc(n.value)}</td><td class="src">${esc(n.source)}</td></tr>`).join('')}</tbody></table>` : ''; }
function card(it) {
  const acts = `<div class="acts">${it.view ? `<button data-go="${it.view}">Fly there</button>` : ''}</div>`;
  const head = `<h3>${esc(it.title)} <span class="pill p-${it.grade}" title="Confirmed = source opened and read; Likely = consistent across sources; Suspected = summary or recalled">${esc(it.grade)}</span></h3>`;
  const body = it.lens === 'contested' ? `<div class="two"><div class="claim"><h4>The claim, as its proponents tell it</h4>${esc(it.body)}</div><div class="evid"><h4>What the evidence says</h4>${esc(it.rebuttal)}</div></div>` : `<p>${esc(it.body)}</p>`;
  return `<div class="card" id="c_${esc(it.id)}" data-view="${it.view || ''}">${head}${body}${numsHtml(it.numbers)}<div class="src">${srcHtml(it.sources)}</div>${acts}</div>`;
}
function ledgerHtml() {
  const L = S.content.ledger || []; return `<table><thead><tr><th>Tier</th><th>What is drawn</th><th>Basis and source</th><th>Grade</th></tr></thead><tbody>${L.map(r => `<tr><td><span class="pill" style="background:var(--${r.tier})">${{ D: 'DOC', T: 'THEORY', S: 'SPEC' }[r.tier]}</span></td><td>${esc(r.what)}</td><td class="src">${r.basis}</td><td>${esc(r.grade)}</td></tr>`).join('')}</tbody></table>` + (S.content.invented ? `<div class="disc"><b>Invented, not sourced:</b> ${esc(S.content.invented)}</div>` : '');
}
function openModal(lens, view, id) {
  S.lens = lens || S.lens; if (view !== undefined) S.filter = view || 'all'; const m = $('modal'); m.classList.add('on'); m.dataset.prev = document.activeElement?.id || '';
  const [t, sub] = LENS[S.lens]; $('mtitle').innerHTML = `${esc(t)} <small style="color:var(--mut);font-weight:400;font-size:12px">${esc(sub)}</small>`;
  const items = S.lens === 'ledger' ? [] : S.content.items.filter(i => i.lens === S.lens), views = [...new Set(items.map(i => i.view))];
  const vl = Object.fromEntries(S.tour.views.map(v => [v.id, v.label]));
  $('chips').innerHTML = S.lens === 'ledger' ? '' : [`<button class="chip ${S.filter === 'all' ? 'on' : ''}" data-f="all">All ${items.length}</button>`, ...views.map(v => `<button class="chip ${S.filter === v ? 'on' : ''}" data-f="${v}">${esc((vl[v] || v).split(':')[0])}</button>`)].join('');
  const DISC = S.lens === 'contested' ? '<div class="disc" style="margin:0 0 10px">Contested ideas are told in their own voice so you can judge them, then set against the evidence. Being on this page is not endorsement. Where a claim is about a person, only what the cited record shows is stated.</div>' : '';
  $('mbody').innerHTML = DISC + (S.lens === 'ledger' ? ledgerHtml() + (S.content.extra || '') : (items.filter(i => S.filter === 'all' || i.view === S.filter).map(card).join('') || '<p class="src">Nothing in this lens for this place yet.</p>'));
  if (id) { const c = $('c_' + id); if (c) { c.classList.add('focus'); c.scrollIntoView({ block: 'center' }); } }
  $('mclose').focus();
}
function closeModal() { $('modal').classList.remove('on'); const p = $($('modal').dataset.prev); if (p) p.focus(); }
/* ---------- tour ---------- */
function runCues(t) { for (const [ct, o] of CUES) if (ct <= t && !runCues.done.has(ct)) { runCues.done.add(ct); fx(o); } }
runCues.done = new Set();
function startTour() { const c = N.TourClock; runCues.done = new Set(); S.tourOn = true; N.V_Tour.set_bind = true; c.stopTime = 0; c.startTime = Date.now() / 1000; $('cap').classList.add('on'); $('tour').textContent = '■ Stop tour'; }
function stopTour() { S.tourOn = false; N.TourClock.stopTime = Date.now() / 1000; $('cap').classList.remove('on'); $('tour').textContent = '▶ Guided descent'; }
/* ---------- boot ---------- */
(async () => {
  try {
    const [states, bin, stars, tour, cst, content] = await Promise.all([jget('states.json'), jget('states.bin', 1), jget('stars_v2.json'), jget('tour.json'), jget('const.json'), jget('content.json')]);
    Object.assign(S, { states, bin: new Uint8Array(bin), stars, tour, const: cst, content });
  } catch (e) { fail('Could not load page data: ' + e.message + '. Serve this folder over http (GitHub Pages does).'); throw e; }
  B = $('cv').browser;
  scene = await new Promise((res, rej) => { let n = 0; const i = setInterval(() => { try { const s = B.currentScene; if (s && s.getNamedNode('SW_DOC') && s.getNamedNode('TourClock')) { clearInterval(i); res(s); } } catch (e) { } if (++n > 600) { clearInterval(i); rej(Error('scene did not load')); } }, 100); }).catch(e => { fail(e.message); throw e; });
  const names = ['SW_DOC', 'SW_THE', 'SW_SPE', 'SW_ORION', 'SW_GAZE', 'SW_SKY', 'SW_CONST', 'STAR_PTS', 'CONST_PTS', 'SUN', 'BG', 'FOG', 'NAV', 'CamSensor', 'TourClock', 'V_Tour', 'M_ground', 'M_khufu', 'M_khafre', 'M_menkaure', ...S.states.meshes.map(m => 'K_' + m.name), ...S.stars.named.map((_, i) => 'NS_' + i)];
  for (const n of names) N[n] = scene.getNamedNode(n);
  $('light').innerHTML = S.states.states.map(s => `<button data-id="${s.id}">${esc(s.label)}</button>`).join('');
  $('views').innerHTML = S.tour.views.map(v => `<button data-v="${v.id}">${esc(v.label.length > 30 ? v.label.slice(0, 29) + '…' : v.label)}</button>`).join('');
  $('light').onclick = e => { const b = e.target.closest('button'); if (b) applyLight(b.dataset.id); };
  $('views').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
  ['cD', 'cT', 'cS', 'cO', 'cG'].forEach(i => $(i).onchange = layers); $('cK').onchange = () => { S.skyOn = $('cK').checked; skyVis(); };
  $('xg').oninput = $('xp').oninput = xray;
  $('ep').oninput = e => { S.epoch = +e.target.value; updateSky(); };
  $('lst').oninput = e => { S.lst = +e.target.value; updateSky(); };
  qsa('[data-ep]').forEach(b => b.onclick = () => { S.epoch = +b.dataset.ep; $('ep').value = S.epoch; updateSky(); });
  qsa('[data-lst]').forEach(b => b.onclick = () => { S.lst = lstPreset(b.dataset.lst); $('lst').value = S.lst; updateSky(); });
  qsa('#nav button').forEach(b => { b.onclick = () => { N.NAV.type = new X3D.MFString(b.dataset.nav, 'ANY'); qsa('#nav button').forEach(x => x.classList.toggle('on', x === b)); }; });
  qsa('.lens button').forEach(b => b.onclick = () => openModal(b.dataset.lens, 'all'));
  $('mclose').onclick = closeModal; $('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  $('chips').onclick = e => { const b = e.target.closest('[data-f]'); if (b) openModal(S.lens, b.dataset.f); };
  $('mbody').onclick = e => { const b = e.target.closest('[data-go]'); if (b) { closeModal(); go(b.dataset.go); } };
  $('lab').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('lab').dataset.mode = b.dataset.m; qsa('#lab button').forEach(x => x.classList.toggle('on', x === b)); };
  $('tour').onclick = () => S.tourOn ? stopTour() : startTour();
  $('dockbtn').onclick = () => { const h = $('dock').classList.toggle('hide'); $('dockbtn').setAttribute('aria-expanded', String(!h)); };
  addEventListener('keydown', e => { if (e.target.matches('input,select,textarea')) return; const k = e.key;
    if (k === 'Escape') closeModal(); else if (k === 't' || k === 'T') $('tour').click(); else if (k === 'c' || k === 'C') $('dockbtn').click();
    else if ('1234'.includes(k) && k) openModal(['technical', 'wonder', 'contested', 'ledger'][+k - 1], 'all'); });
  // touch sensors -> modal; zone sensors -> discovery
  for (const [t, [lens, view]] of Object.entries(TOUCH)) { const sn = scene.getNamedNode(t); sn.addFieldCallback('open_' + t, 'touchTime', () => openModal(lens, view)); sn.addFieldCallback('over_' + t, 'isOver', v => { $('cv').style.cursor = v ? 'pointer' : ''; }); }
  for (const z of Object.keys(ZONE_LABEL)) { const zn = scene.getNamedNode(z); zn.addFieldCallback('zone_' + z, 'isActive', v => {
    if (!v) { S.zone === z && (S.zone = null); return; } S.zone = z; if (ZONE_SPEED[z]) N.NAV.speed = ZONE_SPEED[z];
    const first = !S.found.has(z); S.found.add(z); $('dn').textContent = S.found.size;
    toast(`<b>${first ? 'Found: ' : ''}${esc(ZONE_LABEL[z])}</b><br><small style="color:var(--mut)">${first ? 'Click the glowing structure, or press 1 to 3 for the lenses' : 'You are here'}</small>`); }); }
  const tc = N.TourClock; tc.addFieldCallback('tourf', 'fraction_changed', f => { if (!S.tourOn) return; const t = f * S.tour.duration; runCues(t);
    let cur = S.tour.stops[0]; for (const s of S.tour.stops) if (s.t <= t) cur = s; $('cap').textContent = cur.caption; });
  tc.addFieldCallback('toure', 'isActive', a => { if (!a && S.tourOn) stopTour(); });
  S.cl = await jget('clusters.json'); for (const k of Object.keys(S.cl.clusters)) N['LB_' + k] = scene.getNamedNode('LB_' + k);
  let last = 0, pos = null; N.CamSensor.addFieldCallback('cam', 'position_changed', p => { pos = p; });
  let lastCull = 0; const cull = (x, y, z) => { const aerial = y > 80, AER = ['khafre', 'khufu', 'menk', 'sphinx', 'causeway', 'osiris', 'hall', 'orion'];
    for (const [k, c] of Object.entries(S.cl.clusters)) { const d = Math.hypot(x - c.c[0], y - c.c[1], z - c.c[2]); const on = $('lab').dataset.mode === 'off' ? false : $('lab').dataset.mode === 'all' || (aerial && AER.includes(k)) || d < c.r; const w = on ? 0 : -1; if (N['LB_' + k].whichChoice !== w) N['LB_' + k].whichChoice = w; }
    const under = y < -1.5; if (under !== S.under) { S.under = under; skyVis(); } };
  const ro = () => { requestAnimationFrame(ro); if (!pos) return; const now = performance.now(); if (now - lastCull > 200) { lastCull = now; cull(pos.x, pos.y, pos.z); } const [x, y, z] = [pos.x, pos.y, pos.z], oc = S.cl.clusters.osiris.c, dO = Math.hypot(x - oc[0], y - oc[1], z - oc[2]);
    $('read').innerHTML = `${y < 0 ? 'depth <b>' + (-y).toFixed(1) + ' m</b>' : 'height <b>' + y.toFixed(1) + ' m</b>'} · E <b>${x.toFixed(0)}</b> N <b>${(-z).toFixed(0)}</b> from the Sphinx · Osiris mouth <b>${dO.toFixed(0)} m</b>${S.zone ? ' · in <b>' + esc(ZONE_LABEL[S.zone]) + '</b>' : ''}`; };
  ro();
  if (innerWidth < 760) { $('dock').classList.add('hide'); $('dockbtn').setAttribute('aria-expanded', 'false'); }   // phones start with the scene, not the panel
  applyLight('sunrise'); xray(); layers(); updateSky(); $('nav').children[0].classList.add('on');
  const h = location.hash.slice(1); if (h.startsWith('view=')) go(h.slice(5)); else if (h.startsWith('lens=')) openModal(h.slice(5), 'all');
})().catch(e => console.error(e));
