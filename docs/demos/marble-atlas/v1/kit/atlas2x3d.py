#!/usr/bin/env python3
"""atlas2x3d: World Labs Atlas (and Marble) outputs -> X3D 4.1, offline, zero API calls.

Demo 76, x3d.demo docs/demos/marble-atlas/v1. Written 23 Nov 2026 against the Atlas Developer API docs
fetched that day (docs.atlas.worldlabs.ai, llms.txt sha256 af08fdd9...) and the Apache-2.0 worldlabsai/skills
repo at 6cdb6b9 (12 Nov 2026). This module never talks to any network service.

What it bridges (each function names the Atlas doc it follows):

  camera_to_viewpoint   Atlas camera {intrinsics, extrinsics(rub|rdf)}      -> X3D Viewpoint (+ frustum lines)
                        "cameras-and-posed-images.md": pose is camera-to-world, quaternion XYZW,
                        rub = right/up/back (X3D's own camera axes), rdf = OpenCV. World is Y-up.
  unproject             posed RGBD frame (RGB + linear-depth EXR + confidence) -> world points
                        point at pixel (u, v), depth z = ((u-cx)/fx z, -(v-cy)/fy z, -z) in RUB camera axes.
                        NaN / 0 / negative / inf depth = no surface.  Rows run top to bottom.
  points_x3d            fused points -> X3D PointSet (Coordinate + Color)
  splats_x3d            points or decoded SPZ -> X3D 4.1 GaussianSplats arrays (orientations x y z w)
  read_spz / write_spz  SPZ v2 (gzip, 24-bit fixed point), as posedImages2Splats returns
  collider_glb_x3d      splats2Mesh colliderBoxes GLB (one node per box sharing one cube, yaw-only)
                        -> X3D Collision proxy of Transform + Box, cube size read from the accessor bounds
  mesh_inline_x3d       splats2Mesh mesh GLB -> X3D Inline (X_ITE reads glb)

Frame decision (the one Marble lesson that changes): Marble's raw API splats are OpenCV y-DOWN and need the
Rx(pi) wrapper (x3d.loom docs/MARBLE-SPLATS.md rule 1).  Atlas states every pose, region and anchor "in Three.js
coordinates (+X right, +Y up, -Z forward)", which is X3D's frame, so the Atlas wrapper is the identity.  That is
graded L (docs) for SPZ files, because no Atlas SPZ has been measured here (no spend); camera poses are graded C
by the label-agreement test in build/run_all.py.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

VERSION = "1.0.0"
PI = math.pi
ATLAS_GRIDS = {(1280, 720), (720, 1280), (960, 720), (528, 704)}   # posed-images-to-splats.md


# ------------------------------------------------------------------------------------------------ quaternions
def q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz])


def q_norm(q):
    q = np.asarray(q, dtype=np.float64)
    n = np.linalg.norm(q)
    if not np.isfinite(n) or n < 1e-12:
        raise ValueError("quaternion has zero or non-finite length")
    return q / n


def q_to_matrix(q):
    x, y, z, w = q_norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def q_to_axis_angle(q):
    """XYZW quaternion -> X3D SFRotation (axis x y z, angle), angle in [0, pi]."""
    x, y, z, w = q_norm(q)
    if w < 0:
        x, y, z, w = -x, -y, -z, -w
    s = math.sqrt(max(0.0, 1 - w * w))
    angle = 2 * math.atan2(s, w)
    if s < 1e-9:
        return (0.0, 0.0, 1.0, 0.0)
    return (x / s, y / s, z / s, angle)


QX_PI = np.array([1.0, 0.0, 0.0, 0.0])      # 180 degrees about local X: rdf <-> rub camera axes


# ------------------------------------------------------------------------------------------------ cameras
@dataclass
class AtlasCamera:
    position: np.ndarray       # world, camera-to-world
    q_rub: np.ndarray          # XYZW, camera axes right/up/back (X3D's)
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    source_system: str

    @property
    def R(self):
        return q_to_matrix(self.q_rub)

    @property
    def hfov(self):
        return 2 * math.atan(self.width / (2 * self.fx))

    @property
    def vfov(self):
        return 2 * math.atan(self.height / (2 * self.fy))


def parse_camera(cam: dict, *, strict: bool = True) -> AtlasCamera:
    """Parse an Atlas camera. Rejects what the API rejects: distortion fields (422), unknown systems, bad grids."""
    intr, ext = cam["intrinsics"], cam["extrinsics"]
    extra = set(intr) - {"fx", "fy", "cx", "cy", "width", "height"}
    if strict and extra:
        raise ValueError(f"camera intrinsics carry fields Atlas rejects (HTTP 422): {sorted(extra)}")
    system = ext.get("coordinateSystem", ext.get("coordinate_system"))
    if system not in ("rub", "rdf"):
        raise ValueError(f"coordinateSystem must be rub or rdf, got {system!r}")
    q = q_norm(ext["quaternion"])
    q_rub = q if system == "rub" else q_mul(q, QX_PI)    # R_rub = R_rdf * Rx(pi): flip local y and z
    pos = np.asarray(ext["position"], dtype=np.float64)
    if pos.shape != (3,) or not np.all(np.isfinite(pos)):
        raise ValueError("camera position must be 3 finite numbers")
    w, h = int(intr["width"]), int(intr["height"])
    for k in ("fx", "fy"):
        if not (float(intr[k]) > 0):
            raise ValueError(f"{k} must be positive pixels")
    return AtlasCamera(pos, q_rub, float(intr["fx"]), float(intr["fy"]), float(intr["cx"]), float(intr["cy"]), w, h, system)


def camera_to_viewpoint(cam: AtlasCamera) -> dict:
    """X3D Viewpoint fields. X3D fieldOfView spans the SMALLER display dimension (ISO/IEC 19775-1, 23.4.6),
    so a landscape Atlas camera gives the vertical angle, a portrait one the horizontal angle.
    X3D has no principal-point shift: the offset is reported, not silently dropped."""
    fov = cam.vfov if cam.width >= cam.height else cam.hfov
    ax = q_to_axis_angle(cam.q_rub)
    return {
        "position": cam.position.tolist(),
        "orientation": list(ax),
        "fieldOfView": fov,
        "principal_offset_px": [cam.cx - cam.width / 2, cam.cy - cam.height / 2],
        "square_pixels": abs(cam.fx - cam.fy) < 1e-6 * cam.fx,
        "grid": [cam.width, cam.height],
        "atlas_grid": (cam.width, cam.height) in ATLAS_GRIDS,
    }


def frustum_corners(cam: AtlasCamera, depth: float) -> np.ndarray:
    """World-space image-corner points at planar depth `depth` (top-left, top-right, bottom-right, bottom-left)."""
    px = [(0, 0), (cam.width, 0), (cam.width, cam.height), (0, cam.height)]
    pts = [((u - cam.cx) / cam.fx * depth, -(v - cam.cy) / cam.fy * depth, -depth) for u, v in px]
    return cam.position + (cam.R @ np.array(pts).T).T


# ------------------------------------------------------------------------------------------------ RGBD
def read_exr_depth(path) -> np.ndarray:
    """One-channel float EXR, rows top to bottom (OpenEXR scanline order, as Atlas writes it)."""
    import OpenEXR   # optional dependency, only for real EXR files
    with OpenEXR.File(str(path)) as f:
        ch = f.channels()
        name = next(iter(ch))
        return np.asarray(ch[name].pixels, dtype=np.float32)


def valid_depth(depth: np.ndarray) -> np.ndarray:
    """Atlas: NaN, 0, negative and infinite depth all mean "no surface" (skills conventions.md)."""
    return np.isfinite(depth) & (depth > 0)


def unproject(depth: np.ndarray, cam: AtlasCamera, *, stride: int = 1, pixel_center: float = 0.5,
              confidence: np.ndarray | None = None, min_conf: int = 0, rows_bottom_up: bool = False):
    """Planar depth -> world points. Returns (points[n,3], (row, col) index arrays) for the kept pixels.
    `rows_bottom_up=True` is for arrays decoded by three.js EXRLoader (it flips rows for WebGL)."""
    h, w = depth.shape
    if (w, h) != (cam.width, cam.height):
        raise ValueError(f"depth grid {w}x{h} does not match the camera grid {cam.width}x{cam.height}")
    d = depth[::-1] if rows_bottom_up else depth
    rr, cc = np.mgrid[0:h:stride, 0:w:stride]
    z = d[rr, cc].astype(np.float64)
    keep = valid_depth(z)
    if confidence is not None:
        keep &= confidence[rr, cc] > min_conf
    rr, cc, z = rr[keep], cc[keep], z[keep]
    u, v = cc + pixel_center, rr + pixel_center
    pc = np.stack([(u - cam.cx) / cam.fx * z, -(v - cam.cy) / cam.fy * z, -z], axis=1)
    return cam.position + pc @ cam.R.T, (rr, cc)


# ------------------------------------------------------------------------------------------------ SPZ v2
COLOR_SCALE = 0.15
SH_C0 = 0.28209479177387814


@dataclass
class Splats:
    positions: np.ndarray   # (n,3)
    scales: np.ndarray      # (n,3) linear std-dev
    quats: np.ndarray       # (n,4) xyzw
    alpha: np.ndarray       # (n,)
    rgb: np.ndarray         # (n,3) display colour 0..1


def write_spz(path, s: Splats, fractional_bits: int = 12) -> dict:
    n = len(s.positions)
    fixed = np.round(s.positions * (1 << fractional_bits)).astype(np.int64)
    if np.any(np.abs(fixed) >= (1 << 23)):
        raise ValueError("position outside the 24-bit SPZ range for these fractional bits")
    fixed &= 0xFFFFFF
    pb = np.stack([fixed & 255, (fixed >> 8) & 255, (fixed >> 16) & 255], axis=2).astype(np.uint8).reshape(n, 9)
    ab = np.clip(np.round(s.alpha * 255), 0, 255).astype(np.uint8)
    f_dc = (s.rgb - 0.5) / SH_C0
    cb = np.clip(np.round((f_dc * COLOR_SCALE + 0.5) * 255), 0, 255).astype(np.uint8)
    sb = np.clip(np.round((np.log(s.scales) + 10.0) * 16.0), 0, 255).astype(np.uint8)
    q = s.quats / np.linalg.norm(s.quats, axis=1, keepdims=True)
    q = np.where(q[:, 3:4] < 0, -q, q)
    rb = np.clip(np.round(q[:, :3] * 127.5 + 127.5), 0, 255).astype(np.uint8)
    body = struct.pack("<IIIBBBB", 0x5053474E, 2, n, 0, fractional_bits, 0, 0)
    body += pb.tobytes() + ab.tobytes() + cb.tobytes() + sb.tobytes() + rb.tobytes()
    Path(path).write_bytes(gzip.compress(body, mtime=0))
    return {"version": 2, "splats": n, "sh_degree": 0, "fractional_bits": fractional_bits, "flags": 0}


def read_spz(path) -> tuple[Splats, dict]:
    raw = gzip.decompress(Path(path).read_bytes())
    magic, ver, n, shd, fb, flags, _ = struct.unpack_from("<IIIBBBB", raw, 0)
    if magic != 0x5053474E:
        raise ValueError("not an SPZ file")
    if ver != 2:
        raise ValueError(f"SPZ v{ver}: this demo reads v2 only (Marble scout decoder reads v3; v4 unproven)")
    off = 16

    def take(k):
        nonlocal off
        a = np.frombuffer(raw, np.uint8, k, off)
        off += k
        return a
    p = take(n * 9).reshape(n, 3, 3).astype(np.int32)
    fx = p[..., 0] | (p[..., 1] << 8) | (p[..., 2] << 16)
    fx = np.where(fx & 0x800000, fx - (1 << 24), fx)
    pos = fx / float(1 << fb)
    alpha = take(n) / 255.0
    f_dc = (take(n * 3).reshape(n, 3) / 255.0 - 0.5) / COLOR_SCALE
    scales = np.exp(take(n * 3).reshape(n, 3) / 16.0 - 10.0)
    xyz = take(n * 3).reshape(n, 3) / 127.5 - 1.0
    w = np.sqrt(np.clip(1 - np.sum(xyz * xyz, axis=1), 0, 1))
    q = np.concatenate([xyz, w[:, None]], axis=1)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    hdr = {"version": ver, "splats": n, "sh_degree": shd, "fractional_bits": fb, "flags": flags}
    return Splats(pos, scales, q, alpha, np.clip(0.5 + SH_C0 * f_dc, 0, 1)), hdr


# ------------------------------------------------------------------------------------------------ GLB
def read_glb(path) -> tuple[dict, bytes]:
    b = Path(path).read_bytes()
    magic, ver, length = struct.unpack_from("<III", b, 0)
    if magic != 0x46546C67 or ver != 2:
        raise ValueError("not a glTF 2.0 binary")
    jlen, jtype = struct.unpack_from("<II", b, 12)
    gltf = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    binchunk = b""
    if off < len(b):
        blen, _ = struct.unpack_from("<II", b, off)
        binchunk = b[off + 8: off + 8 + blen]
    return gltf, binchunk


def collider_boxes(path) -> list[dict]:
    """splats2Mesh colliderBoxes GLB: "one node per box sharing one cube, in the same coordinates as mesh";
    boxes "stay upright, turning only about the vertical axis". The cube's size is read from its POSITION
    accessor min/max, so a unit (+-0.5) or a +-1 cube both come out right."""
    g, _ = read_glb(path)
    boxes = []
    for node in g.get("nodes", []):
        if "mesh" not in node:
            continue
        if "matrix" in node:
            raise ValueError("matrix nodes are not expected in a collider-box GLB; TRS only")
        prim = g["meshes"][node["mesh"]]["primitives"][0]
        acc = g["accessors"][prim["attributes"]["POSITION"]]
        lo, hi = np.array(acc["min"]), np.array(acc["max"])
        s = np.array(node.get("scale", [1, 1, 1]), dtype=float)
        q = node.get("rotation", [0, 0, 0, 1])
        yaw_only = abs(q[0]) < 1e-6 and abs(q[2]) < 1e-6
        center_local = (lo + hi) / 2
        R = q_to_matrix(q)
        t = np.array(node.get("translation", [0, 0, 0]), dtype=float) + R @ (center_local * s)
        boxes.append({"name": node.get("name", ""), "translation": t.tolist(), "rotation": list(q_to_axis_angle(q)),
                      "size": ((hi - lo) * s).tolist(), "yaw_only": yaw_only})
    return boxes


# ------------------------------------------------------------------------------------------------ X3D text
def f3(v, fmt="%.4f"):
    return " ".join(fmt % x for x in v)


def mf(a, fmt="%.4f"):
    a = np.asarray(a).reshape(len(a), -1)
    return ", ".join(" ".join(fmt % x for x in row) for row in a)


def viewpoint_xml(vp: dict, desc: str, DEF: str) -> str:
    o = vp["orientation"]
    return (f'<Viewpoint DEF="{DEF}" description="{desc}" position="{f3(vp["position"])}" '
            f'orientation="{o[0]:.6f} {o[1]:.6f} {o[2]:.6f} {o[3]:.6f}" fieldOfView="{vp["fieldOfView"]:.6f}" '
            f'centerOfRotation="0 0.8 -3"/>')


def frustum_xml(cam: AtlasCamera, depth: float, rgb: str, DEF: str) -> str:
    c = frustum_corners(cam, depth)
    pts = np.vstack([cam.position, c])
    idx = "0 1 -1 0 2 -1 0 3 -1 0 4 -1 1 2 3 4 1 -1"
    return (f'<Shape DEF="{DEF}"><Appearance><Material emissiveColor="{rgb}" diffuseColor="0 0 0"/></Appearance>'
            f'<IndexedLineSet coordIndex="{idx}"><Coordinate point="{mf(pts)}"/></IndexedLineSet></Shape>')


def points_xml(pts: np.ndarray, rgb: np.ndarray, DEF: str, point_size: float = 2.0) -> str:
    return (f'<Shape DEF="{DEF}"><Appearance><PointProperties pointSizeScaleFactor="{point_size:g}"/></Appearance>'
            f'<PointSet><Coordinate point="{mf(pts, "%.3f")}"/><Color color="{mf(rgb, "%.3f")}"/></PointSet></Shape>')


def splats_xml(s: Splats, DEF: str) -> str:
    f_dc = (s.rgb - 0.5) / SH_C0
    return (f'<GaussianSplats DEF="{DEF}" castShadow="false" pointerEvents="false"\n'
            f'  positions="{mf(s.positions, "%.4f")}"\n'
            f'  scales="{mf(s.scales, "%.5g")}"\n'
            f'  orientations="{mf(s.quats, "%.4f")}"\n'
            f'  opacities="{" ".join("%.3f" % a for a in s.alpha)}"\n'
            f'  sphericalHarmonicsDegree0Coef0="{mf(f_dc, "%.4f")}"/>')


def collision_xml(boxes: list[dict], DEF: str, show: bool = True) -> str:
    parts = []
    for i, b in enumerate(boxes):
        r = b["rotation"]
        parts.append(f'<Transform DEF="{DEF}_{i}" translation="{f3(b["translation"])}" '
                     f'rotation="{r[0]:.6f} {r[1]:.6f} {r[2]:.6f} {r[3]:.6f}">'
                     f'<Shape><Appearance><Material diffuseColor="0.1 0.9 0.6" transparency="0.75"/></Appearance>'
                     f'<Box size="{f3(b["size"])}"/></Shape></Transform>')
    proxy = "\n      ".join(parts)
    return f'<Collision DEF="{DEF}" enabled="true"><Group containerField="proxy">\n      {proxy}\n    </Group></Collision>'


def sha256_file(p) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()
