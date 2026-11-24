#!/usr/bin/env python3
"""x3dcast: an analytic ray caster for X3D blockouts (Box, Cylinder, Sphere under Transforms).

It reads the X3D file itself, so it is a second, independent reading of the same scene the three.js bridge draws.
Outputs per camera: planar depth (distance along the optical axis, the encoding Atlas asks for in
depth-guided-generation.md "Encode depth"), an object-id map (index into the DEF list) and a face-normal map.
No surface = depth 0 (Atlas: "in an EXR, write 0, NaN, or infinity").

Supported: Transform (translation, rotation, scale; centre and scaleOrientation must be default), Group, Switch
(whichChoice child only), Collision, StaticGroup, Shape with Box / Cylinder / Sphere. Anything else is skipped and
counted in `skipped`, never guessed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from lxml import etree


def axis_angle_matrix(ax):
    x, y, z, a = ax
    n = math.sqrt(x * x + y * y + z * z)
    if n < 1e-12 or abs(a) < 1e-15:
        return np.eye(3)
    x, y, z = x / n, y / n, z / n
    c, s, t = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
                     [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
                     [t * x * z - s * y, t * y * z + s * x, t * z * z + c]])


def _floats(s, n, default):
    if s is None:
        return list(default)
    v = [float(t) for t in s.replace(",", " ").split()]
    if len(v) != n:
        raise ValueError(f"expected {n} numbers, got {s!r}")
    return v


@dataclass
class Prim:
    kind: str                 # box | cylinder | sphere
    params: tuple
    M: np.ndarray             # 4x4 local -> world
    name: str                 # nearest DEF up the tree
    path: str
    rgb: tuple = (0.8, 0.8, 0.8)
    Minv: np.ndarray = field(default=None, repr=False)

    def __post_init__(self):
        self.Minv = np.linalg.inv(self.M)

    def aabb_local(self):
        if self.kind == "box":
            h = np.array(self.params) / 2
        elif self.kind == "cylinder":
            r, hh = self.params
            h = np.array([r, hh / 2, r])
        else:
            h = np.array([self.params[0]] * 3)
        return -h, h

    def corners_world(self):
        lo, hi = self.aabb_local()
        c = np.array([[x, y, z, 1.0] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        return (c @ self.M.T)[:, :3]


def load_x3d(path) -> tuple[list[Prim], dict]:
    root = etree.parse(str(path)).getroot()
    scene = root.find("Scene")
    prims, skipped = [], {}

    def walk(el, M, name, path):
        tag = el.tag
        d = el.get("DEF")
        if d:
            name = d
        p = f"{path}/{tag}" + (f"[{d}]" if d else "")
        if tag == "Transform":
            for bad in ("center", "scaleOrientation"):
                if el.get(bad) not in (None, "0 0 0", "0 0 1 0"):
                    raise ValueError(f"{p}: {bad} is not supported by the caster")
            T = np.eye(4)
            T[:3, :3] = axis_angle_matrix(_floats(el.get("rotation"), 4, (0, 0, 1, 0))) @ np.diag(_floats(el.get("scale"), 3, (1, 1, 1)))
            T[:3, 3] = _floats(el.get("translation"), 3, (0, 0, 0))
            M = M @ T
        if tag == "Switch":
            w = int(el.get("whichChoice", "-1"))
            kids = [k for k in el if isinstance(k.tag, str)]
            if 0 <= w < len(kids):
                walk(kids[w], M, name, p)
            return
        if tag == "Shape":
            rgb = (0.8, 0.8, 0.8)
            mat = el.find("Appearance/Material")
            if mat is not None and mat.get("diffuseColor"):
                rgb = tuple(_floats(mat.get("diffuseColor"), 3, rgb))
            for g in el:
                if g.tag == "Box":
                    prims.append(Prim("box", tuple(_floats(g.get("size"), 3, (2, 2, 2))), M, name, p, rgb))
                elif g.tag == "Cylinder":
                    prims.append(Prim("cylinder", (float(g.get("radius", 1)), float(g.get("height", 2))), M, name, p, rgb))
                elif g.tag == "Sphere":
                    prims.append(Prim("sphere", (float(g.get("radius", 1)),), M, name, p, rgb))
                elif g.tag != "Appearance" and isinstance(g.tag, str):
                    skipped[g.tag] = skipped.get(g.tag, 0) + 1
            return
        for k in el:
            if isinstance(k.tag, str):
                walk(k, M, name, p)

    walk(scene, np.eye(4), "", "")
    return prims, skipped


def load_viewpoints(path) -> list[dict]:
    """Every Viewpoint as {DEF, description, position, orientation(axis-angle), fieldOfView}."""
    root = etree.parse(str(path)).getroot()
    out = []
    for v in root.iter("Viewpoint"):
        out.append({"DEF": v.get("DEF"), "description": v.get("description", ""),
                    "position": _floats(v.get("position"), 3, (0, 0, 10)),
                    "orientation": _floats(v.get("orientation"), 4, (0, 0, 1, 0)),
                    "fieldOfView": float(v.get("fieldOfView", math.pi / 4))})
    return out


def _hit_box(o, d, half):
    with np.errstate(divide="ignore", invalid="ignore"):
        inv = 1.0 / d
        t1, t2 = (-half - o) * inv, (half - o) * inv
    tn, tf = np.minimum(t1, t2), np.maximum(t1, t2)
    # a ray parallel to a slab and outside it gives nan/inf pairs that must miss
    par = d == 0
    out = par & ((o < -half) | (o > half))
    tn = np.where(par, -np.inf, tn)
    tf = np.where(par, np.inf, tf)
    axis_in = np.argmax(tn, axis=1)
    tnear, tfar = tn.max(axis=1), tf.min(axis=1)
    hit = (tnear <= tfar) & (tfar > 1e-9) & ~out.any(axis=1)
    inside = tnear <= 1e-9
    t = np.where(inside, tfar, tnear)
    axis = np.where(inside, np.argmin(tf, axis=1), axis_in)
    n = np.zeros_like(o)
    rows = np.arange(len(o))
    sign = -np.sign(d[rows, axis])
    n[rows, axis] = np.where(inside, -sign, sign)
    return hit, t, n


def _hit_cyl(o, d, r, h):
    hh = h / 2
    a = d[:, 0] ** 2 + d[:, 2] ** 2
    b = 2 * (o[:, 0] * d[:, 0] + o[:, 2] * d[:, 2])
    c = o[:, 0] ** 2 + o[:, 2] ** 2 - r * r
    best = np.full(len(o), np.inf)
    n = np.zeros_like(o)
    with np.errstate(divide="ignore", invalid="ignore"):
        disc = b * b - 4 * a * c
        sq = np.sqrt(np.maximum(disc, 0))
        for s in (-1, 1):
            t = (-b + s * sq) / (2 * a)
            y = o[:, 1] + t * d[:, 1]
            ok = (disc >= 0) & (a > 0) & (t > 1e-9) & (np.abs(y) <= hh) & (t < best)
            best = np.where(ok, t, best)
            px, pz = o[:, 0] + t * d[:, 0], o[:, 2] + t * d[:, 2]
            n = np.where(ok[:, None], np.stack([px / r, np.zeros_like(px), pz / r], 1), n)
        for ysign in (-1, 1):
            t = (ysign * hh - o[:, 1]) / d[:, 1]
            px, pz = o[:, 0] + t * d[:, 0], o[:, 2] + t * d[:, 2]
            ok = (d[:, 1] != 0) & (t > 1e-9) & (px * px + pz * pz <= r * r) & (t < best)
            best = np.where(ok, t, best)
            n = np.where(ok[:, None], np.array([0.0, ysign, 0.0]), n)
    return np.isfinite(best), best, n


def _hit_sph(o, d, r):
    a = (d * d).sum(1)
    b = 2 * (o * d).sum(1)
    c = (o * o).sum(1) - r * r
    disc = b * b - 4 * a * c
    sq = np.sqrt(np.maximum(disc, 0))
    t0, t1 = (-b - sq) / (2 * a), (-b + sq) / (2 * a)
    t = np.where(t0 > 1e-9, t0, t1)
    hit = (disc >= 0) & (t > 1e-9)
    n = (o + t[:, None] * d) / r
    return hit, t, n


def cast(prims: list[Prim], cam, *, pixel_center: float = 0.5):
    """cam: kit.atlas2x3d.AtlasCamera. Returns depth[h,w] float64 (0 = no surface), ids[h,w] int32 (-1 = none),
    normals[h,w,3] world-space unit normals facing the camera side that was hit."""
    w, h = cam.width, cam.height
    R, eye = cam.R, cam.position
    depth = np.full((h, w), np.inf)
    ids = np.full((h, w), -1, np.int32)
    nrm = np.zeros((h, w, 3))
    for i, p in enumerate(prims):
        # pixel bounding box of the primitive, to test only the rays that can reach it
        pc = (p.corners_world() - eye) @ R            # camera axes: x right, y up, z back
        if np.all(pc[:, 2] > -1e-6):
            continue                                   # wholly behind the camera
        if np.any(pc[:, 2] > -1e-3):
            c0, c1, r0, r1 = 0, w, 0, h                # straddles the camera plane: test every ray
        else:
            u = cam.cx + cam.fx * pc[:, 0] / -pc[:, 2]
            v = cam.cy - cam.fy * pc[:, 1] / -pc[:, 2]
            c0, c1 = max(0, int(math.floor(u.min() - 1))), min(w, int(math.ceil(u.max() + 1)))
            r0, r1 = max(0, int(math.floor(v.min() - 1))), min(h, int(math.ceil(v.max() + 1)))
            if c0 >= c1 or r0 >= r1:
                continue
        rr, cc = np.mgrid[r0:r1, c0:c1]
        dc = np.stack([(cc + pixel_center - cam.cx) / cam.fx, -(rr + pixel_center - cam.cy) / cam.fy, -np.ones(cc.shape)], -1).reshape(-1, 3)
        dw = dc @ R.T                                   # world ray; its parameter t is planar depth
        o = p.Minv[:3, :3] @ eye + p.Minv[:3, 3]
        dl = dw @ p.Minv[:3, :3].T
        ol = np.broadcast_to(o, dl.shape)
        if p.kind == "box":
            hit, t, n = _hit_box(ol, dl, np.array(p.params) / 2)
        elif p.kind == "cylinder":
            hit, t, n = _hit_cyl(ol, dl, *p.params)
        else:
            hit, t, n = _hit_sph(ol, dl, p.params[0])
        t = np.where(hit, t, np.inf).reshape(rr.shape)
        sub = depth[r0:r1, c0:c1]
        closer = t < sub
        if not closer.any():
            continue
        sub[closer] = t[closer]
        ids[r0:r1, c0:c1][closer] = i
        nw = n @ np.linalg.inv(p.M[:3, :3])             # normals transform by the inverse transpose
        nw /= np.maximum(np.linalg.norm(nw, axis=1, keepdims=True), 1e-12)
        nrm[r0:r1, c0:c1][closer] = nw.reshape(rr.shape + (3,))[closer]
    depth[~np.isfinite(depth)] = 0.0
    return depth, ids, nrm


def inside_any(prims: list[Prim], point) -> list[str]:
    """Names of primitives that contain `point` (a camera there would be inside geometry)."""
    out = []
    for p in prims:
        q = p.Minv[:3, :3] @ np.asarray(point, float) + p.Minv[:3, 3]
        if p.kind == "box":
            ok = np.all(np.abs(q) <= np.array(p.params) / 2)
        elif p.kind == "cylinder":
            ok = q[0] ** 2 + q[2] ** 2 <= p.params[0] ** 2 and abs(q[1]) <= p.params[1] / 2
        else:
            ok = q @ q <= p.params[0] ** 2
        if ok:
            out.append(p.name)
    return out


def surface_distance(prims: list[Prim], pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unsigned distance from each point to the nearest primitive surface, and the index of that primitive.
    Exact for unscaled boxes, spheres and cylinders (the blockouts use no scale)."""
    best = np.full(len(pts), np.inf)
    who = np.full(len(pts), -1, np.int32)
    for i, p in enumerate(prims):
        q = pts @ p.Minv[:3, :3].T + p.Minv[:3, 3]
        if p.kind == "box":
            h = np.array(p.params) / 2
            d = np.abs(q) - h
            outside = np.linalg.norm(np.maximum(d, 0), axis=1)
            inside = np.minimum(d.max(axis=1), 0)
            dist = np.abs(outside + inside)
        elif p.kind == "cylinder":
            r, hh = p.params[0], p.params[1] / 2
            dr, dy = np.hypot(q[:, 0], q[:, 2]) - r, np.abs(q[:, 1]) - hh
            outside = np.hypot(np.maximum(dr, 0), np.maximum(dy, 0))
            inside = np.minimum(np.maximum(dr, dy), 0)
            dist = np.abs(outside + inside)
        else:
            dist = np.abs(np.linalg.norm(q, axis=1) - p.params[0])
        m = dist < best
        best[m] = dist[m]
        who[m] = i
    return best, who
