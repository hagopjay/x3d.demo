import {sampleTour,TOUR_STOPS,colorBlend} from './review-core.mjs';
'use strict';
const $ = id => document.getElementById(id), qsa = s => [...document.querySelectorAll(s)];
const LAT = 29.9753, R_SKY = 4500;
const S = { lightId: 'sunrise', found: new Set(), epoch: -10499, lst: 18, lens: 'technical', filter: 'all', skyOn: true, tourOn: false, ready: false, view: 'V_Overview', exposure: 1, quality: 'balanced', skyPlay: false, survey: false, scale: false, section: false, sectionZ: -28, bookmarks: [], sourceHashes: {} };
let B, scene, skyModel; const N = {}; const lightCache = new Map();
const ZONE_LABEL = { Z_sphinx: 'Great Sphinx', Z_osiris: 'Osiris Shaft', Z_anomaly: 'Seismic anomaly', Z_hall: "Cayce's Hall", Z_khufu: 'Great Pyramid', Z_khafre: 'The "648 m" claim', Z_menkaure: 'Menkaure pyramid' };
const ZONE_SPEED = { Z_osiris: 6, Z_hall: 10, Z_anomaly: 12, Z_sphinx: 25, Z_khufu: 40, Z_khafre: 90, Z_menkaure: 40 };
const TOUCH = { T_osiris: ['technical', 'V_Osiris'], T_khufu: ['technical', 'V_Khufu'], T_anomaly: ['contested', 'V_Anomaly'], T_hall: ['contested', 'V_Hall'], T_khafre: ['contested', 'V_Khafre'], T_orion: ['contested', 'V_Orion'] };
const SKY = { sunrise: { top: [.03, .04, .10], mid: [.30, .20, .28], hor: [.95, .55, .30] }, midday: { top: [.10, .24, .55], mid: [.40, .60, .85], hor: [.80, .88, .95] }, afternoon: { top: [.08, .14, .36], mid: [.55, .38, .38], hor: [1, .65, .35] }, night: { top: [0, 0, .01], mid: [.02, .03, .07], hor: [.05, .07, .14] } };
const VIEW_FX = { V_Sunrise: { light: 'sunrise', gaze: true }, V_Orion: { light: 'night', orion: true, sky: true }, V_Khufu: { xp: .8 }, V_Osiris: { xg: .6, spe: false }, V_Depth: { xg: .6, spe: false }, V_ChamberB: { xg: .75, spe: false }, V_Hall: { spe: true }, V_HallInside: { xg: .75, spe: true }, V_Khafre: { xg: .75, spe: true }, V_Anomaly: { xg: .6, spe: false } };
const CUES = [[0,{light:'sunrise',xg:.45,xp:0,doc:true,the:true,spe:false,survey:false,scale:false,section:false,gaze:false,orion:false}],[7,{gaze:true}],[14,{gaze:false,xg:.6,spe:false}],[38,{spe:true}],[52,{xg:.75}],[60,{xp:.8,spe:false}],[68,{xp:0,xg:.45,light:'sunrise',spe:false}]];
const fmtYear = e => GizaSky.formatYear(e);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fail(m) { const e = $('err'); e.style.display = 'block'; e.replaceChildren(); const text=document.createElement('p'); text.textContent=m; const close=document.createElement('button'); close.textContent='Continue reading the source cards'; close.onclick=()=>e.style.display='none'; e.append(text,close); }
function toast(html, ms = 3600) { const t = $('toast'); t.innerHTML = html; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms); }
async function jget(u, bin) { const r = await fetch(u); if (!r.ok) throw Error(u + ' ' + r.status); return bin ? r.arrayBuffer() : r.json(); }
/* ---------- observer sky: explicit epoch/LST contract ---------- */
function matFor(epoch) { const sample=skyModel.matrixAt(epoch,{outOfRange:'clamp'}); S.skySample=sample; return sample.matrix; }
const dated=GizaSky.dated;
const horiz=(direction,lst)=>GizaSky.horizontal(direction,lst,LAT);
const toXYZ=GizaSky.toXYZ;
function updateSky() {
  if(!S.stars||!skyModel)return;
  const m=matFor(S.epoch),st=S.stars;
  if(N.STAR_PTS){
    N.STAR_PTS.point=Float32Array.from(st.field.flatMap(v=>toXYZ(horiz(dated(v,m),S.lst),R_SKY)));
    st.named.forEach((star,i)=>{N['NS_'+i].translation=new X3D.SFVec3f(...toXYZ(horiz(dated(star.v,m),S.lst),R_SKY));});
    const pairs=Object.values(S.const.const).flat();
    N.CONST_PTS.point=Float32Array.from(pairs.flatMap(([a,b])=>[a,b]).flatMap(i=>toXYZ(horiz(dated(st.named[i].v,m),S.lst),R_SKY)));
  }
  $('epo').textContent=fmtYear(Math.round(S.epoch));$('lsto').textContent=S.lst.toFixed(2)+' h';
  const star=st.named.find(v=>v.n===$('probe-star').value)||st.named.find(v=>v.n==='Alnilam');
  const direction=dated(star.v,m),h=horiz(direction,S.lst),deg=180/Math.PI;
  const rise=GizaSky.rising(direction,LAT),pole=st.named.map(v=>({n:v.n,dec:Math.asin(Math.max(-1,Math.min(1,dated(v.v,m)[2])))*deg})).sort((a,b)=>b.dec-a.dec)[0];
  $('skyinfo').innerHTML=`<span class="eyebrow">${esc(star.n)} / GEOMETRIC HORIZON</span><div class="probe-metrics"><span><b>${(h.alt*deg).toFixed(1)}°</b><small>altitude</small></span><span><b>${h.azUndefined?'—':(h.az*deg).toFixed(1)+'°'}</b><small>azimuth from north</small></span></div><p>Upper transit <b>${GizaSky.meridianAltitude(h.dec,LAT).toFixed(1)}°</b> · ${rise.status==='rises-and-sets'?'rising LST '+rise.risingLST.toFixed(2)+' h':esc(rise.status)}.</p><p class="fine">${fmtYear(Math.round(S.epoch))}. Nearest north-pole star in this ${st.named.length}-name sample: ${esc(pole.n)}, ${(90-pole.dec).toFixed(1)}° away. ${S.skySample.interpolated?'Interpolated between':'At'} stored epoch samples.</p>`;
}
function lstPreset(kind) {
  if(kind==='dawn')return 18; // idealized equinox orientation; not a civil dawn calculation
  const m=matFor(S.epoch),name=kind==='orion'?'Alnilam':'Regulus';
  const direction=dated(S.stars.named.find(v=>v.n===name).v,m);
  if(kind==='orion')return ((Math.atan2(direction[1],direction[0])*12/Math.PI)%24+24)%24;
  const rising=GizaSky.rising(direction,LAT);
  if(rising.risingLST===null){toast(esc(name+' '+rising.status+' at this latitude and epoch.'));return S.lst;}
  return rising.risingLST;
}
/* ---------- light state, ground/pyramid x-ray, layers ---------- */
let lightGeneration=0;
function appearanceEvent(){dispatchEvent(new CustomEvent('giza:appearance'));}
function applyLight(id) {
 if(!S.states)return;const j=S.states.states.findIndex(v=>v.id===id);if(j<0)return;
 S.lightId=id;
 if(S.ready){
  if(!lightCache.has(id))lightCache.set(id,GizaCore.decodeState(S.states,S.bin,id));
  const target=lightCache.get(id),from=S.displayColors||target,token=++lightGeneration,start=performance.now();
  const st=S.states.states[j],sk=SKY[id],az=st.az*Math.PI/180,el=st.el*Math.PI/180,R=R_SKY*.93;
  const targetEnvironment={sky:[...sk.top,...sk.mid,...sk.hor],ground:[.02,.02,.025,.05,.042,.038],fog:sk.hor.map(x=>x*.8),sun:[R*Math.sin(az)*Math.cos(el),R*Math.sin(el),-R*Math.cos(az)*Math.cos(el)],scale:id==='night'?[.01,.01,.01]:[1,1,1]};
  const fromEnvironment=S.displayEnvironment||targetEnvironment;
  const duration=matchMedia('(prefers-reduced-motion:reduce)').matches?0:500;
  const blend=now=>{
   if(token!==lightGeneration)return;
   const t=duration?Math.min(1,(now-start)/duration):1;
   S.displayColors=t===1?target:Object.fromEntries(Object.entries(target).map(([name,colors])=>[name,colorBlend(from[name],colors,t)]));
   S.displayEnvironment=t===1?targetEnvironment:Object.fromEntries(Object.entries(targetEnvironment).map(([name,values])=>[name,colorBlend(fromEnvironment[name],values,t)]));
   for(const [name,colors] of Object.entries(S.displayColors))N['K_'+name].color=colors;
   const e=S.displayEnvironment;N.BG.skyColor=Float32Array.from(e.sky);N.BG.groundColor=Float32Array.from(e.ground);N.FOG.color=new X3D.SFColor(...e.fog);N.SUN.translation=new X3D.SFVec3f(...e.sun);N.SUN.scale=new X3D.SFVec3f(...e.scale);
   appearanceEvent();if(t<1)requestAnimationFrame(blend);
  };blend(start);skyVis();
 }
 qsa('#light button').forEach(b=>{b.classList.toggle('on',b.dataset.id===id);b.setAttribute('aria-pressed',String(b.dataset.id===id));});
}

function skyVis() { if(!S.ready)return; const on = S.skyOn && !S.under && (S.lightId === 'night' || S.lightId === 'sunrise'); N.SW_SKY.whichChoice = on ? 0 : -1; N.SW_CONST.whichChoice = $('cK').checked ? 0 : -1; }
function setX(g, p) { if (g != null) { $('xg').value = g; xray(); } if (p != null) { $('xp').value = p; xray(); } }
function xray() { if(!S.ready)return; N.M_ground.transparency = +$('xg').value; $('xgo').textContent = (+$('xg').value).toFixed(2); const p = +$('xp').value; $('xpo').textContent = p.toFixed(2); ['khufu', 'khafre', 'menkaure'].forEach(n => N['M_' + n].transparency = p); }
function layers() { if(!S.ready)return; N.SW_DOC.whichChoice = $('cD').checked ? 0 : -1; N.SW_THE.whichChoice = $('cT').checked ? 0 : -1; N.SW_SPE.whichChoice = $('cS').checked ? 0 : -1;
  N.SW_ORION.whichChoice = $('cO').checked ? 0 : -1; N.SW_GAZE.whichChoice = $('cG').checked ? 0 : -1; updateContext(); }
function fx(o) { if (!o) return; if (o.light) applyLight(o.light); if ('gaze' in o) { $('cG').checked = o.gaze; } if ('orion' in o) { $('cO').checked = o.orion; } if ('spe' in o) { $('cS').checked = o.spe; } if('doc' in o)$('cD').checked=o.doc;if('the' in o)$('cT').checked=o.the;if('sectionZ' in o)$('section-z').value=o.sectionZ; if (o.sky) { $('cK').checked = true; S.skyOn = true; }
  if('survey' in o){$('survey').checked=o.survey;} if('scale' in o){$('scale').checked=o.scale;} if('section' in o){$('section').checked=o.section;}
  setX(o.xg, o.xp); layers(); skyVis(); applySurvey(); }
Object.assign(VIEW_FX,{V_Survey:{survey:true},V_DepthCompare:{scale:true,xg:.65},V_HallDetail:{spe:true,xg:.75},V_Section:{section:true,sectionZ:-28,xg:0,spe:false}});
const BASE_FX = { doc:true,the:true,spe:false,xg: .45, xp: 0, gaze: false, orion: false, survey:false,scale:false,section:false };
function go(v) { if(!S.ready)return; S.cameraRestoreGeneration=(S.cameraRestoreGeneration||0)+1; if(!S.tour.views.some(view=>view.id===v))throw new Error('Unknown viewpoint'); if(S.tourOn)stopTour();$('cap').classList.remove('on'); S.view=v; const n=scene.getNamedNode(v);n.getValue().resetUserOffsets();fx({...BASE_FX,...VIEW_FX[v]});n.set_bind=true;updateContext(); }
/* ---------- modal lenses ---------- */
const LENS = { technical: ['⚙ Technical', 'How it was measured, how sure we are'], wonder: ['✦ Wonder', 'Scale and meaning'], contested: ['⚠ Contested', 'Claim, then what the evidence says'], ledger: ['☰ Claim ledger', 'Every drawn thing, its tier and source'] };
function srcHtml(a) { return (a || []).map(s => `<span>${s.opened ? '<span class="o" title="opened and read">✓</span>' : '<span class="n" title="not opened: search summary or recalled">○</span>'} <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></span>`).join(' · '); }
function numsHtml(a) { return a && a.length ? `<table><tbody>${a.map(n => `<tr><th>${esc(n.label)}</th><td>${esc(n.value)}</td><td class="src">${esc(n.source)}</td></tr>`).join('')}</tbody></table>` : ''; }
function card(it) {
  const acts = `<div class="acts">${it.view ? `<button data-go="${it.view}" ${S.ready?'':'disabled title="The 3D scene is not available yet"'}>Fly there</button>` : ''}</div>`;
  const head = `<h3>${esc(it.title)} <span class="pill p-${it.grade}" title="Confirmed = source opened and read; Likely = consistent across sources; Suspected = summary or recalled">Source ${esc(it.grade)}</span></h3>`;
  const body = it.lens === 'contested' ? `<div class="two"><div class="claim"><h4>The claim, as its proponents tell it</h4>${esc(it.body)}</div><div class="evid"><h4>What the evidence says</h4>${esc(it.rebuttal)}</div></div>` : `<p>${esc(it.body)}</p>`;
  const update=it.id==='m-sky'?`The bundled data contain ${S.stars.named.length} named stars, not 41. Epoch samples use astronomical year numbers; −13000 means 13001 BCE. The runtime interpolates rotations between samples. Numerical accuracy against freshly computed intermediate epochs has not been measured. The original card text and its estimates are preserved below.`:it.id==='khafre-648m-sar-claim'?'Edition source update: the publisher’s 10 August 2026 retraction concerns the 2022 Khufu paper. It is distinct from the separate 2025 Khafre claim and is not a field test of that claim. The notice reports methodological and statistical problems; the authors disagree.':'';
  const note=update?`<div class="disc"><b>Current edition note.</b> ${esc(update)}${it.id==='khafre-648m-sar-claim'?' <a href="https://www.mdpi.com/2072-4292/18/16/2679" target="_blank" rel="noopener noreferrer">Publisher notice</a>':''}</div>`:'';
  return `<div class="card" id="c_${esc(it.id)}" data-view="${it.view || ''}">${head}${note}${body}${numsHtml(it.numbers)}<div class="src">${srcHtml(it.sources)}</div>${acts}</div>`;
}
function ledgerHtml() {
  const L = S.content.ledger || []; return `<table><thead><tr><th>Tier</th><th>What is drawn</th><th>Basis and source</th><th>Grade</th></tr></thead><tbody>${L.map(r => `<tr><td><span class="pill" style="background:var(--${r.tier})">${{ D: 'DOC', T: 'THEORY', S: 'SPEC' }[r.tier]}</span></td><td>${esc(r.what)}</td><td class="src">${cleanMarkup(r.basis)}</td><td>${esc(r.grade)}</td></tr>`).join('')}</tbody></table>` + (S.content.invented ? `<div class="disc"><b>Invented, not sourced:</b> ${esc(S.content.invented)}</div>` : '');
}
function openModal(lens, view, id) {
  S.lens = lens || S.lens; if(!LENS[S.lens])S.lens='technical'; $('card-search').value=''; if (view !== undefined) S.filter = view || 'all'; const m = $('modal'); m.classList.add('on'); m.dataset.prev = document.activeElement?.id || '';
  const [t, sub] = LENS[S.lens]; $('mtitle').innerHTML = `${esc(t)} <small style="color:var(--mut);font-weight:400;font-size:12px">${esc(sub)}</small>`;
  const items = S.lens === 'ledger' ? [] : S.content.items.filter(i => i.lens === S.lens), views = [...new Set(items.map(i => i.view))];
  const vl = Object.fromEntries(S.tour.views.map(v => [v.id, v.label]));
  $('chips').innerHTML = S.lens === 'ledger' ? '' : [`<button class="chip ${S.filter === 'all' ? 'on' : ''}" data-f="all">All ${items.length}</button>`, ...views.map(v => `<button class="chip ${S.filter === v ? 'on' : ''}" data-f="${v}">${esc((vl[v] || v).split(':')[0])}</button>`)].join('');
  const DISC = S.lens === 'contested' ? '<div class="disc" style="margin:0 0 10px">Contested ideas are told in their own voice so you can judge them, then set against the evidence. Source grades describe the supplied reading record, not proof that a claim is true. Where a claim is about a person, only what the cited record shows is stated.</div>' : '';
  $('mbody').innerHTML = DISC + (S.lens === 'ledger' ? ledgerHtml() + cleanMarkup(S.content.extra || '') : (items.filter(i => S.filter === 'all' || i.view === S.filter).map(card).join('') || '<p class="src">Nothing in this lens for this place yet.</p>'));
  filterCards();
  if (id) { const c = $('c_' + id); if (c) { c.classList.add('focus'); c.scrollIntoView({ block: 'center' }); } }
  $('mclose').focus();
}
function closeModal() { $('modal').classList.remove('on'); const p = $($('modal').dataset.prev); if (p) p.focus(); }
/* ---------- tour ---------- */
function runCues(t) { for (const [ct,o] of CUES) if(ct<=t&&!runCues.done.has(ct)){runCues.done.add(ct);fx(o);} }
runCues.done=new Set();
function tourPose(t){
 const pose=sampleTour(TOUR_STOPS,t,{motion:$('tour-motion').value});
 N.TourRig.translation=new X3D.SFVec3f(...pose.position);N.TourRig.rotation=new X3D.SFRotation(...pose.orientation);
 N.V_Tour.centerOfRotation=new X3D.SFVec3f(0,0,-Math.hypot(...pose.target.map((x,i)=>x-pose.position[i])));
 let cur=S.tour.stops[0];for(const stop of S.tour.stops)if(stop.t<=t)cur=stop;
 $('cap').textContent=cur.caption;$('tour-time').value=t;$('tour-time-value').textContent=t.toFixed(1)+' / '+S.tour.duration+' s';
 const topic=TOUR_CONTEXT.filter(([time])=>time<=t).at(-1);if(topic)updateContext(topic[1]);
 runCues(t);
}
function startTour(){
 if(!S.ready)return;S.cameraRestoreGeneration=(S.cameraRestoreGeneration||0)+1;
 S.tourTime=0;S.tourStart=performance.now();S.tourOn=true;runCues.done=new Set();
 N.TourClock.enabled=false;N.V_Tour.getValue().resetUserOffsets();
 S.tourNav=Array.from(N.NAV.type);N.NAV.type=new X3D.MFString('NONE');
 N.NAV.transitionType=new X3D.MFString('TELEPORT');tourPose(0);N.V_Tour.set_bind=true;
 $('cap').classList.add('on');$('tour').textContent='■ Stop tour';
}
function stopTour(){
 if(!S.ready)return;S.tourOn=false;N.TourClock.enabled=false;
 if(S.tourNav)N.NAV.type=new X3D.MFString(...S.tourNav);S.tourNav=null;
 N.NAV.transitionType=new X3D.MFString(matchMedia('(prefers-reduced-motion:reduce)').matches?'TELEPORT':'ANIMATE');
 $('cap').classList.remove('on');$('tour').textContent='▶ Guided descent';
}
function scrubTour(t){
 if(!S.ready)return;S.cameraRestoreGeneration=(S.cameraRestoreGeneration||0)+1;if(S.tourOn)stopTour();S.tourTime=t;runCues.done=new Set();
 N.V_Tour.getValue().resetUserOffsets();N.NAV.transitionType=new X3D.MFString('TELEPORT');tourPose(t);N.V_Tour.set_bind=true;
 N.NAV.transitionType=new X3D.MFString(matchMedia('(prefers-reduced-motion:reduce)').matches?'TELEPORT':'ANIMATE');
 $('cap').classList.add('on');
}
/* ---------- boot ---------- */
(async () => {
  try {
    const [states, bin, stars, tour, cst, content] = await Promise.all([jget('states.json'), jget('states.bin', 1), jget('stars_v2.json'), jget('tour.json'), jget('const.json'), jget('content.json')]);
    GizaCore.validateStates(states,new Uint8Array(bin)); skyModel=GizaSky.createModel(stars);
    Object.assign(S,{states,bin:new Uint8Array(bin),stars,tour,const:cst,content});
    await initEvidence();
  } catch (e) { fail('Could not load page data: ' + e.message + '. Serve this folder over http (GitHub Pages does).'); throw e; }
  B = $('cv').browser;
  if(!B?.getContext?.()){ $('engine-state').textContent='WebGL unavailable · source cards active'; $('read').textContent='3D position unavailable'; for(const id of ['cD','cT','cS','cO','cG','exposure','quality','xg','xp','survey','scale','section','section-z','save-view','copy-link','session-save','session-open','tour','sky-play']){$(id).disabled=true;$(id).title='The 3D scene needs a WebGL-capable browser';}qsa('#lab button,#nav button').forEach(b=>b.disabled=true); fail('This browser cannot create a WebGL context. The source cards and manual sky probes remain available. Use a WebGL-capable browser for the 3D study.'); return; }
  scene = await new Promise((res, rej) => { let n = 0; const i = setInterval(() => { try { const s = B.currentScene; if (s && s.getNamedNode('SW_DOC') && s.getNamedNode('TourClock')) { clearInterval(i); res(s); } } catch (e) { } if (++n > 600) { clearInterval(i); rej(Error('scene did not load')); } }, 100); }).catch(e => { fail(e.message); throw e; });
  const names = ['SW_SURVEY','SW_SCALE','CLIP_SECTION','SW_DOC', 'SW_THE', 'SW_SPE', 'SW_ORION', 'SW_GAZE', 'SW_SKY', 'SW_CONST', 'STAR_PTS', 'CONST_PTS', 'SUN', 'BG', 'FOG', 'NAV', 'CamSensor', 'TourClock', 'TourRig', 'V_Tour', 'M_ground', 'M_khufu', 'M_khafre', 'M_menkaure', ...S.states.meshes.map(m => 'K_' + m.name), ...S.stars.named.map((_, i) => 'NS_' + i)];
  for (const n of names) N[n] = scene.getNamedNode(n);
  S.tour.views.find(v=>v.id==='V_Top').label='Overhead perspective (not orthographic)';
  S.ready=true;N.V_Tour.position=new X3D.SFVec3f(0,0,0);N.V_Tour.orientation=new X3D.SFRotation(0,1,0,0);N.TourClock.enabled=false;N.NAV.transitionType=new X3D.MFString(matchMedia('(prefers-reduced-motion:reduce)').matches?'TELEPORT':'ANIMATE');N.NAV.transitionTime=new X3D.MFTime(.8);
  $('light').innerHTML=S.states.states.map(state=>`<button data-id="${state.id}">${esc(LIGHT_LABELS[state.id])}</button>`).join('');
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
  // touch sensors -> modal; zone sensors -> discovery
  for (const [t, [lens, view]] of Object.entries(TOUCH)) { const sn = scene.getNamedNode(t); sn.addFieldCallback('open_' + t, 'touchTime', () => openModal(lens, view)); sn.addFieldCallback('over_' + t, 'isOver', v => { $('cv').style.cursor = v ? 'pointer' : ''; }); }
  for (const z of Object.keys(ZONE_LABEL)) { const zn = scene.getNamedNode(z); zn.addFieldCallback('zone_' + z, 'isActive', v => {
    if (!v) { S.zone === z && (S.zone = null); return; } S.zone = z; if (ZONE_SPEED[z]) N.NAV.speed = ZONE_SPEED[z];
    const first = !S.found.has(z); S.found.add(z); $('dn').textContent = S.found.size;
    toast(`<b>${first ? 'Found: ' : ''}${esc(ZONE_LABEL[z])}</b><br><small style="color:var(--mut)">${first ? 'Click the glowing structure, or press 1 to 3 for the lenses' : 'You are here'}</small>`); }); }
  S.cl = await jget('clusters.json'); for (const k of Object.keys(S.cl.clusters)) N['LB_' + k] = scene.getNamedNode('LB_' + k);
  const initialCamera=readCamera(); let pos=initialCamera?{x:initialCamera.position[0],y:initialCamera.position[1],z:initialCamera.position[2]}:null; N.CamSensor.addFieldCallback('cam', 'position_changed', p => { pos = p; });
  let lastCull = 0; const cull = (x, y, z) => { const aerial = y > 80, AER = ['khafre', 'khufu', 'menk', 'sphinx', 'causeway', 'osiris', 'hall', 'orion']; const gate={osiris:'cD',khufuin:'cD',anomaly:'cT',depth:'cT',hall:'cS',onesys:'cS',khafreclaim:'cS',orion:'cO',gaze:'cG'};
    for (const [k, c] of Object.entries(S.cl.clusters)) { const d = Math.hypot(x - c.c[0], y - c.c[1], z - c.c[2]); const allowed=(!gate[k]||$(gate[k]).checked)&&(!['orion','gaze'].includes(k)||$('cT').checked); const on = allowed&&($('lab').dataset.mode === 'off' ? false : $('lab').dataset.mode === 'all' || (aerial && AER.includes(k)) || d < c.r); const w = on ? 0 : -1; if (N['LB_' + k].whichChoice !== w) N['LB_' + k].whichChoice = w; }
    const under = y < -1.5; if (under !== S.under) { S.under = under; skyVis(); } };
  const ro = () => { requestAnimationFrame(ro); if(document.hidden)return; const now=performance.now();if(S.tourOn){const t=Math.min(S.tour.duration,(now-S.tourStart)/1000);S.tourTime=t;tourPose(t);if(t>=S.tour.duration)stopTour();} if(S.skyPlay){const dt=Math.min(.1,(now-(S.skyLast||now))/1000);S.epoch=Math.min(skyModel.maxEpoch,S.epoch+dt*120);$('ep').value=S.epoch;updateSky();if(S.epoch>=skyModel.maxEpoch)toggleSkyPlay(false);} S.skyLast=now; if(!pos)return; if (now - lastCull > 200) { lastCull = now; cull(pos.x, pos.y, pos.z); } const [x, y, z] = [pos.x, pos.y, pos.z], oc = S.cl.clusters.osiris.c, dO = Math.hypot(x - oc[0], y - oc[1], z - oc[2]);
    $('read').innerHTML = `${y < 0 ? 'depth <b>' + (-y).toFixed(1) + ' m</b>' : 'height <b>' + y.toFixed(1) + ' m</b>'} · E <b>${x.toFixed(0)}</b> N <b>${(-z).toFixed(0)}</b> from the Sphinx · Osiris mouth <b>${dO.toFixed(0)} m</b>${S.zone ? ' · in <b>' + esc(ZONE_LABEL[S.zone]) + '</b>' : ''}`; };
  ro();
  if (innerWidth < 760) { $('dock').classList.add('hide'); $('dockbtn').setAttribute('aria-expanded', 'false'); }   // phones start with the scene, not the panel
  applyLight('sunrise'); xray(); layers(); updateSky(); $('nav').children[0].classList.add('on');
  applySurvey(); applyImage(); initNotebook();updateContext('V_Overview');
  await restoreLink();
  window.__giza={state:S,go,captureState,restoreState,report:buildReport,scrubTour};
})().catch(e => {console.error(e);fail('The study could not finish starting: '+(e.message||e));});

/* ---------- Evidence Atlas instruments ---------- */
const LIGHT_LABELS={sunrise:'East light · +7°',midday:'Midday study',afternoon:'Afternoon study',night:'Starlight · authored'};
const TOUR_CONTEXT=[[0,'V_Overview'],[7,'V_Sunrise'],[14,'V_Osiris'],[26,'V_ChamberB'],[32,'V_Anomaly'],[38,'V_Hall'],[44,'V_HallInside'],[52,'V_Khafre'],[60,'V_Khufu'],[68,'V_Overview']];
const storage={get(k){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
let currentReport=null;
function cleanMarkup(value){
 const doc=new DOMParser().parseFromString(String(value||''),'text/html'),allowed=new Set(['A','B','STRONG','EM','I','P','DIV','SPAN','SMALL','TABLE','THEAD','TBODY','TR','TH','TD','BR','CODE','PRE','UL','OL','LI','DETAILS','SUMMARY','H2','H3','H4']);
 for(const el of [...doc.body.querySelectorAll('*')]){
  if(!allowed.has(el.tagName)){el.remove();continue;}
  for(const a of [...el.attributes])if(!['href','class','target','rel','title','colspan','rowspan'].includes(a.name))el.removeAttribute(a.name);
  if(el.tagName==='A'){try{const url=new URL(el.getAttribute('href'),location.href);if(!['http:','https:'].includes(url.protocol))el.removeAttribute('href');else{el.href=url.href;el.target='_blank';el.rel='noopener noreferrer';}}catch{el.removeAttribute('href');}}
 }
 return doc.body.innerHTML;
}
function filterCards(){const query=$('card-search').value.toLocaleLowerCase();const targets=S.lens==='ledger'?qsa('#mbody tbody tr'):qsa('#mbody .card');for(const el of targets)el.hidden=query&&!el.textContent.toLocaleLowerCase().includes(query);}
function updateContext(view){
 if(view)S.view=view;
 const rec=S.evidence?.views?.[S.view]||S.evidence?.unknown_view||{title:'The Giza plateau',tier:'mixed',geometry_status:'Schematic study geometry',limitations:[]};
 const tier=rec.tier||'mixed';$('context-title').textContent=rec.title;$('context-tier').textContent=({documented:'DOCUMENTED TOPIC',theorized:'INTERPRETATION',speculative:'SPECULATIVE',mixed:'MIXED CONTEXT'})[tier];$('context-tier').className='tier '+tier;
 $('context-geometry').textContent=rec.geometry_status;$('context-limit').textContent=rec.limitations?.[0]||'';
 const flags=[];if($('cS').checked)flags.push('SPECULATION LAYER ON');if($('cO').checked)flags.push('CORRELATION OVERLAY');if($('section').checked)flags.push('OPEN CUTAWAY');
 $('view-stamp').textContent=(tier==='speculative'?'UNVERIFIED / IMAGINED MODEL':'SCHEMATIC PLAN · METRES · SPHINX ORIGIN')+(flags.length?' · '+flags.join(' · '):'');
}
function applySurvey(){
 S.survey=$('survey').checked;S.scale=$('scale').checked;S.section=$('section').checked;S.sectionZ=+$('section-z').value;$('section-value').textContent=S.sectionZ+' m';
 if(S.ready){N.SW_SURVEY.whichChoice=S.survey?0:-1;N.SW_SCALE.whichChoice=S.scale?0:-1;N.CLIP_SECTION.plane=new X3D.SFVec4f(0,0,-1,S.sectionZ);N.CLIP_SECTION.enabled=S.section;}
 updateContext();
}
function applyImage(){
 S.exposure=+$('exposure').value;S.quality=$('quality').value;$('exposure-value').textContent=S.exposure.toFixed(2)+'×';
 const ratio=({performance:.65,balanced:Math.min(devicePixelRatio||1,1.5),ultra:Math.min(Math.max(devicePixelRatio||1,1.5),2)})[S.quality];
 $('cv').setAttribute('exposure',String(S.exposure));$('cv').setAttribute('contentScale',String(ratio));appearanceEvent();
}
function toggleFocus(on){document.body.classList.toggle('focus-mode',on);$('focus').setAttribute('aria-pressed',String(on));}
function toggleSkyPlay(on){S.skyPlay=on;S.skyLast=performance.now();$('sky-play').setAttribute('aria-pressed',String(on));$('sky-play').textContent=(on?'■ Pause':'▶ Animate')+' precession · 120 years/s';}
async function sha256(bytes){const hash=await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function hashAssets(){
 const paths=['giza-atlas-v3.x3d','states.bin','states.json','stars_v2.json','content.json','tour.json','const.json','clusters.json','evidence-index.json','sky-math.js','giza-core.js','../v4/giza.js','../v4/review-core.mjs','../v4/cameras.json','../v4/witness.js','../v4/hawara.mjs','../v4/view-slots.mjs','../v4/witness.css','../v4/index.html'];
 const results=await Promise.all(paths.map(async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error(path+' is unavailable');const bytes=await r.arrayBuffer();return [path,{sha256:await sha256(bytes),bytes:bytes.byteLength}];}));S.sourceHashes=Object.fromEntries(results);return S.sourceHashes;
}
function readCamera(){
 try{
  if(!S.ready)return null;
  const vp=B.getActiveViewpoint(),matrix=vp.getCameraSpaceMatrix();
  // The effective FOV includes X_ITE's navigation/transition scale. The pivot
  // is a point in the viewpoint's parent frame, not necessarily on its gaze.
  const pose=GizaCore.cameraFromMatrix(matrix,10,vp.getUserFieldOfView());
  const centre=vp.getUserCenterOfRotation(),model=vp.getModelMatrix();
  pose.center=[model[0]*centre.x+model[4]*centre.y+model[8]*centre.z+model[12],model[1]*centre.x+model[5]*centre.y+model[9]*centre.z+model[13],model[2]*centre.x+model[6]*centre.y+model[10]*centre.z+model[14]];
  return GizaCore.camera(pose);
 }catch{return null;}
}
async function restoreCamera(value){
 const c=GizaCore.camera(value);if(!c||!S.ready)return;
 const generation=S.cameraRestoreGeneration=(S.cameraRestoreGeneration||0)+1,deadline=performance.now()+5000;
 const nextFrame=async()=>{
  const remaining=deadline-performance.now();if(remaining<=0)throw new Error('The observation camera did not finish binding within 5 seconds.');
  let timer;
  try{await Promise.race([B.nextFrame(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The observation camera did not finish binding within 5 seconds.')),remaining);})]);}
  finally{clearTimeout(timer);}
  if(generation!==S.cameraRestoreGeneration)throw new Error('Camera restore was superseded by a newer observation.');
 };
 if(!S.customView){S.customView=scene.createNode('Viewpoint');S.customView.description='Restored observation camera';scene.addRootNode(S.customView);}
 const vp=S.customView,target=vp.getValue(),p=new X3D.SFVec3f(...c.position),r=new X3D.SFRotation(...c.orientation),t=new X3D.SFVec3f(...c.center);
 B.getActiveViewpoint()?.transitionStop();
 // Restore a snapshot without a LINEAR bind animation continuing to overwrite
 // its offsets. The root viewpoint uses the captured world-coordinate pose.
 vp.jump=false;vp.position=p;vp.orientation=r;vp.centerOfRotation=t;vp.fieldOfView=c.fov;vp.set_bind=true;
 await nextFrame();
 while(B.getActiveViewpoint()!==target)await nextFrame();
 target.transitionStop();target.resetUserOffsets();
 target.setUserPosition(p.getValue());target.setUserOrientation(r.getValue());target.setUserCenterOfRotation(t.getValue());target.setFieldOfViewScale(1);target.update();
 await nextFrame();
 if(B.getActiveViewpoint()!==target)throw new Error('Camera restore was superseded by another viewpoint.');
}
function captureState(){
 return {view:S.view,light:S.lightId,epoch:S.epoch,lst:S.lst,ground:+$('xg').value,pyramid:+$('xp').value,exposure:S.exposure,quality:S.quality,labels:$('lab').dataset.mode,
  layers:{documented:$('cD').checked,theorized:$('cT').checked,speculative:$('cS').checked,orion:$('cO').checked,gaze:$('cG').checked,stars:$('cK').checked},survey:$('survey').checked,scale:$('scale').checked,section:{enabled:$('section').checked,z:+$('section-z').value},camera:readCamera()};
}
function sessionEnvelope(){return {schema:'giza-evidence-atlas-session/v1',created_utc:new Date().toISOString(),frame:'metres; +X east,+Y up,+Z south; schematic Sphinx origin',sources:S.sourceHashes,state:captureState()};}
async function restoreState(envelope,{checkSources=true}={}){
 if(!S.ready)throw new Error('Wait for the X3D scene to finish loading');
 const next=GizaCore.normalizeSession(envelope,{views:S.tour.views.map(v=>v.id),epochMin:skyModel.minEpoch,epochMax:skyModel.maxEpoch});
 if(checkSources&&envelope.sources?.['giza-atlas-v3.x3d']?.sha256){await S.hashPromise;if(envelope.sources['giza-atlas-v3.x3d'].sha256!==S.sourceHashes['giza-atlas-v3.x3d'].sha256)throw new Error('This session targets a different scene version. Open it with that version of the study.');}
 stopTour();toggleSkyPlay(false);S.view=next.view;S.epoch=next.epoch;S.lst=next.lst;$('ep').value=S.epoch;$('lst').value=S.lst;
 const mapping={documented:'cD',theorized:'cT',speculative:'cS',orion:'cO',gaze:'cG',stars:'cK'};for(const [key,id]of Object.entries(mapping))$(id).checked=next.layers[key];S.skyOn=next.layers.stars;
 $('xg').value=next.ground;$('xp').value=next.pyramid;$('exposure').value=next.exposure;$('quality').value=next.quality;
 $('survey').checked=next.survey;$('scale').checked=next.scale;$('section').checked=next.section.enabled;$('section-z').value=next.section.z;
 $('lab').dataset.mode=next.labels;qsa('#lab button').forEach(b=>b.classList.toggle('on',b.dataset.m===next.labels));
 applyLight(next.light);applyImage();layers();xray();applySurvey();updateSky();
 if(next.camera)await restoreCamera(next.camera);else scene.getNamedNode(next.view).set_bind=true;updateContext();
}
function download(data,name,type='application/json'){const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function renderBookmarks(){
 $('bookmarks').innerHTML=S.bookmarks.map((b,i)=>`<li><button class="bookmark-go" data-bm="${i}">${String(i+1).padStart(2,'0')} · ${esc(b.name)}</button><button class="bookmark-delete" data-del="${i}" aria-label="Delete saved viewpoint ${i+1}">×</button></li>`).join('');
}
function initNotebook(){
 const saved=storage.get('giza:atlas:bookmarks');S.bookmarks=[];
 if(Array.isArray(saved))for(const b of saved.slice(0,12)){try{const state=GizaCore.normalizeSession({schema:'giza-evidence-atlas-session/v1',state:b.state},{views:S.tour.views.map(v=>v.id),epochMin:skyModel.minEpoch,epochMax:skyModel.maxEpoch});S.bookmarks.push({name:String(b.name||'Observation').slice(0,60),state});}catch{}}
 renderBookmarks();
}
async function restoreLink(){
 const params=new URLSearchParams(location.hash.slice(1));
 if(params.has('lens')){openModal(params.get('lens'),'all');return;}
 if(params.has('session')){try{const raw=JSON.parse(params.get('session'));await restoreState({schema:'giza-evidence-atlas-session/v1',state:raw},{checkSources:false});}catch(e){toast(esc('View link: '+e.message));}return;}
 if(params.has('view')){try{go(params.get('view'));}catch(e){toast(esc(e.message));}}
}
async function buildReport(){
 if(S.hashPromise)await S.hashPromise;
 const [baseline,structure]=await Promise.all([jget('validation.json'),jget('build/scene-structure.json')]);
 const fps=B?.getCurrentFrameRate?.(),age=B?.getCurrentTime?Date.now()/1000-B.getCurrentTime():Infinity,canvas=B?.getCanvas?.();
 return {schema:'giza-evidence-atlas-report/v1',captured_utc:new Date().toISOString(),session:sessionEnvelope(),witness:window.__witness?.capture?.()||null,baked_light_contract:GizaCore.validateStates(S.states,S.bin),sky_sample:S.skySample,sky_limits:GizaSky.LIMITATIONS,
  scope:{geometry:'Schematic scene, not a survey reconstruction',source_read_grades:'Historical opened/read flags are not truth probabilities',full_xsd_rerun:false,archaeological_fieldwork:false,solar_date_calculation:false,gpu_timing_measured:false},
  renderer:{version:B?.version||'unavailable',activity:age>1.5?'on-demand idle':'engine cadence',fps:Number.isFinite(fps)&&fps>=1&&age<=1.5?fps:null,width:canvas?.width||0,height:canvas?.height||0,quality:S.quality},
  source_hash_error:S.hashError||null,current_structure:structure,baseline_xsd_receipt:{...baseline,scope:'Supplied v2 receipt only; it does not certify this enhanced scene',matches_current_scene_prefix:S.sourceHashes['giza-atlas-v3.x3d']?.sha256.startsWith(baseline.sha)},evidence_scope:S.evidence?.scope};
}
async function initEvidence(){
 S.evidence=await jget('evidence-index.json');S.hashPromise=hashAssets().catch(e=>{S.hashError=e.message;return {};});
 $('star-count').textContent=`${S.stars.field.length} field + ${S.stars.named.length} named stars · incomplete catalogue`;
 $('probe-star').innerHTML=S.stars.named.map(s=>`<option value="${esc(s.n)}" ${s.n==='Alnilam'?'selected':''}>${esc(s.n)}</option>`).join('');
 $('ep').min=skyModel.minEpoch;$('ep').max=skyModel.maxEpoch;
 qsa('.lens button').forEach(b=>b.onclick=()=>openModal(b.dataset.lens,'all'));
 $('mclose').onclick=closeModal;$('modal').onclick=e=>{if(e.target===$('modal'))closeModal();};$('card-search').oninput=filterCards;
 $('chips').onclick=e=>{const b=e.target.closest('[data-f]');if(b)openModal(S.lens,b.dataset.f);};
 $('mbody').onclick=e=>{const b=e.target.closest('[data-go]');if(b){closeModal();go(b.dataset.go);}};
 $('dockbtn').onclick=()=>{const hidden=$('dock').classList.toggle('hide');$('dockbtn').setAttribute('aria-expanded',String(!hidden));};
 $('focus').onclick=()=>toggleFocus(!document.body.classList.contains('focus-mode'));
 $('exposure').oninput=$('quality').onchange=applyImage;
 ['survey','scale','section'].forEach(id=>$(id).onchange=applySurvey);$('section-z').oninput=applySurvey;
 $('reset-main-camera').onclick=()=>go(S.view);
 $('tour-motion').value=matchMedia('(prefers-reduced-motion:reduce)').matches?'cuts':'smooth';$('tour-time').oninput=e=>scrubTour(+e.target.value);
 $('probe-star').onchange=updateSky;$('sky-play').onclick=()=>toggleSkyPlay(!S.skyPlay);
 // These data-only controls work even when the 3D context is unavailable.
 $('ep').oninput=e=>{S.epoch=+e.target.value;updateSky();};$('lst').oninput=e=>{S.lst=+e.target.value;updateSky();};
 qsa('[data-ep]').forEach(b=>b.onclick=()=>{S.epoch=+b.dataset.ep;$('ep').value=S.epoch;updateSky();});qsa('[data-lst]').forEach(b=>b.onclick=()=>{S.lst=lstPreset(b.dataset.lst);$('lst').value=S.lst;updateSky();});
 $('context-sources').onclick=()=>{const record=S.evidence.views[S.view]||S.evidence.unknown_view;const ids=new Set(record.source_card_ids||[]);if(!ids.size){openModal('ledger','all');return;}openModal(record.tier==='speculative'?'contested':'technical','all');$('mtitle').textContent=record.title+' · source cards';$('chips').replaceChildren();$('mbody').innerHTML=S.content.items.filter(item=>ids.has(item.id)).map(card).join('');};
 $('save-view').onclick=()=>{if(!S.ready)return toast('Wait for the scene to finish loading.');if(S.bookmarks.length>=12)return toast('The camera notebook holds twelve observations. Remove one to save another.');S.bookmarks.push({name:S.evidence.views[S.view]?.title||'Observation',state:captureState()});storage.set('giza:atlas:bookmarks',S.bookmarks);renderBookmarks();toast('Observation saved: camera, layers, sky and image settings.');};
 $('bookmarks').onclick=async e=>{const go=e.target.closest('[data-bm]'),del=e.target.closest('[data-del]');try{if(go)await restoreState({schema:'giza-evidence-atlas-session/v1',state:S.bookmarks[+go.dataset.bm].state},{checkSources:false});if(del){S.bookmarks.splice(+del.dataset.del,1);storage.set('giza:atlas:bookmarks',S.bookmarks);renderBookmarks();}}catch(err){toast(esc(err.message));}};
 $('copy-link').onclick=async()=>{if(!S.ready)return;const url=new URL(location.href);url.hash=new URLSearchParams({session:JSON.stringify(captureState())});try{await navigator.clipboard.writeText(url.href);toast('View link copied. It needs this same local study.');}catch{toast('Clipboard unavailable. Export a session instead.');}};
 $('session-save').onclick=async()=>{if(!S.ready)return;await S.hashPromise;download(sessionEnvelope(),'Giza-Evidence-Atlas-session.json');};
 $('session-open').onclick=()=>$('session-file').click();$('session-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>1000000)throw new Error('Session must be smaller than1MB');await restoreState(JSON.parse(await file.text()));toast('Observation session restored.');}catch(err){toast(esc(err.message));}};
 $('report').onclick=async()=>{try{currentReport=await buildReport();$('report-body').textContent=JSON.stringify(currentReport,null,2);$('report-dialog').showModal();}catch(err){toast(esc(err.message));}};
 $('report-close').onclick=()=>$('report-dialog').close();$('report-save').onclick=()=>{if(currentReport)download(currentReport,'Giza-Evidence-Atlas-report.json');};
 addEventListener('keydown',e=>{
  if($('modal').classList.contains('on')){if(e.key==='Escape'){closeModal();return;}if(e.key==='Tab'){const f=qsa('#mbox button,#mbox input,#mbox a[href]').filter(x=>!x.disabled&&!x.hidden&&x.getClientRects().length);const first=f[0],last=f.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}return;}
  if(document.body.classList.contains('hawara-open')||e.target.closest('#visor,#witness-panel')||$('report-dialog').open||e.target.matches('input,select,textarea,button,a')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='Escape')toggleFocus(false);else if(e.key.toLowerCase()==='f')toggleFocus(!document.body.classList.contains('focus-mode'));else if(e.key.toLowerCase()==='t')$('tour').click();else if(e.key.toLowerCase()==='c')$('dockbtn').click();else if(/^[1-4]$/.test(e.key))openModal(['technical','wonder','contested','ledger'][+e.key-1],'all');
 });
 updateSky();updateContext();
 setInterval(()=>{if(!S.ready||document.hidden)return;const fps=B.getCurrentFrameRate(),age=Date.now()/1000-B.getCurrentTime();$('engine-state').textContent=age>1.5||!Number.isFinite(fps)||fps<1?'IDLE · on demand':fps.toFixed(0)+' fps · engine cadence';},900);
}

// Pause elapsed tour time while the page is hidden, preventing a catch-up jump.
let hiddenAt=null;addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=performance.now();else{if(hiddenAt!==null&&S.tourOn)S.tourStart+=performance.now()-hiddenAt;hiddenAt=null;}});
