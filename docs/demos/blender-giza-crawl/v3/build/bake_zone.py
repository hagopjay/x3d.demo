# SPDX-License-Identifier: GPL-3.0-or-later
"""Look-dev for one zone end to end: build, bake, export X3D 4.0 (no route, no figure).
Usage: Blender -b --python bake_zone.py -- ZONE OUT_DIR ADDON_SOURCE_DIR TEXELS_PER_M SAMPLES EXPOSURE "vp:eye:look:fovdeg" ...
"""
import importlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
zone, OUT, ADDON, tpm, samples, expo = argv[0], os.path.abspath(argv[1]), os.path.abspath(argv[2]), float(argv[3]), int(argv[4]), float(argv[5])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
import bakery  # noqa: E402
import geo  # noqa: E402

info = importlib.import_module(zone).build()
bakery.setup_cycles(samples)
scene = bpy.context.scene
world = bpy.data.worlds.new("Dark")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.005, 0.008, 1)
scene.world = world
unbaked = [o for o in scene.objects if o.type == "MESH" and o.name not in geo.ZONES]
for o in unbaked:
    o.hide_render = True
recs = [bakery.bake_object(bpy.data.objects[n], OUT, tpm, samples, expo, combined=("shrine" in n.lower() or "obelisk" in n.lower()))
        for n, z in geo.ZONES.items() if z == zone]
for o in unbaked:
    o.hide_render = False
for o in [o for o in scene.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)                                   # light lives in the textures now
for spec in argv[6:]:
    name, eye, look, fov = spec.split(":")
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.angle = math.radians(float(fov))
    scene.collection.objects.link(cam)
    cam.location = [float(v) for v in eye.split(",")]
    geo.aim(cam, [float(v) for v in look.split(",")])
    scene.camera = scene.camera or cam
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception as e:  # noqa: BLE001
    print("register:", e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, zone + ".blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, zone + ".x3d"), x3d_version="X3D40", use_selection=False, path_mode="RELATIVE"))
json.dump(recs, open(os.path.join(OUT, zone + "-bake.json"), "w"), indent=1)
print("TOTAL_BAKE_S", round(sum(r["seconds"] for r in recs), 1), "JPEG_MB", round(sum(r["jpeg_bytes"] for r in recs) / 1e6, 2))
