/* Re-execute the runnable shipped station and try-edit jobs against the pinned
   browser engines. Historical Python receipts are comparison inputs, not reruns. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root=path.resolve(__dirname,'..');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
for(const file of ['vendor/lab-stack.js','engine.js','parity.js'])vm.runInThisContext(fs.readFileSync(path.join(root,file),'utf8'));
const stations=JSON.parse(fs.readFileSync(path.join(root,'data/stations.json'),'utf8')).stations;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8'));
const recordedJs=JSON.parse(fs.readFileSync(path.join(root,'data/receipts/js.json'),'utf8')).results;
const supported=new Set(['count','sha256','select','ask','diff','reason','shacl']);
LabEngine.init(async file=>fs.readFileSync(path.join(root,file),'utf8'),manifest);
for(const station of stations){
  for(const [name,job]of Object.entries(station.jobs||{})){
    if(!supported.has(job.spec?.kind))continue;
    test(`shipped ${station.id}:${name} reproduces the recorded comparison`,async()=>{
      const live=await LabEngine.run(job.spec);
      const compare=LabParity.compare(job.spec.kind,live,job.python);
      assert.equal(compare.equal,true,JSON.stringify(compare));
    });
  }
  const edit=station.try;
  if(!supported.has(edit?.job?.kind))continue;
  test(`try edit ${station.id} ${edit.parity==='expected'?'retains its documented engine disagreement':'reproduces the recorded comparison'}`,async()=>{
    const live=await LabEngine.run(edit.job);
    const compare=LabParity.compare(edit.job.kind,live,edit.expected);
    if(edit.parity==='expected'){
      assert.equal(compare.equal,false,'the documented disagreement changed; re-review its station text');
      const sameEngine=LabParity.compare(edit.job.kind,live,recordedJs[station.id+':try']);
      assert.equal(sameEngine.equal,true,JSON.stringify(sameEngine));
      assert.match(edit.parity_note||'',/inverse|disagree|path/i);
    }else assert.equal(compare.equal,true,JSON.stringify(compare));
  });
}
