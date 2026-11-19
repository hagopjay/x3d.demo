# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65: the Great Pyramid at its surveyed size, with each famous number drawn in gold beside it.

Overlays (each its own object, so the page can show one at a time through SAI):
  pi      a circle of radius = height around the base square: circumference 2 pi h against perimeter 4 b
  phi     the Kepler half-section floating east of the pyramid: half-base, height, slant
  seked   the 14 : 11 half-section (the builders' slope)
  lat     the 29.9792458 N latitude plane, the Grand Gallery and the point where they meet

Frame: Blender x east, y north, z up, metres, origin at the centre of the base. Numbers come from claims.json
(verify_numbers.py), so the scene and the verdicts share one source.
Usage: python build_numbers.py OUT_DIR ADDON_SOURCE_DIR CLAIMS_JSON
"""
import bpy
import bmesh
import importlib
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig as R  # noqa: E402
from mathutils import Vector  # noqa: E402

OUT, ADDON, CLAIMS = (os.path.abspath(a) for a in sys.argv[1:4])
os.makedirs(OUT, exist_ok=True)
C = json.load(open(CLAIMS))
B, H = C["base_m"], C["height_m"]
HB = B / 2
LAT = C["latitude"]
M_PER_DEG = 110852.4
Y_CLAIM = LAT["claim_point_north_of_centre_m"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, colour, rough=0.6, metal=0.0, emit=None, es=0.0, alpha=1.0, cull=False):
    m = R.principled(name, colour, rough, metal, alpha=alpha, emit=emit, emit_strength=es)
    m.use_backface_culling = cull
    return m


STONE = mat("Casing limestone", (0.86, 0.78, 0.62), 0.7, cull=True)
SAND = mat("Plateau sand", (0.42, 0.33, 0.22), 0.95)
GOLD = mat("Gold line", (1.0, 0.72, 0.22), 0.3, 0.6, emit=(1.0, 0.62, 0.15), es=1.2)
CYAN = mat("Cyan line", (0.3, 0.9, 1.0), 0.3, emit=(0.2, 0.85, 1.0), es=1.4)
PLANE = mat("Latitude plane", (0.2, 0.8, 1.0), 0.3, emit=(0.15, 0.7, 1.0), es=0.6, alpha=0.28)
GALLERY = mat("Grand Gallery", (1.0, 0.45, 0.2), 0.5, emit=(1.0, 0.35, 0.1), es=1.0)
MARK = mat("Claim point", (1.0, 1.0, 1.0), 0.2, emit=(1.0, 1.0, 1.0), es=2.0)


def meta(ob, d):
    ob["x3d_metadata"] = {"node": "MetadataSet", "name": "Giza_numbers", "value": [
        {"node": "MetadataString", "name": k, "value": '"%s"' % v} for k, v in d.items()]}


def obj(name, bm, material, info=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if info:
        meta(ob, info)
    return ob


def tubes(name, segments, r, material, info=None, sides=8):
    bm = bmesh.new()
    for a, b in segments:
        a, b = Vector(a), Vector(b)
        d = b - a
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r, depth=d.length)
        q = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        q.translation = (a + b) / 2
        bmesh.ops.transform(bm, matrix=q, verts=res["verts"])
    return obj(name, bm, material, info)


# ---- the pyramid at its surveyed size --------------------------------------------------------------------------------
bm = bmesh.new()
apex = bm.verts.new((0, 0, H))
cs = [bm.verts.new(p) for p in ((HB, HB, 0), (-HB, HB, 0), (-HB, -HB, 0), (HB, -HB, 0))]
for i in range(4):
    bm.faces.new((cs[i], cs[(i + 1) % 4], apex))
bm.normal_update()
for f in bm.faces:
    c = f.calc_center_median()
    if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
        f.normal_flip()
pyr = obj("Great Pyramid", bm, STONE, {"grade": "Confirmed", "base_m": "%.3f" % B, "height_m": "%.2f" % H,
                                      "source": "Dash 2015 base, Petrie 1883 slope 51 deg 52 min"})

bm = bmesh.new()
g = 900
bm.faces.new([bm.verts.new(p) for p in ((-g, -g, -0.05), (g, -g, -0.05), (g, g, -0.05), (-g, g, -0.05))])
obj("Plateau", bm, SAND)

# ---- pi: circle of radius h against the base square -------------------------------------------------------------
N = 192
ring = [(H * math.cos(2 * math.pi * k / N), H * math.sin(2 * math.pi * k / N), 0.4) for k in range(N + 1)]
tubes("Overlay pi circle", list(zip(ring[:-1], ring[1:])), 0.9, GOLD, {"what": "circle of radius = height: circumference 2 pi h"})
sq = [(HB + 0.5, HB + 0.5, 0.4), (-HB - 0.5, HB + 0.5, 0.4), (-HB - 0.5, -HB - 0.5, 0.4), (HB + 0.5, -HB - 0.5, 0.4)]
tubes("Overlay pi square", [(sq[i], sq[(i + 1) % 4]) for i in range(4)], 0.9, CYAN, {"what": "the base square: perimeter 4 b"})
tubes("Overlay pi radius", [((0, 0, 0.5), (0, 0, H)), ((0, 0, 0.5), (H, 0, 0.5))], 0.7, GOLD, {"what": "height laid flat as the radius"})

# ---- phi and seked: the half-section, floating east of the pyramid -------------------------------------------
X0 = HB + 70


def section(name, half, height, material, info):
    a, b, c = (X0, 0, 0.6), (X0, -half, 0.6), (X0, 0, height)   # centre foot, edge foot, apex (a north-south section)
    return tubes(name, [(a, b), (b, c), (c, a)], 1.0, material, info)


section("Overlay phi section", HB, H, GOLD, {"what": "half-base 1, height sqrt(phi), slant phi (Kepler triangle) against the surveyed section"})
k = 14 / 11
section("Overlay seked section", HB, HB * k, CYAN, {"what": "the 14 : 11 half-section, seked 5 1/2 palms per cubit"})
sq_s = 7.0
tubes("Overlay phi right angle", [((X0, -sq_s, 0.6), (X0, -sq_s, sq_s)), ((X0, -sq_s, sq_s), (X0, 0, sq_s))], 0.6, GOLD)

# ---- latitude: the plane, the Grand Gallery, the point where they meet ------------------------------------------
PX = 7.29
s_a, s_g = math.radians(26.03), math.radians(26.52)
E = Vector((PX, HB - 13.31, 16.97))
JN = E + Vector((0, -math.cos(s_g), -math.sin(s_g))) * 28.2
dirA = Vector((0, -math.cos(s_a), math.sin(s_a)))
AT = JN + dirA * 39.3
GT = AT + dirA * 46.7
tubes("Overlay lat gallery", [(AT, GT)], 1.1, GALLERY, {"what": "Grand Gallery floor, 46.7 m at 26 deg 2 min", "source": "Petrie 1883"}, sides=6)
tubes("Overlay lat passages", [(E, JN), (JN, AT)], 0.5, GALLERY)
t = (AT.y - Y_CLAIM) / (AT.y - GT.y)
P = AT.lerp(GT, t)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.6)
bmesh.ops.translate(bm, vec=P, verts=bm.verts)
obj("Overlay lat point", bm, MARK, {"latitude": "29.9792458 N", "north_of_centre_m": "%.2f" % Y_CLAIM})
mid = AT.lerp(GT, 0.5)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.2)
bmesh.ops.translate(bm, vec=mid, verts=bm.verts)
obj("Overlay lat gallery centre", bm, GALLERY, {"latitude": "%.7f N" % LAT["gallery_mid_lat"], "what": "midpoint of the Gallery floor"})
bm = bmesh.new()
W, T = 330, 190
bm.faces.new([bm.verts.new(p) for p in ((-W, Y_CLAIM, 0), (W, Y_CLAIM, 0), (W, Y_CLAIM, T), (-W, Y_CLAIM, T))])
obj("Overlay lat plane", bm, PLANE, {"latitude": "29.9792458 N"})
# the span: the edge latitudes of the base, as two cyan lines on the ground
tubes("Overlay lat span", [((-W, -HB, 0.4), (W, -HB, 0.4)), ((-W, HB, 0.4), (W, HB, 0.4))], 0.6, CYAN,
      {"south": "%.7f N" % LAT["south_edge_lat"], "north": "%.7f N" % LAT["north_edge_lat"]})

# ---- light and views ----------------------------------------------------------------------------------------------
def sun(name, energy, rot, colour):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy, ld.color, ld.use_shadow = energy, colour, False
    ld["x3d_energy_per_intensity"] = 1.0
    ld["x3d_intensity"] = 1
    lo = bpy.data.objects.new(name, ld)
    lo.rotation_euler = rot
    scene.collection.objects.link(lo)


sun("Low sun", 2.2, (math.radians(70), 0, math.radians(120)), (1.0, 0.78, 0.55))
sun("Dusk fill", 0.7, (math.radians(55), 0, math.radians(-60)), (0.5, 0.6, 1.0))


def cam(name, loc, at, lens=28):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.lens, c.data.clip_end = lens, 4000
    scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return c


cam("Overview", (520, -430, 210), (40, 0, 55), 30)
cam("Pi", (0, -60, 640), (0, 0, 0), 22)
cam("Phi", (X0 + 310, -60, 80), (X0, -55, 70), 30)
cam("Latitude", (260, 210, 120), (PX, Y_CLAIM, 30), 30)
cam("Gallery", (PX + 60, Y_CLAIM + 40, 46), (P.x, P.y, P.z), 26)
scene.camera = bpy.data.objects["Overview"]

# ---- export ---------------------------------------------------------------------------------------------------------
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception:
    pass
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "numbers.blend"))
xp = os.path.join(OUT, "numbers.x3d")
print(bpy.ops.export_scene.x3d(filepath=xp, x3d_version="X3D40", use_selection=False, use_animation=False))
SKY = ('<Background skyColor="0.02 0.02 0.06 0.10 0.08 0.20 0.55 0.30 0.18" skyAngle="1.1 1.55" '
       'groundColor="0.12 0.09 0.06 0.12 0.09 0.06" groundAngle="1.57" />')
x = open(xp, encoding="utf-8").read()
x, n = re.subn(r"<Background [^>]*/>", SKY, x, count=1)
if not n:
    x, n = re.subn(r"(<Scene>)", r"\1\n" + SKY, x, count=1)
open(xp, "w", encoding="utf-8").write(x)
print("pyramid base %.3f m height %.3f m; claim point (%.2f, %.2f, %.2f), %.1f along the Gallery" % (B, H, P.x, P.y, P.z, t))
