#!/usr/bin/env python3
"""Poll Kraken's public (keyless) REST API for the BTC/USD spot order book and trades. Standard library only.

  python3 -I tools/poll_kraken.py [seconds=360] [interval=2.0]

Writes NDJSON (one response per line, wrapped with the local receive time) to downloads/kraken/:
  depth.ndjson   GET https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=500   (~35 KB each)
  trades.ndjson  GET https://api.kraken.com/0/public/Trades?pair=XBTUSD&since=<cursor> (incremental)
Venue: Kraken spot XBT/USD (not a perpetual / futures). Depth is a REST snapshot of the top 500 price levels per side,
so changes between snapshots are only seen at the polling cadence.
"""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(HERE, "downloads", "kraken")
UA = {"User-Agent": "x3d-orderbook-study/0.1 (stdlib urllib)"}
BASE = "https://api.kraken.com/0/public/"


def get(path):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()


def main():
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 360.0
    step = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    os.makedirs(DL, exist_ok=True)
    fd = open(os.path.join(DL, "depth.ndjson"), "w")
    ft = open(os.path.join(DL, "trades.ndjson"), "w")
    t_start = time.time()
    since = str(int((t_start - 30) * 1e9))          # trades from 30 s before the first snapshot
    n_d = n_t = err = 0
    while time.time() - t_start < dur:
        tick = time.time()
        for kind in ("depth", "trades"):
            try:
                if kind == "depth":
                    raw = get("Depth?pair=XBTUSD&count=500")
                else:
                    raw = get("Trades?pair=XBTUSD&since=" + since)
                recv = time.time()
                body = json.loads(raw)
                if body.get("error"):
                    err += 1
                    print(kind, "api error", body["error"], file=sys.stderr)
                    continue
                if kind == "trades":
                    since = body["result"]["last"]
                    n_t += 1
                    ft.write(json.dumps({"recv": recv, "body": body}, separators=(",", ":")) + "\n")
                else:
                    n_d += 1
                    fd.write(json.dumps({"recv": recv, "body": body}, separators=(",", ":")) + "\n")
            except Exception as e:  # network hiccup: log and keep polling
                err += 1
                print(kind, "fail", e, file=sys.stderr)
            time.sleep(0.15)
        fd.flush(); ft.flush()
        time.sleep(max(0.0, step - (time.time() - tick)))
    print(json.dumps({"depth_snapshots": n_d, "trade_polls": n_t, "errors": err, "seconds": round(time.time() - t_start, 1)}))


if __name__ == "__main__":
    main()
