# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 60: one Blender asset (the Flywheel Forge gen 7 orrery) exported once per format.
Usage: python export_all.py GEN7_BLEND OUT_DIR ADDON_SOURCE_DIR
Writes orrery.x3d (x3d-blender-io, X3D 4.0), orrery.glb (Blender glTF), orrery.usdc (Blender USD) and exports.json."""
import bpy
import hashlib, importlib, json, os, sys, time

blend, out, addon = (os.path.abspath(a) for a in sys.argv[1:4])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
sys.path.insert(0, os.path.join(out, "_addon"))
os.makedirs(os.path.join(out, "_addon"), exist_ok=True)
link = os.path.join(out, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(addon, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception:
    pass
log = {"blender": bpy.app.version_string, "source": os.path.basename(blend), "exports": {}}


def run(name, fn):
    t = time.time()
    res = fn()
    p = os.path.join(out, name)
    log["exports"][name] = {"result": sorted(res) if isinstance(res, set) else str(res), "seconds": round(time.time() - t, 2),
                            "bytes": os.path.getsize(p), "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()}


run("orrery.x3d", lambda: bpy.ops.export_scene.x3d(filepath=os.path.join(out, "orrery.x3d"), x3d_version="X3D40",
                                                    use_selection=False, use_animation=True))
run("orrery.glb", lambda: bpy.ops.export_scene.gltf(filepath=os.path.join(out, "orrery.glb"), export_format="GLB",
                                                     export_cameras=True, export_lights=True, export_animations=True,
                                                     export_animation_mode="ACTIONS", export_apply=True))
run("orrery.usdc", lambda: bpy.ops.wm.usd_export(filepath=os.path.join(out, "orrery.usdc"), export_animation=True,
                                                 export_lights=True, export_cameras=True, export_materials=True))
json.dump(log, open(os.path.join(out, "exports.json"), "w"), indent=1)
print(json.dumps(log, indent=1))
