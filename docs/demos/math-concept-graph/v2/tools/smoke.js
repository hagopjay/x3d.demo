// node tools/smoke.js OUT.json [URL] ; headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1300,height:900},deviceScaleFactor:2});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto(process.argv[3]||'http://127.0.0.1:8147/demos/math-concept-graph/v2/index.html');
await p.waitForFunction(()=>window.__mcg&&window.__mcg.ready&&window.__mcg.hooked,null,{timeout:40000}).catch(e=>errs.push('notready'));
await p.waitForTimeout(2500);const r={};
r.lessonRows=await p.evaluate(()=>document.querySelectorAll('tr.ls').length);r.gapRows=await p.evaluate(()=>document.querySelectorAll('#gp tbody tr').length);
r.shapes=await p.evaluate(()=>{const sc=document.querySelector('#cv').browser.currentScene;return sc.rootNodes.length});
r.namedLinesC=await p.evaluate(()=>!!document.querySelector('#cv').browser.currentScene.getNamedNode('lines_C'));
await p.screenshot({path:'../../../../../scout/mcg-a.png'});
await p.evaluate(()=>window.__mcg.show('bayes'));r.pickBayes=await p.evaluate(()=>document.getElementById('pick').innerText.slice(0,160));
await p.click('#flt button[data-g="S"]');await p.waitForTimeout(500);r.sLinesVisibleAfterToggle=await p.evaluate(()=>document.querySelector('#cv').browser.currentScene.getNamedNode('lines_S').visible);
await p.screenshot({path:'../../../../../scout/mcg-b.png'});
r.consoleErrors=errs;r.rig='headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0, 1300x900 @2x';r.date='2026-11-18';
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(r,null,1));console.log(r);await b.close()})()
