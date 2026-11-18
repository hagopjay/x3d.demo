#!/usr/bin/env python3
"""tiles3d_to_x3d v2.1 (18 Nov 2026). v2.1: glb content is placed at its tile frame's origin (the accumulated
transform's translation), not at the bounding-volume centre; the GeoLOD centre still uses the bounding volume.
Origin-at-Earth-centre (ECEF-baked) content is refused. Earlier text:
tiles3d_to_x3d v2 (18 Nov 2026). The geotiling v1 converter (docs/demos/geotiling/v1/, left as shipped) with the
external accountability review's defect 7 fixed:
  * every content URI is resolved against the tileset file that names it, so root.json -> sub/child.json -> mesh.glb
    becomes ../sub/mesh.glb (v1 wrote ../mesh.glb: it resolved everything against the root tileset's folder);
  * semantics this converter cannot carry are REFUSED by default instead of silently changed: refine ADD (v1 mapped
    it to REPLACE), more than one entry in `contents` (v1 kept contents[0]), a glb tile whose transform rotates or
    scales away from local ENU (v1 counted it and placed it unrotated), implicit tiling, a missing external tileset,
    and an external tileset cycle. Exit 2 names every refusal. --allow-lossy converts anyway and writes each loss
    into conversion-report.json next to the output, so the loss is on the record, not hidden.
Original v1 description follows.

3D Tiles (1.0 / 1.1 tileset.json) -> X3D Geospatial. Every tile becomes a GeoLOD; its content becomes the GeoLOD root (GeoLocation + Inline of the .glb);
children become child1Url..child4Url; external tilesets (content .json) become a nested GeoLOD file. stdlib only.
  python3 -I tiles3d_to_x3d.py TILESET.json OUTDIR [--content-base REL_URL_FROM_OUTDIR_TO_TILESET_DIR] [--sse 16] [--screen 1080] [--fov 45] [--dry-run] [--allow-lossy]
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
def geodetic_to_ecef(lat, lon, h):
    la, lo = math.radians(lat), math.radians(lon); n = a_ / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - e2) + h) * math.sin(la))
def geo_distance(p, q):
    return math.dist(geodetic_to_ecef(*p), geodetic_to_ecef(*q))
def enu_relative_rotation(M, lat, lon):
    """Angle between the tile's local axes and the east-north-up basis at its centre (0 for tiles that are already ENU, as geotiling writes them)."""
    la, lo = math.radians(lat), math.radians(lon)
    E = (-math.sin(lo), math.cos(lo), 0); N = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    ex = (M[0], M[1], M[2]); n = math.sqrt(sum(v * v for v in ex)) or 1
    return math.degrees(math.acos(max(-1, min(1, sum(a * b for a, b in zip(ex, E)) / n))))
def frame_loss(M, lat, lon):
    """Rotation (deg) of the tile's x axis from local east, and the largest axis-scale deviation from 1."""
    cols = [(M[0], M[1], M[2]), (M[4], M[5], M[6]), (M[8], M[9], M[10])]
    scale = max(abs(math.sqrt(sum(v * v for v in c)) - 1) for c in cols)
    la, lo = math.radians(lat), math.radians(lon)
    basis = [(-math.sin(lo), math.cos(lo), 0), (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)),
             (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))]
    ang = 0.0
    for c, b in zip(cols, basis):   # every axis, not only x: a turn about east leaves x on east (v1 checked x only)
        n = math.sqrt(sum(v * v for v in c)) or 1
        ang = max(ang, math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(c, b)) / n)))))
    return ang, scale
HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n <head><component name="Geospatial" level="1"/><meta name="title" content="{t}"/><meta name="generator" content="tiles3d_to_x3d.py v2.1 (x3d.demo tools/tiles3d)"/></head>\n <Scene>\n{b}\n </Scene>\n</X3D>\n'
class Unsupported(Exception):
    def __init__(self, items): super().__init__("; ".join(items)); self.items = items
def convert(tileset_path, outdir, content_base=None, sse=16.0, screen=1080, fov=45.0, dry=False, allow_lossy=False):
    tp = pathlib.Path(tileset_path).resolve(); ts = json.loads(tp.read_text()); out = pathlib.Path(outdir).resolve(); K = screen / (2 * math.tan(math.radians(fov / 2)) * sse)
    stats = dict(tiles=0, with_content=0, glb=0, external_json=0, external_missing=0, add_refine=0, non_enu=0, chunked=0, multi_contents=0, implicit=0,
                 bv=dict(), max_depth=0, ranges=[], origin_offsets_m=[], version=ts.get("asset", {}).get("version"))
    losses, files = [], {}
    def loss(where, what): losses.append(f"{where}: {what}")
    def content_url(base, u):
        if "://" in u or u.startswith("/"): return u                          # absolute URL: kept as written
        target = (base / u).resolve()
        if content_base is not None: return content_base.rstrip("/") + "/" + os.path.relpath(target, tp.parent).replace("\\", "/")
        return os.path.relpath(target, out).replace("\\", "/")
    def contents_of(node, name):
        if node.get("content"): return [node["content"]]
        cs = [c for c in node.get("contents", []) if c and c.get("uri")]
        if len(cs) > 1: stats["multi_contents"] += 1; loss(name, f"{len(cs)} contents; only the first is converted")
        return cs[:1]
    def emit(node, M, depth, name, base, chain, refine):
        stats["tiles"] += 1; stats["max_depth"] = max(stats["max_depth"], depth); M = mat_mul(M, node.get("transform", IDENT))
        stats["bv"][next(iter(node["boundingVolume"]))] = stats["bv"].get(next(iter(node["boundingVolume"])), 0) + 1
        refine = node.get("refine", refine)
        if refine == "ADD": stats["add_refine"] += 1; loss(name, "refine ADD drawn as REPLACE (GeoLOD swaps its root for its children)")
        if "implicitTiling" in node: stats["implicit"] += 1; loss(name, "implicitTiling subtree not expanded")
        lat, lon, h = centre(node, M); ge = float(node.get("geometricError", 0)); ge = min(ge, 1e12)
        kids = [(k, base, chain) for k in node.get("children", [])]; body = None
        for c in contents_of(node, name):
            stats["with_content"] += 1; u = c["uri"].split("?")[0]
            if u.endswith(".json"):
                stats["external_json"] += 1; ext = (base / u).resolve()
                if ext in chain: loss(name, f"external tileset cycle at {u}"); continue
                if ext.exists():
                    sub = json.loads(ext.read_text()); kids = [(sub["root"], ext.parent, chain | {ext})] + kids
                else: stats["external_missing"] += 1; loss(name, f"external tileset {u} not found")
            else:
                stats["glb"] += 1
                # content vertices are in the tile's frame, so its local (0,0,0) sits at M's translation, wherever
                # the bounding volume's centre is (second review, 18 Nov 2026, defect 4: v2 placed content at the
                # bounding-volume centre, 9.996 m off for a sphere centred 10 m from the content origin)
                if math.sqrt(M[12] ** 2 + M[13] ** 2 + M[14] ** 2) < 1000:
                    stats["non_enu"] += 1; loss(name, "content has no geodetic origin (transform translation at the Earth's centre: ECEF-baked content); not placed")
                    continue
                olat, olon, oh = ecef_to_geodetic(M[12], M[13], M[14]); ang, sc = frame_loss(M, olat, olon)
                if ang > 1e-3 or sc > 1e-6: stats["non_enu"] += 1; loss(name, f"content frame is {ang:.3f} deg from local ENU, scale off by {sc:.2e}; placed unrotated and unscaled")
                stats["origin_offsets_m"].append(round(geo_distance((lat, lon, h), (olat, olon, oh)), 3))
                body = f'  <GeoLocation geoSystem=\'"GD" "WE"\' geoCoords="{olat:.9f} {olon:.9f} {oh:.3f}"><Inline url=\'"{content_url(base, u)}"\'/></GeoLocation>'
        if len(kids) > 4:
            stats["chunked"] += 1; q = (len(kids) + 3) // 4
            kids = [(dict(boundingVolume=node["boundingVolume"], geometricError=ge, children=[], _group=kids[i * q:(i + 1) * q]), base, chain) for i in range(4) if kids[i * q:(i + 1) * q]]
        kfiles = []
        for i, (k, kb, kc) in enumerate(kids):
            if "_group" in k:   # a chunk: its members keep their own base and chain
                k = dict(k); grp = k.pop("_group")
                kfiles.append(emit_group(k, grp, M, depth + 1, f"{name}_{i}", refine))
            else: kfiles.append(emit(k, M, depth + 1, f"{name}_{i}", kb, kc, refine))
        rng = min(ge * K, 1e10) if kids else 0; stats["ranges"].append(rng)
        return write(name, lat, lon, h, rng, body, kfiles)
    def emit_group(node, grp, M, depth, name, refine):
        stats["tiles"] += 1; stats["max_depth"] = max(stats["max_depth"], depth)
        stats["bv"][next(iter(node["boundingVolume"]))] = stats["bv"].get(next(iter(node["boundingVolume"])), 0) + 1
        lat, lon, h = centre(node, M); ge = float(node.get("geometricError", 0))
        kids = grp
        if len(kids) > 4:
            stats["chunked"] += 1; q = (len(kids) + 3) // 4
            kfiles = [emit_group(dict(node), kids[i * q:(i + 1) * q], M, depth + 1, f"{name}_{i}", refine) for i in range(4) if kids[i * q:(i + 1) * q]]
        else: kfiles = [emit(k, M, depth + 1, f"{name}_{i}", kb, kc, refine) for i, (k, kb, kc) in enumerate(kids)]
        rng = min(ge * K, 1e10); stats["ranges"].append(rng)
        return write(name, lat, lon, h, rng, None, kfiles)
    def write(name, lat, lon, h, rng, body, kfiles):
        if body is not None: files[f"{name}.mesh.x3d"] = HEAD.format(t=f"tile {name}", b=body)
        if kfiles:
            cu = " ".join(f'child{i + 1}Url=\'"{k}"\'' for i, k in enumerate(kfiles))
            root = f' rootUrl=\'"{name}.mesh.x3d"\'' if body is not None else ""
            files[f"{name}.x3d"] = HEAD.format(t=f"GeoLOD {name}", b=f'  <GeoLOD geoSystem=\'"GD" "WE"\' center="{lat:.6f} {lon:.6f} {h:.1f}" range="{rng:.1f}"{root} {cu}/>')
        elif body is not None: files[f"{name}.x3d"] = files.pop(f"{name}.mesh.x3d")
        else: files[f"{name}.x3d"] = HEAD.format(t=f"empty {name}", b="  <Group/>")
        return f"{name}.x3d"
    top = emit(ts["root"], IDENT, 0, "t", tp.parent, frozenset({tp}), ts["root"].get("refine", "REPLACE"))
    stats["root_file"] = top; stats["K"] = K; stats["files"] = len(files)
    stats["ranges"] = dict(min=min(stats["ranges"]), max=max(stats["ranges"])); stats["losses"] = losses
    if losses and not allow_lossy: raise Unsupported(losses)
    if not dry:
        out.mkdir(parents=True, exist_ok=True)
        for n, c in files.items(): (out / n).write_text(c, encoding="utf8")
        if losses: (out / "conversion-report.json").write_text(json.dumps(dict(stats, lossy=True), indent=1, default=str) + "\n")
    return stats
if __name__ == "__main__":
    av = sys.argv[1:]; g = lambda k, d: av[av.index(k) + 1] if k in av else d
    try:
        r = convert(av[0], av[1], g("--content-base", None), float(g("--sse", 16)), float(g("--screen", 1080)), float(g("--fov", 45)), "--dry-run" in av, "--allow-lossy" in av)
    except Unsupported as e:
        print(json.dumps({"refused": "UNSUPPORTED_SEMANTICS", "items": e.items, "hint": "re-run with --allow-lossy to convert and record each loss"}, indent=1)); sys.exit(2)
    print(json.dumps(r, indent=1, default=str))
