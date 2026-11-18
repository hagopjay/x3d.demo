const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1300,height:900}});const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()=='error')errs.push(m.text())});
await p.goto('http://127.0.0.1:8137/index.html');await p.waitForFunction(()=>window.__hg&&window.__hg.ready,null,{timeout:30000}).catch(e=>errs.push('notready'));
await p.waitForTimeout(2500);await p.screenshot({path:process.argv[2]+'/a.png'});
console.log(errs);await p.evaluate(()=>{__hg.state.a=[1.1,0.5,0.3]});await p.waitForTimeout(800);await p.screenshot({path:process.argv[2]+'/b.png'});
await p.evaluate(()=>{__hg.setSel('dp')});await p.waitForTimeout(800);await p.screenshot({path:process.argv[2]+'/c.png'});
await p.click('#mClique');await p.waitForTimeout(800);await p.screenshot({path:process.argv[2]+'/d.png'});
console.log(await p.evaluate(()=>document.getElementById('fps').textContent),JSON.stringify(errs.slice(0,6)));await b.close()})()
