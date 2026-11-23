# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: grade the cached linear bakes (cache/*.npy, written by bakery.py) into the shipped JPEGs.

One grade per zone, so neighbouring surfaces match: exposure is set so the zone's 90th-percentile luminance
(over texels that received any light) lands at `key`, then the Narkowicz ACES fit, an optional split tone
(shadows toward `shadow_tint`), and sRGB. Re-grading costs seconds and needs no Blender.
Usage: python3 -I retone.py OUT_DIR GRADES.json         GRADES: {zone: {objects: [...], key, sat, shadow_tint, lift}}
Prints the exposure chosen per zone (stops) and writes OUT_DIR/grades-applied.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

out_dir, grades_path = sys.argv[1], sys.argv[2]
grades = json.load(open(grades_path))
applied = {}


def aces(x):
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


def srgb(t):
    return np.where(t <= 0.0031308, 12.92 * t, 1.055 * np.power(np.maximum(t, 1e-8), 1 / 2.4) - 0.055)


def fill_empty(a, empty):
    """Push-pull: flood texels no island covers with the average of their covered neighbours, coarse to fine, so
    mipmaps and bilinear filtering never mix black into the edges of the islands."""
    levels, masks = [a * (~empty)[..., None]], [(~empty).astype(np.float32)]
    while min(levels[-1].shape[:2]) > 1:
        x, m = levels[-1], masks[-1]
        h, w = (x.shape[0] // 2) * 2, (x.shape[1] // 2) * 2
        xs = x[:h:2, :w:2] + x[1:h:2, :w:2] + x[:h:2, 1:w:2] + x[1:h:2, 1:w:2]
        ms = m[:h:2, :w:2] + m[1:h:2, :w:2] + m[:h:2, 1:w:2] + m[1:h:2, 1:w:2]
        levels.append(xs)
        masks.append(ms)
    filled = levels[-1] / np.maximum(masks[-1], 1e-6)[..., None]
    for x, m in zip(reversed(levels[:-1]), reversed(masks[:-1])):
        up = np.repeat(np.repeat(filled, 2, 0), 2, 1)
        up = np.pad(up, ((0, x.shape[0] - up.shape[0]), (0, x.shape[1] - up.shape[1]), (0, 0)), mode="edge")
        avg = x / np.maximum(m, 1e-6)[..., None]
        filled = np.where((m > 0)[..., None], avg, up)
    return np.where(empty[..., None], filled, a)


for zone, g in grades.items():
    arrs = {n: np.load(os.path.join(out_dir, "cache", n + ".npy")).astype(np.float32) for n in g["objects"]}
    lum = np.concatenate([(a @ np.array([0.2126, 0.7152, 0.0722], np.float32)).ravel() for a in arrs.values()])
    lit = lum[lum > 1e-4]
    p = float(np.percentile(lit, g.get("pct", 90))) if lit.size else 1.0
    # the scene value that ACES maps to `key` (display-linear), found by bisection
    lo, hi = 1e-4, 100.0
    for _ in range(60):
        mid = (lo * hi) ** 0.5
        lo, hi = (mid, hi) if aces(np.array(mid)) < g.get("key", 0.45) else (lo, mid)
    scale = lo / max(p, 1e-6)
    stops = float(np.log2(scale)) + g.get("bias", 0.0)
    tint = np.array(g.get("shadow_tint", [1, 1, 1]), np.float32)
    for n, a in arrs.items():
        empty = np.all(a == 0, axis=-1)
        if empty.any() and not empty.all():
            a = fill_empty(a, empty)
        x = a * 2.0 ** stops
        if g.get("sat", 1.0) != 1.0:
            l = (x @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
            x = l + (x - l) * g["sat"]
        t = aces(np.maximum(x, 0))
        w = np.clip(1 - t.mean(-1, keepdims=True) * 2.5, 0, 1)            # weight toward the darks
        t = t * (1 - w + w * tint) + g.get("lift", 0.0) * tint * (1 - t)
        img = (np.clip(srgb(np.clip(t, 0, 1)), 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(img[::-1]).save(os.path.join(out_dir, "tex", n + ".jpg"), quality=g.get("quality", 88), optimize=True, progressive=True)
    applied[zone] = dict(p_scene=round(p, 5), exposure_stops=round(stops, 2), **{k: v for k, v in g.items() if k != "objects"})
    print(zone, "exposure %+.2f stops" % stops, "p%d=%.4f" % (g.get("pct", 90), p))
json.dump(applied, open(os.path.join(out_dir, "grades-applied.json"), "w"), indent=1)
