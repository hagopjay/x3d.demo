// One engine page, one asset: load, drive the animation to fraction 0 and 0.25, screenshot both, log console errors.
const {chromium}=require('playwright');
(async()=>{const [,,page,asset,out]=process.argv;const b=await chromium.launch();
const p=await b.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});const errs=[],warns=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,300));if(m.type()==='warning')warns.push(m.text().slice(0,200));});p.on('pageerror',e=>errs.push(String(e).slice(0,300)));
const t=Date.now();await p.goto('http://127.0.0.1:8830/'+page);let engine=null;
try{engine=await p.evaluate(a=>go(a),asset);}catch(e){errs.push('go: '+String(e).slice(0,300));}
const loadMs=Date.now()-t;
await p.waitForTimeout(2500);
for(const [f,suf] of [[0,'t0'],[0.25,'q']]){try{await p.evaluate(f=>at(f),f);}catch(e){errs.push('at: '+String(e).slice(0,200));}await p.waitForTimeout(1500);await p.screenshot({path:out+'-'+suf+'.png'});}
console.log(JSON.stringify({page,asset,engine,chromium:b.version(),load_ms:loadMs,errors:errs,warnings:warns.slice(0,8)}));await b.close();})();
