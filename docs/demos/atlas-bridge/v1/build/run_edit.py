#!/usr/bin/env python3
"""run_edit: an edit addressed by X3D node name. The mask for each view comes from the X3D ray cast (which pixels
belong to the named nodes), so "repaint the globe" is a statement about the scene graph, not a hand-drawn region.
usage: run_edit.py <slug> --match Globe --frames 6,7,16,17 --views dirA,dirB --prompt-file F [--label L] [--grow 10]"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import x3d2atlas as X
from atlas_client import AtlasClient
ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("--match", required=True); ap.add_argument("--frames", required=True)
ap.add_argument("--views", required=True); ap.add_argument("--prompt-file", required=True); ap.add_argument("--label"); ap.add_argument("--grow", type=int, default=10)
ap.add_argument("--seed", type=int, default=7)
a = ap.parse_args()
out = HERE / "out" / a.slug
cams = json.loads((out / "cameras.json").read_text()); names = json.loads((out / "names.json").read_text())
label = a.label or f"edit:{a.slug}:{a.match.lower()}"; dest = out / label.replace(":", "-"); dest.mkdir(parents=True, exist_ok=True)
c = AtlasClient(HERE / "out" / "ledger.json", cap=10000, already_spent=2)
idx = [int(i) for i in a.frames.split(",")]; frames = []; stats = []
for i in idx:
    src = next(p for d in a.views.split(",") for p in [(out / d / f"view-{i:02d}.jpg")] if p.exists())
    ids = np.load(out / f"cast-{i:02d}.npz")["ids"]
    m = X.node_mask(ids, names, lambda n: n.startswith(a.match), grow=a.grow)
    mp = dest / f"mask-{i:02d}.png"; Image.fromarray(m, "L").save(mp)
    stats.append({"view": i, "source": str(src.relative_to(out)), "repaint_pct": round(100 * float((m == 0).mean()), 3)})
    frames.append({"camera": cams[i]["camera"], "depthAsset": c.upload(out / f"depth-{i:02d}.exr"), "imageAsset": c.upload(src, name=f"{a.slug}-{src.parent.name}-{src.name}"), "maskAsset": c.upload(mp, name=f"{a.slug}-mask-{a.match}-{i:02d}.png")})
    print(stats[-1], flush=True)
body = X.chisel_request(frames, Path(a.prompt_file).read_text().strip(), return_depth=False, enhance=False, seed=a.seed)
(dest / "request.json").write_text(json.dumps(body, indent=1)); (dest / "masks.json").write_text(json.dumps({"match": a.match, "nodes": [n for n in names if n.startswith(a.match)], "grow_px": a.grow, "views": stats}, indent=1))
e = c.submit("atlasChisel", body, label)
print(f"submitted {label}: operation {e['operation']} price {e['price']} | {c.summary()}", flush=True)
op = c.wait(e, timeout_s=1500, poll_s=10); c.save_operation(op, dest)
if not op.get("done") or op.get("error"):
    print("NOT DONE or ERROR:", json.dumps(op.get("error"))[:800], c.summary()); sys.exit(1)
for k, f in enumerate(op["response"]["frames"]):
    p = c.download(f["imageAsset"]["assetId"], dest, f"view-{idx[k]:02d}"); print(p.name, p.stat().st_size, flush=True)
print(f"done in {e.get('seconds')} s | {c.summary()}")
