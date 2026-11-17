#!/usr/bin/env python3
"""Serve Semantic Twin Lab locally; no external APIs or write endpoints."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()
    def log_message(self, *_args):
        pass

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port', type=int, default=8790)
    a = p.parse_args()
    if not 1 <= a.port <= 65535:
        p.error('port must be between 1 and 65535')
    server = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print(f'Semantic Twin Lab  http://127.0.0.1:{a.port}/workbench.html', flush=True)
    print('3D study: /index.html   Guide: /ONTOLOGY-FIELD-GUIDE.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
if __name__ == '__main__':
    main()
