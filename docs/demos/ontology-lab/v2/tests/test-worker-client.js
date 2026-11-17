'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(behaviour,timeoutMs=30){
 const workers=[];
 class MockWorker{constructor(url){this.url=url;this.terminated=false;workers.push(this);}postMessage(message){behaviour(this,message);}terminate(){this.terminated=true;}}
 const scope={Worker:MockWorker,setTimeout,clearTimeout};scope.globalThis=scope;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../worker-client.js'),'utf8'),scope);
 return {client:new scope.TwinWorkerClient({url:'fixture.js',timeoutMs}),workers};
}
function answer(w,m,result){queueMicrotask(()=>w.onmessage({data:{id:m.id,ok:true,result}}));}
test('client initialises before work and reuses the initialised worker',async()=>{const calls=[];const {client,workers}=fixture((w,m)=>{calls.push(m.op);answer(w,m,m.op);});assert.equal(await client.call('run',{}),'run');assert.equal(await client.call('warm'),'warm');assert.deepEqual(calls,['init','run','warm']);assert.equal(workers.length,1);client.dispose();});
test('a hard deadline terminates the busy worker and the next request creates a fresh one',async()=>{let rejectRun=true;const {client,workers}=fixture((w,m)=>{if(m.op==='init'||!rejectRun)answer(w,m,m.op);});await assert.rejects(client.call('run'),/exceeded/);assert.equal(workers[0].terminated,true);assert.equal(client.pending.size,0);rejectRun=false;assert.equal(await client.call('run'),'run');assert.equal(workers.length,2);client.dispose();});
test('cancel rejects pending computation without a successful result',async()=>{let signal;const sent=new Promise(r=>signal=r);const {client,workers}=fixture((w,m)=>{if(m.op==='init')answer(w,m,true);else signal();},1000);const pending=client.call('run');await sent;client.cancel();await assert.rejects(pending,/cancelled/);assert.equal(workers[0].terminated,true);assert.equal(client.pending.size,0);client.dispose();});
test('operation errors preserve their message and a closed client refuses work',async()=>{const {client}=fixture((w,m)=>{if(m.op==='init')answer(w,m,true);else queueMicrotask(()=>w.onmessage({data:{id:m.id,ok:false,error:'specific engine failure'}}));});await assert.rejects(client.call('run'),/specific engine failure/);client.dispose();await assert.rejects(client.call('run'),/closed/);});
