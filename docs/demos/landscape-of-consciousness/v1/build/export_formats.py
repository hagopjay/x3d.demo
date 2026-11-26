"""Landscape world through Blender 5.3: import X3D with the x3d-blender-io add-on, export USD (.usdc) and GLB, record what Blender saw.
python export_formats.py WORLD.x3d OUT_DIR ADDON_SOURCE_DIR RESULT.json    (Python 3.13 + bpy==5.3.0)"""
import json, os, sys, tempfile, importlib, time, collections
world, out, addon, dest = (os.path.abspath(a) for a in sys.argv[1:5])
pkg = tempfile.mkdtemp(); os.symlink(addon, os.path.join(pkg, "io_scene_x3d")); sys.path.insert(0, pkg)
import bpy
importlib.import_module("io_scene_x3d").register()
os.makedirs(out, exist_ok=True)
res = {"blender": bpy.app.version_string, "world": os.path.basename(world)}
bpy.ops.wm.read_factory_settings(use_empty=True)
t = time.time()
try:
    r = bpy.ops.import_scene.x3d(filepath=world); res["import"] = sorted(r)
except Exception as e:
    res["import_error"] = str(e)[:400]
res["import_seconds"] = round(time.time() - t, 1)
kinds = collections.Counter(o.type for o in bpy.data.objects)
res["objects"] = dict(kinds); res["object_total"] = len(bpy.data.objects)
res["meshes"] = len(bpy.data.meshes); res["materials"] = len(bpy.data.materials); res["cameras"] = len(bpy.data.cameras)
res["lights"] = len(bpy.data.lights); res["curves"] = len(bpy.data.curves); res["images"] = len(bpy.data.images)
res["verts"] = sum(len(m.vertices) for m in bpy.data.meshes); res["faces"] = sum(len(m.polygons) for m in bpy.data.meshes)
res["animation_data_objects"] = sum(1 for o in bpy.data.objects if o.animation_data); res["actions"] = len(bpy.data.actions)
res["text_objects"] = kinds.get("FONT", 0)
res["empties"] = kinds.get("EMPTY", 0)
res["object_custom_props"] = sum(1 for o in bpy.data.objects if len(o.keys()))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "landscape.blend"))
LAB = dict(export_materials=True, generate_preview_surface=True, export_lights=True, export_cameras=True, use_instancing=True)   # the Foundry's options (x3d.lab blender_worker)
jobs = (("usdc_z", "landscape-z.usdc", lambda p: bpy.ops.wm.usd_export(filepath=p, **LAB)),
        ("usdc_y", "landscape-y.usdc", lambda p: bpy.ops.wm.usd_export(filepath=p, **dict(LAB, convert_orientation=True, export_global_up_selection="Y", export_global_forward_selection="NEGATIVE_Z"))),
        ("usdc_anim", "landscape-anim.usdc", lambda p: bpy.ops.wm.usd_export(filepath=p, **dict(LAB, export_animation=True))),
        ("glb", "landscape.glb", lambda p: bpy.ops.export_scene.gltf(filepath=p, export_format="GLB", export_cameras=True, export_lights=True, export_extras=True)))
for name, fname, fn in jobs:
    if os.environ.get("ONLY") and name not in os.environ["ONLY"].split(","): continue
    p = os.path.join(out, fname); t = time.time()
    try:
        fn(p); res[name] = {"file": fname, "ok": os.path.exists(p), "bytes": os.path.getsize(p) if os.path.exists(p) else 0, "seconds": round(time.time() - t, 1)}
    except Exception as e:
        res[name] = {"error": str(e)[:400]}
json.dump(res, open(dest, "w"), indent=1); print(json.dumps({k: v for k, v in res.items() if k in ("usdc_z", "usdc_y", "glb")}, indent=1))
