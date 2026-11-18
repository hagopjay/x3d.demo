const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});const p=await b.newPage({viewport:{width:1500,height:900}});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto('http://127.0.0.1:8139/index.html');await p.waitForFunction(()=>window.__hg&&window.__hg.ready,null,{timeout:60000});
const o=process.argv[2],R={};const w=ms=>p.waitForTimeout(ms);
await w(3000);
R.nodes=await p.evaluate(()=>__hg.N);R.hyperedges=await p.evaluate(()=>__hg.H);
R.frames=await p.evaluate(()=>window.__hgFrames>5);
// real mouse hover + click on B90
const [x,y]=await p.evaluate(()=>{const i=__hg.D.nodes.findIndex(n=>n.id=='C60');return __hg.scr(i)});
const box=await p.locator('#cv').boundingBox();
await p.mouse.move(box.x+x,box.y+y);await w(600);R.hoverIsC60=await p.evaluate(()=>__hg.D.nodes[__hg.st.hover]?.id);
await p.mouse.click(box.x+x,box.y+y);await w(600);R.clickSelected=await p.evaluate(()=>__hg.D.nodes[__hg.st.sel]?.id);R.infoHasBoard=await p.locator('#info .bd i').count();
await w(1800);await p.screenshot({path:o+'/g_c60.png'});
// transposition isolate
await p.evaluate(()=>{const k=__hg.D.hes.findIndex(h=>h.type=='transposition'&&h.xvol);__hg.setSel(null,k)});await w(3200);await p.screenshot({path:o+'/h_trans.png'});
R.transIso=await p.evaluate(()=>__hg.D.hes[__hg.st.selHe].name);
// rotation + refit
await p.evaluate(()=>{__hg.setSel(null);__hg.st.a=[1.2,0.6,0.3]});await p.dispatchEvent('#rxw','change');await w(3500);await p.screenshot({path:o+'/i_rot.png'});
await p.evaluate(()=>{__hg.st.a=[0,0,0]});await p.click('[data-lens="2"]');await w(3500);await p.screenshot({path:o+'/j_2d.png'});
await p.click('[data-lens="4"]');await p.click('[data-q="sq"]');await w(2000);R.lightQuality=await p.evaluate(()=>!__hg.st.hq);
await p.fill('#q','najdorf');await w(300);R.searchHits=await p.locator('#sres a').count();
await p.locator('#sres a').first().click();await w(500);R.searchSelected=await p.evaluate(()=>__hg.D.nodes[__hg.st.sel]?.id);
await p.keyboard.press('Escape');R.escClears=await p.evaluate(()=>__hg.st.sel==null);
R.consoleErrors=errs;R.rig='headless Chromium (Playwright, SwiftShader software GL, WebGL2), Babylon.js 9.37.0, 1500x900';R.date='2026-11-18';
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(R,null,1));console.log(R);await b.close()})()
