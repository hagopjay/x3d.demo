#!/usr/bin/env python3
"""Local, threaded, same-origin server. Identity-safe gzip negotiation, bounded cache."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from functools import lru_cache
import argparse,gzip,os
ROOT=Path(__file__).resolve().parent
@lru_cache(maxsize=40)
def packed(path,mtime,size):return gzip.compress(Path(path).read_bytes(),compresslevel=6,mtime=0)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  try:self.respond(False)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_HEAD(self):self.respond(True)
 def respond(self,head):
  path=Path(self.translate_path(self.path))
  accepted=[x.strip().split(';') for x in self.headers.get('Accept-Encoding','').lower().split(',')]
  gz=False
  for a in accepted:
   if a[0]=='gzip':
    try:gz=next((float(v.strip()[2:]) for v in a[1:] if v.strip().startswith('q=')),1)>0
    except ValueError:gz=False
  if path.is_file() and path.suffix.lower() in ('.x3d','.xml','.js','.json','.css','.html','.txt','.svg') and gz:
   st=path.stat();data=packed(str(path),st.st_mtime_ns,st.st_size)
   self.send_response(200);self.send_header('Content-Type',self.guess_type(str(path)));self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(data)));self.send_header('Vary','Accept-Encoding');self.send_header('Cache-Control','no-cache');self.end_headers()
   if not head:self.wfile.write(data)
  elif head:super().do_HEAD()
  else:super().do_GET()
 def end_headers(self):
  self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','no-cache');super().end_headers()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8777);a=p.parse_args();print(f'Manifold of Emotion: http://localhost:{a.port}',flush=True);ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
