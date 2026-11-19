# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 61, step 2: the IFC building and an H-Anim walker in one Blender scene, exported to X3D 4.0.

Each IFC element becomes one mesh whose x3d_metadata custom property carries its IFC identity (GlobalId, class, name,
material) and quantities computed from the mesh (volume, mass, embodied carbon). The walker is an armature whose
bones carry H-Anim 2.0 standard joint names, with a skinned mesh and a walk cycle, carried along a path through the
building's door and partition doorway.

Usage: python build_twin.py STATION.ifc OUT_DIR ADDON_SOURCE_DIR
"""
import bpy
import bmesh
import importlib
import json
import math
import os
import sys

import ifcopenshell
import ifcopenshell.geom
from mathutils import Euler, Matrix, Vector

IFC, OUT, ADDON = (os.path.abspath(a) for a in sys.argv[1:4])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FPS = 12
scene.render.fps = FPS

# Illustrative cradle-to-gate (A1-A3) factors of the size generic databases publish. NOT taken from a certified EPD
# or checked against a database: the demo shows the plumbing (IFC identity -> mesh quantity -> X3D metadata), and a
# real project swaps in its own factors.
MATERIAL_DATA = {
    "Concrete C30/37": {"density": 2400, "kgco2e_per_kg": 0.13, "colour": (0.62, 0.62, 0.60), "rough": 0.85, "metal": 0.0},
    "Cross-laminated timber": {"density": 470, "kgco2e_per_kg": 0.44, "colour": (0.78, 0.56, 0.34), "rough": 0.7, "metal": 0.0},
    "Clay brick": {"density": 1900, "kgco2e_per_kg": 0.21, "colour": (0.62, 0.26, 0.17), "rough": 0.9, "metal": 0.0},
    "Steel S355": {"density": 7850, "kgco2e_per_kg": 1.55, "colour": (0.32, 0.34, 0.38), "rough": 0.45, "metal": 0.6},
    "Float glass": {"density": 2500, "kgco2e_per_kg": 1.44, "colour": (0.55, 0.72, 0.80), "rough": 0.1, "metal": 0.0, "alpha": 0.35},
}


def principled(name, colour, rough=0.6, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    return m


mats = {k: principled(k, v["colour"], v["rough"], v["metal"], v.get("alpha", 1.0)) for k, v in MATERIAL_DATA.items()}

# ---- IFC elements -> meshes with metadata ---------------------------------------------------------------------------
ifc = ifcopenshell.open(IFC)
settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)
records = []
for el in ifc.by_type("IfcElement"):
    shape = ifcopenshell.geom.create_shape(settings, el)
    v = shape.geometry.verts
    fcs = shape.geometry.faces
    me = bpy.data.meshes.new(el.Name)
    me.from_pydata([v[i:i + 3] for i in range(0, len(v), 3)], [], [fcs[i:i + 3] for i in range(0, len(fcs), 3)])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    volume = abs(bm.calc_volume())
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(el.Name, me)
    scene.collection.objects.link(ob)
    rel = [r for r in el.HasAssociations if r.is_a("IfcRelAssociatesMaterial")]
    mat_name = rel[0].RelatingMaterial.Name
    me.materials.append(mats[mat_name])
    d = MATERIAL_DATA[mat_name]
    mass = volume * d["density"]
    carbon = mass * d["kgco2e_per_kg"]
    rec = {"object": el.Name, "GlobalId": el.GlobalId, "IfcClass": el.is_a(), "Name": el.Name, "Material": mat_name,
           "volume_m3": round(volume, 4), "mass_kg": round(mass, 1), "kgCO2e": round(carbon, 1)}
    records.append(rec)
    s = lambda name, value: {"node": "MetadataString", "name": name, "value": '"%s"' % value}
    n = lambda name, value: {"node": "MetadataDouble", "name": name, "value": "%g" % value}
    ob["x3d_metadata"] = {"node": "MetadataSet", "name": "IFC", "reference": "IFC4 station.ifc", "value": [
        s("GlobalId", el.GlobalId), s("IfcClass", el.is_a()), s("Name", el.Name), s("Material", mat_name),
        n("volume_m3", round(volume, 4)), n("mass_kg", round(mass, 1)), n("kgCO2e_A1A3_illustrative", round(carbon, 1))]}

# site ground (not an IFC element: no metadata)
bpy.ops.mesh.primitive_plane_add(size=40, location=(6, 4, -0.26))
ground = bpy.context.active_object
ground.name = "Site ground"
ground.data.materials.append(principled("Grass", (0.20, 0.30, 0.13), 0.95))

# ---- H-Anim walker ----------------------------------------------------------------------------------------------------
J = {  # joint centres, metres, walker facing +Y, feet on z=0
    "humanoid_root": (0, 0, 0.95), "sacroiliac": (0, 0, 0.95), "vl5": (0, 0, 1.02), "skullbase": (0, 0, 1.55),
    "l_hip": (0.10, 0, 0.92), "l_knee": (0.10, 0.01, 0.50), "l_ankle": (0.10, 0, 0.08),
    "r_hip": (-0.10, 0, 0.92), "r_knee": (-0.10, 0.01, 0.50), "r_ankle": (-0.10, 0, 0.08),
    "l_shoulder": (0.20, 0, 1.43), "l_elbow": (0.22, -0.01, 1.14), "l_wrist": (0.22, 0.01, 0.89),
    "r_shoulder": (-0.20, 0, 1.43), "r_elbow": (-0.22, -0.01, 1.14), "r_wrist": (-0.22, 0.01, 0.89),
}
TAIL = {"humanoid_root": (0, 0, 1.0), "sacroiliac": (0, 0, 0.90), "vl5": (0, 0, 1.45), "skullbase": (0, 0, 1.80),
        "l_ankle": (0.10, 0.16, 0.02), "r_ankle": (-0.10, 0.16, 0.02), "l_wrist": (0.22, 0.03, 0.74), "r_wrist": (-0.22, 0.03, 0.74)}
PARENT = {"sacroiliac": "humanoid_root", "vl5": "humanoid_root", "skullbase": "vl5",
          "l_hip": "sacroiliac", "l_knee": "l_hip", "l_ankle": "l_knee", "r_hip": "sacroiliac", "r_knee": "r_hip", "r_ankle": "r_knee",
          "l_shoulder": "vl5", "l_elbow": "l_shoulder", "l_wrist": "l_elbow", "r_shoulder": "vl5", "r_elbow": "r_shoulder", "r_wrist": "r_elbow"}
CHILD = {"l_hip": "l_knee", "l_knee": "l_ankle", "r_hip": "r_knee", "r_knee": "r_ankle",
         "l_shoulder": "l_elbow", "l_elbow": "l_wrist", "r_shoulder": "r_elbow", "r_elbow": "r_wrist"}

arm_data = bpy.data.armatures.new("Walker rig")
rig = bpy.data.objects.new("Walker", arm_data)
scene.collection.objects.link(rig)
rig["x3d_hanim_names"] = "standard"
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name in J:
    eb = arm_data.edit_bones.new(name)
    eb.head = J[name]
    eb.tail = J[CHILD[name]] if name in CHILD else TAIL[name]
    eb.roll = 0.0
for name, parent in PARENT.items():
    arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
# H-Anim 2.0 names. The add-on's table still knows the 1.x ankle/wrist names (x3d_mcp's semantic check flags them),
# so the four 2.0 names go in as explicit per-bone overrides.
HANIM2 = {"l_ankle": "l_talocrural", "r_ankle": "r_talocrural", "l_wrist": "l_radiocarpal", "r_wrist": "r_radiocarpal"}
for b in arm_data.bones:
    b["x3d_hanim_joint"] = HANIM2.get(b.name, b.name)

# skin: one mesh, rigid weights per part
walker_mats = {"Hi-vis jacket": principled("Hi-vis jacket", (0.95, 0.42, 0.04), 0.55),
               "Work trousers": principled("Work trousers", (0.08, 0.11, 0.20), 0.8),
               "Hard hat": principled("Hard hat", (0.98, 0.80, 0.08), 0.35),
               "Skin": principled("Skin", (0.70, 0.52, 0.42), 0.6),
               "Boots": principled("Boots", (0.10, 0.08, 0.07), 0.7)}
skin = bmesh.new()
parts = []  # (bone, material index)
order = list(walker_mats)


def tube(a, b, r1, r2, bone, mat, segs=10):
    a, b = Vector(a), Vector(b)
    d = b - a
    res = bmesh.ops.create_cone(skin, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=d.length)
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(skin, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res["verts"])
    parts.append((res["verts"], bone, order.index(mat)))


def ball(c, r, bone, mat, scale=(1, 1, 1)):
    res = bmesh.ops.create_uvsphere(skin, u_segments=14, v_segments=8, radius=r)
    bmesh.ops.transform(skin, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*scale, 1)), verts=res["verts"])
    parts.append((res["verts"], bone, order.index(mat)))


for s, x in (("l", 0.10), ("r", -0.10)):
    tube(J[s + "_hip"], J[s + "_knee"], 0.075, 0.06, s + "_hip", "Work trousers")
    tube(J[s + "_knee"], J[s + "_ankle"], 0.058, 0.045, s + "_knee", "Work trousers")
    tube((x, -0.05, 0.05), (x, 0.17, 0.05), 0.055, 0.05, s + "_ankle", "Boots")
    tube(J[s + "_shoulder"], J[s + "_elbow"], 0.055, 0.047, s + "_shoulder", "Hi-vis jacket")
    tube(J[s + "_elbow"], J[s + "_wrist"], 0.045, 0.038, s + "_elbow", "Hi-vis jacket")
    ball(Vector(J[s + "_wrist"]) + Vector((0, 0, -0.07)), 0.045, s + "_wrist", "Skin")
ball((0, 0, 0.93), 0.17, "sacroiliac", "Work trousers", (1.0, 0.7, 0.55))
tube((0, 0, 1.0), (0, 0, 1.47), 0.17, 0.2, "vl5", "Hi-vis jacket", segs=14)
tube((0, 0, 1.47), (0, 0, 1.56), 0.06, 0.05, "skullbase", "Skin")
ball((0, 0.01, 1.66), 0.11, "skullbase", "Skin", (0.9, 1.0, 1.1))
ball((0, 0.0, 1.73), 0.13, "skullbase", "Hard hat", (1.0, 1.1, 0.6))
skin_me = bpy.data.meshes.new("Walker skin")
skin.to_mesh(skin_me)
skin_ob = bpy.data.objects.new("Walker skin", skin_me)
scene.collection.objects.link(skin_ob)
for m in walker_mats.values():
    skin_me.materials.append(m)
groups = {name: skin_ob.vertex_groups.new(name=name) for name in J}
index_of = {}
skin.verts.index_update()
for verts, bone, mi in parts:
    ids = [v.index for v in verts]
    groups[bone].add(ids, 1.0, "REPLACE")
    for idx in ids:
        index_of[idx] = mi
for poly in skin_me.polygons:
    poly.material_index = index_of.get(poly.vertices[0], 0)
skin.free()
skin_ob.parent = rig
mod = skin_ob.modifiers.new("Armature", "ARMATURE")
mod.object = rig

# which local axis swings a limb forward (+Y)? measure instead of assuming
pb = rig.pose.bones
pb["l_hip"].rotation_mode = "XYZ"
pb["l_hip"].rotation_euler = (0.4, 0, 0)
bpy.context.view_layer.update()
SIGN = 1.0 if (rig.matrix_world @ pb["l_hip"].tail).y > J["l_knee"][1] else -1.0
pb["l_hip"].rotation_euler = (0, 0, 0)
print("forward swing sign", SIGN)

# ---- path through the door, the partition doorway and back -----------------------------------------------------------
PATH = [(2.6, -3.5), (2.6, 1.6), (4.2, 5.3), (8.0, 5.3), (10.4, 4.2), (10.4, 1.4), (7.4, 1.4), (7.2, 4.6), (5.0, 5.3),
        (2.9, 3.0), (2.6, 1.0), (2.6, -3.5)]
SPEED, STRIDE = 1.2, 1.40
legs = [math.dist(PATH[i], PATH[i + 1]) for i in range(len(PATH) - 1)]
total_t = sum(legs) / SPEED
cycles = max(1, round(total_t * SPEED / STRIDE))
total_t = cycles * STRIDE / SPEED          # a whole number of stride cycles, so the loop is seamless
F_END = int(round(total_t * FPS)) + 1
scene.frame_start, scene.frame_end = 1, F_END
carrier = bpy.data.objects.new("Walker path", None)
scene.collection.objects.link(carrier)
rig.parent = carrier

cum = [0.0]
for L in legs:
    cum.append(cum[-1] + L)
scale_t = total_t / (cum[-1] / SPEED)


def heading(i):
    (x0, y0), (x1, y1) = PATH[i], PATH[i + 1]
    return math.atan2(y1 - y0, x1 - x0) - math.pi / 2   # local +Y faces along the leg


prev = None
for i in range(len(PATH)):
    t = cum[i] / SPEED * scale_t
    frame = 1 + t * FPS
    carrier.location = (*PATH[i], 0.0)
    carrier.keyframe_insert("location", frame=frame)
    for k, ti in ((i - 1, t - 0.25), (i, t + 0.25)):      # turn over half a second around each corner
        if 0 <= k < len(legs):
            h = heading(k)
            if prev is not None:
                while h - prev > math.pi:
                    h -= 2 * math.pi
                while h - prev < -math.pi:
                    h += 2 * math.pi
            prev = h
            carrier.rotation_euler = (0, 0, h)
            carrier.keyframe_insert("rotation_euler", frame=max(1, min(F_END, 1 + ti * FPS)))

# walk cycle on the joints, every frame
for name in J:
    pb[name].rotation_mode = "XYZ"
for frame in range(1, F_END + 1):
    p = ((frame - 1) / FPS * SPEED / STRIDE) % 1.0
    w = 2 * math.pi * p
    hip = math.radians(24) * math.sin(w)
    for side, sgn in (("l", 1), ("r", -1)):
        h = sgn * hip
        swing = max(0.0, math.cos(w if sgn > 0 else w + math.pi))
        knee = math.radians(6 + 48 * swing ** 1.5)
        pb[side + "_hip"].rotation_euler = (SIGN * h, 0, 0)
        pb[side + "_knee"].rotation_euler = (-SIGN * knee, 0, 0)
        pb[side + "_ankle"].rotation_euler = (SIGN * math.radians(10) * math.sin(w if sgn > 0 else w + math.pi), 0, 0)
        pb[side + "_shoulder"].rotation_euler = (-SIGN * 0.75 * h, 0, 0)
        pb[side + "_elbow"].rotation_euler = (SIGN * math.radians(18 + 10 * max(0.0, -math.sin(w * sgn))), 0, 0)
    pb["vl5"].rotation_euler = (0, 0, math.radians(4) * math.sin(w))
    pb["humanoid_root"].location = (0, 0, 0.025 * math.cos(2 * w))
    for name in J:
        pb[name].keyframe_insert("rotation_euler", frame=frame)
    pb["humanoid_root"].keyframe_insert("location", frame=frame)

# ---- light and camera -------------------------------------------------------------------------------------------------
for name, energy, rot, col in (("Key sun", 3.0, (math.radians(48), 0, math.radians(35)), (1.0, 0.93, 0.82)),
                               ("Fill sun", 1.1, (math.radians(62), 0, math.radians(215)), (0.7, 0.8, 1.0))):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy, ld.color = energy, col
    ld["x3d_energy_per_intensity"] = 1.0     # suns uncapped (Flywheel Forge gen 3 lesson)
    ld["x3d_intensity"] = energy
    lo = bpy.data.objects.new(name, ld)
    lo.rotation_euler = rot
    scene.collection.objects.link(lo)
cam = bpy.data.objects.new("Overview", bpy.data.cameras.new("Overview"))
cam.data.lens = 24
scene.collection.objects.link(cam)
cam.location = (16.5, -9.5, 13.5)
look = Vector((6.2, 4.0, 0.6)) - cam.location
cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
cam2 = bpy.data.objects.new("Follow the walker", bpy.data.cameras.new("Follow the walker"))
cam2.data.lens = 20
scene.collection.objects.link(cam2)
cam2.parent = carrier                         # rides with the walker: behind, above, looking along its heading
cam2.location = (0.0, -3.4, 2.5)
cam2.rotation_euler = (math.radians(72), 0, 0)
cam3 = bpy.data.objects.new("Street", bpy.data.cameras.new("Street"))
cam3.data.lens = 18
scene.collection.objects.link(cam3)
cam3.location = (-2.5, -6.5, 4.2)
look3 = Vector((5.0, 4.0, 1.0)) - cam3.location
cam3.rotation_euler = look3.to_track_quat("-Z", "Y").to_euler()

# ---- export -------------------------------------------------------------------------------------------------------------
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
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "twin.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "twin.x3d"), x3d_version="X3D40", use_selection=False, use_animation=True))
json.dump({"elements": records, "frames": F_END, "fps": FPS, "seconds": round(total_t, 2), "stride_cycles": cycles,
           "factors": {k: {"density": v["density"], "kgco2e_per_kg": v["kgco2e_per_kg"]} for k, v in MATERIAL_DATA.items()}},
          open(os.path.join(OUT, "elements.json"), "w"), indent=1)
print("elements", len(records), "frames", F_END, "seconds", round(total_t, 1),
      "total kgCO2e", round(sum(r["kgCO2e"] for r in records)))
