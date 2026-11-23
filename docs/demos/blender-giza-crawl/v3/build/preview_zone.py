# SPDX-License-Identifier: GPL-3.0-or-later
"""Look-development: build one zone and render Cycles previews from named cameras (no bake, no export).
Usage: Blender -b --python preview_zone.py -- ZONE OUT_DIR SAMPLES "name:eye_x,eye_y,eye_z:look_x,look_y,look_z:lens" ...
"""
import importlib
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
zone, out, samples = argv[0], argv[1], int(argv[2])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
import geo  # noqa: E402

mod = importlib.import_module(zone)
info = mod.build()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU setup failed", e)
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [
    i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else "None"
world = bpy.data.worlds.new("W")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.01, 0.012, 0.02, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world
for spec in argv[3:]:
    name, eye, look, lens = spec.split(":")
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = float(lens)
    scene.collection.objects.link(cam)
    cam.location = [float(v) for v in eye.split(",")]
    geo.aim(cam, [float(v) for v in look.split(",")])
    scene.camera = cam
    scene.render.filepath = os.path.join(out, name + ".png")
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, round(time.time() - t, 1), "s")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, zone + "_look.blend"))
