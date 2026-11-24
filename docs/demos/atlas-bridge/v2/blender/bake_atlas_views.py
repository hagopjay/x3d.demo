#!/usr/bin/env python3
"""bake_atlas_views: Atlas paints, Blender bakes the paint onto the exact geometry, the add-on writes clean X3D.

No splats and no Atlas mesh are used. The pictures Atlas generated from the Cycles depth are projected back along
the same cameras onto the Blender meshes and baked into one texture:

  1. apply modifiers and transforms, unwrap every object, pack all islands into one UV square
  2. Cycles bakes world POSITION and NORMAL per texel (so each texel knows where it is in the room)
  3. each texel is projected into every Atlas view; it takes colour only from views that really see it
     (its depth must match the depth that was sent, within a tolerance) and that face it
  4. texels no view saw keep the flat colour of their Blender material (counted, never hidden)
  5. one material with that texture, exported with the Blenderizer add-on as X3D 4.0 (ImageTexture)

  python bake_atlas_views.py <scene.blend> <views-dir> <prepared-dir> <addon-repo> <out-stem> [--size 4096]
    views-dir     view-NN.jpg + operation.json (the cameras Atlas returned)
    prepared-dir  depth-NN.exr that was sent (planar depth, metres)
"""
import argparse, json, sys, tempfile, time
from pathlib import Path
import bpy
import numpy as np
from PIL import Image

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("blend"); ap.add_argument("views"); ap.add_argument("prepared"); ap.add_argument("addon"); ap.add_argument("stem")
ap.add_argument("--size", type=int, default=4096); ap.add_argument("--tol-mm", type=float, default=25.0); ap.add_argument("--min-cos", type=float, default=0.12)
ap.add_argument("--jpeg", type=int, default=88)
a = ap.parse_args(argv)
stem = Path(a.stem); stem.parent.mkdir(parents=True, exist_ok=True)
N = a.size
rec = {"blender": bpy.app.version_string, "texture_size": N, "depth_tolerance_mm": a.tol_mm, "min_cos": a.min_cos}
t0 = time.time()
bpy.ops.wm.open_mainfile(filepath=a.blend)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
flat = {o.name: tuple(o.data.materials[0].diffuse_color[:3]) if o.data.materials else (0.5, 0.5, 0.5) for o in meshes}

# 1. final geometry, world space == object space ---------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.convert(target="MESH")                               # applies Bevel and friends
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "kit"))
import atlas2x3d as A
prep = Path(a.prepared)
VIEWS = []
for views in (Path(v) for v in a.views.split(",")):                  # one or more rings of Atlas views
    op = json.loads((views / "operation.json").read_text())
    idx = [int(p.stem.split("-")[-1]) for p in sorted(views.glob("view-*"))]
    for k, f in enumerate(op["response"]["frames"]):
        i = idx[k]
        VIEWS.append((i, A.parse_camera(f["camera"]), np.asarray(Image.open(next(views.glob(f"view-{i:02d}.*"))).convert("RGB"), np.float64),
                      A.read_exr_depth(prep / f"depth-{i:02d}.exr").astype(np.float64)))
tol = a.tol_mm / 1000


def project(Px, Nx, cam, z, img=None):
    """Px, Nx: points and normals in the X3D frame. Returns (ok, cos, depth, colour or None, u, v)."""
    H, W = z.shape
    d = Px - cam.position
    pc = d @ cam.R                                                    # camera axes: right, up, back
    depth = -pc[:, 2]
    ok = depth > 0.05
    dd = np.where(ok, depth, 1)
    u = np.where(ok, cam.fx * pc[:, 0] / dd + cam.cx, -1); v = np.where(ok, cam.cy - cam.fy * pc[:, 1] / dd, -1)
    ok &= (u >= 0.5) & (u < W - 0.5) & (v >= 0.5) & (v < H - 0.5)
    ui, vi = np.clip(u - 0.5, 0, W - 1.001), np.clip(v - 0.5, 0, H - 1.001)
    zs = z[np.clip(np.rint(vi).astype(int), 0, H - 1), np.clip(np.rint(ui).astype(int), 0, W - 1)]
    ok &= (zs > 0) & (np.abs(zs - depth) < tol + 0.004 * depth)       # really the surface this view saw, not one behind it
    cosv = -(d * Nx).sum(1) / np.maximum(np.linalg.norm(d, axis=1), 1e-9)
    ok &= cosv > a.min_cos
    col = None
    if img is not None:
        x0, y0 = ui.astype(int), vi.astype(int); fx, fy = ui - x0, vi - y0
        col = (img[y0, x0] * ((1 - fx) * (1 - fy))[:, None] + img[y0, x0 + 1] * (fx * (1 - fy))[:, None] + img[y0 + 1, x0] * ((1 - fx) * fy)[:, None] + img[y0 + 1, x0 + 1] * (fx * fy)[:, None])
    return ok, cosv, depth, col, u, v


to_x3d = lambda P: np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)        # Blender Z-up -> X3D Y-up

# 1b. which faces does any Atlas view see? Only those get texture room; the rest share a flat swatch of their material
SEEN = {}
seen_faces = total_faces = 0
seen_area = total_area = 0.0
for o in meshes:
    me = o.data
    n = len(me.polygons)
    cen = np.empty(n * 3); me.polygons.foreach_get("center", cen); cen = cen.reshape(-1, 3)
    nrm = np.empty(n * 3); me.polygons.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
    ar = np.empty(n); me.polygons.foreach_get("area", ar)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    seen = np.zeros(n, bool)
    # samples per face: the centre and points 70% of the way to each corner
    samples = [cen]
    maxv = max(p.loop_total for p in me.polygons)
    for c in range(maxv):
        pts = np.array([co[p.vertices[c % p.loop_total]] for p in me.polygons])
        samples.append(cen + 0.7 * (pts - cen))
    for (_, cam, _, z) in VIEWS:
        for sp in samples:
            ok, *_ = project(to_x3d(sp), to_x3d(nrm), cam, z)
            seen |= ok
    # a fresh mesh has every vertex and edge selected, and edit mode would re-select the faces from them
    me.vertices.foreach_set("select", np.zeros(len(me.vertices), bool)); me.edges.foreach_set("select", np.zeros(len(me.edges), bool))
    me.polygons.foreach_set("select", seen)
    SEEN[o.name] = seen
    seen_faces += int(seen.sum()); total_faces += n; seen_area += float(ar[seen].sum()); total_area += float(ar.sum())
    me.update()
rec.update({"objects": len(meshes), "faces": total_faces, "faces_seen_by_a_view": seen_faces, "surface_m2": round(total_area, 2), "surface_seen_m2": round(seen_area, 2)})
print(f"faces seen by a view: {seen_faces} of {total_faces}; area {seen_area:.1f} of {total_area:.1f} m2", flush=True)

# 1c. unwrap the seen faces of all objects into one square (smart project packs across objects at one texel density)
mats = [m for m in bpy.data.materials if m.node_tree]
STRIP = 0.012                                                       # bottom strip of the square: one flat swatch per material
for o in meshes:
    if not o.data.uv_layers:
        o.data.uv_layers.new(name="UVMap")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_mode(type="FACE")
import bmesh
nsel = 0
for o in meshes:
    bm = bmesh.from_edit_mesh(o.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.select = bool(SEEN[o.name][f.index])
    bm.select_flush_mode()
    nsel += sum(f.select for f in bm.faces)
    bmesh.update_edit_mesh(o.data)
assert nsel == seen_faces, (nsel, seen_faces)
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0015, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")
for o in meshes:
    me = o.data
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    sel = SEEN[o.name]
    uv[:, 1] = STRIP + uv[:, 1] * (1 - STRIP)
    for p in me.polygons:
        if not sel[p.index]:
            mi = mats.index(me.materials[p.material_index]) if me.materials else 0
            uv[p.loop_start:p.loop_start + p.loop_total] = ((mi + 0.5) / len(mats), STRIP * 0.4)
    me.uv_layers.active.data.foreach_set("uv", uv.ravel()); me.update()
print("unwrapped", round(time.time() - t0, 1), "s", flush=True)

# 2. bake POSITION and NORMAL once, on a joined copy (374 separate bakes took 339 s per pass) ---------------------
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.duplicate()
dups = list(bpy.context.selected_objects)
bpy.context.view_layer.objects.active = dups[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 1
imgs = {k: bpy.data.images.new(f"bake_{k}", N, N, float_buffer=True, is_data=True) for k in ("POSITION", "NORMAL")}
nodes = [(m, m.node_tree.nodes.new("ShaderNodeTexImage")) for m in mats]
sc.render.bake.margin = 0
sc.render.bake.use_clear = True
sc.render.bake.use_selected_to_active = False
sc.render.bake.normal_space = "OBJECT"
got = {}
for k, im in imgs.items():
    for m, n in nodes:
        n.image = im; m.node_tree.nodes.active = n
    bpy.ops.object.bake(type=k)
    got[k] = np.array(im.pixels[:], np.float32).reshape(N, N, 4)     # row 0 is v = 0 (bottom)
    print("baked", k, round(time.time() - t0, 1), "s", flush=True)
bpy.data.objects.remove(joined, do_unlink=True)
for m, n in nodes:
    m.node_tree.nodes.remove(n)
pos = got["POSITION"][..., :3].astype(np.float64)
nor = got["NORMAL"][..., :3].astype(np.float64) * 2 - 1              # the bake stores normals as 0..1
ln = np.linalg.norm(nor, axis=-1)
used = (np.abs(ln - 1) < 0.05) & (got["NORMAL"][..., 3] > 0.5)       # POSITION alone cannot tell (0,0,0) from empty
used[: int(STRIP * N) + 1] = False                                   # the swatch strip is filled by hand below
nor /= np.maximum(ln, 1e-9)[..., None]
rec["texels_used_pct"] = round(float(100 * used.mean()), 2)
rec["mm_per_texel"] = round(1000 * (seen_area / max(used.sum(), 1)) ** 0.5, 2)
print("texels used", rec["texels_used_pct"], "% ; about", rec["mm_per_texel"], "mm per texel", flush=True)

# 3. project every used texel into every Atlas view ------------------------------------------------------------
P = pos[used]; Nn = nor[used]
Px, Nx = to_x3d(P), to_x3d(Nn)
acc = np.zeros((len(P), 3)); wsum = np.zeros(len(P)); seen = np.zeros(len(P), np.int16)
for (i, cam, img, z) in VIEWS:
    H, W = z.shape
    ok, cosv, depth, col, u, v = project(Px, Nx, cam, z, img)
    edge = np.minimum(np.minimum(u, W - u) / W, np.minimum(v, H - v) / H) * 2          # fade toward the picture border
    w = np.where(ok, (cosv ** 2) * np.clip(edge * 6, 0.05, 1) / np.maximum(depth, 0.3), 0) ** 3   # sharp: the best view dominates
    acc += col * w[:, None]; wsum += w; seen += ok
    print(f"view {i:02d}: paints {100 * ok.mean():.1f}% of the texels", flush=True)
painted = wsum > 0
tex = np.zeros((N, N, 3), np.uint8)
pm = np.zeros((N, N), bool); pm[used] = painted
tex[pm] = np.clip(np.rint(acc[painted] / wsum[painted, None]), 0, 255).astype(np.uint8)
rec["texels_painted_pct_of_used"] = round(float(100 * painted.mean()), 2)
rec["texels_seen_by_2_or_more_pct"] = round(float(100 * (seen >= 2).mean()), 2)

# 4. texels of seen faces that no view reached (slivers at grazing angles) take the nearest painted texel; everything
#    else in the square does too, which also bleeds colour past the island borders. Then the material swatches.
from scipy import ndimage as ndi
_, (iy, ix) = ndi.distance_transform_edt(~pm, return_indices=True)
tex = tex[iy, ix]
srgb = lambda c: int(round(255 * (c ** (1 / 2.2))))
for mi, m in enumerate(mats):
    x0, x1 = int(N * mi / len(mats)), int(N * (mi + 1) / len(mats))
    tex[: int(STRIP * N * 0.8), x0:x1] = [srgb(c) for c in m.diffuse_color[:3]]
mask = np.zeros((N, N), np.uint8); mask[used] = 90; mask[pm] = 255
png = stem.with_suffix(".jpg")
Image.fromarray(tex[::-1]).save(png, quality=a.jpeg, subsampling=0)   # image row 0 is the top
Image.fromarray(mask[::-1]).resize((1024, 1024), Image.NEAREST).save(str(stem) + "-coverage.png")
rec["texture"] = {"file": png.name, "bytes": png.stat().st_size}

# 5. one textured material, export -------------------------------------------------------------------------
img = bpy.data.images.load(str(png))
mat = bpy.data.materials.new("AtlasBaked"); mat.use_nodes = True
# the Atlas pictures already hold the light, so the texture is shown as it is: an Emission shader, which the add-on
# writes as UnlitMaterial + emissiveTexture. The Blender lights are left out of this file for the same reason.
nt = mat.node_tree
nt.nodes.remove(nt.nodes["Principled BSDF"])
em = nt.nodes.new("ShaderNodeEmission"); tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img
nt.links.new(tn.outputs["Color"], em.inputs["Color"]); nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
for o in [o for o in sc.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o, do_unlink=True)
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(mat)
blend_out = str(stem) + ".blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_out)
tmp = tempfile.mkdtemp(prefix="x3d_addon_")
(Path(tmp) / "io_scene_x3d").symlink_to(Path(a.addon).resolve() / "source", target_is_directory=True)
sys.path.insert(0, tmp)
import importlib
mod = importlib.import_module("io_scene_x3d")
try:
    mod.register()
except Exception as e:                                               # noqa: BLE001
    print("register:", e)
x3d = stem.with_suffix(".x3d")
r = bpy.ops.export_scene.x3d(filepath=str(x3d), x3d_version="X3D40", use_selection=False, use_mesh_modifiers=True, use_normals=True, name_decorations=False, path_mode="COPY")
rec["export"] = {"result": sorted(r), "file": x3d.name, "bytes": x3d.stat().st_size}
rec["seconds"] = round(time.time() - t0, 1)
Path(str(stem) + "-bake.json").write_text(json.dumps(rec, indent=1))
print(json.dumps(rec, indent=1))
