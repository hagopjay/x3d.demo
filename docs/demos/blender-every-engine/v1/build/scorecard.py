# SPDX-License-Identifier: GPL-3.0-or-later
"""Score every engine leg against the Cycles reference at fraction 0 (frame 1) and 0.25 (frame 61).
Usage: python -I scorecard.py SHOTS_DIR OUT_JSON"""
import json, sys
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
import skimage

shots, out = sys.argv[1], sys.argv[2]
LEGS = ["xite", "x3dom", "castle", "three", "babylon", "castle-glb", "three-compat", "babylon-compat", "castle-glb-compat",
        "three-fixed", "babylon-fixed", "blender-glb", "castle-glb-fixed", "blender-glb-fixed", "blender-usdc", "blender-usdc-restored"]
load = lambda p: np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0
ref = {k: load("%s/cycles-%s.png" % (shots, k)) for k in ("t0", "q")}
rep = {"schema": "x3d-demo/every-engine/1", "tool": "scikit-image %s SSIM (channel_axis=2, data_range=1)" % skimage.__version__,
       "reference": "Blender 5.3.0 Cycles, 96 spp, OIDN, frames 1 and 61", "legs": {}}
for leg in LEGS:
    r = {}
    imgs = {k: load("%s/%s-%s.png" % (shots, leg, k)) for k in ("t0", "q")}
    for k in ("t0", "q"):
        r["ssim_" + k] = round(float(structural_similarity(ref[k], imgs[k], channel_axis=2, data_range=1.0)), 3)
        r["delta_" + k] = round(float(np.abs(imgs[k] - ref[k]).mean() * 255), 1)
    r["white_pct"] = round(float((imgs["t0"].min(axis=2) > 0.98).mean() * 100), 1)
    r["motion_255"] = round(float(np.abs(imgs["q"] - imgs["t0"]).mean() * 255), 2)
    r["moves"] = r["motion_255"] > 0.5
    rep["legs"][leg] = r
rep["cycles_white_pct"] = round(float((ref["t0"].min(axis=2) > 0.98).mean() * 100), 1)
json.dump(rep, open(out, "w"), indent=1)
for k, v in rep["legs"].items():
    print("%-18s" % k, v)
print("cycles white %", rep["cycles_white_pct"])
