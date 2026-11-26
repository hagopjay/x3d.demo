// node xite_shot.cjs <x_ite dist dir> <file.x3d> <out.png> [width height]: X_ITE renders an X3D file, one screenshot.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [xiteDir, file, out, w = '1280', h = '720'] = process.argv.slice(2);
const page = `<!doctype html><meta charset=utf-8><link rel=stylesheet href=/xite/x_ite.css><script src=/xite/x_ite.min.js></script>
<style>body{margin:0;background:#000}x3d-canvas{width:${w}px;height:${h}px;display:block}</style>
<x3d-canvas id=c contextMenu=false notifications=false splashScreen=false timings=false></x3d-canvas>`;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.x3d': 'model/x3d+xml' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page); }
  const f = u === '/file.x3d' ? file : path.join(xiteDir, u.replace(/^\/xite\//, ''));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) } });
  const errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`http://localhost:${srv.address().port}/`);
  await p.evaluate(async () => { const B = X3D.getBrowser(document.getElementById('c')); await B.loadURL(new X3D.MFString('/file.x3d')); });
  await new Promise(r => setTimeout(r, 6000));
  const extra = (process.env.SHOTS_MS || '').split(',').filter(Boolean).map(Number);   // more frames, ms apart
  await p.locator('#c').screenshot({ path: out });
  for (let i = 0; i < extra.length; i++) { await new Promise(r => setTimeout(r, extra[i])); await p.locator('#c').screenshot({ path: out.replace(/\.png$/, `-${i + 1}.png`) }); }
  await b.close(); srv.close();
  console.log(JSON.stringify({ out, errors }));
})();
