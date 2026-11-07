/* 04-prov.js — x3dprov core, SHA-256/HMAC, PROV/OpenLineage/OTLP views (SPEC rules 10–11, §7.3).
   Globals (v3 names kept): contentHash, addStep, readSteps, readSeal, verify, revalidateOne, provJson, olJson, otlpJson, spansOf,
   sha256b, sha, hmac, stripProv, SECRET, ZERO, dumps, injectMeta, setStepJson, HASH.
   Ported from demo/tether-firehose-v3.template.html lines 266–336 (K256, sha256b, hmac, META_RE/STEP_RE, unesc/esc, stripProv, contentHash,
   readSteps, readSeal, dumps, injectMeta, addStep, verify), 468 (revalidateOne), 586 (spansOf: no modeled durations in v4), 641–650 (provJson, olJson, otlpJson).
   Valid as a page script AND as a worker body: nothing here touches the DOM or `window`; workers/hash.worker.js = this file + hash.shim.js.
   Changes from v3: ops set extended (ingest, measure, judge, summary, transform); spansOf uses r.ms ?? r.latency_ms ?? 0 (src "missing"), never random;
   revalidateOne takes the VALS entry and reads self.judge (20-sim). HASH = worker facade (batch verify, hashMany, sha256hex, build) with main-thread fallback. */
(function(){
"use strict";
const G=typeof self!=="undefined"?self:globalThis;
/* ---------- SHA-256 + HMAC (sync, UTF-8) ---------- */
const K256=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const enc=new TextEncoder();
function sha256b(m){
  const l=m.length,nb=((l+9+63)>>6)<<6,b=new Uint8Array(nb);b.set(m);b[l]=0x80;
  const dv=new DataView(b.buffer);dv.setUint32(nb-4,(l*8)>>>0);dv.setUint32(nb-8,Math.floor(l/0x20000000));
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;const w=new Uint32Array(64);
  for(let o=0;o<nb;o+=64){
    for(let i=0;i<16;i++)w[i]=dv.getUint32(o+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],c=w[i-2];w[i]=(w[i-16]+(((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3))+w[i-7]+(((c>>>17)|(c<<15))^((c>>>19)|(c<<13))^(c>>>10)))>>>0}
    let a=h0,b2=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){
      const t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+K256[i]+w[i])>>>0;
      const t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b2)^(a&c)^(b2&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b2;b2=a;a=(t1+t2)>>>0}
    h0=(h0+a)>>>0;h1=(h1+b2)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0}
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(x=>x.toString(16).padStart(8,"0")).join("")
}
const sha=s=>sha256b(enc.encode(s));
const hex2b=h=>{const o=new Uint8Array(h.length/2);for(let i=0;i<o.length;i++)o[i]=parseInt(h.substr(i*2,2),16);return o};
function hmac(key,msg){const kb=enc.encode(key),k=new Uint8Array(64);k.set(kb);const ip=k.map(x=>x^0x36),op=k.map(x=>x^0x5c),mb=enc.encode(msg);
  const i1=new Uint8Array(64+mb.length);i1.set(ip);i1.set(mb,64);const ih=hex2b(sha256b(i1));const o1=new Uint8Array(96);o1.set(op);o1.set(ih,64);return sha256b(o1)}
/* ---------- x3dprov (JS port of the prototype; text-normalised hash instead of lxml C14N) ---------- */
const ZERO="0".repeat(64),SECRET="pipeline-sim-key";   /* HMAC stand-in; the key is in the page source on purpose and the page says so (Ed25519 stays on the owner's card) */
const META_RE=/\s*<meta name="x3dprov\.[^"]*" content="[^"]*"\/>/g;
const STEP_RE=/<meta name="x3dprov\.step\.(\d+)" content="([^"]*)"\/>/g;
const unesc=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const stripProv=x=>x.replace(META_RE,"").replace(/<head\s*\/>|<head>\s*<\/head>/g,"");   /* the recorder's own lines, and the empty <head> it adds around them to a scene that had none */
const contentHash=x=>sha(stripProv(x).replace(/>\s+</g,"><").trim());
function readSteps(x){const o=[];STEP_RE.lastIndex=0;let m;while((m=STEP_RE.exec(x)))o.push([+m[1],unesc(m[2])]);return o.sort((a,b)=>a[0]-b[0])}
function readSeal(x){const m=/<meta name="x3dprov\.seal" content="([^"]*)"\/>/.exec(x);return m?m[1]:null}
const dumps=o=>JSON.stringify(o,Object.keys(o).sort());
function injectMeta(x,metas){
  if(x.indexOf("</head>")>=0)return x.replace("</head>",metas+"</head>");
  let m=/<head\b[^>]*\/>/.exec(x);if(m)return x.slice(0,m.index)+"<head>"+metas+"</head>"+x.slice(m.index+m[0].length);
  m=/<X3D\b[^>]*>/.exec(x);if(m)return x.slice(0,m.index+m[0].length)+"<head>"+metas+"</head>"+x.slice(m.index+m[0].length);
  return "<head>"+metas+"</head>\n"+x}
function addStep(before,step,after,seal){
  const steps=readSteps(before),out=after??before,prev=steps.length?steps[steps.length-1][1]:null,rec={...step};
  rec.input_sha256=rec.input_sha256||(prev?JSON.parse(prev).output_sha256:contentHash(before));
  rec.output_sha256=contentHash(out);rec.prev=prev?sha(prev):ZERO;
  const all=steps.concat([[steps.length+1,dumps(rec)]]);
  let metas='<meta name="x3dprov.version" content="x3dprov/0.1"/>'+all.map(([n,c])=>`<meta name="x3dprov.step.${n}" content="${esc(c)}"/>`).join("");
  if(seal)metas+=`<meta name="x3dprov.seal" content="${hmac(SECRET,sha(all[all.length-1][1])+":"+all.length)}"/>`;
  return injectMeta(stripProv(out),metas)
}
const OPS=["generate","validate","repair","render","transform","ingest","measure","judge","summary"];
function verify(x,trace){
  const steps=readSteps(x),seal=readSeal(x),rows=trace?[]:null,pr=[];
  if(!steps.length)return{ok:false,status:"no-record",problems:["no record"],rows};
  let pj=null,po=null;
  steps.forEach(([n,c],i)=>{let r;try{r=JSON.parse(c)}catch(e){pr.push(`step ${n}: not JSON`);rows&&rows.push({n,chk:"parse step JSON",exp:"JSON",got:"error",ok:false});return}
    if(n!==i+1){pr.push(`gap before step ${n}`);rows&&rows.push({n,chk:"step numbering",exp:String(i+1),got:String(n),ok:false})}
    if(r.op&&!OPS.includes(r.op)){rows&&rows.push({n,chk:"op in vocabulary",exp:OPS.join("|"),got:r.op,ok:true})}
    const want=pj?sha(pj):ZERO,okp=r.prev===want;if(!okp)pr.push(`step ${n}: prev hash mismatch (step ${n-1} removed or edited)`);
    rows&&rows.push({n,chk:"prev = SHA-256( step n-1 )",exp:want,got:r.prev,ok:okp});
    if(po!==null){const oki=r.input_sha256===po;if(!oki)pr.push(`step ${n}: input differs from step ${n-1} output`);rows&&rows.push({n,chk:"input = step n-1 output",exp:po,got:r.input_sha256,ok:oki})}
    pj=c;po=r.output_sha256});
  if(pr.length)return{ok:false,status:"broken",problems:pr,rows};
  if(seal){const want=hmac(SECRET,sha(pj)+":"+steps.length),oks=seal===want;rows&&rows.push({n:steps.length,chk:"seal = HMAC( key, SHA-256(head) : n )",exp:want,got:seal,ok:oks});
    if(!oks)return{ok:false,status:"seal-fail",problems:["seal does not match chain head (last step or step count altered)"],rows}}
  const cur=contentHash(x),okc=cur===po;rows&&rows.push({n:steps.length,chk:"content hash = head output",exp:po,got:cur,ok:okc});
  if(!okc)return{ok:false,status:"stale",problems:["content differs from last recorded output (untracked edit)"],rows};
  return{ok:true,status:"verified",problems:[],sealed:!!seal,rows}
}
function setStepJson(x,n,j){return x.replace(new RegExp(`<meta name="x3dprov\\.step\\.${n}" content="[^"]*"/>`),`<meta name="x3dprov.step.${n}" content="${esc(dumps(j))}"/>`)}
/* revalidateOne(sc, V): V is a VALS entry (20-sim); the verdict comes from self.judge (recorded verdicts only). Returns true on a valid→invalid flip. */
function revalidateOne(sc,V){
  const j=typeof G.judge==="function"?G.judge(sc,V):{verdict:sc.verdict,codes:[]};const prev=sc.verdict;
  const rec={op:"validate",validator:V.name||"fork",validator_ref:V.ref,verdict:j.verdict,codes:j.codes||[],ms:j.ms??0,ms_src:j.ms_src||"recorded"};
  sc.xml=addStep(sc.xml,rec,sc.xml,sc.sealed);sc.nsteps=readSteps(sc.xml).length;sc.verdict=j.verdict;sc.vref=V.ref;sc.status=verify(sc.xml).status;
  return prev==="valid"&&j.verdict==="invalid"}
/* ---------- views ---------- */
function spansOf(sc){let t=0;return readSteps(sc.xml).map(([n,c])=>{const r=JSON.parse(c),ms=r.ms??r.latency_ms??0,sp={n,r,t0:r.run_s!=null?Math.round(r.run_s*1000):t,ms,src:r.ms!=null||r.latency_ms!=null?(r.ms_src||"recorded"):"missing",sid:sha(c).slice(0,16)};t=(r.run_s!=null?sp.t0:t)+ms;return sp})}
function provJson(sc,steps){steps=steps||readSteps(sc.xml);const ents={},act={},used={},gen={},der={};steps.forEach(([n,cx])=>{const r=JSON.parse(cx),a=`step/${n}-${r.op}`,ei="scene/"+String(r.input_sha256).slice(0,8),eo="scene/"+String(r.output_sha256).slice(0,8);
  ents[ei]={"x3d:sha256":String(r.input_sha256).slice(0,16)+"…"};ents[eo]={"x3d:sha256":String(r.output_sha256).slice(0,16)+"…"};act[a]={"x3d:op":r.op,"x3d:ref":r.validator_ref||r.agent_ref||r.model||""};
  used["_:u"+n]={activity:a,entity:ei};gen["_:g"+n]={entity:eo,activity:a};if(ei!==eo)der["_:d"+n]={generatedEntity:eo,usedEntity:ei,activity:a}});
  return{prefix:{x3d:"urn:x3dprov#"},entity:ents,activity:act,used,wasGeneratedBy:gen,wasDerivedFrom:der}}
function olJson(sc,steps){steps=steps||readSteps(sc.xml);return steps.map(([n,cx])=>{const r=JSON.parse(cx);return{eventType:"COMPLETE",producer:"x3dprov/0.1",run:{runId:sha(sc.id+n).slice(0,32),facets:{x3dprov_step:{op:r.op,ref:r.validator_ref||r.agent_ref||r.model||null}}},job:{namespace:"x3d.pipeline",name:r.op},inputs:[{namespace:"x3d.pipeline",name:String(r.input_sha256).slice(0,12)}],outputs:[{namespace:"x3d.pipeline",name:String(r.output_sha256).slice(0,12)}]}})}
function otlpJson(sc){
  const sp=spansOf(sc),st=readSteps(sc.xml),trace=sha(st.length?st[0][1]:sc.id).slice(0,32),base=1760720000e9+Number(String(sc.id).replace(/\D/g,"")||0)*1e9,at=(k,v)=>({key:k,value:typeof v==="number"?{doubleValue:v}:typeof v==="boolean"?{boolValue:v}:{stringValue:String(v)}});
  const spans=sp.map((p,i)=>({traceId:trace,spanId:p.sid,parentSpanId:i?sp[i-1].sid:"",name:p.r.op,kind:"SPAN_KIND_INTERNAL",startTimeUnixNano:String(Math.round(base+p.t0*1e6)),endTimeUnixNano:String(Math.round(base+(p.t0+p.ms)*1e6)),
    attributes:[at("x3dprov.step",p.n),at("x3dprov.input_sha256",String(p.r.input_sha256).slice(0,16)),at("x3dprov.output_sha256",String(p.r.output_sha256).slice(0,16)),at("x3dprov.duration_source",p.src)].concat(Object.entries(p.r).filter(([k,v])=>["model","validator_ref","verdict","agent_ref","nonblank_ratio","tokens_out","attempts_total"].includes(k)&&v!==null).map(([k,v])=>at("x3dprov."+k,v)))}));
  return{resourceSpans:[{resource:{attributes:[at("service.name","tether-firehose-4"),at("telemetry.sdk.name","x3dprov-view")]},scopeSpans:[{scope:{name:"x3dprov",version:"0.1"},spans}]}]}}
/* ---------- HASH: worker facade (page side only; the shim handles the worker side) ---------- */
const HASH={sealOn:false,mode:"main",ready:null,queue:0,memo:new Map(),worker:null,_id:0,_pending:new Map(),_url:"workers/hash.worker.js"};
const memoPut=(k,v)=>{if(HASH.memo.size>=2000)HASH.memo.delete(HASH.memo.keys().next().value);HASH.memo.set(k,v)};
function wcall(msg){return new Promise((res,rej)=>{const id=++HASH._id;HASH._pending.set(id,{res,rej});HASH.queue++;HASH.worker.postMessage({id,...msg})})}
HASH.init=function(){if(HASH.ready)return HASH.ready;HASH.ready=new Promise(res=>{
  if(typeof Worker==="undefined"||typeof document==="undefined"){HASH.mode="main";return res("main")}
  let w;try{w=new Worker(HASH._url)}catch(e){HASH.mode="main";HASH.err=String(e);return res("main")}
  let settled=false;const done=m=>{if(settled)return;settled=true;HASH.mode=m;res(m)};
  const t=setTimeout(()=>{if(!settled){HASH.err="worker did not answer in 12 s (busy boot?): main thread until it does";done("main")}},12000);  /* worker kept alive: a late pong promotes */
  w.onerror=e=>{HASH.err=String(e&&e.message||e);try{w.terminate()}catch(_){}if(!settled){clearTimeout(t);done("main")}else{HASH._pending.forEach(p=>p.rej(new Error("hash worker died")));HASH._pending.clear();HASH.mode="main"}};
  w.onmessage=ev=>{const d=ev.data||{};if(d.pong&&d.id===0){clearTimeout(t);HASH.worker=w;HASH.err=null;if(!settled)done("worker");else HASH.mode="worker";return}const p=HASH._pending.get(d.id);if(!p)return;HASH._pending.delete(d.id);HASH.queue--;d.error?p.rej(new Error(d.error)):p.res(d)};
  w.postMessage({id:0,type:"ping"})});return HASH.ready};
async function mainSlices(items,fn,size){const out=[];for(let i=0;i<items.length;i+=size){for(let j=i;j<Math.min(items.length,i+size);j++)out.push(fn(items[j],j));if(i+size<items.length)await new Promise(r=>setTimeout(r,0))}return out}
HASH.batch=async function(ids,xmls){await HASH.init();const need=[],out=new Array(ids.length);
  ids.forEach((id,i)=>{const m=HASH.memo.get(xmls[i]);if(m)out[i]={id,status:m,ok:m==="verified"};else need.push(i)});
  if(need.length){let st;if(HASH.mode==="worker"){try{st=(await wcall({type:"verify",ids:need.map(i=>ids[i]),xmls:need.map(i=>xmls[i])})).statuses}catch(e){HASH.mode="main"}}
    if(!st)st=await mainSlices(need,i=>{const v=verify(xmls[i]);return{id:ids[i],status:v.status,ok:v.ok}},24);
    need.forEach((i,k)=>{out[i]=st[k];memoPut(xmls[i],st[k].status)})}
  return out};
HASH.hashMany=async function(xmls){await HASH.init();if(HASH.mode==="worker"){try{return(await wcall({type:"hash",xmls})).hashes}catch(e){HASH.mode="main"}}return mainSlices(xmls,x=>contentHash(x),24)};
HASH.sha256hex=async function(data){const bytes=typeof data==="string"?enc.encode(data):data;
  if(G.crypto&&crypto.subtle){try{return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("")}catch(e){}}
  await HASH.init();if(HASH.mode==="worker"){try{return(await wcall({type:"sha256",bytes})).hex}catch(e){}}return sha256b(bytes)};
HASH.build=async function(x0,steps){await HASH.init();if(HASH.mode==="worker"){try{return(await wcall({type:"build",x0,steps})).xml}catch(e){HASH.mode="main"}}let x=x0;steps.forEach(s=>{x=addStep(x,s.step,s.after??x,s.seal)});return x};
Object.assign(G,{contentHash,addStep,readSteps,readSeal,verify,revalidateOne,provJson,olJson,otlpJson,spansOf,sha256b,sha,hmac,stripProv,SECRET,ZERO,dumps,injectMeta,setStepJson,HASH,PROV_OPS:OPS});
})();

/* hash.shim.js — appended to js/04-prov.js by build_v4.py to make workers/hash.worker.js (never edit the built file).
   Protocol (ARCHITECTURE §4 / 04): {id, type:'ping'} → {id, pong:true}; {id, type:'verify', ids, xmls} → {id, statuses:[{id, status, ok}]};
   {id, type:'hash', xmls} → {id, hashes}; {id, type:'sha256', bytes} → {id, hex}; {id, type:'build', x0, steps:[{step, after, seal}]} → {id, xml}; errors → {id, error}. */
(function(){
"use strict";
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
self.onmessage=async function(ev){const d=ev.data||{},id=d.id;try{
  if(d.type==="ping")return self.postMessage({id,pong:true});
  if(d.type==="verify")return self.postMessage({id,statuses:d.ids.map((sid,i)=>{const v=self.verify(d.xmls[i]);return{id:sid,status:v.status,ok:v.ok}})});
  if(d.type==="hash")return self.postMessage({id,hashes:d.xmls.map(x=>self.contentHash(x))});
  if(d.type==="sha256"){let h=null;if(self.crypto&&crypto.subtle){try{h=hex(await crypto.subtle.digest("SHA-256",d.bytes))}catch(e){}}return self.postMessage({id,hex:h||self.sha256b(d.bytes instanceof Uint8Array?d.bytes:new Uint8Array(d.bytes))})}
  if(d.type==="build"){let x=d.x0;d.steps.forEach(s=>{x=self.addStep(x,s.step,s.after??x,s.seal)});return self.postMessage({id,xml:x})}
  self.postMessage({id,error:"unknown type "+d.type})}catch(e){self.postMessage({id,error:String(e&&e.message||e)})}};
})();
