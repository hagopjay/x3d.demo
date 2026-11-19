# SPDX-License-Identifier: GPL-3.0-or-later
"""Sky geometry for Demo 65 v4: long-term precession (ERFA ltp, Vondrak 2011), linear space motion from the
HYG v4.1 catalogue, culmination altitudes at Giza. No refraction, nutation, aberration or horizon."""
import csv
import math
import erfa
import numpy as np

LAT = 29.979175          # WGS84 centre of the Great Pyramid's base (v1 receipt)
PC_LY = 3.2615638


def load_hyg(path):
    rows = []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        if r["id"] == "0" or not r["dist"]:
            continue
        d = float(r["dist"])
        if not (0 < d < 100000):          # HYG marks unknown distances as 100000 pc
            continue
        rows.append(r)
    return rows


def vec(r, year=2000.0):
    """Unit direction (equatorial J2000 axes) and distance in pc at a Julian epoch, linear space motion."""
    t = year - 2000.0
    p = np.array([float(r["x"]) + float(r["vx"] or 0) * t, float(r["y"]) + float(r["vy"] or 0) * t,
                  float(r["z"]) + float(r["vz"] or 0) * t])
    d = float(np.linalg.norm(p))
    return p / d, d


def precession(year):
    """Rotation matrix: mean J2000 equatorial -> mean equatorial of date (astronomical year numbering)."""
    return np.array(erfa.ltp(float(year)))


def dec_of_date(r, year):
    u, _ = vec(r, year)
    return math.degrees(math.asin(max(-1, min(1, (precession(year) @ u)[2]))))


def culminations(dec, lat=LAT):
    """Upper and lower culmination altitudes (deg) and which side of the zenith the upper one is on."""
    upper = 90 - abs(lat - dec)
    lower = lat + dec - 90 if lat >= 0 else -lat - dec - 90
    return upper, ("south" if dec < lat else "north"), lower


def to_x3d(m_or_v):
    """Equatorial axes (x to RA 0, y to RA 6 h, z to the north pole) -> X3D axes (X, Y up, Z) = (y, z, x)."""
    P = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], float)
    a = np.array(m_or_v, float)
    return P @ a if a.ndim == 1 else P @ a @ P.T


def axis_angle(R):
    """X3D SFRotation (axis x y z, angle) from a proper rotation matrix."""
    ang = math.acos(max(-1, min(1, (np.trace(R) - 1) / 2)))
    if ang < 1e-12:
        return [0, 1, 0, 0]
    ax = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * math.sin(ang))
    return [float(ax[0]), float(ax[1]), float(ax[2]), float(ang)]


def bv_to_rgb(bv):
    """B-V colour index -> display RGB (0..1), a common blackbody fit; clipped to -0.4..2.0."""
    bv = max(-0.4, min(2.0, bv))
    if bv < 0.0:
        t = (bv + 0.4) / 0.4; r = 0.61 + 0.11 * t + 0.1 * t * t
    elif bv < 0.4:
        t = bv / 0.4; r = 0.83 + 0.17 * t
    else:
        r = 1.0
    if bv < 0.0:
        t = (bv + 0.4) / 0.4; g = 0.70 + 0.07 * t + 0.1 * t * t
    elif bv < 0.4:
        t = bv / 0.4; g = 0.87 + 0.11 * t
    elif bv < 1.6:
        t = (bv - 0.4) / 1.2; g = 0.98 - 0.16 * t
    else:
        t = (bv - 1.6) / 0.4; g = 0.82 - 0.5 * t * t
    if bv < 0.4:
        b = 1.0
    elif bv < 1.5:
        t = (bv - 0.4) / 1.1; b = 1.0 - 0.47 * t + 0.1 * t * t
    elif bv < 1.94:
        t = (bv - 1.5) / 0.44; b = 0.63 - 0.6 * t * t
    else:
        b = 0.0
    return r, g, max(0.0, b)
