# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 63: an H-Anim explorer walks, stoops, crawls and climbs through the Great Pyramid, the Osiris Shaft and an
imagined Hall of Records. One Blender scene, exported to X3D 4.0 by x3d-blender-io.

Frame: Blender x east, y north, z up, metres; origin at the Sphinx, as in the Giza study v2 (Khufu centre (-329, 435)).
Documented geometry uses published figures (see SOURCES below); links between sites and the Hall are Authored and the
page says so. Walls face inward and are single-sided, so the inside reads from within and the outside shows a cutaway.

Usage: python build_crawl.py OUT_DIR ADDON_SOURCE_DIR
"""
import bpy
import bmesh
import importlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig as R  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

OUT, ADDON = (os.path.abspath(a) for a in sys.argv[1:3])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FPS = 8
scene.render.fps = FPS

SOURCES = {
    "petrie": "Petrie 1883, The Pyramids and Temples of Gizeh, via the Giza study v2 ledger and standard secondary summaries",
    "muon": "ScanPyramids, Nature 2017 (Big Void) and 2023 (North Face Corridor)",
    "hawass": "Hawass 2007, CASAE 36, The Discovery of the Osiris Shaft at Giza",
    "cayce": "Edgar Cayce trance readings, 1930s and 1940s (a legend: no hall has been found)",
}

# ---- materials ----------------------------------------------------------------------------------------------------
def mat(name, colour, rough=0.85, cull=True, alpha=1.0, emit=None, es=0.0):
    m = R.principled(name, colour, rough, alpha=alpha, emit=emit, emit_strength=es)
    m.use_backface_culling = cull
    return m


LIME = mat("Limestone", (0.80, 0.70, 0.52))
GRANITE = mat("Aswan granite", (0.46, 0.30, 0.27), 0.55)
BEDROCK = mat("Bedrock", (0.58, 0.48, 0.36), 0.95)
CASING = mat("Pyramid shell", (0.86, 0.76, 0.56), 0.9, cull=False, alpha=0.18)
SAND = mat("Plateau", (0.76, 0.62, 0.42), 0.95, cull=False)
AUTH = mat("Authored", (0.62, 0.30, 0.66), 0.7, emit=(0.55, 0.20, 0.65), es=0.6)
WATER = mat("Water", (0.05, 0.14, 0.32), 0.1, cull=False, alpha=0.6)
BASALT = mat("Basalt", (0.10, 0.10, 0.11), 0.4, cull=False)
GOLD = mat("Imagined archive", (0.90, 0.72, 0.30), 0.4, cull=False, emit=(0.9, 0.6, 0.2), es=0.8)

OBJECTS = []


def add(name, bm, material, meta=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if meta:
        ob["x3d_metadata"] = {"node": "MetadataSet", "name": "Giza", "value": [
            {"node": "MetadataString", "name": k, "value": '"%s"' % v} for k, v in meta.items()]}
    OBJECTS.append(name)
    return ob


def quad(bm, a, b, c, d):
    vs = [bm.verts.new(p) for p in (a, b, c, d)]
    bm.faces.new(vs)


def tunnel(name, a, b, w, h, material, meta):
    """Hollow rectangular passage, inward faces only. a, b: floor-centre points; h measured square to the floor."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:                               # vertical shaft
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    if up.z < 0:
        up = -up
        side = -side
    hw = w / 2
    c = lambda p, s, u: p + side * s + up * u
    bm = bmesh.new()
    A = [c(a, -hw, 0), c(a, hw, 0), c(a, hw, h), c(a, -hw, h)]
    B = [c(b, -hw, 0), c(b, hw, 0), c(b, hw, h), c(b, -hw, h)]
    for i in range(4):
        j = (i + 1) % 4
        quad(bm, A[i], A[j], B[j], B[i])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)          # inward
    return add(name, bm, material, meta)


def room(name, x0, y0, z0, x1, y1, z1, material, meta, floor=True):
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=__import__("mathutils").Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
                        @ __import__("mathutils").Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)), verts=res["verts"])
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    if not floor:
        for f in list(bm.faces):
            if f.normal.z > 0.9:
                bm.faces.remove(f)
    return add(name, bm, material, meta)


def block(name, x0, y0, z0, x1, y1, z1, material, meta=None):
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    M = __import__("mathutils").Matrix
    bmesh.ops.transform(bm, matrix=M.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ M.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)),
                        verts=res["verts"])
    return add(name, bm, material, meta)


# ---- the Great Pyramid ------------------------------------------------------------------------------------------------
KX, KY = -329.0, 435.0
PX = KX + 7.29                                # passages lie 7.29 m east of the north-south axis (Petrie)
SL_D, SL_A = math.radians(26.52), math.radians(26.03)
doc = lambda what, src="petrie": {"grade": "Documented", "what": what, "source": SOURCES[src]}

E = Vector((PX, KY + 115.17 - 13.31, 16.97))                                     # entrance floor (Petrie)
dirD = Vector((0, -math.cos(SL_D), -math.sin(SL_D)))
JN = E + dirD * 28.2                                                             # junction with the ascending passage
BOT = E + dirD * 105.2                                                           # foot of the descending passage
tunnel("Descending passage", E, BOT, 1.05, 1.20, LIME, doc("Descending passage, 1.05 x 1.20 m, 26 deg 31 min, about 105 m"))
dirA = Vector((0, -math.cos(SL_A), math.sin(SL_A)))
AT = JN + dirA * 39.3
tunnel("Ascending passage", JN, AT, 1.05, 1.20, LIME, doc("Ascending passage, 1.05 x 1.20 m, 26 deg 2 min, 39.3 m"))
GT = AT + dirA * 46.7
tunnel("Grand Gallery", AT, GT, 2.06, 8.6, LIME, doc("Grand Gallery, 46.7 m slope length, 8.6 m high, 2.06 m wide at the floor"))
for sx in (-1, 1):                              # the two side ramps
    a, b = AT + Vector((sx * 0.78, 0, 0)), GT + Vector((sx * 0.78, 0, 0))
    bm = bmesh.new()
    up = Vector((0, 0, 0.52))
    quad(bm, a + up + Vector((-0.25, 0, 0)), a + up + Vector((0.25, 0, 0)), b + up + Vector((0.25, 0, 0)), b + up + Vector((-0.25, 0, 0)))
    add("Gallery ramp %s" % ("west" if sx < 0 else "east"), bm, LIME)
KF = GT + Vector((0, 0, 0.9))                                                    # the Great Step, then the King's level
KCF = 43.03
tunnel("Antechamber passage", Vector((PX, GT.y - 1.0, KCF)), Vector((PX, GT.y - 8.4, KCF)), 1.05, 1.10, GRANITE,
       doc("Low passages and antechamber, about 1.1 m high"))
room("Antechamber", PX - 0.6, GT.y - 5.9, KCF, PX + 0.6, GT.y - 2.9, KCF + 3.8, GRANITE, doc("Antechamber, 2.97 x 1.17 x 3.8 m"))
KC_Y1 = GT.y - 8.4
room("King's Chamber", PX + 0.55 - 10.47, KC_Y1 - 5.23, KCF, PX + 0.55, KC_Y1, KCF + 5.85, GRANITE, doc("King's Chamber, 10.47 x 5.23 x 5.85 m, granite"))
block("Coffer", PX + 0.55 - 9.0, KC_Y1 - 3.6, KCF, PX + 0.55 - 9.0 + 2.28, KC_Y1 - 3.6 + 0.98, KCF + 1.05, GRANITE, doc("Granite coffer, 2.28 x 0.98 x 1.05 m"))
QF = AT.z
tunnel("Queen's Chamber passage", Vector((PX, AT.y, QF)), Vector((PX, AT.y - 38.3, QF)), 1.05, 1.17, LIME, doc("Horizontal passage, 38.3 m, 1.17 m high"))
room("Queen's Chamber", PX - 2.9, AT.y - 38.3 - 5.23, QF, PX + 2.85, AT.y - 38.3, QF + 6.23, LIME, doc("Queen's Chamber, 5.75 x 5.23 m, 6.23 m to the gable"))
# the well shaft, drawn as two straight legs (its real path is irregular): Gallery foot to the grotto, grotto to the lower descending passage
WT = AT + Vector((-1.0, 0.2, 0.0))
WG = Vector((PX - 1.6, AT.y + 2.5, 2.0))
WB = E + dirD * 86.0
tunnel("Well shaft upper", WT, WG, 0.70, 0.70, BEDROCK, {"grade": "Documented, path schematic", "what": "Well (service) shaft, about 0.7 m square, upper leg", "source": SOURCES["petrie"]})
tunnel("Well shaft lower", WG, WB + Vector((-0.6, 0, 0)), 0.70, 0.70, BEDROCK, {"grade": "Documented, path schematic", "what": "Well shaft, lower leg to the descending passage", "source": SOURCES["petrie"]})
HP0 = BOT
HP1 = BOT + Vector((0, -8.8, 0))
tunnel("Lower horizontal passage", HP0, HP1, 0.85, 0.90, BEDROCK, doc("Horizontal passage to the Subterranean Chamber, about 8.8 m, 0.9 m high"))
SC = (PX + 1.0 - 14.05, HP1.y - 8.33, BOT.z - 0.4, PX + 1.0, HP1.y, -26.8)
room("Subterranean Chamber", *SC, BEDROCK, doc("Subterranean Chamber, 14.05 x 8.33 m, roof about 26.8 m below the pavement"))
block("Big Void (muons)", KX - 1.3, KY - 23, 58, KX + 1.3, KY + 7, 66, mat("Muon void", (0.3, 0.8, 1.0), 0.5, cull=False, alpha=0.25),
      {"grade": "Documented by muon imaging, shape and position schematic", "what": "Big Void, at least 30 m long", "source": SOURCES["muon"]})
# the pyramid itself: a faint shell so the passages read from outside
bm = bmesh.new()
h, b2 = 146.6, 230.33 / 2
apex = bm.verts.new((KX, KY, h))
cs = [bm.verts.new((KX + sx * b2, KY + sy * b2, 0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
for i in range(4):
    bm.faces.new((cs[i], cs[(i + 1) % 4], apex))
add("Great Pyramid shell", bm, CASING, {"grade": "Documented", "what": "Great Pyramid, 230.33 m base, 146.6 m original height", "source": SOURCES["petrie"]})

# ---- the Osiris Shaft (Hawass 2007), under Khafre's causeway -------------------------------------------------------
OX, OY = -223.0, 28.0
ho = lambda what: {"grade": "Documented, plan schematic", "what": what, "source": SOURCES["hawass"]}
zA = -9.62
tunnel("Osiris Shaft A", Vector((OX, OY, 0.0)), Vector((OX, OY, zA)), 2.0, 2.0, BEDROCK, ho("Shaft A, 9.62 m"))
room("Osiris Level 1 Chamber A", OX - 1.0, OY - 1.9, zA, OX + 7.6, OY + 1.95, zA + 2.7, BEDROCK, ho("Level 1, Chamber A, 8.60 x 3.85 m"))
zB = zA - 13.25
tunnel("Osiris Shaft B", Vector((OX + 6.0, OY, zA)), Vector((OX + 6.0, OY, zB)), 2.0, 2.0, BEDROCK, ho("Shaft B, 13.25 m"))
room("Osiris Level 2 Chamber B", OX + 3.0, OY - 1.8, zB, OX + 9.8, OY + 1.85, zB + 2.6, BEDROCK, ho("Level 2, Chamber B, 6.80 x 3.65 m, with side chambers"))
zC = zB - 7.5
tunnel("Osiris Shaft C", Vector((OX + 9.0, OY, zB)), Vector((OX + 9.0, OY, zC)), 1.65, 1.9, BEDROCK, ho("Shaft C, about 7.5 m"))
room("Osiris Level 3 Chamber I", OX + 6.0, OY - 4.5, zC, OX + 15.0, OY + 4.5, zC + 4.5, BEDROCK, ho("Level 3, Chamber I, about 9 x 9 m, water-filled trench"))
block("Osiris water trench", OX + 6.1, OY - 4.4, zC, OX + 14.9, OY + 4.4, zC + 0.6, WATER, ho("Water in the trench"))
block("Osiris emplacement", OX + 7.6, OY - 2.9, zC, OX + 13.4, OY + 2.9, zC + 1.0, BEDROCK, ho("Rock-cut emplacement, 5.2 to 6.0 m a side"))
block("Osiris sarcophagus", OX + 9.36, OY - 0.54, zC + 1.0, OX + 11.64, OY + 0.54, zC + 2.0, BASALT, ho("Basalt sarcophagus, 228 x 108 cm"))
for px in (-2.3, 2.3):
    for py in (-2.3, 2.3):
        block("Osiris pillar stump", OX + 10.5 + px - 0.75, OY + py - 0.75, zC + 1.0, OX + 10.5 + px + 0.75, OY + py + 0.75, zC + 2.5, BEDROCK)

# ---- the Hall of Records (Cayce legend): AUTHORED, no such hall is known ------------------------------------------
HX, HY, HZ = 125.0, -18.0, -26.0
auth = {"grade": "Authored", "what": "Imagined: Cayce's Hall of Records. No hall has been found; size and shape are invented", "source": SOURCES["cayce"]}
T0 = Vector((36.0, -6.0, -2.0))
T1 = Vector((HX - 28.0, HY, HZ))
tunnel("Imagined tunnel to the Hall", T0, T1, 2.2, 2.6, AUTH, auth)
room("Imagined Hall of Records", HX - 28, HY - 15, HZ, HX + 28, HY + 15, HZ + 11, AUTH, auth)
for row in (-7, 7):
    for i in range(8):
        x = HX - 24 + i * 6.8
        block("Imagined pillar", x - 0.6, HY + row - 0.6, HZ, x + 0.6, HY + row + 0.6, HZ + 11, AUTH)
for side in (-1, 1):
    for i in range(12):
        x = HX - 22 + i * 4
        block("Imagined archive case", x - 0.9, HY + side * 14.2 - 0.3, HZ, x + 0.9, HY + side * 14.2 + 0.3, HZ + 2.6, GOLD)

# plateau with holes where the shaft mouths are, so the chase camera can pass
bm = bmesh.new()
HOLES = [(OX - 1.0, OY - 1.0, OX + 1.0, OY + 1.0), (T0.x - 1.5, T0.y - 1.5, T0.x + 1.5, T0.y + 1.5)]
xs = sorted({-600.0, 300.0, *[h[0] for h in HOLES], *[h[2] for h in HOLES]})
ys = sorted({-200.0, 600.0, *[h[1] for h in HOLES], *[h[3] for h in HOLES]})
for i in range(len(xs) - 1):
    for j in range(len(ys) - 1):
        cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
        if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in HOLES):
            continue
        quad(bm, (xs[i], ys[j], 0), (xs[i + 1], ys[j], 0), (xs[i + 1], ys[j + 1], 0), (xs[i], ys[j + 1], 0))
add("Giza plateau", bm, SAND)

# ---- the route ---------------------------------------------------------------------------------------------------------
# legs: (mode, speed m/s, end point, caption, grade); "cut" teleports; "look" holds in place
LEGS = []
leg = lambda mode, speed, to, cap, grade="Documented", face=None: LEGS.append(dict(mode=mode, speed=speed, to=Vector(to), cap=cap, grade=grade, face=face))
START = E + Vector((0, 6.0, 0)) + Vector((0, 0, 0))
leg("walk", 1.2, E, "The entrance, 16.97 m up the north face, 7.29 m east of the axis")
leg("stoop", 0.8, JN, "Down the descending passage: 1.20 m high, 26.5 degrees")
leg("stoop", 0.75, AT, "Up the ascending passage, 39.3 m")
leg("walk", 1.1, GT - dirA * 0.5, "The Grand Gallery: 8.6 m of corbelled roof over your head")
leg("climb", 0.5, KF, "The Great Step")
leg("crawl", 0.55, Vector((PX, GT.y - 8.4, KCF)), "Through the low passages and the antechamber")
leg("walk", 1.0, Vector((PX - 7.0, KC_Y1 - 3.0, KCF)), "The King's Chamber: 10.47 x 5.23 m of Aswan granite")
leg("look", 4.0, Vector((PX - 7.0, KC_Y1 - 3.0, KCF)), "The empty granite coffer", face=(-1, 0))
leg("cut", 0, WT + Vector((0, 0.3, 0)), "Fast-forward to the foot of the Grand Gallery and the well shaft", grade="Cut")
leg("climb", 0.6, WG, "Down the well shaft, a rough service shaft about 0.7 m square (path schematic)", grade="Documented, path schematic", face=(0, -1))
leg("climb", 0.8, WB + Vector((-0.6, 0, 0)), "Still descending, toward the bottom of the descending passage", grade="Documented, path schematic", face=(0, -1))
leg("stoop", 0.8, BOT, "The last 19 m of the descending passage, now below the bedrock surface")
leg("crawl", 0.55, HP1, "On hands and knees: the horizontal passage is about 0.9 m high")
leg("walk", 1.0, Vector((PX - 6.0, HP1.y - 4.2, SC[2])), "The Subterranean Chamber, 27 to 30 m under the pavement, never finished")
leg("look", 4.0, Vector((PX - 6.0, HP1.y - 4.2, SC[2])), "Rough-cut bedrock: the floor was never levelled", face=(-1, 0))
leg("cut", 0, Vector((OX + 1.5, OY - 3.0, 0.0)), "No known tunnel joins these places. Cut to Khafre's causeway, 490 m away", grade="Cut")
leg("walk", 1.0, Vector((OX + 0.0, OY - 1.0, 0.0)), "The mouth of the Osiris Shaft, under Khafre's causeway")
leg("climb", 0.5, Vector((OX, OY - 0.6, zA)), "Shaft A, 9.62 m down", grade="Documented, plan schematic", face=(0, -1))
leg("walk", 1.0, Vector((OX + 6.0, OY - 0.6, zA)), "Level 1, Chamber A", grade="Documented, plan schematic")
leg("climb", 0.5, Vector((OX + 6.0, OY - 0.6, zB)), "Shaft B, 13.25 m down", grade="Documented, plan schematic", face=(0, -1))
leg("walk", 1.0, Vector((OX + 9.0, OY - 0.6, zB)), "Level 2, Chamber B and its side chambers", grade="Documented, plan schematic")
leg("climb", 0.5, Vector((OX + 9.0, OY - 0.6, zC + 1.0)), "Shaft C, about 7.5 m, down to the water", grade="Documented, plan schematic", face=(0, -1))
leg("walk", 0.8, Vector((OX + 9.0, OY - 3.6, zC + 1.0)), "Level 3: a water-filled trench round a rock-cut emplacement", grade="Documented, plan schematic")
leg("look", 4.0, Vector((OX + 9.0, OY - 3.6, zC + 1.0)), "The basalt sarcophagus, 228 x 108 cm", grade="Documented, plan schematic", face=(1, 1))
leg("cut", 0, T0 + Vector((0.0, 0.0, 0.0)), "Now the legend. Edgar Cayce's Hall of Records, under the Sphinx's right paw. Everything ahead is invented", grade="Cut")
leg("walk", 1.3, T1, "An imagined tunnel: no such passage is known", grade="Authored")
leg("walk", 1.2, Vector((HX + 12.0, HY, HZ)), "An imagined hall: size, pillars and archive cases are inventions", grade="Authored")
leg("kneel", 4.0, Vector((HX + 12.0, HY, HZ)), "Kneeling at an imagined archive. In the readings, records of a lost civilisation", grade="Authored", face=(1, 0))

# ---- build the timeline: one sample per frame ---------------------------------------------------------------------
explorer, pb = R.build_figure(scene, "Explorer")
s_sign, r_sign = R.forward_sign(explorer, pb)
carrier = bpy.data.objects.new("Explorer path", None)
scene.collection.objects.link(carrier)
explorer.parent = carrier
BLEND_T = 0.7
samples = []           # (t, pos, heading, mode, phase, leg index)
t, pos, heading, phase = 0.0, START.copy(), math.pi, 0.0
prev_mode = "walk"
chapters = []
dt = 1.0 / FPS


def heading_of(v, fallback):
    if Vector((v.x, v.y)).length < 1e-4:
        return fallback
    return math.atan2(v.y, v.x) - math.pi / 2


STRIDE = {"walk": 1.4, "stoop": 0.9, "crawl": 0.55, "climb": 0.6, "look": 1.0, "kneel": 1.0}
for i, L in enumerate(LEGS):
    chapters.append({"t": round(t, 2), "caption": L["cap"], "grade": L["grade"], "mode": L["mode"]})
    if L["mode"] == "cut":
        pos = L["to"].copy()
        samples.append(dict(t=t, pos=pos.copy(), h=heading, mode=prev_mode, phase=phase, leg=i, cut=True))
        continue
    if L["mode"] in ("look", "kneel"):
        dur = L["speed"]
        target_h = math.atan2(L["face"][1], L["face"][0]) - math.pi / 2 if L["face"] else heading
        n = max(1, int(round(dur * FPS)))
        h0 = heading
        while target_h - h0 > math.pi: target_h -= 2 * math.pi
        while target_h - h0 < -math.pi: target_h += 2 * math.pi
        for k in range(n):
            u = min(1.0, (k + 1) / (n * 0.4))
            heading = h0 + (target_h - h0) * u
            samples.append(dict(t=t, pos=pos.copy(), h=heading, mode=L["mode"], phase=phase, leg=i, look=math.sin(t * 0.9) * 0.5))
            t += dt
        prev_mode = L["mode"]
        continue
    a, b = pos.copy(), L["to"]
    dist = (b - a).length
    n = max(1, int(round(dist / L["speed"] * FPS)))
    vert = L["mode"] == "climb" and abs(b.z - a.z) > 0.8 * dist
    target_h = (math.atan2(L["face"][1], L["face"][0]) - math.pi / 2) if L["face"] else heading_of(b - a, heading)
    h0 = heading
    while target_h - h0 > math.pi: target_h -= 2 * math.pi
    while target_h - h0 < -math.pi: target_h += 2 * math.pi
    for k in range(n):
        u = (k + 1) / n
        p = a + (b - a) * u
        heading = h0 + (target_h - h0) * min(1.0, (k + 1) / max(1, FPS * 0.6))
        phase += (dist / n) / STRIDE[L["mode"]]
        samples.append(dict(t=t, pos=p, h=heading, mode=L["mode"], phase=phase % 1.0, leg=i))
        t += dt
    pos = b.copy()
    prev_mode = L["mode"]
TOTAL = t
F_END = len(samples)
scene.frame_start, scene.frame_end = 1, F_END

# blend the gait parameters over BLEND_T seconds at every mode change
modes = [s["mode"] for s in samples]
nb = int(BLEND_T * FPS)
for f, s in enumerate(samples):
    p = R.MODES[s["mode"]]
    if f > 0:
        # find the last mode change before f within the blend window
        for back in range(1, nb + 1):
            if f - back < 0:
                break
            if modes[f - back] != s["mode"]:
                prevp = R.MODES[modes[f - back]]
                p = R.blend(prevp, p, back / (nb + 1))
                break
    frame = f + 1
    carrier.location = s["pos"]
    carrier.rotation_euler = (0, 0, s["h"])
    carrier.keyframe_insert("location", frame=frame)
    carrier.keyframe_insert("rotation_euler", frame=frame)
    R.pose(pb, s_sign, r_sign, p, s["phase"], s.get("look", 0.0))
    R.key_pose(pb, frame)
for fc in (carrier.animation_data.action.fcurves if hasattr(carrier.animation_data.action, "fcurves") else []):
    for kp in fc.keyframe_points:
        kp.interpolation = "CONSTANT" if False else "LINEAR"

# ---- headlamp, chamber lamps, sun -----------------------------------------------------------------------------------
def lamp(name, kind, energy, loc, colour=(1, 1, 1), parent=None, rot=None, epi=None, atten=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy, ld.color = energy, colour
    ld.use_shadow = False
    ld["x3d_energy_per_intensity"] = epi if epi else (4 * math.pi if kind != "SUN" else 1.0)
    ld["x3d_intensity"] = 1
    if atten:
        ld["x3d_attenuation"] = atten
    if kind == "SPOT":
        ld.spot_size = math.radians(70)
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    if rot:
        lo.rotation_euler = rot
    if parent:
        lo.parent = parent
    scene.collection.objects.link(lo)
    return lo


lamp("Headlamp", "SPOT", 40.0, (0, 0.25, 1.72), (1.0, 0.95, 0.85), parent=carrier, rot=(math.radians(80), 0, 0), atten=[0, 0.25, 0.05])
lamp("Sun", "SUN", 2.6, (0, 0, 0), (1.0, 0.92, 0.80), rot=(math.radians(40), 0, math.radians(30)))
lamp("Sky fill", "SUN", 0.8, (0, 0, 0), (0.7, 0.8, 1.0), rot=(math.radians(70), 0, math.radians(210)))
for name, loc, col in (("King's Chamber lamp", (PX - 5, KC_Y1 - 2.6, KCF + 4.5), (1.0, 0.8, 0.6)),
                       ("Subterranean lamp", (PX - 6, HP1.y - 4.2, -27.6), (1.0, 0.78, 0.55)),
                       ("Osiris lamp", (OX + 10.5, OY, zC + 3.8), (0.7, 0.85, 1.0)),
                       ("Hall glow", (HX + 12, HY, HZ + 8), (1.0, 0.6, 1.0))):
    lamp(name, "POINT", 60.0, loc, col, atten=[0, 0.2, 0.06])

# ---- cameras: a chase camera that trails along the walked path, plus overviews ------------------------------------
chase = bpy.data.objects.new("Chase", bpy.data.cameras.new("Chase"))
chase.data.lens = 16
scene.collection.objects.link(chase)
chase.rotation_mode = "QUATERNION"
path_s = [0.0]
for f in range(1, F_END):
    jump = samples[f].get("cut") or (samples[f]["pos"] - samples[f - 1]["pos"]).length > 5
    path_s.append(0.0 if jump else path_s[-1] + (samples[f]["pos"] - samples[f - 1]["pos"]).length)
seg_start = [0] * F_END
for f in range(1, F_END):
    seg_start[f] = f if path_s[f] == 0.0 else seg_start[f - 1]
prevq = None
cam_pos = None
for f in range(F_END):
    s = samples[f]
    back = 3.0
    g = f
    while g > seg_start[f] and path_s[f] - path_s[g] < back:
        g -= 1
    trail = samples[g]["pos"]
    hd = Vector((-math.sin(s["h"]), math.cos(s["h"]), 0))
    if (s["pos"] - trail).length < 0.6:              # standing still or at a cut: sit behind the heading
        trail = s["pos"] - hd * 1.8
    eye_h = {"crawl": 0.75, "stoop": 0.95, "climb": 1.2}.get(s["mode"], 1.45)
    want = trail + Vector((0, 0, eye_h))
    if s["mode"] == "climb":
        # shafts are too narrow to film from inside: stand outside the wall (walls face inward and
        # are back-face culled, so the near wall vanishes) and look in, like a section drawing
        side = Vector((math.cos(s["h"]), math.sin(s["h"]), 0))
        want = s["pos"] + side * 2.8 - hd * 0.9 + Vector((0, 0, 0.9))
    jump = s.get("cut") or (f > 0 and (s["pos"] - samples[f - 1]["pos"]).length > 5)
    cam_pos = want if (cam_pos is None or jump) else cam_pos.lerp(want, 0.45)
    target = s["pos"] + Vector((0, 0, {"crawl": 0.45, "climb": 0.8}.get(s["mode"], 1.0))) + hd * (0.0 if s["mode"] == "climb" else 0.6)
    q = (target - cam_pos).to_track_quat("-Z", "Y")
    if prevq is not None and prevq.dot(q) < 0:
        q.negate()
    prevq = q
    chase.location = cam_pos
    chase.rotation_quaternion = q
    chase.keyframe_insert("location", frame=f + 1)
    chase.keyframe_insert("rotation_quaternion", frame=f + 1)


def fixed_cam(name, loc, look, lens=24):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.lens = lens
    scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return c


fixed_cam("Pyramid cutaway", (KX + 170, KY + 150, 70), (KX + 7, KY + 40, 5), 26)
fixed_cam("Osiris section", (OX + 40, OY - 28, -6), (OX + 6, OY, -17), 24)
fixed_cam("Imagined hall", (HX - 26, HY - 13, HZ + 9), (HX + 10, HY, HZ + 2), 16)
scene.camera = chase

# ---- export -------------------------------------------------------------------------------------------------------
scene.frame_set(1)
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception:
    pass
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "crawl.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "crawl.x3d"), x3d_version="X3D40", use_selection=False, use_animation=True))
mode_time = {}
for s in samples:
    mode_time[s["mode"]] = mode_time.get(s["mode"], 0) + dt
json.dump({"seconds": round(TOTAL, 2), "fps": FPS, "frames": F_END, "chapters": chapters, "sources": SOURCES,
           "mode_seconds": {k: round(v, 1) for k, v in mode_time.items()},
           "metres_walked": round(sum((samples[f]["pos"] - samples[f - 1]["pos"]).length for f in range(1, F_END)
                                      if (samples[f]["pos"] - samples[f - 1]["pos"]).length < 5), 1)},
          open(os.path.join(OUT, "route.json"), "w"), indent=1)
print("seconds", round(TOTAL, 1), "frames", F_END, "chapters", len(chapters), "signs", s_sign, r_sign)
