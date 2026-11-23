#!/usr/bin/env python3
"""prepare: X3D world -> everything an Atlas request needs, with the checks that gate the paid call.

For every Viewpoint: Atlas camera from the X3D text; depth from the three.js bridge (out/bridge, render_x3d.mjs)
checked against the analytic ray cast of the same X3D file (kit/x3dcast.py); bridge camera checked against the
Atlas camera; EXR written in Atlas's own layout. Writes out/<slug>/ and receipts/prepare-<slug>.json.
"""
import json, sys, hashlib
from pathlib import Path
import numpy as np
from PIL import Image
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3d2atlas as X, x3dcast

slug = sys.argv[1]
world = HERE / "worlds" / f"{slug}.x3d"
out = HERE / "out" / slug
out.mkdir(parents=True, exist_ok=True)
prims, skipped = x3dcast.load_x3d(world)
names = [p.name for p in prims]
vps = [v for v in x3dcast.load_viewpoints(world) if v["DEF"].startswith("Cam")]
bridge = json.loads((HERE / "out" / "bridge" / f"{slug}-bridge.json").read_text())
W, H = bridge["width"], bridge["height"]
rec = {"world": world.name, "world_sha256": hashlib.sha256(world.read_bytes()).hexdigest(), "solids": len(prims), "skipped": skipped,
       "rig": bridge["rig"], "frames": []}
cams, tiles = [], []
for i, vp in enumerate(vps):
    cam_json = X.viewpoint_to_camera(vp, W, H)
    cam = A.parse_camera(cam_json)
    bf = bridge["frames"][i]
    assert bf["def"] == vp["DEF"], (bf["def"], vp["DEF"])
    # 1. the camera the bridge drew with, against the camera Atlas will be told
    M = np.array(bf["matrixWorld"]).reshape(4, 4).T
    P = np.array(bf["projection"]).reshape(4, 4).T
    pos_err = float(np.linalg.norm(M[:3, 3] - cam.position))
    rot_err = float(np.degrees(np.arccos(np.clip((np.trace(M[:3, :3].T @ cam.R) - 1) / 2, -1, 1))))
    fx_b, fy_b = P[0, 0] * W / 2, P[1, 1] * H / 2
    # 2. depth: bridge raster against the analytic cast
    zb = np.frombuffer((HERE / "out" / "bridge" / f"{slug}-{i:02d}-depth.f32").read_bytes(), np.float32).reshape(H, W).astype(np.float64)
    cast_file = out / f"cast-{i:02d}.npz"
    if cast_file.exists():
        z = np.load(cast_file); zc, ids = z["depth"], z["ids"]
    else:
        zc, ids, _ = x3dcast.cast(prims, cam)
        np.savez_compressed(cast_file, depth=zc.astype(np.float32), ids=ids)
        zc = zc.astype(np.float32).astype(np.float64)
    both = (zb > 0) & (zc > 0)
    diff = np.abs(zb - zc)[both]
    rel = diff / zc[both]
    ok = rel < 0.001
    frame = {"index": i, "def": vp["DEF"], "description": vp["description"],
             "camera_pos_err_m": pos_err, "camera_rot_err_deg": rot_err, "fx_bridge": float(fx_b), "fy_bridge": float(fy_b),
             "fx_atlas": cam.fx, "depth_min": float(zb[zb > 0].min()), "depth_median": float(np.median(zb[zb > 0])), "depth_max": float(zb.max()),
             "empty_pct_bridge": float(100 * (zb == 0).mean()), "empty_pct_cast": float(100 * (zc == 0).mean()),
             "coverage_mismatch_px": int(((zb > 0) != (zc > 0)).sum()),
             "depth_median_abs_diff_mm": float(1000 * np.median(diff)), "depth_p99_abs_diff_mm": float(1000 * np.percentile(diff, 99)),
             "px_within_0p1pct": float(100 * ok.mean()), "px_edge_disagree": int((~ok).sum())}
    X.write_depth_exr(out / f"depth-{i:02d}.exr", zb)
    frame["exr_sha256"] = A.sha256_file(out / f"depth-{i:02d}.exr")
    frame["exr_bytes"] = (out / f"depth-{i:02d}.exr").stat().st_size
    rec["frames"].append(frame)
    cams.append({"def": vp["DEF"], "description": vp["description"], "camera": cam_json})
    print(f'{vp["DEF"]} pos {pos_err:.2e} m rot {rot_err:.2e} deg fx {fx_b:.3f}/{cam.fx:.3f} | depth med diff {frame["depth_median_abs_diff_mm"]:.4f} mm p99 {frame["depth_p99_abs_diff_mm"]:.3f} mm within0.1% {frame["px_within_0p1pct"]:.3f}% cover-mismatch {frame["coverage_mismatch_px"]}')
    # contact-sheet tile: bridge picture left, log-depth right
    pic = Image.open(HERE / "out" / "bridge" / f"{slug}-{i:02d}-bridge.png").convert("RGB").resize((480, 270))
    v = zb > 0
    lz = np.zeros_like(zb); lo, hi = np.log(zb[v].min()), np.log(zb[v].max())
    lz[v] = 1 - (np.log(zb[v]) - lo) / max(hi - lo, 1e-9)
    dimg = Image.fromarray((np.stack([lz * 255, lz * 215 + 20, lz * 140 + 60], -1) * v[..., None] + (~v[..., None]) * np.array([20, 40, 90])).astype(np.uint8)).resize((480, 270))
    tile = Image.new("RGB", (960, 270)); tile.paste(pic, (0, 0)); tile.paste(dimg, (480, 0)); tiles.append(tile)
(out / "cameras.json").write_text(json.dumps(cams, indent=1))
(out / "names.json").write_text(json.dumps(names))
sheet = Image.new("RGB", (960 * 2, 270 * ((len(tiles) + 1) // 2)))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * 960, (i // 2) * 270))
sheet.save(HERE / "shots" / f"{slug}-x3d-sheet.png")
f = rec["frames"]
rec["summary"] = {"viewpoints": len(f), "max_camera_pos_err_m": max(x["camera_pos_err_m"] for x in f), "max_camera_rot_err_deg": max(x["camera_rot_err_deg"] for x in f),
                  "max_depth_median_abs_diff_mm": max(x["depth_median_abs_diff_mm"] for x in f), "max_depth_p99_abs_diff_mm": max(x["depth_p99_abs_diff_mm"] for x in f),
                  "min_px_within_0p1pct": min(x["px_within_0p1pct"] for x in f), "max_coverage_mismatch_px": max(x["coverage_mismatch_px"] for x in f),
                  "witness": "three.js bridge depth pass (float32 target) vs kit/x3dcast.py analytic ray cast of the same X3D file"}
(HERE / "receipts").mkdir(exist_ok=True)
(HERE / "receipts" / f"prepare-{slug}.json").write_text(json.dumps(rec, indent=1))
print(json.dumps(rec["summary"], indent=1))
