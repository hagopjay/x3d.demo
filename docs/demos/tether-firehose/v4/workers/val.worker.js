/* val.worker.js — the js-port in a classic Worker (ARCHITECTURE §4 / 05, SPEC §6, §7.3). Protocol = demo/jsval/worker.js's ({id, op, args} →
   {id, ok:true, result} | {id, ok:false, error:{name, message, stack}}; 'load' also posts {id, progress:{stage, ...}}) plus two additions so the same
   source runs as an own-file worker AND as a blob: copy of it:
     {id, op:'boot', args:[{jsval}]}   importScripts(jsval + 'x3dval.js'); jsval is the ABSOLUTE url of jsval/ (a blob: worker has no useful location)
     {id, op:'load', args:[{base, precompile, bytes:{'x3d-4.0.xsd': Uint8Array, 'x3d-4.1.xsd': Uint8Array}}]}
                                       X3DVAL.load with a read() that answers the two big XSDs from the handed bytes (the page decoded parts xsd40/xsd41
                                       and checked their sha256 against the manifest) and fetches the five small XSDs and the json tables from base.
     {id, op:'ping'}                    → {id, ok:true, result:{pong:true, booted}}
   x3dval.js dynamic-import()s jsval/vendor/libxml2-wasm.bundle.mjs itself (CSP: script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:).
   Nothing in this file evaluates a string as code. Label: js-port-of-8dd0d3e (a port of the fork, never the fork itself). */
(function(){
"use strict";
var booted=false,handed={};
function fail(id,e){self.postMessage({id:id,ok:false,error:{name:e&&e.name||"Error",message:String(e&&e.message||e),stack:e&&e.stack||""}})}
function read(url){var name=String(url).replace(/^.*\//,"");if(handed[name])return Promise.resolve(handed[name]);
  return fetch(url).then(function(r){if(!r.ok)throw new Error("val.worker: fetch "+url+" -> HTTP "+r.status);return r.arrayBuffer()}).then(function(ab){return new Uint8Array(ab)})}
self.onmessage=function(ev){var m=ev.data||{},id=m.id,op=m.op,args=m.args||[];
  try{
    if(op==="ping")return self.postMessage({id:id,ok:true,result:{pong:true,booted:booted}});
    if(op==="boot"){var o0=args[0]||{};if(!booted){importScripts(String(o0.jsval||"../jsval/")+"x3dval.js");booted=true}
      return self.postMessage({id:id,ok:true,result:{booted:true,label:self.X3DVAL&&self.X3DVAL.label}})}
    if(!booted)throw new Error("val.worker: not booted (send {op:'boot', args:[{jsval}]} first)");
    var X3DVAL=self.X3DVAL;
    if(op==="load"){var o=args[0]||{},b=o.bytes||{};for(var k in b)handed[k]=b[k]instanceof Uint8Array?b[k]:new Uint8Array(b[k]);
      X3DVAL.load({base:o.base,precompile:o.precompile,read:read,onProgress:function(p){self.postMessage({id:id,progress:p})}})
        .then(function(){self.postMessage({id:id,ok:true,result:X3DVAL.info()})},function(e){fail(id,e)});return}
    if(typeof X3DVAL[op]!=="function")throw new Error("val.worker: unknown op "+op);
    var r=X3DVAL[op].apply(X3DVAL,args);self.postMessage({id:id,ok:true,result:r===undefined?null:r})}
  catch(e){fail(id,e)}};
})();
