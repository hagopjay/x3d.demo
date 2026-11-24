#!/usr/bin/env python3
"""import_world: the return trip, Atlas -> X3D. Writes worlds/<slug>-atlas.x3d (X3D 4.1) from what Atlas sent back:
  cameras   -> Viewpoint (and compared with the Viewpoints that were sent)
  splats    -> GaussianSplats: an inline preview (random sample, stated) + MetadataString splatFile naming the SPZ
  mesh GLB  -> Inline (hidden by default)
  colliders -> Collision with proxy Boxes
  the X3D blockout the trip started from -> Inline (hidden by default), so one file holds both ends
and receipts/<slug>-return.json with the round-trip numbers.
usage: import_world.py <slug> --views dirA,dirB --spz FILE [--mesh GLB] [--colliders GLB] [--preview 30000] [--out NAME]"""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "kit"))
import atlas2x3d as A, x3dcast

ap = argparse.ArgumentParser(); ap.add_argument("slug"); ap.add_argument("--views", required=True); ap.add_argument("--spz", required=True); ap.add_argument("--mesh"); ap.add_argument("--colliders")
ap.add_argument("--preview", type=int, default=30000); ap.add_argument("--preview-scale", type=float, default=0.0); ap.add_argument("--out"); ap.add_argument("--blockout", default=None)
a = ap.parse_args()
out = HERE / "out" / a.slug; name = a.out or f"{a.slug}-atlas"; dest = HERE / "worlds" / f"{name}.x3d"
src_world = HERE / "worlds" / f"{a.slug}.x3d"; has_src = src_world.exists()
R = {"slug": a.slug, "world": dest.name, "operations": {}, "cameras": {}, "splats": {}, "mesh": None, "colliders": None}
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

# ---- cameras: what Atlas returned, as Viewpoints; and how far they are from the Viewpoints that were sent
import x3dmesh
MESH_WORLD = has_src and not x3dcast.load_x3d(src_world)[0]         # a world of meshes (Blender export), not primitives
sent = (sorted(x3dmesh.load_viewpoints(src_world), key=lambda v: v["description"]) if MESH_WORLD else x3dcast.load_viewpoints(src_world)) if has_src else []
vps, worst_p, worst_r, worst_f = [], 0.0, 0.0, 0.0
for d in a.views.split(","):
    op = json.loads((out / d / "operation.json").read_text()); R["operations"][d] = op.get("id")
    idx = [int(p.stem.split("-")[-1]) for p in sorted((out / d).glob("view-*"))]
    for k, f in enumerate(op["response"]["frames"]):
        cam = A.parse_camera(f["camera"]); vp = A.camera_to_viewpoint(cam); i = idx[k]
        desc = f"Atlas view {i:02d}"
        if i < len(sent) and has_src:
            s = sent[i]; desc = f"Atlas view {i:02d}: {s['description']}"
            dp = float(np.linalg.norm(np.array(s["position"]) - cam.position))
            qa = A.q_norm(__import__("x3d2atlas").axis_angle_to_q(s["orientation"])); dot = abs(float(np.dot(qa, cam.q_rub)))
            dr = float(np.degrees(2 * np.arccos(min(1.0, dot)))); df = abs(s["fieldOfView"] - vp["fieldOfView"])
            worst_p, worst_r, worst_f = max(worst_p, dp), max(worst_r, dr), max(worst_f, df)
        vps.append((i, desc, vp))
vps.sort(key=lambda t: t[0])
R["cameras"] = {"count": len(vps), "compared_with_sent": bool(sent), "worst_position_diff_m": worst_p, "worst_rotation_diff_deg": worst_r, "worst_fieldOfView_diff_rad": worst_f}

# ---- splats
S, hdr = A.read_spz_any(a.spz); n = len(S.positions)
R["splats"] = {"file": Path(a.spz).name, "sha256": sha(a.spz), "bytes": Path(a.spz).stat().st_size, "spz_version": hdr["version"], "count": n, "sh_degree": hdr["sh_degree"],
               "bbox_min": S.positions.min(0).round(3).tolist(), "bbox_max": S.positions.max(0).round(3).tolist()}
if has_src:
    prims, _ = x3dcast.load_x3d(src_world)
    rng = np.random.default_rng(1); sel = rng.choice(n, min(n, 120000), replace=False)
    P = S.positions[sel]
    if MESH_WORLD:
        tv, tf, _, _ = x3dmesh.load_triangles(src_world)
        dist, who = x3dmesh.MeshDistance(tv, tf)(P)
    else:
        dist, who = x3dcast.surface_distance(prims, P)
    w = S.alpha[sel]                                             # what the eye sees: weight by opacity
    order = np.argsort(dist); cw = np.cumsum(w[order]) / w.sum()
    R["splats"]["vs_x3d_surfaces"] = {"sample": int(len(sel)), "median_mm": float(1000 * np.median(dist)), "p90_mm": float(1000 * np.percentile(dist, 90)),
                                      "within_20mm_pct": float(100 * (dist < 0.02).mean()), "within_50mm_pct": float(100 * (dist < 0.05).mean()), "within_100mm_pct": float(100 * (dist < 0.1).mean()),
                                      "opacity_weighted_median_mm": float(1000 * dist[order][np.searchsorted(cw, 0.5)]), "method": ("exact distance from splat centre to the nearest triangle of the X3D file the Blender add-on wrote (BVH)" if MESH_WORLD else "exact distance from splat centre to the nearest X3D Box, Cylinder or Sphere surface")}
rng = np.random.default_rng(7); m = min(a.preview, n); keep = np.sort(rng.choice(n, m, replace=False))
grow = a.preview_scale or float(min(3.0, (n / m) ** (1 / 3)))    # fewer splats must each cover more, or the preview is a mist
prev = A.Splats(S.positions[keep], S.scales[keep] * grow, S.quats[keep], S.alpha[keep], S.rgb[keep])
R["splats"]["preview"] = {"count": m, "pick": "uniform random, seed 7", "scale_factor": round(grow, 4)}

# ---- mesh and colliders
parts_mesh = parts_col = ""
if a.mesh:
    g, _ = A.read_glb(a.mesh)
    R["mesh"] = {"file": Path(a.mesh).name, "sha256": sha(a.mesh), "bytes": Path(a.mesh).stat().st_size, "meshes": len(g.get("meshes", [])), "nodes": len(g.get("nodes", [])),
                 "vertices": int(sum(g["accessors"][p["attributes"]["POSITION"]]["count"] for me in g.get("meshes", []) for p in me["primitives"])),
                 "images": len(g.get("images", []))}
    mx = A.mesh_to_x3d(a.mesh, HERE / "worlds" / f"{name}-mesh.x3d", f"{name}-mesh.png", f"{name}: Atlas mesh as X3D")
    R["mesh"]["as_x3d"] = mx
    try:
        sys.path.insert(0, "/home/user/x3d_mcp/src"); from validation.validate import validate_xml as _v
        vr = _v((HERE / "worlds" / mx["x3d"]).read_text()); R["mesh"]["as_x3d"]["valid"] = bool(vr.get("valid") if isinstance(vr, dict) else getattr(vr, "valid", None))
    except Exception as e:
        R["mesh"]["as_x3d"]["valid"] = None; R["mesh"]["as_x3d"]["validator_error"] = repr(e)[:200]
    parts_mesh = f'    <Group DEF="AtlasMesh" visible="false">\n      <Inline DEF="AtlasMeshFile" load="false" url=\'"{mx["x3d"]}"\'/>\n    </Group>\n'
if a.colliders:
    boxes = A.collider_boxes(a.colliders)
    R["colliders"] = {"file": Path(a.colliders).name, "sha256": sha(a.colliders), "boxes": len(boxes), "all_upright": all(b["yaw_only"] for b in boxes)}
    parts_col = "    " + A.collision_xml(boxes, "AtlasColliders") + "\n"
    (HERE / "receipts").mkdir(exist_ok=True); (out / f"{name}-boxes.json").write_text(json.dumps(boxes))

# ---- the X3D file
esc = lambda s: str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
ops = "; ".join(f"{k}={v}" for k, v in R["operations"].items())
head = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.1//EN" "https://www.web3d.org/specifications/x3d-4.1.dtd">
<X3D version="4.1" profile="Immersive" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.1.xsd">
  <head>
    <component name="GaussianSplats" level="1"/>
    <meta name="title" content="{esc(name)}: the Atlas return trip in X3D"/>
    <meta name="generator" content="x3d.demo atlas-bridge/v1 build/import_world.py"/>
    <meta name="atlas.operations" content="{esc(ops)}"/>
    <meta name="atlas.splatFile" content="{Path(a.spz).name}; sha256 {R["splats"]["sha256"]}; {n} splats; SPZ v{hdr["version"]}"/>
    <meta name="atlas.preview" content="GaussianSplats holds {m} of {n} splats inline (uniform random, seed 7, scales x {grow:.4f}); the node's MetadataString splatFile names the full set"/>
    <meta name="atlas.frame" content="Three.js / X3D: +X right, +Y up, -Z forward; camera-to-world poses, rub; identity wrapper, measured"/>
    <meta name="rights" content="Pictures, splats, mesh and colliders are World Labs Atlas outputs made on Developer signup credits: owned by World Labs, licensed for personal non-commercial use (Terms 2.3a). The X3D blockout and this file's structure are the author's."/>
  </head>
  <Scene>
    <WorldInfo title="{esc(name)}" info='"X3D blockout to World Labs Atlas and back"'/>
    <NavigationInfo type='"EXAMINE" "FLY" "ANY"' headlight="true" speed="2"/>
    <Background skyColor="0.02 0.02 0.03"/>
'''
body = "".join("    " + A.viewpoint_xml(vp, esc(desc), f"AtlasCam{i:02d}").replace('centerOfRotation="0 0.8 -3"', 'centerOfRotation="0 1.2 0"') + "\n" for i, desc, vp in vps)
if has_src:
    body += f'    <Group DEF="X3DBlockout" visible="false">\n      <Inline DEF="BlockoutFile" load="false" url=\'"{a.blockout or src_world.name}"\'/>\n    </Group>\n'
sx = A.splats_xml(prev, "AtlasSplats")
meta = (f'\n      <MetadataString containerField="metadata" name="splatFile" value=\'"{Path(a.spz).name}"\'/>\n    </GaussianSplats>')
assert sx.rstrip().endswith("/>")
body += "    " + sx.rstrip()[:-2] + ">" + meta + "\n" + parts_mesh + parts_col
dest.write_text(head + body + "  </Scene>\n</X3D>\n")
R["x3d"] = {"file": dest.name, "bytes": dest.stat().st_size, "sha256": sha(dest), "viewpoints": len(vps)}

sys.path.insert(0, "/home/user/x3d_mcp/src")
try:
    from validation.validate import validate_xml
    v = validate_xml(dest.read_text()); R["x3d"]["valid"] = bool(getattr(v, "valid", None) if not isinstance(v, dict) else v.get("valid")); R["x3d"]["validator"] = "hagopjay/x3d_mcp 4d433af validate_xml, bundled X3D 4.1 XSD"
    errs = getattr(v, "errors", None) if not isinstance(v, dict) else v.get("errors"); R["x3d"]["errors"] = [str(e)[:300] for e in (errs or [])][:8]
except Exception as e:
    R["x3d"]["valid"] = None; R["x3d"]["validator_error"] = repr(e)[:300]
(HERE / "receipts" / f"{name}-return.json").write_text(json.dumps(R, indent=1))
print(json.dumps(R, indent=1))
