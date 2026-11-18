const {chromium}=require('playwright');const fs=require('fs');
const OUT=process.argv[2], PORT=process.argv[3]||8155, ONLY=process.argv[4];
(async()=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto(`http://127.0.0.1:${PORT}/index.html`);await p.waitForFunction(()=>window.__d3x&&window.__d3x.ready,null,{timeout:60000});
const M=await p.evaluate(()=>window.__d3x.M);const rec={rig:'headless Chromium (Playwright), SwiftShader software GL, X_ITE 16.6.0, 1400x1000 viewport',date:new Date().toISOString().slice(0,16)+'Z',scenes:{}};
for(const c of M.charts){ if(ONLY&&!ONLY.split(',').includes(c.id))continue; const e0=errs.length;const t0=Date.now();
 await p.evaluate(id=>window.__d3x.open(id),c.id);
 await p.waitForTimeout(c.id==='elastic'?6000:(c.id==='particles'||c.id==='relief'||c.id==='spacetime')?3500:2500);
 const win={particles:[0.02,0.25],relief:[0.55,0.8]}[c.id];
 if(win)await p.waitForFunction(w=>{const n=X3D.getBrowser(document.getElementById('xc')).currentScene.getNamedNode('CLOCK');const fr=n.fraction_changed;return fr>w[0]&&fr<w[1]},win,{timeout:20000,polling:100}).catch(()=>errs.push('phase-wait '+c.id));
 const info=await p.evaluate(()=>{const B=X3D.getBrowser(document.getElementById('xc'));const S=B.currentScene;let n=0;const walk=x=>{n++;};return {root:S.rootNodes.length,vps:document.querySelectorAll('[data-vp]').length,ticks:window.__d3x.live?window.__d3x.live.ticks:null}});
 const el=await p.$('#cv');await el.screenshot({path:`${OUT}/previews/${c.id}.jpg`,type:'jpeg',quality:86});
 rec.scenes[c.id]={rootNodes:info.root,viewpoints:info.vps,liveTicks:info.ticks,secondsToShot:(Date.now()-t0)/1000,newConsoleErrors:errs.slice(e0)};console.log(c.id,JSON.stringify(rec.scenes[c.id]));
 if(c.id==='elastic'){await p.click('#heat');await p.waitForTimeout(8000);rec.scenes.elastic.reheat=await p.evaluate(()=>{const L=window.__d3x.live;const n=window.__d3x.liveNodes;const B=X3D.getBrowser(document.getElementById('xc'));const t=B.currentScene.getNamedNode('N0').translation;return {ticksAfter8s:L.ticks,alpha:+L.sim.alpha().toFixed(4),N0:[t.x,t.y,t.z].map(x=>+x.toFixed(3)),simN0:[n[0].x,n[0].y,n[0].z].map(x=>+x.toFixed(3))}});await el.screenshot({path:`${OUT}/previews/elastic-reheat.jpg`,type:'jpeg',quality:86});console.log('reheat',JSON.stringify(rec.scenes.elastic.reheat));}}
rec.consoleErrors=errs.length;if(!ONLY)fs.writeFileSync(`${OUT}/receipt-browser.json`,JSON.stringify(rec,null,1));await b.close()})();
