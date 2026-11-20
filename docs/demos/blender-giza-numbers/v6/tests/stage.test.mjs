// SPDX-License-Identifier: GPL-3.0-or-later
// These tests execute the real stage with mocked SAI fields; no WebGL pixels are claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStage} from '../stage.mjs';
import {withTimeout,readJSON,createTransitionSlot,mapHaloCopies,advanceCatalogue,constellationPoints,labelFits,reserveLabel} from '../stage-lifecycle.mjs';

test('displaced transitions settle, cancellation is idempotent and completion is distinct',async()=>{
  const changes=[],slot=createTransitionSlot(v=>changes.push(v));
  const first=slot.start({id:1}),second=slot.start({id:2});
  assert.deepEqual(await first,{cancelled:true,reason:'superseded'});
  assert.equal(slot.active.id,2);slot.cancel('user');
  assert.deepEqual(await second,{cancelled:true,reason:'user'});assert.equal(slot.cancel(),false);
  const third=slot.start({id:3});slot.complete();assert.deepEqual(await third,{cancelled:false});
  assert.equal(changes.at(-1),null);
});

test('resource errors distinguish HTTP failure, timeout and successful JSON',async()=>{
  await assert.rejects(readJSON('missing.json',{fetcher:async()=>({ok:false,status:404})}),/HTTP 404/);
  await assert.rejects(withTimeout(new Promise(()=>{}),8,'bounded resource'),/bounded resource/);
  assert.deepEqual(await readJSON('data.json',{fetcher:async()=>({ok:true,json:async()=>({answer:42})})}),{answer:42});
});

test('halos map only to unique exact catalogue copies, never nearest guesses',()=>{
  assert.deepEqual(mapHaloCopies([[1,2,3],[4,5,6]],[[4,5,6],[1,2,3]]),[1,0]);
  assert.throws(()=>mapHaloCopies([[1,2,3]],[[1,2,3.00001]]),/unique exact/);
  assert.throws(()=>mapHaloCopies([[1,2,3],[1,2,3]],[[1,2,3]]),/unique exact/);
});

test('all 179 shipped halo positions have an unambiguous exact core identity',()=>{
  const root=new URL('../../v4/assets/',import.meta.url),sky=JSON.parse(fs.readFileSync(new URL('sky-data.json',root)));
  const xml=fs.readFileSync(new URL('sky.x3d',root),'utf8');
  const values=xml.match(/DEF='StarsBright'[^>]*?positions='([^']*)'/)[1].trim().split(/\s+/).map(Number);
  const points=Array.from({length:values.length/3},(_,i)=>values.slice(3*i,3*i+3));
  const mapping=mapHaloCopies(points.slice(0,sky.bright),points.slice(sky.bright));
  assert.equal(mapping.length,179);assert.equal(new Set(mapping).size,179);
});

test('space motion uses immutable baselines, including steps smaller than 25 years',()=>{
  const baseline=new Float64Array([1,2,3,4,5,6]),movers=[{i:0,v:[.1,.2,.3]}];
  const a=advanceCatalogue(baseline,movers,2001),b=advanceCatalogue(baseline,movers,2002);
  assert.deepEqual(Array.from(a),[1.1,2.2,3.3,4,5,6]);assert.deepEqual(Array.from(b),[1.2,2.4,3.6,4,5,6]);
  assert.deepEqual(Array.from(baseline),[1,2,3,4,5,6]);
  assert.deepEqual(constellationPoints(a,[[1,0,'test']]),[[4,5,6],[1.1,2.2,3.3]]);
  assert.throws(()=>advanceCatalogue(baseline,movers,NaN),/finite/);
});

test('label bounds account for text width, vertical extent and padding',()=>{
  assert.equal(labelFits(10,20,120,14,390,600),true);
  assert.equal(labelFits(-2,20,120,14,390,600),false);
  assert.equal(labelFits(300,20,120,14,390,600),false);
  assert.equal(labelFits(10,2,120,14,390,600),false);
});

test('labels crossing a grid-row boundary cannot overlap or partially reserve a failed placement',()=>{
  const taken=new Set();
  assert.equal(reserveLabel(taken,10,17,90,14),true);
  const before=[...taken];
  assert.equal(reserveLabel(taken,80,19,90,14),false);
  assert.deepEqual([...taken],before);
  assert.equal(reserveLabel(taken,200,19,90,14),true);
  assert.equal(reserveLabel(taken,10,65,90,14),true);
});

const stageData=JSON.parse(fs.readFileSync(new URL('../../v4/assets/stage-data.json',import.meta.url)));
const celData=JSON.parse(fs.readFileSync(new URL('../assets/celestial-data.json',import.meta.url)));
async function fixture({reduced=false,failSky=false}={}){
  class Vector {constructor(x,y,z){Object.assign(this,{x,y,z});}}
  class Rotation {constructor(x,y,z,angle){Object.assign(this,{x,y,z,angle});}}
  class Multi extends Array {constructor(...args){super(...args);}}
  const points=[[10,20,-30],[30,5,-10]],bright={positions:[new Vector(...points[0]),new Vector(...points[0])]},faint={positions:[new Vector(...points[1])]},coord={point:[]};
  const skyData={stars:2,bright:1,faint:1,halos:1,movers:[{i:0,v:[.01,.02,.03]}],labels:[{n:'Alnitak',i:0,t:1,m:1},{n:'Sirius',i:1,t:1,m:2}],key:{Alnitak:0,Sirius:1},lines:[[0,1,'test']],precession:{n:2,y0:-13000,step:16000,q:[0,0,0,1,0,0,0,1]}};
  const skyNodes=new Map(Object.entries({StarsBright:bright,StarsFaint:faint,Figures:{geometry:{coord}},StarLabels:{value:[{value:['Alnitak','Sirius']}]},SkyRot:{},SunGlow:{},MoonGlow:{}}));
  const sky={getNamedNode:n=>{assert.ok(skyNodes.has(n),n);return skyNodes.get(n);},rootNodes:[{}]};
  const instrumentNames=['SliceTransform','SliceFillMaterial','SliceLabelTransform','SliceText','ExperimentEnvelope','InstrumentSection','InstrumentGeometry','InstrumentSurvey','InstrumentHarmonics'];
  const instrumentNodes=new Map(instrumentNames.map(n=>[n,{}])),instruments={getNamedNode:n=>{assert.ok(instrumentNodes.has(n),n);return instrumentNodes.get(n);},rootNodes:[{}]};
  const celNodes=new Map(),celestial={getNamedNode:n=>{if(!celNodes.has(n))celNodes.set(n,{});return celNodes.get(n);},rootNodes:[{}]};
  const callbacks=new Map(),where={position_changed:new Vector(0,0,10),orientation_changed:new Rotation(0,1,0,0),addFieldCallback:(key,field,fn)=>callbacks.set(key,fn),removeFieldCallback:key=>callbacks.delete(key)};
  const nodeNames=['Where','SkyEye','Eye_A','Eye_B','Light','SkyNight','SkyDay','HazeNight','HazeDay','Proof','Mat_Khufu_Day','Mat_Khufu_Night','World','SkyRoot','Plateau'];
  const nodes=new Map(nodeNames.map(n=>[n,{}]));nodes.set('Where',where);nodes.get('Plateau').children=[{original:true}];
  for(const name of ['Eye_A','Eye_B']){const eye=nodes.get(name);Object.defineProperty(eye,'set_bind',{set(on){if(on){where.position_changed=eye.position;where.orientation_changed=eye.orientation;callbacks.forEach(fn=>fn());}}});}
  const scene={getNamedNode:n=>{assert.ok(nodes.has(n),n);return nodes.get(n);}},frames=new Map();let next=1;
  const browser={currentScene:scene,loadURL:async()=>{},createX3DFromURL:async urls=>{if(urls[0].endsWith('sky.x3d')){if(failSky)throw new Error('sky unavailable');return sky;}if(urls[0].endsWith('celestial.x3d'))return celestial;return instruments;}};
  const runtime=async()=>{};Object.assign(runtime,{getBrowser:()=>browser,SFVec3f:Vector,SFRotation:Rotation,MFString:Multi,MFVec3f:Multi,MFNode:Multi});
  const docListeners=new Map(),canvasListeners=new Map(),attributes={};
  globalThis.window={X3D:runtime,matchMedia:()=>({matches:reduced}),devicePixelRatio:1};
  globalThis.document={hidden:false,addEventListener:(name,fn)=>docListeners.set(name,fn),removeEventListener:name=>docListeners.delete(name)};
  globalThis.customElements={whenDefined:async()=>{}};globalThis.requestAnimationFrame=fn=>{const id=next++;frames.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.fetch=async url=>({ok:true,json:async()=>structuredClone(url.endsWith('stage-data.json')?stageData:url.endsWith('celestial-data.json')?celData:skyData)});
  const canvas={addEventListener:(name,fn)=>canvasListeners.set(name,fn),removeEventListener:name=>canvasListeners.delete(name),setAttribute:(name,value)=>attributes[name]=value,getBoundingClientRect:()=>({width:800,height:600})};
  const ctx=new Proxy({measureText:text=>({width:text.length*7})},{get:(obj,key)=>obj[key]??(()=>{})});const overlay={width:800,height:600,getContext:()=>ctx};
  const stage=await createStage({canvas,overlay});await stage.instrumentReady;if(!failSky)await stage.skyReady;
  return{stage,nodes,instrumentNodes,skyNodes,celNodes,frames,canvasListeners,attributes,docListeners,advance(ms=performance.now()+100000){const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(ms));}};
}

test('stage updates core, halo, line endpoints and readouts at the same requested year',async()=>{
  const f=await fixture(),st=f.stage;
  try{
    st.setSky({year:2001,culminate:'Alnitak'});
    assert.equal(st.state.renderedYear,2001);
    const core=f.skyNodes.get('StarsBright').positions[0],halo=f.skyNodes.get('StarsBright').positions[1],line=f.skyNodes.get('Figures').geometry.coord.point[0];
    assert.deepEqual(core,halo);assert.deepEqual(core,line);assert.deepEqual(st.starVector('Alnitak'),[10.01,20.02,-29.97]);
    st.setSky({year:2002});assert.equal(st.state.renderedYear,2002);assert.deepEqual(st.starVector('Alnitak',2000),[10,20,-30]);
    assert.equal(st.starVector('unlisted'),null);
  }finally{st.dispose();}
});

test('stage camera replacement, pointer cancellation and reduced motion settle all callers',async()=>{
  const f=await fixture(),st=f.stage;
  try{
    const a=st.goto('hero',{seconds:20}),b=st.goto('belt',{seconds:20});assert.equal((await a).cancelled,true);
    f.canvasListeners.get('pointerdown')();assert.equal((await b).cancelled,true);
    const c=st.flyTo('Alnitak',{seconds:20});st.home();assert.equal((await c).cancelled,true);
    assert.equal(st.state.world,'plateau');
  }finally{st.dispose();}
  const g=await fixture({reduced:true});try{assert.deepEqual(await g.stage.goto('belt',{seconds:99}),{cancelled:false});assert.equal(g.stage.state.tween,null);assert.deepEqual(await g.stage.flyTo('Alnitak',{seconds:99}),{cancelled:false});}finally{g.stage.dispose();}
});

test('analytical overlays preserve baked plateau and set coherent slice and ghost transforms',async()=>{
  const f=await fixture(),st=f.stage;
  try{
    st.setInstrument('section',true);st.setSlice(.5);st.setModel(240,52);st.setInstrumentOpacity(.25);
    assert.equal(f.nodes.get('Plateau').children[0].original,true);assert.equal(f.instrumentNodes.get('InstrumentSection').whichChoice,0);
    const slice=f.instrumentNodes.get('SliceTransform');assert.equal(slice.translation.y,stageData.pyramids.Khufu.h/2);assert.equal(slice.scale.x,stageData.pyramids.Khufu.a/2);
    assert.equal(f.instrumentNodes.get('SliceFillMaterial').transparency,.75);assert.ok(f.instrumentNodes.get('ExperimentEnvelope').scale.y>1);
    assert.throws(()=>st.setModel(0,52),/positive base/);assert.throws(()=>st.setInstrument('unknown',true),/Unknown instrument/);
  }finally{st.dispose();}
});

test('stage idles on sensor callbacks, pause freezes updates and disposal settles active motion',async()=>{
  const f=await fixture(),st=f.stage;
  f.advance();f.advance();assert.equal(f.frames.size,0);
  const moving=st.goto('hero',{seconds:99});st.pause();assert.equal(f.frames.size,0);assert.equal(f.attributes.update,'false');
  st.resume();assert.ok(f.frames.size>0);assert.equal(f.attributes.update,'true');st.dispose();
  assert.equal((await moving).reason,'disposed');assert.equal(f.frames.size,0);assert.equal(f.docListeners.size,0);assert.equal(f.canvasListeners.size,0);
});

test('a rejected sky load remains an explicit independent error with a working plateau',async()=>{
  const f=await fixture({failSky:true});try{await assert.rejects(f.stage.skyReady,/sky unavailable/);assert.match(f.stage.state.skyError,/sky unavailable/);assert.deepEqual(await f.stage.goto('hero',{seconds:0}),{cancelled:false});}finally{f.stage.dispose();}
});

test('a camera tween started during an offscreen pause resumes at its start rather than extrapolating',async t=>{
  let clock=0;t.mock.method(performance,'now',()=>clock);
  const f=await fixture(),st=f.stage;
  try{
    st.pause();clock=1000;
    const action=st.goto({pos:[100,100,100],at:[0,0,0]},{seconds:2});
    const start=st.state.tween.p0.slice(),end=st.state.tween.p1.slice();
    clock=2000;st.resume();
    assert.equal(st.state.tween.t0,2000);
    // A slightly earlier RAF timestamp is harmless as well: progress clamps at0.
    f.advance(1990);
    const atStart=f.nodes.get('Eye_A').position;
    assert.deepEqual([atStart.x,atStart.y,atStart.z],start);
    clock=2500;f.advance(clock);
    const p=f.nodes.get('Eye_A').position;
    for(const [axis,value]of [p.x,p.y,p.z].entries())assert.ok(value>=Math.min(start[axis],end[axis])&&value<=Math.max(start[axis],end[axis]));
    st.cancelTransition('test complete');assert.equal((await action).cancelled,true);
  }finally{st.dispose();}
});

// ---- v6: the sky machine in the stage ----
async function machineFixture(options){
  const f=await fixture(options);await f.stage.celestialReady;return f;
}
test('v6 sky frames switch one by one, hide in the cosmos and come back on the plateau',async()=>{
  const f=await machineFixture(),st=f.stage,which=n=>f.celNodes.get(n).whichChoice;
  try{
    st.setMachine({equator:true});
    assert.equal(which('CelEquator'),0);assert.equal(which('CelLocal'),-1);assert.equal(which('CelEcliptic'),-1);assert.equal(which('CelPoleTrail'),-1);
    st.setMachine({local:true,ecliptic:true,trail:true});
    assert.deepEqual(['CelLocal','CelEquator','CelEcliptic','CelPoleTrail'].map(which),[0,0,0,0]);
    assert.deepEqual(st.state.machine,{local:true,equator:true,ecliptic:true,trail:true});
    st.setMachine({equator:false});assert.equal(which('CelEquator'),-1);assert.equal(which('CelLocal'),0);
    st.setMachine({bogus:true});assert.equal('bogus' in st.state.machine,false);
  }finally{st.dispose();}
});

test('v6 angular ruler measures between catalogue directions and vanishes without two stars',async()=>{
  const f=await machineFixture(),st=f.stage;
  try{
    const r=st.setRuler('Alnitak','Sirius');
    const a=st.starVector('Alnitak'),b=st.starVector('Sirius');
    const want=Math.acos((a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(Math.hypot(...a)*Math.hypot(...b)))*180/Math.PI;
    assert.ok(Math.abs(r.sep-want)<1e-9);assert.equal(f.celNodes.get('CelRuler').whichChoice,0);
    assert.equal(st.setRuler('Alnitak','Alnitak'),null);assert.equal(f.celNodes.get('CelRuler').whichChoice,-1);
    assert.equal(st.setRuler(null),null);
    assert.equal(st.setRuler('Alnitak','unlisted').sep,null);
  }finally{st.dispose();}
});

test('v6 a pose bound while the stage is off screen is bound again when it returns, with update "true"',async()=>{
  const f=await machineFixture(),st=f.stage;
  try{
    st.pause();assert.equal(f.attributes.update,'false');
    await st.goto('belt',{seconds:0});
    const want=stageData.stops.belt.pos;
    st.resume();assert.equal(f.attributes.update,'true');
    const bound=[f.nodes.get('Eye_A'),f.nodes.get('Eye_B')].filter(e=>e.position&&e.position.x===want[0]&&e.position.z===want[2]);
    assert.equal(bound.length,2,'the pose was bound on both viewpoints: once off screen, once on return');
    assert.deepEqual(st.state.camPos,want);
  }finally{st.dispose();}
});

test('v6 a long exposure under reduced motion is drawn at once and leaves the hour where ten hours put it',async()=>{
  const f=await machineFixture({reduced:true}),st=f.stage;
  try{
    st.setSky({year:-2559,lst:1});
    const done=await st.exposure({hours:10,seconds:30});
    assert.deepEqual(done,{cancelled:false});assert.equal(st.state.exposing,false);
    assert.ok(Math.abs(st.state.lst-(1+10*15.0410686*Math.PI/180))<1e-9);
  }finally{st.dispose();}
});
