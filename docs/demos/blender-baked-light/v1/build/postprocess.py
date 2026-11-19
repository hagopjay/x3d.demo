# SPDX-License-Identifier: GPL-3.0-or-later
"""Recipe step 6: turn the add-on's X3D 4.0 export into an unlit baked-light scene.

Strips PhysicalMaterial, Background and NavigationInfo; writes a black Background and a NavigationInfo
with the headlight off; turns ColorRGBA whose alpha is 1 everywhere into Color; shortens numbers.
Usage: python -I postprocess.py IN.x3d OUT.x3d
"""
import re
import sys
import xml.etree.ElementTree as ET

src, dst = sys.argv[1], sys.argv[2]
tree = ET.parse(src)
root = tree.getroot()
scene = root.find("Scene")
parents = {c: p for p in root.iter() for c in p}


def short(values, places):
    out = []
    for tok in values.split():
        v = round(float(tok), places)
        s = ("%.*f" % (places, v)).rstrip("0").rstrip(".")
        out.append("0" if s in ("-0", "") else s)
    return " ".join(out)


removed = {"PhysicalMaterial": 0, "Background": 0, "NavigationInfo": 0}
for tag in list(removed):
    for node in list(root.iter(tag)):
        parents[node].remove(node)
        removed[tag] += 1
for appearance in root.iter("Appearance"):
    for key in list(appearance.attrib):
        if key == "DEF":
            continue
converted = 0
for node in list(root.iter("ColorRGBA")):
    vals = node.get("color").split()
    if all(abs(float(a) - 1.0) < 1e-6 for a in vals[3::4]):
        rgb = [v for i, v in enumerate(vals) if i % 4 != 3]
        node.tag = "Color"
        node.set("color", short(" ".join(rgb), 3))
        converted += 1
        parent = parents[node]
        # Color, not ColorRGBA: the geometry still reads it per corner (colorPerVertex with colorIndex)
for node in root.iter("Coordinate"):
    node.set("point", short(node.get("point"), 4))
for node in root.iter("Normal"):
    node.set("vector", short(node.get("vector"), 3))
nav = ET.Element("NavigationInfo", {"headlight": "false", "type": '"EXAMINE" "ANY"'})
bg = ET.Element("Background", {"skyColor": "0 0 0"})
scene.insert(0, bg)
scene.insert(0, nav)
meta = ET.SubElement(root.find("head"), "meta", {"name": "x3d-demo-postprocess",
                     "content": "baked light: materials stripped, colours are display values drawn unlit"})
ET.indent(tree, "  ")
xml = ET.tostring(root, encoding="unicode")
header = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
open(dst, "w", encoding="utf-8").write(header + xml + "\n")
print({"removed": removed, "color_nodes": converted})
