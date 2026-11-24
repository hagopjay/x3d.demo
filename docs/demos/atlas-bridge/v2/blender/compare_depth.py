#!/usr/bin/env python3
"""compare_depth: is the X3D file the Blenderizer wrote the same room, seen by the same cameras, as the .blend?

Three independent readings of every camera:
  blender   camera.matrix_world and angle from the .blend (Z-up), turned to X3D's Y-up
  x3d       the Viewpoint in the exported file, its parent Transforms composed (this script, plain XML)
  bridge    the camera the X3D -> three.js bridge actually drew with
and two depth images per camera: Cycles (from the .blend) and the bridge (from the X3D file).

Cycles depth is tested both as planar z and as ray length; the reading that fits is reported, not assumed.
Writes out/scriptorium/{cameras.json, depth-NN.exr, names.json}, receipts/prepare-scriptorium.json, shots/scriptorium-blender-sheet.jpg.
"""
import json, math, sys, hashlib
from pathlib import Path
import numpy as np
from lxml import etree
from PIL import Image
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3d2atlas as X

slug = sys.argv[1] if len(sys.argv) > 1 else "scriptorium"
CY = HERE / "out" / (sys.argv[2] if len(sys.argv) > 2 else "cycles")       # folder of export_and_render.py output
world = HERE / "worlds" / f"{slug}.x3d"
out = HERE / "out" / slug; out.mkdir(parents=True, exist_ok=True)


def rot(ax):
    x, y, z, a = ax
    n = math.sqrt(x * x + y * y + z * z) or 1
    x, y, z = x / n, y / n, z / n
    c, s, C = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def fl(s, n, d):
    return [float(v) for v in s.replace(",", " ").split()] if s else list(d)


def local(e):
    M = np.eye(4)
    if e.tag == "Transform":
        t = fl(e.get("translation"), 3, (0, 0, 0)); r = fl(e.get("rotation"), 4, (0, 0, 1, 0)); s = fl(e.get("scale"), 3, (1, 1, 1))
        assert e.get("center") in (None, "0 0 0", "0.000000 0.000000 0.000000") and e.get("scaleOrientation") is None, "center/scaleOrientation not handled"
        M[:3, :3] = rot(r) @ np.diag(s); M[:3, 3] = t
    return M


def world_matrix(e):
    M = np.eye(4)
    while e is not None and e.tag != "Scene":
        M = local(e) @ M
        e = e.getparent()
    return M


root = etree.parse(str(world)).getroot()
vps = []
for v in root.iter("Viewpoint"):
    M = world_matrix(v.getparent())
    Lm = np.eye(4); Lm[:3, :3] = rot(fl(v.get("orientation"), 4, (0, 0, 1, 0))); Lm[:3, 3] = fl(v.get("position"), 3, (0, 0, 10))
    M = M @ Lm
    sc = np.linalg.norm(M[:3, :3], axis=0)
    assert np.allclose(sc, 1, atol=1e-5), f"scaled camera {sc}"
    Rm = M[:3, :3] / sc
    q = A.q_norm(A.R_to_q(Rm)) if hasattr(A, "R_to_q") else None
    vps.append({"DEF": v.get("DEF"), "description": v.get("description", ""), "R": Rm, "position": M[:3, 3].copy(), "fieldOfView": float(v.get("fieldOfView"))})
vps.sort(key=lambda v: v["description"])


def R_to_q(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2; q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4]
    else:
        i = int(np.argmax(np.diag(R))); j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
        q = [0, 0, 0, 0]; q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s; q[3] = (R[k, j] - R[j, k]) / s
    q = np.array(q); return q / np.linalg.norm(q)


bridge = json.loads((HERE / "out" / "bridge" / f"{slug}-bridge.json").read_text())
bfr = {f["def"]: f for f in bridge["frames"]}
blend = json.loads((CY / "blender-render.json").read_text())
names = json.loads((CY / "pass-index.json").read_text())
W, H = bridge["width"], bridge["height"]
ZUP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)             # Blender (x, y, z) -> X3D (x, z, -y)
ang = lambda Ra, Rb: float(np.degrees(np.arccos(np.clip((np.trace(Ra.T @ Rb) - 1) / 2, -1, 1))))
u = (np.arange(W) + 0.5 - W / 2); v = (np.arange(H) + 0.5 - H / 2)
rec = {"world": world.name, "world_sha256": hashlib.sha256(world.read_bytes()).hexdigest(), "blender": blend["blender"], "rig": bridge["rig"],
       "exporter": root.find("head/meta[@name='generator']").get("content"), "export_receipt": root.find("head/meta[@name='x3d-blender-io.receipt']").get("content"), "frames": []}
cams, tiles = [], []
for i, vp in enumerate(vps):
    bl = blend["frames"][i]; assert bl["name"] == vp["description"], (bl["name"], vp["description"])
    Mb = np.array(bl["matrix_world"])
    Rb, pb = ZUP @ Mb[:3, :3], ZUP @ Mb[:3, 3]
    f_blender = (H / 2) / math.tan(bl["angle_y"] / 2)
    f_x3d = (min(W, H) / 2) / math.tan(vp["fieldOfView"] / 2)
    bf = bfr[vp["DEF"]]
    Mt = np.array(bf["matrixWorld"]).reshape(4, 4).T; P = np.array(bf["projection"]).reshape(4, 4).T
    f_bridge = P[1, 1] * H / 2
    cam_json = {"extrinsics": {"position": [float(x) for x in vp["position"]], "quaternion": [float(x) for x in R_to_q(vp["R"])], "coordinateSystem": "rub"},
                "intrinsics": {"fx": f_x3d, "fy": f_x3d, "cx": W / 2, "cy": H / 2, "width": W, "height": H}}
    z = np.load(CY / f"cycles-{i:02d}.npz"); zc, ids = z["depth"].astype(np.float64), z["ids"]
    zb = np.frombuffer((HERE / "out" / "bridge" / f"{slug}-{i:02d}-depth.f32").read_bytes(), np.float32).reshape(H, W).astype(np.float64)
    ray = np.sqrt(1 + (u[None, :] / f_x3d) ** 2 + (v[:, None] / f_x3d) ** 2)
    both = (zc > 0) & (zb > 0)
    d_planar = np.abs(zc - zb)[both]; d_ray = np.abs(zc / ray - zb)[both]
    reading = "planar z" if np.median(d_planar) <= np.median(d_ray) else "ray length"
    zp = zc if reading == "planar z" else np.where(zc > 0, zc / ray, 0)
    diff = np.abs(zp - zb)[both]; rel = diff / zb[both]
    fr = {"index": i, "name": bl["name"], "def": vp["DEF"],
          "pos_err_blender_vs_x3d_mm": float(1000 * np.linalg.norm(pb - vp["position"])), "rot_err_blender_vs_x3d_deg": ang(Rb, vp["R"]),
          "pos_err_x3d_vs_bridge_mm": float(1000 * np.linalg.norm(Mt[:3, 3] - vp["position"])), "rot_err_x3d_vs_bridge_deg": ang(Mt[:3, :3], vp["R"]),
          "focal_px": {"blender": f_blender, "x3d": f_x3d, "bridge": float(f_bridge)},
          "cycles_depth_reading": reading, "median_if_planar_mm": float(1000 * np.median(d_planar)), "median_if_ray_mm": float(1000 * np.median(d_ray)),
          "depth_median_abs_diff_mm": float(1000 * np.median(diff)), "depth_p95_abs_diff_mm": float(1000 * np.percentile(diff, 95)), "depth_p99_abs_diff_mm": float(1000 * np.percentile(diff, 99)),
          "px_within_0p5pct": float(100 * (rel < 0.005).mean()), "coverage_mismatch_px": int(((zc > 0) != (zb > 0)).sum()),
          "empty_pct_cycles": float(100 * (zc == 0).mean()), "depth_range_m": [float(zp[zp > 0].min()), float(zp.max())]}
    X.write_depth_exr(out / f"depth-{i:02d}.exr", zp)
    np.savez_compressed(out / f"ids-{i:02d}.npz", ids=ids)
    fr["exr_sha256"] = A.sha256_file(out / f"depth-{i:02d}.exr")
    rec["frames"].append(fr)
    cams.append({"def": vp["DEF"], "description": vp["description"], "camera": cam_json})
    print(f'{bl["name"]} blender->x3d {fr["pos_err_blender_vs_x3d_mm"]:.4f} mm {fr["rot_err_blender_vs_x3d_deg"]:.5f} deg | f {f_blender:.3f}/{f_x3d:.3f}/{f_bridge:.3f} | Cycles is {reading} (planar {fr["median_if_planar_mm"]:.2f} ray {fr["median_if_ray_mm"]:.1f} mm) | med {fr["depth_median_abs_diff_mm"]:.3f} p95 {fr["depth_p95_abs_diff_mm"]:.2f} p99 {fr["depth_p99_abs_diff_mm"]:.1f} mm | cover-mismatch {fr["coverage_mismatch_px"]}')
    pf = CY / f"cycles-{i:02d}.png"
    pic = Image.open(pf).convert("RGB").resize((426, 240)) if pf.exists() else Image.new("RGB", (426, 240))
    xb = Image.open(HERE / "out" / "bridge" / f"{slug}-{i:02d}-bridge.png").convert("RGB").resize((426, 240))
    e = np.zeros((H, W)); e[both] = np.clip(np.abs(zp - zb)[both] / 0.02, 0, 1)                       # white = 20 mm or more
    err = np.stack([e * 255] * 3, -1); err[(zc > 0) != (zb > 0)] = (255, 60, 60); err[(zc == 0) & (zb == 0)] = (20, 40, 90)
    ei = Image.fromarray(err.astype(np.uint8)).resize((426, 240))
    t = Image.new("RGB", (1278, 240)); t.paste(pic, (0, 0)); t.paste(xb, (426, 0)); t.paste(ei, (852, 0)); tiles.append(t)
(out / "cameras.json").write_text(json.dumps(cams, indent=1))
(out / "names.json").write_text(json.dumps(names))
sheet = Image.new("RGB", (1278 * 2, 240 * ((len(tiles) + 1) // 2)))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * 1278, (i // 2) * 240))
sheet.save(HERE / "shots" / f"{slug}-blender-sheet.jpg", quality=88)
f = rec["frames"]; mx = lambda k: max(x[k] for x in f)
rec["summary"] = {"cameras": len(f), "max_pos_err_blender_vs_x3d_mm": mx("pos_err_blender_vs_x3d_mm"), "max_rot_err_blender_vs_x3d_deg": mx("rot_err_blender_vs_x3d_deg"),
                  "max_pos_err_x3d_vs_bridge_mm": mx("pos_err_x3d_vs_bridge_mm"), "max_rot_err_x3d_vs_bridge_deg": mx("rot_err_x3d_vs_bridge_deg"),
                  "cycles_depth_reading": sorted({x["cycles_depth_reading"] for x in f}),
                  "max_depth_median_abs_diff_mm": mx("depth_median_abs_diff_mm"), "max_depth_p95_abs_diff_mm": mx("depth_p95_abs_diff_mm"), "max_depth_p99_abs_diff_mm": mx("depth_p99_abs_diff_mm"),
                  "min_px_within_0p5pct": min(x["px_within_0p5pct"] for x in f), "max_coverage_mismatch_px": mx("coverage_mismatch_px"),
                  "witness": "Cycles Depth pass of the .blend (1 sample, 0.01 px box filter) vs the X3D -> three.js bridge depth pass of the exported X3D file; cameras read three ways (.blend, X3D text, bridge)"}
(HERE / "receipts" / f"prepare-{slug}.json").write_text(json.dumps(rec, indent=1))
print(json.dumps(rec["summary"], indent=1))
