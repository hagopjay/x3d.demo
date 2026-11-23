# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2, zones "passages" and "chambers": the Great Pyramid's interior, positions exactly as v1 (Petrie 1883).

New in v2: the Grand Gallery has its real corbelled section (seven courses, each stepping in) instead of a box, the side
ramps are solid, the King's Chamber is laid in granite courses with its two air-shaft mouths, the Queen's Chamber has
its gabled roof, and the Subterranean Chamber's floor is rough and stepped as it was left. Lighting style: today's
visitor lighting, warm lamps raking up the walls; a cold beam down the King's Chamber southern shaft is a stylised
nod to the star-shaft readings (Authored light, documented shaft).
"""
import math

import bmesh
from mathutils import Vector

import geo
import mats

SOURCES = {
    "petrie": "Petrie 1883, The Pyramids and Temples of Gizeh, via the Giza study v2 ledger and standard secondary summaries",
    "muon": "ScanPyramids, Nature 2017 (Big Void) and 2023 (North Face Corridor)",
}
doc = lambda what, src="petrie": {"grade": "Documented", "what": what, "source": SOURCES[src]}
KX, KY = -329.0, 435.0
PX = KX + 7.29
SL_D, SL_A = math.radians(26.52), math.radians(26.03)
E = Vector((PX, KY + 115.17 - 13.31, 16.97))
dirD = Vector((0, -math.cos(SL_D), -math.sin(SL_D)))
JN = E + dirD * 28.2
BOT = E + dirD * 105.2
dirA = Vector((0, -math.cos(SL_A), math.sin(SL_A)))
AT = JN + dirA * 39.3
GT = AT + dirA * 46.7
KF = GT + Vector((0, 0, 0.9))
KCF = 43.03
KC_Y1 = GT.y - 8.4
QF = AT.z
WT = AT + Vector((-1.0, 0.2, 0.0))
WG = Vector((PX - 1.6, AT.y + 2.5, 2.0))
WB = E + dirD * 86.0
HP0 = BOT
HP1 = BOT + Vector((0, -8.8, 0))
SC = (PX + 1.0 - 14.05, HP1.y - 8.33, BOT.z - 0.4, PX + 1.0, HP1.y, -26.8)
ROCK_AT = 16.97 / math.sin(SL_D)                     # the descending passage enters the bedrock about here


def gallery(name, a, b, material, meta, zone):
    """The Grand Gallery: a polygon section swept from a to b (slope 26 deg). Floor channel 1.05 m between two ramps
    0.51 m wide and 0.53 m high; vertical walls to 2.29 m above the ramps, then seven corbel courses each stepping in
    0.076 m a side, to 8.6 m (Petrie's figures, rounded). Faces point inward."""
    hw0 = 2.06 / 2
    ch = 1.05 / 2
    ramp_h = 0.53
    wall_top = ramp_h + 2.29
    step, n = 0.076, 7
    course = (8.6 - wall_top) / n
    # section points (s, u): s across (west negative), u up; from west ramp top round to east ramp top
    sec = [(-ch, 0.0), (-ch, ramp_h), (-hw0, ramp_h), (-hw0, wall_top)]
    s = hw0
    u = wall_top
    for k in range(n):
        s -= step
        sec.append((-s, u))
        u += course
        sec.append((-s, u))
    top = list(sec)
    right = [(-p[0], p[1]) for p in reversed(top)]
    sec = top + right
    sec = [(-ch, 0.0)] + sec[1:] + [(ch, 0.0)]
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(d).normalized()
    if up.z < 0:
        up, side = -up, -side
    bm = bmesh.new()
    N = 12
    rings = []
    for k in range(N + 1):
        p = a + (b - a) * (k / N)
        # vertical "up" for the walls: the gallery's courses are level-bedded, its walls plumb; use world z for u
        rings.append([bm.verts.new(p + side * s_ + Vector((0, 0, u_))) for s_, u_ in sec])
    m = len(sec)
    for k in range(N):
        for i in range(m - 1):
            bm.faces.new((rings[k][i], rings[k][i + 1], rings[k + 1][i + 1], rings[k + 1][i]))
        bm.faces.new((rings[k][m - 1], rings[k][0], rings[k + 1][0], rings[k + 1][m - 1]))      # floor channel
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return geo.add(name, bm, material, meta, zone), sec


def rough_floor(name, x0, y0, x1, y1, z, material, meta, zone, seed=7):
    """The Subterranean Chamber's unfinished floor: a 0.25 m grid stepped into terraces with a deep trench."""
    import random
    rnd = random.Random(seed)
    nx, ny = int((x1 - x0) / 0.35), int((y1 - y0) / 0.35)
    bm = bmesh.new()
    vs = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            fx, fy = i / nx, j / ny
            h = 0.0
            if fx < 0.55:                                  # west half left high, in rough terraces
                h = 1.6 * (1 - fx / 0.55) ** 0.6
                h = math.floor(h / 0.4) * 0.4 + 0.08 * math.sin(fy * 23 + fx * 7)
            if 0.6 < fx < 0.68:                            # a trench
                h = -0.9
            h += rnd.uniform(-0.05, 0.05)
            row.append(bm.verts.new((x0 + fx * (x1 - x0), y0 + fy * (y1 - y0), z + h)))
        vs.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    return geo.add(name, bm, material, meta, zone)


def build():
    LIME = mats.limestone_blocks("Pyramid limestone (sloped courses)", course=0.62, block=1.1, slope_deg=26.3)
    LIME_L = mats.limestone_blocks("Pyramid limestone", course=0.72, block=1.3, tone=(0.80, 0.70, 0.54))
    GAL = mats.limestone_blocks("Grand Gallery limestone", course=0.82, block=1.6, tone=(0.82, 0.72, 0.56), worn=0.35)
    GRAN = mats.granite("Aswan granite")
    ROCK = mats.bedrock("Bedrock")
    GRANB = mats.granite("Aswan granite (coffer)", polish=0.25)
    P, C = "passages", "chambers"
    geo.tunnel("Descending passage (built)", E, E + dirD * ROCK_AT, 1.05, 1.20, LIME, doc("Descending passage, 1.05 x 1.20 m, 26 deg 31 min, about 105 m"), P, 8)
    geo.tunnel("Descending passage (rock-cut)", E + dirD * ROCK_AT, BOT, 1.05, 1.20, ROCK, doc("Descending passage, rock-cut section"), P, 12)
    geo.tunnel("Ascending passage", JN, AT, 1.05, 1.20, LIME, doc("Ascending passage, 1.05 x 1.20 m, 26 deg 2 min, 39.3 m"), P, 6)
    gal, sec = gallery("Grand Gallery", AT, GT, GAL, doc("Grand Gallery, 46.7 m slope length, 8.6 m high, 2.06 m wide at the floor, seven corbel courses"), "gallery")
    geo.tunnel("Antechamber passage", Vector((PX, GT.y - 1.0, KCF)), Vector((PX, GT.y - 8.4, KCF)), 1.05, 1.10, GRAN,
               doc("Low passages and antechamber, about 1.1 m high"), C)
    geo.room("Antechamber", PX - 0.6, GT.y - 5.9, KCF, PX + 0.6, GT.y - 2.9, KCF + 3.8, GRAN, doc("Antechamber, 2.97 x 1.17 x 3.8 m"), zone=C)
    kx0, kx1, ky0, ky1 = PX + 0.55 - 10.47, PX + 0.55, KC_Y1 - 5.23, KC_Y1
    GRAN = mats.granite("Aswan granite, coursed", course=1.17, block=1.9)
    geo.room("King's Chamber", kx0, ky0, KCF, kx1, ky1, KCF + 5.85, GRAN, doc("King's Chamber, 10.47 x 5.23 x 5.85 m, granite"), zone="kings")
    geo.block("Coffer", PX + 0.55 - 9.0, KC_Y1 - 3.6, KCF, PX + 0.55 - 9.0 + 2.28, KC_Y1 - 3.6 + 0.98, KCF + 1.05, GRANB,
              doc("Granite coffer, 2.28 x 0.98 x 1.05 m"), "kings")
    # air-shaft mouths, 0.21 m square, about 0.9 m up (positions schematic): dark recesses in the north and south walls
    shaft_x = kx1 - 2.5
    for yy, tag in ((ky1, "north"), (ky0, "south")):
        sgn = 1 if tag == "north" else -1
        geo.tunnel("King's Chamber %s shaft mouth" % tag, Vector((shaft_x, yy - sgn * 0.01, KCF + 0.9)), Vector((shaft_x, yy + sgn * 2.0, KCF + 0.9 + 2.0)),
                   0.21, 0.21, GRAN, {"grade": "Documented, position schematic", "what": "King's Chamber %s air shaft, about 0.21 m square" % tag,
                                       "source": SOURCES["petrie"]}, "kings")
    geo.tunnel("Queen's Chamber passage", Vector((PX, AT.y, QF)), Vector((PX, AT.y - 38.3, QF)), 1.05, 1.17, LIME_L, doc("Horizontal passage, 38.3 m, 1.17 m high"), P, 6)
    qx0, qx1, qy0, qy1 = PX - 2.9, PX + 2.85, AT.y - 38.3 - 5.23, AT.y - 38.3
    bm = bmesh.new()                                      # Queen's Chamber: walls to 4.68 m, then the gable to 6.23 m
    geo.box_bm(bm, qx0, qy0, QF, qx1, qy1, QF + 4.68, inward=True, skip=("top",))
    ridge = [bm.verts.new((qx0, (qy0 + qy1) / 2, QF + 6.23)), bm.verts.new((qx1, (qy0 + qy1) / 2, QF + 6.23))]
    eaves = [bm.verts.new(p) for p in ((qx0, qy0, QF + 4.68), (qx1, qy0, QF + 4.68), (qx1, qy1, QF + 4.68), (qx0, qy1, QF + 4.68))]
    bm.faces.new((eaves[0], ridge[0], ridge[1], eaves[1]))
    bm.faces.new((eaves[2], ridge[1], ridge[0], eaves[3]))
    bm.faces.new((eaves[1], ridge[1], eaves[2]))
    bm.faces.new((eaves[3], ridge[0], eaves[0]))
    geo.add("Queen's Chamber", bm, LIME_L, doc("Queen's Chamber, 5.75 x 5.23 m, gabled roof 6.23 m at the ridge"), C)
    geo.tunnel("Well shaft upper", WT, WG, 0.70, 0.70, ROCK, {"grade": "Documented, path schematic", "what": "Well (service) shaft, about 0.7 m square, upper leg",
                                                              "source": SOURCES["petrie"]}, P, 4)
    geo.tunnel("Well shaft lower", WG, WB + Vector((-0.6, 0, 0)), 0.70, 0.70, ROCK, {"grade": "Documented, path schematic",
               "what": "Well shaft, lower leg to the descending passage", "source": SOURCES["petrie"]}, P, 6)
    geo.tunnel("Lower horizontal passage", HP0, HP1, 0.85, 0.90, ROCK, doc("Horizontal passage to the Subterranean Chamber, about 8.8 m, 0.9 m high"), C, 2)
    sx0, sy0, sz0, sx1, sy1, sz1 = SC
    geo.room("Subterranean Chamber", sx0, sy0, sz0 - 1.0, sx1, sy1, sz1, ROCK, doc("Subterranean Chamber, 14.05 x 8.33 m, roof about 26.8 m below the pavement"),
             floor=False, zone="subterranean")
    rough_floor("Subterranean Chamber floor", sx0, sy0, sx1, sy1, sz0, ROCK, doc("Unfinished floor, left in rough steps"), "subterranean")

    # ---- light: warm visitor lamps -------------------------------------------------------------------------------------
    warm, amber = (1.0, 0.72, 0.42), (1.0, 0.60, 0.30)
    for k in range(9):                                            # descending passage: a lamp every ~12 m on the ceiling
        p = E + dirD * (6 + k * 12.0) + Vector((0, 0, 1.0))
        geo.lamp("Descending lamp %d" % k, "POINT", 9.0, p, warm, radius=0.05)
    for k in range(4):
        p = JN + dirA * (4 + k * 10.0) + Vector((0, 0, 1.0))
        geo.lamp("Ascending lamp %d" % k, "POINT", 8.0, p, warm, radius=0.05)
    for k in range(11):                                           # Grand Gallery: uplights on both ramps
        p = AT + dirA * (2.0 + k * 4.3)
        for sx in (-1, 1):
            geo.lamp("Gallery uplight %d%s" % (k, "w" if sx < 0 else "e"), "SPOT", 55.0, p + Vector((sx * 0.75, 0, 0.62)), amber, radius=0.04,
                     rot=(math.pi, 0, 0), spot_deg=110, blend=0.6)
    for k in range(3):
        p = Vector((PX, AT.y - 6 - k * 12.0, QF + 1.0))
        geo.lamp("Queen's passage lamp %d" % k, "POINT", 6.0, p, warm, radius=0.05)
    geo.lamp("Queen's Chamber lamp", "POINT", 60.0, ((qx0 + qx1) / 2, (qy0 + qy1) / 2, QF + 0.4), amber, radius=0.2)
    geo.lamp("Antechamber lamp", "POINT", 12.0, (PX, GT.y - 4.4, KCF + 2.6), warm, radius=0.05)
    geo.lamp("King's floor lamp", "POINT", 70.0, (kx0 + 1.2, ky1 - 0.7, KCF + 0.25), amber, radius=0.15)
    star = geo.lamp("Southern shaft starlight", "SPOT", 900.0, (shaft_x, ky0 + 0.15, KCF + 1.0), (0.62, 0.74, 1.0), radius=0.05, spot_deg=9, blend=0.05)
    geo.aim(star, (shaft_x, ky0 + 2.5, KCF - 1.2))
    # the beam made visible: a faint unlit cone along the spot (not baked; drawn transparent)
    BEAM = mats.G("Starlight beam")
    pb = BEAM.bsdf((0.55, 0.70, 1.0), 1.0, emit=(0.55, 0.70, 1.0), emit_strength=1.0)
    pb.inputs["Alpha"].default_value = 0.10
    BEAM.m.use_backface_culling = False
    a, b = Vector((shaft_x, ky0 + 0.12, KCF + 1.0)), Vector((shaft_x, ky0 + 2.9, KCF))
    bm = bmesh.new()
    n = 16
    ring0 = [bm.verts.new(a + Vector((0.11 * math.cos(2 * math.pi * i / n), 0, 0.11 * math.sin(2 * math.pi * i / n)))) for i in range(n)]
    ring1 = [bm.verts.new(b + Vector((0.55 * math.cos(2 * math.pi * i / n), 0.55 * math.sin(2 * math.pi * i / n) * 0.6, 0.0))) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    geo.add("Southern shaft beam", bm, BEAM.m, {"grade": "Authored", "what": "A stylised beam down the southern shaft: light, not data", "source": "this demo"})
    geo.lamp("Well shaft lamp", "POINT", 5.0, WG + Vector((0, 0, 0.3)), warm, radius=0.05)
    geo.lamp("Lower passage lamp", "POINT", 5.0, (HP0 + HP1) / 2 + Vector((0, 0, 0.6)), warm, radius=0.05)
    geo.lamp("Subterranean lamp", "POINT", 90.0, (sx1 - 3.0, (sy0 + sy1) / 2, sz0 + 0.4), (1.0, 0.55, 0.25), radius=0.2)
    return dict(kings=(kx0, ky0, kx1, ky1), shaft_x=shaft_x)
