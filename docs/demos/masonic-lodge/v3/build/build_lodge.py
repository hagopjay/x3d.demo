# SPDX-License-Identifier: GPL-3.0-or-later
"""Masonic Lodge XR v3: the Giza model that stands over each lodge, rebuilt in Blender as a section drawing in stone.

Khufu is built course by course (stepped core, the casing gone, top platform at 138.5 m today) and cut by a Boolean on the
plane of its passages, 7.29 m east of the axis, so the descending and ascending passages, the Grand Gallery, the Queen's and
King's Chambers, the five relieving chambers above it, and the Subterranean Chamber in the bedrock open as real voids in the cut
face, each lit from inside. An excavation pit east of the cut shows the bedrock part. Khafre keeps its casing near the top;
Menkaure has its granite lower courses. A gilt capstone hovers at Khufu's original apex height (146.6 m): Authored, a symbol of
the lodge, not Giza data (no capstone is known). Golden morning sun from the east-south-east, Cycles light baked into textures.

Frame: Blender x east, y north, z up, metres, origin at the centre of Khufu's base (X3D: x east, y up, z south). Sizes:
Khufu 230.33 m base, 146.6 m original height (Petrie); interior positions as in Giza Crawl (Petrie 1883); Khafre 215.25 m /
143.5 m, Menkaure 102.2 m / 65.5 m and their positions as in v1/v2 of this demo (Wikipedia figures); courses illustrative.

Usage: Blender -b --python build_lodge.py -- OUT_DIR ADDON_SOURCE_DIR [--profile=quick|local|g4]
Writes OUT_DIR/giza-lodge.x3d (raw export), giza-lodge.blend, tex/, cache/, bake.json.
"""
import importlib
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, ADDON = os.path.abspath(argv[0]), os.path.abspath(argv[1])
PROFILE = next((a.split("=", 1)[1] for a in argv if a.startswith("--profile=")), "local")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
T0 = time.time()
import bakery  # noqa: E402
import geo  # noqa: E402
import mats  # noqa: E402

scene = bpy.context.scene
PET = "Petrie 1883 (Khufu and its interior, as in Giza Crawl)"
WIKI = "Wikipedia: Pyramid of Khafre, Pyramid of Menkaure (as in Masonic Lodge v1/v2)"
doc = lambda what, src=PET: {"grade": "Documented", "what": what, "source": src}
auth = lambda what: {"grade": "Authored", "what": what, "source": "this demo"}

# ---- interior (Giza Crawl frame shifted to Khufu's centre) ---------------------------------------------------------------
PX = 7.29
SL_D, SL_A = math.radians(26.52), math.radians(26.03)
E = Vector((PX, 115.17 - 13.31, 16.97))
dD = Vector((0, -math.cos(SL_D), -math.sin(SL_D)))
JN = E + dD * 28.2
BOT = E + dD * 105.2
dA = Vector((0, -math.cos(SL_A), math.sin(SL_A)))
AT = JN + dA * 39.3
GT = AT + dA * 46.7
KCF = 43.03
KC_Y1 = GT.y - 8.4
QF = AT.z
HP1 = BOT + Vector((0, -8.8, 0))


def prism(bm, a, b, w, h):
    """Closed box from floor-centre a to b, width w, height h square to the floor (a Boolean cutter)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    s = d.cross(Vector((0, 0, 1)))
    s = Vector((1, 0, 0)) if s.length < 1e-6 else s.normalized()
    u = s.cross(d).normalized()
    if u.z < 0:
        u, s = -u, -s
    c = [a + s * x + u * z for x, z in ((-w / 2, 0), (w / 2, 0), (w / 2, h), (-w / 2, h))]
    e = [b + s * x + u * z for x, z in ((-w / 2, 0), (w / 2, 0), (w / 2, h), (-w / 2, h))]
    va, vb = [bm.verts.new(p) for p in c], [bm.verts.new(p) for p in e]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((va[i], va[j], vb[j], vb[i]))
    bm.faces.new(list(reversed(va)))
    bm.faces.new(vb)


def solid_box(bm, x0, y0, z0, x1, y1, z1):
    geo.box_bm(bm, x0, y0, z0, x1, y1, z1)


def cutter(name, build, material):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def stepped(bm, cx, cy, base, top_w, top_z, courses, z0=0.0, h0=1.45, h1=0.55):
    """A closed stepped pyramid: `courses` square steps from `base` wide at z0 to `top_w` at top_z; course height eases
    from h0 at the bottom to h1 at the top (illustrative; Khufu's real courses vary irregularly)."""
    hs = [h0 + (h1 - h0) * (k / (courses - 1)) for k in range(courses)]
    k = (top_z - z0) / sum(hs)
    hs = [h * k for h in hs]
    rings, z = [], z0
    for i, h in enumerate(hs):
        w = base / 2 - (base / 2 - top_w / 2) * (i / courses)
        rings += [(w, z), (w, z + h)]
        z += h
    vs = []
    for w, zz in rings:
        vs.append([bm.verts.new((cx + sx * w, cy + sy * w, zz)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for a, b in zip(vs, vs[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(vs[0])))
    bm.faces.new(vs[-1])


def boolean(ob, cut, op="DIFFERENCE"):
    m = ob.modifiers.new("cut " + cut.name, "BOOLEAN")
    m.operation = op
    m.object = cut
    m.solver = "EXACT"
    m.use_self = True                 # the void cutter is many overlapping prisms in one mesh
    m.use_hole_tolerant = True
    if hasattr(m, "material_mode"):
        m.material_mode = "TRANSFER"
    bpy.context.view_layer.objects.active = ob
    n0 = len(ob.data.polygons)
    bpy.ops.object.modifier_apply(modifier=m.name)
    print("BOOL", ob.name, cut.name, n0, "->", len(ob.data.polygons), "cutter polys", len(cut.data.polygons))


# ---- materials ---------------------------------------------------------------------------------------------------------
CORE = mats.limestone_blocks("Khufu core courses", course=0.9, block=1.6, tone=(0.74, 0.60, 0.42), worn=0.9)
SECTION = mats.limestone_blocks("Section face (cut stone)", course=1.3, block=2.4, tone=(0.88, 0.78, 0.62), joint_w=0.05, worn=0.5)
VOID = mats.limestone_blocks("Passages and chambers", course=0.6, block=1.1, tone=(0.82, 0.70, 0.52), worn=0.4)
GRAN = mats.granite("King's Chamber granite", course=1.17, block=1.9)
ROCK = mats.bedrock("Giza bedrock", tone=(0.62, 0.52, 0.38))
CASING = mats.limestone_blocks("Khafre casing", course=1.6, block=3.0, tone=(0.90, 0.82, 0.66), joint_w=0.004, worn=0.25)
REDG = mats.granite("Menkaure granite", polish=0.6, course=1.5, block=2.6)
SAND = mats.sand("Plateau sand")
GILT = mats.gilt("Capstone gilt", tone=(0.95, 0.66, 0.20))
GLOW = mats.sprite("Capstone radiance", "radiance.png", 3.0)

# ---- Khufu: stepped core, cut on the passage plane --------------------------------------------------------------------
bm = bmesh.new()
stepped(bm, 0, 0, 230.33, 10.0, 138.5, 150)
geo.add("Khufu", bm, CORE, doc("Great Pyramid core, 230.33 m base; casing gone, top platform about 138.5 m today; course heights illustrative"), "khufu")
khufu = bpy.data.objects["Khufu"]
# bedrock under the pyramid (sectioned too): the Subterranean Chamber lies in it
bm = bmesh.new()
solid_box(bm, -150, -150, -45, 150, 150, 0)
geo.add("Bedrock", bm, ROCK, doc("Bedrock under the pyramid (the Subterranean Chamber is cut in it)"), "khufu")
bedrock = bpy.data.objects["Bedrock"]
half = cutter("East half (removed)", lambda b: solid_box(b, PX, -200, -60, 200, 200, 200), SECTION)
voids = cutter("Interior voids", lambda b: [
    prism(b, E + dD * -2, BOT, 1.05, 1.20),                                     # descending passage (runs out of the face a little)
    prism(b, JN, AT, 1.05, 1.20),                                               # ascending passage
    prism(b, AT, GT, 2.06, 8.6),                                                # Grand Gallery (box section; corbels are in Giza Crawl)
    solid_box(b, PX - 0.6, GT.y - 8.4, KCF, PX + 0.6, GT.y - 1.0, KCF + 1.1),   # low passages and antechamber
    solid_box(b, PX - 0.6, GT.y - 5.9, KCF, PX + 0.6, GT.y - 2.9, KCF + 3.8),
    prism(b, Vector((PX, AT.y, QF)), Vector((PX, AT.y - 38.3, QF)), 1.05, 1.17),  # Queen's passage
    solid_box(b, PX - 2.9, AT.y - 43.53, QF, PX + 2.85, AT.y - 38.3, QF + 6.23),  # Queen's Chamber
    prism(b, BOT, HP1, 0.85, 0.9),                                              # lower horizontal passage
    solid_box(b, PX + 1.0 - 14.05, HP1.y - 8.33, BOT.z - 0.4, PX + 1.0, HP1.y, -26.8),  # Subterranean Chamber
], VOID)
kings = cutter("King's Chamber void", lambda b: [
    solid_box(b, PX + 0.55 - 10.47, KC_Y1 - 5.23, KCF, PX + 0.55, KC_Y1, KCF + 5.85),
    *[solid_box(b, PX + 0.55 - 10.47, KC_Y1 - 5.23, KCF + 5.85 + 1.4 + k * 2.1, PX + 0.55, KC_Y1, KCF + 5.85 + 2.3 + k * 2.1) for k in range(5)],
], GRAN)
for target in (khufu, bedrock):
    boolean(target, half)
    boolean(target, voids)
    boolean(target, kings)
# split the cut stone and the voids into their own objects so each gets its own texture density
for target in (khufu, bedrock):
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
for ob in list(scene.objects):
    if ob.type == "MESH" and not ob.hide_render and len(ob.data.polygons) == 0:
        bpy.data.objects.remove(ob)                    # separate-by-material can leave the original object empty
        continue
    if ob.type != "MESH" or ob.hide_render or not ob.data.materials:
        continue
    used = sorted({p.material_index for p in ob.data.polygons})
    if len(used) == 1 and used[0] != 0:               # name the part after the material its faces actually use
        ob.data.materials[0] = ob.data.materials[used[0]]
        for p in ob.data.polygons:
            p.material_index = 0
    print("PART", ob.name, len(ob.data.polygons), ob.data.materials[0].name)
    mname = ob.data.materials[0].name
    base = "Khufu" if ob.name.startswith("Khufu") else "Bedrock" if ob.name.startswith("Bedrock") else None
    if base is None:
        continue
    part = {"Khufu core courses": "outer courses", "Giza bedrock": "rock", "Section face (cut stone)": "section face",
            "Passages and chambers": "passages and chambers", "King's Chamber granite": "King's Chamber and relieving chambers"}.get(mname, mname)
    ob.name = "%s %s" % (base, part)
    geo.ZONES[ob.name] = "khufu"
for k in [k for k in list(geo.ZONES) if k not in bpy.data.objects]:
    del geo.ZONES[k]

# ---- Khafre and Menkaure -------------------------------------------------------------------------------------------------
# Petrie's offsets from Khufu's centre (as the Sky Machine uses): Khafre and Menkaure lie to the SOUTH-west.
# v1 and v2 of this demo placed them north-west (X3D z = -420 / -780); v3 corrects that.
KHA, MEN = (-13165.8 * 0.0254, -13931.6 * 0.0254), (-22616.0 * 0.0254, -29102.0 * 0.0254)
bm = bmesh.new()
stepped(bm, *KHA, 215.25, 52.0, 105.0, 110)
geo.add("Khafre core", bm, CORE, doc("Pyramid of Khafre, 215.25 m base, 143.5 m original height", WIKI), "neighbours")
bm = bmesh.new()                                     # the casing kept near the top, a smooth cap
b0, h0, top = 52.0 + 2.0, 105.0, 136.4
apex = bm.verts.new((KHA[0], KHA[1], top))
cs = [bm.verts.new((KHA[0] + sx * b0 / 2, KHA[1] + sy * b0 / 2, h0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
for i in range(4):
    bm.faces.new((cs[i], cs[(i + 1) % 4], apex))
bm.faces.new(list(reversed(cs)))
geo.add("Khafre casing cap", bm, CASING, doc("Khafre's surviving casing near the apex (extent illustrative)", WIKI), "neighbours")
bm = bmesh.new()
stepped(bm, *MEN, 102.2, 6.0, 62.0, 70)
geo.add("Menkaure core", bm, CORE, doc("Pyramid of Menkaure, 102.2 m base, 65.5 m original height", WIKI), "neighbours")
bm = bmesh.new()
stepped(bm, *MEN, 104.0, 85.0, 9.5, 8, h0=1.2, h1=1.2)
geo.add("Menkaure granite casing", bm, REDG, doc("Menkaure's lower courses cased in red granite (extent illustrative)", WIKI), "neighbours")

# ---- ground with an excavation pit east of the cut ----------------------------------------------------------------------
P0x, P1x, P0y, P1y, PZ = PX, PX + 70.0, -150.0, 150.0, -45.0
bm = bmesh.new()
X = [-1100.0, -150.0, P0x, P1x, 160.0, 700.0]
Y = [-700.0, P0y, P1y, 1300.0]
for i in range(len(X) - 1):
    for j in range(len(Y) - 1):
        cx, cy = (X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2
        if P0x < cx < P1x and P0y < cy < P1y:
            continue
        if -150 < cx < P0x and P0y < cy < P1y:
            continue                                  # the pyramid and its bedrock block stand here
        geo.quad(bm, (X[i], Y[j], 0), (X[i + 1], Y[j], 0), (X[i + 1], Y[j + 1], 0), (X[i], Y[j + 1], 0))
bmh = bmesh.new()
geo.quad(bmh, (-150, -150, 0.02), (P0x, -150, 0.02), (P0x, 150, 0.02), (-150, 150, 0.02))
geo.add("Plateau sand", bm, SAND, {"grade": "Illustrative", "what": "Plateau surface", "source": "this demo"}, "ground")
geo.add("Plateau sand round Khufu", bmh, SAND, {"grade": "Illustrative", "what": "Plateau surface", "source": "this demo"}, "ground")
bm = bmesh.new()
geo.quad(bm, (P0x, P0y, PZ), (P1x, P0y, PZ), (P1x, P1y, PZ), (P0x, P1y, PZ))          # pit floor
geo.quad(bm, (P1x, P0y, PZ), (P1x, P0y, 0), (P1x, P1y, 0), (P1x, P1y, PZ))             # east wall faces west
geo.quad(bm, (P0x, P0y, 0), (P0x, P0y, PZ), (P1x, P0y, PZ), (P1x, P0y, 0))             # south wall faces north
geo.quad(bm, (P0x, P1y, PZ), (P0x, P1y, 0), (P1x, P1y, 0), (P1x, P1y, PZ))             # north wall faces south
for f in bm.faces:
    f.normal_update()
geo.add("Excavation pit", bm, ROCK, auth("A cutaway pit so the bedrock section can be seen; not a real excavation"), "ground")

# ---- the capstone (Authored) ------------------------------------------------------------------------------------------------
bm = bmesh.new()
cz, cb, ch = 141.0, 9.0, 5.6                          # hovers so its tip sits at the original apex, 146.6 m
apex = bm.verts.new((0, 0, cz + ch))
cs = [bm.verts.new((sx * cb / 2, sy * cb / 2, cz)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
for i in range(4):
    bm.faces.new((cs[i], cs[(i + 1) % 4], apex))
bm.faces.new(list(reversed(cs)))
geo.add("Capstone (symbolic)", bm, GILT, auth("A gilt capstone at Khufu's original apex height, 146.6 m: the lodge's symbol, not Giza data; no capstone is known"), "capstone")
bm = bmesh.new()                                      # a flat quad facing Blender +z: the X3D Billboard turns +z to the viewer
uvl = bm.loops.layers.uv.new("UVMap")
f = geo.quad(bm, (-15, -15, cz + 2.5), (15, -15, cz + 2.5), (15, 15, cz + 2.5), (-15, 15, cz + 2.5))
for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop[uvl].uv = t
geo.add("Capstone radiance", bm, GLOW, auth("Radiance round the symbolic capstone"))

# ---- light: golden morning sun from the east-south-east, warm lamps in every void ----------------------------------------
sun = geo.lamp("Morning sun", "SUN", 3.0, (0, 0, 0), (1.0, 0.80, 0.56), radius=0.5)
az, el = math.radians(112), math.radians(17)
d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
sun.data.angle = math.radians(1.2)
warm = (1.0, 0.62, 0.30)
for name, p, e in (("King's lamp", (PX - 4.8, KC_Y1 - 2.6, KCF + 2.2), 380), ("Queen's lamp", (PX - 1.0, AT.y - 41, QF + 2.5), 260),
                   ("Gallery lamp low", AT + dA * 8 + Vector((PX * 0 - 0.6, 0, 3.0)), 320), ("Gallery lamp high", AT + dA * 34 + Vector((-0.6, 0, 3.0)), 320),
                   ("Subterranean lamp", (PX - 6, HP1.y - 4.2, -28.5), 320), ("Antechamber lamp", (PX - 0.3, GT.y - 4.4, KCF + 2.5), 60)):
    geo.lamp(name, "POINT", e, p, warm, radius=0.3)
for k in range(5):
    geo.lamp("Relieving lamp %d" % k, "POINT", 30, (PX - 3.0, KC_Y1 - 2.6, KCF + 5.85 + 1.85 + k * 2.1), warm, radius=0.15)
for k, t in enumerate((0.25, 0.55, 0.8)):
    geo.lamp("Descending lamp %d" % k, "POINT", 35, E + (BOT - E) * t + Vector((-0.3, 0, 0.6)), warm, radius=0.1)
    geo.lamp("Ascending lamp %d" % k, "POINT", 30, JN + (AT - JN) * t + Vector((-0.3, 0, 0.6)), warm, radius=0.1)
world = bpy.data.worlds.new("Morning sky")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
sky = world.node_tree.nodes.new("ShaderNodeTexSky")
try:
    sky.sky_type = "MULTIPLE_SCATTERING"
except TypeError:
    pass
try:
    sky.sun_elevation, sky.sun_rotation = el, math.radians(90 - 112 + 90)
except AttributeError:
    pass
world.node_tree.links.new(sky.outputs[0], bg.inputs[0])
bg.inputs[1].default_value = 1.0
scene.world = world

# ---- cameras --------------------------------------------------------------------------------------------------------------
def cam(name, loc, look, lens):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.lens = lens
    scene.collection.objects.link(c)
    c.location = loc
    geo.aim(c, look)
    return c


scene.camera = cam("Section", (300, -170, 95), (0, -10, 45), 30)
cam("Into the section", (75, -48, 52), (PX, -10, 30), 24)
cam("King's Chamber and relieving chambers", (32, -4, 52), (PX - 4, KC_Y1 - 2.6, KCF + 7), 30)
cam("The three pyramids", (380, 260, 260), (-340, -420, 20), 30)
cam("Capstone", (40, -60, 150), (0, 0, 143), 40)

# ---- bake, export -----------------------------------------------------------------------------------------------------------
bakery.setup_cycles(128)
DENS = {"khufu": 5.0, "neighbours": 3.0, "ground": 1.0, "capstone": 80.0}
FINE = {"Khufu section face": 14.0, "Bedrock section face": 14.0, "Khufu passages and chambers": 40.0, "Bedrock passages and chambers": 40.0,
        "Khufu King's Chamber and relieving chambers": 40.0, "Excavation pit": 6.0, "Plateau sand round Khufu": 6.0}
SMP, DIV, GLOSS, MUL = 128, 4, False, 1.0
if PROFILE == "quick":
    SMP, MUL = 32, 0.25
elif PROFILE == "g4":
    SMP, DIV, GLOSS, MUL = 512, 2, True, 1.6
for o in [o for o in scene.objects if o.type == "MESH" and o.name not in geo.ZONES]:
    o.hide_render = True
_ang = lambda base, top_w, top_z: math.degrees(math.atan2(top_z, base / 2 - top_w / 2))
SLOPE_UV = {"Khufu outer courses": (0.0, 0.0, _ang(230.33, 10.0, 138.5)), "Khafre core": (*KHA, _ang(215.25, 52.0, 105.0)),
            "Menkaure core": (*MEN, _ang(102.2, 6.0, 62.0)), "Menkaure granite casing": (*MEN, _ang(104.0, 85.0, 9.5))}
recs = []
for name, zone in list(geo.ZONES.items()):
    ob = bpy.data.objects[name]
    tpm = FINE.get(name, DENS[zone]) * MUL
    slope = SLOPE_UV.get(name)
    uv = (lambda o, s=slope: bakery.unwrap_slope(o, *s)) if slope else None
    r = bakery.bake_object(ob, OUT, tpm, SMP, 0.0, light_div=DIV, gloss=GLOSS, combined=zone == "capstone",
                           cull=zone in ("khufu", "neighbours"), uv=uv)
    r["zone"] = "interior" if name in FINE and "section" not in name and "pit" not in name.lower() and "sand" not in name else zone
    recs.append(r)
for o in scene.objects:
    if o.type == "MESH" and not o.name.startswith(("East half", "Interior voids", "King's Chamber void")):
        o.hide_render = False
for o in [o for o in scene.objects if o.type == "MESH" and o.name.startswith(("East half", "Interior voids", "King's Chamber void"))]:
    bpy.data.objects.remove(o)
for o in [o for o in scene.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)
import shutil  # noqa: E402
for img in bpy.data.images:
    if img.filepath and os.path.basename(img.filepath) == "radiance.png":
        dst = os.path.join(OUT, "tex", "radiance.png")
        shutil.copyfile(bpy.path.abspath(img.filepath), dst)
        img.filepath = dst
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception as e:  # noqa: BLE001
    print("register:", e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "giza-lodge.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "giza-lodge.x3d"), x3d_version="X3D40", use_selection=False, path_mode="RELATIVE"))
json.dump(dict(blender=bpy.app.version_string, profile=PROFILE, device=scene.cycles.device, device_backend=os.environ.get("BAKE_DEVICE", "METAL"),
               samples=SMP, light_div=DIV, build_seconds=round(time.time() - T0, 1), objects=recs), open(os.path.join(OUT, "bake.json"), "w"), indent=1)
print("DONE build_s", round(time.time() - T0, 1))
