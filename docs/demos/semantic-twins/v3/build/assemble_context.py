# SPDX-License-Identifier: GPL-3.0-or-later
"""Semantic Twins v3: grade the context bake, strip its bindables, shorten numbers, copy into DEMO_DIR/context.
Usage: python3 -I assemble_context.py BUILD_OUT DEMO_DIR"""
import json, os, re, shutil, subprocess, sys
out, D = (os.path.abspath(a) for a in sys.argv[1:3])
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(D + "/context/tex", exist_ok=True)
b = json.load(open(out + "/bake.json"))
name = lambda r: os.path.splitext(os.path.basename(r["image"]))[0]
gr = {"context": dict(key=0.58, pct=97, sat=1.0, shadow_tint=[0.82, 0.88, 1.15], objects=[name(r) for r in b["objects"] if r["zone"] != "hollows"]),
      "hollows": dict(key=0.7, pct=85, objects=[name(r) for r in b["objects"] if r["zone"] == "hollows"])}
gr = {k: v for k, v in gr.items() if v["objects"]}
json.dump(gr, open(out + "/grades.json", "w"))
subprocess.run([sys.executable, "-I", os.path.join(HERE, "retone.py"), out, out + "/grades.json"], check=True)
for f in os.listdir(D + "/context/tex"):
    os.remove(D + "/context/tex/" + f)
for f in os.listdir(out + "/tex"):
    shutil.copyfile(out + "/tex/" + f, D + "/context/tex/" + f)
x = open(out + "/heritage-context.x3d").read()
x = re.sub(r"<(Background|NavigationInfo)[^>]*/>\s*", "", x)          # an Inline's bindables are never bound; drop them
x = re.sub(r'(<(?:Coordinate|TextureCoordinate) point=")([^"]+)"',
           lambda m: m.group(1) + " ".join(("%.4f" % float(t)).rstrip("0").rstrip(".") for t in m.group(2).split()) + '"', x)
open(D + "/context/heritage-context.x3d", "w").write(x)
for f in ("bake.json", "grades-applied.json"):
    shutil.copyfile(out + "/" + f, D + "/context/" + f)
print(json.dumps(dict(x3d_bytes=os.path.getsize(D + "/context/heritage-context.x3d"),
                      tex_bytes=sum(os.path.getsize(D + "/context/tex/" + f) for f in os.listdir(D + "/context/tex")))))
