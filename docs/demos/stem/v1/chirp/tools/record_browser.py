"""Bind a browser run's raw result (JSON on stdin, from the page's chirpView()) to the files it ran against,
and write evidence/browser-<date>.json for tools/check_browser.py and the Loom."""
import datetime
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
h = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
r = json.loads(sys.stdin.read())
w = r["watch"]
hear = [x for x in r["hear"] if "mode" in x]
ended = [x for x in r["hear"] if "ended_mode" in x]
sync = max(abs(x["picture_s"] - x["audio_s"]) for x in hear)
ev = {"schema": "chirp.browser/1", "date": datetime.date.today().isoformat(), "browser": "Playwright MCP headless Chromium",
      "renderer": r["renderer"], "user_agent": r["ua"],
      "page_sources": {p: h(p) for p in ["index.html", "src/app.js", "src/app.css", "scenes/chirp.x3d"]},
      "case_manifests": {c: h(f"cases/{c}/case.json") for c in r["cases"]},
      "wave_cross_check": {"what": "the page computes the wave height at the builder's reference points (three times, twelve points each) from the verified samples; worst relative difference at most 1e-6",
                           "cases": r["cases"], "pass": all(c["status"] == "pass" for c in r["cases"].values())},
      "watch": {"what": "slow-motion playback through the scene's TimeSensor: the drawn time advances", "fractions": w,
                "pass": all(b > a for a, b in zip(w, w[1:]))},
      "hear": {"what": "both verified audio tracks play; the picture is drawn at the audio's own time (at most 0.05 s apart) and stops when the sound ends",
               "samples": hear, "ended": ended, "worst_picture_audio_gap_s": sync,
               "pass": all(x["mode"] == "hear" and x["paused"] is False for x in hear) and sync <= 0.05 and all(x["ended_mode"] is None for x in ended)
                       and {x["track"] for x in hear} == {"real", "up"}},
      "console_errors": r["errors"],
      "scope": "One browser on one machine, muted (headless): playback state and clocks, not loudness or what a listener hears; no frame rate is claimed."}
if "resilience" in r:   # the callback's own function throws once; playback must keep advancing (failure mode 88)
    rs = r["resilience"]
    ev["callback_resilience"] = {**rs, "pass": rs["thrown"] >= 1 and rs["advanced_after"] and not rs["uncaught"]}
ev["pass"] = ev["wave_cross_check"]["pass"] and ev["watch"]["pass"] and ev["hear"]["pass"] and not r["errors"] and ev.get("callback_resilience", {"pass": True})["pass"]
out = ROOT / "evidence" / f"browser-{ev['date']}.json"
out.write_text(json.dumps(ev, indent=2) + "\n")
print(out.name, "pass" if ev["pass"] else "FAIL", f"sync {sync * 1000:.1f} ms")
sys.exit(0 if ev["pass"] else 1)
