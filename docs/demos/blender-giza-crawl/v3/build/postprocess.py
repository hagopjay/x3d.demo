# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: the steps after the x3d-blender-io export, each one a thing the exporter does not carry (README:
"what the exporter carried or lost"). Usage: python3 -I postprocess.py IN.x3d OUT.x3d
  1. Background: the add-on writes the world colour; the 2560 BC star cube (sky_cube.py) is added as six face urls.
  2. Fog: Blender's mist/volume has no exported equivalent; one Fog node (DEF Fog, off until the page sets a range).
  3. NavigationInfo: FLY first with a walking-pace speed and the headlight off (lit surfaces are baked; the headlight
     would only flatten the explorer).
  4. Numbers are shortened (coordinates 4 places, normals and texture coordinates 4) to cut the file.
Prints a JSON summary of what it changed.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

src, dst = sys.argv[1], sys.argv[2]
tree = ET.parse(src)
root = tree.getroot()
scene = root.find("Scene")
parents = {c: p for p in root.iter() for c in p}
log = {}


def short(values, places):
    out = []
    for tok in values.split():
        try:
            v = round(float(tok), places)
        except ValueError:
            out.append(tok)
            continue
        s = ("%.*f" % (places, v)).rstrip("0").rstrip(".")
        out.append("0" if s in ("-0", "") else s)
    return " ".join(out)


for tag in ("Background", "NavigationInfo", "Fog"):
    for node in list(root.iter(tag)):
        parents[node].remove(node)
        log["removed_" + tag] = log.get("removed_" + tag, 0) + 1
faces = {k: '"sky/sky-%s.jpg"' % k for k in ("front", "back", "left", "right", "top", "bottom")}
bg = ET.Element("Background", {"DEF": "Sky", "skyColor": "0 0 0", **{k + "Url": v for k, v in faces.items()}})
nav = ET.Element("NavigationInfo", {"DEF": "Nav", "type": '"FLY" "EXAMINE" "ANY"', "speed": "2", "headlight": "false",
                                     "avatarSize": "0.25 1.6 0.75", "visibilityLimit": "0"})
fog = ET.Element("Fog", {"DEF": "Fog", "fogType": "EXPONENTIAL", "color": "0.02 0.015 0.01", "visibilityRange": "0"})
for i, n in enumerate((nav, bg, fog)):
    scene.insert(i, n)
n_pts = 0
for node in root.iter():
    if node.tag == "Coordinate" and node.get("point"):
        node.set("point", short(node.get("point"), 4))
        n_pts += 1
    elif node.tag == "Normal" and node.get("vector"):
        node.set("vector", short(node.get("vector"), 3))
    elif node.tag == "TextureCoordinate" and node.get("point"):
        node.set("point", short(node.get("point"), 4))
    elif node.tag.endswith("Interpolator") and node.get("keyValue"):
        node.set("keyValue", short(node.get("keyValue"), 4))
        node.set("key", short(node.get("key"), 5))
log.update(coordinates_shortened=n_pts, background_faces=6, fog="EXPONENTIAL, off until the page sets visibilityRange",
           navigation="FLY EXAMINE ANY, speed 2, headlight off")
head = root.find("head")
ET.SubElement(head, "meta", {"name": "x3d-demo-postprocess", "content": "Giza Crawl v2 postprocess.py: sky Background faces, Fog, NavigationInfo, shortened numbers"})
ET.indent(tree, " ")
xml = ET.tostring(root, encoding="unicode")
header = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
open(dst, "w", encoding="utf-8").write(header + xml + "\n")
print(json.dumps(log))
