# SPDX-License-Identifier: GPL-3.0-or-later
"""Masonic Lodge v3: grade the bake (retone.py, one grade per zone), post-process, copy into the demo folder.
Usage: python3 -I assemble_lodge.py BUILD_OUT DEMO_DIR"""
import json, os, shutil, subprocess, sys
out, demo = (os.path.abspath(a) for a in sys.argv[1:3])
HERE = os.path.dirname(os.path.abspath(__file__))
GRADE = {"khufu": dict(key=0.62, pct=97, sat=1.0, shadow_tint=[0.82, 0.88, 1.15]),
         "interior": dict(key=0.72, pct=80, sat=1.0),
         "neighbours": dict(key=0.60, pct=97, sat=1.0, shadow_tint=[0.82, 0.88, 1.15]),
         "ground": dict(key=0.55, pct=97, sat=0.95, shadow_tint=[0.85, 0.9, 1.1]),
         "capstone": dict(key=0.80, pct=99, sat=1.1)}
bake = json.load(open(os.path.join(out, "bake.json")))
grades = {}
for r in bake["objects"]:
    z = "khufu" if r["zone"] == "khufu" else r["zone"]
    grades.setdefault(z, dict(GRADE.get(z, dict(key=0.6)), objects=[]))["objects"].append(os.path.splitext(os.path.basename(r["image"]))[0])
json.dump(grades, open(os.path.join(out, "grades.json"), "w"), indent=1)
subprocess.run([sys.executable, "-I", os.path.join(HERE, "retone.py"), out, os.path.join(out, "grades.json")], check=True)
os.makedirs(os.path.join(demo, "tex"), exist_ok=True)
for f in os.listdir(os.path.join(demo, "tex")):
    os.remove(os.path.join(demo, "tex", f))
for f in os.listdir(os.path.join(out, "tex")):
    shutil.copyfile(os.path.join(out, "tex", f), os.path.join(demo, "tex", f))
subprocess.run([sys.executable, "-I", os.path.join(HERE, "postprocess_lodge.py"), os.path.join(out, "giza-lodge.x3d"), os.path.join(demo, "giza-lodge.x3d")], check=True)
os.makedirs(os.path.join(demo, "receipts"), exist_ok=True)
for f in ("bake.json", "grades-applied.json"):
    shutil.copyfile(os.path.join(out, f), os.path.join(demo, "receipts", f))
tex = sum(os.path.getsize(os.path.join(demo, "tex", f)) for f in os.listdir(os.path.join(demo, "tex")))
print(json.dumps(dict(x3d_bytes=os.path.getsize(os.path.join(demo, "giza-lodge.x3d")), tex_bytes=tex, textures=len(os.listdir(os.path.join(demo, "tex"))))))
