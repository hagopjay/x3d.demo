/* Fourth external review's graphics-state probe (round4/evidence/graphics-state-probes.cjs), pointed at v4, plus a retry case. Run: LINKEDOM=/path/to/node_modules/linkedom node state-probes.cjs */
/* Shipped script execution in controlled DOM. No browser, renderer or elapsed-time benchmark. */
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require(process.env.LINKEDOM||'linkedom');
const base=process.env.X3D_DEMO||path.resolve(__dirname,'../../../../..');
const page=path.join(base,'docs/demos/blender-splat/v4.1/index.html');
const guard=path.join(base,'docs/lib/gfx-guard-v3.js');
const html=fs.readFileSync(page,'utf8');
function setup(){
 const {document,window:dw}=parseHTML(html);const timers=[],events={};let now=0;
 const window={MutationObserver:dw.MutationObserver,addEventListener:(k,f)=>events[k]=f};
 class Clock extends Date{static now(){return now;}}
 const create=document.createElement.bind(document);
 document.createElement=t=>{const e=create(t);if(t==='canvas')e.getContext=()=>({RENDERER:0,getExtension:()=>null,getParameter:()=> 'fakeGL'});return e;};
 const context={document,window,Date:Clock,String,console:{log(){}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},
  X3D:{getBrowser:c=>({currentScene:{rootNodes:c.getAttribute('src').includes('mesh.x3d')?[{}]:[]}})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(guard,'utf8'),context);context.GfxGuard=window.GfxGuard;
 const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function loadXite'));
 if(!inline)throw Error('Viewer inline source missing');vm.runInContext(inline,context);
 return {document,window,timers,click:i=>document.querySelector(`.go[data-i="${i}"]`).dispatchEvent(new dw.Event('click')),
  loaded:()=>[...document.head.querySelectorAll('script')].find(s=>s.getAttribute('src')?.endsWith('x_ite.min.js')).onload(),setNow:n=>now=n,
  read:()=>({guard:window.GfxGuard.state.outcome,panes:Object.fromEntries(Object.entries(window.__panes).map(([k,p])=>[k,{state:p.state,label:p.tag.textContent,button:p.go.textContent,disabled:p.go.disabled,hidden:p.go.hidden}])),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)})};
}
const rows=[];
{const c=setup();c.click('A');c.loaded();c.click('B');c.setNow(120001);c.timers.findLast(t=>t.ms===250).fn();const got=c.read();rows.push({case:'old second-pane stall',scope:'modeled mesh ready and splat not ready; scene timer advanced',got,oldDefectClosed:got.panes.B.state==='failed'&&!got.panes.B.disabled&&got.panes.B.button.includes('Retry')});}
{const c=setup();c.click('A');c.loaded();c.setNow(20001);c.timers.find(t=>t.ms===20000).fn();rows.push({case:'one selected pane live, other never selected',got:c.read()});}
{const c=setup();c.click('A');c.setNow(120001);c.timers.forEach(t=>t.fn());rows.push({case:'viewer-library request never settles',scope:'no library onload/onerror is delivered',got:c.read(),scheduledTimers:c.timers.map(t=>t.ms)});}
{const c=setup();c.click('A');c.setNow(120001);c.timers.slice().forEach(t=>t.fn());const failed=c.read().panes.A;
 c.click('A');const sc=[...c.document.head.querySelectorAll('script')].filter(s=>s.getAttribute('src')?.endsWith('x_ite.min.js'));
 sc[0].onload();
 rows.push({case:'retry after library deadline, then the first request answers late',scripts_requested:sc.length,after_deadline:failed,got:c.read(),
   one_request:sc.length===1});}
{const c=setup();c.click('A');const q=()=>[...c.document.head.querySelectorAll('script')].filter(s=>s.getAttribute('src')?.endsWith('x_ite.min.js'));
 q()[0].onerror();const failed=c.read().panes.A.label;c.click('A');const sc=q();sc[sc.length-1].onload();
 rows.push({case:'library request errors, Retry makes a new request',after_error:failed,scripts_requested:sc.length,got:c.read()});}
const result={instrument:{node:process.version,dom:'linkedom0.18.12',browser:'none',gpu:'none; fakeGL',clock:'controlled, no measured duration'},sources:{guard:path.relative(base,guard),page:path.relative(base,page)},rows};
fs.writeFileSync(path.join(__dirname,'state-probes.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
