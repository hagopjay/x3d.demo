#!/usr/bin/env python3
"""match_exposure: make a second ring of Atlas pictures agree with the first, with one Blender compositor node.

Atlas paints each Chisel call on its own, so a second ring comes back at another exposure and white balance. A splat
or a bake that blends both rings then matches neither. The geometry is ours, so the same surface point can be found
in a ring-1 picture and a ring-2 picture exactly (unproject with the depth that was sent, reproject, depth-test).

  1. pairs: ring-2 pixels -> world points (sent depth) -> every ring-1 view that really sees the point
  2. fit one ASC CDL (slope, offset, power per channel, scene-linear) for the ring on pairs from the even ring-1 views
  3. score on pairs from the odd ring-1 views (held out)
  4. apply with Blender's compositor Color Balance node (Offset/Power/Slope) and check Blender against the numpy fit

  python match_exposure.py <ring1-dir> <ring2-dir> <prepared-dir> <out-dir> <receipt.json> [--stride 4]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.optimize import least_squares
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("ring1"); ap.add_argument("ring2"); ap.add_argument("prepared"); ap.add_argument("out"); ap.add_argument("receipt")
ap.add_argument("--stride", type=int, default=4); ap.add_argument("--tol-mm", type=float, default=25.0); ap.add_argument("--no-blender", action="store_true")
a = ap.parse_args(argv)
prep, out = Path(a.prepared), Path(a.out); out.mkdir(parents=True, exist_ok=True)


def ring(d):
    d = Path(d); op = json.loads((d / "operation.json").read_text())
    idx = [int(p.stem.split("-")[-1]) for p in sorted(d.glob("view-*"))]
    return [(idx[k], A.parse_camera(f["camera"]), np.asarray(Image.open(next(d.glob(f"view-{idx[k]:02d}.*"))).convert("RGB"), np.float64) / 255,
             A.read_exr_depth(prep / f"depth-{idx[k]:02d}.exr").astype(np.float64), next(d.glob(f"view-{idx[k]:02d}.*"))) for k, f in enumerate(op["response"]["frames"])]


to_lin = lambda s: np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
to_srgb = lambda l: np.where(l <= 0.0031308, l * 12.92, 1.055 * np.clip(l, 0, None) ** (1 / 2.4) - 0.055)
R1, R2 = ring(a.ring1), ring(a.ring2)
tol = a.tol_mm / 1000
pairs = {"train": [], "test": []}
for j, cam2, img2, z2, _ in R2:
    P, (rr, cc) = A.unproject(z2, cam2, stride=a.stride)
    c2 = img2[rr, cc]
    for i, cam1, img1, z1, _ in R1:
        H, W = z1.shape
        d = P - cam1.position; pc = d @ cam1.R; depth = -pc[:, 2]
        ok = depth > 0.05; dd = np.where(ok, depth, 1)
        u = cam1.fx * pc[:, 0] / dd + cam1.cx; v = cam1.cy - cam1.fy * pc[:, 1] / dd
        ok &= (u >= 1) & (u < W - 1) & (v >= 1) & (v < H - 1)
        ui, vi = np.clip(np.rint(u - 0.5).astype(int), 0, W - 1), np.clip(np.rint(v - 0.5).astype(int), 0, H - 1)
        zs = z1[vi, ui]
        ok &= (zs > 0) & (np.abs(zs - depth) < tol + 0.004 * depth)
        if ok.sum():
            pairs["test" if i % 2 else "train"].append(np.hstack([c2[ok], img1[vi[ok], ui[ok]], np.full((int(ok.sum()), 1), j)]))
tr, te = np.vstack(pairs["train"]), np.vstack(pairs["test"])
rng = np.random.default_rng(5)
trs = tr[rng.choice(len(tr), min(len(tr), 200000), replace=False)]


def cdl(lin, p):                                    # ASC CDL: (in * slope + offset) ^ power, per channel, scene-linear
    return np.clip(lin * p[0:3] + p[3:6], 0, None) ** p[6:9]


def fit(x, y):
    xl = to_lin(x)
    f = lambda p: (to_srgb(cdl(xl, p)) - y).ravel()
    r = least_squares(f, np.r_[1, 1, 1, 0, 0, 0, 1, 1, 1.0], bounds=(np.r_[0.2, 0.2, 0.2, -0.2, -0.2, -0.2, 0.4, 0.4, 0.4], np.r_[5, 5, 5, 0.2, 0.2, 0.2, 2.5, 2.5, 2.5]), loss="soft_l1", f_scale=0.1)
    return r.x


def score(x, y):
    e = x - y; mse = float((e ** 2).mean())
    return {"pairs": int(len(x)), "mean_level_ring2": float(255 * x.mean()), "mean_level_ring1": float(255 * y.mean()), "mean_abs_diff_255": float(255 * np.abs(e).mean()),
            "psnr_db": float(10 * np.log10(1 / mse)), "channel_bias_255": (255 * e.mean(0)).round(2).tolist()}


p = fit(trs[:, 0:3], trs[:, 3:6])
app = lambda x: np.clip(to_srgb(cdl(to_lin(x), p)), 0, 1)
gain = (trs[:, 3:6].mean() / trs[:, 0:3].mean())      # the simplest fix, for comparison: one exposure number
rec = {"method": "pairs = same surface point in a ring-2 and a ring-1 picture (unproject with the sent depth, reproject, depth test); fit on even ring-1 views, scored on odd ring-1 views",
       "rings": {"ring1": [v[0] for v in R1], "ring2": [v[0] for v in R2]}, "stride": a.stride, "depth_tolerance_mm": a.tol_mm,
       "cdl_scene_linear": {"slope": p[0:3].round(5).tolist(), "offset": p[3:6].round(5).tolist(), "power": p[6:9].round(5).tolist()},
       "train": {"before": score(tr[:, 0:3], tr[:, 3:6]), "after": score(app(tr[:, 0:3]), tr[:, 3:6])},
       "held_out": {"before": score(te[:, 0:3], te[:, 3:6]), "after_cdl": score(app(te[:, 0:3]), te[:, 3:6]),
                    "after_one_gain_only": score(np.clip(te[:, 0:3] * gain, 0, 1), te[:, 3:6])},
       "note": "pictures are generated, so two views of one point never agree exactly; the floor of this number is the ring-1 to ring-1 disagreement below"}
# floor: ring-1 against ring-1 on the same kind of pairs
fl = []
for j, cam2, img2, z2, _ in R1[::3]:
    P, (rr, cc) = A.unproject(z2, cam2, stride=a.stride * 2); c2 = img2[rr, cc]
    for i, cam1, img1, z1, _ in R1:
        if i == j: continue
        H, W = z1.shape; d = P - cam1.position; pc = d @ cam1.R; depth = -pc[:, 2]; ok = depth > 0.05; dd = np.where(ok, depth, 1)
        u = cam1.fx * pc[:, 0] / dd + cam1.cx; v = cam1.cy - cam1.fy * pc[:, 1] / dd
        ok &= (u >= 1) & (u < W - 1) & (v >= 1) & (v < H - 1)
        ui, vi = np.clip(np.rint(u - 0.5).astype(int), 0, W - 1), np.clip(np.rint(v - 0.5).astype(int), 0, H - 1)
        ok &= (z1[vi, ui] > 0) & (np.abs(z1[vi, ui] - depth) < tol + 0.004 * depth)
        if ok.sum(): fl.append(np.hstack([c2[ok], img1[vi[ok], ui[ok]]]))
fl = np.vstack(fl); rec["ring1_vs_ring1_floor"] = score(fl[:, 0:3], fl[:, 3:6])

for j, cam2, img2, z2, src in R2:                    # numpy result, the reference for the Blender check
    Image.fromarray((app(img2) * 255 + 0.5).astype(np.uint8)).save(out / f"view-{j:02d}.png")

if not a.no_blender:
    import bpy
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"; sc.display_settings.display_device = "sRGB"
    ng = bpy.data.node_groups.new("ring2_to_ring1", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    im = ng.nodes.new("CompositorNodeImage"); cb = ng.nodes.new("CompositorNodeColorBalance"); go = ng.nodes.new("NodeGroupOutput")
    for cand in ("Offset/Power/Slope (ASC-CDL)", "ASC-CDL", "OFFSET_POWER_SLOPE"):
        try:
            cb.inputs["Type"].default_value = cand; break
        except Exception as e:                        # noqa: BLE001
            err = str(e)
    rec["blender_node"] = {"node": "CompositorNodeColorBalance", "type": cb.inputs["Type"].default_value}
    cb.inputs["Color Slope"].default_value = (*p[0:3], 1); cb.inputs["Color Offset"].default_value = (*p[3:6], 1); cb.inputs["Color Power"].default_value = (*p[6:9], 1)
    ng.links.new(im.outputs["Image"], cb.inputs["Image"]); ng.links.new(cb.outputs[0], go.inputs[0])
    sc.compositing_node_group = ng
    sc.render.compositor_device = "CPU"; sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_depth = "8"; sc.render.image_settings.color_mode = "RGB"
    worst, means = 0, []
    for j, cam2, img2, z2, src in R2:
        im.image = bpy.data.images.load(str(src.resolve()))
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = img2.shape[1], img2.shape[0], 100
        sc.render.filepath = str((out / f"blender-view-{j:02d}.png").resolve())
        bpy.ops.render.render(write_still=True)
        b = np.asarray(Image.open(sc.render.filepath).convert("RGB"), np.int32); n = np.asarray(Image.open(out / f"view-{j:02d}.png"), np.int32)
        worst = max(worst, int(np.abs(b - n).max())); means.append(float(np.abs(b - n).mean()))
    bpy.ops.wm.save_as_mainfile(filepath=str((out / "ring2-to-ring1-compositor.blend").resolve()))
    rec["blender_node"].update({"blender": bpy.app.version_string, "view_transform": "Standard", "max_abs_diff_vs_numpy_255": worst, "mean_abs_diff_vs_numpy_255": float(np.mean(means)),
                                "blend": "ring2-to-ring1-compositor.blend"})
Path(a.receipt).write_text(json.dumps(rec, indent=1)); print(json.dumps(rec, indent=1))
