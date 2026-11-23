#!/usr/bin/env python3
"""run_chisel: X3D blockout -> atlasChisel. usage: run_chisel.py <slug> [--label NAME] [--prompt-file F] [--frames 0,1,2] [--rgb-only] [--seed N]"""
import argparse, json, sys, time
from pathlib import Path
from lxml import etree
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import x3d2atlas as X
from atlas_client import AtlasClient

ap = argparse.ArgumentParser()
ap.add_argument("slug"); ap.add_argument("--label"); ap.add_argument("--prompt-file"); ap.add_argument("--frames"); ap.add_argument("--rgb-only", action="store_true")
ap.add_argument("--context-dir", help="folder of earlier view-NN.jpg to pass as contextFrames"); ap.add_argument("--context", help="frame indices of those views, e.g. 0,1,2")
ap.add_argument("--style", help="style reference image"); ap.add_argument("--seed", type=int, default=7); ap.add_argument("--cap", type=int, default=10000)
a = ap.parse_args()
out = HERE / "out" / a.slug
cams = json.loads((out / "cameras.json").read_text())
idx = [int(i) for i in a.frames.split(",")] if a.frames else list(range(len(cams)))
world = etree.parse(str(HERE / "worlds" / f"{a.slug}.x3d")).getroot()
prompt = Path(a.prompt_file).read_text().strip() if a.prompt_file else world.find("head/meta[@name='atlas.prompt']").get("content")
label = a.label or f"chisel:{a.slug}"
c = AtlasClient(HERE / "out" / "ledger.json", cap=a.cap, already_spent=2)
frames = []
for i in idx:
    aid = c.upload(out / f"depth-{i:02d}.exr", name=f"{a.slug}-depth-{i:02d}.exr")
    frames.append({"camera": cams[i]["camera"], "depthAsset": aid})
    print(f"uploaded depth {i:02d} -> {aid}", flush=True)
ctx = None
if a.context_dir:
    ctx = []
    for i in [int(v) for v in a.context.split(",")]:
        aid = c.upload(Path(a.context_dir) / f"view-{i:02d}.jpg", name=f"{a.slug}-context-{i:02d}.jpg")
        ctx.append({"imageAsset": aid, "camera": cams[i]["camera"]})
    print(f"uploaded {len(ctx)} context views", flush=True)
body = X.chisel_request(frames, prompt, return_depth=not a.rgb_only, enhance=False, seed=a.seed, context=ctx)
if a.style:
    body["styleReferenceImageAsset"] = {"assetId": c.upload(a.style)}
dest = out / label.replace(":", "-")
dest.mkdir(parents=True, exist_ok=True)
(dest / "request.json").write_text(json.dumps(body, indent=1))
e = c.submit("atlasChisel", body, label)
print(f"submitted {label}: operation {e['operation']} price {e['price']} | {c.summary()}", flush=True)
op = c.wait(e, timeout_s=1500, poll_s=10)
c.save_operation(op, dest)
if not op.get("done") or op.get("error"):
    print("NOT DONE or ERROR:", json.dumps(op.get("error"))[:800]); print(c.summary()); sys.exit(1)
resp = op["response"]
(dest / "prompt-used.txt").write_text(resp.get("promptUsed") or "")
for k, f in enumerate(resp["frames"]):
    i = idx[k]
    p = c.download(f["imageAsset"]["assetId"], dest, f"view-{i:02d}")
    line = f"view {i:02d}: {p.name} {p.stat().st_size} B"
    d = f.get("depth") or {}
    if d.get("depthAsset"):
        q = c.download(d["depthAsset"]["assetId"], dest, f"atlas-depth-{i:02d}"); line += f" | depth {q.stat().st_size} B"
    if d.get("confidenceAsset"):
        q = c.download(d["confidenceAsset"]["assetId"], dest, f"atlas-conf-{i:02d}"); line += f" | conf {q.stat().st_size} B"
    print(line, flush=True)
print(f"done in {e.get('seconds')} s | {c.summary()}")
