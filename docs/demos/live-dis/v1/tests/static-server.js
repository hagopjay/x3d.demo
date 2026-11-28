// static-server.js: a minimal static file server for the browser tests.
//   node tests/static-server.js <root> <port>      or      import { serve } from './static-server.js'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.x3d': 'model/x3d+xml', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown' };

export function serve(rootDir, port = 0) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p, (e, d) => {
      if (e) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(d);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}

if (process.argv[1] && process.argv[1].endsWith('static-server.js')) serve(process.argv[2] || '.', Number(process.argv[3] || 8765)).then((s) => console.log(`serving on http://127.0.0.1:${s.port}/`));
