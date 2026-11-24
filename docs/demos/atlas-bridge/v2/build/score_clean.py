#!/usr/bin/env python3
"""score_clean: the clean baked X3D, drawn by the X3D -> three.js bridge, against the Atlas pictures it was baked from.
usage: score_clean.py <slug> <views-dir> <renders-dir> <tag> [stem]   -> receipts/<slug>-clean.json, shots/<slug>-clean-board.jpg"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
HERE = Path(__file__).resolve().parent.parent
slug, views, rd, tag = sys.argv[1], HERE / sys.argv[2], HERE / sys.argv[3], sys.argv[4]
stem = sys.argv[5] if len(sys.argv) > 5 else f"{slug}-clean"      # e.g. scriptorium-clean24
lum = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])
rows, tiles = [], []
for p in sorted(views.glob("view-*")):
    i = int(p.stem.split("-")[-1])
    A = np.asarray(Image.open(p).convert("RGB"), np.float64)
    r = rd / f"{stem}-{i:02d}-{tag}.png"
    if not r.exists():
        continue
    C = np.asarray(Image.open(r).convert("RGB").resize(A.shape[1::-1]), np.float64)
    z = np.load(HERE / "out" / "cycles" / f"cycles-{i:02d}.npz")["depth"]
    m = z > 0                                                        # sky through the windows is not part of the bake
    mse = ((A - C) ** 2)[m].mean()
    rows.append({"view": i, "psnr_db": float(10 * np.log10(255 ** 2 / mse)), "ssim": float(structural_similarity(lum(A), lum(C), data_range=255)),
                 "mean_abs_diff": float(np.abs(A - C)[m].mean()), "px_within_16_pct": float(100 * (np.abs(A - C).max(-1)[m] < 16).mean())})
    B = Image.open(HERE / "out" / "cycles" / f"cycles-{i:02d}.png").convert("RGB")
    t = Image.new("RGB", (1278, 240))
    for k, im in enumerate((B, Image.fromarray(A.astype(np.uint8)), Image.fromarray(C.astype(np.uint8)))):
        t.paste(im.resize((426, 240)), (426 * k, 0))
    tiles.append(t)
res = {"slug": slug, "views": len(rows), "per_view": rows, "psnr_mean_db": float(np.mean([r["psnr_db"] for r in rows])), "psnr_min_db": float(min(r["psnr_db"] for r in rows)),
       "ssim_mean": float(np.mean([r["ssim"] for r in rows])), "px_within_16_mean_pct": float(np.mean([r["px_within_16_pct"] for r in rows])),
       "bake": json.loads(next(q for q in (HERE / "out" / "clean" / f"{stem}-bake.json", HERE / "worlds" / f"{stem}-bake.json") if q.exists()).read_text()),
       "note": "the pictures being compared are the same ones the texture was baked from, so this measures what the bake loses (blending between views, texel size, unpainted texels), not new views"}
sys.path.insert(0, "/home/user/x3d_mcp/src")
from validation.validate import validate_xml
v = validate_xml((HERE / "worlds" / f"{stem}.x3d").read_text())
res["x3d"] = {"file": f"{stem}.x3d", "valid": bool(v.get("valid")), "errors": v.get("errors", [])[:5], "validator": "hagopjay/x3d_mcp 4d433af validate_xml"}
(HERE / "receipts" / f"{stem}.json").write_text(json.dumps(res, indent=1))
sh = Image.new("RGB", (1278 * 2, 240 * ((len(tiles) + 1) // 2)))
for k, t in enumerate(tiles):
    sh.paste(t, ((k % 2) * 1278, (k // 2) * 240))
sh.save(HERE / "shots" / f"{stem}-board.jpg", quality=88)
print(json.dumps({k: v for k, v in res.items() if k not in ("per_view", "bake")}, indent=1)); print([round(r["psnr_db"], 1) for r in rows])
