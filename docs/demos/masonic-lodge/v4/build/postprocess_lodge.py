# SPDX-License-Identifier: GPL-3.0-or-later
"""Masonic Lodge v3: after the x3d-blender-io export. Usage: python3 -I postprocess_lodge.py IN.x3d OUT.x3d
  1. Background: a morning sky gradient (the add-on writes the world colour only; the Cycles sky lit the bake).
  2. NavigationInfo: EXAMINE first (the page is a turntable preview; AR has its own camera), headlight off.
  3. The capstone radiance quad goes inside a Billboard so it faces the viewer (Blender has no billboard to export).
  4. Numbers shortened.
"""
import json
import sys
import xml.etree.ElementTree as ET

src, dst = sys.argv[1:3]
tree = ET.parse(src)
root = tree.getroot()
scene = root.find("Scene")
parents = {c: p for p in root.iter() for c in p}
log = {}
for tag in ("Background", "NavigationInfo"):
    for n in list(root.iter(tag)):
        parents[n].remove(n)
        log["removed_" + tag] = log.get("removed_" + tag, 0) + 1
scene.insert(0, ET.Element("Background", {"DEF": "MorningSky", "skyAngle": "0.9 1.35 1.571",
                                           "skyColor": "0.30 0.47 0.74 0.52 0.66 0.86 0.93 0.82 0.66 0.98 0.80 0.58",
                                           "groundAngle": "1.571", "groundColor": "0.78 0.64 0.46 0.86 0.72 0.54"}))
scene.insert(0, ET.Element("NavigationInfo", {"type": '"EXAMINE" "ANY"', "headlight": "false", "speed": "30"}))
for t in list(root.iter("Transform")):
    if (t.get("DEF") or "").startswith("OB_Capstone_radiance"):
        for s in list(t.findall("Shape")):
            co = s.find(".//Coordinate")
            pts = [float(v) for v in co.get("point").split()]
            c = [sum(pts[i::3]) / (len(pts) // 3) for i in range(3)]
            co.set("point", " ".join("%.4f" % (v - c[i % 3]) for i, v in enumerate(pts)))
            t.remove(s)
            inner = ET.SubElement(t, "Transform", {"DEF": "CapstoneRadianceCentre", "translation": "%.4f %.4f %.4f" % tuple(c)})
            bb = ET.SubElement(inner, "Billboard", {"DEF": "CapstoneRadianceBillboard", "axisOfRotation": "0 0 0"})
            bb.append(s)
            log["billboard_centre"] = [round(v, 2) for v in c]


def short(values, places):
    out = []
    for tok in values.split():
        v = round(float(tok), places)
        s = ("%.*f" % (places, v)).rstrip("0").rstrip(".")
        out.append("0" if s in ("-0", "") else s)
    return " ".join(out)


for n in root.iter():
    if n.tag in ("Coordinate", "TextureCoordinate") and n.get("point"):
        n.set("point", short(n.get("point"), 3 if n.tag == "Coordinate" else 4))
    elif n.tag == "Normal" and n.get("vector"):
        n.set("vector", short(n.get("vector"), 3))
ET.SubElement(root.find("head"), "meta", {"name": "x3d-demo-postprocess", "content": "Masonic Lodge v3 postprocess_lodge.py: Background, NavigationInfo, Billboard, shortened numbers"})
ET.indent(tree, " ")
open(dst, "w", encoding="utf-8").write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
                                       + ET.tostring(root, encoding="unicode") + "\n")
print(json.dumps(log))
