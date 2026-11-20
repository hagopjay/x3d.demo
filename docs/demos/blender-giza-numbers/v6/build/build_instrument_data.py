#!/usr/bin/env python3
"""Extract a tiny reproducible Orion experiment from the retained X3D catalogue.

The positions and velocities are catalogue estimates, not new observations.
HYG-derived data retains the catalogue's CC BY-SA 4.0 attribution.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
sky = json.loads((ASSETS / "sky-data.json").read_text())
stage = json.loads((ASSETS / "stage-data.json").read_text())
source = (ASSETS / "sky.x3d").read_text()
positions = [float(v) for v in re.search(r"DEF='StarsBright'[^>]*?\bpositions='([^']*)'", source)[1].split()]
movers = {m["i"]: m["v"] for m in sky["movers"]}
stars = []
for name in ["Alnitak", "Alnilam", "Mintaka"]:
    i = sky["key"][name]
    stars.append({"name": name, "p": positions[3*i:3*i+3], "v": movers.get(i, [0, 0, 0])})
result = {
    "schema": "giza-instruments/orion-v1",
    "catalogue": "HYG v4.1, David Nash, CC BY-SA 4.0; derived from retained v4 X3D",
    "coordinates": "Sky: J2000 X3D axes (y,z,x), light-years. Ground: east,north,metres.",
    "assumptions": "Fixed star/pyramid correspondence; linear catalogue space motion; orthographic tangent plane; equal weights; no survey covariance or selection-corrected null model.",
    "sky_sha256": hashlib.sha256((ASSETS / "sky.x3d").read_bytes()).hexdigest(),
    "stars": stars,
    "ground": [{"name": name, "p": [stage["pyramids"][name]["c"][0], -stage["pyramids"][name]["c"][2]], "base": 2*stage["pyramids"][name]["a"]} for name in ["Khufu", "Khafre", "Menkaure"]],
}
(ASSETS / "belt-instrument.json").write_text(json.dumps(result, indent=2) + "\n")
print("Wrote assets/belt-instrument.json")
