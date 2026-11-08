/* Pure, clock-injected residency controller. Load readiness comes from adapter witnesses. */
(function(root){'use strict';
class WorldStore {
 constructor(adapter,{budget=2,grace=15000,now=()=>performance.now()}={}) {this.adapter=adapter;this.budget=budget;this.grace=grace;this.now=now;this.entries=new Map();this.active=null;this.intent=null;this.events=[];}
 emit(type,id,detail){this.events.push({t:this.now(),type,id,detail});if(this.events.length>300)this.events.shift();}
 entry(id){if(!this.entries.has(id))this.entries.set(id,{id,state:'unloaded',epoch:0,used:0,protectedUntil:0,error:null});return this.entries.get(id);}
 request(id,{active=false}={}) {
  const e=this.entry(id);e.used=this.now();e.protectedUntil=e.used+this.grace;if(active)this.intent=id;
  if(e.state==='ready')return Promise.resolve(e);if(e.state==='loading')return e.promise;
  this.makeRoom(id);e.epoch++;const epoch=e.epoch;e.state='loading';e.error=null;this.emit('load',id);
  e.promise=Promise.resolve().then(()=>this.adapter.load(id,epoch)).then(()=>{
   if(e.epoch!==epoch||e.state!=='loading')throw new Error('Cancelled stale load: '+id);
   e.state='ready';this.emit('ready',id);return e;
  }).catch(err=>{if(e.epoch===epoch){if(this.intent===id)this.intent=null;this.adapter.unload(id);e.state='failed';e.error=String(err.message||err);this.emit('failure',id,e.error);}throw err;});return e.promise;
 }
 makeRoom(id){let residents=[...this.entries.values()].filter(e=>['loading','ready'].includes(e.state)&&e.id!==id);
  while(residents.length>=this.budget){const candidates=residents.filter(e=>e.id!==this.active&&e.id!==this.intent).sort((a,b)=>a.used-b.used);if(!candidates.length)throw new Error('Residency budget is pinned');const victim=candidates[0];this.unload(victim.id,'budget');residents=residents.filter(e=>e!==victim);}}
 unload(id,reason='departure'){const e=this.entry(id);e.epoch++;this.adapter.unload(id);e.state='unloaded';e.error=null;this.emit('unload',id,reason);}
 commit(id){if(this.intent===id||!this.intent){const now=this.now();if(this.active)this.entry(this.active).protectedUntil=now+this.grace;const e=this.entry(id);e.used=now;e.protectedUntil=now+this.grace;this.active=id;this.intent=null;this.emit('commit',id);}}
 leave(){if(this.active)this.entry(this.active).protectedUntil=this.now()+this.grace;this.active=null;this.intent=null;}
 sweep(){for(const e of this.entries.values())if(e.id!==this.active&&e.id!==this.intent&&e.state==='ready'&&this.now()>e.protectedUntil)this.unload(e.id,'grace expired');}
 snapshot(){return {budget:this.budget,active:this.active,intent:this.intent,resident_groups:[...this.entries.values()].filter(e=>['ready','loading'].includes(e.state)).length,residents:[...this.entries.values()].map(({id,state,epoch,error})=>({id,state,epoch,error})),events:this.events.slice()};}
}
class ArrivalLatch {
 constructor(){this.waiting=false;this.expected=null;}
 begin(){this.waiting=true;this.expected=null;}
 arrive(id){this.waiting=true;this.expected=id||'';}
 cancel(){this.waiting=false;this.expected=null;}
 observe(id){if(!this.waiting)return true;if(this.expected!==null&&(id||'')===this.expected)this.cancel();return false;}
}
root.ArrivalLatch=ArrivalLatch;root.WorldStore=WorldStore;if(typeof module!=='undefined')module.exports={WorldStore,ArrivalLatch};
})(typeof window==='undefined'?globalThis:window);
