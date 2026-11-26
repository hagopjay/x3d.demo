#!/usr/bin/env python3
"""Writes ../index.html from ../data/score.json (copied from x3d.loom fault-court/results/score.json)."""
import json
from pathlib import Path
HERE = Path(__file__).resolve().parents[1]
o = json.loads((HERE / "data/score.json").read_text())
slim = {"cases": {k: {f: {"b": v[f]["base"], "l": v[f]["loom"], "w": v[f].get("where", ""), "r": (v[f].get("rules") or [""])[0][:90]} for f in v}
                  for k, v in o["cases"].items()},
        "man": o["manifest"], "S": o["summary"], "H1": o["H1"], "fam": o["families"]}
page = (HERE / "build/template.html").read_text().replace("/*DATA*/", json.dumps(slim, separators=(",", ":")))
(HERE / "index.html").write_text(page)
print("wrote index.html", len(page), "bytes")
