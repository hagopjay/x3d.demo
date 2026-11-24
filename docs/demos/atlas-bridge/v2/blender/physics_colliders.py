#!/usr/bin/env python3
"""physics_colliders: do the Atlas collider boxes behave like the X3D room when things fall on them?

Two Blender rigid-body worlds, the same probes in each:
  truth   the X3D blockout, imported with the Blenderizer add-on, every solid a passive MESH collider
  atlas   the Atlas collider boxes read from the return world (AtlasColliders_N), every box a passive BOX collider
Small balls are released from one height on a jittered grid (only where the truth world has free air) and left to
settle. Per probe: where it came to rest in each world. A ball that rests 30 cm higher in the Atlas world sat on a
box that is not there in X3D; one that rests lower fell through something Atlas did not box.

  python physics_colliders.py <blockout.x3d> <atlas-world.x3d> <addon-repo> <out.json> [--n 400] [--height 2.1] [--radius 0.05]
"""
import argparse, json, math, random, sys, tempfile, time
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from xml.etree import ElementTree as ET

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("blockout"); ap.add_argument("atlas"); ap.add_argument("addon"); ap.add_argument("out")
ap.add_argument("--n", type=int, default=400); ap.add_argument("--height", type=float, default=2.1); ap.add_argument("--radius", type=float, default=0.05)
ap.add_argument("--seconds", type=float, default=5.0); ap.add_argument("--seed", type=int, default=77); ap.add_argument("--save-blend")
a = ap.parse_args(argv)
FPS, SUB = 60, 8

tmp = tempfile.mkdtemp(prefix="x3d_addon_")
(Path(tmp) / "io_scene_x3d").symlink_to(Path(a.addon).resolve() / "source", target_is_directory=True)
sys.path.insert(0, tmp)
import importlib
mod = importlib.import_module("io_scene_x3d")
try:
    mod.register()
except Exception as e:                                           # noqa: BLE001
    print("register:", e)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        mod.register()
    except Exception:                                            # noqa: BLE001
        pass
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, int(a.seconds * FPS)
    bpy.ops.rigidbody.world_add()
    rw = sc.rigidbody_world
    rw.substeps_per_frame = SUB; rw.solver_iterations = 20
    rw.point_cache.frame_start, rw.point_cache.frame_end = 1, sc.frame_end
    return sc


def passive(o, shape):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
    bpy.ops.rigidbody.object_add(type="PASSIVE")
    o.rigid_body.collision_shape = shape
    o.rigid_body.friction = 0.9; o.rigid_body.restitution = 0.0
    o.rigid_body.collision_margin = 0.001 if shape == "MESH" else 0.0
    o.rigid_body.use_margin = True


def truth_world():
    sc = fresh()
    r = bpy.ops.import_scene.x3d(filepath=a.blockout)
    meshes = [o for o in sc.objects if o.type == "MESH" and len(o.data.polygons)]
    for o in meshes:
        passive(o, "MESH")
    return sc, meshes, sorted(r)


def atlas_world():
    sc = fresh()
    boxes = []
    for t in ET.parse(a.atlas).getroot().iter("Transform"):
        d = t.get("DEF") or ""
        if not d.startswith("AtlasColliders_"):
            continue
        x, y, z = (float(v) for v in t.get("translation").split())
        ax = [float(v) for v in t.get("rotation", "0 1 0 0").split()]
        assert abs(abs(ax[1]) - 1) < 1e-6 and abs(ax[0]) + abs(ax[2]) < 1e-6, f"{d}: collider is not a yaw-only box"
        sx, sy, sz = (float(v) for v in t.find("Shape/Box").get("size").split())
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y), rotation=(0, 0, ax[3] * ax[1]))      # X3D (x, y, z) -> Blender (x, -z, y)
        o = bpy.context.object; o.name = d
        o.scale = (sx, sz, sy)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)   # the default also moves the origin to the world origin, and a BOX collider sits on the origin
        passive(o, "BOX")
        boxes.append(o)
    return sc, boxes


def bvhs(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in objs:
        me = o.data
        M = o.matrix_world
        vs = [M @ v.co for v in me.vertices]
        out.append((o.name, BVHTree.FromPolygons(vs, [tuple(p.vertices) for p in me.polygons]), vs))
    return out


def clearance(trees, p):
    """signed distance from p to the nearest solid: negative inside (the solids are closed and convex-ish)."""
    best = 1e9
    for name, t, _ in trees:
        loc, n, _, d = t.find_nearest(p, 0.6)
        if loc is None:
            continue
        s = d if (p - loc).dot(n) >= 0 else -d
        best = min(best, s)
    return best


def add_probes(sc, pts):
    probes = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=a.radius, location=(0, 0, -50))
    proto = bpy.context.object
    for i, p in enumerate(pts):
        o = proto.copy(); o.data = proto.data; o.name = f"Probe{i:03d}"; o.location = p
        sc.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
        bpy.ops.rigidbody.object_add(type="ACTIVE")
        rb = o.rigid_body
        rb.collision_shape = "SPHERE"; rb.mass = 0.1; rb.friction = 0.9; rb.restitution = 0.0
        rb.linear_damping = 0.35; rb.angular_damping = 0.9
        rb.use_deactivation = False
        probes.append(o)
    bpy.data.objects.remove(proto, do_unlink=True)
    return probes


def settle(sc, probes):
    t = time.time()
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    rest = np.array([list(o.evaluated_get(dg).matrix_world.translation) for o in probes])
    sc.frame_set(sc.frame_end - 30)
    dg = bpy.context.evaluated_depsgraph_get()
    prev = np.array([list(o.evaluated_get(dg).matrix_world.translation) for o in probes])
    return rest, np.linalg.norm(rest - prev, axis=1) / 0.5, round(time.time() - t, 1)


# --- truth world first: it decides where the probes may start ---------------------------------------------
sc, meshes, imp = truth_world()
T = bvhs(meshes)
allv = np.array([list(v) for _, _, vs in T for v in vs])
lo, hi = allv.min(0), allv.max(0)
rng = random.Random(a.seed)
nx = int(round(math.sqrt(a.n * (hi[0] - lo[0]) / (hi[1] - lo[1])))); ny = int(math.ceil(a.n / nx))
m = 0.35
cand = []
for i in range(nx):
    for j in range(ny):
        cx = lo[0] + m + (hi[0] - lo[0] - 2 * m) * (i + 0.5) / nx; cy = lo[1] + m + (hi[1] - lo[1] - 2 * m) * (j + 0.5) / ny
        cand.append(Vector((cx + rng.uniform(-0.12, 0.12), cy + rng.uniform(-0.12, 0.12), a.height)))
pts = [p for p in cand if clearance(T, p) > a.radius + 0.03]
print(f"truth: {len(meshes)} solids, import {imp}; bounds {lo.round(2)} {hi.round(2)}; probes {len(pts)} of {len(cand)} start in free air", flush=True)
probes = add_probes(sc, pts)
restT, speedT, secT = settle(sc, probes)
if a.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=a.save_blend.replace(".blend", "-truth.blend"))

sc, boxes = atlas_world()
B = bvhs(boxes)
inside_box = [clearance(B, p) < a.radius for p in pts]
probes = add_probes(sc, pts)
restA, speedA, secA = settle(sc, probes)
if a.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=a.save_blend.replace(".blend", "-atlas.blend"))

P = np.array([list(p) for p in pts])
dz = restA[:, 2] - restT[:, 2]
lat = np.linalg.norm(restA[:, :2] - restT[:, :2], axis=1)
ok = ~np.array(inside_box)
fellT, fellA = restT[:, 2] < lo[2] - 0.5, restA[:, 2] < lo[2] - 0.5
use = ok & ~fellT & ~fellA
q = lambda v, p: float(np.percentile(v, p)) if len(v) else None
res = {"blender": bpy.app.version_string, "blockout": Path(a.blockout).name, "atlas_world": Path(a.atlas).name, "importer": imp,
       "solids": len(meshes), "collider_boxes": len(boxes), "probe": {"shape": "sphere", "radius_m": a.radius, "release_height_m": a.height, "grid": [nx, ny], "seed": a.seed},
       "sim": {"fps": FPS, "substeps": SUB, "seconds": a.seconds, "solver_iterations": 20, "seconds_wall": [secT, secA]},
       "probes_tried": len(cand), "probes_free_in_x3d": len(pts),
       "start_inside_atlas_box": int(sum(inside_box)), "fell_out_truth": int(fellT.sum()), "fell_out_atlas": int((fellA & ok).sum()),
       "compared": int(use.sum()),
       "rest_height_diff_mm": {"median_abs": q(1000 * np.abs(dz[use]), 50), "p90_abs": q(1000 * np.abs(dz[use]), 90), "p99_abs": q(1000 * np.abs(dz[use]), 99),
                               "mean_signed": float(1000 * dz[use].mean()) if use.any() else None},
       "within_20mm_pct": float(100 * (np.abs(dz[use]) < 0.02).mean()), "within_50mm_pct": float(100 * (np.abs(dz[use]) < 0.05).mean()), "within_100mm_pct": float(100 * (np.abs(dz[use]) < 0.1).mean()),
       "rests_higher_than_x3d_by_100mm": int((dz[use] > 0.1).sum()), "rests_lower_than_x3d_by_100mm": int((dz[use] < -0.1).sum()),
       "lateral_diff_m": {"median": q(lat[use], 50), "p90": q(lat[use], 90)},
       "still_moving_truth": int((speedT[use] > 0.02).sum()), "still_moving_atlas": int((speedA[use] > 0.02).sum()),
       "probes": [{"start": [round(float(v), 3) for v in P[i]], "x3d": [round(float(v), 3) for v in restT[i]], "atlas": [round(float(v), 3) for v in restA[i]],
                   "inside_box": bool(inside_box[i])} for i in range(len(pts))],
       "frame": "Blender Z-up metres; X3D (x, y, z) = Blender (x, z, -y)",
       "note": "probes can touch each other after landing (one shared world); the grid keeps them about a cell apart at release"}
Path(a.out).write_text(json.dumps(res, indent=1))
print(json.dumps({k: v for k, v in res.items() if k != "probes"}, indent=1))
