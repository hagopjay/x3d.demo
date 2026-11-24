#!/usr/bin/env python3
"""cycles_judge: Cycles as the referee for what Atlas painted on a Blender scene.

Cycles knows the scene exactly: for every pixel of every camera, which object is there (object index pass), how far
it is (depth pass) and what a physically based render of the flat materials looks like. Atlas saw only the depth.
Four questions, each answered per view and per object:

  edges      for every object outline Cycles drew, is there an edge in the Atlas picture at the same place?
             (the same measure on the Cycles picture itself is the ceiling)
  objects    which named Blender objects did Atlas paint as something distinct, and which did it lose?
  materials  does each object keep the hue of its Blender material? (colour was never sent, only named in the prompt)
  picture    SSIM and PSNR of Atlas against Cycles, for the record: they are different pictures by design

  python cycles_judge.py <cycles-dir> <atlas-views-dir> <out.json> [--sheet shots/x.jpg]
"""
import argparse, colorsys, json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.metrics import structural_similarity

ap = argparse.ArgumentParser(); ap.add_argument("cycles"); ap.add_argument("views"); ap.add_argument("out"); ap.add_argument("--sheet"); ap.add_argument("--min-px", type=int, default=600)
a = ap.parse_args()
cy, vd = Path(a.cycles), Path(a.views)
names = {int(k): v for k, v in json.loads((cy / "pass-index.json").read_text()).items()}
lum = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])


def grad(im):
    g = ndi.gaussian_filter(lum(im), 1.0)
    return np.hypot(ndi.sobel(g, 0), ndi.sobel(g, 1))


def hue_sat(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(np.clip(rgb, 0, 255) / 255))
    return h * 360, s, v


rows, per_obj, tiles = [], {}, []
idx = sorted(int(p.stem.split("-")[-1]) for p in vd.glob("view-*"))
for i in idx:
    A = np.asarray(Image.open(next(vd.glob(f"view-{i:02d}.*"))).convert("RGB"), np.float64)
    C = np.asarray(Image.open(cy / f"cycles-{i:02d}.png").convert("RGB"), np.float64)
    z = np.load(cy / f"cycles-{i:02d}.npz"); ids, depth = z["ids"].astype(int), z["depth"]
    # outlines: where the object index changes between neighbours
    b = np.zeros(ids.shape, bool)
    b[:, 1:] |= ids[:, 1:] != ids[:, :-1]; b[1:, :] |= ids[1:, :] != ids[:-1, :]
    gA, gC = grad(A), grad(C)
    # an "edge" is a gradient above the picture's own 80th percentile, looked for within 3 px of the outline
    eA = ndi.maximum_filter(gA, 7) > np.percentile(gA, 80); eC = ndi.maximum_filter(gC, 7) > np.percentile(gC, 80)
    row = {"view": i, "outline_px": int(b.sum()), "outline_recall_atlas_pct": float(100 * eA[b].mean()), "outline_recall_cycles_pct": float(100 * eC[b].mean())}
    # edges Atlas added where Cycles has neither an outline nor an edge: detail it invented (stone joints, carving, grain)
    far = ~ndi.binary_dilation(b, iterations=6)
    row["atlas_edge_px_away_from_any_outline_pct"] = float(100 * ((gA > np.percentile(gA, 80)) & far).sum() / far.sum())
    row["cycles_edge_px_away_from_any_outline_pct"] = float(100 * ((gC > np.percentile(gC, 80)) & far).sum() / far.sum())
    row["ssim"] = float(structural_similarity(lum(A), lum(C), data_range=255)); row["psnr_db"] = float(10 * np.log10(255 ** 2 / ((A - C) ** 2).mean()))
    rows.append(row)
    for oid in np.unique(ids):
        if oid == 0 or oid not in names:
            continue
        m = ids == oid
        n = int(m.sum())
        if n < a.min_px:
            continue
        ob = b & ndi.binary_dilation(m, iterations=1) & ~ndi.binary_erosion(m, iterations=1)
        core = ndi.binary_erosion(m, iterations=2)
        if core.sum() < 50 or ob.sum() < 30:
            continue
        d = per_obj.setdefault(names[oid], {"views": 0, "px": 0, "recall_atlas": [], "recall_cycles": [], "atlas_rgb": [], "cycles_rgb": []})
        d["views"] += 1; d["px"] += n
        d["recall_atlas"].append(float(eA[ob].mean())); d["recall_cycles"].append(float(eC[ob].mean()))
        d["atlas_rgb"].append(np.median(A[core], 0)); d["cycles_rgb"].append(np.median(C[core], 0))
    if a.sheet:
        ov = A.copy(); hit = b & eA; miss = b & ~eA
        ov[ndi.binary_dilation(hit, iterations=1)] = (40, 230, 90); ov[ndi.binary_dilation(miss, iterations=1)] = (255, 40, 60)
        t = Image.new("RGB", (1278, 240))
        for k, im in enumerate((C, A, ov)):
            t.paste(Image.fromarray(im.astype(np.uint8)).resize((426, 240)), (426 * k, 0))
        tiles.append(t)
objs = []
for name, d in per_obj.items():
    ar, cr = np.median(d["atlas_rgb"], 0), np.median(d["cycles_rgb"], 0)
    ha, sa, va = hue_sat(ar); hc, sc_, vc = hue_sat(cr)
    dh = abs((ha - hc + 180) % 360 - 180)
    objs.append({"object": name, "views": d["views"], "pixels": d["px"], "outline_recall_atlas_pct": round(100 * float(np.mean(d["recall_atlas"])), 1),
                 "outline_recall_cycles_pct": round(100 * float(np.mean(d["recall_cycles"])), 1),
                 "atlas_rgb": [int(v) for v in ar], "cycles_rgb": [int(v) for v in cr], "hue_diff_deg": round(dh, 1) if min(sa, sc_) > 0.12 else None,
                 "value_atlas": round(va, 3), "value_cycles": round(vc, 3)})
objs.sort(key=lambda o: o["outline_recall_atlas_pct"])
hd = [o["hue_diff_deg"] for o in objs if o["hue_diff_deg"] is not None]
res = {"views": len(rows), "per_view": rows, "objects_judged": len(objs),
       "summary": {"outline_recall_atlas_pct": float(np.mean([r["outline_recall_atlas_pct"] for r in rows])), "outline_recall_cycles_pct": float(np.mean([r["outline_recall_cycles_pct"] for r in rows])),
                   "objects_with_recall_under_50pct": [o["object"] for o in objs if o["outline_recall_atlas_pct"] < 50],
                   "objects_with_recall_over_90pct": int(sum(o["outline_recall_atlas_pct"] >= 90 for o in objs)),
                   "hue_diff_median_deg": float(np.median(hd)) if hd else None, "objects_hue_within_25deg_pct": float(100 * np.mean(np.array(hd) < 25)) if hd else None, "objects_with_hue": len(hd),
                   "detail_added_atlas_pct": float(np.mean([r["atlas_edge_px_away_from_any_outline_pct"] for r in rows])), "detail_in_cycles_pct": float(np.mean([r["cycles_edge_px_away_from_any_outline_pct"] for r in rows])),
                   "ssim_mean": float(np.mean([r["ssim"] for r in rows])), "psnr_mean_db": float(np.mean([r["psnr_db"] for r in rows]))},
       "objects": objs,
       "method": "outlines = object-index changes in the Cycles pass; edge = Sobel gradient of the 1 px blurred luminance above the picture's own 80th percentile, searched within 3 px; hue = HSV hue of the per-object median colour (objects with saturation under 0.12 on either side have no hue)"}
Path(a.out).write_text(json.dumps(res, indent=1))
if a.sheet and tiles:
    sh = Image.new("RGB", (1278 * 2, 240 * ((len(tiles) + 1) // 2)))
    for k, t in enumerate(tiles):
        sh.paste(t, ((k % 2) * 1278, (k // 2) * 240))
    sh.save(a.sheet, quality=88)
print(json.dumps(res["summary"], indent=1))
for o in objs[:10]:
    print(o)
