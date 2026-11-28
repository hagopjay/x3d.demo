#!/usr/bin/env python3 -I
"""Serve this folder on http://localhost:8000 (the page fetches data and scenes, so file:// will not work)."""
import http.server, os, socketserver, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".x3d": "model/x3d+xml", ".wasm": "application/wasm", ".mjs": "text/javascript"}
with socketserver.TCPServer(("", port), H) as s:
    print(f"OBrian v1 on http://localhost:{port}/"); s.serve_forever()
