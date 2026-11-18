const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1300,height:900}});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto('http://127.0.0.1:8138/index.html');await p.waitForFunction(()=>window.__hg&&window.__hg.ready,null,{timeout:30000}).catch(e=>errs.push('notready'));
await p.waitForTimeout(2500);const r={};
await p.screenshot({path:'v2a.png'});
r.nodes=await p.evaluate(()=>Object.keys(__hg.S.nodes).length);r.switches=await p.evaluate(()=>__hg.S.sw.length);
r.visibleBoth=await p.evaluate(()=>__hg.S.sw.filter(s=>s.whichChoice==0).length);
await p.click('[data-layer=dsa]');await p.waitForTimeout(500);r.visibleDsa=await p.evaluate(()=>__hg.S.sw.filter(s=>s.whichChoice==0).length);
await p.click('[data-layer=eco]');await p.waitForTimeout(500);r.visibleEco=await p.evaluate(()=>__hg.S.sw.filter(s=>s.whichChoice==0).length);await p.screenshot({path:'v2b.png'});
await p.click('[data-layer=both]');await p.evaluate(()=>{__hg.state.a=[0.9,0.4,0.2];__hg.setSel('transposition-table'.replace(/^/,'eng:'))});await p.waitForTimeout(700);await p.screenshot({path:'v2c.png'});
r.selNeighbours=await p.evaluate(()=>document.getElementById('sel').textContent.match(/neighbours: (\d+)/)[1]);
await p.waitForTimeout(2500);r.fps=await p.evaluate(()=>+document.getElementById('fps').textContent);
r.consoleErrors=errs;r.rig='headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0, 1300x900';r.date='2026-11-18';
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(r,null,1));console.log(r);await b.close()})()
