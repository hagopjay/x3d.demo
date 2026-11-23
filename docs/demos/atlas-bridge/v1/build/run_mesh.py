#!/usr/bin/env python3
"""run_mesh: splats -> splats2Mesh (mesh GLB + collider boxes GLB). The region to mesh is the X3D world's own
bounding box (plus a margin), so the mesh request is framed by the scene graph, not by eye.
usage: run_mesh.py <slug> <splats-dir> [--which refined|draft] [--boxes 300] [--faces 300000] [--texture 2048] [--margin 0.3] [--label L]"""
import argparse, json, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import x3dcast
from atlas_client import AtlasClient
ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("splats"); ap.add_argument("--which", default="refined"); ap.add_argument("--boxes", type=int, default=300)
ap.add_argument("--faces", type=int, default=300000); ap.add_argument("--texture", type=int, default=2048); ap.add_argument("--margin", type=float, default=0.3); ap.add_argument("--label")
ap.add_argument("--anchors", help="x,y,z;x,y,z manual anchors (default: auto)")
a = ap.parse_args()
out = HERE / "out" / a.slug; d = out / a.splats
r = json.loads((d / "operation.json").read_text())["response"]
asset = r["draftSplat"]["assetId"] if a.which == "draft" else next(iter(r["refinedSplats"].values()))["assetId"]
prims, _ = x3dcast.load_x3d(HERE / "worlds" / f"{a.slug}.x3d")
lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
for p in prims:                                              # world box of every solid (boxes exactly, round solids by their box)
    h = (np.array(p.params) / 2) if p.kind == "box" else (np.array([p.params[0], p.params[1] / 2, p.params[0]]) if p.kind == "cylinder" else np.full(3, p.params[0]))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                c = p.M[:3, :3] @ (h * [sx, sy, sz]) + p.M[:3, 3]; lo, hi = np.minimum(lo, c), np.maximum(hi, c)
lo -= a.margin; hi += a.margin
body = {"splatAsset": {"assetId": asset}, "orientedBoundingBox": {"center": ((lo + hi) / 2).round(4).tolist(), "orientation": [0, 0, 0, 1], "halfExtents": ((hi - lo) / 2).round(4).tolist()},
        "targetFaces": a.faces, "textureMode": "image_texture", "textureSize": a.texture, "colliderBoxes": {"targetBoxes": a.boxes}}
if a.anchors:
    body["cameras"] = {"strategy": "manual_anchors", "anchors": [[float(v) for v in s.split(",")] for s in a.anchors.split(";")]}
label = a.label or f"mesh:{a.slug}:{a.which}"; dest = out / label.replace(":", "-"); dest.mkdir(parents=True, exist_ok=True)
(dest / "request.json").write_text(json.dumps(body, indent=1))
c = AtlasClient(HERE / "out" / "ledger.json", cap=10000, already_spent=2)
e = c.submit("splats2Mesh", body, label)
print(f"submitted {label}: operation {e['operation']} price {e['price']} | {c.summary()}", flush=True)
op = c.wait(e, timeout_s=3300, poll_s=20); c.save_operation(op, dest)
if not op.get("done") or op.get("error"):
    print("NOT DONE or ERROR:", json.dumps(op.get("error"))[:800], c.summary()); sys.exit(1)
rr = op["response"]
p = c.download(rr["mesh"]["assetId"], dest, "mesh"); print("mesh", p.name, p.stat().st_size, flush=True)
if rr.get("colliderBoxes"):
    p = c.download(rr["colliderBoxes"]["assetId"], dest, "colliders"); print("colliders", p.name, p.stat().st_size, flush=True)
print("anchors", len(rr.get("anchorPositions") or []), "| done in", e.get("seconds"), "s |", c.summary())
