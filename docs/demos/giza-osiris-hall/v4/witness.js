import {hawaraScene,hawaraCamera,HAWARA_LIGHTS,chapters} from './hawara.mjs';
import {ViewSlots} from './view-slots.mjs';
const el=id=>document.getElementById(id);
const state={site:'giza',target:'giza',visor:false,lower:false,depth:-10,ghost:.75,water:true,light:'study',chapter:0,generation:0};
const bar=document.createElement('div');bar.id='witness-bar';bar.className='glass';bar.innerHTML='<button id="witness-site" aria-pressed="false" aria-controls="witness-panel">Hawara · narrative atlas</button><button id="witness-visor" aria-pressed="false" aria-controls="visor">Jordi LaForge vision · V</button>';document.body.append(bar);
const panel=document.createElement('section');panel.id='witness-panel';panel.hidden=true;panel.setAttribute('aria-label','Hawara narrative atlas');panel.innerHTML='<div id="witness-scene"><span id="witness-label">HAWARA / ARTISTIC RECONSTRUCTION</span><button id="hawara-reset" class="main-reset">Reset camera</button></div><article id="witness-text"><span id="witness-tier"></span><h2 id="witness-title" tabindex="-1"></h2><p id="witness-body"></p><p><a id="witness-source" target="_blank" rel="noopener noreferrer">Source / reading trail ↗</a></p><nav><button id="witness-prev" aria-label="Previous chapter">←</button><span id="witness-progress" aria-live="polite"></span><button id="witness-next" aria-label="Next chapter">→</button><button id="witness-return">Return to Giza</button></nav></article>';document.body.append(panel);
const visor=document.createElement('aside');visor.id='visor';visor.hidden=true;visor.setAttribute('aria-label','Jordi LaForge vision instruments');visor.innerHTML=`<header><h2>JORDI LAFORGE VISION</h2><button id="visor-close" aria-label="Close vision">×</button></header><details id="visor-settings" open><summary>Instruments & appearance</summary><p>VISOR-inspired • Geordi La Forge, played by LeVar Burton. X3D model views; no measured scan or thermal signal.</p><label for="visor-target">Study target</label><select id="visor-target"><option value="giza">Giza · schematic published subjects</option><option value="hawara">Hawara · artistic account model</option></select><label><input type="checkbox" id="visor-lower"> Magenta conjectural layout (Hawara)</label><label for="visor-depth">Lower-layout datum: <output id="visor-depth-value">−10 m</output></label><input id="visor-depth" type="range" min="-70" max="-8" value="-10" step="1"><label for="visor-ghost">Shell / floor transparency <output id="visor-ghost-value">0.75</output></label><input id="visor-ghost" type="range" min="0" max="1" step=".05" value=".75"><label><input id="visor-water" type="checkbox" checked> Illustrative water plane (Hawara)</label><label for="hawara-light">Hawara lighting · authored</label><select id="hawara-light"><option value="study">Warm study</option><option value="raking">Raking light · relief</option><option value="night">Cool night study</option></select><p id="visor-light-note"></p><label for="visor-budget">View budget</label><select id="visor-budget"><option value="1">1 view · lighter</option><option value="3" selected>3 views · comparative</option></select></details><span id="visor-loading" role="status" aria-live="polite"></span><button id="visor-retry" hidden>Retry failed views</button><div id="visor-feeds"></div>`;document.body.append(visor);
const asset=path=>new URL(path,import.meta.url);
let cameraPromise;
function cameraData(){return cameraPromise??=fetch(asset('cameras.json')).then(r=>{if(!r.ok)throw Error('Camera data unavailable');return r.json();}).catch(error=>{cameraPromise=null;throw error;});}
const disposed=new WeakSet();

function destroy(record){
 if(!record||disposed.has(record))return;disposed.add(record);record.observer?.disconnect();
 const browser=record.canvas?.browser;let gl;try{gl=browser?.getContext();}catch{}record.container?.remove();
 try{browser?.endUpdate();browser?.dispose();}catch{}
 try{gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
}
const slots=new ViewSlots(destroy);
Object.defineProperties(state,{feeds:{get:()=>slots.values().filter(r=>r.feed&&r.scene).map(r=>r.canvas)},hawara:{get:()=>slots.slots.get('main')?.value?.scene?slots.slots.get('main').value.canvas:null}});
function chapter(){
 const c=chapters[state.chapter];el('witness-tier').textContent=c.year+' / '+c.tier;el('witness-title').textContent=c.title;el('witness-body').textContent=c.body;el('witness-source').href=c.url;el('witness-progress').textContent=`${state.chapter+1} / ${chapters.length}`;el('witness-prev').disabled=state.chapter===0;el('witness-next').disabled=state.chapter===chapters.length-1;
}
function reset(record){
 if(!record?.scene)return;
 try{const vp=record.scene.getNamedNode(record.site==='hawara'?'H_Camera':record.view);vp.set_bind=true;const node=vp.getValue();node.transitionStop();node.resetUserOffsets();node.setFieldOfViewScale(1);node.update();}catch{}
}
function appearance(record){
 if(!record?.scene)return;const scene=record.scene;
 if(record.site==='hawara'){
  scene.getNamedNode('H_Shell').transparency=state.ghost;scene.getNamedNode('H_Floor').transparency=state.lower?state.ghost:0;
  scene.getNamedNode('H_Ground').transparency=state.lower?.95:.25;
  scene.getNamedNode('H_LowerSwitch').whichChoice=state.lower?0:-1;scene.getNamedNode('H_LowerRig').translation=new X3D.SFVec3f(0,state.depth,0);
  scene.getNamedNode('WATER').whichChoice=state.water?0:-1;
  const l=HAWARA_LIGHTS[state.light],key=scene.getNamedNode('H_Key'),fill=scene.getNamedNode('H_Fill');
  key.color=new X3D.SFColor(...l.key);key.direction=new X3D.SFVec3f(...l.direction);key.intensity=l.intensity;
  fill.color=new X3D.SFColor(...l.fill);fill.intensity=l.fillIntensity;scene.getNamedNode('H_BG').skyColor=Float32Array.from(l.background);
 }else{
  const main=window.__giza?.state;
  for(const n of ['khufu','khafre','menkaure'])scene.getNamedNode('M_'+n).transparency=state.ghost;
  if(main?.displayColors)for(const [name,colors] of Object.entries(main.displayColors))scene.getNamedNode('K_'+name).color=colors;
  record.canvas.setAttribute('exposure',String(main?.exposure??1));
  record.canvas.setAttribute('contentScale',main?.quality==='ultra'?'1':main?.quality==='performance'?'.5':'.75');
 }
}
function pauseInvisible(){
 const narrow=matchMedia('(max-width:700px)').matches;
 for(const r of slots.values())try{
  const visible=!document.hidden&&(r.feed?state.visor:state.site==='hawara'&&!(narrow&&state.visor));
  if(r.visible!==visible){r.canvas.browser?.[visible?'beginUpdate':'endUpdate']();r.visible=visible;}
 }catch{}
 const main=el('cv')?.browser,mainPaused=document.hidden||state.site==='hawara';
 if(window.__giza?.state.ready&&main&&pauseInvisible.mainPaused!==mainPaused){try{main[mainPaused?'endUpdate':'beginUpdate']();pauseInvisible.mainPaused=mainPaused;}catch{}}
}
async function mount(key,spec,current,own){
 const container=document.createElement('div');container.className=spec.feed?'visor-feed':'hawara-viewport';
 const canvas=document.createElement('x3d-canvas');canvas.setAttribute('splashScreen','false');canvas.setAttribute('contextMenu','false');canvas.setAttribute('contentScale','.75');canvas.setAttribute('aria-label',spec.title);canvas.setAttribute('role','img');
 container.append(canvas);el(spec.feed?'visor-feeds':'witness-scene').append(container);
 const record={...spec,key,canvas,container,scene:null};own(record);
 try{
  await X3D();if(!current())return record;
  const browser=canvas.browser;if(!browser?.getContext?.())throw Error('WebGL unavailable');
  const data=await cameraData();if(!current())return record;
  const bounds=container.getBoundingClientRect(),aspect=Math.max(.01,bounds.width/Math.max(1,bounds.height));
  const scene=spec.site==='hawara'?await browser.createX3DFromString(hawaraScene({...state,view:spec.view,aspect})):await browser.createX3DFromURL(new X3D.MFString(new URL('../v3/giza-atlas-v3.x3d',import.meta.url).href));
  if(!current()){scene?.dispose?.();return record;}
  // Configure before binding, so hidden evidence labels never flash on screen.
  if(spec.site==='giza'){
   for(const id of ['SW_SPE','SW_SKY','SW_CONST','SW_ORION','SW_GAZE',...data.labels])scene.getNamedNode(id).whichChoice=-1;
   for(const id of data.timers)scene.getNamedNode(id).enabled=false;
   scene.getNamedNode('M_ground').transparency=1;
   scene.getNamedNode('FOG').visibilityRange=0;
   scene.getNamedNode('BG').skyAngle=new X3D.MFFloat();scene.getNamedNode('BG').skyColor=Float32Array.from([.012,.025,.04]);
   const nav=scene.getNamedNode('NAV');nav.transitionType=new X3D.MFString('TELEPORT');
   if(spec.view==='V_Section'){const clip=scene.getNamedNode('CLIP_SECTION');clip.plane=new X3D.SFVec4f(0,0,-1,-28);clip.enabled=true;}
  }
  await browser.replaceWorld(scene);if(!current())return record;
  record.scene=scene;appearance(record);
  if(spec.site==='giza')scene.getNamedNode(spec.view).set_bind=true;
  if(spec.site==='hawara'){
   record.observer=new ResizeObserver(()=>{
    if(disposed.has(record)||spec.view==='oblique')return;
    const b=container.getBoundingClientRect();if(b.width>0&&b.height>0)scene.getNamedNode('H_Camera').fieldOfView=new X3D.MFFloat(...hawaraCamera(spec.view,b.width/b.height).fov);
   });record.observer.observe(container);
  }
  if(spec.feed){const title=document.createElement('span');title.className='feed-title';title.textContent=spec.title;const button=document.createElement('button');button.className='feed-reset';button.textContent='Reset';button.setAttribute('aria-label','Reset '+spec.title);button.onclick=()=>reset(record);container.append(title,button);}
  pauseInvisible();return record;
 }catch(error){
  if(current()){
   const p=document.createElement('p');p.className='visor-error';p.textContent='3D unavailable. '+error.message;container.append(p);record.error=error.message;
  }return record;
 }
}
function controls(){
 const hawara=state.site==='hawara'||state.target==='hawara';
 el('visor-lower').disabled=!hawara;el('visor-depth').disabled=!hawara||!state.lower;el('visor-water').disabled=!hawara;el('hawara-light').disabled=!hawara;
 el('visor-light-note').textContent=state.target==='giza'?'Giza views follow the main baked light, exposure and render resolution.':'Hawara lighting is an authored study, independent of the Giza bake.';
 el('witness-label').textContent='HAWARA / ARTISTIC MODEL / ILLUSTRATIVE DIMENSIONS'+(state.lower?' / MAGENTA: CONJECTURE':' / LOWER LAYOUT OFF');
}
async function reconcile(){
 const generation=++state.generation,keys=[];controls();const work=[];
 if(state.site==='hawara'){keys.push('main');work.push(slots.ensure('main','hawara:oblique',(current,own)=>mount('main',{site:'hawara',view:'oblique',feed:false,title:'Hawara artistic model · oblique'},current,own)));}
 if(state.visor){
  const specs=state.target==='hawara'?[
   ['plan','01 / PLAN · invented arrangement'],['section','02 / SECTION · illustrative water'],['oblique','03 / OBLIQUE · optional conjecture']
  ]:[['V_Osiris','01 / OSIRIS · schematic shaft'],['V_Khufu','02 / KHUFU · internal model'],['V_Section','03 / OSIRIS SECTION · model datum']];
  for(const [i,[view,title]] of specs.slice(0,+el('visor-budget').value).entries()){
   const key='feed'+i;keys.push(key);work.push(slots.ensure(key,state.target+':'+view,(current,own)=>mount(key,{site:state.target,view,feed:true,title},current,own)));
  }
 }
 slots.keep(keys);pauseInvisible();el('visor-loading').textContent=state.visor?'Loading model views…':'';
 // Slots are created independently, but scene loads are serialized by queueMount below.
 await Promise.allSettled(work);if(generation!==state.generation)return;
 const feeds=slots.values().filter(r=>r.feed),loaded=feeds.filter(r=>r.scene).length,expected=+el('visor-budget').value;
 el('visor-loading').textContent=state.visor?`${loaded}/${expected} model views ready · drag independently`:'';
 el('visor-retry').hidden=!state.visor||loaded===expected;
 pauseInvisible();
}
// Serialize expensive scene loads while preserving in-flight cancellation checks.
const mountNow=mount;let loadQueue=Promise.resolve();mount=(...args)=>{
 const promise=loadQueue.then(()=>args[2]()?mountNow(...args):null);loadQueue=promise.catch(()=>{});return promise;
};
function update(){controls();for(const r of slots.values())appearance(r);}
function site(hawara){
 if(hawara&&window.__giza?.state.tourOn)el('tour').click();
 state.site=hawara?'hawara':'giza';state.target=state.site;el('visor-target').value=state.target;panel.hidden=!hawara;document.body.classList.toggle('hawara-open',hawara);el('witness-site').setAttribute('aria-pressed',String(hawara));chapter();reconcile();
 if(hawara)el('witness-title').focus();else el('witness-site').focus();
}
function vision(on){
 state.visor=on;visor.hidden=!on;document.body.classList.toggle('visor-open',on);el('witness-visor').setAttribute('aria-pressed',String(on));reconcile();
 if(on)el('visor-close').focus();else el('witness-visor').focus();
}
el('witness-site').onclick=()=>site(state.site!=='hawara');el('witness-return').onclick=()=>site(false);el('witness-visor').onclick=()=>vision(!state.visor);el('visor-close').onclick=()=>vision(false);
el('witness-prev').onclick=()=>{state.chapter=Math.max(0,state.chapter-1);chapter();};el('witness-next').onclick=()=>{state.chapter=Math.min(chapters.length-1,state.chapter+1);chapter();};
el('hawara-reset').onclick=()=>reset(slots.slots.get('main')?.value);
el('visor-lower').onchange=e=>{state.lower=e.target.checked;update();};el('visor-water').onchange=e=>{state.water=e.target.checked;update();};el('hawara-light').onchange=e=>{state.light=e.target.value;update();};
el('visor-target').onchange=e=>{state.target=e.target.value;reconcile();};el('visor-budget').onchange=reconcile;
el('visor-retry').onclick=()=>{for(const [key,slot] of slots.slots)if(slot.value?.error)slots.release(key);reconcile();};
for(const [id,key] of [['visor-depth','depth'],['visor-ghost','ghost']])el(id).oninput=e=>{state[key]=+e.target.value;el(id+'-value').textContent=key==='depth'?state[key]+' m':state[key].toFixed(2);update();};
addEventListener('giza:appearance',()=>{for(const r of slots.values())if(r.site==='giza')appearance(r);pauseInvisible();});
addEventListener('keydown',e=>{
 if(el('modal').classList.contains('on')||el('report-dialog').open)return;
 if(e.key==='Escape'&&state.visor){e.preventDefault();e.stopImmediatePropagation();vision(false);return;}
 if(e.key==='Escape'&&state.site==='hawara'){e.preventDefault();e.stopImmediatePropagation();site(false);return;}
 if((state.site==='hawara'||e.target.closest('#visor'))&&/^[ftc1-4]$/i.test(e.key)){e.stopImmediatePropagation();return;}
 if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a'))return;
 if(e.key.toLowerCase()==='v'){e.preventDefault();e.stopImmediatePropagation();vision(!state.visor);}
 else if(state.site==='hawara'||e.target.closest('#visor'))e.stopImmediatePropagation();
},true);
addEventListener('visibilitychange',pauseInvisible);addEventListener('resize',pauseInvisible);
if(matchMedia('(max-width:700px)').matches){el('visor-budget').value='1';el('visor-settings').open=false;}
function capture(){return {revision:'4.1',site:state.site,target:state.target,visor:state.visor,chapter:state.chapter,lower:state.lower,depth:state.depth,ghost:state.ghost,water:state.water,lighting:state.light,viewBudget:+el('visor-budget').value,views:slots.values().filter(r=>r.scene).map(r=>{const vp=r.canvas.browser.getActiveViewpoint();return {slot:r.key,site:r.site,view:r.view,cameraSpaceMatrix:Array.from(vp.getCameraSpaceMatrix()),fieldOfView:typeof vp.getUserFieldOfView()==='number'?vp.getUserFieldOfView():Array.from(vp.getUserFieldOfView())};})};}
window.__witness={state,site,vision,chapters,rebuild:reconcile,slots,capture};chapter();controls();
