#!/usr/bin/env python3
"""Serve the complete local Giza demo tree, including the sibling renderer."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
import argparse
import webbrowser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8800)
    parser.add_argument('--open', action='store_true', help='open the local URL in a browser')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    root = Path(__file__).resolve().parents[3]
    runtime = root / 'demos/giza-osiris-hall/v3/vendor/x_ite/x_ite.min.js'
    if not runtime.is_file():
        parser.error('Missing sibling v3/vendor renderer. Extract the complete archive together.')
    url = f'http://127.0.0.1:{args.port}/demos/giza-osiris-hall/v4-horizon/'
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        parser.error(f'Could not start local server: {error}. Try --port 8801.')
    print(f'Giza IV — The Horizon Engine\n{url}\nKeep this terminal open. Ctrl+C stops the server.', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
