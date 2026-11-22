# SPDX-License-Identifier: GPL-3.0-or-later
"""Semantic Twins v3, heritage case: a baked context layer for the record scene (v1/data/heritage/scene.xml).

The record scene is not touched: its Boxes, DEFs, sizes, tiers and the RDF twin built from them stay exactly as in v1/v2, so
every query, SHACL check and count on the page is unchanged. This builds a separate scene in the record's own (schematic)
frame that the page adds with an Inline after the record loads:
  - a bedrock block cut on a section plane just south of the Osiris shafts, with every underground record Box carved out of
    it by a Boolean (slightly enlarged), so the translucent tier-coloured Boxes sit in real hollows in the rock;
  - the plateau surface with the shaft mouth open;
  - a Sphinx massing modelled with metaballs inside the record's SphinxBody Box (57 x 20 x 19 m), in layered limestone
    whose softer beds are eroded back, as the Sphinx's are;
  - a stepped Khufu cut through the King's Chamber so the KhufuKingsChamber and KhufuBigVoid Boxes show from the overview.
All of it is ILLUSTRATIVE context: the record's distances are schematic (Khufu is about 500 m from the shaft in reality).
Frame: X3D (x, y, z) = Blender (x, -z... ) -> Blender x = X3D x, Blender y = -X3D z, Blender z = X3D y.
Usage: Blender -b --python build_context.py -- OUT_DIR ADDON_SOURCE_DIR --record=RECORD_SCENE_XML [--profile=quick|local|g4]
"""
import importlib
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, ADDON = (os.path.abspath(a) for a in argv[:2])
RECORD = os.path.abspath(next((a.split("=", 1)[1] for a in argv if a.startswith("--record=")), argv[2] if len(argv) > 2 and not argv[2].startswith("--") else ""))
PROFILE = next((a.split("=", 1)[1] for a in argv if a.startswith("--profile=")), "local")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
T0 = time.time()
import bakery  # noqa: E402
import geo  # noqa: E402
import mats  # noqa: E402

scene = bpy.context.scene
ILL = lambda what: {"grade": "Illustrative", "what": what, "source": "context layer for the record scene; not part of the record"}

# ---- read the record's Boxes (DEF, centre, size) in X3D coordinates, convert to Blender ---------------------------------
rec = open(RECORD).read()
BOXES = {}
for m in re.finditer(r"<Transform DEF='([A-Za-z0-9]+)' translation='([^']+)'><Shape DEF='\1_Shape'>.*?<Box size='([^']+)'/>", rec, re.S):
    x, y, z = map(float, m.group(2).split())
    sx, sy, sz = map(float, m.group(3).split())
    BOXES[m.group(1)] = (Vector((x, -z, y)), Vector((sx, sz, sy)))      # Blender centre, Blender size
print("record boxes", sorted(BOXES))


def box(bm, c, s, pad=0.0):
    geo.box_bm(bm, c.x - s.x / 2 - pad, c.y - s.y / 2 - pad, c.z - s.z / 2 - pad, c.x + s.x / 2 + pad, c.y + s.y / 2 + pad, c.z + s.z / 2 + pad)


def cutter(name, build):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.hide_render = True
    return ob


def boolean(ob, cut):
    m = ob.modifiers.new("cut", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", cut, "EXACT"
    m.use_self, m.use_hole_tolerant = True, True
    if hasattr(m, "material_mode"):
        m.material_mode = "TRANSFER"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


ROCK = mats.bedrock("Plateau bedrock, strata", tone=(0.66, 0.55, 0.40), chisel=0.6)
CUT = mats.bedrock("Carved hollows", tone=(0.78, 0.68, 0.52), chisel=1.4)
SAND = mats.sand("Plateau sand")
CORE = mats.limestone_blocks("Khufu core courses", course=0.9, block=1.6, tone=(0.74, 0.60, 0.42), worn=0.9)
SECT = mats.limestone_blocks("Khufu section", course=0.9, block=1.6, tone=(0.86, 0.76, 0.60), worn=0.3)


def strata(name):
    """Sphinx limestone: beds of hard and soft rock (Members I to III of the Mokattam formation, drawn freely); soft beds are
    darker and eroded back in the geometry, the colour follows the height."""
    g = mats.G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    sep = g.n("ShaderNodeSeparateXYZ", {0: wpos}, out=None)
    z = sep.outputs[2]
    bands = g.n("ShaderNodeTexWave", {"Vector": wpos, "Scale": 0.09, "Distortion": 1.5, "Detail": 3.0}, out=1, wave_type="BANDS", bands_direction="Z")
    fine = g.noise(wpos, 3.0, 8.0, 0.62)
    col = g.ramp(bands, [(0.0, (0.52, 0.42, 0.30)), (0.35, (0.70, 0.58, 0.42)), (0.6, (0.80, 0.69, 0.52)), (1.0, (0.62, 0.50, 0.36))])
    col = g.mix(g.math("MULTIPLY", fine, 0.4), col, (0.45, 0.36, 0.26))
    col = g.mix(g.math("LESS_THAN", z, 3.0), col, (0.60, 0.48, 0.34))
    g.bsdf(col, 0.95, g.bump(g.math("ADD", bands, fine), 0.6, 0.08))
    return g.m


SPHX = strata("Sphinx, layered limestone")

# ---- rock block with the record's underground Boxes carved out ------------------------------------------------------------
under = [d for d, (c, s) in BOXES.items() if c.z - s.z / 2 < 0 and d not in ("SphinxBody",) and not d.startswith("Khufu")]
SEC_Y = 0.0                                    # section plane through the shaft centres (Blender y): the viewer stands south of it
bm = bmesh.new()
geo.box_bm(bm, -30.0, SEC_Y, -42.0, 115.0, 45.0, 0.0)
rock = geo.add("Bedrock block", bm, ROCK, ILL("Bedrock, cut on a section plane so the record's underground boxes show"), "rock")
cut = cutter("Record hollows", lambda b: [box(b, *BOXES[d], pad=0.35) for d in under])
cut.data.materials.append(CUT)
boolean(rock, cut)
bpy.data.objects.remove(cut)
# split the carved faces from the rest so they get their own (denser) texture
bpy.ops.object.select_all(action="DESELECT")
rock.select_set(True)
bpy.context.view_layer.objects.active = rock
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
for ob in [o for o in scene.objects if o.name.startswith("Bedrock block")]:
    if len(ob.data.polygons) == 0:
        bpy.data.objects.remove(ob)
        continue
    used = sorted({p.material_index for p in ob.data.polygons})
    if len(used) == 1 and used[0] != 0:
        ob.data.materials[0] = ob.data.materials[used[0]]
        for p in ob.data.polygons:
            p.material_index = 0
    ob.name = "Carved hollows" if ob.data.materials[0] is CUT else "Bedrock block"
    geo.ZONES[ob.name] = "hollows" if ob.data.materials[0] is CUT else "rock"
print("record boxes carved:", under)

# ---- plateau with the shaft mouth open, and the record's south side left open for the section view -------------------------
mouth = BOXES.get("OsirisShaftA", (Vector((0, 0, 0)), Vector((1.2, 1.2, 1))))[0]
bm = bmesh.new()
X = [-260.0, -30.0, mouth.x - 1.2, mouth.x + 1.2, 115.0, 200.0]
Y = [-160.0, SEC_Y, mouth.y - 1.2, mouth.y + 1.2, 45.0, 260.0]
for i in range(len(X) - 1):
    for j in range(len(Y) - 1):
        cx, cy = (X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2
        if X[2] < cx < X[3] and Y[2] < cy < Y[3]:
            continue                                           # the shaft mouth
        if -30 < cx < 115 and cy < SEC_Y:
            continue                                           # in front of the section: open, so the cut can be seen
        geo.quad(bm, (X[i], Y[j], 0.01), (X[i + 1], Y[j], 0.01), (X[i + 1], Y[j + 1], 0.01), (X[i], Y[j + 1], 0.01))
geo.add("Plateau", bm, SAND, ILL("Plateau surface"), "ground")

# ---- the Sphinx, modelled with metaballs inside the record's SphinxBody box ------------------------------------------------
if "SphinxBody" in BOXES:
    c, s = BOXES["SphinxBody"]
    x0, z0 = c.x - s.x / 2, c.z - s.z / 2                    # tail end (west), base
    mb = bpy.data.metaballs.new("Sphinx")
    mb.resolution = 0.9 if PROFILE != "quick" else 1.6
    mb.render_resolution = mb.resolution
    mb.threshold = 0.22                                 # low threshold: the parts' fields overlap and melt together
    mbo = bpy.data.objects.new("Sphinx metaballs", mb)
    scene.collection.objects.link(mbo)

    def blob(kind, x, y, z, r, size=(1, 1, 1), neg=False):
        e = mb.elements.new()
        e.type = kind
        e.co = (x0 + x * s.x, c.y + y * s.y, z0 + z * s.z)
        e.radius = r
        if kind == "ELLIPSOID":
            e.size_x, e.size_y, e.size_z = size
        e.use_negative = neg
    # radius in metres, size as proportions: big radii make the fields overlap so the parts melt into one body
    blob("ELLIPSOID", 0.42, 0.0, 0.26, 13.0, (1.35, 0.42, 0.45))         # body
    blob("ELLIPSOID", 0.74, 0.0, 0.56, 5.5, (0.8, 0.7, 1.0))            # neck
    blob("ELLIPSOID", 0.17, 0.0, 0.24, 8.0, (1.0, 0.8, 0.75))            # haunch
    blob("ELLIPSOID", 0.70, 0.0, 0.38, 8.0, (0.9, 0.75, 0.95))           # chest
    for side in (-0.22, 0.22):
        blob("ELLIPSOID", 0.86, side, 0.09, 5.0, (2.2, 0.5, 0.45))      # forepaws, out to the east
    blob("ELLIPSOID", 0.80, 0.0, 0.74, 4.5, (0.85, 0.75, 0.9))          # head
    blob("ELLIPSOID", 0.78, 0.0, 0.67, 5.0, (0.7, 1.05, 0.8))           # nemes headdress
    blob("BALL", 0.86, 0.0, 0.74, 2.6)                                   # face
    blob("ELLIPSOID", 0.50, 0.0, 0.03, 14.0, (2.0, 0.65, 0.12))         # the rock base the body rises from
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    mbo.select_set(True)
    bpy.context.view_layer.objects.active = mbo
    bpy.ops.object.convert(target="MESH")
    sph = bpy.context.view_layer.objects.active
    sph.name = "Sphinx"
    sph.data.materials.clear()
    sph.data.materials.append(SPHX)
    for p in sph.data.polygons:
        p.use_smooth = True
    sph["x3d_metadata"] = {"node": "MetadataSet", "name": "Context", "value": [
        {"node": "MetadataString", "name": "grade", "value": '"Illustrative"'},
        {"node": "MetadataString", "name": "what", "value": '"Sphinx massing, metaballs, inside the record\'s SphinxBody box; not a survey"'}]}
    geo.ZONES[sph.name] = "sphinx"

# ---- Khufu, stepped, cut through the King's Chamber so its box shows ------------------------------------------------------
KX = KY = 0.0
if "KhufuKingsChamber" in BOXES:
    kc = BOXES["KhufuKingsChamber"][0]
    KX, KY = kc.x - 2.6, kc.y + 11.7                         # the King's Chamber lies about 2.6 m east, 11.7 m south of the centre
    bm = bmesh.new()
    N, base, top_w, top_z = 140, 230.33, 10.0, 138.5
    rings, z = [], 0.0
    for i in range(N):
        h = (1.45 + (0.55 - 1.45) * i / (N - 1)) * top_z / (N * 1.0)
        w = base / 2 - (base / 2 - top_w / 2) * i / N
        rings += [(w, z), (w, z + h)]
        z += h
    k = top_z / z
    vs = [[bm.verts.new((KX + sx * w, KY + sy * w, zz * k)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for w, zz in rings]
    for a, b in zip(vs, vs[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(vs[0])))
    bm.faces.new(vs[-1])
    kh = geo.add("Khufu", bm, CORE, ILL("Great Pyramid, stepped core at true size, placed round the record's King's Chamber box"), "khufu")
    half = cutter("Khufu south half", lambda b: geo.box_bm(b, KX - 200, KY - 200, -10, KX + 200, kc.y, 200))
    half.data.materials.append(SECT)
    boolean(kh, half)
    hollows = cutter("Khufu record hollows", lambda b: [box(b, *BOXES[d], pad=0.5) for d in BOXES if d.startswith("Khufu")])
    hollows.data.materials.append(CUT)
    boolean(kh, hollows)
    for o in (half, hollows):
        bpy.data.objects.remove(o)

# ---- light: afternoon sun from the south-west, warm; a soft sky ----------------------------------------------------------
sun = geo.lamp("Afternoon sun", "SUN", 4.0, (0, 0, 0), (1.0, 0.84, 0.64), radius=0.5)
az, el = math.radians(232), math.radians(34)
d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
geo.lamp("Section fill", "SUN", 0.8, (0, 0, 0), (0.75, 0.82, 1.0), rot=(math.radians(70), 0, math.radians(180)))
for d in under:                                                   # a warm lamp in each hollow (the record boxes glow there)
    c = BOXES[d][0]
    geo.lamp("Hollow lamp " + d, "POINT", 25.0, (c.x, c.y - 0.2, c.z), (1.0, 0.7, 0.4), radius=0.2)
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.45, 0.65, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
scene.world = world

# ---- bake, export -----------------------------------------------------------------------------------------------------------
bakery.setup_cycles(128)
DENS = {"rock": 8.0, "hollows": 40.0, "ground": 1.2, "sphinx": 20.0, "khufu": 4.0}
SMP, DIV, GLOSS, MUL = 128, 4, False, 1.0
if PROFILE == "quick":
    SMP, MUL = 32, 0.25
elif PROFILE == "g4":
    SMP, DIV, GLOSS, MUL = 512, 2, True, 1.6
for name in [o.name for o in scene.objects if o.type == "MESH" and o.name.startswith("Khufu") and o.name not in geo.ZONES]:
    geo.ZONES[name] = "khufu"
recs = []
for name, zone in list(geo.ZONES.items()):
    ob = bpy.data.objects.get(name)
    if ob is None or len(ob.data.polygons) == 0:
        continue
    uv = (lambda o: bakery.unwrap_slope(o, KX, KY, math.degrees(math.atan2(138.5, 230.33 / 2 - 5.0)))) if zone == "khufu" else None
    r = bakery.bake_object(ob, OUT, DENS[zone] * MUL, SMP, 0.0, light_div=DIV, gloss=GLOSS, cull=zone in ("khufu", "sphinx"), uv=uv)
    r["zone"] = zone
    recs.append(r)
for o in [o for o in scene.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception as e:  # noqa: BLE001
    print("register:", e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "heritage-context.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "heritage-context.x3d"), x3d_version="X3D40", use_selection=False, path_mode="RELATIVE"))
json.dump(dict(blender=bpy.app.version_string, profile=PROFILE, device=scene.cycles.device, device_backend=os.environ.get("BAKE_DEVICE", "METAL"),
               samples=SMP, light_div=DIV, record_boxes_carved=under, build_seconds=round(time.time() - T0, 1), objects=recs),
          open(os.path.join(OUT, "bake.json"), "w"), indent=1)
print("DONE build_s", round(time.time() - T0, 1))
