(function(){'use strict';
const groups={giza:['GizaSky','GizaInline'],pantheon:['PantheonSky','PantheonInline'],materials:['MaterialsSky','MaterialsInline'],drillfield:['DrillfieldSky','DrillfieldInline'],earth:['EarthPlanet','EarthClouds','EarthMoon','VillageInline','VillagersInline']};
const pending=new Map();let store;const latch=new ArrivalLatch();
let immersed=false;function isolate(on){immersed=!!on;if(new URLSearchParams(location.search).get('isolate')==='0')return;for(const b of (gdBoot.buildReceipt?.exterior_branches||[])){const n=gdApi.node(b.name);if(n)n[b.field]=on?false:b.original;}}
function notify(){window.dispatchEvent(new CustomEvent('gobbler-stream',{detail:store.snapshot()}));}
function initialise(){if(store)return;const api=window.gdApi,browser=PX.el.browser,scene=browser.currentScene;
 const adapter={load(id){return new Promise((resolve,reject)=>{const list=groups[id].map(n=>api.node(n));if(list.some(n=>!n))return reject(new Error('Missing Inline in '+id));
  const sensor=scene.createNode('LoadSensor');sensor.timeOut=60;sensor.children=list;scene.addRootNode(sensor);
  let done=false,timer,monitor;function finish(err){if(done)return;done=true;clearTimeout(timer);clearInterval(monitor);sensor.removeFieldCallback('cabinet','isLoaded');scene.removeRootNode(sensor);sensor.getValue().dispose();pending.delete(id);err?reject(err):resolve();}
  pending.set(id,()=>finish(new Error('Load cancelled')));
  sensor.addFieldCallback('cabinet','isLoaded',v=>{if(v)finish();});timer=setTimeout(()=>finish(new Error('World readiness timed out; retry available')),65000);
  list.forEach(n=>{const failed=n.getValue().checkLoadState()===X3D.X3DConstants.FAILED_STATE;n.load=true;if(failed)n.getValue().loadNow().catch(e=>finish(e));});monitor=setInterval(()=>{if(list.some(n=>n.getValue().checkLoadState()===X3D.X3DConstants.FAILED_STATE))finish(new Error('World asset failed to load; retry available'));},100);if(sensor.isLoaded)finish();
 });},unload(id){pending.get(id)?.();for(const name of groups[id]){const n=api.node(name);if(n)n.load=false;}}};
 store=new WorldStore(adapter);window.GobblerStream.store=store;
 setInterval(()=>{store.sweep();notify();},1000);
 // Proximity is an intent hint, not a second writer of Inline.load.
 let lastInside=null;setInterval(()=>{const p=api.cam().pos;if(!p)return;const w=api.worldAt(p);
  if(!latch.observe(w?.id)){lastInside=w?.id||null;return;}
  if(w&&store.active!==w.id&&!store.intent)request(w.id,true).then(()=>{if(store.intent===w.id){store.commit(w.id);isolate(true);latch.cancel();}}).catch(()=>{if(!store.intent)latch.cancel();});
  if(lastInside&&!w&&!store.intent){isolate(false);store.leave();}lastInside=w?.id||null;
 },900);
}
function request(id,active=false){initialise();if(active){latch.begin();}return store.request(id,{active}).finally(notify);}
window.GobblerStream={groups,store:null,request,leave(){isolate(false);if(store)store.leave();},cancel(){if(store)store.intent=null;latch.cancel();},arrive(id){isolate(!!id);latch.arrive(id);if(store){if(id)store.commit(id);else store.leave();}},isolate,isolation(){return immersed&&new URLSearchParams(location.search).get('isolate')!=='0';},snapshot(){return store?.snapshot()||{residents:[],events:[]};},initialise};
})();
