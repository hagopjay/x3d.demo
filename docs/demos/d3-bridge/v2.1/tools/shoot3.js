const {chromium}=require('playwright');const fs=require('fs');
const OUT=process.argv[2], PORT=process.argv[3]||8155, ONLY=process.argv[4], NOGL=process.env.NOGL==='1';
(async()=>{const b=await chromium.launch({args:NOGL?['--disable-webgl','--disable-webgl2','--disable-3d-apis']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
if(NOGL){const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});await p.goto(`http://127.0.0.1:${PORT}/index.html#living`);await p.waitForTimeout(4000);const r={gl:await p.evaluate(()=>hasGL()),fallbackImg:await p.evaluate(()=>!!document.querySelector('#cv img')),tiles:await p.evaluate(()=>document.querySelectorAll('.tile').length),matrixRows:await p.evaluate(()=>document.querySelectorAll('#mx tr').length-1),errors:errs};await p.screenshot({path:`${OUT}/previews/no-webgl-fallback.jpg`,type:'jpeg',quality:80});console.log(JSON.stringify(r));fs.writeFileSync(`${OUT}/receipt-no-webgl.json`,JSON.stringify({rig:'headless Chromium, --disable-webgl --disable-webgl2 --disable-3d-apis',...r},null,1));await b.close();return}
const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto(`http://127.0.0.1:${PORT}/index.html`);await p.waitForFunction(()=>window.__d3x&&window.__d3x.ready,null,{timeout:60000});
const M=await p.evaluate(()=>window.__d3x.M);const rec={rig:'headless Chromium (Playwright), SwiftShader software GL, X_ITE 16.6.0, 1400x1000 viewport',date:new Date().toISOString().slice(0,16)+'Z',scenes:{}};
for(const c of M.charts){ if(ONLY&&!ONLY.split(',').includes(c.id))continue; const e0=errs.length;const t0=Date.now();
 await p.evaluate(id=>window.__d3x.open(id),c.id);
 await p.waitForTimeout(c.id==='living'?6000:(c.id==='particles'||c.id==='relief'||c.id==='spacetime')?3500:2500);
 const win={particles:[0.02,0.25],relief:[0.55,0.8]}[c.id];
 if(win)await p.waitForFunction(w=>{const n=X3D.getBrowser(document.getElementById('xc')).currentScene.getNamedNode('CLOCK');const fr=n.fraction_changed;return fr>w[0]&&fr<w[1]},win,{timeout:20000,polling:100}).catch(()=>errs.push('phase-wait '+c.id));
 const info=await p.evaluate(()=>{const B=X3D.getBrowser(document.getElementById('xc'));const S=B.currentScene;let n=0;const walk=x=>{n++;};return {root:S.rootNodes.length,vps:document.querySelectorAll('[data-vp]').length,ticks:window.__d3x.live?window.__d3x.live.ticks:null}});
 const fr=await p.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<5000)requestAnimationFrame(f);else r(n)};requestAnimationFrame(f)}));
 const el=await p.$('#cv');await el.screenshot({path:`${OUT}/previews/${c.id}.jpg`,type:'jpeg',quality:86});
 rec.scenes[c.id]={rootNodes:info.root,viewpoints:info.vps,liveTicks:info.ticks,secondsToShot:+((Date.now()-t0)/1000).toFixed(1),framesIn5s:fr,newConsoleErrors:errs.slice(e0)};console.log(c.id,JSON.stringify(rec.scenes[c.id]));
 if(c.id==='living'){const L=await p.evaluate(()=>({visible:window.__d3x.living.visible(),edges:window.__d3x.living.edgesVisible(),total:window.__d3x.living.N.length}));
   await p.evaluate(()=>window.__d3x.living.setUpto(4));await p.waitForTimeout(4000);const early=await p.evaluate(()=>({visible:window.__d3x.living.visible(),edges:window.__d3x.living.edgesVisible()}));await el.screenshot({path:`${OUT}/previews/living-early.jpg`,type:'jpeg',quality:86});
   await p.evaluate(()=>window.__d3x.living.setUpto(window.__d3x.living.E.demos.length-1));await p.waitForTimeout(3000);
   const iso=await p.evaluate(()=>window.__d3x.living.select('demo:hypergraph'));await p.waitForTimeout(800);await el.screenshot({path:`${OUT}/previews/living-isolate.jpg`,type:'jpeg',quality:86});await p.evaluate(()=>window.__d3x.living.select(null));
   rec.scenes.living.checks={atLast:L,atDemo5:early,isolateHypergraphOpaqueNodes:iso,ticks:await p.evaluate(()=>window.__d3x.live.ticks)};console.log('living',JSON.stringify(rec.scenes.living.checks));}
 if(c.id==='chord'){const n=await p.evaluate(()=>window.__d3x.chord.isolate(0));await p.waitForTimeout(600);await el.screenshot({path:`${OUT}/previews/chord-isolate.jpg`,type:'jpeg',quality:86});const back=await p.evaluate(()=>window.__d3x.chord.isolate(null));rec.scenes.chord.checks={arches:await p.evaluate(()=>window.__d3x.chord.I.length),opaqueAfterIsolate:n,opaqueAfterRestore:back};console.log('chord',JSON.stringify(rec.scenes.chord.checks));}
 if(c.id==='relief'){await p.evaluate(()=>{const S=X3D.getBrowser(document.getElementById('xc')).currentScene;S.getNamedNode('CLOCK').enabled=false;S.getNamedNode('SQUASH').scale=new X3D.SFVec3f(1,1,1);S.getNamedNode('VP1').set_bind=true});await p.waitForTimeout(3000);await el.screenshot({path:`${OUT}/previews/relief-top.jpg`,type:'jpeg',quality:90});}
 if(c.id==='sankey'){rec.scenes.sankey.checks={viewpoints:info.vps};}
 if(c.id==='spacetime'){await p.waitForTimeout(4000);await el.screenshot({path:`${OUT}/previews/spacetime-slab.jpg`,type:'jpeg',quality:86});}
}
rec.consoleErrors=errs.length;if(!ONLY)fs.writeFileSync(`${OUT}/receipt-browser.json`,JSON.stringify(rec,null,1));await b.close()})();
