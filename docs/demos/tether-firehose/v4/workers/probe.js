/* probe.js — Step 0 own-file worker probe (SPEC §9). Answers {pong, wasm, fn, fetch, subtle}. The one `new Function` here is the
   documented env probe (tagged for the build's grep); nothing else in the page uses eval or new Function. */
self.onmessage=function(e){var r={pong:e.data,wasm:false,fn:false,fetch:null,subtle:!!(self.crypto&&crypto.subtle)};
  try{new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));r.wasm=true}catch(x){r.wasmErr=String(x).slice(0,120)}
  try{r.fn=(new Function("return 7"))()===7}catch(x){r.fnErr=String(x).slice(0,120)} /*@env-probe*/
  fetch("probe.json").then(function(q){return q.ok}).then(function(ok){r.fetch=ok;self.postMessage(r)}).catch(function(x){r.fetch=false;r.fetchErr=String(x).slice(0,120);self.postMessage(r)})};
