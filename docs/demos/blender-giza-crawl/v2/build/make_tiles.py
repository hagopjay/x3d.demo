# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: paint the tileable masks that the Blender materials read (they end up inside the baked textures).

All of it is invented decoration for the Authored Hall of Records: the glyphs are an original made-up script drawn
from simple strokes (discs, bars, zigzags, arcs), not Egyptian hieroglyphs, and the page says so.
Usage: python3 make_tiles.py OUT_DIR      (needs Pillow and numpy; deterministic, seed 1910)
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1910)


def glyph(d, x0, y0, w, h, kinds):
    """Draw 1 to 3 stacked strokes in a w x h cell: white ink on black (a mask)."""
    n = len(kinds)
    lw = max(3, int(w * 0.075))
    for k, kind in enumerate(kinds):
        cy = y0 + h * (k + 0.5) / n
        hh = h / n * 0.72
        cx = x0 + w / 2
        if kind == "disc":
            r = min(w, hh) * 0.34
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
        elif kind == "ring":
            r = min(w, hh) * 0.36
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=255, width=lw)
            d.ellipse((cx - lw * 0.7, cy - lw * 0.7, cx + lw * 0.7, cy + lw * 0.7), fill=255)
        elif kind == "bar":
            d.rectangle((x0 + w * 0.12, cy - lw * 0.8, x0 + w * 0.88, cy + lw * 0.8), fill=255)
        elif kind == "bars":
            for s in (-1, 1):
                d.rectangle((x0 + w * 0.18, cy + s * hh * 0.22 - lw * 0.6, x0 + w * 0.82, cy + s * hh * 0.22 + lw * 0.6), fill=255)
        elif kind == "zigzag":
            pts = [(x0 + w * (0.1 + 0.8 * i / 8), cy + (hh * 0.18 if i % 2 else -hh * 0.18)) for i in range(9)]
            d.line(pts, fill=255, width=lw, joint="curve")
        elif kind == "arc":
            d.arc((x0 + w * 0.15, cy - hh * 0.4, x0 + w * 0.85, cy + hh * 0.5), 180, 360, fill=255, width=lw)
        elif kind == "reed":
            d.line((cx, cy + hh * 0.48, cx, cy - hh * 0.48), fill=255, width=lw)
            d.polygon([(cx, cy - hh * 0.5), (cx + w * 0.22, cy - hh * 0.2), (cx, cy - hh * 0.05)], fill=255)
        elif kind == "tri":
            d.polygon([(cx, cy - hh * 0.42), (cx + w * 0.3, cy + hh * 0.38), (cx - w * 0.3, cy + hh * 0.38)], outline=255, width=lw)
        elif kind == "loop":
            d.rounded_rectangle((x0 + w * 0.2, cy - hh * 0.42, x0 + w * 0.8, cy + hh * 0.42), radius=w * 0.2, outline=255, width=lw)
        elif kind == "dots":
            for i in range(3):
                r = lw * 1.1
                px = x0 + w * (0.28 + 0.22 * i)
                d.ellipse((px - r, cy - r, px + r, cy + r), fill=255)
        elif kind == "hook":
            d.line((x0 + w * 0.3, cy + hh * 0.45, x0 + w * 0.3, cy - hh * 0.2), fill=255, width=lw)
            d.arc((x0 + w * 0.3, cy - hh * 0.5, x0 + w * 0.75, cy + hh * 0.1), 180, 360, fill=255, width=lw)
        elif kind == "eye":
            d.ellipse((x0 + w * 0.15, cy - hh * 0.2, x0 + w * 0.85, cy + hh * 0.2), outline=255, width=lw)
            d.ellipse((cx - lw * 1.4, cy - lw * 1.4, cx + lw * 1.4, cy + lw * 1.4), fill=255)


# 1. glyph columns: 16 columns x 12 rows on a 2048 square, with ruled column dividers (a mask, white = incised/painted)
S = 2048
img = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(img)
KINDS = ["disc", "ring", "bar", "bars", "zigzag", "arc", "reed", "tri", "loop", "dots", "hook", "eye"]
cols, rows = 16, 12
cw, ch = S / cols, S / rows
for c in range(cols):
    x0 = c * cw
    d.rectangle((x0, 0, x0 + 3, S), fill=255)                   # column rule
    for r in range(rows):
        n = int(rng.choice([1, 1, 2, 2, 3]))
        glyph(d, x0 + cw * 0.12, r * ch + ch * 0.08, cw * 0.76, ch * 0.84, list(rng.choice(KINDS, n)))
img = img.filter(ImageFilter.GaussianBlur(1.2))
img.save(os.path.join(OUT, "glyphs.png"))

# 2. star ceiling: five-pointed stars on a staggered grid (white = gold paint)
S = 1024
img = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(img)
n = 4
for gy in range(n):
    for gx in range(n):
        cx = (gx + 0.5 + (0.5 if gy % 2 else 0)) * S / n
        cy = (gy + 0.5) * S / n
        R, r = S / n * 0.3, S / n * 0.12
        rot = rng.normal(0, 0.08)
        pts = []
        for i in range(10):
            a = rot - math.pi / 2 + i * math.pi / 5
            rr = R if i % 2 == 0 else r
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        for dx in (-S, 0, S):
            d.polygon([(x + dx, y) for x, y in pts], fill=255)
img = img.filter(ImageFilter.GaussianBlur(1.0))
img.save(os.path.join(OUT, "stars.png"))

# 3. frieze: rounded-top uprights in four repeating colours, RGB (outlined in black)
W, H = 2048, 512
img = Image.new("RGB", (W, H), (30, 22, 16))
d = ImageDraw.Draw(img)
PAL = [(150, 40, 26), (24, 60, 120), (40, 110, 80), (196, 150, 52)]
n = 16
for i in range(n):
    x0, x1 = i * W / n + 10, (i + 1) * W / n - 10
    col = PAL[i % 4]
    d.rounded_rectangle((x0, 60, x1, H - 30), radius=(x1 - x0) / 2, fill=col, outline=(10, 8, 6), width=6)
    d.ellipse(((x0 + x1) / 2 - 18, 140, (x0 + x1) / 2 + 18, 176), fill=(232, 214, 170))
    d.rectangle((x0 + 18, H - 140, x1 - 18, H - 110), fill=(232, 214, 170))
d.rectangle((0, 0, W, 34), fill=(196, 150, 52))
d.rectangle((0, H - 22, W, H), fill=(196, 150, 52))
img.save(os.path.join(OUT, "frieze.png"))
print("tiles written to", OUT)

# 4. flame: a soft teardrop, white-gold core to red edge, alpha falloff (RGBA; drawn unlit on crossed quads)
W, H = 256, 512
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u = (xx - W / 2) / (W / 2)                      # -1..1 across
v = 1.0 - yy / H                                # 0 at the bottom, 1 at the top
width = np.clip(1.6 * np.clip(v + 0.02, 0, 1) ** 0.35 * np.clip(1 - v, 0, 1) ** 1.1, 1e-3, None)
flick = 0.06 * np.sin(v * 17.0) * v
r = np.abs(u - flick) / width
inten = np.clip(1 - r, 0, 1) ** 1.3 * np.clip(1 - v * 0.9, 0, 1) ** 0.6
core = np.clip(1 - r * 1.8, 0, 1) * np.clip(1 - v * 1.6, 0, 1)
rgb = np.stack([np.clip(0.9 * inten + 0.6 * core, 0, 1), np.clip(0.38 * inten + 0.7 * core, 0, 1), np.clip(0.06 * inten + 0.5 * core, 0, 1)], -1)
alpha = np.clip(inten * 1.6, 0, 1)
Image.fromarray((np.dstack([rgb, alpha]) * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "flame.png"))
print("flame written")
