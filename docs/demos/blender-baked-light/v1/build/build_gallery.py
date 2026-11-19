# SPDX-License-Identifier: GPL-3.0-or-later
"""The Corbelled Gallery: an original synthetic stone gallery, lit in Cycles, baked to per-corner colour,
exported to X3D 4.0 by x3d-blender-io, plus a path-traced reference frame from the same camera.

Run with a bpy 5.x Python:  python build_gallery.py OUT_DIR ADDON_SOURCE_DIR [samples]
Writes OUT_DIR/gallery.blend, gallery_raw.x3d, gallery.glb, reference.png, bake-stats.json.
"""
import hashlib
import json
import math
import os
import sys
import time

import bpy  # noqa: F401  (must load before bmesh)
import bmesh
import bpy
import numpy as np
from mathutils import Vector

OUT = os.path.abspath(sys.argv[1])
ADDON = os.path.abspath(sys.argv[2])
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 384
REF_SAMPLES = min(256, max(64, SAMPLES))
os.makedirs(OUT, exist_ok=True)
T0 = time.time()

# ---------------------------------------------------------------- dimensions (metres, Blender Z-up)
LENGTH = 16.0          # along +Y
FLOOR_W = 2.10         # between the side benches' inner faces
BENCH_W, BENCH_H = 0.52, 0.60
COURSES = 7            # corbel courses above the benches
COURSE_H = 0.92
STEP = 0.075           # each course steps in by this much
WALL_BASE = BENCH_H + 1.70   # straight wall above the bench before corbelling starts
CELL = 0.13            # bake resolution: one vertex colour per corner at ~13 cm
SLOT_W = 0.60          # light slot in the roof
SEED = 19111
EMBER = 7.0          # ember emission strength (mesh lights)
EXPOSE_Q, EXPOSE_TO = 99.5, 2.6  # the 99.5th-percentile floor+wall corner (inside the sun blade) maps to 2.6, shouldered


def rng_hash(*keys):
    h = hashlib.sha256(("%d|" % SEED + "|".join(str(k) for k in keys)).encode()).digest()
    return int.from_bytes(h[:4], "little") / 2 ** 32


# ---------------------------------------------------------------- geometry builder
class Builder:
    """Collects quad patches (with a per-face albedo and an emissive flag) into one bmesh per mesh name."""

    def __init__(self):
        self.meshes = {}

    def patch(self, mesh, origin, u, v, albedo_fn, emissive=0.0, away=None, keep=None):
        """A grid of quads. Each face is turned to look into the gallery (toward the interior axis) or, for a
        box, away from the box centre ``away``: the bake gathers light only on the normal's side."""
        bm, faces = self.meshes.setdefault(mesh, (bmesh.new(), []))
        origin, u, v = Vector(origin), Vector(u), Vector(v)
        nu = max(1, round(u.length / CELL))
        nv = max(1, round(v.length / CELL))
        verts = [[bm.verts.new(origin + u * (i / nu) + v * (j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        for i in range(nu):
            for j in range(nv):
                c = (origin + u * ((i + .5) / nu) + v * ((j + .5) / nv))
                outside = 0
                if keep is not None and not keep(c):
                    if not keep(c - Vector((math.copysign(CELL, c.x), 0, 0))):
                        continue          # more than a cell outside the section: not needed to close the room
                    outside = 1           # margin cell: closes the room, kept out of the smoothing
                f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
                f.normal_update()
                if away is not None:
                    want = c - Vector(away)
                elif abs(f.normal.z) > 0.9:   # floors look up; ledges, roof and slot caps are undersides
                    want = Vector((0.0, 0.0, 1.0 if c.z < 1.0 else -1.0))
                else:
                    want = Vector((0.0, min(max(c.y, 0.6), LENGTH - 0.6), min(max(c.z, 0.9), 7.5))) - c
                if f.normal.dot(want) < 0:
                    f.normal_flip()
                faces.append((f, albedo_fn(c, (i + .5) / nu * u.length, (j + .5) / nv * v.length), emissive, outside))

    def box(self, mesh, lo, hi, albedo_fn, emissive_top=0.0, skip=()):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        X, Y, Z = (x1 - x0, 0, 0), (0, y1 - y0, 0), (0, 0, z1 - z0)
        sides = {
            "-z": ((x0, y0, z0), Y, X), "+z": ((x0, y0, z1), X, Y),
            "-x": ((x0, y0, z0), Z, Y), "+x": ((x1, y0, z0), Y, Z),
            "-y": ((x0, y0, z0), X, Z), "+y": ((x0, y1, z0), Z, X),
        }
        for key, (o, a, b) in sides.items():
            if key in skip:
                continue
            centre = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
            self.patch(mesh, o, a, b, albedo_fn, emissive_top if key == "+z" else 0.0, away=centre)


def limestone(c, su, sv):
    """Fine limestone ashlar: per-block tint, darker joint rows."""
    course = math.floor(c.z / 0.46)
    block = math.floor((c.y + (0.6 if course % 2 else 0.0)) / 1.25)
    t = rng_hash("lime", course, block, round(c.x > 0))
    base = np.array([0.62, 0.55, 0.44]) * (0.86 + 0.22 * t)
    joint = (c.z % 0.46) < 0.035 or ((c.y + (0.6 if course % 2 else 0.0)) % 1.25) < 0.035
    return tuple(base * (0.62 if joint else 1.0))


def granite(c, su, sv):
    t = rng_hash("gran", math.floor(c.x / 0.9), math.floor(c.y / 1.1))
    speck = rng_hash("speck", round(c.x / CELL), round(c.y / CELL), round(c.z / CELL))
    base = np.array([0.30, 0.15, 0.12]) * (0.85 + 0.25 * t) * (0.9 + 0.2 * speck)
    return tuple(base)


def bronze(c, su, sv):
    return (0.45, 0.28, 0.11)


def ember(c, su, sv):
    return (1.0, 0.42, 0.10)


B = Builder()
half = FLOOR_W / 2
# floor (granite) and the two benches (limestone)
B.patch("Floor", (-half, 0, 0), (FLOOR_W, 0, 0), (0, LENGTH, 0), granite)
for side in (-1, 1):
    x_in = side * half
    x_out = side * (half + BENCH_W)
    lo = (min(x_in, x_out), 0, 0)
    hi = (max(x_in, x_out), LENGTH, BENCH_H)
    B.box("Walls", lo, hi, limestone, skip=("-z", "-y", "+y", "+x" if side > 0 else "-x"))
    # the bench's outer face is the wall; build the wall rising from the bench
    xw = x_out
    z = BENCH_H
    # straight lower wall
    if side < 0:
        B.patch("Walls", (xw, 0, z), (0, LENGTH, 0), (0, 0, WALL_BASE - z), limestone)
    else:
        B.patch("Walls", (xw, 0, z), (0, 0, WALL_BASE - z), (0, LENGTH, 0), limestone)
    z = WALL_BASE
    for k in range(COURSES):
        x_face = xw - side * STEP * (k + 1)
        x_prev = xw - side * STEP * k
        # underside ledge of the course (faces down)
        a, b = (x_prev, 0, z), (x_face - x_prev, 0, 0)
        if side < 0:
            B.patch("Walls", a, b, (0, LENGTH, 0), limestone)
        else:
            B.patch("Walls", a, (0, LENGTH, 0), b, limestone)
        if side < 0:
            B.patch("Walls", (x_face, 0, z), (0, LENGTH, 0), (0, 0, COURSE_H), limestone)
        else:
            B.patch("Walls", (x_face, 0, z), (0, 0, COURSE_H), (0, LENGTH, 0), limestone)
        z += COURSE_H
    TOP_Z = z
    # roof slab from the last course to the slot edge (faces down)
    x_last = xw - side * STEP * COURSES
    x_slot = side * SLOT_W / 2
    if side < 0:
        B.patch("Walls", (x_last, 0, TOP_Z), (x_slot - x_last, 0, 0), (0, LENGTH, 0), limestone)
    else:
        B.patch("Walls", (x_last, 0, TOP_Z), (0, LENGTH, 0), (x_slot - x_last, 0, 0), limestone)
    # slot cheek going up 0.9 m (so light enters as a blade)
    if side < 0:
        B.patch("Walls", (x_slot, 0, TOP_Z), (0, 0, 0.9), (0, LENGTH, 0), limestone)
    else:
        B.patch("Walls", (x_slot, 0, TOP_Z), (0, LENGTH, 0), (0, 0, 0.9), limestone)
# the slot is only open over the middle 9 m; roof caps elsewhere
for y0, y1 in ((0, 3.5), (12.5, LENGTH)):
    B.patch("Walls", (-SLOT_W / 2, y0, TOP_Z + 0.9), (SLOT_W, 0, 0), (0, y1 - y0, 0), limestone)
# end walls: far wall (limestone) full height; the near end stays open behind the camera
full_w = FLOOR_W + 2 * BENCH_W


def inside_section(c):
    """True inside the gallery's cross-section. End-wall cells outside it would sit in the open sun and, sharing
    a facing with the inside cells, their light would bleed in through the smoothing (seen as a glowing far wall)."""
    z = c.z
    if z < WALL_BASE:
        w = half + BENCH_W
    elif z < TOP_Z:
        w = half + BENCH_W - STEP * (int((z - WALL_BASE) / COURSE_H) + 1)
    else:
        w = SLOT_W / 2
    return abs(c.x) < w


B.patch("Walls", (-full_w / 2, LENGTH, 0), (0, 0, TOP_Z + 0.9), (full_w, 0, 0), limestone, keep=inside_section)
B.patch("Walls", (-full_w / 2, 0, 0), (full_w, 0, 0), (0, 0, TOP_Z + 0.9), limestone, keep=inside_section)  # behind camera
# a light shroud for the bake and the reference only (deleted before export): a black, closed box around the
# gallery with one opening over the slot, so the outside sun and sky reach the room only through the slot.
# Without it, end-wall rim cells stood in the open sun and the bake carried that light inside.
def black(c, su, sv):
    return (0.0, 0.0, 0.0)


SH = 0.45
sx, sy0, sy1, sz0, sz1 = full_w / 2 + SH, -SH, LENGTH + SH, -SH, TOP_Z + 0.9 + 0.01
for o, a, b in (((-sx, sy0, sz0), (2 * sx, 0, 0), (0, sy1 - sy0, 0)),
                ((-sx, sy0, sz0), (0, sy1 - sy0, 0), (0, 0, sz1 - sz0)), ((sx, sy0, sz0), (0, sy1 - sy0, 0), (0, 0, sz1 - sz0)),
                ((-sx, sy0, sz0), (2 * sx, 0, 0), (0, 0, sz1 - sz0)), ((-sx, sy1, sz0), (2 * sx, 0, 0), (0, 0, sz1 - sz0)),
                ((-sx, sy0, sz1), (sx - SLOT_W / 2, 0, 0), (0, sy1 - sy0, 0)),
                ((SLOT_W / 2, sy0, sz1), (sx - SLOT_W / 2, 0, 0), (0, sy1 - sy0, 0)),
                ((-SLOT_W / 2, sy0, sz1), (SLOT_W, 0, 0), (0, 3.5 - sy0, 0)),
                ((-SLOT_W / 2, 12.5, sz1), (SLOT_W, 0, 0), (0, sy1 - 12.5, 0))):
    B.patch("Shroud", o, a, b, black, away=(0, LENGTH / 2, 4.0))
# a raised dais and the granite sarcophagus at the far end
B.box("Floor", (-half, LENGTH - 3.2, 0), (half, LENGTH, 0.28), granite, skip=("-z", "+y"))
B.box("Sarcophagus", (-0.52, LENGTH - 2.45, 0.28), (0.52, LENGTH - 0.25, 1.33), granite, skip=("-z",))
# four bronze braziers on the benches with ember tops (mesh lights)
for i, y in enumerate((4.2, 8.6)):
    for side in (-1, 1):
        cx = side * (half + BENCH_W / 2)
        # closed underneath, a few mm above the bench: Cycles emission is two-sided, so an open box let the ember
        # light the bench cells hidden inside it, and the smoothing spread that as a glow ring round the base
        B.box("Braziers", (cx - .14, y - .14, BENCH_H + .004), (cx + .14, y + .14, BENCH_H + .42), bronze, skip=("+z",))
        B.patch("Braziers", (cx - .14, y - .14, BENCH_H + .42), (.28, 0, 0), (0, .28, 0), ember, emissive=1.0,
                away=(cx, y, BENCH_H))

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
objects = []
stats = {}
for name, (bm, faces) in B.meshes.items():
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    alb = mesh.color_attributes.new("Alb", "FLOAT_COLOR", "CORNER")
    emi = mesh.attributes.new("Emi", "FLOAT", "FACE")
    out_attr = mesh.attributes.new("Out", "INT", "FACE")
    for poly, (_f, a, e, o) in zip(mesh.polygons, faces):
        emi.data[poly.index].value = e
        out_attr.data[poly.index].value = o
        for li in poly.loop_indices:
            alb.data[li].color = (a[0], a[1], a[2], 1.0)
    bake = mesh.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
    mesh.color_attributes.active_color = bake
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    objects.append(obj)
    stats[name] = {"faces": len(mesh.polygons), "corners": len(mesh.loops), "vertices": len(mesh.vertices)}
    bm.free()

# bake material: Alb as base colour, ember faces emit
mat = bpy.data.materials.new("BakeStone")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
attr = nt.nodes.new("ShaderNodeAttribute")
attr.attribute_name = "Alb"
nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
emi_attr = nt.nodes.new("ShaderNodeAttribute")
emi_attr.attribute_name = "Emi"
math_n = nt.nodes.new("ShaderNodeMath")
math_n.operation = "MULTIPLY"
math_n.inputs[1].default_value = EMBER
nt.links.new(emi_attr.outputs["Fac"], math_n.inputs[0])
nt.links.new(attr.outputs["Color"], bsdf.inputs["Emission Color"])
nt.links.new(math_n.outputs["Value"], bsdf.inputs["Emission Strength"])
for obj in objects:
    obj.data.materials.append(mat)

# key: a sun through the roof slot, raking along the gallery
sun_data = bpy.data.lights.new("Sun", "SUN")
sun_data.energy = 5.0
sun_data.color = (1.0, 0.85, 0.62)
sun_data.angle = math.radians(1.2)
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
SUN_ELEV, SUN_AZ = 52.0, 0.0  # light travels toward +Y (away from the camera) and down
sun.rotation_euler = (math.radians(90 - SUN_ELEV), 0, math.radians(SUN_AZ))
world = bpy.data.worlds.new("Sky")
scene.world = world
world.use_nodes = True
wn = world.node_tree
sky = wn.nodes.new("ShaderNodeTexSky")
try:
    sky.sky_type = "MULTIPLE_SCATTERING"
except TypeError:
    sky.sky_type = "NISHITA"
sky.sun_disc = False
sky.sun_elevation = math.radians(26)
wn.links.new(sky.outputs["Color"], wn.nodes["Background"].inputs["Color"])
wn.nodes["Background"].inputs["Strength"].default_value = 0.25

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 18.0
cam = bpy.data.objects.new("Entrance", cam_data)
scene.collection.objects.link(cam)
cam.location = (0.0, 0.55, 1.62)
direction = Vector((0.0, LENGTH - 0.55, 3.05 - 1.62))
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

scene.render.engine = "CYCLES"
cy = scene.cycles
cy.device = "CPU"
cy.samples = SAMPLES
cy.use_denoising = False
cy.sample_clamp_indirect = 4.0
cy.seed = 7
cy.max_bounces = 8
cy.diffuse_bounces = 6
scene.render.threads_mode = "FIXED"
scene.render.threads = 3

# ---------------------------------------------------------------- bake (light only)
t_bake = time.time()
scene.render.bake.target = "VERTEX_COLORS"
bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
bake_s = time.time() - t_bake
shroud = bpy.data.objects["Shroud"]
objects.remove(shroud)          # kept in the scene for the reference render, never finished or exported
stats.pop("Shroud")

# ---------------------------------------------------------------- finish in Python (recipe step 5)
def read(mesh, name):
    a = mesh.color_attributes[name]
    buf = np.empty(len(a.data) * 4, dtype=np.float32)
    a.data.foreach_get("color", buf)
    return buf.reshape(-1, 4)


SMOOTH_ITERS, SMOOTH_LAMBDA = 3, 0.6


def smooth_bake(mesh):
    """Vertex-colour bakes are noisy (each corner is one sample point). Average corners that share a vertex
    and a facing, then Laplacian-smooth along the faces' edges within that facing. Shadow edges soften by a
    few cells; light never leaks between differently facing surfaces (wall vs floor)."""
    a = mesh.color_attributes["Bake"]
    n = len(a.data)
    buf = np.empty(n * 4, dtype=np.float32)
    a.data.foreach_get("color", buf)
    light = buf.reshape(-1, 4)[:, :3].astype(np.float64)
    loop_vert = np.empty(n, dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", loop_vert)
    pn = np.empty(len(mesh.polygons) * 3)
    mesh.polygons.foreach_get("normal", pn)
    pn = pn.reshape(-1, 3)
    starts = np.empty(len(mesh.polygons), dtype=np.int64)
    totals = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    axis = np.argmax(np.abs(pn), axis=1)
    out_flag = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.attributes["Out"].data.foreach_get("value", out_flag)
    code = (axis * 2 + (pn[np.arange(len(pn)), axis] > 0)) * 2 + out_flag
    loop_code = np.repeat(code, totals)
    keys, inv = np.unique(loop_vert * 16 + loop_code, return_inverse=True)
    k = len(keys)
    cnt = np.bincount(inv, minlength=k).astype(np.float64)
    val = np.zeros((k, 3))
    np.add.at(val, inv, light)
    val /= cnt[:, None]
    # edges between consecutive corners of each face, in key space
    nxt = np.arange(n) + 1
    ends = starts + totals
    nxt[ends - 1] = starts
    e0, e1 = inv, inv[nxt]
    deg = np.bincount(np.concatenate([e0, e1]), minlength=k).astype(np.float64)
    for _ in range(SMOOTH_ITERS):
        acc = np.zeros((k, 3))
        np.add.at(acc, e0, val[e1])
        np.add.at(acc, e1, val[e0])
        avg = acc / np.maximum(deg, 1)[:, None]
        val = val + SMOOTH_LAMBDA * (avg - val)
    out = np.concatenate([val[inv], np.ones((n, 1))], axis=1).astype(np.float32)
    a.data.foreach_set("color", out.ravel())


for obj in objects:
    smooth_bake(obj.data)
all_light = np.concatenate([read(o.data, "Bake")[:, :3].mean(axis=1) for o in objects if o.name in ("Floor", "Walls")])
pq = float(np.percentile(all_light, EXPOSE_Q))
exposure = EXPOSE_TO / max(pq, 1e-6)
FLOOR = np.array([0.012, 0.016, 0.028])  # recipe floor 0.05,0.07,0.12 lowered: it lifted shadows far above the path-traced reference


def srgb(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def shoulder(d):
    # identity below 0.8, then an exponential approach to 1 that never reaches it
    over = np.clip(d - 0.8, 0, None)
    return np.where(d < 0.8, d, 0.8 + 0.2 * (1 - np.exp(-over / 0.2)))


percentiles = {}
for obj in objects:
    mesh = obj.data
    light = read(mesh, "Bake")[:, :3] * exposure
    light = np.maximum(light, FLOOR)
    albedo = read(mesh, "Alb")[:, :3]
    emi_face = np.array([mesh.attributes["Emi"].data[p.index].value for p in mesh.polygons])
    emi_corner = np.repeat(emi_face, [p.loop_total for p in mesh.polygons])[:, None]
    lin = light * albedo
    lin = lin * (1 - emi_corner) + emi_corner * np.maximum(lin, albedo * 1.0)
    disp = np.clip(shoulder(srgb(lin)), 0.0, 0.999)
    out = mesh.color_attributes.new("Display", "FLOAT_COLOR", "CORNER")
    rgba = np.concatenate([disp, np.ones((len(disp), 1))], axis=1).astype(np.float32)
    out.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = out
    lum = disp.mean(axis=1)
    percentiles[obj.name] = {q: round(float(np.percentile(lum, q)), 4) for q in (5, 50, 95)}
    # leave only the display colours on the mesh so every exporter reads the same thing
    for name in ("Bake", "Alb"):
        mesh.color_attributes.remove(mesh.color_attributes[name])
    mesh.color_attributes.active_color = mesh.color_attributes["Display"]
    mesh.color_attributes.render_color_index = 0

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "gallery.blend"))

# ---------------------------------------------------------------- path-traced reference at the same exposure
# Same scene, a fresh Principled material reading Alb (re-made from the saved albedo), full path tracing.
ref_mat = bpy.data.materials.new("RefStone")
ref_mat.use_nodes = True
rn = ref_mat.node_tree
rb = rn.nodes["Principled BSDF"]
ra = rn.nodes.new("ShaderNodeAttribute")
ra.attribute_name = "RefAlb"
rn.links.new(ra.outputs["Color"], rb.inputs["Base Color"])
rb.inputs["Roughness"].default_value = 0.85
re_attr = rn.nodes.new("ShaderNodeAttribute")
re_attr.attribute_name = "Emi"
rm = rn.nodes.new("ShaderNodeMath")
rm.operation = "MULTIPLY"
rm.inputs[1].default_value = EMBER
rn.links.new(re_attr.outputs["Fac"], rm.inputs[0])
rn.links.new(ra.outputs["Color"], rb.inputs["Emission Color"])
rn.links.new(rm.outputs["Value"], rb.inputs["Emission Strength"])
for obj in objects:
    faces = B.meshes[obj.name][1]
    mesh = obj.data
    ref = mesh.color_attributes.new("RefAlb", "FLOAT_COLOR", "CORNER")
    for poly, (_f, a, _e, _o) in zip(mesh.polygons, faces):
        for li in poly.loop_indices:
            ref.data[li].color = (a[0], a[1], a[2], 1.0)
    mesh.color_attributes.active_color = mesh.color_attributes["Display"]
    mesh.materials[0] = ref_mat
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = math.log2(exposure)
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.render.resolution_percentage = 100
cy.samples = REF_SAMPLES
cy.use_denoising = True
try:
    cy.denoiser = "OPENIMAGEDENOISE"
except Exception:
    pass
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(OUT, "reference.png")
t_ref = time.time()
bpy.ops.render.render(write_still=True)
ref_s = time.time() - t_ref
for obj in objects:
    obj.data.color_attributes.remove(obj.data.color_attributes["RefAlb"])
    obj.data.materials[0] = mat

# ---------------------------------------------------------------- export: X3D by x3d-blender-io, GLB by Blender
sys.path.insert(0, os.path.dirname(ADDON))
pkg = os.path.join(OUT, "_addon")
os.makedirs(pkg, exist_ok=True)
link = os.path.join(pkg, "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
sys.path.insert(0, pkg)
import importlib  # noqa: E402
addon = importlib.import_module("io_scene_x3d")
try:
    addon.register()
except Exception:
    pass
bpy.data.objects.remove(sun)
bpy.data.objects.remove(shroud)
x3d_path = os.path.join(OUT, "gallery_raw.x3d")
res = bpy.ops.export_scene.x3d(filepath=x3d_path, x3d_version="X3D40", color_space="AS_IS", use_selection=False)
glb_path = os.path.join(OUT, "gallery.glb")
bpy.ops.object.select_all(action="SELECT")
cam.select_set(False)
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True, export_cameras=False,
                          export_lights=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_materials="NONE")

report = {
    "schema": "x3d-demo/bake-stats/1",
    "blender": bpy.app.version_string,
    "build_hash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash),
    "script_sha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest(),
    "bake": {"type": "DIFFUSE direct+indirect, colour pass off", "target": "VERTEX_COLORS", "samples": SAMPLES,
             "denoise": False, "clamp_indirect": 4.0, "seed": 7, "seconds": round(bake_s, 1),
             "sun": {"elevation_deg": SUN_ELEV, "azimuth_deg": SUN_AZ, "energy": 5.0, "color": [1.0, 0.85, 0.62]},
             "sky": {"type": sky.sky_type, "strength": 0.25, "sun_elevation_deg": 26},
             "embers": "4 mesh lights, emission strength %s" % EMBER},
    "finish": {"exposure": round(exposure, 5), "rule": "%sth percentile floor+wall corner = %.2f (deviates from the recipe 70th-percentile rule: a slot-lit room is mostly shadow)" % (EXPOSE_Q, EXPOSE_TO),
               "light_floor": FLOOR.tolist(), "srgb": True, "shoulder_from": 0.8},
    "reference": {"samples": REF_SAMPLES, "denoiser": "OIDN", "view_transform": "Standard",
                  "exposure_stops": round(math.log2(exposure), 4), "size": [960, 540], "seconds": round(ref_s, 1),
                  "note": "full path tracing (sun + sky + embers) with the bake's exposure; materials diffuse rough 0.85"},
    "meshes": stats, "display_luminance_percentiles": percentiles,
    "x3d_export": sorted(res), "total_seconds": round(time.time() - T0, 1),
    "camera": {"location": list(cam.location), "lens_mm": 18.0, "sensor_mm": cam_data.sensor_width},
}
json.dump(report, open(os.path.join(OUT, "bake-stats.json"), "w"), indent=1)
print(json.dumps({k: report[k] for k in ("bake", "finish", "meshes", "total_seconds")}, indent=1))
