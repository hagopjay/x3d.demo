#!/usr/bin/env python3
"""Demo 76 build: Atlas posed-RGBD bundle -> X3D worlds + trap measurements + Loom receipt. Zero network calls.

    python3 build/run_all.py            (after kit/make_fixture.py has written data/bundle)

Writes worlds/*.x3d, receipts/numbers.json, receipts/loom-receipt.json. Every number in the page comes from
receipts/numbers.json; each entry names the tool that produced it.
"""
from __future__ import annotations

import json
import math
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as ax          # noqa: E402
import make_fixture as fx       # noqa: E402

B = HERE / "data" / "bundle"
W = HERE / "worlds"
R = HERE / "receipts"
X3D_MCP = Path("/home/user/x3d_mcp")
N = {}          # numbers.json


def note(key, value, source):
    N[key] = {"value": value, "source": source}


def lookat(eye, target, up=(0, 1, 0), fov=0.9):
    eye, target, up = (np.asarray(x, float) for x in (eye, target, up))
    b = eye - target
    b /= np.linalg.norm(b)
    r = np.cross(up, b)
    r /= np.linalg.norm(r)
    u = np.cross(b, r)
    M = np.stack([r, u, b], 1)
    w = math.sqrt(max(0, 1 + M[0, 0] + M[1, 1] + M[2, 2])) / 2
    q = np.array([(M[2, 1] - M[1, 2]) / (4 * w), (M[0, 2] - M[2, 0]) / (4 * w), (M[1, 0] - M[0, 1]) / (4 * w), w])
    return {"position": eye.tolist(), "orientation": list(ax.q_to_axis_angle(q)), "fieldOfView": fov}


def err_stats(pred, truth):
    e = np.linalg.norm(pred - truth, axis=1)
    return {"n": int(len(e)), "mean_mm": float(e.mean() * 1000), "p99_mm": float(np.percentile(e, 99) * 1000),
            "max_mm": float(e.max() * 1000)}


def main():
    t0 = time.time()
    frames = json.loads((B / "posed-frames.json").read_text())["posedFrames"]
    cams = [ax.parse_camera(f["camera"]) for f in frames]
    depths = [ax.read_exr_depth(B / f["depth"]["depthAsset"]["path"]) for f in frames]
    confs = [np.asarray(Image.open(B / f["depth"]["confidenceAsset"]["path"])) for f in frames]
    rgbs = [np.asarray(Image.open(B / f["imageAsset"]["path"])).astype(np.float64) / 255 for f in frames]
    truths = [np.load(B / f".truth_{i}.npy") for i in range(len(frames))]

    # ---------------------------------------------------------------- 1. unprojection against ground truth, + traps
    good, mut = [], {k: [] for k in ("rows_bottom_up", "pixel_corner_not_centre", "depth_along_ray",
                                       "pose_read_as_world_to_camera", "rub_read_as_rdf")}
    nan_px = 0
    for cam, d, tr in zip(cams, depths, truths):
        nan_px += int((~ax.valid_depth(d)).sum())
        pts, (rr, cc) = ax.unproject(d, cam, stride=4)
        T = tr[rr, cc].astype(np.float64)
        good.append(np.linalg.norm(pts - T, axis=1))
        # trap 1: decoder handed rows bottom-up (three.js EXRLoader order) and nobody flipped
        p, (r2, c2) = ax.unproject(d, cam, stride=4, rows_bottom_up=True)
        mut["rows_bottom_up"].append(np.linalg.norm(p - tr[r2, c2], axis=1))
        # trap 2: pixel corner (u) instead of pixel centre (u + 0.5)
        p, _ = ax.unproject(d, cam, stride=4, pixel_center=0.0)
        mut["pixel_corner_not_centre"].append(np.linalg.norm(p - T, axis=1))
        # trap 3: depth treated as distance along the ray
        z = d[rr, cc].astype(np.float64)
        u, v = cc + 0.5, rr + 0.5
        dirc = np.stack([(u - cam.cx) / cam.fx, -(v - cam.cy) / cam.fy, -np.ones_like(u, float)], 1)
        dirc /= np.linalg.norm(dirc, axis=1, keepdims=True)
        p = cam.position + (dirc * z[:, None]) @ cam.R.T
        mut["depth_along_ray"].append(np.linalg.norm(p - T, axis=1))
        # trap 4: camera-to-world pose read as world-to-camera
        pc = np.stack([(u - cam.cx) / cam.fx * z, -(v - cam.cy) / cam.fy * z, -z], 1)
        p = (pc - cam.position) @ cam.R           # = R^T (pc - t)
        mut["pose_read_as_world_to_camera"].append(np.linalg.norm(p - T, axis=1))
        # trap 5: an rub pose labelled rdf (only the string changed)
        c_bad = ax.AtlasCamera(cam.position, ax.q_mul(cam.q_rub, ax.QX_PI), cam.fx, cam.fy, cam.cx, cam.cy,
                               cam.width, cam.height, "rdf")
        p = c_bad.position + pc @ c_bad.R.T
        mut["rub_read_as_rdf"].append(np.linalg.norm(p - T, axis=1))
    g = np.concatenate(good)
    note("unproject_correct", {"points": int(len(g)), "mean_mm": float(g.mean() * 1000), "p99_mm": float(np.percentile(g, 99) * 1000),
                               "max_mm": float(g.max() * 1000)},
         "build/run_all.py: atlas2x3d.unproject (stride 4) vs raycast hit points, 10 frames, float32 EXR via OpenEXR 3.5.5")
    note("traps", {k: {"mean_mm": float(np.concatenate(v).mean() * 1000), "p99_mm": float(np.percentile(np.concatenate(v), 99) * 1000)}
                   for k, v in mut.items()}, "same run, each trap applied alone")
    note("nan_pixels", nan_px, "count of NaN depth pixels (window) across 10 frames; skipped by valid_depth()")

    # ---------------------------------------------------------------- 2. viewpoints
    vps = [ax.camera_to_viewpoint(c) for c in cams]
    note("viewpoints", [{"i": i, "position": [round(x, 4) for x in v["position"]],
                         "orientation": [round(x, 5) for x in v["orientation"]],
                         "fieldOfView_rad": round(v["fieldOfView"], 6), "fov_deg": round(math.degrees(v["fieldOfView"]), 3),
                         "hfov_deg": round(math.degrees(cams[i].hfov), 3), "principal_offset_px": v["principal_offset_px"]}
                        for i, v in enumerate(vps)], "atlas2x3d.camera_to_viewpoint on data/atlas-skills-rig.json")
    # rdf round trip: express each camera in rdf, parse again, compare
    worst = 0.0
    for c in cams:
        q_rdf = ax.q_mul(c.q_rub, ax.QX_PI)
        c2 = ax.parse_camera({"intrinsics": {"fx": c.fx, "fy": c.fy, "cx": c.cx, "cy": c.cy, "width": c.width, "height": c.height},
                              "extrinsics": {"position": c.position.tolist(), "quaternion": q_rdf.tolist(), "coordinateSystem": "rdf"}})
        worst = max(worst, float(np.abs(c2.R - c.R).max()))
    note("rdf_roundtrip_max_abs", worst, "rub -> rdf -> parse_camera -> rotation matrix, max |delta| over 10 cameras")
    # the docs' own example: 30 deg right turn = [0, -0.2588, 0, 0.9659]
    c30 = ax.parse_camera({"intrinsics": {"fx": 1, "fy": 1, "cx": 0, "cy": 0, "width": 2, "height": 2},
                           "extrinsics": {"position": [0, 0, 0], "quaternion": [0, -0.2588, 0, 0.9659], "coordinateSystem": "rub"}})
    fwd = c30.R @ np.array([0, 0, -1.0])
    note("docs_30deg_right_turn_forward", [round(x, 4) for x in fwd],
         "cameras-and-posed-images.md example quaternion -> forward vector (expect x = +0.5, z = -0.866: turned right)")

    # ---------------------------------------------------------------- 3. fused point cloud + splats + SPZ
    P, C = [], []
    for cam, d, cf, rgb in zip(cams, depths, confs, rgbs):
        pts, (rr, cc) = ax.unproject(d, cam, stride=12, confidence=cf, min_conf=60)
        P.append(pts)
        C.append(rgb[rr, cc])
    P, C = np.concatenate(P), np.concatenate(C)
    note("points_fused", int(len(P)), "stride 12, confidence > 60, 10 frames")
    # voxel-merge into splats (2.5 cm), isotropic std-dev from the pixel footprint
    vox = np.floor(P / 0.025).astype(np.int64)
    _, first, inv = np.unique(vox, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    cnt = np.bincount(inv)
    Ps = np.stack([np.bincount(inv, P[:, k]) / cnt for k in range(3)], 1)
    Cs = np.stack([np.bincount(inv, C[:, k]) / cnt for k in range(3)], 1)
    sp = ax.Splats(Ps, np.full((len(Ps), 3), 0.022), np.tile([0, 0, 0, 1.0], (len(Ps), 1)), np.full(len(Ps), 0.92), Cs)
    hdr = ax.write_spz(B / "fused.spz", sp)
    sp2, hdr2 = ax.read_spz(B / "fused.spz")
    note("spz", {"header": hdr2, "bytes": (B / "fused.spz").stat().st_size, "splats": len(Ps),
                 "pos_max_err_mm": float(np.abs(sp2.positions - Ps).max() * 1000),
                 "rgb_max_err_255": float(np.abs(sp2.rgb - np.clip(Cs, 0, 1)).max() * 255)},
         "atlas2x3d.write_spz -> read_spz round trip (SPZ v2, 12 fractional bits)")

    # ---------------------------------------------------------------- 4. collider boxes
    boxes = ax.collider_boxes(B / "colliderBoxes.glb")
    truth = {o["name"]: o for o in fx.scene()}
    berr = max(max(np.abs(np.array(b["size"]) - (truth[b["name"]]["hi"] - truth[b["name"]]["lo"])).max(),
                   np.abs(np.array(b["translation"]) - (truth[b["name"]]["hi"] + truth[b["name"]]["lo"]) / 2).max()) for b in boxes)
    note("collider_boxes", {"count": len(boxes), "all_yaw_only": all(b["yaw_only"] for b in boxes), "max_abs_err_m": float(berr)},
         "atlas2x3d.collider_boxes on colliderBoxes.glb vs scene truth")

    # ---------------------------------------------------------------- 5. X3D worlds
    W.mkdir(exist_ok=True)
    head = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.1//EN" '
            '"https://www.web3d.org/specifications/x3d-4.1.dtd">\n<X3D version="4.1" profile="Immersive" '
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.1.xsd">\n'
            '  <head>\n    <component name="GaussianSplats" level="1"/>\n'
            '    <meta name="title" content="{title}"/>\n    <meta name="generator" content="x3d.demo marble-atlas/v1 atlas2x3d.py ' + ax.VERSION + '"/>\n'
            '    <meta name="source" content="Camera rig: worldlabsai/skills 6cdb6b9 (Apache-2.0). Scene: procedural, CC0. No World Labs output data."/>\n'
            '    <meta name="atlas.frame" content="Three.js / X3D: +X right, +Y up, -Z forward; poses camera-to-world, rub; identity wrapper"/>\n'
            '  </head>\n  <Scene>\n')
    tail = "  </Scene>\n</X3D>\n"

    vp_xml = "\n    ".join(ax.viewpoint_xml(v, f"Atlas camera {i}" + (" (posed source)" if i == 0 else " (target)"), f"Cam{i}")
                           for i, v in enumerate(vps))
    fr_xml = "\n      ".join(ax.frustum_xml(c, 0.45, "1 0.55 0.1" if i == 0 else "0.2 0.85 1", f"Frustum{i}") for i, c in enumerate(cams))
    studio = (head.replace("{title}", "Atlas rig in X3D: 10 cameras, fused RGBD, splats, mesh, colliders") +
              '    <NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
              '    <Background skyColor="0.04 0.05 0.08"/>\n'
              + ax.viewpoint_xml(lookat([4.6, 5.8, 4.2], [0, 0.6, -2.6]), "Overview", "Overview") + "\n"
              + ax.viewpoint_xml(lookat([0.0, 9.5, -2.6001], [0, 0, -2.6], up=[0, 0, -1]), "Plan (top)", "Plan") + "\n"
              f'    {vp_xml}\n'
              f'    <Group DEF="Frustums">\n      {fr_xml}\n    </Group>\n'
              '    <Switch DEF="Body" whichChoice="0">\n'
              f'      <Group DEF="PointsGroup">{ax.points_xml(P, C, "FusedPoints", 2.0)}</Group>\n'
              f'      <Group DEF="SplatGroup">{ax.splats_xml(sp2, "FusedSplats")}</Group>\n'
              '      <Group DEF="MeshGroup"><Inline DEF="AtlasMesh" url=\'"../data/bundle/mesh.glb"\'/></Group>\n'
              '    </Switch>\n'
              '    <Switch DEF="Colliders" whichChoice="-1"><Group>\n'
              + "\n".join(f'      <Transform translation="{ax.f3(b["translation"])}" rotation="{" ".join("%.6f" % x for x in b["rotation"])}">'
                          f'<Shape><Appearance><Material diffuseColor="0.1 0.95 0.6" transparency="0.7"/></Appearance><Box size="{ax.f3(b["size"])}"/></Shape></Transform>'
                          for b in boxes) +
              '\n    </Group></Switch>\n'
              f'    {ax.collision_xml(boxes, "AtlasCollision")}\n' + tail)
    (W / "atlas-studio.x3d").write_text(studio)

    def label_world(name, vp_override=None):
        objs = fx.scene()
        shapes = []
        for o in objs:
            col = " ".join("%.4f" % x for x in o["label"])
            app = f'<Appearance><UnlitMaterial emissiveColor="{col}"/></Appearance>'
            if o["kind"] == "box":
                c, s = (o["lo"] + o["hi"]) / 2, o["hi"] - o["lo"]
                shapes.append(f'<Transform translation="{ax.f3(c)}"><Shape>{app}<Box size="{ax.f3(s)}"/></Shape></Transform>')
            else:
                shapes.append(f'<Transform translation="{ax.f3(o["c"])}"><Shape>{app}<Sphere radius="{o["r"]}" /></Shape></Transform>')
        vlist = vp_override or [ax.viewpoint_xml(v, f"Atlas camera {i}", f"Cam{i}") for i, v in enumerate(vps)]
        txt = (head.replace("{title}", f"Atlas camera label test ({name})") +
               '    <NavigationInfo type=\'"NONE"\' transitionType=\'"TELEPORT"\' headlight="false"/>\n    <Background skyColor="0 0 0"/>\n    ' +
               "\n    ".join(vlist) + "\n    " + "\n    ".join(shapes) + "\n" + tail)
        (W / f"labels-{name}.x3d").write_text(txt)
    label_world("correct")
    # mutant viewpoints, for the X_ITE test (build/shots.mjs)
    mv = []
    for i, (c, v) in enumerate(zip(cams, vps)):
        mv.append(ax.viewpoint_xml(dict(v, fieldOfView=c.hfov), f"Atlas camera {i}", f"Cam{i}"))
    label_world("fov-horizontal", mv)
    mv = []
    for i, (c, v) in enumerate(zip(cams, vps)):
        q = c.q_rub * np.array([-1, -1, -1, 1])     # conjugate: world-to-camera read as camera-to-world
        mv.append(ax.viewpoint_xml(dict(v, orientation=list(ax.q_to_axis_angle(q))), f"Atlas camera {i}", f"Cam{i}"))
    label_world("pose-inverted", mv)
    mv = []
    for i, (c, v) in enumerate(zip(cams, vps)):
        q = ax.q_mul(c.q_rub, ax.QX_PI)            # rdf pose passed through without the axis flip
        mv.append(ax.viewpoint_xml(dict(v, orientation=list(ax.q_to_axis_angle(q))), f"Atlas camera {i}", f"Cam{i}"))
    label_world("rdf-unconverted", mv)

    # ---------------------------------------------------------------- 6. validation (x3d_mcp XSD)
    sha = subprocess.run(["git", "-C", str(X3D_MCP), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    sys.path.insert(0, str(X3D_MCP / "src"))
    from validation.validate import validate_xml   # noqa: E402
    vres = {}
    for f in sorted(W.glob("*.x3d")):
        r = validate_xml(f.read_text())
        vres[f.name] = {"valid": bool(r.get("valid")), "errors": len(r.get("errors", [])), "first": (r.get("errors") or [None])[0],
                        "bytes": f.stat().st_size}
    note("validation", vres, f"hagopjay/x3d_mcp {sha} src/validation/validate.py validate_xml, bundled X3D 4.1 XSD")
    note("build_seconds", round(time.time() - t0, 1), f"wall clock, {platform.machine()}, Python {platform.python_version()}")
    R.mkdir(exist_ok=True)
    (R / "numbers.json").write_text(json.dumps(N, indent=1, default=str))
    print(json.dumps({k: N[k]["value"] for k in N if k not in ("viewpoints",)}, indent=1, default=str)[:6000])


if __name__ == "__main__":
    main()
