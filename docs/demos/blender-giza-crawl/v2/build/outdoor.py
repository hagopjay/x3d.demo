# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2, zone "plateau": the surface at night under the 2560 BC sky (the sky itself is the Background cube
from sky_cube.py). Khufu stays a faint cutaway shell, as in v1, so its passages read from outside; an opaque copy
casts its moon shadow in the bake and is deleted before export. Khafre and Menkaure are new: positions and sizes from
Petrie 1883 as used by Demo 65 v4 (build_plateau.py), courses illustrative. The moon is a stage light from azimuth
300 deg, 32 deg up (as in Demo 65: chosen to light the faces, not an ephemeris position).
"""
import math

import bmesh
from mathutils import Vector

import geo
import mats

IN = 0.0254
KX, KY = -329.0, 435.0
PET = "Petrie 1883 s.21-92, via Demo 65 v4 build_plateau.py"
PYRS = [
    dict(name="Khafre pyramid", c=(KX - 13165.8 * IN, KY - 13931.6 * IN), base=8474.9 * IN, slope=math.radians(53 + 10 / 60), z=10.0),
    dict(name="Menkaure pyramid", c=(KX - 22616.0 * IN, KY - 29102.0 * IN), base=4153.6 * IN, slope=math.atan2(2564.0, 4153.6 / 2), z=10.0),
]
HOLES = []                         # shaft mouths, filled in by the caller before build()
EXTENT = (-1050.0, 320.0, -520.0, 700.0)
Z = "plateau"


def pyramid_bm(bm, cx, cy, base, height, z0=0.0):
    b2 = base / 2
    apex = bm.verts.new((cx, cy, z0 + height))
    cs = [bm.verts.new((cx + sx * b2, cy + sy * b2, z0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        bm.faces.new((cs[i], cs[(i + 1) % 4], apex))


def build(holes):
    SAND = mats.sand("Plateau sand")
    STONE = mats.limestone_blocks("Pyramid core courses", course=1.2, block=2.2, tone=(0.72, 0.58, 0.40), worn=0.8)
    CASE = mats.G("Great Pyramid cutaway shell")
    p = CASE.bsdf((0.86, 0.76, 0.56), 0.9)
    p.inputs["Alpha"].default_value = 0.16
    CASE.m.use_backface_culling = False
    # plateau: a grid with square holes at the shaft mouths (so cameras can pass), gently uneven
    x0, x1, y0, y1 = EXTENT
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[2] for h in holes]} | {x0 + i * (x1 - x0) / 24 for i in range(25)})
    ys = sorted({y0, y1, *[h[1] for h in holes], *[h[3] for h in holes]} | {y0 + i * (y1 - y0) / 24 for i in range(25)})
    bm = bmesh.new()
    vid = {}

    def v(x, y):
        k = (round(x, 3), round(y, 3))
        if k not in vid:
            near = min([math.hypot(x - h[0], y - h[1]) for h in holes] + [1e9])
            z = 0.0 if near < 40 else 0.6 * math.sin(x * 0.011) * math.cos(y * 0.013)
            vid[k] = bm.verts.new((x, y, z))
        return vid[k]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes):
                continue
            bm.faces.new((v(xs[i], ys[j]), v(xs[i + 1], ys[j]), v(xs[i + 1], ys[j + 1]), v(xs[i], ys[j + 1])))
    geo.add("Giza plateau", bm, SAND, {"grade": "Illustrative", "what": "Ground, gently uneven", "source": "this demo"}, Z)
    for P in PYRS:
        h = P["base"] / 2 * math.tan(P["slope"])
        bm = bmesh.new()
        pyramid_bm(bm, P["c"][0], P["c"][1], P["base"], h, 0.0)
        geo.add(P["name"], bm, STONE, {"grade": "Documented", "what": "%s, base %.1f m, slope %.2f deg, height %.1f m (complete, unweathered apex)" % (
            P["name"].split()[0], P["base"], math.degrees(P["slope"]), h), "source": PET}, Z)
    bm = bmesh.new()
    pyramid_bm(bm, KX, KY, 230.33, 146.6)
    geo.add("Great Pyramid shell", bm, CASE.m, {"grade": "Documented", "what": "Great Pyramid, 230.33 m base, 146.6 m original height",
                                                "source": "Petrie 1883"})
    bm = bmesh.new()
    pyramid_bm(bm, KX, KY, 230.33, 146.6)
    caster = geo.add("Khufu shadow caster (bake only)", bm, STONE)
    # Khafre's causeway over the Osiris Shaft (schematic): a 4.5 m wide limestone ramp running east to west
    bm = bmesh.new()
    for a, b in ((-560.0, -226.5), (-219.5, -150.0)):            # broken over the shaft mouth so it can be seen
        geo.box_bm(bm, a, 30.5, 0.0, b, 35.0, 1.2, skip=("bottom",))
    geo.add("Khafre causeway (schematic)", bm, STONE, {"grade": "Documented, schematic", "what": "Khafre's causeway, drawn as a straight ramp; the Osiris Shaft opens under it",
                                                        "source": "Hawass 2007"}, Z)
    moon = geo.lamp("Moon (stage light)", "SUN", 0.55, (0, 0, 0), (0.70, 0.78, 1.0), radius=0.5)
    az, el = math.radians(300), math.radians(32)
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))      # direction toward the moon
    moon.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    moon.data.angle = math.radians(0.6)
    return dict(caster=caster.name)
