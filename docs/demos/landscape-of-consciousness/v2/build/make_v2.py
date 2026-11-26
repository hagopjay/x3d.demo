"""v1 -> v2 without the generator's fonts: clear the 35 warnings x3d_mcp 5543a7b found in the delivered world.
 1. OrientationInterpolator keyValue axes -> unit length (same direction, same angle)
 2. IndexedFaceSet faces whose distinct corners are collinear at the written precision are dropped from coordIndex
python3 make_v2.py v1/assets/landscape.x3d v2/assets/landscape.x3d report.json
source/gen.py carries the same axis fix for a rebuild (spin() normalises); the glyph filter is kit/x3d-glyphs in x3d.loom."""
import re, sys, json, math
src, dst, rep = sys.argv[1:4]
t = open(src, encoding="utf-8").read()
report = {"axes_fixed": [], "faces_dropped": 0, "meshes_touched": 0}

def fix_oi(m):
    tag = m.group(0)
    kv = re.search(r"keyValue='([^']*)'", tag)
    nums = [float(x) for x in re.split(r"[\s,]+", kv.group(1).strip()) if x]
    out = []
    changed = False
    for i in range(0, len(nums), 4):
        x, y, z, a = nums[i:i + 4]
        n = math.sqrt(x * x + y * y + z * z)
        if abs(n - 1) > 1e-3 and n > 0:
            x, y, z = x / n, y / n, z / n; changed = True
        out.append(f"{x:.4f} {y:.4f} {z:.4f} {a:.4f}".replace(".0000", "").replace("0 ", "0 "))
    if changed:
        d = re.search(r"DEF='([^']*)'", tag); report["axes_fixed"].append(d.group(1) if d else "?")
        tag = tag.replace(kv.group(0), "keyValue='" + ", ".join(out) + "'")
    return tag
t = re.sub(r"<OrientationInterpolator [^>]*>", fix_oi, t)

def fix_ifs(m):
    whole = m.group(0)
    ci = re.search(r"coordIndex='([^']*)'", whole); pt = re.search(r"<Coordinate [^>]*point='([^']*)'", whole)
    if not ci or not pt:
        return whole
    P = [float(x) for x in re.split(r"[\s,]+", pt.group(1).strip()) if x]
    P = [(P[i], P[i + 1], P[i + 2]) for i in range(0, len(P) - 2, 3)]
    idx = [int(x) for x in re.split(r"[\s,]+", ci.group(1).strip()) if x]
    faces, cur = [], []
    for v in idx:
        if v == -1: faces.append(cur); cur = []
        else: cur.append(v)
    if cur: faces.append(cur)
    keep, dropped = [], 0
    ext = [max(q[k] for q in P) - min(q[k] for q in P) for k in range(3)]; eps = 1e-12 * sum(e * e for e in ext)   # the validator's tolerance (usd_checks.check_zero_area_faces)
    for f in faces:
        if len(set(f)) < 3:
            keep.append(f); continue                      # a repeated index is another check (degenerate-face)
        pts = []
        for v in f:
            if v < len(P) and P[v] not in pts: pts.append(P[v])
        if len(pts) < 3:
            dropped += 1; continue                        # three indices, fewer than three places: collapsed to a point or a segment
        if len(pts) >= 3:
            a, b = pts[0], pts[1]; area = 0.0
            for c in pts[2:]:
                u = (b[0] - a[0], b[1] - a[1], b[2] - a[2]); w = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
                cr = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
                area = max(area, math.sqrt(sum(x * x for x in cr)))
            if area / 2 <= eps:
                dropped += 1; continue
        keep.append(f)
    if not dropped:
        return whole
    report["faces_dropped"] += dropped; report["meshes_touched"] += 1
    if re.search(r"<(Color|ColorRGBA|Normal|TextureCoordinate)\b", whole) or "colorIndex" in whole or "normalIndex" in whole or "texCoordIndex" in whole:
        new = " ".join(" ".join(map(str, f)) + " -1" for f in keep)
        return whole.replace(ci.group(0), "coordIndex='" + new + "'", 1)
    used = sorted({v for f in keep for v in f}); remap = {v: i for i, v in enumerate(used)}   # no per-vertex arrays: compact the points so none is orphaned
    new = " ".join(" ".join(str(remap[v]) for v in f) + " -1" for f in keep)
    flat = re.split(r"[\s,]+", pt.group(1).strip()); flat = [x for x in flat if x]
    newpts = " ".join(" ".join(flat[3 * v:3 * v + 3]) for v in used)
    out = whole.replace(ci.group(0), "coordIndex='" + new + "'", 1).replace(pt.group(1), newpts, 1)
    report["points_removed"] = report.get("points_removed", 0) + (len(P) - len(used))
    return out
t = re.sub(r"<IndexedFaceSet [^>]*>.*?</IndexedFaceSet>", fix_ifs, t, flags=re.S)
open(dst, "w", encoding="utf-8").write(t); json.dump(report, open(rep, "w"), indent=1); print(report)
