#!/usr/bin/env python3
"""x3d2atlas: X3D -> World Labs Atlas requests. The forward half of the bridge; atlas2x3d.py is the return half.

  viewpoint_to_camera   X3D Viewpoint -> Atlas camera {intrinsics, extrinsics}. X3D's camera axes are already
                        Atlas "rub" (right, up, back; looks along -Z) in a Y-up world, so position and rotation
                        pass through unchanged; only the SFRotation becomes an XYZW quaternion and fieldOfView
                        (the angle across the SMALLER side, ISO/IEC 19775-1 23.4.6) becomes pixel focal lengths.
  write_depth_exr       planar depth -> the EXR Atlas itself writes (one channel "Y", ZIP, rows top-down);
                        0 = no surface (depth-guided-generation.md "Mark sky and empty space").
  node_mask             a keep/edit mask for atlasChisel from X3D node names: white = keep, black = repaint.
  chisel_request / generate_request / splats_request   request bodies in the documented shapes.
  path_cameras          an X3D camera path (key Viewpoints, Catmull-Rom position, slerp orientation) -> targetCameras.
"""
from __future__ import annotations

import math

import numpy as np

import atlas2x3d as A

GRIDS = {(1280, 720), (720, 1280), (960, 720), (528, 704)}     # atlas-generate.md target sizes


def axis_angle_to_q(ax):
    x, y, z, a = ax
    n = math.sqrt(x * x + y * y + z * z)
    if n < 1e-12:
        return np.array([0.0, 0.0, 0.0, 1.0])
    s = math.sin(a / 2) / n
    return A.q_norm([x * s, y * s, z * s, math.cos(a / 2)])


def viewpoint_to_camera(vp: dict, width=1280, height=720) -> dict:
    if (width, height) not in GRIDS:
        raise ValueError(f"{width}x{height} is not an Atlas grid")
    fov = float(vp["fieldOfView"])
    if not 0 < fov < math.pi:
        raise ValueError("fieldOfView must be in (0, pi)")
    f = (min(width, height) / 2) / math.tan(fov / 2)             # square pixels: one focal length
    q = axis_angle_to_q(vp["orientation"])
    return {"extrinsics": {"position": [float(v) for v in vp["position"]], "quaternion": [float(v) for v in q], "coordinateSystem": "rub"},
            "intrinsics": {"fx": f, "fy": f, "cx": width / 2, "cy": height / 2, "width": width, "height": height}}


def write_depth_exr(path, depth: np.ndarray):
    import OpenEXR
    d = np.ascontiguousarray(depth, dtype=np.float32)
    d = np.where(np.isfinite(d) & (d > 0), d, 0).astype(np.float32)
    OpenEXR.File({"compression": OpenEXR.ZIP_COMPRESSION, "type": OpenEXR.scanlineimage}, {"Y": d}).write(str(path))


def node_mask(ids: np.ndarray, names: list[str], edit, grow: int = 0) -> np.ndarray:
    """uint8 mask, 255 where the frame is known (keep), 0 where the model may repaint. `edit(name) -> bool`
    picks the X3D nodes to repaint; `grow` dilates the edit region by that many pixels."""
    sel = np.array([bool(edit(n)) for n in names] + [False])
    m = sel[ids]
    for _ in range(grow):
        p = np.pad(m, 1)
        m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return np.where(m, 0, 255).astype(np.uint8)


def chisel_request(frames: list[dict], prompt: str, *, return_depth=True, enhance=False, seed=7, context=None) -> dict:
    """frames: [{camera, depthAsset?, imageAsset?, maskAsset?}] with asset ids. Every optional part must be on
    all frames or none (HTTP 422 otherwise); the rollout budget is 4 views per conditioned target, 128 in all."""
    for key in ("depthAsset", "imageAsset", "maskAsset"):
        have = [key in f for f in frames]
        if any(have) and not all(have):
            raise ValueError(f"{key} must be on every target frame or none")
    budget = sum(4 if ("depthAsset" in f or "imageAsset" in f) else 1 for f in frames) + len(context or [])
    if budget > 128:
        raise ValueError(f"rollout budget {budget} > 128 views")
    if return_depth and len(frames) < 2:
        raise ValueError("returnDepth needs at least 2 target cameras")
    tf = []
    for f in frames:
        t = {"camera": f["camera"]}
        if "depthAsset" in f:
            t["depth"] = {"depthAsset": {"assetId": f["depthAsset"]}}
        if "imageAsset" in f:
            t["imageAsset"] = {"assetId": f["imageAsset"]}
        if "maskAsset" in f:
            t["maskAsset"] = {"assetId": f["maskAsset"]}
        tf.append(t)
    body = {"targetFrames": tf, "prompt": prompt, "enhancePrompt": bool(enhance), "returnDepth": bool(return_depth),
            "modelParameters": {"seed": int(seed)}}
    if context:
        body["contextFrames"] = [{"imageAsset": {"assetId": c["imageAsset"]}, "camera": c["camera"]} for c in context]
    return body


def generate_request(context: list[dict], targets: list[dict], prompt: str | None, *, return_depth=True, enhance=False) -> dict:
    body = {"contextFrames": [{"imageAsset": {"assetId": c["imageAsset"]}, "depth": {"depthAsset": {"assetId": c["depthAsset"]}}, "camera": c["camera"]} for c in context],
            "targetCameras": targets, "returnDepth": bool(return_depth), "enhancePrompt": bool(enhance)}
    if prompt:
        body["prompt"] = prompt
    return body


def splats_request(frames: list[dict], *, refine: bool, prompt: str | None = None) -> dict:
    lim = 512 if refine else 32
    if not 2 <= len(frames) <= lim:
        raise ValueError(f"posedImages2Splats takes 2 to {lim} frames here, got {len(frames)}")
    grids = {(f["camera"]["intrinsics"]["width"], f["camera"]["intrinsics"]["height"]) for f in frames}
    if len(grids) != 1 or not grids <= GRIDS:
        raise ValueError(f"all frames must share one Atlas grid, got {grids}")
    body = {"posedFrames": [{"imageAsset": {"assetId": f["imageAsset"]}, "depth": {"depthAsset": {"assetId": f["depthAsset"]}}, "camera": f["camera"]} for f in frames],
            "refine": bool(refine)}
    if prompt:
        body["prompt"] = prompt
        body["enhancePrompt"] = False
    return body


def _slerp(q0, q1, t):
    d = float(np.dot(q0, q1))
    if d < 0:
        q1, d = -q1, -d
    if d > 0.9995:
        return A.q_norm(q0 + t * (q1 - q0))
    th = math.acos(d)
    return (math.sin((1 - t) * th) * q0 + math.sin(t * th) * q1) / math.sin(th)


def path_cameras(keys: list[dict], n: int, width=1280, height=720) -> list[dict]:
    """n cameras along the key Viewpoints: centripetal-free uniform Catmull-Rom on position, slerp on orientation,
    linear on fieldOfView. The first and last cameras are the first and last keys."""
    P = np.array([k["position"] for k in keys], float)
    Q = [axis_angle_to_q(k["orientation"]) for k in keys]
    F = [k["fieldOfView"] for k in keys]
    out = []
    for i in range(n):
        s = i / (n - 1) * (len(keys) - 1)
        k = min(int(s), len(keys) - 2)
        t = s - k
        p0, p1, p2, p3 = P[max(k - 1, 0)], P[k], P[k + 1], P[min(k + 2, len(keys) - 1)]
        pos = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
        q = _slerp(Q[k], Q[k + 1], t)
        ax = A.q_to_axis_angle(q)
        out.append(viewpoint_to_camera({"position": pos.tolist(), "orientation": ax, "fieldOfView": F[k] + (F[k + 1] - F[k]) * t}, width, height))
    return out
