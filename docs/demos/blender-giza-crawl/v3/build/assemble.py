# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: from a Blender build folder to the demo folder.
Usage: python3 -I assemble.py BUILD_OUT SKY_DIR DEMO_DIR
  - writes BUILD_OUT/grades.json from bake.json (one grade per zone, the values below) and runs retone.py
  - runs postprocess.py on BUILD_OUT/crawl.x3d -> DEMO_DIR/assets/crawl.x3d
  - copies tex/*.jpg + flame.png, the sky faces, and the receipts (route, bake, grades applied, sky)
The page, README and build/ sources are copied separately (they live in the source tree, not the build output).
"""
import json
import os
import shutil
import subprocess
import sys

out, sky, demo = (os.path.abspath(a) for a in sys.argv[1:4])
HERE = os.path.dirname(os.path.abspath(__file__))
GRADE = {   # key: display value of the zone's pct-th percentile; shadow_tint pulls the darks
    "plateau": dict(key=0.34, pct=99, sat=0.75, shadow_tint=[0.78, 0.86, 1.22]),
    "passages": dict(key=0.55, pct=95, sat=0.95, shadow_tint=[0.92, 0.92, 1.05]),
    "gallery": dict(key=0.60, pct=95, sat=0.95, shadow_tint=[0.9, 0.92, 1.08]),
    "chambers": dict(key=0.55, pct=95, sat=0.95),
    "kings": dict(key=0.55, pct=96, sat=1.0, shadow_tint=[0.85, 0.9, 1.15]),
    "subterranean": dict(key=0.50, pct=95, sat=0.9),
    "osiris": dict(key=0.55, pct=96, sat=0.9, shadow_tint=[0.75, 0.9, 1.2]),
    "hall": dict(key=0.55, pct=93, sat=0.92, shadow_tint=[0.80, 0.88, 1.18]),
}
bake = json.load(open(os.path.join(out, "bake.json")))
grades = {}
for rec in bake["objects"]:
    g = grades.setdefault(rec["zone"], dict(GRADE.get(rec["zone"], dict(key=0.5)), objects=[]))
    g["objects"].append(os.path.splitext(os.path.basename(rec["image"]))[0])
json.dump(grades, open(os.path.join(out, "grades.json"), "w"), indent=1)
subprocess.run([sys.executable, "-I", os.path.join(HERE, "retone.py"), out, os.path.join(out, "grades.json")], check=True)
for d in ("assets/tex", "assets/sky", "receipts"):
    os.makedirs(os.path.join(demo, d), exist_ok=True)
subprocess.run([sys.executable, "-I", os.path.join(HERE, "postprocess.py"), os.path.join(out, "crawl.x3d"), os.path.join(demo, "assets", "crawl.x3d")], check=True)
for f in os.listdir(os.path.join(demo, "assets", "tex")):
    os.remove(os.path.join(demo, "assets", "tex", f))
for f in os.listdir(os.path.join(out, "tex")):
    shutil.copyfile(os.path.join(out, "tex", f), os.path.join(demo, "assets", "tex", f))
for f in os.listdir(sky):
    shutil.copyfile(os.path.join(sky, f), os.path.join(demo, "assets" if f.endswith(".jpg") else "receipts", "sky" if f.endswith(".jpg") else "", f))
for f in ("route.json", "bake.json", "grades-applied.json"):
    shutil.copyfile(os.path.join(out, f), os.path.join(demo, "receipts", f))
size = lambda p: sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(p) for f in fs)
print(json.dumps(dict(x3d_bytes=os.path.getsize(os.path.join(demo, "assets", "crawl.x3d")), tex_bytes=size(os.path.join(demo, "assets", "tex")),
                      sky_bytes=size(os.path.join(demo, "assets", "sky")), textures=len(os.listdir(os.path.join(demo, "assets", "tex"))))))
