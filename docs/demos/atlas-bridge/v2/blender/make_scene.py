#!/usr/bin/env python3
"""make_scene: the v2 blockout is authored in Blender, not in X3D.

A vaulted scriptorium, built with things an X3D primitive blockout cannot say in one node: a barrel vault,
arched window openings, bevelled stone and wood, a slanted lectern. Twelve Blender cameras
ring the room. Writes scriptorium.blend; export_and_render.py takes it from there.

  python make_scene.py <out.blend>
"""
import math, random, sys
import bpy, bmesh
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else sys.argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
random.seed(77)

L, Wd, H, T = 9.0, 6.0, 3.2, 0.5          # inside length (x), width (y), springing height, wall thickness
R = Wd / 2                                  # vault radius


def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m


M = {"stone": mat("Tufa", (0.62, 0.42, 0.33)), "floor": mat("Basalt", (0.10, 0.10, 0.11), 0.5), "oak": mat("Oak", (0.36, 0.22, 0.11), 0.55),
     "plaster": mat("Plaster", (0.80, 0.74, 0.62), 0.9), "vellum": mat("Vellum", (0.86, 0.80, 0.64), 0.7), "iron": mat("Iron", (0.10, 0.10, 0.11), 0.5, 0.9),
     "wool": mat("WoolRed", (0.45, 0.08, 0.07), 0.95), "leatherA": mat("LeatherOx", (0.33, 0.07, 0.06), 0.6), "leatherB": mat("LeatherGreen", (0.08, 0.20, 0.13), 0.6),
     "leatherC": mat("LeatherTan", (0.48, 0.30, 0.14), 0.6), "leatherD": mat("LeatherBlue", (0.07, 0.12, 0.28), 0.6), "wax": mat("Wax", (0.90, 0.85, 0.70), 0.4)}
COUNT = [0]


def finish(o, name, m, bevel=0.0):
    o.name = name
    o.data.name = name
    o.data.materials.append(M[m])
    COUNT[0] += 1
    o.pass_index = COUNT[0]
    if bevel:
        b = o.modifiers.new("Bevel", "BEVEL"); b.width = bevel; b.segments = 2; b.limit_method = "ANGLE"
    return o


def box(name, c, s, m, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=rot)
    o = bpy.context.object
    o.scale = s
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, name, m, bevel)


def cyl(name, c, r, h, m, verts=24, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=c, rotation=rot)
    return finish(bpy.context.object, name, m, bevel)


# --- shell -----------------------------------------------------------------------------------------------
box("Floor", (0, 0, -0.15), (L + 2 * T, Wd + 2 * T, 0.3), "floor")
south = box("WallSouth", (0, -(Wd + T) / 2, H / 2), (L + 2 * T, T, H), "stone")
north = box("WallNorth", (0, (Wd + T) / 2, H / 2), (L + 2 * T, T, H), "stone")
box("WallWest", (-(L + T) / 2, 0, (H + R + 0.4) / 2), (T, Wd + 2 * T, H + R + 0.4), "stone")
box("WallEast", ((L + T) / 2, 0, (H + R + 0.4) / 2), (T, Wd + 2 * T, H + R + 0.4), "stone")

# barrel vault: a half-cylinder shell along x, springing at z = H
bm = bmesh.new()
SEG, tv = 28, 0.35
ring = []
for i in range(SEG + 1):
    a = math.pi * i / SEG
    for r in (R, R + tv):
        for x in (-(L / 2 + T), L / 2 + T):
            ring.append(bm.verts.new((x, -r * math.cos(a), H + r * math.sin(a))))
for i in range(SEG):
    a, b = ring[i * 4:(i + 1) * 4], ring[(i + 1) * 4:(i + 2) * 4]      # each: [in-x0, in-x1, out-x0, out-x1]
    bm.faces.new((a[0], a[1], b[1], b[0]))                              # intrados (faces the room)
    bm.faces.new((a[2], b[2], b[3], a[3]))                              # extrados
    bm.faces.new((a[0], b[0], b[2], a[2]))
    bm.faces.new((a[1], a[3], b[3], b[1]))
bm.faces.new((ring[0], ring[2], ring[3], ring[1]))
e = SEG * 4
bm.faces.new((ring[e], ring[e + 1], ring[e + 3], ring[e + 2]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new("Vault")
bm.to_mesh(me); bm.free()
vault = bpy.data.objects.new("Vault", me)
scene.collection.objects.link(vault)
bpy.context.view_layer.objects.active = vault
finish(vault, "Vault", "plaster")

# arched windows in the south wall. The wall is built from a sill band, piers and arch heads; each arch head is a
# strip of convex quads under a semicircle, extruded through the wall (a Boolean cut left no wall at all in bpy 5.3.0).
def arch_head(name, x, z0, w, top, y, depth, m, seg=16):
    bm = bmesh.new()
    r = w / 2
    pts = [(x - r * math.cos(math.pi * i / seg), z0 + r * math.sin(math.pi * i / seg)) for i in range(seg + 1)]
    for i in range(seg):
        (xa, za), (xb, zb) = pts[i], pts[i + 1]
        quad = [(xa, za), (xb, zb), (xb, top), (xa, top)]
        f = [bm.verts.new((px, y - depth / 2, pz)) for px, pz in quad]
        g = [bm.verts.new((px, y + depth / 2, pz)) for px, pz in quad]
        bm.faces.new(f); bm.faces.new(g[::-1])
        bm.faces.new((f[0], g[0], g[1], f[1]))                 # the curved soffit
        bm.faces.new((f[3], f[2], g[2], g[3]))                 # top
        if i == 0:
            bm.faces.new((f[0], f[3], g[3], g[0]))
        if i == seg - 1:
            bm.faces.new((f[1], g[1], g[2], f[2]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    return finish(o, name, m)


bpy.data.objects.remove(south, do_unlink=True); COUNT[0] -= 0
yS, WX, WW, SILL, WH = -(Wd + T) / 2, (-2.6, 0.0, 2.6), 0.9, 1.1, 1.2
box("WallSouthSill", (0, yS, SILL / 2), (L + 2 * T, T, SILL), "stone")
edges = [-(L / 2 + T)] + [v for x in WX for v in (x - WW / 2, x + WW / 2)] + [L / 2 + T]
for i in range(0, len(edges), 2):
    x0, x1 = edges[i], edges[i + 1]
    box(f"WallSouthPier{i // 2}", ((x0 + x1) / 2, yS, (SILL + H) / 2), (x1 - x0, T, H - SILL), "stone")
for i, x in enumerate(WX):
    arch_head(f"WindowArch{i}", x, SILL + WH, WW, H, yS, T, "stone")
    box(f"WindowSill{i}", (x, yS + 0.02, SILL + 0.03), (WW + 0.16, T + 0.1, 0.06), "stone", 0.01)
# door in the east wall: a leaf under a stone arch that stands 6 cm proud of the wall
arch_head("DoorArch", 0, 2.1, 1.3, 2.95, 0, 0.12, "stone").matrix_world = __import__("mathutils").Matrix.Translation((L / 2 - 0.06, 0, 0)) @ __import__("mathutils").Matrix.Rotation(math.pi / 2, 4, "Z")
for i, y in enumerate((-0.75, 0.75)):
    box(f"DoorJamb{i}", (L / 2 - 0.06, y, 1.05), (0.12, 0.2, 2.1), "stone", 0.01)
box("DoorLeaf", (L / 2 - 0.03, 0, 1.05), (0.06, 1.3, 2.1), "oak", 0.01)

# --- furniture -------------------------------------------------------------------------------------------
box("TableTop", (-0.6, 0.2, 0.78), (3.4, 1.1, 0.08), "oak", 0.012)
for i, (dx, dy) in enumerate(((-1.5, -0.42), (1.5, -0.42), (-1.5, 0.42), (1.5, 0.42))):
    cyl(f"TableLeg{i}", (-0.6 + dx, 0.2 + dy, 0.37), 0.06, 0.74, "oak", 16)
box("TableStretcher", (-0.6, 0.2, 0.2), (3.0, 0.08, 0.08), "oak")
for i, y in enumerate((-0.75, 1.15)):
    box(f"BenchSeat{i}", (-0.6, y, 0.45), (3.0, 0.32, 0.06), "oak", 0.01)
    for j, dx in enumerate((-1.3, 1.3)):
        box(f"BenchLeg{i}{j}", (-0.6 + dx, y, 0.21), (0.08, 0.28, 0.42), "oak")
# open books and candles on the table
for i, x in enumerate((-1.6, -0.5, 0.6)):
    box(f"OpenBook{i}", (x, 0.15 + 0.1 * (i % 2), 0.845), (0.46, 0.32, 0.05), "vellum", 0.008, (0, 0, 0.15 * (i - 1)))
for i, x in enumerate((-1.05, 0.05)):
    cyl(f"CandleDish{i}", (x, 0.55, 0.83), 0.07, 0.02, "iron", 20)
    cyl(f"Candle{i}", (x, 0.55, 0.94), 0.018, 0.2, "wax", 12)
# lectern with a slanted top, near the west wall
cyl("LecternPost", (-3.5, -1.2, 0.55), 0.07, 1.1, "oak", 16)
box("LecternBase", (-3.5, -1.2, 0.03), (0.5, 0.5, 0.06), "oak", 0.01)
box("LecternTop", (-3.5, -1.2, 1.17), (0.6, 0.45, 0.04), "oak", 0.008, (0, math.radians(-28), 0))
box("LecternBook", (-3.5, -1.2, 1.215), (0.42, 0.3, 0.05), "vellum", 0.006, (0, math.radians(-28), 0))
# bookshelves along the north wall
for s, x0 in enumerate((-2.9, 0.1)):
    wS, hS, dS = 2.6, 2.3, 0.4
    y0 = Wd / 2 - dS / 2
    box(f"ShelfBack{s}", (x0, Wd / 2 - 0.015, hS / 2), (wS, 0.03, hS), "oak")
    for j, dx in enumerate((-wS / 2 + 0.025, wS / 2 - 0.025)):
        box(f"ShelfSide{s}{j}", (x0 + dx, y0, hS / 2), (0.05, dS, hS), "oak", 0.006)
    for k in range(6):
        z = 0.04 + k * (hS - 0.08) / 5
        box(f"ShelfBoard{s}{k}", (x0, y0, z), (wS - 0.1, dS, 0.04), "oak")
        if k == 5:
            continue
        x = x0 - wS / 2 + 0.07
        n = 0
        while x < x0 + wS / 2 - 0.14:
            th = random.uniform(0.035, 0.085); hh = random.uniform(0.26, 0.38); dd = random.uniform(0.2, 0.3)
            if random.random() < 0.12:
                x += random.uniform(0.05, 0.2); continue
            box(f"Book{s}{k}_{n:02d}", (x + th / 2, y0 - dS / 2 + dd / 2 + 0.03, z + 0.02 + hh / 2), (th, dd, hh), random.choice(["leatherA", "leatherB", "leatherC", "leatherD"]))
            x += th + 0.004; n += 1
# chest, stool, rug, wall cross-stone, candle stands, a pair of columns flanking the door
box("Chest", (3.4, 2.2, 0.32), (1.1, 0.6, 0.64), "oak", 0.015)
box("ChestBand0", (3.05, 2.2, 0.32), (0.05, 0.62, 0.66), "iron")
box("ChestBand1", (3.75, 2.2, 0.32), (0.05, 0.62, 0.66), "iron")
cyl("Stool", (-3.5, -0.45, 0.24), 0.2, 0.05, "oak", 20)
for i in range(3):
    a = i * 2.094
    cyl(f"StoolLeg{i}", (-3.5 + 0.13 * math.cos(a), -0.45 + 0.13 * math.sin(a), 0.11), 0.025, 0.22, "oak", 10)
box("Rug", (-0.6, 0.2, 0.008), (4.6, 2.6, 0.016), "wool")
box("CrossStone", (-L / 2 + 0.12, 0, 1.5), (0.22, 0.95, 2.1), "stone", 0.02)
box("CrossStoneBase", (-L / 2 + 0.2, 0, 0.2), (0.4, 1.2, 0.4), "stone", 0.02)
for i, y in enumerate((-1.25, 1.25)):
    cyl(f"Column{i}", (L / 2 - 0.3, y, 1.3), 0.17, 2.2, "stone", 24)
    box(f"ColumnBase{i}", (L / 2 - 0.3, y, 0.1), (0.46, 0.46, 0.2), "stone", 0.015)
    box(f"ColumnCap{i}", (L / 2 - 0.3, y, 2.5), (0.5, 0.5, 0.2), "stone", 0.015)
for i, (x, y) in enumerate(((3.6, -2.4), (-4.0, 2.4))):
    cyl(f"StandPost{i}", (x, y, 0.7), 0.025, 1.4, "iron", 12)
    cyl(f"StandFoot{i}", (x, y, 0.015), 0.16, 0.03, "iron", 20)
    cyl(f"StandCandle{i}", (x, y, 1.52), 0.03, 0.24, "wax", 12)

# --- light (for the Cycles judge render; Atlas is given depth, not light) -------------------------------------
sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 4.0; sun.angle = math.radians(2)
so = bpy.data.objects.new("Sun", sun); scene.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(-12))        # shines north and down, through the south windows
for i, x in enumerate((-2.5, 1.5)):
    a = bpy.data.lights.new(f"Fill{i}", "POINT"); a.energy = 220; a.color = (1.0, 0.72, 0.45); a.shadow_soft_size = 0.15
    ao = bpy.data.objects.new(f"Fill{i}", a); scene.collection.objects.link(ao); ao.location = (x, 0.3, 2.6)
world = bpy.data.worlds.new("World"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.9, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.2

# --- cameras: 12 on an ellipse at eye height, each looking across the room -------------------------------------
VFOV = 0.95                                  # X3D fieldOfView (the angle across the smaller side) the export must reproduce
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 100
for i in range(12):
    a = 2 * math.pi * i / 12 + 0.13
    pos = Vector((3.3 * math.cos(a), 1.9 * math.sin(a), 1.55 + 0.12 * math.sin(3 * a)))
    tgt = Vector((-1.6 * math.cos(a), -1.1 * math.sin(a), 1.25))
    cd = bpy.data.cameras.new(f"Cam{i:02d}")
    cd.sensor_fit = "VERTICAL"; cd.angle = VFOV; cd.clip_start, cd.clip_end = 0.05, 60
    co = bpy.data.objects.new(f"Cam{i:02d}", cd); scene.collection.objects.link(co)
    co.location = pos
    co.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
scene.camera = bpy.data.objects["Cam00"]
bpy.ops.wm.save_as_mainfile(filepath=out)
print("objects", len([o for o in scene.objects if o.type == "MESH"]), "cameras 12 ->", out)
