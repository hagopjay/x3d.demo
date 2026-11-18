import test from 'node:test';
import assert from 'node:assert/strict';
import {ViewSlots} from '../view-slots.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};};
const flush=()=>Promise.resolve();
function fixture(){const disposed=new Set();return {disposed,slots:new ViewSlots(value=>disposed.add(value))};}

test('same slot signature retains resource and original promise',async()=>{
 const {slots,disposed}=fixture(),resource={id:'camera'},gate=deferred();let creations=0;
 const first=slots.ensure('main','hawara:oblique',async()=>{creations++;await gate.promise;return resource;});
 const second=slots.ensure('main','hawara:oblique',()=>{throw Error('must retain in-flight load');});
 assert.equal(first,second);gate.resolve();assert.equal(await first,resource);
 assert.equal(slots.ensure('main','hawara:oblique',()=>null),first);
 assert.equal(creations,1);assert.deepEqual(slots.values(),[resource]);assert.equal(disposed.size,0);
});

test('cancellation before load completes cannot install its late resource',async()=>{
 const {slots,disposed}=fixture(),gate=deferred(),resource={id:'late'};
 const pending=slots.ensure('feed0','giza:shaft',async current=>{await gate.promise;assert.equal(current(),false);return resource;});
 await flush();slots.release('feed0');gate.resolve();
 assert.equal(await pending,null);assert.deepEqual(slots.values(),[]);assert.ok(disposed.has(resource));
});

test('cancellation during awaited replacement disposes owned renderer immediately',async()=>{
 const {slots,disposed}=fixture(),replacement=deferred(),resource={id:'replacing'};
 const pending=slots.ensure('feed0','giza:shaft',async(current,own)=>{
  own(resource);await replacement.promise;assert.equal(current(),false);return resource;
 });
 await flush();assert.deepEqual(slots.values(),[resource]);
 slots.release('feed0');assert.ok(disposed.has(resource));assert.deepEqual(slots.values(),[]);
 replacement.resolve();assert.equal(await pending,null);assert.deepEqual(slots.values(),[]);
});

test('changed signature supersedes pending load without replacing its successor',async()=>{
 const {slots,disposed}=fixture(),gate=deferred(),old={id:'old'},next={id:'new'};
 const stale=slots.ensure('feed0','giza:shaft',async()=>{await gate.promise;return old;});
 await flush();const fresh=slots.ensure('feed0','hawara:plan',()=>next);
 assert.equal(await fresh,next);gate.resolve();assert.equal(await stale,null);
 assert.deepEqual(slots.values(),[next]);assert.ok(disposed.has(old));assert.equal(disposed.has(next),false);
});

test('shrinking view budget keeps matching views and releases only removed slots',async()=>{
 const {slots,disposed}=fixture(),main={id:'main'},a={id:'feed0'},b={id:'feed1'},c={id:'feed2'};
 await Promise.all([['main',main],['feed0',a],['feed1',b],['feed2',c]].map(([key,value])=>slots.ensure(key,key,()=>value)));
 slots.keep(['main','feed0']);assert.deepEqual(slots.values(),[main,a]);
 assert.deepEqual(disposed,new Set([b,c]));slots.keep([]);assert.equal(slots.slots.size,0);
 assert.deepEqual(disposed,new Set([main,a,b,c]));
});

test('stale rejection cannot delete a current replacement; current rejection allows retry',async()=>{
 const {slots,disposed}=fixture(),gate=deferred(),next={id:'new'},failed={id:'failed-owned'};
 const stale=slots.ensure('feed0','old',()=>gate.promise);const rejection=assert.rejects(stale,/old load failed/);
 await flush();await slots.ensure('feed0','new',()=>next);gate.reject(Error('old load failed'));await rejection;
 assert.deepEqual(slots.values(),[next]);
 await assert.rejects(slots.ensure('feed1','error',(current,own)=>{own(failed);throw Error('current load failed');}),/current load failed/);
 assert.equal(slots.slots.has('feed1'),false);assert.ok(disposed.has(failed));
 const retried={id:'retried'};assert.equal(await slots.ensure('feed1','error',()=>retried),retried);
});
