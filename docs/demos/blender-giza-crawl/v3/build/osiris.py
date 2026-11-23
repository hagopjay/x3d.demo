# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2, zone "osiris": the Osiris Shaft under Khafre's causeway (Hawass 2007), plan schematic as in v1.

Style: a descent into the dark. Rock-cut shafts with chisel tracks and iron ladders, a work lamp every few metres
and black between them, Level 2's side niches with their sarcophagi, Level 3 lit from under the water: cold
blue-green on the rock, one warm lamp over the basalt sarcophagus. The lamps and ladders are stage dressing (the shaft
does have modern stairs and ladders, but not these); the page says so.
"""
import math

import bmesh
from mathutils import Vector

import geo
import mats

OX, OY = -223.0, 28.0
zA = -9.62
zB = zA - 13.25
zC = zB - 7.5
SRC = "Hawass 2007, CASAE 36, The Discovery of the Osiris Shaft at Giza"
ho = lambda what: {"grade": "Documented, plan schematic", "what": what, "source": SRC}
stage = {"grade": "Authored", "what": "Stage dressing for the descent: ladders and lamps are not survey data", "source": "this demo"}
Z = "osiris"


def ladder(bm, x, y, z0, z1, face_y, w=0.5):
    """An iron ladder against a wall: two rails and a rung every 0.3 m (thin boxes)."""
    for sx in (-w / 2, w / 2):
        geo.box_bm(bm, x + sx - 0.025, face_y - 0.1, z0, x + sx + 0.025, face_y - 0.05, z1)
    z = z0 + 0.25
    while z < z1 - 0.1:
        geo.box_bm(bm, x - w / 2, face_y - 0.1, z - 0.015, x + w / 2, face_y - 0.07, z + 0.015)
        z += 0.3


def build():
    ROCK = mats.bedrock("Osiris bedrock", tone=(0.55, 0.47, 0.36), chisel=1.4)
    ROCK2 = mats.bedrock("Osiris bedrock, deep", tone=(0.44, 0.40, 0.34), chisel=1.0)
    IRON = mats.bronze("Iron ladder")
    BAS = mats.basalt("Basalt")
    WAT = mats.water("Water")
    GRAN = mats.granite("Granite sarcophagus", polish=0.4)
    geo.tunnel("Osiris Shaft A", Vector((OX, OY, 0.0)), Vector((OX, OY, zA)), 2.0, 2.0, ROCK, ho("Shaft A, 9.62 m"), Z, 4)
    geo.room("Osiris Level 1 Chamber A", OX - 1.0, OY - 1.9, zA, OX + 7.6, OY + 1.95, zA + 2.7, ROCK, ho("Level 1, Chamber A, 8.60 x 3.85 m"), zone=Z)
    geo.tunnel("Osiris Shaft B", Vector((OX + 6.0, OY, zA)), Vector((OX + 6.0, OY, zB)), 2.0, 2.0, ROCK, ho("Shaft B, 13.25 m"), Z, 6)
    geo.room("Osiris Level 2 Chamber B", OX + 3.0, OY - 1.8, zB, OX + 9.8, OY + 1.85, zB + 2.6, ROCK2, ho("Level 2, Chamber B, 6.80 x 3.65 m, with side chambers"), zone=Z)
    # Level 2 side niches (six, as reported) each with a sarcophagus; positions schematic
    bm_n, bm_s = bmesh.new(), bmesh.new()
    for i, (nx, side) in enumerate(((OX + 4.0, -1), (OX + 6.4, -1), (OX + 8.8, -1), (OX + 4.0, 1), (OX + 6.4, 1), (OX + 8.8, 1))):
        y_wall = OY + (1.85 if side > 0 else -1.8)
        ya, yb = sorted((y_wall, y_wall + side * 2.4))
        geo.box_bm(bm_n, nx - 0.9, ya, zB, nx + 0.9, yb, zB + 1.9, inward=True, skip=("n",) if side < 0 else ("s",))
        if i in (1, 4):
            geo.box_bm(bm_s, nx - 0.55, ya + 0.25, zB, nx + 0.55, yb - 0.25, zB + 0.95)
    geo.add("Osiris Level 2 niches", bm_n, ROCK2, ho("Level 2 side chambers (positions schematic)"), Z)
    geo.add("Osiris Level 2 sarcophagi", bm_s, GRAN, ho("Two granite sarcophagi in Level 2 side chambers"), Z)
    geo.tunnel("Osiris Shaft C", Vector((OX + 9.0, OY, zB)), Vector((OX + 9.0, OY, zC)), 1.65, 1.9, ROCK2, ho("Shaft C, about 7.5 m"), Z, 4)
    geo.room("Osiris Level 3 Chamber I", OX + 6.0, OY - 4.5, zC, OX + 15.0, OY + 4.5, zC + 4.5, ROCK2, ho("Level 3, Chamber I, about 9 x 9 m, water-filled trench"), zone=Z)
    geo.block("Osiris emplacement", OX + 7.6, OY - 2.9, zC, OX + 13.4, OY + 2.9, zC + 1.0, ROCK2, ho("Rock-cut emplacement, 5.2 to 6.0 m a side"), Z)
    geo.block("Osiris sarcophagus", OX + 9.36, OY - 0.54, zC + 1.0, OX + 11.64, OY + 0.54, zC + 2.0, BAS, ho("Basalt sarcophagus, 228 x 108 cm"), Z)
    bm = bmesh.new()
    for px in (-2.3, 2.3):
        for py in (-2.3, 2.3):
            geo.box_bm(bm, OX + 10.5 + px - 0.75, OY + py - 0.75, zC + 1.0, OX + 10.5 + px + 0.75, OY + py + 0.75, zC + 2.5, skip=("bottom",))
    geo.add("Osiris pillar stumps", bm, ROCK2, ho("Four pillar stumps on the emplacement"), Z)
    # water: a single plane at 0.6 m in the trench (unbaked: drawn semi-transparent with its own sheen)
    bm = bmesh.new()
    wz = zC + 0.6
    outer = (OX + 6.05, OY - 4.45, OX + 14.95, OY + 4.45)
    inner = (OX + 7.6, OY - 2.9, OX + 13.4, OY + 2.9)
    for (a0, b0, a1, b1) in ((outer[0], outer[1], outer[2], inner[1]), (outer[0], inner[3], outer[2], outer[3]),
                             (outer[0], inner[1], inner[0], inner[3]), (inner[2], inner[1], outer[2], inner[3])):
        geo.quad(bm, (a0, b0, wz), (a1, b0, wz), (a1, b1, wz), (a0, b1, wz))
    w = geo.add("Osiris water", bm, WAT, ho("Water in the trench"))
    # stage dressing: ladders down each shaft
    bm = bmesh.new()
    ladder(bm, OX, OY, zA, 0.4, OY + 1.0)
    ladder(bm, OX + 6.0, OY, zB, zA, OY + 1.0)
    ladder(bm, OX + 9.0, OY, zC + 1.0, zB, OY + 0.95)
    geo.add("Osiris ladders", bm, IRON, stage, Z)

    # ---- light: sparse warm work lamps, then the cold water glow ------------------------------------------------------
    warm = (1.0, 0.62, 0.32)
    for i, z in enumerate((-2.5, -7.5)):
        geo.lamp("Shaft A lamp %d" % i, "POINT", 14.0, (OX - 0.7, OY - 0.7, z), warm, radius=0.04)
    geo.lamp("Level 1 lamp", "POINT", 22.0, (OX + 3.3, OY + 1.4, zA + 2.3), warm, radius=0.05)
    for i, z in enumerate((zA - 4.0, zA - 10.0)):
        geo.lamp("Shaft B lamp %d" % i, "POINT", 10.0, (OX + 6.7, OY - 0.7, z), warm, radius=0.04)
    for i, z in enumerate((zB - 2.0, zB - 5.5)):
        geo.lamp("Shaft C lamp %d" % i, "POINT", 8.0, (OX + 9.6, OY - 0.6, z), warm, radius=0.04)
    geo.lamp("Level 2 lamp", "POINT", 16.0, (OX + 6.4, OY - 2.6, zB + 1.5), (1.0, 0.5, 0.22), radius=0.05)
    geo.lamp("Level 2 niche lamp", "POINT", 6.0, (OX + 6.4, OY + 3.0, zB + 0.5), (1.0, 0.5, 0.22), radius=0.05)
    for i, (dx, dy) in enumerate(((-3.6, -3.6), (3.6, -3.6), (-3.6, 3.6), (3.6, 3.6), (0, -3.7), (0, 3.7))):
        geo.lamp("Under-water glow %d" % i, "POINT", 45.0, (OX + 10.5 + dx, OY + dy, zC + 0.25), (0.25, 0.75, 0.85), radius=0.4)
    s = geo.lamp("Sarcophagus lamp", "SPOT", 260.0, (OX + 10.5, OY, zC + 4.3), (1.0, 0.66, 0.36), radius=0.06, spot_deg=34, blend=0.3)
    geo.aim(s, (OX + 10.5, OY, zC + 1.5))
    return dict(water=w.name, levels=(zA, zB, zC))
