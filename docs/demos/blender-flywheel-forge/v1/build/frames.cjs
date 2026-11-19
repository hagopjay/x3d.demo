// Load one X3D file in X_ITE (headless Chromium), log console errors, take frames at two moments.
const {chromium}=require('playwright');(async()=>{const [,,url,outA,outB,outS,interps]=process.argv;const b=await chromium.launch();
const p=await b.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});const errs=[],warns=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());if(m.type()==='warning')warns.push(m.text());});p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8820/probe.html');await p.evaluate(u=>runXite(u),url);
await p.waitForTimeout(4000);await p.screenshot({path:outA});await p.waitForTimeout(3000);await p.screenshot({path:outB});
if(outS){await p.evaluate(names=>{const b=X3D.getBrowser(document.querySelector('x3d-canvas'));const s=b.currentScene;try{s.getNamedNode('SceneTimer').enabled=false;}catch(_){}for(const n of JSON.parse(names)){try{s.getNamedNode(n).set_fraction=0;}catch(_){}}},interps||'[]');await p.waitForTimeout(1500);await p.screenshot({path:outS});
await p.evaluate(names=>{const s=X3D.getBrowser(document.querySelector('x3d-canvas')).currentScene;for(const n of JSON.parse(names)){try{s.getNamedNode(n).set_fraction=0.25;}catch(_){}}},interps||'[]');await p.waitForTimeout(1500);await p.screenshot({path:outS.replace('.png','-q.png')});}
console.log(JSON.stringify({chromium:b.version(),errors:errs,warnings:warns.slice(0,10)}));await b.close();})();
