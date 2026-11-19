const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const names=Object.keys(JSON.parse(fs.readFileSync('/home/user/x3d.loom/x3d.threejs/bridge/NODES.json')).nodes);
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});const p=await b.newPage();
await p.goto('http://localhost:8766/probe.html');
const r=await p.evaluate(async names=>{await new Promise(r=>setTimeout(r,1500));const B=X3D.getBrowser('x3d-canvas');
try{await B.loadComponents(...B.getSupportedComponents())}catch(e){}
const out={ver:B.version,has:{}};for(const n of names){let ok=false;try{ok=!!B.getConcreteNode(n)}catch(e){}out.has[n]=ok}return out},names);
fs.writeFileSync('xite.json',JSON.stringify(r));console.log(r.ver,Object.values(r.has).filter(Boolean).length,'of',names.length,Object.keys(r.has).filter(k=>!r.has[k]));await b.close()})();
