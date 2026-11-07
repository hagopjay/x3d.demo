"""Bind a browser run's raw result (JSON on stdin, from the page's heartView()) to the files it ran against,
and write evidence/browser-<date>.json for tools/check_browser.py and the Loom."""
import datetime
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
h = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
r = json.loads(sys.stdin.read())
s = r["playback"]["samples"]
steps = [(b[0] - a[0]) % 36 for a, b in zip(s, s[1:])]          # the period loops: advance modulo 36 frames
ev = {"schema": "living-heart.browser/1", "date": datetime.date.today().isoformat(), "browser": "Playwright MCP headless Chromium",
      "renderer": r["renderer"], "user_agent": r["ua"],
      "page_sources": {p: h(p) for p in ["index.html", "src/app.js", "src/nets.js", "src/app.css", "scenes/heart.x3d"]},
      "case_manifests": {c: h(f"cases/{c}/case.json") for c in r["cases"]},
      "cross_check": {"what": "the page counts the excited cells (u > 0.5) of every verified frame and, for the ventricle, meshes the wall itself; counts must equal the builder's and the wall's volume agree to 1e-6",
                      "cases": r["cases"], "pass": all(c["status"] == "pass" for c in r["cases"].values())},
      "playback": {"what": "Play the ventricle's period; sample the page's frame and the Switch's whichChoice every 0.3 s; pause and check it holds",
                   "samples_frame_whichChoice": s, "paused_then": r["playback"]["paused_then"],
                   "pass": all(a == b for a, b in s) and all(0 < d < 18 for d in steps) and r["playback"]["paused_then"][0] == r["playback"]["paused_then"][1]},
      "console_errors": r["errors"],
      "scope": "One browser on one machine. Counts, mesh and playback order, not pixels; no frame rate is claimed."}
if "resilience" in r:   # the callback's own function throws once; playback must keep advancing (failure mode 88)
    rs = r["resilience"]
    ev["callback_resilience"] = {**rs, "pass": rs["thrown"] >= 1 and rs["advanced_after"] and not rs["uncaught"]}
ev["pass"] = ev["cross_check"]["pass"] and ev["playback"]["pass"] and not r["errors"] and ev.get("callback_resilience", {"pass": True})["pass"]
out = ROOT / "evidence" / f"browser-{ev['date']}.json"
out.write_text(json.dumps(ev, indent=2) + "\n")
print(out.name, "pass" if ev["pass"] else "FAIL")
sys.exit(0 if ev["pass"] else 1)
