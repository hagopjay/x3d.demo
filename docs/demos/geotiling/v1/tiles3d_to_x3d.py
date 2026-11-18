#!/usr/bin/env python3
"""3D Tiles (1.0 / 1.1 tileset.json) -> X3D Geospatial. Every tile becomes a GeoLOD; its content becomes the GeoLOD root (GeoLocation + Inline of the .glb);
children become child1Url..child4Url; external tilesets (content .json) become a nested GeoLOD file. stdlib only.
  python3 -I tiles3d_to_x3d.py TILESET.json OUTDIR [--content-base REL_URL_FROM_OUTDIR_TO_TILESET_DIR] [--sse 16] [--screen 1080] [--fov 45] [--dry-run]
Mapping, SSE -> range: a tile is refined when geometricError * screenHeight / (distance * 2 tan(fov/2)) > maxSSE, so
range = geometricError * screenHeight / (2 tan(fov/2) * maxSSE)  (default 1080 px, 45 deg, 16 px -> x81.48).
Limits (grade S, not hidden): refine ADD is treated as REPLACE (warned); tiles with more than 4 children are chunked into extra GeoLOD levels
(GeoLOD has exactly four child slots); glTF content is placed by GeoLocation, assuming content is local-ENU as geotiling v1 writes it (Google's ECEF-baked glb is NOT re-framed here: untested, no tile bodies on hand)."""
import json, math, sys, pathlib, os
a_, f_ = 6378137.0, 1 / 298.257223563; e2 = f_ * (2 - f_)
def mat_mul(A, B):
    return [sum(A[k * 4 + r] * B[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]     # column-major 4x4
IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
def ecef_to_geodetic(X, Y, Z):
    if math.sqrt(X * X + Y * Y + Z * Z) < 1000: return 0.0, 0.0, 0.0       # box centred on the Earth's centre (Google's root): no geodetic position
    lon = math.atan2(Y, X); p = math.hypot(X, Y); lat = math.atan2(Z, p * (1 - e2))
    for _ in range(6):
        n = a_ / math.sqrt(1 - e2 * math.sin(lat) ** 2); h = p / math.cos(lat) - n; lat = math.atan2(Z, p * (1 - e2 * n / (n + h)))
    n = a_ / math.sqrt(1 - e2 * math.sin(lat) ** 2); return math.degrees(lat), math.degrees(lon), p / math.cos(lat) - n
def centre(node, M):
    bv = node["boundingVolume"]
    if "region" in bv:
        w, s, e, n, h0, h1 = bv["region"]; return math.degrees((s + n) / 2), math.degrees((w + e) / 2), (h0 + h1) / 2     # region is absolute: transform ignored (spec)
    c = bv["box"][:3] if "box" in bv else bv["sphere"][:3]
    X, Y, Z = (M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14])
    return ecef_to_geodetic(X, Y, Z)
def enu_relative_rotation(M, lat, lon):
    """Angle between the tile's local axes and the east-north-up basis at its centre (0 for tiles that are already ENU, as geotiling writes them)."""
    la, lo = math.radians(lat), math.radians(lon)
    E = (-math.sin(lo), math.cos(lo), 0); N = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    ex = (M[0], M[1], M[2]); n = math.sqrt(sum(v * v for v in ex)) or 1
    return math.degrees(math.acos(max(-1, min(1, sum(a * b for a, b in zip(ex, E)) / n))))
HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n <head><component name="Geospatial" level="1"/><meta name="title" content="{t}"/><meta name="generator" content="tiles3d_to_x3d.py (geotiling v1)"/></head>\n <Scene>\n{b}\n </Scene>\n</X3D>\n'
def convert(tileset_path, outdir, content_base=None, sse=16.0, screen=1080, fov=45.0, dry=False):
    tp = pathlib.Path(tileset_path); ts = json.loads(tp.read_text()); out = pathlib.Path(outdir); K = screen / (2 * math.tan(math.radians(fov / 2)) * sse)
    rel = content_base if content_base is not None else os.path.relpath(tp.parent, out).replace("\\", "/")
    stats = dict(tiles=0, with_content=0, glb=0, external_json=0, external_missing=0, add_refine=0, non_enu=0, chunked=0, bv=dict(), max_depth=0, ranges=[], version=ts.get("asset", {}).get("version"))
    files = {}
    def uri_of(node): return (node.get("content") or node.get("contents", [{}])[0] or {}).get("uri")
    def emit(node, M, depth, name):
        stats["tiles"] += 1; stats["max_depth"] = max(stats["max_depth"], depth); M = mat_mul(M, node.get("transform", IDENT))
        stats["bv"][next(iter(node["boundingVolume"]))] = stats["bv"].get(next(iter(node["boundingVolume"])), 0) + 1
        if node.get("refine") == "ADD": stats["add_refine"] += 1
        lat, lon, h = centre(node, M); ge = float(node.get("geometricError", 0)); ge = min(ge, 1e12)
        uri = uri_of(node); kids = list(node.get("children", [])); body = None
        if uri:
            stats["with_content"] += 1; u = uri.split("?")[0]
            if u.endswith(".json"):
                stats["external_json"] += 1; ext = tp.parent / u
                if ext.exists():
                    sub = json.loads(ext.read_text()); kids = [sub["root"]] + kids
                else: stats["external_missing"] += 1
            else:
                stats["glb"] += 1; ang = enu_relative_rotation(M, lat, lon); stats["non_enu"] += ang > 1e-3
                body = f'  <GeoLocation geoSystem=\'"GD" "WE"\' geoCoords="{lat:.7f} {lon:.7f} {h:.2f}"><Inline url=\'"{rel}/{u}"\'/></GeoLocation>'
        if len(kids) > 4:
            stats["chunked"] += 1; q = (len(kids) + 3) // 4; kids = [dict(boundingVolume=node["boundingVolume"], geometricError=ge, children=kids[i * q:(i + 1) * q], refine=node.get("refine")) for i in range(4) if kids[i * q:(i + 1) * q]]
        kfiles = []
        for i, k in enumerate(kids): kfiles.append(emit(k, M, depth + 1, f"{name}_{i}"))
        rng = min(ge * K, 1e10) if kids else 0; stats["ranges"].append(rng)
        if body is not None: files[f"{name}.mesh.x3d"] = HEAD.format(t=f"tile {name}", b=body)
        if kids:
            cu = " ".join(f'child{i + 1}Url=\'"{k}"\'' for i, k in enumerate(kfiles))
            root = f' rootUrl=\'"{name}.mesh.x3d"\'' if body is not None else ""
            files[f"{name}.x3d"] = HEAD.format(t=f"GeoLOD {name}", b=f'  <GeoLOD geoSystem=\'"GD" "WE"\' center="{lat:.6f} {lon:.6f} {h:.1f}" range="{rng:.1f}"{root} {cu}/>')
        elif body is not None: files[f"{name}.x3d"] = files.pop(f"{name}.mesh.x3d")
        else: files[f"{name}.x3d"] = HEAD.format(t=f"empty {name}", b="  <Group/>")
        return f"{name}.x3d"
    top = emit(ts["root"], IDENT, 0, "t"); stats["root_file"] = top; stats["K"] = K
    if not dry:
        out.mkdir(parents=True, exist_ok=True)
        for n, c in files.items(): (out / n).write_text(c, encoding="utf8")
    stats["files"] = len(files); stats["ranges"] = dict(min=min(stats["ranges"]), max=max(stats["ranges"]))
    return stats
if __name__ == "__main__":
    av = sys.argv[1:]; g = lambda k, d: av[av.index(k) + 1] if k in av else d
    r = convert(av[0], av[1], g("--content-base", None), float(g("--sse", 16)), float(g("--screen", 1080)), float(g("--fov", 45)), "--dry-run" in av)
    print(json.dumps(r, indent=1, default=str))
