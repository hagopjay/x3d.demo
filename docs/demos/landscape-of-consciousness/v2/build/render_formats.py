"""Re-import the exported USD and GLB into Blender 5.3 and render the same camera views with Cycles (CPU). python render_formats.py OUT_DIR RENDER_DIR"""
import bpy, sys, os, json, time
out, rd = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]); os.makedirs(rd, exist_ok=True)
VIEWS = ["Overview", "VP1", "VP5", "VP10", "VP10b"]
rec = {}
def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 24; sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = 1030, 644; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 85
    w = bpy.data.worlds.new("W"); w.use_nodes = False; w.color = (0.004, 0.005, 0.012); sc.world = w
    return sc
for fmt, f, imp in (("usd", "landscape-z.usdc", lambda p: bpy.ops.wm.usd_import(filepath=p)),
                    ("glb", "landscape.glb", lambda p: bpy.ops.import_scene.gltf(filepath=p))):
    sc = fresh(); t = time.time(); imp(os.path.join(out, f))
    cams = {o.name.split(".")[0]: o for o in bpy.data.objects if o.type == "CAMERA"}
    rec[fmt] = {"import_seconds": round(time.time() - t, 1), "objects": len(bpy.data.objects), "cameras": sorted(cams), "ortho": [n for n, o in cams.items() if o.data.type == "ORTHO"], "frames": {}}
    for v in VIEWS:
        if v not in cams: continue
        sc.camera = cams[v]; p = os.path.join(rd, f"{fmt}-{v}.jpg"); sc.render.filepath = p; t = time.time()
        bpy.ops.render.render(write_still=True); rec[fmt]["frames"][v] = {"file": os.path.basename(p), "seconds": round(time.time() - t, 1)}
json.dump(rec, open(os.path.join(rd, "render-receipt.json"), "w"), indent=1); print(json.dumps(rec, indent=1))
