// SPDX-License-Identifier: GPL-3.0-or-later
/** Optional integration checks of the actual atlas controller with mocked stage.
 * LINKEDOM_PATH=/absolute/node_modules/linkedom/esm/index.js node --test tests/controller.test.mjs
 * This exercises asynchronous controller behavior, not WebGL or native layout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {yearLabel,culminationAltitude} from '../sky-math.mjs';
import {fmt,markDigits,filterClaims,NUMBER_GRADES,DESIGN_GRADES} from '../atlas-math.mjs';

let parseHTML;
try{({parseHTML}=await import(process.env.LINKEDOM_PATH?pathToFileURL(resolve(process.env.LINKEDOM_PATH)).href:'linkedom'));}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const domTest=parseHTML?test:(name,fn)=>test(name,{skip:'Install linkedom@0.18.12 and set LINKEDOM_PATH.'},fn);
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
const controller=await fs.readFile(new URL('../atlas.mjs',import.meta.url),'utf8');
const atlas=JSON.parse(await fs.readFile(new URL('../receipts/atlas.json',import.meta.url)));
const claims=JSON.parse(await fs.readFile(new URL('../receipts/claims-v4.json',import.meta.url)));
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
let counter=0;

async function fixture({failFirst=false}={}){
  const{window,document}=parseHTML(html),calls=[];let attempts=0,flight=null;
  for(const select of document.querySelectorAll('select')){
    if(!select.querySelector('option[selected]'))select.querySelector('option').selected=true;
    if(!select.options)Object.defineProperty(select,'options',{get(){return [...select.querySelectorAll('option')];}});
  }
  for(const input of document.querySelectorAll('input[type=checkbox]'))input.checked=input.hasAttribute('checked');
  document.getElementById('stage').scrollIntoView=()=>{};
  const state={world:'plateau',light:'day',year:-2559,labels:60,faint:true,figures:true,skyData:{}};
  const st={state,skyReady:Promise.resolve({}),instrumentReady:Promise.resolve({}),
    cancelTransition(reason){if(flight){flight.resolve({cancelled:true,reason});flight=null;}},
    setLight(value){state.light=value;},setRig(value){state.rig=value;},setXray(value){state.xray=value;},
    setSky(value){for(const[k,v]of Object.entries(value))if(v!=null)state[k]=v;},home(){this.cancelTransition('home');state.world='plateau';},
    goto(stop){calls.push({kind:'goto',stop});return Promise.resolve({cancelled:false});},
    flyTo(star){state.world='cosmos';calls.push({kind:'fly',star});return new Promise(resolve=>{flight={resolve};});},
    starInfo(){return{alt:45,az:180,distance:736,dec:-15,ra:0};},pause(){},resume(){},dispose(){this.cancelTransition('disposed');}};
  const createStage=async()=>{attempts++;if(failFirst&&attempts===1)throw new Error('temporary WebGL failure');return st;};
  const createInstruments=async()=>({render(){},dispose(){}});
  window.innerWidth=390;
  Object.assign(globalThis,{window,document,location:{search:'?poster=1'},matchMedia:()=>({matches:true}),fetch:async url=>({ok:!url.includes('upgrade-witness'),json:async()=>structuredClone(url.includes('atlas.json')?atlas:claims)})});
  const key=`__gizaControllerFixture${++counter}`;
  globalThis[key]={createStage,createInstruments,yearLabel,culminationAltitude,fmt,markDigits,filterClaims,NUMBER_GRADES,DESIGN_GRADES};
  const body=controller.replace(/^import[^;]+;\s*/gm,'');
  const prefix=`const {createStage,createInstruments,yearLabel,culminationAltitude,fmt,markDigits,filterClaims,NUMBER_GRADES,DESIGN_GRADES}=globalThis[${JSON.stringify(key)}];\n`;
  await import('data:text/javascript;base64,'+Buffer.from(prefix+body).toString('base64'));
  await settle();assert.ok(window.gizaAtlas,'controller booted');
  return{window,document,st,calls,get attempts(){return attempts;},async cleanup(){window.gizaAtlas.stopTour();await settle();delete globalThis[key];}};
}

domTest('rapid proof selection leaves only the latest scene action and caption active',async()=>{
  const f=await fixture();
  try{
    const first=f.window.gizaAtlas.showClaim('v1_pi',{scroll:false}),second=f.window.gizaAtlas.showClaim('khafre_345',{scroll:false});
    await Promise.all([first,second]);
    const expected=atlas.claims.find(c=>c.id==='khafre_345');
    assert.equal(f.calls.filter(c=>c.kind==='goto').at(-1).stop,expected.proof.stop);
    assert.equal(f.document.getElementById('nowtitle').textContent,expected.title);
    assert.equal(f.document.querySelector('.card.active').dataset.id,'khafre_345');
    assert.equal(f.st.state.rig,expected.proof.rig);
  }finally{await f.cleanup();}
});

domTest('stopping an in-flight fly-out prevents its completion caption from overwriting the page',async()=>{
  const f=await fixture();
  try{
    await f.window.gizaAtlas.ensureStage();f.st.state.light='night';
    const action=f.window.gizaAtlas.GO.fly();await settle();
    assert.equal(f.calls.at(-1).kind,'fly');
    assert.equal(f.document.getElementById('nowtitle').textContent,"Flying to Orion's belt");
    f.window.gizaAtlas.stopTour();await action;
    assert.equal(f.document.getElementById('nowtitle').textContent,"Flying to Orion's belt");
    assert.doesNotMatch(f.document.getElementById('nowkicker').textContent,/589/);
  }finally{await f.cleanup();}
});

domTest('a failed stage initialization is retryable while the atlas remains populated',async()=>{
  const f=await fixture({failFirst:true});
  try{
    await assert.rejects(f.window.gizaAtlas.ensureStage(),/temporary WebGL failure/);
    assert.equal(f.document.querySelectorAll('.card').length,atlas.count);
    assert.match(f.document.getElementById('status').textContent,/could not start/);
    assert.equal(await f.window.gizaAtlas.ensureStage(),f.st);
    await settle();assert.equal(f.attempts,2);assert.equal(f.document.getElementById('stage').dataset.state,'live');
  }finally{await f.cleanup();}
});

domTest('a failed tour startup clears its active state and the next attempt can start',async()=>{
  const f=await fixture({failFirst:true});
  try{
    await assert.rejects(f.window.gizaAtlas.playTour(),/temporary WebGL failure/);
    assert.equal(f.document.getElementById('stage').classList.contains('touring'),false);
    assert.match(f.document.getElementById('tourbtn').textContent,/Grand tour/);
    const retry=f.window.gizaAtlas.playTour();await settle();
    assert.equal(f.attempts,2);
    assert.equal(f.document.getElementById('stage').classList.contains('touring'),true);
    f.window.gizaAtlas.stopTour();await retry;
    assert.equal(f.document.getElementById('stage').classList.contains('touring'),false);
  }finally{await f.cleanup();}
});
