#!/usr/bin/env python3
"""export_and_render: one .blend -> the X3D twin (Blenderizer add-on) and, per camera, Cycles depth, object ids and a lit picture.

  python export_and_render.py <scene.blend> <addon-repo> <out-dir> [--spp 48] [--only 0,3] [--no-beauty]

Depth: Cycles "Depth" pass at 1 sample with a 0.01 px box filter, so no pixel is a blend of two surfaces.
Whether that pass is planar z or ray length is not assumed: compare_depth.py measures it against the X3D file.
"""
import argparse, json, sys, tempfile, time
from pathlib import Path
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("blend"); ap.add_argument("addon"); ap.add_argument("out")
ap.add_argument("--spp", type=int, default=48); ap.add_argument("--only"); ap.add_argument("--no-beauty", action="store_true")
ap.add_argument("--no-export", action="store_true"); ap.add_argument("--version", default="X3D40")
a = ap.parse_args(argv)
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=a.blend)
scene = bpy.context.scene
slug = Path(a.blend).stem
rec = {"blender": bpy.app.version_string, "blend": Path(a.blend).name, "frames": []}

if not a.no_export:
    tmp = tempfile.mkdtemp(prefix="x3d_addon_")
    link = Path(tmp) / "io_scene_x3d"
    link.symlink_to(Path(a.addon).resolve() / "source", target_is_directory=True)
    sys.path.insert(0, tmp)
    import importlib
    mod = importlib.import_module("io_scene_x3d")
    try:
        mod.register()
    except Exception as e:                                   # noqa: BLE001
        print("register:", e)
    x3d = out / f"{slug}.x3d"
    r = bpy.ops.export_scene.x3d(filepath=str(x3d), x3d_version=a.version, use_selection=False, use_mesh_modifiers=True,
                                 use_normals=True, name_decorations=False, use_hierarchy=True)
    rec["export"] = {"result": sorted(r), "file": x3d.name, "bytes": x3d.stat().st_size, "x3d_version": a.version,
                     "options": {"use_selection": False, "use_mesh_modifiers": True, "use_normals": True, "name_decorations": False}}
    print("export", r, x3d.stat().st_size, "bytes", flush=True)

cams = sorted((o for o in scene.objects if o.type == "CAMERA"), key=lambda o: o.name)
only = {int(i) for i in a.only.split(",")} if a.only else None
names = {o.pass_index: o.name for o in scene.objects if o.type == "MESH" and o.pass_index}
(out / "pass-index.json").write_text(json.dumps(names))
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
vl = scene.view_layers[0]
vl.use_pass_z = True
vl.use_pass_object_index = True


def fmt(kind):
    im = scene.render.image_settings
    if kind == "exr":
        if hasattr(im, "media_type"):
            im.media_type = "MULTI_LAYER_IMAGE"              # Blender 5: the multilayer formats sit behind media_type
        im.file_format = "OPEN_EXR_MULTILAYER"; im.color_depth = "32"
    else:
        if hasattr(im, "media_type"):
            im.media_type = "IMAGE"
        im.file_format = "PNG"; im.color_depth = "8"


fmt("exr")
scene.render.film_transparent = False
scene.render.threads_mode = "AUTO"


def read_exr(path):
    import OpenEXR
    f = OpenEXR.File(str(path))
    ch = {}
    for part in f.parts:
        for k, v in part.channels.items():
            ch[k] = v.pixels
    return ch


for i, cam in enumerate(cams):
    if only is not None and i not in only:
        continue
    scene.camera = cam
    M = np.array(cam.matrix_world)
    fr = {"index": i, "name": cam.name, "matrix_world": M.tolist(), "angle_y": cam.data.angle_y, "angle_x": cam.data.angle_x,
          "sensor_fit": cam.data.sensor_fit, "clip": [cam.data.clip_start, cam.data.clip_end]}
    # depth + ids: 1 sample, box filter
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.cycles.pixel_filter_type = "BOX"
    scene.cycles.filter_width = 0.01
    t = time.time()
    scene.render.filepath = str(out / f"tmp-{i:02d}.exr")
    bpy.ops.render.render(write_still=True)
    ch = read_exr(scene.render.filepath)
    zk = [k for k in ch if k.endswith("Depth.Z") or k.endswith(".Z") or k == "Z" or k.endswith("Depth")]
    ik = [k for k in ch if "IndexOB" in k or "Object Index" in k]
    if i == 0 or not zk:
        print("channels:", sorted(ch)[:14], flush=True)
    z = np.asarray(ch[zk[0]], np.float32)
    z = np.where(z > 1e9, 0, z).astype(np.float32)          # background
    ids = np.asarray(ch[ik[0]]).round().astype(np.uint16)
    np.savez_compressed(out / f"cycles-{i:02d}.npz", depth=z, ids=ids)
    Path(scene.render.filepath).unlink()
    fr["depth_seconds"] = round(time.time() - t, 1)
    fr["depth_range"] = [float(z[z > 0].min()), float(z.max())]
    if not a.no_beauty:
        scene.cycles.samples = a.spp
        scene.cycles.use_denoising = True
        scene.cycles.pixel_filter_type = "BLACKMAN_HARRIS"
        scene.cycles.filter_width = 1.5
        fmt("png")
        scene.render.filepath = str(out / f"cycles-{i:02d}.png")
        t = time.time()
        bpy.ops.render.render(write_still=True)
        fr["beauty_seconds"] = round(time.time() - t, 1)
        fr["spp"] = a.spp
        fmt("exr")
    rec["frames"].append(fr)
    print(cam.name, fr.get("depth_seconds"), fr.get("beauty_seconds"), fr["depth_range"], flush=True)
rec["view_transform"] = scene.view_settings.view_transform
(out / "blender-render.json").write_text(json.dumps(rec, indent=1))
