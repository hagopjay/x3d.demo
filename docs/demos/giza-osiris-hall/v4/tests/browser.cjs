// Actual WebGL/DOM acceptance. Requires a browser-capable host and Playwright.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader']});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(process.argv[2]||'http://localhost:8800/demos/giza-osiris-hall/v4/');
   await page.waitForFunction(()=>window.__witness&&window.__giza?.state.ready);
   // Test every authored main view binding, including resetting speculative state.
   for(const id of await page.evaluate(()=>__giza.state.tour.views.map(v=>v.id))){
    await page.evaluate(async id=>{__giza.go(id);await document.querySelector('#cv').browser.nextFrame();},id);
    assert.equal(await page.evaluate(()=>__giza.state.view),id);
   }
   await page.evaluate(()=>{__giza.go('V_Hall');__giza.go('V_Khufu');});
   assert.equal(await page.locator('#cS').isChecked(),false);
   // Scrubbed tours do not inherit an unrelated cut plane or survey overlay.
   await page.evaluate(()=>__giza.scrubTour(26));
   assert.equal(await page.locator('#section').isChecked(),false);
   await page.click('#witness-site');await page.waitForFunction(()=>!!__witness.state.hawara);
   assert.match(await page.locator('#witness-title').innerText(),/provincial cosmos/);
   const main=await page.locator('#witness-scene x3d-canvas').elementHandle();
   await page.click('#witness-next');assert.match(await page.locator('#witness-title').innerText(),/Herodotus/);
   await page.click('#witness-visor');
   const count=width<=700?1:3;
   await page.waitForFunction(n=>__witness.state.feeds.length===n,count);
   assert.equal(await page.locator('.visor-error').count(),0);
   if(width<=700)await page.locator('#visor-settings').evaluate(el=>el.open=true);
   await page.check('#visor-lower');await page.locator('#visor-depth').fill('-70');
   await page.locator('#visor-ghost').fill('.9');
   assert.equal(await main.evaluate(el=>el.isConnected),true,'appearance controls retain main camera');
   await page.selectOption('#hawara-light','raking');
   await page.selectOption('#visor-target','giza');
   await page.waitForFunction(n=>__witness.state.feeds.length===n&&document.querySelector('.feed-title')?.textContent.includes('OSIRIS'),count);
   assert.equal(await page.evaluate(()=>__witness.slots.values().filter(r=>r.feed).every(r=>['LB_hall','LB_khafreclaim','LB_orion'].every(name=>Number(r.scene.getNamedNode(name).whichChoice)===-1))),true);
   await page.locator('#visor-ghost').focus();await page.keyboard.press('Escape');
   assert.equal(await page.locator('#visor-feeds x3d-canvas').count(),0);
   assert.equal(await main.evaluate(el=>el.isConnected),true,'closing VISOR retains Hawara camera');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'witness-visor');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.deepEqual(errors,[]);await page.close();console.log('PASS',width);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
