#!/usr/bin/env python3
"""Serve the Giza Evidence Atlas locally. No external APIs or write endpoints."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()
    def log_message(self,*a): pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=8800);a=p.parse_args()
    if not 1<=a.port<=65535:p.error('port must be between1and65535')
    server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
    print(f'Giza Evidence Atlas  http://127.0.0.1:{a.port}/',flush=True)
    print('Offline scene, source cards and local session files. No account is used.',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__=='__main__':main()
