#!/usr/bin/env python3
"""Label agreement: X_ITE render of each Atlas camera's X3D Viewpoint vs the raycast label image of the same camera.
    python3 build/compare.py /tmp/cam   -> receipts/camtest.json
A pixel agrees when its nearest label colour (X_ITE frame, UnlitMaterial, antialiasing off) names the object the
raycaster hit through that pixel's centre. Sky (window) is black in X_ITE and id 0 in the label image."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
HERE = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1])
labels = json.loads((HERE / "data/bundle/labels.json").read_text())
ids = np.array([0] + [int(k) for k in labels])
pal = np.array([[0, 0, 0]] + [labels[k]["label"] for k in labels]) * 255
meta = json.loads((src / "camtest-meta.json").read_text())
res = {"rig": f"X_ITE {meta['x_ite']}, Chromium {meta['chromium']} headless, {meta['webgl']}, 1280x720 CSS px at DPR 1, antialiased=false",
       "worlds": {}}
for w in meta["worlds"]:
    per = []
    for i in range(10):
        im = np.asarray(Image.open(src / f"{w}_cam{i}.png").convert("RGB")).astype(np.float64)
        d = ((im[:, :, None, :] - pal[None, None]) ** 2).sum(-1)
        got = ids[d.argmin(-1)]
        truth = np.asarray(Image.open(HERE / f"data/bundle/frames_{i}_label.png")).astype(int)
        per.append(float((got == truth).mean() * 100))
        if w == "correct" and i in (0, 3, 8):
            Image.fromarray(im.astype(np.uint8)).save(HERE / f"shots/xite-labels-cam{i}.webp", quality=85)
    res["worlds"][w] = {"per_camera_pct": [round(x, 3) for x in per], "mean_pct": round(float(np.mean(per)), 3),
                        "min_pct": round(float(np.min(per)), 3)}
    print(w, res["worlds"][w]["mean_pct"], res["worlds"][w]["min_pct"])
(HERE / "receipts/camtest.json").write_text(json.dumps(res, indent=1))
