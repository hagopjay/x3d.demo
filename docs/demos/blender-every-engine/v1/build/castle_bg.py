# SPDX-License-Identifier: GPL-3.0-or-later
"""Castle clears to 26/255 grey when a scene has no Background (X3D's default is black). Replace exactly-(26,26,26)
pixels with black so the score measures the model, not the clear colour. python castle_bg.py RAW.png OUT.png"""
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).copy()
m = (a == 26).all(axis=2)
a[m] = 0
Image.fromarray(a).save(sys.argv[2])
print(sys.argv[1], "background pixels", round(m.mean() * 100, 1), "%")
