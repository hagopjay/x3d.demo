import { DEFAULTS, sanitizeSettings, response, sweep, createPiezoState, stepPiezo, journeyAt, JOURNEY_DURATION } from './resonance.mjs';
import { CAMERA_MODES, ENCOUNTER_LEVELS, journeyPose } from './journey.mjs';
import { makeSession, validateSession } from './session.mjs';

const $ = id => document.getElementById(id), all = selector => [...document.querySelectorAll(selector)];
const settingsKeys = Object.keys(DEFAULTS), numeric = settingsKeys.filter(k => typeof DEFAULTS[k] === 'number');
const views = ['V_Overview','V_Cutaway','V_Chamber','V_Ritual','V_Stars','V_Witness','V_Immersive'];
const S = { settings:{...DEFAULTS}, lens:'lab', seconds:0, playing:false, ready:false, view:'V_Cutaway', cameraMode:'witness', encounterLevel:'beings', directed:false, comparison:null, history:[], animationTime:0 };
let browser, scene, N = {}, piezo = createPiezoState(), previous = performance.now(), lastPaint=0, lastJourney=0, lastHistory=0, lastReadout=0, audio;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
$('motion').checked = reduced.matches;
if (innerWidth < 760) setPanel(false);

function note(message) { $('change-note').textContent=message; }
function setPanel(open) { $('instrument').classList.toggle('closed',!open); $('panels-toggle').setAttribute('aria-expanded',String(open)); }
function field(name, prop, value) { if (S.ready && N[name]) N[name][prop]=value; }
function vector(x,y,z) { return new X3D.SFVec3f(x,y,z); }
function camera(view, manual=false) {
 if (!views.includes(view)) throw new Error('Unknown viewpoint.');
 if(manual){S.directed=false;S.cameraMode='witness';syncCameraUI();}
 S.view=view;
 if (S.ready) { N.NAV.transitionTime=$('motion').checked?0:2; scene.getNamedNode(view).set_bind=true; }
 all('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 if(manual && S.playing) { setPlaying(false); note('Passage paused so you can explore this viewpoint.'); }
}
function syncCameraUI(){
 all('[data-camera]').forEach(b=>{const active=b.dataset.camera===S.cameraMode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $('camera-note').textContent=$('motion').checked?'Camera held · select a chapter to reframe':'V to switch · continuous journey cameras';
}
function directedCamera(reframe=false, forceBind=false){
 if(!S.directed||($('motion').checked&&!reframe))return;
 const id=S.cameraMode==='first-person'?'V_Immersive':'V_Witness',changed=S.view!==id;
 if(!S.ready){S.view=id;return;}
 for(const mode of CAMERA_MODES){
  const pose=journeyPose(S.seconds,mode,S.encounterLevel),node=N[mode==='first-person'?'V_Immersive':'V_Witness'];
  node.position=vector(...pose.position);node.orientation=new X3D.SFRotation(...pose.orientation);
  node.centerOfRotation=vector(...pose.target);node.fieldOfView=pose.fov;
 }
 S.view=id;
 if(changed||forceBind){N.NAV.transitionTime=$('motion').checked?0:1.15;N[id].set_bind=true;}
 all('[data-view]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});
}
function setCameraMode(mode){
 if(!CAMERA_MODES.includes(mode))throw new Error('Unknown camera mode.');
 setLens('mythic');S.cameraMode=mode;S.directed=true;syncCameraUI();directedCamera(true,true);applyScene();
 note(mode==='first-person'?'See through the king’s eyes. The visible royal body is hidden to keep the camera clear.':'Witness the same passage from the outside. Journey time and experiments are unchanged.');
}
function setLens(lens) {
 if(!['archaeology','lab','mythic'].includes(lens)) throw new Error('Unknown lens.');
 S.lens=lens;
 all('[data-lens]').forEach(b=>{b.classList.toggle('active',b.dataset.lens===lens);b.setAttribute('aria-pressed',String(b.dataset.lens===lens));});
 const copy={
 archaeology:['SCHEMATIC ARCHAEOLOGY','stone','Schematic dimensions and placement · authored landscape · sources in Evidence & vision','Limestone and granite ground this schematic world. Royal figure, regalia and landscape are artistic reconstructions.'],
 lab:['ILLUSTRATIVE MODEL','','Assumed coefficients · normalized response · no measured pyramid output','A driven resonator analogy. Field ribbons show illustrative amplitude, not a computed electromagnetic map.'],
 mythic:['SPECULATIVE FICTION','fiction','Authored journey · machinery, craft and beings are imagined','Ankh at the heart, was-sceptre at the brow. Switch from witnessing the king to seeing through his eyes. The machinery, craft and beings are authored fiction.']
 }[lens];
 $('tier').textContent=copy[0];$('tier').className='tier '+copy[1];$('status-text').textContent=copy[2];$('lens-description').textContent=copy[3];
 if(lens!=='mythic'){setPlaying(false);if(S.directed){S.directed=false;S.cameraMode='witness';camera('V_Cutaway');syncCameraUI();}}
 applyScene();
}
function syncControls() {
 for(const key of numeric) $(key).value=S.settings[key];
 for(const key of ['crystals','conductor']) $(key).checked=S.settings[key];
 $('mechanical').value=S.settings.mechanical;
 updateReadout();
}
function updateReadout() {
 const s=S.settings, r=response(s);
 for(const key of numeric) $(key+'-out').textContent = key==='frequency'?s[key].toFixed(3)+' MHz':key==='q'?s[key].toFixed(0):(s[key]*100).toFixed(0)+'%';
 $('gain').textContent=r.gain.toFixed(2)+'×';$('phase').textContent=Math.abs(r.phase*180/Math.PI).toFixed(0)+'°';
 $('input-rate').textContent=r.input.toFixed(3);$('loss-rate').textContent=r.dissipated.toFixed(3);$('stored-energy').textContent=r.stored.toFixed(3);
 $('peak').textContent='f₀ '+r.f0MHz.toFixed(3)+' MHz';
 $('spectrum').setAttribute('aria-label',`Driven oscillator analogy. Frequency ${s.frequency.toFixed(3)} megahertz; relative response ${r.gain.toFixed(2)}; phase lag ${Math.abs(r.phase*180/Math.PI).toFixed(0)} degrees. Not a Maxwell solution.`);
 drawSpectrum();applyScene();
}
function drawSpectrum() {
 const cv=$('spectrum'),ctx=cv.getContext('2d'),w=cv.width,h=cv.height,points=sweep(S.settings),comp=S.comparison?sweep(S.comparison):null;
 const ymax=Math.max(1,...points.map(p=>p.gain),...(comp||[]).map(p=>p.gain))*1.1;
 ctx.clearRect(0,0,w,h);ctx.lineWidth=1;ctx.strokeStyle='#34424b';
 for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4);ctx.stroke();}
 const path=(data,color,dashed)=>{ctx.beginPath();ctx.setLineDash(dashed?[6,5]:[]);ctx.lineWidth=2.5;ctx.strokeStyle=color;data.forEach((p,i)=>{const x=(p.frequency-.5)*w,y=h-10-p.gain/ymax*(h-20);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.setLineDash([]);};
 if(comp)path(comp,'#9d86c8',true);path(points,'#e8bb72',false);
 const x=(S.settings.frequency-.5)*w,y=h-10-response(S.settings).gain/ymax*(h-20);
 ctx.strokeStyle='#7cddd970';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.fillStyle='#9afff4';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#a2afb5';ctx.font='13px system-ui';ctx.fillText(ymax.toFixed(1)+'×',5,15);
}
function drawTransient() {
 const cv=$('transient'),ctx=cv.getContext('2d'),w=cv.width,h=cv.height,values=S.history;
 ctx.clearRect(0,0,w,h);const max=Math.max(.015,...values.map(Math.abs));
 ctx.strokeStyle='#34424b';ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.strokeStyle='#7cddd9';ctx.lineWidth=2;ctx.beginPath();
 values.forEach((v,i)=>{const x=i/199*w,y=h/2-v/max*(h/2-7);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
 $('voltage').textContent=piezo.voltage.toFixed(3);
}
function applyScene() {
 if(!S.ready)return;
 const j=journeyAt(S.seconds),pose=journeyPose(S.seconds,S.cameraMode,S.encounterLevel),myth=S.lens==='mythic',lab=S.lens==='lab',r=response(S.settings),cut=$('cutaway').checked;
 const immersive=S.directed&&S.cameraMode==='first-person';
 field('SW_SHELL_FRONT','whichChoice',cut?-1:0);field('SW_CHAMBER_ROOF','whichChoice',immersive||['V_Chamber','V_Ritual'].includes(S.view)||(S.directed&&S.seconds>=30&&S.seconds<=76)?-1:0);
 field('SW_ROYAL_BODY','whichChoice',immersive?-1:0);
 field('SW_QUARTZ','whichChoice',((lab&&S.settings.crystals)||(myth&&j.index>=1))?0:-1);
 field('SW_CONDUCTOR','whichChoice',((lab&&S.settings.conductor)||(myth&&j.index>=2))?0:-1);
 field('SW_FIELD','whichChoice',$('fields').checked&&S.lens!=='archaeology'&&r.gain>0?0:-1);
 field('M_FIELD','transparency',.88-.65*r.visualGain);
 field('M_FIELD','emissiveColor',new X3D.SFColor(.14+.45*r.visualGain,.45+.45*r.visualGain,.67+.25*r.visualGain));
 field('T_WATER','translation',vector(0,+$('water').value,0));
 field('SW_DEVICE','whichChoice',0);
 field('SW_KA','whichChoice',myth&&!immersive&&j.ka>0?0:-1);
 field('T_KA','translation',vector(0,j.ka*145,-30*j.ka));
 field('SW_COSMIC','whichChoice',myth&&pose.stage.geometry>0?0:-1);
 field('SW_MACHINERY','whichChoice',myth&&pose.stage.machinery>0?0:-1);
 field('SW_CRAFT','whichChoice',myth&&pose.stage.craft>0?0:-1);
 field('SW_BEINGS','whichChoice',myth&&pose.stage.beings>0?0:-1);
 field('SW_WAS_AURA','whichChoice',myth&&pose.wasCoupling>0?0:-1);
 const wasScale=1+.055*pose.wasCoupling;field('T_WAS','scale',vector(wasScale,wasScale,wasScale));
 field('M_WAS_GLOW','transparency',.9-.6*pose.wasCoupling);
 field('M_WAS_GLOW','emissiveColor',new X3D.SFColor(.45+.4*pose.wasCoupling,.2+.4*pose.wasCoupling,.05+.2*pose.wasCoupling));
 field('T_CRAFT','translation',vector(0,(1-pose.stage.craft)*24,0));
 const phaseClock=myth?S.seconds:S.animationTime,pulse=$('motion').checked?1:1+.055*Math.sin(phaseClock*2.3);
 field('T_HEART','scale',vector(pulse,pulse,pulse));field('T_HEAD','scale',vector(pulse,pulse,pulse));
 if(!$('motion').checked){field('T_FIELD','rotation',new X3D.SFRotation(0,1,0,phaseClock*.045));field('T_MACHINE','rotation',new X3D.SFRotation(0,1,0,phaseClock*.08));}
 directedCamera();
}
function formatTime(t){return Math.floor(t/60).toString().padStart(2,'0')+':'+Math.floor(t%60).toString().padStart(2,'0');}
function updateJourney(reframe=false) {
 const j=journeyAt(S.seconds),p=journeyPose(S.seconds,S.cameraMode,S.encounterLevel);
 $('timeline').value=S.seconds;$('time').textContent=formatTime(S.seconds)+' / 01:48';
 $('chapter-number').textContent='THE PASSAGE / '+String(j.index+1).padStart(2,'0');$('chapter-title').textContent=j.label;$('caption').textContent=j.caption;
 const shown=Object.entries(p.stage).filter(([,a])=>a>0).map(([key])=>key);
 $('encounter-status').textContent=shown.length?'Revealed: '+shown.join(' → ')+'. Authored fiction.':'Chamber machinery → celestial geometry → craft → beings. All encounter imagery is invented.';
 if(j.index===4){$('caption').textContent=p.stage.beings>0?'Beyond the craft, three nonhuman figures wait. This encounter is an authored vision.':p.stage.craft>0?'The geometric horizon resolves into a gold-and-lapis celestial craft.': 'The was-sceptre becomes the key. A celestial geometry opens above the chamber.';}
 all('[data-time]').forEach(b=>{const active=Math.floor(+b.dataset.time/18)===j.index;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');});
 directedCamera(reframe);
 applyScene();
}
function setPlaying(on) {
 S.playing=on;$('play').textContent=on?'Ⅱ':'▶';$('play').setAttribute('aria-label',on?'Pause journey':'Play journey');$('play').setAttribute('aria-pressed',String(on));document.body.classList.toggle('journey',on);
}
function startOrPause(){if(S.playing){setPlaying(false);return;}if(S.seconds>=JOURNEY_DURATION)S.seconds=0;setLens('mythic');S.directed=true;setPlaying(true);updateJourney(true);}
function download(name,object){const blob=new Blob([JSON.stringify(object,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function stageSnapshot(){return {water:+$('water').value,device:0,quality:+$('quality').value,motion:$('motion').checked,fields:$('fields').checked,cutaway:$('cutaway').checked};}

for(const key of numeric)$(key).addEventListener('input',()=>{S.settings=sanitizeSettings({...S.settings,[key]:+$(key).value});updateReadout();note(key==='moisture'?'In this analogy, moisture shifts the assumed mode and increases loss.':key==='load'?'A load change injects a charge transient only when quartz coupling is enabled.':'The curve shows a driven oscillator with assumed coefficients.');});
for(const key of ['crystals','conductor'])$(key).addEventListener('change',()=>{S.settings=sanitizeSettings({...S.settings,[key]:$(key).checked});updateReadout();note(key==='conductor'?'The imagined metal network adds loss in this toy model; metal does not automatically improve resonance.':'The vast quartz bed is an optional hypothesis. Its RC circuit is separate from the RF oscillator.');});
$('mechanical').onchange=()=>{S.settings.mechanical=$('mechanical').value;note(S.settings.mechanical==='cyclic'?'Cyclic strain is a 0.75 Hz analogy supplied by an external mechanical driver. It does not up-convert into the RF model.':'Constant force gives a transient when applied; the stored charge then leaks away.');};
$('reload').onclick=()=>{piezo=createPiezoState();S.history=[];note('The preload has been reapplied. Watch its transient decay; enable quartz to produce a signal.');};
all('[data-preset]').forEach(b=>b.onclick=()=>{S.settings=b.dataset.preset==='baseline'?{...DEFAULTS}:b.dataset.preset==='quartz'?{...DEFAULTS,crystals:true,conductor:true,quartz:.65,alignment:.75,mechanical:'cyclic'}:{...S.settings,drive:0};piezo=createPiezoState();S.history=[];syncControls();note(b.dataset.preset==='quartz'?'Hypothetical aligned quartz and a fictional metal network are enabled. This is a scenario, not a reconstruction.':b.dataset.preset==='off'?'The RF steady-state response is zero with no external RF drive. Mechanical forcing remains a separate experiment.':'Limestone baseline restored. Unsupported foundation and lining are hidden.');});
$('tune').onclick=()=>{const p=sweep(S.settings).reduce((a,b)=>a.gain>=b.gain?a:b);S.settings.frequency=p.frequency;syncControls();note('Tuned to the largest sampled response of this assumed oscillator. The samples are 0.00625 MHz apart.');};
$('compare').onclick=()=>{if(S.comparison){S.comparison=null;$('compare').textContent='Pin comparison A';}else{S.comparison={...S.settings};$('compare').textContent='Clear comparison A';}drawSpectrum();note(S.comparison?'Dashed violet: saved comparison A. Gold: current experiment. Both curves use the same scale.':'Comparison cleared.');};
all('[data-lens]').forEach(b=>b.onclick=()=>setLens(b.dataset.lens));all('[data-view]').forEach(b=>b.onclick=()=>camera(b.dataset.view,true));
all('[data-camera]').forEach(b=>b.onclick=()=>setCameraMode(b.dataset.camera));
$('begin').onclick=startOrPause;$('play').onclick=startOrPause;
$('timeline').oninput=()=>{setPlaying(false);setLens('mythic');S.directed=true;S.seconds=+$('timeline').value;updateJourney(true);};
all('[data-time]').forEach(b=>b.onclick=()=>{setPlaying(false);setLens('mythic');S.directed=true;S.seconds=+b.dataset.time;updateJourney(true);});
$('encounter-preview').onclick=()=>{setPlaying(false);setLens('mythic');S.directed=true;S.seconds=90;updateJourney(true);$('intro').classList.add('hidden');$('intro-toggle').textContent='Show title';note('The encounter is paused at its fullest reveal. Switch perspective or press play to return.');};
$('reset').onclick=()=>{setPlaying(false);S.seconds=0;S.directed=false;S.cameraMode='witness';syncCameraUI();camera('V_Cutaway');updateJourney(false);};
$('panels-toggle').onclick=()=>setPanel($('instrument').classList.contains('closed'));
$('intro-toggle').onclick=()=>{$('intro').classList.toggle('hidden');$('intro-toggle').textContent=$('intro').classList.contains('hidden')?'Show title':'Hide title';};
for(const key of ['fields','cutaway'])$(key).onchange=()=>applyScene();
$('motion').onchange=()=>{syncCameraUI();note($('motion').checked?'Automatic camera movement is held. Selecting a chapter or perspective explicitly reframes the scene.':'Continuous camera movement and decorative motion are enabled.');applyScene();};
$('encounter').onchange=()=>{const level=$('encounter').value;if(!ENCOUNTER_LEVELS.includes(level))return;S.encounterLevel=level;setLens('mythic');updateJourney(false);note('Encounter cap changed. The sequence stays at the same time and perspective; all reveals remain authored fiction.');};
$('water').oninput=()=>{$('water-out').textContent=(+$('water').value).toFixed(1)+' m';applyScene();note('The floodplain water height is a stage control. It does not drive the RF or piezo models.');};
$('quality').onchange=()=>$('world').setAttribute('contentScale',$('quality').value);
$('sources-open').onclick=()=>$('evidence').showModal();$('sources-close').onclick=()=>$('evidence').close();
$('tier').onclick=()=>$('evidence').showModal();
document.addEventListener('keydown',e=>{if(e.repeat||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('evidence').open)return;if(e.code==='Space'&&!/BUTTON|SUMMARY/.test(e.target.tagName)){e.preventDefault();startOrPause();}else if(e.code==='KeyV'){e.preventDefault();setCameraMode(S.cameraMode==='witness'?'first-person':'witness');}});
$('export').onclick=()=>{const session=makeSession({settings:S.settings,comparison:S.comparison,lens:S.lens,seconds:S.seconds,view:S.view,stage:stageSnapshot(),cameraMode:S.cameraMode,encounterLevel:S.encounterLevel});download('Giza-IV-experiment.json',{...session,response:response(S.settings)});note('Experiment exported with assumptions, selected viewpoint and passage time.');};
$('import').onclick=()=>$('session-file').click();
$('session-file').onchange=async e=>{try{
 const file=e.target.files[0];if(!file)return;if(file.size>65536)throw new Error('Experiment files must be smaller than 64 KiB.');
 const v=validateSession(JSON.parse(await file.text()));setPlaying(false);S.directed=false;setLens(v.lens);S.settings=v.settings;S.comparison=v.comparison;S.seconds=v.seconds;S.cameraMode=v.cameraMode;S.encounterLevel=v.encounterLevel;
 for(const key of ['water','quality'])$(key).value=v.stage[key];for(const key of ['motion','fields','cutaway'])$(key).checked=v.stage[key];$('encounter').value=v.encounterLevel;
 $('quality').onchange();$('water-out').textContent=(+v.stage.water).toFixed(1)+' m';$('compare').textContent=S.comparison?'Clear comparison A':'Pin comparison A';piezo=createPiezoState();S.history=[];
 S.directed=['V_Immersive','V_Witness'].includes(v.view);syncControls();syncCameraUI();camera(v.view);updateJourney(true);note('Experiment restored. Transient circuit restarted; audio stays under your control.');
 }catch(err){note('Could not import: '+err.message);}finally{e.target.value='';}};
$('audio').onclick=async()=>{try{if(audio){await audio.ctx.close();audio=null;$('audio').textContent='Enable sound';$('audio').setAttribute('aria-pressed','false');return;}const Audio=window.AudioContext||window.webkitAudioContext,ctx=new Audio(),gain=ctx.createGain();gain.gain.value=.018;gain.connect(ctx.destination);const oscillators=[110,165,220].map((hz,i)=>{const o=ctx.createOscillator();o.type=i===1?'sine':'triangle';o.frequency.value=hz;o.connect(gain);o.start();return o;});await ctx.resume();audio={ctx,gain,oscillators};$('audio').textContent='Mute sound';$('audio').setAttribute('aria-pressed','true');}catch(err){note('Audio unavailable: '+err.message);}};
document.addEventListener('visibilitychange',()=>{previous=performance.now();if(document.hidden){setPlaying(false);audio?.ctx.suspend();}else if(audio)audio.ctx.resume();});

async function loadEvidence(){try{const r=await fetch('evidence.json');if(!r.ok)throw new Error('Evidence file HTTP '+r.status);const body=await r.json(),cards=Array.isArray(body)?body:body.claims||body.items;if(!Array.isArray(cards))throw new Error('Invalid evidence data.');for(const card of cards){const article=document.createElement('article');article.className='evidence-card';const tier=document.createElement('span');tier.className='eyebrow';tier.textContent=card.tier;const title=document.createElement('h3');title.textContent=card.title;const summary=document.createElement('p');summary.textContent=card.summary;const limit=document.createElement('p');limit.className='limit';limit.textContent=card.limit;article.append(tier,title,summary,limit);for(const source of card.sources||[]){const a=document.createElement('a');const u=new URL(source.url);if(u.protocol!=='https:')continue;a.href=u.href;a.textContent=source.label+' ↗';a.target='_blank';a.rel='noopener noreferrer';article.append(a);}$('evidence-cards').append(article);}}catch(err){$('evidence-cards').textContent='Could not load evidence cards. Read SPECIFICATION.md. '+err.message;}}
async function boot(){
 try{
 await customElements.whenDefined('x3d-canvas');browser=$('world').browser;
 const deadline=performance.now()+45000;
 while(performance.now()<deadline){try{scene=browser.currentScene;scene.getNamedNode('SW_FIELD');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 if(!scene?.getNamedNode('SW_FIELD'))throw new Error('The X3D scene did not become ready.');
 for(const name of ['NAV','V_Witness','V_Immersive','SW_SHELL_FRONT','SW_CHAMBER_ROOF','SW_ROYAL_BODY','SW_QUARTZ','SW_CONDUCTOR','SW_FIELD','SW_KA','SW_COSMIC','SW_MACHINERY','SW_CRAFT','SW_BEINGS','SW_WAS_AURA','T_WAS','T_MACHINE','T_CRAFT','T_WATER','T_FIELD','M_FIELD','M_WAS_GLOW','T_KA','T_HEART','T_HEAD','SW_DEVICE'])N[name]=scene.getNamedNode(name);
 S.ready=true;$('engine').textContent='X_ITE · ready';if(S.directed)directedCamera(true,true);else camera(S.view);applyScene();document.documentElement.dataset.ready='true';
 }catch(err){$('engine').textContent='3D unavailable';$('failure').hidden=false;$('failure').textContent='The 3D scene could not start. Serve the full demo tree over HTTP and use a WebGL2 browser. Instruments and evidence remain available. '+err.message;}
}
function animate(now){
 const elapsed=Math.max(0,(now-previous)/1000);previous=now;
 if(!document.hidden){S.animationTime+=elapsed;piezo=stepPiezo(piezo,S.settings,Math.min(3600,elapsed));
 if(S.playing){S.seconds=Math.min(JOURNEY_DURATION,S.seconds+elapsed);if(now-lastJourney>66){updateJourney(false);lastJourney=now;}if(S.seconds>=JOURNEY_DURATION){setPlaying(false);updateJourney(false);}}
 if(now-lastHistory>100){S.history.push(piezo.voltage);if(S.history.length>200)S.history.shift();drawTransient();lastHistory=now;}
 if(now-lastPaint>50){applyScene();lastPaint=now;}
 if(audio){const r=response(S.settings);audio.gain.gain.setTargetAtTime(.008+.012*r.visualGain,audio.ctx.currentTime,.2);audio.oscillators[0].frequency.setTargetAtTime(95+S.settings.frequency*30,audio.ctx.currentTime,.2);}
 if(now-lastReadout>1000&&S.ready){const fps=browser.getCurrentFrameRate?.();$('engine').textContent=Number.isFinite(fps)&&fps>1?fps.toFixed(0)+' fps · X_ITE':'X_ITE · idle';lastReadout=now;}
 }requestAnimationFrame(animate);
}
// A small read-only observation surface supports reproducible browser checks.
Object.defineProperty(window,'GizaHorizon',{value:{get state(){return JSON.parse(JSON.stringify({settings:S.settings,lens:S.lens,seconds:S.seconds,playing:S.playing,ready:S.ready,view:S.view,cameraMode:S.cameraMode,encounterLevel:S.encounterLevel,directed:S.directed,comparison:S.comparison}));},validateSession},writable:false});
syncControls();syncCameraUI();setLens('lab');updateJourney(false);loadEvidence();boot();requestAnimationFrame(animate);
