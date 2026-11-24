#!/usr/bin/env python3
"""x3dmesh: read an X3D file made of meshes (what the Blender add-on writes) the way x3dcast.py reads one made of
primitives. Viewpoints and geometry are taken to world space by composing every parent Transform.

  load_viewpoints(path)   -> [{DEF, description, position, orientation (axis-angle), fieldOfView, R}] in world space
  load_triangles(path)    -> (V (n,3) float64, F (m,3) int, owner (m,) int, names [str])  world space, polygons fanned
  MeshDistance(V, F)      -> exact unsigned distance from points to the surface (mathutils BVH; needs Blender's Python module)
"""
from __future__ import annotations
import math
import numpy as np
from lxml import etree


def _fl(s, d):
    return [float(v) for v in s.replace(",", " ").split()] if s else list(d)


def rot(ax):
    x, y, z, a = ax
    n = math.sqrt(x * x + y * y + z * z) or 1.0
    x, y, z = x / n, y / n, z / n
    c, s, C = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def R_to_axis_angle(R):
    a = math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2)))
    if a < 1e-9:
        return [0.0, 0.0, 1.0, 0.0]
    if abs(a - math.pi) < 1e-6:                                 # half turn: the antisymmetric part vanishes, take the axis from the diagonal
        d = np.clip((np.diag(R) + 1) / 2, 0, None); ax = np.sqrt(d)
        i = int(np.argmax(ax))
        for j in range(3):
            if j != i and R[i, j] + R[j, i] < 0:
                ax[j] = -ax[j]
        return [*(ax / np.linalg.norm(ax)), a]
    v = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    return [*(v / np.linalg.norm(v)), a]


def _local(e):
    M = np.eye(4)
    if e.tag == "Transform":
        t, r, s = _fl(e.get("translation"), (0, 0, 0)), _fl(e.get("rotation"), (0, 0, 1, 0)), _fl(e.get("scale"), (1, 1, 1))
        c = _fl(e.get("center"), (0, 0, 0))
        if e.get("scaleOrientation") not in (None, "0 0 1 0"):
            raise ValueError("scaleOrientation is not handled")
        T, C, Ci = np.eye(4), np.eye(4), np.eye(4)
        T[:3, 3] = t; C[:3, 3] = c; Ci[:3, 3] = [-v for v in c]
        RS = np.eye(4); RS[:3, :3] = rot(r) @ np.diag(s)
        M = T @ C @ RS @ Ci
    return M


def world_matrix(e):
    M = np.eye(4)
    while e is not None and e.tag != "Scene":
        M = _local(e) @ M
        e = e.getparent()
    return M


def load_viewpoints(path):
    out = []
    for v in etree.parse(str(path)).getroot().iter("Viewpoint"):
        L = np.eye(4); L[:3, :3] = rot(_fl(v.get("orientation"), (0, 0, 1, 0))); L[:3, 3] = _fl(v.get("position"), (0, 0, 10))
        M = world_matrix(v.getparent()) @ L
        sc = np.linalg.norm(M[:3, :3], axis=0)
        if not np.allclose(sc, 1, atol=1e-5):
            raise ValueError(f"Viewpoint {v.get('DEF')} sits under a scale {sc}")
        R = M[:3, :3] / sc
        out.append({"DEF": v.get("DEF"), "description": v.get("description", ""), "position": M[:3, 3].tolist(), "orientation": R_to_axis_angle(R),
                    "fieldOfView": float(v.get("fieldOfView", math.pi / 4)), "R": R})
    return out


def load_triangles(path):
    V, F, owner, names = [], [], [], []
    base = 0
    for g in etree.parse(str(path)).getroot().iter("IndexedFaceSet", "IndexedTriangleSet"):
        c = g.find("Coordinate")
        if c is None or not c.get("point"):
            continue
        P = np.array(_fl(c.get("point"), ()), float).reshape(-1, 3)
        M = world_matrix(g.getparent())
        Pw = P @ M[:3, :3].T + M[:3, 3]
        e = g.getparent()
        while e is not None and not e.get("DEF"):
            e = e.getparent()
        names.append(e.get("DEF") if e is not None else f"shape{len(names)}")
        if g.tag == "IndexedTriangleSet":
            idx = np.array([int(v) for v in g.get("index").replace(",", " ").split()]).reshape(-1, 3)
            tris = idx.tolist()
        else:
            tris, poly = [], []
            for v in [int(v) for v in g.get("coordIndex").replace(",", " ").split()] + [-1]:
                if v == -1:
                    tris += [[poly[0], poly[k], poly[k + 1]] for k in range(1, len(poly) - 1)]
                    poly = []
                else:
                    poly.append(v)
        V.append(Pw); F += [[a + base, b + base, c2 + base] for a, b, c2 in tris]; owner += [len(names) - 1] * len(tris)
        base += len(Pw)
    return np.vstack(V), np.array(F, int), np.array(owner, int), names


class MeshDistance:
    def __init__(self, V, F):
        import bpy  # noqa: F401  (the wheel exposes mathutils only after bpy is imported)
        from mathutils.bvhtree import BVHTree
        self.tree = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(int(i) for i in f) for f in F])

    def __call__(self, P, limit=10.0):
        d = np.empty(len(P)); tri = np.empty(len(P), int)
        for i, p in enumerate(P):
            loc, n, k, dist = self.tree.find_nearest(tuple(float(v) for v in p), limit)
            d[i], tri[i] = (dist, k) if loc is not None else (limit, -1)
        return d, tri
