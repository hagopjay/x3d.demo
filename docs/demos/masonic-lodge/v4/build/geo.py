# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: mesh helpers shared by the zones. Blender frame: x east, y north, z up, metres, Sphinx origin."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

OBJECTS = []
ZONES = {}          # object name -> zone (bake group)


def add(name, bm, material, meta=None, zone=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if meta:
        ob["x3d_metadata"] = {"node": "MetadataSet", "name": "Giza", "value": [
            {"node": "MetadataString", "name": k, "value": '"%s"' % v} for k, v in meta.items()]}
    OBJECTS.append(ob.name)
    if zone:
        ZONES[ob.name] = zone
    return ob


def quad(bm, a, b, c, d):
    vs = [bm.verts.new(p) for p in (a, b, c, d)]
    return bm.faces.new(vs)


def box_bm(bm, x0, y0, z0, x1, y1, z1, inward=False, skip=()):
    """Six faces of a box into bm. skip: any of 'top','bottom','n','s','e','w'."""
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    faces = {"bottom": (0, 3, 2, 1), "top": (4, 5, 6, 7), "s": (0, 1, 5, 4), "e": (1, 2, 6, 5),
             "n": (2, 3, 7, 6), "w": (3, 0, 4, 7)}
    out = []
    for k, idx in faces.items():
        if k in skip:
            continue
        f = bm.faces.new([v[i] for i in idx])
        if inward:
            f.normal_flip()
        out.append(f)
    return out


def block(name, x0, y0, z0, x1, y1, z1, material, meta=None, zone=None):
    bm = bmesh.new()
    box_bm(bm, x0, y0, z0, x1, y1, z1)
    return add(name, bm, material, meta, zone)


def tunnel(name, a, b, w, h, material, meta, zone=None, segs=1):
    """Hollow rectangular passage, inward faces only. a, b: floor-centre points; h square to the floor.
    segs subdivides along the length (more texels per bake island stay square)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    if up.z < 0:
        up, side = -up, -side
    hw = w / 2
    c = lambda p, s, u: p + side * s + up * u
    bm = bmesh.new()
    for k in range(segs):
        pa = a + (b - a) * (k / segs)
        pb = a + (b - a) * ((k + 1) / segs)
        A = [c(pa, -hw, 0), c(pa, hw, 0), c(pa, hw, h), c(pa, -hw, h)]
        B = [c(pb, -hw, 0), c(pb, hw, 0), c(pb, hw, h), c(pb, -hw, h)]
        for i in range(4):
            j = (i + 1) % 4
            quad(bm, A[i], A[j], B[j], B[i])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return add(name, bm, material, meta, zone)


def room(name, x0, y0, z0, x1, y1, z1, material, meta, floor=True, zone=None):
    bm = bmesh.new()
    box_bm(bm, x0, y0, z0, x1, y1, z1, inward=True, skip=() if floor else ("bottom",))
    return add(name, bm, material, meta, zone)


def lathe(bm, profile, n=48, cx=0.0, cy=0.0, lobes=0, lobe_amp=0.0, cap=True):
    """Surface of revolution. profile: [(z, r, lobe_scale)] bottom to top. Lobes give a papyrus-bundle section."""
    rings = []
    for z, r, ls in profile:
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r * (1 + lobe_amp * ls * (abs(math.cos(lobes * a / 2)) - 0.64)) if lobes else r
            ring.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return rings


def cone(bm, base, r, h, n=12, tip_r=0.0):
    rings = lathe(bm, [(base[2], r, 0), (base[2] + h, max(tip_r, 1e-3), 0)], n, base[0], base[1])
    return rings


def lamp(name, kind, energy, loc, colour=(1, 1, 1), radius=0.1, rot=None, spot_deg=70, blend=0.3, shadow=True, parent=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy, ld.color = energy, colour
    ld.use_shadow = shadow
    if hasattr(ld, "shadow_soft_size"):
        ld.shadow_soft_size = radius
    if kind == "SPOT":
        ld.spot_size = math.radians(spot_deg)
        ld.spot_blend = blend
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    if rot:
        lo.rotation_euler = rot
    if parent:
        lo.parent = parent
    bpy.context.scene.collection.objects.link(lo)
    return lo


def aim(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def sprite_cross(bm, base, w, h, n=3):
    """n vertical quads crossed round a vertical axis, UV 0..1 each (a flame sprite seen from any side)."""
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        a = math.pi * k / n
        dx, dy = math.cos(a) * w / 2, math.sin(a) * w / 2
        x, y, z = base
        f = quad(bm, (x - dx, y - dy, z), (x + dx, y + dy, z), (x + dx, y + dy, z + h), (x - dx, y - dy, z + h))
        for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = t
