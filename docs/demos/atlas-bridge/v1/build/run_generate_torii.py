#!/usr/bin/env python3
"""run_generate_torii: Atlas -> X3D leg. One posed photo (step 1, images2PosedRGBD op 802bf230...) -> 8 new posed
RGBD views on an arc about the gate (atlasGenerate), all cameras written first as X3D Viewpoints."""
import json, math, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3d2atlas as X, scenes
from atlas_client import AtlasClient

src = json.loads(Path("/mnt/project-files/atlas-first-call/operation.json").read_text())["response"]["frames"][0]
cam0 = A.parse_camera(src["camera"])
fwd = -cam0.R[:, 2]
C = cam0.position + 9.5 * fwd                         # the gate: median valid depth 9.48 (step 1 depth.exr)
C[1] = cam0.position[1] - 0.6
vfov = cam0.vfov
def orbit(deg, lift=0.0, pull=1.0):
    t = math.radians(deg); v = (cam0.position - C) * pull
    p = C + np.array([v[0] * math.cos(t) + v[2] * math.sin(t), v[1] + lift, -v[0] * math.sin(t) + v[2] * math.cos(t)])
    return p
views = [("arc 12 left", orbit(-12)), ("arc 12 right", orbit(12)), ("arc 24 left", orbit(-24)), ("arc 24 right", orbit(24)),
         ("arc 36 left", orbit(-36)), ("arc 36 right", orbit(36)), ("closer by a third", orbit(0, 0.0, 0.67)), ("raised 1.5 m", orbit(6, 1.5))]
targets, vps = [], []
for name, p in views:
    ax = scenes.look_at_axis_angle(p, C)
    vp = {"position": p.tolist(), "orientation": list(ax), "fieldOfView": vfov}
    cj = X.viewpoint_to_camera(vp, 1280, 720)
    cj["intrinsics"].update(fx=cam0.fx, fy=cam0.fy)    # keep the photo's own focal lengths
    targets.append(cj); vps.append({"description": name, **vp})
out = HERE / "out" / "torii" / "generate"
out.mkdir(parents=True, exist_ok=True)
(out / "viewpoints.json").write_text(json.dumps(vps, indent=1))
ctx = [{"imageAsset": src["imageAsset"]["assetId"], "depthAsset": src["depth"]["depthAsset"]["assetId"], "camera": src["camera"]}]
prompt = ("A vermilion Japanese torii gate standing in the shallow water of a calm mountain lake, a stone landing in front of it, "
          "forested hills and low cloud across the water, a small white boat far off, overcast daylight, photograph")
body = X.generate_request(ctx, targets, prompt, return_depth=True, enhance=False)
(out / "request.json").write_text(json.dumps(body, indent=1))
if "--dry" in sys.argv:
    print(json.dumps(vps, indent=1)[:600]); sys.exit(0)
c = AtlasClient(HERE / "out" / "ledger.json", cap=10000, already_spent=2)
e = c.submit("atlasGenerate", body, "generate:torii")
print(f"submitted: operation {e['operation']} price {e['price']} | {c.summary()}", flush=True)
op = c.wait(e, timeout_s=1500, poll_s=10)
c.save_operation(op, out)
if not op.get("done") or op.get("error"):
    print("NOT DONE or ERROR:", json.dumps(op.get("error"))[:800]); sys.exit(1)
for k, f in enumerate(op["response"]["frames"]):
    p = c.download(f["imageAsset"]["assetId"], out, f"view-{k:02d}")
    d = f.get("depth") or {}
    q = c.download(d["depthAsset"]["assetId"], out, f"atlas-depth-{k:02d}") if d.get("depthAsset") else None
    r = c.download(d["confidenceAsset"]["assetId"], out, f"atlas-conf-{k:02d}") if d.get("confidenceAsset") else None
    print(f"view {k:02d}: {p.name} {p.stat().st_size} B", q and q.stat().st_size, r and r.stat().st_size, flush=True)
print(f"done in {e.get('seconds')} s | {c.summary()}")
