#!/usr/bin/env python3
"""analyze_chisel: how well does Atlas hold the X3D geometry? usage: analyze_chisel.py <slug> <label-dir>

For each view: the depth Atlas RETURNED (reconstructed from its own generated pictures, returnDepth) against the
X3D depth that was SENT for the same camera. Reports the raw relative error, the one global scale that best
aligns the set, and the error after that single scale. Writes receipts/<label>.json and a contact sheet.
This is a fidelity measure of this bridge's round trip, not a benchmark of the service.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A

slug, label = sys.argv[1], sys.argv[2]
out = HERE / "out" / slug
d = out / label
op = json.loads((d / "operation.json").read_text())
req = json.loads((d / "request.json").read_text())
n = len(op["response"]["frames"])
idx = [int(p.stem.split("-")[-1]) for p in sorted(d.glob("view-*"))]
rows, tiles, ratios = [], [], []
per = []
for k, i in enumerate(idx):
    img = next(d.glob(f"view-{i:02d}.*"))
    zx = A.read_exr_depth(out / f"depth-{i:02d}.exr").astype(np.float64)
    cam_sent = req["targetFrames"][k]["camera"]; cam_back = op["response"]["frames"][k]["camera"]
    dp = float(np.linalg.norm(np.array(cam_sent["extrinsics"]["position"]) - np.array(cam_back["extrinsics"]["position"])))
    qa, qb = A.q_norm(cam_sent["extrinsics"]["quaternion"]), A.q_norm(cam_back["extrinsics"]["quaternion"])
    dq = float(np.degrees(2 * np.arccos(min(1.0, abs(float(qa @ qb))))))
    row = {"view": i, "image": img.name, "image_bytes": img.stat().st_size, "image_size": Image.open(img).size,
           "camera_back_pos_diff_m": dp, "camera_back_rot_diff_deg": dq, "camera_back_fx": cam_back["intrinsics"]["fx"], "camera_sent_fx": cam_sent["intrinsics"]["fx"]}
    ze = d / f"atlas-depth-{i:02d}.exr"
    if ze.exists():
        za = A.read_exr_depth(ze).astype(np.float64)
        row["atlas_depth_grid"] = list(za.shape[::-1])
        va, vx = A.valid_depth(za), zx > 0
        both = va & vx
        r = za[both] / zx[both]
        ratios.append(r)
        row.update(atlas_depth_valid_pct=float(100 * va.mean()), x3d_depth_valid_pct=float(100 * vx.mean()),
                   ratio_median=float(np.median(r)), raw_rel_err_median_pct=float(100 * np.median(np.abs(r - 1))))
        per.append((i, za, zx, both))
    rows.append(row)
summary = {"slug": slug, "label": label, "operation": op["id"], "views": n, "prompt_enhanced": req.get("enhancePrompt"), "seed": req.get("modelParameters", {}).get("seed")}
if ratios:
    allr = np.concatenate(ratios)
    s = float(np.median(allr))                          # one scale for the whole set
    summary["global_scale_atlas_over_x3d"] = s
    errs = []
    for (i, za, zx, both), row in zip(per, [r for r in rows if "ratio_median" in r]):
        e = np.abs(za[both] / s - zx[both]) / zx[both]
        errs.append(e)
        row.update(scaled_rel_err_median_pct=float(100 * np.median(e)), scaled_rel_err_p90_pct=float(100 * np.percentile(e, 90)),
                   px_within_2pct=float(100 * (e < 0.02).mean()), px_within_5pct=float(100 * (e < 0.05).mean()),
                   abs_err_median_mm=float(1000 * np.median(np.abs(za[both] / s - zx[both]))))
        # tile: X3D bridge picture | Atlas view | error heat (0 = black, 10 % = white-hot)
        pic = Image.open(HERE / "out" / "bridge" / f"{slug}-{i:02d}-bridge.png").convert("RGB").resize((480, 270))
        av = Image.open(next(d.glob(f"view-{i:02d}.*"))).convert("RGB").resize((480, 270))
        em = np.zeros(zx.shape); em[both] = np.clip(np.abs(za[both] / s - zx[both]) / zx[both] / 0.10, 0, 1)
        heat = np.stack([np.clip(em * 3, 0, 1), np.clip(em * 3 - 1, 0, 1), np.clip(em * 3 - 2, 0, 1)], -1)
        heat[~both] = (0.05, 0.12, 0.3)
        tile = Image.new("RGB", (1440, 270)); tile.paste(pic, (0, 0)); tile.paste(av, (480, 0)); tile.paste(Image.fromarray((heat * 255).astype(np.uint8)).resize((480, 270)), (960, 0))
        tiles.append(tile)
    e = np.concatenate(errs)
    summary.update(scaled_rel_err_median_pct=float(100 * np.median(e)), scaled_rel_err_p90_pct=float(100 * np.percentile(e, 90)),
                   px_within_2pct=float(100 * (e < 0.02).mean()), px_within_5pct=float(100 * (e < 0.05).mean()),
                   raw_rel_err_median_pct=float(100 * np.median(np.abs(allr - 1))), pixels_compared=int(e.size))
else:
    for row in rows:
        i = row["view"]
        pic = Image.open(HERE / "out" / "bridge" / f"{slug}-{i:02d}-bridge.png").convert("RGB").resize((480, 270))
        av = Image.open(d / row["image"]).convert("RGB").resize((480, 270))
        tile = Image.new("RGB", (960, 270)); tile.paste(pic, (0, 0)); tile.paste(av, (480, 0)); tiles.append(tile)
tw = tiles[0].size[0]
sheet = Image.new("RGB", (tw, 270 * len(tiles)))
for k, t in enumerate(tiles):
    sheet.paste(t, (0, k * 270))
sheet.save(HERE / "shots" / f"{slug}-{label}-sheet.jpg", quality=88)
(HERE / "receipts" / f"{slug}-{label}.json").write_text(json.dumps({"summary": summary, "views": rows}, indent=1))
for r in rows:
    print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k not in ("image",)})
print(json.dumps(summary, indent=1))
