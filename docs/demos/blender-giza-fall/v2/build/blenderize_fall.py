# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Fall v2: the Blenderizer pass, run by build_fall_v2.py after the Bullet simulation and before the export.

The simulation, figures and cameras are v1's (same seed, same course heights). This replaces what they fall on and what is
seen around them:
  - the stepped Great Pyramid is rebuilt from the same 203 course heights and cut into baked parts: the strip of the north
    face the explorer falls down (x from STRIP[0] to STRIP[1], split in three by height so each part keeps its texel density),
    the rest of the north face, and the other three faces;
  - every course is weathered limestone (procedural blocks, joints, pitting, wind-scoured edges);
  - Khafre and Menkaure become stepped cores (Khafre with its casing cap, Menkaure with its granite foot), the sand rippled;
  - a low summer-evening sun from the west-north-west rakes the north face so every course throws a shadow; Cycles light is
    baked into image textures and drawn unlit. The two v1 suns stay for the figures (their materials are lit).
"""
import math

import bmesh
import bpy
from mathutils import Vector

import bakery
import geo
import mats

STRIP = (-26.0, 34.0)          # x range of the high-density fall strip on the north face
THIRDS = (0.0, 46.0, 92.0, 139.0)


def _course_faces(bm, tops, half_width, ranges, z_lo, z_hi):
    """Risers and treads of the stepped core within z_lo..z_hi. ranges(side) gives [(u0, u1)] in absolute coordinates along
    that side (x on the north and south faces, y on east and west), clamped to each course's width, so neighbouring parts
    share their edges exactly."""
    pt = {"N": lambda u, w: (u, w), "S": lambda u, w: (u, -w), "E": lambda u, w: (w, u), "W": lambda u, w: (-w, u)}
    z0 = 0.0
    for k, z1 in enumerate(tops):
        if z1 <= z_lo or z0 >= z_hi:
            z0 = z1
            continue
        w = half_width(z1)
        w2 = half_width(tops[k + 1]) if k + 1 < len(tops) else None
        for side, P in pt.items():
            for u0, u1 in ranges(side):
                a0, a1 = max(u0, -w), min(u1, w)
                if a1 - a0 > 1e-3:
                    geo.quad(bm, (*P(a0, w), z0), (*P(a1, w), z0), (*P(a1, w), z1), (*P(a0, w), z1))          # riser
                if w2 is not None:
                    b0, b1 = max(u0, -w2), min(u1, w2)
                    if a1 - a0 > 1e-3 or b1 - b0 > 1e-3:
                        geo.quad(bm, (*P(a0, w), z1), (*P(a1, w), z1), (*P(max(b1, b0), w2), z1), (*P(b0, w2), z1))  # tread
        if w2 is None and ranges("TOP"):
            geo.quad(bm, (w, w, z1), (-w, w, z1), (-w, -w, z1), (w, -w, z1))
        z0 = z1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)
    for f in bm.faces:
        f.normal_update()
        c = f.calc_center_median()
        out = Vector((c.x, c.y, 0)).normalized() if abs(f.normal.z) < 0.5 else Vector((0, 0, 1))
        if f.normal.dot(out) < 0:
            f.normal_flip()


INF = 1e6


def build(scene, tops, half_width, old_pyramid, old_ground, far_names, meta):
    STONE = mats.limestone_blocks("Weathered core limestone", course=1.0, block=1.45, tone=(0.76, 0.62, 0.44), worn=1.0)
    CORE = mats.limestone_blocks("Far pyramid cores", course=1.2, block=2.0, tone=(0.74, 0.60, 0.42), worn=0.9)
    CASE = mats.limestone_blocks("Khafre casing", course=1.6, block=3.0, tone=(0.90, 0.82, 0.66), joint_w=0.004, worn=0.25)
    REDG = mats.granite("Menkaure granite", polish=0.6, course=1.5, block=2.6)
    SAND = mats.sand("Plateau sand")
    for ob in [old_pyramid, old_ground] + [bpy.data.objects[n] for n in far_names]:
        bpy.data.objects.remove(ob, do_unlink=True)
    zones = {}
    for i in range(3):
        bm = bmesh.new()
        lo, hi = THIRDS[i], THIRDS[i + 1]
        _course_faces(bm, tops, half_width, lambda side: [STRIP] if side in ("N", "TOP") else [], lo, hi)
        zones[geo.add("North face, fall strip %d" % (i + 1), bm, STONE, meta).name] = "strip"
    bm = bmesh.new()
    _course_faces(bm, tops, half_width, lambda side: [(-INF, STRIP[0]), (STRIP[1], INF)] if side == "N" else [], 0, 200)
    zones[geo.add("North face, rest", bm, STONE, meta).name] = "face"
    bm = bmesh.new()
    _course_faces(bm, tops, half_width, lambda side: [(-INF, INF)] if side in ("S", "E", "W") else [], 0, 200)
    zones[geo.add("East, south and west faces", bm, STONE, meta).name] = "far"
    PET = "Khafre and Menkaure positions as in v1 (Giza study v2); casing extents illustrative"
    for name, (cx, cy), base, h_core, top_w, cap in (("Khafre", (-322.0, -340.0), 215.25, 105.0, 52.0, True),
                                                     ("Menkaure", (-563.0, -742.0), 103.4, 62.0, 6.0, False)):
        bm = bmesh.new()
        _stepped_closed(bm, cx, cy, base, top_w, h_core, 110 if cap else 70)
        zones[geo.add(name + " core", bm, CORE, {"grade": "Documented position and size; stepped core illustrative", "source": PET}).name] = "far"
        bm = bmesh.new()
        if cap:
            b0, top = top_w + 2.0, 143.5
            apex = bm.verts.new((cx, cy, top))
            cs = [bm.verts.new((cx + sx * b0 / 2, cy + sy * b0 / 2, h_core)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            for i in range(4):
                bm.faces.new((cs[i], cs[(i + 1) % 4], apex))
            zones[geo.add("Khafre casing cap", bm, CASE, {"grade": "Documented that casing survives near the top; extent illustrative", "source": PET}).name] = "far"
        else:
            _stepped_closed(bm, cx, cy, base + 1.6, base - 14.0, 9.5, 8, h0=1.2, h1=1.2)
            zones[geo.add("Menkaure granite foot", bm, REDG, {"grade": "Documented red granite lower courses; extent illustrative", "source": PET}).name] = "far"
    bm = bmesh.new()
    xs = [-1400.0, -130.0, -40.0, 40.0, 130.0, 1400.0]
    ys = [-1400.0, -130.0, 120.0, 260.0, 1400.0]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            geo.quad(bm, (xs[i], ys[j], -0.02), (xs[i + 1], ys[j], -0.02), (xs[i + 1], ys[j + 1], -0.02), (xs[i], ys[j + 1], -0.02))
    g = geo.add("Plateau", bm, SAND, {"grade": "Authored", "what": "sand at the base"})
    # the sand at the foot of the north face, where the fall ends, gets its own denser texture
    bm = bmesh.new()
    geo.quad(bm, (-60.0, 112.0, -0.01), (60.0, 112.0, -0.01), (60.0, 175.0, -0.01), (-60.0, 175.0, -0.01))
    zones[geo.add("Sand below the north face", bm, SAND, {"grade": "Authored", "what": "sand at the base"}).name] = "foot"
    zones[g.name] = "ground"
    # summer evening sun, low in the west-north-west: rakes the north face
    sun = geo.lamp("Evening sun (bake)", "SUN", 4.6, (0, 0, 0), (1.0, 0.74, 0.48), radius=0.5)
    az, el = math.radians(296), math.radians(11)
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sun.data.angle = math.radians(0.6)
    world = bpy.data.worlds.new("Evening sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.42, 0.62, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    return zones, sun


def _stepped_closed(bm, cx, cy, base, top_w, top_z, courses, h0=1.45, h1=0.55):
    hs = [h0 + (h1 - h0) * (k / max(1, courses - 1)) for k in range(courses)]
    k = top_z / sum(hs)
    rings, z = [], 0.0
    for i, h in enumerate(hs):
        w = base / 2 - (base / 2 - top_w / 2) * (i / courses)
        rings += [(w, z), (w, z + h * k)]
        z += h * k
    vs = [[bm.verts.new((cx + sx * w, cy + sy * w, zz)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for w, zz in rings]
    for a, b in zip(vs, vs[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(vs[-1])


def bake(scene, zones, out, profile, bake_sun):
    """Bake every zone; figures, mast and lights for the figures are hidden from the bake."""
    DENS = {"strip": 56.0, "face": 8.0, "far": 2.0, "foot": 20.0, "ground": 0.6}
    SMP, DIV, GLOSS, MUL = 96, 4, False, 1.0
    if profile == "quick":
        SMP, MUL = 24, 0.25
    elif profile == "g4":
        SMP, DIV, GLOSS, MUL = 384, 2, True, 1.6
    bakery.setup_cycles(SMP)
    keep_lights = [o for o in scene.objects if o.type == "LIGHT" and o is not bake_sun]
    for o in keep_lights:
        o.hide_render = True
    hidden = [o for o in scene.objects if o.type in ("MESH", "ARMATURE") and o.name not in zones]
    for o in hidden:
        o.hide_render = True
    recs = []
    for name, zone in zones.items():
        ang = lambda base, top_w, top_z: math.degrees(math.atan2(top_z, base / 2 - top_w / 2))
        slope = (0.0, 0.0, math.degrees(math.atan2(146.6, 230.33 / 2))) if zone in ("strip", "face") or name.startswith("East, south") else \
            (-322.0, -340.0, ang(215.25, 52.0, 105.0)) if name == "Khafre core" else (-563.0, -742.0, ang(103.4, 6.0, 62.0)) if name == "Menkaure core" else None
        uv = (lambda o, s=slope: bakery.unwrap_slope(o, *s)) if slope else None
        r = bakery.bake_object(bpy.data.objects[name], out, DENS[zone] * MUL, SMP, 0.0, light_div=DIV, gloss=GLOSS,
                               cull=zone != "ground" and zone != "foot", uv=uv)
        r["zone"] = zone
        recs.append(r)
    for o in hidden + keep_lights:
        o.hide_render = False
    bpy.data.objects.remove(bake_sun)
    return dict(profile=profile, samples=SMP, light_div=DIV, objects=recs)
