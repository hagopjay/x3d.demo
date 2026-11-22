# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2, zone 4: the imagined Hall of Records (AUTHORED: Cayce's legend, no such hall is known).

Same footprint and position as v1 (56 x 30 x 11 m, floor 26 m down, east of the Sphinx) so the route and the before/after
frames line up. Everything inside it is invented: a hypostyle hall of 16 papyrus-bundle columns, painted walls carrying
an invented script, a star ceiling, gilt archive shrines, a dais under a light well, bronze braziers.
Style: torch-lit, warm, deep shadow; Cycles light baked into image textures.
"""
import math

import bmesh
from mathutils import Vector

import geo
import mats

HX, HY, HZ = 125.0, -18.0, -26.0
L, W, H = 56.0, 30.0, 11.0
AUTH = {"grade": "Authored", "what": "Imagined: Cayce's Hall of Records. No hall has been found; size, shape and decoration are invented",
        "source": "Edgar Cayce trance readings, 1930s and 1940s (a legend)"}
ZONE = "hall"
COL_XS = [HX - 24 + i * 6.8 for i in range(8)]
COL_YS = [HY - 7.0, HY + 7.0]
ARCH_H = 1.0
COL_H = H - ARCH_H


T0 = Vector((36.0, -6.0, -2.0))
T1 = Vector((HX - 28.0, HY, HZ))


def build():
    x0, x1, y0, y1, z0, z1 = HX - L / 2, HX + L / 2, HY - W / 2, HY + W / 2, HZ, HZ + H
    M = dict(wall=mats.painted_wall("Hall walls (painted, invented script)", HZ, H),
             ceil=mats.star_ceiling("Hall star ceiling"),
             floor=mats.floor_flags("Hall floor (granite, alabaster nave)", 2.4, HY),
             col=mats.column_paint("Hall columns (papyrus bundle)", HZ, COL_H),
             gilt=mats.gilt("Gilt"),
             arch=mats.limestone_blocks("Hall architraves", course=1.0, block=6.8, tone=(0.78, 0.66, 0.48)),
             bronze=mats.bronze("Bronze"),
             fire=mats.sprite("Brazier flame", "flame.png", 6.0))
    # floor and ceiling as separate objects (each its own bake image); the west wall has the tunnel mouth
    bm = bmesh.new()
    geo.quad(bm, (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0))
    geo.add("Hall floor", bm, M["floor"], AUTH, ZONE)
    # ceiling with a 2.4 m square light well over the dais; the well's shaft rises 6 m
    wx0, wx1, wy0, wy1 = HX + 23.1, HX + 25.5, HY - 1.2, HY + 1.2
    bm = bmesh.new()
    for (a0, a1, b0, b1) in ((x0, wx0, y0, y1), (wx1, x1, y0, y1), (wx0, wx1, y0, wy0), (wx0, wx1, wy1, y1)):
        geo.quad(bm, (a0, b0, z1), (a0, b1, z1), (a1, b1, z1), (a1, b0, z1))
    geo.add("Hall ceiling", bm, M["ceil"], AUTH, ZONE)
    bm = bmesh.new()
    geo.box_bm(bm, wx0, wy0, z1, wx1, wy1, z1 + 6.0, inward=True, skip=("top", "bottom"))
    geo.add("Hall light well", bm, M["arch"], AUTH, ZONE)
    bm = bmesh.new()
    geo.quad(bm, (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1))        # north wall, faces -y
    geo.quad(bm, (x1, y0, z0), (x0, y0, z0), (x0, y0, z1), (x1, y0, z1))        # south wall, faces +y
    for f in list(bm.faces):
        f.normal_update()
    geo.add("Hall long walls", bm, M["wall"], AUTH, ZONE)
    bm = bmesh.new()
    geo.quad(bm, (x1, y1, z0), (x1, y0, z0), (x1, y0, z1), (x1, y1, z1))        # east wall faces -x
    tw, th = 2.2, 2.6                                                          # west wall with the tunnel mouth
    for (a0, a1, b0, b1) in ((y0, HY - tw / 2, z0, z1), (HY + tw / 2, y1, z0, z1), (HY - tw / 2, HY + tw / 2, z0 + th, z1)):
        geo.quad(bm, (x0, a0, b0), (x0, a1, b0), (x0, a1, b1), (x0, a0, b1))
    geo.add("Hall end walls", bm, M["wall"], AUTH, ZONE)

    # columns: base disc, lobed papyrus-bundle shaft, five tie bands, closed-bud capital, abacus
    bm = bmesh.new()
    R = 1.05
    for cx in COL_XS:
        for cy in COL_YS:
            prof = [(z0, R * 1.35, 0), (z0 + 0.35, R * 1.35, 0), (z0 + 0.36, R * 1.02, 1), (z0 + 1.2, R * 1.08, 1),
                    (z0 + COL_H * 0.5, R * 1.0, 1), (z0 + COL_H * 0.73, R * 0.92, 1), (z0 + COL_H * 0.74, R * 0.98, 0.3),
                    (z0 + COL_H * 0.85, R * 0.98, 0.3), (z0 + COL_H * 0.86, R * 0.92, 1), (z0 + COL_H * 0.91, R * 1.18, 1),
                    (z0 + COL_H * 0.955, R * 0.95, 1), (z0 + COL_H * 0.96, R * 0.62, 0)]
            geo.lathe(bm, prof, 48, cx, cy, lobes=8, lobe_amp=0.09)
            geo.box_bm(bm, cx - 0.75, cy - 0.75, z0 + COL_H * 0.96, cx + 0.75, cy + 0.75, z0 + COL_H, skip=("bottom",))
    geo.add("Hall columns", bm, M["col"], AUTH, ZONE, smooth=True)
    # architraves along both rows
    bm = bmesh.new()
    for cy in COL_YS:
        geo.box_bm(bm, x0, cy - 0.8, z1 - ARCH_H, x1, cy + 0.8, z1, skip=("top",))
    geo.add("Hall architraves", bm, M["arch"], AUTH, ZONE)

    # gilt archive shrines along both long walls (naos form: body, torus moulding, flared cavetto cornice)
    bm = bmesh.new()
    for side in (-1, 1):
        for i in range(12):
            x = HX - 22 + i * 4
            yw = HY + side * (W / 2 - 0.05)
            yb, yf = yw, yw - side * 0.9
            ya, yz = min(yb, yf), max(yb, yf)
            geo.box_bm(bm, x - 0.85, ya, z0, x + 0.85, yz, z0 + 2.4, skip=("bottom",))
            geo.box_bm(bm, x - 0.95, ya - (0.08 if side > 0 else 0), z0 + 2.4, x + 0.95, yz + (0.08 if side < 0 else 0), z0 + 2.55)
            geo.box_bm(bm, x - 1.05, ya - (0.18 if side > 0 else 0), z0 + 2.55, x + 1.05, yz + (0.18 if side < 0 else 0), z0 + 2.8)
    geo.add("Hall archive shrines", bm, M["gilt"], AUTH, ZONE)

    # the dais at the east end: three steps, a great shrine, two obelisks; a light well above it
    bm = bmesh.new()
    for k in range(3):
        geo.box_bm(bm, HX + 19 + k * 0.9, HY - 6 + k * 0.6, z0, x1 - 0.05, HY + 6 - k * 0.6, z0 + 0.3 * (k + 1), skip=("bottom",))
    geo.add("Hall dais", bm, M["arch"], AUTH, ZONE)
    dz = z0 + 0.9
    bm = bmesh.new()
    geo.box_bm(bm, HX + 23.0, HY - 1.6, dz, HX + 25.6, HY + 1.6, dz + 3.2, skip=("bottom",))
    geo.box_bm(bm, HX + 22.8, HY - 1.8, dz + 3.2, HX + 25.8, HY + 1.8, dz + 3.45)
    geo.box_bm(bm, HX + 22.6, HY - 2.0, dz + 3.45, HX + 26.0, HY + 2.0, dz + 3.8)
    for oy in (-4.2, 4.2):
        b = 0.45
        prof = [(dz, b, 0), (dz + 5.2, b * 0.72, 0)]
        v = [bm.verts.new(p) for p in ((HX + 24.3 - b, HY + oy - b, dz), (HX + 24.3 + b, HY + oy - b, dz), (HX + 24.3 + b, HY + oy + b, dz),
                                        (HX + 24.3 - b, HY + oy + b, dz))]
        t = 0.72 * b
        u = [bm.verts.new(p) for p in ((HX + 24.3 - t, HY + oy - t, dz + 5.2), (HX + 24.3 + t, HY + oy - t, dz + 5.2),
                                        (HX + 24.3 + t, HY + oy + t, dz + 5.2), (HX + 24.3 - t, HY + oy + t, dz + 5.2))]
        apex = bm.verts.new((HX + 24.3, HY + oy, dz + 5.9))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((v[i], v[j], u[j], u[i]))
            bm.faces.new((u[i], u[j], apex))
    geo.add("Hall great shrine and obelisks", bm, M["gilt"], AUTH, ZONE)

    # braziers: bronze bowl on a stem in two lines along the nave, flames as emissive cones
    bm_b, bm_f = bmesh.new(), bmesh.new()
    BRAZ = []
    for i in range(7):
        x = (COL_XS[i] + COL_XS[i + 1]) / 2
        for side in (-1, 1):
            y = HY + side * 4.4
            geo.lathe(bm_b, [(z0, 0.45, 0), (z0 + 0.1, 0.45, 0), (z0 + 0.12, 0.12, 0), (z0 + 1.05, 0.09, 0), (z0 + 1.1, 0.25, 0),
                             (z0 + 1.35, 0.6, 0), (z0 + 1.42, 0.62, 0)], 24, x, y)
            geo.sprite_cross(bm_f, (x, y, z0 + 1.22), 0.95, 1.35, 3)
            BRAZ.append((x, y, z0 + 1.75))
    geo.add("Hall braziers", bm_b, M["bronze"], AUTH, ZONE, smooth=True)
    geo.add("Hall brazier flames", bm_f, M["fire"], AUTH, None, smooth=True)     # not baked: emissive, drawn unlit

    # the imagined tunnel from the Sphinx enclosure down to the hall: sandstone with torch sconces
    TUN = mats.limestone_blocks("Hall tunnel sandstone", course=0.55, block=0.9, tone=(0.70, 0.52, 0.34), slope_deg=math.degrees(math.atan2(T0.z - T1.z, (T1 - T0).xy.length)))
    geo.tunnel("Imagined tunnel to the Hall", T0, T1, 2.2, 2.6, TUN, AUTH, ZONE, 10)
    n_t = 9
    for k in range(n_t):
        p = T0 + (T1 - T0) * ((k + 0.5) / n_t)
        dirt = (T1 - T0).normalized()
        side = dirt.cross(Vector((0, 0, 1))).normalized()
        geo.lamp("Tunnel torch %d" % k, "POINT", 40.0, p + side * (0.95 if k % 2 else -0.95) + Vector((0, 0, 1.9)), (1.0, 0.5, 0.16), radius=0.08)

    # light: braziers (warm, soft), wall lamps between shrines, the light well over the dais, a faint cold fill
    for i, (x, y, z) in enumerate(BRAZ):
        geo.lamp("Brazier light %d" % i, "POINT", 260.0, (x, y, z), (1.0, 0.46, 0.13), radius=0.35)
        geo.lamp("Brazier glow up %d" % i, "SPOT", 420.0, (x, y, z + 0.5), (1.0, 0.55, 0.2), radius=0.3, rot=(math.pi, 0, 0), spot_deg=100, blend=0.8)
    for side in (-1, 1):
        for i in range(6):
            geo.lamp("Wall lamp %s%d" % ("n" if side > 0 else "s", i), "POINT", 28.0,
                     (HX - 20 + i * 8, HY + side * (W / 2 - 1.3), z0 + 3.6), (1.0, 0.58, 0.25), radius=0.2)
    well = geo.lamp("Light well", "SPOT", 9000.0, (HX + 24.3, HY, z1 + 6.0), (0.80, 0.88, 1.0), radius=0.6, spot_deg=26, blend=0.15)
    geo.aim(well, (HX + 24.3, HY, z0))
    geo.lamp("Tunnel glow", "POINT", 160.0, (x0 + 1.0, HY, z0 + 2.0), (1.0, 0.55, 0.2), radius=0.3)
    return dict(braziers=BRAZ, well=(HX + 24.3, HY), floor=z0, ceil=z1)
