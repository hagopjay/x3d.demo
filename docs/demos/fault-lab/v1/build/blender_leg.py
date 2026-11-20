"""Fault Lab, Blender leg: X3D -> x3d-blender-io import (defaults) -> what Blender holds -> add-on X3D export, Blender glTF export,
Blender USD export, .blend. Prints one `BLEG {json}` line.

    <python with bpy> build/blender_leg.py ADDON_SOURCE_DIR in.x3d OUT_DIR

Nothing is tuned: this is what a person who clicks Import and then Export gets. The question it answers: which of the
scene's Metadata trees does Blender still hold, and which come out of each exporter.
"""
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

src, x3d, outdir = sys.argv[1:4]
os.makedirs(outdir, exist_ok=True)
tmp = tempfile.mkdtemp(prefix="fl_bleg_")
(Path(tmp) / "io_scene_x3d").symlink_to(Path(src).resolve(), target_is_directory=True)
sys.path.insert(0, tmp)
import bpy  # noqa: E402

importlib.import_module("io_scene_x3d").register()
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    importlib.import_module("io_scene_x3d").register()
except ValueError:
    pass
assert bpy.ops.import_scene.x3d(filepath=x3d) == {"FINISHED"}
sc = bpy.context.scene


def props(idblock):
    return {k: (v if isinstance(v, (str, int, float)) else str(v))[:400] if isinstance(v, str) else (v if isinstance(v, (int, float)) else str(v)[:400])
            for k, v in idblock.items() if k.startswith("x3d") or "meta" in k.lower()}


held = []
for o in sc.objects:
    p = props(o)
    if p:
        held.append({"kind": "object", "name": o.name, "type": o.type, "props": p})
for m in bpy.data.materials:
    p = props(m)
    if p:
        held.append({"kind": "material", "name": m.name, "props": p})
info = {"blender": bpy.app.version_string, "objects": len(sc.objects), "object_names": sorted(o.name for o in sc.objects),
        "meshes": sum(o.type == "MESH" for o in sc.objects), "materials": len(bpy.data.materials), "held": held}
out = Path(outdir)
assert bpy.ops.export_scene.x3d(filepath=str(out / "blender.x3d"), x3d_version="X3D40") == {"FINISHED"}
assert bpy.ops.export_scene.gltf(filepath=str(out / "blender.glb"), export_format="GLB", export_extras=True, export_yup=True) == {"FINISHED"}
try:
    r = bpy.ops.wm.usd_export(filepath=str(out / "blender.usda"), export_custom_properties=True)
    info["usd_export"] = str(r)
except Exception as e:  # the pip wheel may ship without USD
    info["usd_export"] = f"not available: {type(e).__name__}: {e}"[:200]
bpy.ops.wm.save_as_mainfile(filepath=str(out / "blender.blend"), compress=True)
print("BLEG", json.dumps(info))
