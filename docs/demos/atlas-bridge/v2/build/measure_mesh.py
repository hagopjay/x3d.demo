#!/usr/bin/env python3
"""measure_mesh: the Atlas mesh GLB held against the triangles of the X3D file it started from (any X3D mesh world).
usage: measure_mesh.py <slug> <mesh-dir>"""
import json, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3dmesh
slug, md = sys.argv[1], sys.argv[2]
d = HERE / "out" / slug / md
V0, F0, owner, names = x3dmesh.load_triangles(HERE / "worlds" / f"{slug}.x3d")
dist = x3dmesh.MeshDistance(V0, F0)
g, binchunk = A.read_glb(d / "mesh.glb")
prim = g["meshes"][0]["primitives"][0]; acc = g["accessors"][prim["attributes"]["POSITION"]]; bv = g["bufferViews"][acc["bufferView"]]
if bv.get("byteStride", 12) != 12: raise SystemExit("interleaved mesh: not handled")
V = np.frombuffer(binchunk, np.float32, acc["count"] * 3, bv.get("byteOffset", 0) + acc.get("byteOffset", 0)).reshape(-1, 3).astype(float)
rng = np.random.default_rng(3); Vs = V[rng.choice(len(V), min(len(V), 80000), replace=False)]
dm, tri = dist(Vs)
faces = sum(g["accessors"][p["indices"]]["count"] // 3 for me in g["meshes"] for p in me["primitives"] if "indices" in p)
own = owner[tri[tri >= 0]]; touched = len(set(own.tolist()))
R = {"slug": slug, "x3d_triangles": int(len(F0)), "x3d_objects": len(names),
     "mesh": {"vertices": int(len(V)), "faces": int(faces), "bytes": (d / "mesh.glb").stat().st_size, "bbox_min": V.min(0).round(3).tolist(), "bbox_max": V.max(0).round(3).tolist(),
              "sampled": int(len(Vs)), "vertex_to_x3d_surface_median_mm": float(1000 * np.median(dm)), "p90_mm": float(1000 * np.percentile(dm, 90)), "p99_mm": float(1000 * np.percentile(dm, 99)),
              "within_20mm_pct": float(100 * (dm < 0.02).mean()), "within_50mm_pct": float(100 * (dm < 0.05).mean()), "within_100mm_pct": float(100 * (dm < 0.1).mean()),
              "x3d_objects_nearest_to_some_vertex": touched},
     "method": "nearest point on the X3D triangles (Blender BVH) for a random sample of Atlas mesh vertices"}
(HERE / "receipts" / f"{slug}-{md}.json").write_text(json.dumps(R, indent=1)); print(json.dumps(R, indent=1))
