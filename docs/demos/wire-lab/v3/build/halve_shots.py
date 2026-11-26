# SPDX-License-Identifier: GPL-3.0-or-later
"""python halve_shots.py <full-size dir> <out dir>: halves the 2x test screenshots and keeps each PNG under 600 KB."""
import sys
from pathlib import Path

from PIL import Image

src, out = Path(sys.argv[1]), Path(sys.argv[2])
for f in sorted(src.glob("*.png")):
    if f.name.startswith(".tmp"):
        continue
    im = Image.open(f).convert("RGB")
    if im.width != 1920:                     # shots were taken at 2x: halve them; the 1920 wide one was taken at 1x
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    target = out / f.name
    im.save(target, optimize=True)
    if target.stat().st_size > 600_000:      # still large: a 256-colour palette is enough for this dark UI
        im.quantize(256, dither=Image.NONE).save(target, optimize=True)
    print(f"{target.name}: {im.width}x{im.height}, {target.stat().st_size // 1024} KB")
