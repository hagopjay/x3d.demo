// node test/shots.cjs <site root> <out dir>: a few screenshots of the 3D pane for the notes
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = process.argv[3];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.x3d': 'application/xml', '.wasm': 'application/wasm', '.md': 'text/plain', '.toml': 'text/plain', '.yml': 'text/plain' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); }).listen(0);
(async () => {
  const base = `http://127.0.0.1:${srv.address().port}/demos/x3d-trace-viewer/v1/index.html`;
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  for (const [name, q] of [['tall', '?claim=4'], ['wall', '?claim=0'], ['backwall', '?claim=10'], ['light', '?claim=2']]) {
    await pg.goto(base + q);
    await pg.waitForFunction(() => window.__traceReady === true);
    await pg.waitForFunction(() => /scene as published/.test(document.getElementById('stagemsg').textContent), null, { timeout: 40000 });
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: path.join(out, name + '.png'), clip: { x: 0, y: 330, width: 1440, height: 700 } });
  }
  await b.close(); srv.close();
})();
