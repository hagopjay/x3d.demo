// Dispose callbacks must be idempotent: cancellation can race a completed load.
// Own asynchronous views by slot. A stale load never becomes an active view.
export class ViewSlots {
 constructor(dispose){this.slots=new Map();this.dispose=dispose;}
 ensure(key,signature,create){
  const existing=this.slots.get(key);if(existing?.signature===signature)return existing.promise;
  this.release(key);const slot={signature,value:null};this.slots.set(key,slot);
  const current=()=>this.slots.get(key)===slot;
  slot.promise=Promise.resolve().then(()=>create(current,value=>{slot.value=value;if(!current())this.dispose(value);})).then(value=>{
   if(!current()){if(value)this.dispose(value);return null;}
   slot.value=value;return value;
  }).catch(error=>{if(current()){this.slots.delete(key);if(slot.value)this.dispose(slot.value);}throw error;});return slot.promise;
 }
 release(key){const slot=this.slots.get(key);if(!slot)return;this.slots.delete(key);if(slot.value)this.dispose(slot.value);}
 keep(keys){for(const key of this.slots.keys())if(!keys.includes(key))this.release(key);}
 values(){return [...this.slots.values()].map(s=>s.value).filter(Boolean);}
}
