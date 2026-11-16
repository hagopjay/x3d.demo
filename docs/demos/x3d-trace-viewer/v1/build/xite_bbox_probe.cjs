const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const srv = http.createServer((q, s) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } const x = path.extname(p); s.writeHead(200, {'content-type': {'.html':'text/html','.js':'text/javascript','.css':'text/css','.x3d':'application/xml','.json':'application/json','.wasm':'application/wasm'}[x] || 'application/octet-stream'}); s.end(d); }); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage();
  await pg.goto(`http://127.0.0.1:${port}/probe.html`);
  await pg.waitForFunction(() => window.X3D && X3D.getBrowser('#c') && X3D.getBrowser('#c').currentScene && X3D.getBrowser('#c').currentScene.rootNodes.length > 3, null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const out = await pg.evaluate(() => {
    const B = X3D.getBrowser('#c'); const sc = B.currentScene; const r = { rows: [] };
    r.box3proto = Object.getOwnPropertyNames(X3D.Box3.prototype);
    const t = sc.rootNodes.find(n => n.getNodeTypeName() === 'Transform'); const box = new X3D.Box3(); const ret = t.getValue().getBBox(box, false);
    r.same = ret === box; r.ownKeys = Object.keys(box); r.retKeys = ret ? Object.keys(ret) : null;
    sc.rootNodes.forEach((n, i) => {
      if (n.getNodeTypeName() !== 'Transform') return;
      const b2 = new X3D.Box3(); const rr = n.getValue().getBBox(b2, false) || b2;
      const g = (v) => v ? [v.x, v.y, v.z] : null;
      let mn = null, mx = null;
      try { const a = new X3D.Vector3(), c = new X3D.Vector3(); rr.getExtents(a, c); mn = g(a); mx = g(c); } catch (e) { r.exErr = String(e); }
      r.rows.push({ i, min: mn, max: mx, size: g(rr.size), center: g(rr.center) });
    });
    return r;
  });
  console.log(JSON.stringify(out));
  await b.close(); srv.close();
})();
