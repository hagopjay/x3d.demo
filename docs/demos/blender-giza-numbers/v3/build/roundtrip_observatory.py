# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender round-trip witness for the Pyramid Observatory scene (review research item 5).

Import the procedural observatory.x3d through x3d-blender-io, count what arrives in Blender,
export it again as X3D 4.0, and count what comes back. Writes a JSON census.
Usage: python roundtrip_observatory.py IN_X3D OUT_DIR ADDON_SOURCE_DIR
"""
import bpy, importlib, json, os, re, sys, collections, hashlib
from mathutils import Vector
IN, OUT, ADDON = (os.path.abspath(a) for a in sys.argv[1:4])
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.join(OUT, "_addon")); os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link): os.symlink(ADDON, link, target_is_directory=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
importlib.import_module("io_scene_x3d").register()

def census_x3d(path):
    x = open(path, encoding="utf-8").read()
    tags = collections.Counter(re.findall(r"<([A-Z][A-Za-z0-9]*)[\s/>]", x))
    defs = re.findall(r'DEF="([^"]+)"', x)
    return {"bytes": len(x.encode()), "sha256": hashlib.sha256(x.encode()).hexdigest(), "nodes": dict(sorted(tags.items())), "defs": len(defs), "def_names": defs}

src = census_x3d(IN)
r = bpy.ops.import_scene.x3d(filepath=IN)
objs = list(bpy.data.objects)
kinds = collections.Counter(o.type for o in objs)
mins, maxs = Vector((1e9,)*3), Vector((-1e9,)*3)
for o in objs:
    if o.type == "MESH":
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
mesh_polys = sum(len(o.data.polygons) for o in objs if o.type == "MESH")
mesh_edges_only = sum(1 for o in objs if o.type == "MESH" and len(o.data.polygons) == 0 and len(o.data.edges) > 0)
imgs = [i.name for i in bpy.data.images]
mats = len(bpy.data.materials)
names = {o.name for o in objs}
def_hits = [d for d in src["def_names"] if any(n == d or n.startswith(d + ".") or n.startswith(d) for n in names)]
blend = {"import_result": list(r), "objects": len(objs), "by_type": dict(kinds), "mesh_polygons": mesh_polys,
         "edge_only_meshes": mesh_edges_only, "materials": mats, "images": imgs,
         "cameras": sorted(o.name for o in objs if o.type == "CAMERA"), "lights": sorted(o.name for o in objs if o.type == "LIGHT"),
         "fonts_or_text": sum(1 for o in objs if o.type == "FONT"),
         "world_bounds_m": {"min": [round(v, 3) for v in mins], "max": [round(v, 3) for v in maxs]},
         "defs_matched_by_object_name": len(def_hits)}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "observatory_roundtrip.blend"))
xp = os.path.join(OUT, "observatory_roundtrip.x3d")
e = bpy.ops.export_scene.x3d(filepath=xp, x3d_version="X3D40", use_selection=False, use_animation=False)
back = census_x3d(xp)
json.dump({"source": {k: v for k, v in src.items() if k != "def_names"}, "blender": blend,
           "export_result": list(e), "returned": {k: v for k, v in back.items() if k != "def_names"},
           "defs_returned": sorted(set(src["def_names"]) & set(back["def_names"])),
           "defs_lost": sorted(set(src["def_names"]) - set(back["def_names"]))},
          open(os.path.join(OUT, "census.json"), "w"), indent=1)
print("OK", blend["objects"], dict(kinds), mesh_polys, "defs back", len(set(src["def_names"]) & set(back["def_names"])), "/", len(src["def_names"]))
