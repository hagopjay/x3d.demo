#!/usr/bin/env python3
"""Zero-spend Atlas fixture: a procedural reading room (CC0, maths only) seen by the REAL Atlas camera rig.

The 10 cameras are copied from worldlabsai/skills (Apache-2.0, commit 6cdb6b9, skills/atlas-splats/assets/
example/splats-request.json): the rig World Labs' own splat skill built around its "bookshop" example. Its images
and depth are not public, so this script raycasts our own room through those exact cameras and writes what
images2PosedRGBD + atlasGenerate(returnDepth) would hand back, in the documented shapes:

  frames_<i>_image.jpg              RGB on the camera grid (1280x720)
  frames_<i>_depth.exr              one float32 channel, planar depth along the view axis, rows top to bottom,
                                    NaN where no surface (the skylight), as cameras-and-posed-images.md says
  frames_<i>_depth_confidence.png   8-bit, 0 where depth is NaN, lower at grazing angles
  frames_<i>_label.png              object id per pixel (ground truth for the X_ITE camera test; not an Atlas output)
  posed-frames.json                 {"posedFrames":[{imageAsset, depth:{depthAsset, confidenceAsset}, camera}]}
  mesh.glb                          stand-in for splats2Mesh `mesh` (vertex_color mode)
  colliderBoxes.glb                 stand-in for splats2Mesh `colliderBoxes`: one cube shared by N yaw-only nodes

Run:  python3 kit/make_fixture.py --rig data/atlas-skills-rig.json --out data/bundle
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas2x3d as ax  # noqa: E402

LIGHT = np.array([0.35, 0.85, 0.40]) / np.linalg.norm([0.35, 0.85, 0.40])


def h01(i):
    """Deterministic hash 0..1 for integer arrays."""
    i = np.asarray(i, dtype=np.int64)
    x = (i * 2654435761 + 1013904223) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 1274126177) & 0xFFFFFFFF
    return (x & 0xFFFF) / 65535.0


BOOKS = np.array([[0.55, 0.12, 0.10], [0.10, 0.25, 0.45], [0.12, 0.38, 0.20], [0.70, 0.55, 0.20],
                  [0.35, 0.18, 0.40], [0.80, 0.75, 0.62], [0.20, 0.20, 0.22], [0.60, 0.30, 0.12]])


def scene():
    """List of objects: (name, kind, params, label_rgb, colour_fn). Floor y=0 (Atlas gravity-levels to y=0)."""
    objs = []

    def box(name, lo, hi, col, tex=None):
        objs.append({"name": name, "kind": "box", "lo": np.array(lo, float), "hi": np.array(hi, float),
                     "col": np.array(col, float), "tex": tex})
    box("floor", [-3, -0.1, -6.5], [3, 0, 1.6], [0.45, 0.30, 0.18], "planks")
    box("rug", [-1.2, 0, -4.0], [1.2, 0.012, -2.0], [0.55, 0.10, 0.10], "rug")
    # ceiling with a 2 x 2 m skylight hole (x -1..1, z -4..-2): rays through it hit nothing -> NaN depth
    box("ceil_w", [-3, 2.8, -6.5], [-1, 2.9, 1.6], [0.85, 0.83, 0.78])
    box("ceil_e", [1, 2.8, -6.5], [3, 2.9, 1.6], [0.85, 0.83, 0.78])
    box("ceil_n", [-1, 2.8, -6.5], [1, 2.9, -4], [0.85, 0.83, 0.78])
    box("ceil_s", [-1, 2.8, -2], [1, 2.9, 1.6], [0.85, 0.83, 0.78])
    box("wall_w", [-3.1, 0, -6.5], [-3, 2.8, 1.6], [0.80, 0.74, 0.62], "wall")
    box("wall_e", [3, 0, -6.5], [3.1, 2.8, 1.6], [0.80, 0.74, 0.62], "wall")
    # north wall with a window (x -0.8..0.8, y 1.95..2.6): rays through it hit nothing -> NaN depth, confidence 0
    box("wall_n", [-3, 0, -6.6], [-0.8, 2.8, -6.5], [0.74, 0.70, 0.60], "wall")
    box("wall_n2", [0.8, 0, -6.6], [3, 2.8, -6.5], [0.74, 0.70, 0.60], "wall")
    box("wall_n3", [-0.8, 0, -6.6], [0.8, 1.95, -6.5], [0.74, 0.70, 0.60], "wall")
    box("wall_n4", [-0.8, 2.6, -6.6], [0.8, 2.8, -6.5], [0.74, 0.70, 0.60], "wall")
    box("wall_s", [-3, 0, 1.6], [3, 2.8, 1.7], [0.74, 0.70, 0.60], "wall")
    box("shelf_w", [-3, 0, -5.6], [-2.6, 2.2, -0.6], [0.36, 0.22, 0.12], "books_x")
    box("shelf_e", [2.6, 0, -5.6], [3, 2.2, -0.6], [0.36, 0.22, 0.12], "books_x")
    box("shelf_n", [-2.0, 0, -6.5], [2.0, 1.9, -6.1], [0.36, 0.22, 0.12], "books_z")
    box("table", [-0.7, 0.72, -3.45], [0.7, 0.77, -2.55], [0.42, 0.26, 0.14], "planks")
    for i, (x, z) in enumerate([(-0.62, -3.37), (0.62, -3.37), (-0.62, -2.63), (0.62, -2.63)]):
        box(f"leg{i}", [x - 0.04, 0, z - 0.04], [x + 0.04, 0.72, z + 0.04], [0.30, 0.18, 0.10])
    box("bookstack", [-0.45, 0.77, -3.15], [-0.15, 0.95, -2.85], [0.55, 0.12, 0.10], "stack")
    box("lectern", [1.4, 0, -1.4], [1.8, 1.1, -1.0], [0.30, 0.20, 0.12])
    objs.append({"name": "globe", "kind": "sphere", "c": np.array([0.25, 0.95, -3.0]), "r": 0.18,
                 "col": np.array([0.15, 0.35, 0.65]), "tex": "globe"})
    box("globe_stand", [0.22, 0.77, -3.03], [0.28, 0.80, -2.97], [0.6, 0.5, 0.2])
    for i, o in enumerate(objs):
        o["id"] = i + 1
        o["label"] = label_colour(i + 1)
    return objs


def label_colour(i):
    """Distinct, fully saturated label colours, far apart in RGB, for the X_ITE label test."""
    hue = (i * 0.61803398875) % 1.0
    k = np.array([5, 3, 1]) + hue * 6
    rgb = 1 - np.clip(np.minimum(k % 6, 4 - k % 6), 0, 1)
    lum = 0.55 + 0.45 * ((i % 3) / 2)
    return np.round(rgb * lum * 255) / 255


def raycast(objs, origin, dirs):
    n = len(dirs)
    t_best = np.full(n, np.inf)
    hit = np.zeros(n, np.int32)
    normal = np.zeros((n, 3))
    inv = 1.0 / np.where(np.abs(dirs) < 1e-12, 1e-12, dirs)
    for o in objs:
        if o["kind"] == "box":
            t0 = (o["lo"] - origin) * inv
            t1 = (o["hi"] - origin) * inv
            tmin = np.minimum(t0, t1)
            tmax = np.maximum(t0, t1)
            tn = tmin.max(axis=1)
            tf = tmax.min(axis=1)
            ok = (tf >= tn) & (tf > 1e-4)
            t = np.where(tn > 1e-4, tn, tf)
            better = ok & (t < t_best)
            if better.any():
                t_best[better] = t[better]
                hit[better] = o["id"]
                ax_ = tmin[better].argmax(axis=1)
                nrm = np.zeros((better.sum(), 3))
                nrm[np.arange(len(ax_)), ax_] = -np.sign(dirs[better][np.arange(len(ax_)), ax_])
                normal[better] = nrm
        else:
            oc = origin - o["c"]
            b = dirs @ oc
            c = oc @ oc - o["r"] ** 2
            disc = b * b - c
            ok = disc > 0
            t = -b - np.sqrt(np.where(ok, disc, 0))
            better = ok & (t > 1e-4) & (t < t_best)
            if better.any():
                t_best[better] = t[better]
                hit[better] = o["id"]
                p = origin + dirs[better] * t[better, None]
                normal[better] = (p - o["c"]) / o["r"]
    return t_best, hit, normal


def shade(objs, pts, hit, normal):
    rgb = np.zeros((len(pts), 3))
    for o in objs:
        m = hit == o["id"]
        if not m.any():
            continue
        p = pts[m]
        col = np.tile(o["col"], (m.sum(), 1))
        tex = o["tex"]
        if tex == "planks":
            k = np.floor(p[:, 0] * 5).astype(int) * 7 + np.floor(p[:, 2] * 1.2).astype(int)
            col *= (0.78 + 0.4 * h01(k))[:, None]
        elif tex == "rug":
            ring = (np.floor(np.hypot(p[:, 0], (p[:, 2] + 3) * 1.2) * 6) % 2)
            col = np.where(ring[:, None] > 0, col, np.array([0.80, 0.62, 0.25]))
        elif tex == "wall":
            col *= (0.9 + 0.1 * p[:, 1:2] / 2.8)
        elif tex in ("books_x", "books_z", "stack"):
            along = p[:, 2] if tex == "books_x" else p[:, 0]
            shelf = np.floor(p[:, 1] / 0.44).astype(int)
            spine = np.floor(along * 22).astype(int) + shelf * 101
            book = BOOKS[(h01(spine) * len(BOOKS)).astype(int) % len(BOOKS)]
            gap = (p[:, 1] % 0.44) > 0.38           # the shelf plank between rows
            if tex == "stack":
                book = BOOKS[(np.floor(p[:, 1] * 40).astype(int)) % len(BOOKS)]
                gap = np.zeros(len(p), bool)
            col = np.where(gap[:, None], col, book * (0.85 + 0.3 * h01(spine * 3 + 1))[:, None])
        elif tex == "globe":
            d = (p - o["c"]) / o["r"]
            lon = np.arctan2(d[:, 0], d[:, 2])
            lat = np.arcsin(np.clip(d[:, 1], -1, 1))
            land = (np.sin(lon * 3) * np.cos(lat * 4) + 0.4 * np.sin(lon * 7 + lat * 5)) > 0.35
            col = np.where(land[:, None], np.array([0.25, 0.50, 0.22]), col)
        lam = np.clip(normal[m] @ LIGHT, 0, 1)
        rgb[m] = col * (0.45 + 0.65 * lam)[:, None]
    return np.clip(rgb, 0, 1)


def render(objs, cam: ax.AtlasCamera):
    h, w = cam.height, cam.width
    rr, cc = np.mgrid[0:h, 0:w]
    u, v = cc + 0.5, rr + 0.5
    d_cam = np.stack([(u - cam.cx) / cam.fx, -(v - cam.cy) / cam.fy, -np.ones_like(u, dtype=float)], axis=-1).reshape(-1, 3)
    d_world = d_cam @ cam.R.T
    norm = np.linalg.norm(d_world, axis=1)
    dirs = d_world / norm[:, None]
    t, hit, normal = raycast(objs, cam.position, dirs)
    pts = cam.position + dirs * np.where(np.isfinite(t), t, 0)[:, None]
    rgb = shade(objs, pts, hit, normal)
    sky = hit == 0
    rgb[sky] = np.array([0.62, 0.78, 0.95])
    planar = np.where(sky, np.nan, t / norm)            # distance along the view axis, not along the ray
    cosang = np.abs(np.sum(normal * dirs, axis=1))
    conf = np.where(sky, 0, np.clip(np.round(40 + 215 * cosang), 1, 255)).astype(np.uint8)
    lab = np.zeros((len(hit), 3))
    for o in objs:
        lab[hit == o["id"]] = o["label"]
    return (rgb.reshape(h, w, 3), planar.reshape(h, w).astype(np.float32), conf.reshape(h, w),
            hit.reshape(h, w), lab.reshape(h, w, 3), pts.reshape(h, w, 3))


def write_exr(path, depth):
    import OpenEXR
    hdr = {"compression": OpenEXR.ZIP_COMPRESSION, "type": OpenEXR.scanlineimage}
    with OpenEXR.File(hdr, {"Y": depth.astype(np.float32)}) as f:
        f.write(str(path))


# ------------------------------------------------------------------------------------------------ GLB writer
def write_glb(path, meshes, nodes):
    """meshes: list of (positions f32[n,3], colors f32[n,3] or None, indices u32[m]); nodes: list of dicts."""
    bin_ = bytearray()
    accessors, views, gl_meshes = [], [], []

    def add(arr, target, comp, typ, minmax=False):
        nonlocal bin_
        while len(bin_) % 4:
            bin_ += b"\0"
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": arr.nbytes, "target": target})
        bin_ += arr.tobytes()
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1
    for pos, col, idx in meshes:
        attrs = {"POSITION": add(pos.astype(np.float32), 34962, 5126, "VEC3", True)}
        if col is not None:
            attrs["COLOR_0"] = add(col.astype(np.float32), 34962, 5126, "VEC3")
        ia = add(idx.astype(np.uint32), 34963, 5125, "SCALAR")
        gl_meshes.append({"primitives": [{"attributes": attrs, "indices": ia, "mode": 4}]})
    while len(bin_) % 4:
        bin_ += b"\0"
    g = {"asset": {"version": "2.0", "generator": "x3d.demo marble-atlas/v1 make_fixture.py"},
         "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": gl_meshes,
         "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bytes(bin_)
    Path(path).write_bytes(out)


def cube(lo, hi):
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    c = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], float)
    v = lo + c * (hi - lo)
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tri = []
    for a, b, c_, d in faces:
        tri += [a, b, c_, a, c_, d]
    return v, np.array(tri)


def sphere(c, r, n=24):
    lat = np.linspace(0, math.pi, n // 2 + 1)
    lon = np.linspace(0, 2 * math.pi, n + 1)
    v = np.array([[c[0] + r * math.sin(a) * math.cos(b), c[1] + r * math.cos(a), c[2] + r * math.sin(a) * math.sin(b)]
                  for a in lat for b in lon])
    tri = []
    W = n + 1
    for i in range(len(lat) - 1):
        for j in range(n):
            a, b = i * W + j, i * W + j + 1
            tri += [a, a + W, b, b, a + W, b + W]
    return v, np.array(tri)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rig", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rig = json.loads(Path(a.rig).read_text())["posedFrames"]
    objs = scene()
    frames = []
    for i, f in enumerate(rig):
        cam = ax.parse_camera(f["camera"])
        rgb, depth, conf, hit, lab, pts = render(objs, cam)
        Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(out / f"frames_{i}_image.jpg", quality=88)
        write_exr(out / f"frames_{i}_depth.exr", depth)
        Image.fromarray(conf).save(out / f"frames_{i}_depth_confidence.png", optimize=True)
        Image.fromarray(hit.astype(np.uint8)).save(out / f"frames_{i}_label.png", optimize=True)
        frames.append({"imageAsset": {"path": f"frames_{i}_image.jpg"},
                       "depth": {"depthAsset": {"path": f"frames_{i}_depth.exr"},
                                 "confidenceAsset": {"path": f"frames_{i}_depth_confidence.png"}},
                       "camera": f["camera"]})
        np.save(out / f".truth_{i}.npy", pts.astype(np.float32))    # ground-truth hit points, not committed
        print(f"frame {i}: sky px {int(np.isnan(depth).sum())}, depth range {np.nanmin(depth):.3f}..{np.nanmax(depth):.3f}")
    (out / "posed-frames.json").write_text(json.dumps({"posedFrames": frames}, indent=1))
    (out / "labels.json").write_text(json.dumps({str(o["id"]): {"name": o["name"], "label": o["label"].tolist()} for o in objs}, indent=1))
    # splats2Mesh stand-ins
    meshes, nodes = [], []
    for o in objs:
        if o["name"].startswith("ceil") or o["name"] == "wall_s":
            continue     # cut-away, as a splats2Mesh `region` box that stops below the ceiling would give
        v, t = cube(o["lo"], o["hi"]) if o["kind"] == "box" else sphere(o["c"], o["r"])
        col = np.tile(o["col"], (len(v), 1))
        meshes.append((v, col, t))
        nodes.append({"name": o["name"], "mesh": len(meshes) - 1})
    write_glb(out / "mesh.glb", meshes, nodes)
    # collider boxes: one unit cube (+-0.5) shared by every node, TRS, yaw-only. Furniture only, like splats2Mesh.
    v, t = cube([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    cnodes = []
    for o in objs:
        if o["kind"] != "box" or o["name"].startswith(("ceil", "rug")):
            continue
        c = (o["lo"] + o["hi"]) / 2
        cnodes.append({"name": o["name"], "mesh": 0, "translation": c.tolist(), "scale": (o["hi"] - o["lo"]).tolist(),
                       "rotation": [0, 0, 0, 1]})
    write_glb(out / "colliderBoxes.glb", [(v, None, t)], cnodes)
    print(f"{len(frames)} frames, {len(objs)} objects, {len(cnodes)} collider boxes -> {out}")


if __name__ == "__main__":
    main()
