#!/usr/bin/env python3
"""run_splats: posed RGBD -> posedImages2Splats. usage: run_splats.py <slug> <views-dir> --depth x3d|atlas [--refine] [--label L] [--skip 3,9]
--depth x3d   : Atlas pictures + the X3D depth and X3D cameras (geometry stays X3D's)
--depth atlas : Atlas pictures + the depth Atlas returned"""
import argparse, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import x3d2atlas as X
from atlas_client import AtlasClient
ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("views"); ap.add_argument("--depth", required=True); ap.add_argument("--refine", action="store_true")
ap.add_argument("--label"); ap.add_argument("--skip", default=""); ap.add_argument("--extra-source", action="store_true")
a = ap.parse_args()
out = HERE / "out" / a.slug
skip = {int(s) for s in a.skip.split(",") if s}
c = AtlasClient(HERE / "out" / "ledger.json", cap=14956, already_spent=2)
frames = []
for name in a.views.split(","):                         # one or more folders of generated views, e.g. ring 1 and ring 2
    d = out / name
    op = json.loads((d / "operation.json").read_text()); req = json.loads((d / "request.json").read_text())
    idx = [int(p.stem.split("-")[-1]) for p in sorted(d.glob("view-*"))]
    for k, f in enumerate(op["response"]["frames"]):
        i = idx[k]
        if i in skip: continue
        fr = {"imageAsset": f["imageAsset"]["assetId"], "camera": f["camera"]}
        fr["depthAsset"] = c.upload(out / f"depth-{i:02d}.exr") if a.depth == "x3d" else f["depth"]["depthAsset"]["assetId"]
        frames.append(fr)
if a.extra_source:                                      # the posed source photo that the views were generated from
    s = req["contextFrames"][0]
    frames.insert(0, {"imageAsset": s["imageAsset"]["assetId"], "depthAsset": s["depth"]["depthAsset"]["assetId"], "camera": s["camera"]})
body = X.splats_request(frames, refine=a.refine, prompt=req["prompt"])   # enhancePrompt=false needs a prompt (HTTP 422 otherwise)
label = a.label or f"splats-{'refined' if a.refine else 'draft'}:{a.slug}:{a.depth}"
dest = out / label.replace(":", "-"); dest.mkdir(parents=True, exist_ok=True)
(dest / "request.json").write_text(json.dumps(body, indent=1))
e = c.submit("posedImages2Splats", body, label)
print(f"submitted {label}: operation {e['operation']} price {e['price']} frames {len(frames)} | {c.summary()}", flush=True)
op2 = c.wait(e, timeout_s=3300, poll_s=20)
c.save_operation(op2, dest)
if not op2.get("done") or op2.get("error"):
    print("NOT DONE or ERROR:", json.dumps(op2.get("error"))[:800], c.summary()); sys.exit(1)
r = op2["response"]
if r.get("draftSplat"):
    p = c.download(r["draftSplat"]["assetId"], dest, "draft"); print("draft", p.name, p.stat().st_size, flush=True)
for n, s in (r.get("refinedSplats") or {}).items():
    p = c.download(s["assetId"], dest, f"refined-{n}"); print("refined", n, p.name, p.stat().st_size, flush=True)
print(f"done in {e.get('seconds')} s | {c.summary()}")
