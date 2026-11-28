// A static server for playing THERMAL locally: node tools/serve.mjs [port]  (then open http://127.0.0.1:8080)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.wasm': 'application/wasm', '.x3d': 'model/x3d+xml', '.json': 'application/json', '.png': 'image/png' };
const port = Number(process.argv[2] || 8080);
http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(join(root, path === '/' ? 'index.html' : path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`THERMAL on http://127.0.0.1:${port}`));
