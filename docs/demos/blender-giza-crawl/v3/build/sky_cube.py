# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: the night sky over Giza in 2560 BC as six Background faces, from the Sky Machine's own data.

Input is Demo 65 v4 (blender-giza-numbers/v4/assets): sky.x3d (52,602 HYG v4.1 stars as Gaussian splats, equatorial
J2000 stored as X3D (X, Y, Z) = (y, z, x), positions in light-years) and sky-data.json (ERFA ltp precession as X3D-axis
quaternions every 50 years). The frame and rotation are the ones the Sky Machine uses (v6/sky-math.mjs):
    stage = Rx(latitude - 90 deg) . Ry(-LST) . P(year) . star,   stage X east, Y up, Z south  (= this scene's X3D frame)
LST is chosen so Alnitak stands on the meridian, as the Sky Machine's "Orion's belt on the meridian" view does.
Star brightness and colour come from the splats: angular size = scale / distance, colour = 0.5 + 0.2821 x SH DC.
No refraction, no extinction, no Moon. Usage: python3 -I sky_cube.py SKY_X3D SKY_DATA_JSON OUT_DIR [YEAR=-2559] [SIZE=1024]
Writes OUT_DIR/sky-{front,back,left,right,top,bottom}.jpg and sky-receipt.json.
"""
import hashlib
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

sky_x3d, sky_json, out = sys.argv[1:4]
YEAR = float(sys.argv[4]) if len(sys.argv) > 4 else -2559.0
N = int(sys.argv[5]) if len(sys.argv) > 5 else 1024
LAT = 29.979175
os.makedirs(out, exist_ok=True)
src = open(sky_x3d).read()
data = json.load(open(sky_json))


def field(def_name, name):
    m = re.search(r"<GaussianSplats DEF='%s'[^>]*?\b%s='([^']*)'" % (def_name, name), src, re.S)
    return np.array(m.group(1).split(), dtype=np.float64)


stars = []
for d in ("StarsBright", "StarsFaint"):
    pos = field(d, "positions").reshape(-1, 3)
    sc = field(d, "scales").reshape(-1, 3)[:, 0]
    op = field(d, "opacities")
    sh = field(d, "sphericalHarmonicsDegree0Coef0").reshape(-1, 3)
    stars.append((pos, sc, op, sh))
pos = np.concatenate([s[0] for s in stars])
ang = np.concatenate([s[1] for s in stars]) / np.linalg.norm(pos, axis=1)          # angular sigma, radians
op = np.concatenate([s[2] for s in stars])
col = np.clip(0.5 + 0.28209479 * np.concatenate([s[3] for s in stars]), 0, 1.6)
# magnitudes back from the Sky Machine's own splat formulas (sky.x3d meta): opacity = 0.95 x 10^(-0.20 (m - 4.2)) clipped
# to 0.08..0.95; brighter than m 4.2 the opacity saturates, so use sigma = 0.10 deg x 10^(-0.13 (m - 2)) clipped 0.012..0.42
sig_deg = np.degrees(ang)
m_op = 4.2 - 5.0 * np.log10(np.clip(op, 1e-3, None) / 0.95)
m_sig = 2.0 - np.log10(np.clip(sig_deg, 1e-6, None) / 0.10) / 0.13
mag = np.where(op < 0.949, m_op, np.minimum(m_sig, 4.2))
mag = np.where(op <= 0.0801, 99.0, mag)                         # opacity floor: fainter than the formula reaches, drop
flux = 10 ** (-0.4 * mag)
u = pos / np.linalg.norm(pos, axis=1, keepdims=True)


def qmul(a, b):
    return np.array([a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
                     a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]])


def qaxis(axis, angle):
    axis = np.array(axis, float) / np.linalg.norm(axis)
    return np.array([*(axis * math.sin(angle / 2)), math.cos(angle / 2)])


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        q = a + (b - a) * t
        return q / np.linalg.norm(q)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


pr = data["precession"]
q = np.array(pr["q"]).reshape(-1, 4)
f = (YEAR - pr["y0"]) / pr["step"]
i0 = int(math.floor(f))
P = slerp(q[i0], q[i0 + 1], f - i0)
alnitak = data["key"]["Alnitak"]
# LST with Alnitak on the meridian: its right ascension of date. In X3D star axes RA is atan2(X, Z) (x=RA0 -> Z, y=RA6h -> X)
v = qmat(P) @ u[alnitak]
lst = math.atan2(v[0], v[2])
R = qmul(qaxis((1, 0, 0), math.radians(LAT - 90)), qmul(qaxis((0, 1, 0), -lst), P))
S = u @ qmat(R).T                                                   # stage directions: X east, Y up, Z south
al = S[alnitak]
alt_alnitak = math.degrees(math.asin(al[1]))
az_alnitak = (math.degrees(math.atan2(al[0], -al[2])) + 360) % 360      # from north (-Z) through east (+X)

# faces: X3D Background front looks along -Z, back +Z, left -X, right +X, top +Y, bottom -Y. For each face: (forward, right, up)
FACES = {"front": ((0, 0, -1), (1, 0, 0), (0, 1, 0)), "back": ((0, 0, 1), (-1, 0, 0), (0, 1, 0)),
         "left": ((-1, 0, 0), (0, 0, -1), (0, 1, 0)), "right": ((1, 0, 0), (0, 0, 1), (0, 1, 0)),
         "top": ((0, 1, 0), (1, 0, 0), (0, 0, 1)), "bottom": ((0, -1, 0), (1, 0, 0), (0, 0, -1))}
pix_ang = 2.0 / N                                                    # radians per pixel at the face centre (approx.)
receipt = dict(source="Demo 65 v4 sky.x3d + sky-data.json (HYG v4.1, David Nash, CC BY-SA 4.0; ERFA ltp precession)",
               sky_x3d_sha256=hashlib.sha256(src.encode()).hexdigest(), year_astronomical=YEAR, latitude=LAT,
               lst_deg=round(math.degrees(lst) % 360, 3), alnitak_altitude_deg=round(alt_alnitak, 2), alnitak_azimuth_deg=round(az_alnitak, 2),
               stars=int(len(u)), faces={})
yy, xx = np.mgrid[0:N, 0:N]
for name, (fw, rt, up) in FACES.items():
    fw, rt, up = (np.array(a, float) for a in (fw, rt, up))
    img = np.zeros((N, N, 3), np.float64)
    # sky glow: deep blue zenith to a faint warm-grey horizon band, black below the horizon
    dirs = fw[None, None] + rt[None, None] * ((xx + 0.5) / N * 2 - 1)[..., None] + up[None, None] * (1 - (yy + 0.5) / N * 2)[..., None]
    dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
    h = dirs[..., 1]
    glow = np.where(h > 0, np.exp(-h / 0.12), 0.0)
    img += (np.array([0.0012, 0.0018, 0.0045]) + glow[..., None] * np.array([0.0080, 0.0065, 0.0060])) * (h > -0.02)[..., None]
    d = S @ fw
    keep = d > 0.4
    sx, sy, sz = S[keep] @ rt, S[keep] @ up, d[keep]
    px = (sx / sz + 1) / 2 * N
    py = (1 - sy / sz) / 2 * N
    above = S[keep][:, 1] > -0.01
    a_sig = np.maximum(ang[keep], 0.6 * pix_ang)
    sig = np.clip(0.6 + 0.35 * np.clip(3.0 - mag[keep], 0, None), 0.6, 2.2)
    amp = 1.4 * (flux[keep] / 10 ** (-0.4 * 2.0)) ** 0.75
    c = col[keep] / np.maximum(col[keep].max(1, keepdims=True), 1e-3)
    for x, y, s, a, cc, ok in zip(px, py, sig, amp, c, above):
        if not ok or not (-4 < x < N + 4 and -4 < y < N + 4):
            continue
        r = int(min(12, max(2, 3 * s)))
        x0, x1, y0, y1 = max(0, int(x) - r), min(N, int(x) + r + 1), max(0, int(y) - r), min(N, int(y) + r + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        gx = np.exp(-((np.arange(x0, x1) + 0.5 - x) ** 2) / (2 * s * s))
        gy = np.exp(-((np.arange(y0, y1) + 0.5 - y) ** 2) / (2 * s * s))
        img[y0:y1, x0:x1] += (gy[:, None] * gx[None, :])[..., None] * cc[None, None] * a
    disp = 1 - np.exp(-img * 2.2)
    disp = np.where(disp <= 0.0031308, 12.92 * disp, 1.055 * np.power(np.maximum(disp, 1e-9), 1 / 2.4) - 0.055)
    p = os.path.join(out, "sky-%s.jpg" % name)
    Image.fromarray((np.clip(disp, 0, 1) * 255 + 0.5).astype(np.uint8)).save(p, quality=90, optimize=True)
    receipt["faces"][name] = dict(file=os.path.basename(p), bytes=os.path.getsize(p), stars_drawn=int(above.sum()))
json.dump(receipt, open(os.path.join(out, "sky-receipt.json"), "w"), indent=1)
print("Alnitak alt %.2f az %.2f, LST %.2f deg" % (alt_alnitak, az_alnitak, math.degrees(lst) % 360))
