# SPDX-License-Identifier: GPL-3.0-or-later
"""Score browser frames against the Cycles reference: PSNR, SSIM, mean |delta| (0-255) and a heat map.

Usage: python -I score.py reference.png OUT_DIR name=frame.png [name=frame.png ...]
"""
import json
import sys

import numpy as np
from PIL import Image
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

ref_path, out_dir = sys.argv[1], sys.argv[2]
ref = np.asarray(Image.open(ref_path).convert("RGB"), dtype=np.float64) / 255.0
report = {"schema": "x3d-demo/frame-score/1", "reference": ref_path.split("/")[-1], "size": list(ref.shape[1::-1]),
          "tool": "scikit-image %s structural_similarity (channel_axis=2, data_range=1) and peak_signal_noise_ratio"
          % __import__("skimage").__version__, "frames": {}}
for arg in sys.argv[3:]:
    name, path = arg.split("=", 1)
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
    if img.shape != ref.shape:
        raise SystemExit("%s is %s, reference is %s" % (path, img.shape, ref.shape))
    d = np.abs(img - ref)
    lum_ref, lum_img = ref.mean(axis=2), img.mean(axis=2)
    report["frames"][name] = {
        "psnr_db": round(float(peak_signal_noise_ratio(ref, img, data_range=1.0)), 2),
        "ssim": round(float(structural_similarity(ref, img, channel_axis=2, data_range=1.0)), 4),
        "mean_abs_delta_255": round(float(d.mean() * 255), 2),
        "p95_abs_delta_255": round(float(np.percentile(d.mean(axis=2), 95) * 255), 2),
        "mean_luminance_ratio": round(float(lum_img.mean() / max(lum_ref.mean(), 1e-9)), 3),
    }
    heat = np.clip(d.mean(axis=2) * 4.0, 0, 1)  # x4 so a 64/255 error is full scale
    rgb = np.stack([heat, heat ** 2 * 0.6, (1 - heat) * 0.25 * (heat > 0.02)], axis=2)
    Image.fromarray((rgb * 255).astype(np.uint8)).save("%s/heat-%s.png" % (out_dir, name))
json.dump(report, open("%s/scores.json" % out_dir, "w"), indent=1)
print(json.dumps(report["frames"], indent=1))
