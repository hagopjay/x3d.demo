#!/usr/bin/env python3
"""measure_return: what came back from Atlas, held against the X3D world it started from.
  colliders: (a) of the X3D surface points every camera sees, the share inside a collider box (grown by --pad);
             (b) of points in the X3D world's open air (not in any solid, at least --clear from a surface, inside the room box), the share wrongly inside a box
  mesh:      distance from mesh vertices to the nearest X3D surface
usage: measure_return.py <slug> <mesh-dir> [--pad 0.05] [--clear 0.15]"""
import argparse, json, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3dcast
ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("mesh"); ap.add_argument("--pad", type=float, default=0.05); ap.add_argument("--clear", type=float, default=0.15)
a = ap.parse_args()
out = HERE / "out" / a.slug; d = out / a.mesh
prims, _ = x3dcast.load_x3d(HERE / "worlds" / f"{a.slug}.x3d")
cams = json.loads((out / "cameras.json").read_text())
boxes = A.collider_boxes(d / "colliders.glb")
def in_boxes(P, pad=0.0):
    hit = np.zeros(len(P), bool)
    for b in boxes:
        th = b["rotation"][3] * (1 if b["rotation"][1] >= 0 else -1); c, s = np.cos(th), np.sin(th)
        q = P - np.array(b["translation"]); x = c * q[:, 0] - s * q[:, 2]; z = s * q[:, 0] + c * q[:, 2]     # world -> box: rotate by -yaw
        h = np.array(b["size"]) / 2 + pad
        hit |= (np.abs(x) <= h[0]) & (np.abs(q[:, 1]) <= h[1]) & (np.abs(z) <= h[2])
    return hit
# (a) surface points seen by the cameras
rng = np.random.default_rng(3); pts = []
for i, cj in enumerate(cams):
    f = out / f"cast-{i:02d}.npz"
    if not f.exists(): continue
    depth = np.load(f)["depth"]; cam = A.parse_camera(cj["camera"])
    P = A.unproject(depth, cam, stride=8)
    P = P[0] if isinstance(P, tuple) else P
    pts.append(P.reshape(-1, 3))
S = np.vstack(pts); S = S[np.isfinite(S).all(1)]
S = S[rng.choice(len(S), min(len(S), 150000), replace=False)]
cov0, cov = in_boxes(S, 0.0), in_boxes(S, a.pad)
# (b) open air inside the room
req = json.loads((d / "request.json").read_text())["orientedBoundingBox"]; C, Hh = np.array(req["center"]), np.array(req["halfExtents"])
air = C + (rng.random((400000, 3)) * 2 - 1) * Hh
seen_lo, seen_hi = S.min(0), S.max(0); air = air[((air > seen_lo) & (air < seen_hi)).all(1)]         # inside the seen room, not in the wall thickness
dist, _ = x3dcast.surface_distance(prims, air)
inside = np.array([bool(x3dcast.inside_any(prims, p)) for p in air[:60000]]); air, dist = air[:60000], dist[:60000]
free = air[(~inside) & (dist >= a.clear)]
blocked = in_boxes(free, 0.0)
R = {"slug": a.slug, "boxes": len(boxes), "all_upright": all(b["yaw_only"] for b in boxes), "node_form": sorted({b["form"] for b in boxes}),
     "surface_points": int(len(S)), "surface_inside_box_pct": float(100 * cov0.mean()), f"surface_within_{int(a.pad*1000)}mm_of_box_pct": float(100 * cov.mean()),
     "open_air_points": int(len(free)), "open_air_clearance_m": a.clear, "open_air_wrongly_blocked_pct": float(100 * blocked.mean()),
     "box_volume_m3": float(sum(np.prod(b["size"]) for b in boxes))}
g, binchunk = A.read_glb(d / "mesh.glb")
prim = g["meshes"][0]["primitives"][0]; acc = g["accessors"][prim["attributes"]["POSITION"]]; bv = g["bufferViews"][acc["bufferView"]]
V = np.frombuffer(binchunk, np.float32, acc["count"] * 3, bv.get("byteOffset", 0) + acc.get("byteOffset", 0)).reshape(-1, 3).astype(float)
if bv.get("byteStride", 12) != 12: raise SystemExit("interleaved mesh: not handled")
Vs = V[rng.choice(len(V), min(len(V), 80000), replace=False)]; dm, _ = x3dcast.surface_distance(prims, Vs)
faces = sum(g["accessors"][p["indices"]]["count"] // 3 for me in g["meshes"] for p in me["primitives"] if "indices" in p)
R["mesh"] = {"vertices": int(len(V)), "faces": int(faces), "bytes": (d / "mesh.glb").stat().st_size, "bbox_min": V.min(0).round(3).tolist(), "bbox_max": V.max(0).round(3).tolist(),
             "vertex_to_x3d_surface_median_mm": float(1000 * np.median(dm)), "p90_mm": float(1000 * np.percentile(dm, 90)), "within_50mm_pct": float(100 * (dm < 0.05).mean()), "within_100mm_pct": float(100 * (dm < 0.1).mean())}
(HERE / "receipts" / f"{a.slug}-{a.mesh}.json").write_text(json.dumps(R, indent=1)); print(json.dumps(R, indent=1))
