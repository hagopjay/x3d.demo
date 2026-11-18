const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1300,height:900}});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto('http://127.0.0.1:8137/index.html');await p.waitForFunction(()=>window.__hg&&window.__hg.ready);await p.waitForTimeout(2500);
const r={};
r.nodesInScene=await p.evaluate(()=>Object.keys(__hg.S.nodes).length);r.hyperedgeSwitches=await p.evaluate(()=>__hg.S.sw.length);
r.positionsMoveWithRotation=await p.evaluate(async()=>{const a=String(__hg.S.nodes['dp'].translation);__hg.state.a=[1,0.4,0.2];await new Promise(r=>setTimeout(r,400));return a!==String(__hg.S.nodes['dp'].translation)});
r.lens2dFlatZ=await p.evaluate(async()=>{__hg.state.lens=2;await new Promise(r=>setTimeout(r,400));return __hg.D.nodes.every(n=>Math.abs(__hg.S.nodes[n.id].translation.z)<1e-6)});
await p.evaluate(()=>{__hg.state.lens=4});
await p.evaluate(()=>__hg.setSel('dp'));r.selDpHyperNeighbours=await p.evaluate(()=>document.getElementById('sel').textContent.match(/neighbours: (\d+)/)[1]);
await p.click('#mClique');await p.waitForTimeout(500);r.cliqueSwitch=await p.evaluate(()=>__hg.S.swC.whichChoice);
await p.waitForTimeout(2500);r.fps=await p.evaluate(()=>+document.getElementById('fps').textContent);
r.consoleErrors=errs;r.rig='headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0, 1300x900';r.date='2026-11-18';
fs.writeFileSync(process.argv[2],JSON.stringify(r,null,1));console.log(r);await b.close()})()
